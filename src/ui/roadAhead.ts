import type { RideSession } from '../game/session';
import { formatDuration } from '../util/math';
import { gradeColour } from './roadbook';

/**
 * The panel riders look at most on a climb: the gradient under the wheels, big
 * enough to read from the saddle, the next kilometre coloured by steepness, how far
 * to the top, the power zone, and in a hill-climb race the pace against your best.
 * Lives beside the main HUD and writes only what changed.
 */

export interface PowerZone {
  id: number;
  name: string;
  colour: string;
}

/** Coggan zones by share of FTP, in the colours most training apps use. */
export function powerZone(watts: number, ftp: number): PowerZone {
  const r = ftp > 0 ? watts / ftp : 0;
  if (r < 0.56) return { id: 1, name: 'Recovery', colour: '#8a94a0' };
  if (r < 0.76) return { id: 2, name: 'Endurance', colour: '#3d8bfd' };
  if (r < 0.91) return { id: 3, name: 'Tempo', colour: '#3ccf6e' };
  if (r < 1.06) return { id: 4, name: 'Threshold', colour: '#f2c21b' };
  if (r < 1.21) return { id: 5, name: 'VO2 max', colour: '#ff8a2a' };
  return { id: 6, name: 'Anaerobic', colour: '#ff4a3d' };
}

/** What is left of the current climb from here: metres, and the average grade of it. */
export function climbLeft(session: RideSession): { metres: number; avg: number; name: string } | null {
  const p = session.player;
  const route = session.route;
  const race = session.config.mode === 'race' ? session.config.climb : undefined;
  const list = race ? [race] : route.climbs;
  const s = session.config.mode === 'race' ? p.s : route.wrap(p.s);
  for (const c of list) {
    if (s >= c.start - 1 && s < c.end) {
      const metres = c.end - s;
      const avg = (c.summitElevation - route.elevationAt(s)) / Math.max(1, metres);
      return { metres, avg, name: c.name };
    }
  }
  return null;
}

export class RoadAhead {
  private root: HTMLElement;
  private canvas: HTMLCanvasElement;
  private written = new Map<string, string>();
  private lastDraw = 0;
  private cssW = 0;
  private cssH = 0;
  /** Best time on this climb, set by the app when a hill-climb race starts. */
  best: number | null = null;

  constructor(host: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'road-ahead';
    this.root.innerHTML = `
      <div class="ra-grade"><b data-ra="grade">0.0</b><span>%</span></div>
      <canvas class="ra-next" aria-hidden="true"></canvas>
      <div class="ra-line" data-ra="left"></div>
      <div class="ra-line ra-zone"><i data-ra="zone-dot"></i><span data-ra="zone"></span></div>
      <div class="ra-line ra-pace" data-ra="pace"></div>`;
    host.appendChild(this.root);
    this.canvas = this.root.querySelector('canvas')!;
  }

  show(v: boolean): void {
    this.root.hidden = !v;
  }

  private set(key: string, value: string, attr: 'text' | 'bg' = 'text'): void {
    const k = `${key}:${attr}`;
    if (this.written.get(k) === value) return;
    this.written.set(k, value);
    const el = this.root.querySelector<HTMLElement>(`[data-ra="${key}"]`);
    if (!el) return;
    if (attr === 'text') el.textContent = value;
    else el.style.background = value;
  }

  update(session: RideSession, now: number): void {
    const grade = session.feltGrade(0) * 100;
    this.set('grade', `${grade < 0 ? '−' : ''}${Math.abs(grade).toFixed(1)}`);
    this.root.style.setProperty('--ra-colour', gradeColour(grade));

    const left = climbLeft(session);
    this.set('left', left ? `${(left.metres / 1000).toFixed(1)} km to the top · ${(left.avg * 100).toFixed(1)}% average` : '');

    const ftp = session.config.profile.ftp;
    const zone = powerZone(session.power3s, ftp);
    this.set('zone', `Z${zone.id} ${zone.name}`);
    this.set('zone-dot', zone.colour, 'bg');

    this.set('pace', this.paceLine(session));

    if (now - this.lastDraw > 500) {
      this.lastDraw = now;
      this.drawNext(session);
    }
  }

  private paceLine(session: RideSession): string {
    const c = session.config.climb;
    if (session.config.mode !== 'race' || !c || session.config.career || this.best == null) return '';
    const p = session.player;
    const frac = (p.s - c.start) / Math.max(1, c.length);
    if (frac < 0.08 || p.finishTime != null) return '';
    const projected = session.sim.time / frac;
    const delta = projected - this.best;
    const sign = delta < 0 ? '−' : '+';
    return `On pace for ${formatDuration(projected)} · ${sign}${formatDuration(Math.abs(delta))} on your best`;
  }

  /** The next kilometre, each 100 m filled in its gradient colour. */
  private drawNext(session: RideSession): void {
    const c = this.canvas;
    if (!this.cssW) {
      this.cssW = c.clientWidth || 220;
      this.cssH = c.clientHeight || 54;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      c.width = Math.round(this.cssW * dpr);
      c.height = Math.round(this.cssH * dpr);
      c.getContext('2d')?.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const route = session.route;
    const dir = session.player.direction < 0 && session.config.mode !== 'race' ? -1 : 1;
    const s0 = session.player.s;
    const span = 1000;
    const n = 40;
    let lo = Infinity;
    let hi = -Infinity;
    const ys: number[] = [];
    for (let i = 0; i <= n; i++) {
      const y = route.elevationAt(route.wrap(s0 + dir * (span * i) / n));
      ys.push(y);
      lo = Math.min(lo, y);
      hi = Math.max(hi, y);
    }
    const range = Math.max(30, hi - lo);
    const w = this.cssW;
    const h = this.cssH;
    const yOf = (e: number) => h - 4 - ((e - lo) / range) * (h - 10);
    ctx.clearRect(0, 0, w, h);
    const per = n / 10;
    for (let b = 0; b < 10; b++) {
      const a = b * per;
      const z = a + per;
      const pct = ((ys[z] - ys[a]) / (span / 10)) * 100;
      ctx.fillStyle = gradeColour(pct);
      ctx.beginPath();
      ctx.moveTo((a / n) * w, h);
      for (let i = a; i <= z; i++) ctx.lineTo((i / n) * w, yOf(ys[i]));
      ctx.lineTo((z / n) * w, h);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(3, yOf(ys[0]), 3, 0, Math.PI * 2);
    ctx.fill();
  }
}
