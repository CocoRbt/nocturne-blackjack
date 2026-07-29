import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { getTable } from '../engine/rules';
import { fmt } from '../lib/format';
import { ANIMATION_ZONES, splitHandScale } from '../lib/animationZones';
import { resetSettledDeals } from '../lib/dealAnimation';
import { useGame } from '../store/gameStore';
import { ActionBar } from './ActionBar';
import { BettingBoard } from './BettingBoard';
import { SideDrawer, type DrawerTab } from './Drawers';
import { DealerHandView, PlayerHandView } from './HandView';
import { InsuranceOverlay, ResultBanner, ResultTray } from './Overlays';
import { PayoutFly } from './PayoutFly';
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

  const [drawer, setDrawer] = useState<DrawerTab | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [stageScrollable, setStageScrollable] = useState(false);

  const table = getTable(tableId);
  const betting = !round;
  const settled = !!round && display.resultsShown;
  const isInitialDeal = display.dealing;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (drawer) return;
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
  }, [action, deal, rebetAndDeal, drawer]);

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
    const el = stageRef.current;
    if (!el) return;
    const check = () => setStageScrollable(el.scrollHeight > el.clientHeight + 2);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [round, display.resultsShown, betting]);

  const shoeRatio = shoeSize > 0 ? 1 - shoeDealt / shoeSize : 1;
  const broke = betting && balance < table.rules.minBet;
  const splitCount = round?.hands.length ?? 0;
  const handScale = splitHandScale(splitCount);

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
          ← Salon
        </button>
        <div>
          <div className="table-name">{table.name}</div>
          <div className="rules-hint">
            BJ 3:2 · {table.rules.dealerHitsSoft17 ? 'H17' : 'S17'} · {table.rules.decks} jeux
            {table.rules.lateSurrender ? ' · abandon' : ''}
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
          onClick={() => setDrawer('paytables')}
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
              className="player-zone"
              data-zone="player-zone"
              data-split-count={splitCount}
            >
              {round.hands.map((h, i) => (
                <PlayerHandView
                  key={i}
                  handIndex={i}
                  hand={h}
                  active={round.phase === 'player' && i === round.activeHandIndex && !display.dealing}
                  result={display.resultsShown ? round.result?.hands[i] : undefined}
                  isInitialDeal={isInitialDeal}
                />
              ))}
            </div>
          )}

          {!display.dealing && display.dealFlashIds.length > 0 && !display.resultsShown && (
            <div className="deal-flash-strip">
              {display.dealFlashIds.map((id) => (
                <span key={id} className="flash-pill">
                  {id === 'perfectPairs' ? 'Paires' : '21+3'}
                </span>
              ))}
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
    </div>
  );
}
