# NOCTURNE — Craps (salon des jeux)

## Langage joueur (UI)

Pas de jargon casino à l’écran. Mapping :

| UI | Terme classique |
| --- | --- |
| **Gagner** | Pass Line |
| **Contre** | Don’t Pass (12 = remboursé) |
| **Ce coup** | Field |
| **Miser plus** | Odds derrière Pass |
| **Cible** | Point |
| **Libre** | Come-out (puck OFF) |

## Scope (v1)

Expérience single-shooter (tu lances toujours), paris à faible house edge :

| Case UI | Quand | Résolution | Paiement |
| --- | --- | --- | --- |
| **Gagner** | Premier lancer | 7/11 win · 2/3/12 lose · sinon cible | ×2 |
| **Contre** | Premier lancer | 2/3 win · 7/11 lose · **12 remboursé** · sinon cible | ×2 |
| **Miser plus** | Cible fixée | Cible avant 7 | cotes vraies |
| **Ce coup** | Chaque lancer | 2,3,4,9,10,11,12 | ×2 ; **2 → ×3** ; **12 → ×4** (mise+gain) |

### « Miser plus » max (table 3-4-5×)

| Cible | Max | Paiement du renfort |
| --- | --- | --- |
| 4 ou 10 | 3 × mise Gagner | ×2 |
| 5 ou 9 | 4 × mise Gagner | ×1,5 |
| 6 ou 8 | 5 × mise Gagner | ×1,2 |

## Phases

1. **Libre** — pose Gagner / Contre / Ce coup, puis Lance.
2. **Cible** — puck « Cible N ». Miser plus dispo. Ce coup chaque coup. Jusqu’à cible (Gagner gagne) ou 7 trop tôt (Gagner perd).

## Fairness

Deux dés 1–6 via `crypto.getRandomValues` (uniforme). Jetons virtuels, même crédit que blackjack / Mines.
