// First-run setup: four short steps, one save at the end.

import { h, clear, icon, api, app, openLocked, showError, ymd } from './lib.js';

export const CURRENCIES = [['INR', '₹ Indian rupee'], ['USD', '$ US dollar'], ['EUR', '€ Euro'], ['GBP', '£ British pound'], ['AED', 'AED Dirham'], ['SGD', 'S$ Singapore dollar']];

export async function runWizard({ onDone }) {
  let presets = [];
  try { presets = (await api('/habits/presets')).presets; } catch { /* habits can be added later */ }
  const state = {
    habits: new Set(app.settings.setupDone ? [] : ['water', 'steps', 'workout', 'coffee']),
    name: app.settings.name || '',
    currency: app.settings.currency || 'INR',
    budget: app.settings.monthlyBudgetMinor ? (app.settings.monthlyBudgetMinor / 100).toFixed(app.settings.monthlyBudgetMinor % 100 ? 2 : 0) : '',
    musicUrl: '',
  };
  let step = 0;
  let saving = false;
  let error = '';

  openLocked((close) => {
    const root = h('div', { class: 'sheet' });

    const finish = async (skip) => {
      if (saving) return;
      saving = true; error = ''; draw();
      try {
        const body = skip ? { name: state.name } : {
          name: state.name, currency: state.currency, monthlyBudget: state.budget.trim(),
          habits: [...state.habits], today: ymd(), musicUrl: state.musicUrl.trim() || undefined,
        };
        await api('/setup', { method: 'POST', body });
        close();
        onDone();
      } catch (e) {
        saving = false; error = e.message; draw();
      }
    };

    const field = (label, control, hint) => h('div', { class: 'field' }, h('label', { for: control.id }, label), hint ? h('p', { class: 'hint' }, hint) : null, control);

    function stepBody() {
      if (step === 0) {
        const name = h('input', { class: 'input', id: 'w-name', value: state.name, maxlength: 40, autocomplete: 'given-name', onInput: (e) => { state.name = e.target.value; } });
        setTimeout(() => name.focus(), 30);
        return [h('h1', null, 'Welcome to Day Hub'), h('p', null, 'One page for your tasks, habits, journal, spending and music. Four quick questions and you are set.'), field('What should I call you?', name)];
      }
      if (step === 1) {
        const cur = h('select', { class: 'input', id: 'w-cur', onChange: (e) => { state.currency = e.target.value; } },
          CURRENCIES.map(([code, label]) => h('option', { value: code, selected: code === state.currency }, label)));
        const budget = h('input', { class: 'input', id: 'w-budget', inputmode: 'decimal', placeholder: 'Optional', value: state.budget, onInput: (e) => { state.budget = e.target.value; } });
        return [h('h1', null, 'Money'), field('Currency', cur), field('Monthly budget', budget, 'Leave empty if you do not want one. You can change it any time.')];
      }
      if (step === 2) {
        return [
          h('h1', null, 'Daily habits'),
          h('p', null, 'Pick a few to start with. Each earns points, and finishing things keeps your streak going. You can change all of this later.'),
          h('div', { class: 'pick-grid' }, presets.map((p) => h('label', { class: 'check-row' },
            h('input', { type: 'checkbox', checked: state.habits.has(p.id), onChange: (e) => { if (e.target.checked) state.habits.add(p.id); else state.habits.delete(p.id); } }),
            h('span', null, `${p.icon} ${p.title}`, p.kind === 'check' ? '' : h('span', { class: 'meta' }, p.kind === 'limit' ? ` (max ${p.target} ${p.unit})` : ` (${p.target} ${p.unit})`))))),
        ];
      }
      const music = h('input', { class: 'input', id: 'w-music', type: 'url', placeholder: 'YouTube video or playlist link', value: state.musicUrl, onInput: (e) => { state.musicUrl = e.target.value; } });
      return [h('h1', null, 'Music'), h('p', null, 'Paste a YouTube video or playlist and it plays on your home page. You can skip this.'), field('Link', music)];
    }

    function draw() {
      const last = step === 3;
      clear(root,
        h('div', { class: 'steps', 'aria-label': `Step ${step + 1} of 4` }, [0, 1, 2, 3].map((i) => h('i', { class: i <= step ? 'on' : '' }))),
        stepBody(),
        error ? h('p', { class: 'error', role: 'alert' }, error) : null,
        h('div', { class: 'actions' },
          step > 0 ? h('button', { class: 'btn', type: 'button', disabled: saving, onClick: () => { step -= 1; draw(); } }, icon('back', 18), ' Back') : null,
          h('span', { class: 'grow' }),
          last
            ? h('button', { class: 'btn primary', type: 'button', disabled: saving, onClick: () => finish(false) }, saving ? 'Saving…' : 'Finish')
            : h('button', { class: 'btn primary', type: 'button', onClick: () => { step += 1; draw(); } }, 'Next ', icon('next', 18))),
        h('div', { class: 'actions' },
          h('button', { class: 'btn link', type: 'button', disabled: saving, onClick: () => finish(true) }, 'Skip setup, I will do it later')));
    }
    draw();
    return root;
  });
}
