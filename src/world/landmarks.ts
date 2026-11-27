import * as THREE from 'three';
import type { Route } from '../routes/route';
import LANDMARKS from '../routes/real/landmarks.json';
import type { Prepared } from './batch';
import { propAsset } from './propAssets';
import type { Site } from './site';
import { ROAD_HALF_WIDTH, type TerrainField } from './terrainField';

/**
 * Mapped landmarks on the real roads: the Russian Chapel on Vršič, mountain huts and
 * refuges next to the road, wayside shrines and crosses at the verge. Positions come
 * from OpenStreetMap (scripts/real-track/landmarks.mjs → src/routes/real/landmarks.json,
 * already in each road's local metres); the models are Blender GLBs
 * (scripts/blender/landmarks.py) loaded with the other prop models. Worlds built
 * without the prop models (home page, route previews) simply have no landmarks.
 */

export type LandmarkKind = 'chapel' | 'hut' | 'shrine';

export interface MappedLandmark {
  kind: LandmarkKind;
  name: string;
  /** OpenStreetMap element, `node/<id>` or `way/<id>`: the source of the position. */
  osm: string;
  /** A wayside cross rather than a shrine pillar. */
  cross?: boolean;
  lat: number;
  lon: number;
  /** Centre in the road's local metres (x east, z south). */
  x: number;
  z: number;
  /** Distance to the road centre line when the list was built, metres. */
  road: number;
  /** Mapped outline (ways only): long side, short side, long-axis angle from +x toward +z. */
  length?: number;
  width?: number;
  angle?: number;
}

const DATA = LANDMARKS as unknown as Record<string, MappedLandmark[] | string>;

/** The mapped landmarks of one real road (by track id), or none. */
export function landmarksFor(trackId: string | undefined): MappedLandmark[] {
  const list = trackId ? DATA[trackId] : undefined;
  return Array.isArray(list) ? list : [];
}

/**
 * Model sizes at scale 1 (three.js frame: x along the long axis, z across, +y up).
 * `wall` is the main block the OSM outline is matched to; `foot` is everything the
 * model covers (eaves, balcony, terrace, lean-to) for clearance and occupancy.
 */
export const LANDMARK_MODELS = {
  ruska_kapelica: { wall: [8.0, 5.2], foot: [9.6, 6.4], h: 13.6 },
  mountain_hut_a: { wall: [10, 7.4], foot: [11.8, 9.8], h: 10.5 },
  mountain_hut_b: { wall: [14, 10], foot: [20.8, 14.8], h: 13.3 },
  wayside_shrine: { wall: [1.3, 1.3], foot: [2.0, 2.0], h: 4.2 },
  wayside_cross: { wall: [0.9, 0.9], foot: [1.7, 1.0], h: 4.2 },
} as const;
export type LandmarkModel = keyof typeof LANDMARK_MODELS;

/** Outlines bigger than this (m²) get the big refuge, smaller ones the small hut. */
const BIG_HUT = 180;

export function landmarkModel(l: MappedLandmark): LandmarkModel {
  if (l.kind === 'chapel') return 'ruska_kapelica';
  if (l.kind === 'shrine') return l.cross ? 'wayside_cross' : 'wayside_shrine';
  return (l.length ?? 0) * (l.width ?? 0) >= BIG_HUT ? 'mountain_hut_b' : 'mountain_hut_a';
}

/** Closest a building's footprint may come to the road centre line: past the verge and pavement. */
export const BUILDING_CLEAR = ROAD_HALF_WIDTH + 2.4;
/** Closest a shrine or cross may come: just past the verge, where they stand on real roads. */
export const WAYSIDE_CLEAR = ROAD_HALF_WIDTH + 1.5;
/** How far a landmark may be moved off its mapped point to clear the road, metres. */
export const MAX_SHIFT = { chapel: 12, hut: 20, shrine: 5 } as const;

export interface LandmarkSpot {
  landmark: MappedLandmark;
  model: LandmarkModel;
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** Scale along the model's x (length), y (height), z (width). */
  sx: number;
  sy: number;
  sz: number;
  /** Footprint after scaling: d along the model's x, w along its z. */
  d: number;
  w: number;
  h: number;
  /** Metres moved off the mapped point to clear the road. */
  shift: number;
  /** Ground under the footprint before any terrace is cut: lowest and highest. */
  lo: number;
  hi: number;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** Corners, edge midpoints and centre of a d × w box (d along the yawed x axis), like Site.points. */
export function footprintPoints(x: number, z: number, yaw: number, d: number, w: number): [number, number][] {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const out: [number, number][] = [];
  for (const a of [-0.5, 0, 0.5]) for (const b of [-0.5, 0, 0.5]) out.push([x + c * a * d + s * b * w, z - s * a * d + c * b * w]);
  return out;
}

/**
 * Where each landmark of this road goes: its mapped point, turned like its OSM outline
 * (front or door toward the road), scaled to the outline within limits, and moved
 * straight away from the road only if its footprint would touch the verge. Pure: reads
 * the field, changes nothing. Landmarks that cannot be cleared are left out.
 */
export function planLandmarks(route: Route, field: TerrainField): LandmarkSpot[] {
  const out: LandmarkSpot[] = [];
  for (const l of landmarksFor(route.def.track ? route.def.id : undefined)) {
    const model = landmarkModel(l);
    const dims = LANDMARK_MODELS[model];
    // Huts are matched to the mapped outline (Tičarjev dom is 20 m square, Refuge les
    // Thymelets 7 m), within limits so the roof pitch and windows still read. The
    // chapel and wayside pieces keep their modelled size.
    let sx = 1;
    let sz = 1;
    if (l.kind === 'hut' && l.length && l.width) {
      sx = clamp(l.length / dims.wall[0], 0.75, 1.5);
      sz = clamp(l.width / dims.wall[1], 0.75, 1.5);
    }
    const sy = l.kind === 'hut' ? clamp(Math.sqrt(sx * sz), 0.9, 1.25) : 1;
    const d = dims.foot[0] * sx;
    const w = dims.foot[1] * sz;
    const clear = l.kind === 'shrine' ? WAYSIDE_CLEAR : BUILDING_CLEAR;

    const i = nearestIndex(route, l.x, l.z);
    // Away from the road: from the nearest road point to the mapped point. A point
    // on the centre line itself falls back to the road's right-hand normal.
    let ax = l.x - route.x[i];
    let az = l.z - route.z[i];
    const len = Math.hypot(ax, az);
    if (len < 0.5) {
      ax = -route.tz[i];
      az = route.tx[i];
    } else {
      ax /= len;
      az /= len;
    }
    // Facing. A model's +z (hut front, shrine niche) is (sin yaw, cos yaw) in the world,
    // its +x (chapel door) is (cos yaw, -sin yaw). With an outline the long axis is
    // fixed by the map and only the end/side toward the road is chosen; a point faces
    // the road straight.
    let yaw: number;
    if (l.angle !== undefined) {
      const a = -l.angle;
      const score = (y: number) => (l.kind === 'chapel' ? -(Math.cos(y) * ax - Math.sin(y) * az) : -(Math.sin(y) * ax + Math.cos(y) * az));
      yaw = score(a) >= score(a + Math.PI) ? a : a + Math.PI;
    } else {
      yaw = Math.atan2(-ax, -az);
      if (l.kind === 'chapel') yaw -= Math.PI / 2;
    }

    let placed: LandmarkSpot | null = null;
    for (let shift = 0; shift <= MAX_SHIFT[l.kind]; shift += 1) {
      const x = l.x + ax * shift;
      const z = l.z + az * shift;
      let ok = true;
      let lo = Infinity;
      let hi = -Infinity;
      for (const [px, pz] of footprintPoints(x, z, yaw, d, w)) {
        if (field.roadDistance(px, pz) < clear || field.blocksProp(px, pz)) {
          ok = false;
          break;
        }
        const g = field.heightAt(px, pz);
        lo = Math.min(lo, g);
        hi = Math.max(hi, g);
      }
      if (!ok) continue;
      // Buildings sit on their lowest corner (walls run 0.6 m below the origin, so the
      // downhill side is bedded in) and a terrace is cut for the uphill side. Shrines
      // and crosses stand on the ground at their centre.
      const y = l.kind === 'shrine' ? field.heightAt(x, z) - 0.05 : lo + 0.35;
      placed = { landmark: l, model, x, y, z, yaw, sx, sy, sz, d, w, h: dims.h * sy, shift, lo, hi };
      break;
    }
    if (placed) out.push(placed);
  }
  return out;
}

/**
 * Nearest road sample by brute force. TerrainField.nearestRoad only looks a short way
 * out (it serves the ground next to the road); the huts at the top stand 160-170 m off.
 */
export function nearestIndex(route: Route, x: number, z: number): number {
  let best = Infinity;
  let at = 0;
  for (let i = 0; i < route.count; i++) {
    const dx = route.x[i] - x;
    const dz = route.z[i] - z;
    const d = dx * dx + dz * dz;
    if (d < best) {
      best = d;
      at = i;
    }
  }
  return at;
}

/** Deepest terrace cut behind a building, metres. On a steeper slope the uphill wall is bedded in instead. */
export const MAX_CUT = 4;

/** The terrace under a building: 12 floats for TerrainField pads, or null when none is needed or safe. */
export function terracePad(spot: LandmarkSpot, field: TerrainField): number[] | null {
  if (spot.landmark.kind === 'shrine' || spot.hi - spot.y < 0.3) return null;
  // The blend eases the cut back to the hillside; keep it off the asphalt and verge,
  // so a terrace below the road never lowers ground at the road edge.
  let core = Infinity;
  for (const [px, pz] of footprintPoints(spot.x, spot.z, spot.yaw, spot.d, spot.w)) core = Math.min(core, field.roadDistance(px, pz));
  const blend = Math.min(6, core - ROAD_HALF_WIDTH - 1.5);
  if (blend < 1.5) return null;
  const c = Math.cos(spot.yaw);
  const s = Math.sin(spot.yaw);
  // Axes: a along the model's x (c, -s), b along its z (s, c), as in Site.points.
  // Cut no deeper than MAX_CUT below the highest ground: a 19 m cut on a steep
  // forest slope would leave a cliff behind the hut. Past that, the uphill side of
  // the building sits in the slope.
  const cap = Math.max(spot.y - 0.05, spot.hi - MAX_CUT);
  return [c, -s, s, c, spot.x, spot.z, -spot.d / 2, spot.d / 2, -spot.w / 2, spot.w / 2, cap, blend];
}

const built = new Map<LandmarkModel, Prepared | null>();

function prepared(name: LandmarkModel): Prepared | null {
  if (!built.has(name)) {
    const g = propAsset(name);
    // Vertex-coloured, flat-shaded, no tint: one 'rough' surface (wood, stone and
    // shingles are all matte). The geometry is the shared loaded asset; StaticBatch
    // copies it, so nothing here owns or disposes it.
    built.set(name, g ? { groups: [{ mat: 'rough', geom: g }] } : null);
  }
  return built.get(name) ?? null;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

/**
 * Puts this road's mapped landmarks into the scenery: skipped where something is
 * already built (a pass restaurant, a hotel, a town house), cut into the slope with a
 * terrace pad, kept clear of trees and solid for the ride camera. Call from
 * buildScenery before the pads and clearings are copied to the terrain workers.
 */
export function placeMappedLandmarks(site: Site): number {
  if (!site.route.def.track) return 0;
  const pads: number[] = [];
  let n = 0;
  for (const spot of planLandmarks(site.route, site.field)) {
    const model = prepared(spot.model);
    if (!model) {
      built.delete(spot.model); // not loaded yet; try again for the next world
      continue;
    }
    if (!site.free(spot.x, spot.z, spot.yaw, spot.d, spot.w)) continue;
    _q.setFromAxisAngle(_up, spot.yaw);
    _p.set(spot.x, spot.y, spot.z);
    _s.set(spot.sx, spot.sy, spot.sz);
    site.props.place(model, _m.compose(_p, _q, _s));
    site.occupy(spot.x, spot.z, spot.yaw, spot.d, spot.w, spot.landmark.kind === 'shrine' ? 0.8 : 2);
    site.solid(spot.x, spot.z, spot.yaw, spot.d, spot.w, spot.y, spot.h);
    const pad = terracePad(spot, site.field);
    if (pad) pads.push(...pad);
    n++;
  }
  if (pads.length) {
    const prev = site.field.padData();
    const all = new Float32Array(prev.length + pads.length);
    all.set(prev);
    all.set(pads, prev.length);
    site.field.setPads(all);
  }
  return n;
}
