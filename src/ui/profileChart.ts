import type { Route } from '../routes/route';
import { gradeColor } from './dom';

/**
 * Side profile used while a ride loads.
 * The height uses the same elevation scale as the route card, so a flat loop
 * stays low and a mountain fills the line. `progress` 0 is the whole silhouette
 * in grey. The card colours fill from the left.
 */
export function drawLoadProfile(
  canvas: HTMLCanvasElement,
  route: Route,
  progress: number,
  span?: { start: number; end: number },
  reverse = false,
): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(2, Math.round(canvas.clientWidth * dpr));
  const h = Math.max(2, Math.round(canvas.clientHeight * dpr));
  if (canvas.clientWidth < 2 || canvas.clientHeight < 2) return;
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const p = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
  const n = 280;
  const mirrored = reverse && !span;
  const start = span?.start ?? 0;
  const end = span?.end ?? route.length;
  const len = Math.max(1, end - start);
  const along = (i: number) => (mirrored ? end - (len * i) / n : start + (len * i) / n);
  const ys: number[] = [];
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i <= n; i++) {
    const y = route.elevationAt(along(i));
    ys.push(y);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const range = Math.max(1, maxY - minY);
  const chartSpan = freeRideProfileSpan(len, range);
  const base = minY - chartSpan * 0.04;
  const plotBottom = h - 8 * dpr;
  const plotH = h - 18 * dpr;
  const Y = (y: number) => plotBottom - ((y - base) / chartSpan) * plotH;
  const highlights = climbHighlightSpans(route, mirrored);
  const onClimb = (i: number) => {
    const s = along(i);
    return highlights.some((c) => s >= c.start && s <= c.end);
  };
  const fillSlice = (i: number) => {
    const g = (ys[i + 1] - ys[i]) / (len / n);
    ctx.fillStyle = gradeColor(g);
    ctx.beginPath();
    ctx.moveTo((i / n) * w, plotBottom);
    ctx.lineTo((i / n) * w, Y(ys[i]));
    ctx.lineTo(((i + 1) / n) * w, Y(ys[i + 1]));
    ctx.lineTo(((i + 1) / n) * w, plotBottom);
    ctx.closePath();
    ctx.fill();
  };
  const ridge = () => {
    ctx.beginPath();
    ys.forEach((y, i) => {
      const x = (i / n) * w;
      if (i === 0) ctx.moveTo(x, Y(y));
      else ctx.lineTo(x, Y(y));
    });
  };

  ctx.clearRect(0, 0, w, h);
  ctx.beginPath();
  ctx.moveTo(0, plotBottom);
  ys.forEach((y, i) => ctx.lineTo((i / n) * w, Y(y)));
  ctx.lineTo(w, plotBottom);
  ctx.closePath();
  ctx.fillStyle = '#8d97a3';
  ctx.fill();

  if (p > 0) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w * p, h);
    ctx.clip();
    ctx.clearRect(0, 0, w, h);
    ctx.globalAlpha = 0.28;
    for (let i = 0; i < n; i++) if (!onClimb(i)) fillSlice(i);
    ctx.globalAlpha = 0.95;
    for (let i = 0; i < n; i++) if (onClimb(i)) fillSlice(i);
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  ridge();
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 1.5 * dpr;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();
  if (p > 0) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w * p, h);
    ctx.clip();
    ctx.lineWidth = 1.6 * dpr;
    ctx.strokeStyle = '#ff7f2a';
    for (const c of highlights) {
      const chartIndex = (s: number) => ((mirrored ? end - s : s - start) / len) * n;
      const i0 = Math.max(0, Math.floor(Math.min(chartIndex(c.start), chartIndex(c.end))));
      const i1 = Math.min(n, Math.ceil(Math.max(chartIndex(c.start), chartIndex(c.end))));
      if (i1 <= i0) continue;
      ctx.beginPath();
      for (let i = i0; i <= i1; i++) {
        const x = (i / n) * w;
        if (i === i0) ctx.moveTo(x, Y(ys[i]));
        else ctx.lineTo(x, Y(ys[i]));
      }
      ctx.stroke();
    }
    ctx.restore();
  }
  if (p > 0.008 && p < 0.992) {
    const i = p * n;
    const i0 = Math.min(n - 1, Math.floor(i));
    const t = i - i0;
    const yEdge = ys[i0] + (ys[i0 + 1] - ys[i0]) * t;
    ctx.strokeStyle = '#ff7f2a';
    ctx.lineWidth = 2 * dpr;
    ctx.beginPath();
    ctx.moveTo(w * p, Y(yEdge));
    ctx.lineTo(w * p, plotBottom);
    ctx.stroke();
  }
}

/**
 * Same vertical exaggeration on every free-ride card.
 * A metre of climbing takes the same share of the chart on a short wall as on an alpine loop,
 * so a 50 m berg stays a small tooth and a 2000 m mountain fills the card.
 */
export const FREE_RIDE_RISE = 0.034;

export function freeRideProfileSpan(length: number, range: number): number {
  return Math.max(length * FREE_RIDE_RISE, range * 1.08);
}

/**
 * Stretches to mark as the climb on a route card.
 * Forwards, those are the named climbs. Backwards, a named climb is a descent,
 * so the mark follows the uphill you actually ride.
 */
export function climbHighlightSpans(route: Route, reverse: boolean): { start: number; end: number }[] {
  if (!reverse) return route.climbs.map((c) => ({ start: c.start, end: c.end }));
  const step = 80;
  const spans: { start: number; end: number }[] = [];
  let from: number | null = null;
  let to = 0;
  let gain = 0;
  let length = 0;
  let dip = 0;
  const commit = () => {
    if (from === null) return;
    const start = Math.min(from, to);
    const end = Math.max(from, to);
    if (gain >= 40 && length >= 250 && gain / length >= 0.03 && end - start < route.length * 0.85) {
      spans.push({ start, end });
    }
    from = null;
    gain = 0;
    length = 0;
    dip = 0;
  };
  // Left to right on the reversed profile: from the end of the lap back to the start.
  let s = route.length;
  while (s > 1) {
    const d = Math.min(step, s);
    const s2 = s - d;
    const dy = route.elevationAt(s2) - route.elevationAt(s);
    if (dy > d * 0.02) {
      if (from === null) from = s;
      to = s2;
      gain += dy;
      length += d;
      dip = 0;
    } else if (from !== null) {
      dip += d;
      if (dip > 200) commit();
    }
    s = s2;
  }
  commit();
  return spans;
}

/** Side profile for a route card: grade colours, with the climb traced on top. Reverse mirrors the lap. */
export function drawRouteCard(canvas: HTMLCanvasElement, route: Route, reverse = false): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(10, Math.round(canvas.clientWidth * dpr));
  const h = Math.max(10, Math.round(canvas.clientHeight * dpr));
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const n = 220;
  const along = (i: number) => (reverse ? route.length * (1 - i / n) : (route.length * i) / n);
  const ys: number[] = [];
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i <= n; i++) {
    const y = route.elevationAt(along(i));
    ys.push(y);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const range = Math.max(1, maxY - minY);
  const span = freeRideProfileSpan(route.length, range);
  const base = minY - span * 0.04;
  const bar = 3 * dpr;
  const plotH = h - bar - 4 * dpr;
  const Y = (y: number) => h - bar - 2 * dpr - ((y - base) / span) * plotH;
  const spans = climbHighlightSpans(route, reverse);
  const onClimb = (i: number) => {
    const s = along(i);
    return spans.some((c) => s >= c.start && s <= c.end);
  };
  const fillSlice = (i: number) => {
    const g = (ys[i + 1] - ys[i]) / (route.length / n);
    ctx.fillStyle = gradeColor(g);
    ctx.beginPath();
    ctx.moveTo((i / n) * w, h - bar);
    ctx.lineTo((i / n) * w, Y(ys[i]));
    ctx.lineTo(((i + 1) / n) * w, Y(ys[i + 1]));
    ctx.lineTo(((i + 1) / n) * w, h - bar);
    ctx.closePath();
    ctx.fill();
  };
  ctx.clearRect(0, 0, w, h);
  ctx.globalAlpha = 0.28;
  for (let i = 0; i < n; i++) if (!onClimb(i)) fillSlice(i);
  ctx.globalAlpha = 0.95;
  for (let i = 0; i < n; i++) if (onClimb(i)) fillSlice(i);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 1.1 * dpr;
  ctx.beginPath();
  ys.forEach((y, i) => {
    const x = (i / n) * w;
    if (i === 0) ctx.moveTo(x, Y(y));
    else ctx.lineTo(x, Y(y));
  });
  ctx.stroke();
  ctx.lineWidth = 1.6 * dpr;
  ctx.strokeStyle = '#ff7f2a';
  ctx.lineJoin = 'round';
  ctx.fillStyle = '#ff7f2a';
  for (const c of spans) {
    const chartIndex = (s: number) => (reverse ? 1 - s / route.length : s / route.length) * n;
    const i0 = Math.max(0, Math.floor(Math.min(chartIndex(c.start), chartIndex(c.end))));
    const i1 = Math.min(n, Math.ceil(Math.max(chartIndex(c.start), chartIndex(c.end))));
    ctx.beginPath();
    for (let i = i0; i <= i1; i++) {
      const x = (i / n) * w;
      if (i === i0) ctx.moveTo(x, Y(ys[i]));
      else ctx.lineTo(x, Y(ys[i]));
    }
    ctx.stroke();
    const x0 = (i0 / n) * w;
    const x1 = (i1 / n) * w;
    ctx.fillRect(x0, h - bar, Math.max(2 * dpr, x1 - x0), bar);
  }
}

/**
 * Side profile of one climb, or of a career stage.
 * With no rise and no scale, the climb is scaled to itself so the shape stays readable.
 * A rise, in metres of chart per metre of road, is the shared career scale:
 * every stage uses the same exaggeration, and a short stage is not stretched up to the height of a long one.
 * A scale shares one length and one elevation gain across a list of climbs,
 * so a short climb stays narrow and a small one stays low.
 */
export interface ClimbChartScale {
  maxLength: number;
  maxGain: number;
}

export interface StagePrimeMark {
  /** Fraction along the stage, from 0 at the start to 1 at the finish. */
  at: number;
  kind: 'sprint' | 'kom' | 'finish';
  name?: string;
  points?: number[];
}

export interface StagePrimeHit {
  x: number;
  y: number;
  reach: number;
  name: string;
  points: number[];
}

const primeHits = new WeakMap<HTMLCanvasElement, StagePrimeHit[]>();

/** The sprint, mountain, or finish mark under a point on the stage profile, in CSS pixels. */
export function primeUnder(canvas: HTMLCanvasElement, x: number, y: number): StagePrimeHit | null {
  const hits = primeHits.get(canvas) ?? [];
  let best: StagePrimeHit | null = null;
  let bestDist = Infinity;
  for (const hit of hits) {
    if (x < hit.x - 12 || x > hit.x + hit.reach || y < hit.y - 22 || y > hit.y + 8) continue;
    const dist = Math.abs(x - hit.x);
    if (dist < bestDist) {
      best = hit;
      bestDist = dist;
    }
  }
  return best;
}

function drawFinishFlag(ctx: CanvasRenderingContext2D, x: number, py: number, dpr: number): void {
  const top = py - 18 * dpr;
  ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.lineWidth = 1.4 * dpr;
  ctx.beginPath();
  ctx.moveTo(x, py - 2 * dpr);
  ctx.lineTo(x, top);
  ctx.stroke();
  const fw = 14 * dpr;
  const fh = 10 * dpr;
  const cw = fw / 2;
  const ch = fh / 2;
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 2; col++) {
      ctx.fillStyle = (row + col) % 2 === 0 ? '#f4f4f4' : '#1c1208';
      ctx.fillRect(x + col * cw, top + row * ch, cw + 0.6, ch + 0.6);
    }
  }
  ctx.strokeRect(x, top, fw, fh);
}

export function drawClimbCard(
  canvas: HTMLCanvasElement,
  route: Route,
  start: number,
  end: number,
  minRange = 12,
  rise = 0,
  marks: StagePrimeMark[] = [],
  scale?: ClimbChartScale,
  backward = false,
): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(10, Math.round(canvas.clientWidth * dpr));
  const h = Math.max(10, Math.round(canvas.clientHeight * dpr));
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const n = 160;
  const len = Math.max(1, Math.abs(end - start));
  const ys: number[] = [];
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i <= n; i++) {
    const travelled = (len * i) / n;
    const y = route.elevationAt(backward ? Math.max(start, end) - travelled : start + travelled);
    ys.push(y);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const climbed = Math.max(0, maxY - minY);
  const chartScale = scale && scale.maxLength > 0 && scale.maxGain > 0 ? scale : undefined;
  const range = rise > 0 ? Math.max(1, climbed) : Math.max(minRange, climbed);
  const pad = range * 0.1;
  // A power scale keeps a short climb readable beside a long one. Longer stays wider, and more elevation stays taller.
  const gain = Math.max(1, climbed);
  const heightShare = chartScale ? Math.pow(Math.min(1, gain / chartScale.maxGain), 0.62) : 1;
  const lengthShare = chartScale ? Math.pow(Math.min(1, len / chartScale.maxLength), 0.62) : 1;
  const span = chartScale ? gain / (heightShare * 0.86) : rise > 0 ? freeRideProfileSpan(len, range) : range + pad * 2;
  const base = chartScale ? minY : rise > 0 ? minY - span * 0.04 : minY - pad;
  const top = (marks.length ? 20 : 4) * dpr;
  const inset = 4 * dpr;
  const plotH = h - top - inset;
  const Y = (y: number) => h - inset - ((y - base) / span) * plotH;
  const plotW = chartScale ? Math.min(w, Math.max(6 * dpr, lengthShare * w)) : w;
  const floor = chartScale ? h - inset : h;
  const xAt = (i: number) => (i / n) * plotW;
  ctx.clearRect(0, 0, w, h);
  if (chartScale) {
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = dpr;
    ctx.beginPath();
    ctx.moveTo(0, floor);
    ctx.lineTo(w, floor);
    ctx.stroke();
  }
  for (let i = 0; i < n; i++) {
    const g = (ys[i + 1] - ys[i]) / (len / n);
    ctx.fillStyle = gradeColor(g);
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.moveTo(xAt(i), floor);
    ctx.lineTo(xAt(i), Y(ys[i]));
    ctx.lineTo(xAt(i + 1), Y(ys[i + 1]));
    ctx.lineTo(xAt(i + 1), floor);
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.strokeStyle = '#ff7f2a';
  ctx.lineWidth = 1.6 * dpr;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ys.forEach((y, i) => {
    const x = xAt(i);
    if (i === 0) ctx.moveTo(x, Y(y));
    else ctx.lineTo(x, Y(y));
  });
  ctx.stroke();
  let lastLabel = -999;
  const hits: StagePrimeHit[] = [];
  const finishX = w - 16 * dpr;
  const ordered = [...marks].sort((a, b) => a.at - b.at);
  for (const mark of ordered) {
    const finish = mark.kind === 'finish';
    const at = finish ? 1 : Math.min(0.99, Math.max(0.01, mark.at));
    const pos = Math.min(n, at * n);
    const i0 = Math.min(n - 1, Math.floor(pos));
    const mix = pos - i0;
    const y = ys[i0] + ((ys[i0 + 1] ?? ys[i0]) - ys[i0]) * mix;
    const x = finish ? finishX : at * plotW;
    const py = Y(y);
    const sprint = mark.kind === 'sprint';
    ctx.fillStyle = finish ? '#f4f4f4' : sprint ? '#3ddc84' : '#e23b2f';
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.lineWidth = 1.4 * dpr;
    ctx.beginPath();
    ctx.arc(x, py, 4 * dpr, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // A summit award sits on the finish. Keep its letter just left of the flag.
    const labelX = !finish && x > finishX - 18 * dpr ? finishX - 18 * dpr : x;
    const crowded = !finish && labelX - lastLabel < 16 * dpr;
    if (!crowded && !finish) {
      lastLabel = labelX;
      ctx.font = `800 ${13 * dpr}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.lineWidth = 3 * dpr;
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      const label = sprint ? 'S' : 'M';
      const ly = Math.max(14 * dpr, py - 6 * dpr);
      ctx.strokeText(label, labelX, ly);
      ctx.fillStyle = sprint ? '#3ddc84' : '#ff8a7a';
      ctx.fillText(label, labelX, ly);
    }
    if (finish) drawFinishFlag(ctx, x, py, dpr);
    if (mark.name && mark.points?.length) {
      const iconX = finish || crowded ? x : labelX;
      hits.push({ x: iconX / dpr, y: py / dpr, reach: finish ? 18 : 12, name: mark.name, points: mark.points });
    }
  }
  primeHits.set(canvas, hits);
}

export interface ChartMarker {
  s: number;
  color: string;
  size: number;
  label?: string;
}

/**
 * CSS size of an element, kept up to date by a ResizeObserver. Reading clientWidth
 * right after the HUD writes its numbers forces a layout; this does not.
 */
export class CssSize {
  private w = 0;
  private h = 0;
  private observed = false;

  constructor(private el: HTMLElement) {
    if (typeof ResizeObserver === 'undefined') return;
    new ResizeObserver((entries) => {
      const box = entries[entries.length - 1].contentRect;
      this.w = box.width;
      this.h = box.height;
      this.observed = true;
    }).observe(el);
  }

  get width(): number {
    return this.observed ? this.w : this.el.clientWidth;
  }

  get height(): number {
    return this.observed ? this.h : this.el.clientHeight;
  }
}

/** Elevation profile coloured by gradient, with rider markers. */
export class ProfileChart {
  private ctx: CanvasRenderingContext2D;
  private cache: HTMLCanvasElement | null = null;
  private cacheKey = '';
  /** Height range of the cached drawing, padded. */
  private minY = 0;
  private maxY = 1;
  private size: CssSize;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.size = new CssSize(canvas);
  }

  draw(route: Route, s0: number, s1: number, markers: ChartMarker[], options: { wrap?: boolean; reverse?: boolean } = {}): void {
    const c = this.canvas;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(10, Math.round(this.size.width * dpr));
    const h = Math.max(10, Math.round(this.size.height * dpr));
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
      this.cacheKey = '';
    }
    const reverse = options.reverse === true;
    const key = `${route.def.id}:${s0.toFixed(0)}:${s1.toFixed(0)}:${w}x${h}:${reverse ? 1 : 0}`;
    const n = 300;
    const span = s1 - s0;
    const X = (s: number) => ((s - s0) / (s1 - s0)) * w;
    const Y = (y: number) => h - ((y - this.minY) / (this.maxY - this.minY)) * h;

    // Perf: the 301 height samples are only needed to redraw the cached profile, so they are taken on a
    // cache miss only. Markers use the height range of the cached drawing, so they sit on its line.
    if (key !== this.cacheKey || !this.cache) {
      let minY = Infinity;
      let maxY = -Infinity;
      const at = (i: number) => (reverse ? s1 - (span * i) / n : s0 + (span * i) / n);
      const ys: number[] = [];
      for (let i = 0; i <= n; i++) {
        const y = route.elevationAt(at(i));
        ys.push(y);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
      const pad = Math.max(20, (maxY - minY) * 0.12);
      this.minY = minY - pad;
      this.maxY = maxY + pad * 0.6;
      const off = document.createElement('canvas');
      off.width = w;
      off.height = h;
      const o = off.getContext('2d')!;
      for (let i = 0; i < n; i++) {
        const sa = at(i);
        const sb = at(i + 1);
        const g = (ys[i + 1] - ys[i]) / Math.max(1e-3, Math.abs(sb - sa));
        o.fillStyle = gradeColor(g);
        o.globalAlpha = 0.85;
        const x0 = (i / n) * w;
        const x1 = ((i + 1) / n) * w;
        o.beginPath();
        o.moveTo(x0, h);
        o.lineTo(x0, Y(ys[i]));
        o.lineTo(x1, Y(ys[i + 1]));
        o.lineTo(x1, h);
        o.closePath();
        o.fill();
      }
      o.globalAlpha = 1;
      o.strokeStyle = 'rgba(255,255,255,0.9)';
      o.lineWidth = 1.5 * dpr;
      o.beginPath();
      ys.forEach((y, i) => {
        const x = (i / n) * w;
        if (i === 0) o.moveTo(x, Y(y));
        else o.lineTo(x, Y(y));
      });
      o.stroke();
      this.cache = off;
      this.cacheKey = key;
    }
    const ctx = this.ctx;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(this.cache, 0, 0);
    for (const m of markers) {
      let s = m.s;
      if (options.wrap) s = s0 + (((s - s0) % span) + span) % span;
      if (s < Math.min(s0, s1) || s > Math.max(s0, s1)) continue;
      const plotted = reverse ? s0 + s1 - s : s;
      const x = X(plotted);
      const y = Y(route.elevationAt(s));
      ctx.fillStyle = m.color;
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = dpr;
      ctx.beginPath();
      ctx.arc(x, y, m.size * dpr, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      if (m.label) {
        ctx.fillStyle = m.color;
        ctx.font = `${11 * dpr}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(m.label, x, Math.max(12 * dpr, y - 8 * dpr));
      }
    }
  }
}
