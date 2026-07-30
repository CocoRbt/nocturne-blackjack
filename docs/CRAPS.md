# NOCTURNE — Craps (salon des jeux)

## Scope (v1 haut de gamme, jouable)

Expérience **single-shooter** (tu lances toujours) avec les paris à faible house edge :

| Pari | Quand | Résolution | Paiement |
| --- | --- | --- | --- |
| **Pass Line** | Come-out | 7/11 win · 2/3/12 lose · sinon point | 1:1 |
| **Don’t Pass** | Come-out | 2/3 win · 7/11 lose · **12 push (bar)** · sinon point | 1:1 |
| **Odds** (derrière Pass) | Point établi | Point avant 7 | cotes vraies (0 % HE) |
| **Field** | Chaque lancer | 2,3,4,9,10,11,12 | 1:1 ; **2 → 2:1** ; **12 → 3:1** |

### Odds max (table 3-4-5×)

| Point | Max odds | Paiement |
| --- | --- | --- |
| 4 ou 10 | 3 × Pass | 2:1 |
| 5 ou 9 | 4 × Pass | 3:2 |
| 6 ou 8 | 5 × Pass | 6:5 |

## Phases

1. **Come-out** — puck OFF. Placer Pass / Don’t Pass / Field, puis Lancer.
2. **Point** — puck ON sur 4/5/6/8/9/10. Odds disponibles derrière Pass. Field chaque coup. Jusqu’à point (win Pass) ou 7-out (lose Pass).

## Fairness

Deux dés 1–6 via `crypto.getRandomValues` (uniforme). Jetons virtuels, même crédit que blackjack / Mines.
