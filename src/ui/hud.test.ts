import { describe, expect, it } from 'vitest';
import { ttStartCue } from './hud';

describe('time trial start countdown', () => {
  it('counts the whole wait under the stage, and the last 10 seconds in the centre', () => {
    expect(ttStartCue(false, 0, 40)).toEqual({ big: null, wait: null });
    expect(ttStartCue(true, 0, 40)).toEqual({ big: null, wait: '0:40' });
    expect(ttStartCue(true, 30.2, 40)).toEqual({ big: '10', wait: '0:10' });
    expect(ttStartCue(true, 37.1, 40)).toEqual({ big: '3', wait: '0:03' });
    expect(ttStartCue(true, 40, 40)).toEqual({ big: 'GO!', wait: null });
    expect(ttStartCue(true, 42, 40)).toEqual({ big: null, wait: null });
  });

  it('keeps the opening GO when you are the first rider', () => {
    expect(ttStartCue(true, 0.2, 0)).toEqual({ big: 'GO!', wait: null });
    expect(ttStartCue(true, 3, 0)).toEqual({ big: null, wait: null });
  });
});
