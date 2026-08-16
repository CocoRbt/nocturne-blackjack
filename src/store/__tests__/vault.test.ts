import { describe, expect, it } from 'vitest';
import { STARTING_BALANCE } from '../persistence';
import { depositToVault, vaultableAmount, withdrawFromVault } from '../vault';

describe('vaultableAmount', () => {
  it('est 0 au solde de base / après refill', () => {
    expect(vaultableAmount(STARTING_BALANCE)).toBe(0);
    expect(vaultableAmount(STARTING_BALANCE - 1)).toBe(0);
  });

  it('n’autorise que le surplus au-dessus de 100', () => {
    expect(vaultableAmount(150_00)).toBe(50_00);
    expect(vaultableAmount(100_00)).toBe(0);
  });
});

describe('depositToVault', () => {
  it('refuse de coffrer le refill', () => {
    const r = depositToVault(STARTING_BALANCE, 0, 50_00);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.vault).toBe(0);
  });

  it('dépose uniquement le surplus', () => {
    const r = depositToVault(250_00, 10_00, 150_00);
    expect(r).toEqual({ ok: true, balance: 100_00, vault: 160_00 });
  });

  it('refuse un montant au-dessus du plafond', () => {
    const r = depositToVault(180_00, 0, 100_00);
    expect(r.ok).toBe(false);
  });
});

describe('withdrawFromVault', () => {
  it('remet le crédit au solde', () => {
    const r = withdrawFromVault(100_00, 80_00, 50_00);
    expect(r).toEqual({ ok: true, balance: 150_00, vault: 30_00 });
  });

  it('refuse si coffre insuffisant', () => {
    const r = withdrawFromVault(100_00, 20_00, 50_00);
    expect(r.ok).toBe(false);
  });

  it('retire 400k crédits du coffre sans erreur', () => {
    const vault = 400_000_00;
    const r = withdrawFromVault(STARTING_BALANCE, vault, vault);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.vault).toBe(0);
      expect(r.balance).toBe(STARTING_BALANCE + 400_000_00);
    }
  });
});

describe('anti-farm refill + coffre', () => {
  it('cycle refill → coffre ne peut pas accumuler', () => {
    let balance = 0;
    let vault = 0;
    // refill = set à 100
    balance = STARTING_BALANCE;
    let dep = depositToVault(balance, vault, vaultableAmount(balance) || 1);
    expect(dep.ok).toBe(false);

    // gain puis coffre du surplus
    balance = 140_00;
    dep = depositToVault(balance, vault, vaultableAmount(balance));
    expect(dep.ok).toBe(true);
    if (dep.ok) {
      balance = dep.balance;
      vault = dep.vault;
    }
    expect(balance).toBe(100_00);
    expect(vault).toBe(40_00);

    // ruin + refill set
    balance = STARTING_BALANCE;
    dep = depositToVault(balance, vault, 1);
    expect(dep.ok).toBe(false);
    expect(vault).toBe(40_00);
  });
});
