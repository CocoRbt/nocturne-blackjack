import { describe, expect, it } from 'vitest';
import { card } from '../cards';
import { handValue } from '../hand';

const h = (...codes: string[]) => codes.map((c, i) => card(c, `${c}-${i}`));

/** Miroir de HandView — soft : bas/haut (A+4 → 5/15). */
function softPairLabel(total: number) {
  return `${total - 10}/${total}`;
}

function displayTotal(codes: string[]) {
  const v = handValue(h(...codes));
  if (v.soft && v.total !== 21) return softPairLabel(v.total);
  return String(v.total);
}

describe('affichage soft 5/15', () => {
  it('A+4 → 5/15', () => expect(displayTotal(['AS', '4H'])).toBe('5/15'));
  it('A+6 → 7/17', () => expect(displayTotal(['AS', '6H'])).toBe('7/17'));
  it('A+9 → 10/20', () => expect(displayTotal(['AS', '9H'])).toBe('10/20'));
  it('A+A → 2/12', () => expect(displayTotal(['AS', 'AH'])).toBe('2/12'));
  it('A+6+10 → 17 hard', () => expect(displayTotal(['AS', '6H', '10D'])).toBe('17'));
  it('soft 21 reste 21', () => expect(displayTotal(['AS', '4H', '6D'])).toBe('21'));
});
