import {
  activePlayers,
  appendEvent,
  applyMove as engineApplyMove,
  createGame,
  legalMoves,
  makeRng,
  markOut,
  passTurn,
  rollDie,
  type GameState,
  type Move,
  type Rng,
} from '@madn/engine';
import {
  type Color,
  type EventItem,
  type GamePhase,
  type GameView,
  type Intent,
  type MoveView,
  type Notice,
  type PlayerView,
  type Snapshot,
} from '@madn/shared';

import { newCode } from './codes.js';

/** How many happenings a snapshot carries for clients to animate. */
export const EVENT_LOG_LEN = 12;

export type Player = {
  token: string;
  name: string;
  color: Color | null;
  connected: boolean;
  /** The last time this person's socket proved they were there. */
  lastSeenAt: number;
};

export type Spectator = { token: string; name: string; connected: boolean; lastSeenAt: number };

export type Room = {
  code: string;
  phase: GamePhase;
  hostToken: string;
  /** Everyone who has a seat or is waiting for one, by token. */
  players: Map<string, Player>;
  /** Watching only: no seat, no say, cannot affect state. */
  spectators: Map<string, Spectator>;
  /** Colors in the order they were taken — this is also turn order. */
  seatOrder: Color[];
  /** Seats a person left behind, so closing a tab and coming back returns them. */
  abandoned: Map<string, Color>;
  game: GameState | null;
  rng: Rng | null;
  rev: number;
  eventsLog: EventItem[];
  paused: boolean;
  waitingFor: Color | null;
  createdAt: number;
  lastActivityAt: number;
};

export type Store = { rooms: Map<string, Room>; now: () => number; rand: () => number };

export function createStore(opts: { now?: () => number; rand?: () => number } = {}): Store {
  return { rooms: new Map(), now: opts.now ?? (() => Date.now()), rand: opts.rand ?? Math.random };
}

function colorOf(room: Room, token: string): Color | null {
  return room.players.get(token)?.color ?? null;
}

export function playerByColor(room: Room, color: Color): Player | undefined {
  for (const player of room.players.values()) if (player.color === color) return player;
  return undefined;
}

/** Open a room with one person in it: the host, who has not taken a color yet. */
export function createRoom(
  store: Store,
  opts: { name: string; token: string; code?: string },
): Room {
  let code = opts.code ?? newCode(store.rand);
  while (store.rooms.has(code)) code = newCode(store.rand);

  const room: Room = {
    code,
    phase: 'lobby',
    hostToken: opts.token,
    players: new Map([
      [
        opts.token,
        {
          token: opts.token,
          name: opts.name,
          color: null,
          connected: true,
          lastSeenAt: store.now(),
        },
      ],
    ]),
    spectators: new Map(),
    seatOrder: [],
    abandoned: new Map(),
    game: null,
    rng: null,
    rev: 1,
    eventsLog: [],
    paused: false,
    waitingFor: null,
    createdAt: store.now(),
    lastActivityAt: store.now(),
  };
  store.rooms.set(code, room);
  return room;
}

/** Come back to a room, or join it. Known tokens get their seat back; latecomers watch. */
export function joinByCode(
  store: Store,
  code: string,
  opts: { name: string; token: string },
): { room?: Room; notice?: Notice } {
  const room = store.rooms.get(code);
  if (!room) return { notice: { code: 'unknownCode' } };
  room.lastActivityAt = store.now();

  const known = room.players.get(opts.token) ?? room.spectators.get(opts.token);
  if (known) {
    known.connected = true;
    known.name = opts.name;
    known.lastSeenAt = store.now();
    return { room };
  }

  const reclaimed = room.abandoned.get(opts.token);
  if (reclaimed && !playerByColor(room, reclaimed)) {
    room.abandoned.delete(opts.token);
    room.players.set(opts.token, {
      token: opts.token,
      name: opts.name,
      color: reclaimed,
      connected: true,
      lastSeenAt: store.now(),
    });
    return { room };
  }

  const player: Player = {
    token: opts.token,
    name: opts.name,
    color: null,
    connected: true,
    lastSeenAt: store.now(),
  };
  if (room.phase === 'lobby') room.players.set(opts.token, player);
  else room.spectators.set(opts.token, { ...player });
  return { room };
}

/** Someone left for good: their seat is remembered, the host role moves on. */
export function leaveRoom(store: Store, code: string, token: string): void {
  const room = store.rooms.get(code);
  if (!room) return;
  room.lastActivityAt = store.now();

  const leaving = room.players.get(token);
  room.players.delete(token);
  room.spectators.delete(token);
  if (leaving?.color) room.abandoned.set(token, leaving.color);

  if (room.hostToken === token) {
    const heir =
      room.seatOrder.map((color) => playerByColor(room, color)).find((p) => p !== undefined) ??
      room.players.values().next().value;
    room.hostToken = heir?.token ?? '';
  }
}

/** Apply one intent from one token. Refusals change nothing and return a notice. */
export function handleIntent(
  store: Store,
  code: string,
  token: string,
  intent: Intent,
): { snapshot?: Snapshot; notice?: Notice } {
  const room = store.rooms.get(code);
  if (!room) return { notice: { code: 'unknownCode' } };
  room.lastActivityAt = store.now();
  if (intent.type === 'returnToLobby') return returnToLobby(store, code, token);

  const failure = apply(room, token, intent, store);
  if (failure) return { notice: failure };

  room.rev += 1;
  room.eventsLog = room.game ? room.game.events.slice(-EVENT_LOG_LEN) : [];
  return { snapshot: makeSnapshot(room, token) };
}

function apply(room: Room, token: string, intent: Intent, store: Store): Notice | null {
  if (room.paused && (intent.type === 'roll' || intent.type === 'move')) return { code: 'paused' };

  switch (intent.type) {
    case 'rename': {
      const who = room.players.get(token) ?? room.spectators.get(token);
      if (!who) return { code: 'notAPlayer' };
      who.name = intent.name;
      return null;
    }

    case 'pickColor': {
      const player = room.players.get(token);
      if (!player) return { code: 'notAPlayer' };
      if (room.phase !== 'lobby') return { code: 'wrongPhase' };
      const holder = playerByColor(room, intent.color);
      if (holder && holder.token !== token) return { code: 'colorTaken' };
      if (player.color && player.color !== intent.color) {
        room.seatOrder = room.seatOrder.filter((color) => color !== player.color);
      }
      player.color = intent.color;
      if (!room.seatOrder.includes(intent.color)) room.seatOrder.push(intent.color);
      return null;
    }

    case 'unpick': {
      const player = room.players.get(token);
      if (!player) return { code: 'notAPlayer' };
      if (room.phase !== 'lobby') return { code: 'wrongPhase' };
      if (player.color) room.seatOrder = room.seatOrder.filter((color) => color !== player.color);
      player.color = null;
      return null;
    }

    case 'start': {
      if (room.phase !== 'lobby') return { code: 'wrongPhase' };
      if (room.hostToken !== token) return { code: 'notHost' };
      if (room.seatOrder.length < 2) return { code: 'tooFewPlayers' };

      const seed = Math.floor(store.rand() * 2 ** 31);
      const rng = makeRng(seed);
      room.game = appendEvent(
        createGame({ colors: [...room.seatOrder], hostColor: colorOf(room, room.hostToken), seed }, rng),
        'started',
        { colors: [...room.seatOrder] },
      );
      room.rng = rng;
      room.phase = 'playing';

      for (const [who, player] of [...room.players]) {
        if (player.color) continue;
        room.players.delete(who);
        room.spectators.set(who, player);
      }
      return null;
    }

    case 'roll':
    case 'move': {
      const playing = gameOf(room);
      if ('notice' in playing) return playing.notice;
      const color = colorOf(room, token);
      if (!color) return { code: 'notAPlayer' };

      if (intent.type === 'roll') {
        const rolled = rollDie(playing.game, room.rng!, color);
        if ('code' in rolled) return rolled;
        room.game = rolled;
        // Nothing to play: the server passes straight on and lets clients animate it.
        if (legalMoves(room.game).length === 0) room.game = passTurn(room.game);
        return null;
      }

      const move = legalMoves(playing.game).find((m) => m.pieceId === intent.pieceId);
      if (!move) return { code: 'illegalMove' };
      const applied = engineApplyMove(playing.game, move, color);
      if ('code' in applied) return applied;
      room.game = applied;
      if (applied.phase === 'finished') room.phase = 'finished';
      return null;
    }

    case 'forceContinue': {
      const playing = gameOf(room);
      if ('notice' in playing) return playing.notice;
      if (!room.players.get(token)?.connected) return { code: 'notAPlayer' };

      const marked = markOut(playing.game, intent.color);
      if ('code' in marked) return marked;
      room.game = marked;
      room.paused = false;
      room.waitingFor = null;
      if (marked.phase === 'finished') room.phase = 'finished';
      return null;
    }

    default:
      return { code: 'wrongPhase', detail: (intent as { type: string }).type };
  }
}

/**
 * Same people, same colors, new game. The host starts it again; everyone else keeps
 * their seat and the marked-out player gets their color back.
 */
export function returnToLobby(
  store: Store,
  code: string,
  byToken: string,
): { snapshot?: Snapshot; notice?: Notice } {
  const room = store.rooms.get(code);
  if (!room) return { notice: { code: 'unknownCode' } };
  if (room.hostToken !== byToken) return { notice: { code: 'notHost' } };
  if (!room.game || room.phase === 'lobby') {
    return { notice: { code: 'wrongPhase', detail: 'already in the lobby' } };
  }

  const seed = Math.floor(store.rand() * 2 ** 31);
  const rng = makeRng(seed);
  room.game = appendEvent(
    createGame({ colors: [...room.seatOrder], hostColor: colorOf(room, room.hostToken), seed }, rng),
    'started',
    { colors: [...room.seatOrder] },
  );
  room.rng = rng;
  room.phase = 'lobby';
  room.paused = false;
  room.waitingFor = null;
  room.lastActivityAt = store.now();
  room.rev += 1;
  room.eventsLog = room.game.events.slice(-EVENT_LOG_LEN);

  return { snapshot: makeSnapshot(room, byToken) };
}

function gameOf(room: Room): { game: GameState } | { notice: Notice } {
  if (!room.game) return { notice: { code: 'notStarted' } };
  if (room.phase !== 'playing') return { notice: { code: 'finished' } };
  return { game: room.game };
}

const asViews = (moves: Move[]): MoveView[] =>
  moves.map((m) => ({ pieceId: m.pieceId, from: m.from, to: m.to, capture: m.capture }));

/** What one browser is allowed to see. Legal moves only reach the player on turn. */
export function makeSnapshot(room: Room, forToken?: string): Snapshot {
  const seated = room.seatOrder
    .map((color) => playerByColor(room, color))
    .filter((player): player is Player => player !== undefined);
  const unseated = [...room.players.values()].filter((player) => !player.color);

  const players: PlayerView[] = [...seated, ...unseated].map((player) => ({
    token: player.token,
    name: player.name,
    color: player.color,
    connected: player.connected,
    out: player.color !== null && (room.game?.out.includes(player.color) ?? false),
    isHost: player.token === room.hostToken,
  }));

  const viewerColor = forToken ? colorOf(room, forToken) : null;
  let game: GameView | null = null;
  if (room.game) {
    const showMoves =
      room.game.turn.stage === 'awaitMove' && room.game.turn.color === viewerColor;
    game = {
      turnColor: room.game.turn.color,
      stage: room.game.turn.stage,
      die: room.game.turn.die,
      legalMoves: showMoves ? asViews(legalMoves(room.game)) : [],
      pieces: room.game.pieces.map((piece) => ({
        id: piece.id,
        color: piece.color,
        loc: piece.loc,
      })),
      standings: room.game.standings,
    };
  }

  return {
    rev: room.rev,
    phase: room.phase,
    code: room.code,
    hostToken: room.hostToken,
    paused: room.paused,
    waitingFor: room.waitingFor,
    players,
    spectators: [...room.spectators.keys()],
    game,
    events: room.eventsLog,
    notice: null,
  };
}

export { activePlayers };
export { newCode } from './codes.js';
