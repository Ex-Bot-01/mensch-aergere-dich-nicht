import type { ClientMessage, Intent, ServerMessage } from '@madn/shared';

/** The bits of a websocket this module needs — easy to fake in a test. */
export type SocketLike = {
  send(message: unknown): void;
  close(): void;
  on(event: 'open' | 'message' | 'close', handler: (value?: unknown) => void): void;
};

export type FauxSocket = SocketLike;

export type Link = { send(intent: Intent): void; close(): void };
export type Status = 'online' | 'offline' | 'closed';

/** How long to wait before retry number `attempt`: half a second, doubling, capped. */
export function retryDelayMs(attempt: number): number {
  return Math.min(500 * 2 ** attempt, 4_000);
}

const fatal = (message: ServerMessage): boolean =>
  message.type === 'notice' &&
  (message.notice.code === 'unknownCode' || message.notice.code === 'roomClosed');

/**
 * Keep one tab attached to its seat. Phones drop, wifi hands over, laptops sleep — so a
 * closed socket is retried with the same token until it works or the room turns out to
 * be gone. Nothing is queued while offline: a roll clicked with no connection would
 * arrive at a table that has moved on, so it is dropped and the screen says why.
 */
export function connectResilient(opts: {
  code: string;
  token: string;
  name: string;
  open(): SocketLike;
  onMessage(message: ServerMessage): void;
  onStatus(status: Status): void;
}): Link {
  const { code, token, name, open, onMessage, onStatus } = opts;

  let socket: SocketLike | null = null;
  let attached = false;
  let stopped = false;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const dial = (): void => {
    if (stopped) return;

    const live = open();
    socket = live;

    live.on('open', () => {
      if (stopped) return;
      attached = true;
      attempt = 0;
      onStatus('online');
      const hello: ClientMessage = { type: 'hello', code, token, name };
      live.send(hello);
    });

    live.on('message', (value) => {
      const message = value as ServerMessage;
      if (fatal(message)) {
        stopped = true;
        attached = false;
        if (timer !== null) clearTimeout(timer);
        timer = null;
        onStatus('closed');
      }
      onMessage(message);
    });

    live.on('close', () => {
      if (stopped || socket !== live) return;
      attached = false;
      onStatus('offline');
      const delay = retryDelayMs(attempt);
      attempt += 1;
      timer = setTimeout(dial, delay);
    });
  };

  dial();

  return {
    send: (intent) => {
      if (!attached || !socket) return;
      socket.send({ type: 'intent', intent } satisfies ClientMessage);
    },
    close: () => {
      stopped = true;
      attached = false;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      socket?.close();
      socket = null;
    },
  };
}
