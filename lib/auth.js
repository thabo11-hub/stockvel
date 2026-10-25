// Accounts: phone numbers, password hashing, session tokens and cookies.
import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);

export const COOKIE = 'stokvel_session';
export const SESSION_DAYS = 60;

// Accepts 082 123 4567, 0821234567, +27 82 123 4567 or 27821234567 and returns 27821234567.
export function normalizePhone(input) {
  const raw = String(input || '').trim();
  const plus = raw.startsWith('+');
  let d = raw.replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  else if (!plus && d.length === 10 && d.startsWith('0')) d = '27' + d.slice(1);
  else if (!plus && d.length === 9 && !d.startsWith('0')) d = '27' + d;
  if (d.length < 9 || d.length > 15 || d.startsWith('0')) return null;
  return d;
}

export function formatPhone(d) {
  const s = String(d || '');
  if (s.length === 11 && s.startsWith('27')) return '+27 ' + s.slice(2, 4) + ' ' + s.slice(4, 7) + ' ' + s.slice(7);
  return '+' + s;
}

const N = 16384, R = 8, P = 1, KEYLEN = 32;

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(String(password), salt, KEYLEN, { N, r: R, p: P });
  return ['s1', N, R, P, salt.toString('base64'), Buffer.from(key).toString('base64')].join('$');
}

export async function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 's1') {
    await scrypt('x', 'decoy-salt-value', KEYLEN, { N, r: R, p: P });
    return false;
  }
  const [, n, r, p, salt, hash] = parts;
  const expected = Buffer.from(hash, 'base64');
  const actual = Buffer.from(await scrypt(String(password), Buffer.from(salt, 'base64'), expected.length, { N: +n, r: +r, p: +p }));
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
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
