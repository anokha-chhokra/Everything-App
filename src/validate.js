// Small input-validation helpers. Everything user-supplied goes through these.

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const bad = (message) => new HttpError(400, message);

export function obj(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw bad('Expected a JSON object');
  }
  return value;
}

/** Trimmed text with control characters removed. Empty -> null when optional. */
export function str(value, field, { max = 200, optional = false } = {}) {
  if (value === undefined || value === null) {
    if (optional) return null;
    throw bad(`${field} is required`);
  }
  if (typeof value !== 'string') throw bad(`${field} must be text`);
  // eslint-disable-next-line no-control-regex
  const s = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  if (!s) {
    if (optional) return null;
    throw bad(`${field} is required`);
  }
  if (s.length > max) throw bad(`${field} is too long (max ${max} characters)`);
  return s;
}

export function isoDate(value, field, { optional = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (optional) return null;
    throw bad(`${field} is required`);
  }
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw bad(`${field} must look like 2026-10-05`);
  }
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    throw bad(`${field} is not a real date`);
  }
  return value;
}

export function month(value, field = 'month') {
  if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
    throw bad(`${field} must look like 2026-10`);
  }
  return value;
}

/** "123.45" or 123.45 -> 12345 (integer minor units). No float rounding surprises. */
export function moneyToMinor(value, field, { allowZero = false, max = 1_000_000_000 } = {}) {
  let s;
  if (typeof value === 'number' && Number.isFinite(value)) s = String(value);
  else if (typeof value === 'string') s = value.trim().replace(/,/g, '');
  else throw bad(`${field} must be a number`);
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw bad(`${field} must be a positive amount with up to 2 decimals`);
  const [whole, frac = ''] = s.split('.');
  const minor = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  if (!allowZero && minor <= 0) throw bad(`${field} must be greater than zero`);
  if (minor > max * 100) throw bad(`${field} is too large`);
  return minor;
}

export function oneOf(value, list, field, fallback) {
  if (value === undefined || value === null || value === '') {
    if (fallback !== undefined) return fallback;
    throw bad(`${field} is required`);
  }
  if (!list.includes(value)) throw bad(`${field} must be one of: ${list.join(', ')}`);
  return value;
}

export function currency(value) {
  const code = str(value, 'currency', { max: 3 }).toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) throw bad('currency must be a 3-letter code like INR');
  try {
    new Intl.NumberFormat('en', { style: 'currency', currency: code });
  } catch {
    throw bad(`Unknown currency code ${code}`);
  }
  return code;
}

export function id(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw bad('Invalid id');
  return n;
}

export function localDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** The client's "today" when it sends a valid one, otherwise the server's local date. */
export function todayOf(candidate) {
  try {
    return isoDate(candidate, 'today');
  } catch {
    return localDate();
  }
}

export function monthRange(ym) {
  const [y, m] = ym.split('-').map(Number);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  return [`${ym}-01`, `${next}-01`];
}

/** Whole number within [min, max]. Optional -> fallback when missing. */
export function int(value, field, { min = 0, max = 1_000_000, fallback } = {}) {
  if (value === undefined || value === null || value === '') {
    if (fallback !== undefined) return fallback;
    throw bad(`${field} is required`);
  }
  const n = typeof value === 'string' && /^-?\d+$/.test(value.trim()) ? Number(value) : value;
  if (!Number.isInteger(n) || n < min || n > max) throw bad(`${field} must be a whole number from ${min} to ${max}`);
  return n;
}

/** "07:30" style time, or null when empty. */
export function hhmm(value, field = 'time') {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw bad(`${field} must look like 07:30`);
  return value;
}

/** Weekday list like [0,1,2,3,4,5,6] (0 = Sunday). */
export function weekdays(value) {
  if (value === undefined || value === null) return [0, 1, 2, 3, 4, 5, 6];
  if (!Array.isArray(value) || !value.length) throw bad('Pick at least one day');
  const out = [...new Set(value.map((d) => int(d, 'day', { min: 0, max: 6 })))].sort();
  return out;
}

/** Up to 8 short lowercase tags. */
export function tags(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw bad('tags must be a list');
  const out = [];
  for (const raw of value) {
    if (typeof raw !== 'string') throw bad('tags must be text');
    // eslint-disable-next-line no-control-regex
    const t = raw.replace(/[\u0000-\u001f\u007f#]/g, ' ').trim().toLowerCase();
    if (!t) continue;
    if (t.length > 24) throw bad('each tag must be 24 characters or fewer');
    if (!out.includes(t)) out.push(t);
  }
  if (out.length > 8) throw bad('at most 8 tags');
  return out;
}
