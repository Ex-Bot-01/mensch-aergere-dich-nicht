import { describe, expect, it } from 'vitest';

import type { Color, Snapshot } from '@madn/shared';

import {
  createRoom,
  playerByColor,
  createStore,
  handleIntent,
  joinByCode,
  leaveRoom,
  makeSnapshot,
  type Store,
} from '../src/rooms.js';
import {
  EMPTY_ROOM_TTL_MS,
  GONE_AFTER_MS,
  HEARTBEAT_MS,
  IDLE_ROOM_TTL_MS,
  beat,
  forceContinue,
  markConnected,
  markDisconnected,
  tick,
} from '../src/lifecycle.js';

const MINUTE = 60_000;

/** A started table: Anna hosts and takes the first color, then Ben, then Cara. */
function table(seats: [string, Color][] = [['anna', 'red'], ['ben', 'blue']]) {
  const store = createStore({ now: () => 0, rand: () => 0 });
  const room = createRoom(store, { name: seats[0]![0], token: `t-${seats[0]![0]}` });
  for (const [name] of seats.slice(1)) joinByCode(store, room.code, { name, token: `t-${name}` });
  for (const [name, color] of seats) {
    handleIntent(store, room.code, `t-${name}`, { type: 'pickColor', color });
  }
  handleIntent(store, room.code, `t-${seats[0]![0]}`, { type: 'start' });
  return { store, code: room.code };
}

const view = (store: Store, code: string): Snapshot => makeSnapshot(store.rooms.get(code)!);

/** Whoever the engine says is on turn, seat order be damned. */
function tokenOnTurn(store: Store, code: string): string {
  const room = store.rooms.get(code)!;
  return playerByColor(room, room.game!.turn.color)!.token;
}

/** Keep everyone's socket alive at `now`, the way a pong would. */
function allBeat(store: Store, code: string, now: number): void {
  for (const player of store.rooms.get(code)!.players.keys()) beat(store, code, player, now);
}

describe('heartbeat and pausing', () => {
  it('still believes in a player who has been quiet for less than the timeout', () => {
    const { store, code } = table();

    tick(store, GONE_AFTER_MS - 1_000);

    expect(store.rooms.get(code)!.paused).toBe(false);
    expect(store.rooms.get(code)!.players.get('t-ben')?.connected).toBe(true);
  });

  it('pauses the table when players go quiet past the timeout', () => {
    const { store, code } = table();

    tick(store, GONE_AFTER_MS + 1_000);
    const snapshot = view(store, code);

    expect(snapshot.paused).toBe(true);
    expect(snapshot.waitingFor).toBe('red');
    expect(makeSnapshot(store.rooms.get(code)!, 't-ben').waitingFor).toBe('red');
  });

  it('refuses rolls while paused and accepts them again when the player returns', () => {
    const { store, code } = table();
    // Every roll is a six from here on, so there is always something to play and the
    // turn can only move by a rule, never by an accident of the die.
    store.rooms.get(code)!.rng = () => (6 - 0.5) / 6;
    const turnBefore = view(store, code).game!.turnColor;
    markDisconnected(store, code, 't-ben', 0);
    const onTurn = tokenOnTurn(store, code);

    expect(handleIntent(store, code, onTurn, { type: 'roll' }).notice).toEqual({ code: 'paused' });

    markConnected(store, code, 't-ben', 1_000);
    const roll = handleIntent(store, code, onTurn, { type: 'roll' });

    expect(roll.notice).toBeUndefined();
    expect(roll.snapshot?.paused).toBe(false);
    expect(roll.snapshot?.waitingFor).toBeNull();
    expect(roll.snapshot?.game!.turnColor).toBe(turnBefore);
  });

  it('pauses the moment a socket closes, without waiting for the timeout', () => {
    const { store, code } = table();

    markDisconnected(store, code, 't-ben', 1_000);

    expect(view(store, code).paused).toBe(true);
    expect(view(store, code).waitingFor).toBe('blue');
  });
});

describe('force continue', () => {
  it('is allowed from any connected human, host or not', () => {
    const { store, code } = table();
    markDisconnected(store, code, 't-anna', 1_000); // the host is the one who vanished

    const result = forceContinue(store, code, 't-ben', 'red');

    expect(result.snapshot?.paused).toBe(false);
    expect(store.rooms.get(code)!.game!.out).toEqual(['red']);
  });

  it('refuses a color that has already been marked out', () => {
    const { store, code } = table([
      ['anna', 'red'],
      ['ben', 'blue'],
      ['cara', 'green'],
    ]);
    forceContinue(store, code, 't-ben', 'blue');

    expect(forceContinue(store, code, 't-anna', 'blue').notice).toEqual({
      code: 'notAPlayer',
      detail: 'already out',
    });
  });

  it('is refused from a spectator', () => {
    const { store, code } = table();
    joinByCode(store, code, { name: 'dan', token: 't-dan' });

    expect(forceContinue(store, code, 't-dan', 'red').notice).toEqual({ code: 'notAPlayer' });
  });
});

describe('hosting', () => {
  it('does not move the host role when the host merely drops', () => {
    const { store, code } = table();

    markDisconnected(store, code, 't-anna', 1_000);

    expect(view(store, code).hostToken).toBe('t-anna');
  });

  it('passes the role to the next player in seat order when the host leaves', () => {
    const { store, code } = table();

    leaveRoom(store, code, 't-anna');

    expect(view(store, code).hostToken).toBe('t-ben');
  });
});

describe('room death', () => {
  it('closes a room nobody has been attached to for fifteen minutes', () => {
    const { store, code } = table();
    markDisconnected(store, code, 't-anna', 0);
    markDisconnected(store, code, 't-ben', 0);

    const closed = tick(store, EMPTY_ROOM_TTL_MS + 1);

    expect(closed.map((room) => room.code)).toEqual([code]);
    expect(store.rooms.has(code)).toBe(false);
  });

  it('closes an idle table with people still attached after thirty minutes', () => {
    const { store, code } = table();
    const soon = EMPTY_ROOM_TTL_MS + 1;
    allBeat(store, code, soon);

    expect(tick(store, soon)).toEqual([]);

    const late = IDLE_ROOM_TTL_MS + 1;
    allBeat(store, code, late);

    expect(tick(store, late).map((room) => room.code)).toEqual([code]);
  });

  it('leaves a table alone while somebody is playing at it', () => {
    const { store, code } = table();
    handleIntent(store, code, 't-anna', { type: 'roll' });
    const later = IDLE_ROOM_TTL_MS - MINUTE;
    allBeat(store, code, later);

    tick(store, later);

    expect(store.rooms.has(code)).toBe(true);
  });
});

describe('the heartbeat interval', () => {
  it('is shorter than the timeout that declares someone gone', () => {
    expect(HEARTBEAT_MS).toBeLessThan(GONE_AFTER_MS);
    expect(GONE_AFTER_MS).toBeLessThan(EMPTY_ROOM_TTL_MS);
    expect(EMPTY_ROOM_TTL_MS).toBeLessThan(IDLE_ROOM_TTL_MS);
  });
});
