/** Générateur pseudo-aléatoire injectable (déterministe pour les tests). */
export type Rng = () => number;

/** Mulberry32 — rapide, uniforme, seedable. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function cryptoRng(): Rng {
  const buf = new Uint32Array(64);
  let idx = buf.length;
  return () => {
    if (idx >= buf.length) {
      crypto.getRandomValues(buf);
      idx = 0;
    }
    return buf[idx++] / 4294967296;
  };
}

/** Fisher–Yates, en place. */
export function shuffle<T>(items: T[], rng: Rng): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}
