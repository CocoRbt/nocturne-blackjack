import { useGame } from '../store/gameStore'
import { trackDefiEvent, type DefiEvent } from './store'

function live() {
  const s = useGame.getState()
  return {
    handsPlayed: s.stats.handsPlayed,
    wins: s.stats.wins,
    blackjacks: s.stats.blackjacks,
    balance: s.balance,
  }
}

export function notifyDefi(event: DefiEvent) {
  trackDefiEvent(event, live())
  window.dispatchEvent(new Event('nocturne-defis'))
}
