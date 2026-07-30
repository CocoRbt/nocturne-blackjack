import { AnimatePresence, motion } from 'framer-motion';
import { SIDE_BET_DEFS } from '../engine/sidebets';
import { fmt, fmtNet } from '../lib/format';
import { useGame } from '../store/gameStore';

/** Proposition d'assurance / even money quand le croupier montre un As. */
export function InsuranceOverlay() {
  useGame((s) => s.v);
  const round = useGame((s) => s.round);
  const dealing = useGame((s) => s.display.dealing);
  const balance = useGame((s) => s.balance);
  const takeInsurance = useGame((s) => s.takeInsurance);
  const declineInsurance = useGame((s) => s.declineInsurance);
  const takeEvenMoney = useGame((s) => s.takeEvenMoney);

  const open = !!round && round.phase === 'insurance' && !dealing;
  const activeSeat = round?.activeSeatIndex ?? null;

  return (
    <AnimatePresence>
      {open && round && (
        <motion.div
          className="overlay-panel insurance-panel"
          initial={{ opacity: 0, y: 24, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 10, scale: 0.98 }}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        >
          <h3>Le croupier montre un As</h3>
          {activeSeat !== null && <div className="insurance-seat-label">Place {activeSeat + 1}</div>}
          {round.canTakeEvenMoney ? (
            <p>
              Vous avez un blackjack. Prendre even money garantit un paiement 1:1,
              sinon vous risquez l&rsquo;égalité contre un blackjack croupier.
            </p>
          ) : (
            <p>
              L&rsquo;assurance couvre la moitié de votre mise et paie 2:1 si le
              croupier a un blackjack.
            </p>
          )}
          <div className="row">
            {round.canTakeEvenMoney && (
              <button className="btn primary" onClick={takeEvenMoney}>
                Even money 1:1
              </button>
            )}
            <button
              className="btn"
              onClick={takeInsurance}
              disabled={balance <= 0 || round.maxInsurance <= 0}
            >
              Assurance ({fmt(Math.min(round.maxInsurance, balance))})
            </button>
            <button className="btn ghost" onClick={declineInsurance}>
              Refuser
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Headline compacte au centre — les CTAs sont dans ResultTray. */
export function ResultBanner() {
  useGame((s) => s.v);
  const round = useGame((s) => s.round);
  const resultsShown = useGame((s) => s.display.resultsShown);
  const animatedNet = useGame((s) => s.display.animatedNet);
  const payoutPhase = useGame((s) => s.display.payoutPhase);

  if (!round || !round.result) return null;
  if (!resultsShown && payoutPhase !== 'flying') return null;

  const res = round.result;
  const net = resultsShown ? res.totalNet : animatedNet;
  const insuranceNet = res.insurance.reduce((total, insurance) => total + insurance.net, 0);

  const headline =
    resultsShown && res.hands.some((h) => h.outcome === 'blackjack') && res.totalNet > 0
      ? { text: 'Blackjack', cls: 'bj' }
      : net > 0
        ? { text: `Vous gagnez ${fmt(Math.abs(net))}`, cls: 'win' }
        : net < 0
          ? { text: `Perte de ${fmt(Math.abs(net))}`, cls: 'lose' }
          : { text: 'Égalité', cls: 'push' };

  return (
    <motion.div
      className="result-banner compact"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className={`headline ${headline.cls}`}>{headline.text}</div>
      {resultsShown && (
        <>
          <div className="detail">
            Croupier{' '}
            {res.dealerBust ? 'sauté' : res.dealerBlackjack ? 'blackjack' : res.dealerTotal}
            {res.insurance.length > 0 && ` · assurance ${fmtNet(insuranceNet)}`}
          </div>
          {res.sideBets.length > 0 && (
            <div className="side-results">
              {res.sideBets.map((b) => (
                <span key={`${b.seatIndex}-${b.id}`} className={b.net > 0 ? 'won' : ''}>
                  P{b.seatIndex + 1} · {SIDE_BET_DEFS[b.id].shortName}
                  {b.label ? ` — ${b.label}` : ''} {fmtNet(b.net)}
                </span>
              ))}
            </div>
          )}
        </>
      )}
    </motion.div>
  );
}

/** CTAs de fin de manche dans la zone tray (bas). */
export function ResultTray() {
  useGame((s) => s.v);
  const round = useGame((s) => s.round);
  const resultsShown = useGame((s) => s.display.resultsShown);
  const nextRound = useGame((s) => s.nextRound);
  const rebetAndDeal = useGame((s) => s.rebetAndDeal);
  const balance = useGame((s) => s.balance);
  const lastBets = useGame((s) => s.lastBets);
  const tableId = useGame((s) => s.tableId);
  const seatCapacity = useGame((s) => s.seatCapacity);

  if (!round || !resultsShown || !round.result) return null;

  const last = lastBets[tableId];
  const rebetTotal = last
    ? last.reduce(
        (total, seatBet) =>
          total +
          seatBet.bets.main +
          Object.values(seatBet.bets.sideBets).reduce<number>((a, b) => a + (b ?? 0), 0),
        0,
      )
    : 0;
  const rebetFitsCapacity = !last?.some((seatBet) => seatBet.seatIndex >= seatCapacity);
  const canRebet = last !== undefined && rebetFitsCapacity && balance >= rebetTotal;

  return (
    <div className="result-tray">
      <button
        className="btn primary pulse-cta"
        onClick={() => {
          if (canRebet) rebetAndDeal();
          else nextRound();
        }}
        autoFocus
      >
        {canRebet ? 'Remiser · Distribuer' : 'Ajuster la mise'}
      </button>
      <button className="btn" onClick={nextRound}>
        Nouvelle manche
      </button>
    </div>
  );
}
