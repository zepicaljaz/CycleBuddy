import type { RouteDef } from '../routes/types';
import type { RideSample } from '../storage/types';
import { zoneAt } from '../training/workout';
import { gradeColor } from '../ui/dom';

export interface PowerBin {
  /** Start of the block, in minutes. */
  minutes: number;
  /** Length of the block, in minutes. */
  windowMin: number;
  avgPower: number;
  zone: string;
  color: string;
}

/** Average power for each block of a ride, coloured from the rider's FTP. */
export function powerEvery(samples: RideSample[], ftp: number, windowSec: number): PowerBin[] {
  if (!samples.length) return [];
  const window = Math.max(1, windowSec);
  const bins = new Map<number, { sum: number; n: number }>();
  for (const sample of samples) {
    const index = Math.floor(Math.max(0, sample.t) / window);
    const bin = bins.get(index) ?? { sum: 0, n: 0 };
    bin.sum += Number.isFinite(sample.power) ? sample.power : 0;
    bin.n += 1;
    bins.set(index, bin);
  }
  const last = Math.max(...bins.keys());
  const windowMin = window / 60;
  const out: PowerBin[] = [];
  for (let i = 0; i <= last; i++) {
    const bin = bins.get(i);
    const avg = bin && bin.n > 0 ? bin.sum / bin.n : 0;
    const zone = ftp > 0 ? zoneAt(avg / ftp) : { name: 'Power', color: '#ff7f2a' };
    out.push({ minutes: i * windowMin, windowMin, avgPower: avg, zone: zone.name, color: zone.color });
  }
  return out;
}

/** Elevation along the distance that was actually ridden. */
export function riddenElevations(samples: RideSample[], maxPoints = 96): number[] {
  const points = samples.filter((sample) => Number.isFinite(sample.distance) && Number.isFinite(sample.altitude));
  if (points.length < 2) return [];
  const distance = points[points.length - 1].distance - points[0].distance;
  if (!(distance > 1)) return [];
  const step = Math.max(1, Math.ceil(points.length / maxPoints));
  const out: number[] = [];
  for (let i = 0; i < points.length; i += step) out.push(points[i].altitude);
  const last = points[points.length - 1].altitude;
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

/** A light side profile from the route's gradients. Enough for a search thumbnail. */
export function routeElevations(def: Pick<RouteDef, 'startElevation' | 'sections'>, points = 40): number[] {
  const raw: number[] = [];
  let elev = def.startElevation;
  raw.push(elev);
  for (const section of def.sections) {
    const grades = section.grades.length ? section.grades : [0];
    const step = section.length / grades.length;
    for (const grade of grades) {
      elev += (grade / 100) * step;
      raw.push(elev);
    }
  }
  if (raw.length <= points) return raw;
  const out: number[] = [];
  for (let i = 0; i < points; i++) out.push(raw[Math.round((i / (points - 1)) * (raw.length - 1))]);
  return out;
}

export function elevationSvg(elevations: number[], width = 72, height = 28, className = 'route-sketch', stretch = false): string {
  if (elevations.length < 2) return '';
  const min = Math.min(...elevations);
  const max = Math.max(...elevations);
  const span = Math.max(8, max - min);
  const base = min - span * 0.08;
  const top = base + span * 1.16;
  const x = (i: number) => (i / (elevations.length - 1)) * width;
  const y = (value: number) => height - ((value - base) / (top - base)) * (height - 2) - 1;
  const line = elevations.map((value, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(value).toFixed(1)}`).join(' ');
  const fill = `${line} L${width.toFixed(1)},${height} L0,${height} Z`;
  const fit = stretch ? ' preserveAspectRatio="none"' : '';
  return `<svg class="${className}" viewBox="0 0 ${width} ${height}"${fit} aria-hidden="true"><path d="${fill}" fill="rgba(255,127,42,0.28)"/><path d="${line}" fill="none" stroke="#ff7f2a" stroke-width="1.6" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}

/** Side profile of the ridden road, coloured by its gradient the same way the route profile is. */
export function gradeProfileSvg(samples: RideSample[], width = 420, height = 88, className = 'ridden-profile'): string {
  const points = samples
    .filter((sample) => Number.isFinite(sample.altitude) && Number.isFinite(sample.distance))
    .slice()
    .sort((a, b) => a.distance - b.distance || a.t - b.t);
  if (points.length < 2) return '';
  const start = points[0].distance;
  const span = points[points.length - 1].distance - start;
  if (!(span > 1)) return '';
  const slices = Math.min(72, Math.max(12, points.length - 1));
  const values = Array.from({ length: slices + 1 }, (_, i) => altitudeAtDistance(points, start + (span * i) / slices));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const rise = Math.max(8, max - min);
  const base = min - rise * 0.08;
  const top = base + rise * 1.16;
  const yOf = (value: number) => height - ((value - base) / (top - base)) * (height - 2) - 1;
  const xOf = (i: number) => (i / slices) * width;
  const run = span / slices;
  const fills = values
    .slice(0, -1)
    .map((value, i) => {
      const x0 = xOf(i).toFixed(1);
      const x1 = xOf(i + 1).toFixed(1);
      const y0 = yOf(value).toFixed(1);
      const y1 = yOf(values[i + 1]).toFixed(1);
      return `<path d="M${x0},${y0} L${x1},${y1} L${x1},${height} L${x0},${height} Z" fill="${gradeColor((values[i + 1] - value) / run)}"/>`;
    })
    .join('');
  const line = values.map((value, i) => `${i === 0 ? 'M' : 'L'}${xOf(i).toFixed(1)},${yOf(value).toFixed(1)}`).join(' ');
  return `<svg class="${className}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">${fills}<path d="${line}" fill="none" stroke="rgba(255,255,255,0.92)" stroke-width="1.6" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}

function altitudeAtDistance(points: RideSample[], distance: number): number {
  if (distance <= points[0].distance) return points[0].altitude;
  const last = points[points.length - 1];
  if (distance >= last.distance) return last.altitude;
  for (let i = 1; i < points.length; i++) {
    const next = points[i];
    if (next.distance < distance) continue;
    const prev = points[i - 1];
    const span = next.distance - prev.distance;
    const mix = span > 0 ? (distance - prev.distance) / span : 0;
    return prev.altitude + (next.altitude - prev.altitude) * mix;
  }
  return last.altitude;
}

/** Bars use the same FTP scale as a training plan, so an easy hour stays low. */
export function powerBarsHtml(bins: PowerBin[], ftp: number, variant: 'wide' | 'compact' | 'tiny' = 'wide'): string {
  if (!bins.length) return '';
  const ceiling = ftp > 0 ? ftp * 1.75 : Math.max(...bins.map((bin) => bin.avgPower), 1);
  const bars = bins
    .map((bin) => {
      const height = Math.max(6, Math.min(100, (bin.avgPower / ceiling) * 100));
      const end = bin.minutes + bin.windowMin;
      const label = `${minute(bin.minutes)}–${minute(end)} min, ${Math.round(bin.avgPower)} W, ${bin.zone}`;
      return `<i style="height:${height.toFixed(0)}%;background:${bin.color}" title="${escapeAttr(label)}"></i>`;
    })
    .join('');
  const every = minute(bins[0].windowMin);
  return `<span class="power-bar ${variant}" aria-label="Power every ${every} minutes">${bars}</span>`;
}

function minute(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function escapeAttr(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char);
}
