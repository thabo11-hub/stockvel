// Month and money rules shared by the browser app and the API.
// Pure functions only: no DOM, no network.

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const MON3 = MONTHS.map(m => m.slice(0, 3));
export const DAY3 = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const KEY_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
export const STATUSES = ['paid', 'late', 'part'];
export const ATTENDANCE = ['present', 'apology', 'absent'];
export const TITLES = ['Chair', 'Secretary'];

export const pad2 = n => String(n).padStart(2, '0');
export const keyOf = (y, m) => y + '-' + pad2(m + 1);
export const parseKey = k => { const p = String(k).split('-'); return { y: +p[0], m: +p[1] - 1 }; };
export const addMonths = (k, n) => { const p = parseKey(k); const t = p.y * 12 + p.m + n; return keyOf(Math.floor(t / 12), ((t % 12) + 12) % 12); };
export const monthDiff = (a, b) => { const A = parseKey(a), B = parseKey(b); return (B.y * 12 + B.m) - (A.y * 12 + A.m); };
export const monthLong = k => { const p = parseKey(k); return MONTHS[p.m] + ' ' + p.y; };
export const monthName = k => MONTHS[parseKey(k).m];
export const monthShort = k => MON3[parseKey(k).m];
export const keyFromDate = d => keyOf(d.getFullYear(), d.getMonth());
export const isoDate = d => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());

// South Africa has no daylight saving, so SAST is always UTC+2.
export function saToday() {
  const d = new Date(Date.now() + 2 * 3600e3);
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}
export const saMonth = () => keyFromDate(saToday());

// A member counts in a month when they had joined by then and had not yet left.
export const isActive = (m, k) => (!m.joined || monthDiff(m.joined, k) >= 0) && (!m.left || monthDiff(k, m.left) > 0);

const bySort = members => members.slice().sort((a, b) => ((a.sort || 0) - (b.sort || 0)) || String(a.name).localeCompare(String(b.name)));

// Payout order for a rotating stokvel: the saved order first (people who left keep
// a turn they already had), then current members who are not placed yet.
export function rotation(st, members) {
  const byId = new Map(members.map(m => [m.id, m]));
  const seen = new Set(), out = [];
  for (const id of st.order || []) {
    const m = byId.get(id);
    if (m && !seen.has(id)) { out.push(m); seen.add(id); }
  }
  for (const m of bySort(members)) if (!seen.has(m.id) && !m.left) { out.push(m); seen.add(m.id); }
  return out;
}
export function roster(st, members) {
  const r = rotation(st, members), ids = new Set(r.map(m => m.id));
  return r.concat(bySort(members).filter(m => !ids.has(m.id)));
}
export const cycleLen = (st, members) => st.kind === 'rotating'
  ? Math.max(1, rotation(st, members).length)
  : Math.min(36, Math.max(1, Number(st.months) || 12));
export const cycleKeys = (st, members) => Array.from({ length: cycleLen(st, members) }, (_, i) => addMonths(st.startMonth, i));
export const activeIn = (st, members, k) => roster(st, members).filter(m => isActive(m, k));
export function recipientOf(st, members, k) {
  if (st.kind !== 'rotating') return null;
  const i = monthDiff(st.startMonth, k), r = rotation(st, members);
  return i >= 0 && i < r.length ? r[i] : null;
}

// Money a confirmed contribution counts for. Full payments keep the amount they
// were confirmed at; a part payment never counts for more than the monthly amount.
export function paidAmount(st, c) {
  if (!c) return 0;
  const amt = Math.max(0, Number(c.amount) || 0);
  return c.status === 'part' ? Math.min(amt, st.amount) : amt;
}
export const isFull = c => !!c && c.status !== 'part';

export const dueDate = (k, day) => { const p = parseKey(k); return new Date(p.y, p.m, day); };
