/** Identifiants des zones mesurables pour les futures animations (getBoundingClientRect). */
export const ANIMATION_ZONES = {
  shoe: 'shoe',
  /** Sabot visuel sur la table — origine réelle de la distribution. */
  dealOrigin: 'deal-origin',
  dealerHand: 'dealer-hand',
  playerHand: 'player-hand',
  balance: 'balance',
  payout: 'payout',
  betMain: 'bet-main',
  betSide: 'bet-side',
  stage: 'stage',
} as const;

export type AnimationZone = (typeof ANIMATION_ZONES)[keyof typeof ANIMATION_ZONES];

/** Chevauchement adaptatif : plus de cartes → plus de recouvrement (mains compactes). */
export function cardOverlapRatio(count: number): number {
  if (count <= 1) return 0;
  if (count <= 2) return 0.48;
  if (count <= 4) return 0.54;
  if (count <= 6) return 0.6;
  return 0.66;
}

/** Échelle des mains quand plusieurs splits sont actifs. */
export function splitHandScale(handCount: number): number {
  if (handCount <= 2) return 1;
  if (handCount === 3) return 0.9;
  return 0.78;
}

/** Mesure une zone d'animation dans le viewport (pour le prochain agent motion). */
export function measureZone(id: AnimationZone): DOMRect | null {
  if (typeof document === 'undefined') return null;
  const el = document.querySelector(`[data-zone="${id}"]`);
  return el?.getBoundingClientRect() ?? null;
}

/** Ancre de crédit / paiement (balance + data-payout-anchor). */
export function measurePayoutAnchor(): DOMRect | null {
  if (typeof document === 'undefined') return null;
  const el = document.querySelector('[data-payout-anchor]');
  return el?.getBoundingClientRect() ?? null;
}
