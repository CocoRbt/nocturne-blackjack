import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../rng';
import { DealingShoe } from '../shoe';

describe('DealingShoe', () => {
  it('contient decks x 52 cartes uniques', () => {
    const shoe = new DealingShoe(6, 0.75, mulberry32(42));
    expect(shoe.size()).toBe(312);
    const seen = new Set<string>();
    for (let i = 0; i < 312; i++) seen.add(shoe.draw().id);
    expect(seen.size).toBe(312);
  });

  it('demande un re-mélange après la carte de coupe', () => {
    const shoe = new DealingShoe(1, 0.5, mulberry32(1));
    expect(shoe.needsShuffle()).toBe(false);
    for (let i = 0; i < 26; i++) shoe.draw();
    expect(shoe.needsShuffle()).toBe(true);
    expect(shoe.shuffleIfNeeded()).toBe(true);
    expect(shoe.cardsDealt()).toBe(0);
    expect(shoe.needsShuffle()).toBe(false);
  });

  it('distribution à peu près uniforme des rangs (mélange sain)', () => {
    const shoe = new DealingShoe(8, 1, mulberry32(7));
    const firstTen = Array.from({ length: 10 }, () => shoe.draw().rank);
    // Pas un test statistique strict : vérifie simplement que le sabot n'est pas trié.
    expect(new Set(firstTen).size).toBeGreaterThan(2);
  });
});
