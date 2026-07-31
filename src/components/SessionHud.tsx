import { fmtNet } from '../lib/format';
import { useGame, type GoalId } from '../store/gameStore';

function goalShort(id: GoalId): string {
  switch (id) {
    case 'reach6100':
      return 'Objectif +1 100';
    case 'hands20':
      return 'Objectif 20 manches';
    case 'bj2':
      return 'Objectif 2 blackjacks';
    default:
      return 'Objectif';
  }
}

/** HUD session : net, streak, objectif soft. */
export function SessionHud() {
  const session = useGame((s) => s.session);
  if (!session) return null;

  const streak = session.currentStreak;
  const goalPct = Math.round(session.goalProgress * 100);

  return (
    <div className="session-hud" title="Session courante (remise à zéro en quittant la table)">
      <span className={`session-net ${session.net > 0 ? 'pos' : session.net < 0 ? 'neg' : ''}`}>
        Session {fmtNet(session.net)}
      </span>
      {streak >= 2 && <span className="session-streak">×{streak}</span>}
      {session.goalId !== 'none' && (
        <span className={`session-goal ${session.goalDone ? 'done' : ''}`}>
          {session.goalDone
            ? `${goalShort(session.goalId)} ✓`
            : `${goalShort(session.goalId)} · ${goalPct}%`}
        </span>
      )}
    </div>
  );
}
