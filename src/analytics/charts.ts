import type { MonthBucket } from './model';

export interface ChartPoint {
  label: string;
  value: number;
  title?: string;
}

export interface LinePoint {
  label: string;
  value: number | null;
  title?: string;
}

const FONT = 'Roboto, sans-serif';
const MUTED = 'rgba(243,245,247,0.62)';
const GRID = 'rgba(255,255,255,0.1)';
const ORANGE = '#ff7f2a';
const BLUE = '#8ec8ff';
/** 150 m of climbing lines up with every 10 km ridden. */
const METRES_PER_KM = 15;

export function axisMax(value: number): number {
  if (!(value > 0)) return 1;
  const exp = Math.floor(Math.log10(value));
  const base = 10 ** exp;
  const scaled = value / base;
  const nice = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
  return nice * base;
}

export interface ActivityBucket {
  label: string;
  title: string;
  distanceM: number;
  ascentM: number;
  sessions: number;
}

export function activityChart(buckets: ActivityBucket[], aria: string, empty = 'No riding in this range yet.'): string {
  const has = buckets.some((bucket) => bucket.distanceM > 0 || bucket.ascentM > 0);
  if (!has) return emptyChart(empty);
  const distance = buckets.map((bucket) => bucket.distanceM / 1000);
  const ascent = buckets.map((bucket) => bucket.ascentM);
  const score = axisMax(Math.max(...distance, ...ascent.map((metres) => metres / METRES_PER_KM)));
  const f = frame(52, 50);
  const clip = plotClip(f);
  const slot = f.innerW / buckets.length;
  const xOf = (i: number) => f.l + slot * i + slot / 2;
  const distanceLine = buckets.map((_, i) => ({ x: xOf(i), y: yOf(f, distance[i], score) }));
  const ascentLine = buckets.map((_, i) => ({ x: xOf(i), y: yOf(f, ascent[i] / METRES_PER_KM, score) }));
  const dots = (coords: { x: number; y: number }[], values: number[], color: string) =>
    coords
      .map((point, i) => (values[i] > 0 ? `<circle cx="${n(point.x)}" cy="${n(point.y)}" r="3" fill="${color}" stroke="#101820" stroke-width="1" pointer-events="none" />` : ''))
      .join('');
  const labels = buckets
    .map((bucket, i) => `<text x="${n(xOf(i))}" y="${f.h - 8}" text-anchor="middle" fill="${MUTED}" font-size="10" font-family="${FONT}">${esc(bucket.label)}</text>`)
    .join('');
  const hits = buckets
    .map((bucket, i) => {
      const km = distance[i];
      const tip = `${bucket.title}\n${km.toFixed(1)} km ridden\n${Math.round(ascent[i]).toLocaleString('en-GB')} m climbed\n${bucket.sessions} ${bucket.sessions === 1 ? 'ride' : 'rides'}`;
      return slotHit(f, i, slot, tip);
    })
    .join('');
  return svg(
    f,
    aria,
    `${clip.markup}${grid(f, score, axisText)}${rightGrid(f, score)}${smoothPath(distanceLine, ORANGE, base(f), clip.id)}${smoothPath(ascentLine, BLUE, base(f), clip.id)}${dots(distanceLine, distance, ORANGE)}${dots(ascentLine, ascent, BLUE)}${labels}${hits}`,
  );
}

export function monthlyChart(buckets: MonthBucket[]): string {
  const peakKm = Math.max(0, ...buckets.map((bucket) => bucket.distanceM / 1000));
  const peakM = Math.max(0, ...buckets.map((bucket) => bucket.ascentM));
  return activityChart(
    buckets,
    `Monthly activity. Tallest distance ${peakKm.toFixed(1)} kilometres. Most climbing ${Math.round(peakM)} metres. Lines meet at 150 metres for every 10 kilometres.`,
    'No riding in these months yet.',
  );
}

export function barChart(points: ChartPoint[], aria: string, color = ORANGE): string {
  if (!points.some((point) => point.value > 0)) return emptyChart('No rides in these weeks yet.');
  const max = axisMax(Math.max(...points.map((point) => point.value)));
  const ticks = max <= 6 ? Array.from({ length: max + 1 }, (_, i) => i) : [0, max / 2, max];
  const f = frame(44, 14);
  const slot = f.innerW / points.length;
  const barW = Math.max(6, Math.min(26, slot * 0.52));
  const bars = points
    .map((point, i) => {
      if (!(point.value > 0)) return '';
      const x = f.l + slot * i + slot / 2;
      const y = yOf(f, point.value, max);
      return `<rect x="${n(x - barW / 2)}" y="${n(y)}" width="${n(barW)}" height="${n(base(f) - y)}" rx="2" fill="${color}" pointer-events="none" />`;
    })
    .join('');
  const hits = points
    .map((point, i) => {
      const tip = point.title ?? `${point.label}: ${point.value}`;
      return slotHit(f, i, slot, tip);
    })
    .join('');
  const labels = xLabels(f, points.map((point) => point.label));
  return svg(f, aria, `${gridTicks(f, ticks, max, (value) => (Number.isInteger(value) ? String(value) : axisText(value)))}${bars}${labels}${hits}`);
}

export function lineChart(points: LinePoint[], aria: string, color = ORANGE): string {
  const values = points.flatMap((point) => (point.value == null ? [] : [point.value]));
  if (!values.length) return emptyChart('No power recorded for these rides yet.');
  const domain = paddedDomain(values);
  const f = frame(46, 14);
  const floor = values.every((value) => value >= 0) ? yScale(f, 0, domain) : undefined;
  const clip = plotClip(f);
  const slot = f.innerW / points.length;
  const coords = points.map((point, i) => ({
    x: f.l + slot * i + slot / 2,
    y: point.value == null ? null : yScale(f, point.value, domain),
  }));
  const labels = xLabels(f, points.map((point) => point.label));
  const dots = points
    .map((point, i) => {
      const y = coords[i].y;
      if (y == null || point.value == null) return '';
      const last = i === lastValue(points);
      return `<circle cx="${n(coords[i].x)}" cy="${n(y)}" r="${last ? 4.5 : 3}" fill="${color}" stroke="#101820" stroke-width="1" pointer-events="none" />`;
    })
    .join('');
  const hits = points
    .map((point, i) => {
      const tip = point.title ?? (point.value == null ? `${point.label}: no ride` : `${point.label}: ${Math.round(point.value)} W`);
      return slotHit(f, i, slot, tip);
    })
    .join('');
  return svg(f, aria, `${clip.markup}${gridTicks(f, [domain.min, (domain.min + domain.max) / 2, domain.max], domain.max, axisText, domain)}${smoothRuns(coords, color, floor, clip.id)}${dots}${labels}${hits}`);
}

export function segmentChart(points: { label: string; timeSec: number; power: number; title: string }[]): string {
  if (!points.length) return emptyChart('No attempts yet.');
  const times = points.map((point) => point.timeSec / 60);
  const powers = points.map((point) => point.power);
  const timeDomain = paddedDomain(times);
  const powerDomain = paddedDomain(powers);
  const f = frame(48, 48);
  const clip = plotClip(f);
  const slot = f.innerW / points.length;
  const xs = points.map((_, i) => f.l + slot * i + slot / 2);
  const timeFloor = times.every((value) => value >= 0) ? yScale(f, 0, timeDomain) : undefined;
  const powerFloor = powers.every((value) => value >= 0) ? yScale(f, 0, powerDomain) : undefined;
  const timeLine = smoothPath(
    points.map((_, i) => ({ x: xs[i], y: yScale(f, times[i], timeDomain) })),
    BLUE,
    timeFloor,
    clip.id,
  );
  const powerLine = smoothPath(
    points.map((_, i) => ({ x: xs[i], y: yScale(f, powers[i], powerDomain) })),
    ORANGE,
    powerFloor,
    clip.id,
  );
  const dots = points
    .map((point, i) => {
      const ty = yScale(f, times[i], timeDomain);
      const py = yScale(f, powers[i], powerDomain);
      return `<circle cx="${n(xs[i])}" cy="${n(ty)}" r="3" fill="${BLUE}" stroke="#101820" stroke-width="1"><title>${esc(point.title)}</title></circle><circle cx="${n(xs[i])}" cy="${n(py)}" r="3" fill="${ORANGE}" stroke="#101820" stroke-width="1"><title>${esc(point.title)}</title></circle>`;
    })
    .join('');
  const step = points.length <= 8 ? 1 : points.length <= 16 ? 2 : Math.ceil(points.length / 8);
  const labels = points
    .map((point, i) => {
      if (i % step !== 0 && i !== points.length - 1) return '';
      return `<text x="${n(xs[i])}" y="${f.h - 8}" text-anchor="middle" fill="${MUTED}" font-size="10" font-family="${FONT}">${esc(point.label)}</text>`;
    })
    .join('');
  const hits = points
    .map((point, i) => slotHit(f, i, slot, point.title))
    .join('');
  const aria = `Power and time across ${points.length} ${points.length === 1 ? 'attempt' : 'attempts'}.`;
  return svg(
    f,
    aria,
    `${clip.markup}${gridTicks(f, [timeDomain.min, (timeDomain.min + timeDomain.max) / 2, timeDomain.max], timeDomain.max, axisText, timeDomain)}${rightDomain(f, powerDomain)}${timeLine}${powerLine}${dots}${labels}${hits}`,
  );
}

interface Box {
  w: number;
  h: number;
  l: number;
  r: number;
  t: number;
  b: number;
  innerW: number;
  innerH: number;
}

interface Domain {
  min: number;
  max: number;
}

function frame(left: number, right: number): Box {
  const w = 640;
  const h = 214;
  const t = 14;
  const b = 30;
  return { w, h, l: left, r: right, t, b, innerW: w - left - right, innerH: h - t - b };
}

function base(f: Box): number {
  return f.t + f.innerH;
}

/** A column the pointer can rest on, with a guide through the point it describes. */
function slotHit(f: Box, index: number, slot: number, tip: string): string {
  const x = f.l + slot * index;
  const cx = x + slot / 2;
  return `<g class="chart-slot"><rect class="chart-hit" x="${n(x)}" y="${f.t}" width="${n(slot)}" height="${n(f.innerH)}" fill="transparent" data-x="${n(cx)}" data-tip="${tipAttr(tip)}" /><line class="chart-guide" x1="${n(cx)}" y1="${f.t}" x2="${n(cx)}" y2="${n(base(f))}" vector-effect="non-scaling-stroke" /></g>`;
}

function yOf(f: Box, value: number, max: number): number {
  const safe = max > 0 ? max : 1;
  return base(f) - (Math.max(0, value) / safe) * f.innerH;
}

function yScale(f: Box, value: number, domain: Domain): number {
  const span = domain.max - domain.min || 1;
  return base(f) - ((value - domain.min) / span) * f.innerH;
}

function grid(f: Box, max: number, format: (value: number) => string): string {
  return gridTicks(f, [0, max / 2, max], max, format);
}

function gridTicks(f: Box, ticks: number[], max: number, format: (value: number) => string, domain?: Domain): string {
  return ticks
    .map((tick) => {
      const y = domain ? yScale(f, tick, domain) : yOf(f, tick, max);
      return `<line x1="${f.l}" y1="${n(y)}" x2="${n(f.w - f.r)}" y2="${n(y)}" stroke="${GRID}" /><text x="${f.l - 8}" y="${n(y + 3)}" text-anchor="end" fill="${MUTED}" font-size="10" font-family="${FONT}">${esc(format(tick))}</text>`;
    })
    .join('');
}

function rightGrid(f: Box, maxScore: number): string {
  return [0, maxScore / 2, maxScore]
    .map((tick) => {
      const y = yOf(f, tick, maxScore);
      return `<text x="${f.w - f.r + 8}" y="${n(y + 3)}" fill="${BLUE}" font-size="10" font-family="${FONT}">${esc(axisText(tick * METRES_PER_KM))}</text>`;
    })
    .join('');
}

function rightDomain(f: Box, domain: Domain): string {
  return [domain.min, (domain.min + domain.max) / 2, domain.max]
    .map((tick) => {
      const y = yScale(f, tick, domain);
      return `<text x="${f.w - f.r + 8}" y="${n(y + 3)}" fill="${ORANGE}" font-size="10" font-family="${FONT}">${esc(axisText(tick))}</text>`;
    })
    .join('');
}

function xLabels(f: Box, labels: string[]): string {
  const slot = f.innerW / labels.length;
  const step = labels.length <= 8 ? 1 : labels.length <= 16 ? 2 : Math.ceil(labels.length / 8);
  return labels
    .map((label, i) => {
      if (i % step !== 0 && i !== labels.length - 1) return '';
      return `<text x="${n(f.l + slot * i + slot / 2)}" y="${f.h - 8}" text-anchor="middle" fill="${MUTED}" font-size="10" font-family="${FONT}">${esc(label)}</text>`;
    })
    .join('');
}

let clipSerial = 0;

function plotClip(f: Box): { id: string; markup: string } {
  const id = `cb-plot-${++clipSerial}`;
  return {
    id,
    markup: `<defs><clipPath id="${id}"><rect x="${n(f.l)}" y="${n(f.t)}" width="${n(f.innerW)}" height="${n(f.innerH)}"/></clipPath></defs>`,
  };
}

function smoothPath(points: { x: number; y: number }[], color: string, maxY?: number, clip?: string): string {
  if (points.length < 2) return '';
  const clamp = (y: number) => (maxY == null ? y : Math.min(y, maxY));
  let d = `M${n(points[0].x)},${n(points[0].y)}`;
  if (points.length === 2) d += ` L${n(points[1].x)},${n(points[1].y)}`;
  else {
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[Math.max(0, i - 1)];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[Math.min(points.length - 1, i + 2)];
      const c1x = p1.x + (p2.x - p0.x) / 6;
      const c1y = clamp(p1.y + (p2.y - p0.y) / 6);
      const c2x = p2.x - (p3.x - p1.x) / 6;
      const c2y = clamp(p2.y - (p3.y - p1.y) / 6);
      d += ` C${n(c1x)},${n(c1y)} ${n(c2x)},${n(c2y)} ${n(p2.x)},${n(p2.y)}`;
    }
  }
  const clipped = clip ? ` clip-path="url(#${clip})"` : '';
  return `<path d="${d}" fill="none" stroke="${color}" stroke-width="2.25" stroke-linejoin="round" stroke-linecap="round" pointer-events="none"${clipped} />`;
}

function smoothRuns(points: { x: number; y: number | null }[], color: string, maxY?: number, clip?: string): string {
  const runs: { x: number; y: number }[][] = [];
  let run: { x: number; y: number }[] = [];
  for (const point of points) {
    if (point.y == null) {
      if (run.length) runs.push(run);
      run = [];
      continue;
    }
    run.push({ x: point.x, y: point.y });
  }
  if (run.length) runs.push(run);
  return runs.filter((item) => item.length > 1).map((item) => smoothPath(item, color, maxY, clip)).join('');
}

function tipAttr(value: string): string {
  return esc(value).replace(/\n/g, '&#10;');
}

function paddedDomain(values: number[]): Domain {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  if (lo === hi) {
    const pad = lo === 0 ? 1 : Math.max(1, Math.abs(lo) * 0.12);
    const min = lo >= 0 ? Math.max(0, lo - pad) : lo - pad;
    return { min, max: hi + pad };
  }
  const pad = (hi - lo) * 0.18;
  const min = lo >= 0 ? Math.max(0, lo - pad) : lo - pad;
  return { min, max: hi + pad };
}

function lastValue(points: LinePoint[]): number {
  for (let i = points.length - 1; i >= 0; i--) if (points[i].value != null) return i;
  return -1;
}

function axisText(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const abs = Math.abs(value);
  if (abs >= 100) return Math.round(value).toLocaleString('en-GB');
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function emptyChart(label: string): string {
  return `<svg class="chart" viewBox="0 0 640 180" role="img" aria-label="${esc(label)}" focusable="false"><text x="320" y="96" text-anchor="middle" fill="${MUTED}" font-size="13" font-family="${FONT}">${esc(label)}</text></svg>`;
}

function svg(f: Box, aria: string, body: string): string {
  return `<svg class="chart" viewBox="0 0 ${f.w} ${f.h}" role="img" aria-label="${esc(aria)}" focusable="false">${body}</svg>`;
}

function n(value: number): string {
  return value.toFixed(1);
}

function esc(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char);
}
