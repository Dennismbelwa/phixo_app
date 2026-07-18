/**
 * Deterministic seeded PRNG (mulberry32) so demo data and live sessions
 * are repeatable across runs.
 */
export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSeed(...parts: (string | number)[]): number {
  let h = 2166136261;
  const s = parts.join("|");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Normal-ish sample via central limit (mean 0, sd ~1). */
export function gaussian(rng: Rng): number {
  return (rng() + rng() + rng() + rng() - 2) * Math.sqrt(3);
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
