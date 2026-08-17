/**
 * Sync cercle toujours allumée : chacun pousse son téléphone, tout le monde
 * tire le classement. Pas seulement quand le panneau Cercle est ouvert.
 */

import { getSupabase, isSupabaseConfigured } from './supabaseClient';
import {
  loadCircle,
  notifyCircleChanged,
  pushScore,
  refreshLeaderboards,
} from './circleStore';
import { isScoreDirty, markScoreDirty, onScoreDirty } from './scoreSync';
import { sanitizeScoreForPush } from './wealth';
import { useGame } from '../store/gameStore';

const HEARTBEAT_MS = 4_000;
const DIRTY_MS = 500;

function scoreSeedFromGame() {
  const g = useGame.getState();
  return sanitizeScoreForPush({
    balance: g.balance,
    peakBalance: g.peakBalance,
    vault: g.vault,
    handsPlayed: g.stats.handsPlayed,
    blackjacks: g.stats.blackjacks,
    bestStreak: g.stats.longestWinStreak,
    highestTable: g.tableId,
    gamesBeforePeak: g.gamesBeforePeak,
    gamesPlayed: g.gamesPlayed,
  });
}

async function syncOnce(opts?: { push?: boolean }): Promise<void> {
  const state = loadCircle();
  if (!state?.circleCode || !state.cloud || !isSupabaseConfigured()) return;
  const shouldPush = opts?.push !== false;
  let next = state;
  if (shouldPush) {
    const seed = scoreSeedFromGame();
    if (seed.balance !== useGame.getState().balance) {
      useGame.getState().applyVaultServerState(
        { balance: seed.balance, vault: seed.vault, peakBalance: seed.peakBalance },
        undefined,
        { dirty: false },
      );
    }
    next = await pushScore(state, seed);
  }
  await refreshLeaderboards(next);
  notifyCircleChanged();
}

export function startCircleLiveSync(): () => void {
  if (typeof window === 'undefined') return () => undefined;

  let heartbeat: number | undefined;
  let dirtyTimer: number | undefined;
  let running = false;
  let channel: { unsubscribe: () => Promise<unknown> } | null = null;

  const run = async (push: boolean) => {
    if (running) {
      if (push) markScoreDirty();
      return;
    }
    running = true;
    try {
      await syncOnce({ push: push || isScoreDirty() });
    } catch {
      markScoreDirty();
    } finally {
      running = false;
      if (isScoreDirty()) scheduleDirty();
    }
  };

  const scheduleDirty = () => {
    window.clearTimeout(dirtyTimer);
    dirtyTimer = window.setTimeout(() => {
      void run(true);
    }, DIRTY_MS);
  };

  const unsubDirty = onScoreDirty(scheduleDirty);

  heartbeat = window.setInterval(() => {
    void run(true);
  }, HEARTBEAT_MS);

  const onVis = () => {
    if (document.visibilityState === 'visible') void run(true);
    if (document.visibilityState === 'hidden' && isScoreDirty()) void run(true);
  };
  const onHide = () => {
    if (isScoreDirty()) void run(true);
  };
  document.addEventListener('visibilitychange', onVis);
  window.addEventListener('pagehide', onHide);

  const sb = getSupabase();
  if (sb && isSupabaseConfigured()) {
    try {
      const ch = sb
        .channel('nocturne-circle-scores')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'player_scores' },
          () => {
            void run(false);
          },
        )
        .subscribe();
      channel = ch;
    } catch {
      /* realtime optionnel — le heartbeat suffit */
    }
  }

  void run(true);

  return () => {
    unsubDirty();
    window.clearInterval(heartbeat);
    window.clearTimeout(dirtyTimer);
    document.removeEventListener('visibilitychange', onVis);
    window.removeEventListener('pagehide', onHide);
    void channel?.unsubscribe();
  };
}
