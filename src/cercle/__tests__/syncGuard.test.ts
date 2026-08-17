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

  it('accepte un gros dépôt si la richesse totale est stable (400k fantôme)', () => {
    const cloud = {
      balance: 40_010_000,
      vault: 0,
      peakBalance: 40_010_000,
      gamesPlayed: 200,
    };
    const next = resolveSyncedScore(cloud, {
      balance: 10_000,
      vault: 40_000_000,
      peakBalance: 40_010_000,
      gamesPlayed: 200,
    });
    expect(next.vault).toBe(40_000_000);
    expect(next.balance).toBe(10_000);
  });

  it('ne descend jamais un record 1M même sans nouvelle partie', () => {
    const next = resolveSyncedScore(
      { balance: 70_000_00, vault: 0, peakBalance: 70_000_00, gamesPlayed: 200 },
      { balance: 70_000_00, vault: 0, peakBalance: 1_000_000_00, gamesPlayed: 200 },
    );
    expect(next.peakBalance).toBe(1_000_000_00);
    expect(next.balance).toBe(70_000_00);
  });

  it('catch-up : écrit le vrai solde du téléphone si le record a monté', () => {
    const next = resolveSyncedScore(
      { balance: 7_083_000, vault: 0, peakBalance: 7_083_000, gamesPlayed: 200 },
      { balance: 130_000_000, vault: 0, peakBalance: 130_000_000, gamesPlayed: 200 },
    );
    expect(next.balance).toBe(130_000_000);
    expect(next.peakBalance).toBe(130_000_000);
  });

  it('catch-up : un onglet stale (moins de parties) ne baisse pas le record', () => {
    const next = resolveSyncedScore(
      { balance: 130_000_000, vault: 0, peakBalance: 130_000_000, gamesPlayed: 8000 },
      { balance: 7_083_000, vault: 0, peakBalance: 7_083_000, gamesPlayed: 200 },
    );
    expect(next.balance).toBe(130_000_000);
    expect(next.peakBalance).toBe(130_000_000);
    expect(next.gamesPlayed).toBe(8000);
  });
});
