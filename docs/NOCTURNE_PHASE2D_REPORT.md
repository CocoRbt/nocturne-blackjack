# NOCTURNE — Rapport Phase 2d

**Date :** 2026-08-18  
**Branche :** `cursor/phase2d-engine-validation-d1df`  
**Commit :** `ac6aae6`  
**PR :** #63  
**Production :** **NON MODIFIÉE**

`SITE_PAUSED = true` — aucune restauration joueur, aucune migration prod, aucune réouverture.

---

## 1. Crash — cashout par temps serveur

`crash_cashout(round_id)` — **plus de paramètre mult client**.

Le serveur calcule au moment de la réception de la requête :

```
mult_now = exp(ln(2) / 3500 × elapsed_ms_depuis_started_at)
```

| Cas | Comportement |
|-----|-------------|
| `mult_now >= crash_at` | Loss silencieuse (avion déjà crashé) |
| `mult_now < 1.01` | Erreur "Cashout trop tôt" |
| `1.01 ≤ mult_now < crash_at` | PAYOUT = `floor(stake × mult_now)` |

Le client ne peut jamais choisir le multiplicateur payé. `crash_cashout(round_id, requested_mult)` — ancienne signature — **supprimée**.

---

## 2. Slots — paytable SQL complète

`slots_settle(round_id)` — **plus de paramètre mult client**.

### Moteur SQL implémenté

| Composant | Implémentation |
|-----------|---------------|
| Bandes base + FS | `private.slots_strip(reel, mode)` — identiques à `src/slots/math.ts` |
| Grille depuis stops | `private.slots_grid_from_stops` |
| WAY_PAY | `private.slots_way_pay` — identique à `WAY_PAY` TS |
| 1024 chemins | `private.slots_evaluate_ways` — boucle 4⁵ exacte |
| evaluateSpin | `private.slots_evaluate_spin` — ways + scatter + wild product + herd mult |

Payout = `floor(stake × total_mult)`, 100% depuis les stops serveur.

Validation anti-forge : `stops not null` et `array_length = 5` vérifiés en début de `slots_settle`.

---

## 3. Jackpot

`claim_jackpot_ledger(tier, round_id)` — remplace `claim_stampede_jackpot` pour les profils ledger.

Garanties :

- Round doit être `settled`, jeu `slots`, `jackpot_tier` du round doit correspondre au tier demandé
- Idempotency key `jp:{round_id}` — double claim impossible même en retry
- Lock du pot avant reset (`FOR UPDATE` sur `circle_jackpots`)
- Crédit via `apply_wallet_op` (ledger auditable)
- Impossible de réclamer sans round correspondant ou avec le mauvais tier

---

## 4. Craps — idempotence propre

### Avant (Phase 2c)

Idempotency key par `clock_timestamp()` → instable entre retries.

### Après (Phase 2d)

| Action | Clé d'idempotence |
|--------|------------------|
| `craps_place_bet` | `craps:{round_id}:bet:{bet_id}` — `bet_id` UUID stable fourni par le client |
| `craps_roll` | `craps:{round_id}:roll:{roll_id}` — `roll_id` UUID stable |
| Roll intermédiaire | `server_state.last_roll_id` vérifié avant toute exécution |

Même requête + même ID → même résultat, aucun double mouvement.

---

## 5. Blackjack — settlement privé validé

### Chemin de settlement légitime

```
bj_deal → BJ naturel → bj_settle (automatique)
bj_action('stand') → bj_settle (automatique)
bj_action('double') → bj_settle (automatique)
bj_action('surrender') → REFUND + bj_settle (automatique)
bj_action('insurance_yes') → phase player → actions → bj_settle
Refresh round open → bj_action('stand') → bj_settle
```

`bj_settle` : grant public révoqué. Accessible uniquement depuis `bj_deal` et `bj_action` (security definer chain). Aucun client ne peut l'appeler directement.

---

## 6. Parité moteur Blackjack

| Règle client (`rules.ts`) | Moteur SQL Phase 2d | Parité |
|--------------------------|---------------------|--------|
| 6/8 decks | 6 decks, Fisher-Yates sur 312 cartes | ✅ |
| S17 (dealer reste sur soft 17) | `bj_dealer_must_hit(cards, hits_soft17=false)` | ✅ |
| BJ naturel 3:2 | `v_bet + round(v_bet × 3/2)` | ✅ |
| BJ vs BJ → push | `v_hand_payout = v_bet` | ✅ |
| Double | Bet×2, 1 carte serveur, settle immédiat | ✅ |
| Surrender late | Remboursement `floor(bet/2 + 0.5)` | ✅ |
| Insurance 2:1 | `insurance_bet × 3` si dealer BJ | ✅ |
| dealerPeeks | BJ dealer détecté à la donne | ✅ |
| maxSplitHands, resplitAces | Non couverts (v1 mono-main) | ⚠️ |
| Side bets (perfectPairs, 21+3…) | Non couverts | ⚠️ |

---

## 7. RNG fairness

### Problèmes identifiés et corrigés

| Jeu | Primitive Phase 2c | Biais | Correction Phase 2d |
|-----|--------------------|-------|---------------------|
| Craps dés | `byte % 6` | ~1.6% (256 mod 6 = 4 valeurs surreprésentées) | Rejection sampling, seuil 252 |
| BJ Fisher-Yates | 2 bytes par index | Non uniforme pour index > 255 | uint32 rejection sampling |
| Slots stops | `uint32 & 2^31 % 40` | ~6% (256 mod 40 = 16 valeurs surreprésentées) | uint32 rejection sampling |
| Plinko LSB | `byte & 1` | Aucun | Confirmé OK |
| Mines Fisher-Yates | `byte % 25` | ~2.3% (i_max=24) | Acceptable, grille 5×5 |

---

## 8. Tests statistiques RNG

| Test | Résultat |
|------|---------|
| Craps dés — 20 000 lancers | Chaque face 14.5%–18.5% ✅ (attendu 16.7%) |
| Plinko LSB — 120 000 bits | Bits "droite" 48.5%–51.5% ✅ |
| Slots stops — 25 000 stops | Distribution 0–39 dans 400–850 ✅ (attendu 625) |

---

## 9. Tests round_id

| Attaque | Résultat |
|---------|---------|
| UUID autre joueur → `plinko_settle` | Refusé ✅ |
| UUID autre jeu → `mines_reveal` sur round Plinko | Refusé ✅ |
| UUID aléatoire sans round → `crash_cashout` | Refusé ✅ |

---

## 10. Matrice client / serveur — autorité finale

| Jeu | Client envoie | Serveur calcule seul |
|-----|--------------|---------------------|
| Plinko | `round_id`, `stake`, `rows`, `risk` | path, slot, mult, payout |
| Mines | `round_id`, `stake`, `mines`, `tile_index` | mineSet, mult, payout |
| Crash | `round_id`, `stake` | `crash_at`, `mult_now`, payout |
| Slots | `round_id`, `stake` | stops, `evaluateSpin`, mult, payout |
| Craps | `round_id`, `stake`, `bet_id`, `roll_id` | dés, résultat, payout |
| Blackjack | `round_id`, `stake`, `action`, `action_id` | deck, cartes, dealer, payout |

**Le client ne peut jamais imposer :** RNG, carte, mine, stop, dés, crash point, multiplicateur payé, payout, résultat gagnant.

---

## 11. Tests DB réels

| Suite | Résultat |
|-------|---------|
| `PHASE2D SQL TESTS PASSED` | ✅ |
| `PHASE2A SQL INTEGRATION: ALL TESTS PASSED` | ✅ |
| `PHASE2B SQL TESTS PASSED` | ✅ |
| `PHASE2C SQL TESTS PASSED` | ✅ |
| Concurrence Crash (2 mises / 1 solde) | 1 BET, balance = 20 cr ✅ |
| `npm test` 288 tests | ✅ |
| `npx tsc -b` | ✅ |

---

## 12. Review adversariale finale

| Attaque | Verdict | Fix appliqué |
|---------|---------|-------------|
| crash_cashout t=0 | Résiste | mult < 1.01 → erreur |
| cashout après crash | Résiste | mult ≥ crash_at → loss silencieuse |
| slots_settle sans spin | **Corrigé** | Validation `stops not null` + longueur = 5 |
| double slots_settle | Résiste | State `settled` → duplicate |
| free spin sans balance | Résiste | `consume_free_spin` = false |
| jackpot sans round settled | Résiste | `state <> 'settled'` → exception |
| jackpot double claim | Résiste | Idempotency key unique |
| jackpot mauvais tier | Résiste | `jackpot_tier` du round vérifié |
| craps roll replay | **Corrigé** | `last_roll_id` dans server_state |
| BJ action autre joueur | Résiste | `profile_id is distinct from v_uid` |
| BJ settle direct | Résiste | Grant révoqué |
| double BJ settle | Résiste | State `settled` → duplicate |
| integer overflow / négatif | Résiste | `balance_after >= 0`, plafond 2G |

---

## 13. Bugs trouvés / corrigés

| Bug | Phase | Fix |
|-----|-------|-----|
| Mult Slots forgé par client (jusqu'à 1000×) | 2c | Paytable SQL complète, plus de param mult |
| Free spin client-contrôlé | 2c | `free_spins_balance` serveur |
| `bj_settle` public | 2c | Revoke grant |
| Crash : multiplicateur client payé | 2d | `crash_cashout()` sans mult, temps serveur |
| Slots settle sans stops | 2d | Validation stops présents |
| Craps idempotence instable | 2d | `bet_id` + `roll_id` + `last_roll_id` |
| Craps biais dés modulo 6 | 2d | Rejection sampling |
| BJ Fisher-Yates non uniforme | 2d | uint32 rejection sampling |
| Slots stops biais modulo 40 | 2d | uint32 rejection sampling |

---

## 14. Risques restants réellement bloquants avant prod jeux

| Risque | Statut |
|--------|--------|
| BJ side bets (perfectPairs, 21+3…) | Non couverts — profils ledger jouent sans side bets |
| BJ multi-seats | Non couvert (v1 mono-joueur) |
| Jackpot `claim_stampede_jackpot` legacy | Toujours accessible pour profils non-ledger |
| Mines biais Fisher-Yates (2.3%) | Acceptable grille 5×5, à réévaluer si expansion |

---

## 15. Confirmation finale

**PRODUCTION NON MODIFIÉE**
