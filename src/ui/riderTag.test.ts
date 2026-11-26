import { describe, expect, it } from 'vitest';
import { gapClock, tagLines } from './riderTag';

const rider = { name: 'M. Bech', gcRank: 3, gcGap: 84 };

describe('tagLines', () => {
  it('shows only W/kg on a free ride and in training', () => {
    expect(tagLines('free', rider, 3.456)).toEqual({ wkg: '3.5 W/kg' });
    expect(tagLines('train', rider, 2)).toEqual({ wkg: '2.0 W/kg' });
  });

  it('adds the name on a hill-climb, without standings', () => {
    expect(tagLines('hillclimb', rider, 5.04)).toEqual({ name: 'M. Bech', wkg: '5.0 W/kg' });
  });

  it('adds overall place and gap in a career stage race', () => {
    expect(tagLines('career', rider, 4.2)).toEqual({ name: 'M. Bech', standing: { place: '4th overall', gap: '+1:24' }, wkg: '4.2 W/kg' });
    expect(tagLines('career', { name: 'A', gcRank: 0, gcGap: 0 }, 4).standing).toEqual({ place: '1st overall', gap: 'Leader' });
    expect(tagLines('career', { name: 'A', gcRank: 10, gcGap: 5 }, 4).standing?.place).toBe('11th overall');
  });

  it('leaves standings out of a one-day race or the first stage', () => {
    expect(tagLines('career', { name: 'A' }, 4).standing).toBeUndefined();
  });
});

describe('gapClock', () => {
  it('writes gaps like a results sheet', () => {
    expect(gapClock(42)).toBe('+0:42');
    expect(gapClock(725)).toBe('+12:05');
    expect(gapClock(3730)).toBe('+1:02:10');
  });
});
