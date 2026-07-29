import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { useLayoutEffect, useRef } from 'react';
import type { Card } from '../engine/types';
import {
  hasSettledDeal,
  markDealSettled,
  playCardFlip,
  playDealTimeline,
  prefersReducedMotion,
  setCardFaceImmediate,
} from '../lib/dealAnimation';
import { useGame } from '../store/gameStore';
import { TIMING } from '../store/timing';
import { CardShell } from './CardShell';

gsap.registerPlugin(useGSAP);

interface Props {
  card: Card;
  hidden?: boolean;
  faceDown?: boolean;
  /** Index de chorégraphie (donne initiale : 0,1,2,3). */
  dealIndex?: number;
  animateDeal?: boolean;
}

/**
 * Carte jouable : distribution GSAP depuis le sabot + flip 3D à la révélation.
 * Vol toujours dos visible ; face révélée à l'impact (sauf carte cachée croupier).
 */
export function CardView({
  card,
  hidden,
  faceDown,
  dealIndex = 0,
  animateDeal = true,
}: Props) {
  const speed = useGame((s) => s.gameSpeed);
  const isFaceDown = faceDown ?? hidden ?? false;
  const outerRef = useRef<HTMLDivElement>(null);
  const prevFace = useRef<boolean | null>(null);

  useLayoutEffect(() => {
    const inner = outerRef.current?.querySelector<HTMLElement>('.card-inner');
    if (!inner) return;
    if (prevFace.current === null) {
      setCardFaceImmediate(inner, isFaceDown);
      prevFace.current = isFaceDown;
    }
  }, [isFaceDown]);

  useGSAP(
    () => {
      const el = outerRef.current;
      if (!el) return;

      const inner = el.querySelector<HTMLElement>('.card-inner');
      if (!animateDeal || hasSettledDeal(card.id) || prefersReducedMotion()) {
        if (inner) setCardFaceImmediate(inner, isFaceDown);
        prevFace.current = isFaceDown;
        markDealSettled(card.id);
        return;
      }

      // Pendant le deal : on part dos visible (évite le flash face).
      if (inner) setCardFaceImmediate(inner, true);
      prevFace.current = true;

      const delay = dealIndex * (TIMING[speed].dealGap / 1000);
      const tl = playDealTimeline(el, {
        cardId: card.id,
        delay,
        speed,
        revealOnLand: !isFaceDown,
        onComplete: () => {
          prevFace.current = isFaceDown;
        },
      });

      return () => {
        tl.kill();
        gsap.set(el, {
          x: 0,
          y: 0,
          rotation: 0,
          rotationX: 0,
          scale: 1,
          z: 0,
          filter: 'none',
          force3D: true,
        });
        el.classList.remove('is-dealing');
      };
    },
    { dependencies: [card.id] },
  );

  // Révélation différée (carte cachée croupier en fin de manche).
  useGSAP(
    () => {
      if (prevFace.current === null) return;
      if (prevFace.current === isFaceDown) return;
      const inner = outerRef.current?.querySelector<HTMLElement>('.card-inner');
      if (!inner) return;
      const wasDown = prevFace.current;
      prevFace.current = isFaceDown;
      playCardFlip(inner, {
        faceDown: isFaceDown,
        speed,
        animate: wasDown !== isFaceDown,
      });
    },
    { dependencies: [isFaceDown, speed], revertOnUpdate: false },
  );

  return <CardShell ref={outerRef} card={card} faceDown={isFaceDown} />;
}
