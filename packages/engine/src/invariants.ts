import type { FieldId } from '@madn/shared';

import { activePlayers } from './state.js';
import type { GameState } from './state.js';

/**
 * The rules a legal game can never break. Called from tests and the simulator on every
 * turn — never from the hot path, so it may be as strict as it likes.
 */
export function assertInvariants(state: GameState): void {
  const seen = new Map<FieldId, string>();
  for (const piece of state.pieces) {
    const clash = seen.get(piece.loc);
    if (clash !== undefined) {
      throw new Error(`two pieces on ${piece.loc}: ${clash} and ${piece.id}`);
    }
    seen.set(piece.loc, piece.id);
  }

  for (const color of activePlayers(state)) {
    const owned = state.pieces.filter((piece) => piece.color === color);
    if (owned.length !== 4) {
      throw new Error(`${color} owns ${owned.length} pieces, expected exactly 4`);
    }
    for (const piece of owned) {
      const somewhere =
        piece.loc.startsWith('k:') || piece.loc.startsWith('c') || piece.loc.startsWith(`h:${color}:`);
      if (!somewhere) throw new Error(`${piece.id} stands nowhere it can be: ${piece.loc}`);
    }
  }
}

export { activePlayers };
