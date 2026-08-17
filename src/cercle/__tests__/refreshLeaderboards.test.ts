import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../circleApi', async () => {
  const actual = await vi.importActual<typeof import('../circleApi')>('../circleApi');
  return {
    ...actual,
    isSupabaseConfigured: () => true,
    fetchLeaderboards: vi.fn(async () => ({ live: [], peak: [] })),
    ensureCircleMembershipCloud: vi.fn(async () => ({
      ok: true as const,
      profile_id: 'p',
      nickname: 'Minuit',
      circle_id: 'c',
      circle_code: 'NOC-TEST',
      reclaimed: false,
    })),
  };
});

import { fetchLeaderboards } from '../circleApi';
import {
  clearCircleLocal,
  loadCircle,
  refreshLeaderboards,
  restoreCircleFromCloud,
  saveCircle,
  type LocalCircleState,
} from '../circleStore';

function member(
  nickname: string,
  peakBalance: number,
  balance = 10_000,
): LocalCircleState['members'][number] {
  return {
    nickname,
    balance,
    peakBalance,
    vault: 0,
    handsPlayed: 1,
    blackjacks: 0,
    bestStreak: 0,
    highestTable: 'emeraude',
    gamesBeforePeak: 1,
    gamesPlayed: 1,
    updatedAt: Date.now(),
  };
}

function row(nickname: string, balance: number, peak: number, isMe = false) {
  return {
    rank: 1,
    nickname,
    balance,
    peak_balance: peak,
    vault: 0,
    games_before_peak: 8,
    updated_at: '2026-08-17T18:00:00.000Z',
    is_me: isMe,
  };
}

describe('refreshLeaderboards', () => {
  beforeEach(() => {
    clearCircleLocal();
    vi.mocked(fetchLeaderboards).mockResolvedValue({ live: [], peak: [] });
  });

  it('ne vide pas les membres locaux si le cloud renvoie des boards vides', async () => {
    const state: LocalCircleState = {
      nickname: 'Minuit',
      circleCode: 'NOC-TEST',
      cloud: true,
      members: [
        {
          nickname: 'Minuit',
          balance: 12_000,
          peakBalance: 50_000,
          vault: 2_000,
          handsPlayed: 10,
          blackjacks: 1,
          bestStreak: 2,
          highestTable: 'emeraude',
          gamesBeforePeak: 3,
          gamesPlayed: 10,
          updatedAt: Date.now(),
        },
        {
          nickname: 'Pote',
          balance: 8_000,
          peakBalance: 20_000,
          vault: 500,
          handsPlayed: 4,
          blackjacks: 0,
          bestStreak: 1,
          highestTable: 'onyx',
          gamesBeforePeak: 1,
          gamesPlayed: 4,
          updatedAt: Date.now(),
        },
      ],
    };
    saveCircle(state);

    const result = await refreshLeaderboards(state);
    expect(result.state.members).toHaveLength(2);
    expect(result.state.members.map((m) => m.nickname).sort()).toEqual(['Minuit', 'Pote']);
    expect(result.boards.live.length).toBeGreaterThan(0);
  });

  it('remplace un record pote périmé par le cloud', async () => {
    const state: LocalCircleState = {
      nickname: 'Minuit',
      circleCode: 'NOC-TEST',
      cloud: true,
      members: [member('Minuit', 50_000, 12_000), member('Kikiloki', 100_000, 90_000)],
    };
    vi.mocked(fetchLeaderboards).mockResolvedValue({
      live: [row('Kikiloki', 80_000, 9_000_000), row('Minuit', 12_000, 50_000, true)],
      peak: [row('Kikiloki', 80_000, 9_000_000), row('Minuit', 12_000, 50_000, true)],
    });
    const result = await refreshLeaderboards(state);
    const kiki = result.state.members.find((m) => m.nickname === 'Kikiloki');
    expect(kiki?.peakBalance).toBe(9_000_000);
    expect(kiki?.balance).toBe(80_000);
    expect(result.boards.peak.find((r) => r.nickname === 'Kikiloki')?.peak_balance).toBe(
      9_000_000,
    );
  });

  it('restoreCircleFromCloud ne laisse pas un cache à soi tout seul', async () => {
    saveCircle({
      nickname: 'Minuit',
      circleCode: 'NOC-TEST',
      cloud: true,
      members: [member('Minuit', 50_000), member('Kikiloki', 100_000)],
    });
    vi.mocked(fetchLeaderboards).mockResolvedValue({
      live: [row('Kikiloki', 80_000, 9_000_000), row('Minuit', 12_000, 50_000, true)],
      peak: [row('Kikiloki', 80_000, 9_000_000), row('Minuit', 12_000, 50_000, true)],
    });
    const restored = await restoreCircleFromCloud({
      in_circle: true,
      circle_code: 'NOC-TEST',
      nickname: 'Minuit',
      balance: 12_000,
      peak_balance: 50_000,
      vault: 0,
    });
    expect(restored?.members.map((m) => m.nickname).sort()).toEqual(['Kikiloki', 'Minuit']);
    expect(restored?.members.find((m) => m.nickname === 'Kikiloki')?.peakBalance).toBe(
      9_000_000,
    );
  });

  it('migre le cache cercle v1 vers v2', () => {
    const mem = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => {
        mem.set(k, v);
      },
      removeItem: (k: string) => {
        mem.delete(k);
      },
    });
    const legacy: LocalCircleState = {
      nickname: 'Minuit',
      circleCode: 'NOC-TEST',
      cloud: true,
      members: [member('Minuit', 50_000)],
    };
    localStorage.setItem('nocturne-cercle', JSON.stringify(legacy));
    const loaded = loadCircle();
    expect(loaded?.nickname).toBe('Minuit');
    expect(loaded?.members[0]?.peakBalance).toBe(50_000);
    expect(localStorage.getItem('nocturne-cercle-v2')).toBeTruthy();
    expect(localStorage.getItem('nocturne-cercle')).toBeNull();
    vi.unstubAllGlobals();
  });
});
