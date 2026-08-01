import { useEffect, useState } from 'react';
import { fmt } from '../lib/format';
import {
  claimPendingDefiRewards,
  completedCount,
  listDefiViews,
  syncDefiProgress,
  todaysBadges,
  type DefiView,
} from '../defis/store';
import { useGame } from '../store/gameStore';

const GAME_LABEL: Record<string, string> = {
  blackjack: 'BJ',
  mines: 'Mines',
  craps: 'Craps',
  crash: 'Crash',
  plinko: 'Plinko',
  global: 'Salon',
};

function liveBaseline() {
  const s = useGame.getState();
  return {
    handsPlayed: s.stats.handsPlayed,
    wins: s.stats.wins,
    blackjacks: s.stats.blackjacks,
    balance: s.balance,
  };
}

function applyDefiClaims() {
  const claim = claimPendingDefiRewards(liveBaseline());
  if (claim.totalCents <= 0) return;
  const parts = claim.rewards.map((r) => r.title);
  if (claim.fullClearBonus > 0) parts.push('Trio du soir');
  useGame.getState().creditDefiReward(claim.totalCents, parts.join(' · '));
  window.dispatchEvent(new Event('nocturne-defis'));
}

export function useDefiSync() {
  const balance = useGame((s) => s.balance);
  const handsPlayed = useGame((s) => s.stats.handsPlayed);
  const wins = useGame((s) => s.stats.wins);
  const blackjacks = useGame((s) => s.stats.blackjacks);

  useEffect(() => {
    syncDefiProgress({
      handsPlayed,
      wins,
      blackjacks,
      balance,
    });
    applyDefiClaims();
    window.dispatchEvent(new Event('nocturne-defis'));
  }, [balance, handsPlayed, wins, blackjacks]);
}

export function DailyChallenges({ compact = false }: { compact?: boolean }) {
  const balance = useGame((s) => s.balance);
  const handsPlayed = useGame((s) => s.stats.handsPlayed);
  const wins = useGame((s) => s.stats.wins);
  const blackjacks = useGame((s) => s.stats.blackjacks);

  const [views, setViews] = useState<DefiView[]>(() => listDefiViews(liveBaseline()));
  const [badges, setBadges] = useState<string[]>(() => todaysBadges(liveBaseline()));

  useEffect(() => {
    const refresh = () => {
      const live = { handsPlayed, wins, blackjacks, balance };
      setViews(listDefiViews(live));
      setBadges(todaysBadges(live));
    };
    refresh();
    window.addEventListener('nocturne-defis', refresh);
    return () => window.removeEventListener('nocturne-defis', refresh);
  }, [balance, handsPlayed, wins, blackjacks]);

  const { done, total } = completedCount({
    handsPlayed,
    wins,
    blackjacks,
    balance,
  });

  return (
    <section className={`defis-du-jour ${compact ? 'compact' : ''}`} aria-label="Défis du jour">
      <header className="defis-head">
        <div>
          <span className="defis-eyebrow">Aujourd’hui</span>
          <h3>Défis du jour</h3>
        </div>
        <span className={`defis-score ${done === total ? 'done' : ''}`}>
          {done}/{total}
        </span>
      </header>
      <ul className="defis-list">
        {views.map((v) => (
          <li key={v.def.id} className={v.done ? 'done' : ''}>
            <div className="defis-row">
              <span className="defis-game">{GAME_LABEL[v.def.game] ?? v.def.game}</span>
              <div className="defis-body">
                <strong>{v.def.title}</strong>
                <span className="defis-desc">{v.def.description}</span>
              </div>
              <span className="defis-prog" aria-label={`Progression ${v.progress} sur ${v.target}`}>
                {v.done ? '✓' : `${v.progress}/${v.target}`}
              </span>
            </div>
            <div className="defis-meta">
              <span className="defis-reward">+{fmt(v.rewardCents)}</span>
              {v.claimed && <span className="defis-claimed">Récompensé</span>}
            </div>
            <div className="defis-bar" aria-hidden>
              <span style={{ width: `${v.pct}%` }} />
            </div>
          </li>
        ))}
      </ul>
      {done === total && total > 0 && (
        <p className="defis-bonus-hint">Trio du soir · bonus +{fmt(15_00)} + badge</p>
      )}
      {badges.length > 0 && (
        <ul className="defis-badges" aria-label="Badges du jour">
          {badges.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
