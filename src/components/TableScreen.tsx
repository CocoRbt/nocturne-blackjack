import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { getTable } from '../engine/rules';
import { SIDE_BET_DEFS } from '../engine/sidebets';
import { fmt, fmtNet } from '../lib/format';
import { ANIMATION_ZONES, splitHandScale } from '../lib/animationZones';
import { resetSettledDeals } from '../lib/dealAnimation';
import { useGame } from '../store/gameStore';
import { ActionBar } from './ActionBar';
import { BettingBoard } from './BettingBoard';
import { SideDrawer, type DrawerTab } from './Drawers';
import { DealerHandView, PlayerHandView } from './HandView';
import { InsuranceOverlay, ResultBanner, ResultTray } from './Overlays';
import { PayoutFly } from './PayoutFly';
import { RulesGuide } from './RulesGuide';
import { SessionHud } from './SessionHud';

export function TableScreen() {
  useGame((s) => s.v);
  const tableId = useGame((s) => s.tableId);
  const balance = useGame((s) => s.balance);
  const round = useGame((s) => s.round);
  const display = useGame((s) => s.display);
  const notice = useGame((s) => s.notice);
  const dismissNotice = useGame((s) => s.dismissNotice);
  const leaveTable = useGame((s) => s.leaveTable);
  const toggleSound = useGame((s) => s.toggleSound);
  const soundMuted = useGame((s) => s.soundMuted);
  const gameSpeed = useGame((s) => s.gameSpeed);
  const setGameSpeed = useGame((s) => s.setGameSpeed);
  const shoeSize = useGame((s) => s.shoeSize);
  const shoeDealt = useGame((s) => s.shoeDealt);
  const action = useGame((s) => s.action);
  const deal = useGame((s) => s.deal);
  const rebetAndDeal = useGame((s) => s.rebetAndDeal);
  const refill = useGame((s) => s.refill);
  const seatCapacity = useGame((s) => s.seatCapacity);
  const refreshSeatCapacity = useGame((s) => s.refreshSeatCapacity);

  const [drawer, setDrawer] = useState<DrawerTab | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const [stageScrollable, setStageScrollable] = useState(false);

  const table = getTable(tableId);
  const betting = !round;
  const settled = !!round && display.resultsShown;
  const isInitialDeal = display.dealing;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (drawer || rulesOpen) return;
      const k = e.key.toLowerCase();
      if (k === 't') action('hit');
      else if (k === 'r') action('stand');
      else if (k === 'd') action('double');
      else if (k === 's') action('split');
      else if (k === 'a') action('surrender');
      else if (k === ' ') {
        e.preventDefault();
        const st = useGame.getState();
        if (!st.round) deal();
        else if (st.display.resultsShown) rebetAndDeal();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [action, deal, rebetAndDeal, drawer, rulesOpen]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(dismissNotice, 2800);
    return () => clearTimeout(t);
  }, [notice, dismissNotice]);

  // Nouvelle manche : les ids de cartes peuvent revenir après un re-mélange.
  useEffect(() => {
    if (!round) resetSettledDeals();
  }, [round]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(orientation: landscape)');
    const onChange = () => refreshSeatCapacity();
    mq.addEventListener('change', onChange);
    refreshSeatCapacity();
    return () => mq.removeEventListener('change', onChange);
  }, [refreshSeatCapacity]);

  const shoeRatio = shoeSize > 0 ? 1 - shoeDealt / shoeSize : 1;
  const broke = betting && balance < table.rules.minBet;
  const occupiedSeatCount = round?.seats.length ?? 0;
  const splitCount = round?.seats.reduce((max, seat) => Math.max(max, seat.hands.length), 0) ?? 0;
  const handScale = splitHandScale(splitCount);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const check = () => {
      const cluster = el.querySelector('.table-cluster') as HTMLElement | null;
      // Mesurer le cluster (pas scrollHeight) : avec justify-content:center,
      // le débordement haut n’augmente pas toujours scrollHeight (bug Android).
      const needed = (cluster?.offsetHeight ?? el.scrollHeight) + 12;
      setStageScrollable(needed > el.clientHeight + 2);
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    const cluster = el.querySelector('.table-cluster');
    if (cluster) ro.observe(cluster);
    return () => ro.disconnect();
  }, [round, display.resultsShown, betting, occupiedSeatCount, splitCount]);

  // Fin de manche : ramener le scroll en haut pour voir le croupier.
  useEffect(() => {
    if (!settled) return;
    const el = stageRef.current;
    if (!el) return;
    el.scrollTop = 0;
  }, [settled, display.resultsShown]);

  return (
    <div
      className="table-screen grain"
      data-felt={table.felt}
      style={
        {
          '--accent': table.identity.accent,
          '--lamp': table.identity.lamp,
          '--split-hand-scale': handScale,
        } as CSSProperties
      }
    >
      <div className="topbar">
        <button className="back" onClick={leaveTable}>
          ← Lobby
        </button>
        <div>
          <div className="table-name">{table.name}</div>
          <div className="rules-hint">
            BJ 3:2 · {table.rules.dealerHitsSoft17 ? 'H17' : 'S17'} · {table.rules.decks} jeux
            {table.rules.lateSurrender ? ' · abandon' : ''}
            {` · ${seatCapacity} places`}
          </div>
        </div>
        <div className="spacer" />
        <SessionHud />
        <div className="shoe-meter" data-zone={ANIMATION_ZONES.shoe}>
          <span className="label">
            Sabot · {shoeSize - shoeDealt}/{shoeSize}
          </span>
          <div className="bar">
            <div className="fill" style={{ width: `${shoeRatio * 100}%` }} />
          </div>
        </div>
        <div className="balance" data-zone={ANIMATION_ZONES.balance} data-balance data-payout-anchor>
          <span className="label">Crédit</span>
          <span className="value">{fmt(balance)}</span>
        </div>
        <button
          className="icon-btn speed-toggle"
          onClick={() => setGameSpeed(gameSpeed === 'classic' ? 'fast' : 'classic')}
          disabled={!!round}
          aria-label="Vitesse"
          title={gameSpeed === 'classic' ? 'Passer en Rapide' : 'Passer en Classic'}
        >
          {gameSpeed === 'fast' ? '⚡' : '◷'}
        </button>
        <button className="icon-btn" onClick={toggleSound} aria-label="Son">
          {soundMuted ? '🔇' : '🔊'}
        </button>
        <button className="icon-btn" onClick={() => setDrawer('history')} aria-label="Historique">
          ≡
        </button>
        <button
          className="icon-btn"
          onClick={() => setRulesOpen(true)}
          aria-label="Règles et paiements"
        >
          ⓘ
        </button>
      </div>

      <div
        ref={stageRef}
        className={`stage ${stageScrollable ? 'stage-scrollable' : ''}`}
        data-zone={ANIMATION_ZONES.stage}
      >
        <div className="table-cluster">
          <div className="dealer-zone" data-zone="dealer-zone">
            {/* Sabot de table — origine physique de la distribution (réf. casino live). */}
            <div className="table-shoe" data-zone={ANIMATION_ZONES.dealOrigin} aria-hidden="true">
              <div className="table-shoe-slot">
                <span className="table-shoe-stack" />
                <span className="table-shoe-lip" />
              </div>
            </div>
            <span className="zone-label">Croupier</span>
            {round ? (
              <DealerHandView
                cards={round.dealerCards}
                shown={display.holeShown ? display.dealerShown : 2}
                holeShown={display.holeShown}
                isInitialDeal={isInitialDeal}
                dealIndexes={[occupiedSeatCount, occupiedSeatCount * 2 + 1]}
              />
            ) : (
              <div className="table-motto">{table.identity.motto}</div>
            )}
          </div>

          <div className="center-message">
            <ResultBanner />
            {betting && !broke && <span className="table-motto">Placez vos mises</span>}
            {broke && (
              <div className="result-banner compact">
                <div className="headline lose">Crédit épuisé</div>
                <button className="btn primary" onClick={refill} style={{ marginTop: 8 }}>
                  Reconstituer le crédit
                </button>
              </div>
            )}
          </div>

          {round && (
            <div
              className="player-zone table-seats"
              data-zone="player-zone"
              data-split-count={splitCount}
              data-seat-count={occupiedSeatCount}
            >
              {round.seats.map((seat, seatCursor) => {
                const activeSeat = round.activeSeatIndex === seat.seatIndex;
                const sideWins =
                  !display.dealing && !display.resultsShown
                    ? seat.dealSideBetResults.filter((r) => r.returned > 0)
                    : [];
                return (
                  <div
                    key={seat.seatIndex}
                    className={`table-seat ${activeSeat && !display.dealing ? 'active' : ''}`}
                    data-seat-id={seat.seatIndex}
                  >
                    <div className="seat-round-label">Place {seat.seatIndex + 1}</div>
                    <div className="seat-hands">
                      {seat.hands.map((h, handIndex) => (
                        <PlayerHandView
                          key={handIndex}
                          seatIndex={seat.seatIndex}
                          handIndex={handIndex}
                          hand={h}
                          active={
                            round.phase === 'player' &&
                            activeSeat &&
                            handIndex === seat.activeHandIndex &&
                            !display.dealing
                          }
                          result={
                            display.resultsShown
                              ? round.result?.hands.find(
                                  (result) =>
                                    result.seatIndex === seat.seatIndex &&
                                    result.handIndex === handIndex,
                                )
                              : undefined
                          }
                          isInitialDeal={isInitialDeal && handIndex === 0}
                          dealIndexes={
                            handIndex === 0
                              ? [seatCursor, occupiedSeatCount + 1 + seatCursor]
                              : undefined
                          }
                        />
                      ))}
                    </div>
                    {sideWins.length > 0 && (
                      <div className="seat-side-wins" aria-live="polite">
                        {sideWins.map((r) => (
                          <span key={`${seat.seatIndex}-${r.id}`} className="seat-side-win">
                            {SIDE_BET_DEFS[r.id].shortName}
                            {r.label ? ` · ${r.label}` : ''} {fmtNet(r.net)}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <PayoutFly />
      </div>

      {betting ? <BettingBoard /> : settled ? <ResultTray /> : <ActionBar />}

      <InsuranceOverlay />

      <AnimatePresence>
        {notice && (
          <motion.div
            className="notice"
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
          >
            {notice}
          </motion.div>
        )}
      </AnimatePresence>

      <SideDrawer
        open={drawer !== null}
        tab={drawer ?? 'history'}
        onTab={setDrawer}
        onClose={() => setDrawer(null)}
      />

      <RulesGuide game="blackjack" open={rulesOpen} onClose={() => setRulesOpen(false)} />
    </div>
  );
}
