# NOCTURNE — Rapport Phase 2a Production

**Date :** 2026-08-18 UTC  
**Statut global :** **PHASE 2A PRODUCTION OK**

---

## Contexte

Déploiement **uniquement Phase 2a stop-loss** en production.  
**Hors scope** (non démarré) : ledger, `game_rounds`, restauration joueurs, réouverture salon.

---

## 1. SHA déployé

| Élément | Valeur |
|---------|--------|
| Commit mergé | `f9eea6727f1ebeeb70a6930a19b6a4756c5d2bc2` |
| PR | #59 (`cursor/phase2a-stop-loss-d1df` → `main`) |
| Vercel production | deploy `success` sur ce SHA (18/08/2026 ~06:38 UTC) |

---

## 2. Migration Supabase appliquée

| Élément | Valeur |
|---------|--------|
| Projet | `Nocturne_Blackjack` (`gyazoruuxxezuodkhwoz`) |
| Fichier repo | `supabase/migrations/20260818120000_phase2a_stop_loss.sql` |
| Enregistrée MCP | `phase2a_stop_loss` (version `20260818065056`) |
| Contenu | Remplacement de `enforce_score_invariants()`, `sync_my_score()`, `ensure_circle_membership()` + recréation trigger `trg_player_scores_invariants` |
| Confirmé | Aucun `UPDATE` de wallets joueurs, aucune restauration balance/vault/peak |

---

## 3. PHASE2A_VERIFY (post-migration)

Tous les checks **`failed = false`** :

| Check | Résultat |
|-------|----------|
| `sync_my_score` ne restaure plus mid-mise (games identique + balance ↓) | OK |
| `enforce_score_invariants` ne restaure plus OLD.balance / OLD.vault | OK |
| `ensure_circle_membership` ne recolle plus peak → balance millionnaire | OK |

**Triggers actifs sur `player_scores` :**

- `trg_player_scores_invariants` → `enforce_score_invariants()`
- `trg_player_scores_wealth_peak` → `enforce_wealth_peak()` (inchangé)

---

## 4. Vercel / client

| Élément | Valeur |
|---------|--------|
| URL | https://nocturne-blackjack.vercel.app |
| HTTP | 200 |
| Écran | « Salon fermé » (maintenance) |
| Bundle | Contient `gameSessionActive`, `financialSessionDepth` (code Phase 2a) |
| Jeux | Non accessibles (maintenance active) |

---

## 5. SITE_PAUSED

- **`src/sitePaused.ts` :** `SITE_PAUSED = true`
- **Salon :** **NON rouvert** — maintenance maintenue

---

## 6. Wallets — aucune modification

Empreinte **identique** avant / après migration :

| Métrique | Valeur |
|----------|--------|
| Joueurs (`n`) | 12 |
| `sum(balance)` | 1 308 297 614 |
| `sum(vault)` | 250 000 000 |
| `sum(peak_balance)` | 3 077 834 547 |
| `max(updated_at)` | 2026-08-17 22:47:31 UTC |

**Aucune restauration** effectuée (KikiLoki, Vincent, Selmex, Lea, Lea2, Lofty, ZaaariX, Aubin, I2S, coffres).

---

## 7. Sauvegarde rollback (pré-migration)

Dump **LIVE** capturé via `pg_get_functiondef` avant migration :

- `supabase/diagnostics/rollback/2026-08-18T0646Z_pre_phase2a_LIVE.sql`
- PR artefact : #60 (`cursor/phase2a-deploy-artifacts-d1df`)

**PITR :** indisponible (plan org Supabase = **free**). Rollback = réexécuter le dump live ci-dessus.

---

## 8. Prochaines étapes — NE PAS FAIRE sans GO

1. Ledger + `game_rounds`
2. Sécurisation jeux
3. Restauration wallets / coffres (phase dédiée)
4. `SITE_PAUSED = false` (réouverture salon)

---

## Confirmation finale

**PHASE 2A PRODUCTION OK**
