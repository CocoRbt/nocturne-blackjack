import { describe, expect, it } from 'vitest';
import {
  buildPrivateTable,
  canSitAtTable,
  defaultPrivateLimits,
  isTableUnlocked,
  migratePrivateLimits,
  PRIVATE_BOUNDS,
  PRIVATE_TABLE_ID,
  TABLES,
} from '../rules';

describe('progression des tables', () => {
  it('Émeraude est toujours débloquée', () => {
    expect(isTableUnlocked('emeraude', 0)).toBe(true);
    expect(canSitAtTable('emeraude', 100_00, 100_00)).toBe(true);
  });

  it('Onyx se débloque au plafond Émeraude', () => {
    expect(isTableUnlocked('onyx', 499_00)).toBe(false);
    expect(isTableUnlocked('onyx', 500_00)).toBe(true);
    expect(canSitAtTable('onyx', 20_00, 500_00)).toBe(false); // sous la min
    expect(canSitAtTable('onyx', 25_00, 500_00)).toBe(true);
  });

  it('Impériale puis Privée suivent les seuils', () => {
    expect(isTableUnlocked('imperiale', 1_999_00)).toBe(false);
    expect(isTableUnlocked('imperiale', 2_000_00)).toBe(true);
    expect(isTableUnlocked(PRIVATE_TABLE_ID, 9_999_00)).toBe(false);
    expect(isTableUnlocked(PRIVATE_TABLE_ID, PRIVATE_BOUNDS.unlockPeak)).toBe(true);
  });

  it('Table Privée construit des limites cohérentes', () => {
    const t = buildPrivateTable({ minBet: 500_00, maxBet: 100_000_00 });
    expect(t.id).toBe(PRIVATE_TABLE_ID);
    expect(t.rules.minBet).toBe(500_00);
    expect(t.rules.maxBet).toBe(100_000_00);
    expect(t.rules.sideBetMax).toBeGreaterThanOrEqual(t.rules.sideBetMin);
  });

  it('migre l’ancien plafond 25k', () => {
    expect(migratePrivateLimits({ minBet: 250_00, maxBet: 25_000_00 }).maxBet).toBe(
      defaultPrivateLimits().maxBet,
    );
    expect(migratePrivateLimits({ minBet: 250_00, maxBet: 50_000_00 }).maxBet).toBe(50_000_00);
  });

  it('les trois tables thématiques exposent unlockPeak', () => {
    expect(TABLES.map((t) => t.unlockPeak)).toEqual([0, 500_00, 2_000_00]);
  });
});
