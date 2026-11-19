import { describe, expect, it } from 'vitest';

import { type Color, type Notice, type Snapshot } from '@madn/shared';

import {
  createRoom,
  createStore,
  handleIntent,
  joinByCode,
  leaveRoom,
  makeSnapshot,
  newCode,
} from '../src/rooms.js';

const snap = (result: { snapshot?: Snapshot; notice?: Notice }): Snapshot =>
  result.snapshot as Snapshot;

/** A room with `names.length` people in it, the first of whom is host. */
function opened(names: string[]) {
  const store = createStore();
  const [first, ...rest] = names;
  const created = createRoom(store, { name: first!, token: `t-${first}` });
  for (const name of rest) joinByCode(store, created.code, { name, token: `t-${name}` });
  return { store, room: created, code: created.code };
}

/** Seat the named players in the colors given, in order. */
function seatThem(
  store: ReturnType<typeof createStore>,
  code: string,
  seats: Record<string, Color>,
) {
  for (const [name, color] of Object.entries(seats)) {
    handleIntent(store, code, `t-${name}`, { type: 'pickColor', color });
  }
}

describe('room codes', () => {
  it('are six characters long', () => {
    expect(newCode(() => 0)).toBe('AAAAAA');
    expect(newCode(() => 0.9999)).toHaveLength(6);
  });

  it('never contain a glyph that can be misread over the phone', () => {
    for (let i = 1; i < 500; i++) {
      const code = newCode(() => (Math.sin(i) + 1) / 2);
      expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
    }
  });

  it('are not handed out twice to live rooms', () => {
    const store = createStore();
    const codes = new Set<string>();
    for (let i = 0; i < 50; i++) codes.add(createRoom(store, { name: 'x', token: `t${i}` }).code);
    expect(codes.size).toBe(50);
  });
});

describe('the lobby', () => {
  it('opens with its creator as host and every color free', () => {
    const { room } = opened(['anna']);
    const view = makeSnapshot(room, 't-anna');

    expect(view.phase).toBe('lobby');
    expect(view.hostToken).toBe('t-anna');
    expect(view.players.map((p) => p.color)).toEqual([null]);
    expect(view.game).toBeNull();
  });

  it('gives a color to the first person who takes it', () => {
    const { store, code } = opened(['anna', 'ben']);

    seatThem(store, code, { anna: 'red' });
    const view = snap(handleIntent(store, code, 't-ben', { type: 'pickColor', color: 'blue' }));

    expect(view.players.find((p) => p.token === 't-ben')?.color).toBe('blue');
  });

  it('refuses a color another player is holding', () => {
    const { store, code } = opened(['anna', 'ben']);
    seatThem(store, code, { anna: 'red' });

    const result = handleIntent(store, code, 't-ben', { type: 'pickColor', color: 'red' });

    expect(result.notice).toEqual({ code: 'colorTaken' });
    expect(makeSnapshot(store.rooms.get(code)!, 't-ben').players.find((p) => p.token === 't-ben')?.color).toBeNull();
  });

  it('gives two tabs of the same browser name their own seats', () => {
    const store = createStore();
    const room = createRoom(store, { name: 'anna', token: 'tab-one' });
    joinByCode(store, room.code, { name: 'anna', token: 'tab-two' });

    handleIntent(store, room.code, 'tab-one', { type: 'pickColor', color: 'green' });
    handleIntent(store, room.code, 'tab-two', { type: 'pickColor', color: 'yellow' });

    expect(makeSnapshot(room).players.map((p) => p.color)).toEqual(['green', 'yellow']);
  });

  it('lets a player put their color back', () => {
    const { store, code } = opened(['anna']);
    seatThem(store, code, { anna: 'red' });

    const view = snap(handleIntent(store, code, 't-anna', { type: 'unpick' }));

    expect(view.players[0]?.color).toBeNull();
  });
});

describe('starting the game', () => {
  it('is only for the host', () => {
    const { store, code } = opened(['anna', 'ben']);
    seatThem(store, code, { anna: 'red', ben: 'blue' });

    expect(handleIntent(store, code, 't-ben', { type: 'start' }).notice).toEqual({ code: 'notHost' });
    expect(store.rooms.get(code)!.phase).toBe('lobby');
  });

  it('needs two seated players', () => {
    const { store, code } = opened(['anna', 'ben']);
    seatThem(store, code, { anna: 'red' });

    expect(handleIntent(store, code, 't-anna', { type: 'start' }).notice).toEqual({
      code: 'tooFewPlayers',
    });
  });

  it('seats the players in the order they took their colors and announces the start', () => {
    const { store, code } = opened(['anna', 'ben']);
    seatThem(store, code, { ben: 'blue', anna: 'red' });

    const view = snap(handleIntent(store, code, 't-anna', { type: 'start' }));

    expect(view.phase).toBe('playing');
    expect(view.game?.turnColor).toBeDefined();
    expect(store.rooms.get(code)!.game?.players).toEqual(['blue', 'red']);
    expect(store.rooms.get(code)!.eventsLog.at(-1)?.kind).toBe('started');
  });

  it('moves anyone without a color into the spectators', () => {
    const { store, code } = opened(['anna', 'ben', 'cara']);
    seatThem(store, code, { anna: 'red', ben: 'blue' });

    const view = snap(handleIntent(store, code, 't-anna', { type: 'start' }));

    expect(view.spectators).toEqual(['t-cara']);
  });
});

describe('joining a game already running', () => {
  it('lands the newcomer in the spectators with no color', () => {
    const { store, code } = opened(['anna', 'ben']);
    seatThem(store, code, { anna: 'red', ben: 'blue' });
    handleIntent(store, code, 't-anna', { type: 'start' });

    joinByCode(store, code, { name: 'dan', token: 't-dan' });
    const view = makeSnapshot(store.rooms.get(code)!, 't-dan');

    expect(view.spectators).toContain('t-dan');
    expect(view.players).toHaveLength(2);
  });

  it('refuses their game intents without touching the room', () => {
    const { store, code } = opened(['anna', 'ben']);
    seatThem(store, code, { anna: 'red', ben: 'blue' });
    handleIntent(store, code, 't-anna', { type: 'start' });
    joinByCode(store, code, { name: 'dan', token: 't-dan' });
    const revBefore = store.rooms.get(code)!.rev;

    const result = handleIntent(store, code, 't-dan', { type: 'roll' });

    expect(result.notice).toEqual({ code: 'notAPlayer' });
    expect(store.rooms.get(code)!.rev).toBe(revBefore);
  });

  it('gives a returning player their own color back', () => {
    const { store, code } = opened(['anna', 'ben']);
    seatThem(store, code, { anna: 'red', ben: 'blue' });
    handleIntent(store, code, 't-anna', { type: 'start' });
    leaveRoom(store, code, 't-ben');

    joinByCode(store, code, { name: 'ben', token: 't-ben' });
    const view = makeSnapshot(store.rooms.get(code)!, 't-ben');

    expect(view.players.find((p) => p.token === 't-ben')?.color).toBe('blue');
    expect(view.spectators).toEqual([]);
  });
});

/** A generator that rolls the given faces in order, then repeats the last one. */
const faces = (values: number[]) => {
  let drawn = 0;
  return (): number => {
    const face = values[Math.min(drawn, values.length - 1)]!;
    drawn += 1;
    return (face - 0.5) / 6;
  };
};

describe('playing through the room', () => {
  /** A started two-player room; Anna holds red, Ben holds blue. */
  function playing(...rolls: number[]) {
    const { store, code } = opened(['anna', 'ben']);
    seatThem(store, code, { anna: 'red', ben: 'blue' });
    handleIntent(store, code, 't-anna', { type: 'start' });
    const room = store.rooms.get(code)!;
    room.rng = faces(rolls.length ? rolls : [6]);
    const onTurn = room.game!.turn.color;
    const tokenOf = (color: Color) => (color === 'red' ? 't-anna' : 't-ben');
    const idleToken = tokenOf(onTurn === 'red' ? 'blue' : 'red');
    return { store, code, room, onTurn, idleToken, tokenOf };
  }

  it('rolls for the player on turn and hands them their legal moves', () => {
    const { store, code, onTurn, tokenOf } = playing(6);

    const view = snap(handleIntent(store, code, tokenOf(onTurn), { type: 'roll' }));

    expect(view.game?.die).toBe(6);
    expect(view.game?.stage).toBe('awaitMove');
    expect(view.game?.legalMoves).toHaveLength(1); // the mandatory bring-out
  });

  it('shows those legal moves to the player on turn and nobody else', () => {
    const { store, code, onTurn, idleToken, tokenOf } = playing(6);
    handleIntent(store, code, tokenOf(onTurn), { type: 'roll' });

    expect(makeSnapshot(store.rooms.get(code)!, tokenOf(onTurn)).game!.legalMoves).toHaveLength(1);
    expect(makeSnapshot(store.rooms.get(code)!, idleToken).game!.legalMoves).toEqual([]);
  });

  it('plays the chosen move and, without a six, hands the turn to the next seat', () => {
    const { store, code, onTurn, idleToken, tokenOf } = playing(6, 3);
    handleIntent(store, code, tokenOf(onTurn), { type: 'roll' });
    const bringOut = makeSnapshot(store.rooms.get(code)!, tokenOf(onTurn)).game!.legalMoves[0]!;
    handleIntent(store, code, tokenOf(onTurn), { type: 'move', pieceId: bringOut.pieceId });

    handleIntent(store, code, tokenOf(onTurn), { type: 'roll' });
    const advance = makeSnapshot(store.rooms.get(code)!, tokenOf(onTurn)).game!.legalMoves[0]!;
    const view = snap(
      handleIntent(store, code, tokenOf(onTurn), { type: 'move', pieceId: advance.pieceId }),
    );

    expect(view.game!.pieces.find((p) => p.id === advance.pieceId)?.loc).toBe(advance.to);
    expect(view.game!.turnColor).toBe(idleToken === 't-anna' ? 'red' : 'blue');
  });

  it('refuses a roll from the wrong color without changing anything', () => {
    const { store, code, idleToken } = playing(6);
    const revBefore = store.rooms.get(code)!.rev;

    expect(handleIntent(store, code, idleToken, { type: 'roll' }).notice).toEqual({
      code: 'notYourTurn',
    });
    expect(store.rooms.get(code)!.rev).toBe(revBefore);
  });

  it('passes the turn itself when the roll leaves nothing to play', () => {
    const { store, code, onTurn, tokenOf } = playing(1);

    const view = snap(handleIntent(store, code, tokenOf(onTurn), { type: 'roll' }));

    expect(view.game!.legalMoves).toEqual([]);
    expect(store.rooms.get(code)!.eventsLog.map((e) => e.kind)).toContain('passed');
    expect(view.game!.turnColor).not.toBe(onTurn);
  });
});

describe('two rooms on one server', () => {
  it('do not see each other at all', () => {
    const store = createStore();
    const first = createRoom(store, { name: 'anna', token: 't-anna' });
    const second = createRoom(store, { name: 'ben', token: 't-ben' });
    joinByCode(store, first.code, { name: 'cara', token: 't-cara' });
    joinByCode(store, second.code, { name: 'dan', token: 't-dan' });
    seatThem(store, first.code, { anna: 'red', cara: 'blue' });
    handleIntent(store, first.code, 't-anna', { type: 'start' });

    const revBefore = second.rev;
    handleIntent(store, first.code, 't-anna', { type: 'roll' });

    expect(second.rev).toBe(revBefore);
    expect(second.game).toBeNull();
    expect(first.players.size).toBe(2);
  });
});
