// Shown instead of the app when the data saved in this browser cannot be read.
// Nothing is deleted or overwritten until the person chooses.

import { $, h, clear, squiggle, saveTextFile } from './lib.js';
import { STORAGE_KEY } from './core/store.js';

export function showDamaged(host, error, storage) {
  $('#nav').style.display = 'none';
  const keep = `${STORAGE_KEY}:damaged`;
  clear(host, h('div', { class: 'page solo' },
    h('h1', null, 'Day Hub'), squiggle(),
    h('section', { class: 'tile tilt-a' },
      h('h2', null, 'Your saved data could not be read'),
      h('p', null, error.message),
      h('p', { class: 'hint' }, 'Nothing has been deleted. Download a copy first, so it can be repaired later or restored from.'),
      h('div', { class: 'actions' },
        h('button', { class: 'btn', type: 'button', onClick: () => saveTextFile(error.raw || '', 'day-hub-damaged-data.json', 'application/json') }, 'Download the saved data'),
        h('button', { class: 'btn primary', type: 'button', onClick: () => {
          try {
            storage.setItem(keep, error.raw || '');
            storage.removeItem(STORAGE_KEY);
          } catch { return; }
          location.reload();
        } }, 'Start fresh'))),
    h('p', { class: 'hint' }, 'Start fresh keeps the unreadable copy in this browser under another name and opens an empty Day Hub. You can restore a backup afterwards in Settings.')));
}
