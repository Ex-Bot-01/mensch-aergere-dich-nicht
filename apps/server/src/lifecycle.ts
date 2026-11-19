import type { Color, GamePhase, Notice, Snapshot } from '@madn/shared';

import { handleIntent, playerByColor, type Room, type Store } from './rooms.js';

/** How often the server asks each socket whether it is still there. */
export const HEARTBEAT_MS = 15_000;
/** Two missed answers: on mobile data a dead socket can look alive for minutes. */
export const GONE_AFTER_MS = 30_000;
/** A room nobody is attached to at all. */
export const EMPTY_ROOM_TTL_MS = 15 * 60_000;
/** A table with people at it that has seen no intent from anyone for this long. */
export const IDLE_ROOM_TTL_MS = 30 * 60_000;

export type ClosedRoom = { code: string; phase: GamePhase; players: number };

function seated(room: Room): { color: Color; connected: boolean }[] {
  return room.seatOrder
    .map((color) => ({ color, player: playerByColor(room, color) }))
    .filter((seat): seat is { color: Color; player: NonNullable<typeof seat.player> } => !!seat.player)
    .map((seat) => ({ color: seat.color, connected: seat.player.connected }));
}

/** The table waits for the first seat, in turn order, that nobody is home at. */
function recomputePause(room: Room): void {
  if (room.phase !== 'playing' || !room.game) {
    room.paused = false;
    room.waitingFor = null;
    return;
  }
  const out = room.game.out;
  const waiting = seated(room).find(
    (seat) => !seat.connected && !out.includes(seat.color),
  );

  room.paused = waiting !== undefined;
  room.waitingFor = waiting?.color ?? null;
}

function setConnected(store: Store, code: string, token: string, now: number, value: boolean): void {
  const room = store.rooms.get(code);
  if (!room) return;
  const who = room.players.get(token) ?? room.spectators.get(token);
  if (!who) return;

  who.connected = value;
  who.lastSeenAt = now;
  recomputePause(room);
}

/** A socket closed: stop believing this person is there, and wait for them if needed. */
export function markDisconnected(store: Store, code: string, token: string, now: number): void {
  setConnected(store, code, token, now, false);
}

/** A socket came back — or answered a ping, which means the same thing. */
export function markConnected(store: Store, code: string, token: string, now: number): void {
  setConnected(store, code, token, now, true);
}

/** What the websocket layer calls when a pong arrives. */
export const beat = markConnected;

/** Any human — host or not — can end a stalled friend's game so play resumes. */
export function forceContinue(
  store: Store,
  code: string,
  byToken: string,
  targetColor: Color,
): { snapshot?: Snapshot; notice?: Notice } {
  return handleIntent(store, code, byToken, { type: 'forceContinue', color: targetColor });
}

/**
 * One periodic sweep: declare quiet sockets gone, pause tables that are waiting on
 * somebody, and close rooms that have outlived their evening.
 */
export function tick(store: Store, now: number): ClosedRoom[] {
  const closed: ClosedRoom[] = [];

  for (const [code, room] of [...store.rooms]) {
    const everyone = [...room.players.values(), ...room.spectators.values()];

    for (const person of everyone) {
      if (person.connected && now - person.lastSeenAt > GONE_AFTER_MS) {
        person.connected = false;
      }
    }
    recomputePause(room);

    const attached = everyone.some((person) => person.connected);
    const idleFor = now - room.lastActivityAt;
    // A finished table with people at it is not idle: they are reading the standings.
    const watched = attached && room.phase === 'finished';
    if (
      (!attached && idleFor > EMPTY_ROOM_TTL_MS) ||
      (idleFor > IDLE_ROOM_TTL_MS && !watched)
    ) {
      closed.push({ code, phase: room.phase, players: room.players.size });
      store.rooms.delete(code);
    }
  }

  return closed;
}
