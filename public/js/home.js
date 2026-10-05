// The tile dashboard. Each tile has its own container so one can update without
// touching the others. The music tile in particular is only rebuilt when the track
// changes, otherwise refreshing the page data would restart the song.

import { h, clear, icon, api, app, squiggle, greeting, weekdayDate, money, dueLabel, ymd, showError, toast, MOODS, moodEmoji, nowHHMM, celebrate } from './lib.js';
import { taskRow, openTaskSheet, openExpenseSheet, habitRow, openHabitSheet, openEntrySheet, paceText, createExpenseDetector } from './components.js';

export function createHome(container) {
  const head = h('div', { class: 'home-head' });
  const tiles = {
    attention: h('section', { class: 'tile tilt-a', 'aria-labelledby': 'h-attn' }),
    tasks: h('section', { class: 'tile tilt-b', 'aria-labelledby': 'h-tasks' }),
    habits: h('section', { class: 'tile tilt-c', 'aria-labelledby': 'h-habits' }),
    journal: h('section', { class: 'tile tilt-d', 'aria-labelledby': 'h-journal' }),
    spend: h('section', { class: 'tile tilt-a', 'aria-labelledby': 'h-spend' }),
    music: h('section', { class: 'tile tilt-e tape', 'aria-labelledby': 'h-music' }),
  };
  clear(container, h('div', { class: 'home' }, head, tiles.attention, tiles.tasks, tiles.habits, tiles.journal, tiles.spend, tiles.music));

  let token = 0;
  let musicKey = null;
  let lastData = null;

  async function refresh() {
    const mine = ++token;
    let data;
    try {
      data = await api(`/dashboard?today=${ymd()}&now=${nowHHMM()}`);
    } catch (e) {
      if (!lastData) renderFailure(e);
      else showError(e);
      return;
    }
    if (mine !== token) return;
    lastData = data;
    renderHead(data);
    renderAttention(data);
    renderTasks(data);
    renderHabits(data);
    renderJournal(data);
    renderSpend(data);
    renderMusic(data);
  }

  function start() { return refresh(); }

  // Time-based nudges ("planned for 19:30, not done") go stale in a tab left open; refresh on return.
  document.addEventListener('visibilitychange', () => { if (!document.hidden && app.current === 'home') refresh(); });

  function renderFailure(err) {
    clear(head, h('h1', null, 'Day Hub'));
    for (const t of Object.values(tiles)) t.hidden = true;
    tiles.attention.hidden = false;
    clear(tiles.attention,
      h('h2', { id: 'h-attn' }, "Can't load your day"),
      h('p', { class: 'error' }, err.message),
      h('button', { class: 'btn primary', type: 'button', onClick: start }, 'Try again'));
  }

  // ---------- header ----------
  function renderHead(data) {
    for (const t of Object.values(tiles)) t.hidden = false;
    clear(head,
      h('div', null,
        h('p', { class: 'meta' }, weekdayDate()),
        h('h1', null, greeting(data.name)),
        squiggle(),
        h('p', { class: 'meta', style: 'margin:4px 0 0' }, `${data.stats.streak ? `🔥 ${data.stats.streak}-day streak · ` : ''}${data.stats.totalPoints} points`)),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Settings', onClick: () => app.go('settings') }, icon('gear', 26)));
  }

  // ---------- attention ----------
  function renderAttention(data) {
    const items = data.attention;
    const urgent = items.length > 0;
    clear(tiles.attention,
      h('span', { class: `stamp${urgent ? '' : ' calm'}` }, urgent ? 'DUE' : 'CLEAR'),
      h('h2', { id: 'h-attn' }, 'Needs you now'),
      urgent
        ? h('ul', { class: 'list' }, items.map((item) => attentionRow(item, data.today)))
        : h('p', { class: 'empty' }, h('strong', null, 'Nothing urgent.'), ' Nothing overdue, nothing due, nothing missed. Enjoy it.'));
  }

  function attentionRow(item, today) {
    const go = (route) => () => app.go(route);
    const row = (iconName, title, sub, route, bad = false) => h('li', null, h('div', { class: 'attn-item' },
      h('span', { class: `attn-icon${bad ? ' overdue' : ''}` }, icon(iconName, 22)),
      h('div', { class: 'grow' },
        h('button', { class: 'task-title-btn headline', type: 'button', onClick: go(route) }, title),
        h('span', { class: `meta${bad ? ' overdue' : ''}` }, sub))));
    if (item.type === 'habit') return row('habits', `${item.icon || ''} ${item.title}`.trim(), `Planned for ${item.remindAt}, not done yet`, 'journal');
    if (item.type === 'journal') return row('journal', item.title, 'Nothing written yet today', 'journal');
    if (item.type === 'budget') return row('alert', item.title, `Over by ${money(item.overByMinor)}`, 'spend', true);
    return row(item.overdue ? 'alert' : 'tasks', item.title, item.overdue ? `Overdue · ${dueLabel(item.dueOn, today)}` : 'Due today', 'tasks', item.overdue);
  }

  // ---------- tasks ----------
  function renderTasks(data) {
    const open = data.tasks.list.filter((t) => !t.done);
    const shown = open.slice(0, 5);
    const doneCount = data.tasks.doneToday;
    clear(tiles.tasks,
      h('div', { class: 'tile-head' },
        h('h2', { id: 'h-tasks' }, 'Today'),
        h('button', { class: 'btn', type: 'button', onClick: () => openTaskSheet() }, icon('plus', 18), ' Add')),
      shown.length
        ? h('ul', { class: 'list compact' }, shown.map((t) => taskRow(t, { today: data.today, compact: true, onOpen: openTaskSheet })))
        : h('p', { class: 'empty' }, open.length === 0 && doneCount > 0 ? h('strong', null, 'All done for today.') : h('strong', null, 'No tasks yet.'), ' Add one to get going.'),
      h('div', { class: 'actions' },
        h('span', { class: 'meta grow' }, `${doneCount} done today${open.length > shown.length ? ` · ${open.length - shown.length} more` : ''}`),
        h('button', { class: 'btn link', type: 'button', onClick: () => app.go('tasks') }, 'All tasks')));
  }

  // ---------- habits ----------
  function renderHabits(data) {
    const hb = data.habits;
    const list = [...hb.list].sort((a, b) => Number(a.done) - Number(b.done));
    const shown = list.slice(0, 5);
    clear(tiles.habits,
      h('div', { class: 'tile-head' },
        h('h2', { id: 'h-habits' }, 'Habits'),
        h('button', { class: 'btn', type: 'button', onClick: () => openHabitSheet() }, icon('plus', 18), ' Add')),
      shown.length
        ? h('ul', { class: 'list compact' }, shown.map((x) => habitRow(x, { day: data.today, onOpen: openHabitSheet })))
        : h('p', { class: 'empty' }, h('strong', null, hb.total ? 'Nothing scheduled today.' : 'No habits yet.'), hb.total ? '' : ' Add water, steps, a workout…'),
      h('div', { class: 'actions' },
        h('span', { class: 'meta grow' }, hb.total ? `${hb.doneCount} of ${hb.total} done${list.length > shown.length ? ` · ${list.length - shown.length} more` : ''}` : ''),
        h('button', { class: 'btn link', type: 'button', onClick: () => app.go('habits') }, 'All habits')));
  }

  // ---------- journal (quick note) ----------
  // The note box is built once and kept across refreshes, so a half-typed note and the
  // cursor survive the dashboard reloading. Only the prompt, faces and counts are redrawn.
  const detector = createExpenseDetector({ getDay: () => ymd() });
  const note = h('textarea', {
    class: 'input textarea quick-note', rows: 2, maxlength: 10000, id: 'q-note',
    'aria-label': 'Quick journal note', placeholder: 'Jot anything. “Spent ₹250 on lunch” works too.',
  });
  const promptHost = h('div');
  const moodHost = h('div', { class: 'mood-row', role: 'group', 'aria-label': 'Mood' });
  const moodHint = h('p', { class: 'meta', style: 'margin:4px 0 0' });
  const countHost = h('span', { class: 'meta grow' });
  let draftMood = null;
  let latestMood = null;
  let quickMoodId = null;
  let saving = false;
  let journalBuilt = false;

  const hasDraft = () => note.value.trim().length > 0;

  function drawMoodFaces() {
    const writing = hasDraft();
    const shown = writing ? draftMood : latestMood;
    clear(moodHost, MOODS.map((m) => h('button', {
      class: 'mood-btn', type: 'button', 'aria-label': `Mood: ${m.l}`, 'aria-pressed': shown === m.v ? 'true' : 'false',
      onClick: () => (writing ? pickDraftMood(m.v) : quickMood(m)),
    }, m.e)));
    moodHint.textContent = writing ? 'The mood is saved with this note.' : 'Tap a face for a one-tap mood check-in.';
  }

  function pickDraftMood(v) { draftMood = draftMood === v ? null : v; drawMoodFaces(); }

  async function quickMood(m) {
    try {
      // A second tap soon after the first fixes that check-in instead of adding another.
      const res = quickMoodId
        ? await api(`/journal/${quickMoodId}`, { method: 'PATCH', body: { mood: m.v, today: ymd() } })
        : await api('/journal', { method: 'POST', body: { day: ymd(), time: nowHHMM(), mood: m.v, today: ymd() } });
      toast(`Mood saved ${m.e}`);
      celebrate(res.newBadges);
      refresh();
    } catch (e) { showError(e); }
  }

  function clearDraft() {
    note.value = '';
    draftMood = null;
    detector.reset();
    drawMoodFaces();
  }

  async function saveNote() {
    const text = note.value.trim();
    if (!text || saving) return;
    saving = true;
    try {
      const expenses = detector.selected();
      const res = await api('/journal', { method: 'POST', body: { day: ymd(), time: nowHHMM(), text, mood: draftMood, tags: [], expenses, today: ymd() } });
      clearDraft();
      const added = res.expenses ? res.expenses.length : 0;
      toast(added ? `Saved. ${added} expense${added > 1 ? 's' : ''} added too.` : 'Saved to your journal');
      celebrate(res.newBadges);
      app.onChange();
    } catch (e) { showError(e); }
    saving = false;
  }

  // The full sheet (prompts, tags, date and time) takes whatever has been typed so far.
  function openFullEditor() {
    const draft = hasDraft() || draftMood ? { text: note.value, mood: draftMood } : null;
    clearDraft();
    openEntrySheet({ day: ymd(), draft });
  }

  note.addEventListener('input', () => { detector.schedule(note.value); drawMoodFaces(); });
  note.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); saveNote(); }
  });

  function renderJournal(data) {
    const j = data.journal;
    latestMood = j.latestMood;
    quickMoodId = j.quickMoodId;
    if (!journalBuilt) {
      journalBuilt = true;
      clear(tiles.journal,
        h('div', { class: 'tile-head' },
          h('h2', { id: 'h-journal' }, 'Journal'),
          h('button', { class: 'btn', type: 'button', onClick: openFullEditor }, icon('edit', 18), ' Full editor')),
        promptHost,
        h('div', { class: 'field', style: 'margin:0' }, h('label', { class: 'sr-only', for: 'q-note' }, 'Quick journal note'), note),
        detector.host,
        moodHost, moodHint,
        h('div', { class: 'actions' },
          h('button', { class: 'btn primary grow', type: 'button', onClick: saveNote }, icon('plus', 18), ' Add to journal')),
        h('div', { class: 'actions' },
          countHost,
          h('button', { class: 'btn link', type: 'button', onClick: () => app.go('journal') }, 'Open journal')));
    }
    clear(promptHost, h('div', { class: 'prompt-card' }, h('span', { class: 'label' }, j.prompt.title), j.prompt.text));
    drawMoodFaces();
    countHost.textContent = j.todayCount ? `${j.todayCount} ${j.todayCount === 1 ? 'entry' : 'entries'} today${j.latestMood ? ` · ${moodEmoji(j.latestMood)}` : ''}` : 'Nothing written yet today';
  }

  // ---------- spend ----------
  function renderSpend(data) {
    const s = data.spend;
    const cur = s.currency;
    const hasBudget = s.budgetMinor > 0;
    const pct = hasBudget ? Math.min(100, Math.round((s.totalMinor / s.budgetMinor) * 100)) : 0;
    const over = hasBudget && s.totalMinor > s.budgetMinor;
    clear(tiles.spend,
      h('div', { class: 'tile-head' },
        h('h2', { id: 'h-spend' }, 'Spending'),
        h('button', { class: 'btn', type: 'button', onClick: () => openExpenseSheet() }, icon('plus', 18), ' Expense')),
      h('p', { class: 'money big' }, money(s.totalMinor, cur)),
      h('p', { class: 'meta' }, hasBudget
        ? (over ? `Over budget by ${money(s.totalMinor - s.budgetMinor, cur)}` : `${money(s.budgetMinor - s.totalMinor, cur)} left of ${money(s.budgetMinor, cur)}`)
        : 'this month · set a budget in Settings'),
      hasBudget ? h('div', { class: `bar${over ? ' over' : ''}`, role: 'img', 'aria-label': `${pct}% of budget used` }, h('i', { style: `width:${pct}%` })) : null,
      paceText(s.pace, cur) ? h('p', { class: `meta${s.pace.status === 'watch' ? ' overdue' : ''}`, style: 'margin:6px 0 0' }, paceText(s.pace, cur)) : null,
      h('div', { class: 'actions' },
        h('span', { class: 'meta grow' }, `Today: ${money(s.todayMinor, cur)}`),
        h('button', { class: 'btn link', type: 'button', onClick: () => app.go('spend') }, 'Details')));
  }

  // ---------- music ----------
  function pasteForm(hasTrack) {
    const input = h('input', {
      class: 'input', type: 'url', autocomplete: 'off', 'aria-label': 'Paste a YouTube link to play',
      placeholder: hasTrack ? 'Paste another YouTube link' : 'Paste a YouTube link',
    });
    let busy = false;
    const submit = async () => {
      const url = input.value.trim();
      if (!url || busy) return;
      busy = true;
      try {
        await api('/music', { method: 'POST', body: { url } });
        input.value = '';
        await refresh();
      } catch (err) { showError(err); }
      busy = false;
    };
    // Pasting plays straight away; typing and pressing Enter works too.
    input.addEventListener('paste', () => setTimeout(submit, 0));
    return h('form', { onSubmit: (e) => { e.preventDefault(); submit(); } },
      hasTrack ? null : h('p', { class: 'empty' }, 'Paste a YouTube video or playlist link and it plays right here.'),
      h('div', { class: 'inline-form' }, input, h('button', { class: 'btn primary', type: 'submit' }, icon('play', 18), ' Play')));
  }

  function renderMusic(data) {
    const cur = data.music.current;
    const key = cur ? `${cur.id}|${cur.embedUrl}` : 'none';
    if (key === musicKey && tiles.music.childNodes.length) return; // keep the song playing
    musicKey = key;

    const body = [];
    if (cur) {
      body.push(
        h('div', { class: 'player-frame yt' },
          h('iframe', {
            src: cur.embedUrl,
            title: `${cur.label} (YouTube)`,
            allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen',
            referrerpolicy: 'strict-origin-when-cross-origin',
          })),
        h('div', { class: 'now-playing' },
          h('span', { class: 'meta' }, cur.label),
          h('button', { class: 'btn link', type: 'button', onClick: () => app.go('music') }, 'Saved')));
    }
    body.push(h('div', { style: cur ? 'margin-top:8px' : '' }, pasteForm(!!cur)));
    clear(tiles.music, h('div', { class: 'tile-head' }, h('h2', { id: 'h-music' }, 'Music')), body);
  }

  return {
    start,
    refresh,
    /** Called when the user leaves Home so polling stops. */
    pause() {},
    forceMusicRender() { musicKey = null; },
  };
}
