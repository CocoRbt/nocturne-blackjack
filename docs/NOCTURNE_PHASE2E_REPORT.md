# NOCTURNE — Rapport Phase 2e

**Date :** 2026-08-18  
**Branche :** `cursor/phase2e-final-parity-d1df`  
**Base :** Phase 2d validée, sans déploiement prod  
**Production :** **NON MODIFIÉE**

`SITE_PAUSED = true`  
Aucune migration prod, aucune restauration joueur, aucune réouverture.

---

## 1. Mines RNG corrigé

Le `Fisher-Yates` SQL de Mines n’utilise plus `byte % 25`.

### Avant
- `v_j := get_byte(seed, ...) % (i + 1)`
- biais modulo sur certaines positions

### Après
- rejection sampling uniforme pour chaque index `[0, i]`
- même logique que Craps / Blackjack / Slots

### Validation
- smoke test statistique ajouté dans `phase2d_sql_tests.sql`
- 10 000 placements d’une mine
- distribution par case dans la fourchette attendue

---

## 2. Réalité 6 / 8 decks

### État réel actuel côté client NOCTURNE

Dans `src/engine/rules.ts` :

| Table | Decks |
|------|-------|
| Émeraude | 6 |
| Onyx | 8 |
| Impériale | 6 |
| Privée | 6 |

### Conclusion

- **8 decks est une vraie configuration actuelle** : **Onyx**
- le rapport Phase 2d ne pouvait donc pas marquer la parité decks ✅
- le serveur Phase 2d était fixé à 6 decks → **écart réel**

### Décision Phase 2e

Tant que le moteur serveur Blackjack n’implémente pas :
- la vraie configuration decks par table,
- le split / resplit / split As / DAS,
- les side bets accessibles,

**Blackjack est explicitement fermé pour les profils ledger** dans l’UI.

---

## 3. Split / resplit parity

### Fonctionnalités réellement accessibles aujourd’hui côté client

Audit UI + moteur :

| Fonctionnalité | Accessible dans UI ? | Serveur 2d | Décision |
|---------------|----------------------|------------|----------|
| Split | Oui (`ActionBar`, `availableActions`) | Non complet | Désactivé pour profils ledger |
| Plusieurs mains | Oui | Non | Désactivé |
| Re-split | Oui si règles le permettent | Non | Désactivé |
| Split As | Oui | Non | Désactivé |
| Double après split (DAS) | Oui | Non | Désactivé |

### Conclusion

Le moteur client historique supporte bien ces fonctionnalités, donc il était dangereux de laisser Blackjack accessible en ledger avec un moteur serveur simplifié.

**Mesure prise :**

- bouton Blackjack du lobby explicitement fermé pour profils ledger/cloud
- cartes de tables Blackjack désactivées pour profils ledger/cloud
- aucun fallback financier legacy caché pour ces profils

---

## 4. Side bets parity

### Side bets présents dans le repo / UI

Dans `src/engine/sidebets.ts` et `BettingBoard.tsx` :

- Perfect Pairs
- 21+3
- Lucky Ladies
- Bust It
- Royal Match

### Accessibilité réelle

Dans l’UI actuelle :
- `BettingBoard` affiche les side bets selon `table.rules.sideBets`
- `TableRound` et `Round` savent les résoudre

### État serveur 2d

Le moteur SQL Blackjack Phase 2d ne porte pas ces side bets.

### Décision

| Fonctionnalité | Accessible client historique | Serveur ledger | Décision |
|---------------|------------------------------|----------------|----------|
| Perfect Pairs | Oui selon table | Non | Désactivé via fermeture BJ ledger |
| 21+3 | Oui selon table | Non | Désactivé |
| Lucky Ladies | Code présent | Pas confirmé accessible partout | Désactivé si BJ fermé |
| Bust It | Code présent | Non | Désactivé |
| Royal Match | Code présent | Non | Désactivé |

---

## 5. Crash — temps serveur validé

Conditions demandées vérifiées :

| Point | Statut |
|------|--------|
| `started_at` écrit serveur | ✅ |
| `elapsed_ms` calculé serveur | ✅ |
| aucune valeur temporelle client n’influence le payout | ✅ |
| cashouts concurrents idempotents | ✅ |

Le client ne peut envoyer que :
- `round_id`
- intention de cashout

Le serveur calcule seul :
- `elapsed`
- `mult_now`
- comparaison à `crash_at`
- `payout`

---

## 6. Slots parity

### Comparaison automatisée TS vs SQL

Ajout :
- `src/slots/__tests__/sqlParity.test.ts`

Fixtures déterministes couvertes :
- aucune victoire
- scatter x4
- jackpot grand
- wild
- herd multiplier
- proche maximum

Résultat :
- **6 / 6 fixtures OK**
- même `scatter_count`
- même `free_spins`
- même `bison_landed`
- même `total_mult` (tolérance numérique fine)

---

## 7. Jackpot legacy guard

Ajout dans `claim_stampede_jackpot` :

- si le profil a déjà des lignes dans `wallet_ledger`
- alors le RPC legacy refuse avec message explicite

Le profil ledger doit utiliser :
- `claim_jackpot_ledger(tier, round_id)`

Donc :
- un profil ledger ne peut plus passer par le vieux chemin jackpot

---

## 8. Matrice fonctionnelle finale

| Fonction | Ancien jeu | Nouveau serveur | Parité | Décision |
|---------|------------|----------------|--------|----------|
| Plinko | RNG client historique | RNG serveur + ledger | Oui | Ouvert ledger |
| Mines | RNG client historique | RNG serveur + ledger | Oui | Ouvert ledger |
| Crash | mult visuel client | temps serveur + ledger | Oui | Ouvert ledger |
| Slots base | TS `evaluateSpin` | SQL `slots_evaluate_spin` | Oui | Ouvert ledger |
| Slots free spins | client/bonus | serveur + `free_spins_balance` | Oui | Ouvert ledger |
| Slots jackpot | chemin legacy + cloud | `claim_jackpot_ledger` | Oui | Ouvert ledger |
| Craps mise/roll/take back | Oui | Oui | Oui pour version actuelle | Ouvert ledger |
| Blackjack main simple | Oui | Oui | Partiel | **Fermé ledger** |
| Blackjack split / re-split / split As / DAS | Oui | Non | Non | **Fermé ledger** |
| Blackjack side bets | Oui | Non | Non | **Fermé ledger** |

---

## 9. Tests

### SQL / DB réelle
- `PHASE2D SQL TESTS PASSED`
- `PHASE2A SQL INTEGRATION: ALL TESTS PASSED`
- `PHASE2B SQL TESTS PASSED`
- `PHASE2C SQL TESTS PASSED`

### Parité
- `src/slots/__tests__/sqlParity.test.ts` → **6/6 OK**

### Unit / typecheck
- `npm test` → **43 fichiers / 294 tests OK**
- `tsc` → **OK**

### Smoke stats
- Craps dés : OK
- Plinko bits : OK
- Slots stops : OK
- Mines positions : OK

---

## 10. Blockers restants éventuels

### Bloquant réouverture Blackjack ledger

Blackjack ne peut pas être rouvert côté ledger tant que ne sont pas portés serveur :

1. decks réels par table (dont Onyx = 8 decks)
2. split
3. re-split
4. split As
5. DAS
6. side bets réellement accessibles

### Non bloquant pour les autres jeux

Les autres jeux accessibles à la réouverture peuvent maintenant être affirmés comme :

- RNG serveur
- sans biais volontaire connu facilement évitable
- payout serveur
- ledger
- idempotents
- survivant au refresh
- sans fallback legacy caché pour profils ledger

---

## Confirmation finale

**PRODUCTION NON MODIFIÉE**
