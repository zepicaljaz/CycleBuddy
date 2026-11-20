import type { Route } from '../routes/route';

/**
 * A stage profile drawn the way race roadbooks draw them: each kilometre filled
 * in the colour of its gradient, the categorised climbs marked at the top, the
 * sprints on the road, and the part of the stage you skip shaded out.
 */

/** The Alpine kilometre-marker convention, also used on most climb profiles. */
export function gradeColour(pct: number): string {
  if (pct < 0) return '#5e7486';
  if (pct < 3) return '#8fb86a';
  if (pct < 6) return '#e8c547';
  if (pct < 8) return '#ee8a2f';
  if (pct < 10) return '#d9452f';
  return '#7a1e22';
}

export const GRADE_LEGEND: { label: string; colour: string }[] = [
  { label: '<3%', colour: gradeColour(1) },
  { label: '3–6', colour: gradeColour(4) },
  { label: '6–8', colour: gradeColour(7) },
  { label: '8–10', colour: gradeColour(9) },
  { label: '10%+', colour: gradeColour(11) },
];

export interface RoadbookClimb {
  name: string;
  /** Summit distance along the route. */
  s: number;
  category?: string;
}

export interface RoadbookOptions {
  /** Stage start and finish, metres along the route. */
  from: number;
  to: number;
  /** Where your race starts. Everything before it is shaded. */
  raceStart?: number;
  climbs?: RoadbookClimb[];
  sprints?: { s: number; name: string }[];
  /** Kilometre bin for the colours. A long stage reads better with 2 km bins. */
  binM?: number;
  compact?: boolean;
}

function fontFamily(): string {
  return getComputedStyle(document.documentElement).getPropertyValue('--display').trim() || 'sans-serif';
}

export function drawRoadbook(canvas: HTMLCanvasElement, route: Route, opt: RoadbookOptions): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const cssW = Math.max(40, canvas.clientWidth);
  const cssH = Math.max(40, canvas.clientHeight);
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const display = fontFamily();
  const compact = opt.compact ?? cssH < 150;
  const padL = compact ? 4 : 44;
  const padR = compact ? 4 : 12;
  const padT = compact ? 22 : 34;
  const padB = compact ? 4 : 22;
  const plotW = cssW - padL - padR;
  const plotH = cssH - padT - padB;
  const span = Math.max(1, opt.to - opt.from);

  let minY = Infinity;
  let maxY = -Infinity;
  const N = Math.min(600, Math.max(80, Math.round(plotW)));
  const ys = new Float32Array(N + 1);
  for (let i = 0; i <= N; i++) {
    const y = route.elevationAt(opt.from + (span * i) / N);
    ys[i] = y;
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  // Leave room under the lowest point so a flat stage is not a line at the bottom.
  const floor = Math.max(0, minY - Math.max(60, (maxY - minY) * 0.12));
  const top = Math.max(maxY, floor + 300);
  const xOf = (s: number) => padL + ((s - opt.from) / span) * plotW;
  const yOf = (elev: number) => padT + plotH - ((elev - floor) / (top - floor)) * plotH;

  // Kilometre (or two) bins in the gradient colour.
  const bin = opt.binM ?? (span > 120_000 ? 2000 : span > 40_000 ? 1000 : span > 12_000 ? 500 : 250);
  for (let a = opt.from; a < opt.to; a += bin) {
    const b = Math.min(opt.to, a + bin);
    const pct = ((route.elevationAt(b) - route.elevationAt(a)) / Math.max(1, b - a)) * 100;
    ctx.fillStyle = gradeColour(pct);
    ctx.beginPath();
    const steps = Math.max(2, Math.ceil(((b - a) / span) * N));
    ctx.moveTo(xOf(a), yOf(floor));
    for (let k = 0; k <= steps; k++) {
      const s = a + ((b - a) * k) / steps;
      ctx.lineTo(xOf(s), yOf(route.elevationAt(s)));
    }
    ctx.lineTo(xOf(b), yOf(floor));
    ctx.closePath();
    ctx.fill();
  }

  // Outline on top.
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = compact ? 1.2 : 1.6;
  ctx.beginPath();
  for (let i = 0; i <= N; i++) {
    const x = padL + (i / N) * plotW;
    const y = yOf(ys[i]);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // The part of the stage you skip.
  if (opt.raceStart !== undefined && opt.raceStart > opt.from + 10) {
    const x = xOf(opt.raceStart);
    ctx.fillStyle = 'rgba(10,14,20,0.72)';
    ctx.fillRect(padL, padT - 6, x - padL, plotH + 6);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(x, padT - 10);
    ctx.lineTo(x, padT + plotH);
    ctx.stroke();
    ctx.setLineDash([]);
    if (!compact) {
      ctx.fillStyle = '#fff';
      ctx.font = `700 11px ${display}`;
      ctx.textAlign = x > cssW - 80 ? 'right' : 'left';
      ctx.fillText('YOUR START', x + (ctx.textAlign === 'right' ? -6 : 6), padT + plotH - 6);
    }
  }

  // Axis: elevation on the left, km along the bottom.
  if (!compact) {
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = `500 10px ${display}`;
    ctx.textAlign = 'right';
    const stepE = top - floor > 1500 ? 500 : top - floor > 600 ? 250 : 100;
    for (let e = Math.ceil(floor / stepE) * stepE; e <= top; e += stepE) {
      const y = yOf(e);
      ctx.fillText(`${e} m`, padL - 6, y + 3);
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(padL + plotW, y);
      ctx.stroke();
    }
    ctx.textAlign = 'center';
    const kmStep = span > 150_000 ? 25 : span > 60_000 ? 10 : span > 20_000 ? 5 : span > 8000 ? 2 : 1;
    for (let km = 0; km * 1000 <= span; km += kmStep) {
      const x = xOf(opt.from + km * 1000);
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fillText(`${km}`, x, cssH - 6);
    }
    ctx.textAlign = 'right';
    ctx.fillText('km', cssW - 2, cssH - 6);
  }

  // Sprints: a green S on the road.
  for (const sp of opt.sprints ?? []) {
    if (sp.s < opt.from || sp.s > opt.to) continue;
    const x = xOf(sp.s);
    const y = yOf(route.elevationAt(sp.s));
    ctx.fillStyle = '#27a35a';
    ctx.beginPath();
    ctx.arc(x, y - 9, compact ? 6 : 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = `800 ${compact ? 8 : 10}px ${display}`;
    ctx.textAlign = 'center';
    ctx.fillText('S', x, y - 9 + (compact ? 3 : 3.5));
  }

  // Categorised climbs: a small square badge at the summit, the name above it.
  const placed: number[] = [];
  for (const c of opt.climbs ?? []) {
    if (c.s < opt.from - 50 || c.s > opt.to + 50) continue;
    const x = xOf(Math.min(opt.to, c.s));
    const y = yOf(route.elevationAt(Math.min(opt.to, c.s)));
    const cat = c.category ?? '';
    const label = cat === 'HC' ? 'HC' : cat ? cat : '';
    const size = compact ? 14 : 18;
    if (label) {
      ctx.fillStyle = cat === 'HC' ? '#c8102e' : '#f3f5f7';
      ctx.fillRect(x - size / 2, y - size - 6, size, size);
      ctx.fillStyle = cat === 'HC' ? '#fff' : '#c8102e';
      ctx.font = `800 ${compact ? 8 : 10}px ${display}`;
      ctx.textAlign = 'center';
      ctx.fillText(label, x, y - 6 - size / 2 + 3.5);
    } else {
      // Uncategorised: a small summit tick instead of an empty badge.
      ctx.fillStyle = '#f3f5f7';
      ctx.beginPath();
      ctx.moveTo(x, y - 6);
      ctx.lineTo(x - 5, y - 14);
      ctx.lineTo(x + 5, y - 14);
      ctx.closePath();
      ctx.fill();
    }
    if (!compact && !placed.some((px) => Math.abs(px - x) < 90)) {
      ctx.fillStyle = '#fff';
      ctx.font = `700 11px ${display}`;
      ctx.textAlign = x < 70 ? 'left' : x > cssW - 70 ? 'right' : 'center';
      const nameY = Math.max(11, y - size - 12);
      ctx.fillText(c.name.replace(/\s*\(.*\)\s*/, '').toUpperCase(), x, nameY);
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.font = `500 10px ${display}`;
      ctx.fillText(`${Math.round(route.elevationAt(Math.min(opt.to, c.s)))} m`, x, nameY + 11 > y - size - 8 ? nameY - 12 : nameY + 11);
      placed.push(x);
    }
  }
}
