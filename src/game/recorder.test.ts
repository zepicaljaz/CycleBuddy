import { describe, expect, it } from 'vitest';
import { RideRecorder, type LiveInput } from './recorder';

const input = (power: number): LiveInput => ({ power, cadence: 90, heartRate: 140, speed: 9, distance: 100, altitude: 5, grade: 0.01 });

describe('RideRecorder', () => {
  it('averages power over each second', () => {
    const r = new RideRecorder();
    for (let i = 0; i < 60; i++) r.add(1 / 60, input(i < 30 ? 100 : 300));
    expect(r.samples).toHaveLength(1);
    expect(r.samples[0].power).toBe(200);
  });

  it('gives every second of a long step the same values', () => {
    const r = new RideRecorder();
    r.add(0.5, input(100));
    r.add(2.75, input(300));
    expect(r.samples.map((s) => s.power)).toEqual([200, 300, 300]);
    expect(r.samples.map((s) => s.cadence)).toEqual([90, 90, 90]);
    expect(r.samples.map((s) => s.heartRate)).toEqual([140, 140, 140]);
    // The 0.25 s left over carries into the next second.
    r.add(0.75, input(100));
    expect(r.samples.map((s) => s.power)).toEqual([200, 300, 300, 150]);
    expect(r.samples.map((s) => s.t)).toEqual([0, 1, 2, 3]);
  });

  it('starts the clock at the first sample, not when it was built', () => {
    const r = new RideRecorder();
    const built = r.startedAt.getTime();
    const at = built + 10_000;
    r.add(0.5, input(200), at);
    expect(r.startedAt.getTime()).toBe(at - 500);
    r.add(0.5, input(200), at + 500);
    expect(r.startedAt.getTime()).toBe(at - 500);
  });
});
