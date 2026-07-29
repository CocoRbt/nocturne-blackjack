import { AnimatePresence, motion } from 'framer-motion';
import { useGame } from '../store/gameStore';
import { TIMING } from '../store/timing';
import { Chip } from './ChipView';

/** Vol / disparition des jetons avant crédit du solde. */
export function PayoutFly() {
  const flies = useGame((s) => s.display.payoutFlies);
  const phase = useGame((s) => s.display.payoutPhase);
  const speed = useGame((s) => s.gameSpeed);
  const duration = TIMING[speed].payoutFly / 1000;

  if (phase !== 'flying' || flies.length === 0) return null;

  return (
    <div className="payout-fly-layer" aria-hidden>
      <AnimatePresence>
        {flies.map((f, i) => (
          <motion.div
            key={f.id}
            className={`payout-fly ${f.won ? 'won' : f.push ? 'push' : 'lost'}`}
            style={{ left: `${42 + (i % 5) * 4}%`, top: `${58 + Math.floor(i / 5) * 4}%` }}
            initial={{ opacity: 1, y: 0, scale: 1 }}
            animate={
              f.push
                ? { opacity: [1, 1, 0.85], scale: [1, 1.08, 1] }
                : f.won
                  ? { opacity: 0, y: -120, x: 80, scale: 0.55 }
                  : { opacity: 0, y: 90, scale: 0.4 }
            }
            transition={{ duration, ease: [0.22, 1, 0.36, 1], delay: i * 0.04 }}
          >
            <Chip denom={Math.max(1_00, Math.min(500_00, f.amount))} />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
