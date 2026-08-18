import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { emptyStats, loadSave, persistSave, type SaveData } from '../persistence';

class MemoryStorage {
  private data = new Map<string, string>();
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, String(value));
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
  clear() {
    this.data.clear();
  }
  key(i: number) {
    return [...this.data.keys()][i] ?? null;
  }
  get length() {
    return this.data.size;
  }
}

describe('persistence Phase 2a', () => {
  const previous = globalThis.localStorage;

  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: new MemoryStorage(),
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: previous,
      configurable: true,
    });
  });

  it('ne reconstruit pas un solde 0 depuis un record millionnaire', () => {
    const save: SaveData = {
      version: 2,
      balance: 0,
      vault: 0,
      peakBalance: 121_100_000,
      gamesPlayed: 0,
      gamesBeforePeak: 0,
      refills: 0,
      soundMuted: false,
      tableId: 'emeraude',
      history: [],
      stats: emptyStats(),
      lastBets: {},
    };
    persistSave(save);
    const loaded = loadSave();
    expect(loaded?.balance).toBe(0);
    expect(loaded?.peakBalance).toBe(121_100_000);
  });
});
