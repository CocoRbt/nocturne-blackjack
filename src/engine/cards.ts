import { RANKS, SUITS, type Card, type Rank, type Suit } from './types';

/** Valeur de comptage d'une carte (As = 1, figures = 10). */
export function cardValue(rank: Rank): number {
  if (rank === 'A') return 1;
  if (rank === 'K' || rank === 'Q' || rank === 'J') return 10;
  return parseInt(rank, 10);
}

export function isTenValue(rank: Rank): boolean {
  return cardValue(rank) === 10;
}

export function isRed(suit: Suit): boolean {
  return suit === '♥' || suit === '♦';
}

/** Crée `deckCount` jeux de 52 cartes avec identifiants uniques. */
export function buildDecks(deckCount: number): Card[] {
  const cards: Card[] = [];
  for (let d = 0; d < deckCount; d++) {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        cards.push({ rank, suit, id: `${rank}${suit}#${d}` });
      }
    }
  }
  return cards;
}

/** Utilitaire de test : "AH" -> As de cœur, "10S" -> 10 de pique. */
export function card(code: string, id = code): Card {
  const suitChar = code.slice(-1);
  const rank = code.slice(0, -1) as Rank;
  const suitMap: Record<string, Suit> = { S: '♠', H: '♥', D: '♦', C: '♣' };
  const suit = suitMap[suitChar];
  if (!suit || !RANKS.includes(rank)) throw new Error(`Code carte invalide : ${code}`);
  return { rank, suit, id };
}
