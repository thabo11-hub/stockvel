// Request limits per address and a log of suspicious activity. Both live in Postgres, so
// every serverless instance shares them (an in-memory counter resets on each cold start).
import { one, q, dbConfigured, ensureSchema } from './db.js';

// Vercel's edge sets x-real-ip / x-forwarded-for itself, so they are trustworthy there (and
// behind another proxy that does the same, with TRUST_PROXY=1). Elsewhere they could be forged.
const trustProxy = () => process.env.VERCEL === '1' || process.env.TRUST_PROXY === '1';

export function ipOf(req) {
  if (trustProxy()) {
    const real = String(req.headers['x-real-ip'] || '').trim();
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (real || forwarded) return (real || forwarded).slice(0, 64);
  }
  return String((req.socket && req.socket.remoteAddress) || 'unknown').slice(0, 64);
}

const keyOf = (req, name) => `${name}:${ipOf(req)}`;

// Has this address used up `max` tries of `name` in the current window? (Doesn't count a try.)
export async function overLimit(req, name, max) {
  const row = await one(`SELECT hits FROM rate_limits WHERE key = $1 AND reset_at > now()`, [keyOf(req, name)]);
  return !!row && row.hits >= max;
}

// Counts one try of `name` from this address; returns the tries so far in this window.
export async function countTry(req, name, windowSec) {
  const row = await one(
    `INSERT INTO rate_limits (key, hits, reset_at) VALUES ($1, 1, now() + make_interval(secs => $2::int))
     ON CONFLICT (key) DO UPDATE SET
       hits = CASE WHEN rate_limits.reset_at <= now() THEN 1 ELSE rate_limits.hits + 1 END,
       reset_at = CASE WHEN rate_limits.reset_at <= now() THEN EXCLUDED.reset_at ELSE rate_limits.reset_at END
     RETURNING hits`, [keyOf(req, name), windowSec]);
  return row.hits;
}

// 27821234567 -> 27*******567: enough to spot a targeted account without storing whole numbers.
export const maskPhone = p => {
  const s = String(p || '');
  return s.length > 5 ? s.slice(0, 2) + '*'.repeat(s.length - 5) + s.slice(-3) : '***';
};

const ALERT_AT = 15; // suspicious events from one address within 10 minutes

/**
 * Records a security event: a JSON line in the server log (Vercel Logs) and a row in
 * security_log. Never pass passwords, tokens or codes in `detail`. When one address
 * reaches ALERT_AT suspicious events in 10 minutes, an alert goes to ALERT_WEBHOOK_URL.
 */
export async function security(req, event, detail = {}, { userId = null, level = 'warn' } = {}) {
  const ip = ipOf(req);
  console.warn(JSON.stringify({ type: 'security', at: new Date().toISOString(), level, event, ip, ...detail }));
  if (!dbConfigured()) return;
  try {
    await ensureSchema();
    const row = await one(
      `WITH ins AS (
         INSERT INTO security_log (event, level, ip, user_id, detail) VALUES ($1, $2, $3, $4::uuid, $5::jsonb) RETURNING 1
       )
       SELECT count(*)::int AS n FROM security_log WHERE ip = $3 AND level <> 'info' AND at > now() - interval '10 minutes'`,
      [event, level, ip, userId, JSON.stringify(detail)]);
    // The count runs in the same statement, so it doesn't include the row just added.
    if (level !== 'info' && row && row.n + 1 === ALERT_AT) {
      await alert(`${ALERT_AT} suspicious requests from ${ip} in 10 minutes (latest: ${event})`);
    }
  } catch (e) {
    console.error('[stokvel] security log', e);
  }
}

async function alert(message) {
  console.error(JSON.stringify({ type: 'security', level: 'alert', message }));
  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) return;
  try {
    // Slack, Discord and Teams incoming webhooks all accept this.
    await fetch(url, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: `[Stokvel security] ${message}`, content: `[Stokvel security] ${message}` }),
      signal: AbortSignal.timeout(3000),
    });
  } catch (e) {
    console.error('[stokvel] alert could not be sent');
  }
}

// Old limits and log entries are cleared out now and then.
export async function tidy() {
  await q(`DELETE FROM rate_limits WHERE reset_at < now()`);
  await q(`DELETE FROM security_log WHERE at < now() - interval '180 days'`);
}
