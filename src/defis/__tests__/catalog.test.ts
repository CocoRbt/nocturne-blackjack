import { describe, expect, it } from 'vitest';
import { pickDailyDefis, todayKey } from '../catalog';

describe('défis du jour', () => {
  it('même jour → mêmes défis', () => {
    const a = pickDailyDefis('2026-07-30').map((d) => d.id);
    const b = pickDailyDefis('2026-07-30').map((d) => d.id);
    expect(a).toEqual(b);
    expect(a).toHaveLength(3);
  });

  it('jours différents → sélection différente', () => {
    const a = pickDailyDefis('2026-07-30').map((d) => d.id).join(',');
    const variants = ['2026-08-01', '2026-01-01', '2026-12-25', '2027-03-03'].map((d) =>
      pickDailyDefis(d).map((x) => x.id).join(','),
    );
    expect(variants.some((v) => v !== a)).toBe(true);
  });

  it('todayKey format', () => {
    expect(todayKey(new Date('2026-07-30T12:00:00'))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('privilégie des jeux distincts', () => {
    const picked = pickDailyDefis('2026-03-15');
    const games = new Set(picked.map((d) => d.game));
    expect(games.size).toBeGreaterThanOrEqual(2);
  });
});
