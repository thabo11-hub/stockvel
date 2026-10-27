import {
  MON3, DAY3, DATE_RE, ATTENDANCE, TITLES,
  addMonths, monthDiff, monthLong, monthName, monthShort, keyFromDate, isoDate,
  isActive, rotation, roster, cycleKeys, activeIn, recipientOf, paidAmount, isFull, dueDate,
} from '/logic.js';

/* ---------- helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const ATT_LABEL = { present: 'Present', apology: 'Apology', absent: 'Absent' };
const CELL = {
  paid: 'Paid', late: 'Paid late', part: 'Part paid', missed: 'Owing', open: 'Not due yet', future: 'Still to come',
  present: 'Present', apology: 'Apology', absent: 'Absent', nomeet: 'No register', na: 'Not a member then',
};
const TONES = [{ id: 'warm', label: 'Warm' }, { id: 'firm', label: 'Firm' }, { id: 'playful', label: 'Playful' }];
const todayKey = () => keyFromDate(new Date());
const startOfToday = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); };
const daysUntil = date => Math.round((date - startOfToday()) / 864e5);
const fmtDate = d => d.getDate() + ' ' + MON3[d.getMonth()];
const fmtTs = ts => { const d = new Date(ts); return isNaN(d.getTime()) ? '' : fmtDate(d); };
const fmtDay = s => { if (!DATE_RE.test(s || '')) return ''; const [y, m, d] = s.split('-').map(Number); return DAY3[new Date(y, m - 1, d).getDay()] + ' ' + d + ' ' + MON3[m - 1]; };
// Rand with a non-breaking space between thousands (R1 100), so an amount never splits over two lines.
// "24 Oct" from an ISO date such as 2026-10-24.
const fmtISO = s => { if (!DATE_RE.test(s || '')) return ''; const [, m, d] = s.split('-').map(Number); return d + ' ' + MON3[m - 1]; };
const validDate = s => { if (!DATE_RE.test(s || '')) return false; const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d).getDate() === d; };
const fmtSize = n => n < 1048576 ? Math.max(1, Math.round(n / 1024)) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
const fmtR = n => 'R' + String(Math.max(0, Math.round(Number(n) || 0))).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0');
// Reads whole rand from what someone typed: "1 100", "R1,100", "550.00" or "1.100,50".
// Cents are dropped, so a typed decimal point can never turn R550.00 into R55 000.
const toInt = v => {
  const s = String(v == null ? '' : v).replace(/^\s*r/i, '').replace(/\s+/g, '');
  const m = s.match(/^(\d{1,3}(?:[,.]\d{3})+|\d+)(?:[.,]\d{1,2})?$/);
  return m ? parseInt(m[1].replace(/[,.]/g, ''), 10) : NaN;
};
const firstName = s => String(s).trim().split(/\s+/)[0] || String(s);
const listJoin = a => a.length < 2 ? (a[0] || '') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
const hash = s => { let h = 7; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) | 0; return Math.abs(h); };
const relDays = d => d > 1 ? 'in ' + d + ' days' : d === 1 ? 'tomorrow' : d === 0 ? 'today' : d === -1 ? 'yesterday' : (-d) + ' days ago';
const waLink = text => 'https://wa.me/?text=' + encodeURIComponent(text);
// Ends a sentence that finishes on a name, without doubling the full stop of names like "Tshepo M."
const stop = s => /[.!?]$/.test(String(s)) ? String(s) : String(s) + '.';

const svg = p => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const ICON = {
  month: svg('<path d="M3 5.5h6a3 3 0 0 1 3 3V20a2 2 0 0 0-2-2H3z"/><path d="M21 5.5h-6a3 3 0 0 0-3 3V20a2 2 0 0 1 2-2h7z"/>'),
  turns: svg('<path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4.5V9h-4.5"/>'),
  fund: svg('<ellipse cx="12" cy="6.5" rx="7" ry="3"/><path d="M5 6.5v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5"/><path d="M5 11.5v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5"/>'),
  record: svg('<rect x="3.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.6"/>'),
  share: svg('<path d="M20.5 3.5 10 14"/><path d="M20.5 3.5 14 20.5l-4-6.5-6.5-4z"/>'),
  sliders: svg('<path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="17" r="2"/>'),
  people: svg('<circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19.5a5.5 5.5 0 0 1 11 0"/><circle cx="17" cy="9.5" r="2.6"/><path d="M15.8 14.6a4.6 4.6 0 0 1 5.2 4.9"/>'),
  user: svg('<circle cx="12" cy="8.5" r="3.6"/><path d="M5 20a7 7 0 0 1 14 0"/>'),
  register: svg('<rect x="5" y="4.5" width="14" height="16.5" rx="2"/><path d="M9 4.5V3.6a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v.9M8.8 11.5l2 2 4.2-4.2M9 17.2h6"/>'),
  trash: svg('<path d="M4.5 7h15M10 11v6M14 11v6M6.5 7l1 12.4a1.6 1.6 0 0 0 1.6 1.5h5.8a1.6 1.6 0 0 0 1.6-1.5l1-12.4M9.5 7V4.8a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V7"/>'),
  link: svg('<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.1 1.1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.1-1.1"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  left: svg('<path d="m14.5 6-6 6 6 6"/>'),
  right: svg('<path d="m9.5 6 6 6-6 6"/>'),
  up: svg('<path d="M12 18.5v-13M6.5 11 12 5.5l5.5 5.5"/>'),
  down: svg('<path d="M12 5.5v13M6.5 13l5.5 5.5 5.5-5.5"/>'),
  close: svg('<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>'),
  copy: svg('<rect x="8.5" y="8.5" width="12" height="12" rx="2.2"/><path d="M15.5 8.5V5.7a2.2 2.2 0 0 0-2.2-2.2H5.7a2.2 2.2 0 0 0-2.2 2.2v7.6a2.2 2.2 0 0 0 2.2 2.2h2.8"/>'),
  chat: svg('<path d="M4.5 19.5 6 15.6A7.9 7.9 0 1 1 9 18.4z"/>'),
  shuffle: svg('<path d="M16 3.5h4.5V8M3.5 20.5l17-17M20.5 16v4.5H16M14.5 14.5l6 6M3.5 3.5l5 5"/>'),
  clip: svg('<path d="M20.5 11.5 12 20a5.3 5.3 0 0 1-7.5-7.5l8.7-8.7a3.5 3.5 0 0 1 5 5l-8.5 8.5a1.8 1.8 0 0 1-2.5-2.5l7.8-7.8"/>'),
  file: svg('<path d="M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5z"/><path d="M14 3.5v5h5M8.5 13h7M8.5 16.5h5"/>'),
  eye: svg('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>'),
  eyeOff: svg('<path d="M3.5 3.5l17 17"/><path d="M10.6 5.6A9 9 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16.6 16.6 0 0 1-3.1 3.9"/><path d="M6.7 6.8C4 8.5 2.5 12 2.5 12S6 18.5 12 18.5a8.8 8.8 0 0 0 4.3-1.1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>'),
};
const closeBtn = `<button type="button" class="icon-btn" data-act="close" aria-label="Close">${ICON.close}</button>`;
const backLink = () => `<a class="back-btn" href="/" data-act="home">${ICON.left}My stokvels</a>`;
// A labelled form field. `input` is the control's HTML; `help` is optional small print under it.
const field = (id, label, input, help) => `<label class="field" for="${id}"><span class="field-label">${label}</span>${input}${help ? `<small>${help}</small>` : ''}</label>`;
const phoneInput = (id, value) => `<input id="${id}" type="tel" inputmode="tel" autocomplete="tel" placeholder="082 123 4567" value="${esc(value || '')}">`;
// A password box with a show/hide button. The button sits beside the <label>, because a label may only hold its own control.
const passwordField = (id, label, autocomplete, help) => `<div class="field"><label class="field-label" for="${id}">${label}</label>
  <span class="password-input"><input id="${id}" type="password" autocomplete="${autocomplete}"><button type="button" class="reveal" data-act="reveal" data-for="${id}" aria-label="Show password" aria-pressed="false">${ICON.eye}</button></span>${help ? `<small>${help}</small>` : ''}</div>`;

/* ---------- state ---------- */
const S = {
  session: null, bootError: '',
  route: { name: 'boot' },
  list: null, listMonth: null,
  d: null, dId: null, dError: '',
  invite: null, inviteError: '', joinMode: 'new', joinDraft: { name: null, phone: '' },
  tab: 'month', monthKey: null, recView: 'pay', tone: 'warm',
  pending: 0, justStamped: null,
  sheet: null, sheetRender: null, lastFocus: null, lastFocusAt: null,
  reg: null, draw: null, memView: null, memAsk: null, treasAsk: null, pay: null,
};
const store = {
  get(k) { try { return localStorage.getItem('stokvel.' + k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem('stokvel.' + k, v); } catch (e) { /* storage unavailable */ } },
};

/* ---------- API ---------- */
async function api(method, path, body) {
  const opt = { method, headers: { Accept: 'application/json' }, credentials: 'same-origin' };
  if (method !== 'GET') {
    opt.headers['Content-Type'] = 'application/json';
    opt.headers['X-Stokvel'] = '1';
    opt.body = JSON.stringify(body || {});
  }
  let res;
  try { res = await fetch('/api/' + path, opt); }
  catch (e) { throw { status: 0, message: 'You seem to be offline. Check your connection and try again.' }; }
  let data = null;
  try { data = await res.json(); } catch (e) { /* not JSON */ }
  if (!res.ok) throw { status: res.status, code: data && data.code, message: (data && data.error) || 'Something went wrong. Try again.' };
  return data;
}

function handleError(e) {
  if (e && e.status === 401 && S.session) {
    S.session.user = null;
    closeSheet(true);
    toast('Your session ended. Log in again to continue.');
    render();
    return;
  }
  toast((e && e.message) || 'Something went wrong. Try again.');
}
function bump(n) {
  S.pending = Math.max(0, S.pending + n);
  const el = $('#sync');
  if (el) el.hidden = S.pending === 0;
}

/* ---------- routing ---------- */
function parseRoute() {
  const p = location.pathname;
  let m;
  if ((m = p.match(/^\/s\/([0-9a-f-]{36})\/?$/))) return { name: 'stokvel', id: m[1] };
  if ((m = p.match(/^\/join\/([A-Za-z0-9_-]{20,64})\/?$/))) return { name: 'join', token: m[1] };
  return { name: 'home' };
}
function go(path, replace) {
  if (location.pathname !== path) history[replace ? 'replaceState' : 'pushState'](null, '', path);
  closeSheet(true);
  dismissUndo();
  window.scrollTo(0, 0);
  route();
}
window.addEventListener('popstate', () => { closeSheet(true); dismissUndo(); route(); });

async function route() {
  S.route = parseRoute();
  if (!S.session) {
    render();
    try { S.session = await api('GET', 'session'); S.bootError = ''; }
    catch (e) { S.bootError = e.message; render(); return; }
  }
  if (!S.session.dbReady) return render();
  if (S.route.name === 'join') return loadInvite(S.route.token);
  if (!S.session.user) return render();
  if (S.route.name === 'stokvel') return loadStokvel(S.route.id);
  return loadHome();
}

async function loadHome() {
  render();
  try {
    const month = todayKey();
    const r = await api('GET', 'stokvels?month=' + month);
    S.list = r.stokvels;
    S.listMonth = r.month;
    S.session.user = r.user;
  } catch (e) { handleError(e); }
  if (S.route.name === 'home') render();
}

async function loadStokvel(id, quiet) {
  if (S.dId !== id) {
    S.d = null; S.dId = id; S.dError = ''; S.monthKey = null;
    const t = store.get('tab');
    S.tab = ['month', 'turns', 'record', 'share'].includes(t) ? t : 'month';
  }
  if (!quiet) render();
  try {
    const raw = await api('GET', 'stokvels/' + id);
    if (S.dId !== id) return;
    S.d = normalize(raw);
    S.dError = '';
  } catch (e) {
    if (e.status === 404) { S.dError = e.message; }
    else handleError(e);
  }
  if (S.route.name === 'stokvel' && S.dId === id) { render(); refreshSheet(); }
}

async function loadInvite(token) {
  S.invite = null; S.inviteError = ''; S.joinDraft = { name: null, phone: '' };
  render();
  try { S.invite = await api('GET', 'invites/' + token); }
  catch (e) { S.inviteError = e.message; }
  if (S.route.name === 'join') render();
}

function normalize(r) {
  const marks = {}, meetings = {}, payouts = {};
  for (const c of r.contributions) (marks[c.month] = marks[c.month] || {})[c.memberId] = { status: c.status, amount: c.amount, at: c.at, by: c.byName, paidOn: c.paidOn || '', proof: c.proof || null };
  for (const m of r.meetings) meetings[m.month] = { date: m.heldOn, att: m.attendance || {} };
  for (const p of r.payouts) payouts[p.month] = { at: p.at, by: p.byName };
  return {
    st: r.stokvel,
    members: r.members.map(m => ({ ...m, joined: m.joined || '', left: m.left || '' })),
    marks, meetings, payouts,
    totals: r.totals || {},
    role: r.role, canManage: r.canManage, canConfirm: r.canConfirm,
    me: r.me, treasurer: r.treasurer, activity: r.activity || [],
  };
}

/* ---------- reading a stokvel ---------- */
const markOf = (d, k, id) => (d.marks[k] && d.marks[k][id]) || null;
const meetingOf = (d, k) => (d.st.meetings && d.meetings[k] && DATE_RE.test(d.meetings[k].date)) ? d.meetings[k] : null;
const attOf = (d, k, id) => { const mt = meetingOf(d, k), v = mt && mt.att[id]; return ATTENDANCE.includes(v) ? v : null; };
const payoutOf = (d, k) => d.payouts[k] || null;
const isDue = (st, k) => daysUntil(dueDate(k, st.payDay)) < 0;
const findMember = (d, id) => d.members.find(m => m.id === id);
function cellState(d, k, id) {
  const mk = markOf(d, k, id);
  if (mk) return mk.status;
  if (monthDiff(todayKey(), k) > 0) return 'future';
  return isDue(d.st, k) ? 'missed' : 'open';
}
function monthStats(d, k) {
  const st = d.st, act = activeIn(st, d.members, k);
  let collected = 0, paid = 0, part = 0, late = 0;
  for (const m of act) {
    const mk = markOf(d, k, m.id);
    collected += paidAmount(st, mk);
    if (mk) { if (mk.status === 'part') part++; else paid++; if (mk.status === 'late') late++; }
  }
  return { collected, target: st.amount * act.length, paid, part, late, fines: late * st.lateFine, count: act.length, recipient: recipientOf(st, d.members, k), due: dueDate(k, st.payDay) };
}
function meetStats(d, k) {
  const mt = meetingOf(d, k);
  if (!mt) return null;
  const act = activeIn(d.st, d.members, k), out = { date: mt.date, present: [], apology: [], absent: [], unmarked: [], count: act.length };
  for (const m of act) out[attOf(d, k, m.id) || 'unmarked'].push(m);
  return out;
}
function balance(d, id, skipKey) {
  const st = d.st, m = findMember(d, id);
  let paid = 0, owed = 0, fines = 0, meetings = 0, attended = 0;
  const missed = [], absentKeys = [];
  if (!m) return { paid, owed, fines, missed, meetings, attended, absentKeys };
  for (const k of cycleKeys(st, d.members)) {
    if (!isActive(m, k)) continue;
    const mk = markOf(d, k, id), a = paidAmount(st, mk), at = attOf(d, k, id);
    paid += a;
    if (mk && mk.status === 'late') fines += st.lateFine;
    if (k !== skipKey && isDue(st, k) && !isFull(mk)) { owed += st.amount - a; missed.push(k); }
    if (at) { meetings++; if (at === 'present') attended++; if (at === 'absent') { absentKeys.push(k); fines += st.meetFine; } }
  }
  return { paid, owed, fines, missed, meetings, attended, absentKeys };
}
function everActive(d) { const keys = cycleKeys(d.st, d.members); return roster(d.st, d.members).filter(m => keys.some(k => isActive(m, k))); }
function groupTotals(d) {
  let collected = 0, behind = 0, fines = 0;
  for (const m of everActive(d)) { const x = balance(d, m.id); collected += x.paid; behind += x.owed; fines += x.fines; }
  return { collected, behind, fines };
}
function outstanding(d, k) {
  const st = d.st;
  return activeIn(st, d.members, k).map(m => { const mk = markOf(d, k, m.id); return { m, left: isFull(mk) ? 0 : st.amount - paidAmount(st, mk) }; }).filter(x => x.left > 0);
}
function selKey(d) {
  const keys = cycleKeys(d.st, d.members);
  if (S.monthKey && keys.includes(S.monthKey)) return S.monthKey;
  const tk = todayKey();
  if (keys.includes(tk)) return tk;
  return monthDiff(keys[0], tk) < 0 ? keys[0] : keys[keys.length - 1];
}
const defaultMeetDate = (st, k) => k === todayKey() ? isoDate(new Date()) : isoDate(dueDate(k, st.payDay));

/* ---------- messages for the group chat ---------- */
function summaryText(d, k) {
  const st = d.st, s = monthStats(d, k), act = activeIn(st, d.members, k), ms = meetStats(d, k);
  const paid = [], part = [], notYet = [];
  for (const m of act) {
    const mk = markOf(d, k, m.id);
    if (!mk) notYet.push(m.name);
    else if (mk.status === 'part') part.push(m.name + ' (' + fmtR(paidAmount(st, mk)) + ')');
    else paid.push(m.name + (mk.status === 'late' ? ' (late)' : ''));
  }
  const L = ['*' + st.name + ' · ' + monthLong(k) + '*', 'Collected ' + fmtR(s.collected) + ' of ' + fmtR(s.target) + ' · ' + s.paid + ' of ' + s.count + ' paid'];
  if (st.kind === 'rotating' && s.recipient) {
    const po = payoutOf(d, k);
    L.push(po ? 'Pot paid out to ' + s.recipient.name + ' on ' + fmtTs(po.at) : 'Pot goes to ' + s.recipient.name + ' on ' + fmtDate(s.due));
  } else if (st.kind === 'fund') {
    L.push('Due by ' + fmtDate(s.due) + ' · fund so far ' + fmtR(groupTotals(d).collected));
  }
  L.push('');
  if (paid.length) L.push('✅ Paid: ' + paid.join(', '));
  if (part.length) L.push('➖ Part paid: ' + part.join(', '));
  if (notYet.length) L.push('⏳ Not yet: ' + notYet.join(', '));
  if (ms) {
    const bits = [ms.present.length + ' of ' + ms.count + ' present'];
    if (ms.apology.length) bits.push('Apology: ' + ms.apology.map(m => m.name).join(', '));
    if (ms.absent.length) bits.push('Absent: ' + ms.absent.map(m => m.name).join(', '));
    L.push('📋 Meeting ' + fmtDay(ms.date) + ': ' + bits.join(' · '));
  }
  const fines = [];
  if (s.fines) fines.push('late ' + fmtR(s.fines));
  if (ms && ms.absent.length && st.meetFine) fines.push('missed meeting ' + fmtR(ms.absent.length * st.meetFine));
  if (fines.length) L.push('Fines: ' + fines.join(' · '));
  if (st.kind === 'rotating') {
    const nk = addMonths(k, 1), nr = recipientOf(st, d.members, nk);
    if (nr) L.push('', 'Next up: ' + nr.name + ' in ' + monthName(nk) + '.');
  }
  return L.join('\n');
}
function reminderText(d, k, tone) {
  const st = d.st, s = monthStats(d, k), owe = outstanding(d, k);
  const names = listJoin(owe.map(o => firstName(o.m.name)));
  const due = fmtDate(s.due), mon = monthName(k), late = isDue(st, k), amt = fmtR(st.amount);
  const pot = s.recipient ? firstName(s.recipient.name) : '';
  const when = late ? 'were due on ' + due : 'are due by ' + due;
  if (tone === 'firm') {
    return [mon + ' contributions of ' + amt + ' ' + when + '.', 'Still outstanding: ' + names + '.', st.lateFine ? 'Payments after ' + due + ' carry the ' + fmtR(st.lateFine) + ' late fine.' : '', pot ? pot + ' receives the pot this month, so please pay without delay.' : '', 'Thank you.'].filter(Boolean).join(' ');
  }
  if (tone === 'playful') {
    return ['Eish, ' + mon + ' is running away from us! 🏃🏾', names + ', your ' + amt + ' is still on its way.', late ? 'It was due on ' + due + (st.lateFine ? ', and the ' + fmtR(st.lateFine) + ' late fine is already hungry.' : '.') : 'The due date is ' + due + (st.lateFine ? ', and the ' + fmtR(st.lateFine) + ' late fine is watching.' : '.'), pot ? pot + ' has already planned how to spend the pot 😄' : ''].filter(Boolean).join(' ');
  }
  return ['Hi everyone 👋🏾 A gentle reminder that ' + mon + ' contributions (' + amt + ') ' + when + '.', 'Still to come in: ' + names + '.', pot ? pot + ' gets the pot this month, so let’s get it there on time.' : '', 'Thank you, family! 🙏🏾'].filter(Boolean).join(' ');
}
function describe(a) {
  const x = a.detail || {}, who = a.byName || 'Someone', mon = x.month ? monthName(x.month) : '';
  switch (a.action) {
    case 'confirmed': return `${who} confirmed ${x.member} for ${mon}` + (x.status === 'late' ? ' (late)' : x.status === 'part' ? ` (${fmtR(x.amount)} part)` : '')
      + (x.paidOn ? `, paid ${fmtISO(x.paidOn)}` : '') + (x.proof === 'added' ? ', with proof' : x.proof === 'removed' ? ', proof removed' : '');
    case 'cleared': return `${who} cleared ${x.member}’s ${mon} payment`;
    case 'register': return `${who} saved the ${mon} meeting register`;
    case 'payout': return `${who} marked the ${mon} payout as paid`;
    case 'payout_cleared': return `${who} cleared the ${mon} payout`;
    case 'member_added': return `${who} added ${x.member}`;
    case 'member_removed': return `${who} removed ${x.member}`;
    case 'member_restored': return `${who} brought back ${x.member}`;
    case 'invite': return `${who} created an invite link for ${x.member}`;
    case 'joined': return `${x.member} joined (account: ${who})`;
    case 'unlinked': return `${who} unlinked ${x.member}’s account`;
    case 'treasurer': return `${who} made ${x.member} the treasurer`;
    case 'settings': return `${who} changed the settings`;
    case 'order': return `${who} changed the payout order`;
    case 'created': return `${who} started the stokvel`;
    default: return `${who}: ${a.action}`;
  }
}

/* ---------- small render pieces ---------- */
function stampHTML(kind, top, bottom, seed, pressed) {
  const rot = (hash(seed) % 9) - 5;
  return `<span class="stamp ${kind}${pressed ? ' is-pressed' : ''}" style="--rot:${rot}deg"><b>${top}</b>${bottom ? `<small>${bottom}</small>` : ''}</span>`;
}
const miniStamp = s => `<span class="mini-stamp ${s}">${s === 'part' ? 'Part' : s === 'late' ? 'Late' : 'Paid'}</span>`;
const nameTag = (text, accent) => ` <em class="tag${accent ? ' tag--accent' : ''}">${text}</em>`;
// The day a confirmed payment was made: the date the treasurer entered, or for older records the day it was confirmed.
const paidDate = mk => fmtISO(mk.paidOn) || fmtTs(mk.at);
const proofTag = () => `<span class="proof-tag">${ICON.clip}Proof</span>`;
const proofUrl = (sid, memberId, k, p) => `/api/stokvels/${sid}/proofs/${memberId}/${k}?v=${encodeURIComponent((p && p.at) || '')}`;
const names = list => list.map(m => esc(m.name)).join(', ');
const syncHTML = () => `<span class="sync" id="sync"${S.pending ? '' : ' hidden'}><i></i>Saving…</span>`;
function monthBar(keys, k) {
  const i = keys.indexOf(k), isNow = k === todayKey();
  return `<div class="month-nav">
    <button type="button" class="icon-btn" data-act="prev" aria-label="Previous month"${i <= 0 ? ' disabled' : ''}>${ICON.left}</button>
    <div class="month-title"><h2>${monthLong(k)}</h2><p>${isNow ? 'This month · ' + (i + 1) + ' of ' + keys.length : 'Month ' + (i + 1) + ' of ' + keys.length}</p></div>
    <button type="button" class="icon-btn" data-act="next" aria-label="Next month"${i >= keys.length - 1 ? ' disabled' : ''}>${ICON.right}</button>
  </div>`;
}

/* ---------- screens: loading, sign-in, invites ---------- */
function coverHTML(msg) {
  return `<section class="cover" aria-label="Stokvel"><div class="cover-book"><div class="cover-spine" aria-hidden="true"></div><div class="cover-face">
    <h1 class="tape">Stokvel</h1>
    <ul class="cover-list"><li>All your stokvels in one book</li><li>Your treasurer confirms every payment</li><li>See what you’ve paid and the group total</li></ul>
    <p class="cover-status" role="status"><i></i>${esc(msg || 'Opening your book…')}</p></div></div></section>`;
}
function bootErrorHTML() {
  return `<section class="auth"><div class="auth-card"><h1 class="tape">Stokvel</h1><p class="lead">${esc(S.bootError)}</p><button type="button" class="btn btn--primary" data-act="reload">Try again</button></div></section>`;
}
function noDbHTML() {
  return `<section class="auth"><div class="auth-card">
    <h1 class="tape">Almost ready</h1>
    <p class="lead">The app is live, but its database isn’t connected yet.</p>
    <ol class="steps"><li>Open the <b>stockvel</b> project in Vercel.</li><li>Go to <b>Storage</b>, then <b>Create Database</b>, then <b>Neon</b>.</li><li>Connect it to the project, then <b>Redeploy</b>.</li></ol>
    <button type="button" class="btn btn--primary" data-act="reload">Check again</button>
  </div></section>`;
}
function setupHTML() {
  if (!S.session.setupAllowed) {
    return `<section class="auth"><div class="auth-card"><h1 class="tape">Set up Stokvel</h1><p class="lead">Setup is switched off. Add a <b>SETUP_CODE</b> environment variable to the project in Vercel, redeploy, then come back here.</p></div></section>`;
  }
  return `<section class="auth"><form class="auth-card form" id="setupForm" novalidate>
    <h1 class="tape">Set up Stokvel</h1>
    <p class="lead">Create the first account. You need the setup code that came with the app.</p>
    ${field('suCode', 'Setup code', '<input id="suCode" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="XXXX-XXXX-XXXX">')}
    ${field('suName', 'Your name', '<input id="suName" autocomplete="name" maxlength="60">')}
    ${field('suPhone', 'Phone number', phoneInput('suPhone'))}
    ${passwordField('suPass', 'Password', 'new-password', 'At least 6 characters.')}
    <p class="form-error" id="formErr" role="alert" hidden></p>
    <button type="submit" class="btn btn--primary" id="formSubmit">Create my account</button>
  </form></section>`;
}
function loginHTML() {
  return `<section class="auth"><form class="auth-card form" id="loginForm" novalidate>
    <h1 class="tape">Stokvel</h1>
    <p class="lead">Log in with your phone number to see your stokvels.</p>
    ${field('liPhone', 'Phone number', phoneInput('liPhone'))}
    ${passwordField('liPass', 'Password', 'current-password')}
    <p class="form-error" id="formErr" role="alert" hidden></p>
    <button type="submit" class="btn btn--primary" id="formSubmit">Log in</button>
  </form><p class="auth-foot">New here? Ask your treasurer to send you an invite link.</p></section>`;
}
function joinHTML() {
  const user = S.session.user;
  if (S.inviteError) {
    return `<section class="auth"><div class="auth-card"><p class="label">Invite link</p><h1 class="tape">Stokvel</h1><p class="lead">${esc(S.inviteError)}</p>
      <a class="btn btn--primary" href="/" data-act="home">${user ? 'Go to my stokvels' : 'Log in'}</a></div></section>`;
  }
  if (!S.invite) return coverHTML('Opening your invite…');
  const inv = S.invite, m = inv.member, draft = S.joinDraft;
  const role = m.isTreasurer ? ', the treasurer. You’ll confirm everyone’s payments.' : '';
  let body;
  if (user && inv.alreadyIn) {
    body = `<p class="lead">You’re already in this stokvel as <b>${esc(stop(inv.alreadyIn))}</b></p><a class="btn btn--primary" href="/s/${esc(inv.stokvel.id)}" data-act="openStokvel" data-id="${esc(inv.stokvel.id)}">Open ${esc(inv.stokvel.name)}</a>
      <button type="button" class="link-btn" data-act="logout">Not you? Log out</button>`;
  } else if (user) {
    body = `<p class="fineprint">You’re logged in as ${esc(user.name)} (${esc(user.phone)}).</p>
      <p class="form-error" id="formErr" role="alert" hidden></p>
      <button type="button" class="btn btn--primary" data-act="joinAccept" id="formSubmit">Join as ${esc(m.name)}</button>
      <button type="button" class="link-btn" data-act="logout">Not you? Log out</button>`;
  } else {
    const isNew = S.joinMode === 'new';
    body = `<div class="segmented" role="group" aria-label="Account">
        <button type="button" aria-pressed="${isNew}" data-act="joinMode" data-mode="new">I’m new here</button>
        <button type="button" aria-pressed="${!isNew}" data-act="joinMode" data-mode="login">I have an account</button>
      </div>
      <form class="form" id="joinForm" novalidate>
        ${isNew ? field('jnName', 'Your name', `<input id="jnName" autocomplete="name" maxlength="60" value="${esc(draft.name == null ? m.name : draft.name)}">`) : ''}
        ${field('jnPhone', 'Phone number', phoneInput('jnPhone', draft.phone))}
        ${passwordField('jnPass', isNew ? 'Choose a password' : 'Password', isNew ? 'new-password' : 'current-password', isNew ? 'At least 6 characters. You’ll log in with your phone number and this password.' : '')}
        <p class="form-error" id="formErr" role="alert" hidden></p>
        <button type="submit" class="btn btn--primary" id="formSubmit">${isNew ? 'Create my login and join' : 'Log in and join'}</button>
      </form>`;
  }
  return `<section class="auth"><div class="auth-card">
    <p class="label">You’re invited${inv.invitedBy ? ' by ' + esc(inv.invitedBy) : ''}</p>
    <h1 class="tape">${esc(inv.stokvel.name)}</h1>
    <p class="lead">Join as <b>${esc(role ? m.name : stop(m.name))}</b>${role}</p>
    ${body}
  </div></section>`;
}

/* ---------- screens: home ---------- */
function homeHTML() {
  const u = S.session.user, list = S.list;
  const top = `<header class="topbar"><span class="app-name">Stokvel</span><span class="topbar-actions"><button type="button" class="icon-btn" data-act="account" aria-label="Your account">${ICON.user}</button></span></header>`;
  const count = list ? list.length : 0;
  const hello = `<div class="greeting"><h1>Hi ${esc(firstName(u.name))}</h1><p>${!list ? 'Loading your stokvels…' : count ? (count === 1 ? 'Your stokvel' : 'Your ' + count + ' stokvels') : 'Welcome to your stokvel book.'}</p></div>`;
  if (!list) return top + hello;
  if (!count) {
    return top + hello + `<section class="card"><div class="card-head"><h2>You’re not in a stokvel yet</h2><p>Start one and invite your members. If a treasurer sent you an invite link, open that link instead.</p></div><button type="button" class="btn btn--primary" data-act="create">${ICON.plus}Start a stokvel</button></section>`;
  }
  return top + hello + `<div class="stokvel-list">${list.map(cardHTML).join('')}</div><button type="button" class="btn btn--ghost" data-act="create">${ICON.plus}Start another stokvel</button>`;
}
function cardHTML(s) {
  const mon = monthName(S.listMonth || todayKey());
  const kind = s.kind === 'rotating' ? 'Rotating payout' : 'Group fund';
  const isT = s.role === 'treasurer';
  let first;
  if (isT) first = `<div><span>${mon}</span><b>${s.monthPaid} of ${s.activeCount}</b><span>confirmed</span></div>`;
  else if (s.myStatus) first = `<div><span>You’ve paid</span><b>${fmtR(s.myTotal)}</b><span class="text-good">${mon}: confirmed${s.myStatus === 'late' ? ' (late)' : s.myStatus === 'part' ? ' (part)' : ''}</span></div>`;
  else first = `<div><span>You’ve paid</span><b>${fmtR(s.myTotal)}</b><span>${mon}: not confirmed yet</span></div>`;
  const waiting = !s.treasurerJoined && s.treasurerName ? `<p class="sub text-warn">Waiting for ${esc(s.treasurerName)} to join as treasurer.</p>` : '';
  return `<a class="stokvel-card" href="/s/${esc(s.id)}" data-act="openStokvel" data-id="${esc(s.id)}">
    <span class="tape">${esc(s.name)}</span>
    <div class="tags">${isT ? '<span class="chip chip--accent">Treasurer</span>' : '<span class="chip">Member</span>'}<span class="sub">${kind} · ${fmtR(s.amount)} a month</span></div>
    <div class="facts">${first}<div><span>Everyone together</span><b>${fmtR(s.totalCollected)}</b><span>${s.monthCollected ? fmtR(s.monthCollected) + ' this month' : 'collected so far'}</span></div></div>
    ${waiting}
    <span class="chev" aria-hidden="true">${ICON.right}</span>
  </a>`;
}

/* ---------- screens: a stokvel ---------- */
function stokHeader(d) {
  const st = d.st, n = activeIn(st, d.members, selKey(d)).length;
  const kind = st.kind === 'rotating' ? 'Rotating payout' : 'Group fund';
  const tools = d.canManage ? `<span class="topbar-actions"><button type="button" class="icon-btn" data-act="members" aria-label="Members">${ICON.people}</button><button type="button" class="icon-btn" data-act="settings" aria-label="Stokvel settings">${ICON.sliders}</button></span>` : '';
  const who = d.role !== 'treasurer' && d.treasurer ? `<p class="page-sub">${esc(d.treasurer.name)} is the treasurer and confirms payments.</p>` : '';
  return `<header class="page-head">
    <div class="topbar">${backLink()}${syncHTML()}${tools}</div>
    <h1 class="tape">${esc(st.name)}</h1>
    <p class="page-meta"><span>${kind} · ${fmtR(st.amount)} a month · ${n} ${n === 1 ? 'member' : 'members'}</span>${d.role === 'treasurer' ? '<span class="chip chip--accent">Treasurer</span>' : '<span class="chip">Member</span>'}</p>
    ${who}
  </header>`;
}
// While a stokvel loads: its header (the name is known from the home list) and a quiet status line.
function stokLoadingHTML() {
  const known = S.list && S.list.find(s => s.id === S.dId);
  return `<header class="page-head"><div class="topbar">${backLink()}</div><h1 class="tape">${esc(known ? known.name : 'Stokvel')}</h1></header>
    <p class="loading" role="status"><i></i>Opening the book…</p>`;
}

function rowHTML(d, k, m, idx, recId) {
  const st = d.st, mk = markOf(d, k, m.id), cs = cellState(d, k, m.id), due = dueDate(k, st.payDay), at = attOf(d, k, m.id);
  const isRec = recId === m.id, isT = m.id === st.treasurerId;
  const prevOwed = balance(d, m.id, k).owed;
  const bits = [];
  if (isRec) bits.push('<span class="text-accent">Gets the pot</span>');
  if (mk) {
    const amt = fmtR(paidAmount(st, mk)), when = paidDate(mk);
    bits.push(mk.status === 'paid' ? `Paid ${amt} on ${when}` : mk.status === 'late' ? `Paid late · ${amt} on ${when}` : `Paid ${amt} of ${fmtR(st.amount)} on ${when}`);
    if (mk.proof) bits.push(proofTag());
  } else if (cs === 'missed') bits.push('<span class="text-bad">Overdue since ' + fmtDate(due) + '</span>');
  else bits.push('Due ' + fmtDate(due));
  if (at === 'absent') bits.push('<span class="text-bad">missed the meeting</span>');
  if (at === 'apology') bits.push('<span class="text-warn">apology for the meeting</span>');
  if (prevOwed > 0) bits.push('<span class="text-bad">behind ' + fmtR(prevOwed) + '</span>');
  const tag = isT ? nameTag('Treasurer', true) : m.title ? nameTag(esc(m.title)) : '';
  const who = `<span class="name">${esc(m.name)}${tag}</span><span class="sub">${bits.join(' · ')}</span>`;
  let end;
  if (mk) {
    const top = mk.status === 'part' ? 'Part' : mk.status === 'late' ? 'Late' : 'Paid';
    const bottom = mk.status === 'part' ? fmtR(paidAmount(st, mk)) : mk.status === 'late' ? (st.lateFine ? '+' + fmtR(st.lateFine) : paidDate(mk)) : paidDate(mk);
    const stamp = stampHTML(mk.status, top, bottom, m.id + k, S.justStamped === k + ':' + m.id);
    end = `<button type="button" class="stamp-btn" data-act="pay" data-id="${esc(m.id)}" aria-label="Change ${esc(m.name)}’s payment">${stamp}</button>`;
  } else {
    end = `<button type="button" class="confirm-btn" data-act="pay" data-id="${esc(m.id)}" aria-label="Confirm ${esc(m.name)}’s payment">Confirm</button>`;
  }
  const dot = at ? `<i class="att-dot ${at}" role="img" aria-label="Meeting: ${ATT_LABEL[at]}" title="Meeting: ${ATT_LABEL[at]}"></i>` : '';
  return `<li class="ledger-row${isRec ? ' is-recipient' : ''}"><span class="row-num">${idx + 1}${dot}</span><button type="button" class="row-main" data-act="pay" data-id="${esc(m.id)}">${who}</button><div class="row-end">${end}</div></li>`;
}

function monthView(d) {
  const st = d.st, keys = cycleKeys(st, d.members), k = selKey(d), s = monthStats(d, k), act = activeIn(st, d.members, k), ms = meetStats(d, k);
  const side = st.kind === 'rotating'
    ? `<p class="label">Payout · ${fmtDate(s.due)}</p><p class="summary-who">${s.recipient ? esc(s.recipient.name) : '—'}</p><p class="summary-when">${relDays(daysUntil(s.due))}</p>`
    : `<p class="label">Due · ${fmtDate(s.due)}</p><p class="summary-who">${fmtR(groupTotals(d).collected)}</p><p class="summary-when">in the fund so far</p>`;
  const n = Math.max(1, act.length), gap = act.length > 20 ? 2 : 4;
  const payTally = act.map(m => {
    const mk = markOf(d, k, m.id);
    if (mk && mk.status === 'part') return `<i class="part" style="--p:${Math.round(100 * paidAmount(st, mk) / st.amount)}%"></i>`;
    return `<i class="${mk ? mk.status : (cellState(d, k, m.id) === 'missed' ? 'missed' : '')}"></i>`;
  }).join('');
  const foot = [s.paid + ' of ' + s.count + ' confirmed'];
  if (s.part) foot.push(s.part + ' part');
  if (s.fines) foot.push('late fines ' + fmtR(s.fines));
  let meet = '';
  if (st.meetings) {
    if (ms) {
      const line = [ms.present.length + ' present'];
      if (ms.apology.length) line.push(ms.apology.length + (ms.apology.length === 1 ? ' apology' : ' apologies'));
      if (ms.absent.length) line.push(ms.absent.length + ' absent');
      if (ms.unmarked.length) line.push(ms.unmarked.length + ' not marked');
      meet = `<hr class="divider"><div class="info-row"><div><p class="label">Meeting · ${fmtDay(ms.date)}</p><p class="info-value">${line.join(' · ')}</p></div><button type="button" class="btn btn--sm" data-act="register">${ICON.register}Edit register</button></div>
        <div class="tally tally--meet" style="--n:${n};--g:${gap}px" role="img" aria-label="${ms.present.length} of ${ms.count} members at the meeting">${act.map(m => `<i class="${attOf(d, k, m.id) || ''}"></i>`).join('')}</div>`;
    } else {
      meet = `<hr class="divider"><div class="info-row"><div><p class="label">Meeting</p><p class="info-value">Register not taken yet</p></div><button type="button" class="btn btn--sm btn--primary" data-act="register">${ICON.register}Take the register</button></div>`;
    }
  }
  const owe = outstanding(d, k), overdue = isDue(st, k);
  const oweText = owe.length ? owe.map(o => esc(o.m.name) + (o.left < st.amount ? ' (' + fmtR(o.left) + ' left)' : '')).join(', ') : 'Everyone has paid.';
  let meetCheck = '';
  if (st.meetings) {
    let t = 'Register not taken yet.';
    if (ms) {
      const bits = [];
      if (ms.absent.length) bits.push('<span class="text-bad">' + names(ms.absent) + '</span>');
      if (ms.apology.length) bits.push('<span class="text-warn">apology from ' + names(ms.apology) + '</span>');
      if (ms.unmarked.length) bits.push('not marked: ' + names(ms.unmarked));
      t = bits.length ? bits.join(' · ') : 'Everyone was there.';
    }
    meetCheck = `<div><dt class="label">Missed meeting</dt><dd>${t}</dd></div>`;
  }
  const recId = s.recipient ? s.recipient.id : '';
  return `${monthBar(keys, k)}
  <section class="card" aria-label="Month summary">
    <div class="summary">
      <div class="stat"><p class="label">Collected</p><p class="total"><span class="total-value">${fmtR(s.collected)}</span><span class="total-of">of ${fmtR(s.target)}</span></p></div>
      <div class="summary-side">${side}</div>
    </div>
    <div class="tally" style="--n:${n};--g:${gap}px" role="img" aria-label="${s.paid} of ${s.count} members confirmed">${payTally}</div>
    <p class="card-note">${foot.join(' · ')}</p>
    ${meet}
    <hr class="divider">
    <dl class="check-list">
      <div><dt class="label">${overdue && owe.length ? 'Owing' : 'Not paid yet'}</dt><dd${overdue && owe.length ? ' class="text-bad"' : ''}>${oweText}</dd></div>
      ${meetCheck}
    </dl>
  </section>
  ${act.length ? `<ol class="ledger" aria-label="Members">${act.map((m, i) => rowHTML(d, k, m, i, recId)).join('')}</ol>` : '<section class="card"><p class="empty">No members in this month yet.</p></section>'}
  <div class="ledger-foot"><button type="button" class="btn btn--ghost btn--sm" data-act="members">${ICON.people}Add or remove members</button></div>
  <p class="hint">Confirm records the amount, the date it was paid and, if you have one, a proof of payment. Tap a name to change a payment${st.meetings ? ' or mark the meeting' : ''}.</p>`;
}

function movesHTML(m, i, ci, n) {
  const first = Math.max(0, ci + 1);
  return `<span class="move-btns"><button type="button" class="icon-btn icon-btn--sm" data-act="up" data-id="${esc(m.id)}" aria-label="Move ${esc(m.name)} earlier"${i <= first ? ' disabled' : ''}>${ICON.up}</button><button type="button" class="icon-btn icon-btn--sm" data-act="down" data-id="${esc(m.id)}" aria-label="Move ${esc(m.name)} later"${i >= n - 1 ? ' disabled' : ''}>${ICON.down}</button></span>`;
}
function turnsView(d) {
  const st = d.st, r = rotation(st, d.members), keys = cycleKeys(st, d.members), ci = monthDiff(st.startMonth, todayKey());
  const upcoming = r.length - Math.min(r.length, Math.max(0, ci + 1));
  const rows = r.map((m, i) => {
    const k = keys[i], s = monthStats(d, k), po = payoutOf(d, k);
    const state = i < ci ? 'past' : i === ci ? 'now' : 'future';
    let sub, end = '';
    if (po) {
      sub = 'Received ' + fmtR(s.collected) + (po.by ? ' · stamped by ' + esc(po.by) : '');
      end = `<button type="button" class="stamp-btn" data-act="payoutSheet" data-k="${k}" aria-label="Change the paid-out stamp for ${monthLong(k)}">${stampHTML('done', 'Paid out', fmtTs(po.at), 'po' + k, S.justStamped === 'po:' + k)}</button>`;
    } else if (state === 'future') {
      sub = 'Gets ' + fmtR(s.target) + ' on ' + fmtDate(s.due);
      end = movesHTML(m, i, ci, r.length);
    } else {
      sub = fmtR(s.collected) + ' of ' + fmtR(s.target) + ' collected · payout ' + fmtDate(s.due);
      end = `<button type="button" class="confirm-btn" data-act="payout" data-k="${k}">Mark paid out</button>`;
    }
    const tag = state === 'now' ? nameTag('This month', true) : m.left ? nameTag('Left') : '';
    return `<li class="ledger-row is-${state}"><span class="row-num"><b>${monthShort(k)}</b><small>${k.slice(0, 4)}</small></span><div class="row-main"><span class="name">${esc(m.name)}${tag}</span><span class="sub">${sub}</span></div><div class="row-end">${end}</div></li>`;
  }).join('');
  return `<section class="section-head"><div><h2>Payout order</h2><p>Each month one member takes the whole pot.</p></div><button type="button" class="btn btn--sm" data-act="draw"${upcoming < 2 ? ' disabled' : ''}>${ICON.shuffle}Draw lots</button></section>
  <ol class="ledger" aria-label="Payout order">${rows}</ol>
  <p class="hint">Past and current turns stay where they are. Move or draw lots for the turns still to come.</p>`;
}
function fundView(d) {
  const st = d.st, keys = cycleKeys(st, d.members), last = keys[keys.length - 1], list = everActive(d);
  const po = payoutOf(d, last), started = monthDiff(last, todayKey()) >= 0;
  let fund = 0, projected = 0, fines = 0;
  const rows = list.map((m, i) => {
    const x = balance(d, m.id);
    let proj = x.paid;
    for (const k of keys) if (isActive(m, k) && !isDue(st, k)) proj += st.amount - paidAmount(st, markOf(d, k, m.id));
    fund += x.paid; projected += proj; fines += x.fines;
    const sub = ['Paid in ' + fmtR(x.paid)];
    if (x.owed) sub.push('<span class="text-bad">owes ' + fmtR(x.owed) + '</span>');
    if (x.fines) sub.push('fines ' + fmtR(x.fines));
    return `<li class="ledger-row"><span class="row-num">${i + 1}</span><div class="row-main"><span class="name">${esc(m.name)}${m.left ? nameTag('Left') : ''}</span><span class="sub">${sub.join(' · ')}</span></div><div class="row-end"><span class="amt">${fmtR(proj)}</span></div></li>`;
  }).join('');
  let action = '';
  if (po) action = `<button type="button" class="stamp-btn" data-act="payoutSheet" data-k="${last}" aria-label="Change the paid-out stamp">${stampHTML('done', 'Paid out', fmtTs(po.at), 'po' + last, S.justStamped === 'po:' + last)}</button>`;
  else if (started) action = `<button type="button" class="btn btn--sm" data-act="payout" data-k="${last}">Mark fund paid out</button>`;
  return `<section class="section-head"><div><h2>The fund</h2><p>Everyone pays in until ${monthLong(last)}.</p></div>${action}</section>
  <section class="card stats" aria-label="Fund"><div class="stat"><p class="label">In the fund</p><p class="stat-value">${fmtR(fund)}</p></div><div class="stat"><p class="label">By ${monthShort(last)} ${last.slice(0, 4)}</p><p class="stat-value">${fmtR(projected)}</p></div><div class="stat"><p class="label">Fines</p><p class="stat-value">${fmtR(fines)}</p></div></section>
  <ol class="ledger" aria-label="Each member’s share"><li class="ledger-row ledger-row--head" aria-hidden="true"><span class="row-num"></span><span class="label">Member</span><span class="label">By the end</span></li>${rows}</ol>
  <p class="hint">“By the end” assumes everyone pays the months still to come. Arrears are not included.</p>`;
}
function recordView(d) {
  const st = d.st, keys = cycleKeys(st, d.members), list = everActive(d), t = groupTotals(d), tk = todayKey(), meet = st.meetings && S.recView === 'meet';
  const cellFor = (k, m) => {
    if (!isActive(m, k)) return 'na';
    if (!meet) return cellState(d, k, m.id);
    const a = attOf(d, k, m.id);
    if (a) return a;
    return monthDiff(tk, k) > 0 ? 'future' : 'nomeet';
  };
  const head = keys.map(k => `<th scope="col"${k === tk ? ' class="is-now"' : ''}><button type="button" data-act="goto" data-k="${k}" aria-label="Open ${monthLong(k)}" title="${monthLong(k)}">${monthName(k)[0]}</button></th>`).join('');
  const body = list.map(m => `<tr><th scope="row"><span>${esc(m.name)}</span></th>${keys.map(k => { const s = cellFor(k, m), what = esc(monthLong(k) + ': ' + CELL[s]); return `<td${k === tk ? ' class="is-now"' : ''}><i class="cell ${s}" role="img" aria-label="${what}" title="${what}"></i></td>`; }).join('')}</tr>`).join('');
  const legend = (meet ? ['present', 'apology', 'absent', 'nomeet', 'future'] : ['paid', 'late', 'part', 'missed', 'open', 'future']).concat(list.some(m => m.joined || m.left) ? ['na'] : []);
  const rows = list.map(m => ({ m, x: balance(d, m.id) }));
  const behind = rows.filter(r => r.x.owed > 0).sort((a, z) => z.x.owed - a.x.owed);
  const absent = rows.filter(r => r.x.absentKeys.length > 0).sort((a, z) => z.x.absentKeys.length - a.x.absentKeys.length);
  return `<section class="card stats" aria-label="Totals">
    <div class="stat"><p class="label">Collected</p><p class="stat-value">${fmtR(t.collected)}</p></div>
    <div class="stat"><p class="label">Behind</p><p class="stat-value${t.behind ? ' text-bad' : ''}">${fmtR(t.behind)}</p></div>
    <div class="stat"><p class="label">Fines</p><p class="stat-value">${fmtR(t.fines)}</p></div>
  </section>
  <section class="card">
    <div class="card-head"><h2>${st.kind === 'rotating' ? 'The full cycle' : 'The year so far'}</h2><p>${monthLong(keys[0])} to ${monthLong(keys[keys.length - 1])}. Tap a month to open it.</p></div>
    ${st.meetings ? `<div class="segmented" role="group" aria-label="Show"><button type="button" aria-pressed="${!meet}" data-act="recView" data-v="pay">Payments</button><button type="button" aria-pressed="${meet}" data-act="recView" data-v="meet">Meetings</button></div>` : ''}
    <div class="grid-scroll"><table class="record-grid"><thead><tr><th scope="col"><span class="label">Member</span></th>${head}</tr></thead><tbody>${body}</tbody></table></div>
    <ul class="legend">${legend.map(s => `<li><i class="cell ${s}" aria-hidden="true"></i>${CELL[s]}</li>`).join('')}</ul>
  </section>
  <section class="card">
    <div class="card-head"><h2>Behind on payments</h2></div>
    ${behind.length ? `<ul class="list">${behind.map(r => `<li><span class="name">${esc(r.m.name)}</span><span class="sub">${r.x.missed.map(monthShort).join(', ')}</span><span class="amt text-bad">${fmtR(r.x.owed)}</span></li>`).join('')}</ul>` : '<p class="empty">Nobody is behind. Everyone has paid up to date.</p>'}
  </section>
  ${st.meetings ? `<section class="card">
    <div class="card-head"><h2>Missed meetings</h2><p>Absent without an apology${st.meetFine ? ' · ' + fmtR(st.meetFine) + ' fine each time' : ''}.</p></div>
    ${absent.length ? `<ul class="list">${absent.map(r => `<li><span class="name">${esc(r.m.name)}</span><span class="sub">${r.x.absentKeys.map(monthShort).join(', ')} · at ${r.x.attended} of ${r.x.meetings} meetings</span><span class="amt text-bad">${r.x.absentKeys.length} missed</span></li>`).join('')}</ul>` : '<p class="empty">Nobody has missed a meeting without an apology.</p>'}
  </section>` : ''}
  <section class="card">
    <div class="card-head"><h2>Latest activity</h2><p>Who confirmed what, and when.</p></div>
    ${d.activity.length ? `<ul class="list list--activity">${d.activity.slice(0, 15).map(a => `<li><span class="activity-text">${esc(describe(a))}</span><span class="sub">${fmtTs(a.at)}</span></li>`).join('')}</ul>` : '<p class="empty">Changes show up here as the book is updated.</p>'}
  </section>`;
}
function shareView(d) {
  const keys = cycleKeys(d.st, d.members), k = selKey(d);
  const sum = summaryText(d, k), owe = outstanding(d, k), rem = reminderText(d, k, S.tone);
  return `${monthBar(keys, k)}
  <section class="card">
    <div class="card-head"><h2>Month summary</h2><p>For the group chat${d.st.meetings ? ', with the meeting register' : ''}. Copy it, or open WhatsApp with it ready to send.</p></div>
    <pre class="bubble" id="sumText">${esc(sum)}</pre>
    <div class="actions"><button type="button" class="btn" data-act="copy" data-src="sumText">${ICON.copy}Copy</button><a class="btn" href="${esc(waLink(sum))}" target="_blank" rel="noopener">${ICON.chat}Open in WhatsApp</a></div>
  </section>
  <section class="card">
    <div class="card-head"><h2>Nudge who hasn’t paid</h2><p>${owe.length ? owe.length + (owe.length === 1 ? ' person still owes' : ' people still owe') + ' for ' + monthName(k) + '.' : 'Everyone has paid for ' + monthName(k) + '. Nobody to nudge.'}</p></div>
    ${owe.length ? `<div class="segmented" role="group" aria-label="Tone">${TONES.map(t => `<button type="button" aria-pressed="${S.tone === t.id}" data-act="tone" data-tone="${t.id}">${t.label}</button>`).join('')}</div>
    <pre class="bubble" id="remText">${esc(rem)}</pre>
    <div class="actions"><button type="button" class="btn" data-act="copy" data-src="remText">${ICON.copy}Copy</button><a class="btn" href="${esc(waLink(rem))}" target="_blank" rel="noopener">${ICON.chat}Open in WhatsApp</a></div>` : ''}
  </section>`;
}

/* The view for members: what I've paid, what everyone has paid, and the meetings. */
function memberView(d) {
  const st = d.st, tk = todayKey(), keys = cycleKeys(st, d.members), meId = d.me && d.me.memberId, me = meId && findMember(d, meId);
  let setup = '';
  if (d.canManage && d.treasurer && !d.treasurer.joined) {
    setup = `<section class="note note--info"><p><b>${esc(d.treasurer.name)} hasn’t joined yet.</b> Send the treasurer’s invite link so they can start confirming payments. Until then, nobody can confirm.</p><button type="button" class="btn btn--primary btn--sm" data-act="invite" data-id="${esc(d.treasurer.memberId)}">${ICON.link}Invite ${esc(firstName(d.treasurer.name))}</button></section>`;
  }
  if (!me) return setup + `<section class="card"><p class="empty">You’re not listed as a member of this stokvel.</p></section>`;
  const cur = keys.includes(tk) ? tk : (monthDiff(keys[0], tk) < 0 ? keys[0] : keys[keys.length - 1]);
  const mk = markOf(d, cur, meId), bal = balance(d, meId);
  let nowLine;
  if (!isActive(me, cur)) nowLine = `<p class="sub">You’re not paying in ${monthName(cur)}.</p>`;
  else if (mk) nowLine = `<div class="info-row"><div><p class="label">${monthName(cur)}</p><p class="info-value">${mk.status === 'part' ? fmtR(paidAmount(st, mk)) + ' of ' + fmtR(st.amount) : fmtR(paidAmount(st, mk))} paid on ${paidDate(mk)}</p>${mk.proof ? `<a class="proof-link" href="${esc(proofUrl(st.id, meId, cur, mk.proof))}" target="_blank" rel="noopener">${ICON.clip}View proof of payment</a>` : ''}</div>${stampHTML(mk.status, mk.status === 'part' ? 'Part' : mk.status === 'late' ? 'Late' : 'Paid', mk.status === 'part' ? fmtR(paidAmount(st, mk)) : paidDate(mk), meId + cur)}</div>`;
  else nowLine = `<div class="info-row"><div><p class="label">${monthName(cur)}</p><p class="info-value${isDue(st, cur) ? ' text-bad' : ''}">${isDue(st, cur) ? 'Not confirmed · was due ' + fmtDate(dueDate(cur, st.payDay)) : 'Not confirmed yet · due ' + fmtDate(dueDate(cur, st.payDay))}</p></div></div>`;
  const shown = keys.filter(k => monthDiff(k, tk) >= 0 && isActive(me, k)).reverse();
  const history = shown.map(k => {
    const c = markOf(d, k, meId), cs = cellState(d, k, meId);
    const sub = c
      ? (c.status === 'part' ? 'Part payment · paid ' : 'Paid ') + paidDate(c) + (c.proof ? ` · <a href="${esc(proofUrl(st.id, meId, k, c.proof))}" target="_blank" rel="noopener">View proof</a>` : '')
      : cs === 'missed' ? 'Not confirmed · was due ' + fmtDate(dueDate(k, st.payDay)) : 'Due ' + fmtDate(dueDate(k, st.payDay));
    const end = c ? `<span class="amt">${fmtR(paidAmount(st, c))}</span>` : `<span class="no-stamp${cs === 'missed' ? ' text-bad' : ''}">${cs === 'missed' ? 'Owing' : 'Not yet'}</span>`;
    return `<li><span class="name">${monthLong(k)} ${c ? miniStamp(c.status) : ''}</span><span class="sub">${sub}</span>${end}</li>`;
  }).join('');
  const notes = [];
  if (bal.owed) notes.push(`<span class="text-bad">You’re behind ${fmtR(bal.owed)} (${bal.missed.map(monthShort).join(', ')}).</span>`);
  if (bal.fines) notes.push(`Fines so far: ${fmtR(bal.fines)}.`);
  const mine = `<section class="card" aria-label="My contributions">
    <div class="stat"><p class="label">What I’ve paid</p><p class="total"><span class="total-value">${fmtR(bal.paid)}</span><span class="total-of">confirmed so far</span></p></div>
    ${notes.length ? `<p class="card-note">${notes.join(' ')}</p>` : ''}
    <hr class="divider">
    ${nowLine}
    ${history ? `<details class="disclosure"><summary>Every month (${shown.length})</summary><ul class="list">${history}</ul></details>` : ''}
  </section>`;

  const allCollected = Object.entries(d.totals).filter(([k]) => keys.includes(k)).reduce((a, [, v]) => a + (v.collected || 0), 0);
  const curTotals = d.totals[cur] || { collected: 0, paid: 0 };
  const target = st.amount * activeIn(st, d.members, cur).length;
  const pct = target ? Math.min(100, Math.round(100 * curTotals.collected / target)) : 0;
  let potLine = '';
  if (st.kind === 'rotating') {
    const rcp = recipientOf(st, d.members, cur), po = payoutOf(d, cur);
    if (rcp) potLine = `<p class="card-note">${po ? 'The ' + monthName(cur) + ' pot was paid out to ' + esc(rcp.id === meId ? 'you' : rcp.name) + ' on ' + fmtTs(po.at) + '.' : 'The ' + monthName(cur) + ' pot goes to ' + (rcp.id === meId ? '<b>you</b>' : esc(rcp.name)) + ' on ' + fmtDate(dueDate(cur, st.payDay)) + '.'}</p>`;
  } else {
    potLine = `<p class="card-note">Everyone pays in until ${monthLong(keys[keys.length - 1])}.</p>`;
  }
  const group = `<section class="card" aria-label="Everyone together">
    <div class="stat"><p class="label">Everyone together</p><p class="total"><span class="total-value">${fmtR(allCollected)}</span><span class="total-of">collected in total</span></p></div>
    <div class="info-row"><div><p class="label">${monthName(cur)}</p><p class="info-value">${fmtR(curTotals.collected)} of ${fmtR(target)}</p></div><p class="sub">${curTotals.paid} paid in full</p></div>
    <div class="progress" role="img" aria-label="${pct}% of this month’s contributions collected"><i style="--w:${pct}%"></i></div>
    ${potLine}
  </section>`;

  let meetings = '';
  if (st.meetings) {
    const held = keys.map(k => [k, meetStats(d, k)]).filter(([, m]) => m).reverse();
    const att = bal.meetings ? `<p class="card-note">You were at ${bal.attended} of ${bal.meetings} meetings.</p>` : '';
    const peopleHTML = ms => {
      const pills = (key, label) => ms[key].length ? `<div><p class="label">${label} (${ms[key].length})</p><ul class="name-pills">${ms[key].map(m => `<li class="${key}${m.id === meId ? ' is-me' : ''}"><i aria-hidden="true"></i>${esc(m.id === meId ? m.name + ' (you)' : m.name)}</li>`).join('')}</ul></div>` : '';
      return `<div class="people">${pills('present', 'Present')}${pills('apology', 'Apology')}${pills('absent', 'Absent')}${pills('unmarked', 'Not marked')}</div>`;
    };
    if (held.length) {
      const [lk, lm] = held[0];
      const earlier = held.slice(1);
      meetings = `<section class="card" aria-label="Meetings">
        <div class="card-head"><p class="label">Meetings</p><h2>${fmtDay(lm.date)}</h2><p>${monthLong(lk)} · ${lm.present.length} of ${lm.count} there</p></div>
        ${peopleHTML(lm)}
        ${att}
        ${earlier.length ? `<details class="disclosure"><summary>Earlier meetings (${earlier.length})</summary><div class="meeting-list">${earlier.map(([, m]) => `<div><h3>${fmtDay(m.date)} · ${m.present.length} of ${m.count} there</h3>${peopleHTML(m)}</div>`).join('')}</div></details>` : ''}
      </section>`;
    } else {
      meetings = `<section class="card" aria-label="Meetings"><div class="card-head"><p class="label">Meetings</p><h2>No register yet</h2><p>Attendance shows here once ${d.treasurer ? esc(d.treasurer.name) : 'the treasurer'} takes the register.</p></div></section>`;
    }
  }

  let turn = '';
  if (st.kind === 'rotating') {
    const r = rotation(st, d.members), idx = r.findIndex(m => m.id === meId), ci = monthDiff(st.startMonth, tk);
    let head = 'You don’t have a turn in this cycle.';
    if (idx >= 0) {
      const k = keys[idx];
      head = idx < ci ? `You received the pot in ${monthLong(k)}.` : idx === ci ? `It’s your turn: the pot comes to you on ${fmtDate(dueDate(k, st.payDay))}.` : `Your turn: ${monthLong(k)} (${idx - ci === 1 ? 'next month' : 'in ' + (idx - ci) + ' months'}).`;
    }
    const rows = r.map((m, i) => `<li class="ledger-row${m.id === meId ? ' is-me' : ''}"><span class="row-num"><b>${monthShort(keys[i])}</b><small>${keys[i].slice(0, 4)}</small></span><div class="row-main"><span class="name">${esc(m.id === meId ? m.name + ' (you)' : m.name)}${i === ci ? nameTag('This month', true) : ''}</span>${payoutOf(d, keys[i]) ? '<span class="sub">Paid out</span>' : ''}</div><div class="row-end"></div></li>`).join('');
    turn = `<section class="card" aria-label="Payout order"><div class="card-head"><p class="label">Payout order</p><h2>${head}</h2></div></section><ol class="ledger" aria-label="Payout order">${rows}</ol>`;
  }
  return setup + mine + group + meetings + turn;
}

function paintTabs(d) {
  const tabs = $('#tabs');
  if (!tabs.childElementCount) {
    tabs.innerHTML = [['month', 'Month', ICON.month], ['turns', 'Turns', ICON.turns], ['record', 'Record', ICON.record], ['share', 'Share', ICON.share]]
      .map(([id, label, icon]) => `<button type="button" data-tab="${id}"><span class="tab-icon">${icon}</span><span class="tab-label">${label}</span></button>`).join('');
  }
  const t = $('[data-tab="turns"]', tabs);
  $('.tab-label', t).textContent = d.st.kind === 'rotating' ? 'Turns' : 'Fund';
  $('.tab-icon', t).innerHTML = d.st.kind === 'rotating' ? ICON.turns : ICON.fund;
  for (const b of $$('[data-tab]', tabs)) {
    if (b.dataset.tab === S.tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  }
}

function render() {
  const app = $('#app'), bar = $('#tabbar');
  const keep = app.contains(document.activeElement) ? focusTarget(document.activeElement) : null;
  let html, tabs = false;
  const s = S.session;
  if (S.bootError) html = bootErrorHTML();
  else if (!s) html = coverHTML();
  else if (!s.dbReady) html = noDbHTML();
  else if (S.route.name === 'join') html = joinHTML();
  else if (!s.user) html = s.setupNeeded ? setupHTML() : loginHTML();
  else if (S.route.name === 'stokvel') {
    const d = S.d;
    if (S.dError) html = `<header class="page-head"><div class="topbar">${backLink()}</div></header><section class="card"><p class="empty">${esc(S.dError)}</p></section>`;
    else if (!d) html = stokLoadingHTML();
    else if (d.role === 'treasurer') {
      tabs = true;
      let view;
      if (S.tab === 'turns') view = d.st.kind === 'rotating' ? turnsView(d) : fundView(d);
      else if (S.tab === 'record') view = recordView(d);
      else if (S.tab === 'share') view = shareView(d);
      else view = monthView(d);
      html = stokHeader(d) + view;
    } else html = stokHeader(d) + memberView(d);
  } else html = homeHTML();
  app.innerHTML = html;
  bar.hidden = !tabs;
  document.body.classList.toggle('has-tabs', tabs);
  if (tabs) paintTabs(S.d);
  S.justStamped = null;
  if (keep) restoreFocus(keep, app);
}

// Re-rendering replaces the page's buttons. These keep keyboard focus on the same
// control afterwards, or failing that on another control for the same member.
function focusTarget(el) {
  const ds = el && el.dataset;
  if (!ds || !ds.act) return null;
  let sel = '[data-act="' + ds.act + '"]';
  for (const k of ['id', 'k', 'v', 'tone', 'mode']) if (ds[k]) sel += '[data-' + k + '="' + CSS.escape(ds[k]) + '"]';
  return { sel, id: ds.id || '' };
}
function restoreFocus(t, root) {
  let el = $(t.sel, root);
  if ((!el || el.disabled) && t.id) el = $('[data-id="' + CSS.escape(t.id) + '"]', root);
  if (el && !el.disabled) el.focus({ preventScroll: true });
}

/* ---------- sheets and toasts ---------- */
function openSheet(name, renderer) {
  const sh = $('#sheet');
  hideToast();
  if (!S.sheet) { S.lastFocus = document.activeElement; S.lastFocusAt = focusTarget(document.activeElement); }
  sh.innerHTML = `<div class="scrim" data-act="close"></div><div class="sheet-panel" role="dialog" aria-modal="true" aria-labelledby="sheetTitle"><div class="sheet-body">${renderer()}</div></div>`;
  sh.hidden = false;
  S.sheet = name;
  S.sheetRender = renderer;
  setBackground(true);
  requestAnimationFrame(focusSheet);
}
function focusSheet() {
  const sh = $('#sheet');
  const f = sh.querySelector('[data-first]') || sh.querySelector('.sheet-head .icon-btn');
  if (f) f.focus({ preventScroll: true });
}
// While a sheet is open, the page behind it can't be scrolled, tapped or tabbed to.
function setBackground(locked) {
  $('#app').inert = locked;
  $('#tabbar').inert = locked;
  document.documentElement.classList.toggle('is-locked', locked);
}
function refreshSheet() {
  if (!S.sheet || !S.sheetRender) return;
  const body = $('#sheet .sheet-body');
  if (!body) return;
  body.innerHTML = S.sheetRender();
  if (!body.contains(document.activeElement)) focusSheet();
}
function closeSheet(silent) {
  const sh = $('#sheet');
  if (S.draw) { clearInterval(S.draw.timer); S.draw = null; }
  const was = S.sheet;
  S.reg = null; S.memView = null; S.memAsk = null; S.treasAsk = null; S.pay = null;
  sh.hidden = true;
  sh.innerHTML = '';
  S.sheet = null;
  S.sheetRender = null;
  setBackground(false);
  if (!silent) {
    if (S.lastFocus && S.lastFocus.isConnected) S.lastFocus.focus({ preventScroll: true });
    else if (S.lastFocusAt) restoreFocus(S.lastFocusAt, $('#app'));
  }
  return was;
}

// The toast region is always in the page, so screen readers announce each message.
let toastTimer = 0;
function toast(msg, action) {
  const region = $('#toast');
  region.innerHTML = `<div class="toast"><span>${esc(msg)}</span>${action ? '<button type="button" id="toastAct">' + esc(action.label) + '</button>' : ''}</div>`;
  if (action) $('#toastAct').onclick = () => { hideToast(); action.run(); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, action ? 6000 : 3200);
}
function hideToast() { clearTimeout(toastTimer); $('#toast').innerHTML = ''; }
// An Undo belongs to the screen it was offered on.
function dismissUndo() { if ($('#toastAct')) hideToast(); }
{
  // Hold the toast while someone points at it or tabs into it.
  const region = $('#toast');
  const hold = () => clearTimeout(toastTimer);
  const resume = () => { if (region.firstChild) { clearTimeout(toastTimer); toastTimer = setTimeout(hideToast, 2500); } };
  region.addEventListener('pointerenter', hold);
  region.addEventListener('focusin', hold);
  region.addEventListener('pointerleave', resume);
  region.addEventListener('focusout', resume);
}
function formError(id, msg) { const el = $('#' + id); if (!el) return toast(msg); el.textContent = msg; el.hidden = !msg; if (msg) el.scrollIntoView({ block: 'nearest' }); }
function busyButton(id, label) {
  const b = $('#' + id);
  if (!b) return () => {};
  const old = b.textContent;
  b.disabled = true; b.textContent = label;
  return () => { if (b.isConnected) { b.disabled = false; b.textContent = old; } };
}

/* ---------- treasurer actions ---------- */
// Each change names the stokvel it was made in. The book on screen may have been
// reloaded in the meantime (a fresh copy of the same stokvel), so look it up again.
const liveBook = sid => (S.d && S.d.st.id === sid ? S.d : null);
const showing = d => !!d && S.route.name === 'stokvel' && S.d === d;

function setMark(d, k, id, mark) {
  d.marks[k] = Object.assign({}, d.marks[k] || {});
  if (mark) d.marks[k][id] = mark; else delete d.marks[k][id];
}
// change: { status, amount, paidOn, proof }. status null clears the payment (and its proof).
// proof: undefined keeps the saved one, null removes it, { name, type, size, data } replaces it.
async function confirmPay(sid, memberId, month, change) {
  const d = liveBook(sid);
  if (!d) return { ok: false, prev: null };
  const { status, amount, paidOn, proof } = change, prev = markOf(d, month, memberId), stamp = new Date().toISOString();
  setMark(d, month, memberId, status ? {
    status, amount: status === 'part' ? amount : d.st.amount, at: stamp, by: S.session.user.name, paidOn: paidOn || '',
    proof: proof === undefined ? (prev ? prev.proof : null) : proof ? { name: proof.name, type: proof.type, size: proof.size, at: stamp, pending: true } : null,
  } : null);
  if (showing(d)) render();
  bump(1);
  try {
    const r = await api('PUT', `stokvels/${sid}/contributions`, { memberId, month, status: status || null, amount, paidOn, proof });
    const c = r.contribution, now = liveBook(sid);
    const next = c ? { status: c.status, amount: c.amount, at: c.at, by: c.byName, paidOn: c.paidOn || '', proof: c.proof || null } : null;
    if (now) {
      const was = markOf(now, month, memberId);
      setMark(now, month, memberId, next);
      // Skip the repaint when nothing visible changed, so the stamping motion can finish.
      const same = was && next
        ? was.status === next.status && was.amount === next.amount && paidDate(was) === paidDate(next) && !!was.proof === !!next.proof
        : was === next;
      if (!same && showing(now)) render();
    }
    return { ok: true, prev };
  } catch (e) {
    const now = liveBook(sid);
    if (now) { setMark(now, month, memberId, prev); if (showing(now)) render(); }
    handleError(e);
    return { ok: false, prev };
  } finally { bump(-1); }
}
// Undo puts back the amount, date and status. A proof that was removed or replaced stays as it is now.
const undoPay = (sid, memberId, month, prev) => confirmPay(sid, memberId, month, prev
  ? { status: prev.status, amount: prev.amount, paidOn: prev.paidOn || isoDate(new Date(prev.at)) }
  : { status: null });

/* ---------- confirming a payment: amount, date paid, proof ---------- */
function openPay(id) {
  const d = S.d;
  if (!findMember(d, id)) return;
  S.pay = { id, k: selKey(d), proof: undefined, busy: false };
  openSheet('pay', paySheetHTML);
}
function paySheetHTML() {
  const d = S.d, st = d.st, p = S.pay, k = p.k, m = findMember(d, p.id);
  if (!m) return '';
  const mk = markOf(d, k, p.id), due = isoDate(dueDate(k, st.payDay)), today = isoDate(new Date());
  const amount = mk ? paidAmount(st, mk) : st.amount;
  const date = mk ? (validDate(mk.paidOn) ? mk.paidOn : isoDate(new Date(mk.at))) : today;
  const late = mk ? mk.status === 'late' : date > due;
  const at = attOf(d, k, p.id), mt = meetingOf(d, k);
  const meeting = st.meetings ? `<div class="option">
      <span class="option-title">Meeting</span>
      <span class="option-desc">${mt ? 'Register for ' + fmtDay(mt.date) + '. Tap again to clear.' : 'No register yet for ' + monthName(k) + '. This starts one.'}</span>
      <div class="segmented" role="group" aria-label="Meeting attendance">${ATTENDANCE.map(a => `<button type="button" data-act="setatt" data-id="${esc(p.id)}" data-a="${a}" aria-pressed="${at === a}">${ATT_LABEL[a]}</button>`).join('')}</div>
    </div>` : '';
  return `<div class="sheet-head"><div><h2 id="sheetTitle">${esc(m.name)}</h2><p>${monthLong(k)} · ${fmtR(st.amount)} due ${fmtISO(due)}</p></div>${closeBtn}</div>
    <form class="form" id="payForm" data-id="${esc(p.id)}" novalidate>
      <div class="field-row">
        ${field('payAmt', 'Amount paid', `<span class="money-input"><i>R</i><input id="payAmt" inputmode="numeric" autocomplete="off" value="${amount}"></span>`)}
        ${field('payDate', 'Date paid', `<input id="payDate" type="date" value="${date}" max="${today}">`)}
      </div>
      <p class="fineprint" id="payHint">${payHint(amount)}</p>
      <label class="toggle" for="payLate" id="payLateRow"${amount < st.amount ? ' hidden' : ''}><span><b>Paid late</b><small>After the ${fmtISO(due)} due date.${st.lateFine ? ' Adds the ' + fmtR(st.lateFine) + ' late fine.' : ''}</small></span><input type="checkbox" id="payLate"${late ? ' checked' : ''}></label>
      <div class="field"><span class="field-label">Proof of payment <span class="field-optional">optional</span></span><div id="proofBox">${proofBoxHTML()}</div></div>
      <p class="form-error" id="payErr" role="alert" hidden></p>
      <button type="submit" class="btn btn--primary" id="paySubmit" data-first>${mk ? 'Save changes' : 'Confirm payment'}</button>
    </form>
    ${mk ? `<button type="button" class="option option--quiet" data-act="clearPay" data-id="${esc(p.id)}"><span class="option-title">Clear the confirmation</span><span class="option-desc">Back to not paid.${mk.proof ? ' The proof of payment is removed too.' : ''}</span></button>` : ''}
    ${meeting}
    ${mk ? `<p class="fineprint">Confirmed ${fmtTs(mk.at)}${mk.by ? ' by ' + esc(mk.by) : ''}.</p>` : ''}`;
}
function payHint(amount) {
  const st = S.d.st, mon = monthName(S.pay.k);
  if (!(amount > 0)) return 'Enter the amount in rand.';
  if (amount < st.amount) return `Part payment: ${fmtR(st.amount - amount)} still to come for ${mon}.`;
  if (amount > st.amount) return `Counts as ${fmtR(st.amount)} for ${mon}, the most one month takes.`;
  return `Paid in full for ${mon}.`;
}
// Keeps the hint and the "Paid late" switch in step with what is typed.
function syncPayForm(dateChanged) {
  if (!S.pay || !$('#payForm')) return;
  const st = S.d.st, amount = toInt($('#payAmt').value);
  $('#payHint').textContent = payHint(amount);
  $('#payLateRow').hidden = amount < st.amount;
  const date = $('#payDate').value;
  if (dateChanged && validDate(date)) $('#payLate').checked = date > isoDate(dueDate(S.pay.k, st.payDay));
}
function proofBoxHTML() {
  const d = S.d, p = S.pay, mk = markOf(d, p.k, p.id);
  if (p.busy) return `<p class="proof-busy" role="status"><i></i>Preparing the file…</p>`;
  const pr = p.proof === undefined ? (mk && mk.proof) : p.proof;
  if (!pr) return `<label class="file-pick"><input type="file" id="payProof" class="visually-hidden" accept="image/*,application/pdf">${ICON.clip}<span>Add a photo or PDF</span></label>`;
  const fresh = !!(p.proof && p.proof.data);
  const src = fresh ? p.proof.preview : pr.pending ? '' : proofUrl(d.st.id, p.id, p.k, pr);
  const thumb = /^image\//.test(pr.type) && src ? `<img src="${esc(src)}" alt="">` : `<span class="proof-file">${ICON.file}</span>`;
  const view = !fresh && src ? `<a class="btn btn--sm" href="${esc(src)}" target="_blank" rel="noopener">View</a>` : '';
  return `<div class="proof">${thumb}<div class="proof-text"><b>${esc(pr.name || 'Proof of payment')}</b><small>${fmtSize(pr.size || 0)}${fresh ? ' · not saved yet' : ''}</small></div>
    <div class="proof-actions">${view}<button type="button" class="btn btn--sm btn--danger" data-act="proofRemove">Remove</button></div></div>`;
}
function paintProof() { const box = $('#proofBox'); if (box) box.innerHTML = proofBoxHTML(); }

// Proof of payment files: a photo (shrunk to at most 1600px and saved as JPEG) or a PDF, up to 3 MB.
const PROOF_MAX = 3 * 1024 * 1024;
const readDataURL = file => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result));
  r.onerror = () => reject(r.error);
  r.readAsDataURL(file);
});
function photoToJpeg(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.naturalWidth * scale));
      c.height = Math.max(1, Math.round(img.naturalHeight * scale));
      const g = c.getContext('2d');
      g.fillStyle = '#fff';   // transparent screenshots get a white page, not a black one
      g.fillRect(0, 0, c.width, c.height);
      g.drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('unreadable')); };
    img.src = url;
  });
}
async function pickProof(file) {
  const p = S.pay;
  if (!p) return;
  formError('payErr', '');
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  const isImage = /^image\//.test(file.type) || /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name);
  try {
    if (!isPdf && !isImage) throw new Error('Choose a photo or a PDF.');
    if (isPdf && file.size > PROOF_MAX) throw new Error('That PDF is too big. Use one under 3 MB, or a photo of the slip.');
    p.busy = true; paintProof();
    const url = isPdf ? await readDataURL(file) : await photoToJpeg(file);
    const data = url.slice(url.indexOf(',') + 1);
    const size = Math.floor(data.length * 3 / 4) - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0);
    if (size > PROOF_MAX) throw new Error('That file is too big. Use a photo, or a PDF under 3 MB.');
    const name = isPdf ? file.name : (file.name.replace(/\.[^.]*$/, '') || 'proof-of-payment') + '.jpg';
    if (S.pay === p) p.proof = { name, type: isPdf ? 'application/pdf' : 'image/jpeg', size, data, preview: isPdf ? '' : url };
  } catch (e) {
    if (S.pay === p) formError('payErr', e && e.message && e.message !== 'unreadable' ? e.message : 'That photo couldn’t be opened. Try a JPG or PNG, or a PDF.');
  } finally {
    if (S.pay === p) { p.busy = false; paintProof(); }
  }
}
async function savePayment(form) {
  const d = S.d, st = d.st, p = S.pay, id = form.dataset.id, m = findMember(d, id);
  if (!p || !m) return;
  if (p.busy) return formError('payErr', 'Wait a moment: the file is still being prepared.');
  const amt = toInt($('#payAmt').value), date = ($('#payDate').value || '').trim();
  if (!(amt > 0)) return formError('payErr', 'Enter the amount they paid, in rand.');
  if (!validDate(date)) return formError('payErr', 'Pick the date they paid.');
  if (date > isoDate(new Date())) return formError('payErr', 'The payment date can’t be in the future.');
  const full = amt >= st.amount, status = full ? ($('#payLate').checked ? 'late' : 'paid') : 'part';
  const proof = p.proof === undefined ? undefined : p.proof && { name: p.proof.name, type: p.proof.type, size: p.proof.size, data: p.proof.data };
  const sid = st.id, k = p.k;
  closeSheet();
  S.justStamped = k + ':' + id;
  const r = await confirmPay(sid, id, k, { status, amount: full ? undefined : amt, paidOn: date, proof });
  if (r.ok) toast(`Confirmed ${fmtR(full ? st.amount : amt)} from ${m.name}, paid ${fmtISO(date)}`, { label: 'Undo', run: () => undoPay(sid, id, k, r.prev) });
}
async function clearPay(id) {
  const d = S.d, sid = d.st.id, k = S.pay ? S.pay.k : selKey(d), m = findMember(d, id);
  closeSheet();
  if (!m || !markOf(d, k, id)) return;
  const r = await confirmPay(sid, id, k, { status: null });
  if (r.ok) toast('Cleared ' + m.name + '’s confirmation', { label: 'Undo', run: () => undoPay(sid, id, k, r.prev) });
}
async function putMeeting(sid, k, heldOn, attendance, merge) {
  bump(1);
  try {
    const r = await api('PUT', `stokvels/${sid}/meetings/${k}`, { heldOn, attendance, merge });
    const d = liveBook(sid);
    if (d) { d.meetings[k] = { date: r.meeting.heldOn, att: r.meeting.attendance || {} }; if (showing(d)) render(); }
    return true;
  } catch (e) { handleError(e); return false; }
  finally { bump(-1); }
}
async function setAtt(id, a) {
  const d = S.d, sid = d.st.id, k = selKey(d), m = findMember(d, id);
  if (!m) return;
  const prev = attOf(d, k, id), mt = meetingOf(d, k), next = prev === a ? null : a;
  closeSheet();
  const date = mt ? mt.date : defaultMeetDate(d.st, k);
  const ok = await putMeeting(sid, k, date, { [id]: next }, true);
  if (ok) toast(next ? m.name + ': ' + ATT_LABEL[next].toLowerCase() + ' at the meeting' : 'Cleared ' + m.name + '’s meeting mark', { label: 'Undo', run: () => putMeeting(sid, k, date, { [id]: prev }, true) });
}
function registerSheetHTML() {
  const d = S.d, st = d.st, r = S.reg, act = activeIn(st, d.members, r.k), mt = meetingOf(d, r.k);
  const rows = act.map(m => `<li><span class="register-name">${esc(m.name)}</span><div class="segmented segmented--compact" role="group" aria-label="${esc(m.name)}">${ATTENDANCE.map(a => `<button type="button" data-act="regSet" data-id="${esc(m.id)}" data-a="${a}" aria-pressed="${r.att[m.id] === a}">${ATT_LABEL[a]}</button>`).join('')}</div></li>`).join('');
  return `<div class="sheet-head"><div><h2 id="sheetTitle">Meeting register</h2><p>${monthLong(r.k)}. Mark each member, then save.${st.meetFine ? ' Absent without an apology carries the ' + fmtR(st.meetFine) + ' fine.' : ''}</p></div>${closeBtn}</div>
    <div class="register-head">${field('regDate', 'Meeting date', `<input id="regDate" type="date" value="${mt ? mt.date : defaultMeetDate(st, r.k)}">`)}<button type="button" class="btn btn--sm" data-act="regAll">Everyone else present</button></div>
    <ul class="register-list">${rows}</ul>
    <p class="form-error" id="regErr" role="alert" hidden></p>
    <div class="actions actions--end"><button type="button" class="btn" data-act="close">Cancel</button><button type="button" class="btn btn--primary" data-act="regSave" id="regSave">Save register</button></div>`;
}
function paintRegister() {
  for (const b of $$('#sheet [data-act="regSet"]')) b.setAttribute('aria-pressed', String(S.reg.att[b.dataset.id] === b.dataset.a));
}
function openRegister() {
  const d = S.d, k = selKey(d);
  S.reg = { k, att: {} };
  for (const m of activeIn(d.st, d.members, k)) S.reg.att[m.id] = attOf(d, k, m.id);
  openSheet('register', registerSheetHTML);
}
async function saveRegister() {
  const r = S.reg;
  if (!r) return;
  const date = ($('#regDate').value || '').trim();
  if (!DATE_RE.test(date)) { formError('regErr', 'Pick the date of the meeting.'); return; }
  const counts = { present: 0, apology: 0, absent: 0 };
  for (const v of Object.values(r.att)) if (v) counts[v]++;
  const sid = S.d.st.id, k = r.k, att = Object.assign({}, r.att);
  closeSheet();
  if (await putMeeting(sid, k, date, att, false)) toast(`Register saved: ${counts.present} present, ${counts.apology} apology, ${counts.absent} absent`);
}
async function setPayout(sid, k, on) {
  const d0 = liveBook(sid), prev = d0 ? payoutOf(d0, k) : null;
  if (on) S.justStamped = 'po:' + k;
  bump(1);
  try {
    const r = await api('PUT', `stokvels/${sid}/payouts/${k}`, { paid: on });
    const d = liveBook(sid);
    if (d) {
      if (r.payout) d.payouts[k] = { at: r.payout.at, by: r.payout.byName }; else delete d.payouts[k];
      if (showing(d)) render();
    }
    toast(on ? 'Stamped as paid out' : 'Cleared the paid-out stamp', { label: 'Undo', run: () => setPayout(sid, k, !on && !!prev) });
  } catch (e) { handleError(e); }
  finally { bump(-1); }
}
function payoutSheetHTML(k) {
  const po = payoutOf(S.d, k);
  return `<div class="sheet-head"><div><h2 id="sheetTitle">Paid out · ${monthLong(k)}</h2><p>${po ? 'Stamped ' + fmtTs(po.at) + (po.by ? ' by ' + esc(po.by) : '') + '.' : ''}</p></div>${closeBtn}</div>
    <div class="actions actions--end"><button type="button" class="btn" data-act="close" data-first>Keep it</button><button type="button" class="btn btn--danger" data-act="clearPayout" data-k="${k}">Clear the stamp</button></div>`;
}
// Order changes show at once and are saved one after another, so quick taps
// on the arrows can't reach the server out of order.
let orderQueue = Promise.resolve();
async function saveOrder(sid, order, msg) {
  const d = liveBook(sid);
  if (d) { d.st.order = order; if (showing(d)) render(); }
  bump(1);
  const job = orderQueue.then(() => api('PUT', `stokvels/${sid}/order`, { order }));
  orderQueue = job.catch(() => {});
  try {
    await job;
    if (msg) toast(msg);
  } catch (e) {
    handleError(e);
    if (S.dId === sid) loadStokvel(sid, true);   // show what the server has
  } finally { bump(-1); }
}
function moveTurn(id, dir) {
  const d = S.d, st = d.st, ids = rotation(st, d.members).map(m => m.id), first = Math.max(0, monthDiff(st.startMonth, todayKey()) + 1);
  const i = ids.indexOf(id), j = i + dir;
  if (i < first || j < first || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  saveOrder(st.id, ids);
}
function randInt(n) {
  if (window.crypto && crypto.getRandomValues) {
    const u = new Uint32Array(1), lim = Math.floor(0x100000000 / n) * n;
    let x;
    do { crypto.getRandomValues(u); x = u[0]; } while (x >= lim);
    return x % n;
  }
  return Math.floor(Math.random() * n);
}
function fairShuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = randInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function drawSheetHTML() {
  const d = S.d, keys = cycleKeys(d.st, d.members), dr = S.draw, first = dr.fixed.length;
  const nm = new Map(d.members.map(m => [m.id, m.name]));
  const rows = dr.pool.map((id, j) => `<li><span class="draw-month">${monthLong(keys[first + j])}</span><span class="draw-name" id="draw-${j}">${esc(nm.get(id))}</span></li>`).join('');
  return `<div class="sheet-head"><div><h2 id="sheetTitle">Draw lots</h2><p>A fair shuffle of the ${dr.pool.length} turns still to come.${first ? ' Turns that have started stay where they are.' : ''}</p></div>${closeBtn}</div>
    <ol class="draw-list" aria-live="polite">${rows}</ol>
    <div class="actions actions--end"><button type="button" class="btn" data-act="drawAgain" id="drawAgain" disabled>Draw again</button><button type="button" class="btn btn--primary" data-act="drawKeep" id="drawKeep" disabled>Use this order</button></div>`;
}
function openDraw() {
  const d = S.d, r = rotation(d.st, d.members), first = Math.max(0, monthDiff(d.st.startMonth, todayKey()) + 1);
  const pool = r.slice(first);
  if (pool.length < 2) { toast('There are no upcoming turns left to draw.'); return; }
  S.draw = { fixed: r.slice(0, first).map(m => m.id), pool: pool.map(m => m.id), result: null, timer: 0 };
  openSheet('draw', drawSheetHTML);
  runDraw();
}
function runDraw() {
  const dr = S.draw;
  if (!dr) return;
  const nm = new Map(S.d.members.map(m => [m.id, m.name]));
  const slots = dr.pool.map((_, j) => $('#draw-' + j));
  const keep = $('#drawKeep'), again = $('#drawAgain');
  keep.disabled = true; again.disabled = true;
  dr.result = fairShuffle(dr.pool);
  const finish = () => {
    slots.forEach((el, j) => {
      if (!el) return;
      el.textContent = nm.get(dr.result[j]) || '';
      el.classList.remove('is-spinning', 'is-landed'); void el.offsetWidth;
      el.style.animationDelay = (j * 70) + 'ms';
      el.classList.add('is-landed');
    });
    keep.disabled = false; again.disabled = false;
    keep.focus({ preventScroll: true });
  };
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { finish(); return; }
  slots.forEach(el => { if (el) { el.classList.remove('is-landed'); el.classList.add('is-spinning'); } });
  let n = 0;
  clearInterval(dr.timer);
  dr.timer = setInterval(() => {
    slots.forEach(el => { if (el) el.textContent = nm.get(dr.pool[randInt(dr.pool.length)]) || ''; });
    if (++n >= 14) { clearInterval(dr.timer); finish(); }
  }, 75);
}
function keepDraw() {
  const dr = S.draw;
  if (!dr || !dr.result) return;
  const order = dr.fixed.concat(dr.result), sid = S.d.st.id;
  closeSheet();
  saveOrder(sid, order, 'New payout order saved');
}

/* ---------- members, invites and settings ---------- */
const isCurrent = m => !m.left || monthDiff(todayKey(), m.left) > 0;
function membersSheetHTML() {
  const d = S.d, st = d.st, meId = d.me && d.me.memberId;
  const current = roster(st, d.members).filter(isCurrent), former = d.members.filter(m => !isCurrent(m));
  const rows = current.map(m => {
    const isT = m.id === st.treasurerId;
    const status = m.id === meId ? 'You' : m.linked ? 'Joined' + (m.accountName ? ' as ' + esc(m.accountName) : '') : m.inviteExpires ? 'Invite link open until ' + fmtTs(m.inviteExpires) : 'Not joined yet';
    return `<li><button type="button" data-act="memberOpen" data-id="${esc(m.id)}"><span class="name">${esc(m.name)}${isT ? nameTag('Treasurer', true) : m.title ? nameTag(esc(m.title)) : ''}</span><span class="sub${!m.linked && m.id !== meId ? ' text-warn' : ''}">${status}</span><span class="chev" aria-hidden="true">${ICON.right}</span></button></li>`;
  }).join('');
  return `<div class="sheet-head"><div><h2 id="sheetTitle">Members</h2><p>${current.length} ${current.length === 1 ? 'member' : 'members'}. Tap someone to rename them, send their invite link or remove them.</p></div>${closeBtn}</div>
    <ul class="member-rows">${rows}</ul>
    <form class="input-row" id="addForm" novalidate><input id="newMember" placeholder="New member’s name" maxlength="60" autocomplete="off" aria-label="New member’s name"><button type="submit" class="btn btn--primary">Add</button></form>
    <p class="form-error" id="memErr" role="alert" hidden></p>
    <p class="fineprint">${st.kind === 'rotating' ? 'New members start paying this month and take the last turn for the pot.' : 'New members start paying this month.'} Members who join with an invite link can log in and see what they’ve paid.</p>
    ${former.length ? `<div class="field"><h3 class="field-label">Former members</h3><ul class="list">${former.map(m => `<li><span class="name">${esc(m.name)}</span><span class="sub">Left ${monthLong(m.left)}</span><button type="button" class="btn btn--sm" data-act="restore" data-id="${esc(m.id)}">Bring back</button></li>`).join('')}</ul></div>` : ''}`;
}
function memberSheetHTML(id) {
  const d = S.d, st = d.st, m = findMember(d, id);
  if (!m) { S.memView = null; return membersSheetHTML(); }
  const isT = m.id === st.treasurerId, isMe = !!d.me && d.me.memberId === m.id;
  const account = isMe
    ? `<div class="note note--info"><p><b>This is you.</b></p></div>`
    : m.linked
      ? `<div class="note note--info"><p><b>${m.accountName ? 'Joined as ' + esc(stop(m.accountName)) : 'Joined.'}</b> They can log in and see what they’ve paid${isT ? ', and confirm payments' : ''}.</p><button type="button" class="btn btn--sm" data-act="unlink" data-id="${esc(m.id)}">Unlink account</button></div>`
      : `<div class="note"><p><b>Not joined yet.</b> ${m.inviteExpires ? 'Their invite link is open until ' + fmtTs(m.inviteExpires) + '. Make a new one if it got lost.' : 'Send an invite link so they can log in' + (isT ? ' and confirm payments.' : ' and see what they’ve paid.')}</p><button type="button" class="btn btn--primary btn--sm" data-act="invite" data-id="${esc(m.id)}">${ICON.link}${m.inviteExpires ? 'New invite link' : 'Create invite link'}</button></div>`;
  let treas = '';
  if (!isT) {
    if (S.treasAsk === m.id) {
      const ask = isMe
        ? '<b>Make yourself the treasurer?</b> You’ll confirm everyone’s payments from now on.'
        : `<b>Make ${esc(m.name)} the treasurer?</b> ${d.role === 'treasurer' ? 'You’ll stop being able to confirm payments. ' : ''}${esc(firstName(m.name))} ${m.linked ? 'takes over straight away.' : 'takes over once they’ve joined with their invite link.'}`;
      treas = `<div class="confirm-box"><p>${ask}</p><div class="actions actions--end"><button type="button" class="btn btn--sm" data-act="cancelTreasurer" data-first>Cancel</button><button type="button" class="btn btn--sm btn--primary" data-act="doTreasurer" data-id="${esc(m.id)}">Make treasurer</button></div></div>`;
    } else {
      treas = `<button type="button" class="btn" data-act="askTreasurer" data-id="${esc(m.id)}">${isMe ? 'Make me the treasurer' : 'Make ' + esc(firstName(m.name)) + ' the treasurer'}</button>`;
    }
  }
  // Nobody removes themselves: it would take the stokvel off their own home screen.
  let remove = '';
  if (isT) remove = `<p class="fineprint">To remove the treasurer, make someone else treasurer first.</p>`;
  else if (isMe) remove = '';
  else if (S.memAsk === m.id) remove = `<div class="confirm-box"><p><b>Remove ${esc(m.name)}?</b> If they have payments or meetings on record, those stay in the record and they stop paying from this month. Otherwise they’re removed completely.</p><div class="actions actions--end"><button type="button" class="btn btn--sm" data-act="cancelRemove" data-first>Keep</button><button type="button" class="btn btn--sm btn--danger" data-act="doRemove" data-id="${esc(m.id)}">Remove</button></div></div>`;
  else remove = `<button type="button" class="btn btn--danger" data-act="askRemove" data-id="${esc(m.id)}">${ICON.trash}Remove from the stokvel</button>`;
  return `<div class="sheet-head"><div><button type="button" class="back-btn" data-act="membersBack">${ICON.left}Members</button><h2 id="sheetTitle">${esc(m.name)}</h2><p>${isT ? 'Treasurer · confirms payments' : esc(m.title || 'Member')}</p></div>${closeBtn}</div>
    <form class="form" id="memberForm" data-id="${esc(m.id)}" novalidate>
      <div class="field-row">
        ${field('mName', 'Name', `<input id="mName" value="${esc(m.name)}" maxlength="60" autocomplete="off">`)}
        ${field('mTitle', 'Role', `<select id="mTitle"><option value="">Member</option>${TITLES.map(t => `<option${m.title === t ? ' selected' : ''}>${t}</option>`).join('')}</select>`)}
      </div>
      <p class="form-error" id="memErr" role="alert" hidden></p>
      <button type="submit" class="btn" id="memSave">Save changes</button>
    </form>
    ${account}${treas}${remove}`;
}
const membersRenderer = () => S.memView ? memberSheetHTML(S.memView) : membersSheetHTML();
function openMembers(id) {
  S.memView = id || null; S.memAsk = null; S.treasAsk = null;
  if (S.sheet === 'members') refreshSheet(); else openSheet('members', membersRenderer);
}
async function memberCall(method, path, body, okMsg) {
  const d = S.d;
  bump(1);
  try {
    const r = await api(method, `stokvels/${d.st.id}/${path}`, body);
    await loadStokvel(d.st.id, true);
    if (okMsg) toast(okMsg);
    return r || {};
  } catch (e) {
    if (S.sheet === 'members' && e.status !== 401) formError('memErr', e.message); else handleError(e);
    return null;
  } finally { bump(-1); }
}
function inviteSheetHTML(inv) {
  const first = firstName(inv.memberName);
  const msg = inv.isTreasurer
    ? `Hi ${first}, you’re the treasurer of ${inv.stokvelName} on our stokvel app. Open this link to set up your login, then you can confirm everyone’s payments: ${inv.url}`
    : `Hi ${first}, here’s your link to the ${inv.stokvelName} stokvel book. Open it to set up your login and see what you’ve paid: ${inv.url}`;
  return `<div class="sheet-head"><div><h2 id="sheetTitle">Invite ${esc(first)}</h2><p>The link works once and stays open until ${fmtTs(inv.expiresAt)}.</p></div>${closeBtn}</div>
    <pre class="bubble" id="inviteMsg">${esc(msg)}</pre>
    <div class="actions"><button type="button" class="btn" data-act="copy" data-src="inviteMsg" data-first>${ICON.copy}Copy message</button><a class="btn btn--primary" href="${esc(waLink(msg))}" target="_blank" rel="noopener">${ICON.chat}Send on WhatsApp</a></div>
    <p class="fineprint">Only send this to ${esc(first)}. Anyone who has the link can join this stokvel as ${esc(stop(inv.memberName))}</p>`;
}
async function createInvite(id) {
  const d = S.d;
  bump(1);
  try {
    const inv = await api('POST', `stokvels/${d.st.id}/members/${id}/invite`);
    openSheet('invite', () => inviteSheetHTML(inv));
    loadStokvel(d.st.id, true);
  } catch (e) { handleError(e); }
  finally { bump(-1); }
}
function settingsFields(st) {
  const kindOpt = (v, title, desc) => `<label class="choice" for="fKind-${v}"><input type="radio" name="fKind" id="fKind-${v}" value="${v}"${st.kind === v ? ' checked' : ''}><span><b>${title}</b><small>${desc}</small></span></label>`;
  const money = (id, value, placeholder) => `<span class="money-input"><i>R</i><input id="${id}" inputmode="numeric" autocomplete="off" value="${value}"${placeholder ? ` placeholder="${placeholder}"` : ''}></span>`;
  return `${field('fName', 'Stokvel name', `<input id="fName" maxlength="60" autocomplete="off" value="${esc(st.name || '')}" placeholder="Kopanang Savings Club">`)}
    <fieldset class="field choice-group"><legend class="field-label">How it works</legend>${kindOpt('fund', 'Group fund', 'Everyone pays into one fund, to save or invest together.')}${kindOpt('rotating', 'Rotating payout', 'Each month one member takes the whole pot.')}</fieldset>
    <div class="field-row">
      ${field('fAmt', 'Each member pays', money('fAmt', st.amount || '', '500'))}
      ${field('fDay', 'Due on day', `<input id="fDay" inputmode="numeric" autocomplete="off" value="${st.payDay || 25}">`)}
    </div>
    <div class="field-row">
      ${field('fStart', 'First month', `<input id="fStart" type="month" value="${esc(st.startMonth || todayKey())}">`)}
      <label class="field fund-only" for="fMonths"${st.kind === 'fund' ? '' : ' hidden'}><span class="field-label">Months of paying in</span><input id="fMonths" inputmode="numeric" autocomplete="off" value="${st.months || 12}"></label>
    </div>
    ${field('fFine', 'Late fine', money('fFine', st.lateFine || 0))}
    <label class="toggle" for="fMeet"><span><b>We hold meetings</b><small>Take a register each month and see who missed.</small></span><input type="checkbox" id="fMeet"${st.meetings ? ' checked' : ''}></label>
    <label class="field meet-only" for="fMeetFine"${st.meetings ? '' : ' hidden'}><span class="field-label">Missed-meeting fine</span>${money('fMeetFine', st.meetFine || 0)}</label>`;
}
function readSettingsForm() {
  const picked = $('input[name="fKind"]:checked');
  return {
    name: $('#fName').value, kind: picked ? picked.value : 'fund',
    amount: toInt($('#fAmt').value), payDay: toInt($('#fDay').value), startMonth: $('#fStart').value.trim(),
    months: toInt($('#fMonths').value), lateFine: $('#fFine').value.trim() ? toInt($('#fFine').value) : 0,
    meetings: $('#fMeet').checked, meetFine: $('#fMeetFine').value.trim() ? toInt($('#fMeetFine').value) : 0,
  };
}
function settingsSheetHTML() {
  const st = S.d.st;
  return `<div class="sheet-head"><div><h2 id="sheetTitle">Stokvel settings</h2><p>Changes show for everyone in ${esc(st.name)}.</p></div>${closeBtn}</div>
    <form id="settingsForm" class="form" novalidate>
      ${settingsFields(st)}
      <p class="form-error" id="formErr" role="alert" hidden></p>
      <div class="actions actions--end"><button type="button" class="btn" data-act="close">Cancel</button><button type="submit" class="btn btn--primary" id="formSubmit">Save changes</button></div>
    </form>
    <div class="danger-zone"><p><b>Delete this stokvel.</b> This removes its members, payments and meetings for everyone. It can’t be undone. Type the stokvel’s name to confirm.</p>
      <form id="deleteForm" class="input-row" novalidate><input id="delConfirm" placeholder="${esc(st.name)}" autocomplete="off" aria-label="Type the stokvel’s name to confirm"><button type="submit" class="btn btn--danger" id="delSubmit">Delete</button></form>
      <p class="form-error" id="delErr" role="alert" hidden></p></div>`;
}
function createSheetHTML() {
  const u = S.session.user;
  const base = { name: '', kind: 'fund', amount: '', payDay: 25, startMonth: todayKey(), months: 12, lateFine: 0, meetings: true, meetFine: 0 };
  return `<div class="sheet-head"><div><h2 id="sheetTitle">Start a stokvel</h2><p>You can change any of this later, and add or remove members any time.</p></div>${closeBtn}</div>
    <form id="createForm" class="form" novalidate>
      ${settingsFields(base)}
      ${field('fMe', 'Your name in this stokvel', `<input id="fMe" maxlength="60" autocomplete="name" value="${esc(u.name)}">`)}
      ${field('fMembers', 'Other members', '<textarea id="fMembers" rows="6" placeholder="One name per line"></textarea>', 'The order you type is the payout order for a rotating stokvel. You can draw lots for it later.')}
      <label class="field" for="fTreasurer"><span class="field-label">Treasurer</span><select id="fTreasurer"></select><small id="fTreasurerHint">The treasurer confirms everyone’s payments.</small></label>
      <p class="form-error" id="formErr" role="alert" hidden></p>
      <div class="actions actions--end"><button type="button" class="btn" data-act="close">Cancel</button><button type="submit" class="btn btn--primary" id="formSubmit">Create the stokvel</button></div>
    </form>`;
}
function createNames() {
  const me = ($('#fMe') && $('#fMe').value.trim()) || 'Me';
  const others = ($('#fMembers') ? $('#fMembers').value : '').split(/\n|,/).map(s => s.trim().replace(/\s+/g, ' ')).filter(Boolean);
  return { me, others };
}
function paintTreasurerOptions() {
  const sel = $('#fTreasurer');
  if (!sel) return;
  const { me, others } = createNames(), keep = sel.value;
  sel.innerHTML = [`<option value="">${esc(me)} (me)</option>`].concat(others.map(n => `<option value="${esc(n)}">${esc(n)}</option>`)).join('');
  if (keep && others.includes(keep)) sel.value = keep;
  const hint = $('#fTreasurerHint');
  if (hint) hint.textContent = sel.value ? 'You’ll get an invite link to send them. Until they join, you can set things up but nobody can confirm payments.' : 'The treasurer confirms everyone’s payments.';
}
function accountSheetHTML() {
  const u = S.session.user;
  return `<div class="sheet-head"><div><h2 id="sheetTitle">Your account</h2><p>You log in with ${esc(u.phone)}.</p></div>${closeBtn}</div>
    <form id="accountForm" class="form" novalidate>
      ${field('acName', 'Your name', `<input id="acName" value="${esc(u.name)}" maxlength="60" autocomplete="name">`)}
      <p class="form-error" id="acErr" role="alert" hidden></p>
      <button type="submit" class="btn" id="acSave">Save name</button>
    </form>
    <hr class="divider">
    <form id="passwordForm" class="form" novalidate>
      ${passwordField('pwOld', 'Current password', 'current-password')}
      ${passwordField('pwNew', 'New password', 'new-password', 'At least 6 characters. Other devices will be logged out.')}
      <p class="form-error" id="pwErr" role="alert" hidden></p>
      <button type="submit" class="btn" id="pwSave">Change password</button>
    </form>
    <hr class="divider">
    <button type="button" class="btn btn--danger" data-act="logout">Log out</button>`;
}

/* ---------- forms ---------- */
async function submitForm(form) {
  const id = form.id;
  if (id === 'setupForm') {
    const done = busyButton('formSubmit', 'Creating…');
    try {
      const r = await api('POST', 'setup', { code: $('#suCode').value, name: $('#suName').value, phone: $('#suPhone').value, password: $('#suPass').value });
      S.session.user = r.user; S.session.setupNeeded = false;
      go('/', true);
    } catch (e) { done(); formError('formErr', e.message); }
  } else if (id === 'loginForm') {
    const done = busyButton('formSubmit', 'Logging in…');
    try {
      const r = await api('POST', 'login', { phone: $('#liPhone').value, password: $('#liPass').value });
      S.session.user = r.user;
      route();
    } catch (e) { done(); formError('formErr', e.message); }
  } else if (id === 'joinForm') {
    const done = busyButton('formSubmit', 'Joining…');
    const body = S.joinMode === 'new'
      ? { mode: 'new', name: $('#jnName').value, phone: $('#jnPhone').value, password: $('#jnPass').value }
      : { mode: 'login', phone: $('#jnPhone').value, password: $('#jnPass').value };
    try {
      const r = await api('POST', `invites/${S.route.token}/accept`, body);
      S.session = await api('GET', 'session');
      toast('Welcome to ' + S.invite.stokvel.name);
      go('/s/' + r.stokvelId, true);
    } catch (e) {
      done();
      if (e.code === 'already_member') { S.session = await api('GET', 'session').catch(() => S.session); toast(e.message); go('/', true); return; }
      // The number already has an account: switch to logging in, keeping what was typed.
      if (e.code === 'phone_taken') { S.joinMode = 'login'; render(); }
      formError('formErr', e.message);
    }
  } else if (id === 'createForm') {
    const v = readSettingsForm(), { me, others } = createNames();
    if (!(v.amount > 0)) return formError('formErr', 'Enter how much each member pays a month, in rand.');
    const done = busyButton('formSubmit', 'Creating…');
    try {
      const r = await api('POST', 'stokvels', { ...v, myName: me, members: others, treasurerName: $('#fTreasurer').value || '' });
      closeSheet(true);
      go('/s/' + r.id);
      if (r.treasurerInvite) {
        const inv = { ...r.treasurerInvite, stokvelName: v.name.trim(), isTreasurer: true };
        setTimeout(() => openSheet('invite', () => inviteSheetHTML(inv)), 350);
      } else toast('Your stokvel is ready. Add members and send their invite links.');
    } catch (e) { done(); formError('formErr', e.message); }
  } else if (id === 'settingsForm') {
    const v = readSettingsForm();
    const done = busyButton('formSubmit', 'Saving…');
    try {
      await api('PATCH', 'stokvels/' + S.d.st.id, v);
      closeSheet();
      await loadStokvel(S.d.st.id, true);
      toast('Saved');
    } catch (e) { done(); formError('formErr', e.message); }
  } else if (id === 'deleteForm') {
    const name = $('#delConfirm').value;
    if (name.trim().toLowerCase() !== S.d.st.name.trim().toLowerCase()) return formError('delErr', 'Type ' + S.d.st.name + ' exactly to confirm.');
    const done = busyButton('delSubmit', 'Deleting…');
    try {
      await api('DELETE', 'stokvels/' + S.d.st.id, { confirm: name });
      const gone = S.d.st.name;
      closeSheet(true); S.d = null; S.dId = null;
      go('/', true);
      toast('Deleted ' + gone);
    } catch (e) { done(); formError('delErr', e.message); }
  } else if (id === 'addForm') {
    const name = $('#newMember').value.trim();
    if (!name) return formError('memErr', 'Type the new member’s name first.');
    const r = await memberCall('POST', 'members', { name }, 'Added ' + name);
    if (r) { refreshSheet(); const inp = $('#newMember'); if (inp) inp.focus(); }
  } else if (id === 'memberForm') {
    const done = busyButton('memSave', 'Saving…');
    const r = await memberCall('PATCH', 'members/' + form.dataset.id, { name: $('#mName').value, title: $('#mTitle').value }, 'Saved');
    done();
    if (r) refreshSheet();
  } else if (id === 'payForm') {
    await savePayment(form);
  } else if (id === 'accountForm') {
    const done = busyButton('acSave', 'Saving…');
    try {
      const r = await api('PATCH', 'account', { name: $('#acName').value });
      S.session.user = r.user;
      closeSheet(); render(); toast('Saved');
    } catch (e) { done(); if (e.status === 401) handleError(e); else formError('acErr', e.message); }
  } else if (id === 'passwordForm') {
    const done = busyButton('pwSave', 'Changing…');
    try {
      await api('PATCH', 'account', { currentPassword: $('#pwOld').value, newPassword: $('#pwNew').value });
      closeSheet(); toast('Password changed. Other devices have been logged out.');
    } catch (e) { done(); if (e.status === 401) handleError(e); else formError('pwErr', e.message); }
  }
}

function copyFrom(id) {
  const el = $('#' + id);
  if (!el) return;
  const fallback = () => {
    const r = document.createRange(); r.selectNodeContents(el);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    toast('Selected. Use your phone’s Copy to finish.');
  };
  try {
    if (!navigator.clipboard || !navigator.clipboard.writeText) return fallback();
    navigator.clipboard.writeText(el.textContent).then(() => toast('Copied. Paste it in WhatsApp.'), fallback);
  } catch (e) { fallback(); }
}

/* ---------- events ---------- */
document.addEventListener('click', ev => {
  const el = ev.target.closest('[data-act],[data-tab]');
  if (!el || el.disabled) return;
  if (el.tagName === 'A') {
    // Links still open in a new tab or window when asked to; a plain click stays in the app.
    if (ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
    ev.preventDefault();
  }
  if (el.dataset.tab) {
    S.tab = el.dataset.tab;
    store.set('tab', S.tab);
    render();
    window.scrollTo(0, 0);
    return;
  }
  const id = el.dataset.id, d = S.d;
  switch (el.dataset.act) {
    case 'reload': S.session = null; S.bootError = ''; route(); break;
    case 'home': go('/'); break;
    case 'openStokvel': go('/s/' + id); break;
    case 'account': openSheet('account', accountSheetHTML); break;
    case 'logout': {
      // Logging out from an invite stays on the invite, so someone else can join with it.
      const back = S.route.name === 'join' ? location.pathname : '/';
      api('POST', 'logout').catch(() => {}).finally(() => { closeSheet(true); S.session.user = null; S.list = null; S.d = null; S.dId = null; go(back, true); });
      break;
    }
    case 'create': openSheet('create', createSheetHTML); paintTreasurerOptions(); break;
    case 'joinMode': S.joinMode = el.dataset.mode === 'login' ? 'login' : 'new'; render(); break;
    case 'joinAccept': {
      const done = busyButton('formSubmit', 'Joining…');
      api('POST', `invites/${S.route.token}/accept`, {})
        .then(r => { toast('Welcome to ' + S.invite.stokvel.name); go('/s/' + r.stokvelId, true); })
        .catch(e => { done(); formError('formErr', e.message); });
      break;
    }
    case 'close': closeSheet(); break;
    case 'prev': case 'next': {
      const keys = cycleKeys(d.st, d.members), i = keys.indexOf(selKey(d)) + (el.dataset.act === 'next' ? 1 : -1);
      if (keys[i]) { S.monthKey = keys[i]; render(); }
      break;
    }
    case 'goto': S.monthKey = el.dataset.k; S.tab = 'month'; store.set('tab', 'month'); render(); window.scrollTo(0, 0); break;
    case 'pay': openPay(id); break;
    case 'clearPay': clearPay(id); break;
    case 'proofRemove': if (S.pay) { S.pay.proof = null; paintProof(); } break;
    case 'reveal': {
      const input = $('#' + el.dataset.for);
      if (!input) break;
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      el.setAttribute('aria-pressed', String(show));
      el.innerHTML = show ? ICON.eyeOff : ICON.eye;
      break;
    }
    case 'setatt': setAtt(id, el.dataset.a); break;
    case 'register': openRegister(); break;
    case 'regSet': if (S.reg) { S.reg.att[id] = S.reg.att[id] === el.dataset.a ? null : el.dataset.a; paintRegister(); } break;
    case 'regAll': if (S.reg) { for (const k of Object.keys(S.reg.att)) if (!S.reg.att[k]) S.reg.att[k] = 'present'; paintRegister(); } break;
    case 'regSave': saveRegister(); break;
    case 'payout': setPayout(d.st.id, el.dataset.k, true); break;
    case 'payoutSheet': openSheet('payout', () => payoutSheetHTML(el.dataset.k)); break;
    case 'clearPayout': closeSheet(); setPayout(d.st.id, el.dataset.k, false); break;
    case 'up': moveTurn(id, -1); break;
    case 'down': moveTurn(id, 1); break;
    case 'draw': openDraw(); break;
    case 'drawAgain': runDraw(); break;
    case 'drawKeep': keepDraw(); break;
    case 'recView': S.recView = el.dataset.v === 'meet' ? 'meet' : 'pay'; render(); break;
    case 'tone': S.tone = el.dataset.tone; render(); break;
    case 'copy': copyFrom(el.dataset.src); break;
    case 'members': openMembers(); break;
    case 'memberOpen': openMembers(id); break;
    case 'membersBack': S.memView = null; S.memAsk = null; S.treasAsk = null; refreshSheet(); break;
    case 'askRemove': S.memAsk = id; refreshSheet(); break;
    case 'cancelRemove': S.memAsk = null; refreshSheet(); break;
    case 'doRemove': {
      const m = findMember(d, id);
      memberCall('DELETE', 'members/' + id, null, 'Removed ' + (m ? m.name : 'member')).then(r => { if (r) { S.memView = null; S.memAsk = null; refreshSheet(); } });
      break;
    }
    case 'restore': memberCall('PATCH', 'members/' + id, { restore: true }, 'Welcome back').then(r => { if (r) refreshSheet(); }); break;
    case 'unlink': memberCall('DELETE', `members/${id}/link`, null, 'Account unlinked').then(r => { if (r) refreshSheet(); }); break;
    case 'askTreasurer': S.treasAsk = id; refreshSheet(); break;
    case 'cancelTreasurer': S.treasAsk = null; refreshSheet(); break;
    case 'doTreasurer': {
      // Make the invite link first, while this person can still manage the stokvel.
      const m = findMember(d, id);
      if (!m) break;
      const isMe = !!d.me && d.me.memberId === id;
      bump(1);
      (async () => {
        try {
          const inv = m.linked ? null : await api('POST', `stokvels/${d.st.id}/members/${id}/invite`);
          await api('PATCH', 'stokvels/' + d.st.id, { treasurerId: id });
          closeSheet(true);
          await loadStokvel(d.st.id, true);
          if (inv) openSheet('invite', () => inviteSheetHTML({ ...inv, isTreasurer: true }));
          else toast(isMe ? 'You’re now the treasurer' : m.name + ' is now the treasurer');
        } catch (e) { handleError(e); }
        finally { bump(-1); }
      })();
      break;
    }
    case 'invite': createInvite(id); break;
    case 'settings': openSheet('settings', settingsSheetHTML); break;
  }
});
document.addEventListener('submit', async ev => {
  ev.preventDefault();
  const form = ev.target;
  if (form.dataset.busy) return;   // ignore a second Enter while the first is saving
  form.dataset.busy = '1';
  try { await submitForm(form); } finally { delete form.dataset.busy; }
});
document.addEventListener('change', ev => {
  const t = ev.target;
  if (t.name === 'fKind') $$('.fund-only').forEach(e => { e.hidden = t.value !== 'fund'; });
  if (t.id === 'fMeet') $$('.meet-only').forEach(e => { e.hidden = !t.checked; });
  if (t.id === 'fTreasurer') paintTreasurerOptions();
  if (t.id === 'payDate') syncPayForm(true);
  if (t.id === 'payProof' && t.files && t.files[0]) pickProof(t.files[0]);
});
document.addEventListener('input', ev => {
  const t = ev.target;
  if (t.id === 'fMembers' || t.id === 'fMe') paintTreasurerOptions();
  else if (t.id === 'jnName') S.joinDraft.name = t.value;
  else if (t.id === 'jnPhone') S.joinDraft.phone = t.value;
  else if (t.id === 'payAmt') syncPayForm(false);
});
document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && S.sheet) closeSheet(); });

// See other people's changes when coming back to the app.
let lastRefresh = Date.now();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || S.sheet || Date.now() - lastRefresh < 15000) return;
  lastRefresh = Date.now();
  if (S.session && S.session.user) {
    if (S.route.name === 'stokvel' && S.dId) loadStokvel(S.dId, true);
    else if (S.route.name === 'home') loadHome();
  }
});

route();
