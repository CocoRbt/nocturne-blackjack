import { Suspense, lazy } from 'react';
import { Lobby } from './components/Lobby';
import { useGame } from './store/gameStore';

const TableScreen = lazy(() =>
  import('./components/TableScreen').then((m) => ({ default: m.TableScreen })),
);
const MinesScreen = lazy(() =>
  import('./components/MinesScreen').then((m) => ({ default: m.MinesScreen })),
);
const CrapsScreen = lazy(() =>
  import('./components/CrapsScreen').then((m) => ({ default: m.CrapsScreen })),
);
const CrashScreen = lazy(() =>
  import('./components/CrashScreen').then((m) => ({ default: m.CrashScreen })),
);
const PlinkoScreen = lazy(() =>
  import('./components/PlinkoScreen').then((m) => ({ default: m.PlinkoScreen })),
);

function ScreenFallback() {
  return (
    <div className="screen-fallback grain" role="status">
      Ouverture du salon…
    </div>
  );
}

export default function App() {
  const screen = useGame((s) => s.screen);
  if (screen === 'lobby') return <Lobby />;
  return (
    <Suspense fallback={<ScreenFallback />}>
      {screen === 'mines' ? (
        <MinesScreen />
      ) : screen === 'craps' ? (
        <CrapsScreen />
      ) : screen === 'crash' ? (
        <CrashScreen />
      ) : screen === 'plinko' ? (
        <PlinkoScreen />
      ) : (
        <TableScreen />
      )}
    </Suspense>
  );
}
