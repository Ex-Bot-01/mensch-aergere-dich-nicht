import { COLORS, type Color, type FieldId } from '@madn/shared';

export { COLORS };
export type { Color, FieldId };

/** Fields on the shared circuit that every color walks around. */
export const CIRCUIT_LEN = 40;
/** Private fields per color at the end of the route ("Häuschen"). */
export const HOME_LEN = 4;
/** A piece's whole route: one full circuit, then its own home column. */
export const ROUTE_LEN = CIRCUIT_LEN + HOME_LEN;

/** Where each color enters the circuit — relative step 0 for that color. */
export const ENTRY: Record<Color, number> = { red: 0, blue: 10, green: 20, yellow: 30 };

/** Resolve a color-relative step (0..ROUTE_LEN-1) to the field standing there. */
export function fieldId(color: Color, step: number): FieldId {
  if (!Number.isInteger(step) || step < 0 || step >= ROUTE_LEN) {
    throw new RangeError(`step out of range: ${String(step)}`);
  }
  if (step < CIRCUIT_LEN) return `c${(ENTRY[color] + step) % CIRCUIT_LEN}`;
  return `h:${color}:${step - CIRCUIT_LEN + 1}`;
}

export function isHomeField(field: FieldId): boolean {
  return field.startsWith('h:');
}

/** The color a private home field belongs to, or null for shared fields. */
export function ownerOf(field: FieldId): Color | null {
  const [kind, owner] = field.split(':');
  if (kind !== 'h') return null;
  return (COLORS as readonly string[]).includes(owner ?? '') ? (owner as Color) : null;
}
