import gsap from 'gsap';
import { ANIMATION_ZONES, measureZone } from './animationZones';
import type { GameSpeed } from '../store/timing';

/** Cartes dont la distribution s'est terminée (évite un re-deal au split). */
const settledDealIds = new Set<string>();

export function hasSettledDeal(cardId: string): boolean {
  return settledDealIds.has(cardId);
}

export function markDealSettled(cardId: string): void {
  settledDealIds.add(cardId);
}

export function resetSettledDeals(): void {
  settledDealIds.clear();
}

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function unit(cardId: string, salt: number): number {
  let h = salt * 2654435761;
  for (let i = 0; i < cardId.length; i++) {
    h = Math.imul(h ^ cardId.charCodeAt(i), 1597334677);
  }
  return ((h >>> 0) % 10000) / 10000;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export interface DealVariation {
  lateral: number;
  depth: number;
  curveX: number;
  curveY: number;
  startRot: number;
  flightRot: number;
  overshootX: number;
  overshootY: number;
  durationMul: number;
  delayJitter: number;
  startScale: number;
}

export function dealVariation(cardId: string): DealVariation {
  return {
    lateral: lerp(-10, 10, unit(cardId, 1)),
    depth: lerp(-6, 8, unit(cardId, 2)),
    curveX: lerp(-16, 16, unit(cardId, 3)),
    curveY: lerp(-9, 7, unit(cardId, 4)),
    startRot: lerp(20, 36, unit(cardId, 5)),
    flightRot: lerp(-5, 7, unit(cardId, 6)),
    overshootX: lerp(-3.2, 3.2, unit(cardId, 7)),
    overshootY: lerp(2.2, 4.2, unit(cardId, 8)),
    durationMul: lerp(0.95, 1.04, unit(cardId, 9)),
    delayJitter: lerp(-0.008, 0.012, unit(cardId, 10)),
    startScale: lerp(0.64, 0.7, unit(cardId, 11)),
  };
}

/** Origine : gueule du sabot de table. */
export function shoeDeltaFor(el: HTMLElement): { x: number; y: number } {
  const shoe =
    measureZone(ANIMATION_ZONES.dealOrigin) ?? measureZone(ANIMATION_ZONES.shoe);
  const prev = el.style.transform;
  el.style.transform = 'none';
  void el.offsetWidth;
  const dest = el.getBoundingClientRect();
  el.style.transform = prev;

  if (!shoe || dest.width < 4 || dest.height < 4) {
    return { x: 180, y: -160 };
  }
  // Gueule du sabot (bord avant / lip).
  const originX = shoe.left + shoe.width * 0.18;
  const originY = shoe.top + shoe.height * 0.62;
  const destCX = dest.left + dest.width / 2;
  const destCY = dest.top + dest.height / 2;
  let x = originX - destCX;
  let y = originY - destCY;
  if (Math.hypot(x, y) < 80) {
    x = 180;
    y = -160;
  }
  return { x, y };
}

const SPEED_SCALE: Record<GameSpeed, number> = {
  classic: 1,
  fast: 0.64,
};

export interface DealTimelineOpts {
  cardId: string;
  delay: number;
  speed: GameSpeed;
  /** Si true : dos pendant le vol, flip face à l'impact. */
  revealOnLand?: boolean;
  onComplete?: () => void;
}

function cubic(t: number, a: number, b: number, c: number, d: number): number {
  const u = 1 - t;
  return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
}

/** Fouetté croupier : sortie nette, freinage court. */
function dealEase(t: number): number {
  return 1 - Math.pow(1 - t, 4.5);
}

function setFeltShadow(
  el: HTMLElement,
  lift: number,
  t: number,
): void {
  // Ombre projetée au feutre : plus large / diffuse en vol, serrée à la pose.
  const o = 0.22 + lift * 0.018;
  const blur = 6 + lift * 1.35;
  const sy = 2 + lift * 0.7;
  const sx = (1 - t) * 2;
  const sc = 0.88 + lift * 0.025;
  el.style.setProperty('--felt-o', o.toFixed(3));
  el.style.setProperty('--felt-blur', `${blur.toFixed(1)}px`);
  el.style.setProperty('--felt-y', `${sy.toFixed(1)}px`);
  el.style.setProperty('--felt-x', `${sx.toFixed(1)}px`);
  el.style.setProperty('--felt-s', sc.toFixed(3));
}

function clearFeltShadow(el: HTMLElement): void {
  el.style.removeProperty('--felt-o');
  el.style.removeProperty('--felt-blur');
  el.style.removeProperty('--felt-y');
  el.style.removeProperty('--felt-x');
  el.style.removeProperty('--felt-s');
}

/**
 * Distribution style casino live :
 * 1) émergence gueule du sabot
 * 2) fouetté dos visible
 * 3) micro-friction à la pose
 * 4) révélation face à l'impact (si revealOnLand)
 */
export function playDealTimeline(el: HTMLElement, opts: DealTimelineOpts): gsap.core.Timeline {
  const v = dealVariation(opts.cardId);
  const base = shoeDeltaFor(el);
  const scale = SPEED_SCALE[opts.speed] * v.durationMul;
  const delay = Math.max(0, opts.delay + v.delayJitter);
  // ~340ms classic + emerge — 4 cartes ≈ 1s avec dealGap ~190ms.
  const duration = 0.36 * scale;
  const revealOnLand = opts.revealOnLand ?? false;

  const startX = base.x + v.lateral;
  const startY = base.y + v.depth;
  const len = Math.hypot(startX, startY) || 1;
  // Encore un peu « dans » le sabot.
  const buriedX = startX * 1.1;
  const buriedY = startY * 1.08;

  const c1x = startX * 0.8 + (-startY / len) * v.curveX * 0.22;
  const c1y = startY * 0.84 + (startX / len) * v.curveY * 0.18;
  const c2x = startX * 0.18 + (-startY / len) * v.curveX * 0.8;
  const c2y = startY * 0.2 + (startX / len) * v.curveY * 0.65;

  const inner = el.querySelector<HTMLElement>('.card-inner');
  // Toujours dos pendant le trajet.
  if (inner) setCardFaceImmediate(inner, true);

  el.classList.add('is-dealing');

  gsap.set(el, {
    x: buriedX,
    y: buriedY,
    rotation: v.startRot + 6,
    rotationX: 16,
    scale: v.startScale * 0.92,
    transformOrigin: '50% 50%',
    force3D: true,
    z: 4,
    filter: 'none',
  });
  setFeltShadow(el, 4, 0);

  const proxy = { t: 0 };
  let prevX = buriedX;
  let prevY = buriedY;
  let prevTime = performance.now();
  let revealStarted = false;

  const revealDur = opts.speed === 'fast' ? 0.18 : 0.24;
  const revealAt = 0.78;

  const tl = gsap.timeline({
    delay,
    onComplete: () => {
      el.classList.remove('is-dealing');
      clearFeltShadow(el);
      gsap.set(el, {
        x: 0,
        y: 0,
        rotation: 0,
        rotationX: 0,
        scale: 1,
        z: 0,
        filter: 'none',
        clearProps: 'boxShadow',
        force3D: true,
      });
      if (inner) {
        setCardFaceImmediate(inner, !revealOnLand);
      }
      markDealSettled(opts.cardId);
      opts.onComplete?.();
    },
  });

  tl.to(proxy, {
    t: 1,
    duration,
    ease: 'none', // mapping manuel (emerge + whip + settle)
    onUpdate: () => {
      const t = proxy.t;
      let x: number;
      let y: number;
      let rot: number;
      let pitch: number;
      let sc: number;
      let lift: number;
      let blur = 0;

      const emergeEnd = 0.12;
      const settleStart = 0.88;

      if (t < emergeEnd) {
        // Phase 1 — émergence gueule du sabot (lente, dos visible).
        const e = smoothstep(0, 1, t / emergeEnd);
        x = lerp(buriedX, startX, e);
        y = lerp(buriedY, startY, e);
        rot = lerp(v.startRot + 6, v.startRot, e);
        pitch = lerp(16, 12, e);
        sc = lerp(v.startScale * 0.92, v.startScale, e);
        lift = 3 + e * 4;
      } else if (t < settleStart) {
        // Phase 2 — fouetté sur le feutre.
        const u = (t - emergeEnd) / (settleStart - emergeEnd);
        const eased = dealEase(u);
        x = cubic(eased, startX, c1x, c2x, v.overshootX);
        y = cubic(eased, startY, c1y, c2y, v.overshootY);
        const rotFlight = lerp(v.startRot, v.flightRot, smoothstep(0, 0.55, u));
        rot = lerp(rotFlight, v.flightRot * 0.3, smoothstep(0.55, 1, u));
        pitch = lerp(12, 2, smoothstep(0, 1, u));
        sc = lerp(v.startScale, 1, smoothstep(0, 0.9, u));
        lift = 8 * Math.sin(Math.PI * Math.min(1, u * 1.05));
      } else {
        // Phase 3 — micro-friction (2–4 px), pas un rebond.
        const s = smoothstep(settleStart, 1, t);
        x = lerp(v.overshootX, 0, s);
        y = lerp(v.overshootY, 0, s);
        rot = lerp(v.flightRot * 0.3, 0, s);
        pitch = lerp(2, 0, s);
        sc = 1;
        lift = lerp(2, 0, s);
      }

      // Motion blur (uniquement pendant le fouetté).
      if (t >= emergeEnd && t < settleStart) {
        const now = performance.now();
        const dt = Math.max(0.008, (now - prevTime) / 1000);
        const speed = Math.hypot(x - prevX, y - prevY) / dt;
        blur = Math.min(1.5, Math.max(0, (speed - 1000) / 2600));
      }
      prevX = x;
      prevY = y;
      prevTime = performance.now();

      setFeltShadow(el, lift, t);

      gsap.set(el, {
        x,
        y,
        z: lift,
        rotation: rot,
        rotationX: pitch,
        scale: sc,
        force3D: true,
        filter: blur > 0.1 ? `blur(${blur.toFixed(2)}px)` : 'none',
      });

      // Révélation à l'impact — flip court, chevauche la fin du trajet.
      if (revealOnLand && inner && !revealStarted && t >= revealAt) {
        revealStarted = true;
        playCardFlip(inner, {
          faceDown: false,
          speed: opts.speed,
          animate: !prefersReducedMotion(),
          duration: revealDur,
        });
      }
    },
  });

  return tl;
}

export interface FlipOpts {
  faceDown: boolean;
  speed: GameSpeed;
  animate: boolean;
  /** Durée override (révélation à l'impact plus courte). */
  duration?: number;
}

/** Flip 3D — une rotation continue, lift parallèle. */
export function playCardFlip(inner: HTMLElement, opts: FlipOpts): gsap.core.Timeline | void {
  const target = opts.faceDown ? 180 : 0;
  const from = opts.faceDown ? 0 : 180;
  gsap.killTweensOf(inner);
  if (!opts.animate || prefersReducedMotion()) {
    gsap.set(inner, { rotationY: target, z: 0, transformOrigin: '50% 50%' });
    return;
  }
  const dur = opts.duration ?? (opts.speed === 'fast' ? 0.3 : 0.48);
  const outer = inner.closest('.card-outer');
  outer?.classList.add('is-flipping');

  const tl = gsap.timeline({
    defaults: { force3D: true, transformOrigin: '50% 50%' },
    onComplete: () => outer?.classList.remove('is-flipping'),
  });

  gsap.set(inner, { rotationY: from, z: 0 });
  tl.to(inner, { rotationY: target, duration: dur, ease: 'power1.inOut' }, 0);
  tl.to(
    inner,
    { z: 22, duration: dur * 0.5, ease: 'sine.out', yoyo: true, repeat: 1 },
    0,
  );
  return tl;
}

export function setCardFaceImmediate(inner: HTMLElement, faceDown: boolean): void {
  gsap.set(inner, {
    rotationY: faceDown ? 180 : 0,
    transformOrigin: '50% 50%',
    force3D: true,
  });
}
