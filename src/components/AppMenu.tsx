import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { requestCircleSection } from '../cercle/circleNav';
import { useGame } from '../store/gameStore';
import { CircleDrawer } from './CircleDrawer';
import { circleJoinedLabel } from './CirclePanel';

type AppMenuProps = {
  /**
   * Mode compact (icône seule) — salons / table, évite la superposition
   * avec crédit / topbar.
   */
  compact?: boolean;
  /** Bloque la navigation (ex. Crash en vol). */
  navLocked?: boolean;
  navLockedReason?: string;
};

type SalonTarget = 'lobby' | 'mines' | 'craps' | 'crash' | 'plinko';

/**
 * Menu hamburger fixe (haut droite) — toutes les pages.
 * Navigation Lobby / salons + cercle + compte.
 */
export function AppMenu({
  compact = false,
  navLocked = false,
  navLockedReason,
}: AppMenuProps) {
  const screen = useGame((s) => s.screen);
  const enterMines = useGame((s) => s.enterMines);
  const enterCraps = useGame((s) => s.enterCraps);
  const enterCrash = useGame((s) => s.enterCrash);
  const enterPlinko = useGame((s) => s.enterPlinko);
  const leaveTable = useGame((s) => s.leaveTable);
  const leaveMines = useGame((s) => s.leaveMines);
  const leaveCraps = useGame((s) => s.leaveCraps);
  const leaveCrash = useGame((s) => s.leaveCrash);
  const leavePlinko = useGame((s) => s.leavePlinko);

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

  const goTo = (target: SalonTarget) => {
    if (navLocked) return;
    setMenuOpen(false);
    if (target === 'lobby') {
      if (screen === 'lobby') return;
      if (screen === 'mines') leaveMines();
      else if (screen === 'craps') leaveCraps();
      else if (screen === 'crash') leaveCrash();
      else if (screen === 'plinko') leavePlinko();
      else leaveTable();
      return;
    }
    if (target === 'mines') {
      if (screen === 'mines') return;
      enterMines();
      return;
    }
    if (target === 'craps') {
      if (screen === 'craps') return;
      enterCraps();
      return;
    }
    if (target === 'crash') {
      if (screen === 'crash') return;
      enterCrash();
      return;
    }
    if (target === 'plinko') {
      if (screen === 'plinko') return;
      enterPlinko();
    }
  };

  return (
    <>
      <div className={`lobby-menu app-menu ${compact ? 'is-compact' : ''}`}>
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
          {!compact && <span className="lobby-menu-text">Menu</span>}
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
              {navLocked && (
                <p className="lobby-menu-locked">{navLockedReason ?? 'Navigation indisponible'}</p>
              )}

              <button
                type="button"
                disabled={navLocked}
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
                disabled={navLocked}
                onClick={() => {
                  setMenuOpen(false);
                  requestCircleSection('compte');
                  setCircleOpen(true);
                }}
              >
                Compte
                <span className="dim">sync PC · téléphone</span>
              </button>

              <div className="lobby-menu-sep" aria-hidden />

              {screen !== 'lobby' && (
                <button type="button" disabled={navLocked} onClick={() => goTo('lobby')}>
                  Lobby
                  <span className="dim">accueil</span>
                </button>
              )}
              {screen !== 'mines' && (
                <button type="button" disabled={navLocked} onClick={() => goTo('mines')}>
                  Mines
                  <span className="dim">diamants · bombes</span>
                </button>
              )}
              {screen !== 'craps' && (
                <button type="button" disabled={navLocked} onClick={() => goTo('craps')}>
                  Craps
                  <span className="dim">Dés · cibles</span>
                </button>
              )}
              {screen !== 'crash' && (
                <button type="button" disabled={navLocked} onClick={() => goTo('crash')}>
                  Crash
                  <span className="dim">avion · multiplicateur</span>
                </button>
              )}
              {screen !== 'plinko' && (
                <button type="button" disabled={navLocked} onClick={() => goTo('plinko')}>
                  Plinko
                  <span className="dim">bille · pyramide</span>
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
