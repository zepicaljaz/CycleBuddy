import * as THREE from 'three';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';
import { mulberry32 } from '../util/math';
import { prepare, type Prepared } from './batch';
import { paint, profileExtrude, tube, v3 } from './geometry';
import type { MatKind, Model } from './materials';

/**
 * Procedural buildings. Each faces local +x (the street side), stands on y = 0 at its
 * centre and is tinted per instance through the 'wall', 'roof' and 'accent' slots.
 * Foundations reach well below ground so a building can sit on a gentle slope.
 */

type Geo = THREE.BufferGeometry;

export type BuildingKind =
  | 'cottage'
  | 'house'
  | 'gablefront'
  | 'modern'
  | 'townhouse'
  | 'shop'
  | 'apartment'
  | 'tower'
  | 'garage'
  | 'garage2'
  | 'barn'
  | 'farmhouse'
  | 'silo'
  | 'adobe'
  | 'church'
  | 'villa'
  | 'duplex';

export interface Building {
  model: Prepared;
  /** Footprint along x (depth, front to back) and z (width along the street), roof overhang included. */
  d: number;
  w: number;
  h: number;
  /** Where the front door is along z, for paths and drives. */
  door: number;
  /** Distance from the origin to the front (+x) and back (-x) of the footprint. */
  front: number;
  back: number;
}

const GLASS = 0x27323e;
const GLASS_LIT = 0x3a4450;
const FRAME = 0xf1eee6;
const STONE = 0x8e8a83;
const STEP = 0xb9b5ad;
const METAL = 0x5d6066;
const WOOD = 0x7a5232;
const STOREY = 2.9;
const FLOOR = 0.5;

function box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): Geo {
  const ax = Math.min(x0, x1), bx = Math.max(x0, x1);
  const ay = Math.min(y0, y1), by = Math.max(y0, y1);
  const az = Math.min(z0, z1), bz = Math.max(z0, z1);
  return new THREE.BoxGeometry(Math.max(1e-3, bx - ax), Math.max(1e-3, by - ay), Math.max(1e-3, bz - az)).translate((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
}

class Kit {
  readonly parts: Model = [];
  add(g: Geo, mat: MatKind, color: THREE.ColorRepresentation, tint?: string, crease = 0): void {
    this.parts.push({ geom: paint(g, color, { crease }), mat, tint });
  }
  wall(g: Geo, shade = 1): void {
    this.add(g, 'matte', new THREE.Color(shade, shade, shade), 'wall');
  }
  roof(g: Geo, shade = 1): void {
    this.add(g, 'rough', new THREE.Color(shade, shade, shade), 'roof');
  }
  accent(g: Geo, mat: MatKind = 'matte', shade = 1): void {
    this.add(g, mat, new THREE.Color(shade, shade, shade), 'accent');
  }
}

/** 0 = front (+x), 1 = +z, 2 = back (-x), 3 = -z. */
type Side = 0 | 1 | 2 | 3;

/**
 * Maps face coordinates (u along the wall to the viewer's right, y up, n out of the wall)
 * into the building. The origin sits 5 cm proud of the wall. Window and door boxes reach
 * 3 cm back in face space, so this keeps every pane and frame outside the wall instead of
 * sharing its surface. Shared surfaces flicker into black rectangles as the camera moves.
 */
function face(side: Side, d: number, w: number): THREE.Matrix4 {
  const up = v3(0, 1, 0);
  const proud = 0.05;
  const m = new THREE.Matrix4();
  const place = (x: THREE.Vector3, z: THREE.Vector3, p: THREE.Vector3) =>
    m.makeBasis(x, up, z).setPosition(p.addScaledVector(z, proud));
  if (side === 0) return place(v3(0, 0, -1), v3(1, 0, 0), v3(d / 2, 0, 0));
  if (side === 1) return place(v3(1, 0, 0), v3(0, 0, 1), v3(0, 0, w / 2));
  if (side === 2) return place(v3(0, 0, 1), v3(-1, 0, 0), v3(-d / 2, 0, 0));
  return place(v3(-1, 0, 0), v3(0, 0, -1), v3(0, 0, -w / 2));
}

const faceLen = (side: Side, d: number, w: number) => (side % 2 === 0 ? w : d);

/** Evenly spaced bay centres along a wall. */
function bays(len: number, n: number): number[] {
  return Array.from({ length: n }, (_, i) => -len / 2 + (len * (i + 0.5)) / n);
}

interface WinOpts {
  shutters?: boolean;
  cross?: boolean;
  frame?: number;
  sill?: boolean;
  glass?: number;
  /** Roller-shutter box above the window. */
  roller?: boolean;
}

function win(k: Kit, f: THREE.Matrix4, u: number, y: number, w: number, h: number, o: WinOpts = {}): void {
  const fr = o.frame ?? FRAME;
  const t = 0.07;
  const put = (g: Geo, mat: MatKind, c: number, tint?: string) => k.add(g.applyMatrix4(f), mat, c, tint);
  put(box(u - w / 2, u + w / 2, y, y + h, -0.03, 0.01), 'glass', o.glass ?? GLASS);
  put(box(u - w / 2 - t, u - w / 2, y - t, y + h + t, -0.03, 0.055), 'matte', fr);
  put(box(u + w / 2, u + w / 2 + t, y - t, y + h + t, -0.03, 0.055), 'matte', fr);
  put(box(u - w / 2, u + w / 2, y + h, y + h + t, -0.03, 0.055), 'matte', fr);
  put(box(u - w / 2, u + w / 2, y - t, y, -0.03, 0.055), 'matte', fr);
  if (o.cross) {
    put(box(u - 0.025, u + 0.025, y, y + h, -0.03, 0.035), 'matte', fr);
    put(box(u - w / 2, u + w / 2, y + h * 0.64 - 0.025, y + h * 0.64 + 0.025, -0.03, 0.035), 'matte', fr);
  }
  if (o.sill ?? true) put(box(u - w / 2 - 0.1, u + w / 2 + 0.1, y - t - 0.06, y - t, -0.03, 0.13), 'rough', 0xd6d2ca);
  if (o.roller) put(box(u - w / 2 - t, u + w / 2 + t, y + h + t, y + h + t + 0.2, -0.03, 0.07), 'matte', 0xdedad2);
  if (o.shutters) {
    for (const s of [-1, 1]) {
      const a = u + s * (w / 2 + t + 0.02);
      const b = u + s * (w / 2 + t + 0.02 + w * 0.5);
      k.accent(box(a, b, y - t, y + h + t, 0, 0.045).applyMatrix4(f));
      // Louvres read as a few darker bands.
      for (let i = 1; i < 5; i++) {
        const yy = y - t + ((h + 2 * t) * i) / 5;
        k.accent(box(a, b, yy - 0.012, yy + 0.012, 0.04, 0.055).applyMatrix4(f), 'matte', 0.72);
      }
    }
  }
}

function frontDoor(k: Kit, f: THREE.Matrix4, u: number, w = 1.05, h = 2.15, canopy = true): void {
  const put = (g: Geo, mat: MatKind, c: number) => k.add(g.applyMatrix4(f), mat, c);
  k.accent(box(u - w / 2, u + w / 2, FLOOR, FLOOR + h, -0.03, 0.03).applyMatrix4(f), 'gloss', 0.85);
  put(box(u - w / 2 + 0.12, u + w / 2 - 0.12, FLOOR + h * 0.62, FLOOR + h - 0.14, -0.03, 0.04), 'glass', GLASS);
  put(box(u - w / 2 - 0.08, u - w / 2, FLOOR, FLOOR + h + 0.08, -0.03, 0.07), 'matte', FRAME);
  put(box(u + w / 2, u + w / 2 + 0.08, FLOOR, FLOOR + h + 0.08, -0.03, 0.07), 'matte', FRAME);
  put(box(u - w / 2, u + w / 2, FLOOR + h, FLOOR + h + 0.08, -0.03, 0.07), 'matte', FRAME);
  put(box(u + w / 2 - 0.2, u + w / 2 - 0.12, FLOOR + 1.0, FLOOR + 1.05, 0.03, 0.08), 'chrome', 0xc8c8c8);
  // Steps up to the floor.
  put(box(u - w / 2 - 0.3, u + w / 2 + 0.3, -0.6, FLOOR * 0.5, 0, 0.75), 'rough', STEP);
  put(box(u - w / 2 - 0.3, u + w / 2 + 0.3, -0.6, FLOOR, 0, 0.4), 'rough', STEP);
  if (canopy) {
    k.add(box(u - w / 2 - 0.35, u + w / 2 + 0.35, FLOOR + h + 0.25, FLOOR + h + 0.36, -0.03, 0.95).applyMatrix4(f), 'rough', 0x6c6e72);
  }
}

/** Walls with a stone plinth that runs down into the ground. */
function body(k: Kit, d: number, w: number, h: number, plinth = STONE): void {
  k.wall(box(-d / 2, d / 2, 0.2, h, -w / 2, w / 2));
  k.add(box(-d / 2 - 0.05, d / 2 + 0.05, -2.6, FLOOR, -w / 2 - 0.05, w / 2 + 0.05), 'rough', plinth);
}

/** Corner boards or quoins on the vertical edges. */
function corners(k: Kit, d: number, w: number, y0: number, y1: number, c: number, mat: MatKind = 'matte'): void {
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      k.add(box(sx * (d / 2 - 0.12), sx * (d / 2 + 0.035), y0, y1, sz * (w / 2 - 0.12), sz * (w / 2 + 0.035)), mat, c);
    }
  }
}

/**
 * Tiled gable roof over a d (x) by w (z) block with its eaves at y0. The ridge runs along z,
 * or along x when `alongX`. The underside rests exactly on the wall tops. Returns the ridge height above y0.
 */
function gableRoof(k: Kit, d: number, w: number, y0: number, pitch: number, o: { alongX?: boolean; eave?: number; verge?: number; tiles?: boolean; gable?: boolean; x?: number; z?: number } = {}): number {
  const alongX = !!o.alongX;
  const S = alongX ? w : d;
  const L = alongX ? d : w;
  const eave = o.eave ?? 0.45;
  const verge = o.verge ?? 0.3;
  const tp = Math.tan(pitch);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const rise = (S / 2) * tp;
  const tv = 0.2 / cp;
  const ex = S / 2 + eave;
  const ey = y0 - eave * tp;
  const slope = ex / cp;
  const rows = o.tiles === false ? 1 : Math.max(2, Math.round(slope / 0.34));
  const tile = 0.035;
  const T = (s: number, off: number): [number, number] => [-ex + s * cp - sp * off, ey + tv + s * sp + cp * off];
  const left: [number, number][] = [[-ex, ey]];
  if (rows > 1) {
    left.push(T(0, tile));
    for (let i = 1; i < rows; i++) left.push(T((slope * i) / rows, 0), T((slope * i) / rows, tile));
  } else left.push(T(0, 0));
  left.push(T(slope, 0));
  const right = left.map(([x, y]) => [-x, y] as [number, number]).reverse();
  const outlinePts = [...left, ...right.slice(1), [0, y0 + rise] as [number, number]];
  const slab = profileExtrude(outlinePts, L + 2 * verge);
  const cap = new THREE.CylinderGeometry(0.11, 0.11, L + 2 * verge + 0.04, 8).rotateX(Math.PI / 2).translate(0, y0 + rise + tv - 0.03, 0);
  const parts: Geo[] = [slab, cap];
  let gable: Geo | null = null;
  if (o.gable ?? true) gable = profileExtrude([[-S / 2, 0], [S / 2, 0], [0, rise]], L).translate(0, y0, 0);
  if (alongX) {
    for (const g of parts) g.rotateY(Math.PI / 2);
    gable?.rotateY(Math.PI / 2);
  }
  const ox = o.x ?? 0;
  const oz = o.z ?? 0;
  if (ox || oz) {
    for (const g of parts) g.translate(ox, 0, oz);
    gable?.translate(ox, 0, oz);
  }
  if (gable) k.wall(gable);
  k.roof(slab);
  k.roof(cap, 0.78);
  return rise + tv;
}

/** Hip roof over a d by w block: four slopes, ridge along the longer side, caps on ridge and hips. */
function hipRoof(k: Kit, d: number, w: number, y0: number, pitch: number, eave = 0.5): number {
  const alongZ = w >= d;
  const hs = (alongZ ? d : w) / 2 + eave;
  const hl = (alongZ ? w : d) / 2 + eave;
  const tp = Math.tan(pitch);
  const yb = y0 - eave * tp;
  const yr = yb + hs * tp;
  const r = Math.max(0.01, hl - hs);
  const pts: THREE.Vector3[] = [];
  for (const y of [yb - 0.17, yb]) for (const a of [-1, 1]) for (const b of [-1, 1]) pts.push(v3(a * hs, y, b * hl));
  pts.push(v3(0, yr, -r), v3(0, yr, r));
  const g = new ConvexGeometry(pts);
  const caps: Geo[] = [tube(v3(0, yr + 0.03, -r), v3(0, yr + 0.03, r), 0.1, 0.1, 6)];
  for (const a of [-1, 1]) for (const b of [-1, 1]) caps.push(tube(v3(a * hs, yb + 0.06, b * hl), v3(0, yr + 0.03, b * r), 0.08, 0.08, 6));
  if (!alongZ) {
    g.rotateY(Math.PI / 2);
    for (const c of caps) c.rotateY(Math.PI / 2);
  }
  k.roof(g);
  for (const c of caps) k.roof(c, 0.78);
  return yr - y0;
}

/** Flat roof: membrane, parapet and coping. */
function flatRoof(k: Kit, d: number, w: number, y0: number, parapet = 0.55, coping = 0xcfcbc2): void {
  k.add(box(-d / 2 + 0.2, d / 2 - 0.2, y0 - 0.2, y0 + 0.08, -w / 2 + 0.2, w / 2 - 0.2), 'rough', 0x5a5c60);
  const t = 0.25;
  k.wall(box(-d / 2, d / 2, y0 - 0.1, y0 + parapet, w / 2 - t, w / 2));
  k.wall(box(-d / 2, d / 2, y0 - 0.1, y0 + parapet, -w / 2, -w / 2 + t));
  k.wall(box(d / 2 - t, d / 2, y0 - 0.1, y0 + parapet, -w / 2, w / 2));
  k.wall(box(-d / 2, -d / 2 + t, y0 - 0.1, y0 + parapet, -w / 2, w / 2));
  k.add(box(-d / 2 - 0.05, d / 2 + 0.05, y0 + parapet, y0 + parapet + 0.07, w / 2 - t - 0.03, w / 2 + 0.05), 'rough', coping);
  k.add(box(-d / 2 - 0.05, d / 2 + 0.05, y0 + parapet, y0 + parapet + 0.07, -w / 2 - 0.05, -w / 2 + t + 0.03), 'rough', coping);
  k.add(box(d / 2 - t - 0.03, d / 2 + 0.05, y0 + parapet, y0 + parapet + 0.07, -w / 2 + t, w / 2 - t), 'rough', coping);
  k.add(box(-d / 2 - 0.05, -d / 2 + t + 0.03, y0 + parapet, y0 + parapet + 0.07, -w / 2 + t, w / 2 - t), 'rough', coping);
}

function chimney(k: Kit, x: number, z: number, y0: number, y1: number, brick = 0x8c5a44): void {
  k.add(box(x - 0.32, x + 0.32, y0, y1, z - 0.4, z + 0.4), 'rough', brick);
  k.add(box(x - 0.4, x + 0.4, y1, y1 + 0.1, z - 0.48, z + 0.48), 'rough', 0x9a958c);
  k.add(box(x - 0.14, x + 0.14, y1 + 0.1, y1 + 0.32, z - 0.14, z + 0.14), 'rough', 0x5c4a40);
}

/** Windows on every wall of a block, floor by floor. The front can skip a bay for the door. */
function fenestrate(k: Kit, d: number, w: number, floors: number, o: WinOpts & { width?: number; height?: number; spacing?: number; doorBay?: number; sides?: Side[] } = {}): void {
  const ww = o.width ?? 1.15;
  const wh = o.height ?? 1.35;
  for (const side of o.sides ?? ([0, 1, 2, 3] as Side[])) {
    const len = faceLen(side, d, w);
    const n = Math.max(1, Math.floor((len - 0.8) / (o.spacing ?? 2.6)));
    const f = face(side, d, w);
    const us = bays(len, n);
    for (let fl = 0; fl < floors; fl++) {
      us.forEach((u, i) => {
        if (fl === 0 && side === 0 && i === o.doorBay) return;
        win(k, f, u, FLOOR + fl * STOREY + 0.9, ww, wh, o);
      });
    }
  }
}

function finish(k: Kit, d: number, w: number, h: number, door = 0, front = d / 2, back = d / 2): Building {
  return { model: prepare(k.parts), d, w, h, door, front, back };
}

// ------------------------------------------------------------------------------------------ houses

function cottage(r: () => number): Building {
  const k = new Kit();
  const w = 8.4 + r() * 2;
  const d = 6.6 + r() * 1.2;
  const h = FLOOR + STOREY + 0.35;
  body(k, d, w, h);
  const pitch = 0.68 + r() * 0.16;
  const rise = gableRoof(k, d, w, h, pitch);
  const shutters = r() < 0.6;
  const n = Math.max(2, Math.floor((w - 0.8) / 2.6));
  const doorBay = Math.floor(r() * n);
  fenestrate(k, d, w, 1, { shutters, cross: r() < 0.5, doorBay });
  const us = bays(w, n);
  frontDoor(k, face(0, d, w), us[doorBay], 1.0, 2.1, r() < 0.7);
  // A small window in each gable.
  for (const side of [1, 3] as Side[]) win(k, face(side, d, w), 0, h + rise * 0.22, 0.75, 0.85, { shutters, sill: false });
  chimney(k, -d * 0.18, (r() < 0.5 ? -1 : 1) * w * 0.3, h + rise * 0.4, h + rise + 0.5);
  return finish(k, d + 1, w + 0.7, h + rise, -us[doorBay]);
}

function house(r: () => number): Building {
  const k = new Kit();
  const w = 9 + r() * 2.6;
  const d = 7.6 + r() * 1.6;
  const h = FLOOR + 2 * STOREY + 0.3;
  body(k, d, w, h);
  // Band between the storeys.
  k.wall(box(-d / 2 - 0.06, d / 2 + 0.06, FLOOR + STOREY - 0.05, FLOOR + STOREY + 0.12, -w / 2 - 0.06, w / 2 + 0.06), 0.88);
  const rise = hipRoof(k, d, w, h, 0.5 + r() * 0.12);
  const n = Math.max(3, Math.floor((w - 0.8) / 2.5));
  const doorBay = Math.floor(n / 2);
  const shutters = r() < 0.45;
  fenestrate(k, d, w, 2, { shutters, roller: !shutters && r() < 0.6, doorBay });
  frontDoor(k, face(0, d, w), bays(w, n)[doorBay], 1.1, 2.2, true);
  corners(k, d, w, FLOOR, h, 0xe9e5dc);
  chimney(k, -d * 0.2, w * 0.22, h + rise * 0.3, h + rise + 0.4);
  return finish(k, d + 1, w + 1, h + rise, -bays(w, n)[doorBay]);
}

function gablefront(r: () => number): Building {
  const k = new Kit();
  const w = 6.8 + r() * 1.4;
  const d = 9 + r() * 2.2;
  const floors = 2;
  const h = FLOOR + floors * STOREY + 0.2;
  body(k, d, w, h);
  const rise = gableRoof(k, d, w, h, 0.72 + r() * 0.12, { alongX: true, eave: 0.4, verge: 0.45 });
  const shutters = r() < 0.5;
  fenestrate(k, d, w, floors, { shutters, doorBay: 0, spacing: 2.3 });
  const f = face(0, d, w);
  const us = bays(w, Math.max(1, Math.floor((w - 0.8) / 2.3)));
  frontDoor(k, f, us[0], 1.0, 2.1, true);
  // Window in the front and back gables.
  win(k, f, 0, h + rise * 0.18, 1.0, 1.1, { shutters });
  win(k, face(2, d, w), 0, h + rise * 0.18, 1.0, 1.1, { shutters });
  // Wooden balcony across the upper floor in front.
  if (r() < 0.55) {
    const y = FLOOR + STOREY;
    k.add(box(d / 2, d / 2 + 1.1, y - 0.12, y + 0.05, -w / 2 + 0.3, w / 2 - 0.3), 'rough', WOOD);
    for (let z = -w / 2 + 0.35; z <= w / 2 - 0.3; z += 0.16) k.add(box(d / 2 + 1.0, d / 2 + 1.06, y + 0.05, y + 0.95, z, z + 0.08), 'rough', 0x6a4529);
    k.add(box(d / 2 + 0.98, d / 2 + 1.1, y + 0.95, y + 1.02, -w / 2 + 0.3, w / 2 - 0.3), 'rough', WOOD);
  }
  chimney(k, -d * 0.25, w * 0.18, h + rise * 0.3, h + rise * 0.95);
  return finish(k, d + 1, w + 1, h + rise, -us[0]);
}

function modern(r: () => number): Building {
  const k = new Kit();
  const w = 10 + r() * 2;
  const d = 8 + r() * 1.2;
  const h1 = FLOOR + 3.1;
  body(k, d, w, h1);
  flatRoof(k, d, w, h1, 0.25, 0xd8d6d0);
  // Upper volume, set off to one side over the lower one.
  const uw = w * 0.62;
  const uz = (r() < 0.5 ? -1 : 1) * (w - uw) * 0.6;
  const h2 = h1 + 3.0;
  k.wall(box(-d / 2 + 0.6, d / 2 + 0.6, h1, h2, uz - uw / 2, uz + uw / 2), 0.96);
  k.add(box(-d / 2 + 0.6, d / 2 + 0.6, h2, h2 + 0.3, uz - uw / 2, uz + uw / 2), 'rough', 0xd8d6d0);
  // Timber cladding and big glazing.
  k.add(box(d / 2 + 0.6, d / 2 + 0.66, h1 + 0.1, h2 - 0.1, uz - uw / 2 + 0.1, uz - uw / 2 + uw * 0.38), 'rough', 0x8a6040);
  for (let z = uz - uw / 2 + 0.2; z < uz - uw / 2 + uw * 0.38; z += 0.18) k.add(box(d / 2 + 0.66, d / 2 + 0.68, h1 + 0.1, h2 - 0.1, z, z + 0.02), 'rough', 0x6a4a30);
  const glassBand = (side: Side, dd: number, ww: number, y0: number, y1: number, u0: number, u1: number, dx = 0, dz = 0) => {
    const f = face(side, dd, ww).premultiply(new THREE.Matrix4().makeTranslation(dx, 0, dz));
    k.add(box(u0, u1, y0, y1, -0.02, 0.02).applyMatrix4(f), 'glass', GLASS);
    for (let u = u0; u <= u1 + 1e-3; u += (u1 - u0) / Math.max(1, Math.round((u1 - u0) / 1.4))) k.add(box(u - 0.04, u + 0.04, y0, y1, -0.02, 0.05).applyMatrix4(f), 'metal', 0x303236);
    k.add(box(u0 - 0.04, u1 + 0.04, y1, y1 + 0.06, -0.02, 0.05).applyMatrix4(f), 'metal', 0x303236);
  };
  glassBand(0, d, w, FLOOR + 0.05, h1 - 0.35, -w / 2 + 0.6, w * 0.15, 0, 0);
  glassBand(2, d, w, FLOOR + 0.05, h1 - 0.35, -w / 2 + 1, w / 2 - 1, 0, 0);
  glassBand(0, d, uw, h1 + 0.5, h2 - 0.4, -uw / 2 + 0.3, uw * 0.1, 0.6, uz);
  glassBand(2, d, uw, h1 + 0.5, h2 - 0.4, -uw / 2 + 0.5, uw / 2 - 0.5, 0.6, uz);
  fenestrate(k, d, w, 1, { sides: [1, 3], width: 0.9, height: 1.6, frame: 0x303236, sill: false });
  const doorU = w * 0.32;
  frontDoor(k, face(0, d, w), doorU, 1.1, 2.3, false);
  return finish(k, d + 1.4, w, h2 + 0.3, -doorU);
}

function townhouse(r: () => number, shop: boolean): Building {
  const k = new Kit();
  const w = 6.5 + r() * 2.2;
  const d = 9.5 + r() * 2;
  const floors = 3 + (r() < 0.35 ? 1 : 0);
  const h = FLOOR + floors * STOREY + 0.25;
  body(k, d, w, h);
  // Cornices between floors.
  for (let fl = 1; fl < floors; fl++) {
    const y = FLOOR + fl * STOREY;
    k.wall(box(d / 2 - 0.1, d / 2 + 0.08, y - 0.06, y + 0.1, -w / 2, w / 2), 0.86);
  }
  const shutters = r() < 0.6;
  const n = Math.max(2, Math.floor((w - 0.6) / 2.2));
  const f = face(0, d, w);
  const us = bays(w, n);
  if (shop) {
    // Shop front: wide glazing, door, sign band and an awning.
    const y1 = FLOOR + 2.6;
    k.add(box(-w / 2 + 0.4, w / 2 - 0.4, FLOOR + 0.25, y1, -0.02, 0.03).applyMatrix4(f), 'glass', GLASS_LIT);
    k.accent(box(-w / 2 + 0.3, w / 2 - 0.3, FLOOR, FLOOR + 0.25, 0, 0.08).applyMatrix4(f), 'gloss', 0.5);
    k.accent(box(-w / 2 + 0.3, w / 2 - 0.3, y1, y1 + 0.5, 0, 0.1).applyMatrix4(f), 'gloss', 0.7);
    for (const u of [-w / 2 + 0.35, w / 2 - 0.35, us[0] + 0.6]) k.add(box(u - 0.06, u + 0.06, FLOOR, y1, 0, 0.07).applyMatrix4(f), 'metal', 0x2e3034);
    k.accent(box(us[0] - 0.5, us[0] + 0.5, FLOOR, FLOOR + 2.3, 0.02, 0.05).applyMatrix4(f), 'gloss', 0.45);
    // Awning: sloped cloth on arms.
    const aw = new THREE.BufferGeometry();
    const a0 = y1 + 0.45;
    const a1 = y1 - 0.15;
    const ax = 1.5;
    aw.setAttribute('position', new THREE.Float32BufferAttribute([-w / 2 + 0.3, a0, 0.05, w / 2 - 0.3, a0, 0.05, -w / 2 + 0.3, a1, ax, w / 2 - 0.3, a1, ax], 3));
    aw.setIndex([0, 2, 1, 1, 2, 3]);
    k.add(aw.applyMatrix4(f), 'cloth', 0xffffff, 'accent', 0);
    k.add(box(-w / 2 + 0.3, w / 2 - 0.3, a1 - 0.25, a1, ax - 0.02, ax + 0.01).applyMatrix4(f), 'cloth', 0xffffff, 'accent');
  } else {
    frontDoor(k, f, us[0], 1.05, 2.2, false);
    us.slice(1).forEach((u) => win(k, f, u, FLOOR + 0.9, 1.1, 1.4, { shutters }));
  }
  for (let fl = 1; fl < floors; fl++) {
    us.forEach((u, i) => {
      win(k, f, u, FLOOR + fl * STOREY + 0.6, 1.05, 1.75, { shutters, cross: !shutters });
      // Small balcony under some tall windows.
      if (fl === 1 && (i + floors) % 2 === 0 && r() < 0.6) {
        const y = FLOOR + fl * STOREY + 0.55;
        k.add(box(u - 0.75, u + 0.75, y - 0.1, y, 0, 0.6).applyMatrix4(f), 'rough', 0xcfcbc2);
        for (let x = u - 0.7; x <= u + 0.72; x += 0.14) k.add(box(x, x + 0.03, y, y + 0.9, 0.55, 0.58).applyMatrix4(f), 'metal', 0x2b2c30);
        k.add(box(u - 0.75, u + 0.75, y + 0.9, y + 0.95, 0.53, 0.6).applyMatrix4(f), 'metal', 0x2b2c30);
      }
    });
  }
  fenestrate(k, d, w, floors, { sides: [2], shutters, spacing: 2.4 });
  fenestrate(k, d, w, floors, { sides: [1, 3], shutters, spacing: 3.4, width: 0.95 });
  let rise: number;
  if (r() < 0.5) rise = gableRoof(k, d, w, h, 0.62 + r() * 0.14, { eave: 0.35, verge: 0.12 });
  else {
    flatRoof(k, d, w, h, 0.7);
    rise = 0.8;
  }
  corners(k, d, w, FLOOR, h, 0xe6e1d6);
  return finish(k, d + 1, w + 0.4, h + rise, -us[0]);
}

function farmhouse(r: () => number): Building {
  const k = new Kit();
  const w = 11 + r() * 3;
  const d = 8.5 + r() * 1.5;
  const h = FLOOR + 2 * STOREY + 0.2;
  body(k, d, w, h);
  const rise = gableRoof(k, d, w, h, 0.6 + r() * 0.12, { eave: 0.8, verge: 0.6 });
  const n = Math.max(3, Math.floor((w - 0.8) / 2.6));
  const doorBay = 1;
  fenestrate(k, d, w, 2, { shutters: true, doorBay });
  frontDoor(k, face(0, d, w), bays(w, n)[doorBay], 1.15, 2.2, false);
  // Long wooden balcony along the upper floor, alpine style.
  const y = FLOOR + STOREY;
  k.add(box(d / 2, d / 2 + 1.2, y - 0.14, y + 0.04, -w / 2 + 0.2, w / 2 - 0.2), 'rough', WOOD);
  for (let z = -w / 2 + 0.25; z <= w / 2 - 0.25; z += 0.18) k.add(box(d / 2 + 1.1, d / 2 + 1.16, y + 0.04, y + 0.98, z, z + 0.1), 'rough', 0x6a4529);
  k.add(box(d / 2 + 1.06, d / 2 + 1.2, y + 0.98, y + 1.05, -w / 2 + 0.2, w / 2 - 0.2), 'rough', WOOD);
  for (const z of [-w / 2 + 0.3, w / 2 - 0.3]) k.add(box(d / 2 + 1.0, d / 2 + 1.14, FLOOR, y, z - 0.07, z + 0.07), 'rough', 0x6a4529);
  // Window boxes with flowers under the balcony windows.
  for (const u of bays(w, Math.max(3, Math.floor((w - 0.8) / 2.6)))) {
    const z = -u;
    k.add(box(d / 2 + 0.02, d / 2 + 0.3, FLOOR + 0.6, FLOOR + 0.82, z - 0.6, z + 0.6), 'rough', WOOD);
    k.add(box(d / 2 + 0.05, d / 2 + 0.33, FLOOR + 0.82, FLOOR + 1.0, z - 0.58, z + 0.58), 'foliage', 0xc8302f);
  }
  chimney(k, -d * 0.15, -w * 0.28, h + rise * 0.4, h + rise + 0.5);
  return finish(k, d + 2.4, w + 1.2, h + rise, -bays(w, n)[doorBay]);
}

function adobe(r: () => number): Building {
  const k = new Kit();
  const w = 7.5 + r() * 3;
  const d = 6.5 + r() * 2;
  const floors = r() < 0.35 ? 2 : 1;
  const h = FLOOR + floors * STOREY + 0.2;
  k.wall(box(-d / 2, d / 2, -2.6, h, -w / 2, w / 2));
  flatRoof(k, d, w, h, 0.45, 0xd9c4a0);
  // Roof beams poking out under the parapet.
  for (const z of bays(w, Math.round(w / 0.9))) k.add(box(d / 2 - 0.2, d / 2 + 0.35, h - 0.35, h - 0.18, z - 0.09, z + 0.09), 'rough', 0x6b4a30);
  fenestrate(k, d, w, floors, { width: 0.8, height: 1.0, frame: 0x6b4a30, sill: false, spacing: 2.6, doorBay: 0 });
  const us = bays(w, Math.max(1, Math.floor((w - 0.8) / 2.6)));
  frontDoor(k, face(0, d, w), us[0], 1.0, 2.0, false);
  return finish(k, d + 0.8, w, h + 0.5, -us[0]);
}

function villa(r: () => number): Building {
  const k = new Kit();
  const w = 13 + r() * 2.6;
  const d = 9.2 + r() * 1.4;
  const h = FLOOR + 2 * STOREY + 0.25;
  body(k, d, w, h);
  const rise = hipRoof(k, d, w, h, 0.46 + r() * 0.08, 0.42);
  // Centre gable over the door, sitting on the same eaves so the roof stays on the house.
  const gw = 4.4;
  const gd = 2.2;
  k.wall(box(d / 2 - 0.05, d / 2 + gd, -1.6, h, -gw / 2, gw / 2));
  const bayRise = gableRoof(k, gd, gw, h, 0.72, { alongX: true, eave: 0.28, verge: 0.22, x: d / 2 + gd / 2 });
  const n = Math.max(3, Math.floor((w - 0.8) / 2.7));
  const doorBay = Math.floor(n / 2);
  fenestrate(k, d, w, 2, { shutters: r() < 0.5, doorBay, roller: r() < 0.35 });
  const f = face(0, d, w);
  frontDoor(k, f, 0, 1.2, 2.3, true);
  win(k, f, 0, h + bayRise * 0.18, 1.0, 1.05, { shutters: true });
  corners(k, d, w, FLOOR, h, 0xe9e5dc);
  chimney(k, -d * 0.2, w * 0.22, h + rise * 0.35, h + rise + 0.45);
  return finish(k, d + gd + 0.8, w + 1, h + Math.max(rise, bayRise), 0, d / 2 + gd);
}

function duplex(r: () => number): Building {
  const k = new Kit();
  const half = 6.4 + r() * 1.2;
  const w = half * 2;
  const d = 7.4 + r() * 1.2;
  const h = FLOOR + 2 * STOREY + 0.2;
  body(k, d, w, h);
  const rise = gableRoof(k, d, w, h, 0.62 + r() * 0.1, { eave: 0.4, verge: 0.28 });
  k.wall(box(-0.08, 0.08, FLOOR, h, -w / 2, w / 2), 0.9);
  const shutters = r() < 0.55;
  for (const unit of [-1, 1]) {
    const f = face(0, d, w);
    const u = unit * half * 0.5;
    frontDoor(k, f, u - 1.15, 1.0, 2.1, true);
    win(k, f, u + 1.05, FLOOR + 0.9, 1.15, 1.35, { shutters });
    win(k, f, u - 1.15, FLOOR + STOREY + 0.7, 1.1, 1.45, { shutters });
    win(k, f, u + 1.05, FLOOR + STOREY + 0.7, 1.1, 1.45, { shutters });
  }
  fenestrate(k, d, w, 2, { sides: [2], shutters, spacing: 2.4 });
  chimney(k, -d * 0.16, 0, h + rise * 0.4, h + rise + 0.4);
  return finish(k, d + 1, w + 0.7, h + rise, -half * 0.5);
}

// ------------------------------------------------------------------------------------------ blocks

function apartment(r: () => number): Building {
  const k = new Kit();
  const w = 22 + r() * 9;
  const d = 11 + r() * 2;
  const floors = 4 + Math.floor(r() * 3);
  const h = FLOOR + 0.3 + floors * STOREY;
  body(k, d, w, h, 0x7d7a74);
  const bay = 3.0;
  const n = Math.floor(w / bay);
  const us = bays(w, n);
  const entry = Math.floor(n / 2);
  const f = face(0, d, w);
  const balconies = r() < 0.75;
  const roller = r() < 0.5;
  for (let fl = 1; fl <= floors; fl++) {
    const y = FLOOR + 0.3 + fl * STOREY;
    k.wall(box(-d / 2 - 0.04, d / 2 + 0.04, y - 0.12, y + 0.06, -w / 2 - 0.04, w / 2 + 0.04), 0.86);
  }
  for (let fl = 0; fl < floors; fl++) {
    const y = FLOOR + 0.3 + fl * STOREY;
    us.forEach((u, i) => {
      if (i === entry) {
        // Stairwell: narrow windows half a floor up.
        if (fl > 0) win(k, f, u, y - 0.6, 0.7, 1.2, { sill: false, frame: 0xdcdcdc });
        return;
      }
      const balcony = balconies && fl > 0 && i % 2 === 1;
      if (balcony) {
        win(k, f, u - 0.45, y + 0.05, 0.85, 2.15, { sill: false, roller });
        win(k, f, u + 0.6, y + 0.85, 0.85, 1.3, { roller });
        k.add(box(u - 1.3, u + 1.3, y - 0.18, y, 0, 1.35).applyMatrix4(f), 'rough', 0xc9c6bf);
        k.accent(box(u - 1.3, u + 1.3, y, y + 1.0, 1.28, 1.35).applyMatrix4(f), 'matte');
        for (const s of [-1, 1]) k.accent(box(u + s * 1.3 - 0.035, u + s * 1.3 + 0.035, y, y + 1.0, 0, 1.35).applyMatrix4(f), 'matte');
      } else {
        win(k, f, u, y + 0.85, 1.25, 1.35, { roller });
      }
    });
  }
  // Entrance with a canopy.
  const eu = us[entry];
  k.add(box(eu - 0.9, eu + 0.9, FLOOR, FLOOR + 2.4, -0.02, 0.03).applyMatrix4(f), 'glass', GLASS_LIT);
  k.add(box(eu - 0.95, eu + 0.95, FLOOR + 2.4, FLOOR + 2.5, -0.02, 0.06).applyMatrix4(f), 'metal', METAL);
  k.add(box(eu - 1.6, eu + 1.6, FLOOR + 2.7, FLOOR + 2.85, 0, 1.6).applyMatrix4(f), 'rough', 0x6c6e72);
  k.add(box(eu - 1.4, eu + 1.4, -0.6, FLOOR, 0, 1.4).applyMatrix4(f), 'rough', STEP);
  fenestrate(k, d, w, floors, { sides: [2], roller, spacing: 3 });
  fenestrate(k, d, w, floors, { sides: [1, 3], roller, spacing: 3.6 });
  let rise = 0.8;
  if (r() < 0.4) rise = hipRoof(k, d, w, h, 0.32, 0.4);
  else {
    flatRoof(k, d, w, h, 0.8);
    k.add(box(-1.5, 1.5, h, h + 2.4, -eu - 1.4, -eu + 1.4), 'matte', 0xd6d3cc);
  }
  return finish(k, d + (balconies ? 2.8 : 1), w + 1, h + rise, -eu);
}

function tower(r: () => number): Building {
  const k = new Kit();
  const w = 16 + r() * 5;
  const d = 15 + r() * 4;
  const floors = 9 + Math.floor(r() * 6);
  const fh = 3.15;
  const h = FLOOR + 1.2 + floors * fh;
  body(k, d, w, h, 0x6e6c68);
  const mull = r() < 0.5 ? 0x2c2e33 : 0xb8bcc2;
  for (const side of [0, 1, 2, 3] as Side[]) {
    const len = faceLen(side, d, w);
    const f = face(side, d, w);
    const u0 = -len / 2 + 0.9;
    const u1 = len / 2 - 0.9;
    // Lobby glazing.
    k.add(box(u0, u1, FLOOR, FLOOR + 3.6, -0.02, 0.03).applyMatrix4(f), 'glass', GLASS_LIT);
    for (let fl = 0; fl < floors; fl++) {
      const y = FLOOR + 1.2 + fl * fh;
      k.add(box(u0, u1, y + 0.75, y + fh - 0.25, -0.02, 0.03).applyMatrix4(f), 'glass', GLASS);
      k.wall(box(u0 - 0.02, u1 + 0.02, y + fh - 0.25, y + fh + 0.75, -0.02, 0.06).applyMatrix4(f), 0.95);
    }
    const panes = Math.round((u1 - u0) / 1.55);
    for (let i = 0; i <= panes; i++) {
      const u = u0 + ((u1 - u0) * i) / panes;
      k.add(box(u - 0.05, u + 0.05, FLOOR, h - 0.3, -0.02, 0.12).applyMatrix4(f), 'metal', mull);
    }
  }
  flatRoof(k, d, w, h, 1.0);
  k.add(box(-3, 3, h, h + 3.4, -4, 4), 'matte', 0xd0cdc6);
  for (const [x, z] of [[-d / 2 + 2.5, w / 2 - 3], [d / 2 - 3, -w / 2 + 2.5], [2.5, w / 2 - 2.2]]) k.add(box(x - 0.9, x + 0.9, h, h + 1.3, z - 0.7, z + 0.7), 'metal', 0x9a9ea4);
  k.add(new THREE.CylinderGeometry(0.06, 0.08, 6, 6).translate(1.5, h + 3.4 + 3, 2), 'metal', 0xa0a4aa);
  k.add(box(d / 2, d / 2 + 1.8, FLOOR + 3.6, FLOOR + 3.85, -w / 4, w / 4), 'rough', 0x606266);
  return finish(k, d + 1, w + 1, h + 3.4, 0);
}

// ------------------------------------------------------------------------------------------ outbuildings

function garage(r: () => number, double: boolean): Building {
  const k = new Kit();
  const w = double ? 6.2 : 3.5;
  const d = 6.2;
  const h = 2.75;
  k.wall(box(-d / 2, d / 2, -1.6, h, -w / 2, w / 2));
  const f = face(0, d, w);
  const doors = double ? [-1.5, 1.5] : [0];
  for (const u of doors) {
    k.add(box(u - 1.25, u + 1.25, 0.02, 2.15, -0.02, 0.03).applyMatrix4(f), 'matte', 0xe3e1dc);
    for (let i = 1; i < 5; i++) k.add(box(u - 1.25, u + 1.25, (2.13 * i) / 5 - 0.012, (2.13 * i) / 5 + 0.012, 0.02, 0.04).applyMatrix4(f), 'matte', 0xb8b6b0);
    k.add(box(u - 1.33, u + 1.33, 2.15, 2.23, -0.02, 0.05).applyMatrix4(f), 'matte', FRAME);
  }
  win(k, face(1, d, w), -1, 1.1, 0.8, 0.7, { sill: false });
  let rise = 0.3;
  if (r() < 0.5) {
    k.add(box(-d / 2 - 0.2, d / 2 + 0.3, h, h + 0.22, -w / 2 - 0.2, w / 2 + 0.2), 'rough', 0x5c5e62);
  } else rise = gableRoof(k, d, w, h, 0.5, { eave: 0.3, verge: 0.25, tiles: true });
  // Concrete apron in front.
  k.add(box(d / 2, d / 2 + 1.2, -0.3, 0.06, -w / 2, w / 2), 'rough', 0xa9a59d);
  return finish(k, d + 1.4, w + 0.5, h + rise, 0);
}

function barn(r: () => number): Building {
  const k = new Kit();
  const w = 14 + r() * 6;
  const d = 9 + r() * 3;
  const h = 4.4 + r() * 1.2;
  k.wall(box(-d / 2, d / 2, -2, h, -w / 2, w / 2));
  k.add(box(-d / 2 - 0.05, d / 2 + 0.05, -2.4, 0.6, -w / 2 - 0.05, w / 2 + 0.05), 'rough', STONE);
  // Vertical boards.
  for (const side of [0, 1, 2, 3] as Side[]) {
    const len = faceLen(side, d, w);
    const f = face(side, d, w);
    for (let u = -len / 2 + 0.3; u < len / 2 - 0.2; u += 0.55) k.wall(box(u - 0.04, u + 0.04, 0.6, h, 0, 0.035).applyMatrix4(f), 0.8);
  }
  const rise = gableRoof(k, d, w, h, 0.62 + r() * 0.1, { eave: 0.6, verge: 0.4 });
  // Big doors with X bracing.
  const f = face(0, d, w);
  const dw = 3.8;
  k.accent(box(-dw / 2, dw / 2, 0, 3.6, 0, 0.07).applyMatrix4(f), 'rough');
  for (const s of [-1, 1]) {
    const g = box(-0.08, 0.08, -2.2, 2.2, 0.07, 0.11).rotateZ(s * 0.85).translate(0, 1.8, 0);
    k.add(g.applyMatrix4(f), 'rough', 0xf0ece4);
  }
  k.add(box(-dw / 2 - 0.12, dw / 2 + 0.12, 3.6, 3.75, 0, 0.12).applyMatrix4(f), 'rough', 0xf0ece4);
  win(k, face(1, d, w), 0, h + rise * 0.2, 1.4, 1.2, { sill: false, frame: 0xf0ece4 });
  for (const side of [0, 2] as Side[]) {
    for (const u of bays(w, 4)) if (side === 2 || Math.abs(u) > 2.6) win(k, face(side, d, w), u, 2.0, 0.9, 0.6, { sill: false, frame: 0xf0ece4 });
  }
  return finish(k, d + 1.2, w + 0.8, h + rise, 0);
}

function silo(r: () => number): Building {
  const k = new Kit();
  const rad = 2.6 + r() * 0.8;
  const h = 11 + r() * 4;
  k.add(new THREE.CylinderGeometry(rad, rad, h + 1.5, 28, 1, true).translate(0, h / 2 - 0.75, 0), 'metal', 0xc4c8cc, undefined, 0.3);
  for (let y = 1.2; y < h; y += 1.6) k.add(new THREE.CylinderGeometry(rad + 0.04, rad + 0.04, 0.08, 28, 1, true).translate(0, y, 0), 'metal', 0x9ea2a8, undefined, 0.3);
  k.add(new THREE.SphereGeometry(rad, 28, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.45, 1).translate(0, h, 0), 'metal', 0xb4b8bd, undefined, 0.5);
  k.add(box(rad - 0.05, rad + 0.35, 0.3, h + 0.6, -0.25, 0.25), 'metal', 0x6d7076);
  return finish(k, rad * 2 + 0.6, rad * 2, h + rad * 0.45, 0);
}

// ------------------------------------------------------------------------------------------ church

function archWindow(k: Kit, f: THREE.Matrix4, u: number, y: number, w: number, h: number, glass = 0x334a5e): void {
  const put = (g: Geo, mat: MatKind, c: number) => k.add(g.applyMatrix4(f), mat, c);
  put(box(u - w / 2, u + w / 2, y, y + h, -0.03, 0.02), 'glass', glass);
  put(new THREE.CylinderGeometry(w / 2, w / 2, 0.05, 14, 1, false, Math.PI / 2, Math.PI).rotateX(Math.PI / 2).translate(u, y + h, -0.005), 'glass', glass);
  const s = w / 2 + 0.14;
  put(box(u - s, u - w / 2, y - 0.12, y + h, -0.03, 0.08), 'rough', 0xd9d4c8);
  put(box(u + w / 2, u + s, y - 0.12, y + h, -0.03, 0.08), 'rough', 0xd9d4c8);
  put(box(u - s, u + s, y - 0.18, y - 0.06, -0.03, 0.16), 'rough', 0xd9d4c8);
  put(new THREE.CylinderGeometry(s, s, 0.1, 14, 1, false, Math.PI / 2, Math.PI).rotateX(Math.PI / 2).translate(u, y + h, 0.03), 'rough', 0xd9d4c8);
}

function church(r: () => number): Building {
  const k = new Kit();
  const w = 9.5 + r() * 1.5;
  const d = 19 + r() * 4;
  const h = 7.6 + r() * 1.2;
  body(k, d, w, h, 0x9a958c);
  const rise = gableRoof(k, d, w, h, 0.92, { alongX: true, eave: 0.45, verge: 0.35 });
  // Buttresses and tall arched windows along the nave.
  for (const side of [1, 3] as Side[]) {
    const f = face(side, d, w);
    const n = Math.round(d / 4.2);
    const us = bays(d, n);
    us.forEach((u) => archWindow(k, f, u, 2.4, 1.15, 3.4));
    for (let i = 0; i <= n; i++) {
      const u = -d / 2 + (d * i) / n;
      k.wall(box(u - 0.35, u + 0.35, -0.5, h - 1.2, 0, 0.55).applyMatrix4(f), 0.93);
      k.add(box(u - 0.38, u + 0.38, h - 1.2, h - 0.95, 0, 0.6).applyMatrix4(f), 'rough', 0xcfc9bc);
    }
  }
  // Apse behind the altar.
  const ar = w / 2 - 0.6;
  k.wall(new THREE.CylinderGeometry(ar, ar, h - 1 + 2.6, 18, 1, false, Math.PI, Math.PI).translate(-d / 2, (h - 1 - 2.6) / 2, 0));
  k.roof(new THREE.ConeGeometry(ar + 0.35, 2.6, 18, 1, false, Math.PI, Math.PI).translate(-d / 2, h - 1 + 1.3, 0));
  // Bell tower in front of the nave.
  const tw = 4.4;
  const tx = d / 2 + tw / 2 - 0.4;
  const th = h + rise + 6.5 + r() * 3;
  k.wall(box(tx - tw / 2, tx + tw / 2, -2.6, th, -tw / 2, tw / 2), 0.97);
  k.add(box(tx - tw / 2 - 0.08, tx + tw / 2 + 0.08, -2.6, 0.8, -tw / 2 - 0.08, tw / 2 + 0.08), 'rough', STONE);
  for (const y of [h, th - 4.4, th]) k.add(box(tx - tw / 2 - 0.12, tx + tw / 2 + 0.12, y - 0.1, y + 0.18, -tw / 2 - 0.12, tw / 2 + 0.12), 'rough', 0xd8d2c4);
  for (const side of [0, 1, 2, 3] as Side[]) {
    const f = face(side, tw, tw).premultiply(new THREE.Matrix4().makeTranslation(tx, 0, 0));
    // Belfry openings, clock and a slit window.
    archWindow(k, f, 0, th - 3.6, 1.3, 1.9, 0x121417);
    const clockY = th - 5.6;
    k.add(new THREE.CylinderGeometry(0.85, 0.85, 0.08, 24).rotateX(Math.PI / 2).translate(0, clockY, 0.05).applyMatrix4(f), 'matte', 0xf4f1ea);
    k.add(new THREE.TorusGeometry(0.85, 0.06, 6, 24).translate(0, clockY, 0.1).applyMatrix4(f), 'gloss', 0x2a2a2a);
    const hand = (len: number, a: number) => box(-0.03, 0.03, 0, len, 0.1, 0.13).rotateZ(a).translate(0, clockY, 0).applyMatrix4(f);
    k.add(hand(0.62, -0.5 - side), 'gloss', 0x1d1d1d);
    k.add(hand(0.45, 2.1 + side * 0.7), 'gloss', 0x1d1d1d);
    if (side !== 2) archWindow(k, f, 0, h * 0.55, 0.45, 1.5);
  }
  // Spire and cross.
  const sh = 7 + r() * 3;
  k.roof(new THREE.ConeGeometry(tw / 2 + 0.45, sh, 8).rotateY(Math.PI / 8).translate(tx, th + 0.18 + sh / 2, 0), 0.95);
  k.add(box(tx - 0.04, tx + 0.04, th + sh, th + sh + 1.3, -0.04, 0.04), 'metal', 0x8c7a4a);
  k.add(box(tx - 0.04, tx + 0.04, th + sh + 0.75, th + sh + 0.85, -0.4, 0.4), 'metal', 0x8c7a4a);
  // Arched portal.
  const pf = face(0, tw, tw).premultiply(new THREE.Matrix4().makeTranslation(tx, 0, 0));
  k.add(box(-1.15, 1.15, FLOOR, FLOOR + 2.6, -0.03, 0.06).applyMatrix4(pf), 'rough', 0xd9d4c8);
  k.add(new THREE.CylinderGeometry(1.15, 1.15, 0.09, 16, 1, false, Math.PI / 2, Math.PI).rotateX(Math.PI / 2).translate(0, FLOOR + 2.6, 0.015).applyMatrix4(pf), 'rough', 0xd9d4c8);
  k.accent(box(-0.9, 0.9, FLOOR, FLOOR + 2.6, 0, 0.1).applyMatrix4(pf), 'rough');
  k.accent(new THREE.CylinderGeometry(0.9, 0.9, 0.1, 16, 1, false, Math.PI / 2, Math.PI).rotateX(Math.PI / 2).translate(0, FLOOR + 2.6, 0.05).applyMatrix4(pf), 'rough');
  k.add(box(-0.02, 0.02, FLOOR, FLOOR + 3.45, 0.1, 0.12).applyMatrix4(pf), 'rough', 0x3a2618);
  k.add(box(-1.6, 1.6, -0.8, FLOOR, 0, 1.6).applyMatrix4(pf), 'rough', STEP);
  k.add(box(-1.6, 1.6, -0.8, FLOOR * 0.5, 0, 2.1).applyMatrix4(pf), 'rough', STEP);
  // Round window in the front gable either side of the tower would be hidden; put one in the back gable.
  k.add(new THREE.CylinderGeometry(0.9, 0.9, 0.06, 20).rotateZ(Math.PI / 2).translate(-d / 2 - 0.02, h + rise * 0.35, 0), 'glass', 0x3a4f66);
  k.add(new THREE.TorusGeometry(0.95, 0.1, 6, 20).rotateY(Math.PI / 2).translate(-d / 2 - 0.05, h + rise * 0.35, 0), 'rough', 0xd9d4c8);
  return finish(k, d + tw + ar, w + 1.6, th + sh + 1.3, 0, d / 2 + tw - 0.4 + 2.1, d / 2 + ar + 0.4);
}

// ------------------------------------------------------------------------------------------ catalogue

const BUILDERS: Record<BuildingKind, (r: () => number) => Building> = {
  cottage,
  house,
  gablefront,
  modern,
  townhouse: (r) => townhouse(r, false),
  shop: (r) => townhouse(r, true),
  apartment,
  tower,
  garage: (r) => garage(r, false),
  garage2: (r) => garage(r, true),
  barn,
  farmhouse,
  silo,
  adobe,
  church,
  villa,
  duplex,
};

const cache = new Map<string, Building>();

/** A building of the given kind. Variants differ in size, roof and details; each is built once. */
export function building(kind: BuildingKind, variant: number): Building {
  const key = `${kind}:${variant}`;
  let b = cache.get(key);
  if (!b) {
    b = BUILDERS[kind](mulberry32(variant * 7919 + kind.length * 104729 + kind.charCodeAt(0)));
    cache.set(key, b);
  }
  return b;
}

/** Wall, roof and accent colours that suit each landscape. */
export interface BuildingPalette {
  walls: number[];
  roofs: number[];
  accents: number[];
  /** Pitched roofs are rare here; flat-roofed houses instead. */
  flat?: boolean;
}

export const PALETTES: Record<'alpine' | 'mediterranean' | 'moor' | 'desert' | 'limestone', BuildingPalette> = {
  alpine: {
    walls: [0xf3eee2, 0xece2cc, 0xf6f1e6, 0xe4d6bb, 0xdcd3c2, 0xf0e4c8, 0xe8d0b0],
    roofs: [0x5b4a40, 0x6a3f30, 0x4f4f53, 0x7a4632, 0x3f3e42, 0x8a4a33],
    accents: [0x5e3b26, 0x2f5a3a, 0x7a2e2a, 0x34485e, 0x6b4a2f],
  },
  mediterranean: {
    walls: [0xf2e3c6, 0xe9c99b, 0xf4ead8, 0xe6b98a, 0xf0d9b5, 0xd9a77a, 0xf7efe3, 0xe8d3a8],
    roofs: [0xb35a36, 0xa84e30, 0xc0663d, 0x9c4a2e, 0xb8613a],
    accents: [0x2f6b4f, 0x3a6d8c, 0x7e8f4a, 0x8a3b2e, 0x4c7a8a],
  },
  limestone: {
    walls: [0xeadfc8, 0xe2d2b2, 0xf1e8d6, 0xd8c7a6, 0xe7d9bc],
    roofs: [0xa9583a, 0x9d5034, 0xb46440],
    accents: [0x3e6b52, 0x4a6f86, 0x6d5a3c],
  },
  moor: {
    walls: [0xeeeeea, 0xd9d8d2, 0xc9c6bd, 0xb3afa6, 0xe4e1d8],
    roofs: [0x3f4247, 0x46494e, 0x383a3e, 0x52504c],
    accents: [0x2c3e50, 0x6b2d2d, 0x2f4f3a, 0x5a4a3a],
  },
  desert: {
    walls: [0xd9b48a, 0xcfa577, 0xe2c299, 0xc79a6c, 0xe6cfa9],
    roofs: [0xb07a4f, 0x9c6b45],
    accents: [0x3d6e8a, 0x6b4a30, 0x2f6b5a],
    flat: true,
  },
};
