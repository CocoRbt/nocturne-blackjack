import { describe, expect, it } from 'vitest';
import { mergeBoardMembers, boardsAreEmpty } from '../boardMerge';
import type { Leaderboards } from '../circleApi';

const member = (
  nickname: string,
  extra: Partial<{
    balance: number;
    peakBalance: number;
    vault: number;
    gamesBeforePeak: number;
  }> = {},
) => ({
  nickname,
  balance: extra.balance ?? 10_000,
  peakBalance: extra.peakBalance ?? 10_000,
  vault: extra.vault ?? 0,
  handsPlayed: 0,
  blackjacks: 0,
  bestStreak: 0,
  highestTable: 'emeraude',
  gamesBeforePeak: extra.gamesBeforePeak ?? 0,
  gamesPlayed: 0,
  updatedAt: 1,
});

const row = (
  nickname: string,
  balance: number,
  peak: number,
  vault: number,
  isMe = false,
) => ({
  rank: 1,
  nickname,
  balance,
  peak_balance: peak,
  vault,
  games_before_peak: 12,
  updated_at: '2026-08-17T00:00:00.000Z',
  is_me: isMe,
});

describe('mergeBoardMembers', () => {
  it('prend le nouveau record cloud d’un pote (pas le cache local périmé)', () => {
    const boards: Leaderboards = {
      live: [row('Kikiloki', 80_000, 500_000_00, 0), row('Moi', 10_000, 20_000, 0, true)],
      peak: [row('Kikiloki', 80_000, 500_000_00, 0), row('Moi', 10_000, 20_000, 0, true)],
    };
    const merged = mergeBoardMembers(boards, 'Moi', [
      member('Moi', { peakBalance: 20_000 }),
      member('Kikiloki', { peakBalance: 100_000, balance: 90_000 }),
    ]);
    const kiki = merged.find((m) => m.nickname === 'Kikiloki')!;
    expect(kiki.peakBalance).toBe(500_000_00);
    expect(kiki.balance).toBe(80_000);
  });

  it('ne conserve pas un pote absent du board cloud', () => {
    const boards: Leaderboards = {
      live: [row('Moi', 10_000, 20_000, 0, true)],
      peak: [row('Moi', 10_000, 20_000, 0, true)],
    };
    const merged = mergeBoardMembers(boards, 'Moi', [
      member('Moi'),
      member('Ancien'),
    ]);
    expect(merged.map((m) => m.nickname).sort()).toEqual(['Moi']);
  });

  it('boardsAreEmpty', () => {
    expect(boardsAreEmpty({ live: [], peak: [] })).toBe(true);
    expect(boardsAreEmpty({ live: [row('A', 1, 1, 0)], peak: [] })).toBe(false);
  });
});
