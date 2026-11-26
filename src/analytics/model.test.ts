import { describe, expect, it } from 'vitest';
import type { ClimbEffort, RideSummary } from '../storage/types';
import { analyticsHtml, type AnalyticsState } from './view';
import { axisMax, columnChart, curveChart } from './charts';
import {
  careerSegmentsPending,
  completedGoals,
  dayKey,
  delta,
  formatKm,
  formatMoving,
  monthGrid,
  monthlyActivity,
  rideKind,
  rideRows,
  ridesBefore,
  ridesSince,
  segmentCatalog,
  segmentSeries,
  sortRideRows,
  totals,
  weeklySeries,
} from './model';
import { gradeProfileSvg, powerEvery, riddenElevations, routeElevations } from './shape';
import type { RideSample } from '../storage/types';

function at(year: number, month: number, day: number, hour = 12): string {
  return new Date(year, month, day, hour).toISOString();
}

function ride(partial: Partial<RideSummary> & Pick<RideSummary, 'id' | 'mode' | 'title' | 'startedAt'>): RideSummary {
  return {
    createdAt: partial.startedAt,
    updatedAt: partial.startedAt,
    routeId: 'alpine',
    routeName: 'Alpe',
    durationSec: 3600,
    movingSec: 3500,
    distanceM: 20000,
    ascentM: 400,
    avgPower: 200,
    maxPower: 400,
    normalizedPower: 220,
    avgCadence: 85,
    avgHeartRate: 140,
    maxHeartRate: 170,
    avgSpeedKmh: 28,
    hasFit: true,
    ...partial,
  };
}

function effort(partial: Partial<ClimbEffort> & Pick<ClimbEffort, 'id' | 'climbId' | 'rideId'>): ClimbEffort {
  return {
    climbName: 'Col',
    routeName: 'Alpe',
    lengthM: 5000,
    createdAt: at(2026, 10, 1),
    timeSec: 1000,
    avgPower: 250,
    wkg: 3.5,
    ...partial,
  };
}

const now = new Date(2026, 10, 16, 18);

describe('ride kinds', () => {
  it('keeps free rides, workouts, hill climbs and career stages apart', () => {
    expect(rideKind(ride({ id: 'a', mode: 'free', title: 'Free ride: Coast', startedAt: at(2026, 10, 1) }))).toBe('free');
    expect(rideKind(ride({ id: 'b', mode: 'train', title: 'Training · Base', startedAt: at(2026, 10, 2) }))).toBe('train');
    expect(rideKind(ride({ id: 'c', mode: 'race', title: 'Hill-climb race: Alpe', startedAt: at(2026, 10, 3) }))).toBe('race');
    expect(rideKind(ride({ id: 'd', mode: 'race', title: 'France Tour · Stage 13', startedAt: at(2026, 10, 4) }))).toBe('career');
  });
});

describe('totals', () => {
  const rides = [
    ride({ id: 'old', mode: 'free', title: 'Free ride: Coast', startedAt: at(2026, 9, 1), distanceM: 10000, ascentM: 100, movingSec: 1000 }),
    ride({ id: 'new', mode: 'train', title: 'Training', startedAt: at(2026, 10, 10), distanceM: 5000, ascentM: 50, movingSec: 400, durationSec: 900 }),
    ride({ id: 'today', mode: 'race', title: 'France Tour · Stage 1', startedAt: at(2026, 10, 16), distanceM: 40000, ascentM: 800, movingSec: 0, durationSec: 5000 }),
  ];

  it('adds distance, climbing and moving time from every ride', () => {
    expect(totals(rides)).toEqual({ sessions: 3, distanceM: 55000, ascentM: 950, movingSec: 6400 });
  });

  it('keeps the last 30 calendar days, including today', () => {
    const recent = ridesSince(rides, now, 30);
    expect(recent.map((item) => item.id)).toEqual(['new', 'today']);
  });

  it('buckets the last 12 months and the current week', () => {
    const months = monthlyActivity(rides, now, 12);
    expect(months).toHaveLength(12);
    expect(months.at(-1)?.key).toBe('2026-11');
    expect(months.at(-1)?.sessions).toBe(2);
    expect(months.find((bucket) => bucket.key === '2026-10')?.sessions).toBe(1);
    const weeks = weeklySeries(rides, now, 12);
    expect(weeks).toHaveLength(12);
    expect(weeks.at(-1)?.sessions).toBe(1);
    const trained = weeks.find((week) => week.key === dayKey(new Date(2026, 10, 9)));
    expect(trained?.sessions).toBe(1);
    expect(trained?.avgPower).toBe(200);
    expect(trained?.distanceM).toBe(5000);
    expect(monthlyActivity(rides, now, 12, 1).at(-1)?.key).toBe('2026-10');
    expect(ridesBefore(rides, now, 30).map((item) => item.id)).toEqual(['old']);
    expect(delta(12, 10).pct).toBeCloseTo(20);
    expect(delta(4, 0).pct).toBeNull();
  });
});

describe('segments and goals', () => {
  const rides = [
    ride({ id: 'free', mode: 'free', title: 'Free ride: Coast', startedAt: at(2026, 10, 1) }),
    ride({
      id: 'ftp',
      mode: 'train',
      title: 'Training · FTP Test · 20-minute FTP test',
      startedAt: at(2026, 10, 2),
      workout: { planId: 'ftp-test', workoutId: 'ftp-20', name: '20-minute FTP test', compliance: 100, ftpEstimate: 240, completed: true },
    }),
    ride({
      id: 'hill',
      mode: 'race',
      title: 'Hill-climb race: Alpe',
      startedAt: at(2026, 10, 3),
      race: { position: 4, field: 80, finishTimeSec: 2400, winnerTimeSec: 2200 },
    }),
    ride({
      id: 'stage',
      mode: 'race',
      title: 'France Tour · Stage 13',
      startedAt: at(2026, 10, 4),
      race: { position: 12, field: 150, finishTimeSec: 9000, winnerTimeSec: 8800 },
    }),
  ];
  const efforts = [
    effort({ id: 'e1', climbId: 'alpe', climbName: 'Alpe', rideId: 'free', timeSec: 1200, avgPower: 200, lengthM: 10000, createdAt: at(2026, 10, 1) }),
    effort({ id: 'e2', climbId: 'alpe', climbName: 'Alpe', rideId: 'hill', timeSec: 1000, avgPower: 300, lengthM: 10000, createdAt: at(2026, 10, 3) }),
  ];

  it('weights segment power by the time spent on each climb', () => {
    const rows = rideRows(rides, [
      effort({ id: 'a', climbId: 'one', rideId: 'free', timeSec: 10, avgPower: 100 }),
      effort({ id: 'b', climbId: 'two', rideId: 'free', timeSec: 30, avgPower: 200 }),
    ]);
    expect(rows.find((row) => row.ride.id === 'free')?.segmentPower).toBe(175);
  });

  it('puts the fastest attempt first in the chart order and the newest first in the table', () => {
    const [series] = segmentSeries(efforts, rides);
    expect(series.climbName).toBe('Alpe');
    expect(series.best.timeSec).toBe(1000);
    expect(series.attempts.map((attempt) => attempt.effort.id)).toEqual(['e1', 'e2']);
    expect(series.rows[0].effort.id).toBe('e2');
    expect(series.rows[0].speedKmh).toBeCloseTo(36);
    expect(series.rows[0].rideTitle).toBe('Hill-climb race: Alpe');
  });

  it('sorts missing segment power to the end', () => {
    const sorted = sortRideRows(rideRows(rides, efforts), 'segmentPower', true);
    expect(sorted.at(-1)?.segmentPower).toBeNull();
    expect(sorted[0].ride.id).toBe('hill');
  });

  it('counts finished plans, workouts and races as goals', () => {
    const goals = completedGoals(rides);
    expect(goals.map((goal) => goal.kind)).toEqual(['race', 'race', 'plan', 'workout']);
    expect(goals.find((goal) => goal.kind === 'plan')?.title).toBe('FTP Test');
    expect(goals.find((goal) => goal.id === 'race-stage')?.detail).toBe('Career · P12 of 150');
    expect(completedGoals([ride({ id: 'open', mode: 'train', title: 'Training', startedAt: at(2026, 10, 1), workout: { planId: 'ftp-test', workoutId: 'ftp-20', name: '20-minute FTP test', compliance: null, ftpEstimate: null, completed: false } })])).toEqual([]);
  });

  it('notices when a saved career stage has no climb records yet', () => {
    expect(careerSegmentsPending(rides, efforts)).toBe(true);
    expect(careerSegmentsPending(rides, [...efforts, effort({ id: 'e3', climbId: 'lune', rideId: 'stage' })])).toBe(false);
  });
});

describe('calendar', () => {
  it('starts the month on Monday and keeps a ride on its local day', () => {
    const rides = [ride({ id: 'mon', mode: 'free', title: 'Free ride: Coast', startedAt: at(2026, 10, 16) })];
    const days = monthGrid(2026, 10, rides);
    expect(days[0].date.getDate()).toBe(26);
    expect(days[0].date.getMonth()).toBe(9);
    const ridden = days.find((day) => day.rides.length > 0);
    expect(ridden?.key).toBe('2026-11-16');
    expect(ridden?.inMonth).toBe(true);
  });
});

describe('formatting and charts', () => {
  it('prints headline numbers and a tidy axis', () => {
    expect(formatKm(1234567)).toBe('1,235 km');
    expect(formatKm(12500)).toBe('12.5 km');
    expect(formatMoving(0)).toBe('0s');
    expect(formatMoving(90)).toBe('2m');
    expect(formatMoving(3720)).toBe('1h 02m');
    expect(axisMax(0)).toBe(1);
    expect(axisMax(3)).toBe(5);
    expect(axisMax(120)).toBe(200);
    const cols = columnChart(
      [
        { label: 'A', value: 0, title: 'A' },
        { label: 'B', value: 120, title: 'B\nload 120', text: '120' },
      ],
      'Weekly load',
      'Nothing yet',
      (value) => String(value),
    );
    expect(cols).toContain('data-tip="B&#10;load 120"');
    expect(cols).toContain('height:80.0%');
    expect(columnChart([{ label: 'A', value: 0, title: 'A' }], 'x', 'Nothing yet', String)).toContain('Nothing yet');
    const curve = curveChart(
      [
        { sec: 1, watts: 800, rideId: 'a', at: null },
        { sec: 60, watts: 400, rideId: 'a', at: null },
      ],
      [],
      80,
    );
    expect(curve).toContain('class="chart-guide"');
    expect(curve).toContain('10.00 W/kg');
  });
});


describe('ride traces', () => {
  it('splits power into timed blocks and colours the road by its gradient', () => {
    const samples: RideSample[] = Array.from({ length: 600 }, (_, t) => ({
      t,
      power: [120, 160, 210, 280][Math.floor(t / 180)] ?? 280,
      cadence: 90,
      heartRate: 140,
      speed: 8,
      distance: t * 8,
      altitude: 100 + t * 0.2,
      grade: 0.03,
    }));
    const bins = powerEvery(samples, 250, 180);
    expect(bins.map((bin) => Math.round(bin.avgPower))).toEqual([120, 160, 210, 280]);
    expect(bins.map((bin) => bin.minutes)).toEqual([0, 3, 6, 9]);
    expect(bins[0].zone).toBe('Recovery');
    expect(bins[2].zone).toBe('Tempo');
    expect(powerEvery(samples, 250, 120)).toHaveLength(5);
    expect(riddenElevations(samples).length).toBeGreaterThan(2);
    expect(riddenElevations([])).toEqual([]);
    const climb = gradeProfileSvg([
      { t: 0, power: 200, cadence: 80, heartRate: 140, speed: 5, distance: 0, altitude: 100, grade: 0.09 },
      { t: 20, power: 200, cadence: 80, heartRate: 150, speed: 5, distance: 100, altitude: 109, grade: 0.09 },
    ]);
    const descent = gradeProfileSvg([
      { t: 0, power: 80, cadence: 90, heartRate: 110, speed: 12, distance: 0, altitude: 200, grade: -0.05 },
      { t: 10, power: 80, cadence: 90, heartRate: 110, speed: 12, distance: 100, altitude: 195, grade: -0.05 },
    ]);
    expect(climb).toContain('#e2412e');
    expect(descent).toContain('#4d9de0');
    expect(climb).not.toContain('#3cba78');
  });

  it('draws a route thumbnail from its gradients and lists that route’s segments', () => {
    const elevations = routeElevations({ startElevation: 100, sections: [{ length: 1000, grades: [10], style: { kind: 'straight' } }] });
    expect(elevations[0]).toBe(100);
    expect(elevations.at(-1)).toBeCloseTo(200);
    const catalog = segmentCatalog([
      effort({ id: 'e1', climbId: 'alpe', climbName: 'Alpe', rideId: 'free', routeId: 'riviera', routeName: 'Riviera' }),
      effort({ id: 'e2', climbId: 'crest', climbName: 'Crest', rideId: 'free', routeId: 'alpine', routeName: 'Alpine' }),
    ]);
    expect(catalog.routes.map((route) => route.id).sort()).toEqual(['alpine', 'riviera']);
    expect(catalog.segments.find((segment) => segment.climbId === 'alpe')?.routeId).toBe('riviera');
    expect(catalog.routes.find((route) => route.id === 'riviera')?.difficulty).toBeTruthy();
  });
});

describe('analytics pages', () => {
  const rides = [
    ride({ id: 'free', mode: 'free', title: 'Free ride: Coast', startedAt: at(2026, 10, 16) }),
    ride({ id: 'work', mode: 'train', title: 'Training · Base · Endurance', startedAt: at(2026, 10, 15), workout: { planId: 'base', workoutId: 'e1', name: 'Endurance', compliance: 90, ftpEstimate: null, completed: true } }),
    ride({ id: 'hill', mode: 'race', title: 'Hill-climb race: Alpe', startedAt: at(2026, 10, 14), race: { position: 2, field: 60, finishTimeSec: 1800, winnerTimeSec: 1700 } }),
    ride({ id: 'stage', mode: 'race', title: 'France Tour · Stage 13', startedAt: at(2026, 10, 13), race: { position: 8, field: 140, finishTimeSec: 8000, winnerTimeSec: 7600 } }),
  ];
  const efforts = [effort({ id: 'e1', climbId: 'alpe', climbName: 'Alpe d’Huez', rideId: 'hill', createdAt: at(2026, 10, 14) })];
  const state = (page: AnalyticsState['page']): AnalyticsState => ({
    page,
    sortKey: 'date',
    sortDesc: true,
    kind: 'all',
    year: 2026,
    month: 10,
    day: null,
    segmentId: 'all',
    routeId: '',
    range: '3m',
    volume: 'time',
    now,
  });

  it('builds the dashboard, the ride table, the segment chart and the calendar from the same rides', () => {
    const dashboard = analyticsHtml(rides, efforts, state('dashboard'));
    for (const tab of ['Overview', 'Fitness', 'Power', 'Rides', 'Climbs', 'Calendar']) expect(dashboard).toContain(`>${tab}</button>`);
    expect(dashboard).toContain('Form today');
    expect(dashboard).toContain('This week');
    expect(dashboard).toContain('Weekly load');
    expect(dashboard).toContain('Recent rides');
    expect(dashboard).toContain('Totals');
    // A short history says form reads low, and opens the explanations.
    expect(dashboard).toContain('Still learning your fitness');
    expect(dashboard).toContain('<details class="an-explain" open>');
    expect(dashboard).toContain('What these numbers mean');
    expect(dashboard).toContain('data-tip=');
    expect(dashboard).toContain('France Tour · Stage 13');

    const fitness = analyticsHtml(rides, efforts, state('fitness'));
    expect(fitness).toContain('Fitness and fatigue');
    expect(fitness).toContain('data-range="6w"');
    expect(fitness).toContain('data-volume="load"');
    expect(fitness).toContain('Week by week');
    expect(fitness).toContain('Aerobic efficiency');

    const power = analyticsHtml(rides, efforts, state('power'));
    expect(power).toContain('Best power');
    expect(power).toContain('Power curve');
    expect(power).toContain('Time in zones');

    const table = analyticsHtml(rides, efforts, state('rides'));
    for (const column of ['Ride', 'Date', 'Distance', 'Time', 'Climbing', 'Avg W', 'NP', 'Load']) {
      expect(table).toContain(column);
    }
    expect(table).toContain('Free ride');
    expect(table).toContain('Training');
    expect(table).toContain('Hill climb');
    expect(table).toContain('Career');
    expect(table).toContain('Export backup');
    expect(table).toContain('More details');
    expect(table).toContain('Power on climbs');
    expect(table).toContain('data-sort-select');
    expect(table).toContain('What these numbers mean');
    // Not the old History list's .ride-row, which turned table rows into a grid.
    expect(table).toContain('<tr class="an-ride-row">');
    expect(table).not.toContain('class="ride-row"');

    const segments = analyticsHtml(rides, efforts, state('segments'));
    expect(segments).toContain('Alpe d’Huez');
    expect(segments).toContain('id="route-find"');
    expect(segments).toContain('id="segment-find"');
    expect(segments).toContain('>Search</button>');
    expect(segments).not.toContain('route-sketch');
    expect(segments).toContain('Speed');
    expect(segments).toContain('W/kg');
    expect(segments).toContain('Hill-climb race: Alpe');

    const calendar = analyticsHtml(rides, efforts, state('calendar'));
    expect(calendar).toContain('Free ride: Coast');
    expect(calendar).toContain('data-day="2026-11-16"');
    expect(calendar).toContain('Result');
  });
});
