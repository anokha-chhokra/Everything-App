import { h, clear, icon, api, ymd, showError } from './lib.js';
import { habitRow, openHabitSheet } from './components.js';

export function mountHabits(container) {
  let token = 0;
  const body = h('div', { class: 'stack' });
  clear(container, h('div', { class: 'page' },
    h('div', { class: 'page-head' },
      h('h1', null, 'Habits'),
      h('button', { class: 'btn primary', type: 'button', onClick: () => openHabitSheet() }, icon('plus', 18), ' Add')),
    body));

  async function refresh() {
    const mine = ++token;
    let habits; let stats;
    try {
      const today = ymd();
      [{ habits }, stats] = await Promise.all([api(`/habits?today=${today}`), api(`/stats?today=${today}`)]);
    } catch (e) { showError(e); return; }
    if (mine !== token) return;

    const today = habits.filter((x) => x.scheduled);
    const other = habits.filter((x) => !x.scheduled);
    const done = today.filter((x) => x.done).length;

    const statTile = h('section', { class: 'tile tilt-a' },
      h('div', { class: 'stats-row' },
        stat(stats.totalPoints, 'points'),
        stat(stats.streak, stats.streak === 1 ? 'day streak' : 'day streak'),
        stat(stats.longestStreak, 'best streak')),
      h('p', { class: 'meta', style: 'margin:8px 0 0' },
        `Today: ${stats.todayPoints >= 0 ? '+' : ''}${stats.todayPoints} points. A day counts for your streak when you finish a habit or write a journal entry.`));

    const todayTile = h('section', { class: 'tile tilt-b' },
      h('div', { class: 'tile-head' }, h('h2', null, 'Today'), today.length ? h('span', { class: 'meta' }, `${done} of ${today.length} done`) : null),
      today.length
        ? h('ul', { class: 'list' }, today.map((x) => habitRow(x, { day: ymd(), onOpen: openHabitSheet })))
        : h('p', { class: 'empty' }, habits.length ? h('strong', null, 'Nothing scheduled today.') : [h('strong', null, 'No habits yet.'), ' Tap Add to start with water, steps, a workout and more.']));

    const otherTile = other.length ? h('section', { class: 'tile tilt-c' },
      h('h2', null, 'Not today'),
      h('ul', { class: 'list' }, other.map((x) => h('li', null, h('div', { class: 'habit-row' },
        h('span', { class: 'habit-icon', 'aria-hidden': 'true' }, x.icon),
        h('div', { class: 'grow' }, h('button', { class: 'task-title-btn', type: 'button', onClick: () => openHabitSheet(x) },
          h('span', { class: 'habit-title' }, x.title), h('span', { class: 'meta' }, scheduleText(x)))))))))
      : null;

    const unlocked = stats.badges.filter((b) => b.unlockedOn).length;
    const badgeTile = h('section', { class: 'tile tilt-d' },
      h('div', { class: 'tile-head' }, h('h2', null, 'Badges'), h('span', { class: 'meta' }, `${unlocked} of ${stats.badges.length}`)),
      h('div', { class: 'badge-grid' }, stats.badges.map((b) => h('div', { class: `badge${b.unlockedOn ? '' : ' locked'}`, title: b.desc },
        h('span', { class: 'ic', 'aria-hidden': 'true' }, b.icon),
        h('span', { class: 'nm' }, b.name),
        h('small', null, b.unlockedOn ? b.unlockedOn : b.desc)))));

    clear(body, statTile, todayTile, otherTile, badgeTile);
  }

  return { refresh };
}

function stat(value, label) {
  return h('div', { class: 'stat' }, h('b', null, value), h('span', null, label));
}

const NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function scheduleText(habit) {
  return habit.days.length === 7 ? 'Every day' : habit.days.map((d) => NAMES[d]).join(', ');
}
