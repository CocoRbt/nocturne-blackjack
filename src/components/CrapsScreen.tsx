import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import {
  boardNumbers,
  canRoll,
  createCrapsRound,
  cryptoUnit,
  currentMult,
  placeBet,
  resolveRoll,
  rollDice,
  type CrapsRound,
  type DieFace,
} from '../craps/engine';
import { MULT_COME_OUT, MULT_POINT, POINT_ROLLS_BEFORE_PUSH } from '../craps/math';
import { notifyDefi } from '../defis/track';
import { fmt } from '../lib/format';
import { useGame } from '../store/gameStore';
import { GameShell } from './GameShell';
import { RulesGuide } from './RulesGuide';

const BET_PRESETS = [1_00, 5_00, 25_00, 100_00, 500_00] as const;
const THROW_MS = 1600;
const SETTLE_DELAY_MS = 280;

const PIP_MAP: Record<DieFace, Array<[number, number]>> = {
  1: [[50, 50]],
  2: [
    [28, 28],
    [72, 72],
  ],
  3: [
    [28, 28],
    [50, 50],
    [72, 72],
  ],
  4: [
    [28, 28],
    [72, 28],
    [28, 72],
    [72, 72],
  ],
  5: [
    [28, 28],
    [72, 28],
    [50, 50],
    [28, 72],
    [72, 72],
  ],
  6: [
    [28, 28],
    [72, 28],
    [28, 50],
    [72, 50],
    [28, 72],
    [72, 72],
  ],
};

function randFace(): DieFace {
  return (Math.floor(cryptoUnit() * 6) + 1) as DieFace;
}

function DieFaceSvg({ face }: { face: DieFace }) {
  return (
    <svg viewBox="0 0 100 100" className="craps-die-svg">
      <rect x="6" y="6" width="88" height="88" rx="16" className="craps-die-face" />
      {PIP_MAP[face].map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="8.5" className="craps-die-pip" />
      ))}
    </svg>
  );
}

function ThrowingDie({
  face,
  throwing,
  throwKey,
  side,
}: {
  face: DieFace;
  throwing: boolean;
  throwKey: number;
  side: 'left' | 'right';
}) {
  const xFrom = side === 'left' ? -120 : 120;
  const rotFrom = side === 'left' ? -420 : 480;

  return (
    <div className="craps-die-slot">
      <motion.div
        key={`shadow-${throwKey}-${throwing}`}
        className="craps-die-shadow"
        initial={throwing ? { opacity: 0, scale: 0.4, y: -40 } : false}
        animate={
          throwing
            ? {
                opacity: [0, 0.15, 0.45, 0.55],
                scale: [0.4, 0.7, 1.1, 1],
                y: [-40, -10, 8, 0],
              }
            : { opacity: 0.45, scale: 1, y: 0 }
        }
        transition={{ duration: THROW_MS / 1000, ease: [0.22, 1, 0.36, 1] }}
      />
      <motion.div
        key={`die-${throwKey}`}
        className={`craps-die ${throwing ? 'is-throwing' : ''}`}
        initial={
          throwing
            ? { x: xFrom, y: -160, rotate: rotFrom, scale: 0.7, opacity: 0.85 }
            : false
        }
        animate={
          throwing
            ? {
                x: [xFrom, xFrom * 0.2, 8, 0],
                y: [-160, -40, 18, 0],
                rotate: [rotFrom, rotFrom * 0.4, side === 'left' ? 24 : -28, 0],
                scale: [0.7, 1.12, 0.96, 1],
                opacity: 1,
              }
            : { x: 0, y: 0, rotate: 0, scale: 1, opacity: 1 }
        }
        transition={{ duration: THROW_MS / 1000, ease: [0.18, 0.85, 0.25, 1] }}
        aria-label={`Dé ${face}`}
      >
        <DieFaceSvg face={face} />
      </motion.div>
    </div>
  );
}

function coachCopy(round: CrapsRound): { step: string; title: string; body: string } {
  if (round.phase === 'point' && round.point != null) {
    const left = POINT_ROLLS_BEFORE_PUSH - round.pointRolls;
    return {
      step: `Cible · ×${MULT_POINT}`,
      title: `Il faut un ${round.point}`,
      body: `Refais un ${round.point} avant un 7 pour ×${MULT_POINT}. Encore ${left} jet${left > 1 ? 's' : ''} — sinon on te rend ta mise.`,
    };
  }
  if (round.bet <= 0) {
    return {
      step: `1 · Mise · ×${MULT_COME_OUT}`,
      title: 'Pose un jeton',
      body: `7 ou 11 = tu gagnes ×${MULT_COME_OUT}. 2, 3 ou 12 = tu perds. Autre chiffre = on fixe une cible (ensuite ×${MULT_POINT}).`,
    };
  }
  return {
    step: `2 · Lancer · ×${MULT_COME_OUT}`,
    title: 'Lance les dés',
    body: `Premier jet : 7 / 11 gagnent ×${MULT_COME_OUT}. Sinon une cible apparaît et ça passe à ×${MULT_POINT}.`,
  };
}

export function CrapsScreen() {
  const balance = useGame((s) => s.balance);
  const leaveCraps = useGame((s) => s.leaveCraps);
  const crapsDebit = useGame((s) => s.crapsDebit);
  const crapsCredit = useGame((s) => s.crapsCredit);
  const notice = useGame((s) => s.notice);
  const dismissNotice = useGame((s) => s.dismissNotice);

  const [round, setRound] = useState<CrapsRound>(() => createCrapsRound());
  const [chip, setChip] = useState(5_00);
  const [rolling, setRolling] = useState(false);
  const [faces, setFaces] = useState<[DieFace, DieFace]>([3, 4]);
  const [throwKey, setThrowKey] = useState(0);
  const [showTotal, setShowTotal] = useState(false);
  const [flash, setFlash] = useState<'win' | 'lose' | 'push' | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    return () => {
      for (const t of timers.current) window.clearTimeout(t);
    };
  }, []);

  useEffect(() => {
    const el = document.querySelector('.craps-screen');
    if (el instanceof HTMLElement) el.scrollTop = 0;
  }, []);

  const clearTimers = () => {
    for (const t of timers.current) window.clearTimeout(t);
    timers.current = [];
  };

  const busy = rolling || round.phase === 'point';
  const canBet = !rolling && round.phase === 'come_out';
  const rollReady = canRoll(round) && !rolling;
  const coach = coachCopy(round);
  const board = boardNumbers(round);
  const mult = currentMult(round);
  const total = faces[0] + faces[1];

  const onAddChip = () => {
    if (!canBet) return;
    const amount = Math.min(chip, balance);
    if (amount < 1_00) return;
    const result = placeBet(round, amount);
    if (!result.ok) return;
    if (!crapsDebit(result.debitCents)) return;
    setRound(result.round);
    setFlash(null);
  };

  const onRoll = () => {
    if (!rollReady) return;
    clearTimers();
    const final = rollDice(cryptoUnit);
    const snapshot = round;
    setRolling(true);
    setFlash(null);
    setShowTotal(false);
    setThrowKey((k) => k + 1);

    let tick = 0;
    const tumble = window.setInterval(() => {
      setFaces([randFace(), randFace()]);
      tick += 1;
      if (tick >= 14) window.clearInterval(tumble);
    }, 95);
    timers.current.push(tumble as unknown as number);

    timers.current.push(
      window.setTimeout(() => {
        window.clearInterval(tumble);
        setFaces([final.d1, final.d2]);
        setShowTotal(true);
        const res = resolveRoll(snapshot, final);
        if (!res.ok) {
          setRolling(false);
          return;
        }
        timers.current.push(
          window.setTimeout(() => {
            const kinds = res.round.settlements.map((s) => s.kind);
            const ended = kinds.some(
              (k) =>
                k === 'come_out_win' ||
                k === 'come_out_lose' ||
                k === 'point_win' ||
                k === 'point_lose' ||
                k === 'point_push',
            );
            if (ended) crapsCredit(res.creditCents, true);
            else if (res.creditCents > 0) crapsCredit(res.creditCents, false);

            setRound(res.round);
            if (kinds.some((k) => k === 'come_out_win' || k === 'point_win')) {
              notifyDefi({ type: 'craps_pass_win' });
              setFlash('win');
            } else if (kinds.some((k) => k === 'point_push' || k === 'point_set')) {
              setFlash(kinds.some((k) => k === 'point_push') ? 'push' : null);
            } else if (kinds.some((k) => k === 'come_out_lose' || k === 'point_lose')) {
              setFlash('lose');
            }
            setRolling(false);
          }, SETTLE_DELAY_MS),
        );
      }, THROW_MS),
    );
  };

  return (
    <div className="craps-screen grain">
      <GameShell
        accent="craps"
        title="Craps"
        eyebrow="Salon des jeux"
        onBack={() => {
          if (!busy || round.bet === 0) leaveCraps();
        }}
        backDisabled={busy && round.bet > 0}
        backTitle={busy && round.bet > 0 ? 'Finis la manche d’abord' : 'Retour Lobby'}
        onRules={() => setRulesOpen(true)}
        rulesLabel="Comment jouer"
      />

      <div className="craps-layout">
        <aside className="craps-panel">
          <div className="craps-coach" data-phase={round.phase}>
            <span className="craps-coach-step">{coach.step}</span>
            <strong>{coach.title}</strong>
            <p>{coach.body}</p>
          </div>

          <div className="craps-panel-block">
            <label className="craps-label">Combien tu mises</label>
            <div className="craps-presets">
              {BET_PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  className={`craps-chip ${chip === p ? 'on' : ''}`}
                  disabled={!canBet || p > balance}
                  onClick={() => setChip(p)}
                >
                  {fmt(p)}
                </button>
              ))}
              <button
                type="button"
                className="craps-chip"
                disabled={!canBet || balance < 1_00}
                onClick={() => setChip(Math.max(1_00, balance))}
              >
                Max
              </button>
            </div>
            <button
              type="button"
              className="btn ghost craps-add-bet"
              disabled={!canBet || Math.min(chip, balance) < 1_00}
              onClick={onAddChip}
            >
              Poser {fmt(Math.min(chip, balance))}
            </button>
          </div>

          <div className="craps-stats">
            <div>
              <span className="k">En jeu</span>
              <span className="v">{fmt(round.bet)}</span>
            </div>
            <div>
              <span className="k">Multi</span>
              <span className="v brass">×{mult}</span>
            </div>
            {round.phase === 'point' && (
              <div>
                <span className="k">Jets restants</span>
                <span className="v">
                  {POINT_ROLLS_BEFORE_PUSH - round.pointRolls}/{POINT_ROLLS_BEFORE_PUSH}
                </span>
              </div>
            )}
            {round.lastRoll && !rolling && (
              <div>
                <span className="k">Dernier jet</span>
                <span className="v brass">
                  {round.lastRoll.d1}+{round.lastRoll.d2} = {round.lastRoll.total}
                </span>
              </div>
            )}
          </div>

          <button
            type="button"
            className={`btn primary craps-cta ${rollReady ? 'pulse' : ''}`}
            disabled={!rollReady}
            onClick={onRoll}
          >
            {rolling ? 'Les dés volent…' : round.bet === 0 ? 'Pose une mise…' : `Lancer · ×${mult}`}
          </button>

          <ul className="craps-settle">
            {round.settlements
              .filter((s) => s.kind !== 'point_continue')
              .map((s, i) => (
                <li
                  key={`${s.kind}-${i}`}
                  className={
                    s.kind.includes('win') ? 'ok' : s.kind.includes('lose') ? 'bad' : ''
                  }
                >
                  {s.label}
                </li>
              ))}
          </ul>

          <p className="craps-footnote">
            Une seule mise · ×{MULT_COME_OUT} puis ×{MULT_POINT} · remboursé après{' '}
            {POINT_ROLLS_BEFORE_PUSH} jets sans résultat
          </p>
        </aside>

        <main className="craps-table-wrap">
          <AnimatePresence mode="wait">
            {(flash || round.message) && !rolling && (
              <motion.p
                key={round.message + (flash ?? '')}
                className={`craps-banner ${flash ?? ''}`}
                initial={{ opacity: 0, y: -14, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0 }}
              >
                {round.message}
              </motion.p>
            )}
          </AnimatePresence>

          <div
            className={`craps-felt ${round.phase === 'point' ? 'point-on' : ''} ${rolling ? 'is-rolling' : ''}`}
          >
            <div className="craps-puck-row">
              <div className={`craps-puck ${round.phase === 'point' ? 'on' : 'off'}`}>
                <span className="puck-label">{round.phase === 'point' ? 'Cible' : 'Libre'}</span>
                <span className="puck-value">
                  {round.phase === 'point' ? round.point : '—'}
                </span>
              </div>

              <div className="craps-throw">
                <div className="craps-dice">
                  <ThrowingDie face={faces[0]} throwing={rolling} throwKey={throwKey} side="left" />
                  <ThrowingDie face={faces[1]} throwing={rolling} throwKey={throwKey} side="right" />
                </div>
                <AnimatePresence>
                  {showTotal && (
                    <motion.div
                      key={`total-${throwKey}`}
                      className="craps-total"
                      initial={{ opacity: 0, scale: 0.6, y: 12 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ type: 'spring', stiffness: 320, damping: 18 }}
                    >
                      <span className="craps-total-k">Total</span>
                      <strong>{total}</strong>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <div className="craps-mult-badge" aria-label={`Multiplicateur ×${mult}`}>
                <span className="craps-mult-k">Paie</span>
                <strong>×{mult}</strong>
              </div>
            </div>

            <p className="craps-board-hint">{board.hint}</p>

            <div className="craps-board-nums" aria-live="polite">
              <div className="craps-num-col win">
                <span className="craps-num-label">Gagne</span>
                <div className="craps-num-row">
                  {board.wins.map((n) => (
                    <span key={n} className="craps-num">
                      {n}
                    </span>
                  ))}
                </div>
              </div>
              <div className="craps-num-col lose">
                <span className="craps-num-label">Perd</span>
                <div className="craps-num-row">
                  {board.loses.map((n) => (
                    <span key={n} className="craps-num">
                      {n}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {round.phase === 'point' && round.point != null && (
              <div className="craps-goal" aria-live="polite">
                Jet {round.pointRolls}/{POINT_ROLLS_BEFORE_PUSH} ·{' '}
                <strong>{round.point}</strong> avant <strong className="sev">7</strong>
              </div>
            )}
          </div>

          {round.history.length > 0 && (
            <div className="craps-history" aria-label="Historique des lancers">
              {round.history.map((h, i) => (
                <span
                  key={`${h.total}-${i}`}
                  className={`craps-pill ${h.total === 7 ? 'sev' : h.total === round.point ? 'pt' : ''}`}
                  title={`${h.d1}+${h.d2}`}
                >
                  {h.total}
                </span>
              ))}
            </div>
          )}
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
