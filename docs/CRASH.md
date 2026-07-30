# NOCTURNE — Crash (salon des jeux)

## Règles (alignées Stake Crash)

- Mise débitée au **Décoller**.
- Un multiplicateur part de **1,00×** et croît de façon exponentielle.
- **Encaisser** à tout moment pendant le vol → gain = `mise × multiplicateur`.
- Si l’avion **crash** avant l’encaissement → mise perdue.
- **Auto cashout** optionnel à un seuil (ex. 2,00×).

## Formule (RTP 99 %)

Point de crash depuis u ∈ [0, 1) via `crypto.getRandomValues` :

```
h = floor(u × 2³²)
crash = max(1, floor((2³² / (h + 1)) × 0.99 × 100) / 100)
```

≈ **1 %** d’instant crash à 1,00×. Cap théorique 1 000 000×.

Probabilité d’atteindre un multiplicateur `m` ≈ `0.99 / m`.

## Animation

Courbe + avion en temps réel (`requestAnimationFrame`). Le point de crash est tiré **au décollage** ; l’affichage monte jusqu’à ce point (ou jusqu’au cashout).
