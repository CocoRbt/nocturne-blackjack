import { getTable } from '../engine/rules';
import { SIDE_BET_DEFS } from '../engine/sidebets';
import type { SideBetId } from '../engine/types';
import { ANIMATION_ZONES } from '../lib/animationZones';
import { fmt } from '../lib/format';
import { chipsForLimits } from '../store/chips';
import { stagedTotal, useGame, type BetSpot } from '../store/gameStore';
import { Chip, ChipStack } from './ChipView';

/** Ordre Stake / Evolution : 21+3 à gauche, main au centre, Paires à droite. */
const SPOT_ORDER: BetSpot[] = ['twentyOnePlusThree', 'main', 'perfectPairs'];

function Spot({
  spot,
  label,
  title,
  hint,
  main = false,
  flash = false,
}: {
  spot: BetSpot;
  label: string;
  title?: string;
  hint?: string;
  main?: boolean;
  flash?: boolean;
}) {
  const stacks = useGame((s) => s.stacks);
  const addChip = useGame((s) => s.addChip);
  const chips = stacks[spot];
  const amount = chips.reduce((a, b) => a + b, 0);
  return (
    <button
      className={`bet-spot ${main ? 'main' : 'pill'} ${amount > 0 ? 'filled' : ''} ${flash ? 'flash-win' : ''}`}
      onClick={() => addChip(spot)}
      aria-label={`Miser sur ${main ? 'Main principale' : label}`}
      title={title}
      data-zone={main ? ANIMATION_ZONES.betMain : ANIMATION_ZONES.betSide}
      data-bet-spot={spot}
    >
      <div className="ring">
        {amount > 0 ? <ChipStack chips={chips} /> : <span className="hint">{hint ?? '—'}</span>}
      </div>
      <span className="name">{label}</span>
      <span className={`amount ${amount === 0 ? 'empty' : ''}`}>
        {amount > 0 ? fmt(amount) : 'miser'}
      </span>
    </button>
  );
}

/** Plateau de mise : arc desktop, pastilles mobile, rack de jetons. */
export function BettingBoard() {
  const tableId = useGame((s) => s.tableId);
  const balance = useGame((s) => s.balance);
  const stacks = useGame((s) => s.stacks);
  const selectedChip = useGame((s) => s.selectedChip);
  const selectChip = useGame((s) => s.selectChip);
  const undoLastChip = useGame((s) => s.undoLastChip);
  const clearBets = useGame((s) => s.clearBets);
  const rebet = useGame((s) => s.rebet);
  const deal = useGame((s) => s.deal);
  const lastBets = useGame((s) => s.lastBets);
  const placementOrder = useGame((s) => s.placementOrder);
  const dealFlashIds = useGame((s) => s.display.dealFlashIds);

  const table = getTable(tableId);
  const chipDenoms = chipsForLimits(table.rules.minBet, table.rules.maxBet);
  const staged = stagedTotal(stacks);
  const main = stacks.main.reduce((a, b) => a + b, 0);
  const canDeal = main >= table.rules.minBet;
  const enabled = new Set<BetSpot>(['main', ...table.rules.sideBets]);

  return (
    <>
      <div className="betting-board">
        <div className="spots-row">
          {SPOT_ORDER.filter((s) => enabled.has(s)).map((spot) => {
            if (spot === 'main') {
              return (
                <Spot
                  key={spot}
                  spot="main"
                  label="Main"
                  hint="BJ 3:2"
                  main
                />
              );
            }
            const def = SIDE_BET_DEFS[spot as SideBetId];
            return (
              <Spot
                key={spot}
                spot={spot}
                label={def.shortName}
                title={`${def.name} — ${def.description}`}
                hint={def.shortName}
                flash={dealFlashIds.includes(spot as SideBetId)}
              />
            );
          })}
        </div>
      </div>
      <div className="tray">
        <div className="chip-row">
          {chipDenoms.map((d) => (
            <button
              key={d}
              className={`chip-btn ${selectedChip === d ? 'selected' : ''}`}
              disabled={staged + d > balance}
              onClick={() => selectChip(d)}
              aria-label={`Jeton de ${fmt(d)}`}
            >
              <Chip denom={d} />
            </button>
          ))}
        </div>
        <div className="bet-controls">
          <button className="btn ghost" onClick={undoLastChip} disabled={placementOrder.length === 0}>
            Annuler
          </button>
          <button className="btn ghost" onClick={clearBets} disabled={staged === 0}>
            Effacer
          </button>
          <button className="btn" onClick={rebet} disabled={!lastBets[tableId]}>
            Remiser
          </button>
          <button className="btn primary" onClick={deal} disabled={!canDeal}>
            Distribuer{staged > 0 ? ` · ${fmt(staged)}` : ''}
          </button>
        </div>
      </div>
    </>
  );
}
