// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Snapshot } from '@madn/shared';

import { recalledName, rememberName, tabToken } from '../src/api.js';
import { renderHome } from '../src/render/home.js';
import { renderLobby } from '../src/render/lobby.js';
import { renderTable } from '../src/render/table.js';
import { FINISHED, LOBBY, fixture, spectatorView } from './fixtures.js';

const noop = () => {};
const actions = (me: string) => ({
  me,
  roll: noop,
  move: noop,
  pickColor: noop,
  unpick: noop,
  start: noop,
  forceContinue: noop,
});

/** Same table, but the die has not been rolled yet. */
function beforeRoll(snapshot: Snapshot): Snapshot {
  return { ...snapshot, game: snapshot.game ? { ...snapshot.game, stage: 'awaitRoll', die: null } : null };
}

const mount = (render: (root: HTMLElement) => void): HTMLElement => {
  const root = document.createElement('div');
  document.body.append(root);
  render(root);
  return root;
};

beforeEach(() => {
  document.body.innerHTML = '';
  sessionStorage.clear();
  localStorage.clear();
});

describe('one identity per tab', () => {
  it('gives a fresh tab its own token, so two tabs are two players', () => {
    const first = tabToken();
    sessionStorage.removeItem('madn:token');

    expect(tabToken()).not.toBe(first);
  });

  it('keeps that token across a reload', () => {
    const first = tabToken();

    expect(tabToken()).toBe(first);
  });

  it('remembers the name you typed for each room code', () => {
    rememberName('K7M2QP', 'anna');

    expect(recalledName('K7M2QP')).toBe('anna');
    expect(recalledName('QQQQQQ')).toBeNull();
  });
});

describe('the table screen', () => {
  it('highlights the legal pieces of the player whose turn it is', () => {
    const root = mount((el) => renderTable(el, fixture(), actions('tab-one')));

    expect(root.querySelectorAll('.legal')).toHaveLength(1);
    expect(root.querySelector('[data-piece]')?.getAttribute('data-color')).toBe('red');
  });

  it('shows no legal pieces to a player who is not on turn', () => {
    const root = mount((el) => renderTable(el, spectatorView(), actions('tab-two')));

    expect(root.querySelectorAll('.legal')).toHaveLength(0);
  });

  it('gives a spectator no dice to throw', () => {
    const root = mount((el) => renderTable(el, beforeRoll(fixture()), actions('watcher')));

    expect(root.querySelector('[data-act="roll"]')).toBeNull();
  });

  it('offers the die only to the player on turn', () => {
    const mine = mount((el) => renderTable(el, beforeRoll(fixture()), actions('tab-one')));
    document.body.innerHTML = '';
    const theirs = mount((el) => renderTable(el, beforeRoll(fixture()), actions('tab-two')));

    expect(mine.querySelector('[data-act="roll"]')).not.toBeNull();
    expect(theirs.querySelector('[data-act="roll"]')).toBeNull();
  });

  it('says who the table is waiting for and locks everyone out', () => {
    const paused = fixture({ paused: true, waitingFor: 'blue' });
    const root = mount((el) => renderTable(el, beforeRoll(paused), actions('tab-one')));
    const roll = root.querySelector<HTMLButtonElement>('[data-act="roll"]');

    expect(root.querySelector('[data-waiting]')?.textContent).toMatch(/waiting for blue/i);
    expect(roll?.disabled).toBe(true);
  });

  it('names the player whose turn it is', () => {
    const root = mount((el) => renderTable(el, fixture(), actions('tab-two')));

    expect(root.querySelector('[data-turn]')?.textContent).toMatch(/anna/i);
  });

  it('shows standings only once somebody has won', () => {
    const playing = mount((el) => renderTable(el, fixture(), actions('tab-one')));
    document.body.innerHTML = '';
    const done = mount((el) => renderTable(el, FINISHED, actions('tab-one')));

    expect(playing.querySelector('[data-standings]')).toBeNull();
    expect(done.querySelectorAll('[data-standings] li')).toHaveLength(2);
    expect(done.querySelector('[data-standings] li')?.textContent).toMatch(/red/i);
  });

  it('lets a connected human send a stalled player home', () => {
    const paused = fixture({ paused: true, waitingFor: 'blue' });
    const forceContinue = vi.fn();
    const root = mount((el) =>
      renderTable(el, paused, { ...actions('tab-one'), forceContinue }),
    );

    root.querySelector<HTMLButtonElement>('[data-act="forceContinue"]')?.click();

    expect(forceContinue).toHaveBeenCalledWith('blue');
  });
});

describe('the lobby screen', () => {
  it('offers only the colors nobody has taken', () => {
    const root = mount((el) => renderLobby(el, LOBBY, actions('tab-two')));
    const buttons = [...root.querySelectorAll<HTMLButtonElement>('[data-color]')];

    expect(buttons.find((b) => b.dataset.color === 'red')?.disabled).toBe(true);
    expect(buttons.find((b) => b.dataset.color === 'green')?.disabled).toBe(false);
  });

  it('shows the code so it can be read out over the phone', () => {
    const root = mount((el) => renderLobby(el, LOBBY, actions('tab-two')));

    expect(root.querySelector('[data-code]')?.textContent).toContain('K7M2QP');
  });

  it('lets only the host start, and not before two colors are taken', () => {
    const guest = mount((el) => renderLobby(el, LOBBY, actions('tab-two')));
    document.body.innerHTML = '';
    const host = mount((el) => renderLobby(el, LOBBY, actions('tab-one')));

    expect(guest.querySelector('[data-act="start"]')).toBeNull();
    expect(host.querySelector<HTMLButtonElement>('[data-act="start"]')?.disabled).toBe(true);
  });
});

describe('the home screen', () => {
  it('explains why a code was refused instead of showing nothing', () => {
    const root = mount((el) =>
      renderHome(el, {
        name: '',
        notice: { code: 'unknownCode', detail: 'K7M2QP' },
        create: noop,
        join: noop,
      }),
    );

    expect(root.querySelector('[data-notice]')?.textContent).toMatch(/no game called K7M2QP/i);
  });

  it('prefills the name this browser used last time', () => {
    rememberName('K7M2QP', 'anna');
    const join = vi.fn();
    const root = mount((el) =>
      renderHome(el, {
        name: recalledName('K7M2QP') ?? '',
        notice: null,
        create: noop,
        join,
        code: 'k7m2qp',
      }),
    );
    const input = root.querySelector<HTMLInputElement>('input[name="name"]')!;

    expect(input.value).toBe('anna');
    root.querySelector<HTMLButtonElement>('[data-act="join"]')?.click();
    expect(join).toHaveBeenCalledWith('K7M2QP', 'anna');
  });
});
