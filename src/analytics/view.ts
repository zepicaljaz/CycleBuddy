import type { ClimbEffort, RideSample, RideSummary } from '../storage/types';
import { esc } from '../ui/dom';
import { formatDuration } from '../util/math';
import { activityChart, barChart, lineChart, segmentChart } from './charts';
import {
  DIFFICULTY_LABEL,
  KIND_LABEL,
  POWER_WINDOW,
  byNewest,
  careerSegmentsPending,
  countKinds,
  dayKey,
  delta,
  formatAscent,
  formatAscentValue,
  formatDay,
  formatKm,
  formatKmValue,
  formatMoving,
  formatWhen,
  maxMonthShift,
  maxPowerSkip,
  maxWeekShift,
  monthGrid,
  monthlyActivity,
  powerTrend,
  rideKind,
  rideMovingSec,
  rideRows,
  ridesBefore,
  ridesInMonth,
  ridesInYear,
  ridesSince,
  segmentCatalog,
  segmentSeries,
  sortRideRows,
  totals,
  weeklySeries,
  type Delta,
  type RideKind,
  type RideRow,
  type RideSortKey,
  type SegmentSeries,
} from './model';
import { gradeProfileSvg, powerBarsHtml, powerEvery } from './shape';

export type AnalyticsPage = 'dashboard' | 'rides' | 'segments' | 'calendar';

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
  /** Months, weeks, or rides to skip back from the latest window. */
  monthShift: number;
  weekShift: number;
  sessionShift: number;
  powerShift: number;
  now: Date;
}

export interface AnalyticsContext {
  ftp: number;
  samples: ReadonlyMap<string, RideSample[]>;
}

const PAGES: { id: AnalyticsPage; label: string }[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'rides', label: 'All rides' },
  { id: 'segments', label: 'Segment analyzer' },
  { id: 'calendar', label: 'Calendar' },
];

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const KINDS: RideKind[] = ['free', 'train', 'race', 'career'];

export function analyticsHtml(
  rides: RideSummary[],
  efforts: ClimbEffort[],
  state: AnalyticsState,
  context: AnalyticsContext = { ftp: 250, samples: new Map() },
): string {
  const rows = rideRows(rides, efforts);
  const page =
    state.page === 'rides'
      ? ridesPage(rows, state)
      : state.page === 'segments'
        ? segmentsPage(rides, efforts, state)
        : state.page === 'calendar'
          ? calendarPage(rides, rows, state, context)
          : dashboardPage(rides, state);
  return `<nav class="analytics-nav" aria-label="Analytics">${PAGES.map((item) => navButton(item.id, item.label, state.page)).join('')}</nav><div class="analytics-main">${page}<div class="chart-tip" hidden></div></div>`;
}

const DETAIL_POWER_SEC = 180;
const CALENDAR_POWER_SEC = 120;

export function rideTraceHtml(samples: RideSample[], ftp: number): { profile: string; power: string } {
  const bins = powerEvery(samples, ftp, DETAIL_POWER_SEC);
  const profile = gradeProfileSvg(samples, 420, 88, 'ridden-profile');
  return {
    profile: profile || '<p class="chart-note">No elevation was recorded for this ride.</p>',
    power: bins.length ? powerBarsHtml(bins, ftp) : '<p class="chart-note">No power was recorded for this ride.</p>',
  };
}

function dashboardPage(rides: RideSummary[], state: AnalyticsState): string {
  const all = totals(rides);
  const thisYear = totals(ridesInYear(rides, state.now.getFullYear()));
  const lastYear = totals(ridesInYear(rides, state.now.getFullYear() - 1));
  const monthRides = ridesSince(rides, state.now, 30);
  const priorMonth = totals(ridesBefore(rides, state.now, 30));
  const recentTotals = totals(monthRides);
  const recent = byNewest(rides).slice(0, 5);
  const months = monthlyActivity(rides, state.now, 12, state.monthShift);
  const activityWeeks = weeklySeries(rides, state.now, 12, state.weekShift);
  const sessionWeeks = weeklySeries(rides, state.now, 12, state.sessionShift);
  const powers = powerTrend(rides, state.powerShift, POWER_WINDOW);
  const today = dayKey(state.now);
  const grid = monthGrid(state.year, state.month, rides);
  const ridingDays = grid.filter((day) => day.inMonth && day.rides.length > 0).length;
  const monthTitle = new Date(state.year, state.month, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const atLatestMonth = state.year > state.now.getFullYear() || (state.year === state.now.getFullYear() && state.month >= state.now.getMonth());
  return `
    <div class="analytics-stack">
      <section class="analytics-block" aria-label="All time">
        <h3>All time</h3>
        ${statGrid(all, thisYear, lastYear, 'vs last year')}
      </section>
      <section class="analytics-block" aria-label="Last 30 days">
        <h3>Last 30 days</h3>
        ${statGrid(recentTotals, recentTotals, priorMonth, 'vs prior 30 days')}
      </section>
      <div class="analytics-split">
        <section class="chart-card">
          <div class="chart-head">
            <h3>Monthly activity</h3>
            <div class="chart-tools">
              <div class="legend" aria-hidden="true"><span><i class="swatch distance"></i>Distance</span><span><i class="swatch elevation"></i>Elevation</span></div>
              ${chartNav('month', state.monthShift, maxMonthShift(rides, state.now))}
            </div>
          </div>
          <p class="chart-note">Orange is kilometres ridden. Blue is metres climbed. The lines meet at 150 m of climbing for every 10 km.</p>
          ${activityChart(months, 'Monthly activity. Orange line is distance. Blue line is elevation. The lines meet at 150 metres for every 10 kilometres.', 'No riding in these months yet.')}
        </section>
        <section class="chart-card cal-card">
          <div class="chart-head">
            <h3>${esc(monthTitle)}</h3>
            <div class="chart-tools">
              <span class="muted small">${ridingDays} ${ridingDays === 1 ? 'day' : 'days'}</span>
              ${monthArrows(atLatestMonth)}
            </div>
          </div>
          <div class="cal-mini" role="grid" aria-label="${esc(monthTitle)}">
            ${WEEKDAYS.map((name) => `<span class="dow">${name}</span>`).join('')}
            ${grid.map((day) => miniDay(day, today)).join('')}
          </div>
        </section>
      </div>
      <div class="analytics-split">
        <section class="chart-card">
          <div class="chart-head">
            <h3>Weekly activity</h3>
            <div class="chart-tools">
              <div class="legend" aria-hidden="true"><span><i class="swatch distance"></i>Distance</span><span><i class="swatch elevation"></i>Elevation</span></div>
              ${chartNav('week', state.weekShift, maxWeekShift(rides, state.now))}
            </div>
          </div>
          <p class="chart-note">One line for distance and one for elevation. They meet at 150 m of climbing for every 10 km.</p>
          ${activityChart(activityWeeks, 'Weekly activity. Orange line is distance. Blue line is elevation. The lines meet at 150 metres for every 10 kilometres.', 'No riding in these weeks yet.')}
        </section>
        <section class="chart-card list-card">
          <div class="chart-head"><h3>Recent rides</h3><span class="muted small">${rides.length}</span></div>
          ${recent.length ? `<ul class="feed">${recent.map((ride) => recentItem(ride)).join('')}</ul>` : '<p class="empty-note">No rides yet. A free ride, a workout, a hill climb or a career stage will show up here.</p>'}
        </section>
      </div>
      <div class="analytics-pair">
        <section class="chart-card">
          <div class="chart-head">
            <h3>Power trend</h3>
            <div class="chart-tools">
              <div class="legend" aria-hidden="true"><span><i class="swatch power"></i>Average power</span></div>
              ${chartNav('power', state.powerShift, maxPowerSkip(rides.length))}
            </div>
          </div>
          <p class="chart-note">Average power of each ride. Older rides are to the left.</p>
          ${lineChart(
            powers.map((ride) => ({
              label: shortDay(ride.startedAt),
              value: ride.avgPower,
              title: `${ride.title}\n${formatWhen(ride.startedAt)}\n${Math.round(ride.avgPower)} W average\n${(ride.distanceM / 1000).toFixed(1)} km · ${formatDuration(rideMovingSec(ride))}`,
            })),
            'Power trend. Average watts of each ride.',
          )}
        </section>
        <section class="chart-card">
          <div class="chart-head">
            <h3>Weekly sessions</h3>
            <div class="chart-tools">
              <div class="legend" aria-hidden="true"><span><i class="swatch distance"></i>Rides</span></div>
              ${chartNav('sessions', state.sessionShift, maxWeekShift(rides, state.now))}
            </div>
          </div>
          <p class="chart-note">How many rides started in each week.</p>
          ${barChart(
            sessionWeeks.map((week) => ({
              label: week.label,
              value: week.sessions,
              title: `${week.title}\n${week.sessions} ${week.sessions === 1 ? 'ride' : 'rides'}\n${(week.distanceM / 1000).toFixed(1)} km · ${Math.round(week.ascentM).toLocaleString('en-GB')} m`,
            })),
            'Weekly sessions. Ride count for each week.',
          )}
        </section>
      </div>
    </div>`;
}

function ridesPage(rows: RideRow[], state: AnalyticsState): string {
  const counts = countKinds(rows.map((row) => row.ride));
  const filtered = state.kind === 'all' ? rows : rows.filter((row) => row.kind === state.kind);
  const sorted = sortRideRows(filtered, state.sortKey, state.sortDesc);
  const sum = totals(filtered.map((row) => row.ride));
  return `
    <div class="analytics-stack">
      <p class="analytics-lead">Every saved free ride, training session, hill climb and career stage.</p>
      <div class="kind-filters" role="tablist" aria-label="Ride type">
        ${kindChip('all', 'All', rows.length, state.kind)}
        ${KINDS.map((kind) => kindChip(kind, KIND_LABEL[kind], counts[kind], state.kind)).join('')}
      </div>
      <p class="analytics-summary">${filtered.length} ${filtered.length === 1 ? 'ride' : 'rides'} · ${formatKm(sum.distanceM)} · ${formatAscent(sum.ascentM)} · ${formatMoving(sum.movingSec)}</p>
      <div class="table-wrap chart-card">
        <table class="analytics-table ride-table">
          <thead><tr>
            ${head('name', 'Name', state)}
            ${head('date', 'Date', state)}
            ${head('type', 'Type', state)}
            ${head('distance', 'Distance', state, true)}
            ${head('time', 'Time', state, true)}
            ${head('elevation', 'Elevation gain', state, true)}
            ${head('power', 'Average power', state, true)}
            ${head('segmentPower', 'Power on segments', state, true)}
            <th class="actions"><span>Actions</span></th>
          </tr></thead>
          <tbody>
            ${sorted.length ? sorted.map((row) => rideTr(row)).join('') : `<tr><td class="empty-cell" colspan="9">No rides in this view yet.</td></tr>`}
          </tbody>
        </table>
      </div>
      <section class="chart-card backup-card">
        <h3>Backup</h3>
        <div class="row-buttons">
          <button class="btn" id="backup-export" type="button">Export backup</button>
          <label class="btn ghost" title="A CycleBuddy backup, or one or more .fit rides">Import backup<input type="file" id="backup-import" accept=".json,.fit,application/json" multiple hidden /></label>
        </div>
        <p class="muted small">A CycleBuddy backup (.json), or ride files (.fit) from this game or another app.</p>
      </section>
    </div>`;
}

function segmentsPage(rides: RideSummary[], efforts: ClimbEffort[], state: AnalyticsState): string {
  const series = segmentSeries(efforts, rides);
  const catalog = segmentCatalog(efforts);
  const route = catalog.routes.find((item) => item.id === state.routeId);
  const onRoute = route ? series.filter((item) => item.routeId === route.id) : series;
  const chosen = state.segmentId === 'all' ? onRoute : onRoute.filter((item) => item.climbId === state.segmentId);
  const shown = chosen.length ? chosen : [];
  const pending = careerSegmentsPending(rides, efforts);
  const segmentName = state.segmentId === 'all' ? '' : (catalog.segments.find((item) => item.climbId === state.segmentId)?.climbName ?? '');
  return `
    <div class="analytics-stack">
      <p class="analytics-lead">Each named climb, with time and power for every attempt. The line on the left is time. The line on the right is power.</p>
      ${pending ? '<p class="chart-note">Climbs from career stages already saved were not stored one by one. The next stage you ride will add them here.</p>' : ''}
      ${
        series.length
          ? `${finder(catalog, route?.name ?? '', segmentName, state.routeId)}
            ${shown.length ? shown.map((item) => segmentBlock(item)).join('') : '<p class="empty-note">No segment matches that search.</p>'}`
          : '<p class="empty-note">No segments yet. Finish a named climb on a free ride, a training session, a hill climb or a career stage.</p>'
      }
    </div>`;
}

function calendarPage(rides: RideSummary[], rows: RideRow[], state: AnalyticsState, context: AnalyticsContext): string {
  const grid = monthGrid(state.year, state.month, rides);
  const title = new Date(state.year, state.month, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const power = new Map(rows.map((row) => [row.ride.id, row.segmentPower]));
  const selected = state.day ? grid.find((day) => day.key === state.day) : undefined;
  const monthRides = ridesInMonth(rides, state.year, state.month);
  const atLatest = state.year > state.now.getFullYear() || (state.year === state.now.getFullYear() && state.month >= state.now.getMonth());
  const groups = selected
    ? [{ key: selected.key, label: selected.date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }), rides: [...selected.rides].reverse() }]
    : groupDays(monthRides);
  return `
    <div class="analytics-stack">
      <p class="analytics-lead">Every ride on the day you started it. Select a day, or read the whole month below.</p>
      <div class="month-nav">
        <button class="chart-arrow" type="button" data-cal="prev" aria-label="Previous month">${ARROW_PREV}</button>
        <h3>${esc(title)}</h3>
        <button class="chart-arrow" type="button" data-cal="next" aria-label="Next month" ${atLatest ? 'disabled' : ''}>${ARROW_NEXT}</button>
      </div>
      <div class="cal-grid" role="grid" aria-label="${esc(title)}">
        ${WEEKDAYS.map((name) => `<span class="dow">${name}</span>`).join('')}
        ${grid.map((day) => monthDay(day, state.day, dayKey(state.now), context)).join('')}
      </div>
      <div class="cal-focus">
        ${selected ? '<button class="chip" type="button" data-cal="month">Whole month</button>' : ''}
        ${
          groups.length
            ? groups
                .map(
                  (group) => `
            <section class="cal-day-block">
              <h3>${esc(group.label)}</h3>
              ${group.rides.length ? group.rides.map((ride) => calendarRide(ride, power.get(ride.id) ?? null, context)).join('') : '<p class="empty-note">No rides this day.</p>'}
            </section>`,
                )
                .join('')
            : `<p class="empty-note">No rides in ${esc(title)}.</p>`
        }
      </div>
    </div>`;
}

function navButton(id: AnalyticsPage, label: string, current: AnalyticsPage): string {
  const on = id === current;
  return `<button type="button" class="${on ? 'active' : ''}" data-analytics="${id}" ${on ? 'aria-current="page"' : ''}>${label}</button>`;
}

function statGrid(sum: ReturnType<typeof totals>, current: ReturnType<typeof totals>, previous: ReturnType<typeof totals>, compare: string): string {
  return `<div class="stat-grid">
    ${stat('Total sessions', String(sum.sessions), '', ICON_SESSIONS, delta(current.sessions, previous.sessions), compare, (diff) => String(Math.round(diff)))}
    ${stat('Distance ridden', formatKmValue(sum.distanceM), 'km', ICON_DISTANCE, delta(current.distanceM, previous.distanceM), compare, (diff) => formatKm(diff))}
    ${stat('Elevation gain', formatAscentValue(sum.ascentM), 'm', ICON_ELEVATION, delta(current.ascentM, previous.ascentM), compare, (diff) => formatAscent(diff))}
    ${stat('Moving time', formatMoving(sum.movingSec), '', ICON_TIME, delta(current.movingSec, previous.movingSec), compare, (diff) => formatMoving(diff))}
  </div>`;
}

function stat(label: string, value: string, unit: string, icon: string, change: Delta, compare: string, absolute: (diff: number) => string): string {
  return `<article class="stat-card"><header><span class="stat-icon">${icon}</span><small>${label}</small></header><b>${esc(value)}${unit ? `<span>${esc(unit)}</span>` : ''}</b>${deltaLine(change, compare, absolute)}</article>`;
}

function deltaLine(change: Delta, compare: string, absolute: (diff: number) => string): string {
  if (change.pct == null) {
    const text = compare === 'vs last year' ? 'No rides last year' : 'None in the prior 30 days';
    return `<em class="delta up">${text}</em>`;
  }
  if (change.pct === 0 && change.previous === 0) return '';
  const rounded = Math.round(change.pct);
  const tone = rounded > 0 ? 'up' : rounded < 0 ? 'down' : 'flat';
  if (Math.abs(rounded) >= 300) {
    const diff = change.current - change.previous;
    const sign = diff > 0 ? '+' : diff < 0 ? '−' : '';
    return `<em class="delta ${tone}">${sign}${absolute(Math.abs(diff))} ${esc(compare)}</em>`;
  }
  const sign = rounded > 0 ? '+' : '';
  return `<em class="delta ${tone}">${sign}${rounded}% ${esc(compare)}</em>`;
}

function chartNav(id: string, shift: number, max: number): string {
  return `<div class="chart-nav"><button type="button" class="chart-arrow" data-window="${id}" data-dir="prev" aria-label="Earlier" ${shift >= max ? 'disabled' : ''}>${ARROW_PREV}</button><button type="button" class="chart-arrow" data-window="${id}" data-dir="next" aria-label="Later" ${shift <= 0 ? 'disabled' : ''}>${ARROW_NEXT}</button></div>`;
}

function monthArrows(atLatest: boolean): string {
  return `<div class="chart-nav"><button type="button" class="chart-arrow" data-cal="prev" aria-label="Previous month">${ARROW_PREV}</button><button type="button" class="chart-arrow" data-cal="next" aria-label="Next month" ${atLatest ? 'disabled' : ''}>${ARROW_NEXT}</button></div>`;
}

function recentItem(ride: RideSummary): string {
  const kind = rideKind(ride);
  return `<li>
    <div class="feed-copy">
      <b title="${esc(ride.title)}">${esc(ride.title)}</b>
      <span>${esc(formatWhen(ride.startedAt))} · ${(ride.distanceM / 1000).toFixed(1)} km · ${formatDuration(rideMovingSec(ride))} · ${Math.round(ride.avgPower)} W</span>
    </div>
    ${kindBadge(kind)}
  </li>`;
}

function kindChip(kind: RideKind | 'all', label: string, count: number, current: RideKind | 'all'): string {
  return `<button type="button" class="chip ${kind === current ? 'selected' : ''}" data-kind="${kind}">${esc(label)} <span>${count}</span></button>`;
}

function finder(
  catalog: ReturnType<typeof segmentCatalog>,
  routeName: string,
  segmentName: string,
  routeId: string,
): string {
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
      <label for="segment-find">Segment</label>
      <div class="finder-line">
        <input id="segment-find" type="search" placeholder="${routeId ? 'Segments on this route' : 'All segments'}" autocomplete="off" value="${esc(segmentName)}" />
        <button type="button" class="btn small finder-go" data-finder="segment">Search</button>
      </div>
      <div class="finder-menu" id="segment-menu" hidden>
        <button type="button" data-segment="all">All segments</button>
        ${segments
          .map(
            (segment) => `<button type="button" data-segment="${esc(segment.climbId)}" data-route-id="${esc(segment.routeId)}" data-name="${esc(segment.climbName)}"><span class="finder-copy"><b>${esc(segment.climbName)}</b><span>${esc(segment.routeName)}</span></span></button>`,
          )
          .join('')}
      </div>
    </div>
  </div>`;
}

function head(key: RideSortKey, label: string, state: AnalyticsState, numeric = false): string {
  const on = state.sortKey === key;
  const arrow = on ? (state.sortDesc ? '↓' : '↑') : '';
  const sort = on ? (state.sortDesc ? 'descending' : 'ascending') : 'none';
  return `<th class="${numeric ? 'num' : ''}" aria-sort="${sort}"><button type="button" class="${on ? 'on' : ''}" data-sort="${key}">${label}${arrow ? ` <span class="sort-dir">${arrow}</span>` : ''}</button></th>`;
}

function rideTr(row: RideRow): string {
  const ride = row.ride;
  return `<tr>
    <td class="name" title="${esc(ride.title)}"><span class="name-line">${esc(ride.title)}</span><button class="ride-open" type="button" data-more="${esc(ride.id)}" aria-expanded="false">${CARET}<span>More details</span></button></td>
    <td class="when"><span class="when-day">${esc(formatDay(ride.startedAt))}</span><span class="when-time">${esc(formatClock(ride.startedAt))}</span></td>
    <td>${kindBadge(row.kind)}</td>
    <td class="num">${(ride.distanceM / 1000).toFixed(1)} km</td>
    <td class="num">${formatDuration(rideMovingSec(ride))}</td>
    <td class="num">+${Math.round(ride.ascentM)} m</td>
    <td class="num">${Math.round(ride.avgPower)} W</td>
    <td class="num">${row.segmentPower == null ? '—' : `${Math.round(row.segmentPower)} W`}</td>
    <td class="actions"><div class="row-actions"><button class="btn small" type="button" data-fit="${esc(ride.id)}">FIT</button><button class="btn small ghost danger" type="button" data-del="${esc(ride.id)}">Delete</button></div></td>
  </tr>
  <tr class="ride-detail" id="detail-${esc(ride.id)}" hidden>
    <td colspan="9">
      <div class="ride-detail-grid">
        <section><h4>Road ridden</h4><div data-detail-profile="${esc(ride.id)}"><p class="chart-note">The profile of the distance you rode.</p></div></section>
        <section><h4>Power every 3 minutes</h4><p class="chart-note">Colours follow your FTP, the same way a training plan does.</p><div data-detail-power="${esc(ride.id)}"></div></section>
      </div>
    </td>
  </tr>`;
}

function formatClock(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  return at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function kindBadge(kind: RideKind): string {
  return `<span class="badge kind kind-${kind}">${KIND_LABEL[kind]}</span>`;
}

function segmentBlock(series: SegmentSeries): string {
  const best = series.best;
  const length = series.lengthM ? `${(series.lengthM / 1000).toFixed(1)} km · ` : '';
  const attempts = series.attempts.length;
  return `
    <section class="chart-card segment-card" id="segment-${esc(series.climbId)}">
      <div class="chart-head">
        <h3>${esc(series.climbName)}</h3>
        <div class="legend" aria-hidden="true"><span><i class="swatch elevation"></i>Time</span><span><i class="swatch power"></i>Power</span></div>
      </div>
      <p class="segment-meta">${series.routeName ? `<span>${esc(series.routeName)}</span>` : ''}<span>Best ${formatDuration(best.timeSec)} · ${length}${Math.round(best.avgPower)} W · ${best.wkg.toFixed(2)} W/kg</span><span>${attempts} ${attempts === 1 ? 'attempt' : 'attempts'}</span></p>
      <p class="chart-note">Oldest attempt on the left. Time is the blue line, power is the orange line.</p>
      ${segmentChart(
        series.attempts.map((attempt) => ({
          label: shortDay(attempt.effort.createdAt),
          timeSec: attempt.effort.timeSec,
          power: attempt.effort.avgPower,
          title: `${formatDay(attempt.effort.createdAt)}: ${formatDuration(attempt.effort.timeSec)}, ${Math.round(attempt.effort.avgPower)} W`,
        })),
      )}
      <div class="table-wrap">
        <table class="analytics-table">
          <thead><tr><th>Date</th><th>Ride</th><th class="num">Time</th><th class="num">Average speed</th><th class="num">Average power</th></tr></thead>
          <tbody>
            ${series.rows
              .map((attempt) => {
                const pr = Math.abs(attempt.effort.timeSec - best.timeSec) < 0.5;
                return `<tr class="${pr ? 'is-pr' : ''}">
                  <td>${esc(formatDay(attempt.effort.createdAt))}</td>
                  <td class="name" title="${esc(attempt.rideTitle)}">${esc(attempt.rideTitle)}</td>
                  <td class="num">${formatDuration(attempt.effort.timeSec)}${pr ? ' <b class="pr">PR</b>' : ''}</td>
                  <td class="num">${attempt.speedKmh == null ? '—' : `${attempt.speedKmh.toFixed(1)} km/h`}</td>
                  <td class="num">${Math.round(attempt.effort.avgPower)} W</td>
                </tr>`;
              })
              .join('')}
          </tbody>
        </table>
      </div>
    </section>`;
}

function miniDay(day: ReturnType<typeof monthGrid>[number], today: string): string {
  const count = day.rides.length;
  const label = `${day.date.toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}${count ? `, ${count} ${count === 1 ? 'ride' : 'rides'}` : ', no rides'}`;
  const dots = day.rides
    .slice(0, 4)
    .map((ride) => `<i class="ride-dot kind-${rideKind(ride)}"></i>`)
    .join('');
  const extra = day.rides.length > 4 ? '<i class="ride-dot more">+</i>' : '';
  return `<button type="button" class="cal-dot ${day.inMonth ? '' : 'out'} ${day.key === today ? 'today' : ''}" data-day="${day.key}" data-jump="1" aria-label="${esc(label)}"><b>${day.date.getDate()}</b><span class="dot-row">${dots}${extra}</span></button>`;
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
  return `<div class="cal-cell ${day.inMonth ? '' : 'out'} ${day.key === selected ? 'selected' : ''} ${day.key === today ? 'today' : ''}"><button type="button" class="cal-num" data-day="${day.key}"><b>${day.date.getDate()}</b></button><div class="cal-chips">${chips}</div></div>`;
}

function calendarRide(ride: RideSummary, segmentPower: number | null, context: AnalyticsContext): string {
  const kind = rideKind(ride);
  const place = ride.race && ride.race.finishTimeSec != null ? `<div><dt>Result</dt><dd>P${ride.race.position} of ${ride.race.field}</dd></div>` : '';
  const segment = segmentPower == null ? '' : `<div><dt>Segment power</dt><dd>${Math.round(segmentPower)} W</dd></div>`;
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
      <div><dt>Distance</dt><dd>${(ride.distanceM / 1000).toFixed(1)} km</dd></div>
      <div><dt>Time</dt><dd>${formatDuration(rideMovingSec(ride))}</dd></div>
      <div><dt>Elevation</dt><dd>+${Math.round(ride.ascentM)} m</dd></div>
      <div><dt>Avg power</dt><dd>${Math.round(ride.avgPower)} W</dd></div>
      <div><dt>Avg speed</dt><dd>${ride.avgSpeedKmh.toFixed(1)} km/h</dd></div>
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

const ARROW_PREV = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.8 5.2 8 12l6.8 6.8" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ARROW_NEXT = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.2 5.2 16 12l-6.8 6.8" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const CARET = `<svg class="ride-caret" viewBox="0 0 12 12" aria-hidden="true"><path d="M1.8 4.1 6 8.2l4.2-4.1" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ICON_SESSIONS = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6.5" cy="16.5" r="2.4" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="17" cy="16.5" r="2.4" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M8.2 16.5 11 9.5h4.2l1.6 3.4H19M11.2 9.5 13 6.8h2.6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ICON_DISTANCE = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 16c2.2-5 4.2-5 6.4 0s4.2 5 6.4 0 4.2-5 6.2 0" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="5.2" cy="16" r="1.3" fill="currentColor"/></svg>`;
const ICON_ELEVATION = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 18 9 8l4 5 2.5-3.2L21 18z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>`;
const ICON_TIME = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7.2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M12 8.2V12l2.6 1.8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

function shortDay(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  return at.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
