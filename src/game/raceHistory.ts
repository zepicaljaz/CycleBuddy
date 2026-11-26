// Your Hill climb races: the list on the race screen and one race in full. Built from
// saved rides, so a race ridden before its settings were saved still shows what it has.
import { gradeProfileSvg, powerEvery } from '../analytics/shape';
import type { ClimbEffort, HillClimbRecord, RideSample, RideSummary } from '../storage/types';
import { formatDuration } from '../util/math';
import { esc, gradeColor } from '../ui/dom';

/** Length of one block of the power profile. */
export const RACE_BLOCK_SEC = 120;
/** Without a saved result, a ride this far up the climb counts as finished. */
const FINISHED_SHARE = 0.97;

export interface ClimbFacts {
  name: string;
  lengthM: number;
  gainM: number;
  avgGrade: number;
}

export interface RaceRow {
  ride: RideSummary;
  climbName: string;
  routeName: string;
  /** Null when the climb is no longer in the game and the race was saved without it. */
  climb: ClimbFacts | null;
  finished: boolean;
  timeSec: number | null;
  /** Seconds behind the winner. 0 for a win, null if you did not finish. */
  gapSec: number | null;
  position: number | null;
  field: number | null;
  /** Your weight on the day. Null when it was not saved: today's weight is not used instead. */
  weightKg: number | null;
  wkg: number | null;
  hill: HillClimbRecord | null;
}

export function isHillRace(ride: Pick<RideSummary, 'mode' | 'title' | 'race'>): boolean {
  return ride.mode === 'race' && (!!ride.race?.hill || ride.title.startsWith('Hill-climb race'));
}

/** Every Hill climb race, newest first. `climbOf` knows the climbs in the game. */
export function raceRows(rides: RideSummary[], efforts: ClimbEffort[], climbOf: (id: string) => ClimbFacts | null): RaceRow[] {
  return rides
    .filter(isHillRace)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .map((ride) => {
      const hill = ride.race?.hill ?? null;
      const climb = hill
        ? { name: hill.climbName, lengthM: hill.lengthM, gainM: hill.gainM, avgGrade: hill.avgGrade }
        : climbOf(ride.climbId ?? '');
      const mine = hill?.results.find((row) => row.player);
      const recorded = ride.race?.finishTimeSec ?? null;
      // Older saves gave a race you left a guessed time, so the distance has the last word.
      const finished = mine
        ? mine.timeSec !== null
        : recorded !== null && (!climb || ride.distanceM >= climb.lengthM * FINISHED_SHARE);
      const timeSec = finished ? mine?.timeSec ?? recorded : null;
      const winner = ride.race?.winnerTimeSec ?? null;
      const effort = efforts.find((e) => e.rideId === ride.id && e.climbId === ride.climbId);
      const weightKg = hill?.weightKg || (effort && effort.wkg > 0 ? effort.avgPower / effort.wkg : null);
      return {
        ride,
        climbName: climb?.name ?? (ride.title.replace(/^Hill-climb race:\s*/, '') || ride.routeName),
        routeName: ride.routeName,
        climb,
        finished,
        timeSec,
        gapSec: timeSec !== null && winner !== null ? Math.max(0, timeSec - winner) : null,
        position: finished ? ride.race?.position ?? null : null,
        field: ride.race?.field ?? null,
        weightKg,
        wkg: weightKg ? ride.avgPower / weightKg : null,
        hill,
      };
    });
}

export interface RaceBlock {
  fromSec: number;
  /** Seconds in the block. The last one is usually short. */
  seconds: number;
  power: number;
  zone: string;
  color: string;
  heartRate: number;
  cadence: number;
  /** Metres ridden and climbed in this block. */
  distanceM: number;
  climbedM: number;
}

/** Your race cut into two-minute blocks. */
export function raceBlocks(samples: RideSample[], ftp: number): RaceBlock[] {
  const bins = powerEvery(samples, ftp, RACE_BLOCK_SEC);
  const inside: RideSample[][] = bins.map(() => []);
  for (const sample of samples) inside[Math.floor(Math.max(0, sample.t) / RACE_BLOCK_SEC)]?.push(sample);
  const mean = (list: number[]) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0);
  let before: RideSample | undefined = samples[0];
  return bins.map((bin, i) => {
    const list = inside[i];
    let climbedM = 0;
    let previous = before;
    for (const sample of list) {
      if (previous) climbedM += Math.max(0, sample.altitude - previous.altitude);
      previous = sample;
    }
    const distanceM = list.length && before ? list[list.length - 1].distance - before.distance : 0;
    before = previous;
    return {
      fromSec: i * RACE_BLOCK_SEC,
      seconds: list.length,
      power: bin.avgPower,
      zone: bin.zone,
      color: bin.color,
      heartRate: mean(list.map((s) => s.heartRate).filter((v) => v > 0)),
      cadence: mean(list.map((s) => s.cadence).filter((v) => v > 0)),
      distanceM,
      climbedM,
    };
  });
}

/**
 * Power in two-minute columns with the road you rode under it, both on one time scale,
 * so each column stands over the stretch it was ridden on.
 */
export function raceChartHtml(samples: RideSample[], blocks: RaceBlock[]): string {
  const total = blocks.reduce((sum, b) => sum + b.seconds, 0);
  if (!total) return '<p class="chart-note">No power was recorded for this race.</p>';
  const top = Math.max(1, ...blocks.map((b) => b.power));
  const columns = blocks
    .map((b) => {
      const label = `${clockLabel(b.fromSec)} to ${clockLabel(b.fromSec + b.seconds)}, ${Math.round(b.power)} W, ${b.zone}`;
      const short = b.seconds < RACE_BLOCK_SEC / 2;
      return `<div class="race-col" style="flex-grow:${b.seconds}" title="${esc(label)}"><div class="race-col-bar" style="--h:${((b.power / top) * 100).toFixed(1)}%"><b>${short ? '' : Math.round(b.power)}</b><i style="background:${b.color}"></i></div><small>${short ? '' : Math.round(b.fromSec / 60)}</small></div>`;
    })
    .join('');
  const wide = blocks.length * 34;
  return `<div class="race-chart" role="img" aria-label="Power every 2 minutes over the road you rode"><div class="race-chart-inner" style="min-width:${wide}px"><div class="race-cols">${columns}</div>${timeProfileSvg(samples)}</div></div><p class="chart-note">Watts for each 2 minutes, with the start of each block in minutes. Under it, the road at the same moments, coloured by gradient. On a narrow screen, swipe the chart sideways.</p>`;
}

/** The road against time, not distance, to line up with the power columns. */
function timeProfileSvg(samples: RideSample[]): string {
  if (samples.length < 2) return '';
  const width = 1000;
  const height = 120;
  const step = Math.max(1, Math.ceil(samples.length / 240));
  const points = samples.filter((_, i) => i % step === 0);
  if (points[points.length - 1] !== samples[samples.length - 1]) points.push(samples[samples.length - 1]);
  const heights = points.map((p) => p.altitude);
  const min = Math.min(...heights);
  const rise = Math.max(8, Math.max(...heights) - min);
  const x = (p: RideSample) => ((Math.min(samples.length, p.t + 1) / samples.length) * width).toFixed(1);
  const y = (value: number) => (height - 8 - ((value - min) / rise) * (height - 14)).toFixed(1);
  const fills = points
    .slice(1)
    .map((p, i) => {
      const prev = points[i];
      const run = p.distance - prev.distance;
      const grade = run > 1 ? (p.altitude - prev.altitude) / run : p.grade;
      return `<path d="M${x(prev)},${y(prev.altitude)} L${x(p)},${y(p.altitude)} L${x(p)},${height} L${x(prev)},${height} Z" fill="${gradeColor(grade)}"/>`;
    })
    .join('');
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p)},${y(p.altitude)}`).join(' ');
  return `<svg class="race-road" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">${fills}<path d="${line}" fill="none" stroke="rgba(255,255,255,0.92)" stroke-width="1.6" vector-effect="non-scaling-stroke"/></svg>`;
}

function clockLabel(sec: number): string {
  return formatDuration(sec);
}

export function ordinalPlace(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

function raceDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function gapText(row: RaceRow): string {
  if (row.gapSec === null) return '—';
  return row.gapSec < 0.5 ? 'Winner' : `+${formatDuration(row.gapSec)}`;
}

const wkgText = (value: number | null) => (value === null ? '—' : value.toFixed(2));

/** The list of races. `rows` is null while they are still being read. */
export function raceListHtml(rows: RaceRow[] | null): string {
  if (!rows) return '<p class="muted race-empty">Reading your races…</p>';
  if (!rows.length) return '<p class="muted race-empty">No races yet. Finish a Hill climb race and it shows up here.</p>';
  const cell = (label: string, value: string, extra = '') => `<span class="race-cell ${extra}"><small>${label}</small><b>${value}</b></span>`;
  const items = rows
    .map((row) => {
      const ai = row.hill ? `${row.hill.topWkg.toFixed(1)}–${row.hill.bottomWkg.toFixed(1)}` : '—';
      const place = row.finished && row.position ? `${row.position}<i> / ${row.field ?? '—'}</i>` : 'DNF';
      return `<li><button type="button" class="race-row" data-race-open="${esc(row.ride.id)}">
        <span class="race-what"><b>${esc(row.climbName)}</b><span>${raceDate(row.ride.startedAt)}${row.climb ? ` · ${(row.climb.lengthM / 1000).toFixed(1)} km` : ''}</span></span>
        ${cell('Time', row.timeSec === null ? '—' : formatDuration(row.timeSec))}
        ${cell('Place', place)}
        ${cell('Gap', gapText(row))}
        ${cell('Avg power', `${Math.round(row.ride.avgPower)} W`)}
        ${cell('W/kg', wkgText(row.wkg))}
        ${cell('AI W/kg', ai)}
      </button></li>`;
    })
    .join('');
  return `<ul class="race-list">${items}</ul>`;
}

/** One race in full. `samples` is null while they are still being read. */
export function raceDetailHtml(row: RaceRow, samples: RideSample[] | null, ftp: number): string {
  const { ride, hill, climb } = row;
  const figure = (label: string, value: string, unit = '', note = '') =>
    `<div><dt>${label}</dt><dd>${value}${unit ? `<small>${unit}</small>` : ''}</dd>${note ? `<span>${note}</span>` : ''}</div>`;
  const fact = (label: string, value: string) => `<div><dt>${label}</dt><dd>${value}</dd></div>`;
  const number = (value: number, unit: string) => (value > 0 ? `${Math.round(value)} ${unit}` : '—');
  const winner = hill?.results[0];
  const winnerTime = ride.race?.winnerTimeSec ?? null;

  const headline = `<dl class="an-figures five">
    ${figure('Time', row.timeSec === null ? 'DNF' : formatDuration(row.timeSec))}
    ${figure('Place', row.finished && row.position ? ordinalPlace(row.position) : '—', '', row.field ? `of ${row.field}` : '')}
    ${figure('Behind winner', gapText(row))}
    ${figure('Avg power', String(Math.round(ride.avgPower)), 'W')}
    ${figure('W/kg', wkgText(row.wkg), '', row.weightKg ? `at ${Math.round(row.weightKg * 10) / 10} kg` : 'weight not saved')}
  </dl>`;

  const facts = `<dl class="an-facts">
    ${fact('Climb length', climb ? `${(climb.lengthM / 1000).toFixed(1)} km` : '—')}
    ${fact('Climb height', climb ? `${Math.round(climb.gainM)} m` : '—')}
    ${fact('Average gradient', climb ? `${(climb.avgGrade * 100).toFixed(1)}%` : '—')}
    ${fact('Distance ridden', `${(ride.distanceM / 1000).toFixed(2)} km`)}
    ${fact('Climbed', `${Math.round(ride.ascentM)} m`)}
    ${fact('Ride time', formatDuration(ride.durationSec))}
    ${fact('Average speed', ride.avgSpeedKmh > 0 ? `${ride.avgSpeedKmh.toFixed(1)} km/h` : '—')}
    ${fact('Normalized power', number(ride.normalizedPower, 'W'))}
    ${fact('Max power', number(ride.maxPower, 'W'))}
    ${fact('Average heart rate', number(ride.avgHeartRate, 'bpm'))}
    ${fact('Max heart rate', number(ride.maxHeartRate, 'bpm'))}
    ${fact('Average cadence', number(ride.avgCadence, 'rpm'))}
    ${hill ? fact('Your FTP that day', number(hill.ftp, 'W')) : ''}
  </dl>`;

  const faded = hill ? hill.results.filter((r) => r.drop > 0).length : 0;
  const field = hill
    ? `<dl class="an-facts">
        ${fact('AI riders', String(hill.aiCount))}
        ${fact('Strongest', `${hill.topWkg.toFixed(1)} W/kg`)}
        ${fact('Slowest', `${hill.bottomWkg.toFixed(1)} W/kg`)}
        ${fact('Lost power near the top', String(faded))}
        ${winner ? fact('Winner', esc(winner.name)) : ''}
        ${fact('Winning time', winnerTime === null ? '—' : formatDuration(winnerTime))}
      </dl>`
    : `<p class="chart-note">The AI settings and the finishing order were not saved for this race. Races from now on keep them.${winnerTime === null ? '' : ` Winning time: ${formatDuration(winnerTime)}.`}</p>`;

  let trace = '<p class="muted">Reading the ride…</p>';
  let table = '';
  if (samples) {
    const blocks = raceBlocks(samples, hill?.ftp || ftp);
    trace = raceChartHtml(samples, blocks) + (blocks.length ? '' : gradeProfileSvg(samples));
    if (blocks.length) {
      const rows = blocks
        .map((b) => `<tr><th>${clockLabel(b.fromSec)}–${clockLabel(b.fromSec + b.seconds)}</th><td class="num">${Math.round(b.power)} W</td><td class="num">${row.weightKg ? (b.power / row.weightKg).toFixed(2) : '—'}</td><td class="num">${b.heartRate > 0 ? Math.round(b.heartRate) : '—'}</td><td class="num">${b.cadence > 0 ? Math.round(b.cadence) : '—'}</td><td class="num">${(b.distanceM / 1000).toFixed(2)} km</td><td class="num">${Math.round(b.climbedM)} m</td></tr>`)
        .join('');
      table = `<section class="an-section"><div class="an-head"><h3>Every 2 minutes</h3></div><div class="race-table-wrap"><table class="analytics-table"><thead><tr><th>Time</th><th class="num">Power</th><th class="num">W/kg</th><th class="num">Heart rate</th><th class="num">Cadence</th><th class="num">Distance</th><th class="num">Climbed</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
    }
  }

  const best = winner?.timeSec ?? null;
  const results = hill
    ? `<section class="an-section"><div class="an-head"><h3>Finishing order</h3><span class="muted">W/kg is what a rider set out with. Lost is the part of it that went near the top.</span></div><div class="race-table-wrap"><table class="analytics-table race-results-table"><thead><tr><th class="num">#</th><th>Rider</th><th class="num">W/kg</th><th class="num">Lost</th><th class="num">Time</th><th class="num">Gap</th></tr></thead><tbody>${hill.results
        .map((r, i) => {
          const gap = r.timeSec === null || best === null || i === 0 ? '' : r.timeSec - best < 0.5 ? 's.t.' : `+${formatDuration(r.timeSec - best)}`;
          return `<tr class="${r.player ? 'me' : ''}"><td class="num">${r.timeSec === null ? '—' : i + 1}</td><th class="name">${esc(r.name)}${r.country ? ` <small>${esc(r.country)}</small>` : ''}</th><td class="num">${r.wkg.toFixed(2)}</td><td class="num">${r.drop > 0 ? `${Math.round(r.drop * 100)}%` : ''}</td><td class="num">${r.timeSec === null ? 'DNF' : formatDuration(r.timeSec)}</td><td class="num">${gap}</td></tr>`;
        })
        .join('')}</tbody></table></div></section>`
    : '';

  return `<div class="analytics-stack race-detail-page">
    <div><button type="button" class="an-link" data-race-back>All races</button><h3 class="race-title">${esc(row.climbName)}</h3><p class="an-lead">${raceDate(ride.startedAt)}${row.routeName && row.routeName !== row.climbName ? ` · ${esc(row.routeName)}` : ''}${row.finished ? '' : ' · Did not finish'}</p></div>
    ${headline}
    <section class="an-section"><div class="an-head"><h3>Power and road</h3></div>${trace}</section>
    <section class="an-section"><div class="an-head"><h3>Your ride</h3></div>${facts}</section>
    <section class="an-section"><div class="an-head"><h3>The race</h3></div>${field}</section>
    ${table}
    ${results}
  </div>`;
}
