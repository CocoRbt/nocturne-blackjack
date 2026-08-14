import { describe, expect, it } from 'vitest';
import { scoreToHydratePayload } from '../accountHydrate';
import {
  bumpSyncEpoch,
  clearScoreDirty,
  consumeScoreDirty,
  getSyncEpoch,
  isScoreDirty,
  markScoreDirty,
} from '../scoreSync';

describe('scoreToHydratePayload', () => {
  it('prend le solde cloud même si le local était à 200', () => {
    const payload = scoreToHydratePayload({
      found: true,
      balance: 3_000_000,
      peak_balance: 3_000_000,
      vault: 0,
    });
    expect(payload.balance).toBe(3_000_000);
    expect(payload.peakBalance).toBe(3_000_000);
  });

  it('parse les entiers éventuellement stringifiés', () => {
    const payload = scoreToHydratePayload({
      found: true,
      balance: '20000' as unknown as number,
      peak_balance: '25000' as unknown as number,
      vault: '0' as unknown as number,
    });
    expect(payload.balance).toBe(20_000);
    expect(payload.peakBalance).toBe(25_000);
  });
});

describe('scoreSync epoch', () => {
  it('clearScoreDirty empêche un push stale après login', () => {
    markScoreDirty();
    expect(isScoreDirty()).toBe(true);
    clearScoreDirty();
    expect(consumeScoreDirty()).toBe(false);
  });

  it('bumpSyncEpoch invalide les push en vol', () => {
    const a = getSyncEpoch();
    const b = bumpSyncEpoch();
    expect(b).toBeGreaterThan(a);
    expect(getSyncEpoch()).toBe(b);
  });
});
