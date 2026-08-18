# NOCTURNE — Phase 2a Stop-loss

**Statut :** PR préparée, tests locaux verts.  
**PRODUCTION NON MODIFIÉE** — aucune migration appliquée, aucun wallet restauré, aucun deploy.

Hors scope (inchangé) : ledger, `game_rounds`, restauration joueurs, multi-device, refonte sync.

---

## 1. Fichiers modifiés

| Fichier | Rôle |
|---------|------|
| `supabase/migrations/20260818120000_phase2a_stop_loss.sql` | Nouvelle migration corrective |
| `src/cercle/syncGuard.ts` | Miroir client : une baisse à `games_played` inchangé n’est plus annulée |
| `src/cercle/gameSession.ts` | État explicite `gameSessionActive` |
| `src/cercle/circleLiveSync.ts` | Heartbeat : pas de push wallet si session financière |
| `src/cercle/wealth.ts` | `restoreWipedPlayable` = identité (plus de peak → balance) |
| `src/store/gameStore.ts` | Debit/credit/deal/settlement + hold d’écran |
| `src/store/persistence.ts` | Boot localStorage : plus de recollage peak |
| Écrans BJ / Mines / Craps / Crash / Plinko / Stampede | `setGameSessionActive` pendant la manche |
| Tests `src/cercle/__tests__/phase2aStopLoss.test.ts` etc. | Matrice obligatoire |
| `supabase/diagnostics/PHASE2A_VERIFY.sql` | SELECT de contrôle **après** GO |

---

## 2. Migration SQL — ce qui change exactement

Nouvelle migration, **pas** un replay de `#172000` (qui gardait encore les deux bugs et un `UPDATE` wallets).

### A — `sync_my_score`

**Retiré :**

```
si games_played identique ET balance < ancien ET vault inchangé
  → remettre l’ancien balance
```

C’est la cause confirmée : débit de mise → heartbeat → restauration.

**Conservé (anti-stale, pas anti-perte) :**

- push avec `games_played` **inférieur** → ignoré (appareil en retard)
- coffre ↑ sans débit solde correspondant (sauf patrimoine stable)
- coffre ↓ sans crédit solde correspondant
- gros **gain** sans nouvelle partie (sauf refill < 100 → 100 cr, ou delta ≤ 30 cr défi)
- saut de patrimoine > 1000 cr sans nouvelle partie

**Aucun** `UPDATE public.player_scores` de données joueur dans cette migration.

### B — `enforce_score_invariants`

Ne fait plus que :

```
peak_balance = greatest(new, old, balance+vault)
```

**Supprimé :**

- `v_new_wealth < 100` → `new.balance := old.balance` / `new.vault := old.vault`
- tout `peak_balance → balance` / `peak_balance → vault`

Le trigger `enforce_wealth_peak()` n’est **pas** touché (record-only, pas la cause).

`ensure_circle_membership()` n’est **pas** touché (prod sans millionaire restore — ne pas le réintroduire).

---

## 3. Client

`gameSessionActive` = `financialSessionDepth > 0` **ou** hold d’écran **ou** `salonStakeOpen`.

Ce n’est **pas** `screen !== 'lobby'` : on peut être sur Mines/Plinko sans mise en jeu, le classement continue de se pousser.

| Jeu | Session ON | Session OFF |
|-----|------------|-------------|
| Blackjack | `deal` (depth) + hold tant que la donne n’est pas réglée | `applySummary` + résultats affichés |
| Mines / Crash / Plinko / Slots / Craps | `*Debit` + hold (playing / vol / billes / spin+bonus / jeton) | `*Credit` / fin d’écran |
| Plinko multi-balles | depth = nombre de billes débitées | chaque landing −1 |

Pendant ON : heartbeat **et** `pushScore` (sauf jackpot `force`) ne poussent pas le wallet. Pull classement conservé. Coffre / envoi cercle refusés.

`restoreWipedPlayable` n’est plus appelé au boot ni à `hydrateFromCloud`.

---

## 4. Tests effectués (non-production)

```
vitest run  →  40 files, 287 tests, 0 failed
tsc -b      →  OK
```

Matrice :

- Mines 100 → mise 50 → perte → heartbeats → **50**, record inchangé
- Plinko 3 drops perdants → soldes 90 / 80 / 70, jamais de remontée
- Crash mise perdue → solde diminué après sync
- Slots spin perdant → solde diminué
- BJ perte / all-in / double perdu → ancienne valeur jamais réappliquée
- Record 1000, solde 100, perte → record 1000, solde 50
- Gain après settlement → sync reprend
- Cloud plus haut vs perte locale → `keep_local`
- Migration SQL sans restore OLD / peak→wallet / UPDATE joueurs

---

## 5. Plan de restauration (documenté, **non exécuté**)

T0 : **17 août 2026 03:00 France** = `2026-08-17 01:00:00 UTC`.

**Tous les coffres du cercle principal = 0** (les 500k / 1M actuels sont des artefacts récents).

| Joueur | Décision manuelle | Unités DB | Notes |
|--------|-------------------|-----------|-------|
| **KikiLoki** | historique, **pas** un nouveau | balance **121100000**, peak **121100000**, vault **0** | 1 211 000 cr. Ne **pas** reset 100. |
| **Vincent** | arrivé après T0, gains légitimes avant le bug | balance **100000**, vault **0** | 1 000 cr. Record : **pas** choisi auto. |
| **Selmex** (cercle principal) | profil à conserver | `7997ace8-c050-49f1-afd8-e4bb9c817cc3` · `NOC-EJV7` | L’autre profil Selmex (autre cercle) ≠ wallet actif. Ne pas supprimer en 2a. |

Snapshots balance (cercle principal, **coffre = 0**) :

- Lofty : 100 cr
- ZaaariX : 32 996,02 cr
- Selmex : 100 cr
- Lea2 : 2,50 cr
- Lea : 92,62 cr

---

## 6. Rollback

1. Client : revert PR.
2. SQL : `CREATE OR REPLACE` depuis le corps **prod actuel** (sauvegarder `pg_get_functiondef` avant apply).
3. `enforce_wealth_peak` inchangé → rien à rollback de ce côté.

---

## 7. Risques restants (hors 2a)

- Deux onglets : un onglet stale (`games_played` inférieur) est rejeté ; l’onglet local plus riche peut rester désync jusqu’au prochain hydrate (`keep_local`).
- Debit Mines/BJ **non persisté** mid-manche : un refresh restaure le solde pré-mise **localement** (comportement déjà là). Après settlement, persist + push.
- Gros gain sans `games+1` toujours rejeté (anti-cheat) — voulu.
- `SITE_PAUSED` (écran maintenance) reste en prod tant qu’on ne le retire pas.

---

## 8. Confirmation

**PRODUCTION NON MODIFIÉE.**

Pas de `supabase db push`, pas de merge `main`, pas de restauration, pas de ledger.
