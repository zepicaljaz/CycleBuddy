import { describe, expect, it } from 'vitest';
import {
  compareFtpTests,
  ftpChangeLabel,
  ftpFromTwentyMinutes,
  ftpInRange,
  ftpTestsFromRides,
  ftpTrend,
  isRampTestStep,
  RampTest,
  sampleTwentyMinute,
} from './ftp';

const window = { start: 480, end: 1680 };

describe('ramp FTP', () => {
  /** Ride one-minute steps from 70% of 250 W, `held` of them at target, then `after` seconds at `tail` watts. */
  function ride(held: number, opts: { tail?: number; after?: number; dt?: number; bias?: number } = {}): RampTest {
    const test = new RampTest();
    const dt = opts.dt ?? 0.25;
    const ftp = 250;
    const bias = opts.bias ?? 1;
    let t = 0;
    const total = held * 60 + (opts.after ?? 0);
    while (t < total - 1e-9) {
      const index = Math.floor(t / 60);
      const step = { start: index * 60, end: index * 60 + 60 };
      const asked = (0.7 + index * 0.05) * ftp * bias;
      const power = t < held * 60 ? asked : (opts.tail ?? 0);
      test.sample(index, step, dt, power, asked);
      t += dt;
    }
    return test;
  }

  it('is 75% of the best rolling 60-second average power', () => {
    const test = ride(6);
    expect(test.seconds.length).toBe(360);
    // The best minute is the last full step: (0.7 + 5 × 0.05) × 250 = 237.5 W.
    expect(test.best60).toBeCloseTo(237.5, 6);
    expect(test.estimate()).toBe(Math.round(237.5 * 0.75));
  });

  it('does not count a step touched for a moment', () => {
    const test = new RampTest();
    test.sample(0, { start: 0, end: 60 }, 0.25, 400, 175);
    for (let t = 0.25; t < 30; t += 0.25) test.sample(0, { start: 0, end: 60 }, 0.25, 0, 175);
    expect(test.lastHeld).toBe(0);
    expect(test.best60).toBeNull();
    expect(test.estimate()).toBeNull();
  });

  it('falls back to the last step held, at the watts the trainer asked for', () => {
    const test = new RampTest();
    // A 30-second step held, at an ERG bias of 0.9, then the next step abandoned.
    for (let t = 0; t < 30; t += 0.5) test.sample(0, { start: 0, end: 30 }, 0.5, 180, 200 * 0.9);
    for (let t = 0; t < 10; t += 0.5) test.sample(1, { start: 30, end: 60 }, 0.5, 20, 220 * 0.9);
    expect(test.best60).toBeNull();
    expect(test.lastHeld).toBeCloseTo(180, 6);
    expect(test.estimate()).toBe(135);
  });

  it('keeps the best minute when the rider stops, whatever the frame rate', () => {
    const smooth = ride(8, { after: 20, tail: 30, dt: 1 / 60 });
    const coarse = ride(8, { after: 20, tail: 30, dt: 0.4 });
    expect(smooth.estimate()).toBe(coarse.estimate());
    expect(smooth.estimate()).toBe(Math.round((0.7 + 7 * 0.05) * 250 * 0.75));
  });

  it('only scores the ramp steps, not the warm-up or cool-down', () => {
    expect(isRampTestStep({ fromPct: 0.65 })).toBe(false);
    expect(isRampTestStep({ fromPct: 0.7 })).toBe(true);
    expect(isRampTestStep({ fromPct: 1.45 })).toBe(true);
    expect(isRampTestStep({ fromPct: 0.6 })).toBe(false);
  });
});

describe('20-minute FTP', () => {
  it('turns the 20-minute average into 95 percent', () => {
    expect(ftpFromTwentyMinutes(200)).toBe(190);
    expect(ftpFromTwentyMinutes(250)).toBe(238);
    expect(ftpInRange(80)).toBe(true);
    expect(ftpInRange(550)).toBe(true);
    expect(ftpInRange(79)).toBe(false);
  });

  it('counts only the power inside the 20-minute window', () => {
    const before = sampleTwentyMinute({ joules: 0, sec: 0 }, window, 400, 400, 100);
    expect(before.window.sec).toBe(0);
    expect(before.ftp).toBeNull();

    const partial = sampleTwentyMinute({ joules: 0, sec: 0 }, window, 1000, 520, 250);
    expect(partial.window.sec).toBe(520);
    expect(partial.ftp).toBeNull();

    const full = sampleTwentyMinute({ joules: 0, sec: 0 }, window, 1680, 1200, 200);
    expect(full.average).toBe(200);
    expect(full.ftp).toBe(190);
  });

  it('keeps every saved test and compares it with the one before', () => {
    const tests = ftpTestsFromRides([
      { mode: 'train', startedAt: '2026-01-01T00:00:00.000Z', workout: { ftpEstimate: 200, ftpKind: 'twenty', ftpAverage: 211, weightKg: 72 } },
      { mode: 'free', startedAt: '2026-02-01T00:00:00.000Z', workout: { ftpEstimate: 999, ftpKind: 'twenty' } },
      { mode: 'train', startedAt: '2026-03-01T00:00:00.000Z', workout: { ftpEstimate: 220, ftpKind: 'ramp' } },
      { mode: 'train', startedAt: '2026-04-01T00:00:00.000Z', workout: { ftpEstimate: null, ftpKind: 'twenty' } },
      { mode: 'train', startedAt: '2026-06-01T00:00:00.000Z', workout: { ftpEstimate: 210, ftpKind: 'twenty', ftpAverage: 221 } },
      { mode: 'train', startedAt: '2025-12-01T00:00:00.000Z', workout: { ftpEstimate: 230 } },
    ]);
    const compared = compareFtpTests(tests);
    expect(compared.map((test) => test.ftp)).toEqual([210, 220, 200, 230]);
    expect(compared.map((test) => test.delta)).toEqual([-10, 20, -30, null]);
    expect(compared[0].kind).toBe('twenty');
    expect(compared[3].kind).toBe('ramp');
    expect(ftpChangeLabel(compared[1].delta)).toBe('+20 W');
    expect(ftpChangeLabel(null)).toBe('First test');
    expect(ftpTrend(compared)).toBe('Latest result 210 W, 20 W lower than the first saved test of 230 W.');
  });
});
