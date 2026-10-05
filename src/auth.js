// A single shared password for the whole app. It exists because a copy of Day Hub on
// Vercel is reachable by anyone who knows the address, and it holds a private journal.
//
// Sign-in sets a signed cookie (httpOnly, SameSite=Lax) that lasts 30 days. The cookie
// holds an expiry time and a signature, nothing else, so there is no session table to store.
// Changing the password signs every device out.

import crypto from 'node:crypto';

const COOKIE = 'dh_session';
const MAX_AGE_S = 30 * 24 * 60 * 60;
const MAX_FAILS = 8;
const FAIL_WINDOW_MS = 15 * 60 * 1000;

const sha256 = (text) => crypto.createHash('sha256').update(String(text)).digest();
const b64url = (buf) => Buffer.from(buf).toString('base64url');

function sameText(a, b) {
  return crypto.timingSafeEqual(sha256(a), sha256(b));
}

export function createAuth(config, { now = () => Date.now() } = {}) {
  const password = String(config.password || '');
  const enabled = password.length > 0;
  // On a public host, no password means "do not show anything", never "show everything".
  const misconfigured = !enabled && !!config.requireAuth;
  const key = crypto.createHmac('sha256', config.sessionSecret || 'dayhub-session').update(sha256(password)).digest();
  const fails = new Map(); // best effort only: each server instance counts for itself

  const sign = (expires) => b64url(crypto.createHmac('sha256', key).update(`v1.${expires}`).digest());

  function readCookie(req) {
    for (const part of String(req.headers.cookie || '').split(';')) {
      const at = part.indexOf('=');
      if (at !== -1 && part.slice(0, at).trim() === COOKIE) return part.slice(at + 1).trim();
    }
    return '';
  }

  function signedIn(req) {
    if (!enabled) return !misconfigured;
    const token = readCookie(req);
    const m = /^v1\.(\d{10,14})\.([A-Za-z0-9_-]{43})$/.exec(token);
    if (!m) return false;
    if (Number(m[1]) <= now()) return false;
    const want = sign(m[1]);
    return want.length === m[2].length && crypto.timingSafeEqual(Buffer.from(want), Buffer.from(m[2]));
  }

  const cookieFlags = () => `Path=/; HttpOnly; SameSite=Lax${config.secureCookies ? '; Secure' : ''}`;

  function clientKey(req) {
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    return forwarded || (req.socket && req.socket.remoteAddress) || 'unknown';
  }

  /**
   * Returns { ok: true, cookie } or { ok: false, tooMany: boolean }.
   * Wrong guesses are counted per address; too many in a row are refused for a while.
   */
  function login(req, attempt) {
    if (!enabled) return { ok: false, tooMany: false };
    const who = clientKey(req);
    const t = now();
    const record = fails.get(who);
    if (record && record.until > t) return { ok: false, tooMany: true };
    if (typeof attempt === 'string' && sameText(attempt, password)) {
      fails.delete(who);
      const expires = t + MAX_AGE_S * 1000;
      return { ok: true, cookie: `${COOKIE}=v1.${expires}.${sign(expires)}; Max-Age=${MAX_AGE_S}; ${cookieFlags()}` };
    }
    const count = (record && record.resetAt > t ? record.count : 0) + 1;
    fails.set(who, { count, resetAt: t + FAIL_WINDOW_MS, until: count >= MAX_FAILS ? t + FAIL_WINDOW_MS : 0 });
    if (fails.size > 500) for (const [k, v] of fails) if (v.resetAt <= t) fails.delete(k);
    return { ok: false, tooMany: count >= MAX_FAILS };
  }

  const logoutCookie = () => `${COOKIE}=; Max-Age=0; ${cookieFlags()}`;

  return { enabled, misconfigured, signedIn, login, logoutCookie };
}
