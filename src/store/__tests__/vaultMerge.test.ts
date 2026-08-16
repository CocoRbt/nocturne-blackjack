import { describe, expect, it } from 'vitest';
import { mergeIncomingVault } from '../vaultMerge';

describe('mergeIncomingVault', () => {
  it('garde le dépôt local si le cloud n’a pas encore le coffre (richesse stable)', () => {
    expect(
      mergeIncomingVault({
        localBalance: 100_00,
        localVault: 200_00,
        cloudBalance: 300_00,
        cloudVault: 0,
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

  it('accepte le coffre cloud après un envoi (crash avant MAJ locale)', () => {
    expect(
      mergeIncomingVault({
        localBalance: 100_00,
        localVault: 800_00,
        cloudBalance: 100_00,
        cloudVault: 300_00,
      }),
    ).toBe(300_00);
  });
});
