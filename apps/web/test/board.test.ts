// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';

import { COLORS, type Color, type EventItem, type PieceView, type Snapshot } from '@madn/shared';

import { BOARD_VIEWBOX, fieldPoint } from '../src/board-geometry.js';
import { renderBoard } from '../src/render/board.js';

const freshPieces = (): PieceView[] =>
  COLORS.flatMap((color) =>
    [0, 1, 2, 3].map((slot) => ({ id: `${color}:${slot}`, color, loc: `k:${color}:${slot}` })),
  );

function board(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    rev: 1,
    phase: 'playing',
    code: 'K7M2QP',
    hostToken: 't1',
    paused: false,
    waitingFor: null,
    players: [],
    spectators: [],
    game: {
      turnColor: 'red',
      stage: 'awaitMove',
      die: 3,
      legalMoves: [{ pieceId: 'red:0', from: 'k:red:0', to: 'c3' }],
      pieces: freshPieces(),
      standings: null,
    },
    events: [],
    notice: null,
    ...overrides,
  };
}

/** happy-dom's SVG elements have no .click(), so tap them the way a browser does. */
const tap = (element: Element | null | undefined): void => {
  element?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
};

const mount = (snapshot: Snapshot, onPick = (): void => {}): HTMLElement => {
  const root = document.createElement('div');
  document.body.append(root);
  renderBoard(root, snapshot, onPick);
  return root;
};

describe('board geometry', () => {
  it('places every circuit field on a distinct point inside the board', () => {
    const seen = new Set<string>();

    for (let i = 0; i < 40; i++) {
      const { x, y } = fieldPoint(`c${i}`);

      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(100);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(100);
      seen.add(`${x.toFixed(2)},${y.toFixed(2)}`);
    }

    expect(seen.size).toBe(40);
  });

  it('puts the four entry fields a quarter turn apart', () => {
    const angleOf = (field: string): number => {
      const { x, y } = fieldPoint(field);
      return ((Math.atan2(y - 50, x - 50) * 180) / Math.PI + 360) % 360;
    };
    const entries = COLORS.map((color) => angleOf(`c${{ red: 0, blue: 10, green: 20, yellow: 30 }[color as Color]}`));

    for (let i = 0; i < entries.length; i++) {
      const here = entries[i]!;
      const next = entries[(i + 1) % entries.length]!;
      expect(Math.abs(((next - here + 360) % 360) - 90)).toBeLessThan(1);
    }
  });

  it('runs each home column straight at the centre, one field closer each time', () => {
    for (const color of COLORS) {
      const entry = fieldPoint(`c${{ red: 0, blue: 10, green: 20, yellow: 30 }[color]}`);
      const distances = [1, 2, 3, 4].map((field) => {
        const { x, y } = fieldPoint(`h:${color}:${field}`);
        return Math.hypot(x - 50, y - 50);
      });

      for (let i = 1; i < distances.length; i++) {
        expect(distances[i]!).toBeLessThan(distances[i - 1]!);
      }
      const angleOf = (x: number, y: number): number => (Math.atan2(y - 50, x - 50) * 180) / Math.PI;
      const homeTwo = fieldPoint(`h:${color}:2`);

      expect(Math.abs(angleOf(entry.x, entry.y) - angleOf(homeTwo.x, homeTwo.y))).toBeLessThan(1);
    }
  });

  it("keeps each color's corner inside its own quarter of the board", () => {
    const quadrantOf = (color: Color): string => {
      const { x, y } = fieldPoint(`k:${color}:0`);
      return `${x < 50 ? 'left' : 'right'}/${y < 50 ? 'top' : 'bottom'}`;
    };
    const quadrants = COLORS.map(quadrantOf);

    expect(new Set(quadrants).size).toBe(4);
  });

  it('refuses a field it does not know', () => {
    expect(() => fieldPoint('z9')).toThrow(RangeError);
  });
});

describe('drawing the board', () => {
  it('draws sixteen pieces for a fresh four-player game', () => {
    const root = mount(board());

    expect(root.querySelectorAll('[data-piece]')).toHaveLength(16);
    expect(root.querySelector('svg')?.getAttribute('viewBox')).toBe(BOARD_VIEWBOX);
  });

  it('marks only the pieces the server said may move', () => {
    const root = mount(board());

    expect(root.querySelectorAll('.legal')).toHaveLength(1);
    expect(root.querySelector('.legal')?.getAttribute('data-piece')).toBe('red:0');
  });

  it('asks for a move when a legal piece is tapped, and not when an illegal one is', () => {
    const onPick = vi.fn();
    const root = mount(board(), onPick);

    tap(root.querySelector('.legal'));
    tap(root.querySelectorAll('circle[data-piece]')[3]);

    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith('red:0');
  });

  it('flashes the color of the piece that was just captured', () => {
    const captured: EventItem = {
      id: 4,
      kind: 'captured',
      payload: { color: 'blue', pieceId: 'blue:1', field: 'c7' },
    };
    const root = mount(board({ events: [captured] }));
    const flashing = root.querySelectorAll('.flash');

    expect(flashing).toHaveLength(1);
    expect(flashing[0]?.getAttribute('data-color')).toBe('blue');
  });

  it('gives legal pieces a tap area bigger than the dot', () => {
    const root = mount(board());

    expect(root.querySelector('.legal')?.getAttribute('r')).toBe('2.6');
    expect(root.querySelector('.hit')).not.toBeNull();
    expect(Number(root.querySelector('.hit')?.getAttribute('r'))).toBeGreaterThanOrEqual(5);
  });
});
