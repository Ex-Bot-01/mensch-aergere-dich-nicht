// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';

import * as THREE from 'three';

import { createDice, faceQuaternion, type DieValue } from '../src/dice.js';

const VALUES: DieValue[] = [1, 2, 3, 4, 5, 6];

/** Rotate the die's own up axis by a quaternion, the way three.js will. */
function upAxisOf(q: readonly [number, number, number, number]): [number, number, number] {
  const [x, y, z, w] = q;
  // v' = q * (0,1,0) * q⁻¹, expanded so the test needs no three.js import.
  return [
    2 * (x * y + w * z),
    1 - 2 * (x * x + z * z),
    2 * (y * z - w * x),
  ];
}

const angleBetween = (a: number[], b: number[]): number => {
  const dot = a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
  return (Math.acos(Math.min(1, Math.max(-1, dot))) * 180) / Math.PI;
};

const mounted: HTMLElement[] = [];

function host(): HTMLElement {
  const element = document.createElement('div');
  document.body.append(element);
  mounted.push(element);
  return element;
}

afterEach(() => {
  while (mounted.length) mounted.pop()?.remove();
});

describe('face orientations', () => {
  it('lands a different face for every value', () => {
    const axes = VALUES.map((value) => upAxisOf(faceQuaternion(value)));

    for (const [i, a] of axes.entries()) {
      for (const [j, b] of axes.entries()) {
        if (i >= j) continue;
        expect(angleBetween(a, b)).toBeGreaterThan(20);
      }
    }
  });

  it('is a real rotation, not a scale', () => {
    for (const value of VALUES) {
      const q = faceQuaternion(value);
      const length = Math.hypot(q[0]!, q[1]!, q[2]!, q[3]!);

      expect(length).toBeCloseTo(1, 6);
    }
  });

  it('puts opposite faces on opposite sides, as a real die does', () => {
    for (const [a, b] of [[1, 6], [2, 5], [3, 4]] as [DieValue, DieValue][]) {
      const axisA = upAxisOf(faceQuaternion(a));
      const axisB = upAxisOf(faceQuaternion(b));

      expect(angleBetween(axisA, axisB)).toBeGreaterThan(170);
    }
  });
});

describe('the dice widget', () => {
  it('tosses, then shows the value in text when there is no WebGL', () => {
    vi.useFakeTimers();
    const element = host();
    const dice = createDice(element, { forceFallback: true });

    dice.show(4);
    expect(element.textContent).toBe('–');
    vi.advanceTimersByTime(900);

    expect(dice.mode).toBe('text');
    expect(element.textContent).toContain('4');
    dice.dispose();
    expect(element.textContent).toBe('');
    vi.useRealTimers();
  });

  it('settles on the last value asked for, not an earlier one', () => {
    vi.useFakeTimers();
    const element = host();
    const dice = createDice(element, { forceFallback: true });

    dice.show(2);
    dice.show(6);
    vi.advanceTimersByTime(900);

    expect(element.textContent).toContain('6');
    dice.dispose();
    vi.useRealTimers();
  });

  it('does not throw when WebGL is simply missing', () => {
    const element = host();
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = (() => null) as never;

    try {
      expect(() => createDice(element).show(3)).not.toThrow();
    } finally {
      HTMLCanvasElement.prototype.getContext = original;
    }
  });

  /** A stand-in GL context: enough for three.js to be *attempted*, not enough to draw. */
  const fakeGl = (): WebGLRenderingContext => {
    const store: Record<string, unknown> = { canvas: document.createElement('canvas') };
    return new Proxy(store, {
      get: (target, property) => {
        if (property in target) return target[property as string];
        return (..._args: unknown[]) => 1;
      },
    }) as unknown as WebGLRenderingContext;
  };

  it('tries three.js when a WebGL context answers, and still renders without one', () => {
    const element = host();
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = ((type: string) =>
      type === '2d' ? null : fakeGl()) as never;

    try {
      const dice = createDice(element);

      // A context that cannot really draw must land on one of the two paths, never a crash.
      expect(['3d', 'text']).toContain(dice.mode);
      expect(() => dice.show(6)).not.toThrow();
      expect(element.textContent.length + (element.querySelector('canvas') ? 1 : 0)).toBeGreaterThan(0);
      dice.dispose();
    } finally {
      HTMLCanvasElement.prototype.getContext = original;
    }
  });

  it('relies on three.js building the box faces in the order the pip table assumes', () => {
    const geometry = new THREE.BoxGeometry(1, 1, 1);

    expect(geometry.groups).toHaveLength(6);
    expect(geometry.groups.map((group) => group.materialIndex)).toEqual([0, 1, 2, 3, 4, 5]);
  });
});
