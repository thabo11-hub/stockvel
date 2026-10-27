// Stokvel API: one Vercel function that routes every /api/* request.
import crypto from 'node:crypto';
import { q, one, ensureSchema, dbConfigured, iso } from '../lib/db.js';
import {
  COOKIE, SESSION_DAYS, normalizePhone, oldPhoneForm, formatPhone, hashPassword, verifyPassword,
  newToken, sha256, safeEqual, readCookie, sessionCookie,
} from '../lib/auth.js';
import {
  KEY_RE, DATE_RE, STATUSES, ATTENDANCE, TITLES, addMonths, monthDiff, isActive, rotation, saMonth, saToday, isoDate,
} from '../public/logic.js';

class HttpError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code || null; }
}
const fail = (status, message, code) => { throw new HttpError(status, message, code); };
// A route that writes its own response (a file, not JSON) returns this.
const SENT = Symbol('sent');

const UUID = '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})';
const MONTH = '(\\d{4}-(?:0[1-9]|1[0-2]))';
const TOKEN = '([A-Za-z0-9_-]{20,64})';
const UUID_RE = new RegExp('^' + UUID + '$');

const ROUTES = [
  ['GET', 'session', getSession, false],
  ['POST', 'setup', postSetup, false],
  ['POST', 'login', postLogin, false],
  ['POST', 'logout', postLogout, false],
  ['PATCH', 'account', patchAccount, true],
  ['GET', `invites/${TOKEN}`, getInvite, false],
  ['POST', `invites/${TOKEN}/accept`, acceptInvite, false],
  ['GET', 'stokvels', listStokvels, true],
  ['POST', 'stokvels', createStokvel, true],
  ['GET', `stokvels/${UUID}`, getStokvel, true],
  ['PATCH', `stokvels/${UUID}`, patchStokvel, true],
  ['DELETE', `stokvels/${UUID}`, deleteStokvel, true],
  ['POST', `stokvels/${UUID}/members`, addMember, true],
  ['PATCH', `stokvels/${UUID}/members/${UUID}`, patchMember, true],
  ['DELETE', `stokvels/${UUID}/members/${UUID}`, removeMember, true],
  ['POST', `stokvels/${UUID}/members/${UUID}/invite`, inviteMember, true],
  ['DELETE', `stokvels/${UUID}/members/${UUID}/link`, unlinkMember, true],
  ['PUT', `stokvels/${UUID}/contributions`, putContribution, true, 4600000],
  ['GET', `stokvels/${UUID}/proofs/${UUID}/${MONTH}`, getProof, true],
  ['PUT', `stokvels/${UUID}/meetings/${MONTH}`, putMeeting, true],
  ['PUT', `stokvels/${UUID}/payouts/${MONTH}`, putPayout, true],
  ['PUT', `stokvels/${UUID}/order`, putOrder, true],
].map(([method, pattern, fn, auth, limit = 200000]) => ({ method, re: new RegExp('^' + pattern + '$'), fn, auth, limit }));

export default async function handler(req, res) {
  try {
    const { url, path } = routeOf(req);
    const method = String(req.method || 'GET').toUpperCase();
    let route = null, params = [], known = false;
    for (const r of ROUTES) {
      const m = r.re.exec(path);
      if (!m) continue;
      known = true;
      if (r.method === method) { route = r; params = m.slice(1); break; }
    }
    if (!route) fail(known ? 405 : 404, known ? 'That action is not allowed here.' : 'Not found.');
    if (method !== 'GET' && !(req.headers['x-stokvel'] === '1' && sameOrigin(req))) {
      fail(403, 'This request was blocked. Reload the page and try again.', 'blocked');
    }
    if (!dbConfigured()) {
      if (route.fn === getSession) return send(res, 200, { dbReady: false });
      fail(503, 'The database is not connected yet.', 'no_db');
    }
    await ensureSchema();
    const user = await currentUser(req);
    if (route.auth && !user) fail(401, 'Log in to continue.', 'auth');
    const body = method === 'GET' ? {} : await readBody(req, route.limit);
    const out = await route.fn({ req, res, url, params, user, body });
    if (out !== SENT) send(res, 200, out || {});
  } catch (e) {
    if (e instanceof HttpError) return send(res, e.status, { error: e.message, code: e.code });
    console.error('[stokvel]', e);
    send(res, 500, { error: 'Something went wrong on our side. Try again in a moment.', code: 'server' });
  }
}

/* ---------- plumbing ---------- */

function routeOf(req) {
  const url = new URL(req.url || '/', 'http://local');
  let path = url.pathname;
  // vercel.json rewrites /api/<path> to /api/index?path=<path>.
  if (/^\/api(\/index(\.js)?)?\/?$/.test(path) && url.searchParams.has('path')) path = '/api/' + url.searchParams.get('path');
  return { url, path: path.replace(/^\/api\/?/, '').replace(/\/+$/, '') };
}

function send(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(data));
}

async function readBody(req, limit) {
  let pre;
  try { pre = req.body; } catch (e) { fail(400, 'Send the data as JSON.'); }
  if (pre && typeof pre === 'object' && !Buffer.isBuffer(pre)) return pre;
  let raw = typeof pre === 'string' ? pre : Buffer.isBuffer(pre) ? pre.toString('utf8') : null;
  if (raw === null) {
    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > limit) fail(413, 'That request is too large.');
      chunks.push(c);
    }
    raw = Buffer.concat(chunks).toString('utf8');
  }
  if (!raw.trim()) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? v : {};
  } catch (e) { fail(400, 'Send the data as JSON.'); }
}

const header = (req, name) => String(req.headers[name] || '').split(',')[0].trim();
const isSecure = req => process.env.VERCEL === '1' || header(req, 'x-forwarded-proto') === 'https';
const hostOf = req => header(req, 'x-forwarded-host') || header(req, 'host');
const originOf = req => (header(req, 'x-forwarded-proto') || (process.env.VERCEL === '1' ? 'https' : 'http')) + '://' + hostOf(req);

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === hostOf(req); } catch (e) { return false; }
}

async function currentUser(req) {
  const token = readCookie(req, COOKIE);
  if (!token || token.length > 128) return null;
  const u = await one(
    `SELECT u.id::text AS id, u.name, u.phone, u.is_admin
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now()`, [sha256(token)]);
  if (u) u.token = token;
  return u;
}

const publicUser = u => ({ id: u.id, name: u.name, phone: formatPhone(u.phone), isAdmin: !!u.is_admin });

async function startSession(req, res, userId) {
  const token = newToken();
  await q(`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2::uuid, now() + make_interval(days => $3::int))`,
    [sha256(token), userId, SESSION_DAYS]);
  res.setHeader('Set-Cookie', sessionCookie(token, isSecure(req)));
}

async function log(stokvelId, userId, action, detail) {
  try {
    await q(`INSERT INTO activity (stokvel_id, user_id, action, detail) VALUES ($1::uuid, $2::uuid, $3, $4::jsonb)`,
      [stokvelId, userId, action, JSON.stringify(detail || {})]);
  } catch (e) { console.error('[stokvel] activity log', e); }
}

/* ---------- validation ---------- */

function text(v, label, max = 60) {
  const s = typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '';
  if (!s) fail(400, `Enter ${label}.`);
  if (s.length > max) fail(400, `Keep ${label} under ${max} characters.`);
  return s;
}
function whole(v, label, lo, hi) {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/[\s,]/g, ''));
  if (!Number.isInteger(n) || n < lo || n > hi) fail(400, `${label} must be a whole number from ${lo} to ${hi}.`);
  return n;
}
function phoneOf(v) {
  const p = normalizePhone(v);
  if (!p) fail(400, 'Enter a phone number, like 082 123 4567.');
  return p;
}
function passwordOf(v) {
  const s = typeof v === 'string' ? v : '';
  if (s.length < 6) fail(400, 'Use a password of at least 6 characters.');
  if (s.length > 200) fail(400, 'That password is too long.');
  return s;
}
function uuidOf(v) {
  const s = String(v || '');
  if (!UUID_RE.test(s)) fail(400, 'Pick a member.');
  return s;
}
function monthOf(v, a) {
  const k = String(v || '');
  if (!KEY_RE.test(k)) fail(400, 'Pick a month, like 2026-10.');
  const d = monthDiff(a.start_month, k);
  if (d < 0 || d > 59) fail(400, 'That month is outside this stokvel’s cycle.');
  return k;
}
function readSettings(body, creating) {
  const out = {};
  const has = k => creating || body[k] !== undefined;
  if (has('name')) out.name = text(body.name, 'a name for the stokvel');
  if (has('kind')) {
    if (!['rotating', 'fund'].includes(body.kind)) fail(400, 'Choose how the stokvel pays out.');
    out.kind = body.kind;
  }
  if (has('amount')) out.amount = whole(body.amount, 'The monthly amount', 1, 10000000);
  if (has('payDay')) out.payDay = whole(body.payDay ?? 25, 'The due day', 1, 28);
  if (has('startMonth')) {
    if (!KEY_RE.test(String(body.startMonth || ''))) fail(400, 'Pick the first month, like 2026-10.');
    out.startMonth = body.startMonth;
  }
  if (has('months')) out.months = whole(body.months ?? 12, 'The number of months', 1, 36);
  if (has('lateFine')) out.lateFine = whole(body.lateFine ?? 0, 'The late fine', 0, 1000000);
  if (has('meetings')) out.meetings = body.meetings === true;
  if (has('meetFine')) out.meetFine = whole(body.meetFine ?? 0, 'The missed-meeting fine', 0, 1000000);
  return out;
}
// The day a payment was made. Defaults to today; a day of slack allows for phones in another time zone.
function paidOnOf(v) {
  if (v === undefined || v === null || v === '') return isoDate(saToday());
  const s = String(v);
  const [y, m, d] = s.split('-').map(Number);
  if (!DATE_RE.test(s) || new Date(y, m - 1, d).getDate() !== d) fail(400, 'Pick the date of the payment.');
  const tomorrow = saToday();
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (s > isoDate(tomorrow)) fail(400, 'The payment date can’t be in the future.');
  return s;
}

// Proof of payment: a photo or a PDF of up to 3 MB, sent as base64. The type comes from
// the file's first bytes, never from what the browser claims, so nothing else can be stored.
const PROOF_MAX = 3 * 1024 * 1024;
const PROOF_TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'application/pdf': '.pdf' };
function sniffType(b) {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 8 && b.toString('hex', 0, 8) === '89504e470d0a1a0a') return 'image/png';
  if (b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  if (b.length > 5 && b.toString('latin1', 0, 5) === '%PDF-') return 'application/pdf';
  return null;
}
function readProof(v) {
  if (v === undefined) return undefined;   // keep whatever is there
  if (v === null) return null;             // remove it
  if (!v || typeof v !== 'object' || typeof v.data !== 'string' || !v.data) fail(400, 'Attach the proof as a photo or a PDF.');
  const tooBig = () => fail(413, 'That file is too big. Use a photo, or a PDF under 3 MB.', 'too_big');
  if (v.data.length > Math.ceil(PROOF_MAX / 3) * 4 + 4) tooBig();
  const buf = Buffer.from(v.data, 'base64');
  if (buf.length > PROOF_MAX) tooBig();
  const type = sniffType(buf);
  if (!type) fail(400, 'Proof of payment must be a photo (JPG, PNG or WebP) or a PDF.', 'proof_type');
  const ext = PROOF_TYPES[type];
  let name = String(v.name || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').trim().slice(-80);
  if (!name.toLowerCase().endsWith(ext)) name = (name.replace(/\.[^.]*$/, '') || 'proof-of-payment').slice(0, 70) + ext;
  return { buf, type, name };
}
const proofMeta = r => r && r.proof_type ? { name: r.proof_name, type: r.proof_type, size: r.proof_size, at: r.proof_at } : null;

const setupCode = () => String(process.env.SETUP_CODE || '').toUpperCase().replace(/\s+/g, '');
// Ends a sentence that finishes on a name, without doubling the full stop of names like "Tshepo M."
const stop = s => /[.!?]$/.test(String(s)) ? String(s) : String(s) + '.';
const hasLeft = (m, now) => !!m.left_month && monthDiff(m.left_month, now) >= 0;

/* ---------- accounts ---------- */

async function getSession({ user }) {
  const row = await one(`SELECT EXISTS (SELECT 1 FROM users) AS any`);
  return { dbReady: true, user: user ? publicUser(user) : null, setupNeeded: !row.any, setupAllowed: !!setupCode() };
}

async function postSetup({ req, res, body }) {
  const code = setupCode();
  if (!code) fail(403, 'Setup is switched off. Add a SETUP_CODE environment variable in Vercel, then redeploy.', 'setup_off');
  const given = String(body.code || '').toUpperCase().replace(/\s+/g, '');
  if (!safeEqual(given, code)) fail(403, 'That setup code doesn’t match. Check it and try again.', 'setup_code');
  const name = text(body.name, 'your name');
  const phone = phoneOf(body.phone);
  const hash = await hashPassword(passwordOf(body.password));
  const row = await one(
    `INSERT INTO users (phone, name, pass_hash, is_admin)
     SELECT $1, $2, $3, true WHERE NOT EXISTS (SELECT 1 FROM users)
     RETURNING id::text AS id`, [phone, name, hash]);
  if (!row) fail(409, 'Setup is already done. Log in instead.', 'setup_done');
  await startSession(req, res, row.id);
  return { user: publicUser({ id: row.id, name, phone, is_admin: true }) };
}

// A phone number as typed, and the form older accounts may have stored it in.
const phoneForms = input => { const p = phoneOf(input); return [p, oldPhoneForm(p)]; };

async function checkPassword(input, password) {
  const [phone, legacy] = phoneForms(input);
  const lock = await one(`SELECT count, (last_at > now() - interval '15 minutes') AS recent FROM login_failures WHERE phone = $1`, [phone]);
  if (lock && lock.recent && lock.count >= 8) fail(429, 'Too many wrong tries. Wait 15 minutes, then try again.', 'locked');
  const user = await one(
    `SELECT id::text AS id, name, phone, is_admin, pass_hash FROM users
      WHERE phone = $1 OR phone = $2 ORDER BY (phone = $1) DESC LIMIT 1`, [phone, legacy]);
  const ok = await verifyPassword(String(password || ''), user ? user.pass_hash : '');
  if (!user || !ok) {
    await q(
      `INSERT INTO login_failures (phone, count, last_at) VALUES ($1, 1, now())
       ON CONFLICT (phone) DO UPDATE SET
         count = CASE WHEN login_failures.last_at > now() - interval '15 minutes' THEN login_failures.count + 1 ELSE 1 END,
         last_at = now()`, [phone]);
    fail(401, 'That phone number and password don’t match.', 'login');
  }
  if (lock) await q(`DELETE FROM login_failures WHERE phone = $1`, [phone]);
  return user;
}

async function postLogin({ req, res, body }) {
  const user = await checkPassword(body.phone, body.password);
  await startSession(req, res, user.id);
  await q(`DELETE FROM sessions WHERE expires_at < now()`);
  return { user: publicUser(user) };
}

async function postLogout({ req, res, user }) {
  if (user) await q(`DELETE FROM sessions WHERE token_hash = $1`, [sha256(user.token)]);
  res.setHeader('Set-Cookie', sessionCookie('', isSecure(req)));
  return { ok: true };
}

async function patchAccount({ user, body }) {
  if (body.name !== undefined) {
    const name = text(body.name, 'your name');
    await q(`UPDATE users SET name = $2 WHERE id = $1::uuid`, [user.id, name]);
    user.name = name;
  }
  if (body.newPassword !== undefined) {
    const row = await one(`SELECT pass_hash FROM users WHERE id = $1::uuid`, [user.id]);
    if (!(await verifyPassword(String(body.currentPassword || ''), row.pass_hash))) fail(400, 'Your current password isn’t right.', 'password');
    const hash = await hashPassword(passwordOf(body.newPassword));
    await q(`UPDATE users SET pass_hash = $2 WHERE id = $1::uuid`, [user.id, hash]);
    await q(`DELETE FROM sessions WHERE user_id = $1::uuid AND token_hash <> $2`, [user.id, sha256(user.token)]);
  }
  return { user: publicUser(user) };
}

/* ---------- invites ---------- */

async function makeInvite(req, stokvelId, memberId, userId) {
  const token = newToken(24);
  await q(`DELETE FROM invites WHERE member_id = $1::uuid AND used_at IS NULL`, [memberId]);
  const row = await one(
    `INSERT INTO invites (token_hash, stokvel_id, member_id, created_by, expires_at)
     VALUES ($1, $2::uuid, $3::uuid, $4::uuid, now() + interval '14 days')
     RETURNING ${iso('expires_at')} AS expires_at`, [sha256(token), stokvelId, memberId, userId]);
  return { url: originOf(req) + '/join/' + token, expiresAt: row.expires_at };
}

async function loadInvite(token) {
  return one(
    `SELECT (i.expires_at > now()) AS live, (i.used_at IS NOT NULL) AS used,
            m.id::text AS member_id, m.name AS member_name, (m.user_id IS NOT NULL) AS taken, m.left_month,
            s.id::text AS stokvel_id, s.name AS stokvel_name, coalesce(s.treasurer_id = m.id, false) AS is_treasurer,
            s.kind, s.amount, s.meetings, cu.name AS invited_by
       FROM invites i
       JOIN members m ON m.id = i.member_id
       JOIN stokvels s ON s.id = i.stokvel_id
       LEFT JOIN users cu ON cu.id = i.created_by
      WHERE i.token_hash = $1`, [sha256(token)]);
}

function checkInvite(inv) {
  if (!inv) fail(404, 'This invite link isn’t valid. Ask your treasurer for a new one.', 'invite_invalid');
  if (inv.used) fail(410, 'This invite link has already been used. If that wasn’t you, ask your treasurer for a new one.', 'invite_used');
  if (!inv.live) fail(410, 'This invite link has expired. Ask your treasurer for a new one.', 'invite_expired');
  if (inv.taken) fail(409, `Someone has already joined as ${stop(inv.member_name)} Ask your treasurer if that’s a mistake.`, 'invite_taken');
  if (hasLeft(inv, saMonth())) fail(410, `${inv.member_name} is no longer a member of ${inv.stokvel_name}.`, 'invite_left');
}

async function getInvite({ params, user }) {
  const inv = await loadInvite(params[0]);
  checkInvite(inv);
  let alreadyIn = null;
  if (user) {
    const r = await one(`SELECT name FROM members WHERE stokvel_id = $1::uuid AND user_id = $2::uuid`, [inv.stokvel_id, user.id]);
    if (r) alreadyIn = r.name;
  }
  return {
    stokvel: { id: inv.stokvel_id, name: inv.stokvel_name, kind: inv.kind, amount: inv.amount, meetings: inv.meetings },
    member: { name: inv.member_name, isTreasurer: inv.is_treasurer },
    invitedBy: inv.invited_by || '',
    alreadyIn,
  };
}

const CLAIM_INVITE = `
  UPDATE invites SET used_at = now(), used_by = $2::uuid
   WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
     AND EXISTS (SELECT 1 FROM members m WHERE m.id = invites.member_id AND m.user_id IS NULL)
  RETURNING member_id`;

async function acceptInvite({ req, res, params, user, body }) {
  const token = params[0];
  const tokenHash = sha256(token);
  const inv = await loadInvite(token);
  checkInvite(inv);

  if (!user && body.mode !== 'login') {
    const name = text(body.name, 'your name');
    const [phone, legacy] = phoneForms(body.phone);
    const hash = await hashPassword(passwordOf(body.password));
    const taken = await one(`SELECT 1 AS x FROM users WHERE phone = $1 OR phone = $2`, [phone, legacy]);
    if (taken) fail(409, 'There’s already an account for this number. Choose “I already have an account” and log in.', 'phone_taken');
    let row;
    try {
      row = await one(
        `WITH inv AS (
           UPDATE invites SET used_at = now()
            WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
              AND EXISTS (SELECT 1 FROM members m WHERE m.id = invites.member_id AND m.user_id IS NULL)
           RETURNING member_id
         ), u AS (
           INSERT INTO users (phone, name, pass_hash) SELECT $2, $3, $4 WHERE EXISTS (SELECT 1 FROM inv) RETURNING id
         ), m AS (
           UPDATE members SET user_id = (SELECT id FROM u) WHERE id = (SELECT member_id FROM inv) RETURNING id
         )
         SELECT (SELECT id::text FROM u) AS user_id, (SELECT id::text FROM m) AS member_id`,
        [tokenHash, phone, name, hash]);
    } catch (e) {
      if (e && e.code === '23505') fail(409, 'There’s already an account for this number. Choose “I already have an account” and log in.', 'phone_taken');
      throw e;
    }
    if (!row || !row.user_id || !row.member_id) fail(409, 'This invite was used a moment ago. Ask your treasurer for a new one.', 'invite_used');
    await q(`UPDATE invites SET used_by = $2::uuid WHERE token_hash = $1`, [tokenHash, row.user_id]);
    await startSession(req, res, row.user_id);
    await log(inv.stokvel_id, row.user_id, 'joined', { member: inv.member_name });
    return { stokvelId: inv.stokvel_id };
  }

  let userId = user && user.id;
  if (!user) {
    const u = await checkPassword(body.phone, body.password);
    userId = u.id;
    await startSession(req, res, userId);
  }
  const already = await one(`SELECT name FROM members WHERE stokvel_id = $1::uuid AND user_id = $2::uuid`, [inv.stokvel_id, userId]);
  if (already) fail(409, `You’re already in ${inv.stokvel_name} as ${stop(already.name)}`, 'already_member');
  const linked = await one(
    `WITH inv AS (${CLAIM_INVITE})
     UPDATE members SET user_id = $2::uuid WHERE id = (SELECT member_id FROM inv) RETURNING id::text AS id`, [tokenHash, userId]);
  if (!linked) fail(409, 'This invite was used a moment ago. Ask your treasurer for a new one.', 'invite_used');
  await log(inv.stokvel_id, userId, 'joined', { member: inv.member_name });
  return { stokvelId: inv.stokvel_id };
}

/* ---------- stokvels ---------- */

async function access(stokvelId, user) {
  const r = await one(
    `SELECT s.id::text AS id, s.name, s.kind, s.amount, s.start_month, s.months, s.meetings, s.payout_order,
            s.treasurer_id::text AS treasurer_id, coalesce(s.created_by = $2::uuid, false) AS is_creator,
            me.id::text AS my_member_id, t.user_id::text AS treasurer_user_id
       FROM stokvels s
       LEFT JOIN members me ON me.stokvel_id = s.id AND me.user_id = $2::uuid
       LEFT JOIN members t ON t.id = s.treasurer_id
      WHERE s.id = $1::uuid`, [stokvelId, user.id]);
  if (!r || !(r.my_member_id || r.is_creator)) fail(404, 'We couldn’t find that stokvel.', 'not_found');
  const isTreasurer = !!r.my_member_id && r.treasurer_id === r.my_member_id;
  // Until the treasurer has joined, whoever created the stokvel can set it up and invite them.
  const canManage = isTreasurer || (r.is_creator && !r.treasurer_user_id);
  return { ...r, isTreasurer, canManage, canConfirm: isTreasurer };
}
const needManage = a => { if (!a.canManage) fail(403, 'Only the treasurer can change this.', 'forbidden'); };
const needConfirm = a => { if (!a.canConfirm) fail(403, 'Only the treasurer can confirm payments and take the register.', 'forbidden'); };

async function memberOf(stokvelId, memberId) {
  const m = await one(
    `SELECT id::text AS id, name, user_id::text AS user_id, joined_month, left_month, sort
       FROM members WHERE id = $1::uuid AND stokvel_id = $2::uuid`, [memberId, stokvelId]);
  if (!m) fail(404, 'We couldn’t find that member.', 'not_found');
  return m;
}

async function listStokvels({ user, url }) {
  const m = url.searchParams.get('month');
  const month = m && KEY_RE.test(m) ? m : saMonth();
  const rows = await q(
    `SELECT s.id::text AS id, s.name, s.kind, s.amount, s.meetings, s.start_month,
            me.name AS my_name, coalesce(s.treasurer_id = me.id, false) AS is_treasurer,
            t.name AS treasurer_name, (t.user_id IS NOT NULL) AS treasurer_joined,
            (SELECT count(*)::int FROM members x WHERE x.stokvel_id = s.id AND x.joined_month <= $2 AND (x.left_month = '' OR x.left_month > $2)) AS active_count,
            (SELECT coalesce(sum(c.amount), 0)::int FROM contributions c WHERE c.stokvel_id = s.id AND c.month >= s.start_month) AS total_collected,
            (SELECT coalesce(sum(c.amount), 0)::int FROM contributions c WHERE c.stokvel_id = s.id AND c.month = $2) AS month_collected,
            (SELECT count(*)::int FROM contributions c WHERE c.stokvel_id = s.id AND c.month = $2 AND c.status <> 'part') AS month_paid,
            (SELECT coalesce(sum(c.amount), 0)::int FROM contributions c WHERE c.member_id = me.id AND c.month >= s.start_month) AS my_total,
            (SELECT c.status FROM contributions c WHERE c.member_id = me.id AND c.month = $2) AS my_status,
            (SELECT c.amount FROM contributions c WHERE c.member_id = me.id AND c.month = $2) AS my_amount,
            coalesce(s.created_by = $1::uuid, false) AS created_by_me
       FROM members me
       JOIN stokvels s ON s.id = me.stokvel_id
       LEFT JOIN members t ON t.id = s.treasurer_id
      WHERE me.user_id = $1::uuid
      ORDER BY s.created_at`, [user.id, month]);
  return {
    month,
    user: publicUser(user),
    stokvels: rows.map(r => ({
      id: r.id, name: r.name, kind: r.kind, amount: r.amount, meetings: r.meetings, startMonth: r.start_month,
      myName: r.my_name, role: r.is_treasurer ? 'treasurer' : 'member',
      treasurerName: r.treasurer_name || '', treasurerJoined: !!r.treasurer_joined, createdByMe: r.created_by_me,
      activeCount: r.active_count, totalCollected: r.total_collected,
      monthCollected: r.month_collected, monthPaid: r.month_paid,
      myTotal: r.my_total, myStatus: r.my_status, myAmount: r.my_amount,
    })),
  };
}

async function createStokvel({ req, user, body }) {
  const s = readSettings(body, true);
  const myName = text(body.myName, 'your name in this stokvel');
  const names = [myName];
  for (const raw of Array.isArray(body.members) ? body.members : []) {
    const n = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : '';
    if (!n) continue;
    if (n.length > 60) fail(400, 'Keep each name under 60 characters.');
    names.push(n);
  }
  if (names.length > 60) fail(400, 'A stokvel can have up to 60 members.');
  const seen = new Set();
  for (const n of names) {
    if (seen.has(n.toLowerCase())) fail(400, `Two members are called ${stop(n)} Add a surname or initial so you can tell them apart.`);
    seen.add(n.toLowerCase());
  }
  const want = typeof body.treasurerName === 'string' ? body.treasurerName.trim().replace(/\s+/g, ' ').toLowerCase() : '';
  let ti = want ? names.findIndex(n => n.toLowerCase() === want) : 0;
  if (ti < 0) fail(400, 'Pick the treasurer from the members you listed.');

  const sid = crypto.randomUUID();
  const rows = names.map((name, i) => ({ id: crypto.randomUUID(), name, user_id: i === 0 ? user.id : '', sort: i }));
  await q(
    `WITH s AS (
       INSERT INTO stokvels (id, name, kind, amount, pay_day, start_month, months, late_fine, meetings, meet_fine, treasurer_id, created_by)
       VALUES ($1::uuid, $2, $3, $4::int, $5::int, $6, $7::int, $8::int, $9::boolean, $10::int, $11::uuid, $12::uuid)
       RETURNING id
     )
     INSERT INTO members (id, stokvel_id, name, user_id, sort)
     SELECT x.id::uuid, (SELECT id FROM s), x.name, NULLIF(x.user_id, '')::uuid, x.sort
       FROM jsonb_to_recordset($13::jsonb) AS x(id text, name text, user_id text, sort int)`,
    [sid, s.name, s.kind, s.amount, s.payDay, s.startMonth, s.kind === 'fund' ? s.months : names.length,
      s.lateFine, s.meetings, s.meetFine, rows[ti].id, user.id, JSON.stringify(rows)]);
  await log(sid, user.id, 'created', { name: s.name });
  let treasurerInvite = null;
  if (ti !== 0) {
    const inv = await makeInvite(req, sid, rows[ti].id, user.id);
    treasurerInvite = { ...inv, memberName: rows[ti].name };
  }
  return { id: sid, treasurerInvite };
}

async function getStokvel({ params, user }) {
  const a = await access(params[0], user);
  const sid = a.id;
  const full = a.isTreasurer;
  const [st, members, contributions, totals, meetings, payouts, activity] = await Promise.all([
    one(`SELECT id::text AS id, name, kind, amount, pay_day, start_month, months, late_fine, meetings, meet_fine,
                payout_order, treasurer_id::text AS treasurer_id
           FROM stokvels WHERE id = $1::uuid`, [sid]),
    q(`SELECT m.id::text AS id, m.name, m.title, m.joined_month, m.left_month, m.sort,
              CASE WHEN $2::boolean THEN (m.user_id IS NOT NULL) END AS linked,
              CASE WHEN $2::boolean THEN u.name END AS account_name,
              CASE WHEN $2::boolean THEN (SELECT ${iso('max(i.expires_at)')} FROM invites i
                                           WHERE i.member_id = m.id AND i.used_at IS NULL AND i.expires_at > now()) END AS invite_expires
         FROM members m LEFT JOIN users u ON u.id = m.user_id
        WHERE m.stokvel_id = $1::uuid
        ORDER BY m.sort, m.created_at`, [sid, a.canManage]),
    q(`SELECT c.member_id::text AS member_id, c.month, c.status, c.amount, c.paid_on, ${iso('c.confirmed_at')} AS at, u.name AS by_name,
              p.name AS proof_name, p.type AS proof_type, p.size AS proof_size, ${iso('p.uploaded_at')} AS proof_at
         FROM contributions c
         LEFT JOIN users u ON u.id = c.confirmed_by
         LEFT JOIN proofs p ON p.member_id = c.member_id AND p.month = c.month
        WHERE c.stokvel_id = $1::uuid AND ($2::boolean OR c.member_id = $3::uuid)`, [sid, full, a.my_member_id]),
    q(`SELECT month, sum(amount)::int AS collected, (count(*) FILTER (WHERE status <> 'part'))::int AS paid
         FROM contributions WHERE stokvel_id = $1::uuid GROUP BY month`, [sid]),
    q(`SELECT month, held_on, attendance FROM meetings WHERE stokvel_id = $1::uuid ORDER BY month`, [sid]),
    q(`SELECT p.month, ${iso('p.paid_at')} AS at, u.name AS by_name
         FROM payouts p LEFT JOIN users u ON u.id = p.paid_by WHERE p.stokvel_id = $1::uuid`, [sid]),
    a.canManage
      ? q(`SELECT a.action, a.detail, ${iso('a.at')} AS at, u.name AS by_name
             FROM activity a LEFT JOIN users u ON u.id = a.user_id
            WHERE a.stokvel_id = $1::uuid ORDER BY a.at DESC LIMIT 40`, [sid])
      : Promise.resolve([]),
  ]);
  const me = members.find(m => m.id === a.my_member_id);
  const t = members.find(m => m.id === st.treasurer_id);
  return {
    role: a.isTreasurer ? 'treasurer' : 'member',
    canManage: a.canManage,
    canConfirm: a.canConfirm,
    stokvel: {
      id: st.id, name: st.name, kind: st.kind, amount: st.amount, payDay: st.pay_day, startMonth: st.start_month,
      months: st.months, lateFine: st.late_fine, meetings: st.meetings, meetFine: st.meet_fine,
      order: Array.isArray(st.payout_order) ? st.payout_order : [], treasurerId: st.treasurer_id,
    },
    me: me ? { memberId: me.id, name: me.name } : null,
    treasurer: t ? { memberId: t.id, name: t.name, joined: !!a.treasurer_user_id } : null,
    members: members.map(m => ({
      id: m.id, name: m.name, title: m.title, joined: m.joined_month, left: m.left_month, sort: m.sort,
      linked: m.linked, accountName: m.account_name, inviteExpires: m.invite_expires,
    })),
    contributions: contributions.map(c => ({
      memberId: c.member_id, month: c.month, status: c.status, amount: c.amount, paidOn: c.paid_on || '',
      at: c.at, byName: c.by_name, proof: proofMeta(c),
    })),
    totals: Object.fromEntries(totals.map(r => [r.month, { collected: r.collected, paid: r.paid }])),
    meetings: st.meetings ? meetings.map(m => ({ month: m.month, heldOn: m.held_on, attendance: m.attendance || {} })) : [],
    payouts: payouts.map(p => ({ month: p.month, at: p.at, byName: p.by_name })),
    activity: activity.map(x => ({ action: x.action, detail: x.detail || {}, at: x.at, byName: x.by_name })),
  };
}

async function patchStokvel({ params, user, body }) {
  const a = await access(params[0], user);
  needManage(a);
  const s = readSettings(body, false);
  let treasurerId = null, treasurerName = '';
  if (body.treasurerId !== undefined) {
    const m = await memberOf(a.id, uuidOf(body.treasurerId));
    if (hasLeft(m, saMonth())) fail(400, `${m.name} has left the stokvel.`);
    treasurerId = m.id;
    treasurerName = m.name;
  }
  await q(
    `UPDATE stokvels SET
       name = coalesce($2, name), kind = coalesce($3, kind), amount = coalesce($4::int, amount),
       pay_day = coalesce($5::int, pay_day), start_month = coalesce($6, start_month), months = coalesce($7::int, months),
       late_fine = coalesce($8::int, late_fine), meetings = coalesce($9::boolean, meetings), meet_fine = coalesce($10::int, meet_fine),
       treasurer_id = coalesce($11::uuid, treasurer_id), updated_at = now()
     WHERE id = $1::uuid`,
    [a.id, s.name ?? null, s.kind ?? null, s.amount ?? null, s.payDay ?? null, s.startMonth ?? null, s.months ?? null,
      s.lateFine ?? null, s.meetings ?? null, s.meetFine ?? null, treasurerId]);
  if (treasurerId && treasurerId !== a.treasurer_id) await log(a.id, user.id, 'treasurer', { member: treasurerName });
  if (Object.keys(s).length) await log(a.id, user.id, 'settings', { fields: Object.keys(s) });
  return { ok: true };
}

async function deleteStokvel({ params, user, body }) {
  const a = await access(params[0], user);
  needManage(a);
  if (String(body.confirm || '').trim().toLowerCase() !== a.name.trim().toLowerCase()) fail(400, `Type ${a.name} to confirm.`);
  await q(`DELETE FROM stokvels WHERE id = $1::uuid`, [a.id]);
  return { ok: true };
}

async function addMember({ params, user, body }) {
  const a = await access(params[0], user);
  needManage(a);
  const name = text(body.name, 'the new member’s name');
  const now = saMonth();
  const clash = await one(
    `SELECT 1 AS x FROM members WHERE stokvel_id = $1::uuid AND lower(name) = lower($2) AND (left_month = '' OR left_month > $3)`,
    [a.id, name, now]);
  if (clash) fail(409, `There’s already a member called ${stop(name)}`);
  const count = await one(`SELECT count(*)::int AS n FROM members WHERE stokvel_id = $1::uuid AND (left_month = '' OR left_month > $2)`, [a.id, now]);
  if (count.n >= 60) fail(400, 'A stokvel can have up to 60 members.');
  const joined = monthDiff(a.start_month, now) > 0 ? now : '';
  const row = await one(
    `INSERT INTO members (id, stokvel_id, name, joined_month, sort)
     SELECT $1::uuid, $2::uuid, $3, $4, coalesce(max(sort), -1) + 1 FROM members WHERE stokvel_id = $2::uuid
     RETURNING id::text AS id`, [crypto.randomUUID(), a.id, name, joined]);
  await log(a.id, user.id, 'member_added', { member: name });
  return { id: row.id };
}

async function patchMember({ params, user, body }) {
  const a = await access(params[0], user);
  needManage(a);
  const m = await memberOf(a.id, params[1]);
  const now = saMonth();
  const clashes = name => one(
    `SELECT 1 AS x FROM members WHERE stokvel_id = $1::uuid AND id <> $2::uuid AND lower(name) = lower($3) AND (left_month = '' OR left_month > $4)`,
    [a.id, m.id, name, now]);
  if (body.name !== undefined) {
    const name = text(body.name, 'a name');
    if (await clashes(name)) fail(409, `There’s already a member called ${stop(name)}`);
    await q(`UPDATE members SET name = $2 WHERE id = $1::uuid`, [m.id, name]);
  }
  if (body.title !== undefined) {
    if (body.title !== '' && !TITLES.includes(body.title)) fail(400, 'Pick Chair, Secretary or Member.');
    await q(`UPDATE members SET title = $2 WHERE id = $1::uuid`, [m.id, body.title]);
  }
  if (body.restore === true && m.left_month) {
    if (await clashes(m.name)) fail(409, `There’s already a member called ${stop(m.name)} Rename one of them first.`);
    await q(`UPDATE members SET left_month = '' WHERE id = $1::uuid`, [m.id]);
    await log(a.id, user.id, 'member_restored', { member: m.name });
  }
  return { ok: true };
}

async function removeMember({ params, user }) {
  const a = await access(params[0], user);
  needManage(a);
  const m = await memberOf(a.id, params[1]);
  if (m.id === a.treasurer_id) fail(409, `${m.name} is the treasurer. Make someone else treasurer first.`);
  // Removing yourself would take the stokvel off your own list, with nobody left to run it.
  if (m.user_id && m.user_id === user.id) fail(409, 'You can’t remove yourself from the stokvel.', 'self');
  if (m.left_month) return { ok: true };
  const now = saMonth();
  const h = await one(
    `SELECT EXISTS (SELECT 1 FROM contributions WHERE member_id = $1::uuid) AS paid_ever,
            EXISTS (SELECT 1 FROM contributions WHERE member_id = $1::uuid AND month = $3) AS paid_now,
            EXISTS (SELECT 1 FROM meetings WHERE stokvel_id = $2::uuid AND attendance ? $4) AS met_ever,
            EXISTS (SELECT 1 FROM meetings WHERE stokvel_id = $2::uuid AND month = $3 AND attendance ? $4) AS met_now`,
    [m.id, a.id, now, m.id]);
  const ci = monthDiff(a.start_month, now);
  let order = null, turn = -1;
  if (a.kind === 'rotating') {
    const all = await q(`SELECT id::text AS id, name, joined_month, left_month, sort FROM members WHERE stokvel_id = $1::uuid`, [a.id]);
    const ids = rotation(
      { kind: 'rotating', startMonth: a.start_month, order: Array.isArray(a.payout_order) ? a.payout_order : [] },
      all.map(x => ({ id: x.id, name: x.name, joined: x.joined_month, left: x.left_month, sort: x.sort }))).map(x => x.id);
    turn = ids.indexOf(m.id);
    order = ids;
  }
  const hadTurn = turn >= 0 && turn <= ci;
  // Save the rotation explicitly, so a turn already taken stays put and a turn still to come is dropped.
  const saveOrder = async keep => {
    if (order) await q(`UPDATE stokvels SET payout_order = $2::jsonb WHERE id = $1::uuid`, [a.id, JSON.stringify(keep ? order : order.filter(x => x !== m.id))]);
  };
  if (!h.paid_ever && !h.met_ever && !hadTurn) {
    await q(`DELETE FROM members WHERE id = $1::uuid`, [m.id]);
    await saveOrder(false);
    await log(a.id, user.id, 'member_removed', { member: m.name });
    return { ok: true, removed: 'deleted' };
  }
  const busyNow = h.paid_now || h.met_now || (hadTurn && turn === ci);
  let left = busyNow ? addMonths(now, 1) : now;
  if (monthDiff(left, a.start_month) > 0) left = a.start_month;
  await q(`UPDATE members SET left_month = $2 WHERE id = $1::uuid`, [m.id, left]);
  await q(`DELETE FROM invites WHERE member_id = $1::uuid AND used_at IS NULL`, [m.id]);
  await saveOrder(hadTurn);
  await log(a.id, user.id, 'member_removed', { member: m.name, left });
  return { ok: true, removed: 'left', left };
}

async function inviteMember({ req, params, user }) {
  const a = await access(params[0], user);
  needManage(a);
  const m = await memberOf(a.id, params[1]);
  if (m.user_id) fail(409, `${m.name} has already joined.`);
  if (hasLeft(m, saMonth())) fail(409, `${m.name} has left the stokvel.`);
  const inv = await makeInvite(req, a.id, m.id, user.id);
  await log(a.id, user.id, 'invite', { member: m.name });
  return { ...inv, memberName: m.name, stokvelName: a.name, isTreasurer: m.id === a.treasurer_id };
}

async function unlinkMember({ params, user }) {
  const a = await access(params[0], user);
  needManage(a);
  const m = await memberOf(a.id, params[1]);
  if (m.user_id === user.id) fail(409, 'You can’t unlink yourself.');
  await q(`UPDATE members SET user_id = NULL WHERE id = $1::uuid`, [m.id]);
  await log(a.id, user.id, 'unlinked', { member: m.name });
  return { ok: true };
}

async function putContribution({ params, user, body }) {
  const a = await access(params[0], user);
  needConfirm(a);
  const m = await memberOf(a.id, uuidOf(body.memberId));
  const month = monthOf(body.month, a);
  if (!isActive({ joined: m.joined_month, left: m.left_month }, month)) fail(400, `${m.name} wasn’t a member in that month.`);
  if (body.status === null || body.status === undefined || body.status === '') {
    await q(
      `WITH c AS (DELETE FROM contributions WHERE member_id = $1::uuid AND month = $2 RETURNING 1)
       DELETE FROM proofs WHERE member_id = $1::uuid AND month = $2`, [m.id, month]);
    await log(a.id, user.id, 'cleared', { member: m.name, month });
    return { contribution: null };
  }
  if (!STATUSES.includes(body.status)) fail(400, 'Choose paid, paid late or part payment.');
  let status = body.status, amount = a.amount;
  if (status === 'part') {
    amount = whole(body.amount, 'The part payment', 1, 10000000);
    if (amount >= a.amount) { status = 'paid'; amount = a.amount; }
  }
  const paidOn = paidOnOf(body.paidOn);
  const proof = readProof(body.proof);
  // The payment and its proof are saved together, in one statement.
  const values = [m.id, a.id, month, status, amount, paidOn, user.id];
  let proofStep = '';
  if (proof) {
    values.push(proof.name, proof.type, proof.buf.length, proof.buf.toString('base64'));
    proofStep = `, pr AS (
      INSERT INTO proofs (member_id, stokvel_id, month, name, type, size, data, uploaded_by)
      VALUES ($1::uuid, $2::uuid, $3, $8, $9, $10::int, decode($11, 'base64'), $7::uuid)
      ON CONFLICT (member_id, month) DO UPDATE SET name = EXCLUDED.name, type = EXCLUDED.type, size = EXCLUDED.size,
        data = EXCLUDED.data, uploaded_by = EXCLUDED.uploaded_by, uploaded_at = now()
      RETURNING 1)`;
  } else if (proof === null) {
    proofStep = `, pr AS (DELETE FROM proofs WHERE member_id = $1::uuid AND month = $3 RETURNING 1)`;
  }
  const row = await one(
    `WITH c AS (
       INSERT INTO contributions (member_id, stokvel_id, month, status, amount, paid_on, confirmed_by)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5::int, $6, $7::uuid)
       ON CONFLICT (member_id, month) DO UPDATE SET
         status = EXCLUDED.status, amount = EXCLUDED.amount, paid_on = EXCLUDED.paid_on,
         confirmed_by = EXCLUDED.confirmed_by, confirmed_at = now()
       RETURNING member_id::text AS member_id, month, status, amount, paid_on, ${iso('confirmed_at')} AS at
     )${proofStep}
     SELECT c.*, p.name AS proof_name, p.type AS proof_type, p.size AS proof_size, ${iso('p.uploaded_at')} AS proof_at
       FROM c LEFT JOIN proofs p ON p.member_id = $1::uuid AND p.month = $3`, values);
  // The SELECT sees the proof as it was before this statement, so describe a new or removed one directly.
  const saved = proof ? { name: proof.name, type: proof.type, size: proof.buf.length, at: row.at } : proof === null ? null : proofMeta(row);
  await log(a.id, user.id, 'confirmed', {
    member: m.name, month, status, amount, paidOn, ...(proof ? { proof: 'added' } : proof === null && row.proof_type ? { proof: 'removed' } : {}),
  });
  return {
    contribution: {
      memberId: row.member_id, month: row.month, status: row.status, amount: row.amount, paidOn: row.paid_on,
      at: row.at, byName: user.name, proof: saved,
    },
  };
}

// A proof of payment, for the treasurer or the member it belongs to.
async function getProof({ res, params, user }) {
  const a = await access(params[0], user);
  const memberId = params[1], month = params[2];
  if (!(a.isTreasurer || memberId === a.my_member_id)) fail(404, 'We couldn’t find that proof of payment.', 'not_found');
  const p = await one(
    `SELECT name, type, encode(data, 'base64') AS b64 FROM proofs
      WHERE stokvel_id = $1::uuid AND member_id = $2::uuid AND month = $3`, [a.id, memberId, month]);
  if (!p || !PROOF_TYPES[p.type]) fail(404, 'We couldn’t find that proof of payment.', 'not_found');
  const buf = Buffer.from(p.b64, 'base64');
  res.statusCode = 200;
  res.setHeader('Content-Type', p.type);
  res.setHeader('Content-Length', buf.length);
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(p.name || 'proof-of-payment' + PROOF_TYPES[p.type])}`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.end(buf);
  return SENT;
}

async function putMeeting({ params, user, body }) {
  const a = await access(params[0], user);
  needConfirm(a);
  if (!a.meetings) fail(400, 'Meetings are switched off for this stokvel.');
  const month = monthOf(params[1], a);
  const heldOn = String(body.heldOn || '');
  if (!DATE_RE.test(heldOn)) fail(400, 'Pick the date of the meeting.');
  const ids = new Set((await q(`SELECT id::text AS id FROM members WHERE stokvel_id = $1::uuid`, [a.id])).map(r => r.id));
  const clean = {};
  for (const [k, v] of Object.entries(body.attendance && typeof body.attendance === 'object' ? body.attendance : {})) {
    if (!ids.has(k)) continue;
    if (v !== null && !ATTENDANCE.includes(v)) fail(400, 'Mark each member present, apology or absent.');
    clean[k] = v;
  }
  const merge = body.merge === true;
  const row = await one(
    `INSERT INTO meetings (stokvel_id, month, held_on, attendance, updated_by)
     VALUES ($1::uuid, $2, $3, jsonb_strip_nulls($4::jsonb), $5::uuid)
     ON CONFLICT (stokvel_id, month) DO UPDATE SET
       held_on = EXCLUDED.held_on,
       attendance = CASE WHEN $6::boolean THEN jsonb_strip_nulls(meetings.attendance || $4::jsonb) ELSE jsonb_strip_nulls($4::jsonb) END,
       updated_by = EXCLUDED.updated_by, updated_at = now()
     RETURNING month, held_on, attendance`,
    [a.id, month, heldOn, JSON.stringify(clean), user.id, merge]);
  if (!merge) await log(a.id, user.id, 'register', { month });
  return { meeting: { month: row.month, heldOn: row.held_on, attendance: row.attendance || {} } };
}

async function putPayout({ params, user, body }) {
  const a = await access(params[0], user);
  needConfirm(a);
  const month = monthOf(params[1], a);
  if (body.paid === true) {
    const row = await one(
      `INSERT INTO payouts (stokvel_id, month, paid_by) VALUES ($1::uuid, $2, $3::uuid)
       ON CONFLICT (stokvel_id, month) DO UPDATE SET paid_by = EXCLUDED.paid_by, paid_at = now()
       RETURNING ${iso('paid_at')} AS at`, [a.id, month, user.id]);
    await log(a.id, user.id, 'payout', { month });
    return { payout: { month, at: row.at, byName: user.name } };
  }
  await q(`DELETE FROM payouts WHERE stokvel_id = $1::uuid AND month = $2`, [a.id, month]);
  await log(a.id, user.id, 'payout_cleared', { month });
  return { payout: null };
}

async function putOrder({ params, user, body }) {
  const a = await access(params[0], user);
  needManage(a);
  const ids = new Set((await q(`SELECT id::text AS id FROM members WHERE stokvel_id = $1::uuid`, [a.id])).map(r => r.id));
  const order = [];
  for (const id of Array.isArray(body.order) ? body.order : []) if (ids.has(id) && !order.includes(id)) order.push(id);
  await q(`UPDATE stokvels SET payout_order = $2::jsonb, updated_at = now() WHERE id = $1::uuid`, [a.id, JSON.stringify(order)]);
  await log(a.id, user.id, 'order', {});
  return { ok: true };
}
