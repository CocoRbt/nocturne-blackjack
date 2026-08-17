import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import { MaintenanceScreen } from './components/MaintenanceScreen';
import { SITE_PAUSED } from './sitePaused';
import { useGame } from './store/gameStore';

// Exposé en dev pour les vérifications de bout en bout (Playwright).
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__game = useGame;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>{SITE_PAUSED ? <MaintenanceScreen /> : <App />}</StrictMode>,
);
