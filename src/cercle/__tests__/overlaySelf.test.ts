import { describe, expect, it } from 'vitest';
import { overlaySelfOnBoards, type Leaderboards } from '../circleStore';

const empty: Leaderboards = {
  live: [
    {
      rank: 1,
      nickname: 'ZaaariX',
      balance: 17_340,
      peak_balance: 40_000,
      games_before_peak: 0,
      updated_at: '2026-07-31T00:00:00.000Z',
      is_me: true,
    },
    {
      rank: 2,
      nickname: 'I2S',
      balance: 10_000,
      peak_balance: 10_000,
      games_before_peak: 0,
      updated_at: '2026-07-31T00:00:00.000Z',
      is_me: false,
    },
  ],
  peak: [
    {
      rank: 1,
      nickname: 'Selmex',
      balance: 250,
      peak_balance: 1_434_975,
      games_before_peak: 0,
      updated_at: '2026-07-31T00:00:00.000Z',
      is_me: false,
    },
    {
      rank: 2,
      nickname: 'ZaaariX',
      balance: 17_340,
      peak_balance: 40_000,
      games_before_peak: 0,
      updated_at: '2026-07-31T00:00:00.000Z',
      is_me: true,
    },
  ],
};

describe('overlaySelfOnBoards', () => {
  it('écrase mon crédit live avec le solde local', () => {
    const boards = overlaySelfOnBoards(empty, 'ZaaariX', {
      balance: 172_700,
      peakBalance: 172_700,
      gamesBeforePeak: 184,
    });
    const me = boards.live.find((r) => r.nickname === 'ZaaariX')!;
    expect(me.balance).toBe(172_700);
    expect(me.rank).toBe(1);
    expect(boards.live.find((r) => r.nickname === 'I2S')!.balance).toBe(10_000);
  });

  it('affiche mes parties avant le record sur l’onglet Record', () => {
    const boards = overlaySelfOnBoards(empty, 'ZaaariX', {
      balance: 172_700,
      peakBalance: 172_700,
      gamesBeforePeak: 184,
    });
    const me = boards.peak.find((r) => r.nickname === 'ZaaariX')!;
    expect(me.peak_balance).toBe(172_700);
    expect(me.games_before_peak).toBe(184);
    expect(me.rank).toBe(2); // sous Selmex 1_434_975
  });
});
