import { describe, expect, it } from 'vitest';
import { authEmailRedirectTo } from '../accountAuth';

describe('authEmailRedirectTo', () => {
  it('retourne une URL http(s) utilisable', () => {
    const url = authEmailRedirectTo();
    expect(url).toMatch(/^https?:\/\//);
    expect(url.includes('localhost:3000')).toBe(false);
  });
});
