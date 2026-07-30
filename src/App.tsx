import { CrapsScreen } from './components/CrapsScreen';
import { Lobby } from './components/Lobby';
import { MinesScreen } from './components/MinesScreen';
import { TableScreen } from './components/TableScreen';
import { useGame } from './store/gameStore';

export default function App() {
  const screen = useGame((s) => s.screen);
  if (screen === 'lobby') return <Lobby />;
  if (screen === 'mines') return <MinesScreen />;
  if (screen === 'craps') return <CrapsScreen />;
  return <TableScreen />;
}
