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

function emptyStacks(): SeatStacks {
  return {
    main: [],
    perfectPairs: [],
    twentyOnePlusThree: [],
    luckyLadies: [],
    bustIt: [],
    royalMatch: [],
  };
}

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
}: {
  seatIndex: number;
  stacks: SeatStacks;
  spot: BetSpot;
  label: string;
  title?: string;
  hint?: string;
  main?: boolean;
  flash?: boolean;
}) {
  const addChip = useGame((s) => s.addChip);
  const selectSeat = useGame((s) => s.selectSeat);
  const chips = stacks[spot];
  const amount = spotAmount(stacks, spot);
  return (
    <button
      className={`bet-spot ${main ? 'main' : 'pill'} ${amount > 0 ? 'filled' : ''} ${flash ? 'flash-win' : ''}`}
      onClick={() => {
        selectSeat(seatIndex);
        addChip(spot);
      }}
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

/** Pastille compacte : sélection de place + aperçu de la mise principale. */
function SeatTab({
  seatIndex,
  stacks,
  selected,
}: {
  seatIndex: number;
  stacks: SeatStacks;
  selected: boolean;
}) {
  const selectSeat = useGame((s) => s.selectSeat);
  const addChip = useGame((s) => s.addChip);
  const main = spotAmount(stacks, 'main');
  const sides =
    spotAmount(stacks, 'twentyOnePlusThree') + spotAmount(stacks, 'perfectPairs');

  return (
    <button
      type="button"
      className={`seat-tab ${selected ? 'selected' : ''} ${main > 0 ? 'occupied' : ''}`}
      onClick={() => selectSeat(seatIndex)}
      onDoubleClick={() => {
        selectSeat(seatIndex);
        addChip('main');
      }}
      aria-label={`Place ${seatIndex + 1}${main > 0 ? `, mise ${fmt(main)}` : ''}`}
      aria-pressed={selected}
      data-seat-id={seatIndex}
    >
      <span className="seat-tab-num">{seatIndex + 1}</span>
      <span className="seat-tab-main">{main > 0 ? fmt(main) : '—'}</span>
      {sides > 0 && <span className="seat-tab-sides">+{fmt(sides)}</span>}
    </button>
  );
}

/**
 * Plateau multi-places : bandeau de sièges + zone de mise focalisée
 * sur la place sélectionnée (évite la superposition des cercles).
 */
export function BettingBoard() {
  const tableId = useGame((s) => s.tableId);
  const balance = useGame((s) => s.balance);
  const stacks = useGame((s) => s.stacks);
  const seatCapacity = useGame((s) => s.seatCapacity);
  const selectedSeat = useGame((s) => s.selectedSeat);
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
  const canDeal = stacks.some(
    (seatStacks, index) =>
      index < seatCapacity && spotAmount(seatStacks, 'main') >= table.rules.minBet,
  );
  const enabled = new Set<BetSpot>(['main', ...table.rules.sideBets]);
  const activeSeat = Math.min(selectedSeat, seatCapacity - 1);
  const activeStacks = stacks[activeSeat] ?? emptyStacks();

  return (
    <>
      <div className="betting-board">
        <div className="seat-tabs" data-seat-capacity={seatCapacity}>
          {Array.from({ length: seatCapacity }, (_, seatIndex) => (
            <SeatTab
              key={seatIndex}
              seatIndex={seatIndex}
              stacks={stacks[seatIndex] ?? emptyStacks()}
              selected={seatIndex === activeSeat}
            />
          ))}
        </div>

        <div className="focused-seat-bets" data-seat-id={activeSeat}>
          <div className="focused-seat-caption">Place {activeSeat + 1}</div>
          <div className="spots-row">
            {SPOT_ORDER.filter((s) => enabled.has(s)).map((spot) => {
              if (spot === 'main') {
                return (
                  <Spot
                    key={spot}
                    seatIndex={activeSeat}
                    stacks={activeStacks}
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
                  seatIndex={activeSeat}
                  stacks={activeStacks}
                  spot={spot}
                  label={def.shortName}
                  title={`${def.name} — ${def.description}`}
                  hint={def.shortName}
                  flash={dealFlashIds.includes(`${activeSeat}:${spot}`)}
                />
              );
            })}
          </div>
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
