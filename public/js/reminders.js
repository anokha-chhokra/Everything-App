// Reminders while Day Hub is open: a toast always, plus a system notification
// if the person turned notifications on. A web page cannot wake itself up when
// the tab is closed, so this only fires while the app is open somewhere.

import { api, app, toast, ymd, nowHHMM } from './lib.js';

const fired = new Set(); // "day|key" so each reminder fires once a day

export function startReminders() {
  check();
  setInterval(check, 20_000);
}

async function check() {
  const now = nowHHMM();
  const day = ymd();
  const s = app.settings;
  const due = [];

  if (s.journalReminder && s.journalReminder <= now && !fired.has(`${day}|journal`)) {
    due.push({ key: 'journal', title: 'Time to write', body: 'Take a minute for today\'s journal entry.' });
  }
  let habits;
  try { habits = (await api(`/habits?today=${day}`)).habits; } catch { return; }
  for (const hb of habits) {
    if (hb.scheduled && hb.remindAt && hb.remindAt <= now && !hb.done && !fired.has(`${day}|h${hb.id}`)) {
      due.push({ key: `h${hb.id}`, title: `${hb.icon} ${hb.title}`, body: 'Reminder from Day Hub' });
    }
  }
  for (const d of due) {
    fired.add(`${day}|${d.key}`);
    toast(`${d.title}`, { ms: 8000 });
    if (s.notifications && 'Notification' in window && Notification.permission === 'granted') {
      try { new Notification(d.title, { body: d.body, icon: '/icon.svg' }); } catch { /* some browsers block constructors */ }
    }
  }
}
