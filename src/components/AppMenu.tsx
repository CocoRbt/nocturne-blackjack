import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { requestCircleSection } from '../cercle/circleNav';
import { exitCircle } from '../cercle/circleStore';
import { useGame } from '../store/gameStore';
import { CircleDrawer } from './CircleDrawer';
import { circleJoinedLabel } from './CirclePanel';

type AppMenuProps = {
  /** Afficher les raccourcis vers les salons (lobby uniquement). */
  showSalonLinks?: boolean;
};

/**
 * Menu hamburger fixe (haut droite) — présent sur toutes les pages.
 * Ouvre le cercle d’amis (+ raccourcis salons sur le lobby).
 */
export function AppMenu({ showSalonLinks = false }: AppMenuProps) {
  const enterMines = useGame((s) => s.enterMines);
  const enterCraps = useGame((s) => s.enterCraps);
  const enterCrash = useGame((s) => s.enterCrash);
  const [menuOpen, setMenuOpen] = useState(false);
  const [circleOpen, setCircleOpen] = useState(false);
  const [joinedAs, setJoinedAs] = useState(() => circleJoinedLabel());

  useEffect(() => {
    if (!circleOpen && !menuOpen) setJoinedAs(circleJoinedLabel());
  }, [circleOpen, menuOpen]);

  useEffect(() => {
    const openCircle = () => setCircleOpen(true);
    window.addEventListener('nocturne-open-circle', openCircle);
    return () => window.removeEventListener('nocturne-open-circle', openCircle);
  }, []);

  return (
    <>
      <div className="lobby-menu app-menu">
        <button
          type="button"
          className={`lobby-menu-btn ${joinedAs ? 'has-circle' : ''}`}
          aria-label="Menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
        >
          <span className="lobby-menu-icon" aria-hidden>
            <span />
            <span />
            <span />
          </span>
          <span className="lobby-menu-text">Menu</span>
        </button>
        <AnimatePresence>
          {menuOpen && (
            <motion.div
              className="lobby-menu-panel"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.22 }}
            >
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  requestCircleSection('cercle');
                  setCircleOpen(true);
                }}
              >
                Cercle d&rsquo;amis
                {joinedAs ? <span className="dim">{joinedAs}</span> : null}
              </button>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  requestCircleSection('compte');
                  setCircleOpen(true);
                }}
              >
                Compte
                <span className="dim">sync PC · téléphone</span>
              </button>
              {showSalonLinks && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      enterMines();
                    }}
                  >
                    Mines
                    <span className="dim">diamants · bombes</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      enterCraps();
                    }}
                  >
                    Craps
                    <span className="dim">Scraps · dés</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      enterCrash();
                    }}
                  >
                    Crash
                    <span className="dim">avion · multiplicateur</span>
                  </button>
                </>
              )}
              {joinedAs && (
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    void exitCircle().finally(() => setJoinedAs(null));
                  }}
                >
                  Quitter le cercle
                  <span className="dim">garde votre crédit local</span>
                </button>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <CircleDrawer open={circleOpen} onClose={() => setCircleOpen(false)} />
    </>
  );
}
