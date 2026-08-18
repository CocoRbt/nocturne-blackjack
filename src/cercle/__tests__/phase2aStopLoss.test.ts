import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { shouldPushWalletSnapshot, sessionPatch, IDLE_GAME_SESSION } from '../gameSession';
import { resolveSyncedScore, type SyncScoreSnapshot } from '../syncGuard';
import { shouldApplyCloudWallet } from '../walletReconcile';
import { settleGamePeak } from '../../store/peakMeta';
import { restoreWipedPlayable, sanitizeScoreForPush } from '../wealth';

const START = 100_00;

function heartbeat(
  prev: SyncScoreSnapshot,
  local: SyncScoreSnapshot,
  session: { financialSessionDepth: number; gameSessionHold: boolean; salonStakeOpen: boolean },
): SyncScoreSnapshot {
  if (!shouldPushWalletSnapshot(session)) return prev;
  return resolveSyncedScore(prev, local);
}

describe('Phase 2a — matrice stop-loss', () => {
  it('Mines : 100 cr, mise 50, perte, heartbeat 10 s → 50 cr, pas de remontée', () => {
    let cloud: SyncScoreSnapshot = {
      balance: START,
      vault: 0,
      peakBalance: START,
      gamesPlayed: 4,
    };
    let local = { ...cloud };
    let session = { ...IDLE_GAME_SESSION };

    local = { ...local, balance: local.balance - 50_00 };
    session = sessionPatch(session, { financialSessionDepth: 1, gameSessionHold: true });
    cloud = heartbeat(cloud, local, session);
    expect(cloud.balance).toBe(START);

    const settled = settleGamePeak(local.balance, 0, {
      peakBalance: local.peakBalance,
      gamesPlayed: local.gamesPlayed,
      gamesBeforePeak: 0,
    });
    local = {
      ...local,
      balance: settled.balance,
      peakBalance: settled.peakBalance,
      gamesPlayed: settled.gamesPlayed,
    };
    session = sessionPatch(session, { financialSessionDepth: 0, gameSessionHold: false });

    for (let i = 0; i < 3; i++) {
      cloud = heartbeat(cloud, local, session);
    }
    expect(cloud.balance).toBe(50_00);
    expect(local.balance).toBe(50_00);
    expect(cloud.peakBalance).toBe(START);
  });

  it('Plinko : plusieurs drops perdants, chaque mise reste débitée', () => {
    let cloud: SyncScoreSnapshot = {
      balance: START,
      vault: 0,
      peakBalance: START,
      gamesPlayed: 0,
    };
    let local = { ...cloud };
    let depth = 0;

    for (let i = 0; i < 3; i++) {
      const before = cloud.balance;
      local = { ...local, balance: local.balance - 10_00 };
      depth += 1;
      let session = sessionPatch(IDLE_GAME_SESSION, { financialSessionDepth: depth, gameSessionHold: true });
      cloud = heartbeat(cloud, local, session);
      expect(cloud.balance).toBe(before);

      const settled = settleGamePeak(local.balance, 0, {
        peakBalance: local.peakBalance,
        gamesPlayed: local.gamesPlayed,
        gamesBeforePeak: 0,
      });
      local = {
        ...local,
        balance: settled.balance,
        gamesPlayed: settled.gamesPlayed,
        peakBalance: settled.peakBalance,
      };
      depth -= 1;
      session = sessionPatch(IDLE_GAME_SESSION, { financialSessionDepth: depth, gameSessionHold: depth > 0 });
      cloud = heartbeat(cloud, local, session);
      expect(cloud.balance).toBe(before - 10_00);
    }

    expect(local.balance).toBe(70_00);
    expect(cloud.balance).toBe(70_00);
    expect(cloud.gamesPlayed).toBe(3);
  });

  it('Crash : mise perdue, solde diminué après sync', () => {
    let cloud: SyncScoreSnapshot = {
      balance: 200_00,
      vault: 0,
      peakBalance: 200_00,
      gamesPlayed: 8,
    };
    let local = { ...cloud };
    local = { ...local, balance: local.balance - 40_00 };
    let session = sessionPatch(IDLE_GAME_SESSION, { financialSessionDepth: 1, gameSessionHold: true });
    cloud = heartbeat(cloud, local, session);
    expect(cloud.balance).toBe(200_00);

    const settled = settleGamePeak(local.balance, 0, {
      peakBalance: local.peakBalance,
      gamesPlayed: local.gamesPlayed,
      gamesBeforePeak: 0,
    });
    local = { ...local, balance: settled.balance, gamesPlayed: settled.gamesPlayed };
    session = IDLE_GAME_SESSION;
    cloud = heartbeat(cloud, local, session);
    expect(cloud.balance).toBe(160_00);
  });

  it('Slots : spin perdant, solde diminué', () => {
    let cloud: SyncScoreSnapshot = {
      balance: START,
      vault: 0,
      peakBalance: START,
      gamesPlayed: 2,
    };
    let local = { ...cloud, balance: START - 25_00 };
    let session = sessionPatch(IDLE_GAME_SESSION, { financialSessionDepth: 1, gameSessionHold: true });
    cloud = heartbeat(cloud, local, session);
    expect(cloud.balance).toBe(START);

    const settled = settleGamePeak(local.balance, 0, {
      peakBalance: local.peakBalance,
      gamesPlayed: local.gamesPlayed,
      gamesBeforePeak: 0,
    });
    local = { ...local, balance: settled.balance, gamesPlayed: settled.gamesPlayed };
    cloud = heartbeat(cloud, local, IDLE_GAME_SESSION);
    expect(cloud.balance).toBe(75_00);
  });

  it('Blackjack : perte normale, all-in, double — aucune ancienne valeur', () => {
    const cases = [
      { start: START, bet: 10_00, extra: 0, returned: 0, label: 'perte' },
      { start: 80_00, bet: 80_00, extra: 0, returned: 0, label: 'all-in' },
      { start: START, bet: 20_00, extra: 20_00, returned: 0, label: 'double perdu' },
    ];
    for (const c of cases) {
      let cloud: SyncScoreSnapshot = {
        balance: c.start,
        vault: 0,
        peakBalance: 1_000_00,
        gamesPlayed: 10,
      };
      let local = { ...cloud, balance: c.start - c.bet };
      let session = sessionPatch(IDLE_GAME_SESSION, { financialSessionDepth: 1, gameSessionHold: true });
      cloud = heartbeat(cloud, local, session);
      expect(cloud.balance).toBe(c.start);

      local = { ...local, balance: local.balance - c.extra };
      cloud = heartbeat(cloud, local, session);
      expect(cloud.balance).toBe(c.start);

      const settled = settleGamePeak(local.balance, c.returned, {
        peakBalance: local.peakBalance,
        gamesPlayed: local.gamesPlayed,
        gamesBeforePeak: 0,
      });
      local = {
        ...local,
        balance: settled.balance,
        gamesPlayed: settled.gamesPlayed,
        peakBalance: settled.peakBalance,
      };
      cloud = heartbeat(cloud, local, IDLE_GAME_SESSION);
      expect(cloud.balance).toBe(c.start - c.bet - c.extra);
      expect(cloud.peakBalance).toBe(1_000_00);
    }
  });

  it('Record 1000 cr, solde 100 : après perte le record reste, le solde baisse', () => {
    let cloud: SyncScoreSnapshot = {
      balance: 100_00,
      vault: 0,
      peakBalance: 1_000_00,
      gamesPlayed: 20,
    };
    let local = { ...cloud, balance: 50_00 };
    const session = sessionPatch(IDLE_GAME_SESSION, { financialSessionDepth: 1 });
    expect(heartbeat(cloud, local, session).balance).toBe(100_00);

    const settled = settleGamePeak(50_00, 0, {
      peakBalance: 1_000_00,
      gamesPlayed: 20,
      gamesBeforePeak: 5,
    });
    local = { ...local, balance: settled.balance, gamesPlayed: settled.gamesPlayed };
    cloud = heartbeat(cloud, local, IDLE_GAME_SESSION);
    expect(cloud.balance).toBe(50_00);
    expect(cloud.peakBalance).toBe(1_000_00);
  });

  it('Gain légitime après settlement : synchro reprend, cercle voit la hausse', () => {
    let cloud: SyncScoreSnapshot = {
      balance: START,
      vault: 0,
      peakBalance: START,
      gamesPlayed: 1,
    };
    let local = { ...cloud, balance: START - 20_00 };
    const mid = sessionPatch(IDLE_GAME_SESSION, { financialSessionDepth: 1, gameSessionHold: true });
    cloud = heartbeat(cloud, local, mid);
    const settled = settleGamePeak(local.balance, 50_00, {
      peakBalance: local.peakBalance,
      gamesPlayed: local.gamesPlayed,
      gamesBeforePeak: 0,
    });
    local = {
      ...local,
      balance: settled.balance,
      gamesPlayed: settled.gamesPlayed,
      peakBalance: settled.peakBalance,
    };
    cloud = heartbeat(cloud, local, IDLE_GAME_SESSION);
    expect(cloud.balance).toBe(130_00);
    expect(cloud.gamesPlayed).toBe(2);
  });

  it('Réponse cloud plus haute n’annule pas une perte locale', () => {
    expect(
      shouldApplyCloudWallet({
        localBalance: 50_00,
        localVault: 0,
        cloudBalance: 100_00,
        cloudVault: 0,
      }),
    ).toBe('keep_local');
  });

  it('sanitize / restore ne recollent pas peak → balance', () => {
    expect(restoreWipedPlayable(0, 0, 1_211_000_00)).toBe(0);
    const pushed = sanitizeScoreForPush({
      balance: 50_00,
      vault: 0,
      peakBalance: 1_000_00,
    });
    expect(pushed.balance).toBe(50_00);
    expect(pushed.peakBalance).toBe(1_000_00);
  });
});

describe('migration SQL Phase 2a', () => {
  const sql = readFileSync('supabase/migrations/20260818120000_phase2a_stop_loss.sql', 'utf8');

  it('ne restaure plus OLD.balance / peak → wallet et ne mute aucune ligne joueur', () => {
    expect(sql).not.toMatch(/new\.balance\s*:=\s*old\.balance/i);
    expect(sql).not.toMatch(/new\.vault\s*:=\s*coalesce\(\s*old\.vault/i);
    expect(sql).not.toMatch(/new\.balance\s*:=\s*new\.peak_balance/i);
    expect(sql).not.toMatch(/v_games = coalesce\(v_prev\.games_played, 0\)/);
    expect(sql).not.toMatch(/update\s+public\.player_scores/i);
  });
});
