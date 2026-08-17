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

  it('ne défait pas un coffrage local tant que le cloud n’a pas le coffre (sync)', () => {
    expect(
      shouldApplyCloudWallet({
        localBalance: 10_000,
        localVault: 400_000_00,
        cloudBalance: 400_100_00,
        cloudVault: 0,
      }),
    ).toBe('keep_local');
  });

  it('aligne un coffre fantôme quand on le demande (retrait)', () => {
    expect(
      shouldApplyCloudWallet({
        localBalance: 10_000,
        localVault: 400_000_00,
        cloudBalance: 400_100_00,
        cloudVault: 0,
        intent: 'align',
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

  it('n’annule pas une perte locale avec un solde cloud plus haut', () => {
    expect(
      shouldApplyCloudWallet({
        localBalance: 5_000,
        localVault: 0,
        cloudBalance: 80_000,
        cloudVault: 0,
      }),
    ).toBe('keep_local');
  });
});
