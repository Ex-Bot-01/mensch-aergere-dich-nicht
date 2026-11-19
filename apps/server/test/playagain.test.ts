import { describe, expect, it } from 'vitest';

import { markOut } from '@madn/engine';
import { tick, IDLE_ROOM_TTL_MS } from '../src/lifecycle.js';
import { createStore, createRoom, handleIntent, joinByCode, returnToLobby } from '../src/rooms.js';

/** A finished two-player game: everyone but the winner is marked out. */
function finishedGame(): { code: string; store: ReturnType<typeof createStore> } {
  let clock = 0;
  let drawn = 0;
  // Never repeats, so any two draws prove the game really was re-seeded.
  const store = createStore({ now: () => clock, rand: () => ++drawn / 1000 });

  const room = createRoom(store, { name: 'anna', token: 't-anna' });
  const code = room.code;
  joinByCode(store, code, { name: 'ben', token: 't-ben' });
  joinByCode(store, code, { name: 'cy', token: 't-cy' }); // watching

  handleIntent(store, code, 't-anna', { type: 'pickColor', color: 'red' });
  handleIntent(store, code, 't-ben', { type: 'pickColor', color: 'blue' });
  handleIntent(store, code, 't-anna', { type: 'start' });

  // One player marked out of two leaves a winner, which is all this test needs.
  room.game = markOut(room.game!, 'red') as typeof room.game;
  room.phase = 'finished';
  clock = 500;

  return { code, store };
}

describe('playing again', () => {
  it('gives the host the same table with a fresh game', () => {
    const { code, store } = finishedGame();

    const result = returnToLobby(store, code, 't-anna');
    const snapshot = result.snapshot!;

    expect(result.notice).toBeUndefined();
    expect(snapshot.phase).toBe('lobby');
    expect(snapshot.players.find((p) => p.token === 't-anna')).toMatchObject({
      color: 'red',
      isHost: true,
    });
    expect(snapshot.players.find((p) => p.token === 't-ben')?.color).toBe('blue');
    expect(snapshot.spectators).toContain('t-cy');
  });

  it('clears the board, the outs and the standings', () => {
    const { code, store } = finishedGame();
    const room = store.rooms.get(code)!;
    expect(room.game!.standings).not.toBeNull();

    returnToLobby(store, code, 't-anna');

    expect(room.game!.pieces.every((piece) => piece.loc.startsWith('k:'))).toBe(true);
    expect(room.game!.out).toEqual([]);
    expect(room.game!.standings).toBeNull();
    expect(room.waitingFor).toBeNull();
    expect(room.paused).toBe(false);
  });

  it('draws a new seed, so the next game is not the last one again', () => {
    const { code, store } = finishedGame();
    const room = store.rooms.get(code)!;
    const oldSeed = room.game!.seed;

    returnToLobby(store, code, 't-anna');

    expect(room.game!.seed).not.toBe(oldSeed);
  });

  it('refuses anybody but the host, and changes nothing for them', () => {
    const { code, store } = finishedGame();
    const room = store.rooms.get(code)!;
    const revBefore = room.rev;

    const refused = returnToLobby(store, code, 't-ben');

    expect(refused.notice).toEqual({ code: 'notHost' });
    expect(room.rev).toBe(revBefore);
    expect(room.phase).toBe('finished');
  });

  it('reaches everyone as a snapshot through the normal intent path', () => {
    const { code, store } = finishedGame();

    const result = handleIntent(store, code, 't-anna', { type: 'returnToLobby' });

    expect(result.snapshot?.phase).toBe('lobby');
    expect(result.notice).toBeUndefined();
  });

  it('keeps a finished table alive while somebody is still watching it', () => {
    const { code, store } = finishedGame();
    const room = store.rooms.get(code)!;
    room.lastActivityAt = 0;
    for (const person of [...room.players.values(), ...room.spectators.values()]) {
      person.lastSeenAt = IDLE_ROOM_TTL_MS + 1;
    }

    const closed = tick(store, IDLE_ROOM_TTL_MS + 1);

    expect(closed.map((c) => c.code)).not.toContain(code);
    expect(store.rooms.has(code)).toBe(true);
  });

  it('still closes it once everyone has drifted away', () => {
    const { code, store } = finishedGame();
    const room = store.rooms.get(code)!;
    room.lastActivityAt = 0;
    for (const person of [...room.players.values(), ...room.spectators.values()]) {
      person.connected = false;
      person.lastSeenAt = 0;
    }

    tick(store, IDLE_ROOM_TTL_MS + 1);

    expect(store.rooms.has(code)).toBe(false);
  });
});
