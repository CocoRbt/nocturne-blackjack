/// <reference types="node" />
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'child_process';
import { evaluateSpin, gridFromStops, BASE_STRIPS, FREE_STRIPS } from '../math';

type Fixture = {
  name: string;
  mode: 'base' | 'free';
  stops: number[];
  herdHeads?: number;
};

const FIXTURES: Fixture[] = [
  { name: 'aucune-victoire', mode: 'base', stops: [1, 2, 3, 4, 5] },
  { name: 'scatter-4', mode: 'base', stops: [10, 12, 14, 16, 0] },
  { name: 'jackpot-grand', mode: 'base', stops: [38, 38, 38, 38, 38] },
  { name: 'wild-base', mode: 'base', stops: [0, 0, 1, 2, 3] },
  { name: 'free-herd', mode: 'free', stops: [0, 0, 0, 0, 0], herdHeads: 7 },
  { name: 'near-max', mode: 'base', stops: [0, 0, 0, 0, 0] },
];

function sqlEval(fx: Fixture) {
  const stops = `ARRAY[${fx.stops.join(',')}]`;
  const herd = fx.herdHeads ?? 0;
  const query = `
    select row_to_json(r)
    from (
      select *
      from private.slots_evaluate_spin(${stops}, '${fx.mode}', ${herd}, decode(repeat('00',8),'hex'))
    ) r;
  `;
  const out = execFileSync(
    'sudo',
    ['-u', 'postgres', 'psql', '-d', process.env.PARITY_DB ?? 'nocturne_phase2d_final', '-Atc', query],
    { encoding: 'utf8' },
  ).trim();
  return JSON.parse(out);
}

describe('slots SQL parity fixtures', () => {
  for (const fx of FIXTURES) {
    it(fx.name, () => {
      const strips = fx.mode === 'free' ? FREE_STRIPS : BASE_STRIPS;
      const grid = gridFromStops(strips, fx.stops);
      const ts = evaluateSpin(grid, {
        freeSpinMode: fx.mode === 'free',
        herdHeads: fx.herdHeads ?? 0,
        rng: () => 0, // wilds déterministes 2×
      });
      const sql = sqlEval(fx);
      expect(Number(sql.scatter_count)).toBe(ts.scatterCount);
      expect(Number(sql.free_spins)).toBe(ts.freeSpins);
      expect(Number(sql.bison_landed)).toBe(ts.bisonLanded);
      expect(Number(sql.total_mult)).toBeCloseTo(ts.totalMult, 6);
    });
  }
});
