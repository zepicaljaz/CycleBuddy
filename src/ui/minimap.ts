import type { RideSession } from '../game/session';
import type { Route } from '../routes/route';
import { ROUTE_DS } from '../routes/route';
import { gradeColor } from './dom';
import { CssSize } from './profileChart';

/** World width of the nearby map along its shorter side, in metres. The scale never changes. */
const NEARBY_METRES = 480;
/**
 * The step between the nearby road and the whole loop.
 * Five times further out: the next few kilometres, still a fixed scale.
 */
const WIDE_METRES = NEARBY_METRES * 5;
const MAP_PAD = 10;

/**
 * How far from the rider a fixed-scale map looks, in metres. The old circle stopped
 * inside a wide map. This reaches the corner, so the road runs off every edge.
 */
export function nearbyReachMetres(width: number, height: number, metres = NEARBY_METRES): number {
  const short = Math.max(2, Math.min(width, height) - MAP_PAD * 2);
  const scale = short / metres;
  return Math.hypot(width / 2, height / 2) / scale;
}

/**
 * On an out-and-back road the climb and the descent share the asphalt.
 * 1 paints this sample on top. Section 2 is the top loop, the way down and the bottom loop.
 */
export function legPaintRank(section: number, onReturn: boolean, outAndBack: boolean): number {
  if (!outAndBack) return 0;
  return (section === 2) === onReturn ? 1 : 0;
}

export type MapMode = 'ahead' | 'wide' | 'loop';

/** Route samples between the ends of one drawn stretch on the nearby map. */
const AHEAD_STEP = 3;
/** Side of a grid cell for the nearby-map index, in metres. */
const CELL = 256;

/** The stretches of road starting in each 256 m cell. Built once per route. */
type RouteGrid = Map<number, number[]>;
const grids = new WeakMap<Route, RouteGrid>();

const cellKey = (cx: number, cz: number) => (cx + 32768) * 65536 + (cz + 32768);

function gridFor(route: Route): RouteGrid {
  let grid = grids.get(route);
  if (grid) return grid;
  grid = new Map();
  for (let i = 0; i < route.count; i += AHEAD_STEP) {
    const key = cellKey(Math.floor(route.x[i] / CELL), Math.floor(route.z[i] / CELL));
    let list = grid.get(key);
    if (!list) grid.set(key, (list = []));
    list.push(i);
  }
  grids.set(route, grid);
  return grid;
}

const MODE_ORDER: MapMode[] = ['ahead', 'wide', 'loop'];

const MODE_LABEL: Record<MapMode, string> = {
  ahead: 'Map: nearby road',
  wide: 'Map: wider road',
  loop: 'Map: full loop',
};

/** The ride map. A line only: the road nearby, a wider stretch of it, or the whole loop. */
export class Minimap {
  private ctx: CanvasRenderingContext2D;
  private mode: MapMode = 'ahead';
  private size: CssSize;
  /** The full-loop line and its climbs, drawn once per route, size and direction. */
  private loopCache: { key: string; canvas: HTMLCanvasElement; midX: number; midZ: number; scale: number } | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Minimap canvas has no 2D context');
    this.ctx = ctx;
    this.size = new CssSize(canvas);
  }

  current(): MapMode {
    return this.mode;
  }

  setMode(mode: MapMode): void {
    this.mode = mode;
  }

  /** Nearby road, then the wider road, then the whole loop. Returns the label to show. */
  toggle(): string {
    const at = MODE_ORDER.indexOf(this.mode);
    this.mode = MODE_ORDER[(at < 0 ? 0 : at + 1) % MODE_ORDER.length];
    return MODE_LABEL[this.mode];
  }

  draw(session: RideSession): void {
    const canvas = this.canvas;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = this.size.width;
    const h = this.size.height;
    if (w < 2 || h < 2) return;
    const bw = Math.round(w * dpr);
    const bh = Math.round(h * dpr);
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    if (this.mode === 'loop') this.drawLoop(session, w, h);
    else this.drawAhead(session, w, h, this.mode === 'wide' ? WIDE_METRES : NEARBY_METRES);
  }

  /**
   * Road around the rider, fixed to the world. It does not turn with the rider
   * and it does not zoom. Each stretch is coloured by its gradient.
   * `metres` is the world width along the shorter side.
   */
  private drawAhead(session: RideSession, w: number, h: number, metres: number): void {
    const ctx = this.ctx;
    const route = session.route;
    const origin = route.sample(session.player.s);
    const step = AHEAD_STEP * Math.max(1, Math.round(metres / NEARBY_METRES));
    const scale = (Math.min(w, h) - MAP_PAD * 2) / metres;
    const project = (x: number, z: number): [number, number] => [
      w / 2 + (x - origin.x) * scale,
      h / 2 + (z - origin.z) * scale,
    ];
    const reach = nearbyReachMetres(w, h, metres) + step * ROUTE_DS;
    const reach2 = reach * reach;
    const playerI = Math.min(route.count - 1, Math.max(0, Math.floor(route.wrap(session.player.s) / ROUTE_DS)));
    const outAndBack = !!route.def.track;
    const onReturn = outAndBack && route.section[playerI] === 2;
    const segs: { x0: number; y0: number; x1: number; y1: number; color: string; rank: number }[] = [];
    // Only the grid cells around the rider, not every sample of the route. A stretch
    // is filed under its first point, so look one stretch further than the reach.
    const grid = gridFor(route);
    const margin = reach + step * ROUTE_DS + 1;
    const cx0 = Math.floor((origin.x - margin) / CELL);
    const cx1 = Math.floor((origin.x + margin) / CELL);
    const cz0 = Math.floor((origin.z - margin) / CELL);
    const cz1 = Math.floor((origin.z + margin) / CELL);
    const near: number[] = [];
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cz = cz0; cz <= cz1; cz++) {
        const list = grid.get(cellKey(cx, cz));
        if (list) for (const i of list) near.push(i);
      }
    }
    for (const i of near) {
      if (i % step !== 0) continue;
      const j = (i + step) % route.count;
      const ax = route.x[i] - origin.x;
      const az = route.z[i] - origin.z;
      const bx = route.x[j] - origin.x;
      const bz = route.z[j] - origin.z;
      if (ax * ax + az * az > reach2 && bx * bx + bz * bz > reach2) continue;
      const [x0, y0] = project(route.x[i], route.z[i]);
      const [x1, y1] = project(route.x[j], route.z[j]);
      segs.push({
        x0,
        y0,
        x1,
        y1,
        color: gradeColor(route.grade[i] * session.player.direction),
        rank: legPaintRank(route.section[i], onReturn, outAndBack),
      });
    }
    segs.sort((a, b) => a.rank - b.rank);
    const wide = metres > NEARBY_METRES;
    ctx.lineWidth = wide ? 5 : 7;
    ctx.strokeStyle = 'rgba(0,0,0,0.78)';
    for (const s of segs) {
      ctx.beginPath();
      ctx.moveTo(s.x0, s.y0);
      ctx.lineTo(s.x1, s.y1);
      ctx.stroke();
    }
    ctx.lineWidth = wide ? 3 : 4;
    for (const s of segs) {
      ctx.beginPath();
      ctx.moveTo(s.x0, s.y0);
      ctx.lineTo(s.x1, s.y1);
      ctx.strokeStyle = s.color;
      ctx.stroke();
    }

    if (session.config.mode === 'race') {
      for (const rider of session.sim.racers) {
        if (rider.isPlayer || (session.config.career?.road.timeTrial && session.sim.time < rider.ttStart)) continue;
        const p = route.sample(rider.s);
        const [x, y] = project(p.x - p.tz * rider.lat, p.z + p.tx * rider.lat);
        if (x < -8 || y < -8 || x > w + 8 || y > h + 8) continue;
        this.dot(x, y, 2.2, rider.direction < 0 ? 'rgba(255,120,96,0.9)' : 'rgba(255,255,255,0.85)');
      }
    }

    const me = session.player;
    const [mx, my] = project(origin.x - origin.tz * me.lat, origin.z + origin.tx * me.lat);
    const nose = this.nose(route, session, project);
    this.playerDot(mx, my, nose, session.config.mode === 'race');
  }

  /** The whole loop, or just the stage when a career race is on a section of a longer road. */
  private drawLoop(session: RideSession, w: number, h: number): void {
    const route = session.route;
    const stage = session.config.career ? session.config.climb : null;
    const dpr = this.canvas.width / Math.max(1, w);
    const key = `${route.def.id}:${route.length}:${stage ? `${stage.start}-${stage.end}` : 'loop'}:${session.player.direction}:${this.canvas.width}x${this.canvas.height}`;
    if (this.loopCache?.key !== key) {
      const off = document.createElement('canvas');
      off.width = this.canvas.width;
      off.height = this.canvas.height;
      const octx = off.getContext('2d');
      if (!octx) return;
      octx.setTransform(dpr, 0, 0, dpr, 0, 0);
      octx.lineJoin = 'round';
      octx.lineCap = 'round';
      const fit = this.drawLoopLine(octx, session, w, h);
      this.loopCache = { key, canvas: off, ...fit };
    }
    const { midX, midZ, scale } = this.loopCache;
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.loopCache.canvas, 0, 0);
    ctx.restore();

    if (session.config.mode === 'race') {
      for (const rider of session.sim.racers) {
        if (rider.isPlayer || (session.config.career?.road.timeTrial && session.sim.time < rider.ttStart)) continue;
        const p = route.sample(rider.s, this.tmp);
        const x = w / 2 + (p.x - midX) * scale;
        const y = h / 2 + (p.z - midZ) * scale;
        this.dot(x, y, 1.8, 'rgba(255,255,255,0.8)');
      }
    }

    const me = route.sample(session.player.s, this.tmp);
    const mx = w / 2 + (me.x - midX) * scale;
    const my = h / 2 + (me.z - midZ) * scale;
    const nose = this.nose(route, session, (x, z) => [w / 2 + (x - midX) * scale, h / 2 + (z - midZ) * scale]);
    this.playerDot(mx, my, nose, session.config.mode === 'race');
  }

  private tmp = { x: 0, y: 0, z: 0, tx: 1, tz: 0, grade: 0 };

  /** The static part of the loop map: road line and climbs. Returns how it was fitted. */
  private drawLoopLine(ctx: CanvasRenderingContext2D, session: RideSession, w: number, h: number): { midX: number; midZ: number; scale: number } {
    const route = session.route;
    const stage = session.config.career ? session.config.climb : null;
    const i0 = stage ? Math.max(0, Math.floor(stage.start / ROUTE_DS)) : 0;
    const i1 = stage ? Math.min(route.count - 1, Math.ceil(stage.end / ROUTE_DS)) : route.count - 1;
    const step = 8;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = i0; i <= i1; i += step) {
      minX = Math.min(minX, route.x[i]);
      maxX = Math.max(maxX, route.x[i]);
      minZ = Math.min(minZ, route.z[i]);
      maxZ = Math.max(maxZ, route.z[i]);
    }
    const pad = 12;
    const scale = Math.min((w - pad * 2) / Math.max(maxX - minX, 1), (h - pad * 2) / Math.max(maxZ - minZ, 1));
    const midX = (minX + maxX) / 2;
    const midZ = (minZ + maxZ) / 2;
    const projectIndex = (i: number): [number, number] => [
      w / 2 + (route.x[i] - midX) * scale,
      h / 2 + (route.z[i] - midZ) * scale,
    ];

    ctx.beginPath();
    for (let i = i0; i <= i1; i += step) {
      const [x, y] = projectIndex(i);
      if (i === i0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    if (!stage) ctx.closePath();
    ctx.strokeStyle = 'rgba(0,0,0,0.72)';
    ctx.lineWidth = 4.5;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = 2;
    ctx.stroke();

    const dir = session.player.direction;
    ctx.beginPath();
    let drawing = false;
    for (let i = i0; i <= i1; i += step) {
      const on = dir < 0 ? route.grade[i] * dir > 0.02 : onClimb(route, i * ROUTE_DS);
      if (!on) {
        drawing = false;
        continue;
      }
      const [x, y] = projectIndex(i);
      if (!drawing) {
        ctx.moveTo(x, y);
        drawing = true;
      } else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = 'rgba(40, 24, 0, 0.75)';
    ctx.lineWidth = 6;
    ctx.stroke();
    ctx.strokeStyle = '#ff7f2a';
    ctx.lineWidth = 3.2;
    ctx.stroke();
    return { midX, midZ, scale };
  }

  private dot(x: number, y: number, r: number, fill: string): void {
    const ctx = this.ctx;
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  private playerDot(x: number, y: number, nose: [number, number] | null = null, gold = false): void {
    const ctx = this.ctx;
    let angle = -Math.PI / 2;
    if (nose) angle = Math.atan2(nose[1] - y, nose[0] - x);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.fillStyle = gold ? '#f0b429' : '#ffffff';
    ctx.strokeStyle = 'rgba(0,0,0,0.65)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(9, 0);
    ctx.lineTo(-7, 5.5);
    ctx.lineTo(-4, 0);
    ctx.lineTo(-7, -5.5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  /** A point just in front of the rider, in the direction the bike is facing. */
  private nose(route: Route, session: RideSession, project: (x: number, z: number) => [number, number]): [number, number] {
    const me = route.sample(session.player.s);
    const angle = session.sim.facingAngle();
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const tx = me.tx * c - me.tz * s;
    const tz = me.tx * s + me.tz * c;
    return project(me.x + tx * 24, me.z + tz * 24);
  }
}

function onClimb(route: Route, s: number): boolean {
  for (const c of route.climbs) if (s >= c.start && s <= c.end) return true;
  return false;
}
