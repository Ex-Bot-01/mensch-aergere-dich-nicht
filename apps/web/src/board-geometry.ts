import { CIRCUIT_LEN, ENTRY } from '@madn/engine';
import type { Color, FieldId } from '@madn/shared';

export const BOARD_VIEWBOX = '0 0 100 100';

const CENTRE = 50;
/** The shared circuit is drawn as a ring; the cross of the real board reads the same. */
const RING_RADIUS = 42;

/** Where each color's four corner slots sit, one per quarter of the board. */
const CORNER_CENTRE: Record<Color, { x: number; y: number }> = {
  red: { x: 25, y: 25 },
  blue: { x: 75, y: 25 },
  green: { x: 75, y: 75 },
  yellow: { x: 25, y: 75 },
};

const CORNER_SLOTS = [
  [-4, -4],
  [4, -4],
  [-4, 4],
  [4, 4],
] as const;

export type Point = { x: number; y: number };

function circuitPoint(index: number): Point {
  const angle = (index / CIRCUIT_LEN) * Math.PI * 2 - Math.PI / 2;
  return { x: CENTRE + RING_RADIUS * Math.cos(angle), y: CENTRE + RING_RADIUS * Math.sin(angle) };
}

/** Where a field sits on the board, for circuit fields, home columns and corners alike. */
export function fieldPoint(field: FieldId): Point {
  if (field.startsWith('c')) {
    const index = Number(field.slice(1));
    if (!Number.isInteger(index) || index < 0 || index >= CIRCUIT_LEN) {
      throw new RangeError(`unknown circuit field: ${field}`);
    }
    return circuitPoint(index);
  }

  const [kind, color, which] = field.split(':');
  const number = Number(which);
  const corner = color !== undefined && color in CORNER_CENTRE ? CORNER_CENTRE[color as Color] : null;

  if (!corner || !Number.isInteger(number)) throw new RangeError(`unknown field: ${field}`);

  if (kind === 'h' && number >= 1 && number <= 4) {
    const entry = circuitPoint(ENTRY[color as Color]);
    const toward = number / 5; // one fifth of the way in per field, so the last sits near the middle
    return {
      x: entry.x + (CENTRE - entry.x) * toward,
      y: entry.y + (CENTRE - entry.y) * toward,
    };
  }

  if (kind === 'k' && number >= 0 && number <= 3) {
    const offset = CORNER_SLOTS[number];
    if (!offset) throw new RangeError(`unknown corner slot: ${field}`);
    return { x: corner.x + offset[0], y: corner.y + offset[1] };
  }

  throw new RangeError(`unknown field: ${field}`);
}

/** Every field the board should show faintly behind the pieces. */
export function fieldMarks(): { field: FieldId; r: number; tint: Color | null }[] {
  const marks: { field: FieldId; r: number; tint: Color | null }[] = [];

  const ownerOfEntry = (index: number): Color | null =>
    (Object.keys(ENTRY) as Color[]).find((color) => ENTRY[color] === index) ?? null;

  for (let index = 0; index < CIRCUIT_LEN; index++) {
    const entry = ownerOfEntry(index);
    marks.push({ field: `c${index}`, r: entry ? 2.1 : 1.5, tint: entry });
  }
  for (const color of Object.keys(CORNER_CENTRE) as Color[]) {
    for (let home = 1; home <= 4; home++) marks.push({ field: `h:${color}:${home}`, r: 2.4, tint: color });
    for (let slot = 0; slot < 4; slot++) marks.push({ field: `k:${color}:${slot}`, r: 2.2, tint: color });
  }

  return marks;
}
