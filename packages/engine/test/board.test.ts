import { describe, expect, it } from 'vitest';

import {
  CIRCUIT_LEN,
  COLORS,
  ENTRY,
  HOME_LEN,
  ROUTE_LEN,
  fieldId,
  isHomeField,
  ownerOf,
} from '../src/board.js';

describe('board geometry', () => {
  it('makes a route of one full circuit plus four home fields', () => {
    expect(CIRCUIT_LEN).toBe(40);
    expect(HOME_LEN).toBe(4);
    expect(ROUTE_LEN).toBe(CIRCUIT_LEN + HOME_LEN);
    expect(ROUTE_LEN).toBe(44);
  });

  it('spaces the four entry points evenly around the circuit', () => {
    const offsets = COLORS.map((color) => ENTRY[color]);
    expect(offsets).toEqual([0, 10, 20, 30]);
    for (let i = 0; i < offsets.length; i++) {
      const next = offsets[(i + 1) % offsets.length]!;
      const here = offsets[i]!;
      expect((next - here + CIRCUIT_LEN) % CIRCUIT_LEN).toBe(CIRCUIT_LEN / COLORS.length);
    }
  });

  it('walks every circuit field exactly once before turning toward home', () => {
    for (const color of COLORS) {
      const seen = new Set<string>();
      for (let step = 0; step < CIRCUIT_LEN; step++) {
        const field = fieldId(color, step);
        expect(field.startsWith('c')).toBe(true);
        expect(seen.has(field)).toBe(false);
        seen.add(field);
      }
      expect(seen.size).toBe(CIRCUIT_LEN);
    }
  });

  it('wraps a relative step onto the shared circuit numbering', () => {
    expect(fieldId('red', 0)).toBe('c0');
    expect(fieldId('red', 39)).toBe('c39');
    expect(fieldId('blue', 39)).toBe('c9');
    expect(fieldId('yellow', 25)).toBe('c15');
  });

  it('gives every color its own private home fields', () => {
    for (const color of COLORS) {
      expect(fieldId(color, CIRCUIT_LEN)).toBe(`h:${color}:1`);
      expect(fieldId(color, ROUTE_LEN - 1)).toBe(`h:${color}:4`);
    }
    const ids = new Set<string>();
    for (const color of COLORS) {
      for (let step = CIRCUIT_LEN; step < ROUTE_LEN; step++) ids.add(fieldId(color, step));
    }
    expect(ids.size).toBe(COLORS.length * HOME_LEN);
  });

  it('reports which fields are home fields and who owns them', () => {
    expect(isHomeField('h:green:2')).toBe(true);
    expect(isHomeField('c7')).toBe(false);
    expect(ownerOf('h:green:2')).toBe('green');
    expect(ownerOf('c7')).toBeNull();
  });
});
