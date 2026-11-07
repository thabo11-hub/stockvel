// Security tests. They start the real app (scripts/dev.mjs) on a throwaway local Postgres
// database and attack it over HTTP, the way someone on the internet would.
//
//   npm test
//
// Needs a local Postgres you can reach over its Unix socket without a password. Defaults:
// LOCAL_PG_SOCKET=/var/run/postgresql, LOCAL_PG_DB=stokvel_test (emptied on every run),
// LOCAL_PG_USER=$USER. Never point LOCAL_PG_DB at a database you care about.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { localPg } from '../scripts/pg-local.mjs';
import { saMonth } from '../public/logic.js';

const PG = {
  socketDir: process.env.LOCAL_PG_SOCKET || '/var/run/postgresql',
  database: process.env.LOCAL_PG_DB || 'stokvel_test',
  user: process.env.LOCAL_PG_USER || process.env.USER || 'postgres',
};
const PORT = 3900 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;
const SETUP_CODE = 'TEST-CODE-7731';
const db = localPg(PG);
let server;
let serverLog = '';

before(async () => {
  if (!/test/.test(PG.database)) throw new Error('LOCAL_PG_DB must contain "test": the tests empty it');
  await db('DROP SCHEMA IF EXISTS public CASCADE');
  await db('CREATE SCHEMA public');
  server = spawn(process.execPath, ['scripts/dev.mjs'], {
    env: {
      ...process.env, PORT: String(PORT), LOCAL_PG_SOCKET: PG.socketDir, LOCAL_PG_DB: PG.database,
      LOCAL_PG_USER: PG.user, SETUP_CODE, TRUST_PROXY: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stderr.on('data', d => { serverLog += d; });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not start:\n' + serverLog)), 15000);
    server.stdout.on('data', d => { serverLog += d; if (String(d).includes('running on')) { clearTimeout(timer); resolve(); } });
    server.on('exit', code => reject(new Error(`server exited (${code}):\n${serverLog}`)));
  });
});
after(async () => {
  if (server) server.kill();
  await db.close();
});

let ipCounter = 10;
// A visitor: keeps its own session cookie, and comes from its own address.
class Visitor {
  constructor() { this.cookie = ''; this.ip = `203.0.113.${ipCounter++}`; this.rawCookie = ''; }
  async call(method, path, body, { headers = {}, raw = false, appHeader = true } = {}) {
    const h = { 'content-type': 'application/json', 'x-forwarded-for': this.ip, ...headers };
    if (appHeader) h['x-stokvel'] = '1';
    if (this.cookie) h.cookie = this.cookie;
    const res = await fetch(`${BASE}/api/${path}`, {
      method, headers: h, redirect: 'manual',
      body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) {
      this.rawCookie = set;
      const m = set.match(/stokvel_session=([^;]*)/);
      if (m) this.cookie = m[1] ? `stokvel_session=${m[1]}` : '';
    }
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (e) { /* not JSON */ }
    return { status: res.status, headers: res.headers, json, text };
  }
}

const PASS = 'Correct-Horse-Battery-9';
const month = saMonth();
let admin, stokvelId, members;

async function newMember(name, phone) {
  // The treasurer invites `name`, who joins with a new account.
  const m = members.find(x => x.name === name);
  const inv = await admin.call('POST', `stokvels/${stokvelId}/members/${m.id}/invite`, {});
  assert.equal(inv.status, 200, inv.text);
  const token = inv.json.url.split('/join/')[1];
  const v = new Visitor();
  const r = await v.call('POST', `invites/${token}/accept`, { name, phone, password: PASS });
  assert.equal(r.status, 200, r.text);
  return v;
}

test('security headers are sent on pages and on API responses', async () => {
  const page = await fetch(BASE + '/');
  for (const [k, v] of [
    ['content-security-policy', "script-src 'self'"], ['x-frame-options', 'DENY'], ['x-content-type-options', 'nosniff'],
    ['referrer-policy', 'same-origin'], ['strict-transport-security', 'max-age='], ['cross-origin-opener-policy', 'same-origin'],
  ]) assert.ok((page.headers.get(k) || '').includes(v), `page ${k}: ${page.headers.get(k)}`);
  const api = await new Visitor().call('GET', 'session');
  assert.match(api.headers.get('content-security-policy') || '', /default-src 'none'/);
  assert.equal(api.headers.get('cache-control'), 'no-store');
  assert.equal(api.headers.get('access-control-allow-origin'), null, 'no CORS: other sites cannot read the API');
});

test('first-account setup needs the setup code, rejects weak passwords, and only works once', async () => {
  const v = new Visitor();
  assert.equal((await v.call('POST', 'setup', { code: 'GUESS', name: 'Eve', phone: '0820000001', password: PASS })).status, 403);
  for (const weak of ['abc123', 'short7!', 'password123', '12345678']) {
    const r = await v.call('POST', 'setup', { code: SETUP_CODE, name: 'Thabo', phone: '0821110000', password: weak });
    assert.equal(r.status, 400, `"${weak}" should be refused: ${r.text}`);
  }
  admin = new Visitor();
  const ok = await admin.call('POST', 'setup', { code: SETUP_CODE, name: 'Thabo', phone: '0821110000', password: PASS });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.json.user.isAdmin, true);
  const again = await new Visitor().call('POST', 'setup', { code: SETUP_CODE, name: 'Eve', phone: '0820000002', password: PASS });
  assert.equal(again.status, 409);
});

test('passwords are stored as salted scrypt hashes, never as text', async () => {
  const [row] = await db(`SELECT pass_hash FROM users WHERE phone = '27821110000'`);
  assert.match(row.pass_hash, /^s1\$32768\$8\$1\$/);
  assert.ok(!row.pass_hash.includes(PASS));
});

test('the session cookie is HttpOnly and SameSite, and logging out ends it on the server', async () => {
  assert.match(admin.rawCookie, /HttpOnly/);
  assert.match(admin.rawCookie, /SameSite=Lax/);
  const v = new Visitor();
  assert.equal((await v.call('POST', 'login', { phone: '082 111 0000', password: PASS })).status, 200);
  const stolen = v.cookie;
  assert.equal((await v.call('POST', 'logout', {})).status, 200);
  const replay = new Visitor();
  replay.cookie = stolen;
  assert.equal((await replay.call('GET', 'stokvels')).status, 401, 'a logged-out session must not work again');
});

test('changing data needs the app header and a same-origin Origin (CSRF)', async () => {
  const noHeader = await admin.call('POST', 'stokvels', { name: 'X' }, { appHeader: false });
  assert.equal(noHeader.status, 403);
  const foreign = await admin.call('POST', 'stokvels', { name: 'X' }, { headers: { origin: 'https://evil.example' } });
  assert.equal(foreign.status, 403);
  assert.equal((await new Visitor().call('GET', 'stokvels')).status, 401, 'reading needs a login');
});

test('SQL injection in names is stored as text and never runs', async () => {
  const evil = "Robert'); DROP TABLE users;--";
  const r = await admin.call('POST', 'stokvels', {
    name: 'Sodi Stokvel', kind: 'fund', amount: 1100, payDay: 25, startMonth: month, months: 12,
    lateFine: 0, meetings: true, meetFine: 0, myName: 'Thabo', members: ['Lerato', 'Sipho', evil],
  });
  assert.equal(r.status, 200, r.text);
  stokvelId = r.json.id;
  const s = await admin.call('GET', `stokvels/${stokvelId}`);
  members = s.json.members;
  assert.ok(members.some(m => m.name === evil));
  const [{ n }] = await db('SELECT count(*)::int AS n FROM users');
  assert.equal(n, 1, 'the users table is still there');
});

test("members can't see other people's money or act as treasurer (IDOR)", async () => {
  const lerato = await newMember('Lerato', '0823330000');
  const sipho = await newMember('Sipho', '0824440000');
  const lMember = members.find(m => m.name === 'Lerato');
  assert.equal((await admin.call('PUT', `stokvels/${stokvelId}/contributions`, { memberId: lMember.id, month, status: 'paid' })).status, 200);

  const asSipho = await sipho.call('GET', `stokvels/${stokvelId}`);
  assert.equal(asSipho.status, 200);
  assert.equal(asSipho.json.role, 'member');
  assert.ok(!asSipho.json.contributions.some(c => c.memberId === lMember.id), "a member sees only their own payments");
  assert.equal((await sipho.call('PUT', `stokvels/${stokvelId}/contributions`,
    { memberId: lMember.id, month, status: 'paid' })).status, 403, 'only the treasurer confirms payments');
  assert.equal((await sipho.call('DELETE', `stokvels/${stokvelId}`, { confirm: 'Sodi Stokvel' })).status, 403);

  // A stokvel Lerato is not in stays invisible, even with its id.
  const other = await admin.call('POST', 'stokvels', {
    name: 'ICP', kind: 'fund', amount: 500, payDay: 1, startMonth: month, months: 12,
    lateFine: 0, meetings: false, meetFine: 0, myName: 'Thabo', members: [],
  });
  assert.equal((await lerato.call('GET', `stokvels/${other.json.id}`)).status, 404);
  assert.equal((await lerato.call('PATCH', `stokvels/${other.json.id}`, { name: 'Mine now' })).status, 404);
});

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a5d00000000049454e44ae426082', 'hex');

test('proof uploads: only real photos and PDFs, at most 3 MB, served back safely', async () => {
  const sMember = members.find(m => m.name === 'Sipho');
  const put = proof => admin.call('PUT', `stokvels/${stokvelId}/contributions`, { memberId: sMember.id, month, status: 'paid', proof });
  const html = Buffer.from('<html><script>alert(document.cookie)</script></html>').toString('base64');
  assert.equal((await put({ name: 'proof.png', data: html })).status, 400, 'HTML named .png is refused');
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>').toString('base64');
  assert.equal((await put({ name: 'proof.svg', data: svg })).status, 400, 'SVG is refused');
  const big = Buffer.concat([PNG, Buffer.alloc(3 * 1024 * 1024)]).toString('base64');
  assert.equal((await put({ name: 'big.png', data: big })).status, 413);

  // A PNG with HTML glued on is kept as a PNG and served as one, so a browser never runs it.
  const polyglot = Buffer.concat([PNG, Buffer.from('<script>alert(1)</script>')]);
  const ok = await put({ name: '../../evil.html', data: polyglot.toString('base64') });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.json.contribution.proof.type, 'image/png');
  assert.ok(!ok.json.contribution.proof.name.includes('/'));
  const file = await fetch(`${BASE}/api/stokvels/${stokvelId}/proofs/${sMember.id}/${month}`, { headers: { cookie: admin.cookie } });
  assert.equal(file.status, 200);
  assert.equal(file.headers.get('content-type'), 'image/png');
  assert.equal(file.headers.get('x-content-type-options'), 'nosniff');
});

test('invite links are single-use and expire', async () => {
  const m = members.find(x => x.name.startsWith('Robert'));
  const inv = await admin.call('POST', `stokvels/${stokvelId}/members/${m.id}/invite`, {});
  const token = inv.json.url.split('/join/')[1];
  assert.equal((await new Visitor().call('GET', 'invites/' + 'A'.repeat(32))).status, 404, 'made-up links fail');
  await db(`UPDATE invites SET expires_at = now() - interval '1 minute' WHERE used_at IS NULL`);
  assert.equal((await new Visitor().call('GET', `invites/${token}`)).status, 410, 'expired links fail');
});

test('wrong passwords lock a phone number for 15 minutes after 8 tries', async () => {
  const v = new Visitor();
  for (let i = 0; i < 8; i++) assert.equal((await v.call('POST', 'login', { phone: '0823330000', password: 'wrong-' + i })).status, 401);
  const locked = await new Visitor().call('POST', 'login', { phone: '0823330000', password: PASS });
  assert.equal(locked.status, 429, 'even the right password waits out the lock');
});

test("one address can't spray passwords across many phone numbers", async () => {
  const v = new Visitor();
  let blocked = 0;
  for (let i = 0; i < 25; i++) {
    const r = await v.call('POST', 'login', { phone: `08250000${String(i).padStart(2, '0')}`, password: 'Summer2026!' });
    if (r.status === 429) blocked++;
  }
  assert.ok(blocked > 0, 'the address is slowed down');
  // Someone else, from another address, can still log in.
  assert.equal((await new Visitor().call('POST', 'login', { phone: '0824440000', password: PASS })).status, 200);
});

test('setup codes cannot be guessed at speed', async () => {
  const v = new Visitor();
  const statuses = [];
  for (let i = 0; i < 14; i++) statuses.push((await v.call('POST', 'setup', { code: 'GUESS' + i, name: 'Eve', phone: '0820000009', password: PASS })).status);
  assert.ok(statuses.includes(429), statuses.join(','));
});

test('suspicious activity is written to the security log', async () => {
  const rows = await db(`SELECT event, ip FROM security_log ORDER BY id`);
  const events = new Set(rows.map(r => r.event));
  for (const e of ['login_failed', 'account_locked', 'rate_limited', 'csrf_blocked', 'setup_code_wrong']) assert.ok(events.has(e), `missing ${e}`);
  assert.ok(rows.every(r => r.ip), 'every entry records the address');
  const [{ leaked }] = await db(`SELECT count(*)::int AS leaked FROM security_log WHERE detail::text LIKE '%' || $1 || '%'`, [PASS]);
  assert.equal(leaked, 0, 'passwords are never logged');
});

test('older, weaker password hashes are upgraded when the person logs in', async () => {
  const crypto = await import('node:crypto');
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync('Old-Account-Pass-1', salt, 32, { N: 16384, r: 8, p: 1 });
  const old = ['s1', 16384, 8, 1, salt.toString('base64'), key.toString('base64')].join('$');
  await db(`UPDATE users SET pass_hash = $1 WHERE phone = '27824440000'`, [old]);
  assert.equal((await new Visitor().call('POST', 'login', { phone: '0824440000', password: 'Old-Account-Pass-1' })).status, 200);
  const [row] = await db(`SELECT pass_hash FROM users WHERE phone = '27824440000'`);
  assert.match(row.pass_hash, /^s1\$32768\$/);
});

test('errors and oversized requests reveal nothing about the server', async () => {
  const bad = await admin.call('POST', 'stokvels', '{"name": ', { raw: true });
  assert.equal(bad.status, 400);
  assert.ok(!/at |Error:|node_modules|\.js:\d+/.test(bad.text), bad.text);
  const huge = await admin.call('POST', 'stokvels', JSON.stringify({ name: 'x'.repeat(300000) }), { raw: true });
  assert.equal(huge.status, 413);
});

// The browser escapes everything people type: a name that is really HTML shows up as text.
const pw = (() => { try { return createRequire(import.meta.url)('playwright'); } catch (e) { return null; } })();
test('names that contain HTML or script are shown as text, never run (XSS)', { skip: !pw && 'playwright is not installed' }, async () => {
  const xss = '<img src=x onerror="window.__pwned=1">';
  assert.equal((await admin.call('POST', `stokvels/${stokvelId}/members`, { name: xss })).status, 200);
  const browser = await pw.chromium.launch();
  try {
    const page = await (await browser.newContext()).newPage();
    let dialog = false;
    page.on('dialog', d => { dialog = true; d.dismiss(); });
    await page.goto(BASE + '/');
    await page.locator('input[type=tel]').first().fill('082 111 0000');
    await page.locator('input[type=password]').first().fill(PASS);
    await page.locator('input[type=password]').first().press('Enter');
    await page.getByText('Sodi Stokvel').first().click();
    await page.getByText(xss).first().waitFor({ timeout: 10000 });
    assert.equal(await page.evaluate(() => window.__pwned), undefined);
    assert.equal(dialog, false);
  } finally {
    await browser.close();
  }
});
