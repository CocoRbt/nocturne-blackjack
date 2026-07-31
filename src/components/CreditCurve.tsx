import { useMemo } from 'react';
import { fmt } from '../lib/format';
import type { CreditSeriesPoint } from '../cercle/circleApi';

const PALETTE = ['#c2a15f', '#3ecfad', '#e0785a', '#8fafa0', '#d4a5c9', '#7eb4c8', '#e8c07a'];

type Series = {
  nickname: string;
  isMe: boolean;
  color: string;
  points: { t: number; balance: number }[];
};

function buildSeries(raw: CreditSeriesPoint[]): Series[] {
  const byNick = new Map<string, Series>();
  let colorIdx = 0;
  for (const p of raw) {
    let s = byNick.get(p.nickname);
    if (!s) {
      s = {
        nickname: p.nickname,
        isMe: p.is_me,
        color: p.is_me ? '#e8d5a3' : PALETTE[colorIdx++ % PALETTE.length],
        points: [],
      };
      byNick.set(p.nickname, s);
    }
    s.points.push({ t: new Date(p.t).getTime(), balance: p.balance });
  }
  return [...byNick.values()].filter((s) => s.points.length > 0);
}

/** Courbe multi-joueurs (SVG) — évolution des crédits du cercle. */
export function CreditCurve({
  data,
  emptyHint,
}: {
  data: CreditSeriesPoint[];
  emptyHint?: string;
}) {
  const series = useMemo(() => buildSeries(data), [data]);

  const chart = useMemo(() => {
    if (series.length === 0) return null;
    const all = series.flatMap((s) => s.points);
    const tMin = Math.min(...all.map((p) => p.t));
    const tMax = Math.max(...all.map((p) => p.t));
    const bMin = Math.min(...all.map((p) => p.balance));
    const bMax = Math.max(...all.map((p) => p.balance));
    const padT = tMax === tMin ? 1 : 0;
    const padB = bMax === bMin ? Math.max(100, bMax * 0.05) : 0;
    const x0 = tMin;
    const x1 = tMax + padT;
    const y0 = Math.max(0, bMin - padB);
    const y1 = bMax + padB;
    const W = 320;
    const H = 160;
    const L = 8;
    const R = 8;
    const T = 12;
    const B = 20;
    const innerW = W - L - R;
    const innerH = H - T - B;
    const x = (t: number) => L + ((t - x0) / (x1 - x0 || 1)) * innerW;
    const y = (bal: number) => T + (1 - (bal - y0) / (y1 - y0 || 1)) * innerH;

    const paths = series.map((s) => {
      const d = s.points
        .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.t).toFixed(1)},${y(p.balance).toFixed(1)}`)
        .join(' ');
      const last = s.points[s.points.length - 1];
      return { ...s, d, lastX: x(last.t), lastY: y(last.balance), lastBal: last.balance };
    });

    return { W, H, paths, y0, y1 };
  }, [series]);

  if (!chart) {
    return (
      <p className="credit-curve-empty">
        {emptyHint ?? 'Jouez quelques manches — la courbe se remplit au fil des syncs.'}
      </p>
    );
  }

  return (
    <div className="credit-curve">
      <svg viewBox={`0 0 ${chart.W} ${chart.H}`} className="credit-curve-svg" role="img" aria-label="Évolution des crédits">
        <line
          x1="8"
          x2={chart.W - 8}
          y1={chart.H - 20}
          y2={chart.H - 20}
          stroke="rgba(233,228,216,0.12)"
          strokeWidth="1"
        />
        {chart.paths.map((p) => (
          <g key={p.nickname}>
            <path
              d={p.d}
              fill="none"
              stroke={p.color}
              strokeWidth={p.isMe ? 2.4 : 1.6}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={p.isMe ? 1 : 0.75}
            />
            <circle cx={p.lastX} cy={p.lastY} r={p.isMe ? 3.5 : 2.5} fill={p.color} />
          </g>
        ))}
      </svg>
      <ul className="credit-curve-legend">
        {chart.paths.map((p) => (
          <li key={p.nickname} className={p.isMe ? 'me' : ''}>
            <span className="swatch" style={{ background: p.color }} />
            <span className="nick">{p.nickname}</span>
            <span className="bal">{fmt(p.lastBal)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
