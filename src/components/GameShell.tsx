import { fmt } from '../lib/format';
import { STARTING_BALANCE } from '../store/persistence';
import { useGame } from '../store/gameStore';
import { AppMenu } from './AppMenu';

export type GameShellAccent = 'mines' | 'craps' | 'crash' | 'plinko' | 'slots';

type GameShellProps = {
  title: string;
  eyebrow: string;
  accent: GameShellAccent;
  onBack: () => void;
  backDisabled?: boolean;
  backTitle?: string;
  onRules: () => void;
  rulesLabel: string;
  /** Bloque menu nav (Crash en vol). */
  navLocked?: boolean;
  navLockedReason?: string;
  /**
   * Bloque la recharge (ex. Plinko : billes encore en vol / payouts en attente).
   * Évite de recharger à 0 pendant que des gains vont encore arriver.
   */
  refillLocked?: boolean;
  refillLockedReason?: string;
};

/**
 * Topbar partagée des salons (Mines / Craps / Crash / Plinko / Stampede) :
 * retour Lobby, marque, règles, crédit + pic, recharge si fauché.
 */
export function GameShell({
  title,
  eyebrow,
  accent,
  onBack,
  backDisabled = false,
  backTitle,
  onRules,
  rulesLabel,
  navLocked = false,
  navLockedReason,
  refillLocked = false,
  refillLockedReason,
}: GameShellProps) {
  const balance = useGame((s) => s.balance);
  const peakBalance = useGame((s) => s.peakBalance);
  const refill = useGame((s) => s.refill);
  const broke = balance < 1_00;
  const canRefill = broke && !refillLocked;

  return (
    <>
      <AppMenu
        compact
        navLocked={navLocked || backDisabled}
        navLockedReason={navLockedReason ?? backTitle}
      />
      <header className="game-topbar" data-accent={accent}>
        <button
          type="button"
          className="game-shell-back"
          onClick={onBack}
          aria-label="Retour Lobby"
          disabled={backDisabled}
          title={backTitle ?? (backDisabled ? undefined : 'Retour Lobby')}
        >
          ← Lobby
        </button>
        <div className="game-brand">
          <span className="mono">{eyebrow}</span>
          <h1>{title}</h1>
        </div>
        <button type="button" className="icon-btn" onClick={onRules} aria-label={rulesLabel}>
          ⓘ
        </button>
        <div className="game-balance">
          <span className="label">Crédit</span>
          <span className="value">{fmt(balance)}</span>
          <span className="peak">Pic {fmt(peakBalance)}</span>
          {canRefill && (
            <button
              type="button"
              className="btn primary game-refill-btn"
              onClick={refill}
              title={`Recharger ${fmt(STARTING_BALANCE)}`}
            >
              +{Math.floor(STARTING_BALANCE / 100)}
            </button>
          )}
        </div>
      </header>
      {broke && (
        <div className="game-broke-banner" role="status">
          {refillLocked ? (
            <span>{refillLockedReason ?? 'Attendez la fin de la manche pour recharger.'}</span>
          ) : (
            <>
              <span>Crédit épuisé — rechargez pour continuer.</span>
              <button type="button" className="btn primary" onClick={refill}>
                Recharger {fmt(STARTING_BALANCE)}
              </button>
            </>
          )}
        </div>
      )}
    </>
  );
}
