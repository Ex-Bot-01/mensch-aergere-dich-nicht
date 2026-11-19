import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { makeSnapshot, createRoom, joinByCode, type Store } from './rooms.js';

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
};

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** A file from the built web app, refusing to wander outside its own directory. */
function serveStatic(webRoot: string, path: string, response: ServerResponse): void {
  const wanted = path === '/' ? '/index.html' : path;
  const root = resolve(webRoot);
  const file = resolve(join(root, normalize(wanted)));

  if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) {
    sendJson(response, 404, { notice: { code: 'unknownCode', detail: wanted } });
    return;
  }

  response.writeHead(200, {
    'content-type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream',
  });
  // A small synchronous read on purpose: phase 1 serves a handful of static files.
  response.end(readFileSync(file));
}

/** HTTP: three JSON endpoints and the built browser app. */
export function createRequestHandler(store: Store, webRoot: string) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;

    if (request.method === 'POST' && path === '/api/create') {
      const body = await readBody(request);
      const token = typeof body.token === 'string' ? body.token : newToken();
      const room = createRoom(store, { name: text(body.name), token });
      sendJson(response, 201, { code: room.code, token });
      return;
    }

    if (request.method === 'POST' && path === '/api/join') {
      const body = await readBody(request);
      const token = typeof body.token === 'string' ? body.token : newToken();
      const code = typeof body.code === 'string' ? body.code.toUpperCase() : '';
      const result = joinByCode(store, code, { name: text(body.name), token });

      if (result.notice) sendJson(response, 404, { notice: result.notice });
      else sendJson(response, 200, { code, token });
      return;
    }

    if (request.method === 'GET' && path.startsWith('/api/snapshot/')) {
      const code = decodeURIComponent(path.slice('/api/snapshot/'.length));
      const room = store.rooms.get(code);
      if (!room) {
        sendJson(response, 404, { notice: { code: 'unknownCode', detail: code } });
        return;
      }
      sendJson(response, 200, makeSnapshot(room));
      return;
    }

    if (request.method === 'GET') {
      serveStatic(webRoot, path, response);
      return;
    }

    sendJson(response, 404, { notice: { code: 'unknownCode', detail: path } });
  };
}

const text = (value: unknown): string => (typeof value === 'string' && value.trim() ? value.trim().slice(0, 24) : 'guest');

export function newToken(): string {
  return globalThis.crypto.randomUUID();
}
