/**
 * Projection du graphe Crash — ne doit JAMAIS dépendre de crashAt.
 * Sinon la position de l’avion révèle la fin du vol (exploit).
 */

export const GRAPH_W = 640;
export const GRAPH_H = 360;
/** Fenêtre temporelle visible (ms), style Stake (scroll si plus long). */
export const GRAPH_VIEW_MS = 8000;

const PAD_L = 28;
const PAD_R = 48;
const PAD_T = 28;
const PAD_B = 36;

export type FlightSample = { elapsed: number; mult: number };
export type GraphPoint = { x: number; y: number };

/** Max Y affiché : suit le mult courant, sans connaître le crash. */
export function displayYMax(currentMult: number): number {
  return Math.max(2, currentMult * 1.2);
}

/** X selon le temps écoulé + fenêtre glissante (indépendant du crash). */
export function xForElapsed(elapsed: number, windowEnd: number, viewMs = GRAPH_VIEW_MS): number {
  const w = GRAPH_W - PAD_L - PAD_R;
  const windowStart = Math.max(0, windowEnd - viewMs);
  const span = Math.max(viewMs, windowEnd - windowStart);
  const t = (elapsed - windowStart) / span;
  return PAD_L + Math.min(1, Math.max(0, t)) * w;
}

export function yForMult(mult: number, yMax: number): number {
  const h = GRAPH_H - PAD_T - PAD_B;
  const top = Math.max(yMax, 1.01);
  const n = (Math.min(mult, top) - 1) / (top - 1);
  return PAD_T + h - n * h;
}

export function projectSample(
  sample: FlightSample,
  windowEnd: number,
  yMax: number,
  viewMs = GRAPH_VIEW_MS,
): GraphPoint {
  return {
    x: xForElapsed(sample.elapsed, windowEnd, viewMs),
    y: yForMult(sample.mult, yMax),
  };
}

export function projectSamples(
  samples: FlightSample[],
  windowEnd: number,
  yMax: number,
  viewMs = GRAPH_VIEW_MS,
): GraphPoint[] {
  const windowStart = Math.max(0, windowEnd - viewMs);
  return samples
    .filter((s) => s.elapsed >= windowStart - 50)
    .map((s) => projectSample(s, windowEnd, yMax, viewMs));
}

export function buildPath(points: GraphPoint[]): string {
  if (points.length === 0) return '';
  let d = `M ${points[0]!.x.toFixed(2)} ${points[0]!.y.toFixed(2)}`;
  for (let i = 1; i < points.length; i++) {
    d += ` L ${points[i]!.x.toFixed(2)} ${points[i]!.y.toFixed(2)}`;
  }
  return d;
}
