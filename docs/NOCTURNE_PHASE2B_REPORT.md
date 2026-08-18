# NOCTURNE — Rapport Phase 2b: ledger + game_rounds

**Date :** 2026-08-18  
**Branche :** `cursor/phase2b-ledger-rounds-d1df`  
**Statut :** implémenté et testé en branche locale/staging uniquement  
**Production :** **NON MODIFIÉE**

`SITE_PAUSED = true` est inchangé.  
Aucune restauration joueur.  
Aucun reset wallet.  
Aucune réouverture du salon.

---

## 1. Objectif atteint

La Phase 2b introduit une première chaîne **serveur autoritaire** pour les opérations financières :

- `wallet_ledger` = vérité comptable historique, immuable, auditable ;
- `player_scores` = état courant matérialisé, mis à jour dans la **même transaction** ;
- `game_rounds` = état serveur des parties pour empêcher payout forgé / double payout / reroll ;
- migrations **complètes** pour **Plinko** et **Mines** ;
- intégration **préparée** pour coffre / transferts via ledger ;
- garde-fous ajoutés pour éviter que le legacy `sync_my_score` écrase un wallet déjà migré ledger.

---

## 2. Schéma final ledger / game_rounds

### `wallet_ledger`

Table immuable avec :

- `profile_id`
- `idempotency_key` unique par profil
- `op_type`
- `amount`
- `vault_delta`
- `balance_after`
- `vault_after`
- `game`
- `round_id`
- `transfer_id`
- `metadata`
- `created_at`

Types minimaux supportés :

- `ACCOUNT_OPENING`
- `BET`
- `PAYOUT`
- `REFUND`
- `VAULT_DEPOSIT`
- `VAULT_WITHDRAW`
- `TRANSFER`

### `game_rounds`

Champs principaux :

- `id`
- `profile_id`
- `game`
- `state`
- `stake`
- `payout`
- `server_seed`
- `server_state`
- `result`
- `created_at`
- `resolved_at`
- `settled_at`

États utilisés :

- `open`
- `resolved`
- `settled`
- `void` (prévu)

---

## 3. Fichiers modifiés / ajoutés

### Migrations

- `supabase/migrations/20260818140000_phase2b_wallet_ledger.sql`
- `supabase/migrations/20260818140100_phase2b_game_rounds_plinko.sql`
- `supabase/migrations/20260818140200_phase2b_mines.sql`
- `supabase/migrations/20260818140300_phase2b_vault_transfer_ledger.sql`
- `supabase/migrations/20260818140400_phase2b_hardening.sql`

### Diagnostics / scripts

- `supabase/diagnostics/phase2b_sql_integration_test.sql`
- `scripts/run-phase2b-pg-test.sh`

### Client

- `src/cercle/ledgerApi.ts`
- `src/cercle/ledgerGames.ts`
- `src/store/gameStore.ts`
- `src/cercle/circleLiveSync.ts`
- `src/components/PlinkoScreen.tsx`
- `src/components/MinesScreen.tsx`

### Tests unitaires

- `src/cercle/__tests__/ledgerGames.test.ts`
- `src/cercle/__tests__/walletFromLedger.test.ts`

### Docs

- `docs/NOCTURNE_PHASE2B.md`
- `docs/NOCTURNE_PHASE2B_REPORT.md`

---

## 4. Migrations préparées

### 4.1 `20260818140000_phase2b_wallet_ledger.sql`

Ajoute :

- table `wallet_ledger`
- trigger immutabilité
- helper atomique `private.apply_wallet_op`
- `open_account_if_needed()`
- `audit_wallet_ledger()`

### 4.2 `20260818140100_phase2b_game_rounds_plinko.sql`

Ajoute :

- table `game_rounds`
- paytable / payout Plinko côté SQL
- `plinko_drop`
- `plinko_settle`
- `get_my_open_rounds`
- `recover_my_rounds`

### 4.3 `20260818140200_phase2b_mines.sql`

Ajoute :

- math Mines côté SQL
- placement des mines côté serveur
- `mines_start`
- `mines_reveal`
- `mines_cashout`
- `mines_settle`

### 4.4 `20260818140300_phase2b_vault_transfer_ledger.sql`

Ajoute :

- `ledger_deposit_vault`
- `ledger_withdraw_vault`
- `ledger_send_circle_vault`

### 4.5 `20260818140400_phase2b_hardening.sql`

Corrige deux risques trouvés en review :

- **plus aucun push wallet legacy** si le profil a déjà du ledger ;
- **Mines** : unicité d’un round `open/resolved` par profil ;
- `open_account_if_needed()` refuse désormais tout profil déjà matérialisé dans `player_scores`, même à zéro.

---

## 5. Premier jeu migré complètement

## Plinko — migré complètement

Flux final :

1. client génère `round_id`
2. `plinko_drop` :
   - lock wallet
   - écrit `BET`
   - crée le round
   - fige RNG / `path`
   - calcule `payout` serveur
   - retourne wallet canonique + résultat d’animation
3. le client **anime seulement** le `path` serveur
4. `plinko_settle` :
   - écrit `PAYOUT` si > 0
   - settlement idempotent
   - round `settled`
5. Zustand reçoit le wallet canonique via `applyCanonicalWallet`

Le client ne choisit jamais le payout.

---

## 6. Deuxième jeu migré

## Mines — migré aussi

Flux final :

1. `mines_start` :
   - lock wallet
   - écrit `BET`
   - crée round `open`
   - serveur conserve `mineSet`
2. `mines_reveal` :
   - valide chaque case côté serveur
   - mine → loss + settle
   - dernier diamant → auto-cashout + settle
3. `mines_cashout` :
   - payout recalculé serveur
   - settlement unique
4. refresh :
   - round `open` repris
   - round `resolved` settled

Le `mineSet` n’est jamais renvoyé tant que le round n’est pas terminé.

---

## 7. Tests DB réels

Script exécuté :

- `bash scripts/run-phase2b-pg-test.sh`

Résultat :

- **OK**

Couverture intégration SQL :

- `ACCOUNT_OPENING` unique
- refus d’ouverture pour comptes existants / legacy
- Plinko :
  - BET
  - duplicate drop
  - duplicate settle
  - refresh / recover
- Mines :
  - start
  - reveal safe
  - cashout
  - bust
  - refus second round simultané
- coffre :
  - dépôt
  - retry safe
  - plancher 100 crédits
  - retrait
- transfert :
  - atomique
  - retry safe
- audit :
  - `SUM(ledger) == player_scores`

---

## 8. Résultats concurrence

Test obligatoire exécuté :

- solde initial = `10000`
- deux sessions tentent chacune une mise Plinko de `8000`

Résultat obtenu :

- **une seule mise acceptée**
- **l’autre refusée** avec `Solde insuffisant`
- `balance` finale = `2000`
- nombre de lignes `BET` = `1`

Donc :

- **transaction + lock OK**

---

## 9. Résultats refresh / recovery

### Plinko

- `plinko_drop` crée immédiatement un round `resolved`
- `recover_my_rounds()` settle les rounds `resolved`
- gain non perdu au refresh

### Mines

- `mines_start` garde le round `open`
- reconnexion : reprise du round
- `resolved` → `mines_settle`

---

## 10. Review adversarial

Une review indépendante a été lancée.

### Problèmes trouvés initialement

1. **heartbeat legacy vs ledger**  
   `sync_my_score` pouvait réécrire `player_scores` après un settlement ledger

2. **TOCTOU sur `mines_start`**  
   deux starts simultanés pouvaient théoriquement passer

3. **ACCOUNT_OPENING** sur profil legacy à zéro

### Statut

- les **3 points ont été corrigés**
- corrections intégrées dans `20260818140400_phase2b_hardening.sql`
- re-tests **OK**

---

## 11. Risques restants

Les éléments suivants restent volontairement hors scope ou partiels :

1. **Crash / Slots / Craps / Blackjack** restent sur l’ancien modèle
2. **CirclePanel coffre / transfert** n’utilise pas encore les nouveaux RPC ledger
3. pas encore de migration réelle des wallets prod existants vers ledger
4. pas encore de flux admin / restauration pour profils historiques
5. `sync_my_score` est neutralisé pour profils ledger, mais pas supprimé pour les jeux legacy

---

## 12. Plan migration utilisateurs existants

À faire dans une phase dédiée, séparée :

1. snapshot lecture des `player_scores`
2. règle métier de migration initiale validée
3. une écriture ledger dédiée de type migration initiale
4. audit `ledger == player_scores`
5. seulement ensuite activation ledger pour les profils historiques

**Important :**

- **ne pas** créer d’`ACCOUNT_OPENING` pour les comptes prod existants
- **ne pas** backfiller silencieusement

---

## 13. Rollback

Tant que rien n’est déployé :

1. ne pas merger / ne pas appliquer les migrations en prod
2. revert branche si besoin

Si un futur déploiement staging/prod était lancé :

1. rollback client vers commit précédent
2. rollback SQL uniquement si tables / données migrées sont sous contrôle
3. dump Phase 2a toujours disponible dans `supabase/diagnostics/rollback/`

---

## 14. Vérifications complémentaires

- `npm test` → **288 tests OK**
- `npx tsc -b --pretty false` → **OK**
- `SITE_PAUSED = true` → inchangé

---

## 15. Conclusion

### Confirmation finale

- **premier jeu migré complètement** : **Plinko**
- **deuxième jeu migré aussi** : **Mines**
- **tests DB réels** : **OK**
- **concurrence** : **OK**
- **refresh / recovery** : **OK**
- **review adversarial** : **faite et corrigée**

## **PRODUCTION NON MODIFIÉE**
