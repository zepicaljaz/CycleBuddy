import { describe, expect, it } from 'vitest';
import { climbsInside, passedMarkBackward } from './climbRecord';

const climb = (start: number, end: number, length = end - start) => ({ id: `${start}`, start, end, length });

describe('climbs on a stage', () => {
  const climbs = [climb(1000, 3000), climb(8000, 12000), climb(14000, 14100, 100)];

  it('keeps named climbs that sit inside the stage and drops a short rise', () => {
    expect(climbsInside(climbs, 500, 13000).map((item) => item.id)).toEqual(['1000', '8000']);
  });

  it('uses the same window when the stage is ridden back toward the start', () => {
    expect(climbsInside(climbs, 13000, 500).map((item) => item.id)).toEqual(['1000', '8000']);
  });
});

describe('backward segment crossings', () => {
  const length = 40000;

  it('fires once when the rider rides down through a mark', () => {
    expect(passedMarkBackward(1005, 990, 1000, length)).toBe(true);
    expect(passedMarkBackward(990, 980, 1000, length)).toBe(false);
  });

  it('fires when the rider starts on the mark and leaves it', () => {
    expect(passedMarkBackward(1000, 990, 1000, length)).toBe(true);
  });

  it('follows a wrap from the start of the loop onto the end', () => {
    expect(passedMarkBackward(10, length - 20, 5, length)).toBe(true);
    expect(passedMarkBackward(10, length - 20, length - 10, length)).toBe(true);
    expect(passedMarkBackward(10, length - 20, length - 40, length)).toBe(false);
  });

  it('ignores a normal step forward', () => {
    expect(passedMarkBackward(100, 110, 105, length)).toBe(false);
  });
});
