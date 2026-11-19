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
import { createDice, TOSS_MS, type Dice } from './dice.js';
import { drainEvents, latestEventId } from './events.js';
import { noticeText } from './copy.js';
import { renderHome } from './render/home.js';
import { renderLobby } from './render/lobby.js';
import { renderTable } from './render/table.js';
import type { Actions } from './render/shared.js';

const root = document.querySelector<HTMLElement>('#app')!;
const dock = document.querySelector<HTMLElement>('#dock')!;
const NAME_KEY = 'madn:lastname';

const token = tabToken();
let connection: Connection | null = null;
let snapshot: Snapshot | null = null;
let notice: Notice | null = null;
let name = sessionStorage.getItem(NAME_KEY) ?? '';
let dice: Dice | null = null;
let seenEventId = 0;
let timers: ReturnType<typeof setTimeout>[] = [];

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
    returnToLobby: () => send({ type: 'returnToLobby' }),
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
  animate(snapshot);
}

/**
 * The dice toss is only for looks: the server already moved on. Rolls are replayed in
 * order, one toss each, and a client that woke up far behind skips straight to the board.
 */
function animate(snapshot: Snapshot): void {
  const fresh = drainEvents(snapshot, seenEventId);
  seenEventId = latestEventId(snapshot);

  if (snapshot.phase === 'lobby') {
    dock.hidden = true;
    return;
  }

  const rolls = fresh.filter((event) => event.kind === 'rolled');
  if (rolls.length === 0) return;

  dice ??= createDice(dock);
  dock.hidden = false;
  for (const timer of timers) clearTimeout(timer);
  timers = rolls.flatMap((event, index) => {
    const value = Number(event.payload['value'] ?? 0);
    if (value < 1 || value > 6) return [];
    return [setTimeout(() => dice?.show(value), index * TOSS_MS)];
  });
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

/**
 * A link with a code in it goes straight back into the game if we already know who is
 * using this tab. A stranger who follows a link still gets asked for a name first.
 */
const code = urlCode();
const known = code ? recalledName(code) ?? name : '';
if (code && known) {
  void join(code.toUpperCase(), known);
} else {
  draw();
}
