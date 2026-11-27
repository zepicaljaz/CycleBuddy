import * as THREE from 'three';
import type { Route } from '../routes/route';
import { ROUTE_DS } from '../routes/route';
import { ROAD_HALF_WIDTH } from './terrainField';

const PIECE_LENGTH = 1000;
const STEP = 2; // route samples per road segment (4 m)
const HASH_CELL = 32;

/**
 * How far the gravel shoulder may reach on each side before it meets the next
 * carriageway. On a stacked hairpin the two shoulders would otherwise run
 * into each other and the upper terrace covers the lower one.
 */
function shoulderReach(route: Route): { left: Float32Array; right: Float32Array } {
  const n = route.count;
  const full = ROAD_HALF_WIDTH + 1.4;
  const key = (ix: number, iz: number) => (ix + 32768) * 65536 + (iz + 32768);
  const hash = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const k = key(Math.floor(route.x[i] / HASH_CELL), Math.floor(route.z[i] / HASH_CELL));
    let arr = hash.get(k);
    if (!arr) hash.set(k, (arr = []));
    arr.push(i);
  }
  const rawL = new Float32Array(n);
  const rawR = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const rx = -route.tz[i];
    const rz = route.tx[i];
    const cx = Math.floor(route.x[i] / HASH_CELL);
    const cz = Math.floor(route.z[i] / HASH_CELL);
    let left = full;
    let right = full;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const arr = hash.get(key(cx + dx, cz + dz));
        if (!arr) continue;
        for (const j of arr) {
          let along = Math.abs(j - i);
          if (along > n / 2) along = n - along;
          // The ride back down this road sits on the same line. A few metres
          // off is the next terrace of a hairpin.
          if (along < 14) continue;
          const vx = route.x[j] - route.x[i];
          const vz = route.z[j] - route.z[i];
          const d = Math.hypot(vx, vz);
          if (d < 3.2 || d > 18) continue;
          const lat = vx * rx + vz * rz;
          const room = d * 0.5 - 0.25;
          if (lat < 0) left = Math.min(left, room);
          else right = Math.min(right, room);
        }
      }
    }
    rawL[i] = Math.max(ROAD_HALF_WIDTH, left);
    rawR[i] = Math.max(ROAD_HALF_WIDTH, right);
  }
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let l = rawL[i];
    let r = rawR[i];
    for (let k = -2; k <= 2; k++) {
      const j = (i + k + n) % n;
      l = Math.min(l, rawL[j]);
      r = Math.min(r, rawR[j]);
    }
    left[i] = l;
    right[i] = r;
  }
  return { left, right };
}

/**
 * How far the road may reach on the inside of a turn at each sample. A point further
 * inside than the turn's radius would sit past the turn centre and fold the surface
 * over (tightest real hairpins: Stelvio, Krvavec ~3 m radius vs a 3.8 m half-width).
 * Lines on the inner side are pulled in to 70 % of the tightest radius nearby, so the
 * inner edge narrows to a pivot at the apex, as on a real hairpin. `side` is +1 when
 * the road turns right (inner = right), -1 when it turns left.
 */
function innerLimit(route: Route): { side: Int8Array; limit: Float32Array } {
  const n = route.count;
  const side = new Int8Array(n);
  const radius = new Float32Array(n).fill(Infinity);
  // Measured over 4 m and over 8 m; the shorter one catches an apex sharper than a segment.
  for (const span of [1, 2]) {
    for (let i = span; i < n - span; i++) {
      const a = i - span;
      const b = i + span;
      const cross = route.tx[a] * route.tz[b] - route.tz[a] * route.tx[b];
      const dot = route.tx[a] * route.tx[b] + route.tz[a] * route.tz[b];
      const turn = Math.atan2(cross, dot);
      if (Math.abs(turn) < 1e-4) continue;
      const r = (2 * span * ROUTE_DS) / Math.abs(turn);
      if (r >= radius[i]) continue;
      radius[i] = r;
      // Right vector is (-tz, tx); a positive cross turns the heading towards it.
      side[i] = turn > 0 ? 1 : -1;
    }
  }
  const limit = new Float32Array(n);
  const win = 4;
  for (let i = 0; i < n; i++) {
    let r = Infinity;
    for (let k = Math.max(0, i - win); k <= Math.min(n - 1, i + win); k++) {
      if (side[k] === side[i]) r = Math.min(r, radius[k]);
    }
    limit[i] = 0.7 * r;
  }
  return { side, limit };
}

const C = {
  /** The bank under the road edge: earth, a shade darker than the gravel verge. */
  side: new THREE.Color(0x6e6450),
  asphalt: new THREE.Color(0x6a6866),
  asphaltAlt: new THREE.Color(0x666462),
  line: new THREE.Color(0xe9e6dc),
  verge: new THREE.Color(0x8d8064),
};

/**
 * How deep the side skirt hangs below the verge edge. The terrain mesh sits up to
 * ~0.4 m under the road edge on a straight and up to ~2 m on the outside of a tight
 * turn (coarse terrain triangles cut the corner); without a skirt that gap shows as a
 * see-through slit under a paper-thin road. Measured 27 Nov 2026: Stelvio turns p99
 * 1.35 m, max 2.03 m. Mostly buried in the hillside, so it costs no extra overdraw.
 */
const SKIRT_DEPTH = 3.5;
const SKIRT_OUT = 0.5;

/**
 * Builds the road surface as a set of 1 km meshes (for frustum culling).
 *
 * The surface is drawn one-sided (cheaper), so two rules keep it closed:
 * - Each lateral line (verge edge, road edge, lane line...) only ever moves forward.
 *   On the inside of a hairpin tighter than the road is wide, the inner edge would
 *   swing backwards and flip triangles upside down, which a one-sided material does
 *   not draw: a hole. A point that would move backwards stays where it is, so the
 *   inner edge pivots like a real hairpin apex (see `road.test.ts`).
 * - A skirt hangs from both verge edges down into the ground (see SKIRT_DEPTH).
 */
export function buildRoad(route: Route): THREE.Group {
  const group = new THREE.Group();
  group.name = 'road';
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.95,
    metalness: 0,
    envMapIntensity: 0.4,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
  });

  const H = ROAD_HALF_WIDTH;
  const shoulder = shoulderReach(route);
  const drop = (outer: number) => -0.22 * Math.min(1, Math.max(0, outer - H) / 1.4);

  // Last point of each lateral line, in world space, carried across segments and pieces.
  const last = new Map<string, number[]>();
  const fwd = [0, 0];
  /** Moves lateral line `key` to `p` unless that would go backwards; returns where it is. */
  // Backstop for what the inner clamp misses: a line never moves backwards.
  const advance = (key: string, p: number[], start: boolean): number[] => {
    const prev = last.get(key);
    if (start) {
      // The start of a segment is the end of the one before, so neighbours share edges.
      if (prev) return prev;
      last.set(key, p);
      return p;
    }
    if (prev && (p[0] - prev[0]) * fwd[0] + (p[2] - prev[2]) * fwd[1] < 0.02) {
      // Would move backwards (inside of a hairpin): pivot on the last point, keep its
      // height in step with the road so the apex does not tilt.
      const pivot = [prev[0], p[1], prev[2]];
      last.set(key, pivot);
      return pivot;
    }
    last.set(key, p);
    return p;
  };
  const inner = innerLimit(route);
  const lineAt = (key: string, idx: number, lat: number, dy: number, start: boolean): number[] => {
    if (inner.side[idx] !== 0 && Math.sign(lat) === inner.side[idx] && Math.abs(lat) > inner.limit[idx]) {
      lat = inner.side[idx] * inner.limit[idx];
    }
    const [rx, rz] = rightVector(route, idx);
    return advance(key, [route.x[idx] + rx * lat, route.y[idx] + 0.02 + dy, route.z[idx] + rz * lat], start);
  };

  const samplesPerPiece = Math.round(PIECE_LENGTH / ROUTE_DS);
  for (let start = 0; start < route.count; start += samplesPerPiece) {
    const end = Math.min(route.count, start + samplesPerPiece);
    const pos: number[] = [];
    const col: number[] = [];
    const ox = route.x[start];
    const oz = route.z[start];
    const local = (p: number[]) => [p[0] - ox, p[1], p[2] - oz];
    const quad = (
      p0: number[], p1: number[], p2: number[], p3: number[], c: THREE.Color,
    ) => {
      // p0,p1 at segment start (left,right); p2,p3 at segment end (left,right)
      pos.push(...local(p0), ...local(p1), ...local(p2), ...local(p1), ...local(p3), ...local(p2));
      for (let k = 0; k < 6; k++) col.push(c.r, c.g, c.b);
    };
    for (let i = start; i < end; i += STEP) {
      let j = Math.min(i + STEP, end);
      // A closed loop joins the last samples back to the start. An open excerpt must not,
      // or a road is drawn from one end of the valley to the other.
      if (j >= route.count) {
        j = 0;
        if (Math.hypot(route.x[0] - route.x[i], route.z[0] - route.z[i]) > 24) continue;
      }
      const fl = Math.hypot(route.x[j] - route.x[i], route.z[j] - route.z[i]) || 1;
      fwd[0] = (route.x[j] - route.x[i]) / fl;
      fwd[1] = (route.z[j] - route.z[i]) / fl;
      const l0 = shoulder.left[i];
      const l1 = shoulder.left[j];
      const r0 = shoulder.right[i];
      const r1 = shoulder.right[j];
      // Lateral lines, left to right. Each is one edge shared by the bands either side.
      const lines: [string, number, number, number, number][] = [
        ['vl', -l0, -l1, drop(l0), drop(l1)],
        ['l', -H, -H, 0, 0],
        ['lc', -H + 0.14, -H + 0.14, 0, 0],
        ['c', 0, 0, 0, 0],
        ['rc', H - 0.14, H - 0.14, 0, 0],
        ['r', H, H, 0, 0],
        ['vr', r0, r1, drop(r0), drop(r1)],
      ];
      const a: number[][] = [];
      const b: number[][] = [];
      for (const [key, lat0, lat1, dy0, dy1] of lines) {
        a.push(lineAt(key, i, lat0, dy0, true));
        b.push(lineAt(key, j, lat1, dy1, false));
      }
      const band = (k: number, c: THREE.Color) => quad(a[k], a[k + 1], b[k], b[k + 1], c);
      if (l0 - H > 0.05 || l1 - H > 0.05) band(0, C.verge);
      band(1, C.line);
      band(2, C.asphalt);
      band(3, C.asphaltAlt);
      band(4, C.line);
      if (r0 - H > 0.05 || r1 - H > 0.05) band(5, C.verge);
      // Skirts: from the outer verge edge down and slightly out, facing away from the road.
      const sl0 = lineAt('sl', i, -(l0 + SKIRT_OUT), drop(l0) - SKIRT_DEPTH, true);
      const sl1 = lineAt('sl', j, -(l1 + SKIRT_OUT), drop(l1) - SKIRT_DEPTH, false);
      const sr0 = lineAt('sr', i, r0 + SKIRT_OUT, drop(r0) - SKIRT_DEPTH, true);
      const sr1 = lineAt('sr', j, r1 + SKIRT_OUT, drop(r1) - SKIRT_DEPTH, false);
      quad(sl0, a[0], sl1, b[0], C.side);
      quad(a[6], sr0, b[6], sr1, C.side);
      // dashed centre line: 3 m dash every 9 m
      const sMeters = i * ROUTE_DS;
      if (sMeters % 9 < 4) {
        const at = (idx: number, lat: number) => {
          const [rx, rz] = rightVector(route, idx);
          return [route.x[idx] + rx * lat, route.y[idx] + 0.03, route.z[idx] + rz * lat];
        };
        quad(at(i, -0.07), at(i, 0.07), at(j, -0.07), at(j, 0.07), C.line);
      }
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geom.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geom.computeVertexNormals();
    geom.computeBoundingSphere();
    const mesh = new THREE.Mesh(geom, material);
    mesh.position.set(ox, 0, oz);
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}

/** Right-hand lateral unit vector (forward x up) for a route sample. */
export function rightVector(route: Route, idx: number): [number, number] {
  return [-route.tz[idx], route.tx[idx]];
}
