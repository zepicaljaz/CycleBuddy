import * as THREE from 'three';
import { climbHairpinFence } from '../routes/regions';
import type { Climb, Route } from '../routes/route';
import { ROUTE_DS } from '../routes/route';
import { lerp, mulberry32, smoothstep } from '../util/math';
import { buildWaterfront } from './boats';
import { buildClimbFurniture, isBigClimb, raceGraffiti, type RoadWriting } from './climbs';
import { placeLakeIsland } from './island';
import { placeAlpineHotel } from './alpineHotel';
import { placeModernHotel } from './modernHotel';
import { ventouxAntennaGroup } from './ventouxAntenna';
import { placeAlpineRestaurants } from './alpineRestaurant';
import { placeMappedLandmarks } from './landmarks';
import { buildFarms, placeMotorhomes } from './farms';
import { fencePost, fenceSpan, guardrailBeam, guardrailPost, stoneWall, woodPost, woodRails } from './fences';
import { addCrowdMotion, colored, flagPole, nationFlag } from './models';
import { buildSpectator, pickSpectator, type SpectatorKind } from './spectators';
import { Props } from './props';
import { buildSettlements, type Signal } from './settlement';
import { buildMappedPlaces } from './mappedPlaces';
import { Site, styleFor } from './site';
import { rightVector } from './road';
import { ROAD_HALF_WIDTH, type TerrainField } from './terrainField';
import { textTexture } from './textures';

function placeOnRoute(route: Route, idx: number, lateral: number) {
  const [rx, rz] = rightVector(route, idx);
  return { x: route.x[idx] + rx * lateral, z: route.z[idx] + rz * lateral };
}

export interface Junction {
  idx: number;
  side: -1 | 1;
  length: number;
}

/** Shared clock for the crowd cheer and flag wave. */
export const crowdTime = { value: 0 };

export interface Scenery {
  group: THREE.Group;
  /** Traffic light stop lines in the towns. */
  signals: Signal[];
  /** Circles (x, z, r) where trees must not grow. */
  clear: Float32Array;
  /** Paved shelves the terrain mesh must not rise through. See FieldInput.pads. */
  pads: Float32Array;
  /** Buildings and parked vehicles the camera must stay outside of. */
  solids: Float32Array;
  update(dt: number, eye: THREE.Vector3): void;
}

/**
 * Villages, side roads, fences, guardrails, kilometre signs and arches along the route.
 * A corridor keeps the fences and guardrails and skips villages, side roads and arches,
 * for a short homepage excerpt that should stay an empty valley.
 */
export function buildScenery(route: Route, field: TerrainField, towns: TownSpan[] = planTowns(route), corridor = false, writing?: RoadWriting): Scenery {
  const group = new THREE.Group();
  group.name = 'scenery';
  const props = new Props();
  const junctions = corridor ? [] : planJunctions(route, field);
  let signals: Signal[] = [];
  let solids: Scenery['solids'] = new Float32Array(0);
  let site: Site | null = null;
  if (!corridor) {
    group.add(buildJunctions(route, field, junctions));
    site = new Site(route, field, props, styleFor(route));
    for (const j of junctions) {
      const js = j.idx * ROUTE_DS;
      site.occupyStrip(js - 3.6, js + 3.6, ROAD_HALF_WIDTH, ROAD_HALF_WIDTH + j.length + 1, j.side, 0.5);
    }
    signals = buildSettlements(site, towns, junctions);
    buildFarms(site, towns, junctions);
    placeMotorhomes(site, route.climbs);
    buildWaterfront(site);
    placeLakeIsland(site);
    placeAlpineHotel(site);
    placeModernHotel(site);
    placeAlpineRestaurants(site);
    // After everything hand-placed, so a mapped hut never lands on a pass restaurant or hotel.
    placeMappedLandmarks(site);
    solids = site.boxes();
  }
  const clear = Float32Array.from(props.clear);
  field.setClearings(clear);
  const pads = field.padData();
  const furniture = corridor ? null : buildClimbFurniture(route, field, writing);
  const roadside = planRoadsideFences(route, junctions, towns);
  // A climb's stone walls already guard that side of the road: no second barrier on top.
  if (furniture) {
    for (const si of [0, 1]) for (let i = 0; i < route.count; i++) if (furniture.walls[si][i]) roadside[si][i] = 0;
  }
  const fences = buildFences(route, field, junctions, towns, roadside);
  const roadsideFences = buildRoadsideFences(route, field, junctions, towns, roadside);
  group.add(fences, roadsideFences);
  const cells = [...fenceCells(fences), ...fenceCells(roadsideFences)];
  if (furniture) {
    group.add(furniture.group);
    group.add(buildArches(route));
    group.add(buildCrowds(route));
  }
  group.add(buildMappedPlaces(route, field, site));
  const antenna = ventouxAntennaGroup(route, field);
  if (antenna) group.add(antenna);
  group.add(props.build());
  return {
    group,
    signals,
    clear,
    pads,
    solids,
    update: (dt, eye) => {
      props.update(dt, eye);
      cullFences(cells, eye);
    },
  };
}

function planJunctions(route: Route, field: TerrainField): Junction[] {
  const rng = mulberry32(route.def.seed + 17);
  const out: Junction[] = [];
  const water = route.def.scenery.waterLevel;
  const treeline = route.def.scenery.treeline;
  let s = 700;
  while (s < route.length - 500) {
    const idx = Math.min(route.count - 1, Math.floor(s / ROUTE_DS));
    const ahead = Math.min(route.count - 1, idx + 20);
    const behind = Math.max(0, idx - 20);
    const dot = route.tx[ahead] * route.tx[behind] + route.tz[ahead] * route.tz[behind];
    const gentle =
      Math.abs(route.grade[idx]) < 0.045 &&
      Math.abs(route.grade[ahead]) < 0.06 &&
      Math.abs(route.grade[behind]) < 0.06;
    const clear = route.hairpin[idx] === 0 && route.hairpin[ahead] === 0 && route.hairpin[behind] === 0;
    if (dot > 0.92 && gentle && clear && route.y[idx] < treeline - 60) {
      const sides: Array<-1 | 1> = rng() < 0.28 ? [-1, 1] : [rng() < 0.5 ? -1 : 1];
      let placed = false;
      for (const side of sides) {
        const length = 42 + rng() * 50;
        const far = placeOnRoute(route, idx, side * (ROAD_HALF_WIDTH + length));
        const yFar = field.heightAt(far.x, far.z);
        const slope = Math.abs(yFar - route.y[idx]) / length;
        const clearOfRoad = field.roadDistance(far.x, far.z) > 16;
        const dry = water === null || yFar > water + 1.5;
        if (slope < 0.14 && clearOfRoad && dry) {
          out.push({ idx, side, length });
          placed = true;
        }
      }
      s += placed ? 1900 + rng() * 2400 : 320;
    } else {
      s += 180;
    }
  }
  return out;
}

/** Height of a side road: flush with the asphalt at the join, then down onto open ground. */
function spurHeight(routeY: number, terrainY: number, d: number, length: number): number {
  const t = smoothstep(ROAD_HALF_WIDTH, ROAD_HALF_WIDTH + length, d);
  return lerp(routeY + 0.06, Math.max(terrainY + 0.4, routeY - 0.15), t);
}

function buildJunctions(route: Route, field: TerrainField, junctions: Junction[]): THREE.Group {
  const group = new THREE.Group();
  if (!junctions.length) return group;
  const pos: number[] = [];
  const col: number[] = [];
  const asphalt = new THREE.Color(0x6a6866);
  const line = new THREE.Color(0xe9e6dc);
  const pushQuad = (a: number[], b: number[], c: number[], d: number[], color: THREE.Color) => {
    const ux = b[0] - a[0];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vz = c[2] - a[2];
    const up = uz * vx - ux * vz >= 0;
    const verts = up ? [a, b, c, b, d, c] : [a, c, b, c, d, b];
    for (const v of verts) {
      pos.push(v[0], v[1], v[2]);
      col.push(color.r, color.g, color.b);
    }
  };

  const signs: { x: number; y: number; z: number; yaw: number }[] = [];
  for (const j of junctions) {
    const idx = j.idx;
    const [rx, rz] = rightVector(route, idx);
    const tx = route.tx[idx];
    const tz = route.tz[idx];
    const halfW = 2.7;
    const steps = Math.max(4, Math.ceil(j.length / 4));
    const corner = (d: number, w: number, y: number) => [
      route.x[idx] + rx * d * j.side + tx * w,
      y,
      route.z[idx] + rz * d * j.side + tz * w,
    ];
    const yAt = (d: number) => {
      const x = route.x[idx] + rx * d * j.side;
      const z = route.z[idx] + rz * d * j.side;
      return spurHeight(route.y[idx], field.heightAt(x, z), d, j.length);
    };
    for (let k = 0; k < steps; k++) {
      const d0 = ROAD_HALF_WIDTH + (j.length * k) / steps;
      const d1 = ROAD_HALF_WIDTH + (j.length * (k + 1)) / steps;
      pushQuad(corner(d0, -halfW, yAt(d0)), corner(d0, halfW, yAt(d0)), corner(d1, -halfW, yAt(d1)), corner(d1, halfW, yAt(d1)), asphalt);
    }
    const stop = ROAD_HALF_WIDTH + 1.5;
    const yStop = yAt(stop) + 0.025;
    pushQuad(
      corner(stop, -halfW + 0.35, yStop),
      corner(stop, halfW - 0.35, yStop),
      corner(stop + 0.4, -halfW + 0.35, yStop),
      corner(stop + 0.4, halfW - 0.35, yStop),
      line,
    );
    signs.push({
      x: route.x[idx] + rx * j.side * (ROAD_HALF_WIDTH + 0.7) + tx * (halfW + 0.7),
      y: route.y[idx],
      z: route.z[idx] + rz * j.side * (ROAD_HALF_WIDTH + 0.7) + tz * (halfW + 0.7),
      yaw: Math.atan2(-tx, -tz),
    });
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geom.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geom.computeVertexNormals();
  const mesh = new THREE.Mesh(
    geom,
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.95,
      metalness: 0,
      envMapIntensity: 0.4,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -2,
    }),
  );
  mesh.receiveShadow = true;
  group.add(mesh);

  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.15 });
  const posts = new THREE.InstancedMesh(colored(new THREE.CylinderGeometry(0.06, 0.06, 2.1, 5).translate(0, 1.05, 0), 0x9aa0a6), mat, signs.length);
  const boards = new THREE.InstancedMesh(colored(new THREE.BoxGeometry(0.08, 0.7, 0.85).translate(0, 1.9, 0), 0xf2f4f6), mat, signs.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  signs.forEach((sg, i) => {
    q.setFromAxisAngle(up, sg.yaw);
    m.compose(new THREE.Vector3(sg.x, sg.y, sg.z), q, new THREE.Vector3(1, 1, 1));
    posts.setMatrixAt(i, m);
    boards.setMatrixAt(i, m);
  });
  for (const im of [posts, boards]) {
    im.castShadow = true;
    im.receiveShadow = true;
    im.computeBoundingSphere();
  }
  group.add(posts, boards);
  return group;
}

function nearJunction(junctions: Junction[], idx: number, side: number, samples: number): boolean {
  for (const j of junctions) {
    if (j.side === side && Math.abs(j.idx - idx) <= samples) return true;
  }
  return false;
}

export interface TownSpan {
  s0: number;
  s1: number;
  name: string;
}

const TOWN_NAMES = ['Aldeno', 'Brenta', 'Colle Verde', 'Lago', 'Monteluce', 'Osteria', 'Rivamonte', 'San Pietro', 'Valdora', 'Ponte'];

function coversTown(towns: TownSpan[], s: number, pad = 0): boolean {
  return towns.some((t) => s >= t.s0 - pad && s <= t.s1 + pad);
}

function townSpans(route: Route, named: { section: number; along: number; length: number; name: string }[] | undefined): TownSpan[] {
  if (!named?.length) return [];
  return named.map((t) => {
    const centre = (route.sectionStart[t.section] ?? 0) + t.along;
    const half = t.length / 2;
    let s0 = centre - half;
    let s1 = centre + half;
    if (s0 < 0) {
      s1 -= s0;
      s0 = 0;
    }
    if (s1 > route.length) {
      s0 = Math.max(0, s0 - (s1 - route.length));
      s1 = route.length;
    }
    return { s0, s1, name: t.name };
  });
}

/** Two or three valley streets the road actually passes through. Named extras are added on top. */
export function planTowns(route: Route): TownSpan[] {
  const named = townSpans(route, route.def.towns);
  // A real road with no named town stays open. Generated loops still get valley towns.
  const base = named.length ? named : route.def.track ? [] : generatedTowns(route);
  const extra = townSpans(route, route.def.extraTowns).filter(
    (town) => !base.some((other) => town.s0 < other.s1 + 40 && town.s1 > other.s0 - 40),
  );
  return extra.length ? [...base, ...extra] : base;
}

function generatedTowns(route: Route): TownSpan[] {
  const water = route.def.scenery.waterLevel;
  const treeline = route.def.scenery.treeline;
  const pick = (maxGrade: number, want: number): TownSpan[] => {
    const rng = mulberry32(route.def.seed + 55 + Math.round(maxGrade * 1000));
    const towns: TownSpan[] = [];
    let s = 1600;
    while (s < route.length - 1600 && towns.length < want) {
      const idx = Math.min(route.count - 1, Math.floor(s / ROUTE_DS));
      let ok = route.y[idx] < treeline - 70 && (water === null || route.y[idx] > water + 8);
      for (let k = 0; k < 100 && ok; k += 8) {
        const i = Math.min(route.count - 1, idx + k);
        if (Math.abs(route.grade[i]) > maxGrade || route.hairpin[i]) ok = false;
      }
      if (ok) {
        const len = 160 + rng() * 100;
        towns.push({
          s0: s,
          s1: Math.min(route.length - 400, s + len),
          name: TOWN_NAMES[Math.floor(rng() * TOWN_NAMES.length)],
        });
        s += len + 6500 + rng() * 4500;
      } else {
        s += 260;
      }
    }
    return towns;
  };
  const gentle = pick(0.028, 3);
  return gentle.length >= 2 ? gentle : pick(0.048, 3);
}

/** Pasture fences set back from the verge on gentle sections. Posts about every 2 m, three rails. */
function buildFences(route: Route, field: TerrainField, junctions: Junction[], towns: TownSpan[], roadside: Uint8Array[]): THREE.Group {
  const rng = mulberry32(route.def.seed + 41);
  const posts: THREE.Matrix4[][] = [[], [], []];
  const rails: THREE.Matrix4[] = [];
  const treeline = route.def.scenery.treeline;
  const water = route.def.scenery.waterLevel;
  const step = 1;
  for (const side of [-1, 1] as const) {
    let i = 80;
    while (i < route.count - 80) {
      const run = Math.floor((70 + rng() * 150) / ROUTE_DS);
      const gap = Math.floor((22 + rng() * 50) / ROUTE_DS);
      const lateral = side * (ROAD_HALF_WIDTH + 5.2 + rng() * 2.4);
      const end = Math.min(route.count - 1, i + run);
      let prev: THREE.Vector3 | null = null;
      let sinceGate = 0;
      for (let k = i; k <= end; k += step) {
        sinceGate += step * ROUTE_DS;
        if (sinceGate > 46 && sinceGate < 64) {
          prev = null;
          continue;
        }
        if (sinceGate >= 64) sinceGate = 0;
        if (Math.abs(route.grade[k]) > 0.04 || route.hairpin[k] || route.y[k] > treeline - 40) {
          prev = null;
          continue;
        }
        const si = side > 0 ? 1 : 0;
        let taken = false;
        for (let d = -14; d <= 14; d++) {
          const j = k + d;
          if (j > 0 && j < route.count && roadside[si][j]) {
            taken = true;
            break;
          }
        }
        if (taken) {
          prev = null;
          continue;
        }
        if (nearJunction(junctions, k, side, 8) || coversTown(towns, k * ROUTE_DS, 14)) {
          prev = null;
          continue;
        }
        const p = placeOnRoute(route, k, lateral);
        if (field.onLake(p.x, p.z) || field.blocksProp(p.x, p.z) || field.cleared(p.x, p.z)) {
          prev = null;
          continue;
        }
        const dist = field.roadDistance(p.x, p.z);
        if (dist < ROAD_HALF_WIDTH + 3 || dist > 22) {
          prev = null;
          continue;
        }
        const outer = placeOnRoute(route, k, side * (Math.abs(lateral) + 6));
        if (route.y[k] - field.heightAt(outer.x, outer.z) > 1.4) {
          prev = null;
          continue;
        }
        const y = field.surfaceHeight(p.x, p.z) - 0.02;
        if (water !== null && y < water + 1) {
          prev = null;
          continue;
        }
        const [rx, rz] = rightVector(route, k);
        const toward = new THREE.Vector3(-rx * side, 0, -rz * side);
        const cur = new THREE.Vector3(p.x, y, p.z);
        const n = posts[0].length + posts[1].length + posts[2].length;
        posts[n % 3].push(fencePost(cur, toward));
        if (prev && prev.distanceTo(cur) < 4.5) {
          const along = cur.clone().sub(prev);
          rails.push(fenceSpan(prev.clone().add(cur).multiplyScalar(0.5), along, toward, along.length()));
        }
        prev = cur;
      }
      i = end + gap;
    }
  }
  const group = new THREE.Group();
  group.name = 'pasture-fence';
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.92 });
  posts.forEach((list, variant) => addInstances(group, woodPost(variant), mat, list));
  addInstances(group, woodRails(), mat, rails);
  return group;
}

/** Fence instances are split into map cells this wide, so each cell is culled on its own. */
const FENCE_CELL = 500;
/** Fence cells further than this from the camera are hidden: a fence there is under a pixel. */
const FENCE_RANGE = 1000;

export interface FenceCell {
  mesh: THREE.InstancedMesh;
  cx: number;
  cz: number;
}

/**
 * One InstancedMesh per map cell, not one for the whole loop. A single mesh spanning the
 * loop has one bounding sphere that is always in view, so every bay was drawn (and shadowed)
 * every frame. Per cell, the camera and the sun cull what is out of view, and `cullFences`
 * hides what is too far away.
 */
function addInstances(group: THREE.Group, geom: THREE.BufferGeometry, mat: THREE.Material, matrices: THREE.Matrix4[], size = FENCE_CELL): void {
  if (!matrices.length) return;
  const cells = new Map<string, THREE.Matrix4[]>();
  for (const m of matrices) {
    const key = `${Math.floor(m.elements[12] / size)},${Math.floor(m.elements[14] / size)}`;
    const list = cells.get(key);
    if (list) list.push(m);
    else cells.set(key, [m]);
  }
  for (const [key, list] of cells) {
    const [ix, iz] = key.split(',').map(Number);
    const mesh = new THREE.InstancedMesh(geom, mat, list.length);
    list.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    mesh.matrixAutoUpdate = false;
    mesh.userData.fenceCell = { cx: (ix + 0.5) * size, cz: (iz + 0.5) * size };
    group.add(mesh);
  }
}

function fenceCells(root: THREE.Object3D): FenceCell[] {
  const out: FenceCell[] = [];
  root.traverse((o) => {
    const cell = o.userData.fenceCell as { cx: number; cz: number } | undefined;
    if (cell && (o as THREE.InstancedMesh).isInstancedMesh) out.push({ mesh: o as THREE.InstancedMesh, cx: cell.cx, cz: cell.cz });
  });
  return out;
}

function cullFences(cells: FenceCell[], eye: THREE.Vector3, range = FENCE_RANGE, size = FENCE_CELL): void {
  const r = range + size * 0.71;
  const r2 = r * r;
  for (const c of cells) {
    const dx = c.cx - eye.x;
    const dz = c.cz - eye.z;
    c.mesh.visible = dx * dx + dz * dz < r2;
  }
}

function climbAt(route: Route, s: number): number {
  for (let i = 0; i < route.climbs.length; i++) {
    const c = route.climbs[i];
    const lo = Math.min(c.start, c.end);
    const hi = Math.max(c.start, c.end);
    if (s >= lo && s <= hi) return i;
  }
  return -1;
}

/** The finish chute already has its own barriers, so the verge fence stops short of the summit. */
function nearFinish(route: Route, s: number): boolean {
  for (const c of route.climbs) {
    const dir = c.end >= c.start ? 1 : -1;
    const toEnd = (c.end - s) * dir;
    if (toEnd > -22 && toEnd < 250) return true;
  }
  return false;
}

const FENCE_METAL = 1;
const FENCE_STONE = 2;

/**
 * Outside of a tight bend, +1 to the right of travel. 0 on a straight.
 * Facing +Z, right is -X, so a right turn has a positive tangent cross and
 * its outside (the side a rider would leave the road) is to the left.
 */
function hairpinOutside(route: Route): Int8Array {
  const n = route.count;
  const local = new Int8Array(n);
  const out = new Int8Array(n);
  for (let i = 2; i < n - 2; i++) {
    const a = i - 2;
    const b = i + 2;
    const dot = route.tx[a] * route.tx[b] + route.tz[a] * route.tz[b];
    if (dot >= 0.88) continue;
    const cross = route.tx[a] * route.tz[b] - route.tz[a] * route.tx[b];
    local[i] = cross >= 0 ? -1 : 1;
  }
  for (let i = 0; i < n; i++) {
    if (local[i]) {
      out[i] = local[i];
      continue;
    }
    for (let d = 1; d <= 3; d++) {
      const left = i - d >= 0 ? local[i - d] : 0;
      const right = i + d < n ? local[i + d] : 0;
      if (left) {
        out[i] = left;
        break;
      }
      if (right) {
        out[i] = right;
        break;
      }
    }
  }
  return out;
}

function dilateFence(mark: Uint8Array, force: Uint8Array, allow: (i: number) => boolean, radius: number): void {
  const srcM = mark.slice();
  const srcF = force.slice();
  for (let i = 0; i < mark.length; i++) {
    if (!srcM[i]) continue;
    const kind = srcM[i];
    for (let d = -radius; d <= radius; d++) {
      const j = i + d;
      if (j < 0 || j >= mark.length || mark[j] || !allow(j)) continue;
      mark[j] = kind;
      if (srcF[i]) force[j] = 1;
    }
  }
}

function cullShortFence(mark: Uint8Array, force: Uint8Array, minLen: number): void {
  let i = 0;
  while (i < mark.length) {
    if (!mark[i]) {
      i++;
      continue;
    }
    let j = i;
    let forced = false;
    while (j < mark.length && mark[j]) {
      if (force[j]) forced = true;
      j++;
    }
    if (!forced && j - i < minLen) {
      for (let k = i; k < j; k++) mark[k] = 0;
    }
    i = j;
  }
}

/**
 * One fence on the outside of a climb hairpin, in front of the race crowd.
 * High mountains, green hills and sprucelands get the metal rail.
 * Limestone, desert and grassland get the stone wall. The inside of the bend stays open.
 */
export function planRoadsideFences(route: Route, junctions: Junction[], towns: TownSpan[]): Uint8Array[] {
  const n = route.count;
  const marks = [new Uint8Array(n), new Uint8Array(n)];
  const forced = [new Uint8Array(n), new Uint8Array(n)];
  const outside = hairpinOutside(route);
  const kind = climbHairpinFence(route.def.id) === 'stone' ? FENCE_STONE : FENCE_METAL;
  const allow = (i: number, side: number) => {
    const s = i * ROUTE_DS;
    return climbAt(route, s) >= 0 && !coversTown(towns, s, 18) && !nearJunction(junctions, i, side, 5) && !nearFinish(route, s);
  };
  for (let i = 1; i < n - 1; i++) {
    const bend = outside[i];
    if (!bend || !allow(i, bend)) continue;
    const si = bend > 0 ? 1 : 0;
    marks[si][i] = kind;
    forced[si][i] = 1;
  }
  for (const side of [-1, 1] as const) {
    const si = side > 0 ? 1 : 0;
    dilateFence(marks[si], forced[si], (i) => allow(i, side) && outside[i] === 0, 2);
  }
  for (let i = 0; i < n; i++) {
    if (outside[i] > 0) marks[0][i] = 0;
    else if (outside[i] < 0) marks[1][i] = 0;
  }
  for (const side of [-1, 1] as const) cullShortFence(marks[side > 0 ? 1 : 0], forced[side > 0 ? 1 : 0], 8);
  return marks;
}

function buildRoadsideFences(route: Route, field: TerrainField, junctions: Junction[], towns: TownSpan[], marks: Uint8Array[]): THREE.Group {
  const n = route.count;

  const metalPosts: THREE.Matrix4[] = [];
  const metalBeams: THREE.Matrix4[] = [];
  const stones: THREE.Matrix4[][] = [[], [], [], []];
  for (const side of [-1, 1] as const) {
    const mark = marks[side > 0 ? 1 : 0];
    let prev: { x: number; y: number; z: number; kind: number } | null = null;
    for (let i = 0; i < n; i++) {
      const kind = mark[i];
      if (!kind) {
        prev = null;
        continue;
      }
      const s = i * ROUTE_DS;
      if (coversTown(towns, s, 18) || nearJunction(junctions, i, side, 5) || nearFinish(route, s)) {
        prev = null;
        continue;
      }
      const setback = kind === 2 ? 0.7 : 0.78;
      const lateral = side * (ROAD_HALF_WIDTH + setback);
      const p = placeOnRoute(route, i, lateral);
      const [rx, rz] = rightVector(route, i);
      const ox = p.x + rx * side;
      const oz = p.z + rz * side;
      // Another carriageway owns this spot, or the bank falls away within a metre.
      // A rail post here would hang over the next leg of a stacked hairpin.
      const drop = (x: number, z: number) => route.y[i] - field.heightAt(x, z);
      if (field.onLake(p.x, p.z) || field.blocksProp(p.x, p.z) || field.roadDistance(p.x, p.z) < ROAD_HALF_WIDTH + 0.4 || drop(p.x, p.z) > 1.2 || drop(ox, oz) > 1.2) {
        prev = null;
        continue;
      }
      const toward = new THREE.Vector3(-rx * side, 0, -rz * side);
      const t = Math.min(1, Math.max(0, (Math.abs(lateral) - ROAD_HALF_WIDTH) / 1.4));
      const y = route.y[i] + 0.02 - 0.22 * t - 0.02;
      if (kind === 1) metalPosts.push(fencePost(new THREE.Vector3(p.x, y, p.z), toward));
      if (prev && prev.kind === kind) {
        const dx = p.x - prev.x;
        const dy = y - prev.y;
        const dz = p.z - prev.z;
        const dist = Math.hypot(dx, dy, dz);
        const max = kind === 2 ? 2.7 : 3.4;
        if (dist > 0.8 && dist < max) {
          const mid = new THREE.Vector3((p.x + prev.x) / 2, (y + prev.y) / 2, (p.z + prev.z) / 2);
          const along = new THREE.Vector3(dx, dy, dz);
          if (kind === 1) metalBeams.push(fenceSpan(mid, along, toward, dist));
          else stones[(i + (side > 0 ? 1 : 0)) % 4].push(fenceSpan(mid, along, toward, dist / 2));
        }
      }
      prev = { x: p.x, y, z: p.z, kind };
    }
  }

  const group = new THREE.Group();
  group.name = 'roadside-fence';
  const metal = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.68, metalness: 0.16 });
  const stone = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.97 });
  addInstances(group, guardrailPost(), metal, metalPosts);
  addInstances(group, guardrailBeam(), metal, metalBeams);
  stones.forEach((list, variant) => addInstances(group, stoneWall(variant), stone, list));
  return group;
}

interface Spectator {
  x: number;
  y: number;
  z: number;
  yaw: number;
  scale: number;
  kind: SpectatorKind;
  look: number;
}

/** Small summit rails. Spectators and flags are added only for a hill-climb race. */
function buildCrowds(route: Route): THREE.Group {
  const rails: { x: number; y: number; z: number; yaw: number; color: number }[] = [];

  for (const climb of route.climbs) {
    const chute = climb.length >= 8000 ? 130 : climb.length >= 3000 ? 85 : 48;
    for (const side of [-1, 1]) {
      for (let d = 1.5; d < chute; d += 1.8) {
        const idx = Math.floor(route.wrap(climb.end - d) / ROUTE_DS) % route.count;
        const p = placeOnRoute(route, idx, side * (ROAD_HALF_WIDTH + 0.95));
        rails.push({
          x: p.x,
          y: route.y[idx],
          z: p.z,
          yaw: Math.atan2(-route.tz[idx], route.tx[idx]),
          color: Math.floor(d / 1.8) % 2 === 0 ? 0xf4f4f4 : 0xd22525,
        });
      }
    }
  }

  const group = new THREE.Group();
  group.name = 'crowd';

  if (rails.length) {
    const rail = new THREE.InstancedMesh(
      colored(new THREE.BoxGeometry(1.7, 0.16, 0.1).translate(0, 0.92, 0), 0xffffff),
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.2 }),
      rails.length,
    );
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const c = new THREE.Color();
    rails.forEach((r, i) => {
      q.setFromAxisAngle(up, r.yaw);
      m.compose(new THREE.Vector3(r.x, r.y, r.z), q, new THREE.Vector3(1, 1, 1));
      rail.setMatrixAt(i, m);
      rail.setColorAt(i, c.set(r.color));
    });
    rail.name = 'summit-rails';
    rail.castShadow = true;
    rail.receiveShadow = true;
    rail.computeBoundingSphere();
    group.add(rail);
  }
  return group;
}

function addPeople(group: THREE.Group, people: Spectator[]): void {
  if (!people.length) return;
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, flatShading: true });
  addCrowdMotion(mat, crowdTime, 'bob');
  const groups = new Map<string, Spectator[]>();
  for (const p of people) {
    const key = `${p.kind}:${p.look}`;
    const list = groups.get(key);
    if (list) list.push(p);
    else groups.set(key, [p]);
  }
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  for (const [key, list] of groups) {
    const [kind, look] = key.split(':') as [SpectatorKind, string];
    const geom = buildSpectator(kind, Number(look));
    const matrices = list.map((p) => {
      q.setFromAxisAngle(up, p.yaw);
      return new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y, p.z), q, new THREE.Vector3(p.scale, p.scale, p.scale));
    });
    // Per map cell, like the fences: a crowd along a whole climb is one bounding sphere that
    // is always in view, so every spectator on the mountain was drawn and shadowed each frame.
    addInstances(group, geom, mat, matrices, PEOPLE_CELL);
  }
}

/** Spectators are split into cells this wide, and hidden beyond PEOPLE_RANGE. */
const PEOPLE_CELL = 400;
const PEOPLE_RANGE = 700;

/** Cells of a race crowd, for `cullRaceCrowd` each frame. */
export function raceCrowdCells(root: THREE.Object3D): FenceCell[] {
  return fenceCells(root);
}

export function cullRaceCrowd(cells: FenceCell[], eye: THREE.Vector3): void {
  cullFences(cells, eye, PEOPLE_RANGE, PEOPLE_CELL);
}

export type CrowdLevel = 'quiet' | 'normal' | 'busy' | 'grand';

/** Race crowd: thick at the foot and the summit, a thinner line in between. */
function approachDir(climb: Climb): 1 | -1 {
  return climb.end >= climb.start ? 1 : -1;
}

function buildRaceCrowd(route: Route, climb: Climb, field: TerrainField, level: CrowdLevel = 'normal'): Spectator[] {
  const tune = {
    quiet: { band: 180, denseStep: 4.8, thinStep: 22, thinSkip: 0.55, rows: 1 },
    normal: { band: 420, denseStep: 2.2, thinStep: 7.5, thinSkip: 0.28, rows: 2 },
    busy: { band: 560, denseStep: 1.9, thinStep: 9, thinSkip: 0.18, rows: 2 },
    grand: { band: 900, denseStep: 1.55, thinStep: 11, thinSkip: 0.08, rows: 3 },
  }[level];
  const rng = mulberry32(route.def.seed + 91 + Math.round(climb.start));
  const people: Spectator[] = [];
  const spawn = (s: number, lateral: number) => {
    const sample = route.place(s, lateral);
    const side = Math.sign(lateral) || 1;
    const along = (rng() - 0.5) * 0.7;
    const who = pickSpectator(rng);
    const x = sample.x + sample.tx * along;
    const z = sample.z + sample.tz * along;
    // The road centre sits above the grass. Plant the feet on the triangle the camera sees.
    people.push({
      x,
      y: field.surfaceHeight(x, z),
      z,
      yaw: Math.atan2(side * sample.tx, side * sample.tz) + (rng() - 0.5) * 0.35,
      scale: who.kind === 'child' ? 0.96 + rng() * 0.06 : 0.98 + rng() * 0.06,
      kind: who.kind,
      look: who.look,
    });
  };
  const dir = approachDir(climb);
  const span = Math.abs(climb.end - climb.start);
  for (const side of [-1, 1]) {
    let traveled = 8;
    while (traveled < span - 6) {
      const s = climb.start + dir * traveled;
      const fromStart = traveled;
      const fromEnd = span - traveled;
      const dense = Math.min(fromStart, fromEnd) < tune.band;
      const step = dense ? tune.denseStep : tune.thinStep;
      if (!dense && rng() < tune.thinSkip) {
        traveled += step;
        continue;
      }
      const rows = dense && tune.rows > 1
        ? [ROAD_HALF_WIDTH + 1.95, ROAD_HALF_WIDTH + 3.2, ...(tune.rows > 2 ? [ROAD_HALF_WIDTH + 4.5] : [])]
        : [ROAD_HALF_WIDTH + 2.15 + (rng() - 0.5) * 0.8];
      for (const lat of rows) {
        if (rng() < (dense ? 0.06 : 0)) continue;
        spawn(s, side * lat);
      }
      traveled += step;
    }
  }
  return people;
}

function addFlags(group: THREE.Group, flags: { x: number; y: number; z: number; yaw: number; nation: number }[]): void {
  if (!flags.length) return;
  const poles = new THREE.InstancedMesh(flagPole(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.25 }), flags.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  flags.forEach((f, i) => {
    q.setFromAxisAngle(up, f.yaw);
    m.compose(new THREE.Vector3(f.x, f.y, f.z), q, new THREE.Vector3(1, 1, 1));
    poles.setMatrixAt(i, m);
  });
  poles.castShadow = true;
  poles.computeBoundingSphere();
  group.add(poles);
  const byNation = new Map<number, typeof flags>();
  for (const f of flags) {
    const list = byNation.get(f.nation) ?? [];
    list.push(f);
    byNation.set(f.nation, list);
  }
  for (const [nation, list] of byNation) {
    const flagMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, side: THREE.DoubleSide });
    addCrowdMotion(flagMat, crowdTime, 'flag');
    const cloths = new THREE.InstancedMesh(nationFlag(nation), flagMat, list.length);
    list.forEach((f, i) => {
      q.setFromAxisAngle(up, f.yaw);
      m.compose(new THREE.Vector3(f.x, f.y, f.z), q, new THREE.Vector3(1, 1, 1));
      cloths.setMatrixAt(i, m);
    });
    cloths.castShadow = true;
    cloths.computeBoundingSphere();
    group.add(cloths);
  }
}

/** Flags along the last part of a hill-climb, behind the fences. */
function buildRaceFlags(route: Route, climb: Climb): { x: number; y: number; z: number; yaw: number; nation: number }[] {
  const rng = mulberry32(route.def.seed + 113 + Math.round(climb.end));
  const dir = approachDir(climb);
  const flags: { x: number; y: number; z: number; yaw: number; nation: number }[] = [];
  for (const side of [-1, 1]) {
    for (let d = 8; d < 150; d += 7) {
      const sample = route.place(climb.end - dir * d, side * (ROAD_HALF_WIDTH + 1.45));
      flags.push({
        x: sample.x,
        y: sample.y,
        z: sample.z,
        yaw: Math.atan2(-sample.tz, sample.tx) + (dir < 0 ? Math.PI : 0),
        nation: Math.floor(rng() * 8),
      });
    }
  }
  return flags;
}

function makeArch(route: Route, s: number, label: string, sub: string, color: string, face: 1 | -1 = 1): THREE.Group {
  const sample = route.sample(s);
  const arch = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.6 });
  const width = ROAD_HALF_WIDTH * 2 + 2.4;
  for (const side of [-1, 1]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.6, 5.2, 0.6), mat);
    pillar.position.set(0, 2.6, (side * width) / 2);
    pillar.castShadow = true;
    arch.add(pillar);
  }
  const tex = textTexture(
    [
      { text: label, size: 60, color: '#ffffff', weight: '800' },
      { text: sub, size: 26, color: 'rgba(255,255,255,0.85)', weight: '600' },
    ],
    color,
    1024,
    160,
  );
  const bannerMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 });
  // local +x is the direction of travel; the -x face is what approaching riders read
  const banner = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.4, width + 0.6), [bannerMat, bannerMat, mat, mat, mat, mat]);
  banner.position.set(0, 5.4, 0);
  banner.castShadow = true;
  arch.add(banner);
  arch.position.set(sample.x, sample.y, sample.z);
  arch.rotation.y = Math.atan2(-sample.tz, sample.tx) + (face < 0 ? Math.PI : 0);
  return arch;
}

/** Green arches for the intermediate sprints of a career stage. */
export function buildPrimeArches(route: Route, marks: { s: number; name: string }[], face: 1 | -1 = 1): THREE.Group {
  const group = new THREE.Group();
  group.name = 'prime-arches';
  for (const mark of marks) {
    group.add(makeArch(route, mark.s, 'SPRINT', mark.name, '#128a3e', face));
  }
  return group;
}

function buildArches(route: Route): THREE.Group {
  const group = new THREE.Group();
  const climbAtStart = route.climbs.some((c) => Math.min(c.start, Math.abs(route.length - c.start)) < 40);
  if (!climbAtStart) group.add(makeArch(route, 0, 'CYCLEBUDDY', `${route.def.name} - start / finish`, '#ff7f2a'));
  for (const c of route.climbs) {
    group.add(makeArch(route, c.start, c.name.toUpperCase(), `Climb start - ${(c.length / 1000).toFixed(1)} km @ ${(c.avgGrade * 100).toFixed(1)}%`, '#2d6a3e'));
    const summit = makeArch(route, c.end, 'SUMMIT', `${c.name} - ${Math.round(c.summitElevation)} m`, '#c8102e');
    summit.name = `summit-arch:${c.id}`;
    group.add(summit);
  }
  return group;
}

const RACE_FENCE_BEFORE = 250;
const RACE_FENCE_AFTER = 18;

/**
 * Race-only finish for one climb: barriers up the last part, a line and arch at the
 * summit, and a red flag over the road one kilometre out.
 */
const ROAD_NAMES = ['ALLEZ', 'FORZA', 'VAMOS', 'HUP HUP', 'GO GO', 'TIFOSI', 'PUREZA', 'ANIMO'];

function roadWriting(route: Route, climb: Climb): THREE.Group {
  const group = new THREE.Group();
  const rng = mulberry32(route.def.seed + 71 + Math.round(climb.start));
  const names = [climb.name.split(' ')[0].toUpperCase(), ...ROAD_NAMES];
  const dir = approachDir(climb);
  const span = Math.abs(climb.end - climb.start);
  let d = 40;
  while (d < Math.min(span - 30, 380)) {
    const s = climb.end - dir * d;
    const sample = route.sample(s);
    const text = names[Math.floor(rng() * names.length)];
    const tex = textTexture([{ text, size: 72, color: '#f4f1ea', weight: '900' }], 'rgba(0,0,0,0)', 512, 128);
    tex.premultiplyAlpha = true;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -12 });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 1.15).rotateX(-Math.PI / 2), mat);
    mesh.position.set(sample.x, sample.y + 0.04, sample.z);
    mesh.rotation.y = Math.atan2(-sample.tz, sample.tx) + (dir < 0 ? Math.PI : 0);
    mesh.rotation.z = Math.atan(sample.grade);
    group.add(mesh);
    d += 28 + rng() * 22;
  }
  return group;
}

export function buildRaceFinish(route: Route, climb: Climb, field: TerrainField, crowd: CrowdLevel = 'normal', namesOnRoad = false): THREE.Group {
  const group = new THREE.Group();
  group.name = 'race-finish';
  addPeople(group, buildRaceCrowd(route, climb, field, crowd));
  addFlags(group, buildRaceFlags(route, climb));
  // A race already paints the climbs. This only fills a finish that has none.
  if (!namesOnRoad) {
    if (approachDir(climb) > 0) {
      const named = route.climbs.find((c) => c.id === climb.id);
      if (!named || !isBigClimb(named)) {
        const writing = raceGraffiti(route, Math.max(climb.start + 30, climb.end - 380), climb.end - 40, route.def.seed + 71 + Math.round(climb.start));
        if (writing) group.add(writing);
      }
    } else group.add(roadWriting(route, climb));
  }

  const panelMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.35 });
  const railMat = new THREE.MeshStandardMaterial({ color: 0xd0121a, roughness: 0.5, metalness: 0.25 });
  const panelGeom = colored(new THREE.BoxGeometry(2.02, 0.82, 0.08).translate(0, 0.62, 0), 0xffffff);
  const railGeom = new THREE.BoxGeometry(2.02, 0.07, 0.1).translate(0, 1.06, 0);
  const matrices: THREE.Matrix4[] = [];
  const colors: THREE.Color[] = [];
  const q = new THREE.Quaternion();
  const qYaw = new THREE.Quaternion();
  const qPitch = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const zAxis = new THREE.Vector3(0, 0, 1);
  const pos = new THREE.Vector3();
  const white = new THREE.Color(0xf4f4f4);
  const red = new THREE.Color(0xd0121a);
  const lat = ROAD_HALF_WIDTH + 0.62;
  const dir = approachDir(climb);
  for (const side of [-1, 1]) {
    for (let d = -RACE_FENCE_AFTER; d <= RACE_FENCE_BEFORE; d += 2.05) {
      const s = climb.end - dir * d;
      if ((s - climb.start) * dir < 8) continue;
      const sample = route.place(s, side * lat);
      pos.set(sample.x, sample.y, sample.z);
      qYaw.setFromAxisAngle(up, Math.atan2(-sample.tz, sample.tx) + (dir < 0 ? Math.PI : 0));
      qPitch.setFromAxisAngle(zAxis, Math.atan(sample.grade));
      q.multiplyQuaternions(qYaw, qPitch);
      matrices.push(new THREE.Matrix4().compose(pos, q, new THREE.Vector3(1, 1, 1)));
      colors.push(Math.floor(d / 2.05) % 2 === 0 ? white : red);
    }
  }
  if (matrices.length) {
    const panels = new THREE.InstancedMesh(panelGeom, panelMat, matrices.length);
    const rails = new THREE.InstancedMesh(railGeom, railMat, matrices.length);
    const c = new THREE.Color();
    matrices.forEach((m, i) => {
      panels.setMatrixAt(i, m);
      rails.setMatrixAt(i, m);
      panels.setColorAt(i, c.copy(colors[i]));
    });
    for (const mesh of [panels, rails]) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      group.add(mesh);
    }
  }

  const line = new THREE.Group();
  const pitched = new THREE.Group();
  const lineMat = new THREE.MeshStandardMaterial({
    color: 0xf7f7f7,
    roughness: 0.7,
    polygonOffset: true,
    polygonOffsetFactor: -6,
    polygonOffsetUnits: -6,
  });
  const blackMat = new THREE.MeshStandardMaterial({
    color: 0x1a1a1a,
    roughness: 0.8,
    polygonOffset: true,
    polygonOffsetFactor: -8,
    polygonOffsetUnits: -8,
  });
  const span = ROAD_HALF_WIDTH * 2 - 0.5;
  const depth = 4.2;
  const base = new THREE.Mesh(new THREE.BoxGeometry(depth, 0.03, span), lineMat);
  base.position.y = 0.05;
  pitched.add(base);
  const cols = 8;
  const rows = 4;
  const cellX = depth / rows;
  const cellZ = span / cols;
  const checker = new THREE.BoxGeometry(cellX * 0.94, 0.03, cellZ * 0.94);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if ((row + col) % 2 === 0) continue;
      const square = new THREE.Mesh(checker, blackMat);
      square.position.set((row + 0.5) * cellX - depth / 2, 0.07, (col + 0.5) * cellZ - span / 2);
      pitched.add(square);
    }
  }
  const atLine = route.sample(climb.end);
  pitched.rotation.z = Math.atan(atLine.grade);
  line.add(pitched);
  line.position.set(atLine.x, atLine.y, atLine.z);
  line.rotation.y = Math.atan2(-atLine.tz, atLine.tx) + (dir < 0 ? Math.PI : 0);
  group.add(line);

  const finish = makeArch(route, climb.end, 'FINISH', `${climb.name.toUpperCase()}  ·  ${Math.round(climb.summitElevation)} m`, '#c8102e', dir);
  finish.name = 'race-arch';
  group.add(finish);

  const ride = Math.abs(climb.end - climb.start);
  const flammeS = climb.start + dir * Math.max(40, ride - 1000);
  const flamme = makeArch(route, flammeS, '1 KM', 'TO THE FINISH', '#9d0c18', dir);
  flamme.name = 'flamme-rouge';
  // The flamme rouge itself: a big red triangle hanging under the banner, point down,
  // on the side the riders come from (-x).
  const flagGeom = new THREE.BufferGeometry();
  flagGeom.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      [
        -0.2, 4.66, -0.85,
        -0.2, 4.66, 0.85,
        -0.24, 3.32, 0,
      ],
      3,
    ),
  );
  flagGeom.computeVertexNormals();
  const flag = new THREE.Mesh(
    flagGeom,
    new THREE.MeshStandardMaterial({
      color: 0xff1a1a,
      emissive: 0x8a0000,
      emissiveIntensity: 0.35,
      roughness: 0.45,
      side: THREE.DoubleSide,
    }),
  );
  flag.castShadow = true;
  flamme.add(flag);
  group.add(flamme);

  return group;
}
