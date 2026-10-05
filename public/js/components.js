// Pieces used by more than one view: task rows and the add/edit sheets.

import { h, clear, icon, api, app, toast, showError, openSheet, ymd, dueLabel, currencySymbol, addDays, money, MOODS, nowHHMM, timeForDay, celebrate } from './lib.js';

export const CATEGORIES = ['Food', 'Transport', 'Bills', 'Shopping', 'Health', 'Fun', 'Other'];

// ---------- tasks ----------

export async function setTaskDone(task, done) {
  try {
    await api(`/tasks/${task.id}`, { method: 'PATCH', body: { done, today: ymd(), time: nowHHMM() } });
    app.onChange();
  } catch (e) { showError(e); app.onChange(); }
}

export async function toggleStar(task) {
  try {
    await api(`/tasks/${task.id}`, { method: 'PATCH', body: { priority: task.priority ? 0 : 1 } });
    app.onChange();
  } catch (e) { showError(e); }
}

export async function deleteTaskWithUndo(task) {
  try {
    await api(`/tasks/${task.id}`, { method: 'DELETE' });
    app.onChange();
    toast('Task deleted', {
      action: 'Undo',
      onAction: async () => {
        try {
          const back = await api('/tasks', { method: 'POST', body: { title: task.title, dueOn: task.dueOn, priority: task.priority } });
          if (task.done) await api(`/tasks/${back.id}`, { method: 'PATCH', body: { done: true, today: task.doneOn || ymd() } });
          app.onChange();
        } catch (e) { showError(e); }
      },
    });
  } catch (e) { showError(e); }
}

/** One line in a task list. `compact` is the Home tile version. */
export function taskRow(task, { today = ymd(), compact = false, onOpen } = {}) {
  const overdue = !task.done && task.dueOn && task.dueOn < today;
  const label = task.dueOn ? dueLabel(task.dueOn, today) : '';
  const box = h('span', { class: 'box' }, task.done ? icon('check', 18, { strokeWidth: 3 }) : null);
  const row = h('li', null,
    h('div', { class: 'task-row' },
      h('button', {
        class: 'check', type: 'button', role: 'checkbox', 'aria-checked': task.done ? 'true' : 'false',
        'aria-label': `${task.done ? 'Mark not done' : 'Mark done'}: ${task.title}`,
        onClick: () => setTaskDone(task, !task.done),
      }, box),
      h('div', { class: 'grow' },
        h('button', { class: 'task-title-btn', type: 'button', onClick: () => onOpen && onOpen(task) },
          h('span', { class: `task-title${task.done ? ' done' : ''}` }, task.title),
          label ? h('span', { class: `meta${overdue ? ' overdue' : ''}` }, overdue ? `Overdue · ${label}` : label) : null)),
      compact
        ? (task.priority ? h('span', { class: 'attn-icon', title: 'Starred' }, icon('star', 20)) : null)
        : [
          h('button', {
            class: 'icon-btn', type: 'button', 'aria-pressed': task.priority ? 'true' : 'false',
            'aria-label': task.priority ? `Unstar ${task.title}` : `Star ${task.title}`,
            onClick: () => toggleStar(task),
          }, icon('star', 22)),
          h('button', { class: 'icon-btn', type: 'button', 'aria-label': `Delete ${task.title}`, onClick: () => deleteTaskWithUndo(task) }, icon('trash', 22)),
        ]));
  return row;
}

export function openTaskSheet(task) {
  const editing = !!task;
  openSheet(editing ? 'Edit task' : 'New task', (close) => {
    const title = h('input', { class: 'input', id: 'f-title', maxlength: 200, required: true, value: editing ? task.title : '', autocomplete: 'off' });
    const due = h('input', { class: 'input', id: 'f-due', type: 'date', value: editing ? task.dueOn || '' : '' });
    const star = h('input', { type: 'checkbox', id: 'f-star', checked: editing ? !!task.priority : false });
    const error = h('p', { class: 'error', role: 'alert', hidden: true });

    const quick = (text, days) => h('button', {
      class: 'btn', type: 'button',
      onClick: () => { due.value = days === null ? '' : addDays(ymd(), days); },
    }, text);

    const form = h('form', {
      onSubmit: async (e) => {
        e.preventDefault();
        error.hidden = true;
        const body = { title: title.value, dueOn: due.value || null, priority: star.checked ? 1 : 0 };
        try {
          if (editing) await api(`/tasks/${task.id}`, { method: 'PATCH', body });
          else await api('/tasks', { method: 'POST', body });
          close();
          app.onChange();
        } catch (err) { error.textContent = err.message; error.hidden = false; }
      },
    },
      h('div', { class: 'field' }, h('label', { for: 'f-title' }, 'What needs doing?'), title),
      h('div', { class: 'field' }, h('label', { for: 'f-due' }, 'When?'), due,
        h('div', { class: 'actions' }, quick('Today', 0), quick('Tomorrow', 1), quick('No date', null))),
      h('label', { class: 'check-row', for: 'f-star' }, star, h('span', null, 'Star it (shows first)')),
      error,
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary grow', type: 'submit' }, editing ? 'Save' : 'Add task'),
        editing ? h('button', { class: 'btn danger', type: 'button', onClick: () => { close(); deleteTaskWithUndo(task); } }, 'Delete') : null));
    setTimeout(() => title.focus(), 30);
    return form;
  });
}

// ---------- expenses ----------

export async function deleteExpenseWithUndo(exp) {
  try {
    await api(`/expenses/${exp.id}`, { method: 'DELETE' });
    app.onChange();
    toast('Expense deleted', {
      action: 'Undo',
      onAction: async () => {
        try {
          await api('/expenses', { method: 'POST', body: { amount: (exp.amountMinor / 100).toFixed(2), category: exp.category, note: exp.note, spentOn: exp.spentOn, time: exp.time } });
          app.onChange();
        } catch (e) { showError(e); }
      },
    });
  } catch (e) { showError(e); }
}

export function openExpenseSheet({ day = ymd() } = {}) {
  openSheet('Add expense', (close) => {
    const amount = h('input', { class: 'input', id: 'e-amount', inputmode: 'decimal', placeholder: '0', required: true, autocomplete: 'off' });
    const category = h('select', { class: 'input', id: 'e-cat' }, CATEGORIES.map((c) => h('option', { value: c }, c)));
    const note = h('input', { class: 'input', id: 'e-note', maxlength: 120, placeholder: 'Optional', autocomplete: 'off' });
    const date = h('input', { class: 'input', id: 'e-date', type: 'date', value: day });
    const time = h('input', { class: 'input', id: 'e-time', type: 'time', value: timeForDay(day) || '' });
    // Moving the date to another day clears the time (we don't know it); back to today fills it in.
    date.addEventListener('change', () => { time.value = timeForDay(date.value) || ''; });
    const error = h('p', { class: 'error', role: 'alert', hidden: true });

    const form = h('form', {
      onSubmit: async (e) => {
        e.preventDefault();
        error.hidden = true;
        try {
          await api('/expenses', { method: 'POST', body: { amount: amount.value, category: category.value, note: note.value, spentOn: date.value || ymd(), time: time.value || null } });
          close();
          toast('Expense added');
          app.onChange();
        } catch (err) { error.textContent = err.message; error.hidden = false; }
      },
    },
      h('div', { class: 'field' }, h('label', { for: 'e-amount' }, `Amount (${currencySymbol()})`), amount),
      h('div', { class: 'field' }, h('label', { for: 'e-cat' }, 'Category'), category),
      h('div', { class: 'field' }, h('label', { for: 'e-note' }, 'Note'), note),
      h('div', { class: 'field-row' },
        h('div', { class: 'field' }, h('label', { for: 'e-date' }, 'Date'), date),
        h('div', { class: 'field' }, h('label', { for: 'e-time' }, 'Time (optional)'), time)),
      error,
      h('div', { class: 'actions' }, h('button', { class: 'btn primary grow', type: 'submit' }, 'Add expense')));
    setTimeout(() => amount.focus(), 30);
    return form;
  });
}

// ---------- habits ----------

const DAY_NAMES = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const KIND_LABELS = { check: 'Daily check', goal: 'Goal (count up)', limit: 'Limit (stay under)' };

export async function logHabit(habit, day, value) {
  try {
    const res = await api(`/habits/${habit.id}/log`, { method: 'PUT', body: { day, value: Math.max(0, value), today: ymd(), time: timeForDay(day) } });
    celebrate(res.newBadges);
    app.onChange();
  } catch (e) { showError(e); app.onChange(); }
}

export function habitDetail(habit) {
  if (habit.kind === 'goal') return `${habit.value} / ${habit.target} ${habit.unit}`.trim();
  if (habit.kind === 'limit') return `${habit.value} (max ${habit.target} ${habit.unit})`.trim();
  return habit.remindAt ? `Reminder ${habit.remindAt}` : '';
}

/** One habit with its controls. Calls onOpen(habit) when the title is tapped. */
export function habitRow(habit, { day = ymd(), onOpen } = {}) {
  const over = habit.kind === 'limit' && habit.value > habit.target;
  const detail = habitDetail(habit);
  const pts = habit.pointsToday;
  let control;
  if (habit.kind === 'check') {
    control = h('button', {
      class: 'check', type: 'button', role: 'checkbox', 'aria-checked': habit.done ? 'true' : 'false',
      'aria-label': `${habit.done ? 'Undo' : 'Done'}: ${habit.title}`,
      onClick: () => logHabit(habit, day, habit.done ? 0 : 1),
    }, h('span', { class: 'box' }, habit.done ? icon('check', 18, { strokeWidth: 3 }) : null));
  } else {
    control = h('div', { class: 'stepper' },
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': `Less ${habit.title}`, disabled: habit.value <= 0, onClick: () => logHabit(habit, day, habit.value - habit.step) }, icon('minus', 22)),
      h('span', { class: 'val', 'aria-live': 'polite' }, habit.value),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': `More ${habit.title}`, onClick: () => logHabit(habit, day, habit.value + habit.step) }, icon('plus', 22)));
  }
  const pct = habit.kind === 'goal' ? Math.min(100, Math.round((habit.value / habit.target) * 100))
    : habit.kind === 'limit' ? Math.min(100, Math.round((habit.value / habit.target) * 100)) : 0;
  return h('li', null, h('div', { class: 'habit-row' },
    habit.kind === 'check' ? control : null,
    h('span', { class: 'habit-icon', 'aria-hidden': 'true' }, habit.icon),
    h('div', { class: 'grow' },
      h('button', { class: 'task-title-btn', type: 'button', onClick: () => onOpen && onOpen(habit) },
        h('span', { class: `habit-title${habit.kind === 'check' && habit.done ? ' task-title done' : ''}` }, habit.title),
        h('span', { class: `meta${over ? ' overdue' : ''}` },
          [detail, pts ? h('span', { class: `pts${pts < 0 ? ' neg' : ''}` }, `${detail ? ' · ' : ''}${pts > 0 ? '+' : ''}${pts} pts`) : null])),
      habit.kind === 'check' ? null : h('div', { class: `bar${over ? ' over' : ''}`, role: 'img', 'aria-label': `${pct}%` }, h('i', { style: `width:${pct}%` }))),
    habit.kind === 'check' ? null : control));
}

export function openHabitSheet(habit) {
  const editing = !!habit;
  openSheet(editing ? 'Edit habit' : 'New habit', (close) => {
    const st = {
      kind: editing ? habit.kind : 'check',
      days: new Set(editing ? habit.days : [0, 1, 2, 3, 4, 5, 6]),
    };
    const title = h('input', { class: 'input', id: 'h-title', maxlength: 60, required: true, autocomplete: 'off', value: editing ? habit.title : '' });
    const icn = h('input', { class: 'input', id: 'h-icon', maxlength: 8, value: editing ? habit.icon : '📌', 'aria-label': 'Icon (emoji)' });
    const kind = h('select', { class: 'input', id: 'h-kind', onChange: (e) => { st.kind = e.target.value; syncKind(); } },
      Object.entries(KIND_LABELS).map(([v, l]) => h('option', { value: v, selected: v === st.kind }, l)));
    const target = h('input', { class: 'input', id: 'h-target', inputmode: 'numeric', value: editing ? habit.target : 8 });
    const unit = h('input', { class: 'input', id: 'h-unit', maxlength: 20, placeholder: 'glasses, steps, cups…', value: editing ? habit.unit : '' });
    const step = h('input', { class: 'input', id: 'h-step', inputmode: 'numeric', value: editing ? habit.step : 1 });
    const points = h('input', { class: 'input', id: 'h-points', inputmode: 'numeric', value: editing ? habit.points : 10 });
    const remind = h('input', { class: 'input', id: 'h-remind', type: 'time', value: editing ? habit.remindAt || '' : '' });
    const error = h('p', { class: 'error', role: 'alert', hidden: true });
    const targetBox = h('div', null,
      h('div', { class: 'field' }, h('label', { for: 'h-target' }, 'Target per day'), target),
      h('div', { class: 'row2' },
        h('div', { class: 'grow' }, h('div', { class: 'field', style: 'width:100%' }, h('label', { for: 'h-unit' }, 'Unit'), unit)),
        h('div', { class: 'grow' }, h('div', { class: 'field', style: 'width:100%' }, h('label', { for: 'h-step' }, 'Each tap adds'), step))));
    const syncKind = () => { targetBox.hidden = st.kind === 'check'; };
    syncKind();

    const dayRow = h('div', { class: 'day-chips', role: 'group', 'aria-label': 'Days' });
    const drawDays = () => clear(dayRow, DAY_NAMES.map((n, i) => h('button', {
      class: 'chip', type: 'button', 'aria-pressed': st.days.has(i) ? 'true' : 'false',
      onClick: () => { if (st.days.has(i)) { if (st.days.size > 1) st.days.delete(i); } else st.days.add(i); drawDays(); },
    }, n)));
    drawDays();

    let presetBox = null;
    if (!editing) {
      presetBox = h('div', { class: 'field' }, h('span', { class: 'label' }, 'Start from'), h('div', { class: 'chips', id: 'preset-chips' }));
      api('/habits/presets').then(({ presets }) => {
        const host = presetBox.querySelector('.chips');
        clear(host, presets.map((p) => h('button', {
          class: 'chip', type: 'button',
          onClick: () => {
            title.value = p.title; icn.value = p.icon; st.kind = p.kind; kind.value = p.kind;
            target.value = p.target; unit.value = p.unit; step.value = p.step; points.value = p.points; syncKind();
          },
        }, `${p.icon} ${p.title}`)));
      }).catch(() => {});
    }

    let armed = false;
    const form = h('form', {
      onSubmit: async (e) => {
        e.preventDefault();
        error.hidden = true;
        const body = {
          title: title.value, icon: icn.value, kind: st.kind, target: target.value, unit: unit.value, step: step.value,
          points: points.value, days: [...st.days].sort(), remindAt: remind.value || null, today: ymd(),
        };
        try {
          if (editing) await api(`/habits/${habit.id}`, { method: 'PATCH', body });
          else await api('/habits', { method: 'POST', body });
          close();
          app.onChange();
        } catch (err) { error.textContent = err.message; error.hidden = false; }
      },
    },
      presetBox,
      h('div', { class: 'field' }, h('label', { for: 'h-title' }, 'Name'), h('div', { class: 'inline-form' }, h('div', { style: 'width:72px;flex:none' }, icn), title)),
      h('div', { class: 'field' }, h('label', { for: 'h-kind' }, 'Type'), kind),
      targetBox,
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'Repeats on'), dayRow),
      h('div', { class: 'row2' },
        h('div', { class: 'grow' }, h('div', { class: 'field', style: 'width:100%' }, h('label', { for: 'h-points' }, 'Points'), points)),
        h('div', { class: 'grow' }, h('div', { class: 'field', style: 'width:100%' }, h('label', { for: 'h-remind' }, 'Reminder'), remind))),
      error,
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary grow', type: 'submit' }, editing ? 'Save' : 'Add habit'),
        editing ? h('button', {
          class: 'btn danger', type: 'button',
          onClick: async (ev) => {
            if (!armed) { armed = true; ev.currentTarget.textContent = 'Tap again to delete'; return; }
            try { await api(`/habits/${habit.id}`, { method: 'DELETE' }); close(); toast('Habit deleted. Your points and streak are kept.'); app.onChange(); } catch (err) { showError(err); }
          },
        }, 'Delete') : null));
    setTimeout(() => title.focus(), 30);
    return form;
  });
}

// ---------- journal ----------

const whenLabel = (n) => (n === 0 ? '' : n === 1 ? ' · yesterday' : ` · ${n} days earlier`);

/**
 * "Looks like spending" box shared by the entry sheet and the quick note on Home.
 * Call schedule(text) as the user types; selected() gives the ticked suggestions
 * in the shape the journal API expects.
 */
export function createExpenseDetector({ getDay, entryId } = {}) {
  const host = h('div');
  let items = [];
  let skipped = new Set();
  let timer = null;
  let token = 0;

  function draw() {
    clear(host, items.length ? h('div', { class: 'detect-box' },
      h('span', { class: 'label' }, 'Looks like spending'),
      items.map((x) => h('label', { class: 'check-row' },
        h('input', { type: 'checkbox', checked: !skipped.has(x.key), onChange: (e) => { if (e.target.checked) skipped.delete(x.key); else skipped.add(x.key); } }),
        h('span', null, `Add as expense: ${money(x.amountMinor)} · ${x.category}${x.note ? ` · ${x.note}` : ''}${whenLabel(x.daysAgo || 0)}`)))) : null);
  }

  function schedule(text) {
    clearTimeout(timer);
    const mine = ++token;
    if (!text.trim()) { items = []; skipped = new Set(); draw(); return; }
    timer = setTimeout(async () => {
      try {
        const res = await api('/expenses/detect', { method: 'POST', body: { text, day: getDay ? getDay() : ymd(), entryId } });
        if (mine !== token) return; // a newer keystroke is already on its way
        items = res.items.map((x) => ({ ...x, key: `${x.amountMinor}|${x.note}|${x.daysAgo || 0}` }));
        skipped = new Set([...skipped].filter((k) => items.some((x) => x.key === k)));
        draw();
      } catch { /* detection is a bonus; ignore failures */ }
    }, 450);
  }

  function reset() { clearTimeout(timer); token += 1; items = []; skipped = new Set(); draw(); }
  function selected() {
    return items.filter((x) => !skipped.has(x.key))
      .map((x) => ({ amount: (x.amountMinor / 100).toFixed(2), category: x.category, note: x.note, daysAgo: x.daysAgo || 0 }));
  }
  return { host, schedule, reset, selected };
}

export function openEntrySheet({ entry = null, day = ymd(), draft = null } = {}) {
  const editing = !!entry;
  openSheet(editing ? 'Edit entry' : 'New entry', (close) => {
    const st = {
      mood: editing ? entry.mood : (draft ? draft.mood ?? null : null),
      promptId: null,
      tags: new Set(editing ? entry.tags : []),
    };
    const detector = createExpenseDetector({ getDay: () => dayInput.value || day, entryId: editing ? entry.id : undefined });
    let prompts = [];
    let suggestions = [];
    let todayPrompt = null;

    const dayInput = h('input', { class: 'input', id: 'j-day', type: 'date', value: editing ? entry.day : day, max: ymd() });
    const timeInput = h('input', { class: 'input', id: 'j-time', type: 'time', value: editing ? (entry.time || '') : (timeForDay(day) || '') });
    // Changing the date of a new entry: today gets the clock time, any other day starts with no time.
    dayInput.addEventListener('change', () => { if (!editing) timeInput.value = timeForDay(dayInput.value) || ''; });
    const text = h('textarea', { class: 'input textarea', id: 'j-text', maxlength: 10000, placeholder: 'Write anything. Even one line counts.', value: editing ? entry.text : (draft ? draft.text || '' : '') });
    const error = h('p', { class: 'error', role: 'alert', hidden: true });
    const promptHost = h('div');
    const moodHost = h('div', { class: 'mood-row', role: 'group', 'aria-label': 'Mood' });
    const tagHost = h('div', { class: 'chips' });
    const tagInput = h('input', { class: 'input', id: 'j-tag', maxlength: 24, placeholder: 'Add a tag, press Enter', autocomplete: 'off', onKeydown: (e) => {
      if (e.key === 'Enter') { e.preventDefault(); addTag(); }
    } });

    function addTag() {
      const t = tagInput.value.trim().toLowerCase().replace(/^#/, '');
      if (t && st.tags.size < 8) st.tags.add(t);
      tagInput.value = '';
      drawTags();
    }
    function drawMood() {
      clear(moodHost, MOODS.map((m) => h('button', {
        class: 'mood-btn', type: 'button', 'aria-pressed': st.mood === m.v ? 'true' : 'false', 'aria-label': m.l,
        onClick: () => { st.mood = st.mood === m.v ? null : m.v; drawMood(); },
      }, m.e)));
    }
    function drawTags() {
      const all = [...new Set([...suggestions, ...st.tags])];
      clear(tagHost, all.map((t) => h('button', {
        class: 'chip', type: 'button', 'aria-pressed': st.tags.has(t) ? 'true' : 'false',
        onClick: () => { if (st.tags.has(t)) st.tags.delete(t); else if (st.tags.size < 8) st.tags.add(t); drawTags(); },
      }, `#${t}`)));
    }
    function drawPrompt() {
      if (editing) { clear(promptHost); return; }
      const chosen = prompts.find((p) => p.id === st.promptId);
      text.placeholder = chosen ? chosen.text : 'Write anything. Even one line counts.';
      clear(promptHost,
        h('div', { class: 'chips', style: 'margin-bottom:8px', role: 'group', 'aria-label': 'Prompt' },
          h('button', { class: 'chip', type: 'button', 'aria-pressed': st.promptId ? 'false' : 'true', onClick: () => { st.promptId = null; drawPrompt(); } }, 'Free write'),
          prompts.map((p) => h('button', { class: 'chip', type: 'button', 'aria-pressed': st.promptId === p.id ? 'true' : 'false', onClick: () => { st.promptId = p.id; drawPrompt(); } }, p.title))),
        chosen ? h('div', { class: 'prompt-card' }, h('span', { class: 'label' }, chosen.title), chosen.text) : null);
    }
    text.addEventListener('input', () => detector.schedule(text.value));
    if (draft && draft.text) detector.schedule(text.value);

    drawMood(); drawTags();
    api(`/prompts?today=${ymd()}`).then((res) => {
      prompts = res.prompts; suggestions = res.tags; todayPrompt = res.today;
      if (!editing && day === ymd()) st.promptId = todayPrompt.id;
      drawPrompt(); drawTags();
    }).catch(() => {});

    let armed = false;
    const form = h('form', {
      onSubmit: async (e) => {
        e.preventDefault();
        error.hidden = true;
        try {
          let res;
          const expenses = detector.selected();
          const when = { day: dayInput.value || day, time: timeInput.value || null };
          if (editing) {
            res = await api(`/journal/${entry.id}`, { method: 'PATCH', body: { text: text.value, mood: st.mood, tags: [...st.tags], ...when, expenses, today: ymd() } });
          } else {
            res = await api('/journal', { method: 'POST', body: { ...when, text: text.value, mood: st.mood, tags: [...st.tags], promptId: st.promptId, expenses, today: ymd() } });
          }
          close();
          const added = res.expenses ? res.expenses.length : 0;
          toast(added ? `Saved. ${added} expense${added > 1 ? 's' : ''} added too.` : 'Saved');
          celebrate(res.newBadges);
          app.onChange();
        } catch (err) { error.textContent = err.message; error.hidden = false; }
      },
    },
      promptHost,
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'How are you?'), moodHost),
      h('div', { class: 'field' }, h('label', { for: 'j-text' }, 'Entry'), text),
      detector.host,
      h('div', { class: 'field' }, h('label', { for: 'j-tag' }, 'Tags'), tagHost, tagInput),
      h('div', { class: 'field-row' },
        h('div', { class: 'field' }, h('label', { for: 'j-day' }, 'Day'), dayInput),
        h('div', { class: 'field' }, h('label', { for: 'j-time' }, 'Time'), timeInput)),
      error,
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary grow', type: 'submit' }, editing ? 'Save' : 'Save entry'),
        editing ? h('button', {
          class: 'btn danger', type: 'button',
          onClick: async (ev) => {
            if (!armed) { armed = true; ev.currentTarget.textContent = 'Tap again to delete'; return; }
            try { await api(`/journal/${entry.id}`, { method: 'DELETE' }); close(); toast('Entry deleted'); app.onChange(); } catch (err) { showError(err); }
          },
        }, 'Delete') : null));
    setTimeout(() => text.focus(), 30);
    return form;
  });
}

/** One plain sentence about how the month's spending is going. */
export function paceText(pace, cur) {
  if (!pace || pace.status === 'none' || pace.status === 'over') return '';
  const parts = [];
  if (pace.perDayLeftMinor !== null && pace.daysLeft > 0) parts.push(`About ${money(pace.perDayLeftMinor, cur)} a day for the next ${pace.daysLeft} day${pace.daysLeft === 1 ? '' : 's'}`);
  if (pace.status === 'watch') parts.push(`at this pace the month ends near ${money(pace.projectedMinor, cur)}`);
  return parts.join(' · ');
}
