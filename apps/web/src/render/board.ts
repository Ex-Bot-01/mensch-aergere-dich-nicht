import type { Snapshot } from '@madn/shared';

import { BOARD_VIEWBOX, fieldMarks, fieldPoint } from '../board-geometry.js';

const PIECE_RADIUS = 2.6;
/** A legal piece is a small dot; this is the fat tap area around it for thumbs. */
const TAP_RADIUS = 5;

/** The board itself: fields, then pieces, then whatever needs flashing. */
export function renderBoard(
  root: HTMLElement,
  snapshot: Snapshot,
  onPick: (pieceId: string) => void,
  opts: { interactive?: boolean } = {},
): void {
  const interactive = opts.interactive !== false;
  const legal = new Set(
    interactive ? (snapshot.game?.legalMoves ?? []).map((move) => move.pieceId) : [],
  );
  const lastCapture = [...(snapshot.events ?? [])]
    .reverse()
    .find((event) => event.kind === 'captured');
  const flashed =
    typeof lastCapture?.payload.pieceId === 'string' ? lastCapture.payload.pieceId : null;

  const marks = fieldMarks()
    .map(({ field, r, tint }) => {
      const { x, y } = fieldPoint(field);
      const cls = tint ? 'field tinted' : 'field';
      return `<circle class="${cls}" data-field="${field}" cx="${x.toFixed(2)}" cy="${y.toFixed(
        2,
      )}" r="${r}"${tint ? ` data-color="${tint}"` : ''} />`;
    })
    .join('');

  const pieces = (snapshot.game?.pieces ?? [])
    .map((piece) => {
      const { x, y } = fieldPoint(piece.loc);
      const at = `cx="${x.toFixed(2)}" cy="${y.toFixed(2)}"`;
      const classes = ['piece', piece.color, legal.has(piece.id) ? 'legal' : '', flashed === piece.id ? 'flash' : '']
        .filter(Boolean)
        .join(' ');
      const body = `<circle class="${classes}" data-piece="${piece.id}" data-color="${piece.color}" ${at} r="${PIECE_RADIUS}" />`;
      const tap = legal.has(piece.id)
        ? `<circle class="hit" data-hit="${piece.id}" ${at} r="${TAP_RADIUS}" />`
        : '';
      return body + tap;
    })
    .join('');

  root.innerHTML = `<svg viewBox="${BOARD_VIEWBOX}" class="board-svg" role="img" aria-label="the board">${marks}${pieces}</svg>`;

  for (const target of root.querySelectorAll<SVGElement>('.legal, .hit')) {
    const pieceId = target.getAttribute('data-piece') ?? target.getAttribute('data-hit');
    if (!pieceId) continue;
    target.addEventListener('click', () => onPick(pieceId));
  }
}
