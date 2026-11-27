import * as THREE from 'three';

/**
 * Low-poly trees and rocks made in Blender (scripts/blender/, see the CLAUDE.md there)
 * and shipped as small GLB files. Each file is its own hashed asset, fetched only
 * when a ride starts, and GLTFLoader is imported dynamically, so neither lands in the
 * boot chunk.
 *
 * Every model becomes a BufferGeometry shaped exactly like the code-built props in
 * models.ts: non-indexed, with `position`, `normal` and `color` (Float32, 3 per
 * vertex, linear, flat per face). The wind-sway shader needs nothing else: it bends
 * by local height above 2 m. Anything missing (file not built, fetch failed, parse
 * failed) returns null, and callers fall back to the code-built geometry.
 */
const FILES = import.meta.glob('../assets/models/*.glb', { query: '?url', import: 'default' }) as Record<
  string,
  () => Promise<string>
>;

/**
 * What exists, by name. Far versions are `<name>_far` (about 40 % of the triangles)
 * and `propAsset(name, true)` finds them. `sway: false` models (rocks, cliffs, scree)
 * should not sit under a material with addWindSway if they are taller than 2 m:
 * the sway grows with height and would bend a cliff.
 */
export const PROP_MODELS = {
  /** Conifers and broadleaf trees, 9-12 m tall at scale 1 (mugo 1.6 m, holm oak 7.5 m). */
  trees: ['spruce_a', 'spruce_b', 'larch', 'mugo', 'scots_pine', 'aleppo_pine', 'cypress', 'beech', 'holm_oak'],
  /** 1.5-3 m angular boulders, the size of the code-built rock. */
  boulders: ['boulder_a', 'boulder_b', 'boulder_c', 'boulder_d', 'boulder_e'],
  /** 4-6 m flat spreads of small stones, under 0.5 m tall. For scree ground cover. */
  scree: ['scree_patch_a', 'scree_patch_b'],
  /** 11-18 m wide, 7-14 m tall rock faces. Front faces +Z, back open, base at y = 0. */
  cliffs: ['cliff_face_a', 'cliff_face_b', 'cliff_face_c'],
  /** Dwarf mountain pine for scrub / krummholz above the trees. */
  scrub: ['mugo'],
} as const;

const geoms = new Map<string, THREE.BufferGeometry>();
const owned = new WeakSet<THREE.BufferGeometry>();
let loading: Promise<void> | null = null;

const baseName = (path: string) => path.slice(path.lastIndexOf('/') + 1).replace(/\.glb$/, '');

/** Mesh geometry in the props' format (see the file comment). Null if there is no mesh. */
export function toPropGeometry(root: THREE.Object3D): THREE.BufferGeometry | null {
  root.updateMatrixWorld(true);
  let found: THREE.Mesh | null = null;
  root.traverse((o) => {
    if (!found && (o as THREE.Mesh).isMesh) found = o as THREE.Mesh;
  });
  if (!found) return null;
  const mesh = found as THREE.Mesh;
  const src = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
  src.applyMatrix4(mesh.matrixWorld);
  const pos = src.getAttribute('position');
  if (!pos) return null;
  const count = pos.count;
  const out = new THREE.BufferGeometry();
  const copy = (attr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute) => {
    // glTF may store normals or colours quantised (normalized ints) or colours as
    // RGBA; the instanced prop path expects plain Float32 RGB/XYZ.
    const a = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      a[i * 3] = attr.getX(i);
      a[i * 3 + 1] = attr.getY(i);
      a[i * 3 + 2] = attr.getZ(i);
    }
    return new THREE.BufferAttribute(a, 3);
  };
  out.setAttribute('position', copy(pos));
  const normal = src.getAttribute('normal');
  if (normal) out.setAttribute('normal', copy(normal));
  else out.computeVertexNormals();
  const color = src.getAttribute('color');
  if (color) out.setAttribute('color', copy(color));
  else {
    // No colours: neutral grey rather than black, so a broken export is visible but not a hole.
    const c = new Float32Array(count * 3).fill(0.5);
    out.setAttribute('color', new THREE.BufferAttribute(c, 3));
  }
  src.dispose();
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

async function loadAll(): Promise<void> {
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const loader = new GLTFLoader();
  const failed: string[] = [];
  await Promise.all(
    Object.entries(FILES).map(async ([path, url]) => {
      const name = baseName(path);
      try {
        const res = await fetch(await url());
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const gltf = await loader.parseAsync(await res.arrayBuffer(), '');
        const g = toPropGeometry(gltf.scene);
        if (!g) throw new Error('no mesh');
        owned.add(g);
        geoms.set(name, g);
      } catch {
        failed.push(name);
      }
    }),
  );
  if (failed.length) console.warn(`Prop models not loaded, using the code-built ones: ${failed.sort().join(', ')}`);
}

/**
 * Loads every prop model once. Safe to call any number of times and never rejects:
 * a failure is logged once and those props fall back to the code-built geometry.
 */
export function preloadPropAssets(): Promise<void> {
  if (!loading) {
    loading = loadAll().catch((err) => {
      console.warn('Prop models not loaded, using the code-built ones.', err);
    });
  }
  return loading;
}

/** A loaded model by name, its far version when `far` (or the near one if no far exists), or null. */
export function propAsset(name: string, far = false): THREE.BufferGeometry | null {
  if (far) return geoms.get(`${name}_far`) ?? geoms.get(name) ?? null;
  return geoms.get(name) ?? null;
}

/** Loaded models are shared by every world; owners must not dispose them. */
export function isPropAsset(g: THREE.BufferGeometry): boolean {
  return owned.has(g);
}
