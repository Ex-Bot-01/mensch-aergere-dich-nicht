import { COLORS, type Color, type Snapshot } from '@madn/shared';

import { colorLabel, esc } from '../copy.js';
import { renderBoard } from './board.js';
import { myPlayer, type Actions } from './shared.js';

/** The board, the dice, and whatever the player on turn is allowed to do. */
export function renderTable(root: HTMLElement, snapshot: Snapshot, actions: Actions): void {
  const game = snapshot.game;
  const me = myPlayer(snapshot, actions.me);
  const onTurn = me !== undefined && me.color !== null && me.color === game?.turnColor;
  const turnPlayer = game ? snapshot.players.find((p) => p.color === game.turnColor) : undefined;

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
    <div id="board" class="board"></div>
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

  const boardRoot = root.querySelector<HTMLElement>('#board');
  if (boardRoot && game) renderBoard(boardRoot, snapshot, (pieceId) => actions.move(pieceId));

  root.querySelector('[data-act="roll"]')?.addEventListener('click', () => actions.roll());
  root.querySelector('[data-act="forceContinue"]')?.addEventListener('click', () => {
    if (snapshot.waitingFor) actions.forceContinue(snapshot.waitingFor);
  });

}
