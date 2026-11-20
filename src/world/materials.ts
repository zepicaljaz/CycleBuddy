import * as THREE from 'three';

/**
 * Shared surface types. Every model part names one of these, and all geometry carries
 * vertex colours, so one material per kind serves the whole world.
 */
export type MatKind =
  | 'matte'
  | 'rough'
  | 'gloss'
  | 'paint'
  | 'carpaint'
  | 'metal'
  | 'chrome'
  | 'glass'
  | 'glow'
  | 'rubber'
  | 'cloth'
  | 'foliage'
  | 'ground'
  | 'marks';

const cache = new Map<MatKind, THREE.Material>();

/**
 * Materials kept at module level and reused by the next World. Disposing one would
 * only force its shader to compile again, so World.dispose leaves these alone.
 */
export const SHARED_MATERIALS = new Set<THREE.Material>();

/** Marks a module-cached material so a world teardown does not dispose it. */
export function keepShared<T extends THREE.Material>(m: T): T {
  SHARED_MATERIALS.add(m);
  return m;
}

export function material(kind: MatKind): THREE.Material {
  let m = cache.get(kind);
  if (m) return m;
  m = keepShared(create(kind));
  cache.set(kind, m);
  return m;
}

function create(kind: MatKind): THREE.Material {
  const std = (o: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial({ vertexColors: true, ...o });
  switch (kind) {
    case 'matte':
      return std({ roughness: 0.86, metalness: 0 });
    case 'rough':
      return std({ roughness: 0.96, metalness: 0, envMapIntensity: 0.6 });
    case 'gloss':
      return std({ roughness: 0.42, metalness: 0.05 });
    case 'paint':
      return std({ roughness: 0.26, metalness: 0.42, envMapIntensity: 1.25 });
    case 'carpaint':
      // Coloured base under a clear coat: the colour holds at every angle, reflections build up at grazing angles.
      return new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.12, clearcoat: 1, clearcoatRoughness: 0.12, envMapIntensity: 1.1 });
    case 'metal':
      return std({ roughness: 0.38, metalness: 0.85 });
    case 'chrome':
      return std({ roughness: 0.14, metalness: 1, envMapIntensity: 1.4 });
    case 'glass':
      return std({ roughness: 0.08, metalness: 0.1, envMapIntensity: 1.5 });
    case 'glow':
      return new THREE.MeshBasicMaterial({ vertexColors: true });
    case 'rubber':
      return std({ roughness: 0.92, metalness: 0, envMapIntensity: 0.5 });
    case 'cloth':
      return std({ roughness: 0.9, metalness: 0, side: THREE.DoubleSide });
    case 'foliage':
      return std({ roughness: 0.92, metalness: 0, envMapIntensity: 0.55 });
    case 'ground':
      // Laid a few centimetres over the terrain or road; the offset keeps it from flickering.
      return std({ roughness: 0.95, metalness: 0, envMapIntensity: 0.4, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    case 'marks':
      return std({ roughness: 0.8, metalness: 0, envMapIntensity: 0.4, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -10 });
  }
}

/** One part of a model: geometry, the surface it uses, and an optional tint slot. */
export interface Part {
  geom: THREE.BufferGeometry;
  mat: MatKind;
  /** Instances can recolour this part. The geometry is usually white where it is tinted. */
  tint?: string;
}

export type Model = Part[];

/** Groups parts that share a surface and tint so each group is one draw call. */
export function groupParts(model: Model): { mat: MatKind; tint?: string; geoms: THREE.BufferGeometry[] }[] {
  const groups = new Map<string, { mat: MatKind; tint?: string; geoms: THREE.BufferGeometry[] }>();
  for (const p of model) {
    const key = `${p.mat}|${p.tint ?? ''}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { mat: p.mat, tint: p.tint, geoms: [] }));
    g.geoms.push(p.geom);
  }
  return [...groups.values()];
}
