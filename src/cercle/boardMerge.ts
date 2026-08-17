import type { LeaderboardRow, Leaderboards } from './circleApi';

export type BoardMember = {
  nickname: string;
  balance: number;
  peakBalance: number;
  vault: number;
  handsPlayed: number;
  blackjacks: number;
  bestStreak: number;
  highestTable: string;
  gamesBeforePeak: number;
  gamesPlayed: number;
  updatedAt: number;
};

/**
 * Fusionne les classements cloud dans le cache membres.
 * Pour les potes, le cloud gagne toujours (sinon un cache local périmé
 * affiche d’anciens records). Soi-même : on conserve les stats locales
 * absentes du board (mains, streak, etc.).
 */
export function mergeBoardMembers(
  boards: Leaderboards,
  me: string,
  previous: BoardMember[] = [],
): BoardMember[] {
  const prevMap = new Map(previous.map((m) => [m.nickname, m]));
  const map = new Map<string, BoardMember>();

  const putFromRow = (row: LeaderboardRow, keepLiveBalance: boolean) => {
    const name = row.nickname;
    const prev = map.get(name) ?? prevMap.get(name);
    const isSelf = name === me || row.is_me;
    const cloudBal = Math.max(0, Math.floor(Number(row.balance) || 0));
    const cloudPeak = Math.max(0, Math.floor(Number(row.peak_balance) || 0));
    const cloudVault = Math.max(
      0,
      Math.floor(Number(row.vault ?? prev?.vault ?? 0) || 0),
    );
    const updatedAt = Date.parse(row.updated_at) || Date.now();

    if (!isSelf) {
      if (keepLiveBalance || !map.has(name)) {
        map.set(name, {
          nickname: name,
          balance: cloudBal,
          peakBalance: cloudPeak,
          vault: cloudVault,
          handsPlayed: prev?.handsPlayed ?? 0,
          blackjacks: prev?.blackjacks ?? 0,
          bestStreak: prev?.bestStreak ?? 0,
          highestTable: prev?.highestTable ?? 'emeraude',
          gamesBeforePeak: row.games_before_peak ?? prev?.gamesBeforePeak ?? 0,
          gamesPlayed: prev?.gamesPlayed ?? 0,
          updatedAt,
        });
        return;
      }
      const cur = map.get(name)!;
      const peakBalance = Math.max(cur.peakBalance, cloudPeak);
      map.set(name, {
        ...cur,
        peakBalance,
        gamesBeforePeak:
          cloudPeak >= cur.peakBalance
            ? (row.games_before_peak ?? cur.gamesBeforePeak)
            : cur.gamesBeforePeak,
        updatedAt: Math.max(cur.updatedAt, updatedAt),
      });
      return;
    }

    const peakBalance = Math.max(cloudPeak, prev?.peakBalance ?? 0);
    const balance = keepLiveBalance
      ? cloudBal
      : Math.max(cloudBal, prev?.balance ?? 0, map.get(name)?.balance ?? 0);
    const fromPeakRow = cloudPeak >= (prev?.peakBalance ?? 0);
    map.set(name, {
      nickname: name,
      balance,
      peakBalance,
      vault: cloudVault,
      handsPlayed: prev?.handsPlayed ?? 0,
      blackjacks: prev?.blackjacks ?? 0,
      bestStreak: prev?.bestStreak ?? 0,
      highestTable: prev?.highestTable ?? 'emeraude',
      gamesBeforePeak: fromPeakRow
        ? (row.games_before_peak ?? prev?.gamesBeforePeak ?? 0)
        : (prev?.gamesBeforePeak ?? row.games_before_peak ?? 0),
      gamesPlayed: prev?.gamesPlayed ?? 0,
      updatedAt,
    });
  };

  for (const row of boards.live ?? []) putFromRow(row, true);
  for (const row of boards.peak ?? []) putFromRow(row, false);

  if (!map.has(me)) {
    const self = prevMap.get(me);
    if (self) map.set(me, self);
  }

  return [...map.values()].sort((a, b) => b.peakBalance - a.peakBalance);
}

export function boardsAreEmpty(boards: Leaderboards): boolean {
  return (boards.live?.length ?? 0) === 0 && (boards.peak?.length ?? 0) === 0;
}
