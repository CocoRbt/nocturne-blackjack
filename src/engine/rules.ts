import type { SideBetId } from './types';

/** Lit sonore de table (branché sur `sounds.setAmbience`). */
export type TableAmbienceId = 'emeraude' | 'onyx' | 'imperiale' | 'privee';

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
  /** Profil d’ambiance sonore (pads + bruit de salle). */
  ambienceId: TableAmbienceId;
  /** @deprecated conservé pour compat — préférer ambienceId. */
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
  /**
   * Pic de crédit minimal pour débloquer la table (progression).
   * 0 = toujours débloquée (Émeraude).
   */
  unlockPeak: number;
}

const BASE_RULES: Omit<
  RulesConfig,
  | 'decks'
  | 'dealerHitsSoft17'
  | 'minBet'
  | 'maxBet'
  | 'sideBetMin'
  | 'sideBetMax'
  | 'resplitAces'
  | 'lateSurrender'
> = {
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

/** Les trois tables thématiques du cercle. Montants en centimes. */
export const TABLES: TableConfig[] = [
  {
    id: 'emeraude',
    name: 'Salon Émeraude',
    tagline: 'Table d’entrée · mises douces · jetons accessibles',
    felt: 'emerald',
    unlockPeak: 0,
    identity: {
      accent: '#c2a15f',
      lamp: 'rgba(216, 201, 160, 0.10)',
      ambienceId: 'emeraude',
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
    tagline: 'Limites relevées · une fois le Salon maîtrisé',
    felt: 'onyx',
    /** Déblocage : avoir atteint le plafond Émeraude au moins une fois. */
    unlockPeak: 500_00,
    identity: {
      accent: '#a8b0c0',
      lamp: 'rgba(168, 176, 192, 0.08)',
      ambienceId: 'onyx',
      ambienceHz: 180,
      motto: '« Le silence tient la banque. »',
    },
    rules: {
      ...BASE_RULES,
      decks: 8,
      dealerHitsSoft17: false,
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
    tagline: 'Table haute · pour ceux qui ont fait grossir le crédit',
    felt: 'oxblood',
    unlockPeak: 2_000_00,
    identity: {
      accent: '#cf9a6c',
      lamp: 'rgba(224, 176, 144, 0.09)',
      ambienceId: 'imperiale',
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

/** Identifiant de la table privée (endgame). */
export const PRIVATE_TABLE_ID = 'privee';

/** Bornes du salon privé — pas un sur-mesure total dès le lobby. */
export const PRIVATE_BOUNDS = {
  minBetChoices: [25_00, 50_00, 100_00, 250_00, 500_00, 1_000_00] as const,
  maxBetChoices: [1_000_00, 2_500_00, 5_000_00, 10_000_00, 25_000_00, 50_000_00, 100_000_00] as const,
  /** Pic requis : plafond Impériale (le joueur a été bridé). */
  unlockPeak: 10_000_00,
};

export interface PrivateLimits {
  minBet: number;
  maxBet: number;
}

export function defaultPrivateLimits(): PrivateLimits {
  return { minBet: 250_00, maxBet: 25_000_00 };
}

/** Construit la config runtime de la Table Privée. */
export function buildPrivateTable(limits: PrivateLimits): TableConfig {
  const minBet = limits.minBet;
  const maxBet = Math.max(limits.maxBet, minBet * 10);
  const sideBetMin = Math.max(1_00, Math.round(minBet / 5));
  const sideBetMax = Math.max(sideBetMin * 10, Math.round(maxBet / 10));
  return {
    id: PRIVATE_TABLE_ID,
    name: 'Table Privée',
    tagline: `Sur mesure · mise ${minBet / 100} – ${maxBet / 100}`,
    felt: 'private',
    unlockPeak: PRIVATE_BOUNDS.unlockPeak,
    identity: {
      accent: '#d4af77',
      lamp: 'rgba(212, 175, 119, 0.11)',
      ambienceId: 'privee',
      ambienceHz: 240,
      motto: '« Le cercle se referme sur ceux qui restent. »',
    },
    rules: {
      ...BASE_RULES,
      decks: 6,
      dealerHitsSoft17: false,
      resplitAces: true,
      lateSurrender: true,
      minBet,
      maxBet,
      sideBetMin,
      sideBetMax,
    },
  };
}

let privateOverrides: PrivateLimits | null = null;

/** Enregistre les limites privées pour `getTable('privee')`. */
export function setPrivateLimits(limits: PrivateLimits | null): void {
  privateOverrides = limits;
}

export function getPrivateLimits(): PrivateLimits {
  return privateOverrides ?? defaultPrivateLimits();
}

export function getTable(id: string): TableConfig {
  if (id === PRIVATE_TABLE_ID) {
    return buildPrivateTable(getPrivateLimits());
  }
  const t = TABLES.find((t) => t.id === id);
  if (!t) throw new Error(`Table inconnue : ${id}`);
  return t;
}

export function allLobbyTables(privateLimits?: PrivateLimits | null): TableConfig[] {
  return [...TABLES, buildPrivateTable(privateLimits ?? getPrivateLimits())];
}

/** La table est débloquée par le pic de crédit (progression). */
export function isTableUnlocked(tableId: string, peakBalance: number): boolean {
  if (tableId === PRIVATE_TABLE_ID) {
    return peakBalance >= PRIVATE_BOUNDS.unlockPeak;
  }
  const t = getTable(tableId);
  return peakBalance >= t.unlockPeak;
}

/** On peut s’asseoir : débloquée + solde ≥ mise min. */
export function canSitAtTable(
  tableId: string,
  balance: number,
  peakBalance: number,
  privateLimits?: PrivateLimits | null,
): boolean {
  const table =
    tableId === PRIVATE_TABLE_ID
      ? buildPrivateTable(privateLimits ?? getPrivateLimits())
      : getTable(tableId);
  return isTableUnlocked(tableId, peakBalance) && balance >= table.rules.minBet;
}

/** Applique un ratio [num, den] à un montant en centimes (arrondi au centime). */
export function applyRatio(amount: number, ratio: [number, number]): number {
  return Math.round((amount * ratio[0]) / ratio[1]);
}
