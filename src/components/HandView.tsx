import { type CSSProperties } from 'react';
import { handValue, isNaturalBlackjack } from '../engine/hand';
import type { HandResult, PlayerHandState } from '../engine/types';
import { ANIMATION_ZONES, cardOverlapRatio } from '../lib/animationZones';
import { fmt } from '../lib/format';
import { decompose } from '../store/gameStore';
import { CardView } from './CardView';
import { ChipStack } from './ChipView';

const OUTCOME_LABEL: Record<string, string> = {
  blackjack: 'Blackjack',
  win: 'Gagné',
  push: 'Égalité',
  lose: 'Perdu',
  surrender: 'Abandon',
  evenMoney: 'Even money',
};

const OUTCOME_CLASS: Record<string, string> = {
  blackjack: 'bj',
  win: 'win',
  push: 'push',
  lose: 'lose',
  surrender: 'push',
  evenMoney: 'win',
};

interface Props {
  hand: PlayerHandState;
  seatIndex?: number;
  handIndex: number;
  active: boolean;
  result?: HandResult;
  isInitialDeal: boolean;
  dealIndexes?: number[];
}

function totalLabel(hand: PlayerHandState): { text: string; cls: string } {
  const v = handValue(hand.cards);
  if (hand.surrendered) return { text: 'Abandon', cls: '' };
  if (isNaturalBlackjack(hand.cards, hand.fromSplit)) return { text: 'Blackjack', cls: 'bj' };
  if (v.bust) return { text: `${v.total} · sauté`, cls: 'bust' };
  if (v.soft && v.total !== 21) return { text: `${v.total} soft`, cls: 'soft' };
  return { text: String(v.total), cls: '' };
}

function cardsStyle(count: number): CSSProperties {
  return {
    '--card-count': count,
    '--card-overlap': cardOverlapRatio(count),
  } as CSSProperties;
}

export function PlayerHandView({
  hand,
  seatIndex,
  handIndex,
  active,
  result,
  isInitialDeal,
  dealIndexes,
}: Props) {
  const t = totalLabel(hand);
  // Pendant la donne, les 2 cartes sont déjà en state mais pas encore posées :
  // on n’affiche le total qu’une fois la chorégraphie terminée.
  const showTotal = !isInitialDeal && hand.cards.length > 0;
  return (
    <div
      className={`hand player-hand ${active ? 'active' : 'inactive'}`}
      data-zone={ANIMATION_ZONES.playerHand}
      data-seat-id={seatIndex}
      data-hand-index={handIndex}
      data-hand-active={active ? 'true' : 'false'}
    >
      {result && (
        <div className={`hand-outcome ${OUTCOME_CLASS[result.outcome]}`}>
          {result.outcome === 'push'
            ? 'Égalité · mise rendue'
            : OUTCOME_LABEL[result.outcome]}
          {result.net !== 0 && ` ${result.net > 0 ? '+' : '−'}${fmt(Math.abs(result.net))}`}
        </div>
      )}
      <div className={`hand-focus ${active ? 'is-active' : ''}`}>
        <div className="cards" style={cardsStyle(hand.cards.length)}>
          {hand.cards.map((c, i) => (
            <CardView key={c.id} card={c} dealIndex={isInitialDeal ? (dealIndexes?.[i] ?? i * 2) : 0} />
          ))}
        </div>
        {showTotal && <div className={`total-badge ${t.cls}`}>{t.text}</div>}
      </div>
      <div
        className="hand-bet-spot"
        data-zone={ANIMATION_ZONES.betMain}
        data-hand-index={handIndex}
        data-bet-spot="play"
      >
        <div className="hand-bet">
          <ChipStack chips={decompose(hand.bet)} mini />
          <span className="hand-bet-label">
            {fmt(hand.bet)}
            {hand.doubled ? ' · doublé' : ''}
          </span>
        </div>
      </div>
    </div>
  );
}

interface DealerProps {
  cards: PlayerHandState['cards'];
  shown: number;
  holeShown: boolean;
  isInitialDeal: boolean;
  dealIndexes?: number[];
}

export function DealerHandView({ cards, shown, holeShown, isInitialDeal, dealIndexes }: DealerProps) {
  const visible = cards.slice(0, Math.max(shown, 2));
  const revealed = holeShown ? visible : visible.slice(0, 2);
  const v = handValue(holeShown ? visible : [visible[0]]);
  const isBj = holeShown && visible.length === 2 && handValue(visible).total === 21;
  // Pas de total pendant la donne (la carte visible n’est pas encore posée).
  const showTotal = !isInitialDeal && visible.length > 0;

  return (
    <div className="hand dealer-hand" data-zone={ANIMATION_ZONES.dealerHand}>
      <div className="cards" style={cardsStyle(visible.length)}>
        {visible.map((c, i) => (
          <CardView
            key={c.id}
            card={c}
            faceDown={i === 1 && !holeShown}
            dealIndex={isInitialDeal ? (dealIndexes?.[i] ?? i * 2 + 1) : 0}
          />
        ))}
      </div>
      {showTotal && (
        <div className={`total-badge ${v.bust ? 'bust' : isBj ? 'bj' : v.soft && v.total !== 21 ? 'soft' : ''}`}>
          {isBj
            ? 'Blackjack'
            : v.bust
              ? `${v.total} · sauté`
              : holeShown && revealed.length > 1 && v.soft && v.total !== 21
                ? `${v.total} soft`
                : v.total}
        </div>
      )}
    </div>
  );
}
