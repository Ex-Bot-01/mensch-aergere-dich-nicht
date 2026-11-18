import { describe, expect, it } from 'vitest';

import type { Color } from '@madn/shared';

import type { GameState } from '../src/state.js';
import { createGame, rollDie } from '../src/state.js';
import { makeRng } from '../src/rng.js';

const seat = (colors: readonly Color[], seed: number): GameState =>
  createGame({ colors: [...colors], hostColor: colors[0]!, seed });

const idleColor = (state: GameState): Color =>
  state.players.find((c) => c !== state.turn.color)!;

describe('game setup', () => {
  it('starts with all four pieces of every player in that color corner', () => {
    const state = seat(['red', 'blue'], 7);

    expect(state.pieces).toHaveLength(8);
    for (const color of ['red', 'blue'] as const) {
      const locs = state.pieces.filter((p) => p.color === color).map((p) => p.loc);
      expect(locs.sort()).toEqual([`k:${color}:0`, `k:${color}:1`, `k:${color}:2`, `k:${color}:3`]);
    }
  });

  it('names each piece after its color and corner slot', () => {
    const state = seat(['green'], 1);
    expect(state.pieces.map((p) => p.id).sort()).toEqual([
      'green:0',
      'green:1',
      'green:2',
      'green:3',
    ]);
  });

  it('opens a game that is playing, with no standings and nobody out', () => {
    const state = seat(['red', 'blue', 'green'], 3);

    expect(state.phase).toBe('playing');
    expect(state.standings).toBeNull();
    expect(state.out).toEqual([]);
    expect(state.turn.stage).toBe('awaitRoll');
    expect(state.turn.die).toBeNull();
    expect(state.players).toEqual(['red', 'blue', 'green']);
  });

  it('derives the starting color from the seed alone', () => {
    const colors: Color[] = ['red', 'blue', 'green', 'yellow'];
    expect(seat(colors, 42).turn.color).toBe(seat(colors, 42).turn.color);
  });

  it('lets every color start at least once across two hundred seeds', () => {
    const colors: Color[] = ['red', 'blue', 'green', 'yellow'];
    const starters = new Set<Color>();
    for (let seed = 0; seed < 200; seed++) starters.add(seat(colors, seed).turn.color);
    expect([...starters].sort()).toEqual(['blue', 'green', 'red', 'yellow']);
  });
});

describe('rolling the die', () => {
  /** A generator that always yields the roll whose face is `value`. */
  const always = (value: number) => () => (value - 0.5) / 6;

  it('refuses a roll from a color that is not on turn', () => {
    const state = seat(['red', 'blue'], 7);
    expect(rollDie(state, always(4), idleColor(state))).toEqual({ code: 'notYourTurn' });
  });

  it('records the value and appends one rolled event', () => {
    const before = seat(['red', 'blue'], 7);
    const state = rollDie(before, always(6), before.turn.color) as GameState;

    expect(state.turn.die).toBe(6);
    expect(state.turn.stage).toBe('awaitMove');
    expect(state.events).toEqual([{ id: 1, kind: 'rolled', payload: { color: before.turn.color, value: 6 } }]);
  });

  it('refuses a second roll while the player still owes a move', () => {
    const before = seat(['red', 'blue'], 7);
    const after = rollDie(before, always(3), before.turn.color) as GameState;

    expect(rollDie(after, makeRng(9), after.turn.color)).toEqual({ code: 'alreadyRolled' });
  });

  it('rolls every face from a full sweep of the generator', () => {
    const faces = new Set<number>();
    for (let i = 0; i < 6; i++) {
      const before = seat(['red', 'blue'], 7);
      const state = rollDie(before, () => i / 6 + 0.001, before.turn.color) as GameState;
      faces.add(state.turn.die!);
    }
    expect([...faces].sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('leaves the state untouched when it refuses', () => {
    const state = seat(['red', 'blue'], 7);
    rollDie(state, always(4), idleColor(state));

    expect(state.turn.die).toBeNull();
    expect(state.events).toEqual([]);
  });
});
