import type { CurvePoint, DayLoad } from './metrics';
import { CURVE_SECONDS, durationLabel } from './metrics';

const GRID = 'rgba(255,255,255,0.1)';
const ORANGE = '#ff7f2a';
const BLUE = '#8ec8ff';

export function axisMax(value: number): number {
  if (!(value > 0)) return 1;
  const exp = Math.floor(Math.log10(value));
  const base = 10 ** exp;
  const scaled = value / base;
  const nice = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
  return nice * base;
}















function tipAttr(value: string): string {
  return esc(value).replace(/\n/g, '&#10;');
}



function axisText(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const abs = Math.abs(value);
  if (abs >= 100) return Math.round(value).toLocaleString('en-GB');
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}



function n(value: number): string {
  return value.toFixed(1);
}

function esc(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char);
}

// ---------- Responsive plots
// The plot itself stretches to its box; axis labels are HTML, so they stay readable on a phone.

const VB_W = 1000;
const VB_H = 100;

interface Tick {
  /** 0..1 from the left (x) or from the bottom (y). */
  at: number;
  label: string;
}

interface PlotOptions {
  aria: string;
  body: string;
  yTicks: Tick[];
  xTicks: Tick[];
  /** Extra HTML laid over the plot (dots, labels). */
  overlay?: string;
  /** Labels on the right-hand axis, if any. */
  rightTicks?: Tick[];
  size?: 'tall' | 'short';
}

function plot(options: PlotOptions): string {
  const grid = options.yTicks
    .map((tick) => `<line x1="0" x2="${VB_W}" y1="${n(VB_H - tick.at * VB_H)}" y2="${n(VB_H - tick.at * VB_H)}" stroke="${GRID}" vector-effect="non-scaling-stroke" />`)
    .join('');
  const y = options.yTicks.map((tick) => `<span style="top:${pct(1 - tick.at)}">${esc(tick.label)}</span>`).join('');
  const right = options.rightTicks?.length
    ? `<div class="plot-y right" aria-hidden="true">${options.rightTicks.map((tick) => `<span style="top:${pct(1 - tick.at)}">${esc(tick.label)}</span>`).join('')}</div>`
    : '';
  const x = options.xTicks
    .map((tick, i, all) => {
      const edge = i === 0 && tick.at < 0.08 ? ' first' : i === all.length - 1 && tick.at > 0.92 ? ' last' : '';
      return `<span class="${edge.trim()}" style="left:${pct(tick.at)}">${esc(tick.label)}</span>`;
    })
    .join('');
  return `<figure class="plot ${options.size ?? 'tall'}${right ? ' has-right' : ''}" role="img" aria-label="${esc(options.aria)}">
    <div class="plot-y" aria-hidden="true">${y}</div>
    <div class="plot-box"><svg viewBox="0 0 ${VB_W} ${VB_H}" preserveAspectRatio="none" focusable="false">${grid}${options.body}</svg>${options.overlay ?? ''}</div>
    ${right}
    <div class="plot-x" aria-hidden="true">${x}</div>
  </figure>`;
}

function hitColumn(x0: number, x1: number, tip: string): string {
  const cx = (x0 + x1) / 2;
  return `<g class="chart-slot"><rect x="${n(x0)}" y="0" width="${n(Math.max(0.5, x1 - x0))}" height="${VB_H}" fill="transparent" data-x="${n(cx)}" data-tip="${tipAttr(tip)}" /><line class="chart-guide" x1="${n(cx)}" x2="${n(cx)}" y1="0" y2="${VB_H}" vector-effect="non-scaling-stroke" /></g>`;
}

function polyline(points: { x: number; y: number }[], color: string, width = 2.5, dash = ''): string {
  if (points.length < 2) return '';
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${n(p.x)},${n(p.y)}`).join(' ');
  return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" ${dash ? `stroke-dasharray="${dash}"` : ''} stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" pointer-events="none" />`;
}

/** Round steps (1, 2, 2.5, 5 × 10ⁿ) and a top just above the data. */
function niceTicks(max: number, count = 4): { top: number; ticks: number[] } {
  const raw = Math.max(max, 1e-6) / count;
  const exp = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * exp).find((value) => value >= raw) ?? 10 * exp;
  const steps = Math.max(1, Math.ceil((max * 1.02) / step));
  return { top: steps * step, ticks: Array.from({ length: steps + 1 }, (_, i) => i * step) };
}

function dateTicks(dates: Date[], count: number): Tick[] {
  if (dates.length < 2) return dates.length ? [{ at: 0.5, label: shortDate(dates[0]) }] : [];
  const out: Tick[] = [];
  const step = (dates.length - 1) / Math.max(1, count - 1);
  for (let i = 0; i < count; i++) {
    const index = Math.round(i * step);
    out.push({ at: index / (dates.length - 1), label: shortDate(dates[index]) });
  }
  return out;
}

function shortDate(date: Date): string {
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** Fitness and fatigue as lines over the daily load. */
export function loadChart(days: DayLoad[]): string {
  if (!days.some((day) => day.tss > 0 || day.fitness > 0.5)) return emptyPlot('No training load in this range yet.');
  const max = Math.max(...days.map((day) => Math.max(day.fitness, day.fatigue, day.tss)), 10);
  const { top, ticks } = niceTicks(max);
  const xOf = (i: number) => (days.length === 1 ? VB_W / 2 : (i / (days.length - 1)) * VB_W);
  const yOf = (value: number) => VB_H - (Math.max(0, value) / top) * VB_H;
  const slot = VB_W / days.length;
  const bars = days
    .map((day, i) => {
      if (!(day.tss > 0)) return '';
      const w = Math.max(1.5, slot * 0.6);
      const y = yOf(day.tss);
      return `<rect x="${n(xOf(i) - w / 2)}" y="${n(y)}" width="${n(w)}" height="${n(VB_H - y)}" fill="rgba(255,255,255,0.16)" pointer-events="none" />`;
    })
    .join('');
  const fitness = polyline(days.map((day, i) => ({ x: xOf(i), y: yOf(day.fitness) })), ORANGE, 3);
  const fatigue = polyline(days.map((day, i) => ({ x: xOf(i), y: yOf(day.fatigue) })), BLUE, 1.75);
  const hits = days
    .map((day, i) =>
      hitColumn(
        xOf(i) - slot / 2,
        xOf(i) + slot / 2,
        `${day.date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}\nFitness ${Math.round(day.fitness)}\nFatigue ${Math.round(day.fatigue)}\nForm ${signed(day.form)}\nLoad that day ${Math.round(day.tss)}`,
      ),
    )
    .join('');
  return plot({
    aria: `Fitness and fatigue. Fitness is ${Math.round(days[days.length - 1].fitness)} today, fatigue ${Math.round(days[days.length - 1].fatigue)}.`,
    body: `${bars}${fatigue}${fitness}${hits}`,
    yTicks: ticks.map((tick) => ({ at: tick / top, label: axisText(tick) })),
    xTicks: dateTicks(days.map((day) => day.date), 5),
  });
}

/** Form as bars around zero, coloured by its band. */
export function formChart(days: DayLoad[]): string {
  if (!days.length) return '';
  const extent = Math.max(30, ...days.map((day) => Math.abs(day.form)));
  const top = Math.ceil(extent / 10) * 10;
  const yOf = (value: number) => VB_H / 2 - (value / top) * (VB_H / 2);
  const slot = VB_W / days.length;
  const bars = days
    .map((day, i) => {
      const y0 = yOf(0);
      const y1 = yOf(day.form);
      const color = day.form > 25 ? '#8ec8ff' : day.form > 5 ? '#3cba78' : day.form >= -10 ? 'rgba(255,255,255,0.4)' : day.form >= -30 ? '#ff7f2a' : '#e23b3b';
      return `<rect x="${n(i * slot + slot * 0.15)}" y="${n(Math.min(y0, y1))}" width="${n(Math.max(0.8, slot * 0.7))}" height="${n(Math.max(0.4, Math.abs(y1 - y0)))}" fill="${color}" pointer-events="none" />`;
    })
    .join('');
  const zero = `<line x1="0" x2="${VB_W}" y1="${VB_H / 2}" y2="${VB_H / 2}" stroke="rgba(255,255,255,0.5)" vector-effect="non-scaling-stroke" />`;
  const hits = days
    .map((day, i) => hitColumn(i * slot, (i + 1) * slot, `${day.date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}\nForm ${signed(day.form)}`))
    .join('');
  return plot({
    aria: `Form. Today ${signed(days[days.length - 1].form)}.`,
    body: `${bars}${zero}${hits}`,
    yTicks: [
      { at: 1, label: `+${top}` },
      { at: 0.5, label: '0' },
      { at: 0, label: `−${top}` },
    ],
    xTicks: dateTicks(days.map((day) => day.date), 5),
    size: 'short',
  });
}

export interface BarPoint {
  label: string;
  value: number;
  title: string;
  /** Shown above the bar. */
  text?: string;
}

/** Column chart drawn in HTML, so bars, values and labels stay sharp at any width. */
export function columnChart(points: BarPoint[], aria: string, empty: string, format: (value: number) => string): string {
  if (!points.some((point) => point.value > 0)) return emptyPlot(empty);
  const { top, ticks } = niceTicks(Math.max(...points.map((point) => point.value)), 3);
  const every = points.length > 16 ? Math.ceil(points.length / 8) : points.length > 8 ? 2 : 1;
  const cols = points
    .map((point, i) => {
      const h = Math.max(point.value > 0 ? 1.5 : 0, (point.value / top) * 100);
      const label = (points.length - 1 - i) % every === 0 ? esc(point.label) : '';
      const latest = i === points.length - 1 ? ' latest' : '';
      return `<div class="col${latest}" data-tip="${tipAttr(point.title)}"><div class="col-track"><div class="col-bar" style="height:${h.toFixed(1)}%">${point.text && points.length <= 14 ? `<em>${esc(point.text)}</em>` : ''}</div></div><span>${label}</span></div>`;
    })
    .join('');
  const y = ticks.map((tick) => `<span style="top:${pct(1 - tick / top)}">${esc(format(tick))}</span>`).join('');
  const grid = ticks.map((tick) => `<i style="top:${pct(1 - tick / top)}"></i>`).join('');
  return `<figure class="cols" role="img" aria-label="${esc(aria)}"><div class="plot-y" aria-hidden="true">${y}</div><div class="cols-box"><div class="cols-grid" aria-hidden="true">${grid}</div><div class="cols-row">${cols}</div></div></figure>`;
}

/** Best power for each duration, on a log time axis, against the period before. */
export function curveChart(current: CurvePoint[], previous: CurvePoint[], weightKg: number): string {
  const values = [...current, ...previous].flatMap((point) => (point.watts == null ? [] : [point.watts]));
  if (!values.length) return emptyPlot('No power data in this range yet.');
  const { top, ticks } = niceTicks(Math.max(...values));
  const lo = Math.log(CURVE_SECONDS[0]);
  const hi = Math.log(CURVE_SECONDS[CURVE_SECONDS.length - 1]);
  const xOf = (sec: number) => ((Math.log(sec) - lo) / (hi - lo)) * VB_W;
  const yOf = (watts: number) => VB_H - (watts / top) * VB_H;
  const line = (points: CurvePoint[], color: string, width: number, dash = '') =>
    polyline(points.filter((point) => point.watts != null).map((point) => ({ x: xOf(point.sec), y: yOf(point.watts!) })), color, width, dash);
  const hits = CURVE_SECONDS.map((sec, i) => {
    const left = i === 0 ? 0 : (xOf(CURVE_SECONDS[i - 1]) + xOf(sec)) / 2;
    const right = i === CURVE_SECONDS.length - 1 ? VB_W : (xOf(sec) + xOf(CURVE_SECONDS[i + 1])) / 2;
    const now = current[i]?.watts;
    const before = previous[i]?.watts;
    const kg = weightKg > 0 ? weightKg : 0;
    const lines = [`Best ${durationLabel(sec)}`];
    lines.push(now == null ? 'This range: none' : `This range: ${Math.round(now)} W${kg ? ` · ${(now / kg).toFixed(2)} W/kg` : ''}`);
    if (previous.length) lines.push(before == null ? 'Before: none' : `Before: ${Math.round(before)} W`);
    return `<g class="chart-slot"><rect x="${n(left)}" y="0" width="${n(right - left)}" height="${VB_H}" fill="transparent" data-x="${n(xOf(sec))}" data-tip="${tipAttr(lines.join('\n'))}" /><line class="chart-guide" x1="${n(xOf(sec))}" x2="${n(xOf(sec))}" y1="0" y2="${VB_H}" vector-effect="non-scaling-stroke" /></g>`;
  }).join('');
  const marks = [1, 10, 60, 300, 1200, 3600];
  return plot({
    aria: 'Power curve. Best average power for each duration.',
    body: `${line(previous, 'rgba(255,255,255,0.45)', 1.75, '6 5')}${line(current, ORANGE, 3)}${hits}`,
    yTicks: ticks.map((tick) => ({ at: tick / top, label: axisText(tick) })),
    xTicks: marks.map((sec) => ({ at: xOf(sec) / VB_W, label: durationLabel(sec).replace(' ', '') })),
  });
}

export interface DotPoint {
  at: Date;
  value: number;
  title: string;
}

/** A dot per ride over time, with a fitted trend line. */
export function dotChart(points: DotPoint[], from: Date, to: Date, aria: string, empty: string, digits = 2): string {
  if (points.length < 2) return emptyPlot(empty);
  const values = points.map((point) => point.value);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pad = Math.max((hi - lo) * 0.2, hi * 0.04, 0.05);
  const min = Math.max(0, lo - pad);
  const max = hi + pad;
  const span = Math.max(1, to.getTime() - from.getTime());
  const xFrac = (date: Date) => Math.min(1, Math.max(0, (date.getTime() - from.getTime()) / span));
  const yFrac = (value: number) => (value - min) / (max - min);
  const dots = points
    .map((point) => `<i class="dot-mark" style="left:${pct(xFrac(point.at))};top:${pct(1 - yFrac(point.value))}" data-tip="${tipAttr(point.title)}"></i>`)
    .join('');
  // Least squares, for the trend.
  const xs = points.map((point) => xFrac(point.at));
  const meanX = xs.reduce((a, b) => a + b, 0) / xs.length;
  const meanY = values.reduce((a, b) => a + b, 0) / values.length;
  const sxx = xs.reduce((sum, x) => sum + (x - meanX) ** 2, 0);
  const slope = sxx > 0 ? xs.reduce((sum, x, i) => sum + (x - meanX) * (values[i] - meanY), 0) / sxx : 0;
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const trend = polyline(
    [
      { x: x0 * VB_W, y: VB_H - yFrac(meanY + slope * (x0 - meanX)) * VB_H },
      { x: x1 * VB_W, y: VB_H - yFrac(meanY + slope * (x1 - meanX)) * VB_H },
    ],
    'rgba(255,255,255,0.55)',
    1.5,
    '5 4',
  );
  const ticks = [0, 0.5, 1].map((at) => ({ at, label: (min + (max - min) * at).toFixed(digits) }));
  const dates: Date[] = [];
  for (let i = 0; i < 5; i++) dates.push(new Date(from.getTime() + (span * i) / 4));
  return plot({
    aria,
    body: trend,
    overlay: `<div class="dot-layer">${dots}</div>`,
    yTicks: ticks,
    xTicks: dates.map((date, i) => ({ at: i / 4, label: shortDate(date) })),
    size: 'short',
  });
}

function emptyPlot(label: string): string {
  return `<p class="plot-empty">${esc(label)}</p>`;
}

function signed(value: number): string {
  const rounded = Math.round(value);
  return rounded > 0 ? `+${rounded}` : rounded < 0 ? `−${Math.abs(rounded)}` : '0';
}

function pct(fraction: number): string {
  return `${(Math.min(1, Math.max(0, fraction)) * 100).toFixed(2)}%`;
}

/** Time (left axis) and power (right axis) for every attempt on a climb, oldest first. */
export function segmentChart(points: { at: Date; timeSec: number; power: number; title: string }[]): string {
  if (points.length < 2) return emptyPlot('One attempt so far.');
  const times = points.map((point) => point.timeSec / 60);
  const powers = points.map((point) => point.power);
  const domain = (values: number[]) => {
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    const pad = Math.max((hi - lo) * 0.15, hi * 0.02, 0.5);
    return { min: Math.max(0, lo - pad), max: hi + pad };
  };
  const t = domain(times);
  const w = domain(powers);
  const xOf = (i: number) => (i / (points.length - 1)) * VB_W;
  const yOf = (value: number, d: { min: number; max: number }) => VB_H - ((value - d.min) / (d.max - d.min)) * VB_H;
  const slot = VB_W / (points.length - 1);
  const hits = points.map((point, i) => hitColumn(xOf(i) - slot / 2, xOf(i) + slot / 2, point.title)).join('');
  const ticks = [0, 0.5, 1];
  const xIdx = points.length <= 5 ? points.map((_, i) => i) : [0, 1, 2, 3, 4].map((k) => Math.round((k / 4) * (points.length - 1)));
  return plot({
    aria: `Time and power across ${points.length} attempts.`,
    body: `${polyline(points.map((_, i) => ({ x: xOf(i), y: yOf(times[i], t) })), BLUE, 2.5)}${polyline(points.map((_, i) => ({ x: xOf(i), y: yOf(powers[i], w) })), ORANGE, 2.5)}${hits}`,
    yTicks: ticks.map((at) => ({ at, label: minutes(t.min + (t.max - t.min) * at) })),
    rightTicks: ticks.map((at) => ({ at, label: `${Math.round(w.min + (w.max - w.min) * at)}` })),
    xTicks: [...new Set(xIdx)].map((i) => ({ at: i / (points.length - 1), label: shortDate(points[i].at) })),
    size: 'short',
  });
}

function minutes(value: number): string {
  const total = Math.round(value * 60);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
