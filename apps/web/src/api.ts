import type { Intent, Notice, ServerMessage } from '@madn/shared';

const TOKEN_KEY = 'madn:token';

export type Access = { code: string; token: string };
export type Connection = { send(intent: Intent): void; close(): void };

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

/** Open the socket for this tab's seat and hand every message to the screen. */
export function connect(
  code: string,
  token: string,
  onMessage: (message: ServerMessage) => void,
  name = 'guest',
): Connection {
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  const socket = new WebSocket(`${scheme}://${location.host}/ws`);

  socket.addEventListener('open', () => {
    socket.send(JSON.stringify({ type: 'hello', code, token, name }));
  });
  socket.addEventListener('message', (event) => {
    onMessage(JSON.parse(String(event.data)) as ServerMessage);
  });

  return {
    send: (intent) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'intent', intent }));
      }
    },
    close: () => socket.close(),
  };
}
