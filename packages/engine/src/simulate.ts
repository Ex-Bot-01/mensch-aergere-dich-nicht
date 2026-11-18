import type { Color } from '@madn/shared';

import { applyMove, passTurn } from './apply.js';
import { assertInvariants } from './invariants.js';
import { legalMoves, type Move } from './moves.js';
import { makeRng, type Rng } from './rng.js';
import { createGame, rollDie, type GameState } from './state.js';

/** A random game that outlasts this is a bug, not a long evening. */
export const MAX_TURNS = 50_000;

export type Picker = (moves: Move[], state: GameState, rng: Rng) => Move;

export type SimResult = { state: GameState; turns: number; rolls: number };

/** Pick uniformly — deterministic, because it draws from the game's own generator. */
export const randomPick: Picker = (moves, _state, rng) => moves[Math.floor(rng() * moves.length)]!;

/**
 * Play a whole game with legal-but-mindless bots, checking the invariants after every
 * roll and every move. This is what proves the rules engine terminates.
 */
export function playRandomGame(opts: { colors: Color[]; seed: number; pick?: Picker }): SimResult {
  const rng = makeRng(opts.seed);
  const pick = opts.pick ?? randomPick;
  let state = createGame(
    { colors: [...opts.colors], hostColor: opts.colors[0]!, seed: opts.seed },
    rng,
  );
  let turns = 0;
  let rolls = 0;

  while (state.phase === 'playing') {
    if (++turns > MAX_TURNS) throw new Error(`no winner within ${MAX_TURNS} rolls`);

    const rolled = rollDie(state, rng, state.turn.color);
    if ('code' in rolled) throw new Error(`roll refused: ${rolled.code}`);
    rolls += 1;
    assertInvariants(rolled);

    const moves = legalMoves(rolled);
    let next: GameState;
    if (moves.length === 0) {
      next = passTurn(rolled);
    } else {
      const applied = applyMove(rolled, pick(moves, rolled, rng), rolled.turn.color);
      if ('code' in applied) throw new Error(`legal move refused: ${applied.code}`);
      next = applied;
    }

    assertInvariants(next);
    state = next;
  }

  return { state, turns, rolls };
}
