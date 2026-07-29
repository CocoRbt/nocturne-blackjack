/**
 * Toutes les durées de présentation du jeu, centralisées et scalées
 * par la vitesse choisie. Aucun composant ni le store ne doit contenir
 * de délai magique : tout passe par TIMING[gameSpeed].
 */

export type GameSpeed = 'classic' | 'fast';

export interface TimingProfile {
  /** Intervalle entre deux cartes de la donne initiale (ms). */
  dealGap: number;
  /** Déverrouillage des actions après le début de la donne (ms). */
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

export const TIMING: Record<GameSpeed, TimingProfile> = {
  classic: {
    /** 4 cartes ≈ 1,0 s (3× gap + trajet). */
    dealGap: 190,
    dealUnlock: 1020,
    holeDelay: 260,
    postHoleGap: 380,
    dealerCardGap: 360,
    payoutFly: 700,
    rebetPause: 280,
    cardStagger: 0.1,
  },
  fast: {
    dealGap: 95,
    dealUnlock: 480,
    holeDelay: 100,
    postHoleGap: 150,
    dealerCardGap: 140,
    payoutFly: 280,
    rebetPause: 120,
    cardStagger: 0.05,
  },
};
