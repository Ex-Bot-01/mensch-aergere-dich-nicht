/** Deterministic generator: same seed, same dice sequence. */
export type Rng = () => number;

/** mulberry32 — tiny, seeded, plenty fair for a board game die. */
export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type DieValue = 1 | 2 | 3 | 4 | 5 | 6;

export function rollValue(rng: Rng): DieValue {
  return (1 + Math.floor(rng() * 6)) as DieValue;
}
