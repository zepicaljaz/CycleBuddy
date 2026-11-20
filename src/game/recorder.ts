import type { RideSample, RideSummary } from '../storage/types';
import { uuid } from '../util/math';

export interface LiveInput {
  power: number;
  cadence: number;
  heartRate: number;
  speed: number;
  distance: number;
  altitude: number;
  grade: number;
}

/** Records one sample per second of ride time and computes ride statistics. */
export class RideRecorder {
  readonly id = uuid();
  private readonly createdAt = new Date();
  private firstAddAt: Date | null = null;
  samples: RideSample[] = [];
  private acc = { t: 0, power: 0, cadence: 0, hr: 0 };
  private elapsed = 0;

  constructor(samples?: RideSample[]) {
    if (samples) {
      this.samples = samples;
      this.elapsed = samples.length ? samples[samples.length - 1].t + 1 : 0;
    }
  }

  /** When riding began: the first sample, not the moment the session was built (races count down first). */
  get startedAt(): Date {
    return this.firstAddAt ?? this.createdAt;
  }

  get elapsedSec(): number {
    return this.elapsed;
  }

  /**
   * Feed with every simulation step; emits a sample each full second (averaged power).
   * A long step is split across the seconds it covers, so each of them gets this
   * step's values and the part left over carries into the next second.
   */
  add(dt: number, input: LiveInput, now = Date.now()): void {
    if (!this.firstAddAt) this.firstAddAt = new Date(now - dt * 1000);
    let left = dt;
    while (left > 0) {
      const room = 1 - this.acc.t;
      const full = left >= room;
      const take = full ? room : left;
      this.acc.t += take;
      this.acc.power += input.power * take;
      this.acc.cadence += input.cadence * take;
      this.acc.hr += input.heartRate * take;
      left -= take;
      if (!full) break;
      this.samples.push({
        t: Math.round(this.elapsed),
        power: Math.round(this.acc.power),
        cadence: Math.round(this.acc.cadence),
        heartRate: Math.round(this.acc.hr),
        speed: +input.speed.toFixed(3),
        distance: +input.distance.toFixed(1),
        altitude: +input.altitude.toFixed(1),
        grade: +input.grade.toFixed(4),
      });
      this.elapsed += 1;
      this.acc = { t: 0, power: 0, cadence: 0, hr: 0 };
    }
  }

  summarize(meta: Pick<RideSummary, 'mode' | 'routeId' | 'routeName' | 'climbId' | 'title' | 'laps' | 'race' | 'workout'>): RideSummary {
    return summarizeSamples(this.id, this.startedAt, this.samples, meta);
  }
}

export function summarizeSamples(
  id: string,
  startedAt: Date,
  s: RideSample[],
  meta: Pick<RideSummary, 'mode' | 'routeId' | 'routeName' | 'climbId' | 'title' | 'laps' | 'race' | 'workout'>,
): RideSummary {
  const n = s.length;
  const avg = (f: (x: RideSample) => number, filter: (x: RideSample) => boolean = () => true) => {
    const list = s.filter(filter);
    return list.length ? list.reduce((a, x) => a + f(x), 0) / list.length : 0;
  };
  let ascent = 0;
  for (let i = 1; i < n; i++) ascent += Math.max(0, s[i].altitude - s[i - 1].altitude);
  // Normalized power: 30 s rolling average, 4th power mean, 4th root
  let np = 0;
  if (n >= 30) {
    let sum = 0;
    let acc4 = 0;
    for (let i = 0; i < n; i++) {
      sum += s[i].power;
      if (i >= 30) sum -= s[i - 30].power;
      if (i >= 29) acc4 += Math.pow(sum / 30, 4);
    }
    np = Math.pow(acc4 / (n - 29), 0.25);
  }
  const moving = s.filter((x) => x.speed > 0.5).length;
  const distance = n ? s[n - 1].distance : 0;
  const now = new Date().toISOString();
  return {
    id,
    createdAt: now,
    updatedAt: now,
    startedAt: startedAt.toISOString(),
    ...meta,
    durationSec: n,
    movingSec: moving,
    distanceM: distance,
    ascentM: ascent,
    avgPower: avg((x) => x.power),
    maxPower: s.reduce((m, x) => Math.max(m, x.power), 0),
    normalizedPower: np,
    avgCadence: avg((x) => x.cadence, (x) => x.cadence > 0),
    avgHeartRate: avg((x) => x.heartRate, (x) => x.heartRate > 0),
    maxHeartRate: s.reduce((m, x) => Math.max(m, x.heartRate), 0),
    avgSpeedKmh: moving ? (distance / moving) * 3.6 : 0,
    hasFit: n > 0,
  };
}
