import { COLORS, type Color, type Snapshot } from '@madn/shared';

import { colorLabel, esc } from '../copy.js';
import { myPlayer, type Actions } from './shared.js';

/** Where the players wait for the host to start. */
export function renderLobby(root: HTMLElement, snapshot: Snapshot, actions: Actions): void {
  const seated = snapshot.players.filter((player) => player.color).length;
  const isHost = snapshot.hostToken === actions.me;

  const rows = COLORS.map((color) => {
    const holder = snapshot.players.find((player) => player.color === color);
    const mine = holder?.token === actions.me;
    const disabled = holder !== undefined && !mine;
    const label = holder
      ? `${colorLabel(color)} — ${mine ? 'you' : esc(holder.name)}`
      : `${colorLabel(color)} — free`;

    return `<li><button type="button" data-color="${color}" data-act="${mine ? 'unpick' : 'pickColor'}"${
      disabled ? ' disabled' : ''
    }>${label}</button></li>`;
  }).join('');

  root.innerHTML = `<section class="screen lobby">
    <h1>Lobby</h1>
    <p class="code">Code <strong data-code>${esc(snapshot.code)}</strong>
      <button type="button" data-act="copy">copy</button></p>
    <ul class="seats">${rows}</ul>
    ${
      isHost
        ? `<button type="button" data-act="start"${seated < 2 ? ' disabled' : ''}>Start game</button>`
        : '<p class="hint">Waiting for the host to start.</p>'
    }
    ${seated < 2 ? '<p class="hint">Two players are needed.</p>' : ''}
    ${snapshot.spectators.length > 0 ? `<p class="hint">${snapshot.spectators.length} watching.</p>` : ''}
  </section>`;

  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-color]')) {
    const color = button.dataset.color as Color;
    button.addEventListener('click', () =>
      button.dataset.act === 'unpick' ? actions.unpick() : actions.pickColor(color),
    );
  }
  root.querySelector('[data-act="start"]')?.addEventListener('click', () => actions.start());
  root.querySelector('[data-act="copy"]')?.addEventListener('click', () => {
    void navigator.clipboard?.writeText(snapshot.code);
  });
}

