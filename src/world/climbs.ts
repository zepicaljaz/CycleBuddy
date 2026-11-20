import * as THREE from 'three';
import type { Climb, Route } from '../routes/route';
import { ROUTE_DS } from '../routes/route';
import { mulberry32 } from '../util/math';
import { keepShared } from './materials';
import { ROAD_HALF_WIDTH, type TerrainField } from './terrainField';

/**
 * Furniture a rider recognises on a real col, all from one shared atlas:
 * - French kilometre bornes every km on climbs of 3 km or more. The cap is coloured
 *   by the next kilometre's average grade (green < 4 %, blue 4-6, red 6-8, black > 8).
 * - Numbered hairpin signs, counting down to 1 at the last bend (Alpe d'Huez style),
 *   or up from the foot where the real road does (Vršič).
 * - A brown summit sign with the name and altitude.
 * - Painted names and cheers on the tarmac. Rare at the foot, more often through
 *   the middle, and about every 10 m in the top fifth of a race. Some names cross
 *   the road, some do not.
 * - Stone parapets on the outside of hairpins and above steep drops.
 *
 * Everything is instanced or merged route-wide: seven draw calls in total, whatever
 * the number of climbs. The sign faces are one mesh with one texture.
 */

const H = ROAD_HALF_WIDTH;

/** Real Alpine convention for the colour of a kilometre borne. */
export function gradeBand(grade: number): string {
  if (grade < 0.04) return '#2f9a46';
  if (grade < 0.06) return '#1f63c6';
  if (grade < 0.08) return '#d22a2a';
  return '#18191b';
}

/** Climbs long enough for kilometre bornes. */
export const BORNE_MIN_LENGTH = 3000;

/** Big climbs get painted names along the whole climb. */
export function isBigClimb(c: Climb): boolean {
  return c.length >= 4000 && (c.gain >= 300 || c.avgGrade >= 0.05);
}

export interface Hairpin {
  /** Sample index of the apex. */
  idx: number;
  /** -1: the outside of the bend is on the left of the rider, +1 on the right. */
  outside: -1 | 1;
  /** First and last sample of the bend. */
  from: number;
  to: number;
  /** Number on the sign. The last bend before the summit is 1. */
  number: number;
}

/**
 * Bends that turn more than ~120° within ~100 m, found from the road itself. Numbered
 * down toward the summit: the first one a rider meets carries the highest number.
 */
export function findHairpins(route: Route, climb: Climb): Hairpin[] {
  const i0 = Math.max(2, Math.floor(climb.start / ROUTE_DS));
  const i1 = Math.min(route.count - 3, Math.floor(climb.end / ROUTE_DS));
  const n = i1 - i0 + 1;
  if (n < 10) return [];
  // Unwrapped heading. A positive change turns toward the rider's right.
  const ang = new Float64Array(n);
  let prev = Math.atan2(route.tz[i0], route.tx[i0]);
  ang[0] = prev;
  for (let k = 1; k < n; k++) {
    const a = Math.atan2(route.tz[i0 + k], route.tx[i0 + k]);
    let d = a - prev;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    ang[k] = ang[k - 1] + d;
    prev = a;
  }
  // A sample is in a bend when the radius over the next 8 m is under about 45 m.
  const span = 2;
  const turning = (k: number) => k >= span && k < n - span && Math.abs(ang[k + span] - ang[k - span]) > (span * 2 * ROUTE_DS) / 45;
  const out: (Hairpin & { turn: number })[] = [];
  // A real road with a published hairpin count: take a looser look, then keep the sharpest ones.
  const known = route.def?.track?.hairpinCount ?? 0;
  const minTurn = ((known ? 100 : 120) * Math.PI) / 180;
  const maxLength = known ? 130 : 110;
  let k = span;
  while (k < n - span) {
    if (!turning(k)) {
      k++;
      continue;
    }
    let end = k;
    let gap = 0;
    let j = k + 1;
    // Straight bits of up to 8 m inside a bend do not split it.
    while (j < n - span && gap <= 4) {
      if (turning(j)) {
        end = j;
        gap = 0;
      } else gap++;
      j++;
    }
    const a = Math.max(0, k - span);
    const b = Math.min(n - 1, end + span);
    const total = ang[b] - ang[a];
    const length = (b - a) * ROUTE_DS;
    if (Math.abs(total) > minTurn && length < maxLength) {
      let apex = a;
      while (apex < b && Math.abs(ang[apex] - ang[a]) < Math.abs(total) / 2) apex++;
      out.push({ idx: i0 + apex, outside: total > 0 ? -1 : 1, from: i0 + a, to: i0 + b, number: 0, turn: Math.abs(total) });
    }
    k = end + 1;
  }
  // Most climbs count down to 1 at the top; some (Vršič) count up from the foot.
  const up = route.def?.track?.hairpins === 'up';
  let pins = out;
  if (known && pins.length > known) {
    // The numbered bends are on the climb itself. A corner in the flat streets
    // after the last bend (Alpe d'Huez, above bend 1, about 4%) is sharper than
    // the gentlest real bend, and would take its sign. Drop those first.
    const steep = pins.filter((p) => Math.abs(route.grade[p.idx]) >= 0.045);
    const pool = steep.length >= known ? steep : pins;
    const keep = new Set([...pool].sort((p, q) => q.turn - p.turn).slice(0, known));
    pins = pins.filter((p) => keep.has(p));
  }
  const list: Hairpin[] = pins.map(({ turn: _turn, ...h }) => h);
  list.forEach((h, i) => (h.number = up ? i + 1 : list.length - i));
  return list;
}

// ------------------------------------------------------------------------------------ atlas

/** One atlas cell, in pixels. Bornes and hairpin plates take one, a summit sign two side by side. */
const CELL_W = 160;
const CELL_H = 200;
const COLS = 6;
const ATLAS_W = 1024;

interface Cell {
  u0: number;
  u1: number;
  v0: number;
  v1: number;
}

class Atlas {
  private draws: ((ctx: CanvasRenderingContext2D) => void)[] = [];
  private slots: { col: number; row: number; span: number; cell: Cell }[] = [];
  private col = 0;
  private row = 0;

  /** Reserves `span` cells in a row; the UVs are filled in once the atlas height is known. */
  add(span: 1 | 2, paint: (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) => void): Cell {
    if (this.col + span > COLS) {
      this.col = 0;
      this.row++;
    }
    const cell: Cell = { u0: 0, u1: 0, v0: 0, v1: 0 };
    const col = this.col;
    const row = this.row;
    this.slots.push({ col, row, span, cell });
    this.draws.push((ctx) => paint(ctx, col * CELL_W, row * CELL_H, CELL_W * span, CELL_H));
    this.col += span;
    return cell;
  }

  build(): THREE.CanvasTexture | null {
    if (!this.slots.length) return null;
    const height = (this.row + 1) * CELL_H;
    const canvas = document.createElement('canvas');
    canvas.width = ATLAS_W;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, ATLAS_W, height);
    for (const d of this.draws) d(ctx);
    // A two-pixel inset keeps mipmaps from bleeding the neighbouring sign in.
    const inset = 2;
    for (const s of this.slots) {
      const x0 = s.col * CELL_W + inset;
      const x1 = (s.col + s.span) * CELL_W - inset;
      const y0 = s.row * CELL_H + inset;
      const y1 = (s.row + 1) * CELL_H - inset;
      s.cell.u0 = x0 / ATLAS_W;
      s.cell.u1 = x1 / ATLAS_W;
      // Canvas textures are flipped on upload: canvas top is v = 1.
      s.cell.v1 = 1 - y0 / height;
      s.cell.v0 = 1 - y1 / height;
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }
}

/** Fills one line of text, shrinking the font until it fits the width. */
function fitText(ctx: CanvasRenderingContext2D, text: string, cx: number, y: number, maxW: number, size: number, weight: string, color: string): void {
  let s = size;
  ctx.font = `${weight} ${s}px Poppins, sans-serif`;
  while (s > 8 && ctx.measureText(text).width > maxW) {
    s -= 1;
    ctx.font = `${weight} ${s}px Poppins, sans-serif`;
  }
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, cx, y);
}

function paintBorne(name: string, kmToGo: number, grade: number) {
  return (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) => {
    const band = gradeBand(grade);
    ctx.fillStyle = '#f7f5ef';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = band;
    ctx.fillRect(x, y, w, h * 0.36);
    const cx = x + w / 2;
    fitText(ctx, name.toUpperCase(), cx, y + h * 0.11, w - 14, 19, '700', '#ffffff');
    fitText(ctx, 'SOMMET', cx, y + h * 0.26, w - 14, 17, '600', 'rgba(255,255,255,0.9)');
    fitText(ctx, `${kmToGo} km`, cx, y + h * 0.56, w - 10, 50, '800', '#1b1c1f');
    const pct = `${(grade * 100).toFixed(1)} %`;
    fitText(ctx, pct, cx, y + h * 0.82, w - 14, 34, '800', band === '#18191b' ? '#18191b' : band);
  };
}

function paintHairpin(number: number, altitude: number, winner: string) {
  return (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) => {
    ctx.fillStyle = '#f7f6f2';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#1d3f8a';
    ctx.lineWidth = 6;
    ctx.strokeRect(x + 7, y + 7, w - 14, h - 14);
    const cx = x + w / 2;
    fitText(ctx, 'VIRAGE', cx, y + h * 0.17, w - 30, 22, '700', '#1d3f8a');
    fitText(ctx, String(number), cx, y + h * 0.47, w - 30, 74, '900', '#1d3f8a');
    fitText(ctx, winner.toUpperCase(), cx, y + h * 0.72, w - 30, 17, '600', '#33363d');
    fitText(ctx, `${Math.round(altitude)} m`, cx, y + h * 0.85, w - 30, 16, '600', '#33363d');
  };
}

function paintSummit(name: string, altitude: number) {
  return (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) => {
    ctx.fillStyle = '#5b3a24';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#f2ede2';
    ctx.lineWidth = 5;
    ctx.strokeRect(x + 9, y + 9, w - 18, h - 18);
    const cx = x + w / 2;
    fitText(ctx, name.toUpperCase(), cx, y + h * 0.4, w - 40, 44, '800', '#f2ede2');
    fitText(ctx, `ALTITUDE ${Math.round(altitude)} m`, cx, y + h * 0.7, w - 40, 26, '600', '#f2ede2');
  };
}

// ------------------------------------------------------------------------------------ build

export interface ClimbFurniture {
  group: THREE.Group;
  /** Per side (0 = left, 1 = right) and route sample: 1 where a stone wall stands, so no wooden rail goes there too. */
  walls: [Uint8Array, Uint8Array];
}

interface Board {
  x: number;
  y: number;
  z: number;
  /** Unit horizontal normal of the face, toward the riders who should read it. */
  nx: number;
  nz: number;
}

const tmpSample = { x: 0, y: 0, z: 0, tx: 1, tz: 0, grade: 0 };

/** How a race asks for the names on the road. Free rides leave this unset. */
export interface RoadWriting {
  /** 1 faces riders going up the stored road. -1 faces riders coming back toward the start. */
  dir: 1 | -1;
  /** Limit the paint to this stretch of the route. Omitted paints every long climb. */
  from?: number;
  to?: number;
}

/** Climbs shorter than this stay bare. A race paints the longer ones every 10 m. */
export const RACE_NAME_MIN = 400;

/** Cheers, then fictional first and last names. Never a real rider's surname. */
export const ROAD_WORDS = [
  'ALLEZ', 'FORZA', 'HOP HOP', 'VAI', 'AUPA', 'VAMOS', 'GO GO',
  'LUKA NOVARIK', 'MATEJ KRANJEC', 'JAN ZAJC', 'ANZE POTOCNIK', 'DOMEN VIDMAR',
  'JONAS VINTER', 'MADS SKOVLUND', 'MAGNUS HOLM', 'REMI EVRAULT', 'YVES DELAERE',
  'PAUL SEIGNER', 'ROMAIN GREGAND', 'ENRIC MASDEN', 'PELLO ROGOV', 'GIULIO CICORELLI',
  'DAVIDE MILANI', 'TOM YARROW', 'ADAM BENNETT', 'TOBIAS JOHANSEN', 'MATHIS POELMAN',
  'NEIL KUSTER', 'BEN HINDON', 'SANTIAGO MONTES', 'FLORIAN LIPOV', 'MARC HIRZEL',
] as const;

const CHEER_COUNT = 7;

export function buildClimbFurniture(route: Route, field: TerrainField, writing?: RoadWriting): ClimbFurniture {
  const group = new THREE.Group();
  group.name = 'climb-furniture';
  const walls: [Uint8Array, Uint8Array] = [new Uint8Array(route.count), new Uint8Array(route.count)];
  const atlas = new Atlas();
  const faces: { board: Board; w: number; h: number; lift: number; cell: Cell }[] = [];
  const bornes: { board: Board; grade: number }[] = [];
  const posts: { x: number; y: number; z: number; height: number }[] = [];
  const backs: { board: Board; w: number; h: number; lift: number; color: number }[] = [];
  const wallBlocks: { m: THREE.Matrix4; color: THREE.Color }[] = [];
  const graffiti: RoadPaint[] = [];

  const boardAt = (idx: number, lateral: number, faceToward: { x: number; z: number }): Board => {
    const x = route.x[idx] - route.tz[idx] * lateral;
    const z = route.z[idx] + route.tx[idx] * lateral;
    const dx = faceToward.x - x;
    const dz = faceToward.z - z;
    const l = Math.hypot(dx, dz) || 1;
    return { x, y: route.y[idx], z, nx: dx / l, nz: dz / l };
  };
  // A post reaches down to the ground, which beside a hairpin can be well below the road.
  const addPost = (x: number, z: number, top: number) => {
    const foot = Math.min(field.heightAt(x, z), top - 2.6) - 0.2;
    posts.push({ x, y: foot, z, height: top - foot });
  };
  const idxAt = (s: number) => Math.min(route.count - 1, Math.max(0, Math.floor(route.wrap(s) / ROUTE_DS)));

  const rng = mulberry32(route.def.seed + 4049);
  const paintedNames = ROAD_WORDS.slice(CHEER_COUNT);
  if (writing) {
    for (const span of writingSpans(route, writing)) {
      graffiti.push(...planRoadPaint(span.from, span.to, route.def.seed + Math.round(span.from), 'race', span.flip));
    }
  }
  for (const climb of route.climbs) {
    // Hairpins: a numbered plate on a post at the outside of each bend, facing the way in.
    const pins = findHairpins(route, climb);
    for (const pin of pins) {
      const into = idxAt((pin.from - 12) * ROUTE_DS);
      const board = boardAt(pin.idx, pin.outside * (H + 1.55), { x: route.x[into], z: route.z[into] });
      const cell = atlas.add(1, paintHairpin(pin.number, route.y[pin.idx], paintedNames[Math.floor(rng() * paintedNames.length)]));
      // The post stands just behind the plate, not through it.
      addPost(board.x - board.nx * 0.08, board.z - board.nz * 0.08, board.y + 2.2);
      backs.push({ board, w: 0.74, h: 0.92, lift: 1.72, color: 0xe9e9e6 });
      faces.push({ board, w: 0.7, h: 0.88, lift: 1.72, cell });
      // Mark the bend's outside for a stone wall.
      const side = pin.outside > 0 ? 1 : 0;
      for (let i = pin.from - 6; i <= pin.to + 6; i++) if (i >= 0 && i < route.count) walls[side][i] = 2;
    }

    // Summit sign: two posts, brown board, past the line on the right.
    {
      const idx = idxAt(climb.end + 30);
      const back = idxAt(climb.end - 10);
      const board = boardAt(idx, H + 2.3, { x: route.x[back], z: route.z[back] });
      const rx = board.nz;
      const rz = -board.nx;
      for (const k of [-0.68, 0.68]) addPost(board.x + rx * k - board.nx * 0.08, board.z + rz * k - board.nz * 0.08, board.y + 2.5);
      const altitude = route.elevationAt(climb.end);
      backs.push({ board, w: 1.72, h: 0.9, lift: 2.05, color: 0x4a2f1e });
      faces.push({ board, w: 1.66, h: 0.84, lift: 2.05, cell: atlas.add(2, paintSummit(climb.name, altitude)) });
    }

    // Free rides paint the whole climb. Races already did, from the foot up.
    if (!writing && isBigClimb(climb)) {
      graffiti.push(...planRoadPaint(climb.start + 30, climb.end - 25, route.def.seed + Math.round(climb.start), 'ride'));
    }

    // Stone walls above steep drops anywhere on the climb.
    const i0 = idxAt(climb.start);
    const i1 = idxAt(climb.end);
    for (let i = i0; i <= i1; i++) {
      for (const side of [0, 1] as const) {
        const sign = side ? 1 : -1;
        const ox = route.x[i] - route.tz[i] * sign * (H + 8);
        const oz = route.z[i] + route.tx[i] * sign * (H + 8);
        const drop = route.y[i] - field.heightAt(ox, oz);
        if (drop > 2.2) walls[side][i] = 1;
        else if (walls[side][i] === 2 && drop < 0.3) walls[side][i] = 0;
      }
    }

    // Kilometre bornes: one per whole kilometre to the summit, on the right verge, facing down the road.
    if (climb.length >= BORNE_MIN_LENGTH) {
      for (let km = Math.floor(climb.length / 1000); km >= 1; km--) {
        const s = climb.end - km * 1000;
        if (s < climb.start + 150) continue;
        const grade = (route.elevationAt(Math.min(climb.end, s + 1000)) - route.elevationAt(s)) / Math.min(1000, climb.end - s);
        const idx = idxAt(s);
        const back = idxAt(s - 20);
        // On the verge, or tucked in front of a stone wall where there is one.
        const board = boardAt(idx, walls[1][idx] ? H + 0.24 : H + 0.55, { x: route.x[back], z: route.z[back] });
        board.y -= 0.12;
        bornes.push({ board, grade });
        const cell = atlas.add(1, paintBorne(climb.name, km, grade));
        faces.push({ board, w: 0.44, h: 0.6, lift: 0.43, cell });
      }
    }
  }

  // Wall blocks: a 2 m stone block on every marked sample, pitched with the road.
  const stones = [0x9b958a, 0xa8a195, 0x8e897f, 0xb3ac9e, 0x989081];
  const qYaw = new THREE.Quaternion();
  const qPitch = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const zAxis = new THREE.Vector3(0, 0, 1);
  for (const side of [0, 1] as const) {
    const lateral = (side ? 1 : -1) * (H + 0.75);
    for (let i = 0; i < route.count; i++) {
      if (!walls[side][i]) continue;
      const s = i * ROUTE_DS;
      route.place(s + ROUTE_DS / 2, lateral, tmpSample);
      qYaw.setFromAxisAngle(up, Math.atan2(-tmpSample.tz, tmpSample.tx));
      qPitch.setFromAxisAngle(zAxis, Math.atan(tmpSample.grade));
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(tmpSample.x, tmpSample.y - 0.32, tmpSample.z),
        qYaw.multiply(qPitch),
        new THREE.Vector3(1, 1, 1),
      );
      wallBlocks.push({ m, color: new THREE.Color(stones[(i * 7 + side * 3) % stones.length]) });
    }
  }

  const texture = atlas.build();
  if (texture) {
    group.add(facesMesh(faces, texture));
    const flat = (color: number) => new THREE.MeshStandardMaterial({ color, roughness: 0.75, flatShading: true });
    if (bornes.length) group.add(...borneMeshes(bornes, flat));
    if (backs.length) group.add(backsMesh(backs, flat(0xffffff)));
  }
  if (posts.length) group.add(postsMesh(posts));
  if (wallBlocks.length) group.add(wallMesh(wallBlocks));
  if (graffiti.length) group.add(graffitiMesh(route, graffiti));
  return { group, walls };
}

// ------------------------------------------------------------------------------------ graffiti

export interface RoadPaint {
  s: number;
  lat: number;
  word: number;
  width: number;
  length: number;
  /** Turn the letters around so a rider coming back down the road can read them. */
  flip: boolean;
}

const WORD_COLS = 2;
const WORD_H = 128;
const ATLAS_H = Math.ceil(ROAD_WORDS.length / WORD_COLS) * WORD_H;
/** The widest a name gets: verge to verge, just inside the edge lines. */
const ROAD_SPAN = ROAD_HALF_WIDTH * 2 * 0.97;

interface WritingSpan {
  from: number;
  to: number;
  flip: boolean;
}

function overlaps(start: number, end: number, from: number, to: number): boolean {
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  return end >= lo - 40 && start <= hi + 40;
}

/** Stretches that get race paint: the named climbs, or the rises when the stage runs backwards. */
export function writingSpans(route: Route, writing: RoadWriting): WritingSpan[] {
  if (writing.dir < 0 && writing.from != null && writing.to != null) {
    return uphillRuns(route, writing.from, writing.to, -1)
      .filter((run) => run.length >= RACE_NAME_MIN)
      .map((run) => ({
        from: Math.min(run.start, run.end) + 8,
        to: Math.max(run.start, run.end) - 8,
        flip: true,
      }))
      .filter((span) => span.to > span.from + 20);
  }
  const spans: WritingSpan[] = [];
  for (const climb of route.climbs) {
    if (climb.length < RACE_NAME_MIN) continue;
    if (writing.from != null && writing.to != null && !overlaps(climb.start, climb.end, writing.from, writing.to)) continue;
    const from = climb.start + 12;
    const to = climb.end - 12;
    if (to > from + 20) spans.push({ from, to, flip: false });
  }
  return spans;
}

/** Uphill runs in the direction of travel. `dir` -1 walks from `from` toward smaller metres. */
export function uphillRuns(route: Route, from: number, endAt: number, dir: 1 | -1): { start: number; end: number; length: number; gain: number }[] {
  const span = Math.abs(endAt - from);
  if (span < 80) return [];
  const step = 20;
  const runs: { start: number; end: number; length: number; gain: number }[] = [];
  let baseD = 0;
  let baseY = route.elevationAt(route.wrap(from));
  let peakD = 0;
  let peakY = baseY;
  let rising = false;
  const commit = () => {
    const length = peakD - baseD;
    const gain = peakY - baseY;
    if (rising && gain >= 25 && length >= RACE_NAME_MIN) {
      runs.push({
        start: route.wrap(from + dir * baseD),
        end: route.wrap(from + dir * peakD),
        length,
        gain,
      });
    }
    rising = false;
  };
  for (let d = step; d <= span + 0.1; d += step) {
    const y = route.elevationAt(route.wrap(from + dir * Math.min(d, span)));
    if (!rising) {
      if (y > baseY + 0.6) rising = true;
      else {
        baseD = d;
        baseY = y;
      }
      peakD = d;
      peakY = y;
      continue;
    }
    if (y >= peakY - 0.4) {
      if (y >= peakY) {
        peakD = d;
        peakY = y;
      }
      continue;
    }
    if (peakY - y >= 6) {
      commit();
      baseD = d;
      baseY = y;
      peakD = d;
      peakY = y;
    }
  }
  commit();
  return runs;
}

/**
 * How wide this word is, and where it sits. Some cross the carriageway.
 * The others are a patch on the left, the middle, or the right, still on the asphalt.
 */
function wordPatch(rng: () => number): { width: number; length: number; lat: number } {
  const full = rng() < 0.4;
  const width = full ? ROAD_SPAN : ROAD_SPAN * (0.36 + rng() * 0.38);
  const length = full ? 2.3 + rng() * 1.1 : 1.45 + rng() * 0.9;
  const room = Math.max(0, ROAD_HALF_WIDTH - 0.3 - width / 2);
  const lat = full || room < 0.2 ? 0 : (rng() * 2 - 1) * room;
  return { width, length, lat };
}

/**
 * Metres down to the next name. `u` is 0 at the foot and 1 at the summit.
 * The top fifth keeps the close spacing. The middle is a name now and then.
 * The bottom is only the odd one.
 */
function nameGap(u: number, kind: 'race' | 'ride', rng: () => number): number {
  const top = u >= 0.8;
  const middle = u >= 0.4;
  if (kind === 'race') {
    if (top) return 10;
    if (middle) return 36 + rng() * 20;
    return 180 + rng() * 100;
  }
  if (top) return 28 + rng() * 24;
  if (middle) return 80 + rng() * 50;
  return 260 + rng() * 140;
}

/**
 * Words on the road between two distances. Sparse at the foot, closer in the
 * middle, and — on a race — every 10 m through the top fifth. A free ride stays
 * looser in every part.
 */
export function planRoadPaint(from: number, to: number, seed: number, kind: 'race' | 'ride', flip = false): RoadPaint[] {
  if (!(to > from + 8)) return [];
  const rng = mulberry32(seed >>> 0);
  const out: RoadPaint[] = [];
  const names = ROAD_WORDS.length - CHEER_COUNT;
  const span = to - from;
  let s = to;
  while (s > from) {
    const word = kind === 'race'
      ? (rng() < 0.68 ? CHEER_COUNT + Math.floor(rng() * names) : Math.floor(rng() * CHEER_COUNT))
      : Math.floor(rng() * ROAD_WORDS.length);
    const patch = wordPatch(rng);
    out.push({ s, word, flip, ...patch });
    s -= nameGap((s - from) / span, kind, rng);
  }
  return out;
}

let graffitiTexture: THREE.CanvasTexture | null = null;
/** Shared by every world and race finish, so a teardown leaves it (and its texture) alone. */
let graffitiMaterial: THREE.MeshStandardMaterial | null = null;
/** White letters on transparent. One slot is 512 x 128. Built once per page. */
function graffitiAtlas(): THREE.CanvasTexture {
  if (graffitiTexture) return graffitiTexture;
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_W;
  canvas.height = ATLAS_H;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, ATLAS_W, ATLAS_H);
  ROAD_WORDS.forEach((word, i) => {
    const x = (i % WORD_COLS) * 512;
    const y = Math.floor(i / WORD_COLS) * WORD_H;
    ctx.save();
    ctx.translate(x + 256, y + WORD_H / 2);
    ctx.rotate(((i * 37) % 7 - 3) * 0.012);
    ctx.font = 'italic 900 100px Poppins, sans-serif';
    ctx.fillStyle = '#f6f3ea';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // Stretch every word, short or long, out to both edges of the slot.
    const measured = ctx.measureText(word).width || 1;
    ctx.scale(500 / measured, 1);
    ctx.fillText(word, 0, 2);
    ctx.restore();
  });
  graffitiTexture = new THREE.CanvasTexture(canvas);
  graffitiTexture.colorSpace = THREE.SRGBColorSpace;
  graffitiTexture.anisotropy = 8;
  return graffitiTexture;
}

/**
 * Paint lying on the asphalt. The log depth buffer ignores polygonOffset, so the
 * quads sit 4.5 cm above the road and follow it in three steps along their length.
 */
export function graffitiMesh(route: Route, list: RoadPaint[]): THREE.Mesh {
  const steps = 3;
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const index: number[] = [];
  for (const g of list) {
    const col = g.word % WORD_COLS;
    const row = Math.floor(g.word / WORD_COLS);
    const u0 = (col * 512 + 4) / ATLAS_W;
    const u1 = ((col + 1) * 512 - 4) / ATLAS_W;
    const vTop = 1 - (row * WORD_H + 4) / ATLAS_H;
    const vBottom = 1 - ((row + 1) * WORD_H - 4) / ATLAS_H;
    // A rider going back down the road needs the letters turned around.
    const uL = g.flip ? u1 : u0;
    const uR = g.flip ? u0 : u1;
    const v0 = g.flip ? vTop : vBottom;
    const v1 = g.flip ? vBottom : vTop;
    const base = pos.length / 3;
    for (let j = 0; j <= steps; j++) {
      // Letter tops point up the road, away from the rider reading them.
      const along = (j / steps - 0.5) * g.length;
      for (let i = 0; i <= 1; i++) {
        const lat = g.lat + (i - 0.5) * g.width;
        route.place(g.s + along, lat, tmpSample);
        pos.push(tmpSample.x, tmpSample.y + 0.02 + 0.045, tmpSample.z);
        nor.push(-tmpSample.tx * tmpSample.grade, 1, -tmpSample.tz * tmpSample.grade);
        uv.push(i ? uR : uL, v0 + (v1 - v0) * (j / steps));
      }
    }
    for (let j = 0; j < steps; j++) {
      const a = base + j * 2;
      // a, a+1: left and right at this step; a+2, a+3 one step up the road. Counter-clockwise from above.
      index.push(a, a + 3, a + 2, a, a + 1, a + 3);
    }
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geom.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geom.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geom.setIndex(index);
  geom.normalizeNormals();
  geom.computeBoundingSphere();
  graffitiMaterial ??= keepShared(new THREE.MeshStandardMaterial({ map: graffitiAtlas(), alphaTest: 0.45, roughness: 0.8 }));
  const mesh = new THREE.Mesh(geom, graffitiMaterial);
  mesh.name = 'road-graffiti';
  mesh.receiveShadow = true;
  return mesh;
}

/** Painted words between two distances, for a race finish on a climb without its own. */
export function raceGraffiti(route: Route, from: number, to: number, seed: number): THREE.Mesh | null {
  const list = planRoadPaint(Math.min(from, to), Math.max(from, to), seed, 'ride');
  return list.length ? graffitiMesh(route, list) : null;
}

// ------------------------------------------------------------------------------------ meshes

/** All sign faces in one mesh: a quad per face, UVs into the atlas. */
function facesMesh(faces: { board: Board; w: number; h: number; lift: number; cell: Cell }[], texture: THREE.Texture): THREE.Mesh {
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const index: number[] = [];
  for (const f of faces) {
    const { board: b, w, h, cell } = f;
    // Right, as seen by someone facing the sign.
    const rx = b.nz;
    const rz = -b.nx;
    // Just proud of the board or borne so it does not flicker against it.
    const out = f.lift > 1 ? 0.04 : 0.135;
    const cx = b.x + b.nx * out;
    const cz = b.z + b.nz * out;
    const cy = b.y + f.lift;
    const base = pos.length / 3;
    const corner = (sx: number, sy: number) => {
      pos.push(cx + rx * sx * (w / 2), cy + sy * (h / 2), cz + rz * sx * (w / 2));
      nor.push(b.nx, 0, b.nz);
    };
    corner(-1, -1);
    uv.push(cell.u0, cell.v0);
    corner(1, -1);
    uv.push(cell.u1, cell.v0);
    corner(1, 1);
    uv.push(cell.u1, cell.v1);
    corner(-1, 1);
    uv.push(cell.u0, cell.v1);
    index.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geom.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geom.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geom.setIndex(index);
  geom.computeBoundingSphere();
  const mesh = new THREE.Mesh(geom, new THREE.MeshStandardMaterial({ map: texture, roughness: 0.65 }));
  mesh.name = 'climb-sign-faces';
  mesh.receiveShadow = true;
  return mesh;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const _up = new THREE.Vector3(0, 1, 0);

/** Yaw that turns local +z onto the board's normal. */
const faceYaw = (b: Board) => Math.atan2(b.nx, b.nz);

/** Borne body (white) and its rounded cap (grade colour), two instanced meshes. */
function borneMeshes(bornes: { board: Board; grade: number }[], flat: (c: number) => THREE.MeshStandardMaterial): THREE.InstancedMesh[] {
  // 0.5 wide, 0.25 deep, 0.75 tall; the cap is a half cylinder across the top.
  const body = new THREE.BoxGeometry(0.5, 0.75, 0.25).translate(0, 0.375, 0);
  const cap = new THREE.CylinderGeometry(0.25, 0.25, 0.25, 8, 1, false, -Math.PI / 2, Math.PI).rotateX(-Math.PI / 2).translate(0, 0.75, 0);
  const bodies = new THREE.InstancedMesh(body, flat(0xf2f0ea), bornes.length);
  const caps = new THREE.InstancedMesh(cap, flat(0xffffff), bornes.length);
  const c = new THREE.Color();
  bornes.forEach((b, i) => {
    _q.setFromAxisAngle(_up, faceYaw(b.board));
    _m.compose(_p.set(b.board.x, b.board.y, b.board.z), _q, _s);
    bodies.setMatrixAt(i, _m);
    caps.setMatrixAt(i, _m);
    caps.setColorAt(i, c.set(gradeBand(b.grade)));
  });
  for (const mesh of [bodies, caps]) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
  }
  bodies.name = 'km-bornes';
  return [bodies, caps];
}

function backsMesh(backs: { board: Board; w: number; h: number; lift: number; color: number }[], mat: THREE.MeshStandardMaterial): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 0.06), mat, backs.length);
  const c = new THREE.Color();
  backs.forEach((b, i) => {
    _q.setFromAxisAngle(_up, faceYaw(b.board));
    _m.compose(_p.set(b.board.x, b.board.y + b.lift, b.board.z), _q, new THREE.Vector3(b.w, b.h, 1));
    mesh.setMatrixAt(i, _m);
    mesh.setColorAt(i, c.set(b.color));
  });
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.computeBoundingSphere();
  mesh.name = 'climb-sign-boards';
  return mesh;
}

function postsMesh(posts: { x: number; y: number; z: number; height: number }[]): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.045, 0.045, 1, 6).translate(0, 0.5, 0),
    new THREE.MeshStandardMaterial({ color: 0x8c9098, roughness: 0.5, metalness: 0.4, flatShading: true }),
    posts.length,
  );
  posts.forEach((p, i) => {
    _m.compose(_p.set(p.x, p.y, p.z), _q.identity(), new THREE.Vector3(1, p.height, 1));
    mesh.setMatrixAt(i, _m);
  });
  mesh.castShadow = true;
  mesh.computeBoundingSphere();
  mesh.name = 'climb-sign-posts';
  return mesh;
}

function wallMesh(blocks: { m: THREE.Matrix4; color: THREE.Color }[]): THREE.InstancedMesh {
  // 2.1 m long so neighbours overlap on a bend; 0.6 m above the road, 0.32 m below the verge.
  const geom = new THREE.BoxGeometry(2.1, 0.92, 0.42).translate(0, 0.46, 0);
  const mesh = new THREE.InstancedMesh(geom, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true }), blocks.length);
  blocks.forEach((b, i) => {
    mesh.setMatrixAt(i, b.m);
    mesh.setColorAt(i, b.color);
  });
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.computeBoundingSphere();
  mesh.name = 'climb-walls';
  return mesh;
}
