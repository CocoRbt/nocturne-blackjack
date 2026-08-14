/**
 * Portefeuille compte : le cloud (uid email) est la source de vérité
 * à la connexion et au chargement — pas le localStorage de l’appareil.
 */

import { fetchMyScore, type MyScore } from './circleApi';
import { getAccountSession } from './accountAuth';
import { restoreCircleFromCloud } from './circleStore';
import { bumpSyncEpoch, clearScoreDirty } from './scoreSync';
import { useGame } from '../store/gameStore';

export function scoreToHydratePayload(score: MyScore) {
  return {
    balance: Math.floor(Number(score.balance) || 0),
    peakBalance: Math.floor(Number(score.peak_balance) || 0),
    vault: Math.floor(Number(score.vault) || 0),
    gamesPlayed: score.games_played,
    gamesBeforePeak: score.games_before_peak,
    handsPlayed: score.hands_played,
    blackjacks: score.blackjacks,
    bestStreak: score.best_streak,
    highestTable: score.highest_table,
  };
}

/** Applique get_my_score au store + cercle local. */
export async function applyCloudScore(score: MyScore, opts?: { silent?: boolean }): Promise<boolean> {
  clearScoreDirty();
  bumpSyncEpoch();
  if (!score.found || score.balance == null || score.peak_balance == null) {
    return false;
  }
  useGame.getState().hydrateFromCloud(scoreToHydratePayload(score), {
    force: true,
    silent: opts?.silent,
  });
  if (score.in_circle && score.circle_code) {
    await restoreCircleFromCloud(score);
  }
  clearScoreDirty();
  return true;
}

async function fetchMyScoreRetry(attempts = 3): Promise<MyScore> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetchMyScore();
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 200 * (i + 1)));
    }
  }
  throw last instanceof Error ? last : new Error('Score cloud introuvable');
}

/**
 * Si une session email est active, tire le solde cloud.
 * Appelé au boot lobby et après « Se connecter ».
 */
export async function pullAccountWallet(): Promise<MyScore | null> {
  const session = await getAccountSession();
  if (session.isAnonymous || !session.userId) return null;
  clearScoreDirty();
  bumpSyncEpoch();
  const score = await fetchMyScoreRetry();
  await applyCloudScore(score, { silent: true });
  return score;
}
