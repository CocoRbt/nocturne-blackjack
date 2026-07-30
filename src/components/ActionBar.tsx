import type { PlayerActionType } from '../engine/types';
import { useGame } from '../store/gameStore';

const PRIMARY: PlayerActionType[] = ['hit', 'stand'];
const SECONDARY: PlayerActionType[] = ['double', 'split', 'surrender'];

const LABELS: Record<PlayerActionType, { label: string; key: string }> = {
  hit: { label: 'Tirer', key: 'T' },
  stand: { label: 'Rester', key: 'R' },
  double: { label: 'Doubler', key: 'D' },
  split: { label: 'Séparer', key: 'S' },
  surrender: { label: 'Abandonner', key: 'A' },
};

/** Barre d'actions : Tirer/Rester XXL, secondaires en ghost. */
export function ActionBar() {
  useGame((s) => s.v);
  const round = useGame((s) => s.round);
  const balance = useGame((s) => s.balance);
  const dealing = useGame((s) => s.display.dealing);
  const resultsShown = useGame((s) => s.display.resultsShown);
  const action = useGame((s) => s.action);

  if (!round || round.phase !== 'player' || dealing || resultsShown) return null;
  const available = round.availableActions(balance);
  const primary = PRIMARY.filter((id) => available.includes(id));
  const secondary = SECONDARY.filter((id) => available.includes(id));
  const activeSeat = round.activeSeatIndex;

  return (
    <div className="action-bar">
      {activeSeat !== null && <div className="action-seat-label">Place {activeSeat + 1}</div>}
      <div className="action-primary">
        {primary.map((id) => (
          <button key={id} className="btn primary xxl" onClick={() => action(id)}>
            {LABELS[id].label}
            <span className="key">{LABELS[id].key}</span>
          </button>
        ))}
      </div>
      {secondary.length > 0 && (
        <div className="action-secondary">
          {secondary.map((id) => (
            <button key={id} className="btn ghost" onClick={() => action(id)}>
              {LABELS[id].label}
              <span className="key">{LABELS[id].key}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
