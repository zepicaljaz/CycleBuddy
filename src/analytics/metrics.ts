/**
 * Training metrics for the Analytics page.
 *
 * Load follows the power-based model used across cycling software (Coggan / TrainingPeaks):
 * Normalized Power, Intensity Factor (NP / FTP) and Training Stress Score (one hour at FTP = 100).
 * Fitness, fatigue and form are exponentially weighted daily load (42 and 7 days), form being
 * yesterday's fitness minus yesterday's fatigue. Sources are listed in docs/ANALYTICS.md.
 */
import type { RideSample, RideSummary } from '../storage/types';
import { ZONES } from '../training/workout';

export const FITNESS_DAYS = 42;
export const FATIGUE_DAYS = 7;

/** Durations on the power curve, in seconds. */
export const CURVE_SECONDS = [1, 5, 10, 15, 30, 60, 120, 180, 300, 480, 600, 1200, 1800, 2700, 3600, 5400, 7200] as const;
/** The durations riders quote: sprint, anaerobic, VO2max, threshold, endurance. */
export const KEY_SECONDS = [5, 60, 300, 1200, 3600] as const;

export type AnalyticsRange = '6w' | '3m' | '6m' | '1y' | 'all';

export const RANGES: { id: AnalyticsRange; label: string; days: number | null }[] = [
  { id: '6w', label: '6 weeks', days: 42 },
  { id: '3m', label: '3 months', days: 91 },
  { id: '6m', label: '6 months', days: 182 },
  { id: '1y', label: '1 year', days: 365 },
  { id: 'all', label: 'All time', days: null },
];

export interface RideLoad {
  /** Normalized Power, or average power when the ride is too short for NP. */
  np: number;
  ftp: number;
  intensity: number;
  tss: number;
  /** Variability index: NP / average power. 1.00 is perfectly steady. */
  vi: number | null;
  /** Mechanical work in kilojoules. */
  kj: number;
  /** Efficiency factor: NP / average heart rate. Null without heart rate or under 20 minutes. */
  ef: number | null;
}

export interface DayLoad {
  key: string;
  date: Date;
  tss: number;
  fitness: number;
  fatigue: number;
  /** Fitness minus fatigue at the end of the day before. */
  form: number;
}

export interface FormBand {
  id: 'transition' | 'fresh' | 'neutral' | 'optimal' | 'risk';
  label: string;
  advice: string;
}

export interface PowerData {
  /** Best average power for each of CURVE_SECONDS. Null when the ride is shorter. */
  best: (number | null)[];
  /** Seconds in each power zone (ZONES order). */
  zones: number[];
  /** Pw:HR decoupling in percent, first half vs second half. Null without heart rate or under 20 minutes. */
  decoupling: number | null;
}

export interface CurvePoint {
  sec: number;
  watts: number | null;
  rideId: string | null;
  at: string | null;
}

// ---------- FTP over time

/**
 * The FTP a ride was scored against. Accepted FTP tests set it from their day on.
 * Rides after the last test use the profile, which may have been edited since.
 */
export function ftpTimeline(rides: RideSummary[], profileFtp: number): (ride: Pick<RideSummary, 'startedAt'>) => number {
  const fallback = profileFtp > 0 ? profileFtp : 200;
  const tests = rides
    .filter((ride) => ride.workout?.ftpEstimate != null && ride.workout.ftpEstimate >= 80 && ride.workout.ftpEstimate <= 550)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  if (!tests.length) return () => fallback;
  const lastAt = tests[tests.length - 1].startedAt;
  const before = tests[0].workout?.previousFtp;
  const first = before && before > 0 ? before : fallback;
  return (ride) => {
    if (ride.startedAt > lastAt) return fallback;
    let ftp = first;
    for (const test of tests) {
      if (test.startedAt > ride.startedAt) break;
      ftp = test.workout!.ftpEstimate!;
    }
    return ftp;
  };
}

export interface FtpChange {
  at: string;
  ftp: number;
  previous: number | null;
}

export function ftpHistory(rides: RideSummary[]): FtpChange[] {
  return rides
    .filter((ride) => ride.workout?.ftpEstimate != null && ride.workout.ftpEstimate >= 80 && ride.workout.ftpEstimate <= 550)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
    .map((ride) => ({ at: ride.startedAt, ftp: ride.workout!.ftpEstimate!, previous: ride.workout!.previousFtp ?? null }));
}

// ---------- One ride

export function rideLoad(ride: RideSummary, ftp: number): RideLoad {
  const seconds = Math.max(0, num(ride.durationSec) || num(ride.movingSec));
  const avg = num(ride.avgPower);
  const np = num(ride.normalizedPower) > 0 ? num(ride.normalizedPower) : avg;
  const safeFtp = ftp > 0 ? ftp : 200;
  const intensity = np / safeFtp;
  const tss = seconds > 0 && np > 0 ? ((seconds * np * intensity) / (safeFtp * 3600)) * 100 : 0;
  const hr = num(ride.avgHeartRate);
  return {
    np,
    ftp: safeFtp,
    intensity,
    tss,
    vi: avg > 0 && np > 0 ? np / avg : null,
    kj: (avg * seconds) / 1000,
    ef: hr > 40 && seconds >= 1200 && np > 0 ? np / hr : null,
  };
}

/** Best efforts, time in zones and decoupling, read from the 1 Hz samples of a ride. */
export function powerData(samples: RideSample[], ftp: number): PowerData {
  const watts = samples.map((sample) => (Number.isFinite(sample.power) && sample.power > 0 ? sample.power : 0));
  const prefix = new Float64Array(watts.length + 1);
  for (let i = 0; i < watts.length; i++) prefix[i + 1] = prefix[i] + watts[i];
  const best = CURVE_SECONDS.map((sec) => {
    if (watts.length < sec) return null;
    let top = 0;
    for (let i = sec; i <= watts.length; i++) {
      const avg = (prefix[i] - prefix[i - sec]) / sec;
      if (avg > top) top = avg;
    }
    return top > 0 ? top : null;
  });
  const zones = new Array<number>(ZONES.length).fill(0);
  const safeFtp = ftp > 0 ? ftp : 200;
  for (const w of watts) {
    if (!(w > 0)) continue;
    const pct = w / safeFtp;
    const index = ZONES.findIndex((zone) => pct < zone.max);
    zones[index < 0 ? ZONES.length - 1 : index] += 1;
  }
  return { best, zones, decoupling: decoupling(samples) };
}

/** Pw:HR: how much the power-to-heart-rate ratio fell from the first half of the ride to the second. */
export function decoupling(samples: RideSample[]): number | null {
  const usable = samples.filter((sample) => sample.heartRate > 40 && Number.isFinite(sample.power));
  if (usable.length < 1200 || usable.length < samples.length * 0.8) return null;
  const half = Math.floor(usable.length / 2);
  const ratio = (list: RideSample[]) => {
    const power = list.reduce((sum, sample) => sum + Math.max(0, sample.power), 0);
    const hr = list.reduce((sum, sample) => sum + sample.heartRate, 0);
    return hr > 0 ? power / hr : 0;
  };
  const first = ratio(usable.slice(0, half));
  const second = ratio(usable.slice(half));
  if (!(first > 0)) return null;
  return ((first - second) / first) * 100;
}

// ---------- Many rides

export function rangeStart(range: AnalyticsRange, now: Date, rides: RideSummary[]): Date {
  const days = RANGES.find((item) => item.id === range)?.days;
  if (days != null) return startOfDay(addDays(now, -(days - 1)));
  const oldest = rides.reduce<string | null>((min, ride) => (min == null || ride.startedAt < min ? ride.startedAt : min), null);
  const at = oldest ? new Date(oldest) : now;
  return startOfDay(Number.isNaN(at.getTime()) ? now : at);
}

export function rangeDays(range: AnalyticsRange, now: Date, rides: RideSummary[]): number {
  const start = rangeStart(range, now, rides);
  return Math.max(1, Math.round((startOfDay(now).getTime() - start.getTime()) / 86400000) + 1);
}

/** Rides from the start of the range to the end of today. */
export function ridesInRange(rides: RideSummary[], range: AnalyticsRange, now: Date): RideSummary[] {
  const from = rangeStart(range, now, rides).getTime();
  const end = startOfDay(addDays(now, 1)).getTime();
  return rides.filter((ride) => {
    const at = Date.parse(ride.startedAt);
    return Number.isFinite(at) && at >= from && at < end;
  });
}

/** The same number of days just before the range. Empty for all time. */
export function ridesBeforeRange(rides: RideSummary[], range: AnalyticsRange, now: Date): RideSummary[] {
  if (range === 'all') return [];
  const start = rangeStart(range, now, rides);
  const days = rangeDays(range, now, rides);
  const from = addDays(start, -days).getTime();
  return rides.filter((ride) => {
    const at = Date.parse(ride.startedAt);
    return Number.isFinite(at) && at >= from && at < start.getTime();
  });
}

/** Daily load, fitness, fatigue and form from the first ride to today. */
export function loadSeries(rides: RideSummary[], ftpOf: (ride: RideSummary) => number, now: Date): DayLoad[] {
  const byDay = new Map<string, number>();
  let first: Date | null = null;
  for (const ride of rides) {
    const at = new Date(ride.startedAt);
    if (Number.isNaN(at.getTime())) continue;
    const key = dayKeyOf(at);
    byDay.set(key, (byDay.get(key) ?? 0) + rideLoad(ride, ftpOf(ride)).tss);
    if (!first || at < first) first = at;
  }
  if (!first) return [];
  const out: DayLoad[] = [];
  const end = startOfDay(now);
  let fitness = 0;
  let fatigue = 0;
  for (let day = startOfDay(first); day <= end; day = addDays(day, 1)) {
    const key = dayKeyOf(day);
    const tss = byDay.get(key) ?? 0;
    const form = fitness - fatigue;
    fitness += (tss - fitness) / FITNESS_DAYS;
    fatigue += (tss - fatigue) / FATIGUE_DAYS;
    out.push({ key, date: day, tss, fitness, fatigue, form });
  }
  return out;
}

/** The common reading of form (TSB), from "very fresh" down to "overreaching". */
export function formBand(form: number): FormBand {
  if (form > 25) return { id: 'transition', label: 'Very fresh', advice: 'Rested for a long time. Fitness is starting to fade.' };
  if (form > 5) return { id: 'fresh', label: 'Fresh', advice: 'Good day for a race, a test or a hard climb.' };
  if (form >= -10) return { id: 'neutral', label: 'Neutral', advice: 'Holding steady. Fine for any ride.' };
  if (form >= -30) return { id: 'optimal', label: 'Building', advice: 'Training is adding fitness. Keep recovery days in.' };
  return { id: 'risk', label: 'Overreaching', advice: 'Fatigue is high. Ride easy or rest for a few days.' };
}

/** Change in fitness over the last seven days. Up to about 5 a week is a steady build. */
export function rampRate(series: DayLoad[]): number | null {
  if (series.length < 8) return null;
  return series[series.length - 1].fitness - series[series.length - 8].fitness;
}

/** Best of each duration across rides, remembering which ride set it. */
export function mergeCurves(rides: RideSummary[], data: ReadonlyMap<string, PowerData>): CurvePoint[] {
  return CURVE_SECONDS.map((sec, i) => {
    let watts: number | null = null;
    let rideId: string | null = null;
    let at: string | null = null;
    for (const ride of rides) {
      const value = data.get(ride.id)?.best[i];
      if (value != null && (watts == null || value > watts)) {
        watts = value;
        rideId = ride.id;
        at = ride.startedAt;
      }
    }
    return { sec, watts, rideId, at };
  });
}

export function sumZones(rides: RideSummary[], data: ReadonlyMap<string, PowerData>): number[] {
  const total = new Array<number>(ZONES.length).fill(0);
  for (const ride of rides) {
    const zones = data.get(ride.id)?.zones;
    if (!zones) continue;
    zones.forEach((sec, i) => (total[i] += sec));
  }
  return total;
}

/** 95 % of the best 20 minutes: the usual field estimate of FTP. */
export function estimateFtp(curve: CurvePoint[]): number | null {
  const twenty = curve.find((point) => point.sec === 1200)?.watts;
  return twenty != null && twenty > 0 ? Math.round(twenty * 0.95) : null;
}

export function zoneRanges(ftp: number): { name: string; color: string; from: number; to: number | null }[] {
  let from = 0;
  return ZONES.map((zone) => {
    const to = Number.isFinite(zone.max) ? Math.round(zone.max * ftp) - 1 : null;
    const out = { name: zone.name, color: zone.color, from, to };
    from = to == null ? from : to + 1;
    return out;
  });
}

export function durationLabel(sec: number): string {
  if (sec < 60) return `${sec} s`;
  if (sec < 3600) return `${Math.round(sec / 60)} min`;
  const h = sec / 3600;
  return Number.isInteger(h) ? `${h} h` : `${h.toFixed(1)} h`;
}

function dayKeyOf(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function num(value: number): number {
  return Number.isFinite(value) ? value : 0;
}
