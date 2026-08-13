import { describe, expect, it } from 'vitest';
import {
  contribPartsCents,
  emptyJackpots,
  JACKPOT_SEEDS_CENTS,
  jackpotTierFromStarCount,
} from '../jackpot';
import { evaluateSpin, jackpotTierFromStars, type SlotSymbol } from '../math';

describe('stampede jackpot', () => {
  it('seeds = 50 / 250 / 1000 crédits', () => {
    const e = emptyJackpots();
    expect(e.miniCents).toBe(5_000);
    expect(e.majorCents).toBe(25_000);
    expect(e.grandCents).toBe(100_000);
    expect(JACKPOT_SEEDS_CENTS.mini).toBe(5_000);
  });

  it('contribution 1 % découpée (alignée SQL)', () => {
    const p = contribPartsCents(10_000); // 100 crédits
    expect(p.miniCents).toBe(50);
    expect(p.majorCents).toBe(30);
    expect(p.grandCents).toBe(20);
    expect(p.miniCents + p.majorCents + p.grandCents).toBe(100);
  });

  it('contribution minimale 1¢ par pot', () => {
    const p = contribPartsCents(100); // 1 crédit
    expect(p.miniCents).toBe(1);
    expect(p.majorCents).toBe(1);
    expect(p.grandCents).toBe(1);
  });

  it('tiers depuis le nombre d’étoiles', () => {
    expect(jackpotTierFromStarCount(0)).toBeNull();
    expect(jackpotTierFromStarCount(2)).toBeNull();
    expect(jackpotTierFromStarCount(3)).toBe('mini');
    expect(jackpotTierFromStarCount(4)).toBe('major');
    expect(jackpotTierFromStarCount(5)).toBe('grand');
    expect(jackpotTierFromStarCount(7)).toBe('grand');
    expect(jackpotTierFromStars(4)).toBe('major');
  });

  it('evaluateSpin détecte le jackpot en base uniquement', () => {
    const grid: SlotSymbol[][] = [
      ['star', 'J', 'J', 'J'],
      ['star', 'J', 'J', 'J'],
      ['star', 'J', 'J', 'J'],
      ['J', 'J', 'J', 'J'],
      ['J', 'J', 'J', 'J'],
    ];
    const base = evaluateSpin(grid, { freeSpinMode: false, herdHeads: 0, rng: () => 0.5 });
    expect(base.starCount).toBe(3);
    expect(base.jackpotTier).toBe('mini');

    const free = evaluateSpin(grid, { freeSpinMode: true, herdHeads: 0, rng: () => 0.5 });
    expect(free.starCount).toBe(3);
    expect(free.jackpotTier).toBeNull();
  });

  it('l’étoile casse une way', () => {
    const grid: SlotSymbol[][] = [
      ['bison', 'J', 'J', 'J'],
      ['bison', 'J', 'J', 'J'],
      ['star', 'J', 'J', 'J'],
      ['bison', 'J', 'J', 'J'],
      ['bison', 'J', 'J', 'J'],
    ];
    const ev = evaluateSpin(grid, { freeSpinMode: false, herdHeads: 0, rng: () => 0.5 });
    expect(ev.wayWins.some((w) => w.symbol === 'bison' && w.length >= 3)).toBe(false);
  });
});
