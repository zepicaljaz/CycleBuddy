import type { FtpProtocol } from './workout';

/** A 20-minute average is a little above the power a rider can hold for an hour. */
export const TWENTY_MINUTE_FACTOR = 0.95;
export const FTP_MIN = 80;
export const FTP_MAX = 550;

export function ftpFromTwentyMinutes(averageWatts: number): number {
  return Math.round(averageWatts * TWENTY_MINUTE_FACTOR);
}

export function ftpInRange(watts: number): boolean {
  return watts >= FTP_MIN && watts <= FTP_MAX;
}

export interface TwentyWindow {
  joules: number;
  sec: number;
}

/**
 * Add the power that fell inside the 20-minute window.
 * The result is set once the clock has reached the end and nearly all of that window was recorded.
 */
export function sampleTwentyMinute(
  window: TwentyWindow,
  step: { start: number; end: number },
  rideTime: number,
  dt: number,
  power: number,
): { window: TwentyWindow; average: number | null; ftp: number | null } {
  const from = Math.max(step.start, rideTime - dt);
  const to = Math.min(step.end, rideTime);
  const span = Math.max(0, to - from);
  const next = span > 0 && power >= 0
    ? { joules: window.joules + power * span, sec: window.sec + span }
    : window;
  const length = step.end - step.start;
  const finished = rideTime + 0.001 >= step.end && next.sec >= length * 0.98 && next.sec > 0;
  if (!finished) return { window: next, average: null, ftp: null };
  const average = next.joules / next.sec;
  return { window: next, average: Math.round(average), ftp: ftpFromTwentyMinutes(average) };
}

/** Ramp test: FTP is this share of the best rolling 60-second average power. */
export const RAMP_FACTOR = 0.75;
/** Ramp-test steps start at 70% of FTP. The warm-up and cool-down sit below that. */
export const RAMP_TEST_FROM = 0.7;
/** A ramp step counts as held when its average power reached this share of the target. */
export const RAMP_HOLD = 0.85;

export function isRampTestStep(step: { fromPct: number; open?: boolean }): boolean {
  return !step.open && step.fromPct >= RAMP_TEST_FROM - 1e-9;
}

/**
 * Power through a ramp test, one value per second. The estimate is
 * RAMP_FACTOR × the best rolling 60-second average. Before a full minute has been
 * ridden, it falls back to the target of the last step held for the whole step.
 */
export class RampTest {
  /** Average power of every whole second of the test. */
  readonly seconds: number[] = [];
  /** Best 60-second average so far. Null until a full minute is in. */
  best60: number | null = null;
  /** Target watts of the last step whose whole-step average reached RAMP_HOLD of that target. */
  lastHeld = 0;
  private partJ = 0;
  private partSec = 0;
  private rolling = 0;
  private step = { index: -1, length: 0, joules: 0, askedJ: 0, sec: 0 };

  /** `asked` is the target the rider was given, ERG bias included. */
  sample(stepIndex: number, step: { start: number; end: number }, dt: number, power: number, asked: number): void {
    if (!(dt > 0)) return;
    const watts = Math.max(0, power);
    if (stepIndex !== this.step.index) {
      this.closeStep();
      this.step = { index: stepIndex, length: step.end - step.start, joules: 0, askedJ: 0, sec: 0 };
    }
    this.step.joules += watts * dt;
    this.step.askedJ += asked * dt;
    this.step.sec += dt;
    let left = dt;
    while (left > 1e-9) {
      const take = Math.min(left, 1 - this.partSec);
      this.partJ += watts * take;
      this.partSec += take;
      left -= take;
      if (this.partSec >= 1 - 1e-9) {
        this.pushSecond(this.partJ / this.partSec);
        this.partJ = 0;
        this.partSec = 0;
      }
    }
  }

  /** Watts, or null when nothing usable was ridden. */
  estimate(): number | null {
    this.closeStep();
    if (this.best60 != null) return Math.round(this.best60 * RAMP_FACTOR);
    if (this.lastHeld > 0) return Math.round(this.lastHeld * RAMP_FACTOR);
    return null;
  }

  private pushSecond(watts: number): void {
    const s = this.seconds;
    s.push(watts);
    this.rolling += watts;
    if (s.length > 60) this.rolling -= s[s.length - 61];
    if (s.length >= 60) {
      const avg = this.rolling / 60;
      if (this.best60 == null || avg > this.best60) this.best60 = avg;
    }
  }

  private closeStep(): void {
    const step = this.step;
    if (step.index < 0 || step.sec <= 0) return;
    // A step is held only when it was ridden to the end at RAMP_HOLD of its target on average.
    if (step.sec >= step.length * 0.95 && step.joules >= step.askedJ * RAMP_HOLD) this.lastHeld = step.askedJ / step.sec;
  }
}

export interface FtpTestRecord {
  at: string;
  kind: FtpProtocol;
  ftp: number;
  average: number | null;
  previousFtp: number | null;
  weightKg: number | null;
}

export interface ComparedFtpTest extends FtpTestRecord {
  /** Watts versus the saved test before this one. Null on the first test. */
  delta: number | null;
}

export function ftpTestsFromRides(
  rides: {
    mode?: string;
    startedAt?: string;
    workout?: {
      ftpEstimate?: number | null;
      ftpKind?: FtpProtocol | null;
      ftpAverage?: number | null;
      previousFtp?: number | null;
      weightKg?: number | null;
    } | null;
  }[],
): FtpTestRecord[] {
  const tests: FtpTestRecord[] = [];
  for (const ride of rides) {
    const workout = ride.workout;
    const ftp = workout?.ftpEstimate;
    if (ride.mode !== 'train' || !workout || ftp == null || !(ftp > 0)) continue;
    const kind = workout.ftpKind === 'twenty' || workout.ftpKind === 'ramp' ? workout.ftpKind : 'ramp';
    tests.push({
      at: ride.startedAt || '',
      kind,
      ftp: Math.round(ftp),
      average: workout.ftpAverage != null && workout.ftpAverage > 0 ? Math.round(workout.ftpAverage) : null,
      previousFtp: workout.previousFtp != null && workout.previousFtp > 0 ? Math.round(workout.previousFtp) : null,
      weightKg: workout.weightKg != null && workout.weightKg > 0 ? workout.weightKg : null,
    });
  }
  return tests;
}

/** Newest first. `delta` is against the test that happened before it. */
export function compareFtpTests(tests: FtpTestRecord[]): ComparedFtpTest[] {
  const chronological = [...tests].sort((a, b) => a.at.localeCompare(b.at));
  let previous: number | null = null;
  const compared = chronological.map((test) => {
    const delta = previous == null ? null : test.ftp - previous;
    previous = test.ftp;
    return { ...test, delta };
  });
  return compared.reverse();
}

export function ftpChangeLabel(delta: number | null): string {
  if (delta == null) return 'First test';
  if (delta === 0) return 'No change';
  if (delta > 0) return `+${delta} W`;
  return `${delta} W`;
}

export function ftpTrend(tests: ComparedFtpTest[]): string | null {
  if (!tests.length) return null;
  const latest = tests[0];
  const first = tests[tests.length - 1];
  if (tests.length === 1) return `One saved test: ${latest.ftp} W.`;
  const delta = latest.ftp - first.ftp;
  const way = delta > 0 ? `${delta} W higher` : delta < 0 ? `${Math.abs(delta)} W lower` : 'the same';
  return `Latest result ${latest.ftp} W, ${way} than the first saved test of ${first.ftp} W.`;
}

export function formatFtpDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
