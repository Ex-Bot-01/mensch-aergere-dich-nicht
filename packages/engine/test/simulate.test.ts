import { describe, expect, it } from 'vitest';

import type { Color } from '@madn/shared';

import { playRandomGame, type SimResult } from '../src/simulate.js';

const LINEUPS: Color[][] = [
  ['red', 'blue'],
  ['red', 'blue', 'green'],
  ['red', 'blue', 'green', 'yellow'],
];

const SEEDS = Array.from({ length: 500 }, (_, seed) => seed);

type Game = { seed: number } & SimResult;

/** Play each lineup's five hundred games once, then assert several things about them. */
const playedCache = new Map<string, Game[]>();

function playAll(players: Color[]): Game[] {
  const key = players.join(',');
  const cached = playedCache.get(key);
  if (cached) return cached;
  const games = SEEDS.map((seed) => ({ seed, ...playRandomGame({ colors: players, seed }) }));
  playedCache.set(key, games);
  return games;
}

const describeGame = (game: Game) => `seed ${game.seed} (${game.turns} rolls)`;

describe('bot-played games', () => {
  for (const players of LINEUPS) {
    it(`finishes every ${players.length}-player game across five hundred seeds`, () => {
      for (const game of playAll(players)) {
        expect(game.state.phase, describeGame(game)).toBe('finished');
        expect(game.state.standings, describeGame(game)).toHaveLength(players.length);
        expect(game.turns, describeGame(game)).toBeLessThan(50_000);
      }
    });

    it(`ranks a real winner first in every ${players.length}-player game`, () => {
      for (const game of playAll(players)) {
        const winner = game.state.standings?.[0];

        expect(winner?.rank, describeGame(game)).toBe(1);
        expect(winner?.finished, describeGame(game)).toBe(4);
      }
    });
  }

  it('replays a fixed seed to an identical final board', () => {
    const once = playRandomGame({ colors: LINEUPS[2]!, seed: 77 });
    const twice = playRandomGame({ colors: LINEUPS[2]!, seed: 77 });

    expect(structuredClone(twice.state)).toEqual(structuredClone(once.state));
  });

  it('still advances the turn while a player cannot do anything', () => {
    const passes = SEEDS.slice(0, 40).reduce((total, seed) => {
      const { state } = playRandomGame({ colors: LINEUPS[2]!, seed });
      return total + state.events.filter((e) => e.kind === 'passed').length;
    }, 0);

    expect(passes).toBeGreaterThan(0);
  });

  it('keeps the whole game log inside the engine event counter', () => {
    const { state } = playRandomGame({ colors: LINEUPS[1]!, seed: 5 });
    const ids = state.events.map((e) => e.id);

    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    expect(new Set(ids).size).toBe(ids.length);
  });
});
