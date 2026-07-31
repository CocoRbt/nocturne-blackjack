import { beforeEach, describe, expect, it } from 'vitest';
import { DEFI_FULL_CLEAR_BONUS_CENTS, DEFI_REWARD_CENTS, todayKey } from '../catalog';
import {
  claimPendingDefiRewards,
  ensureDefiDay,
  listDefiViews,
  trackDefiEvent,
} from '../store';

const live = {
  handsPlayed: 0,
  wins: 0,
  blackjacks: 0,
  balance: 100_00,
};

function installMemoryStorage() {
  const map = new Map<string, string>();
  const memory = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, String(v));
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
    clear: () => map.clear(),
  };
  Object.defineProperty(globalThis, 'localStorage', {
    value: memory,
    configurable: true,
  });
}

describe('récompenses défis', () => {
  beforeEach(() => {
    installMemoryStorage();
  });

  it('crédite une fois un défi mines complété + badge', () => {
    const day = todayKey();
    const state = ensureDefiDay(live, day);
    state.challengeIds = ['mines_cash_2', 'bj_hands_8', 'gain_25'];
    state.completed = [];
    state.claimed = [];
    localStorage.setItem('nocturne-defis-du-jour', JSON.stringify(state));

    trackDefiEvent({ type: 'mines_cashout', mult: 1.5 }, live);
    trackDefiEvent({ type: 'mines_cashout', mult: 1.2 }, live);

    const first = claimPendingDefiRewards(live);
    expect(first.rewards.some((r) => r.id === 'mines_cash_2')).toBe(true);
    expect(first.rewards.find((r) => r.id === 'mines_cash_2')!.cents).toBe(DEFI_REWARD_CENTS);
    expect(first.badges).toContain('Diamants en poche');

    const second = claimPendingDefiRewards(live);
    expect(second.totalCents).toBe(0);
  });

  it('bonus trio du soir quand 3/3 réclamés', () => {
    const day = todayKey();
    const state = ensureDefiDay(live, day);
    state.challengeIds = ['mines_cash_2', 'craps_pass_2', 'crash_cash_3'];
    state.completed = ['mines_cash_2', 'craps_pass_2', 'crash_cash_3'];
    state.claimed = [];
    state.fullClearClaimed = false;
    localStorage.setItem('nocturne-defis-du-jour', JSON.stringify(state));

    const claim = claimPendingDefiRewards(live);
    expect(claim.rewards).toHaveLength(3);
    expect(claim.fullClearBonus).toBe(DEFI_FULL_CLEAR_BONUS_CENTS);
    expect(claim.badges).toContain('Trio du soir');
    expect(claim.totalCents).toBe(3 * DEFI_REWARD_CENTS + DEFI_FULL_CLEAR_BONUS_CENTS);
  });

  it('listDefiViews expose la récompense', () => {
    ensureDefiDay(live);
    const views = listDefiViews(live);
    expect(views.every((v) => v.rewardCents >= DEFI_REWARD_CENTS)).toBe(true);
  });
});
