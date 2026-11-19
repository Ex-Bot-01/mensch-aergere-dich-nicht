import type { Server } from 'node:http';

import { WebSocket, WebSocketServer } from 'ws';

import type { ClientMessage } from '@madn/shared';

import { HEARTBEAT_MS, beat, markConnected, markDisconnected } from './lifecycle.js';
import { handleIntent, joinByCode, makeSnapshot, type Store } from './rooms.js';

type Session = { code: string; token: string; alive: boolean };

/** The websocket side of the server: hello, then intents, and snapshots out. */
export function attachWebSockets(store: Store, server: Server) {
  const wss = new WebSocketServer({ server, path: '/ws' });
  const sessions = new Map<WebSocket, Session>();

  const send = (socket: WebSocket, message: unknown): void => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  };

  const broadcast = (code: string): void => {
    const room = store.rooms.get(code);
    if (!room) return;
    for (const [socket, session] of sessions) {
      if (session.code === code) send(socket, { type: 'snapshot', snapshot: makeSnapshot(room, session.token) });
    }
  };

  wss.on('connection', (socket) => {
    let session: Session | null = null;

    socket.on('message', (raw) => {
      let message: ClientMessage;
      try {
        message = JSON.parse(String(raw)) as ClientMessage;
      } catch {
        return;
      }

      if (!session) {
        if (message.type !== 'hello') {
          socket.close(1002, 'say hello first');
          return;
        }
        session = { code: message.code.toUpperCase(), token: message.token, alive: true };
        sessions.set(socket, session);

        const joined = joinByCode(store, session.code, {
          name: message.name ?? 'guest',
          token: session.token,
        });
        if (joined.notice) {
          send(socket, { type: 'notice', notice: joined.notice });
          return;
        }
        // Coming back reattaches the seat, clears any wait on them, and tells everyone.
        markConnected(store, session.code, session.token, store.now());
        broadcast(session.code);
        return;
      }

      if (message.type !== 'intent') return;
      const result = handleIntent(store, session.code, session.token, message.intent);
      if (result.notice) send(socket, { type: 'notice', notice: result.notice });
      else broadcast(session.code);
    });

    socket.on('pong', () => {
      const known = sessions.get(socket);
      if (!known) return;
      known.alive = true;
      beat(store, known.code, known.token, store.now());
    });

    socket.on('close', () => {
      const known = sessions.get(socket);
      if (!known) return;
      sessions.delete(socket);
      markDisconnected(store, known.code, known.token, store.now());
      broadcast(known.code);
    });
  });

  const heartbeat = setInterval(() => {
    for (const [socket, session] of sessions) {
      if (!session.alive) {
        session.alive = false;
        markDisconnected(store, session.code, session.token, store.now());
        socket.terminate();
        continue;
      }
      session.alive = false;
      socket.ping();
    }
  }, HEARTBEAT_MS);

  return {
    stopHeartbeat: (): void => clearInterval(heartbeat),
    closeSockets: (): Promise<void> =>
      new Promise((resolve) => {
        for (const socket of sessions.keys()) socket.terminate();
        sessions.clear();
        wss.close(() => resolve());
      }),
  };
}
