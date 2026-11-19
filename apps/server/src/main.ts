import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

import { createRequestHandler } from './http.js';
import { tick } from './lifecycle.js';
import { createStore, type Store } from './rooms.js';
import { attachWebSockets } from './ws.js';

/** How often the server looks for quiet sockets and dead rooms. */
const SWEEP_MS = 5_000;

export type Running = { port: number; store: Store; close(): Promise<void> };

export async function startServer(
  opts: { port?: number; host?: string; webRoot?: string; store?: Store } = {},
): Promise<Running> {
  const store = opts.store ?? createStore();
  const handler = createRequestHandler(store, opts.webRoot ?? 'apps/web/dist');
  const server = createServer((request, response) => {
    void handler(request, response);
  });
  const sockets = attachWebSockets(store, server);
  const sweeper = setInterval(() => {
    tick(store, store.now());
  }, SWEEP_MS);

  await new Promise<void>((resolve) => {
    server.listen(opts.port ?? 3000, opts.host ?? '0.0.0.0', resolve);
  });

  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : (opts.port ?? 3000);

  return {
    port,
    store,
    close: async () => {
      clearInterval(sweeper);
      sockets.stopHeartbeat();
      server.closeAllConnections?.();
      await sockets.closeSockets();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

const launchedDirectly = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (launchedDirectly) {
  const port = Number(process.env.PORT ?? 3000);
  void startServer({ port, webRoot: process.env.WEB_ROOT ?? 'apps/web/dist' }).then((running) => {
    console.log(`Mensch ärgere dich nicht — http://localhost:${running.port}/`);
  });
}
