# NOCTURNE — Mines (salon des jeux)

## Règles (alignées Stake Originals)

- Grille **5×5** (25 cases).
- Joueur choisit **1 à 24 mines** avant la manche.
- Mise débitée au démarrage (centimes, même crédit que le blackjack).
- Chaque **diamant** révélé augmente le multiplicateur.
- **Encaisser** à tout moment après le 1er diamant → gain = `mise × multiplicateur`.
- **Mine** → perte de la mise ; grille révélée.
- Tous les diamants trouvés → encaissement auto.

## Multiplicateur (RTP 99 %)

Après `n` diamants avec `m` mines :

```
acc = Π_{i=0}^{n-1} (25 − i) / (25 − m − i)
mult = floor(acc × 0.99 × 100) / 100
```

Équivalent : `0.99 × C(25,n) / C(25−m,n)` (arrondi floor 2 décimales).

## Fairness

Placement des mines : Fisher–Yates sur `crypto.getRandomValues` au moment du **Bet** (grille figée pour la manche).
