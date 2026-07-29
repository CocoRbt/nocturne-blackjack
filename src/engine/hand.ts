import { cardValue } from './cards';
import type { Card } from './types';

export interface HandValue {
  /** Meilleur total <= 21, sinon total minimal (bust). */
  total: number;
  /** true si un As compte pour 11 dans le meilleur total. */
  soft: boolean;
  bust: boolean;
}

export function handValue(cards: Card[]): HandValue {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    total += cardValue(c.rank);
    if (c.rank === 'A') aces++;
  }
  // Promeut au plus un As de 1 à 11 si cela reste <= 21.
  let soft = false;
  if (aces > 0 && total + 10 <= 21) {
    total += 10;
    soft = true;
  }
  return { total, soft, bust: total > 21 };
}

/** Blackjack naturel : 21 en deux cartes, hors main issue d'un split. */
export function isNaturalBlackjack(cards: Card[], fromSplit: boolean): boolean {
  return !fromSplit && cards.length === 2 && handValue(cards).total === 21;
}

export function isPair(cards: Card[], allowMixedTenValue: boolean): boolean {
  if (cards.length !== 2) return false;
  const [a, b] = cards;
  if (a.rank === b.rank) return true;
  return allowMixedTenValue && cardValue(a.rank) === 10 && cardValue(b.rank) === 10;
}
