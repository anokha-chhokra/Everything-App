import { h, clear, icon, api, app, showError, toast, ymd } from './lib.js';
import { CURRENCIES, runWizard } from './wizard.js';

export function mountSettings(container) {
  let token = 0;
  const body = h('div', { class: 'stack' });
  clear(container, h('div', { class: 'page' }, h('div', { class: 'page-head' }, h('h1', null, 'Settings')), body));

  async function refresh() {
    const mine = ++token;
    let settings;
    try { settings = await api('/settings'); } catch (e) { showError(e); return; }
    if (mine !== token) return;
    app.settings = settings;
    clear(body, profileTile(settings), reminderTile(settings), dataTile());
  }

  function profileTile(s) {
    const name = h('input', { class: 'input', id: 's-name', value: s.name, maxlength: 40 });
    const cur = h('select', { class: 'input', id: 's-cur' }, (CURRENCIES.some(([c]) => c === s.currency) ? CURRENCIES : [[s.currency, s.currency], ...CURRENCIES])
      .map(([code, label]) => h('option', { value: code, selected: code === s.currency }, label)));
    const budget = h('input', { class: 'input', id: 's-budget', inputmode: 'decimal', placeholder: 'No budget', value: s.monthlyBudgetMinor ? (s.monthlyBudgetMinor / 100).toFixed(s.monthlyBudgetMinor % 100 ? 2 : 0) : '' });
    return h('form', { class: 'tile tilt-a', onSubmit: async (e) => {
      e.preventDefault();
      try {
        app.settings = await api('/settings', { method: 'PUT', body: { name: name.value, currency: cur.value, monthlyBudget: budget.value.trim() } });
        toast('Saved');
        app.onChange();
      } catch (err) { showError(err); }
    } },
      h('h2', null, 'You'),
      h('div', { class: 'field' }, h('label', { for: 's-name' }, 'Name'), name),
      h('div', { class: 'field' }, h('label', { for: 's-cur' }, 'Currency'), cur),
      h('div', { class: 'field' }, h('label', { for: 's-budget' }, 'Monthly budget'), budget),
      h('div', { class: 'actions' }, h('button', { class: 'btn primary', type: 'submit' }, 'Save')));
  }

  function reminderTile(s) {
    const supported = 'Notification' in window;
    const time = h('input', { class: 'input', id: 's-jr', type: 'time', value: s.journalReminder || '' });
    const note = h('p', { class: 'hint' });
    const toggle = h('input', { type: 'checkbox', id: 's-notif', checked: s.notifications && supported && Notification.permission === 'granted', disabled: !supported,
      onChange: async (e) => {
        try {
          if (e.target.checked) {
            const perm = await Notification.requestPermission();
            if (perm !== 'granted') { e.target.checked = false; toast('Notifications are blocked in this browser. Reminders will still show inside the app.'); }
          }
          app.settings = await api('/settings', { method: 'PUT', body: { notifications: e.target.checked } });
        } catch (err) { showError(err); }
      } });
    note.textContent = supported
      ? 'Reminders appear inside Day Hub, and as a system notification if you allow it. They only fire while Day Hub is open in a tab or window.'
      : 'This browser does not support system notifications. Reminders still appear inside the app while it is open.';
    return h('form', { class: 'tile tilt-b', onSubmit: async (e) => {
      e.preventDefault();
      try {
        app.settings = await api('/settings', { method: 'PUT', body: { journalReminder: time.value || '' } });
        toast('Saved');
      } catch (err) { showError(err); }
    } },
      h('h2', null, 'Reminders'),
      h('div', { class: 'field' }, h('label', { for: 's-jr' }, 'Daily journal reminder'), time,
        h('p', { class: 'hint' }, 'Leave empty for none. Habit reminders are set on each habit.')),
      h('label', { class: 'check-row', for: 's-notif' }, toggle, h('span', null, 'Also show system notifications')),
      note,
      h('div', { class: 'actions' }, h('button', { class: 'btn primary', type: 'submit' }, 'Save')));
  }

  function dataTile() {
    return h('section', { class: 'tile tilt-d' },
      h('h2', null, 'Your data'),
      h('p', { class: 'hint' }, app.hosted
        ? 'Your data is kept in the storage you connected to this Vercel project. Nothing is sent anywhere else. Download a backup now and then.'
        : 'Everything lives in a file on the computer running Day Hub. Nothing is sent anywhere.'),
      h('div', { class: 'actions' },
        h('a', { class: 'btn', href: '/api/export', download: 'day-hub-backup.json' }, icon('download', 18), ' Backup (JSON)'),
        h('a', { class: 'btn', href: '/api/expenses.csv', download: 'expenses-all.csv' }, icon('download', 18), ' All expenses (CSV)'),
        h('a', { class: 'btn', href: `/api/export.md?today=${ymd()}`, download: 'day-hub-journal.md' }, icon('download', 18), ' Journal (Markdown)'),
        h('button', { class: 'btn', type: 'button', onClick: () => runWizard({ onDone: async () => { await refresh(); app.onChange(); } }) }, 'Run setup again'),
        app.signIn === 'password' && h('button', { class: 'btn', type: 'button', onClick: signOut }, 'Sign out')));
  }

  async function signOut() {
    try { await api('/logout', { method: 'POST', body: {} }); } catch { /* signing out anyway */ }
    location.reload();
  }

  return { refresh };
}
