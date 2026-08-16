import { describe, expect, it } from 'vitest';
import { shouldApplyCloudWallet } from '../walletReconcile';

describe('shouldApplyCloudWallet', () => {
  it('refuse d’écraser un local plus riche (anti-wipe)', () => {
    expect(
      shouldApplyCloudWallet({
        localBalance: 200_000,
        localVault: 50_000,
        cloudBalance: 10_000,
        cloudVault: 0,
      }),
    ).toBe('keep_local');
  });

  it('accepte un coffre fantôme → solde cloud (même patrimoine)', () => {
    expect(
      shouldApplyCloudWallet({
        localBalance: 10_000,
        localVault: 400_000_00,
        cloudBalance: 400_100_00,
        cloudVault: 0,
      }),
    ).toBe('apply');
  });

  it('accepte un cadeau cloud', () => {
    expect(
      shouldApplyCloudWallet({
        localBalance: 10_000,
        localVault: 0,
        cloudBalance: 10_000,
        cloudVault: 80_000,
      }),
    ).toBe('apply');
  });

  it('accepte une égalité de patrimoine (tolérance 1)', () => {
    expect(
      shouldApplyCloudWallet({
        localBalance: 100,
        localVault: 50,
        cloudBalance: 151,
        cloudVault: 0,
      }),
    ).toBe('apply');
  });
});
