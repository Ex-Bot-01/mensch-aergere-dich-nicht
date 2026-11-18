import { describe, expect, it } from 'vitest';

import type { Color, FieldId } from '@madn/shared';

import { fieldId } from '../src/board.js';
import { legalMoves } from '../src/moves.js';
import type { GameState } from '../src/state.js';
import { createGame } from '../src/state.js';

const TWO: Color[] = ['red', 'blue'];

/** A fresh two-player game whose turn belongs to `color`. */
function game(color: Color = 'red', seed = 7): GameState {
  const state = createGame({ colors: [...TWO], hostColor: 'red', seed });
  return { ...state, turn: { color, stage: 'awaitRoll', die: null } };
}

/** Give the player on turn a die value, as a roll would. */
function rolled(state: GameState, die: number): GameState {
  return { ...state, turn: { ...state.turn, die, stage: 'awaitMove' } };
}

/** Stand a named piece on a field, clearing anyone who was there. */
function stand(state: GameState, pieceId: string, loc: FieldId): GameState {
  const moving = state.pieces.find((p) => p.id === pieceId)!;
  return {
    ...state,
    pieces: state.pieces
      .filter((p) => !(p.loc === loc && p.id !== pieceId))
      .map((p) => (p.id === pieceId ? { ...p, loc } : p)),
  };
}

const moveTo = (state: GameState, field: FieldId) =>
  legalMoves(state).filter((m) => m.to === field);

describe('legal moves before the die', () => {
  it('offers nothing until the active player has rolled', () => {
    expect(legalMoves(game('red'))).toEqual([]);
  });

  it('offers nothing once the game is finished', () => {
    const state = rolled(game('red'), 4);
    expect(legalMoves({ ...state, phase: 'finished' })).toEqual([]);
  });

  it('offers nothing when everyone is still in the corner and the die is not a six', () => {
    expect(legalMoves(rolled(game('red'), 4))).toEqual([]);
  });
});

describe('bringing a piece out on a six', () => {
  it('offers exactly one move — the corner piece onto the entry field', () => {
    const state = rolled(game('red'), 6);

    expect(legalMoves(state)).toEqual([{ pieceId: 'red:0', from: 'k:red:0', to: 'c0' }]);
  });

  it('is mandatory even when another piece could advance instead', () => {
    let state = stand(game('red'), 'red:1', fieldId('red', 10));
    state = rolled(state, 6);

    expect(legalMoves(state)).toEqual([{ pieceId: 'red:0', from: 'k:red:0', to: 'c0' }]);
  });

  it('captures an opponent standing on the entry field', () => {
    let state = stand(game('red'), 'blue:1', 'c0');
    state = rolled(state, 6);

    expect(legalMoves(state)).toEqual([
      { pieceId: 'red:0', from: 'k:red:0', to: 'c0', capture: 'blue' },
    ]);
  });

  it('falls back to ordinary moves once the entry field holds one of your own', () => {
    let state = stand(game('red'), 'red:0', 'c0');
    state = rolled(state, 6);
    const moves = legalMoves(state);

    expect(moves.some((m) => m.from.startsWith('k:'))).toBe(false);
    expect(moves).toEqual([{ pieceId: 'red:0', from: 'c0', to: 'c6' }]);
  });
});

describe('advancing on the circuit', () => {
  it('offers a move onto an empty field', () => {
    let state = stand(game('red'), 'red:0', fieldId('red', 2));
    state = rolled(state, 3);

    expect(moveTo(state, fieldId('red', 5))).toEqual([
      { pieceId: 'red:0', from: fieldId('red', 2), to: fieldId('red', 5) },
    ]);
  });

  it('drops a move whose destination holds one of your own pieces', () => {
    let state = stand(game('red'), 'red:0', fieldId('red', 2));
    state = stand(state, 'red:1', fieldId('red', 5));
    state = rolled(state, 3);

    expect(legalMoves(state).filter((m) => m.pieceId === 'red:0')).toEqual([]);
    expect(moveTo(state, fieldId('red', 8))).toEqual([
      { pieceId: 'red:1', from: fieldId('red', 5), to: fieldId('red', 8) },
    ]);
  });

  it('marks a destination held by an opponent as a capture', () => {
    let state = stand(game('red'), 'red:0', fieldId('red', 2));
    state = stand(state, 'blue:2', fieldId('red', 5));
    state = rolled(state, 3);

    expect(legalMoves(state)).toEqual([
      { pieceId: 'red:0', from: fieldId('red', 2), to: fieldId('red', 5), capture: 'blue' },
    ]);
  });

  it('walks past opponents on the way without being blocked', () => {
    let state = stand(game('red'), 'red:0', fieldId('red', 2));
    state = stand(state, 'blue:3', fieldId('red', 3));
    state = rolled(state, 3);

    expect(moveTo(state, fieldId('red', 5))).toHaveLength(1);
  });

  it('wraps around the shared circuit numbering', () => {
    expect(fieldId('blue', 28)).toBe('c38');
    let state = stand(game('blue'), 'blue:0', fieldId('blue', 28));
    state = rolled(state, 5);

    expect(legalMoves(state).filter((m) => m.pieceId === 'blue:0')).toEqual([
      { pieceId: 'blue:0', from: 'c38', to: 'c3' },
    ]);
  });
});

describe('the home column', () => {
  it('needs a full circuit before a piece may turn into it', () => {
    let state = stand(game('red'), 'red:0', fieldId('red', 38));
    state = rolled(state, 6);

    expect(legalMoves(state).filter((m) => m.pieceId === 'red:0')).toEqual([]);
  });

  it('lets a piece at step 37 enter on a six once nobody is left in the corner', () => {
    let state = stand(game('red'), 'red:0', fieldId('red', 37));
    for (const [slot, step] of [[1, 5], [2, 6], [3, 7]] as const) {
      state = stand(state, `red:${slot}`, fieldId('red', step));
    }
    state = rolled(state, 6);

    expect(legalMoves(state).filter((m) => m.pieceId === 'red:0')).toEqual([
      { pieceId: 'red:0', from: fieldId('red', 37), to: 'h:red:4' },
    ]);
  });

  it('drops a move that would pass the last home field', () => {
    let state = stand(game('red'), 'red:0', 'h:red:3');
    state = rolled(state, 3);

    expect(legalMoves(state)).toEqual([]);
  });

  it('lands on the last home field with the exact roll', () => {
    let state = stand(game('red'), 'red:0', 'h:red:2');
    state = rolled(state, 2);

    expect(legalMoves(state)).toEqual([{ pieceId: 'red:0', from: 'h:red:2', to: 'h:red:4' }]);
  });

  it('will not jump over one of its own pieces standing further up the column', () => {
    let state = stand(game('red'), 'red:1', 'h:red:2');
    state = stand(state, 'red:0', 'h:red:1');
    state = rolled(state, 1);

    expect(legalMoves(state)).toEqual([{ pieceId: 'red:1', from: 'h:red:2', to: 'h:red:3' }]);
  });

  it('treats a piece on the last home field as finished and unmoving', () => {
    let state = stand(game('red'), 'red:0', 'h:red:4');
    state = rolled(state, 1);

    expect(legalMoves(state)).toEqual([]);
  });
});
