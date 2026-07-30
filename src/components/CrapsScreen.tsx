import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import {
  canPlaceDontPass,
  canPlaceOdds,
  canPlacePass,
  createCrapsRound,
  oddsCap,
  placeBet,
  rollAndResolve,
  type BetKind,
  type CrapsRound,
  type DieFace,
} from '../craps/engine';
import { fmt } from '../lib/format';
import { useGame } from '../store/gameStore';
import { RulesGuide } from './RulesGuide';

const BET_PRESETS = [1_00, 5_00, 25_00, 100_00, 500_00] as const;

const PIP_MAP: Record<DieFace, Array<[number, number]>> = {
  1: [[50, 50]],
  2: [[28, 28], [72, 72]],
  3: [[28, 28], [50, 50], [72, 72]],
  4: [[28, 28], [72, 28], [28, 72], [72, 72]],
  5: [[28, 28], [72, 28], [50, 50], [28, 72], [72, 72]],
  6: [[28, 28], [72, 28], [28, 50], [72, 50], [28, 72], [72, 72]],
};

function Die({ face, rolling, delay = 0 }: { face: DieFace; rolling: boolean; delay?: number }) {
  return (
    <motion.div
      className="craps-die"
      animate={
        rolling
          ? { rotate: [0, 18, -14, 10, 0], y: [0, -18, 6, -4, 0], scale: [1, 1.06, 0.98, 1] }
          : { rotate: 0, y: 0, scale: 1 }
      }
      transition={{ duration: 0.55, delay, ease: [0.22, 1, 0.36, 1] }}
      aria-label={`Dé ${face}`}
    >
      <svg viewBox="0 0 100 100" className="craps-die-svg">
        <rect x="6" y="6" width="88" height="88" rx="16" className="craps-die-face" />
        {PIP_MAP[face].map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="8.5" className="craps-die-pip" />
        ))}
      </svg>
    </motion.div>
  );
}

export function CrapsScreen() {
  const balance = useGame((s) => s.balance);
  const peakBalance = useGame((s) => s.peakBalance);
  const leaveCraps = useGame((s) => s.leaveCraps);
  const crapsDebit = useGame((s) => s.crapsDebit);
  const crapsCredit = useGame((s) => s.crapsCredit);
  const notice = useGame((s) => s.notice);
  const dismissNotice = useGame((s) => s.dismissNotice);

  const [chip, setChip] = useState(5_00);
  const [round, setRound] = useState<CrapsRound>(() => createCrapsRound());
  const [rolling, setRolling] = useState(false);
  const [flash, setFlash] = useState<'win' | 'lose' | 'push' | null>(null);
  const [selected, setSelected] = useState<BetKind>('pass');
  const [rulesOpen, setRulesOpen] = useState(false);

  useEffect(() => {
    if (chip > balance) setChip(Math.max(1_00, balance));
  }, [balance, chip]);

  useEffect(() => {
    if (round.phase === 'point' && selected === 'pass') setSelected('odds');
    if (round.phase === 'come_out' && selected === 'odds') setSelected('pass');
  }, [round.phase, selected]);

  const working =
    round.bets.pass + round.bets.dontPass + round.bets.field + round.bets.odds;
  const canRoll = working > 0 && !rolling;
  const oddsMax = oddsCap(round);

  const onPlace = (kind: BetKind) => {
    if (rolling) return;
    const amount = Math.min(chip, balance);
    if (amount < 1_00) return;
    if (kind === 'odds') {
      const room = oddsMax - round.bets.odds;
      if (room < 1_00) return;
      const stake = Math.min(amount, room);
      const result = placeBet(round, kind, stake);
      if (!result.ok) return;
      if (!crapsDebit(result.debitCents)) return;
      setRound(result.round);
      setSelected(kind);
      return;
    }
    const result = placeBet(round, kind, amount);
    if (!result.ok) return;
    if (!crapsDebit(result.debitCents)) return;
    setRound(result.round);
    setSelected(kind);
  };

  const onRoll = () => {
    if (!canRoll) return;
    setRolling(true);
    setFlash(null);
    window.setTimeout(() => {
      const res = rollAndResolve(round);
      if (!res.ok) {
        setRolling(false);
        return;
      }
      if (res.creditCents > 0) crapsCredit(res.creditCents);
      setRound(res.round);
      const kinds = res.round.settlements.map((s) => s.kind);
      if (kinds.some((k) => k.endsWith('_win') || k === 'point_made')) setFlash('win');
      else if (kinds.some((k) => k === 'dont_pass_push')) setFlash('push');
      else if (kinds.some((k) => k.endsWith('_lose') || k === 'seven_out')) setFlash('lose');
      setRolling(false);
    }, 520);
  };

  const d1 = round.lastRoll?.d1 ?? 1;
  const d2 = round.lastRoll?.d2 ?? 1;

  return (
    <div className="craps-screen grain">
      <header className="craps-topbar">
        <button type="button" className="icon-btn" onClick={leaveCraps} aria-label="Retour lobby">
          ←
        </button>
        <div className="craps-brand">
          <span className="mono">Salon des jeux · Scraps</span>
          <h1>Craps</h1>
        </div>
        <button
          type="button"
          className="icon-btn"
          onClick={() => setRulesOpen(true)}
          aria-label="Règles Craps"
        >
          ⓘ
        </button>
        <div className="craps-balance">
          <span className="label">Crédit</span>
          <span className="value">{fmt(balance)}</span>
          <span className="peak">Pic {fmt(peakBalance)}</span>
        </div>
      </header>

      <div className="craps-layout">
        <aside className="craps-panel">
          <div className="craps-panel-block">
            <label className="craps-label">Jeton</label>
            <div className="craps-presets">
              {BET_PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  className={`craps-chip ${chip === p ? 'on' : ''}`}
                  disabled={rolling || p > balance}
                  onClick={() => setChip(p)}
                >
                  {fmt(p)}
                </button>
              ))}
              <button
                type="button"
                className="craps-chip"
                disabled={rolling || balance < 1_00}
                onClick={() => setChip(Math.max(1_00, balance))}
              >
                Max
              </button>
            </div>
          </div>

          <div className="craps-stats">
            <div>
              <span className="k">Phase</span>
              <span className="v brass">
                {round.phase === 'come_out' ? 'Come-out' : `Point ${round.point}`}
              </span>
            </div>
            <div>
              <span className="k">En jeu</span>
              <span className="v">{fmt(working)}</span>
            </div>
            {round.phase === 'point' && (
              <div>
                <span className="k">Odds max</span>
                <span className="v">{fmt(oddsMax)}</span>
              </div>
            )}
            {round.lastRoll && (
              <div>
                <span className="k">Dernier total</span>
                <span className="v brass">{round.lastRoll.total}</span>
              </div>
            )}
          </div>

          <button
            type="button"
            className="btn primary craps-cta"
            disabled={!canRoll}
            onClick={onRoll}
          >
            {rolling ? 'Les dés roulent…' : 'Lancer les dés'}
          </button>

          <ul className="craps-settle">
            {round.settlements
              .filter((s) => s.kind !== 'point_set' && s.kind !== 'point_made' && s.kind !== 'seven_out')
              .map((s, i) => (
                <li key={`${s.kind}-${i}`}>{s.label}</li>
              ))}
          </ul>

          <p className="craps-footnote">
            Pass · Don’t Pass (bar 12) · Field · Odds 3-4-5× · jetons virtuels
          </p>
        </aside>

        <main className="craps-table-wrap">
          <AnimatePresence mode="wait">
            {(flash || round.message) && (
              <motion.p
                key={round.message + (flash ?? '')}
                className={`craps-banner ${flash ?? ''}`}
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
              >
                {round.message}
              </motion.p>
            )}
          </AnimatePresence>

          <div className={`craps-felt ${round.phase === 'point' ? 'point-on' : ''}`}>
            <div className="craps-puck-row">
              <div className={`craps-puck ${round.phase === 'point' ? 'on' : 'off'}`}>
                {round.phase === 'point' ? `ON ${round.point}` : 'OFF'}
              </div>
              <div className="craps-dice">
                <Die face={d1} rolling={rolling} />
                <Die face={d2} rolling={rolling} delay={0.08} />
              </div>
            </div>

            <div className="craps-spots">
              <button
                type="button"
                className={`craps-spot pass ${selected === 'pass' ? 'sel' : ''} ${!canPlacePass(round) ? 'locked' : ''}`}
                disabled={rolling || !canPlacePass(round)}
                onClick={() => onPlace('pass')}
              >
                <span className="spot-name">Pass Line</span>
                <span className="spot-pay">1 : 1</span>
                {round.bets.pass > 0 && <span className="spot-stake">{fmt(round.bets.pass)}</span>}
              </button>

              <button
                type="button"
                className={`craps-spot dont ${selected === 'dont_pass' ? 'sel' : ''} ${!canPlaceDontPass(round) ? 'locked' : ''}`}
                disabled={rolling || !canPlaceDontPass(round)}
                onClick={() => onPlace('dont_pass')}
              >
                <span className="spot-name">Don’t Pass</span>
                <span className="spot-pay">bar 12</span>
                {round.bets.dontPass > 0 && (
                  <span className="spot-stake">{fmt(round.bets.dontPass)}</span>
                )}
              </button>

              <button
                type="button"
                className={`craps-spot field ${selected === 'field' ? 'sel' : ''}`}
                disabled={rolling}
                onClick={() => onPlace('field')}
              >
                <span className="spot-name">Field</span>
                <span className="spot-pay">2×2 · 12×3</span>
                {round.bets.field > 0 && <span className="spot-stake">{fmt(round.bets.field)}</span>}
              </button>

              <button
                type="button"
                className={`craps-spot odds ${selected === 'odds' ? 'sel' : ''} ${!canPlaceOdds(round) ? 'locked' : ''}`}
                disabled={rolling || !canPlaceOdds(round)}
                onClick={() => onPlace('odds')}
              >
                <span className="spot-name">Odds</span>
                <span className="spot-pay">cotes vraies</span>
                {round.bets.odds > 0 && <span className="spot-stake">{fmt(round.bets.odds)}</span>}
              </button>
            </div>

            {round.history.length > 0 && (
              <div className="craps-history" aria-label="Historique des lancers">
                {round.history.map((h, i) => (
                  <span key={`${h.total}-${i}`} className={h.total === 7 ? 'sev' : ''}>
                    {h.total}
                  </span>
                ))}
              </div>
            )}
          </div>
        </main>
      </div>

      <AnimatePresence>
        {notice && (
          <motion.div
            className="notice"
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            onClick={dismissNotice}
          >
            {notice}
          </motion.div>
        )}
      </AnimatePresence>

      <RulesGuide game="craps" open={rulesOpen} onClose={() => setRulesOpen(false)} />
    </div>
  );
}
