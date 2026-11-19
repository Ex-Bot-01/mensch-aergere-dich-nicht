// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ServerMessage } from '@madn/shared';

import { connectResilient, retryDelayMs, type FauxSocket } from '../src/connection.js';

/** A socket we can open and drop on demand, with the messages it was told to send. */
function fauxSocket(): FauxSocket & {
  opened: number;
  sent: unknown[];
  emitOpen(): void;
  emitMessage(message: ServerMessage): void;
  emitClose(): void;
} {
  const handlers: Record<string, ((value?: unknown) => void)[]> = {};
  const socket = {
    opened: 0,
    sent: [] as unknown[],
    send: (message: unknown) => socket.sent.push(message),
    close: () => socket.emitClose(),
    on: (event: string, handler: (value?: unknown) => void) => {
      handlers[event] = [...(handlers[event] ?? []), handler];
    },
    emitOpen: () => {
      socket.opened += 1;
      for (const handler of handlers['open'] ?? []) handler();
    },
    emitMessage: (message: ServerMessage) => {
      for (const handler of handlers['message'] ?? []) handler(message);
    },
    emitClose: () => {
      for (const handler of handlers['close'] ?? []) handler();
    },
  };
  return socket;
}

const snapshot = (rev: number): ServerMessage => ({
  type: 'snapshot',
  snapshot: {
    rev,
    phase: 'playing',
    code: 'K7M2QP',
    hostToken: 't1',
    paused: false,
    waitingFor: null,
    players: [],
    spectators: [],
    game: null,
    events: [],
    notice: null,
  },
});

describe('staying connected', () => {
  let sockets: ReturnType<typeof fauxSocket>[] = [];
  let statuses: string[];
  let messages: ServerMessage[];

  beforeEach(() => {
    vi.useFakeTimers();
    sockets = [];
    statuses = [];
    messages = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Wire a connection whose every open hands back a socket the test controls. */
  function wire(): ReturnType<typeof fauxSocket> {
    const connection = connectResilient({
      code: 'K7M2QP',
      token: 'tab-one',
      name: 'anna',
      open: () => {
        const socket = fauxSocket();
        sockets.push(socket);
        return socket;
      },
      onMessage: (message) => messages.push(message),
      onStatus: (status) => statuses.push(status),
    });
    void connection;
    return sockets[0]!;
  }

  it('says hello as soon as the socket opens', () => {
    const first = wire();
    first.emitOpen();

    expect(first.sent).toEqual([{ type: 'hello', code: 'K7M2QP', token: 'tab-one', name: 'anna' }]);
    expect(statuses).toEqual(['online']);
  });

  it('passes what the server sends straight through', () => {
    const first = wire();
    first.emitOpen();
    first.emitMessage(snapshot(4));

    expect(messages.map((m) => (m.type === 'snapshot' ? m.snapshot.rev : m.type))).toEqual([4]);
  });

  it('comes back by itself after a drop, with the same seat', () => {
    const first = wire();
    first.emitOpen();
    first.emitClose();

    expect(statuses).toEqual(['online', 'offline']);

    vi.advanceTimersByTime(retryDelayMs(0));
    expect(sockets).toHaveLength(2);

    sockets[1]!.emitOpen();
    expect(sockets[1]!.sent).toEqual([
      { type: 'hello', code: 'K7M2QP', token: 'tab-one', name: 'anna' },
    ]);
    expect(statuses).toEqual(['online', 'offline', 'online']);
  });

  it('waits a little longer each time, and never longer than four seconds', () => {
    wire();
    sockets[0]!.emitOpen();

    for (let attempt = 0; attempt < 6; attempt++) {
      sockets[attempt]!.emitClose();
      const wanted = retryDelayMs(attempt);

      vi.advanceTimersByTime(wanted - 1);
      expect(sockets).toHaveLength(attempt + 2 - 1); // nothing early
      vi.advanceTimersByTime(1);
      expect(sockets).toHaveLength(attempt + 2);
    }

    expect(retryDelayMs(0)).toBeLessThanOrEqual(1_000);
    expect(retryDelayMs(1)).toBeGreaterThan(retryDelayMs(0));
    expect(retryDelayMs(9)).toBe(4_000);
  });

  it('starts the wait again from short after a good connection', () => {
    wire();
    sockets[0]!.emitOpen();
    sockets[0]!.emitClose();
    vi.advanceTimersByTime(retryDelayMs(0));
    sockets[1]!.emitOpen(); // a healthy reconnect resets the backoff
    sockets[1]!.emitClose();

    vi.advanceTimersByTime(retryDelayMs(0));

    expect(sockets).toHaveLength(3);
  });

  it('keeps trying through several dead minutes', () => {
    wire();
    sockets[0]!.emitOpen();
    sockets[0]!.emitClose();

    for (let attempt = 0; attempt < 5; attempt++) {
      vi.advanceTimersByTime(retryDelayMs(attempt));
      const next = sockets[attempt + 1];
      expect(next, `retry ${attempt + 1} should have dialled`).toBeDefined();
      next!.emitClose(); // still no network: this attempt fails too
    }

    expect(sockets.length).toBe(6);
  });

  it('gives up politely when the room itself is gone', () => {
    const connection = connectResilient({
      code: 'K7M2QP',
      token: 'tab-one',
      name: 'anna',
      open: () => {
        const socket = fauxSocket();
        sockets.push(socket);
        return socket;
      },
      onMessage: (message) => messages.push(message),
      onStatus: (status) => statuses.push(status),
    });

    sockets[0]!.emitOpen();
    sockets[0]!.emitMessage({ type: 'notice', notice: { code: 'unknownCode' } });
    vi.advanceTimersByTime(30_000);

    expect(sockets).toHaveLength(1);
    expect(statuses.at(-1)).toBe('closed');
    connection.send({ type: 'roll' });
    expect(sockets[0]!.sent.filter((m) => JSON.stringify(m).includes('roll'))).toHaveLength(0);
  });

  it('stops trying once the caller closes it', () => {
    const connection = connectResilient({
      code: 'K7M2QP',
      token: 'tab-one',
      name: 'anna',
      open: () => {
        const socket = fauxSocket();
        sockets.push(socket);
        return socket;
      },
      onMessage: (message) => messages.push(message),
      onStatus: (status) => statuses.push(status),
    });

    sockets[0]!.emitOpen();
    connection.close();
    vi.advanceTimersByTime(30_000);

    expect(sockets).toHaveLength(1);
  });

  it('drops an intent sent while offline instead of queueing a stale one', () => {
    wire();
    sockets[0]!.emitOpen();
    sockets[0]!.emitClose();

    const connection = connectResilient({
      code: 'K7M2QP',
      token: 'tab-one',
      name: 'anna',
      open: () => {
        const socket = fauxSocket();
        sockets.push(socket);
        return socket;
      },
      onMessage: () => {},
      onStatus: () => {},
    });
    connection.send({ type: 'roll' });

    expect(sockets[sockets.length - 1]!.sent.some((m) => JSON.stringify(m).includes('roll'))).toBe(
      false,
    );
  });
});
