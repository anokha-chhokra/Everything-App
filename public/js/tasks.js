import { h, clear, icon, api, ymd, showError } from './lib.js';
import { taskRow, openTaskSheet } from './components.js';

export function mountTasks(container) {
  let tab = 'open';
  let token = 0;
  const listHost = h('div');
  const tabs = h('div', { class: 'tabs', role: 'group', 'aria-label': 'Show tasks' });
  clear(container, h('div', { class: 'page' },
    h('div', { class: 'page-head' },
      h('h1', null, 'Tasks'),
      h('button', { class: 'btn primary', type: 'button', onClick: () => openTaskSheet() }, icon('plus', 18), ' Add')),
    tabs,
    h('div', { style: 'height:12px' }),
    listHost));

  function drawTabs() {
    clear(tabs, [['open', 'Open'], ['done', 'Done']].map(([id, label]) => h('button', {
      class: 'tab', type: 'button', 'aria-pressed': tab === id ? 'true' : 'false',
      onClick: () => { tab = id; drawTabs(); refresh(); },
    }, label)));
  }

  function group(title, tasks, today, extraClass = '') {
    if (!tasks.length) return null;
    return h('section', { class: 'tile', style: 'margin-bottom:12px' },
      h('h2', { class: `group-title ${extraClass}` }, title),
      h('ul', { class: 'list' }, tasks.map((t) => taskRow(t, { today, onOpen: openTaskSheet }))));
  }

  async function refresh() {
    const mine = ++token;
    let res;
    try { res = await api(`/tasks?status=${tab}`); } catch (e) { showError(e); return; }
    if (mine !== token) return;
    const today = ymd();
    const tasks = res.tasks;
    if (!tasks.length) {
      clear(listHost, h('div', { class: 'tile' }, h('p', { class: 'empty' },
        tab === 'open' ? [h('strong', null, 'Nothing to do.'), ' Add a task and it shows up here.'] : [h('strong', null, 'Nothing finished yet.')])));
      return;
    }
    if (tab === 'done') {
      clear(listHost, group('Finished', tasks, today));
      return;
    }
    const overdue = tasks.filter((t) => t.dueOn && t.dueOn < today);
    const todays = tasks.filter((t) => t.dueOn === today);
    const later = tasks.filter((t) => t.dueOn && t.dueOn > today);
    const none = tasks.filter((t) => !t.dueOn);
    clear(listHost,
      group('Overdue', overdue, today, 'overdue'),
      group('Today', todays, today),
      group('Upcoming', later, today),
      group('No date', none, today));
  }

  drawTabs();
  return { refresh };
}
