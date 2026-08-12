import type { SlotSymbol } from './math';

/** Tête de bison de face : cornes crochues, laine, museau large. */
export function BisonGlyph() {
  return (
    <svg className="slots-glyph" viewBox="0 0 40 40" aria-hidden>
      <path
        className="fill-part"
        d="M11.4 13.4C6.6 13 2.8 10.2 1.8 5.6c-.2-1.2 1-2 2-1.2 1.9 1.5 2.4 3.7 3.8 5 1.1 1 2.6 1.6 4.4 1.9z"
      />
      <path
        className="fill-part"
        d="M28.6 13.4c4.8-.4 8.6-3.2 9.6-7.8.2-1.2-1-2-2-1.2-1.9 1.5-2.4 3.7-3.8 5-1.1 1-2.6 1.6-4.4 1.9z"
      />
      <path className="fill-part" d="M11.2 15.8 5.4 14.2l4.6 5.6zM28.8 15.8l5.8-1.6-4.6 5.6z" />
      <path
        className="fill-part"
        d="M20 8.2c-7 0-11.6 3.4-12.2 9-.3 2.8.5 5.4 2.2 7.6.5.7.9 1.6 1 2.5l.5 3.2c.2 1.5 1.5 2.6 3 2.6h11c1.5 0 2.8-1.1 3-2.6l.5-3.2c.1-.9.5-1.8 1-2.5 1.7-2.2 2.5-4.8 2.2-7.6-.6-5.6-5.2-9-12.2-9z"
      />
      <path
        className="ink"
        d="M15.4 25h9.2c1.6 0 2.8 1.3 2.8 2.8v.9c0 2-1.6 3.6-3.6 3.6h-7.6c-2 0-3.6-1.6-3.6-3.6v-.9c0-1.5 1.2-2.8 2.8-2.8z"
      />
      <circle className="fill-part" cx="17.2" cy="28.4" r="1.3" />
      <circle className="fill-part" cx="22.8" cy="28.4" r="1.3" />
      <circle className="ink" cx="13.6" cy="19.2" r="1.7" />
      <circle className="ink" cx="26.4" cy="19.2" r="1.7" />
    </svg>
  );
}

/** Tête d’aigle de profil : bec crochu, arcade sourcilière marquée. */
export function EagleGlyph() {
  return (
    <svg className="slots-glyph" viewBox="0 0 40 40" aria-hidden>
      <path
        className="fill-part"
        d="M16.4 8.4c5.8 0 10.4 4.3 10.4 9.6 0 3.2-1.7 6.1-4.3 7.9l1.8 10.5h-4.9l-1.6-9c-6-.2-10.8-4.4-10.8-9.4 0-5.3 4.6-9.6 9.4-9.6z"
      />
      <path
        className="fill-part"
        d="M25.4 14.2 36 17.6c1.4.5 1.5 2.4.2 3l-5 2.4c-1.2.6-2.6.3-3.4-.8l-3.6-4.6z"
      />
      <path className="fill-part" d="m31.6 22.2-1 4.4 4-3.4z" />
      <path className="ink" d="M16.8 13 25.2 15.6l-.9 2.4-3.6-1.1z" />
      <circle className="ink" cx="19.6" cy="18" r="1.9" />
      <path className="ink" d="M28.8 18.2h2.4v1.2h-2.4z" />
    </svg>
  );
}

/** Puma de face : crâne rond, museau court, moustaches. */
export function CougarGlyph() {
  return (
    <svg className="slots-glyph" viewBox="0 0 40 40" aria-hidden>
      <path
        className="fill-part"
        d="M12.6 15 10 5.4l7.4 5.2h5.2L30 5.4 27.4 15c1.4 2 2.2 4.4 2.2 7 0 6.1-4.3 10.6-9.6 10.6S10.4 28.1 10.4 22c0-2.6.8-5 2.2-7z"
      />
      <path className="ink" d="M15.8 20.2 19 21.8l-3.2 1.6zM24.2 20.2 21 21.8l3.2 1.6z" />
      <path className="ink" d="M20 25.4a2 2 0 0 1-1.8-1.1h3.6A2 2 0 0 1 20 25.4z" />
      <path
        className="ink-stroke"
        d="M20 25.4v1.8M20 27.2c-1.1 1.3-2.8 1.3-3.9.2M20 27.2c1.1 1.3 2.8 1.3 3.9.2"
      />
      <path
        className="ink-stroke whisker"
        d="M14 24.6 7.6 23.2M14 26.6 8.2 27.8M26 24.6l6.4-1.4M26 26.6l5.8 1.2"
      />
    </svg>
  );
}

/** Loup de face : crâne anguleux, grandes oreilles, museau pointu. */
export function WolfGlyph() {
  return (
    <svg className="slots-glyph" viewBox="0 0 40 40" aria-hidden>
      <path
        className="fill-part"
        d="M11.8 16.4 7.4 3.8l8.6 6.6h8l8.6-6.6-4.4 12.6c1 1.7 1.6 3.6 1.6 5.6 0 3.7-1.9 6.9-4.8 8.8L20 36l-5-5.2c-2.9-1.9-4.8-5.1-4.8-8.8 0-2 .6-3.9 1.6-5.6z"
      />
      <path className="ink" d="M14.8 19.6 18.2 21l-3.4 1.6zM25.2 19.6 21.8 21l3.4 1.6z" />
      <path className="ink" d="M20 28.6 17.6 25h4.8z" />
    </svg>
  );
}

/** Élan : bois ramifiés, tête allongée. */
export function ElkGlyph() {
  return (
    <svg className="slots-glyph" viewBox="0 0 40 40" aria-hidden>
      <path className="stroke-part" d="M14.4 13.6 9.6 6.8M9.6 6.8 4 6M9.6 6.8 8.8 2M12.4 10.4 6.8 10" />
      <path
        className="stroke-part"
        d="M25.6 13.6 30.4 6.8M30.4 6.8 36 6M30.4 6.8 31.2 2M27.6 10.4 33.2 10"
      />
      <path
        className="fill-part"
        d="M20 10.6c4.3 0 6.8 2.4 6.8 6.6 0 6.4-2.6 15-6.8 15s-6.8-8.6-6.8-15c0-4.2 2.5-6.6 6.8-6.6z"
      />
      <circle className="ink" cx="17" cy="17.6" r="1.4" />
      <circle className="ink" cx="23" cy="17.6" r="1.4" />
      <path
        className="ink"
        d="M18 27.4h4c.8 0 1.4.7 1.4 1.5s-.6 1.5-1.4 1.5h-4c-.8 0-1.4-.7-1.4-1.5s.6-1.5 1.4-1.5z"
      />
    </svg>
  );
}

export function WildGlyph() {
  return (
    <svg className="slots-glyph" viewBox="0 0 40 40" aria-hidden>
      <circle className="sun" cx="20" cy="16" r="9" />
      <path className="ridge" d="M2 31l7.6-7.6 5.4 5.4 7-8.6 7 7.6 9 3.2V36H2z" />
      <path className="ink-stroke ray" d="M20 3v3M6.2 16h-3M33.8 16h3M9.6 6.2 7.5 4M30.4 6.2 32.5 4" />
    </svg>
  );
}

export function ScatterGlyph() {
  return (
    <svg className="slots-glyph" viewBox="0 0 40 40" aria-hidden>
      <path className="ribbon" d="M13.6 27 11 37l9-4.6 9 4.6-2.6-10" />
      <circle className="disc" cx="20" cy="17" r="11" />
      <circle className="disc-inner" cx="20" cy="17" r="7.6" />
      <path
        className="star"
        d="m20 10 2.5 5.1 5.6.8-4 3.9 1 5.6-5.1-2.7-5.1 2.7 1-5.6-4-3.9 5.6-.8z"
      />
    </svg>
  );
}

/** Étoile jackpot — distincte de la Médaille. */
export function JackpotStarGlyph() {
  return (
    <svg className="slots-glyph" viewBox="0 0 40 40" aria-hidden>
      <path
        className="jp-ray"
        d="M20 3.5v6.2M20 30.3v6.2M3.5 20h6.2M30.3 20h6.2M8.2 8.2l4.4 4.4M27.4 27.4l4.4 4.4M31.8 8.2l-4.4 4.4M12.6 27.4l-4.4 4.4"
      />
      <path
        className="jp-star"
        d="m20 8.2 3.2 6.6 7.3 1.1-5.3 5.1 1.2 7.2L20 24.8l-6.4 3.4 1.2-7.2-5.3-5.1 7.3-1.1z"
      />
    </svg>
  );
}

export function SymbolTile({ symbol, compact = false }: { symbol: SlotSymbol; compact?: boolean }) {
  if (symbol === 'bison') return <BisonGlyph />;
  if (symbol === 'eagle') return <EagleGlyph />;
  if (symbol === 'cougar') return <CougarGlyph />;
  if (symbol === 'wolf') return <WolfGlyph />;
  if (symbol === 'elk') return <ElkGlyph />;
  if (symbol === 'wild') {
    return (
      <span className={`slots-special${compact ? ' is-compact' : ''}`}>
        <WildGlyph />
        {!compact && <span className="slots-tag">Wild</span>}
      </span>
    );
  }
  if (symbol === 'scatter') {
    return (
      <span className={`slots-special${compact ? ' is-compact' : ''}`}>
        <ScatterGlyph />
        {!compact && <span className="slots-tag">Médaille</span>}
      </span>
    );
  }
  if (symbol === 'star') {
    return (
      <span className={`slots-special${compact ? ' is-compact' : ''}`}>
        <JackpotStarGlyph />
        {!compact && <span className="slots-tag">Jackpot</span>}
      </span>
    );
  }
  return <span className="slots-letter">{symbol}</span>;
}

