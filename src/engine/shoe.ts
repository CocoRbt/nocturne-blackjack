import { buildDecks } from './cards';
import { cryptoRng, shuffle, type Rng } from './rng';
import type { Card } from './types';

export interface Shoe {
  draw(): Card;
  /** Cartes restantes avant la carte de coupe. */
  remaining(): number;
  /** true si la carte de coupe a été atteinte : re-mélange avant la prochaine manche. */
  needsShuffle(): boolean;
  shuffleIfNeeded(): boolean;
  /** Nombre total de cartes dans le sabot. */
  size(): number;
  cardsDealt(): number;
}

/** Sabot multi-jeux avec carte de coupe et re-mélange entre les manches. */
export class DealingShoe implements Shoe {
  private cards: Card[] = [];
  private dealt = 0;
  private cutIndex = 0;

  private readonly deckCount: number;
  private readonly penetration: number;
  private readonly rng: Rng;

  constructor(deckCount: number, penetration: number, rng: Rng = cryptoRng()) {
    this.deckCount = deckCount;
    this.penetration = penetration;
    this.rng = rng;
    this.reshuffle();
  }

  private reshuffle(): void {
    this.cards = shuffle(buildDecks(this.deckCount), this.rng);
    this.dealt = 0;
    this.cutIndex = Math.floor(this.cards.length * this.penetration);
  }

  draw(): Card {
    // Sécurité : ne devrait jamais arriver en jeu normal (re-mélange entre manches),
    // mais garantit qu'une manche en cours peut toujours se terminer.
    if (this.dealt >= this.cards.length) this.reshuffle();
    return this.cards[this.dealt++];
  }

  remaining(): number {
    return this.cards.length - this.dealt;
  }

  needsShuffle(): boolean {
    return this.dealt >= this.cutIndex;
  }

  shuffleIfNeeded(): boolean {
    if (this.needsShuffle()) {
      this.reshuffle();
      return true;
    }
    return false;
  }

  size(): number {
    return this.cards.length;
  }

  cardsDealt(): number {
    return this.dealt;
  }
}

/** Sabot truqué pour les tests : distribue une séquence prédéfinie. */
export class RiggedShoe implements Shoe {
  private idx = 0;
  private readonly sequence: Card[];

  constructor(sequence: Card[]) {
    this.sequence = sequence;
  }

  draw(): Card {
    if (this.idx >= this.sequence.length) throw new Error('RiggedShoe épuisé');
    return this.sequence[this.idx++];
  }
  remaining(): number {
    return this.sequence.length - this.idx;
  }
  needsShuffle(): boolean {
    return false;
  }
  shuffleIfNeeded(): boolean {
    return false;
  }
  size(): number {
    return this.sequence.length;
  }
  cardsDealt(): number {
    return this.idx;
  }
}
