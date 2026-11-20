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

const C = {
  asphalt: new THREE.Color(0x6a6866),
  asphaltAlt: new THREE.Color(0x666462),
  line: new THREE.Color(0xe9e6dc),
  verge: new THREE.Color(0x8d8064),
};

/** Builds the road surface as a set of 1 km meshes (for frustum culling). */
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

  const samplesPerPiece = Math.round(PIECE_LENGTH / ROUTE_DS);
  for (let start = 0; start < route.count; start += samplesPerPiece) {
    const end = Math.min(route.count, start + samplesPerPiece);
    const pos: number[] = [];
    const col: number[] = [];
    const ox = route.x[start];
    const oz = route.z[start];
    const quad = (
      p0: number[], p1: number[], p2: number[], p3: number[], c: THREE.Color,
    ) => {
      // p0,p1 at segment start (left,right); p2,p3 at segment end (left,right)
      pos.push(...p0, ...p1, ...p2, ...p1, ...p3, ...p2);
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
      const at = (idx: number, lat: number, dy: number) => {
        const [rx, rz] = rightVector(route, idx);
        return [route.x[idx] + rx * lat - ox, route.y[idx] + 0.02 + dy, route.z[idx] + rz * lat - oz];
      };
      const span = (
        a0: number, b0: number, a1: number, b1: number,
        ya0: number, yb0: number, ya1: number, yb1: number, c: THREE.Color,
      ) => {
        if (Math.abs(b0 - a0) < 0.05 && Math.abs(b1 - a1) < 0.05) return;
        quad(at(i, a0, ya0), at(i, b0, yb0), at(j, a1, ya1), at(j, b1, yb1), c);
      };
      const l0 = shoulder.left[i];
      const l1 = shoulder.left[j];
      const r0 = shoulder.right[i];
      const r1 = shoulder.right[j];
      span(-l0, -H, -l1, -H, drop(l0), 0, drop(l1), 0, C.verge);
      span(-H, -H + 0.14, -H, -H + 0.14, 0, 0, 0, 0, C.line);
      span(-H + 0.14, 0, -H + 0.14, 0, 0, 0, 0, 0, C.asphalt);
      span(0, H - 0.14, 0, H - 0.14, 0, 0, 0, 0, C.asphaltAlt);
      span(H - 0.14, H, H - 0.14, H, 0, 0, 0, 0, C.line);
      span(H, r0, H, r1, 0, drop(r0), 0, drop(r1), C.verge);
      // dashed centre line: 3 m dash every 9 m
      const sMeters = i * ROUTE_DS;
      if (sMeters % 9 < 4) {
        quad(at(i, -0.07, 0.01), at(i, 0.07, 0.01), at(j, -0.07, 0.01), at(j, 0.07, 0.01), C.line);
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
