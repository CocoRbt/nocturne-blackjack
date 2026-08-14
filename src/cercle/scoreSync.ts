/**
 * Marque le score local comme « à pousser » après une vraie action de jeu
 * (manche réglée, salon, refill, récompense défi) — pas un edit fantôme.
 */

const EVENT = 'nocturne-score-dirty';

let dirty = false;
/** Invalide les push en vol (login compte / hydrate cloud). */
let syncEpoch = 0;

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

/** Annule un push pending — le local n’est plus la source de vérité. */
export function clearScoreDirty(): void {
  dirty = false;
}

export function isScoreDirty(): boolean {
  return dirty;
}

export function bumpSyncEpoch(): number {
  syncEpoch += 1;
  return syncEpoch;
}

export function getSyncEpoch(): number {
  return syncEpoch;
}

export function onScoreDirty(cb: () => void): () => void {
  const handler = () => cb();
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
