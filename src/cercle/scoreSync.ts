/**
 * Marque le score local comme « à pousser » après une vraie action de jeu
 * (manche réglée, salon, refill, récompense défi) — pas un edit fantôme.
 */

const EVENT = 'nocturne-score-dirty';

let dirty = false;

export function markScoreDirty(): void {
  dirty = true;
  try {
    window.dispatchEvent(new Event(EVENT));
  } catch {
    /* SSR / tests */
  }
}

export function consumeScoreDirty(): boolean {
  const was = dirty;
  dirty = false;
  return was;
}

export function isScoreDirty(): boolean {
  return dirty;
}

export function onScoreDirty(cb: () => void): () => void {
  const handler = () => cb();
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
