# STAMPEDE — machine à sous Nocturne

Inspiration **mécanique** type Buffalo (Aristocrat) — **sans IP** : pas de marque, assets ni paytable IGT/Aristocrat.

## Concept
- Nom : **STAMPEDE** (sous-titre « Ruée dorée »)
- Grille **5×4**, **1024 ways** (adjacent gauche → droite, pas de lignes fixes)
- Wild : **Crépuscule** (substitue tout sauf scatter)
- Scatter : **Médaille** (3+ n’importe où → free spins)
- Free spins : 3→8, 4→15, 5→20 ; retrigger 2+ médailles → +5
- Pendant FS : multiplicateurs wild 2×/3× (produit) + **compteur Troupeau** (bisons transformant les autres animaux)

## Stack technique
Même pattern que Plinko : `math.ts` + `engine.ts` purs → `SlotScreen` → `slotsDebit`/`slotsCredit` → GameShell / Lobby / défis.

## RTP
Cible **~96–97 %** (slots classiques un peu plus « casino » que Mines/Plinko à 99 %). Vérifié par simulation Vitest.

## Checklist d’implémentation

- [x] `src/slots/math.ts` — bandes, 1024 ways, scatter, troupeau, RTP simulé
- [x] `src/slots/engine.ts` — `createIdleRound` / `startSpin` / `settleSpin` / `resetAfterSettle`
- [x] `src/components/SlotScreen.tsx` — 5 rouleaux animés, arrêt décalé + anticipation médailles
- [x] Bandeau tours gratuits, jauge Troupeau, détail des ways, pulse de gain
- [x] Store : `screen: 'slots'`, `enterSlots` / `leaveSlots` / `slotsDebit` / `slotsCredit` (ambiance `salon`)
- [x] Débit sur les spins de base uniquement, crédit exactement une fois par spin
- [x] Nav verrouillée (lobby / menu / recharge) pendant la rotation et le bonus
- [x] Lobby (carte + tagline), `AppMenu`, `GameShell` (accent `slots`), `RulesGuide`
- [x] Défis : `slots_rounds` (10 spins) + `slots_mult` (10×) + libellé « Stampede »
- [x] `index.css` — habillage prairie au crépuscule (ambre / rouille / ocre), responsive mobile
- [x] Tests `src/slots/__tests__/situations.test.ts` — invariant de caisse base / free spins

## Habillage
Palette **prairie au crépuscule** : ambre `#e9a33d`, or `#f6c86a`, rouille `#b4441f`, ocre `#c8892c`
sur brun profond `#1d0f08`. Symboles en SVG inline (aucune dépendance image).
Trois mouvements portants : rotation des rouleaux (boucle CSS + rebond d’arrêt),
pulse des cases gagnantes, balayage lumineux du bandeau de tours gratuits.

## Feel (polish)
- Ambiance audio dédiée `stampede` (vent + pads chauds)
- Overlay gros gain (≥10×) avec compteur + pause
- Célébration entrée free spins
- Anticipation : tremblement des rouleaux si 2+ médailles déjà arrêtées
- Jauge Troupeau avec paliers marqués (1,5× / 2× / 2,5× / 3×)
- **Auto-spin** 10 / 25 / 50 / 100 / ∞ + stop FS / gros gain
- Règles détaillées type Stake : paytable avec logos (`src/slots/glyphs.tsx`)

## Jackpots progressifs
- Pots **Mini / Major / Grand** par cercle (Supabase) ou localStorage en solo
- Seeds : 50 / 250 / 1 000 crédits — contribution **1 %** des mises de base
- Trigger : 3 / 4 / 5 **Étoiles** sur la grille (base uniquement, plus haut tier)
- Migration : `supabase/migrations/20260812220000_circle_jackpots.sql`

## Hors scope v1
- Samples audio western dédiés (réutilise win/click/bigwin)
- Provably fair UI
