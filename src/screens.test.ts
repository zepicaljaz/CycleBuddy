// Every menu screen renders. Screens are HTML strings, so each one is built here with real
// data (a fresh career, sample rides) and checked for the marks of a broken template:
// "undefined", "NaN", "[object Object]", "Infinity", or an empty page.
import { describe, expect, it } from 'vitest';
import { analyticsHtml, type AnalyticsPage, type AnalyticsState } from './analytics/view';
import { Career } from './career/season';
import { careerHtml } from './career/panel';
import type { CareerTab } from './career/season';
import { homeHtml, HOME_KEYS } from './game/homeView';
import { loadChoice, proRaceHtml } from './game/proRaceView';
import { RACE_LENGTHS } from './game/quickRace';
import { REAL_STAGES } from './routes/real/data';
import { trainingMain } from './site/trainingPage';
import type { ClimbEffort, RideSummary } from './storage/types';
import { HELP_SECTIONS } from './ui/helpContent';

const BROKEN = /\bundefined\b|\bNaN\b|\[object Object\]|\bInfinity\b/;

/** The text and attributes of a screen, with the place a broken value was found. */
function expectClean(html: string, where: string): void {
  expect(html.length, `${where} rendered nothing`).toBeGreaterThan(40);
  const hit = html.match(BROKEN);
  if (hit) {
    const at = hit.index ?? 0;
    expect.fail(`${where} shows "${hit[0]}": …${html.slice(Math.max(0, at - 80), at + 40)}…`);
  }
}

function ride(id: string, mode: RideSummary['mode'], daysAgo: number, extra: Partial<RideSummary> = {}): RideSummary {
  const when = new Date(Date.UTC(2026, 10, 16 - daysAgo, 7, 30)).toISOString();
  return {
    id,
    createdAt: when,
    updatedAt: when,
    startedAt: when,
    mode,
    routeId: 'alpine',
    routeName: 'Alpine Pass',
    title: mode === 'race' ? 'Krvavec' : 'Alpine Pass',
    durationSec: 3600,
    movingSec: 3500,
    distanceM: 28_000,
    ascentM: 640,
    avgPower: 190,
    maxPower: 520,
    normalizedPower: 205,
    avgCadence: 86,
    avgHeartRate: 142,
    maxHeartRate: 171,
    avgSpeedKmh: 28,
    hasFit: false,
    ...extra,
  };
}

const RIDES: RideSummary[] = [
  ride('ride-free-0001', 'free', 1, { laps: 2 }),
  ride('ride-race-0002', 'race', 3, { race: { position: 4, field: 76, finishTimeSec: 3400, winnerTimeSec: 3300 } }),
  ride('ride-train-003', 'train', 9),
  ride('ride-free-0004', 'free', 40),
];
const EFFORTS: ClimbEffort[] = [
  { id: 'eff-1', climbId: 'krvavec', climbName: 'Krvavec', rideId: 'ride-race-0002', createdAt: RIDES[1].startedAt, timeSec: 3400, avgPower: 230, wkg: 3.2, lengthM: 11_600 },
];

function state(page: AnalyticsPage): AnalyticsState {
  return {
    page,
    sortKey: 'date',
    sortDesc: true,
    kind: 'all',
    year: 2026,
    month: 10,
    day: null,
    segmentId: '',
    routeId: '',
    monthShift: 0,
    weekShift: 0,
    sessionShift: 0,
    powerShift: 0,
    now: new Date(Date.UTC(2026, 10, 16, 12)),
  };
}

describe('menu screens render', () => {
  it('home: every mode, the climb of the day and the build stamp', () => {
    const html = homeHtml({ name: 'Test Rider', weightKg: 72, ftp: 230, trainer: 'No trainer yet' }, '<svg></svg>');
    expectClean(html, 'home');
    for (const mode of HOME_KEYS) expect(html).toContain(`data-go="${mode.go}"`);
    expect(HOME_KEYS.map((mode) => mode.title)).toEqual(['Free ride', 'Hill climb race', 'Training plans', 'Career mode']);
    expect(HOME_KEYS.map((mode) => mode.key)).toEqual(['1', '2', '3', '4']);
    expect(html).not.toContain('data-go="pro"');
    expect(html).toMatch(/class="hm-build"[^>]*>v\d+\.\d+\.\d+ · /);
  });

  it('home: a rider with no weight or FTP yet still renders numbers', () => {
    expectClean(homeHtml({ name: '', weightKg: 0, ftp: 0, trainer: '' }, ''), 'home (empty rider)');
  });

  for (const page of ['dashboard', 'rides', 'segments', 'calendar'] as AnalyticsPage[]) {
    it(`analytics ${page}: with rides and with none`, () => {
      expectClean(analyticsHtml(RIDES, EFFORTS, state(page)), `analytics ${page}`);
      expectClean(analyticsHtml([], [], state(page)), `analytics ${page} (no rides)`);
    });
  }

  it('pro race setup: every stage, and every length of one', { timeout: 60_000 }, () => {
    for (const stage of REAL_STAGES) {
      expectClean(proRaceHtml({ ...loadChoice(), stageId: stage.id }, 3.2), `pro race ${stage.id}`);
    }
    for (const { id: length } of RACE_LENGTHS) {
      expectClean(proRaceHtml({ ...loadChoice(), length }, 3.2), `pro race length ${length}`);
    }
  });

  it('training plans page', () => {
    expectClean(trainingMain(), 'training plans');
  });

  it('trainer setup help', () => {
    expect(HELP_SECTIONS.length).toBeGreaterThan(0);
    for (const section of HELP_SECTIONS) expectClean(section.html, `help ${section.id}`);
  });
});

describe('career screens render', () => {
  it('team pick, before a career exists', () => {
    expectClean(careerHtml(new Career()), 'career pick');
  });

  it('every tab of a new career', () => {
    const career = new Career();
    career.create('slorising', 'SLO', 3.4, 3.8, 4.3);
    const tabs: CareerTab[] = ['hub', 'calendar', 'rankings', 'record', 'team', 'riders', 'field'];
    for (const tab of tabs) {
      career.tab = tab;
      expectClean(careerHtml(career, 'Test Rider'), `career ${tab}`);
    }
  });

  it('the race brief: stats, pace, teammates table, team orders, start', () => {
    const career = new Career();
    career.create('slorising', 'SLO', 3.4, 3.8, 4.3);
    career.openBrief();
    expect(career.tab).toBe('brief');
    const html = careerHtml(career, 'Test Rider');
    expectClean(html, 'career brief');
    expect(html).toContain('class="brief-stats"');
    expect(html).toContain('data-career="diff-flat"');
    expect(html).toContain('Team orders');
    expect(html).toContain('data-career="start"');
    expect((html.match(/data-career="tactic"/g) ?? []).length).toBe(3);
  });
});
