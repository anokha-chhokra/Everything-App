import { h, clear, icon, api, app, showError, toast, ymd, download, openSheet } from './lib.js';
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
    let usage = null;
    try { usage = await api('/storage'); } catch { /* the usage line is optional */ }
    if (mine !== token) return;
    app.settings = settings;
    clear(body, profileTile(settings), reminderTile(settings), dataTile(usage));
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

  function dataTile(usage) {
    const used = usage && !app.volatile ? `Day Hub is using about ${Math.max(1, Math.round(usage.chars / 1024))} KB of the roughly ${Math.round(usage.limitChars / 1024).toLocaleString()} KB this browser allows.` : '';
    const fileInput = h('input', { type: 'file', accept: 'application/json,.json', hidden: true, id: 's-restore',
      onChange: async (e) => {
        const file = e.target.files && e.target.files[0];
        e.target.value = '';
        if (file) await chooseBackup(file);
      } });
    return h('section', { class: 'tile tilt-d' },
      h('h2', null, 'Your data'),
      app.volatile
        ? h('p', { class: 'error' }, 'This browser is blocking storage, so Day Hub will forget everything when you close this tab. Allow site data for this page, or download a backup before you leave.')
        : h('p', { class: 'hint' }, 'Your data is saved only in this browser, on this device. It is never uploaded, so another phone or computer starts empty, and clearing the browser\u2019s site data deletes it. Download a backup now and then. On an iPhone, adding Day Hub to your Home Screen keeps Safari from clearing it.'),
      used && h('p', { class: 'hint' }, used),
      h('div', { class: 'actions' },
        h('button', { class: 'btn', type: 'button', onClick: () => download('/export', 'day-hub-backup.json').catch(showError) }, icon('download', 18), ' Backup (JSON)'),
        h('button', { class: 'btn', type: 'button', onClick: () => document.getElementById('s-restore').click() }, 'Restore from backup'),
        h('button', { class: 'btn', type: 'button', onClick: () => download('/expenses.csv', 'expenses-all.csv').catch(showError) }, icon('download', 18), ' All expenses (CSV)'),
        h('button', { class: 'btn', type: 'button', onClick: () => download(`/export.md?today=${ymd()}`, 'day-hub-journal.md').catch(showError) }, icon('download', 18), ' Journal (Markdown)'),
        h('button', { class: 'btn', type: 'button', onClick: () => runWizard({ onDone: async () => { await refresh(); app.onChange(); } }) }, 'Run setup again')),
      fileInput);
  }

  /** Reads a backup file and asks before replacing what is on this device. */
  async function chooseBackup(file) {
    let data;
    try {
      if (file.size > 50_000_000) throw new Error('too big');
      data = JSON.parse(await file.text());
    } catch {
      toast('That file is not a Day Hub backup.');
      return;
    }
    const count = (k) => (data && Array.isArray(data[k]) ? data[k].length : 0);
    openSheet('Restore from backup', (close) => h('div', { class: 'stack' },
      h('p', null, `This backup has ${count('journal')} journal entries, ${count('tasks')} tasks, ${count('expenses')} expenses and ${count('habits')} habits.`),
      h('p', { class: 'error' }, 'Restoring replaces everything now saved on this device.'),
      h('div', { class: 'actions' },
        h('button', { class: 'btn', type: 'button', onClick: close }, 'Cancel'),
        h('button', { class: 'btn primary', type: 'button', onClick: async () => {
          try {
            await api('/import', { method: 'POST', body: data });
          } catch (err) { showError(err); return; }
          close();
          location.hash = '#/';
          location.reload();
        } }, 'Replace my data'))));
  }

  return { refresh };
}
