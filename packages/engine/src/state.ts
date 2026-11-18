import type { Color, EventItem, EventKind, FieldId, NoticeCode, Standing } from '@madn/shared';

import { makeRng, rollValue, type Rng } from './rng.js';

export type { Rng } from './rng.js';
export type { DieValue } from './rng.js';

/** A piece. Its id never changes: `<color>:<corner slot>`, assigned before it ever moves. */
export type Piece = { id: string; color: Color; loc: FieldId };

export type Turn = { color: Color; stage: 'awaitRoll' | 'awaitMove'; die: number | null };

/** A refused intent. Codes are shared with the browser so it can word the message. */
export type EngineError = { code: NoticeCode; detail?: string };

export type GameState = {
  seed: number;
  /** Seat order, which is also turn order. */
  players: Color[];
  phase: 'playing' | 'finished';
  turn: Turn;
  pieces: Piece[];
  events: EventItem[];
  nextEventId: number;
  standings: Standing[] | null;
  /** Colors removed by force continue; they are no longer players in play. */
  out: Color[];
};

export const CORNER_SLOTS = [0, 1, 2, 3] as const;

/** Colors still in play, in seat order. A marked-out color is no longer a player. */
export function activePlayers(state: GameState): Color[] {
  return state.players.filter((color) => !state.out.includes(color));
}

export function cornerId(color: Color, slot: number): FieldId {
  return `k:${color}:${slot}`;
}

/**
 * Start a game. `rng` is the game's one generator — pass the room's so the starting-color
 * draw and the dice sequence share a stream. Omit it for tests that only need determinism.
 */
export function createGame(
  opts: { colors: Color[]; hostColor: Color | null; seed: number },
  rng: Rng = makeRng(opts.seed),
): GameState {
  const pick = Math.floor(rng() * opts.colors.length);
  const start = opts.colors[Math.min(pick, opts.colors.length - 1)]!;

  return {
    seed: opts.seed,
    players: [...opts.colors],
    phase: 'playing',
    turn: { color: start, stage: 'awaitRoll', die: null },
    pieces: opts.colors.flatMap((color) =>
      CORNER_SLOTS.map((slot) => ({ id: `${color}:${slot}`, color, loc: cornerId(color, slot) })),
    ),
    events: [],
    nextEventId: 1,
    standings: null,
    out: [],
  };
}

/** Append to the game's event log. Ids come from here and nowhere else. */
export function appendEvent(
  state: GameState,
  kind: EventKind,
  payload: Record<string, unknown> = {},
): GameState {
  return {
    ...state,
    events: [...state.events, { id: state.nextEventId, kind, payload }],
    nextEventId: state.nextEventId + 1,
  };
}

/** The active player rolls. Only they may, and only once per turn. */
export function rollDie(
  state: GameState,
  rng: Rng,
  byColor: Color,
): GameState | EngineError {
  if (state.phase !== 'playing') return { code: 'finished' };
  if (!state.players.includes(byColor) || state.out.includes(byColor)) {
    return { code: 'notAPlayer' };
  }
  if (state.turn.color !== byColor) return { code: 'notYourTurn' };
  if (state.turn.stage !== 'awaitRoll') return { code: 'alreadyRolled' };

  const value = rollValue(rng);
  const rolled: GameState = {
    ...state,
    turn: { ...state.turn, die: value, stage: 'awaitMove' },
  };
  return appendEvent(rolled, 'rolled', { color: byColor, value });
}
