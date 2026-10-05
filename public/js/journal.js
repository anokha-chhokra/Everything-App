import { h, clear, icon, api, nowHHMM, ymd, addDays, money, monthTitle, shiftMonth, shortDate, moodEmoji, showError } from './lib.js';
import { openEntrySheet, openExpenseSheet, openHabitSheet, habitRow, logHabit } from './components.js';

export function mountJournal(container) {
  let tab = 'day';
  let day = ymd();
  let ym = day.slice(0, 7);
  let token = 0;
  const tabs = h('div', { class: 'tabs', role: 'group', 'aria-label': 'Journal view' });
  const nav = h('div', { class: 'page-head', style: 'margin-top:12px' });
  const body = h('div', { class: 'stack' });
  clear(container, h('div', { class: 'page' },
    h('div', { class: 'page-head' },
      h('h1', null, 'Journal'),
      h('button', { class: 'btn primary', type: 'button', onClick: () => openEntrySheet({ day: tab === 'day' ? day : ymd() }) }, icon('plus', 18), ' Write')),
    tabs, nav, body));

  function drawTabs() {
    clear(tabs, [['day', 'Day'], ['calendar', 'Calendar'], ['entries', 'Entries']].map(([id, label]) => h('button', {
      class: 'tab', type: 'button', 'aria-pressed': tab === id ? 'true' : 'false',
      onClick: () => { tab = id; if (id !== 'day') ym = day.slice(0, 7); drawTabs(); refresh(); },
    }, label)));
  }

  function goMonth(delta) {
    const next = shiftMonth(ym, delta);
    if (next > ymd().slice(0, 7)) return;
    ym = next; refresh();
  }
  function goDay(delta) {
    const next = addDays(day, delta);
    if (next > ymd()) return;
    day = next; refresh();
  }
  function openDay(d) { day = d; tab = 'day'; drawTabs(); refresh(); }

  function drawNav() {
    if (tab === 'day') {
      const today = ymd();
      const label = day === today ? 'Today' : day === addDays(today, -1) ? 'Yesterday' : shortDate(day);
      clear(nav,
        h('button', { class: 'icon-btn round', type: 'button', 'aria-label': 'Previous day', onClick: () => goDay(-1) }, icon('back')),
        h('h2', { 'aria-live': 'polite' }, label, label === shortDate(day) ? null : h('span', { class: 'meta', style: 'display:block;font-size:14px' }, shortDate(day))),
        h('button', { class: 'icon-btn round', type: 'button', 'aria-label': 'Next day', disabled: day >= today, onClick: () => goDay(1) }, icon('next')));
      return;
    }
    const atNow = ym >= ymd().slice(0, 7);
    clear(nav,
      h('button', { class: 'icon-btn round', type: 'button', 'aria-label': 'Previous month', onClick: () => goMonth(-1) }, icon('back')),
      h('h2', null, monthTitle(ym)),
      h('button', { class: 'icon-btn round', type: 'button', 'aria-label': 'Next month', disabled: atNow, onClick: () => goMonth(1) }, icon('next')));
  }

  function entryBlock(e) {
    return h('div', { class: 'entry' }, h('button', { class: 'entry-open', type: 'button', onClick: () => openEntrySheet({ entry: e, day: e.day }), 'aria-label': 'Edit entry' },
      h('div', { class: 'entry-head' },
        e.mood ? h('span', { class: 'entry-mood', 'aria-hidden': 'true' }, moodEmoji(e.mood)) : null,
        h('span', { class: 'meta' }, [e.time || '', e.wordCount ? ` · ${e.wordCount} words` : ''])),
      e.text ? h('p', { class: 'entry-text' }, e.text) : h('p', { class: 'meta' }, 'Mood check-in'),
      e.tags.length ? h('div', { class: 'entry-tags' }, e.tags.map((t) => `#${t} `)) : null));
  }

  function dayGroups(entries) {
    const days = new Map();
    for (const e of entries) {
      if (!days.has(e.day)) days.set(e.day, []);
      days.get(e.day).push(e);
    }
    return [...days.entries()].map(([d, rows]) => h('div', null,
      h('h3', { class: 'group-title' }, shortDate(d)),
      h('ul', { class: 'list' }, rows.map((e) => h('li', null, entryBlock(e))))));
  }

  /* ---------- Day timeline ---------- */

  function timelineRow(item) {
    const time = h('span', { class: 'tl-time' }, item.time || '·');
    let card;
    if (item.type === 'entry') {
      card = h('div', { class: 'tl-card tl-entry' }, entryBlock(item.entry));
    } else if (item.type === 'habit') {
      const hb = item.habit;
      const pending = !!item.pending;
      const missed = pending && item.missed;
      const pts = hb.pointsToday;
      const done = !pending && (hb.done || hb.value > 0);
      card = h('div', { class: `tl-card tl-habit${pending ? ' pending' : ''}${missed ? ' missed' : ''}` },
        hb.kind === 'check' ? h('button', {
          class: 'check', type: 'button', role: 'checkbox', 'aria-checked': done ? 'true' : 'false',
          'aria-label': `${done ? 'Undo' : 'Done'}: ${hb.title}`,
          onClick: () => logHabit(hb, day, done ? 0 : 1),
        }, h('span', { class: 'box' }, done ? icon('check', 18, { strokeWidth: 3 }) : null)) : null,
        h('span', { class: 'habit-icon', 'aria-hidden': 'true' }, hb.icon),
        h('button', { class: 'task-title-btn grow', type: 'button', onClick: () => openHabitSheet(hb) },
          h('span', { class: 'habit-title' }, hb.title),
          h('span', { class: `meta${missed ? ' overdue' : ''}` }, pending ? (missed ? `not done · planned for ${item.time}` : 'planned') : [
            hb.kind === 'check' ? 'done' : `${hb.value}${hb.unit ? ' ' + hb.unit : ''}`,
            pts ? h('span', { class: `pts${pts < 0 ? ' neg' : ''}` }, ` · ${pts > 0 ? '+' : ''}${pts} pts`) : null])));
    } else if (item.type === 'expense') {
      const x = item.expense;
      card = h('div', { class: 'tl-card tl-expense' },
        h('span', { class: 'habit-icon', 'aria-hidden': 'true' }, '💸'),
        h('div', { class: 'grow' },
          h('span', { class: 'habit-title' }, `${money(x.amountMinor)} · ${x.category}`),
          h('span', { class: 'meta' }, [x.note || '', x.entryId ? (x.note ? ' · ' : '') + 'from your journal' : ''])));
    } else {
      card = h('div', { class: 'tl-card tl-task' },
        h('span', { class: 'habit-icon', 'aria-hidden': 'true' }, '✓'),
        h('div', { class: 'grow' }, h('span', { class: 'habit-title' }, item.task.title), h('span', { class: 'meta' }, 'task finished')));
    }
    return h('li', { class: `tl-row tl-${item.type}` }, time, h('span', { class: 'tl-dot', 'aria-hidden': 'true' }), card);
  }

  // Light headings (Morning, Afternoon…) between the rows, only when the day spans more than one part.
  function groupByPart(items) {
    const parts = new Set(items.map((it) => it.part || 'No time'));
    const rows = [];
    let last = null;
    for (const it of items) {
      const part = it.part || 'No time';
      if (parts.size > 1 && part !== last) rows.push(h('li', { class: 'tl-part', 'aria-hidden': 'true' }, part));
      last = part;
      rows.push(timelineRow(it));
    }
    return rows;
  }

  function drawDay(tlData) {
    const s = tlData.summary;
    const stat = (value, label) => h('div', { class: 'stat' }, h('b', { style: String(value).length > 5 ? 'font-size:24px;line-height:1.4' : null }, value), h('span', null, label));
    const parts = [
      h('section', { class: 'tile tilt-a' },
        h('div', { class: 'stats-row' },
          stat(`${s.points > 0 ? '+' : ''}${s.points}`, 'points'),
          stat(s.habitsScheduled ? `${s.habitsDone}/${s.habitsScheduled}` : '–', 'habits'),
          stat(s.entries, s.entries === 1 ? 'entry' : 'entries'),
          stat(s.spentMinor ? money(s.spentMinor) : '–', 'spent')),
        s.missed ? h('p', { class: 'meta overdue', style: 'margin:8px 0 0' }, `${s.missed} planned habit${s.missed === 1 ? ' was' : 's were'} not done.`) : null)];

    if (tlData.goals.length) {
      parts.push(h('section', { class: 'tile tilt-b' },
        h('div', { class: 'tile-head' }, h('h2', null, 'Limits & goals')),
        h('ul', { class: 'list' }, tlData.goals.map((g) => habitRow(g, { day, onOpen: openHabitSheet })))));
    }
    if (tlData.anytime.length) {
      parts.push(h('section', { class: 'tile tilt-a' },
        h('div', { class: 'tile-head' }, h('h2', null, 'Anytime today')),
        h('ul', { class: 'list' }, tlData.anytime.map((g) => habitRow(g, { day, onOpen: openHabitSheet })))));
    }

    const actions = h('div', { class: 'actions' },
      h('button', { class: 'btn primary', type: 'button', onClick: () => openEntrySheet({ day }) }, icon('plus', 18), ' Write entry'),
      h('button', { class: 'btn', type: 'button', onClick: () => openExpenseSheet({ day }) }, icon('plus', 18), ' Expense'));

    parts.push(h('section', { class: 'tile tilt-b' },
      h('div', { class: 'tile-head' }, h('h2', null, 'Timeline')),
      tlData.items.length
        ? h('ol', { class: 'tl' }, groupByPart(tlData.items))
        : h('p', { class: 'empty' }, h('strong', null, 'Nothing logged yet.'), day === ymd() ? ' Write a line, tick a habit, or add an expense and it lands here with the time.' : ' Nothing was recorded for this day.'),
      actions));
    clear(body, parts);
  }

  /* ---------- Month views ---------- */

  function drawCalendar(res, cal) {
    const [y, m] = ym.split('-').map(Number);
    const first = new Date(y, m - 1, 1).getDay();
    const count = new Date(y, m, 0).getDate();
    const today = ymd();
    const cells = [];
    for (const n of ['S', 'M', 'T', 'W', 'T', 'F', 'S']) cells.push(h('div', { class: 'dow' }, n));
    for (let i = 0; i < first; i++) cells.push(h('div'));
    for (let d = 1; d <= count; d++) {
      const dd = `${ym}-${String(d).padStart(2, '0')}`;
      const info = cal.days[dd];
      const future = dd > today;
      const pct = info && info.habitsScheduled ? Math.round((info.habitsDone / info.habitsScheduled) * 100) : 0;
      cells.push(h('button', {
        class: `cal-day${dd === today ? ' today' : ''}${dd === day ? ' sel' : ''}`, type: 'button', disabled: future,
        'aria-label': `Open ${shortDate(dd)}${info && info.entries ? `, ${info.entries} entries` : ''}`,
        onClick: () => openDay(dd),
      },
        h('span', { class: 'n' }, d),
        h('span', { class: 'dots' }, info && info.entries ? (info.mood ? moodEmoji(info.mood) : '•') : ' '),
        info && info.habitsScheduled ? h('span', { class: 'mini' }, h('i', { style: `width:${pct}%` })) : null));
    }
    clear(body, h('section', { class: 'tile tilt-a' }, h('div', { class: 'cal' }, cells),
      h('p', { class: 'meta', style: 'margin:8px 0 0' }, 'Tap a day to open its timeline. The emoji is the day’s average mood; the bar shows habits finished.')));
  }

  async function refresh() {
    const mine = ++token;
    drawNav();
    try {
      if (tab === 'day') {
        const data = await api(`/timeline?day=${day}&today=${ymd()}&now=${nowHHMM()}`);
        if (mine === token) drawDay(data);
        return;
      }
      const res = await api(`/journal?month=${ym}`);
      const cal = tab === 'calendar' ? await api(`/calendar?month=${ym}`) : null;
      if (mine !== token) return;
      if (tab === 'calendar') { drawCalendar(res, cal); return; }
      clear(body, res.entries.length
        ? h('section', { class: 'tile tilt-a' }, dayGroups(res.entries))
        : h('section', { class: 'tile' }, h('p', { class: 'empty' }, h('strong', null, 'No entries this month.'), ' Tap Write. A one-line mood check-in is enough.')));
    } catch (e) { showError(e); }
  }

  // Leaving the Journal resets it, so coming back (or tapping "Open journal" on Home) lands on today.
  function pause() { tab = 'day'; day = ymd(); ym = day.slice(0, 7); drawTabs(); }

  drawTabs();
  return { refresh, pause };
}
