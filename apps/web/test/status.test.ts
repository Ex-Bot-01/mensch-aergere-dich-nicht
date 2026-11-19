// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';

import type { Snapshot } from '@madn/shared';

import { renderStatus } from '../src/render/status.js';
import { FINISHED, LOBBY, fixture } from './fixtures.js';
import { renderLobby } from '../src/render/lobby.js';
import { renderTable } from '../src/render/table.js';

const actions = (me: string, online = true) => ({
  me,
  online,
  roll: (): void => {},
  move: (): void => {},
  pickColor: (): void => {},
  unpick: (): void => {},
  start: (): void => {},
  forceContinue: (): void => {},
  returnToLobby: (): void => {},
});

const mount = (render: (root: HTMLElement) => void): HTMLElement => {
  document.body.innerHTML = '';
  const root = document.createElement('div');
  document.body.append(root);
  render(root);
  return root;
};

describe('saying what the connection is doing', () => {
  it('says nothing while the wire is good', () => {
    const root = mount((el) => renderStatus(el, 'online'));

    expect(root.hidden).toBe(true);
    expect(root.textContent).toBe('');
  });

  it('says the game is still being played out there when this tab dropped', () => {
    const root = mount((el) => renderStatus(el, 'offline'));

    expect(root.hidden).toBe(false);
    expect(root.textContent).toMatch(/connection lost/i);
    expect(root.textContent).toMatch(/trying again/i);
  });

  it('says plainly when the game is gone for good', () => {
    const root = mount((el) => renderStatus(el, 'closed'));

    expect(root.textContent).toMatch(/closed/i);
  });
});

describe('not offering moves that cannot land', () => {
  const playing: Snapshot = fixture();

  it('disables the dice while this tab is cut off', () => {
    const before = mount((el) => renderTable(el, { ...playing, game: { ...playing.game!, stage: 'awaitRoll', die: null } }, actions('tab-one')));
    document.body.innerHTML = '';
    const after = mount((el) =>
      renderTable(
        el,
        { ...playing, game: { ...playing.game!, stage: 'awaitRoll', die: null } },
        actions('tab-one', false),
      ),
    );

    expect(after.querySelector<HTMLButtonElement>('button[data-act="roll"]')?.disabled).toBe(true);
    expect(before.querySelector<HTMLButtonElement>('button[data-act="roll"]')?.disabled).toBeFalsy();
    expect(after.querySelectorAll('.legal')).toHaveLength(0);
  });

  it('holds the lobby still too', () => {
    const root = mount((el) => renderLobby(el, LOBBY, actions('tab-one', false)));

    expect(root.querySelector('[data-act="start"]')).toBeNull();
    expect(root.querySelectorAll('.seats button[disabled]')).toHaveLength(4);
  });

  it('disables every button that would need the wire, and only those', () => {
    const root = mount((el) => renderTable(el, FINISHED, actions('tab-one', false)));

    expect(root.querySelector('[data-act="again"]')?.hasAttribute('disabled')).toBe(true);
    expect(root.querySelector('[data-code]')).toBeNull(); // standings need no wire, so they stay
  });
});
