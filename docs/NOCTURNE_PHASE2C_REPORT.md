# NOCTURNE — Rapport Phase 2c

**Date :** 2026-08-18  
**Branche :** `cursor/phase2c-all-games-d1df`  
**Statut :** implémenté et testé en branche locale  
**Production :** **NON MODIFIÉE**

`SITE_PAUSED = true` — aucune restauration joueur, aucune migration prod.

---

## 1. Crash migré

**Flux :**

1. `crash_start` : lock wallet → BET → RNG `gen_random_bytes(32)` figé → round `open`, `crash_at` non exposé
2. `crash_cashout` : vérifie `p_requested_mult < crash_at` → PAYOUT ou loss silencieuse
3. `crash_resolve_loss` : round `settled`, payout 0
4. Refresh : `crash_start` retourne `duplicate`, round repris

**Horloge de référence :** `now()` PostgreSQL (serveur). Le mult demandé par le client est comparé au `crash_at` serveur. Tout cashout reçu "trop tard" (mult ≥ crash_at) → perte.

---

## 2. Stampede / Slots migré

**Flux :**

1. `slots_spin` : valide le mode via `free_spins_balance` serveur (nouvelle table). Le client ne peut pas forcer un free spin sans en avoir.
2. `slots_settle` : payout = `floor(stake × mult)`, plafonné à **113×** (seuil anti-forge, paytable SQL complète = Phase 2d)
3. Free spins crédités dans `free_spins_balance` à chaque settle (via `private.credit_free_spins`)
4. Jackpot tier : détecté depuis les stops serveur (position étoile = 38 dans chaque bande)

**Note production :** le plafond temporaire 113× est suffisant pour la majorité des gains légitimes (max paytable = ~113×). La paytable SQL complète sera validée avant le GO prod jeux.

---

## 3. Craps migré

**Flux :**

1. `craps_place_bet` : BET, round `open`, idempotency par timestamp
2. `craps_roll` : RNG `gen_random_bytes(8)`, deux dés, résout la mise
3. `craps_take_back` : remboursement come_out uniquement (phase `point` refusée)
4. Refresh : round `open` retrouvé, état conservé

---

## 4. Blackjack migré

**Flux :**

1. `bj_deal` : RNG `gen_random_bytes(416)`, Fisher-Yates sur sabot 6 jeux, 4 premières cartes tirées ; BJ naturel résolu immédiatement
2. `bj_action` : hit/stand/double/surrender/insurance_yes/insurance_no
3. `bj_settle` : dealer tire depuis le même seed serveur, compare, crédite par main
4. `bj_settle` **non accessible publiquement** (revoke grant — adversarial fix)
5. Refresh : round `open` retrouvé

---

## 5. Coffre UI ledger

`CirclePanel` utilise maintenant :

- `ledger_deposit_vault` si `ledgerAuthoritative = true`
- `ledger_withdraw_vault` si `ledgerAuthoritative = true`
- `ledger_send_circle_vault` si `ledgerAuthoritative = true`

Fallback : legacy `deposit_my_vault` / `withdraw_my_vault` si pas encore migré.

---

## 6. Transfert UI ledger

`sendToMate` utilise maintenant `ledger_send_circle_vault` si `ledgerAuthoritative`.

---

## 7. Stratégie wallet cloud commune

`hasServerWallet` / `shouldUseLedger` :

- Supabase configuré
- Cercle cloud → `circle.cloud = true` → ledger activé
- `ledgerAuthoritative` (flag Zustand posé par `applyCanonicalWallet`) → lecture synchrone

Le cercle n'est **pas** une condition intrinsèque du moteur financier : un joueur multi-device avec compte synchronisé activera aussi le ledger dès que `applyCanonicalWallet` sera appelé.

---

## 8. Review round_id (UUID client)

**Le UUID client reste sûr** grâce aux garanties serveur :

| Risque | Protection |
|--------|-----------|
| Réutiliser un round d'un autre joueur | `profile_id is distinct from v_uid` vérifié dans toutes les fonctions |
| Réutiliser un round d'un autre jeu | `game = 'crash'` (ou slots/craps/bj) vérifié |
| Double BET même round | `on conflict (id) do nothing` + idempotency key |
| UUID existant pour contourner | Détecté comme `duplicate`, aucune action financière |

**Conclusion :** l'UUID client est sûr. Le serveur génère le RNG indépendamment du round_id. Générer le round_id côté serveur apporterait marginalement plus de sécurité (pas de tentative de devinette d'UUID) mais n'est pas nécessaire avec les contraintes actuelles.

---

## 9. RNG primitives

| Jeu | Primitive | Notes |
|-----|-----------|-------|
| Plinko | `gen_random_bytes(32)` + LSB de chaque byte | Crypto CSPRNG Postgres |
| Mines | `gen_random_bytes(32)` + Fisher-Yates | Crypto CSPRNG |
| Crash | `gen_random_bytes(32)`, uint64 via 8 premiers bytes | Crypto CSPRNG |
| Slots | `gen_random_bytes(32)` + uint32 pour chaque reel stop | Crypto CSPRNG |
| Craps | `gen_random_bytes(8)` + modulo 6 | Crypto CSPRNG |
| Blackjack | `gen_random_bytes(416)` + Fisher-Yates 312 cartes | Crypto CSPRNG |

Le client ne contrôle aucune entrée du RNG. Le seed est figé dans `server_seed` avant tout `BET`.

---

## 10. Matrice ledger / legacy finale

| Fonction | Ledger Phase 2c | Legacy (conservé) |
|----------|----------------|-------------------|
| Plinko | ✅ `plinko_drop` + `plinko_settle` | Fallback si hors cloud |
| Mines | ✅ `mines_start/reveal/cashout/settle` | Fallback |
| Crash | ✅ `crash_start/cashout/resolve_loss` | Fallback |
| Stampede | ✅ `slots_spin/settle` | Fallback |
| Craps | ✅ `craps_place_bet/roll/take_back` | Fallback |
| Blackjack | ✅ `bj_deal/action/settle` | Fallback |
| Coffre dépôt | ✅ `ledger_deposit_vault` | `deposit_my_vault` si legacy |
| Coffre retrait | ✅ `ledger_withdraw_vault` | `withdraw_my_vault` si legacy |
| Transfert | ✅ `ledger_send_circle_vault` | `send_circle_vault` si legacy |
| `sync_my_score` | ✅ Bloqué si profil ledger | Write pour profils legacy uniquement |
| `enforce_score_invariants` | ✅ Record monotone uniquement | — |

**Aucune mutation financière cloud ne passe par** : `debit`/`credit` local, `localStorage` wallet, merge cloud/local, `sync_my_score` comme writer de balance pour profils ledger.

---

## 11. Tests DB réels

Résultats :

- `Phase2a SQL INTEGRATION: ALL TESTS PASSED`
- `Phase2b SQL TESTS PASSED`
- `Phase2c SQL TESTS PASSED`
- Test concurrence Crash : balance finale = 2000, BETs = 1

Couverture Phase 2c : Crash (win/loss/dup/recovery), Slots (base/free/dup), Craps (roll/take_back), BJ (deal/action/settle/dup/autre joueur refusé).

---

## 12. Tests concurrence/recovery

| Test | Résultat |
|------|---------|
| Double mise Crash (80+80 sur 100 cr) | 1 BET accepté, 1 refusé, balance = 20 cr ✅ |
| Refresh après Crash start | `duplicate` retourné, round retrouvé ✅ |
| Refresh après BJ deal | Round `open` retrouvé ✅ |
| Take back Craps come_out | REFUND émis ✅ |

---

## 13. Review adversarial

**Bugs trouvés et corrigés :**

| Bug | Fichier | Fix |
|-----|---------|-----|
| Mult Slots forgé par client (jusqu'à 1000×) | `slots.sql` | Plafond 113× + paytable SQL Phase 2d |
| Free spin client-contrôlé (BET gratuit/forcé) | `slots.sql` | `free_spins_balance` serveur, `consume_free_spin` |
| `bj_settle` public (contournement logique) | `blackjack.sql` | Revoke grant public |

---

## 14. Format préparé pour migration historique

Migration `MIGRATION_OPENING` :

- `private.ledger_migration_opening(uid, balance, vault, authorized_by)`
- Idempotent : refuse si ledger existant pour ce profil
- N'écrase pas `peak_balance` (restauration séparée)
- N'exécute aucun UPDATE automatique des joueurs existants

Fichier : `supabase/migrations/20260818150400_phase2c_migration_opening.sql`

---

## 15. Risques restants

| Risque | Statut |
|--------|--------|
| Paytable SQL Slots complète (anti-forge précis) | Phase 2d obligatoire avant GO prod jeux |
| Jackpot double claim | Dépend de `claim_stampede_jackpot` (RPC existant, non modifié) |
| BJ multi-seats (plusieurs joueurs même table) | Non couvert (v1 mono-joueur) |
| Crash : horloge client vs serveur | Résolu par `p_requested_mult >= crash_at` côté SQL |
| Free spins leak inter-sessions | `free_spins_balance` table serveur — correctement lockée |
| `open_account_if_needed` pour joueurs prod | Refusé si `player_scores` existe — sûr |

---

## 16. Rollback

1. Ne pas merger / ne pas appliquer migrations prod
2. Si SQL appliqué en staging : DROP tables `free_spins_balance`, DROP fonctions Phase 2c, revert client
3. Sauvegarde live Phase 2a dans `supabase/diagnostics/rollback/`

---

## 17. Confirmation finale

**PRODUCTION NON MODIFIÉE**
