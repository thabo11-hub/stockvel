// Accounts: phone numbers, password hashing, session tokens and cookies.
import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);

export const COOKIE = 'stokvel_session';
export const SESSION_DAYS = 60;

// Accepts 082 123 4567, 0821234567, +27 82 123 4567, +27 082 123 4567 or 27821234567
// and returns 27821234567.
export function normalizePhone(input) {
  const raw = String(input || '').trim();
  const plus = raw.startsWith('+');
  let d = raw.replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  else if (!plus && d.length === 10 && d.startsWith('0')) d = '27' + d.slice(1);
  else if (!plus && d.length === 9 && !d.startsWith('0')) d = '27' + d;
  // "+27 082 …": the 0 that starts a South African number, typed after the country code.
  if (d.length === 12 && d.startsWith('270')) d = '27' + d.slice(3);
  if (d.length < 9 || d.length > 15 || d.startsWith('0')) return null;
  return d;
}

// Before "+27 0…" was understood, such numbers were stored as 270…. Logging in also
// tries that form, so accounts made back then keep working.
export const oldPhoneForm = d => /^27\d{9}$/.test(d) ? '270' + d.slice(2) : d;

export function formatPhone(d) {
  const s = String(d || '');
  if (s.length === 11 && s.startsWith('27')) return '+27 ' + s.slice(2, 4) + ' ' + s.slice(4, 7) + ' ' + s.slice(7);
  return '+' + s;
}

// scrypt cost. Hashes record their own cost, so older (cheaper) ones keep working and are
// upgraded the next time that person logs in (see needsRehash).
const N = 32768, R = 8, P = 1, KEYLEN = 32, MAXMEM = 64 * 1024 * 1024;

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(String(password), salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return ['s1', N, R, P, salt.toString('base64'), Buffer.from(key).toString('base64')].join('$');
}

export async function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 's1') {
    await scrypt('x', 'decoy-salt-value', KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
    return false;
  }
  const [, n, r, p, salt, hash] = parts;
  const expected = Buffer.from(hash, 'base64');
  const actual = Buffer.from(await scrypt(String(password), Buffer.from(salt, 'base64'), expected.length,
    { N: +n, r: +r, p: +p, maxmem: MAXMEM }));
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

export const needsRehash = stored => {
  const [alg, n, r, p] = String(stored || '').split('$');
  return alg === 's1' && (+n < N || +r !== R || +p !== P);
};

// Short or very common passwords are the first thing attackers try.
const COMMON = new Set(['password', 'password1', 'password12', 'password123', 'passw0rd', '12345678', '123456789',
  '1234567890', '11111111', '00000000', '87654321', 'qwerty123', 'qwertyuiop', 'iloveyou', 'letmein1', 'welcome1',
  'admin123', 'abcd1234', 'abc12345', 'stokvel1', 'stokvel123', 'mzansi123', 'sunshine1', 'football1', 'mypassword']);
export function passwordProblem(password) {
  const s = typeof password === 'string' ? password : '';
  if (s.length < 8) return 'Use a password of at least 8 characters.';
  if (s.length > 200) return 'That password is too long.';
  if (COMMON.has(s.toLowerCase()) || /^(.)\1+$/.test(s)) return 'That password is too easy to guess. Pick another.';
  return null;
}

export const newToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
export const sha256 = s => crypto.createHash('sha256').update(String(s)).digest('hex');

export function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) {
      try { return decodeURIComponent(part.slice(i + 1).trim()); } catch (e) { return ''; }
    }
  }
  return '';
}

export function sessionCookie(token, secure) {
  const maxAge = token ? SESSION_DAYS * 86400 : 0;
  return `${COOKIE}=${token ? encodeURIComponent(token) : ''}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}
