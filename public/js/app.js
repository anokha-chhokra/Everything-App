// App shell: loads settings, runs first-time setup, wires the bottom nav and
// hash routing. Home stays mounted (just hidden) so music keeps playing while
// you look at other tabs.

import { $, h, clear, icon, api, app, showError, toast, useBackend } from './lib.js';
import { createHome } from './home.js';
import { mountTasks } from './tasks.js';
import { mountSpend } from './spend.js';
import { mountMusic } from './music.js';
import { mountHabits } from './habits.js';
import { mountJournal } from './journal.js';
import { startReminders } from './reminders.js';
import { mountSettings } from './settings.js';
import { runWizard } from './wizard.js';
import { createBackend, browserStorage } from './core/backend.js';
import { DamagedData, STORAGE_KEY } from './core/store.js';
import { showDamaged } from './damaged.js';

const NAV = [['home', 'Home', 'home'], ['tasks', 'Tasks', 'tasks'], ['habits', 'Habits', 'habits'], ['journal', 'Journal', 'journal'], ['spend', 'Spend', 'spend'], ['music', 'Music', 'music']];
const TITLES = { home: 'Day Hub', tasks: 'Tasks', habits: 'Habits', journal: 'Journal', spend: 'Spending', music: 'Music', settings: 'Settings' };

let home = null;
const views = {};          // route -> {refresh, pause?}
let activeOther = null;
let routeToken = 0;

function routeFromHash() {
  const r = location.hash.replace(/^#\/?/, '').split(/[/?]/)[0];
  return r === 'settings' || NAV.some(([id]) => id === r) ? r : 'home';
}

function drawNav(route) {
  clear($('#nav'), NAV.map(([id, label, ic]) => h('a', {
    href: `#/${id}`, 'aria-current': route === id ? 'page' : null,
  }, h('span', { class: 'pill' }, icon(ic, 24)), label)));
}

function ensureView(route) {
  if (views[route]) return views[route];
  const host = h('div', { id: `view-${route}`, hidden: true });
  $('#v-other').append(host);
  const mount = { tasks: mountTasks, habits: mountHabits, journal: mountJournal, spend: mountSpend, music: mountMusic, settings: mountSettings }[route];
  views[route] = { host, ...mount(host) };
  return views[route];
}

async function show() {
  const route = routeFromHash();
  const mine = ++routeToken;
  app.current = route;
  document.title = TITLES[route] === 'Day Hub' ? 'Day Hub' : `${TITLES[route]} · Day Hub`;
  drawNav(route === 'settings' ? '' : route);

  const homeEl = $('#v-home');
  const otherEl = $('#v-other');
  if (activeOther && views[activeOther] && views[activeOther].pause) views[activeOther].pause();

  if (route === 'home') {
    homeEl.classList.remove('view-away');
    otherEl.hidden = true;
    activeOther = null;
    await home.start();
  } else {
    homeEl.classList.add('view-away'); // hidden, but the iframe stays alive
    otherEl.hidden = false;
    for (const v of Object.values(views)) v.host.hidden = true;
    const view = ensureView(route);
    view.host.hidden = false;
    activeOther = route;
    await view.refresh();
    if (mine !== routeToken) return;
  }
  window.scrollTo(0, 0);
}

// Views call this after they change something.
app.onChange = () => {
  if (home) home.refresh();
  if (activeOther && views[activeOther]) views[activeOther].refresh();
};

async function boot() {
  // Open the data saved in this browser. There is no server to ask.
  const storage = browserStorage();
  try {
    useBackend(createBackend({ storage }));
  } catch (e) {
    if (e instanceof DamagedData) { showDamaged($('#v-home'), e, storage); return; }
    throw e;
  }
  app.volatile = !!storage.volatile;
  if (app.volatile) toast('This browser is blocking storage, so Day Hub will forget everything when you close the tab.', { ms: 8000 });
  // Ask the browser not to clear our data when it is short on space (it may say no).
  try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch { /* optional */ }
  // Another tab of this browser saved something: show it.
  window.addEventListener('storage', (e) => { if (e.key === STORAGE_KEY) app.onChange(); });

  let state;
  try {
    state = await api('/state');
  } catch (e) {
    clear($('#v-home'), h('div', { class: 'page' }, h('h1', null, 'Day Hub'), h('p', { class: 'error' }, e.message),
      h('button', { class: 'btn primary', type: 'button', onClick: () => location.reload() }, 'Try again')));
    return;
  }
  app.settings = state.settings;
  home = createHome($('#v-home'));
  window.addEventListener('hashchange', show);
  startReminders();
  // Refresh when the tab becomes visible again (e.g. phone unlocked).
  document.addEventListener('visibilitychange', () => { if (!document.hidden) app.onChange(); });

  if (!state.setupDone) {
    await show();
    await runWizard({
      onDone: async () => {
        try { app.settings = await api('/settings'); } catch (e) { showError(e); }
        app.go('home');
        show();
      },
    });
  } else {
    await show();
  }
}

boot();
