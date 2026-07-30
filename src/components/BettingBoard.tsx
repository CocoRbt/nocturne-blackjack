import { getTable } from '../engine/rules';
import { SIDE_BET_DEFS } from '../engine/sidebets';
import type { SideBetId } from '../engine/types';
import { ANIMATION_ZONES } from '../lib/animationZones';
import { fmt } from '../lib/format';
import { chipsForLimits } from '../store/chips';
import { stagedTotal, useGame, type BetSpot, type SeatStacks } from '../store/gameStore';
import { Chip, ChipStack } from './ChipView';

/** Ordre Stake / Evolution : 21+3 à gauche, main au centre, Paires à droite. */
const SPOT_ORDER: BetSpot[] = ['twentyOnePlusThree', 'main', 'perfectPairs'];

function spotAmount(stacks: SeatStacks, spot: BetSpot): number {
  return stacks[spot].reduce((a, b) => a + b, 0);
}

function Spot({
  seatIndex,
  stacks,
  spot,
  label,
  title,
  hint,
  main = false,
  flash = false,
  locked = false,
}: {
  seatIndex: number;
  stacks: SeatStacks;
  spot: BetSpot;
  label: string;
  title?: string;
  hint?: string;
  main?: boolean;
  flash?: boolean;
  locked?: boolean;
}) {
  const addChip = useGame((s) => s.addChip);
  const selectSeat = useGame((s) => s.selectSeat);
  const chips = stacks[spot];
  const amount = spotAmount(stacks, spot);
  return (
    <button
      className={`bet-spot ${main ? 'main' : 'pill'} ${amount > 0 ? 'filled' : ''} ${flash ? 'flash-win' : ''}`}
      onClick={(e) => {
        e.stopPropagation();
        selectSeat(seatIndex);
        addChip(spot);
      }}
      disabled={locked}
      aria-label={`Miser place ${seatIndex + 1} sur ${main ? 'Main principale' : label}`}
      title={title}
      data-zone={main ? ANIMATION_ZONES.betMain : ANIMATION_ZONES.betSide}
      data-bet-spot={spot}
      data-seat-id={seatIndex}
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

function SeatPod({
  seatIndex,
  locked,
  enabled,
  dealFlashIds,
}: {
  seatIndex: number;
  locked: boolean;
  enabled: Set<BetSpot>;
  dealFlashIds: string[];
}) {
  const allStacks = useGame((s) => s.stacks);
  const selectedSeat = useGame((s) => s.selectedSeat);
  const selectSeat = useGame((s) => s.selectSeat);
  const stacks = allStacks[seatIndex] ?? {
    main: [],
    perfectPairs: [],
    twentyOnePlusThree: [],
    luckyLadies: [],
    bustIt: [],
    royalMatch: [],
  };
  const occupied = spotAmount(stacks, 'main') > 0;
  const selected = selectedSeat === seatIndex && !locked;

  return (
    <div
      className={`seat-pod ${selected ? 'selected' : ''} ${occupied ? 'occupied' : ''} ${locked ? 'locked' : ''}`}
      onClick={() => selectSeat(seatIndex)}
      onKeyDown={(e) => {
        if (locked) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          selectSeat(seatIndex);
        }
      }}
      role="button"
      tabIndex={locked ? -1 : 0}
      data-seat-id={seatIndex}
      aria-label={locked ? `Place ${seatIndex + 1} verrouillée` : `Sélectionner place ${seatIndex + 1}`}
      aria-disabled={locked}
    >
      <span className="seat-label">Place {seatIndex + 1}</span>
      <div className="seat-spots">
        {SPOT_ORDER.filter((s) => enabled.has(s)).map((spot) => {
          if (spot === 'main') {
            return (
              <Spot
                key={spot}
                seatIndex={seatIndex}
                stacks={stacks}
                spot="main"
                label="Main"
                hint="BJ"
                main
                locked={locked}
              />
            );
          }
          const def = SIDE_BET_DEFS[spot as SideBetId];
          return (
            <Spot
              key={spot}
              seatIndex={seatIndex}
              stacks={stacks}
              spot={spot}
              label={def.shortName}
              title={`${def.name} — ${def.description}`}
              hint={def.shortName}
              flash={dealFlashIds.includes(`${seatIndex}:${spot}`)}
              locked={locked}
            />
          );
        })}
      </div>
    </div>
  );
}

/** Plateau de mise : arc desktop, pastilles mobile, rack de jetons. */
export function BettingBoard() {
  const tableId = useGame((s) => s.tableId);
  const balance = useGame((s) => s.balance);
  const stacks = useGame((s) => s.stacks);
  const seatCapacity = useGame((s) => s.seatCapacity);
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
  const canDeal = stacks.some((seatStacks, index) => index < seatCapacity && spotAmount(seatStacks, 'main') >= table.rules.minBet);
  const enabled = new Set<BetSpot>(['main', ...table.rules.sideBets]);
  const visibleSeatCount = seatCapacity === 5 ? 7 : seatCapacity;

  return (
    <>
      <div className="betting-board">
        <div className="seats-betting-row" data-seat-capacity={seatCapacity}>
          {Array.from({ length: visibleSeatCount }, (_, seatIndex) => (
            <SeatPod
              key={seatIndex}
              seatIndex={seatIndex}
              locked={seatIndex >= seatCapacity}
              enabled={enabled}
              dealFlashIds={dealFlashIds}
            />
          ))}
        </div>
        {seatCapacity === 5 && (
          <div className="seat-capacity-hint">Passe en paysage pour 7 places</div>
        )}
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
