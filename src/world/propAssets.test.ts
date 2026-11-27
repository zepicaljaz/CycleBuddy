import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';
import { PROP_MODELS, toPropGeometry } from './propAssets';

// Read the files straight from disk. The project ships no Node types, so node:fs comes in
// through a non-literal import (typed any) instead of a typed one.
const FS = 'node:fs';
const fs = await import(/* @vite-ignore */ FS);
const DIR = new URL('../assets/models/', import.meta.url);
const BYTES = new Map<string, Uint8Array>(
  (fs.readdirSync(DIR) as string[])
    .filter((f) => f.endsWith('.glb'))
    .map((f) => [f, new Uint8Array(fs.readFileSync(new URL(f, DIR)))] as const),
);
const files = [...BYTES.keys()].sort();

async function load(file: string): Promise<{ gltf: { scene: THREE.Object3D; parser: { json: any } }; bytes: number }> {
  const u8 = BYTES.get(file);
  if (!u8) throw new Error(`missing ${file}`);
  const gltf = await new GLTFLoader().parseAsync(u8.slice().buffer, '');
  return { gltf: gltf as never, bytes: u8.byteLength };
}

/** Allowed size of each family at scale 1, metres: [min, max] of width (largest of x/z) and height. */
const FAMILY: Record<string, { tris: [number, number]; width: [number, number]; height: [number, number] }> = {
  tree: { tris: [100, 300], width: [1.5, 10], height: [7, 13] },
  mugo: { tris: [100, 300], width: [2.5, 5], height: [0.8, 2.2] },
  boulder: { tris: [30, 150], width: [1, 3.5], height: [0.6, 2.6] },
  scree: { tris: [30, 150], width: [4, 6.5], height: [0.1, 1] },
  cliff: { tris: [30, 150], width: [10, 20], height: [6, 15] },
};

const familyOf = (name: string) =>
  name.startsWith('mugo') ? 'mugo' : name.startsWith('boulder') ? 'boulder' : name.startsWith('scree') ? 'scree' : name.startsWith('cliff') ? 'cliff' : 'tree';

describe('prop models (GLB)', () => {
  it('has a file for every registered model, and a far version of every tree', () => {
    const names = new Set(files.map((f) => f.replace(/\.glb$/, '')));
    const all = [...PROP_MODELS.trees, ...PROP_MODELS.boulders, ...PROP_MODELS.scree, ...PROP_MODELS.cliffs];
    for (const n of all) expect(names.has(n), n).toBe(true);
    for (const n of PROP_MODELS.trees) expect(names.has(`${n}_far`), `${n}_far`).toBe(true);
  });

  for (const file of files) {
    const name = file.replace(/\.glb$/, '');
    it(`${name}: small, only POSITION/NORMAL/COLOR_0, within budget and size, on the ground`, async () => {
      const { gltf, bytes } = await load(file);
      expect(bytes).toBeLessThan(30 * 1024);
      const json = gltf.parser.json;
      expect(json.meshes).toHaveLength(1);
      expect(json.images ?? []).toHaveLength(0);
      expect(json.textures ?? []).toHaveLength(0);
      for (const prim of json.meshes[0].primitives) {
        expect(Object.keys(prim.attributes).sort()).toEqual(['COLOR_0', 'NORMAL', 'POSITION']);
      }

      const g = toPropGeometry(gltf.scene);
      expect(g).not.toBeNull();
      const geom = g!;
      expect(geom.index).toBeNull();
      expect(Object.keys(geom.attributes).sort()).toEqual(['color', 'normal', 'position']);
      for (const a of ['position', 'normal', 'color']) {
        const attr = geom.getAttribute(a) as THREE.BufferAttribute;
        expect(attr.itemSize).toBe(3);
        expect(attr.array).toBeInstanceOf(Float32Array);
        expect(attr.array.every((v: number) => Number.isFinite(v))).toBe(true);
      }
      const col = geom.getAttribute('color').array as Float32Array;
      expect(Math.min(...col)).toBeGreaterThanOrEqual(0);
      expect(Math.max(...col)).toBeLessThanOrEqual(1);

      const tris = geom.getAttribute('position').count / 3;
      const fam = FAMILY[familyOf(name)];
      if (name.endsWith('_far')) {
        // Far trees: well under the near model, which is what makes them worth having.
        const near = toPropGeometry((await load(file.replace('_far', ''))).gltf.scene)!;
        expect(tris).toBeLessThanOrEqual(near.getAttribute('position').count / 3 * 0.5);
        expect(tris).toBeGreaterThanOrEqual(24);
      } else {
        expect(tris).toBeGreaterThanOrEqual(fam.tris[0]);
        expect(tris).toBeLessThanOrEqual(fam.tris[1]);
      }

      const box = geom.boundingBox!;
      // Origin at the ground centre, +Y up: the base sits on y = 0 (scree bedded in a little).
      expect(Math.abs(box.min.y)).toBeLessThan(0.15);
      expect(Math.abs((box.min.x + box.max.x) / 2)).toBeLessThan(familyOf(name) === 'cliff' ? 1 : 1.5);
      const size = box.getSize(new THREE.Vector3());
      const width = Math.max(size.x, size.z);
      expect(width).toBeGreaterThanOrEqual(fam.width[0]);
      expect(width).toBeLessThanOrEqual(fam.width[1]);
      expect(size.y).toBeGreaterThanOrEqual(fam.height[0]);
      expect(size.y).toBeLessThanOrEqual(fam.height[1]);
    });
  }

  it('cliff faces open to +Z: most front-facing area points toward +Z', async () => {
    for (const name of PROP_MODELS.cliffs) {
      const g = toPropGeometry((await load(`${name}.glb`)).gltf.scene)!;
      const n = g.getAttribute('normal');
      let front = 0;
      let backFacing = 0;
      for (let i = 0; i < n.count; i++) {
        if (n.getZ(i) > 0.3) front++;
        if (n.getZ(i) < -0.3) backFacing++;
      }
      expect(front).toBeGreaterThan(backFacing * 3);
    }
  });
});

describe('preloadPropAssets', () => {
  it('never rejects, loads once, and leaves missing models to the code-built fallback', async () => {
    const { preloadPropAssets, propAsset } = await import('./propAssets');
    const warn = console.warn;
    let warnings = 0;
    console.warn = () => void warnings++;
    try {
      const a = preloadPropAssets();
      expect(preloadPropAssets()).toBe(a);
      await expect(a).resolves.toBeUndefined();
      await preloadPropAssets();
    } finally {
      console.warn = warn;
    }
    // In Node the asset URLs cannot be fetched, so nothing loads and one warning is logged.
    expect(warnings).toBeLessThanOrEqual(1);
    expect(propAsset('no_such_model')).toBeNull();
    expect(propAsset('no_such_model', true)).toBeNull();
  });
});
