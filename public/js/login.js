// The sign-in screen (shown only when the app has a password) and the
// "finish setting up" screen for a hosted copy that has no password yet.

import { $, h, clear, api, squiggle } from './lib.js';

/** Resolves once the password is accepted. */
export function showLogin(host) {
  $('#nav').style.display = 'none'; // the tab bar has nothing to offer before you are in
  return new Promise((resolve) => {
    const pw = h('input', { class: 'input', id: 'login-pw', type: 'password', autocomplete: 'current-password', required: true, maxlength: 200 });
    const msg = h('p', { class: 'error', role: 'alert' });
    const go = h('button', { class: 'btn primary', type: 'submit' }, 'Open Day Hub');
    const form = h('form', { class: 'tile tilt-a', onSubmit: async (e) => {
      e.preventDefault();
      go.disabled = true;
      msg.textContent = '';
      try {
        await api('/login', { method: 'POST', body: { password: pw.value } });
        $('#nav').style.display = '';
        resolve();
      } catch (err) {
        msg.textContent = err.message;
        go.disabled = false;
        pw.select();
      }
    } },
      h('h2', null, 'Welcome back'),
      h('div', { class: 'field' }, h('label', { for: 'login-pw' }, 'Password'), pw),
      msg,
      h('div', { class: 'actions' }, go));
    clear(host, h('div', { class: 'page login' }, h('h1', null, 'Day Hub'), squiggle(), form));
    pw.focus();
  });
}

/** A hosted copy with no password refuses to show anything; this says how to fix it. */
export function showSetupNeeded(host) {
  $('#nav').style.display = 'none';
  clear(host, h('div', { class: 'page login' },
    h('h1', null, 'Day Hub'), squiggle(),
    h('section', { class: 'tile tilt-a' },
      h('h2', null, 'One more step'),
      h('p', null, 'This copy of Day Hub is online, so it needs a password before it will show anything.'),
      h('ol', null,
        h('li', null, 'In Vercel, open this project, then Settings, then Environment Variables.'),
        h('li', null, 'Add DAYHUB_PASSWORD with the password you want.'),
        h('li', null, 'Redeploy, then reload this page.')))));
}
