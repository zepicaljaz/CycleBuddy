import { ROUTES } from '../routes/definitions';
import type { Difficulty } from '../routes/types';
import type { ClimbEffort, RideSummary } from '../storage/types';
import { flattenWorkouts, planById } from '../training/plans';
import { routeElevations } from './shape';

/** How a saved ride was started. Career stages are stored as races, with the stage name as the title. */
export type RideKind = 'free' | 'train' | 'race' | 'career';

export const KIND_LABEL: Record<RideKind, string> = {
  free: 'Free ride',
  train: 'Training',
  race: 'Hill climb',
  career: 'Career',
};

export type RideSortKey = 'name' | 'date' | 'type' | 'distance' | 'time' | 'elevation' | 'power' | 'segmentPower';

export interface Totals {
  sessions: number;
  distanceM: number;
  ascentM: number;
  movingSec: number;
}

export interface MonthBucket {
  key: string;
  label: string;
  /** Full month name, used in the hover tip. */
  title: string;
  distanceM: number;
  ascentM: number;
  sessions: number;
}

export interface WeekPoint {
  key: string;
  label: string;
  title: string;
  sessions: number;
  distanceM: number;
  ascentM: number;
  /** Average power weighted by moving time. Null when the week has no riding. */
  avgPower: number | null;
}

export interface Delta {
  current: number;
  previous: number;
  /** Null when the previous period had nothing to compare with and this one has some. */
  pct: number | null;
}

export interface RouteChoice {
  id: string;
  name: string;
  difficulty: Difficulty | null;
  elevations: number[];
}

export interface SegmentChoice {
  climbId: string;
  climbName: string;
  routeId: string;
  routeName: string;
}

export const POWER_WINDOW = 16;
export const POWER_PAGE = 8;

export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  flat: 'Flat',
  hilly: 'Hilly',
  mountain: 'Mountain',
  epic: 'Epic',
};

export interface RideRow {
  ride: RideSummary;
  kind: RideKind;
  /** Time-weighted average of the segment efforts on this ride. */
  segmentPower: number | null;
}

export interface SegmentAttempt {
  effort: ClimbEffort;
  rideTitle: string;
  speedKmh: number | null;
}

export interface SegmentSeries {
  climbId: string;
  climbName: string;
  routeId: string;
  routeName: string;
  lengthM: number | null;
  best: ClimbEffort;
  /** Oldest first, for the comparison chart. */
  attempts: SegmentAttempt[];
  /** Newest first, for the table. */
  rows: SegmentAttempt[];
}

export interface GoalItem {
  id: string;
  at: string;
  title: string;
  detail: string;
  kind: 'plan' | 'workout' | 'race';
}

export interface CalendarDay {
  date: Date;
  key: string;
  inMonth: boolean;
  rides: RideSummary[];
}

export function rideKind(ride: Pick<RideSummary, 'mode' | 'title'>): RideKind {
  if (ride.mode === 'free') return 'free';
  if (ride.mode === 'train') return 'train';
  if (ride.title.startsWith('Hill-climb race')) return 'race';
  return 'career';
}

export function rideMovingSec(ride: Pick<RideSummary, 'movingSec' | 'durationSec'>): number {
  const moving = num(ride.movingSec);
  return moving > 0 ? moving : num(ride.durationSec);
}

export function totals(rides: RideSummary[]): Totals {
  const sum: Totals = { sessions: 0, distanceM: 0, ascentM: 0, movingSec: 0 };
  for (const ride of rides) {
    sum.sessions += 1;
    sum.distanceM += num(ride.distanceM);
    sum.ascentM += num(ride.ascentM);
    sum.movingSec += rideMovingSec(ride);
  }
  return sum;
}

/** Rides started on today or one of the previous calendar days. Thirty includes today. */
export function ridesSince(rides: RideSummary[], now: Date, days: number): RideSummary[] {
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (Math.max(1, days) - 1)).getTime();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
  return rides.filter((ride) => {
    const at = Date.parse(ride.startedAt);
    return Number.isFinite(at) && at >= from && at < end;
  });
}

export function byNewest(rides: RideSummary[]): RideSummary[] {
  return [...rides].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export function countKinds(rides: RideSummary[]): Record<RideKind, number> {
  const counts: Record<RideKind, number> = { free: 0, train: 0, race: 0, career: 0 };
  for (const ride of rides) counts[rideKind(ride)] += 1;
  return counts;
}

export function monthlyActivity(rides: RideSummary[], now: Date, months = 12, shift = 0): MonthBucket[] {
  const count = Math.max(1, months);
  const buckets: MonthBucket[] = [];
  const cursor = new Date(now.getFullYear(), now.getMonth() - (count - 1) - Math.max(0, shift), 1);
  for (let i = 0; i < count; i++) {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    buckets.push({
      key: monthKey(year, month),
      label: cursor.toLocaleString(undefined, { month: 'short' }),
      title: cursor.toLocaleString(undefined, { month: 'long', year: 'numeric' }),
      distanceM: 0,
      ascentM: 0,
      sessions: 0,
    });
    cursor.setMonth(month + 1);
  }
  const years = new Set(buckets.map((bucket) => bucket.key.slice(0, 4)));
  if (years.size > 1) {
    for (const bucket of buckets) {
      const [year, month] = bucket.key.split('-');
      if (bucket === buckets[0] || month === '01') {
        const date = new Date(Number(year), Number(month) - 1, 1);
        bucket.label = `${date.toLocaleString(undefined, { month: 'short' })} ${year.slice(2)}`;
      }
    }
  }
  const index = new Map(buckets.map((bucket, i) => [bucket.key, i]));
  for (const ride of rides) {
    const at = new Date(ride.startedAt);
    if (Number.isNaN(at.getTime())) continue;
    const slot = index.get(monthKey(at.getFullYear(), at.getMonth()));
    if (slot === undefined) continue;
    buckets[slot].distanceM += num(ride.distanceM);
    buckets[slot].ascentM += num(ride.ascentM);
    buckets[slot].sessions += 1;
  }
  return buckets;
}

export function weeklySeries(rides: RideSummary[], now: Date, weeks = 12, shift = 0): WeekPoint[] {
  const count = Math.max(1, weeks);
  const end = addDays(mondayOf(now), -Math.max(0, shift) * 7);
  const points: WeekPoint[] = [];
  for (let i = 0; i < count; i++) {
    const start = addDays(end, (i - (count - 1)) * 7);
    points.push({
      key: dayKey(start),
      label: weekLabel(start, now),
      title: `Week of ${start.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}`,
      sessions: 0,
      distanceM: 0,
      ascentM: 0,
      avgPower: null,
    });
  }
  const index = new Map(points.map((point, i) => [point.key, i]));
  const power = new Array<number>(count).fill(0);
  const weight = new Array<number>(count).fill(0);
  for (const ride of rides) {
    const at = new Date(ride.startedAt);
    if (Number.isNaN(at.getTime())) continue;
    const slot = index.get(dayKey(mondayOf(at)));
    if (slot === undefined) continue;
    points[slot].sessions += 1;
    points[slot].distanceM += num(ride.distanceM);
    points[slot].ascentM += num(ride.ascentM);
    const seconds = rideMovingSec(ride);
    if (seconds > 0) {
      power[slot] += num(ride.avgPower) * seconds;
      weight[slot] += seconds;
    }
  }
  for (let i = 0; i < count; i++) {
    points[i].avgPower = weight[i] > 0 ? power[i] / weight[i] : null;
  }
  return points;
}

/** How far the 12-month window can slide back and still end on a month with a ride. */
export function maxMonthShift(rides: RideSummary[], now: Date): number {
  const oldest = oldestRide(rides);
  if (!oldest) return 0;
  return Math.max(0, (now.getFullYear() - oldest.getFullYear()) * 12 + (now.getMonth() - oldest.getMonth()));
}

export function maxWeekShift(rides: RideSummary[], now: Date): number {
  const oldest = oldestRide(rides);
  if (!oldest) return 0;
  const weeks = Math.round((mondayOf(now).getTime() - mondayOf(oldest).getTime()) / (7 * 86400000));
  return Math.max(0, weeks);
}

/** Newest rides first are skipped, then the window is drawn oldest to newest. */
export function powerTrend(rides: RideSummary[], skip = 0, count = POWER_WINDOW): RideSummary[] {
  const ordered = byNewest(rides);
  const start = Math.max(0, Math.min(skip, Math.max(0, ordered.length - 1)));
  return ordered.slice(start, start + count).reverse();
}

export function maxPowerSkip(rideCount: number, window = POWER_WINDOW): number {
  return Math.max(0, rideCount - window);
}

export function delta(current: number, previous: number): Delta {
  if (!(previous > 0)) return { current, previous, pct: current > 0 ? null : 0 };
  return { current, previous, pct: ((current - previous) / previous) * 100 };
}

/** The 30 days before the current 30-day window. */
export function ridesBefore(rides: RideSummary[], now: Date, days: number): RideSummary[] {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const recentStart = new Date(today);
  recentStart.setDate(recentStart.getDate() - (Math.max(1, days) - 1));
  const priorStart = new Date(recentStart);
  priorStart.setDate(priorStart.getDate() - Math.max(1, days));
  return rides.filter((ride) => {
    const at = Date.parse(ride.startedAt);
    return Number.isFinite(at) && at >= priorStart.getTime() && at < recentStart.getTime();
  });
}

export function ridesInYear(rides: RideSummary[], year: number): RideSummary[] {
  return rides.filter((ride) => {
    const at = new Date(ride.startedAt);
    return !Number.isNaN(at.getTime()) && at.getFullYear() === year;
  });
}

export function effortRouteKey(effort: Pick<ClimbEffort, 'routeId' | 'routeName'>): string {
  if (effort.routeId) return effort.routeId;
  return `name:${(effort.routeName || 'Route').trim().toLowerCase()}`;
}

export function segmentCatalog(efforts: ClimbEffort[]): { routes: RouteChoice[]; segments: SegmentChoice[] } {
  const routes = new Map<string, RouteChoice>();
  const segments = new Map<string, SegmentChoice>();
  for (const effort of efforts) {
    const id = effortRouteKey(effort);
    const known = effort.routeId ? ROUTES.find((route) => route.id === effort.routeId) : undefined;
    const choice = routes.get(id) ?? {
      id,
      name: known?.name || effort.routeName || 'Route',
      difficulty: known?.difficulty ?? null,
      elevations: known ? routeElevations(known) : [],
    };
    routes.set(id, choice);
    const segment = segments.get(effort.climbId) ?? {
      climbId: effort.climbId,
      climbName: effort.climbName,
      routeId: id,
      routeName: choice.name,
    };
    segments.set(effort.climbId, segment);
  }
  const byName = (a: { name?: string; climbName?: string }, b: { name?: string; climbName?: string }) =>
    (a.name || a.climbName || '').localeCompare(b.name || b.climbName || '');
  return {
    routes: [...routes.values()].sort(byName),
    segments: [...segments.values()].sort(byName),
  };
}

export function rideRows(rides: RideSummary[], efforts: ClimbEffort[]): RideRow[] {
  const byRide = new Map<string, { powerTime: number; time: number }>();
  for (const effort of efforts) {
    const time = num(effort.timeSec);
    if (!(time > 0)) continue;
    const current = byRide.get(effort.rideId) ?? { powerTime: 0, time: 0 };
    current.powerTime += num(effort.avgPower) * time;
    current.time += time;
    byRide.set(effort.rideId, current);
  }
  return rides.map((ride) => {
    const agg = byRide.get(ride.id);
    return {
      ride,
      kind: rideKind(ride),
      segmentPower: agg && agg.time > 0 ? agg.powerTime / agg.time : null,
    };
  });
}

export function sortRideRows(rows: RideRow[], key: RideSortKey, desc: boolean): RideRow[] {
  const dir = desc ? -1 : 1;
  const value = (row: RideRow): number | string | null => {
    switch (key) {
      case 'name':
        return row.ride.title.toLowerCase();
      case 'date':
        return row.ride.startedAt;
      case 'type':
        return KIND_LABEL[row.kind];
      case 'distance':
        return num(row.ride.distanceM);
      case 'time':
        return rideMovingSec(row.ride);
      case 'elevation':
        return num(row.ride.ascentM);
      case 'power':
        return num(row.ride.avgPower);
      case 'segmentPower':
        return row.segmentPower;
    }
  };
  return [...rows].sort((a, b) => {
    const av = value(a);
    const bv = value(b);
    if (av == null && bv == null) return b.ride.startedAt.localeCompare(a.ride.startedAt);
    if (av == null) return 1;
    if (bv == null) return -1;
    const cmp = typeof av === 'string' && typeof bv === 'string' ? av.localeCompare(bv) : (av as number) - (bv as number);
    if (cmp === 0) return b.ride.startedAt.localeCompare(a.ride.startedAt);
    return cmp * dir;
  });
}

export function segmentSeries(efforts: ClimbEffort[], rides: RideSummary[]): SegmentSeries[] {
  const titles = new Map(rides.map((ride) => [ride.id, ride.title]));
  const byClimb = new Map<string, ClimbEffort[]>();
  for (const effort of efforts) {
    const list = byClimb.get(effort.climbId) ?? [];
    list.push(effort);
    byClimb.set(effort.climbId, list);
  }
  return [...byClimb.values()]
    .map((list) => {
      const chrono = [...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
      const toAttempt = (effort: ClimbEffort): SegmentAttempt => ({
        effort,
        rideTitle: titles.get(effort.rideId) || effort.routeName || 'Ride',
        speedKmh: effort.lengthM && effort.timeSec > 0 ? (effort.lengthM / effort.timeSec) * 3.6 : null,
      });
      const attempts = chrono.map(toAttempt);
      const best = [...list].sort((a, b) => a.timeSec - b.timeSec)[0];
      const lengthM = [...list].reverse().find((effort) => effort.lengthM && effort.lengthM > 0)?.lengthM ?? null;
      return {
        climbId: list[0].climbId,
        climbName: list[0].climbName,
        routeId: effortRouteKey(list.find((effort) => effort.routeId || effort.routeName) ?? list[0]),
        routeName: list.find((effort) => effort.routeName)?.routeName ?? '',
        lengthM,
        best,
        attempts,
        rows: [...attempts].reverse(),
      };
    })
    .sort((a, b) => (a.routeName + a.climbName).localeCompare(b.routeName + b.climbName));
}

/** True when saved career stages exist, but none of them recorded a named climb. */
export function careerSegmentsPending(rides: RideSummary[], efforts: ClimbEffort[]): boolean {
  const careerIds = rides.filter((ride) => rideKind(ride) === 'career').map((ride) => ride.id);
  if (!careerIds.length) return false;
  const ids = new Set(careerIds);
  return !efforts.some((effort) => ids.has(effort.rideId));
}

export function completedGoals(rides: RideSummary[]): GoalItem[] {
  const goals: GoalItem[] = [];
  const doneAt = new Map<string, string>();
  for (const ride of rides) {
    const workout = ride.workout;
    if (ride.mode === 'train' && workout?.completed && workout.planId && workout.workoutId) {
      const key = `${workout.planId}/${workout.workoutId}`;
      const prev = doneAt.get(key);
      if (!prev || ride.startedAt > prev) doneAt.set(key, ride.startedAt);
      const plan = planById(workout.planId);
      goals.push({
        id: `workout-${ride.id}`,
        at: ride.startedAt,
        title: workout.name,
        detail: plan?.name ?? 'Training',
        kind: 'workout',
      });
    }
    if (ride.mode === 'race' && ride.race && ride.race.finishTimeSec != null) {
      const kind = rideKind(ride);
      goals.push({
        id: `race-${ride.id}`,
        at: ride.startedAt,
        title: ride.title,
        detail: `${kind === 'career' ? 'Career' : 'Hill climb'} · P${ride.race.position} of ${ride.race.field}`,
        kind: 'race',
      });
    }
  }
  const planIds = new Set([...doneAt.keys()].map((key) => key.slice(0, key.indexOf('/'))));
  for (const planId of planIds) {
    const plan = planById(planId);
    if (!plan) continue;
    const workouts = flattenWorkouts(plan);
    if (!workouts.length || !workouts.every((item) => doneAt.has(`${plan.id}/${item.workout.id}`))) continue;
    let at = '';
    for (const item of workouts) {
      const when = doneAt.get(`${plan.id}/${item.workout.id}`) ?? '';
      if (when > at) at = when;
    }
    goals.push({
      id: `plan-${plan.id}`,
      at,
      title: plan.name,
      detail: 'Plan complete',
      kind: 'plan',
    });
  }
  const rank = { plan: 0, race: 1, workout: 2 };
  return goals.sort((a, b) => b.at.localeCompare(a.at) || rank[a.kind] - rank[b.kind]);
}

/** Monday-first month grid, including the leading and trailing days needed to fill the weeks. */
export function monthGrid(year: number, month: number, rides: RideSummary[]): CalendarDay[] {
  const first = new Date(year, month, 1);
  const startPad = (first.getDay() + 6) % 7;
  const start = new Date(year, month, 1 - startPad);
  const days: CalendarDay[] = [];
  for (let i = 0; i < 42; i++) {
    const date = addDays(start, i);
    days.push({ date, key: dayKey(date), inMonth: date.getMonth() === month && date.getFullYear() === year, rides: [] });
  }
  const byKey = new Map(days.map((day) => [day.key, day]));
  for (const ride of rides) {
    const at = new Date(ride.startedAt);
    if (Number.isNaN(at.getTime())) continue;
    byKey.get(dayKey(at))?.rides.push(ride);
  }
  for (const day of days) day.rides.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  while (days.length > 28 && days.slice(-7).every((day) => !day.inMonth)) days.splice(-7);
  return days;
}

export function dayKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function ridesInMonth(rides: RideSummary[], year: number, month: number): RideSummary[] {
  return byNewest(
    rides.filter((ride) => {
      const at = new Date(ride.startedAt);
      return at.getFullYear() === year && at.getMonth() === month;
    }),
  );
}

export function formatKm(metres: number): string {
  const km = num(metres) / 1000;
  const digits = Math.abs(km) >= 100 ? 0 : 1;
  return `${km.toLocaleString('en-GB', { minimumFractionDigits: digits, maximumFractionDigits: digits })} km`;
}

export function formatKmValue(metres: number): string {
  return formatKm(metres).replace(/ km$/, '');
}

export function formatAscent(metres: number): string {
  return `${Math.round(num(metres)).toLocaleString('en-GB')} m`;
}

export function formatAscentValue(metres: number): string {
  return formatAscent(metres).replace(/ m$/, '');
}

export function formatMoving(sec: number): string {
  const s = Math.max(0, Math.round(num(sec)));
  const h = Math.floor(s / 3600);
  const rem = s % 3600;
  if (h > 0) {
    const m = Math.round(rem / 60);
    if (m >= 60) return `${(h + 1).toLocaleString('en-GB')}h 00m`;
    return `${h.toLocaleString('en-GB')}h ${pad(m)}m`;
  }
  if (s >= 60) return `${Math.round(s / 60)}m`;
  return `${s}s`;
}

export function formatWhen(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  return at.toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function formatDay(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  return at.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function oldestRide(rides: RideSummary[]): Date | null {
  let oldest: Date | null = null;
  for (const ride of rides) {
    const at = new Date(ride.startedAt);
    if (Number.isNaN(at.getTime())) continue;
    if (!oldest || at < oldest) oldest = at;
  }
  return oldest;
}

function num(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function monthKey(year: number, month: number): string {
  return `${year}-${pad(month + 1)}`;
}

function mondayOf(date: Date): Date {
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const weekday = day.getDay();
  day.setDate(day.getDate() + (weekday === 0 ? -6 : 1 - weekday));
  return day;
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function weekLabel(start: Date, now: Date): string {
  const day = start.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  return start.getFullYear() === now.getFullYear() ? day : `${day} ${String(start.getFullYear()).slice(2)}`;
}
