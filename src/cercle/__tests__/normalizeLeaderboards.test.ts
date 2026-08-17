import { describe, expect, it } from 'vitest';
import { normalizeLeaderboards } from '../circleApi';

describe('normalizeLeaderboards', () => {
  it('accepte un tableau JSON', () => {
    const boards = normalizeLeaderboards({
      live: [{ nickname: 'A', balance: 1, peak_balance: 2, is_me: false }],
      peak: [],
    });
    expect(boards.live).toHaveLength(1);
    expect(boards.peak).toEqual([]);
  });

  it('parse une string JSON (PostgREST parfois)', () => {
    const boards = normalizeLeaderboards({
      live: JSON.stringify([{ nickname: 'A', balance: 1, peak_balance: 2, is_me: false }]),
      peak: '[]',
    });
    expect(boards.live).toHaveLength(1);
    expect(boards.peak).toEqual([]);
  });
});
