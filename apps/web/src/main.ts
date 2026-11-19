import type { Intent, Notice, ServerMessage, Snapshot } from '@madn/shared';

import {
  connect,
  createGame,
  joinGame,
  recalledName,
  rememberName,
  tabToken,
  type Connection,
} from './api.js';
import { noticeText } from './copy.js';
import { renderHome } from './render/home.js';
import { renderLobby } from './render/lobby.js';
import { renderTable } from './render/table.js';
import type { Actions } from './render/shared.js';

const root = document.querySelector<HTMLElement>('#app')!;
const NAME_KEY = 'madn:lastname';

const token = tabToken();
let connection: Connection | null = null;
let snapshot: Snapshot | null = null;
let notice: Notice | null = null;
let name = sessionStorage.getItem(NAME_KEY) ?? '';

const urlCode = (): string => new URLSearchParams(location.search).get('code') ?? '';
const send = (intent: Intent): void => connection?.send(intent);

function draw(): void {
  if (!snapshot) {
    renderHome(root, { name, code: urlCode(), notice, create, join });
    return;
  }

  const actions: Actions = {
    me: token,
    roll: () => send({ type: 'roll' }),
    move: (pieceId) => send({ type: 'move', pieceId }),
    pickColor: (color) => send({ type: 'pickColor', color }),
    unpick: () => send({ type: 'unpick' }),
    start: () => send({ type: 'start' }),
    forceContinue: (color) => send({ type: 'forceContinue', color }),
  };

  if (snapshot.phase === 'playing' || snapshot.phase === 'finished') renderTable(root, snapshot, actions);
  else renderLobby(root, snapshot, actions);

  if (notice) {
    const toast = document.createElement('p');
    toast.className = 'toast';
    toast.textContent = noticeText(notice);
    root.append(toast);
  }
}

function onMessage(message: ServerMessage): void {
  if (message.type === 'notice') {
    notice = message.notice;
    draw();
    return;
  }

  snapshot = message.snapshot;
  notice = null;
  history.replaceState(null, '', `?code=${snapshot.code}`);
  rememberName(snapshot.code, name);
  draw();
}

function open(code: string): void {
  connection?.close();
  connection = connect(code, token, onMessage, name);
}

async function create(who: string): Promise<void> {
  name = who;
  sessionStorage.setItem(NAME_KEY, who);
  const access = await createGame(who);
  open(access.code);
}

async function join(code: string, who: string): Promise<void> {
  name = who;
  sessionStorage.setItem(NAME_KEY, who);
  const result = await joinGame(code, who);

  if (result.notice) {
    notice = result.notice;
    draw();
    return;
  }
  open(result.access!.code);
}

/** A reload inside a game rejoins the same seat, because the token lives in this tab. */
const code = urlCode();
if (code) {
  name = recalledName(code) ?? name;
  void join(code.toUpperCase(), name || 'guest');
} else {
  draw();
}
