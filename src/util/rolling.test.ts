import { describe, expect, it } from 'vitest';
import { RollingMean } from './rolling';

describe('RollingMean', () => {
  it('matches a shifted array', () => {
    const r = new RollingMean(400);
    const ref: number[] = [];
    for (let i = 0; i < 5000; i++) {
      const v = (i * 37) % 451;
      const limit = i < 2500 ? 180 : 60 + (i % 7);
      r.push(v, limit);
      ref.push(v);
      while (ref.length > limit) ref.shift();
      expect(r.mean).toBeCloseTo(ref.reduce((a, b) => a + b, 0) / ref.length, 9);
    }
  });

  it('is empty at first', () => {
    expect(new RollingMean(10).mean).toBe(0);
  });
});
