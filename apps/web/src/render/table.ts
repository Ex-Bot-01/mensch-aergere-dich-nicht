import { COLORS, type Color, type Snapshot } from '@madn/shared';

import { colorLabel, esc } from '../copy.js';
import { myPlayer, type Actions } from './shared.js';

/** The board, the dice, and whatever the player on turn is allowed to do. */
export function renderTable(root: HTMLElement, snapshot: Snapshot, actions: Actions): void {
  const game = snapshot.game;
  const me = myPlayer(snapshot, actions.me);
  const onTurn = me !== undefined && me.color !== null && me.color === game?.turnColor;
  const legal = new Set((game?.legalMoves ?? []).map((move) => move.pieceId));
  const turnPlayer = game ? snapshot.players.find((p) => p.color === game.turnColor) : undefined;

  const pieces = (game?.pieces ?? [])
    .map(
      (piece) =>
        `<i class="piece${legal.has(piece.id) && onTurn ? ' legal' : ''}" data-piece="${esc(
          piece.id,
        )}" data-color="${piece.color}" data-loc="${esc(piece.loc)}"></i>`,
    )
    .join('');

  const standings = game?.standings
    ? `<ul data-standings>${game.standings
        .map(
          (row) =>
            `<li>#${row.rank} <span class="swatch" data-color="${row.color}"></span>${colorLabel(
              row.color,
            )} — ${row.finished} home</li>`,
        )
        .join('')}</ul>`
    : '';

  root.innerHTML = `<section class="screen table">
    <p class="turn" data-turn>${
      turnPlayer ? esc(turnPlayer.name) : 'nobody'
    } to ${game?.stage === 'awaitRoll' ? 'roll' : 'move'}</p>
    <div id="board" class="board">${pieces}</div>
    <div class="controls">
      <span class="die" data-die>${game?.die ?? '–'}</span>
      ${
        onTurn && game?.stage === 'awaitRoll'
          ? `<button type="button" data-act="roll"${snapshot.paused ? ' disabled' : ''}>Roll dice</button>`
          : ''
      }
      ${
        snapshot.paused && snapshot.waitingFor
          ? `<p class="waiting" data-waiting>Waiting for ${colorLabel(snapshot.waitingFor)}…</p>
             <button type="button" data-act="forceContinue">End ${colorLabel(snapshot.waitingFor)}'s game</button>`
          : ''
      }
    </div>
    ${standings}
  </section>`;

  root.querySelector('[data-act="roll"]')?.addEventListener('click', () => actions.roll());
  root.querySelector('[data-act="forceContinue"]')?.addEventListener('click', () => {
    if (snapshot.waitingFor) actions.forceContinue(snapshot.waitingFor);
  });
  for (const piece of root.querySelectorAll<HTMLElement>('.piece.legal')) {
    piece.addEventListener('click', () => {
      const id = piece.getAttribute('data-piece');
      if (id) actions.move(id);
    });
  }
}
