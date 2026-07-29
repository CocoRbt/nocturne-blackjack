import { forwardRef, type CSSProperties } from 'react';
import { isRed } from '../engine/cards';
import type { Card } from '../engine/types';

export interface CardShellProps {
  card: Card;
  /** Face cachée (dos visible). */
  faceDown?: boolean;
  className?: string;
  style?: CSSProperties;
}

/**
 * Présentation pure d'une carte — aucune animation.
 * Structure prête pour flip 3D, translate et ciblage GSAP ultérieur.
 */
export const CardShell = forwardRef<HTMLDivElement, CardShellProps>(function CardShell(
  { card, faceDown = false, className = '', style },
  ref,
) {
  const red = isRed(card.suit);
  return (
    <div
      ref={ref}
      className={`card-outer ${className}`.trim()}
      data-card-id={card.id}
      data-rank={card.rank}
      data-suit={card.suit}
      data-face={faceDown ? 'down' : 'up'}
      style={style}
    >
      <div className={`card-inner ${faceDown ? 'is-face-down' : 'is-face-up'}`}>
        <div className={`card-face ${red ? 'red' : ''}`} aria-hidden={faceDown}>
          <div className="corner">
            {card.rank}
            <small>{card.suit}</small>
          </div>
          <div className="pip">{card.suit}</div>
          <div className="corner flip">
            {card.rank}
            <small>{card.suit}</small>
          </div>
        </div>
        <div className="card-back" aria-hidden={!faceDown} />
      </div>
    </div>
  );
});
