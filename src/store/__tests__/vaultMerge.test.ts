import { describe, expect, it } from 'vitest';
import { mergeIncomingVault } from '../vaultMerge';

describe('mergeIncomingVault', () => {
  it('garde le local si cloud ≤ local', () => {
    expect(
      mergeIncomingVault({
        localBalance: 100_00,
        localVault: 200_00,
        cloudBalance: 100_00,
        cloudVault: 150_00,
      }),
    ).toBe(200_00);
  });

  it('accepte un cadeau (richesse cloud > locale)', () => {
    expect(
      mergeIncomingVault({
        localBalance: 100_00,
        localVault: 0,
        cloudBalance: 100_00,
        cloudVault: 500_00,
      }),
    ).toBe(500_00);
  });

  it('ne re-crédite pas après un retrait (richesse stable)', () => {
    // Local : retiré 500 du coffre. Cloud stale : encore 500 en coffre.
    expect(
      mergeIncomingVault({
        localBalance: 600_00,
        localVault: 0,
        cloudBalance: 100_00,
        cloudVault: 500_00,
      }),
    ).toBe(0);
  });

  it('ne re-crédite pas un retrait partiel', () => {
    expect(
      mergeIncomingVault({
        localBalance: 350_00,
        localVault: 250_00,
        cloudBalance: 100_00,
        cloudVault: 500_00,
      }),
    ).toBe(250_00);
  });

  it('accepte un cadeau même si le solde local a un peu bougé', () => {
    expect(
      mergeIncomingVault({
        localBalance: 95_00,
        localVault: 0,
        cloudBalance: 100_00,
        cloudVault: 500_00,
      }),
    ).toBe(500_00);
  });
});
