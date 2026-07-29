import { motion } from 'framer-motion';

const LABELS: Record<number, string> = {
  1_00: '1',
  5_00: '5',
  25_00: '25',
  100_00: '100',
  500_00: '500',
  1000_00: '1K',
};

export function Chip({ denom }: { denom: number }) {
  return (
    <div className="chip" data-d={denom}>
      {LABELS[denom] ?? denom / 100}
    </div>
  );
}

/** Pile de jetons empilés visuellement (les derniers posés au sommet). */
export function ChipStack({ chips, mini = false }: { chips: number[]; mini?: boolean }) {
  if (chips.length === 0) return null;
  const visible = chips.slice(-14); // évite les piles infinies
  const clipped = chips.length - visible.length;
  return (
    <div className={`chip-stack ${mini ? 'mini' : ''}`}>
      {visible.map((d, i) => (
        <motion.div
          key={`${i + clipped}-${d}`}
          initial={{ y: -26, opacity: 0, scale: 1.1 }}
          animate={{ y: -(i + clipped) * 3.4, opacity: 1, scale: 1 }}
          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
          style={{ position: 'absolute', zIndex: i }}
        >
          <Chip denom={d} />
        </motion.div>
      ))}
    </div>
  );
}
