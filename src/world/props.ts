import * as THREE from 'three';
import type { Route } from '../routes/route';
import { prepare, StaticBatch, type Prepared } from './batch';
import { yardRailFence } from './fences';
import { paint, surface, tube, v3 } from './geometry';
import type { MatKind, Model } from './materials';
import type { TerrainField } from './terrainField';

/** Animated props (sails, wheels, tractors, boats, lamps) only move within this range of the camera. */
export const UPDATE_RANGE = 1500;

/**
 * Static scenery gathered into one batch (one mesh per surface per map cell), the
 * clearings where trees must not grow, and anything that animates.
 */
export class Props {
  readonly batch = new StaticBatch(240);
  readonly clear: number[] = [];
  readonly group = new THREE.Group();
  private updaters: { f: (dt: number, eye: THREE.Vector3) => void; x: number; z: number; pending: number }[] = [];
  private culledAt = new THREE.Vector2(Infinity, Infinity);

  place(model: Prepared, m: THREE.Matrix4, tints?: Record<string, number | THREE.Color>): void {
    this.batch.add(model, m, tints);
  }

  /** Painted geometry already in world space. It is moved to its own centre so the batch files it in the right cell. */
  addWorld(geom: THREE.BufferGeometry, mat: MatKind): void {
    geom.computeBoundingBox();
    const c = geom.boundingBox!.getCenter(new THREE.Vector3());
    geom.translate(-c.x, 0, -c.z);
    this.batch.add({ groups: [{ mat, geom }] }, new THREE.Matrix4().makeTranslation(c.x, 0, c.z));
  }

  clearing(x: number, z: number, r: number): void {
    this.clear.push(x, z, r);
  }

  /**
   * Runs f every frame. With `at`, only while the camera is within UPDATE_RANGE of
   * that point; the time spent out of range is handed over on the first frame back,
   * so a sail or a tractor is where it would have been.
   */
  onUpdate(f: (dt: number, eye: THREE.Vector3) => void, at?: { x: number; z: number }): void {
    this.updaters.push({ f, x: at?.x ?? NaN, z: at?.z ?? NaN, pending: 0 });
  }

  update(dt: number, eye: THREE.Vector3): void {
    const r2 = UPDATE_RANGE * UPDATE_RANGE;
    for (const u of this.updaters) {
      if (u.x === u.x) {
        const dx = u.x - eye.x;
        const dz = u.z - eye.z;
        if (dx * dx + dz * dz > r2) {
          u.pending += dt;
          continue;
        }
      }
      u.f(dt + u.pending, eye);
      u.pending = 0;
    }
    // Cells are 240 m; re-check them only once the camera has moved a little.
    const mx = eye.x - this.culledAt.x;
    const mz = eye.z - this.culledAt.y;
    if (!(mx * mx + mz * mz < 16 * 16)) {
      this.culledAt.set(eye.x, eye.z);
      this.batch.cull(eye.x, eye.z, 2200);
    }
  }

  build(): THREE.Group {
    this.group.add(this.batch.build('props'));
    return this.group;
  }
}

/** Flip triangles of an indexed geometry so the first face points up. */
export function faceUp(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const idx = g.getIndex();
  const p = g.getAttribute('position');
  if (!idx || idx.count < 3) return g;
  const a = new THREE.Vector3().fromBufferAttribute(p, idx.getX(0));
  const b = new THREE.Vector3().fromBufferAttribute(p, idx.getX(1));
  const c = new THREE.Vector3().fromBufferAttribute(p, idx.getX(2));
  const n = b.sub(a).cross(c.sub(a));
  if (n.y < 0) {
    for (let i = 0; i < idx.count; i += 3) {
      const t = idx.getX(i + 1);
      idx.setX(i + 1, idx.getX(i + 2));
      idx.setX(i + 2, t);
    }
  }
  return g;
}

/** Highest ground around a point, so a sheet covers the terrain facets under it. */
function highGround(field: TerrainField, x: number, z: number, radius: number): number {
  const step = 4;
  const n = Math.max(0, Math.round(radius / step));
  let h = field.heightAt(x, z);
  for (let j = -n; j <= n; j++) {
    for (let i = -n; i <= n; i++) {
      if (i === 0 && j === 0) continue;
      if (i * i + j * j > (n + 0.25) * (n + 0.25)) continue;
      h = Math.max(h, field.heightAt(x + i * step, z + j * step));
    }
  }
  return h;
}

/**
 * A grid laid over the terrain. f maps (u, v) in 0..1 to world x, z.
 * floor(x, z) can hold it up, e.g. at road level.
 * cover, in metres, raises each vertex to the ground around it so the sheet
 * sits on the terrain instead of letting a coarser triangle rise through it.
 */
export function drape(
  field: TerrainField,
  nu: number,
  nv: number,
  f: (u: number, v: number) => [number, number],
  lift: number,
  floor?: (x: number, z: number) => number,
  cover = 0,
): THREE.BufferGeometry {
  return faceUp(
    surface(nu, nv, (u, v) => {
      const [x, z] = f(u, v);
      const h = cover > 0 ? highGround(field, x, z, cover) : field.heightAt(x, z);
      return v3(x, Math.max(h, floor ? floor(x, z) : -Infinity) + lift, z);
    }),
  );
}

/** A strip that follows the road, between two lateral offsets. y(s, lat) is the height. */
export function roadStrip(route: Route, s0: number, s1: number, lat0: number, lat1: number, y: (s: number, lat: number) => number, step = 2): THREE.BufferGeometry {
  const n = Math.max(1, Math.ceil(Math.abs(s1 - s0) / step));
  const tmp = { x: 0, y: 0, z: 0, tx: 1, tz: 0, grade: 0 };
  return faceUp(
    surface(n, 1, (u, v) => {
      const s = s0 + (s1 - s0) * u;
      const lat = lat0 + (lat1 - lat0) * v;
      route.place(s, lat, tmp);
      return v3(tmp.x, y(s, lat), tmp.z);
    }),
  );
}

/** Vertical face along the road at one lateral offset, facing `towardRoad` (or away). */
export function roadWall(route: Route, s0: number, s1: number, lat: number, y0: (s: number) => number, y1: (s: number) => number, facePositive: boolean, step = 2): THREE.BufferGeometry {
  const n = Math.max(1, Math.ceil(Math.abs(s1 - s0) / step));
  const tmp = { x: 0, y: 0, z: 0, tx: 1, tz: 0, grade: 0 };
  const g = surface(n, 1, (u, v) => {
    const s = s0 + (s1 - s0) * u;
    route.place(s, lat, tmp);
    return v3(tmp.x, v ? y1(s) : y0(s), tmp.z);
  });
  // Turn it so the normal points to +lateral when facePositive.
  const p = g.getAttribute('position');
  const idx = g.getIndex()!;
  const a = new THREE.Vector3().fromBufferAttribute(p, idx.getX(0));
  const b = new THREE.Vector3().fromBufferAttribute(p, idx.getX(1));
  const c = new THREE.Vector3().fromBufferAttribute(p, idx.getX(2));
  const nrm = b.sub(a).cross(c.sub(a));
  route.place(s0, lat, tmp);
  const rx = -tmp.tz;
  const rz = tmp.tx;
  const positive = nrm.x * rx + nrm.z * rz > 0;
  if (positive !== facePositive) {
    for (let i = 0; i < idx.count; i += 3) {
      const t = idx.getX(i + 1);
      idx.setX(i + 1, idx.getX(i + 2));
      idx.setX(i + 2, t);
    }
  }
  return g;
}

// ------------------------------------------------------------------------------------------ small props

function box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): THREE.BufferGeometry {
  return new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
}

const cached = new Map<string, Prepared>();
function once(key: string, build: () => Model): Prepared {
  let p = cached.get(key);
  if (!p) cached.set(key, (p = prepare(build())));
  return p;
}

/** Street lamp facing +x (the road), arm over the pavement. */
export function streetLamp(): Prepared {
  return once('lamp', () => {
    const arm = [v3(0, 4.7, 0), v3(0.25, 5.15, 0), v3(0.75, 5.3, 0), v3(1.2, 5.25, 0)];
    const parts: Model = [
      { geom: paint(new THREE.CylinderGeometry(0.06, 0.09, 5, 8).translate(0, 2.5, 0), 0x3a3d42, { crease: 0.8 }), mat: 'metal' },
      { geom: paint(new THREE.CylinderGeometry(0.14, 0.16, 0.5, 8).translate(0, 0.25, 0), 0x3a3d42, { crease: 0.8 }), mat: 'metal' },
      { geom: paint(new THREE.BoxGeometry(0.5, 0.12, 0.26).translate(1.3, 5.2, 0), 0x3a3d42, { crease: 0.3 }), mat: 'metal' },
      { geom: paint(new THREE.BoxGeometry(0.42, 0.04, 0.2).translate(1.3, 5.13, 0), new THREE.Color(1.4, 1.3, 1.05), { crease: 0 }), mat: 'glow' },
    ];
    for (let i = 1; i < arm.length; i++) parts.push({ geom: paint(tube(arm[i - 1], arm[i], 0.045, 0.04, 6, false), 0x3a3d42, { crease: 0.8 }), mat: 'metal' });
    return parts;
  });
}

export function bench(): Prepared {
  return once('bench', () => {
    const wood = 0x8a5a36;
    const parts: Model = [];
    for (let i = 0; i < 3; i++) parts.push({ geom: paint(box(-0.25 + i * 0.13, -0.15 + i * 0.13, 0.44, 0.48, -0.9, 0.9), wood, { crease: 0 }), mat: 'rough' });
    for (let i = 0; i < 2; i++) parts.push({ geom: paint(box(-0.32, -0.28, 0.6 + i * 0.16, 0.7 + i * 0.16, -0.9, 0.9), wood, { crease: 0 }), mat: 'rough' });
    for (const z of [-0.75, 0.75]) {
      parts.push({ geom: paint(box(-0.3, 0.12, 0, 0.44, z - 0.03, z + 0.03), 0x2d2f33, { crease: 0 }), mat: 'metal' });
      parts.push({ geom: paint(box(-0.34, -0.28, 0.44, 0.9, z - 0.03, z + 0.03), 0x2d2f33, { crease: 0 }), mat: 'metal' });
    }
    return parts;
  });
}

/** Garden or street tree, variant 0..3. Moor gardens use the grassland olive. */
export function gardenTree(variant: number, moor = false): Prepared {
  return once(moor ? `tree-moor${variant}` : `tree${variant}`, () => {
    const rng = (k: number) => Math.abs(Math.sin(variant * 91.7 + k * 13.1)) % 1;
    const h = 3.2 + variant * 0.6;
    const parts: Model = [{ geom: paint(new THREE.CylinderGeometry(0.1, 0.15, h, 7).translate(0, h / 2, 0), 0x5b4332, { crease: 0.8 }), mat: 'rough' }];
    const greens = moor ? [0x6a7040, 0x746e44, 0x5c6238, 0x7a7248] : [0x4f7a34, 0x5d8a3a, 0x46702f, 0x6a8f3c];
    for (let i = 0; i < 4; i++) {
      const r = 1.1 + rng(i) * 0.7;
      const g = new THREE.IcosahedronGeometry(r, 1).translate((rng(i + 4) - 0.5) * 1.4, h + (rng(i + 8) - 0.3) * 1.2, (rng(i + 12) - 0.5) * 1.4);
      parts.push({ geom: paint(g, greens[(variant + i) % greens.length], { crease: 0, jitter: 0.08, seed: variant * 7 + i }), mat: 'foliage' });
    }
    return parts;
  });
}

/** Hedge segment one metre long along z, 1.1 m tall. */
export function hedge(color = 0x3f6a2c): Prepared {
  return once(color === 0x3f6a2c ? 'hedge' : `hedge${color.toString(16)}`, () => [
    { geom: paint(new THREE.BoxGeometry(0.7, 1.05, 1.02, 2, 2, 2).translate(0, 0.52, 0), color, { crease: 0, jitter: 0.1 }), mat: 'foliage' },
  ]);
}

/** Wooden rail fence bay 2 m long along z, post at z = 0. */
export function railFence(): Prepared {
  return once('railfence', yardRailFence);
}

/** White picket fence bay 2 m long along z. */
export function picketFence(): Prepared {
  return once('picket', () => {
    const parts: Model = [
      { geom: paint(box(-0.05, 0.05, -0.3, 1.05, -0.05, 0.05), 0xf2f0ea, { crease: 0 }), mat: 'matte' },
      { geom: paint(box(-0.06, -0.03, 0.3, 0.38, 0, 2), 0xf2f0ea, { crease: 0 }), mat: 'matte' },
      { geom: paint(box(-0.06, -0.03, 0.7, 0.78, 0, 2), 0xf2f0ea, { crease: 0 }), mat: 'matte' },
    ];
    for (let z = 0.12; z < 1.95; z += 0.16) parts.push({ geom: paint(box(-0.03, 0, -0.05, 0.95, z, z + 0.08), 0xf2f0ea, { crease: 0 }), mat: 'matte' });
    return parts;
  });
}

/** Traffic light: pole and a three-lamp head facing +x, and a second head on an arm along +z. The lenses are drawn separately so they can change. */
export function trafficPole(arm: number): Prepared {
  return once(`tpole${arm.toFixed(1)}`, () => {
    const parts: Model = [
      { geom: paint(new THREE.CylinderGeometry(0.065, 0.08, 4.2, 8).translate(0, 2.1, 0), 0x2e3034, { crease: 0.8 }), mat: 'metal' },
      { geom: paint(box(-0.13, 0.13, 2.25, 3.25, -0.17, 0.17), 0x1d1e21, { crease: 0 }), mat: 'gloss' },
      { geom: paint(box(-0.16, -0.13, 2.15, 3.35, -0.26, 0.26), 0xe8e8e8, { crease: 0 }), mat: 'matte' },
    ];
    for (let i = 0; i < 3; i++) {
      const y = 2.45 + i * 0.3;
      parts.push({ geom: paint(box(0.13, 0.3, y + 0.11, y + 0.13, -0.13, 0.13), 0x1d1e21, { crease: 0 }), mat: 'gloss' });
    }
    if (arm > 0) {
      parts.push({ geom: paint(tube(v3(0, 4.0, 0), v3(0, 4.0, arm), 0.05, 0.05, 6), 0x2e3034, { crease: 0.8 }), mat: 'metal' });
      parts.push({ geom: paint(box(-0.13, 0.13, 3.2, 4.2, arm - 0.17, arm + 0.17), 0x1d1e21, { crease: 0 }), mat: 'gloss' });
      parts.push({ geom: paint(box(-0.16, -0.13, 3.1, 4.3, arm - 0.26, arm + 0.26), 0xe8e8e8, { crease: 0 }), mat: 'matte' });
      for (let i = 0; i < 3; i++) {
        const y = 3.4 + i * 0.3;
        parts.push({ geom: paint(box(0.13, 0.3, y + 0.11, y + 0.13, arm - 0.13, arm + 0.13), 0x1d1e21, { crease: 0 }), mat: 'gloss' });
      }
    }
    return parts;
  });
}

/** Square sign board on a post, facing +x. The face is a texture so it is a separate mesh. */
export function signPost(): Prepared {
  return once('signpost', () => [{ geom: paint(new THREE.CylinderGeometry(0.05, 0.05, 2.6, 6).translate(0, 1.3, 0), 0x8a8e96, { crease: 0.8 }), mat: 'metal' }]);
}

export function bin(): Prepared {
  return once('bin', () => [
    { geom: paint(new THREE.CylinderGeometry(0.22, 0.2, 0.75, 10).translate(0, 0.45, 0), 0x2f5a3a, { crease: 0.8 }), mat: 'gloss' },
    { geom: paint(new THREE.CylinderGeometry(0.04, 0.04, 0.5, 6).translate(0, 0.25, 0), 0x2f3034, { crease: 0.8 }), mat: 'metal' },
  ]);
}

export function planter(foliage = 0x4f7a34): Prepared {
  return once(foliage === 0x4f7a34 ? 'planter' : `planter${foliage.toString(16)}`, () => [
    { geom: paint(box(-0.45, 0.45, 0, 0.5, -0.45, 0.45), 0xb8b2a6, { crease: 0 }), mat: 'rough' },
    { geom: paint(new THREE.IcosahedronGeometry(0.5, 1).scale(1, 0.6, 1).translate(0, 0.65, 0), foliage, { crease: 0, jitter: 0.1 }), mat: 'foliage' },
    { geom: paint(new THREE.IcosahedronGeometry(0.22, 0).translate(0.15, 0.85, 0.1), 0xd9445a, { crease: 0 }), mat: 'foliage' },
  ]);
}

export function fountain(): Prepared {
  return once('fountain', () => [
    { geom: paint(new THREE.CylinderGeometry(2.2, 2.3, 0.6, 24, 1, true).translate(0, 0.3, 0), 0xc9c2b4, { crease: 0.8 }), mat: 'rough' },
    { geom: paint(new THREE.CylinderGeometry(2.0, 2.0, 0.6, 24, 1, true).translate(0, 0.3, 0).scale(-1, 1, 1), 0xb3ac9f, { crease: 0.8 }), mat: 'rough' },
    { geom: paint(new THREE.RingGeometry(2.0, 2.3, 24).rotateX(-Math.PI / 2).translate(0, 0.6, 0), 0xd6d0c4, { crease: 0.8 }), mat: 'rough' },
    { geom: paint(new THREE.CircleGeometry(2.0, 24).rotateX(-Math.PI / 2).translate(0, 0.45, 0), 0x3b6f86, { crease: 0.8 }), mat: 'glass' },
    { geom: paint(new THREE.CylinderGeometry(0.25, 0.35, 1.6, 10).translate(0, 0.8, 0), 0xc9c2b4, { crease: 0.8 }), mat: 'rough' },
    { geom: paint(new THREE.CylinderGeometry(0.75, 0.3, 0.25, 14).translate(0, 1.7, 0), 0xc9c2b4, { crease: 0.8 }), mat: 'rough' },
  ]);
}
