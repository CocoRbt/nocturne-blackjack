import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../circleApi', async () => {
  const actual = await vi.importActual<typeof import('../circleApi')>('../circleApi');
  return {
    ...actual,
    isSupabaseConfigured: () => true,
    fetchLeaderboards: vi.fn(async () => ({ live: [], peak: [] })),
  };
});

import { fetchLeaderboards } from '../circleApi';
import { clearCircleLocal, refreshLeaderboards, saveCircle, type LocalCircleState } from '../circleStore';

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
});
