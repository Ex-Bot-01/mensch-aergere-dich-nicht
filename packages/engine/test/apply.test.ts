import { describe, expect, it } from 'vitest';

import type { Color } from '@madn/shared';

import { fieldId } from '../src/board.js';
import { applyMove, passTurn } from '../src/apply.js';
import type { GameState } from '../src/state.js';
import { expectMove, game, rolled, stand, stood } from './helpers.js';

const asState = (result: GameState | { code: string }): GameState => result as GameState;

describe('refusing a move', () => {
  it('refuses a move that is not on the legal list', () => {
    const state = rolled(game('red'), 3);
    const bogus = { pieceId: 'red:0', from: 'k:red:0', to: fieldId('red', 3) };

    expect(applyMove(state, bogus, 'red')).toEqual({ code: 'illegalMove' });
  });

  it('changes nothing when it refuses', () => {
    const state = rolled(game('red'), 3);
    const before = structuredClone(state);

    applyMove(state, { pieceId: 'red:0', from: 'k:red:0', to: fieldId('red', 3) }, 'red');

    expect(state).toEqual(before);
  });

  it('refuses a move before the die has been rolled', () => {
    const state = game('red');

    expect(applyMove(state, { pieceId: 'red:0', from: 'k:red:0', to: 'c3' }, 'red')).toMatchObject({
      code: 'wrongPhase',
    });
  });

  it('refuses a move by a color that is not on turn', () => {
    const state = rolled(game('red'), 6);

    expect(applyMove(state, expectMove(state, 'red:0', 'c0'), 'blue')).toEqual({
      code: 'notYourTurn',
    });
  });
});

describe('applying a move', () => {
  it('moves the piece and clears the die', () => {
    let state = stand(game('red'), 'red:0', fieldId('red', 2));
    state = rolled(state, 3);

    const next = asState(applyMove(state, expectMove(state, 'red:0', fieldId('red', 5)), 'red'));

    expect(next.pieces.find((p) => p.id === 'red:0')!.loc).toBe(fieldId('red', 5));
    expect(next.turn.die).toBeNull();
    expect(next.turn.stage).toBe('awaitRoll');
  });

  it('sends an opponent back to their own corner slot', () => {
    let state = stood(game('red'), [
      ['red:0', fieldId('red', 2)],
      ['blue:2', fieldId('red', 5)],
    ]);
    state = rolled(state, 3);

    const next = asState(applyMove(state, expectMove(state, 'red:0', fieldId('red', 5)), 'red'));

    expect(next.pieces.find((p) => p.id === 'blue:2')!.loc).toBe('k:blue:2');
    expect(next.events.map((e) => e.kind)).toEqual(['moved', 'captured']);
    expect(next.events.at(-1)!.payload).toEqual({
      color: 'blue',
      pieceId: 'blue:2',
      field: fieldId('red', 5),
    });
  });

  it('lets the same color roll again after a six', () => {
    let state = stood(game('red'), [
      ['red:0', fieldId('red', 2)],
      ['red:1', fieldId('red', 12)],
      ['red:2', fieldId('red', 22)],
      ['red:3', fieldId('red', 32)],
    ]);
    state = rolled(state, 6);

    const next = asState(applyMove(state, expectMove(state, 'red:0', fieldId('red', 8)), 'red'));

    expect(next.turn).toEqual({ color: 'red', stage: 'awaitRoll', die: null });
    expect(next.phase).toBe('playing');
  });

  it('hands the turn to the next seat when the roll was not a six', () => {
    let state = stand(game('red', ['red', 'blue', 'green']), 'red:0', fieldId('red', 2));
    state = rolled(state, 3);

    const next = asState(applyMove(state, expectMove(state, 'red:0', fieldId('red', 5)), 'red'));

    expect(next.turn.color).toBe('blue');
  });

  it('skips a player who has been marked out when advancing the turn', () => {
    let state = stand(game('red', ['red', 'blue', 'green']), 'red:0', fieldId('red', 2));
    state = rolled(state, 3);
    state = { ...state, out: ['blue'] };

    const next = asState(applyMove(state, expectMove(state, 'red:0', fieldId('red', 5)), 'red'));

    expect(next.turn.color).toBe('green');
  });

  it('wraps the turn back to the first seat', () => {
    let state = stand(game('green', ['red', 'blue', 'green']), 'green:0', fieldId('green', 2));
    state = rolled(state, 3);

    const next = asState(applyMove(state, expectMove(state, 'green:0', fieldId('green', 5)), 'green'));

    expect(next.turn.color).toBe('red');
  });
});

/** Red about to play its fourth piece into a home column that already holds three. */
function nearlyHome(players: readonly Color[]): GameState {
  let state = game('red', players);
  state = stood(state, [
    ['red:0', 'h:red:4'],
    ['red:1', 'h:red:3'],
    ['red:2', 'h:red:2'],
    ['red:3', fieldId('red', 38)],
  ]);
  if (players.includes('blue')) {
    state = stood(state, [
      ['blue:0', 'h:blue:4'],
      ['blue:1', 'h:blue:3'],
      ['blue:2', fieldId('blue', 20)],
    ]);
  }
  if (players.includes('green')) {
    state = stood(state, [
      ['green:0', 'h:green:4'],
      ['green:1', 'h:green:3'],
      ['green:2', fieldId('green', 5)],
    ]);
  }
  return rolled(state, 2);
}

describe('winning', () => {
  it('ends the game when a color gets its fourth piece into the home column', () => {
    const state = nearlyHome(['red', 'blue']);

    const next = asState(applyMove(state, expectMove(state, 'red:3', 'h:red:1'), 'red'));

    expect(next.phase).toBe('finished');
    expect(next.events.map((e) => e.kind)).toContain('finished');
  });

  it('ranks the winner first and breaks the rest by pieces in home, then by distance covered', () => {
    const state = nearlyHome(['red', 'blue', 'green']);

    const next = asState(applyMove(state, expectMove(state, 'red:3', 'h:red:1'), 'red'));

    expect(next.standings?.map((s) => [s.rank, s.color, s.finished])).toEqual([
      [1, 'red', 4],
      [2, 'blue', 2],
      [3, 'green', 2],
    ]);
  });

  it('leaves the game running while a color still has pieces outside its home column', () => {
    let state = stood(game('red'), [
      ['red:0', 'h:red:4'],
      ['red:1', 'h:red:1'],
    ]);
    state = rolled(state, 2);

    const next = asState(applyMove(state, expectMove(state, 'red:1', 'h:red:3'), 'red'));

    expect(next.phase).toBe('playing');
  });
});

describe('passing a turn with nothing to play', () => {
  it('announces the pass and moves the turn without touching any piece', () => {
    const state = game('red', ['red', 'blue']);

    const next = passTurn(state);

    expect(next.pieces).toEqual(state.pieces);
    expect(next.turn.color).toBe('blue');
    expect(next.events.map((e) => e.kind)).toEqual(['passed']);
  });

  it('skips marked-out players when it passes', () => {
    const state = { ...game('red', ['red', 'blue', 'green']), out: ['blue' as const] };

    expect(passTurn(state).turn.color).toBe('green');
  });
});
