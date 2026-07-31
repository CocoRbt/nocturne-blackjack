import { describe, expect, it } from 'vitest';
import { card } from '../cards';
import { dealerMustHit, handValue, isNaturalBlackjack, isPair } from '../hand';

const h = (...codes: string[]) => codes.map((c, i) => card(c, `${c}-${i}`));

describe('handValue', () => {
  it('calcule les totaux durs', () => {
    expect(handValue(h('10S', '7H'))).toEqual({ total: 17, soft: false, bust: false });
    expect(handValue(h('KS', 'QH', '2D'))).toEqual({ total: 22, soft: false, bust: true });
  });

  it('gère les As en soft', () => {
    expect(handValue(h('AS', '6H'))).toEqual({ total: 17, soft: true, bust: false });
    expect(handValue(h('AS', 'AH'))).toEqual({ total: 12, soft: true, bust: false });
    expect(handValue(h('AS', 'AH', 'AD', 'AC'))).toEqual({ total: 14, soft: true, bust: false });
  });

  it('rétrograde les As quand nécessaire', () => {
    expect(handValue(h('AS', '6H', '10D'))).toEqual({ total: 17, soft: false, bust: false });
    expect(handValue(h('AS', 'AH', '9D'))).toEqual({ total: 21, soft: true, bust: false });
    expect(handValue(h('AS', '5H', '7D', '9C'))).toEqual({ total: 22, soft: false, bust: true });
  });

  it('soft 21 en plusieurs cartes n\u2019est pas bust', () => {
    expect(handValue(h('AS', '4H', '6D'))).toEqual({ total: 21, soft: true, bust: false });
  });
});

describe('dealerMustHit', () => {
  it('tire sous 17', () => {
    expect(dealerMustHit(h('10S', '6H'), false)).toBe(true);
    expect(dealerMustHit(h('10S', '6H'), true)).toBe(true);
  });

  it('reste sur 17 dur, même avec un As (S17 et H17)', () => {
    expect(dealerMustHit(h('10S', '7H'), true)).toBe(false);
    expect(dealerMustHit(h('10S', '6H', 'AD'), true)).toBe(false);
    expect(dealerMustHit(h('9S', '7H', 'AD'), false)).toBe(false);
  });

  it('soft 17 : tire seulement en H17', () => {
    expect(dealerMustHit(h('AS', '6H'), false)).toBe(false);
    expect(dealerMustHit(h('AS', '6H'), true)).toBe(true);
    expect(dealerMustHit(h('6S', 'AH'), true)).toBe(true);
  });

  it('reste au-dessus de 17', () => {
    expect(dealerMustHit(h('10S', '8H'), true)).toBe(false);
    expect(dealerMustHit(h('AS', '7H'), true)).toBe(false);
  });
});

describe('isNaturalBlackjack', () => {
  it('détecte A + 10/J/Q/K en deux cartes', () => {
    expect(isNaturalBlackjack(h('AS', 'KH'), false)).toBe(true);
    expect(isNaturalBlackjack(h('10D', 'AC'), false)).toBe(true);
  });
  it('refuse 21 en trois cartes', () => {
    expect(isNaturalBlackjack(h('7S', '7H', '7D'), false)).toBe(false);
  });
  it('refuse 21 après split', () => {
    expect(isNaturalBlackjack(h('AS', 'KH'), true)).toBe(false);
  });
});

describe('isPair', () => {
  it('même rang', () => {
    expect(isPair(h('8S', '8H'), false)).toBe(true);
    expect(isPair(h('8S', '9H'), false)).toBe(false);
  });
  it('cartes de valeur 10 mixtes selon la règle', () => {
    expect(isPair(h('KS', 'QH'), true)).toBe(true);
    expect(isPair(h('KS', 'QH'), false)).toBe(false);
    expect(isPair(h('10S', 'JH'), true)).toBe(true);
  });
});
