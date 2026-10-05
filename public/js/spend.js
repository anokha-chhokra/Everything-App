import { h, clear, icon, api, app, money, monthTitle, shiftMonth, shortDate, ymd, showError } from './lib.js';
import { openExpenseSheet, deleteExpenseWithUndo, paceText } from './components.js';

export function mountSpend(container) {
  let ym = ymd().slice(0, 7);
  let token = 0;
  const body = h('div', { class: 'stack' });
  const nav = h('div', { class: 'page-head' });
  clear(container, h('div', { class: 'page' },
    h('div', { class: 'page-head' },
      h('h1', null, 'Spending'),
      h('button', { class: 'btn primary', type: 'button', onClick: () => openExpenseSheet() }, icon('plus', 18), ' Add')),
    nav, body));

  function go(delta) {
    const next = shiftMonth(ym, delta);
    if (next > ymd().slice(0, 7)) return; // no future months
    ym = next;
    refresh();
  }

  async function refresh() {
    const mine = ++token;
    let res;
    let pace = null;
    try {
      res = await api(`/expenses?month=${ym}&today=${ymd()}`);
      if (ym === ymd().slice(0, 7)) pace = (await api(`/dashboard?today=${ymd()}`)).spend.pace;
    } catch (e) { showError(e); return; }
    if (mine !== token) return;
    const budget = app.settings.monthlyBudgetMinor || 0;
    const atNow = ym >= ymd().slice(0, 7);

    clear(nav,
      h('button', { class: 'icon-btn round', type: 'button', 'aria-label': 'Previous month', onClick: () => go(-1) }, icon('back')),
      h('h2', null, monthTitle(ym)),
      h('button', { class: 'icon-btn round', type: 'button', 'aria-label': 'Next month', disabled: atNow, onClick: () => go(1) }, icon('next')));

    const pct = budget ? Math.min(100, Math.round((res.totalMinor / budget) * 100)) : 0;
    const over = budget && res.totalMinor > budget;
    const top = Math.max(1, ...res.byCategory.map((c) => c.totalMinor));

    const summary = h('section', { class: 'tile tilt-a' },
      h('p', { class: 'label' }, 'Spent this month'),
      h('p', { class: 'money big' }, money(res.totalMinor)),
      budget
        ? [h('p', { class: 'meta' }, over ? `Over budget by ${money(res.totalMinor - budget)}` : `${money(budget - res.totalMinor)} left of ${money(budget)}`),
          h('div', { class: `bar${over ? ' over' : ''}`, role: 'img', 'aria-label': `${pct}% of budget used` }, h('i', { style: `width:${pct}%` }))]
        : h('p', { class: 'meta' }, 'Set a monthly budget in Settings to see progress.'),
      paceText(pace, app.settings.currency) ? h('p', { class: `meta${pace.status === 'watch' ? ' overdue' : ''}` }, paceText(pace, app.settings.currency)) : null,
      res.byCategory.length
        ? h('div', { style: 'margin-top:12px' }, res.byCategory.map((c) => h('div', { class: 'cat-row' },
          h('span', null, c.category),
          h('span', { class: 'exp-amount' }, money(c.totalMinor)),
          h('div', { class: 'bar' }, h('i', { style: `width:${Math.round((c.totalMinor / top) * 100)}%` })))))
        : null,
      h('div', { class: 'actions' },
        h('a', { class: 'btn', href: `/api/expenses.csv?month=${ym}`, download: `expenses-${ym}.csv` }, icon('download', 18), ' CSV')));

    let list;
    if (!res.expenses.length) {
      list = h('section', { class: 'tile' }, h('p', { class: 'empty' }, h('strong', null, 'No expenses this month.'), ' Tap Add when you spend something.'));
    } else {
      const days = new Map();
      for (const e of res.expenses) {
        if (!days.has(e.spentOn)) days.set(e.spentOn, []);
        days.get(e.spentOn).push(e);
      }
      list = h('section', { class: 'tile tilt-b' }, [...days.entries()].map(([day, rows]) => h('div', null,
        h('h3', { class: 'group-title' }, shortDate(day)),
        h('ul', { class: 'list' }, rows.map((e) => h('li', null, h('div', { class: 'exp-row' },
          h('div', { class: 'grow' }, h('div', null, e.note || e.category), e.note ? h('div', { class: 'meta' }, e.category) : null),
          h('span', { class: 'exp-amount' }, money(e.amountMinor)),
          h('button', { class: 'icon-btn', type: 'button', 'aria-label': `Delete ${e.note || e.category} ${money(e.amountMinor)}`, onClick: () => deleteExpenseWithUndo(e) }, icon('trash', 22)))))))));
    }
    clear(body, summary, list);
  }

  return { refresh };
}
