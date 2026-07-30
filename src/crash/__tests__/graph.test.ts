import { describe, expect, it } from 'vitest';
import { displayYMax, projectSample, xForElapsed } from '../graph';

describe('crash graph — pas de fuite du crashAt', () => {
  it('X ne dépend que du temps (pas du multiplicateur de crash)', () => {
    const a = xForElapsed(2000, 2000);
    const b = xForElapsed(2000, 2000);
    expect(a).toBe(b);
    // Au début de la fenêtre (0 ms), X est à gauche — un crash tôt ne finit pas à droite.
    const early = xForElapsed(400, 400);
    const late = xForElapsed(7000, 7000);
    expect(early).toBeLessThan(late);
    expect(early).toBeLessThan(120);
  });

  it('Y max suit le mult courant, pas un crashAt secret', () => {
    expect(displayYMax(1.5)).toBe(2); // plancher à 2×
    expect(displayYMax(10)).toBe(12);
    // Même sample projeté avec deux yMax différents → Y change, X identique
    const s = { elapsed: 1500, mult: 1.4 };
    const p1 = projectSample(s, 1500, displayYMax(1.4));
    const p2 = projectSample(s, 1500, displayYMax(50));
    expect(p1.x).toBe(p2.x);
    expect(p1.y).not.toBe(p2.y);
  });

  it('un crash à 1,2× (court) reste à gauche de l’écran', () => {
    // ~700 ms pour 1.2× avec doublement 3,5 s — clairement < 8 s de fenêtre
    const x = xForElapsed(700, 700);
    expect(x).toBeLessThan(GRAPH_LEFT_THIRD());
  });
});

function GRAPH_LEFT_THIRD(): number {
  // padL 28 + 1/3 de la largeur utile (~564)
  return 28 + 564 / 3;
}
