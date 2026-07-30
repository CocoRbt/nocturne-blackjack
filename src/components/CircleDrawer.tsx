import { AnimatePresence, motion } from 'framer-motion';
import { CirclePanel } from './CirclePanel';

export function CircleDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose(): void;
}) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="drawer-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.aside
            className="drawer circle-drawer"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            role="dialog"
            aria-modal="true"
            aria-label="Cercle d'amis"
          >
            <header>
              <h2>Cercle d&rsquo;amis</h2>
              <button className="icon-btn" onClick={onClose} aria-label="Fermer">
                ✕
              </button>
            </header>
            <div className="content">
              <CirclePanel />
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
