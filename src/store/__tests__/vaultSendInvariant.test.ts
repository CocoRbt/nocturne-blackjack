import { describe, expect, it } from 'vitest';
import { STARTING_BALANCE } from '../persistence';
import { depositToVault, vaultableAmount } from '../vault';

/**
 * L’envoi réel est atomique côté SQL (coffre → coffre).
 * On vérifie ici l’invariant anti-farm : on ne peut envoyer que du coffré,
 * et on ne peut coffrer que le surplus au-dessus de 100.
 */
describe('envoi cercle — invariants anti-farm', () => {
  it('après refill (100), rien n’est coffrable ni envoyable', () => {
    const balance = STARTING_BALANCE;
    const vault = 0;
    expect(vaultableAmount(balance)).toBe(0);
    expect(depositToVault(balance, vault, 1).ok).toBe(false);
    expect(vault).toBe(0);
  });

  it('seul le surplus gagné peut rejoindre le coffre puis être envoyé', () => {
    let balance = 250_00;
    let vault = 0;
    const dep = depositToVault(balance, vault, vaultableAmount(balance));
    expect(dep.ok).toBe(true);
    if (!dep.ok) return;
    balance = dep.balance;
    vault = dep.vault;
    expect(balance).toBe(STARTING_BALANCE);
    expect(vault).toBe(150_00);
    // Envoi max = vault (jamais le solde jouable)
    const send = Math.min(vault, 150_00);
    vault -= send;
    expect(vault).toBe(0);
    expect(balance).toBe(STARTING_BALANCE);
  });
});
