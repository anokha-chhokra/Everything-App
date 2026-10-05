import { h, clear, icon, api, app, showError, toast } from './lib.js';

export function mountMusic(container) {
  let token = 0;
  const body = h('div', { class: 'stack' });
  clear(container, h('div', { class: 'page' }, h('div', { class: 'page-head' }, h('h1', null, 'Music')), body));

  async function play(linkId) {
    try {
      await api('/music/current', { method: 'PUT', body: { id: linkId } });
      app.onChange();
    } catch (e) { showError(e); }
  }

  async function refresh() {
    const mine = ++token;
    let res;
    try { res = await api('/music'); } catch (e) { showError(e); return; }
    if (mine !== token) return;
    const cur = res.current;

    const input = h('input', { class: 'input', type: 'url', id: 'm-url', required: true, autocomplete: 'off',
      placeholder: 'https://www.youtube.com/watch?v=…' });
    const form = h('form', {
      onSubmit: async (e) => {
        e.preventDefault();
        try {
          await api('/music', { method: 'POST', body: { url: input.value.trim() } });
          input.value = '';
          app.onChange();
        } catch (err) { showError(err); }
      },
    },
      h('div', { class: 'field' }, h('label', { for: 'm-url' }, 'Paste a YouTube link'),
        h('p', { class: 'hint' }, 'A video or a playlist. It starts playing right away.'),
        h('div', { class: 'inline-form' }, input, h('button', { class: 'btn primary', type: 'submit' }, icon('play', 18), ' Play'))));

    const player = cur
      ? h('section', { class: 'tile tilt-a tape' },
        h('div', { class: 'player-frame yt' },
          h('iframe', {
            src: cur.embedUrl,
            title: cur.label,
            allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen',
            referrerpolicy: 'strict-origin-when-cross-origin',
          })),
        h('p', { class: 'meta' }, cur.label))
      : null;

    const list = h('section', { class: 'tile tilt-b' },
      h('h2', null, 'Saved'),
      res.links.length
        ? h('ul', { class: 'list' }, res.links.map((l) => h('li', null, h('div', { class: 'source-row' },
          h('div', { class: 'grow' }, h('div', null, l.label), h('div', { class: 'meta' }, l.kind)),
          cur && cur.id === l.id
            ? h('span', { class: 'meta' }, 'Playing')
            : h('button', { class: 'btn', type: 'button', onClick: () => play(l.id) }, icon('play', 18), ' Play'),
          h('button', {
            class: 'icon-btn', type: 'button', 'aria-label': `Remove ${l.label}`,
            onClick: async () => {
              try { await api(`/music/${l.id}`, { method: 'DELETE' }); toast('Removed'); app.onChange(); } catch (e) { showError(e); }
            },
          }, icon('trash', 22))))))
        : h('p', { class: 'empty' }, 'Links you play are saved here.'));

    clear(body, player, h('section', { class: 'tile' }, form,
      h('p', { class: 'note-box' }, 'Some videos block embedding. If one will not play, try another link.')), list);
  }

  return { refresh };
}
