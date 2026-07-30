/**
 * Toutes les durées de présentation du jeu, centralisées et scalées
 * par la vitesse choisie. Aucun composant ni le store ne doit contenir
 * de délai magique : tout passe par TIMING[gameSpeed].
 */

export type GameSpeed = 'classic' | 'fast';

export interface TimingProfile {
  /** Intervalle entre deux cartes de la donne initiale (ms). */
  dealGap: number;
  /** Déverrouillage des actions après le début de la donne (ms) — base 4 cartes. */
  dealUnlock: number;
  /** Délai avant le flip de la carte cachée du croupier (ms). */
  holeDelay: number;
  /** Pause après le flip, avant le premier tirage croupier (ms). */
  postHoleGap: number;
  /** Intervalle entre deux cartes tirées par le croupier (ms). */
  dealerCardGap: number;
  /** Durée du vol des jetons vers le solde / la défausse (ms). */
  payoutFly: number;
  /** Pause entre « Remiser » et la donne automatique (ms). */
  rebetPause: number;
  /** Stagger Framer Motion (s) par carte hors donne initiale. */
  cardStagger: number;
}

/**
 * classic ≈ rythme croupier humain (≈ 0,5 s entre chaque carte).
 * fast = accéléré mais encore lisible.
 */
export const TIMING: Record<GameSpeed, TimingProfile> = {
  classic: {
    dealGap: 520,
    /** 3 × gap + temps de vol ≈ 2,1 s pour 4 cartes. */
    dealUnlock: 2100,
    holeDelay: 700,
    postHoleGap: 560,
    dealerCardGap: 620,
    payoutFly: 900,
    rebetPause: 450,
    cardStagger: 0.14,
  },
  fast: {
    dealGap: 240,
    dealUnlock: 980,
    holeDelay: 280,
    postHoleGap: 260,
    dealerCardGap: 280,
    payoutFly: 420,
    rebetPause: 200,
    cardStagger: 0.07,
  },
};
