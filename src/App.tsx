import { Lobby } from './components/Lobby';
import { TableScreen } from './components/TableScreen';
import { useGame } from './store/gameStore';

export default function App() {
  const screen = useGame((s) => s.screen);
  return screen === 'lobby' ? <Lobby /> : <TableScreen />;
}
