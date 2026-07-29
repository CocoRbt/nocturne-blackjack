import { cardValue, isRed, isTenValue } from './cards';
import type { Card, SideBetId } from './types';

/**
 * Side bets — variantes reconnues, tables de paiement centralisées.
 *
 * - Perfect Pairs : paire sur les 2 premières cartes du joueur.
 * - 21+3 : main de poker avec les 2 cartes du joueur + la carte visible du croupier.
 * - Lucky Ladies : total de 20 sur les 2 premières cartes du joueur.
 * - Bust It (Buster Blackjack) : le croupier saute ; payé selon le nombre de cartes.
 * - Royal Match : 2 premières cartes du joueur assorties ; bonus Roi+Dame assortis.
 */

export interface PaytableRow {
  key: string;
  label: string;
  pays: number; // multiplicateur x:1 (2.5 = 5:2)
}

export interface SideBetDefinition {
  id: SideBetId;
  name: string;
  shortName: string;
  description: string;
  /** Résolu à la donne ('deal') ou après le tour du croupier ('dealer'). */
  resolvesAt: 'deal' | 'dealer';
  paytable: PaytableRow[];
}

export const SIDE_BET_DEFS: Record<SideBetId, SideBetDefinition> = {
  perfectPairs: {
    id: 'perfectPairs',
    name: 'Perfect Pairs',
    shortName: 'Paires',
    description: 'Vos deux premières cartes forment une paire.',
    resolvesAt: 'deal',
    paytable: [
      { key: 'perfect', label: 'Paire parfaite (même carte)', pays: 25 },
      { key: 'colored', label: 'Paire colorée (même couleur)', pays: 12 },
      { key: 'mixed', label: 'Paire mixte', pays: 6 },
    ],
  },
  twentyOnePlusThree: {
    id: 'twentyOnePlusThree',
    name: '21+3',
    shortName: '21+3',
    description: 'Vos deux cartes + la carte visible du croupier forment une main de poker.',
    resolvesAt: 'deal',
    paytable: [
      { key: 'suitedTrips', label: 'Brelan assorti', pays: 100 },
      { key: 'straightFlush', label: 'Quinte flush', pays: 40 },
      { key: 'trips', label: 'Brelan', pays: 30 },
      { key: 'straight', label: 'Quinte', pays: 10 },
      { key: 'flush', label: 'Couleur', pays: 5 },
    ],
  },
  luckyLadies: {
    id: 'luckyLadies',
    name: 'Lucky Ladies',
    shortName: 'Ladies',
    description: 'Vos deux premières cartes totalisent 20.',
    resolvesAt: 'deal',
    paytable: [
      { key: 'qhBj', label: 'Paire de Dames de cœur + BJ croupier', pays: 1000 },
      { key: 'qhPair', label: 'Paire de Dames de cœur', pays: 125 },
      { key: 'matched20', label: '20 identique (même rang, même enseigne)', pays: 19 },
      { key: 'suited20', label: '20 assorti', pays: 9 },
      { key: 'any20', label: '20 quelconque', pays: 4 },
    ],
  },
  bustIt: {
    id: 'bustIt',
    name: 'Bust It',
    shortName: 'Bust It',
    description: 'Le croupier dépasse 21. Payé selon son nombre de cartes.',
    resolvesAt: 'dealer',
    paytable: [
      { key: 'bust8', label: 'Saute avec 8 cartes ou plus', pays: 250 },
      { key: 'bust7', label: 'Saute avec 7 cartes', pays: 50 },
      { key: 'bust6', label: 'Saute avec 6 cartes', pays: 18 },
      { key: 'bust5', label: 'Saute avec 5 cartes', pays: 4 },
      { key: 'bust34', label: 'Saute avec 3 ou 4 cartes', pays: 2 },
    ],
  },
  royalMatch: {
    id: 'royalMatch',
    name: 'Royal Match',
    shortName: 'Royal',
    description: 'Vos deux premières cartes sont de la même enseigne.',
    resolvesAt: 'deal',
    paytable: [
      { key: 'royal', label: 'Mariage royal (Roi + Dame assortis)', pays: 25 },
      { key: 'suited', label: 'Deux cartes assorties', pays: 2.5 },
    ],
  },
};

export interface SideBetEvaluation {
  /** Ligne gagnante de la table de paiement, null si perdu. */
  row: PaytableRow | null;
}

function evalPerfectPairs(player: [Card, Card]): SideBetEvaluation {
  const [a, b] = player;
  const rows = SIDE_BET_DEFS.perfectPairs.paytable;
  if (a.rank !== b.rank) return { row: null };
  if (a.suit === b.suit) return { row: rows.find((r) => r.key === 'perfect')! };
  if (isRed(a.suit) === isRed(b.suit)) return { row: rows.find((r) => r.key === 'colored')! };
  return { row: rows.find((r) => r.key === 'mixed')! };
}

/** Ordre des rangs pour les quintes du 21+3 (As haut ou bas, pas de tour du roi). */
const STRAIGHT_ORDER: string[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

function isStraightRanks(ranks: string[]): boolean {
  const idx = ranks.map((r) => STRAIGHT_ORDER.indexOf(r)).sort((x, y) => x - y);
  if (new Set(idx).size !== 3) return false;
  if (idx[2] - idx[0] === 2 && idx[1] - idx[0] === 1) return true;
  // Quinte à l'As haut : Q-K-A
  return idx[0] === 0 && idx[1] === 11 && idx[2] === 12;
}

function eval21Plus3(player: [Card, Card], dealerUp: Card): SideBetEvaluation {
  const cards = [player[0], player[1], dealerUp];
  const rows = SIDE_BET_DEFS.twentyOnePlusThree.paytable;
  const ranks = cards.map((c) => c.rank);
  const suits = cards.map((c) => c.suit);
  const flush = suits[0] === suits[1] && suits[1] === suits[2];
  const trips = ranks[0] === ranks[1] && ranks[1] === ranks[2];
  const straight = isStraightRanks(ranks);
  if (trips && flush) return { row: rows.find((r) => r.key === 'suitedTrips')! };
  if (straight && flush) return { row: rows.find((r) => r.key === 'straightFlush')! };
  if (trips) return { row: rows.find((r) => r.key === 'trips')! };
  if (straight) return { row: rows.find((r) => r.key === 'straight')! };
  if (flush) return { row: rows.find((r) => r.key === 'flush')! };
  return { row: null };
}

function evalLuckyLadies(player: [Card, Card], dealerBlackjack: boolean): SideBetEvaluation {
  const [a, b] = player;
  const rows = SIDE_BET_DEFS.luckyLadies.paytable;
  const total = cardValue(a.rank) + cardValue(b.rank);
  if (total !== 20) return { row: null };
  const isQh = (c: Card) => c.rank === 'Q' && c.suit === '♥';
  if (isQh(a) && isQh(b)) {
    return dealerBlackjack
      ? { row: rows.find((r) => r.key === 'qhBj')! }
      : { row: rows.find((r) => r.key === 'qhPair')! };
  }
  if (a.rank === b.rank && a.suit === b.suit) return { row: rows.find((r) => r.key === 'matched20')! };
  if (a.suit === b.suit) return { row: rows.find((r) => r.key === 'suited20')! };
  return { row: rows.find((r) => r.key === 'any20')! };
}

function evalBustIt(dealerCards: Card[], dealerBusted: boolean): SideBetEvaluation {
  if (!dealerBusted) return { row: null };
  const rows = SIDE_BET_DEFS.bustIt.paytable;
  const n = dealerCards.length;
  if (n >= 8) return { row: rows.find((r) => r.key === 'bust8')! };
  if (n === 7) return { row: rows.find((r) => r.key === 'bust7')! };
  if (n === 6) return { row: rows.find((r) => r.key === 'bust6')! };
  if (n === 5) return { row: rows.find((r) => r.key === 'bust5')! };
  return { row: rows.find((r) => r.key === 'bust34')! };
}

function evalRoyalMatch(player: [Card, Card]): SideBetEvaluation {
  const [a, b] = player;
  const rows = SIDE_BET_DEFS.royalMatch.paytable;
  if (a.suit !== b.suit) return { row: null };
  const isRoyal =
    (a.rank === 'K' && b.rank === 'Q') || (a.rank === 'Q' && b.rank === 'K');
  return isRoyal
    ? { row: rows.find((r) => r.key === 'royal')! }
    : { row: rows.find((r) => r.key === 'suited')! };
}

/** Évalue un side bet résolu à la donne. */
export function evaluateDealSideBet(
  id: SideBetId,
  player: [Card, Card],
  dealerUp: Card,
  dealerBlackjack: boolean,
): SideBetEvaluation {
  switch (id) {
    case 'perfectPairs':
      return evalPerfectPairs(player);
    case 'twentyOnePlusThree':
      return eval21Plus3(player, dealerUp);
    case 'luckyLadies':
      return evalLuckyLadies(player, dealerBlackjack);
    case 'royalMatch':
      return evalRoyalMatch(player);
    case 'bustIt':
      throw new Error('Bust It se résout après le tour du croupier');
  }
}

export function evaluateBustIt(dealerCards: Card[], dealerBusted: boolean): SideBetEvaluation {
  return evalBustIt(dealerCards, dealerBusted);
}

/** Petit export utilitaire pour l'UI : la carte 10/J/Q/K compte 10. */
export { isTenValue };
