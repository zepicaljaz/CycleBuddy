import * as THREE from 'three';
import { merge } from './geometry';
import { groupParts, material, type MatKind, type Model } from './materials';

class Grow {
  data: Float32Array;
  length = 0;
  constructor(size = 4096) {
    this.data = new Float32Array(size);
  }
  reserve(n: number) {
    if (this.length + n <= this.data.length) return;
    let size = this.data.length * 2;
    while (size < this.length + n) size *= 2;
    const next = new Float32Array(size);
    next.set(this.data.subarray(0, this.length));
    this.data = next;
  }
  view(): Float32Array {
    return this.data.slice(0, this.length);
  }
}

interface Bucket {
  pos: Grow;
  nor: Grow;
  col: Grow;
}

/** Model with its parts merged per surface, ready to stamp many times. */
export interface Prepared {
  groups: { mat: MatKind; tint?: string; geom: THREE.BufferGeometry }[];
}

export function prepare(model: Model): Prepared {
  return { groups: groupParts(model).map((g) => ({ mat: g.mat, tint: g.tint, geom: merge(g.geoms) })) };
}

const _n = new THREE.Matrix3();
const _v = new THREE.Vector3();
const _c = new THREE.Color();

/**
 * Static scenery baked into one mesh per surface per map cell. Cells far from the
 * camera are hidden, and each cell is culled on its own by the camera and the sun.
 */
export class StaticBatch {
  private cells = new Map<string, { cx: number; cz: number; buckets: Map<MatKind, Bucket> }>();
  readonly group = new THREE.Group();
  private meshes: { mesh: THREE.Mesh; cx: number; cz: number }[] = [];

  constructor(private cell = 360) {}

  add(model: Prepared, m: THREE.Matrix4, tints: Record<string, number | THREE.Color> = {}): void {
    const ex = m.elements[12];
    const ez = m.elements[14];
    const ix = Math.floor(ex / this.cell);
    const iz = Math.floor(ez / this.cell);
    const key = `${ix},${iz}`;
    let cell = this.cells.get(key);
    if (!cell) this.cells.set(key, (cell = { cx: (ix + 0.5) * this.cell, cz: (iz + 0.5) * this.cell, buckets: new Map() }));
    _n.getNormalMatrix(m);
    for (const g of model.groups) {
      let b = cell.buckets.get(g.mat);
      if (!b) cell.buckets.set(g.mat, (b = { pos: new Grow(), nor: new Grow(), col: new Grow() }));
      const pos = g.geom.getAttribute('position');
      const nor = g.geom.getAttribute('normal');
      const col = g.geom.getAttribute('color');
      const n = pos.count;
      b.pos.reserve(n * 3);
      b.nor.reserve(n * 3);
      b.col.reserve(n * 3);
      const t = g.tint ? tints[g.tint] : undefined;
      if (t !== undefined) {
        if (t instanceof THREE.Color) _c.copy(t);
        else _c.set(t);
      } else _c.setRGB(1, 1, 1);
      const P = b.pos.data;
      const N = b.nor.data;
      const C = b.col.data;
      let o = b.pos.length;
      for (let i = 0; i < n; i++, o += 3) {
        _v.fromBufferAttribute(pos, i).applyMatrix4(m);
        P[o] = _v.x;
        P[o + 1] = _v.y;
        P[o + 2] = _v.z;
        _v.fromBufferAttribute(nor, i).applyMatrix3(_n).normalize();
        N[o] = _v.x;
        N[o + 1] = _v.y;
        N[o + 2] = _v.z;
        C[o] = col.getX(i) * _c.r;
        C[o + 1] = col.getY(i) * _c.g;
        C[o + 2] = col.getZ(i) * _c.b;
      }
      b.pos.length += n * 3;
      b.nor.length += n * 3;
      b.col.length += n * 3;
    }
  }

  /** Bake once everything has been added. */
  build(name = 'static'): THREE.Group {
    this.group.name = name;
    for (const cell of this.cells.values()) {
      for (const [mat, b] of cell.buckets) {
        if (!b.pos.length) continue;
        const geom = new THREE.BufferGeometry();
        // Positions are cell-local to keep float precision far from the origin.
        const pos = b.pos.view();
        for (let i = 0; i < pos.length; i += 3) {
          pos[i] -= cell.cx;
          pos[i + 2] -= cell.cz;
        }
        geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geom.setAttribute('normal', new THREE.BufferAttribute(b.nor.view(), 3));
        geom.setAttribute('color', new THREE.BufferAttribute(b.col.view(), 3));
        geom.computeBoundingSphere();
        const mesh = new THREE.Mesh(geom, material(mat));
        mesh.position.set(cell.cx, 0, cell.cz);
        mesh.castShadow = mat !== 'glow' && mat !== 'glass' && mat !== 'ground' && mat !== 'marks';
        mesh.receiveShadow = mat !== 'glow';
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        this.group.add(mesh);
        this.meshes.push({ mesh, cx: cell.cx, cz: cell.cz });
      }
    }
    this.cells.clear();
    return this.group;
  }

  /** Hide cells beyond `range` metres. */
  cull(x: number, z: number, range: number): void {
    const r2 = (range + this.cell) * (range + this.cell);
    for (const m of this.meshes) {
      const dx = m.cx - x;
      const dz = m.cz - z;
      m.mesh.visible = dx * dx + dz * dz < r2;
    }
  }
}

/** Flags the first `count` floats of an instance buffer for upload, and nothing past them. */
export function markRange(attr: THREE.BufferAttribute, count: number): void {
  attr.clearUpdateRanges();
  attr.addUpdateRange(0, Math.min(count, attr.array.length));
  attr.needsUpdate = true;
}

/**
 * A model drawn many times with per-instance matrices and tints. One InstancedMesh per
 * surface and tint slot.
 */
export class InstancedModel {
  readonly group = new THREE.Group();
  readonly meshes: { mesh: THREE.InstancedMesh; tint?: string }[] = [];
  private dirtyColor = false;

  constructor(
    model: Prepared | Model,
    readonly capacity: number,
    opts: { shadows?: boolean; receive?: boolean; dynamic?: boolean; materials?: Partial<Record<MatKind, THREE.Material>> } = {},
  ) {
    const prepared = Array.isArray(model) ? prepare(model) : model;
    for (const g of prepared.groups) {
      const mat = opts.materials?.[g.mat] ?? material(g.mat);
      const mesh = new THREE.InstancedMesh(g.geom, mat, capacity);
      mesh.castShadow = (opts.shadows ?? true) && g.mat !== 'glow' && g.mat !== 'glass';
      mesh.receiveShadow = (opts.receive ?? true) && g.mat !== 'glow';
      mesh.frustumCulled = false;
      if (opts.dynamic ?? true) mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      if (g.tint) {
        for (let i = 0; i < capacity; i++) mesh.setColorAt(i, _c.setRGB(1, 1, 1));
      }
      this.group.add(mesh);
      this.meshes.push({ mesh, tint: g.tint });
    }
  }

  set count(n: number) {
    for (const m of this.meshes) {
      m.mesh.count = n;
      m.mesh.visible = n > 0;
    }
  }

  get count(): number {
    return this.meshes[0]?.mesh.count ?? 0;
  }

  setMatrix(i: number, m: THREE.Matrix4): void {
    for (const s of this.meshes) s.mesh.setMatrixAt(i, m);
  }

  setTint(i: number, slot: string, color: THREE.Color | number): void {
    if (typeof color === 'number') _c.set(color);
    else _c.copy(color);
    for (const s of this.meshes) {
      if (s.tint === slot) s.mesh.setColorAt(i, _c);
    }
    this.dirtyColor = true;
  }

  /** Uploads only the slots in use. The buffers are sized for the worst case, which is rarely drawn. */
  commit(): void {
    for (const s of this.meshes) {
      const n = s.mesh.count;
      if (n > 0) markRange(s.mesh.instanceMatrix, n * 16);
      if (this.dirtyColor && s.mesh.instanceColor && n > 0) markRange(s.mesh.instanceColor, n * 3);
    }
    this.dirtyColor = false;
  }

  /** For static instances: compute bounds so the group can be culled. */
  finalize(): void {
    for (const s of this.meshes) {
      s.mesh.frustumCulled = true;
      s.mesh.computeBoundingSphere();
      s.mesh.instanceMatrix.clearUpdateRanges();
      s.mesh.instanceMatrix.needsUpdate = true;
      s.mesh.instanceColor?.clearUpdateRanges();
      if (s.mesh.instanceColor) s.mesh.instanceColor.needsUpdate = true;
    }
  }
}
