import { fmt } from '../lib/format';
import { STARTING_BALANCE } from '../store/persistence';
import { useGame } from '../store/gameStore';
import { AppMenu } from './AppMenu';

export type GameShellAccent = 'mines' | 'craps' | 'crash';

type GameShellProps = {
  title: string;
  eyebrow: string;
  accent: GameShellAccent;
  onBack: () => void;
  backDisabled?: boolean;
  backTitle?: string;
  onRules: () => void;
  rulesLabel: string;
};

/**
 * Topbar partagée des salons (Mines / Craps / Crash) :
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
}: GameShellProps) {
  const balance = useGame((s) => s.balance);
  const peakBalance = useGame((s) => s.peakBalance);
  const refill = useGame((s) => s.refill);
  const broke = balance < 1_00;

  return (
    <>
      <AppMenu />
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
          {broke && (
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
          <span>Crédit épuisé — rechargez pour continuer.</span>
          <button type="button" className="btn primary" onClick={refill}>
            Recharger {fmt(STARTING_BALANCE)}
          </button>
        </div>
      )}
    </>
  );
}
