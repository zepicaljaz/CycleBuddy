import { describe, expect, it } from 'vitest';
import { tailAnchor } from './convoy';
import type { LaneUser } from './traffic';

function rider(s: number, broom = false): LaneUser {
  return { s, lat: 0.5, speed: 12, dir: 1, broom };
}

describe('time trial tail bike', () => {
  it('waits at the ramp until the last rider leaves, then follows that rider', () => {
    const ramp = { s: 1000, dir: 1 as const };
    const early = [rider(1040), rider(1010)];
    expect(tailAnchor(early, ramp)).toBe(986);
    expect(tailAnchor([...early, rider(1000, true)], ramp)).toBe(986);
    expect(tailAnchor([...early, rider(1180, true)], ramp)).toBe(1166);
  });

  it('follows the back of a road race', () => {
    expect(tailAnchor([rider(500), rider(480), rider(510)])).toBe(466);
  });
});
