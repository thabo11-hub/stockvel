// Database access.
// On Vercel this talks to Neon Postgres over HTTP with the serverless driver.
// Local tools can swap in another query function with setQuery().

let queryImpl = null;
let sqlPromise = null;
let migrated = null;

export function setQuery(fn) {
  queryImpl = fn;
  migrated = null;
}

// The Neon integration names the variable DATABASE_URL, or PREFIX_DATABASE_URL
// when a custom prefix was chosen while connecting the database.
export function connectionString() {
  const env = process.env;
  if (env.DATABASE_URL) return env.DATABASE_URL;
  if (env.POSTGRES_URL) return env.POSTGRES_URL;
  const key = Object.keys(env).find(k => /(^|_)(DATABASE_URL|POSTGRES_URL)$/.test(k) && env[k]);
  return key ? env[key] : '';
}

export const dbConfigured = () => !!(queryImpl || connectionString());

async function getSql() {
  if (!sqlPromise) {
    sqlPromise = import('@neondatabase/serverless')
      .then(({ neon }) => neon(connectionString()))
      .catch(e => { sqlPromise = null; throw e; });
  }
  return sqlPromise;
}

export async function q(text, params = []) {
  if (queryImpl) return queryImpl(text, params);
  const sql = await getSql();
  return sql.query(text, params);
}

export async function one(text, params = []) {
  const rows = await q(text, params);
  return rows[0] || null;
}

// Timestamps always leave the database as ISO text, so every driver returns the same shape.
export const ISO = `'YYYY-MM-DD"T"HH24:MI:SS"Z"'`;
export const iso = col => `to_char(${col} AT TIME ZONE 'UTC', ${ISO})`;

const SCHEMA_VERSION = '1';

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS app_meta (key text PRIMARY KEY, value text NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    phone text NOT NULL UNIQUE,
    name text NOT NULL,
    pass_hash text NOT NULL,
    is_admin boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash text PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id)`,
  `CREATE TABLE IF NOT EXISTS login_failures (
    phone text PRIMARY KEY,
    count int NOT NULL DEFAULT 0,
    last_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS stokvels (
    id uuid PRIMARY KEY,
    name text NOT NULL,
    kind text NOT NULL DEFAULT 'fund',
    amount int NOT NULL,
    pay_day int NOT NULL DEFAULT 25,
    start_month text NOT NULL,
    months int NOT NULL DEFAULT 12,
    late_fine int NOT NULL DEFAULT 0,
    meetings boolean NOT NULL DEFAULT true,
    meet_fine int NOT NULL DEFAULT 0,
    payout_order jsonb NOT NULL DEFAULT '[]'::jsonb,
    treasurer_id uuid,
    created_by uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS members (
    id uuid PRIMARY KEY,
    stokvel_id uuid NOT NULL REFERENCES stokvels(id) ON DELETE CASCADE,
    name text NOT NULL,
    title text NOT NULL DEFAULT '',
    user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    joined_month text NOT NULL DEFAULT '',
    left_month text NOT NULL DEFAULT '',
    sort int NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS members_stokvel ON members (stokvel_id)`,
  `CREATE INDEX IF NOT EXISTS members_user ON members (user_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS members_user_once ON members (stokvel_id, user_id) WHERE user_id IS NOT NULL`,
  `CREATE TABLE IF NOT EXISTS contributions (
    member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    stokvel_id uuid NOT NULL REFERENCES stokvels(id) ON DELETE CASCADE,
    month text NOT NULL,
    status text NOT NULL,
    amount int NOT NULL,
    confirmed_by uuid REFERENCES users(id) ON DELETE SET NULL,
    confirmed_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (member_id, month)
  )`,
  `CREATE INDEX IF NOT EXISTS contributions_stokvel ON contributions (stokvel_id, month)`,
  `CREATE TABLE IF NOT EXISTS meetings (
    stokvel_id uuid NOT NULL REFERENCES stokvels(id) ON DELETE CASCADE,
    month text NOT NULL,
    held_on text NOT NULL,
    attendance jsonb NOT NULL DEFAULT '{}'::jsonb,
    updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (stokvel_id, month)
  )`,
  `CREATE TABLE IF NOT EXISTS payouts (
    stokvel_id uuid NOT NULL REFERENCES stokvels(id) ON DELETE CASCADE,
    month text NOT NULL,
    paid_by uuid REFERENCES users(id) ON DELETE SET NULL,
    paid_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (stokvel_id, month)
  )`,
  `CREATE TABLE IF NOT EXISTS invites (
    token_hash text PRIMARY KEY,
    stokvel_id uuid NOT NULL REFERENCES stokvels(id) ON DELETE CASCADE,
    member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    created_by uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    used_at timestamptz,
    used_by uuid REFERENCES users(id) ON DELETE SET NULL
  )`,
  `CREATE INDEX IF NOT EXISTS invites_member ON invites (member_id)`,
  `CREATE TABLE IF NOT EXISTS activity (
    id bigserial PRIMARY KEY,
    stokvel_id uuid NOT NULL REFERENCES stokvels(id) ON DELETE CASCADE,
    user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    action text NOT NULL,
    detail jsonb NOT NULL DEFAULT '{}'::jsonb,
    at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS activity_stokvel ON activity (stokvel_id, at DESC)`,
];

async function migrate() {
  try {
    const row = await one(`SELECT value FROM app_meta WHERE key = 'schema'`);
    if (row && row.value === SCHEMA_VERSION) return;
  } catch (e) {
    // The table does not exist yet on a fresh database.
  }
  for (const stmt of SCHEMA) await q(stmt);
  await q(`INSERT INTO app_meta (key, value) VALUES ('schema', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [SCHEMA_VERSION]);
}

export function ensureSchema() {
  if (!migrated) migrated = migrate().catch(e => { migrated = null; throw e; });
  return migrated;
}
