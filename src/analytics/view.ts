import type { ClimbEffort, RideSample, RideSummary } from '../storage/types';
import { esc } from '../ui/dom';
import { formatDuration } from '../util/math';
import { columnChart, curveChart, dotChart, formChart, loadChart, segmentChart, type BarPoint } from './charts';
import {
  CURVE_SECONDS,
  KEY_SECONDS,
  RANGES,
  durationLabel,
  estimateFtp,
  formBand,
  ftpHistory,
  ftpTimeline,
  loadSeries,
  mergeCurves,
  powerData,
  rampRate,
  rangeStart,
  rideLoad,
  ridesBeforeRange,
  ridesInRange,
  sumZones,
  zoneRanges,
  type AnalyticsRange,
  type CurvePoint,
  type PowerData,
} from './metrics';
import {
  DIFFICULTY_LABEL,
  KIND_LABEL,
  byNewest,
  careerSegmentsPending,
  countKinds,
  dayKey,
  formatAscent,
  formatDay,
  formatKm,
  formatMoving,
  formatWhen,
  monthGrid,
  monthlyActivity,
  rideKind,
  rideMovingSec,
  rideRows,
  ridesInMonth,
  ridesInYear,
  segmentCatalog,
  segmentSeries,
  sortRideRows,
  totals,
  weeklySeries,
  type RideKind,
  type RideRow,
  type RideSortKey,
  type SegmentSeries,
} from './model';
import { gradeProfileSvg, powerBarsHtml, powerEvery } from './shape';

export type AnalyticsPage = 'dashboard' | 'fitness' | 'power' | 'rides' | 'segments' | 'calendar';
export type VolumeMetric = 'time' | 'distance' | 'ascent' | 'load';

export const ANALYTICS_PAGES: AnalyticsPage[] = ['dashboard', 'fitness', 'power', 'rides', 'segments', 'calendar'];
export const VOLUME_METRICS: VolumeMetric[] = ['time', 'load', 'distance', 'ascent'];

export interface AnalyticsState {
  page: AnalyticsPage;
  sortKey: RideSortKey;
  sortDesc: boolean;
  kind: RideKind | 'all';
  year: number;
  month: number;
  day: string | null;
  segmentId: string;
  /** Empty shows every route. */
  routeId: string;
  /** Time window for the Fitness and Power pages. */
  range: AnalyticsRange;
  volume: VolumeMetric;
  now: Date;
}

export interface AnalyticsContext {
  ftp: number;
  weightKg: number;
  samples: ReadonlyMap<string, RideSample[]>;
  /** Best efforts and zone time per ride, read from its samples. */
  power: ReadonlyMap<string, PowerData>;
  /** Power data for the range is still being read. */
  powerLoading?: boolean;
}

const PAGES: { id: AnalyticsPage; label: string }[] = [
  { id: 'dashboard', label: 'Overview' },
  { id: 'fitness', label: 'Fitness' },
  { id: 'power', label: 'Power' },
  { id: 'rides', label: 'Rides' },
  { id: 'segments', label: 'Climbs' },
  { id: 'calendar', label: 'Calendar' },
];

const VOLUME_LABEL: Record<VolumeMetric, string> = { time: 'Time', load: 'Load', distance: 'Distance', ascent: 'Climbing' };

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const KINDS: RideKind[] = ['free', 'train', 'race', 'career'];
const DEFAULT_CONTEXT: AnalyticsContext = { ftp: 250, weightKg: 72, samples: new Map(), power: new Map() };

export function analyticsHtml(rides: RideSummary[], efforts: ClimbEffort[], state: AnalyticsState, context: AnalyticsContext = DEFAULT_CONTEXT): string {
  const ftpOf = ftpTimeline(rides, context.ftp);
  const rows = rideRows(rides, efforts, ftpOf);
  const page =
    state.page === 'rides'
      ? ridesPage(rows, state)
      : state.page === 'segments'
        ? segmentsPage(rides, efforts, state, context)
        : state.page === 'calendar'
          ? calendarPage(rides, rows, state, context)
          : state.page === 'fitness'
            ? fitnessPage(rides, state, ftpOf)
            : state.page === 'power'
              ? powerPage(rides, state, context)
              : overviewPage(rides, rows, state, context, ftpOf);
  return `<nav class="an-tabs" aria-label="Analytics">${PAGES.map((item) => navButton(item.id, item.label, state.page)).join('')}</nav><div class="analytics-main">${page}<div class="chart-tip" hidden></div></div>`;
}

/** Rides whose samples the Power page needs. */
export function powerRides(rides: RideSummary[], range: AnalyticsRange, now: Date): RideSummary[] {
  return [...ridesInRange(rides, range, now), ...ridesBeforeRange(rides, range, now)].filter((ride) => ride.avgPower > 0);
}

export { ftpTimeline, powerData };

const DETAIL_POWER_SEC = 180;
const CALENDAR_POWER_SEC = 120;

/** The parts of a ride's detail that need its samples. */
export function rideTraceHtml(samples: RideSample[], ftp: number, weightKg = 0): { profile: string; power: string; extra: string } {
  const bins = powerEvery(samples, ftp, DETAIL_POWER_SEC);
  const profile = gradeProfileSvg(samples, 420, 88, 'ridden-profile');
  const data = samples.length ? powerData(samples, ftp) : null;
  let extra = '';
  if (data && data.best.some((value) => value != null)) {
    const best = KEY_SECONDS.map((sec) => ({ sec, watts: data.best[CURVE_SECONDS.indexOf(sec)] }));
    extra = `<div class="an-detail-extra">
      <section><h4>Best efforts</h4><table class="an-mini"><tbody>${best
        .map((item) => `<tr><th>${durationLabel(item.sec)}</th><td>${item.watts == null ? '—' : `${Math.round(item.watts)} W`}</td><td class="muted">${item.watts == null || !(weightKg > 0) ? '' : `${(item.watts / weightKg).toFixed(2)} W/kg`}</td></tr>`)
        .join('')}</tbody></table></section>
      <section><h4>Time in zones</h4>${zoneList(data.zones, ftp, true)}</section>
      ${data.decoupling == null ? '' : `<section><h4>Power to heart rate</h4><p class="an-big-line"><b>${data.decoupling.toFixed(1)}%</b> ${decouplingWord(data.decoupling)}</p><p class="chart-note">How far power per heartbeat fell from the first half of the ride to the second. Under 5% on a steady ride means your endurance held.</p></section>`}
    </div>`;
  }
  return {
    profile: profile || '<p class="chart-note">No elevation was recorded for this ride.</p>',
    power: bins.length ? powerBarsHtml(bins, ftp) : '<p class="chart-note">No power was recorded for this ride.</p>',
    extra,
  };
}

// ---------- Overview

function overviewPage(rides: RideSummary[], rows: RideRow[], state: AnalyticsState, context: AnalyticsContext, ftpOf: (ride: RideSummary) => number): string {
  if (!rides.length) {
    return `<div class="analytics-stack"><section class="an-section"><h3>No rides yet</h3><p class="an-lead">Ride a free ride, a workout, a hill climb or a career stage. Fitness, power and every ride show up here, ready to read on your phone after the ride.</p></section></div>`;
  }
  const series = loadSeries(rides, ftpOf, state.now);
  const today = series[series.length - 1];
  const band = formBand(today.form);
  const ramp = rampRate(series);
  const loads = new Map(rows.map((row) => [row.ride.id, row.load]));
  const weeks = weeklySeries(rides, state.now, 2);
  const weekLoad = weekLoads(rides, state.now, 12, ftpOf);
  const thisWeek = weekLoad[weekLoad.length - 1];
  const lastWeek = weekLoad[weekLoad.length - 2];
  const recent = byNewest(rides).slice(0, 5);
  const year = state.now.getFullYear();
  const thisYear = totals(ridesInYear(rides, year));
  const lastYear = totals(ridesInYear(rides, year - 1));
  const all = totals(rides);
  const wkg = context.weightKg > 0 ? context.ftp / context.weightKg : null;
  const tests = ftpHistory(rides);
  const lastTest = tests[tests.length - 1];
  return `
    <div class="analytics-stack">
      <section class="an-hero" aria-label="Today">
        <div class="an-form band-${band.id}">
          <small>Form today</small>
          <b>${signed(today.form)}</b>
          <strong>${band.label}</strong>
          <p>${band.advice}</p>
        </div>
        <dl class="an-figures">
          <div><dt>Fitness</dt><dd>${Math.round(today.fitness)}</dd><span>${ramp == null ? '&nbsp;' : `${signedOne(ramp)} this week`}</span></div>
          <div><dt>Fatigue</dt><dd>${Math.round(today.fatigue)}</dd><span>Last 7 days</span></div>
          <div><dt>FTP</dt><dd>${Math.round(context.ftp)}<small>W</small></dd><span>${wkg == null ? '&nbsp;' : `${wkg.toFixed(2)} W/kg`}</span></div>
        </dl>
        <p class="an-foot">${lastTest ? `Last FTP test ${esc(formatDay(lastTest.at))}.` : 'No FTP test yet. Load and zones use the FTP in your profile.'}</p>
        <div class="an-hero-help">
          ${learningNote(series.length)}
          ${glossary(['form', 'fitness', 'fatigue', 'load', 'ftp'])}
        </div>
      </section>

      <section class="an-section">
        <div class="an-head"><h3>This week</h3><span class="muted">Since Monday</span></div>
        <table class="an-compare">
          <thead><tr><th></th><th>This week</th><th>Last week</th></tr></thead>
          <tbody>
            ${compareRow('Rides', String(weeks[1].sessions), String(weeks[0].sessions))}
            ${compareRow('Time', formatMoving(thisWeek.seconds), formatMoving(lastWeek.seconds))}
            ${compareRow('Load', String(Math.round(thisWeek.tss)), String(Math.round(lastWeek.tss)))}
            ${compareRow('Distance', formatKm(weeks[1].distanceM), formatKm(weeks[0].distanceM))}
            ${compareRow('Climbing', formatAscent(weeks[1].ascentM), formatAscent(weeks[0].ascentM))}
          </tbody>
        </table>
      </section>

      <div class="an-two">
        <section class="an-section">
          <div class="an-head"><h3>Fitness, last 6 weeks</h3><button type="button" class="an-link" data-analytics="fitness">Open Fitness</button></div>
          ${legend([['fitness', 'Fitness'], ['fatigue', 'Fatigue'], ['load', 'Daily load']])}
          ${loadChart(series.slice(-42))}
        </section>
        <section class="an-section">
          <div class="an-head"><h3>Weekly load</h3><span class="muted">12 weeks</span></div>
          <p class="chart-note">How hard each week was. One hour flat out at your FTP counts 100, an easy hour about 50.</p>
          ${columnChart(
            weekLoad.map((week) => ({
              label: week.label,
              value: week.tss,
              text: week.tss > 0 ? String(Math.round(week.tss)) : '',
              title: `${week.title}\nLoad ${Math.round(week.tss)}\n${formatMoving(week.seconds)} · ${week.rides} ${week.rides === 1 ? 'ride' : 'rides'}`,
            })),
            'Training load per week for the last 12 weeks.',
            'No riding in the last 12 weeks.',
            (value) => String(Math.round(value)),
          )}
        </section>
      </div>

      <section class="an-section">
        <div class="an-head"><h3>Recent rides</h3><button type="button" class="an-link" data-analytics="rides">All ${rides.length} rides</button></div>
        <ul class="an-list">${recent.map((ride) => recentItem(ride, loads.get(ride.id)?.tss ?? 0)).join('')}</ul>
      </section>

      <section class="an-section">
        <div class="an-head"><h3>Totals</h3></div>
        <table class="an-compare three">
          <thead><tr><th></th><th>${year}</th><th>${year - 1}</th><th>All time</th></tr></thead>
          <tbody>
            ${compareRow('Rides', String(thisYear.sessions), String(lastYear.sessions), String(all.sessions))}
            ${compareRow('Time', formatMoving(thisYear.movingSec), formatMoving(lastYear.movingSec), formatMoving(all.movingSec))}
            ${compareRow('Distance', formatKm(thisYear.distanceM), formatKm(lastYear.distanceM), formatKm(all.distanceM))}
            ${compareRow('Climbing', formatAscent(thisYear.ascentM), formatAscent(lastYear.ascentM), formatAscent(all.ascentM))}
          </tbody>
        </table>
      </section>
    </div>`;
}

// ---------- Fitness

function fitnessPage(rides: RideSummary[], state: AnalyticsState, ftpOf: (ride: RideSummary) => number): string {
  const series = loadSeries(rides, ftpOf, state.now);
  const start = rangeStart(state.range, state.now, rides);
  const shown = series.filter((day) => day.date >= start);
  const today = series[series.length - 1];
  const band = today ? formBand(today.form) : null;
  const ramp = rampRate(series);
  const inRange = ridesInRange(rides, state.range, state.now);
  const monthly = state.range === '1y' || state.range === 'all';
  const weekCount = Math.max(1, Math.ceil(shown.length / 7) || 6);
  const weekLoad = weekLoads(rides, state.now, monthly ? 12 : weekCount, ftpOf);
  const efPoints = byNewest(inRange)
    .map((ride) => ({ ride, ef: rideLoad(ride, ftpOf(ride)).ef }))
    .filter((item): item is { ride: RideSummary; ef: number } => item.ef != null)
    .map((item) => ({
      at: new Date(item.ride.startedAt),
      value: item.ef,
      title: `${item.ride.title}\n${formatDay(item.ride.startedAt)}\nEF ${item.ef.toFixed(2)}\n${Math.round(rideLoad(item.ride, ftpOf(item.ride)).np)} W at ${Math.round(item.ride.avgHeartRate)} bpm`,
    }));
  return `
    <div class="analytics-stack">
      ${rangeControl(state.range)}
      ${learningNote(series.length)}
      <section class="an-section">
        <div class="an-head"><h3>Fitness and fatigue</h3></div>
        ${
          today && band
            ? `<dl class="an-figures four">
          <div><dt>Fitness</dt><dd>${Math.round(today.fitness)}</dd><span>42-day load</span></div>
          <div><dt>Fatigue</dt><dd>${Math.round(today.fatigue)}</dd><span>7-day load</span></div>
          <div class="band-${band.id}"><dt>Form</dt><dd>${signed(today.form)}</dd><span>${band.label}</span></div>
          <div><dt>Ramp</dt><dd>${ramp == null ? '—' : signedOne(ramp)}</dd><span>Fitness per week</span></div>
        </dl>`
            : ''
        }
        ${legend([['fitness', 'Fitness'], ['fatigue', 'Fatigue'], ['load', 'Daily load']])}
        ${loadChart(shown)}
        <h4 class="an-sub">Form</h4>
        ${shown.length ? formChart(shown) : ''}
        ${formLegend()}
        ${glossary(['load', 'fitness', 'fatigue', 'form', 'ramp'])}
      </section>

      <section class="an-section">
        <div class="an-head"><h3>Training volume</h3><span class="muted">${monthly ? 'Per month' : 'Per week'}</span></div>
        <div class="an-seg" role="group" aria-label="Volume shown">${VOLUME_METRICS.map((metric) => `<button type="button" data-volume="${metric}" aria-pressed="${metric === state.volume}">${VOLUME_LABEL[metric]}</button>`).join('')}</div>
        ${volumeChart(rides, state, ftpOf, monthly, weekLoad)}
      </section>

      <section class="an-section">
        <div class="an-head"><h3>Week by week</h3></div>
        <div class="table-wrap">
          <table class="analytics-table an-weeks">
            <thead><tr><th>Week</th><th class="num">Rides</th><th class="num">Time</th><th class="num">Load</th><th class="num">Distance</th><th class="num">Climbing</th></tr></thead>
            <tbody>${[...weekLoad]
              .reverse()
              .slice(0, 12)
              .map(
                (week) =>
                  `<tr class="${week.rides ? '' : 'is-empty'}"><td>${esc(week.label)}</td><td class="num" data-label="Rides">${week.rides}</td><td class="num" data-label="Time">${formatMoving(week.seconds)}</td><td class="num" data-label="Load">${Math.round(week.tss)}</td><td class="num" data-label="Distance">${formatKm(week.distanceM)}</td><td class="num" data-label="Climbing">${formatAscent(week.ascentM)}</td></tr>`,
              )
              .join('')}</tbody>
          </table>
        </div>
      </section>

      <section class="an-section">
        <div class="an-head"><h3>Aerobic efficiency</h3><span class="muted">${efPoints.length} ${efPoints.length === 1 ? 'ride' : 'rides'}</span></div>
        <p class="chart-note">Power per heartbeat (normalized power ÷ average heart rate) on rides of 20 minutes or more. Each dot is a ride. If the dashed line climbs, you make more power for the same effort: you are getting fitter.</p>
        ${dotChart(efPoints, start, state.now, 'Aerobic efficiency per ride.', 'Ride with a heart-rate strap to see this. It needs two rides of 20 minutes or more.')}
      </section>
    </div>`;
}

interface WeekLoad {
  label: string;
  title: string;
  rides: number;
  seconds: number;
  tss: number;
  distanceM: number;
  ascentM: number;
}

function weekLoads(rides: RideSummary[], now: Date, weeks: number, ftpOf: (ride: RideSummary) => number): WeekLoad[] {
  const base = weeklySeries(rides, now, weeks);
  const index = new Map(base.map((week, i) => [week.key, i]));
  const extra = base.map(() => ({ seconds: 0, tss: 0 }));
  for (const ride of rides) {
    const at = new Date(ride.startedAt);
    if (Number.isNaN(at.getTime())) continue;
    const monday = new Date(at.getFullYear(), at.getMonth(), at.getDate() - ((at.getDay() + 6) % 7));
    const slot = index.get(dayKey(monday));
    if (slot === undefined) continue;
    extra[slot].seconds += rideMovingSec(ride);
    extra[slot].tss += rideLoad(ride, ftpOf(ride)).tss;
  }
  return base.map((week, i) => ({ label: week.label, title: week.title, rides: week.sessions, seconds: extra[i].seconds, tss: extra[i].tss, distanceM: week.distanceM, ascentM: week.ascentM }));
}

function volumeChart(rides: RideSummary[], state: AnalyticsState, ftpOf: (ride: RideSummary) => number, monthly: boolean, weeks: WeekLoad[]): string {
  const metric = state.volume;
  const pick = (bucket: { seconds: number; tss: number; distanceM: number; ascentM: number }) =>
    metric === 'time' ? bucket.seconds / 3600 : metric === 'load' ? bucket.tss : metric === 'distance' ? bucket.distanceM / 1000 : bucket.ascentM;
  const show = (value: number) => (metric === 'time' ? `${value.toFixed(value >= 10 ? 0 : 1)} h` : metric === 'distance' ? `${Math.round(value)} km` : metric === 'ascent' ? `${Math.round(value).toLocaleString('en-GB')} m` : String(Math.round(value)));
  const axis = (value: number) => (metric === 'time' ? `${Number.isInteger(value) ? value : value.toFixed(1)}h` : metric === 'ascent' ? `${Math.round(value).toLocaleString('en-GB')}` : String(Math.round(value)));
  let buckets: { label: string; title: string; seconds: number; tss: number; distanceM: number; ascentM: number; rides: number }[];
  if (monthly) {
    const months = state.range === 'all' ? Math.max(12, monthSpan(rides, state.now)) : 12;
    const list = monthlyActivity(rides, state.now, Math.min(months, 36));
    const index = new Map(list.map((month, i) => [month.key, i]));
    const extra = list.map(() => ({ seconds: 0, tss: 0 }));
    for (const ride of rides) {
      const at = new Date(ride.startedAt);
      const slot = index.get(`${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}`);
      if (slot === undefined) continue;
      extra[slot].seconds += rideMovingSec(ride);
      extra[slot].tss += rideLoad(ride, ftpOf(ride)).tss;
    }
    buckets = list.map((month, i) => ({ label: month.label, title: month.title, seconds: extra[i].seconds, tss: extra[i].tss, distanceM: month.distanceM, ascentM: month.ascentM, rides: month.sessions }));
  } else {
    buckets = weeks;
  }
  const points: BarPoint[] = buckets.map((bucket) => {
    const value = pick(bucket);
    return {
      label: bucket.label,
      value,
      text: value > 0 ? show(value).replace(/ (h|km|m)$/, '') : '',
      title: `${bucket.title}\n${formatMoving(bucket.seconds)} · load ${Math.round(bucket.tss)}\n${formatKm(bucket.distanceM)} · ${formatAscent(bucket.ascentM)}\n${bucket.rides} ${bucket.rides === 1 ? 'ride' : 'rides'}`,
    };
  });
  return columnChart(points, `${VOLUME_LABEL[metric]} ${monthly ? 'per month' : 'per week'}.`, 'No riding in this range yet.', axis);
}

function monthSpan(rides: RideSummary[], now: Date): number {
  const oldest = rides.reduce<string | null>((min, ride) => (min == null || ride.startedAt < min ? ride.startedAt : min), null);
  if (!oldest) return 1;
  const at = new Date(oldest);
  return (now.getFullYear() - at.getFullYear()) * 12 + (now.getMonth() - at.getMonth()) + 1;
}

// ---------- Power

function powerPage(rides: RideSummary[], state: AnalyticsState, context: AnalyticsContext): string {
  const inRange = ridesInRange(rides, state.range, state.now).filter((ride) => ride.avgPower > 0);
  const before = ridesBeforeRange(rides, state.range, state.now).filter((ride) => ride.avgPower > 0);
  const withData = inRange.filter((ride) => context.power.has(ride.id));
  const current = mergeCurves(inRange, context.power);
  const previous = state.range === 'all' ? [] : mergeCurves(before, context.power);
  const weight = context.weightKg;
  const estimate = estimateFtp(current);
  const rangeLabel = RANGES.find((item) => item.id === state.range)?.label.toLowerCase() ?? '';
  const loading = context.powerLoading ? '<p class="chart-note an-loading">Reading power from your rides…</p>' : '';
  if (!inRange.length) {
    return `<div class="analytics-stack">${rangeControl(state.range)}<section class="an-section"><h3>No power in this range</h3><p class="an-lead">Ride with a smart trainer or a power meter, or choose a longer range.</p></section></div>`;
  }
  const byId = new Map(rides.map((ride) => [ride.id, ride]));
  const key = KEY_SECONDS.map((sec) => ({ sec, now: current[CURVE_SECONDS.indexOf(sec)], was: previous[CURVE_SECONDS.indexOf(sec)] }));
  return `
    <div class="analytics-stack">
      ${rangeControl(state.range)}
      ${loading}
      ${glossary(['best', 'wkg', 'curve', 'estimate', 'zones'])}
      <section class="an-section">
        <div class="an-head"><h3>Best power</h3><span class="muted">${withData.length} of ${inRange.length} rides read</span></div>
        <dl class="an-figures five">
          ${key
            .map((item) => {
              const watts = item.now?.watts;
              const change = watts != null && item.was?.watts != null ? watts - item.was.watts : null;
              return `<div><dt>${durationLabel(item.sec)}</dt><dd>${watts == null ? '—' : Math.round(watts)}<small>W</small></dd><span>${watts != null && weight > 0 ? `${(watts / weight).toFixed(2)} W/kg` : '&nbsp;'}</span>${change == null ? '' : `<em class="delta ${change > 0.5 ? 'up' : change < -0.5 ? 'down' : 'flat'}">${signed(change)} W</em>`}</div>`;
            })
            .join('')}
        </dl>
        ${
          estimate != null
            ? `<p class="an-note-line">Best 20 minutes × 95% = <b>${estimate} W</b> estimated FTP. Your profile says <b>${Math.round(context.ftp)} W</b>.${estimate > context.ftp * 1.03 ? ' Time for an FTP test.' : ''}</p>`
            : ''
        }
      </section>

      <section class="an-section">
        <div class="an-head"><h3>Power curve</h3></div>
        <p class="chart-note">Your best average power for every length of effort, ${esc(rangeLabel)}.${previous.length ? ' The dashed line is the same length of time before it.' : ''}</p>
        ${legend(previous.length ? [['fitness', `Last ${rangeLabel}`], ['before', 'Before that']] : [['fitness', 'Best power']])}
        ${curveChart(current, previous, weight)}
        <div class="table-wrap">
          <table class="analytics-table an-best">
            <thead><tr><th>Effort</th><th class="num">Best</th><th class="num">W/kg</th>${previous.length ? '<th class="num">Before</th>' : ''}<th>Set on</th></tr></thead>
            <tbody>${current
              .filter((point) => point.watts != null)
              .map((point) => bestRow(point, previous.find((item) => item.sec === point.sec) ?? null, weight, byId, previous.length > 0))
              .join('')}</tbody>
          </table>
        </div>
      </section>

      <section class="an-section">
        <div class="an-head"><h3>Time in zones</h3><span class="muted">FTP ${Math.round(context.ftp)} W</span></div>
        <p class="chart-note">Seconds at each power, ${esc(rangeLabel)}. Most riders build fitness with a lot of Endurance and a little VO2max and above.</p>
        ${zoneList(sumZones(inRange, context.power), context.ftp, false)}
      </section>
    </div>`;
}

function bestRow(point: CurvePoint, before: CurvePoint | null, weight: number, byId: Map<string, RideSummary>, compare: boolean): string {
  const watts = point.watts ?? 0;
  const ride = point.rideId ? byId.get(point.rideId) : undefined;
  const was = before?.watts;
  const beforeCell = compare ? `<td class="num" data-label="Before">${was == null ? '—' : `${Math.round(was)} W`}</td>` : '';
  return `<tr>
    <th scope="row">${durationLabel(point.sec)}</th>
    <td class="num" data-label="Best"><b>${Math.round(watts)} W</b></td>
    <td class="num" data-label="W/kg">${weight > 0 ? (watts / weight).toFixed(2) : '—'}</td>
    ${beforeCell}
    <td class="an-set" data-label="Set on">${ride ? `<button type="button" class="an-link" data-day="${dayKey(new Date(ride.startedAt))}" data-jump="1">${esc(formatDay(ride.startedAt))}</button><span>${esc(ride.title)}</span>` : '—'}</td>
  </tr>`;
}

function zoneList(zones: number[], ftp: number, compact: boolean): string {
  const total = zones.reduce((a, b) => a + b, 0);
  if (!(total > 0)) return '<p class="plot-empty">No power recorded yet.</p>';
  const ranges = zoneRanges(ftp > 0 ? ftp : 200);
  const max = Math.max(...zones);
  return `<ol class="an-zones${compact ? ' compact' : ''}">${ranges
    .map((zone, i) => {
      const sec = zones[i] ?? 0;
      const share = (sec / total) * 100;
      const watts = zone.to == null ? `${zone.from}+ W` : `${zone.from}–${zone.to} W`;
      return `<li><span class="z-name"><i style="background:${zone.color}"></i>${zone.name}${compact ? '' : `<small>${watts}</small>`}</span><span class="z-bar"><i style="width:${((sec / max) * 100).toFixed(1)}%;background:${zone.color}"></i></span><span class="z-time">${formatMoving(sec)}</span><span class="z-pct">${share.toFixed(0)}%</span></li>`;
    })
    .join('')}</ol>`;
}

// ---------- Rides

function ridesPage(rows: RideRow[], state: AnalyticsState): string {
  const counts = countKinds(rows.map((row) => row.ride));
  const filtered = state.kind === 'all' ? rows : rows.filter((row) => row.kind === state.kind);
  const sorted = sortRideRows(filtered, state.sortKey, state.sortDesc);
  const sum = totals(filtered.map((row) => row.ride));
  const load = filtered.reduce((acc, row) => acc + row.load.tss, 0);
  return `
    <div class="analytics-stack">
      <div class="an-seg wrap" role="group" aria-label="Ride type">
        ${kindChip('all', 'All', rows.length, state.kind)}
        ${KINDS.map((kind) => kindChip(kind, KIND_LABEL[kind], counts[kind], state.kind)).join('')}
      </div>
      ${glossary(['avgw', 'np', 'load', 'intensity', 'variability', 'work', 'efficiency', 'decoupling'])}
      <p class="analytics-summary">${filtered.length} ${filtered.length === 1 ? 'ride' : 'rides'} · ${formatKm(sum.distanceM)} · ${formatAscent(sum.ascentM)} · ${formatMoving(sum.movingSec)} · load ${Math.round(load)}</p>
      <label class="an-sort">Sort by
        <select data-sort-select aria-label="Sort rides by">
          ${sortOption('date', 'Date', state)}${sortOption('load', 'Load', state)}${sortOption('time', 'Time', state)}${sortOption('distance', 'Distance', state)}${sortOption('elevation', 'Climbing', state)}${sortOption('power', 'Average power', state)}${sortOption('np', 'Normalized power', state)}${sortOption('name', 'Name', state)}
        </select>
      </label>
      <div class="table-wrap an-section flush">
        <table class="analytics-table ride-table">
          <thead><tr>
            ${head('name', 'Ride', state)}
            ${head('date', 'Date', state)}
            ${head('distance', 'Distance', state, true)}
            ${head('time', 'Time', state, true)}
            ${head('elevation', 'Climbing', state, true)}
            ${head('power', 'Avg W', state, true)}
            ${head('np', 'NP', state, true)}
            ${head('load', 'Load', state, true)}
            <th class="actions"><span>Actions</span></th>
          </tr></thead>
          <tbody>
            ${sorted.length ? sorted.map((row) => rideTr(row)).join('') : `<tr><td class="empty-cell" colspan="9">No rides in this view yet.</td></tr>`}
          </tbody>
        </table>
      </div>
      <section class="an-section backup-card">
        <h3>Backup</h3>
        <div class="row-buttons">
          <button class="btn" id="backup-export" type="button">Export backup</button>
          <label class="btn ghost" title="A CycleBuddy backup, or one or more .fit rides">Import backup<input type="file" id="backup-import" accept=".json,.fit,application/json" multiple hidden /></label>
        </div>
        <p class="muted small">A CycleBuddy backup (.json), or ride files (.fit) from this game or another app.</p>
      </section>
    </div>`;
}

function sortOption(key: RideSortKey, label: string, state: AnalyticsState): string {
  return `<option value="${key}" ${state.sortKey === key ? 'selected' : ''}>${label}</option>`;
}

function rideTr(row: RideRow): string {
  const ride = row.ride;
  const load = row.load;
  const hr = ride.avgHeartRate > 0 ? `${Math.round(ride.avgHeartRate)} bpm · max ${Math.round(ride.maxHeartRate)}` : '—';
  const facts: [string, string][] = [
    ['Normalized power', load.np > 0 ? `${Math.round(load.np)} W` : '—'],
    ['Intensity', load.np > 0 ? load.intensity.toFixed(2) : '—'],
    ['Load', String(Math.round(load.tss))],
    ['Variability', load.vi == null ? '—' : load.vi.toFixed(2)],
    ['Work', `${Math.round(load.kj).toLocaleString('en-GB')} kJ`],
    ['Max power', ride.maxPower > 0 ? `${Math.round(ride.maxPower)} W` : '—'],
    ['Heart rate', hr],
    ['Efficiency', load.ef == null ? '—' : load.ef.toFixed(2)],
    ['Cadence', ride.avgCadence > 0 ? `${Math.round(ride.avgCadence)} rpm` : '—'],
    ['Avg speed', `${num(ride.avgSpeedKmh).toFixed(1)} km/h`],
    ['FTP that day', `${Math.round(load.ftp)} W`],
    ['Power on climbs', row.segmentPower == null ? '—' : `${Math.round(row.segmentPower)} W`],
  ];
  if (ride.race && ride.race.finishTimeSec != null) facts.push(['Result', `P${ride.race.position} of ${ride.race.field}`]);
  return `<tr class="an-ride-row">
    <td class="name" title="${esc(ride.title)}"><span class="name-line">${esc(ride.title)}</span><span class="name-sub">${kindBadge(row.kind)}<span class="when-inline">${esc(formatDay(ride.startedAt))}</span></span><button class="ride-open" type="button" data-more="${esc(ride.id)}" aria-expanded="false">${CARET}<span>More details</span></button></td>
    <td class="when"><span class="when-day">${esc(formatDay(ride.startedAt))}</span><span class="when-time">${esc(formatClock(ride.startedAt))}</span></td>
    <td class="num" data-label="Distance">${(num(ride.distanceM) / 1000).toFixed(1)} km</td>
    <td class="num" data-label="Time">${formatDuration(rideMovingSec(ride))}</td>
    <td class="num" data-label="Climbing">+${Math.round(num(ride.ascentM))} m</td>
    <td class="num" data-label="Avg W">${Math.round(num(ride.avgPower))} W</td>
    <td class="num" data-label="NP">${load.np > 0 ? `${Math.round(load.np)} W` : '—'}</td>
    <td class="num" data-label="Load"><b>${Math.round(load.tss)}</b></td>
    <td class="actions"><div class="row-actions"><button class="btn small" type="button" data-fit="${esc(ride.id)}">FIT</button><button class="btn small ghost danger" type="button" data-del="${esc(ride.id)}">Delete</button></div></td>
  </tr>
  <tr class="ride-detail" id="detail-${esc(ride.id)}" hidden>
    <td colspan="9">
      <dl class="an-facts">${facts.map(([label, value]) => `<div><dt>${label}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>
      <div class="ride-detail-grid">
        <section><h4>Road ridden</h4><div data-detail-profile="${esc(ride.id)}"><p class="chart-note">The profile of the distance you rode.</p></div></section>
        <section><h4>Power every 3 minutes</h4><p class="chart-note">Colours follow your FTP, the same way a training plan does.</p><div data-detail-power="${esc(ride.id)}"></div></section>
      </div>
      <div data-detail-extra="${esc(ride.id)}"></div>
    </td>
  </tr>`;
}

// ---------- Climbs

function segmentsPage(rides: RideSummary[], efforts: ClimbEffort[], state: AnalyticsState, context: AnalyticsContext): string {
  const series = segmentSeries(efforts, rides);
  const catalog = segmentCatalog(efforts);
  const route = catalog.routes.find((item) => item.id === state.routeId);
  const onRoute = route ? series.filter((item) => item.routeId === route.id) : series;
  const chosen = state.segmentId === 'all' || !state.segmentId ? onRoute : onRoute.filter((item) => item.climbId === state.segmentId);
  const pending = careerSegmentsPending(rides, efforts);
  const segmentName = state.segmentId === 'all' ? '' : (catalog.segments.find((item) => item.climbId === state.segmentId)?.climbName ?? '');
  return `
    <div class="analytics-stack">
      <p class="an-lead">Every named climb you have finished, with time and power for each attempt.</p>
      ${pending ? '<p class="chart-note">Climbs from career stages already saved were not stored one by one. The next stage you ride will add them here.</p>' : ''}
      ${
        series.length
          ? `${finder(catalog, route?.name ?? '', segmentName, state.routeId)}
            ${chosen.length ? chosen.map((item) => segmentBlock(item, context.weightKg)).join('') : '<p class="empty-note">No climb matches that search.</p>'}`
          : '<p class="empty-note">No climbs yet. Finish a named climb on a free ride, a training session, a hill climb or a career stage.</p>'
      }
    </div>`;
}

function segmentBlock(series: SegmentSeries, weightKg: number): string {
  const best = series.best;
  const length = series.lengthM ? `${(series.lengthM / 1000).toFixed(1)} km` : '';
  const attempts = series.attempts.length;
  const latest = series.rows[0];
  const gap = latest && latest.effort.id !== best.id ? latest.effort.timeSec - best.timeSec : null;
  return `
    <section class="an-section segment-card" id="segment-${esc(series.climbId)}">
      <div class="an-head"><h3>${esc(series.climbName)}</h3><span class="muted">${series.routeName ? esc(series.routeName) : ''}</span></div>
      <dl class="an-figures four">
        <div><dt>Best time</dt><dd>${formatDuration(best.timeSec)}</dd><span>${esc(formatDay(best.createdAt))}</span></div>
        <div><dt>Best power</dt><dd>${Math.round(best.avgPower)}<small>W</small></dd><span>${best.wkg.toFixed(2)} W/kg</span></div>
        <div><dt>Attempts</dt><dd>${attempts}</dd><span>${length || '&nbsp;'}</span></div>
        <div><dt>Last try</dt><dd>${latest ? formatDuration(latest.effort.timeSec) : '—'}</dd><span>${gap == null ? 'Your best' : `+${formatDuration(gap)} off best`}</span></div>
      </dl>
      ${
        attempts > 1
          ? `${legend([['ascent', 'Time'], ['fitness', 'Power']])}${segmentChart(
              series.attempts.map((attempt) => ({
                at: new Date(attempt.effort.createdAt),
                timeSec: attempt.effort.timeSec,
                power: attempt.effort.avgPower,
                title: `${formatDay(attempt.effort.createdAt)}: ${formatDuration(attempt.effort.timeSec)}, ${Math.round(attempt.effort.avgPower)} W`,
              })),
            )}`
          : ''
      }
      <div class="table-wrap">
        <table class="analytics-table an-attempts">
          <thead><tr><th>Date</th><th>Ride</th><th class="num">Time</th><th class="num">Speed</th><th class="num">Power</th><th class="num">W/kg</th></tr></thead>
          <tbody>
            ${series.rows
              .map((attempt) => {
                const pr = Math.abs(attempt.effort.timeSec - best.timeSec) < 0.5;
                const wkg = attempt.effort.wkg > 0 ? attempt.effort.wkg : weightKg > 0 ? attempt.effort.avgPower / weightKg : 0;
                return `<tr class="${pr ? 'is-pr' : ''}">
                  <td>${esc(formatDay(attempt.effort.createdAt))}</td>
                  <td class="name" title="${esc(attempt.rideTitle)}">${esc(attempt.rideTitle)}</td>
                  <td class="num" data-label="Time">${formatDuration(attempt.effort.timeSec)}${pr ? ' <b class="pr">Best</b>' : ''}</td>
                  <td class="num" data-label="Speed">${attempt.speedKmh == null ? '—' : `${attempt.speedKmh.toFixed(1)} km/h`}</td>
                  <td class="num" data-label="Power">${Math.round(attempt.effort.avgPower)} W</td>
                  <td class="num" data-label="W/kg">${wkg > 0 ? wkg.toFixed(2) : '—'}</td>
                </tr>`;
              })
              .join('')}
          </tbody>
        </table>
      </div>
    </section>`;
}

function finder(catalog: ReturnType<typeof segmentCatalog>, routeName: string, segmentName: string, routeId: string): string {
  const segments = routeId ? catalog.segments.filter((item) => item.routeId === routeId) : catalog.segments;
  return `<div class="finder">
    <div class="finder-field">
      <label for="route-find">Route</label>
      <div class="finder-line">
        <input id="route-find" type="search" placeholder="All routes" autocomplete="off" value="${esc(routeName)}" />
        <button type="button" class="btn small finder-go" data-finder="route">Search</button>
      </div>
      <div class="finder-menu" id="route-menu" hidden>
        <button type="button" data-route="" ${routeId ? '' : 'class="selected"'}>All routes</button>
        ${catalog.routes
          .map(
            (route) => `<button type="button" data-route="${esc(route.id)}" data-name="${esc(route.name)}" ${route.id === routeId ? 'class="selected"' : ''}>
              <span class="finder-copy"><b>${esc(route.name)}</b>${route.difficulty ? `<span class="badge ${route.difficulty}">${DIFFICULTY_LABEL[route.difficulty]}</span>` : ''}</span>
            </button>`,
          )
          .join('')}
      </div>
    </div>
    <div class="finder-field">
      <label for="segment-find">Climb</label>
      <div class="finder-line">
        <input id="segment-find" type="search" placeholder="${routeId ? 'Climbs on this route' : 'All climbs'}" autocomplete="off" value="${esc(segmentName)}" />
        <button type="button" class="btn small finder-go" data-finder="segment">Search</button>
      </div>
      <div class="finder-menu" id="segment-menu" hidden>
        <button type="button" data-segment="all">All climbs</button>
        ${segments
          .map(
            (segment) => `<button type="button" data-segment="${esc(segment.climbId)}" data-route-id="${esc(segment.routeId)}" data-name="${esc(segment.climbName)}"><span class="finder-copy"><b>${esc(segment.climbName)}</b><span>${esc(segment.routeName)}</span></span></button>`,
          )
          .join('')}
      </div>
    </div>
  </div>`;
}

// ---------- Calendar

function calendarPage(rides: RideSummary[], rows: RideRow[], state: AnalyticsState, context: AnalyticsContext): string {
  const grid = monthGrid(state.year, state.month, rides);
  const title = new Date(state.year, state.month, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const byRide = new Map(rows.map((row) => [row.ride.id, row]));
  const selected = state.day ? grid.find((day) => day.key === state.day) : undefined;
  const monthRides = ridesInMonth(rides, state.year, state.month);
  const atLatest = state.year > state.now.getFullYear() || (state.year === state.now.getFullYear() && state.month >= state.now.getMonth());
  const groups = selected
    ? [{ key: selected.key, label: selected.date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }), rides: [...selected.rides].reverse() }]
    : groupDays(monthRides);
  const monthSum = totals(monthRides);
  const monthLoad = monthRides.reduce((sum, ride) => sum + (byRide.get(ride.id)?.load.tss ?? 0), 0);
  const weeks: string[] = [];
  for (let i = 0; i < grid.length; i += 7) {
    const week = grid.slice(i, i + 7);
    const load = week.flatMap((day) => day.rides).reduce((sum, ride) => sum + (byRide.get(ride.id)?.load.tss ?? 0), 0);
    const seconds = week.flatMap((day) => day.rides).reduce((sum, ride) => sum + rideMovingSec(ride), 0);
    weeks.push(`${week.map((day) => monthDay(day, state.day, dayKey(state.now), context)).join('')}<div class="cal-week" aria-label="Week total"><b>${load > 0 ? Math.round(load) : ''}</b><span>${seconds > 0 ? formatMoving(seconds) : ''}</span></div>`);
  }
  return `
    <div class="analytics-stack">
      <div class="month-nav">
        <button class="chart-arrow" type="button" data-cal="prev" aria-label="Previous month">${ARROW_PREV}</button>
        <h3>${esc(title)}</h3>
        <button class="chart-arrow" type="button" data-cal="next" aria-label="Next month" ${atLatest ? 'disabled' : ''}>${ARROW_NEXT}</button>
      </div>
      <p class="analytics-summary">${monthRides.length} ${monthRides.length === 1 ? 'ride' : 'rides'} · ${formatMoving(monthSum.movingSec)} · ${formatKm(monthSum.distanceM)} · load ${Math.round(monthLoad)}</p>
      <div class="cal-grid with-weeks" role="grid" aria-label="${esc(title)}">
        ${WEEKDAYS.map((name) => `<span class="dow">${name}</span>`).join('')}<span class="dow">Load</span>
        ${weeks.join('')}
      </div>
      <div class="cal-focus">
        ${selected ? '<button class="an-link" type="button" data-cal="month">Show the whole month</button>' : ''}
        ${
          groups.length
            ? groups
                .map(
                  (group) => `
            <section class="cal-day-block">
              <h3>${esc(group.label)}</h3>
              ${group.rides.length ? group.rides.map((ride) => calendarRide(ride, byRide.get(ride.id) ?? null, context)).join('') : '<p class="empty-note">No rides this day.</p>'}
            </section>`,
                )
                .join('')
            : `<p class="empty-note">No rides in ${esc(title)}.</p>`
        }
      </div>
    </div>`;
}

function monthDay(day: ReturnType<typeof monthGrid>[number], selected: string | null, today: string, context: AnalyticsContext): string {
  const chips = day.rides
    .map((ride) => {
      const kind = rideKind(ride);
      const bars = powerBarsHtml(powerEvery(context.samples.get(ride.id) ?? [], context.ftp, CALENDAR_POWER_SEC), context.ftp, 'tiny');
      if (!bars) return `<button type="button" class="cal-chip kind-${kind}" data-ride="${esc(ride.id)}">${esc(ride.title)}</button>`;
      return `<button type="button" class="cal-mark kind-${kind}" data-ride="${esc(ride.id)}" title="${esc(ride.title)}"><span>${esc(ride.title)}</span>${bars}</button>`;
    })
    .join('');
  return `<div class="cal-cell ${day.inMonth ? '' : 'out'} ${day.key === selected ? 'selected' : ''} ${day.key === today ? 'today' : ''}"><button type="button" class="cal-num" data-day="${day.key}" aria-label="${esc(day.date.toLocaleDateString(undefined, { day: 'numeric', month: 'long' }))}"><b>${day.date.getDate()}</b></button><div class="cal-chips">${chips}</div></div>`;
}

function calendarRide(ride: RideSummary, row: RideRow | null, context: AnalyticsContext): string {
  const kind = rideKind(ride);
  const load = row?.load ?? rideLoad(ride, context.ftp);
  const place = ride.race && ride.race.finishTimeSec != null ? `<div><dt>Result</dt><dd>P${ride.race.position} of ${ride.race.field}</dd></div>` : '';
  const segment = row?.segmentPower == null ? '' : `<div><dt>On climbs</dt><dd>${Math.round(row.segmentPower)} W</dd></div>`;
  const samples = context.samples.get(ride.id) ?? [];
  const bars = powerBarsHtml(powerEvery(samples, context.ftp, DETAIL_POWER_SEC), context.ftp, 'compact');
  const profile = gradeProfileSvg(samples, 280, 56, 'ridden-profile');
  const trace =
    profile && bars
      ? `<div class="cal-trace"><div class="cal-profile"><span>Road ridden</span>${profile}</div><div class="cal-power"><span>Power every 3 minutes</span>${bars}</div></div>`
      : `${profile ? `<div class="cal-profile"><span>Road ridden</span>${profile}</div>` : ''}${bars ? `<div class="cal-power"><span>Power every 3 minutes</span>${bars}</div>` : ''}`;
  return `<article class="cal-ride kind-${kind}" id="cal-ride-${esc(ride.id)}">
    <header><b>${esc(ride.title)}</b>${kindBadge(kind)}</header>
    <p class="muted small">${esc(formatWhen(ride.startedAt))}</p>
    <dl class="cal-stats">
      <div><dt>Time</dt><dd>${formatDuration(rideMovingSec(ride))}</dd></div>
      <div><dt>Distance</dt><dd>${(num(ride.distanceM) / 1000).toFixed(1)} km</dd></div>
      <div><dt>Climbing</dt><dd>+${Math.round(num(ride.ascentM))} m</dd></div>
      <div><dt>Avg power</dt><dd>${Math.round(num(ride.avgPower))} W</dd></div>
      <div><dt>Load</dt><dd>${Math.round(load.tss)}</dd></div>
      <div><dt>Intensity</dt><dd>${load.np > 0 ? load.intensity.toFixed(2) : '—'}</dd></div>
      ${ride.avgHeartRate > 0 ? `<div><dt>Heart rate</dt><dd>${Math.round(ride.avgHeartRate)} bpm</dd></div>` : ''}
      ${segment}
      ${place}
    </dl>
    ${trace || '<p class="chart-note">No power trace was saved for this ride.</p>'}
  </article>`;
}

function groupDays(rides: RideSummary[]): { key: string; label: string; rides: RideSummary[] }[] {
  const groups: { key: string; label: string; rides: RideSummary[] }[] = [];
  for (const ride of byNewest(rides)) {
    const at = new Date(ride.startedAt);
    const key = dayKey(at);
    const last = groups[groups.length - 1];
    if (last?.key === key) last.rides.push(ride);
    else groups.push({ key, label: at.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }), rides: [ride] });
  }
  return groups;
}

// ---------- Small pieces

function navButton(id: AnalyticsPage, label: string, current: AnalyticsPage): string {
  const on = id === current;
  return `<button type="button" class="${on ? 'active' : ''}" data-analytics="${id}" ${on ? 'aria-current="page"' : ''}>${label}</button>`;
}

function rangeControl(range: AnalyticsRange): string {
  return `<div class="an-seg" role="group" aria-label="Time range">${RANGES.map((item) => `<button type="button" data-range="${item.id}" aria-pressed="${item.id === range}">${item.label}</button>`).join('')}</div>`;
}

function legend(items: [string, string][]): string {
  return `<div class="an-legend" aria-hidden="true">${items.map(([kind, label]) => `<span><i class="key ${kind}"></i>${esc(label)}</span>`).join('')}</div>`;
}

function formLegend(): string {
  const bands: [string, string][] = [
    ['transition', 'Very fresh: above +25'],
    ['fresh', 'Fresh: +5 to +25'],
    ['neutral', 'Balanced: −10 to +5'],
    ['optimal', 'Training: −10 to −30'],
    ['risk', 'Very tired: below −30'],
  ];
  return `<ul class="an-bands">${bands.map(([id, label]) => `<li class="band-${id}"><i></i>${label}</li>`).join('')}</ul>`;
}

/** Fitness needs about six weeks of rides before form means much. */
const LEARNING_DAYS = 42;

function learningNote(days: number): string {
  if (days >= LEARNING_DAYS) return '';
  const left = LEARNING_DAYS - days;
  return `<p class="an-learning"><b>Still learning your fitness.</b> CycleBuddy has ${days} ${days === 1 ? 'day' : 'days'} of your riding. Fitness and fatigue start at zero on your first ride here, and fatigue catches up in a week while fitness takes about six. Until then form reads lower than you feel, so trust your legs for about ${left} more ${left === 1 ? 'day' : 'days'}. Rides from other apps count once you import their .fit files under Rides.</p>`;
}

type Term =
  | 'form' | 'fitness' | 'fatigue' | 'load' | 'ramp' | 'ftp' | 'wkg' | 'avgw' | 'np' | 'intensity'
  | 'variability' | 'work' | 'efficiency' | 'decoupling' | 'best' | 'curve' | 'estimate' | 'zones';

const TERMS: Record<Term, [string, string]> = {
  form: ['Form', 'Fitness minus fatigue, as of yesterday. It is not a score where higher is better. Negative means you rode more than usual this week: normal while training, and you can still feel good. Positive means you are rested: good before a race or an FTP test. Below −30, rest. Above +25, fitness is fading.'],
  fitness: ['Fitness', 'How much you have trained lately: your average daily load over about the last six weeks, with recent days counting a little more. It rises slowly when you ride often and falls slowly when you stop. Compare it with your own earlier numbers, not with other riders.'],
  fatigue: ['Fatigue', 'The same average, but over about the last seven days. It jumps after hard rides and drops after a few easy days.'],
  load: ['Load', 'How hard a ride was, as one number. It counts how long you rode and how hard, compared with your FTP. One hour flat out at your FTP is 100, an easy hour about 50, two steady hours about 130. Riding harder raises it faster than riding longer.'],
  ramp: ['Ramp', 'How much fitness changed in the last seven days. Up to about +5 a week is a steady build. Much more, week after week, is hard to recover from.'],
  ftp: ['FTP', 'Functional threshold power: the power you can hold for about an hour. Load, intensity and zones are all measured against it, so keep it current with an FTP test under Training plans.'],
  wkg: ['W/kg', 'Watts per kilogram of body weight. On a climb this decides who is faster, so it is how riders of different sizes compare.'],
  avgw: ['Avg W', 'Average power over the whole ride, easy parts included.'],
  np: ['NP', 'Normalized power: average power adjusted for surges. Hard efforts tire you more than their average suggests, so a ride with attacks has an NP above its average. It is the steady power that would feel as hard.'],
  intensity: ['Intensity', 'NP divided by your FTP. About 0.65 is easy, 0.75 to 0.85 steady endurance, 0.95 to 1.05 a race or an all-out hour.'],
  variability: ['Variability', 'NP divided by average power. 1.00 is perfectly steady. Above 1.10 is a stop-and-go ride, like a race with attacks.'],
  work: ['Work', 'Energy you put into the pedals, in kilojoules. Roughly the food calories the ride used.'],
  efficiency: ['Efficiency', 'Power per heartbeat: NP divided by average heart rate. If it rises over the weeks, you are getting fitter. Needs a heart-rate strap.'],
  decoupling: ['Power to heart rate', 'How much power per heartbeat dropped from the first half of a ride to the second. Under 5% on a steady ride means your endurance held.'],
  best: ['Best power', 'The highest average power you held for that long, anywhere inside a ride. 5 s is a sprint, 1 min a short steep climb, 5 min a hard climb, 20 min and 1 h are close to your FTP.'],
  curve: ['Power curve', 'Your best power for every length of effort: short efforts on the left, long ones on the right. Higher is better. The dashed line is the period before, so you can see what improved.'],
  estimate: ['Estimated FTP', '95% of your best 20 minutes, the usual quick estimate. If it is clearly above the FTP in your profile, an FTP test will raise it.'],
  zones: ['Zones', 'Power ranges set from your FTP, from easy Recovery to all-out Sprint. Time in zones shows how your riding was spread. Mostly Endurance and Tempo with a little hard work builds fitness well.'],
};

function glossary(terms: Term[]): string {
  return `<details class="an-explain">
    <summary>What these numbers mean</summary>
    <dl class="an-glossary">${terms.map((term) => `<div><dt>${TERMS[term][0]}</dt><dd>${TERMS[term][1]}</dd></div>`).join('')}</dl>
  </details>`;
}

function compareRow(label: string, ...values: string[]): string {
  return `<tr><th scope="row">${label}</th>${values.map((value, i) => `<td class="${i === 0 ? 'now' : ''}">${esc(value)}</td>`).join('')}</tr>`;
}

function recentItem(ride: RideSummary, tss: number): string {
  const kind = rideKind(ride);
  return `<li><button type="button" class="an-ride" data-day="${dayKey(new Date(ride.startedAt))}" data-jump="1">
    <span class="an-ride-copy"><b>${esc(ride.title)}</b><span>${kindBadge(kind)} ${esc(formatDay(ride.startedAt))} · ${(num(ride.distanceM) / 1000).toFixed(1)} km · ${Math.round(num(ride.avgPower))} W</span></span>
    <span class="an-ride-side"><b>${formatDuration(rideMovingSec(ride))}</b><span>Load ${Math.round(tss)}</span></span>
  </button></li>`;
}

function kindChip(kind: RideKind | 'all', label: string, count: number, current: RideKind | 'all'): string {
  return `<button type="button" data-kind="${kind}" aria-pressed="${kind === current}">${esc(label)} <span>${count}</span></button>`;
}

function head(key: RideSortKey, label: string, state: AnalyticsState, numeric = false): string {
  const on = state.sortKey === key;
  const arrow = on ? (state.sortDesc ? '↓' : '↑') : '';
  const sort = on ? (state.sortDesc ? 'descending' : 'ascending') : 'none';
  return `<th class="${numeric ? 'num' : ''}" aria-sort="${sort}"><button type="button" class="${on ? 'on' : ''}" data-sort="${key}">${label}${arrow ? ` <span class="sort-dir">${arrow}</span>` : ''}</button></th>`;
}

function kindBadge(kind: RideKind): string {
  return `<span class="badge kind kind-${kind}">${KIND_LABEL[kind]}</span>`;
}

function decouplingWord(pct: number): string {
  if (pct < 5) return 'steady';
  if (pct < 10) return 'some drift';
  return 'large drift';
}

function formatClock(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  return at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function signed(value: number): string {
  const rounded = Math.round(value);
  return rounded > 0 ? `+${rounded}` : rounded < 0 ? `−${Math.abs(rounded)}` : '0';
}

function signedOne(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return rounded > 0 ? `+${rounded.toFixed(1)}` : rounded < 0 ? `−${Math.abs(rounded).toFixed(1)}` : '0.0';
}

function num(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

const ARROW_PREV = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.8 5.2 8 12l6.8 6.8" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ARROW_NEXT = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.2 5.2 16 12l-6.8 6.8" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const CARET = `<svg class="ride-caret" viewBox="0 0 12 12" aria-hidden="true"><path d="M1.8 4.1 6 8.2l4.2-4.1" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
