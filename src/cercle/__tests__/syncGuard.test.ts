import { describe, expect, it } from 'vitest';
import { resolveSyncedScore } from '../syncGuard';

describe('resolveSyncedScore', () => {
  const base = {
    balance: 80_000,
    vault: 0,
    peakBalance: 120_000,
    gamesPlayed: 40,
  };

  it('rejette un push stale (moins de parties) qui baisserait le crédit', () => {
    const next = resolveSyncedScore(base, {
      balance: 12_000,
      vault: 0,
      peakBalance: 120_000,
      gamesPlayed: 38,
    });
    expect(next.balance).toBe(80_000);
    expect(next.gamesPlayed).toBe(40);
  });

  it('ignore une baisse mid-mise (même games_played, pas de dépôt coffre)', () => {
    const next = resolveSyncedScore(base, {
      balance: 50_000,
      vault: 0,
      peakBalance: 120_000,
      gamesPlayed: 40,
    });
    expect(next.balance).toBe(80_000);
  });

  it('accepte une perte après une vraie partie (games + 1)', () => {
    const next = resolveSyncedScore(base, {
      balance: 50_000,
      vault: 0,
      peakBalance: 120_000,
      gamesPlayed: 41,
    });
    expect(next.balance).toBe(50_000);
    expect(next.gamesPlayed).toBe(41);
  });

  it('accepte un gros gain après une vraie partie', () => {
    const next = resolveSyncedScore(base, {
      balance: 500_000,
      vault: 0,
      peakBalance: 500_000,
      gamesPlayed: 41,
    });
    expect(next.balance).toBe(500_000);
    expect(next.peakBalance).toBe(500_000);
  });

  it('autorise un dépôt coffre (solde ↓ = coffre ↑)', () => {
    const next = resolveSyncedScore(base, {
      balance: 30_000,
      vault: 50_000,
      peakBalance: 120_000,
      gamesPlayed: 40,
    });
    expect(next.balance).toBe(30_000);
    expect(next.vault).toBe(50_000);
  });
});
