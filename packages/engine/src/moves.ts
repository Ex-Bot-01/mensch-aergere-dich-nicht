import type { Color, FieldId } from '@madn/shared';

import { CIRCUIT_LEN, ENTRY, ROUTE_LEN, fieldId } from './board.js';
import type { GameState, Piece } from './state.js';

export type Move = { pieceId: string; from: FieldId; to: FieldId; capture?: Color };

/**
 * Where a piece stands in its own color's route coordinates. Returns null for a piece
 * still in the corner — and for nothing else, since a piece never stands in another
 * color's home column.
 */
function stepOf(color: Color, loc: FieldId): number | null {
  if (loc.startsWith('c')) return (Number(loc.slice(1)) - ENTRY[color] + CIRCUIT_LEN) % CIRCUIT_LEN;
  if (loc.startsWith(`h:${color}:`)) return CIRCUIT_LEN + Number(loc.split(':')[2]) - 1;
  return null;
}

function occupancy(state: GameState): Map<FieldId, Piece> {
  const map = new Map<FieldId, Piece>();
  for (const piece of state.pieces) map.set(piece.loc, piece);
  return map;
}

/** Every move the player on turn may make with the die they rolled, in piece order. */
export function legalMoves(state: GameState): Move[] {
  const { die, stage } = state.turn;
  if (state.phase !== 'playing' || stage !== 'awaitMove' || die === null) return [];

  const color = state.turn.color;
  const mine = state.pieces.filter((piece) => piece.color === color);
  const here = occupancy(state);

  // A six with an empty entry field must be spent bringing a piece out.
  const entryField = fieldId(color, 0);
  const entryHeldByMe = mine.some((piece) => piece.loc === entryField);
  if (die === 6 && !entryHeldByMe) {
    const waiting = mine.find((piece) => stepOf(color, piece.loc) === null);
    if (waiting) {
      const blocked = here.get(entryField);
      return [
        blocked && blocked.color !== color
          ? { pieceId: waiting.id, from: waiting.loc, to: entryField, capture: blocked.color }
          : { pieceId: waiting.id, from: waiting.loc, to: entryField },
      ];
    }
  }

  const moves: Move[] = [];
  for (const piece of mine) {
    const from = stepOf(color, piece.loc);
    if (from === null) continue;

    const to = from + die;
    if (to >= ROUTE_LEN) continue; // overshooting the last home field is not a move

    const target = fieldId(color, to);
    const occupant = here.get(target);

    if (to >= CIRCUIT_LEN) {
      // Inside the home column your own pieces block the way; nothing may jump them.
      const blockedAhead = mine.some((other) => {
        const step = stepOf(color, other.loc);
        return step !== null && step > from && step <= to;
      });
      if (blockedAhead) continue;
    } else if (occupant && occupant.color === color) {
      continue; // your own piece stands there: not a move at all
    }

    moves.push(
      occupant && occupant.color !== color
        ? { pieceId: piece.id, from: piece.loc, to: target, capture: occupant.color }
        : { pieceId: piece.id, from: piece.loc, to: target },
    );
  }

  return moves;
}
