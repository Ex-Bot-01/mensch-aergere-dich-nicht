import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

import type { Notice, ServerMessage, Snapshot } from '@madn/shared';

import { startServer, type Running } from '../src/main.js';

/** A browser in miniature: one socket, one remembered token, a queue of what arrived. */
class Client {
  readonly messages: ServerMessage[] = [];
  private waiters: ((message: ServerMessage) => void)[] = [];

  constructor(
    readonly token: string,
    private readonly ws: WebSocket,
  ) {
    ws.on('message', (raw) => {
      const message = JSON.parse(String(raw)) as ServerMessage;
      this.messages.push(message);
      this.waiters.shift()?.(message);
    });
  }

  next(timeoutMs = 2_000): Promise<ServerMessage> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`nothing arrived for ${this.token}`)), timeoutMs);
      this.waiters.push((message) => {
        clearTimeout(timer);
        resolve(message);
      });
    });
  }

  send(message: unknown): void {
    this.ws.send(JSON.stringify(message));
  }

  /** The newest snapshot seen, however it arrived. */
  get last(): Snapshot | undefined {
    const found = [...this.messages].reverse().find((m) => m.type === 'snapshot');
    return found?.type === 'snapshot' ? found.snapshot : undefined;
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      this.ws.once('close', () => resolve());
      this.ws.close();
    });
  }
}

/** Read until a snapshot says the thing the test is waiting for. */
async function until(
  client: Client,
  ready: (snapshot: Snapshot) => boolean,
  what: string,
): Promise<Snapshot> {
  for (;;) {
    let message: ServerMessage;
    try {
      message = await client.next();
    } catch (error) {
      const seen = client.messages.map((m) => (m.type === 'snapshot' ? `s${m.snapshot.rev}:${m.snapshot.phase}` : '!')).join(',');
      throw new Error(`waiting for ${what}; arrived [${seen}]`);
    }
    if (message.type === 'notice') continue;
    if (ready(message.snapshot)) return message.snapshot;
  }
}

async function untilNotice(client: Client): Promise<Notice> {
  for (;;) {
    const message = await client.next();
    if (message.type === 'notice') return message.notice;
  }
}

async function connect(port: number, code: string, token: string, name: string): Promise<Client> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  await new Promise<void>((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });

  const client = new Client(token, ws);
  client.send({ type: 'hello', code, token, name });
  await until(client, () => true, 'the first snapshot');
  return client;
}

type Access = { code: string; token: string };

async function post<T>(port: number, path: string, body: unknown): Promise<T> {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return (await response.json()) as T;
}

const create = (port: number, name: string) => post<Access>(port, '/api/create', { name });
const join = (port: number, code: string, name: string) =>
  post<Access>(port, '/api/join', { code, name });

const seat = (color: string) => ({ type: 'intent', intent: { type: 'pickColor', color } });
const intent = (type: string, extra: Record<string, unknown> = {}) => ({
  type: 'intent',
  intent: { type, ...extra },
});

/** Two people in a room with colors picked, one of them host. */
async function twoAtATable(port: number, first: string, second: string, colors: [string, string]) {
  const created = await create(port, first);
  const joined = await join(port, created.code, second);

  const host = await connect(port, created.code, created.token, first);
  const guest = await connect(port, created.code, joined.token, second);

  host.send(seat(colors[0]));
  await until(host, (s) => s.players.some((p) => p.color === colors[0]), `${first} seated`);
  guest.send(seat(colors[1]));
  await until(guest, (s) => s.players.some((p) => p.color === colors[1]), `${second} seated`);

  host.send(intent('start'));
  const started = await until(host, (s) => s.phase === 'playing', 'the game starting');
  await until(guest, (s) => s.phase === 'playing', `${second} seeing it start`);

  return { host, guest, started, code: created.code };
}

describe('a game over websockets', () => {
  let server: Running;
  let port: number;

  beforeAll(async () => {
    server = await startServer({ port: 0, webRoot: 'apps/web/dist' });
    port = server.port;
  });

  afterAll(async () => {
    await server.close();
  });

  it('takes friends from a code to a played move, telling everyone about it', async () => {
    const { host, guest, started, code } = await twoAtATable(port, 'anna', 'ben', ['red', 'blue']);
    const room = server.store.rooms.get(code)!;
    room.rng = () => (6 - 0.5) / 6; // every roll is a six: there is always something to play

    expect(started.game?.stage).toBe('awaitRoll');

    const roller = started.game!.turnColor === 'red' ? host : guest;
    const watcher = roller === host ? guest : host;

    roller.send(intent('roll'));
    const rolled = await until(roller, (s) => s.game?.die === 6, 'a six');
    expect(rolled.game?.stage).toBe('awaitMove');
    expect(rolled.game?.legalMoves).toHaveLength(1);

    await until(watcher, (s) => s.game?.die === 6, 'the roll reaching the other player');

    const move = rolled.game!.legalMoves[0]!;
    roller.send(intent('move', { pieceId: move.pieceId }));
    const seen = await until(
      watcher,
      (s) => s.game!.pieces.some((p) => p.id === move.pieceId && p.loc === move.to),
      'the move reaching the other player',
    );

    expect(seen.game?.pieces.find((p) => p.id === move.pieceId)?.loc).toBe(move.to);
  });

  it('answers a wrong-color roll with a notice and no new snapshot for anyone else', async () => {
    const { host, guest, started } = await twoAtATable(port, 'carla', 'dan', ['green', 'yellow']);
    const idle = started.game!.turnColor === 'green' ? guest : host;
    const watcher = idle === guest ? host : guest;
    const revBefore = watcher.last!.rev;

    idle.send(intent('roll'));

    expect(await untilNotice(idle)).toEqual({ code: 'notYourTurn' });
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(watcher.last!.rev).toBe(revBefore);
  });

  it('returns a refreshed browser to the exact choice it left behind', async () => {
    const { host, guest, started, code } = await twoAtATable(port, 'eve', 'fin', ['red', 'blue']);
    const room = server.store.rooms.get(code)!;
    room.rng = () => (6 - 0.5) / 6;

    const roller = started.game!.turnColor === 'red' ? host : guest;
    roller.send(intent('roll'));
    const rolled = await until(roller, (s) => s.game?.die === 6 && s.game.stage === 'awaitMove', 'a six');

    await roller.close();
    const back = await connect(port, code, roller.token, 'eve-again');

    expect(back.last?.game?.stage).toBe('awaitMove');
    expect(back.last?.game?.die).toBe(rolled.game?.die);
    expect(back.last?.game?.legalMoves.length).toBeGreaterThan(0);
    expect(back.last?.paused).toBe(false);
    void guest;
  });

  it('lets a late friend in to watch, with no say', async () => {
    const { host, code } = await twoAtATable(port, 'gus', 'hal', ['red', 'blue']);
    const late = await join(port, code, 'ivy');

    const ivy = await connect(port, code, late.token, 'ivy');

    expect(ivy.last?.players).toHaveLength(2);
    expect(ivy.last?.spectators).toContain(late.token);

    ivy.send(intent('roll'));
    expect((await untilNotice(ivy)).code).toBe('notAPlayer');
    void host;
  });

  it('hands out a snapshot for a code over plain http', async () => {
    const created = await create(port, 'joe');

    const response = await fetch(`http://127.0.0.1:${port}/api/snapshot/${created.code}`);
    const snapshot = (await response.json()) as Snapshot;

    expect(snapshot.code).toBe(created.code);
    expect(snapshot.players.map((p) => p.name)).toEqual(['joe']);
  });
});
