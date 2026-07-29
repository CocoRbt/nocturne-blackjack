import type { SideBetId } from './types';

/**
 * Configuration complète des règles d'une table.
 * Tout est centralisé ici : règles de jeu, limites, paiements.
 */
export interface RulesConfig {
  /** Nombre de jeux dans le sabot. */
  decks: number;
  /** Pénétration du sabot (proportion distribuée avant re-mélange). */
  penetration: number;
  /** Le croupier tire sur soft 17 (H17) ou reste (S17). */
  dealerHitsSoft17: boolean;
  /** Blackjack payé : [numérateur, dénominateur] — [3, 2] = 3:2. */
  blackjackPays: [number, number];
  /** Double autorisé : 'any2' ou seulement sur totaux 9-11. */
  doubleOn: 'any2' | '9to11';
  /** Double après split autorisé (DAS). */
  doubleAfterSplit: boolean;
  /** Nombre maximal de mains après splits (4 = re-split jusqu'à 3 fois). */
  maxSplitHands: number;
  /** Re-split des As autorisé. */
  resplitAces: boolean;
  /** Une seule carte sur chaque As splitté. */
  splitAcesOneCard: boolean;
  /** Split autorisé entre cartes de valeur 10 différentes (K+Q...). */
  splitMixedTens: boolean;
  /** Abandon tardif (late surrender) autorisé. */
  lateSurrender: boolean;
  /** Le croupier vérifie le blackjack (hole card) avec As ou 10 visible. */
  dealerPeeks: boolean;
  /** Assurance payée 2:1. */
  insurancePays: [number, number];
  /** Limites de la mise principale, en centimes. */
  minBet: number;
  maxBet: number;
  /** Limites des side bets, en centimes. */
  sideBetMin: number;
  sideBetMax: number;
  /** Side bets proposés sur cette table. */
  sideBets: SideBetId[];
}

/** Identité sensorielle d'une table : lumière, accent, ambiance, devise. */
export interface TableIdentity {
  /** Couleur d'accent (laiton teinté) appliquée aux liserés / CTA. */
  accent: string;
  /** Couleur du halo de lampe au-dessus de la table. */
  lamp: string;
  /** Fréquence de coupure (Hz) du filtre de l'ambiance sonore. */
  ambienceHz: number;
  /** Devise affichée sur le feutre. */
  motto: string;
}

export interface TableConfig {
  id: string;
  name: string;
  tagline: string;
  /** Couleur d'accent du feutre. */
  felt: string;
  identity: TableIdentity;
  rules: RulesConfig;
}

const BASE_RULES: Omit<RulesConfig, 'decks' | 'dealerHitsSoft17' | 'minBet' | 'maxBet' | 'sideBetMin' | 'sideBetMax' | 'resplitAces' | 'lateSurrender'> = {
  penetration: 0.75,
  blackjackPays: [3, 2],
  doubleOn: 'any2',
  doubleAfterSplit: true,
  maxSplitHands: 4,
  splitAcesOneCard: true,
  splitMixedTens: true,
  dealerPeeks: true,
  insurancePays: [2, 1],
  sideBets: ['twentyOnePlusThree', 'perfectPairs'],
};

/** Les trois tables du cercle. Montants en centimes. */
export const TABLES: TableConfig[] = [
  {
    id: 'emeraude',
    name: 'Salon Émeraude',
    tagline: '6 jeux · croupier reste sur soft 17 · abandon autorisé',
    felt: 'emerald',
    identity: {
      accent: '#c2a15f',
      lamp: 'rgba(216, 201, 160, 0.10)',
      ambienceHz: 220,
      motto: '« La nuit ne compte pas ses cartes. »',
    },
    rules: {
      ...BASE_RULES,
      decks: 6,
      dealerHitsSoft17: false,
      resplitAces: false,
      lateSurrender: true,
      minBet: 5_00,
      maxBet: 500_00,
      sideBetMin: 1_00,
      sideBetMax: 100_00,
    },
  },
  {
    id: 'onyx',
    name: 'Table Onyx',
    tagline: '8 jeux · croupier tire sur soft 17 · limites relevées',
    felt: 'onyx',
    identity: {
      accent: '#a8b0c0',
      lamp: 'rgba(168, 176, 192, 0.08)',
      ambienceHz: 180,
      motto: '« Le silence tient la banque. »',
    },
    rules: {
      ...BASE_RULES,
      decks: 8,
      dealerHitsSoft17: true,
      resplitAces: false,
      lateSurrender: true,
      minBet: 25_00,
      maxBet: 2_000_00,
      sideBetMin: 5_00,
      sideBetMax: 250_00,
    },
  },
  {
    id: 'imperiale',
    name: 'Suite Impériale',
    tagline: '6 jeux · re-split des As · table haute',
    felt: 'oxblood',
    identity: {
      accent: '#cf9a6c',
      lamp: 'rgba(224, 176, 144, 0.09)',
      ambienceHz: 260,
      motto: '« On ne compte qu\u2019après minuit. »',
    },
    rules: {
      ...BASE_RULES,
      decks: 6,
      dealerHitsSoft17: false,
      resplitAces: true,
      lateSurrender: false,
      minBet: 100_00,
      maxBet: 10_000_00,
      sideBetMin: 25_00,
      sideBetMax: 1_000_00,
    },
  },
];

export function getTable(id: string): TableConfig {
  const t = TABLES.find((t) => t.id === id);
  if (!t) throw new Error(`Table inconnue : ${id}`);
  return t;
}

/** Applique un ratio [num, den] à un montant en centimes (arrondi au centime). */
export function applyRatio(amount: number, ratio: [number, number]): number {
  return Math.round((amount * ratio[0]) / ratio[1]);
}
