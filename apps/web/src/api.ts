import type { Notice } from '@madn/shared';
import type { SocketLike } from './connection.js';

const TOKEN_KEY = 'madn:token';

export type Access = { code: string; token: string };

/** One identity per browser tab: sessionStorage survives a reload, not a new tab. */
export function tabToken(): string {
  const existing = sessionStorage.getItem(TOKEN_KEY);
  if (existing) return existing;

  const fresh = globalThis.crypto.randomUUID();
  sessionStorage.setItem(TOKEN_KEY, fresh);
  return fresh;
}

const nameKey = (code: string): string => `madn:name:${code}`;

/** The name this browser last used for this room, so returning is one tap. */
export function rememberName(code: string, name: string): void {
  localStorage.setItem(nameKey(code), name);
}

export function recalledName(code: string): string | null {
  return localStorage.getItem(nameKey(code));
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return (await response.json()) as T;
}

export async function createGame(name: string): Promise<Access> {
  const token = tabToken();
  return post<Access>('/api/create', { name, token });
}

export async function joinGame(
  code: string,
  name: string,
): Promise<{ access?: Access; notice?: Notice }> {
  const token = tabToken();
  const result = await post<{ notice?: Notice }>('/api/join', { code, name, token });
  return result.notice ? { notice: result.notice } : { access: { code, token } };
}

/**
 * One raw websocket to the room, in the shape the reconnecting link wants. It says
 * nothing about who is using it — that hello waits until the socket is open, so a
 * retry after a dropout looks exactly like the first attempt did.
 */
export function webSocket(): SocketLike {
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  const socket = new WebSocket(`${scheme}://${location.host}/ws`);
  const handlers: Record<string, ((value?: unknown) => void)[]> = {};

  const fire = (event: string, value?: unknown): void => {
    for (const handler of handlers[event] ?? []) handler(value);
  };

  socket.addEventListener('open', () => fire('open'));
  socket.addEventListener('message', (event) => {
    try {
      fire('message', JSON.parse(String(event.data)));
    } catch {
      // A message we cannot read is not worth tearing the connection down over.
    }
  });
  socket.addEventListener('close', () => fire('close'));

  return {
    send: (message) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
    },
    close: () => socket.close(),
    on: (event, handler) => {
      handlers[event] = [...(handlers[event] ?? []), handler];
    },
  };
}
