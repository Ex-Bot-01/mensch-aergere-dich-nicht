import type { Color, FieldId } from '@madn/shared';

import type { Move } from '../src/moves.js';
import { legalMoves } from '../src/moves.js';
import type { GameState } from '../src/state.js';
import { createGame } from '../src/state.js';

/** A fresh game whose turn belongs to `color`. Test scaffolding only. */
export function game(
  color: Color = 'red',
  players: readonly Color[] = ['red', 'blue'],
  seed = 7,
): GameState {
  const state = createGame({ colors: [...players], hostColor: players[0]!, seed });
  return { ...state, turn: { color, stage: 'awaitRoll', die: null } };
}

/** Give the player on turn a die value, as a roll would. */
export function rolled(state: GameState, die: number): GameState {
  return { ...state, turn: { ...state.turn, die, stage: 'awaitMove' } };
}

/** Stand a named piece on a field, clearing whoever was there. */
export function stand(state: GameState, pieceId: string, loc: FieldId): GameState {
  return {
    ...state,
    pieces: state.pieces
      .filter((p) => !(p.loc === loc && p.id !== pieceId))
      .map((p) => (p.id === pieceId ? { ...p, loc } : p)),
  };
}

/** Stand several pieces at once: `[pieceId, field]` pairs. */
export function stood(state: GameState, placements: readonly (readonly [string, FieldId])[]): GameState {
  return placements.reduce((acc, [pieceId, loc]) => stand(acc, pieceId, loc), state);
}

/** The legal move the test means, or a loud failure. */
export function expectMove(state: GameState, pieceId: string, to: FieldId): Move {
  const found = legalMoves(state).find((m) => m.pieceId === pieceId && m.to === to);
  if (!found) throw new Error(`no legal move for ${pieceId} onto ${to}`);
  return found;
}
