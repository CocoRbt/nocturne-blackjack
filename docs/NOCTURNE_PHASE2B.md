# NOCTURNE — Phase 2b Ledger + game_rounds

**Date :** 2026-08-18  
**Branche :** `cursor/phase2b-ledger-rounds-d1df`  
**Statut :** implémenté en branche / tests locaux — **PRODUCTION NON MODIFIÉE**

`SITE_PAUSED = true` (inchangé). Aucune restauration joueur. Aucun `ACCOUNT_OPENING` des comptes prod existants.

---

## 1. Schéma

### `wallet_ledger`

Vérité comptable **immuable** (trigger refuse UPDATE/DELETE).

| Colonne | Rôle |
|---------|------|
| `idempotency_key` | unique par `(profile_id, key)` |
| `op_type` | `ACCOUNT_OPENING` `BET` `PAYOUT` `REFUND` `VAULT_DEPOSIT` `VAULT_WITHDRAW` `TRANSFER` |
| `amount` / `vault_delta` | deltas signés |
| `balance_after` / `vault_after` | snapshot après coup |
| `round_id` / `transfer_id` | liens |

Helper unique : `private.apply_wallet_op` — `SELECT … FOR UPDATE` → insert ledger → **si conflit : aucun UPDATE scores** → sinon scores + peak (wealth) dans **la même transaction**.

### `game_rounds`

| Champ | Rôle |
|-------|------|
| `id` | round_id client (UUID) |
| `state` | `open` → `resolved` → `settled` (`void` prévu) |
| `server_seed` / `server_state` | RNG et état figés |
| `payout` | calculé serveur, jamais un montant client |

Pas de SELECT RLS : `mineSet` ne fuit pas. Lecture via RPCs sanitizées.

### `player_scores`

Cache matérialisé mis à jour **dans la même transaction** que le ledger. Pas de recalcul à l’affichage.

Audit : `audit_wallet_ledger()` → `SUM(amount/vault_delta) == balance/vault`.

---

## 2. Ordre des jeux

| Jeu | Phase 2b | Pourquoi |
|-----|----------|----------|
| **Plinko** | **migré** | Instantané, 1 BET + 1 settle, chemin = résultat |
| **Mines** | **migré** | Progressif simple (reveal / cashout) |
| Crash | legacy | Timing live |
| Stampede | legacy | Free spins + jackpot RPC |
| Craps | legacy | Multi-mises |
| Blackjack | legacy | Moteur le plus lourd |

Un jeu est **terminé** avant de passer au suivant.

---

## 3. Flux Plinko (référence)

1. Client : UUID `round_id` + mise  
2. `plinko_drop` : lock wallet, BET, RNG serveur, round `resolved`  
3. UI anime **uniquement** `path` serveur  
4. `plinko_settle` : PAYOUT si > 0 (idempotent `plinko:{id}:settle`)  
5. `applyCanonicalWallet` — pas de `sync_my_score` / `markScoreDirty`  
6. Refresh : `recover_my_rounds` auto-settle les Plinko `resolved`

---

## 4. Flux Mines

1. `mines_start` : BET, `mineSet` serveur, round `open` (le client **ne reçoit pas** les mines)  
2. `mines_reveal` : validé serveur ; mine → resolved payout 0 + settle ; grille complète → auto-cashout  
3. `mines_cashout` : payout = `floor(stake * mult)` serveur, settle unique  
4. Refresh : reprendre le round `open` ; `resolved` → settle

---

## 5. Idempotence

| Action | Clé |
|--------|-----|
| Ouverture | `opening:{profile_id}` |
| Plinko BET / settle | `plinko:{round_id}:bet` / `:settle` |
| Mines BET / settle | `mines:{round_id}:bet` / `:settle` |
| Coffre | `vault:deposit:{key}` / `vault:withdraw:{key}` |
| Transfert | `transfer:{transfer_id}` (une ligne par profil) |

Même clé → même `balance_after`, zéro 2ᵉ mouvement.

---

## 6. Coffre / transfert (SQL 2b, UI 2c)

RPCs **nouvelles** (n’écrasent pas `deposit_my_vault` / `send_circle_vault`) :

- `ledger_deposit_vault` — plancher **100 cr** serveur  
- `ledger_withdraw_vault`  
- `ledger_send_circle_vault` — locks ordonnés, même cercle, retry safe  

**CirclePanel reste sur les anciens RPC** jusqu’à Phase 2c (câblage UI).

---

## 7. ACCOUNT_OPENING

`open_account_if_needed()` → `+10000` une fois.  
**Refuse** si `player_scores` est déjà garni **sans** ledger (joueurs prod).  
**Ne pas appeler en production** tant que la migration des soldes n’a pas de GO.

---

## 8. Legacy vs ledger

| Chemin | Jeux |
|--------|------|
| Ledger + `applyCanonicalWallet` | Plinko, Mines **si** Supabase + cercle cloud |
| Debit/credit local + `sync_my_score` | Crash, Stampede, Craps, Blackjack, **et** Plinko/Mines hors cloud |

Heartbeat : `financialSessionDepth` bloque toujours le push mid-mise. Les settlements ledger font `clearScoreDirty`.

---

## 9. Fichiers

### Migrations (à n’appliquer qu’après GO prod)

- `supabase/migrations/20260818140000_phase2b_wallet_ledger.sql`
- `supabase/migrations/20260818140100_phase2b_game_rounds_plinko.sql`
- `supabase/migrations/20260818140200_phase2b_mines.sql`
- `supabase/migrations/20260818140300_phase2b_vault_transfer_ledger.sql`

### Client

- `src/cercle/ledgerApi.ts` `ledgerGames.ts`
- `src/store/gameStore.ts` (`applyCanonicalWallet`)
- `src/components/PlinkoScreen.tsx` `MinesScreen.tsx`

### Tests

- `scripts/run-phase2b-pg-test.sh`
- `supabase/diagnostics/phase2b_sql_integration_test.sql`

---

## 10. Migration des wallets existants (plus tard)

1. Snapshot lecture `player_scores`  
2. Pour chaque profil : **une** ligne ledger `MIGRATE_BALANCE` / politique dédiée (pas `ACCOUNT_OPENING`)  
3. Vérifier `audit_wallet_ledger` sans drift  
4. GO séparé — **pas dans cette phase**

---

## 11. Rollback

1. Ne pas merger / ne pas `apply_migration` prod  
2. Si SQL déjà appliqué (après un futur GO) : DROP RPCs + tables `game_rounds` / `wallet_ledger` **seulement si vides** ; client revert  
3. Dump fonctions live Phase 2a toujours dans `supabase/diagnostics/rollback/`

---

## 12. Confirmation

**PRODUCTION NON MODIFIÉE**
