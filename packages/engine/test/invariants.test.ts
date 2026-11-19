import { describe, expect, it } from 'vitest';

import type { Color } from '@madn/shared';

import { fieldId } from '../src/board.js';
import { applyMove, markOut, passTurn } from '../src/apply.js';
import { activePlayers, assertInvariants } from '../src/invariants.js';
import { legalMoves } from '../src/moves.js';
import { makeRng, type Rng } from '../src/rng.js';
import { createGame, rollDie, type GameState } from '../src/state.js';
import { expectMove, game, rolled, stand, stood } from './helpers.js';

/** Play a stretch of real turns, checking the invariants after every single one. */
function playLegalSequence(seed: number, players: Color[], turns: number): () => void {
  return () => {
    const rng = makeRng(seed);
    let state = createGame({ colors: players, hostColor: players[0]!, seed });

    for (let i = 0; i < turns && state.phase === 'playing'; i++) {
      const rolledState = rollOrThrow(state, rng);
      assertInvariants(rolledState);

      const moves = legalMoves(rolledState);
      if (moves.length === 0) {
        state = passTurn(rolledState);
      } else {
        const chosen = moves[Math.floor(rng() * moves.length)]!;
        const applied = applyMove(rolledState, chosen, rolledState.turn.color);
        if ('code' in applied) throw new Error(`refused a legal move: ${applied.code}`);
        state = applied;
      }
      assertInvariants(state);
    }
  };
}

/** Roll the way the server loop will: the engine decides, and refuses nothing here. */
function rollOrThrow(state: GameState, rng: Rng): GameState {
  const result = rollDie(state, rng, state.turn.color);
  if ('code' in result) throw new Error(`roll refused: ${result.code}`);
  return result;
}

describe('invariants', () => {
  it('hold through a long sequence of legal rolls and moves', () => {
    expect(playLegalSequence(11, ['red', 'blue', 'green'], 40)).not.toThrow();
  });

  it('notice a piece that has gone missing', () => {
    const broken: GameState = {
      ...game('red'),
      pieces: game('red').pieces.filter((p) => p.id !== 'red:3'),
    };

    expect(() => assertInvariants(broken)).toThrow(/red.*3/);
  });

  it('notice two pieces standing on the same field', () => {
    const state = game('red');
    const broken: GameState = {
      ...state,
      pieces: state.pieces.map((p) =>
        p.id === 'red:0' || p.id === 'red:1' ? { ...p, loc: 'c5' as const } : p,
      ),
    };

    expect(() => assertInvariants(broken)).toThrow(/c5/);
  });

  it('ignore pieces of a player who has been marked out', () => {
    const state = { ...game('red'), out: ['blue' as const], pieces: game('red').pieces.slice(0, 4) };

    expect(() => assertInvariants(state)).not.toThrow();
  });
});

describe('marking a player out', () => {
  it('takes all their pieces off the board and announces it', () => {
    let state = game('red', ['red', 'blue', 'green']);
    state = stood(state, [
      ['blue:0', 'h:blue:4'],
      ['blue:1', fieldId('blue', 12)],
    ]);

    const next = markOut(state, 'blue') as GameState;

    expect(next.pieces.filter((p) => p.color === 'blue')).toEqual([]);
    expect(next.out).toEqual(['blue']);
    expect(next.events.at(-1)).toEqual({ id: 1, kind: 'markedOut', payload: { color: 'blue' } });
  });

  it('refuses a color that is not in the game', () => {
    expect(markOut(game('red'), 'yellow')).toEqual({ code: 'notAPlayer' });
  });

  it('ends a two-player game at once with the other player first', () => {
    const next = markOut(game('red'), 'blue') as GameState;

    expect(next.phase).toBe('finished');
    expect(next.standings?.map((s) => [s.rank, s.color])).toEqual([
      [1, 'red'],
      [2, 'blue'],
    ]);
  });

  it('leaves the other players taking turns in seat order', () => {
    let state = game('red', ['red', 'blue', 'green', 'yellow']);
    state = markOut(state, 'blue') as GameState;

    expect(activePlayers(state)).toEqual(['red', 'green', 'yellow']);
    expect(passTurn(state).turn.color).toBe('green');
  });

  it('ranks a marked-out player last however far along they were', () => {
    let state = game('red', ['red', 'blue', 'green']);
    state = stood(state, [
      ['green:0', 'h:green:4'],
      ['green:1', 'h:green:3'],
      ['green:2', 'h:green:2'],
      ['green:3', 'h:green:1'],
      ['red:0', 'h:red:4'],
      ['red:1', 'h:red:3'],
      ['red:2', 'h:red:2'],
      ['red:3', fieldId('red', 38)],
    ]);
    state = markOut(state, 'green') as GameState;
    state = rolled(state, 2);

    const won = applyMove(state, expectMove(state, 'red:3', 'h:red:1'), 'red') as GameState;

    expect(won.standings?.map((s) => s.color)).toEqual(['red', 'blue', 'green']);
  });
});
