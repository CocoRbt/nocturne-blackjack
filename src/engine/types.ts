/**
 * Types fondamentaux du moteur de blackjack.
 * Tous les montants monétaires sont exprimés en CENTIMES (entiers)
 * pour garantir des paiements exacts (ex. blackjack 3:2).
 */

export const SUITS = ['♠', '♥', '♦', '♣'] as const;
export type Suit = (typeof SUITS)[number];

export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const;
export type Rank = (typeof RANKS)[number];

export interface Card {
  rank: Rank;
  suit: Suit;
  /** Identifiant unique dans le sabot (pour les clés React / animations). */
  id: string;
}

export type SideBetId = 'perfectPairs' | 'twentyOnePlusThree' | 'luckyLadies' | 'bustIt' | 'royalMatch';

export const SIDE_BET_IDS: SideBetId[] = [
  'perfectPairs',
  'twentyOnePlusThree',
  'luckyLadies',
  'bustIt',
  'royalMatch',
];

/** Mises posées au début d'une manche (en centimes). */
export interface BetLayout {
  main: number;
  sideBets: Partial<Record<SideBetId, number>>;
}

export type RoundPhase =
  | 'dealing'
  | 'insurance' // le croupier montre un As : assurance / even money
  | 'player'
  | 'dealer'
  | 'settled';

export type PlayerActionType = 'hit' | 'stand' | 'double' | 'split' | 'surrender';

export interface PlayerHandState {
  cards: Card[];
  bet: number;
  /** Main issue d'un split. */
  fromSplit: boolean;
  /** Main issue d'un split d'As (une seule carte, pas de blackjack). */
  fromSplitAces: boolean;
  doubled: boolean;
  surrendered: boolean;
  stood: boolean;
  /** Main résolue avant le tour du croupier (blackjack naturel payé, abandon...). */
  settledEarly: boolean;
}

export type HandOutcome =
  | 'blackjack'
  | 'win'
  | 'push'
  | 'lose'
  | 'surrender'
  | 'evenMoney';

export interface HandResult {
  handIndex: number;
  outcome: HandOutcome;
  bet: number;
  /** Montant total rendu au joueur (mise + gain), en centimes. */
  returned: number;
  /** Gain net (returned - bet). */
  net: number;
}

export interface SideBetResult {
  id: SideBetId;
  bet: number;
  /** Libellé de la combinaison gagnante, null si perdu. */
  label: string | null;
  /** Multiplicateur "x:1" appliqué (0 si perdu). */
  paysMultiplier: number;
  returned: number;
  net: number;
}

export interface InsuranceResult {
  bet: number;
  won: boolean;
  returned: number;
  net: number;
}

export interface RoundSummary {
  hands: HandResult[];
  sideBets: SideBetResult[];
  insurance: InsuranceResult | null;
  dealerCards: Card[];
  dealerTotal: number;
  dealerBust: boolean;
  dealerBlackjack: boolean;
  /** Somme totale rendue au joueur (à créditer au solde). */
  totalReturned: number;
  /** Net de la manche : totalReturned - tout ce qui a été misé. */
  totalNet: number;
  totalWagered: number;
}
