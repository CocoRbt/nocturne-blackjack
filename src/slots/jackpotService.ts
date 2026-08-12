import {
  claimStampedeJackpot,
  contributeStampedeJackpot,
  fetchCircleJackpots,
  isSupabaseConfigured,
} from '../cercle/circleApi'
import { loadCircle, pushScore } from '../cercle/circleStore'
import { useGame } from '../store/gameStore'
import {
  emptyJackpots,
  jackpotLabel,
  loadLocalJackpots,
  localClaim,
  localContribute,
  type CircleJackpotState,
  type JackpotHitRecord,
  type JackpotTier,
} from './jackpot'

export type JackpotView = CircleJackpotState & {
  hits: JackpotHitRecord[]
  cloud: boolean
}

function scoreSeed() {
  const g = useGame.getState()
  return {
    balance: g.balance,
    peakBalance: g.peakBalance,
    vault: g.vault,
    handsPlayed: g.stats.handsPlayed,
    blackjacks: g.stats.blackjacks,
    bestStreak: g.stats.longestWinStreak,
    highestTable: g.tableId,
    gamesBeforePeak: g.gamesBeforePeak,
    gamesPlayed: g.gamesPlayed,
  }
}

export function readJackpotView(): JackpotView {
  const pots = loadLocalJackpots()
  return { ...pots, hits: [], cloud: false }
}

export async function refreshJackpotView(): Promise<JackpotView> {
  const circle = loadCircle()
  if (circle?.cloud && isSupabaseConfigured()) {
    try {
      const data = await fetchCircleJackpots()
      if (data.ok && data.in_circle) {
        return {
          miniCents: Math.floor(data.mini ?? 0),
          majorCents: Math.floor(data.major ?? 0),
          grandCents: Math.floor(data.grand ?? 0),
          cloud: true,
          hits: (data.hits ?? []).map((h, i) => ({
            id: `${h.created_at}-${i}`,
            tier: h.tier,
            amountCents: h.amount,
            playerName: h.nickname,
            createdAt: h.created_at,
          })),
        }
      }
    } catch {
      /* fallback local */
    }
  }
  return { ...loadLocalJackpots(), hits: [], cloud: false }
}

/** Alimente les pots (1 %) — cloud si possible, sinon local. */
export async function contributeJackpot(betCents: number): Promise<JackpotView> {
  const circle = loadCircle()
  if (circle?.cloud && isSupabaseConfigured()) {
    try {
      const res = await contributeStampedeJackpot(betCents)
      return {
        miniCents: res.mini,
        majorCents: res.major,
        grandCents: res.grand,
        cloud: true,
        hits: [],
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : ''
      if (!/contribute_stampede_jackpot|Could not find the function|schema cache/i.test(msg)) {
        // Autre erreur (hors cercle…) → local
      }
    }
  }
  const pots = localContribute(betCents)
  return { ...pots, hits: [], cloud: false }
}

/**
 * Claim atomique. Crédite le solde local une seule fois.
 * Cloud : push score → claim RPC → applique balance serveur.
 * Local / fallback : localClaim + slotsCredit.
 */
export async function claimJackpot(
  tier: JackpotTier,
  betCents: number,
): Promise<{ amountCents: number; pots: CircleJackpotState; label: string }> {
  const label = jackpotLabel(tier)
  const circle = loadCircle()
  if (circle?.cloud && isSupabaseConfigured()) {
    try {
      await pushScore(circle, scoreSeed())
      const res = await claimStampedeJackpot(tier, betCents)
      const g = useGame.getState()
      g.applyVaultServerState(
        {
          balance: res.balance,
          vault: g.vault,
          peakBalance: res.peak_balance,
        },
        `Jackpot ${label} · +${Math.floor(res.amount / 100)} crédits`,
      )
      return {
        amountCents: res.amount,
        pots: {
          miniCents: res.mini,
          majorCents: res.major,
          grandCents: res.grand,
        },
        label,
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : ''
      if (!/claim_stampede_jackpot|Could not find the function|schema cache|Rejoins un cercle/i.test(msg)) {
        // continue fallback
      }
    }
  }

  const local = localClaim(tier)
  useGame.getState().slotsCredit(local.amountCents, false)
  return { amountCents: local.amountCents, pots: local.pots, label }
}

export function formatJackpotSeedHint(): string {
  const e = emptyJackpots()
  return `${e.miniCents / 100} / ${e.majorCents / 100} / ${e.grandCents / 100}`
}
