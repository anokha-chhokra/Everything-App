// Small helpers shared by every view. No innerHTML anywhere: everything is built
// with the DOM API, so text from feeds or the database can never become markup.

export const $ = (sel, root = document) => root.querySelector(sel);

const SVG_NS = 'http://www.w3.org/2000/svg';

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'value' || key === 'checked' || key === 'disabled' || key === 'selected' || key === 'hidden') el[key] = value;
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === undefined || child === null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

export function clear(el, ...children) {
  el.replaceChildren();
  return append(el, children);
}

const ICONS = {
  home: ['M3 11l9-8 9 8', 'M5 10v10h5v-6h4v6h5V10'],
  tasks: ['M9 6h11', 'M9 12h11', 'M9 18h11', 'M3.5 6l1.5 1.5L7.5 4.5', 'M3.5 12l1.5 1.5L7.5 10.5', 'M3.5 18l1.5 1.5L7.5 16.5'],
  spend: ['M4 7h16v12H4z', 'M4 7l12-3v3', 'M16 13h2'],
  music: ['M9 18V6l10-2v12', 'M9 18a3 3 0 1 1-3-3 3 3 0 0 1 3 3z', 'M19 16a3 3 0 1 1-3-3 3 3 0 0 1 3 3z'],
  gear: ['M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M19 12l2-1-1-3-2 .5-1.5-1.5.5-2-3-1-1 2h-2L9.5 3l-3 1 .5 2L5.5 7.5 3.5 7l-1 3 2 1v2l-2 1 1 3 2-.5L7 18.5l-.5 2 3 1 1-2h2l1 2 3-1-.5-2 1.5-1.5 2 .5 1-3-2-1z'],
  check: ['M4 12.5l5 5L20 5'],
  star: ['M12 3l2.7 5.7 6.3.8-4.6 4.3 1.2 6.2L12 17l-5.6 3 1.2-6.2L3 9.5l6.3-.8z'],
  trash: ['M4 7h16', 'M9 7V4h6v3', 'M6 7l1 13h10l1-13', 'M10 11v6', 'M14 11v6'],
  plus: ['M12 5v14', 'M5 12h14'],
  refresh: ['M20 11a8 8 0 0 0-14-4L4 9', 'M4 4v5h5', 'M4 13a8 8 0 0 0 14 4l2-2', 'M20 20v-5h-5'],
  play: ['M7 4l13 8-13 8z'],
  link: ['M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1', 'M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1'],
  alert: ['M12 3l10 18H2z', 'M12 10v5', 'M12 18v.5'],
  close: ['M5 5l14 14', 'M19 5L5 19'],
  download: ['M12 4v12', 'M7 11l5 5 5-5', 'M5 20h14'],
  back: ['M15 5l-7 7 7 7'],
  habits: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M8 12.5l3 3 5-6'],
  journal: ['M6 3h12v18H6z', 'M9 8h6', 'M9 12h6', 'M9 16h3'],
  edit: ['M4 20h4L19 9l-4-4L4 16z', 'M13 7l4 4'],
  bell: ['M6 16v-5a6 6 0 0 1 12 0v5l2 2H4z', 'M10 21h4'],
  minus: ['M5 12h14'],
  next: ['M9 5l7 7-7 7'],
};

export function icon(name, size = 24, { strokeWidth = 2 } = {}) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', strokeWidth);
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of ICONS[name] || []) {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d);
    svg.append(p);
  }
  return svg;
}

export function squiggle() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 120 8');
  svg.setAttribute('width', 120);
  svg.setAttribute('height', 8);
  svg.setAttribute('class', 'squiggle');
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(SVG_NS, 'path');
  p.setAttribute('d', 'M2 5 Q12 0 22 5 T42 5 T62 5 T82 5 T102 5 T118 4');
  p.setAttribute('fill', 'none');
  p.setAttribute('stroke', '#1B1A17');
  p.setAttribute('stroke-width', '2.5');
  p.setAttribute('stroke-linecap', 'round');
  svg.append(p);
  return svg;
}

// ---------- talking to the server ----------

export async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error('Cannot reach Day Hub. Is it still running?');
  }
  if (res.status === 204) return null;
  let data = null;
  try { data = await res.json(); } catch { /* not JSON */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || `Something went wrong (${res.status})`);
    err.status = res.status;
    err.code = data && data.code;
    // The sign-in expired (or was never there): go back to the login screen.
    if (res.status === 401 && err.code === 'auth' && !path.startsWith('/login')) app.onAuthLost();
    throw err;
  }
  return data;
}

export const MOODS = [
  { v: 1, e: '😞', l: 'Rough' },
  { v: 2, e: '😕', l: 'Low' },
  { v: 3, e: '😐', l: 'Okay' },
  { v: 4, e: '🙂', l: 'Good' },
  { v: 5, e: '😄', l: 'Great' },
];
export const moodEmoji = (v) => (MOODS.find((m) => m.v === v) || {}).e || '';

export const nowHHMM = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** The clock time to record for something done on `day`: now if it is today, otherwise unknown. */
export const timeForDay = (day) => (day === ymd() ? nowHHMM() : null);


// ---------- shared app state ----------

export const app = {
  settings: { name: '', currency: 'INR', monthlyBudgetMinor: 0, currentMusicId: null, notifications: false, journalReminder: '' },
  go: (route) => { location.hash = `#/${route}`; },
  current: 'home',
  onChange: () => {}, // views call this after changing data so Home can refresh
  onAuthLost: () => {}, // set by the shell: show the sign-in screen again
  signIn: 'off',        // 'password' when this copy asks for a password
  hosted: false,        // true when the data lives in hosted storage instead of a local file
};

// ---------- toast ----------

let toastTimer = null;
export function toast(message, { action, onAction, ms = 5000 } = {}) {
  const host = $('#toast');
  clearTimeout(toastTimer);
  const close = () => { host.replaceChildren(); };
  const el = h('div', { class: 'toast' }, h('span', null, message));
  if (action) {
    el.append(h('button', { type: 'button', onClick: () => { close(); onAction && onAction(); } }, action));
  }
  clear(host, el);
  toastTimer = setTimeout(close, action ? ms : 3000);
}

export function celebrate(newBadges) {
  if (newBadges && newBadges.length) {
    toast(`${newBadges.map((b) => `${b.icon} ${b.name}`).join(', ')}: badge unlocked!`, { ms: 5000 });
  }
}

export function showError(err) {
  toast(err && err.message ? err.message : String(err));
}

// ---------- dialog sheet ----------

export function openSheet(title, build) {
  const dlg = $('#dialog');
  const closeSheet = () => { if (dlg.open) dlg.close(); };
  const sheet = h('div', { class: 'sheet' },
    h('div', { class: 'sheet-head' },
      h('h2', null, title),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close', onClick: closeSheet }, icon('close'))));
  sheet.append(build(closeSheet));
  clear(dlg, sheet);
  dlg.onclick = (e) => { if (e.target === dlg) closeSheet(); };
  dlg.onclose = () => { dlg.replaceChildren(); };
  if (!dlg.open) dlg.showModal();
  return closeSheet;
}

// Dialog that cannot be dismissed (first-run wizard).
export function openLocked(build) {
  const dlg = $('#dialog');
  clear(dlg, build(() => { if (dlg.open) dlg.close(); }));
  dlg.onclick = null;
  dlg.oncancel = (e) => e.preventDefault();
  dlg.onclose = () => { dlg.oncancel = null; dlg.replaceChildren(); };
  if (!dlg.open) dlg.showModal();
}

// ---------- formatting ----------

export function ymd(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

export function addDays(ymdStr, days) {
  const [y, m, d] = ymdStr.split('-').map(Number);
  return ymd(new Date(y, m - 1, d + days));
}

export function fromMinor(minor) { return (minor || 0) / 100; }

export function money(minor, currency = app.settings.currency) {
  const value = fromMinor(minor);
  const whole = Number.isInteger(value);
  try {
    return new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : undefined, {
      style: 'currency',
      currency,
      minimumFractionDigits: whole ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

export function currencySymbol(currency = app.settings.currency) {
  try {
    const part = new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : undefined, { style: 'currency', currency })
      .formatToParts(0).find((p) => p.type === 'currency');
    return part ? part.value : currency;
  } catch { return currency; }
}

export function greeting(name) {
  const hr = new Date().getHours();
  const part = hr < 5 ? 'Still up' : hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : hr < 22 ? 'Good evening' : 'Late night';
  return name ? `${part}, ${name}` : part;
}

export function weekdayDate(date = new Date()) {
  return date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
}

export function monthTitle(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

export function shiftMonth(ym, delta) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function shortDate(ymdStr) {
  const [y, m, d] = ymdStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

export function timeAgo(iso) {
  if (!iso) return '';
  const secs = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 90) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  const days = Math.round(hrs / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

export function dueLabel(dueOn, today = ymd()) {
  if (!dueOn) return '';
  if (dueOn === today) return 'Today';
  if (dueOn === addDays(today, 1)) return 'Tomorrow';
  if (dueOn === addDays(today, -1)) return 'Yesterday';
  return shortDate(dueOn);
}

export function safeHref(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch { return null; }
}
