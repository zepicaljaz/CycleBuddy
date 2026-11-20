import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Flat-shaded geometry with a baked vertex colour. */
export function colored(geom: THREE.BufferGeometry, hex: number, jitter = 0, seed = 1): THREE.BufferGeometry {
  const g = geom.index ? geom.toNonIndexed() : geom.clone();
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  const base = new THREE.Color(hex);
  const count = g.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  let s = seed;
  for (let i = 0; i < count; i += 3) {
    s = (s * 16807) % 2147483647;
    const k = 1 + ((s / 2147483647) * 2 - 1) * jitter;
    for (let v = 0; v < 3; v++) {
      colors[(i + v) * 3] = base.r * k;
      colors[(i + v) * 3 + 1] = base.g * k;
      colors[(i + v) * 3 + 2] = base.b * k;
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

const merge = (parts: THREE.BufferGeometry[]) => {
  const g = mergeGeometries(parts, false);
  if (!g) throw new Error('merge failed');
  g.computeBoundingSphere();
  return g;
};

export function pineDetailed(): THREE.BufferGeometry {
  const trunk = colored(new THREE.CylinderGeometry(0.22, 0.32, 3, 5).translate(0, 1.5, 0), 0x6b4a32);
  const tiers = [
    { r: 2.6, h: 4.2, y: 3.6, c: 0x2f5d34 },
    { r: 2.0, h: 3.6, y: 5.9, c: 0x356b3a },
    { r: 1.35, h: 3.0, y: 7.9, c: 0x3c7741 },
  ].map((t, i) => colored(new THREE.ConeGeometry(t.r, t.h, 7).translate(0, t.y, 0).rotateY(i * 0.7), t.c, 0.06, i + 3));
  return merge([trunk, ...tiers]);
}

/** Narrow, dark conifer. Used where a forest is spruce and nothing else. */
export function spruceDetailed(): THREE.BufferGeometry {
  const trunk = colored(new THREE.CylinderGeometry(0.16, 0.26, 3.6, 5).translate(0, 1.8, 0), 0x5a4030);
  const tiers = [
    { r: 1.55, h: 3.2, y: 3.1, c: 0x1c4428 },
    { r: 1.25, h: 2.9, y: 4.8, c: 0x214e30 },
    { r: 0.95, h: 2.6, y: 6.3, c: 0x275836 },
    { r: 0.58, h: 2.2, y: 7.7, c: 0x2d6240 },
  ].map((t, i) => colored(new THREE.ConeGeometry(t.r, t.h, 7).translate(0, t.y, 0).rotateY(i * 0.55), t.c, 0.05, i + 11));
  return merge([trunk, ...tiers]);
}

export function spruceSimple(): THREE.BufferGeometry {
  const trunk = colored(new THREE.CylinderGeometry(0.18, 0.24, 2.2, 4).translate(0, 1.1, 0), 0x5a4030);
  const crown = colored(new THREE.ConeGeometry(1.25, 8.2, 6).translate(0, 5.4, 0), 0x214e30, 0.05, 8);
  return merge([trunk, crown]);
}

export function pineSimple(): THREE.BufferGeometry {
  const trunk = colored(new THREE.CylinderGeometry(0.25, 0.3, 2, 4).translate(0, 1, 0), 0x6b4a32);
  const crown = colored(new THREE.ConeGeometry(2.4, 8, 5).translate(0, 5.5, 0), 0x32633a, 0.05, 2);
  return merge([trunk, crown]);
}

export function broadleafDetailed(crown: readonly [number, number, number] = [0x5f8f37, 0x6c9c3d, 0x56853a]): THREE.BufferGeometry {
  const trunk = colored(new THREE.CylinderGeometry(0.2, 0.32, 3.2, 5).translate(0, 1.6, 0), 0x6e5038);
  const c1 = colored(new THREE.IcosahedronGeometry(2.6, 0).scale(1, 0.85, 1).translate(0, 4.6, 0), crown[0], 0.08, 4);
  const c2 = colored(new THREE.IcosahedronGeometry(1.7, 0).translate(1.1, 5.6, 0.6), crown[1], 0.08, 5);
  const c3 = colored(new THREE.IcosahedronGeometry(1.5, 0).translate(-1.0, 5.2, -0.8), crown[2], 0.08, 6);
  return merge([trunk, c1, c2, c3]);
}

export function broadleafSimple(crown = 0x5f8f37): THREE.BufferGeometry {
  const trunk = colored(new THREE.CylinderGeometry(0.25, 0.3, 2.6, 4).translate(0, 1.3, 0), 0x6e5038);
  const top = colored(new THREE.IcosahedronGeometry(2.8, 0).scale(1, 0.9, 1).translate(0, 4.6, 0), crown, 0.06, 7);
  return merge([trunk, top]);
}

function boulder(hex: number, seed: number): THREE.BufferGeometry {
  const g = new THREE.DodecahedronGeometry(1, 0);
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const k = 0.8 + Math.abs(Math.sin(x * 12.9 + y * 78.2 + z * 37.7)) * 0.35;
    pos.setXYZ(i, x * k * 1.2, y * k * 0.7, z * k);
  }
  return merge([colored(g, hex, 0.12, seed)]);
}

export function rock(): THREE.BufferGeometry {
  return boulder(0x8a847b, 9);
}

/** Rust-coloured boulder for the desert. */
export function rockWarm(): THREE.BufferGeometry {
  return boulder(0xc47a48, 13);
}

/** Low dry bush. About a metre tall before the terrain scale. */
export function shrub(crown: readonly [number, number, number] = [0x8d8a3e, 0xa08a48, 0x6f6a32]): THREE.BufferGeometry {
  const stem = colored(new THREE.CylinderGeometry(0.05, 0.08, 0.4, 4).translate(0, 0.18, 0), 0x6b5340);
  const a = colored(new THREE.IcosahedronGeometry(0.55, 0).scale(1.35, 0.65, 1.15).translate(0, 0.5, 0), crown[0], 0.08, 2);
  const b = colored(new THREE.IcosahedronGeometry(0.36, 0).scale(1.2, 0.7, 1).translate(0.42, 0.42, 0.18), crown[1], 0.08, 3);
  const c = colored(new THREE.IcosahedronGeometry(0.3, 0).translate(-0.36, 0.4, -0.12), crown[2], 0.06, 4);
  return merge([stem, a, b, c]);
}

/** Simple saguaro, facing no particular direction. */
export function cactus(): THREE.BufferGeometry {
  const trunk = colored(new THREE.CylinderGeometry(0.16, 0.2, 1.7, 6).translate(0, 0.85, 0), 0x6e8a4a);
  const arm = (rot: number) =>
    colored(new THREE.CylinderGeometry(0.1, 0.12, 0.75, 5).translate(0, 0.38, 0).rotateZ(rot).translate(Math.sign(rot) * 0.22, 0.85, 0), 0x7d9a52);
  return merge([trunk, arm(1.05), arm(-0.95)]);
}

export function cloud(): THREE.BufferGeometry {
  const parts = [
    new THREE.IcosahedronGeometry(90, 0).scale(1.4, 0.6, 1).translate(0, 0, 0),
    new THREE.IcosahedronGeometry(70, 0).scale(1.2, 0.7, 1).translate(110, -10, 20),
    new THREE.IcosahedronGeometry(65, 0).scale(1.2, 0.6, 1).translate(-105, -15, -10),
    new THREE.IcosahedronGeometry(55, 0).translate(40, 35, -5),
  ].map((g, i) => colored(g, 0xffffff, 0.03, i + 11));
  return merge(parts);
}

/** House walls and roof as separate geometries so each can be tinted per instance. */
export function houseWalls(): THREE.BufferGeometry {
  const walls = colored(new THREE.BoxGeometry(8, 5, 6).translate(0, 2.5, 0), 0xffffff);
  const door = colored(new THREE.BoxGeometry(0.1, 2.2, 1.2).translate(4.02, 1.1, 0), 0x6a4a35);
  const windows = [-2, 2].map((z, i) => colored(new THREE.BoxGeometry(0.1, 1.1, 1.0).translate(4.02, 3.3, z), 0x3d5566, 0, i));
  const windowsSide = [-2, 2].map((x, i) => colored(new THREE.BoxGeometry(1.0, 1.1, 0.1).translate(x, 3.3, 3.02), 0x3d5566, 0, i));
  return merge([walls, door, ...windows, ...windowsSide]);
}

export function houseRoof(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-4.8, 0);
  shape.lineTo(4.8, 0);
  shape.lineTo(0, 3.2);
  shape.lineTo(-4.8, 0);
  const g = new THREE.ExtrudeGeometry(shape, { depth: 7.2, bevelEnabled: false });
  g.translate(0, 5, -3.6);
  g.rotateY(Math.PI / 2);
  return merge([colored(g, 0xffffff)]);
}

/** Car body and wheels, facing local +x. Body is white so the instance colour tints it. */
export function carBody(): THREE.BufferGeometry {
  const body = colored(new THREE.BoxGeometry(4.3, 0.7, 1.75).translate(0, 0.62, 0), 0xffffff);
  const cabin = colored(new THREE.BoxGeometry(2.1, 0.55, 1.55).translate(-0.15, 1.15, 0), 0xd8dde4);
  const wheel = (x: number, z: number) => colored(new THREE.CylinderGeometry(0.34, 0.34, 0.22, 8).rotateX(Math.PI / 2).translate(x, 0.34, z), 0x1a1c20);
  return merge([body, cabin, wheel(1.35, 0.82), wheel(1.35, -0.82), wheel(-1.35, 0.82), wheel(-1.35, -0.82)]);
}

/** National flag cloth. Stripes are baked so each instance can still tint the whole flag. */
export function flagCloth(): THREE.BufferGeometry {
  return nationFlag(0);
}

export const FLAG_NATIONS = 8;

/** Vertical or horizontal tricolours and a couple of crosses, painted in local colours. */
export function nationFlag(kind: number): THREE.BufferGeometry {
  const w = 0.95;
  const h = 0.62;
  const x = 0.02;
  const y = 2.15;
  const z0 = 0.08;
  const parts: THREE.BufferGeometry[] = [];
  const stripe = (zA: number, zB: number, yA: number, yB: number, c: number) =>
    colored(new THREE.BoxGeometry(0.03, yB - yA, zB - zA).translate(x, (yA + yB) / 2, (zA + zB) / 2), c);
  const k = ((kind % FLAG_NATIONS) + FLAG_NATIONS) % FLAG_NATIONS;
  if (k === 0) {
    // France
    parts.push(stripe(z0, z0 + w / 3, y - h / 2, y + h / 2, 0x0055a4), stripe(z0 + w / 3, z0 + (2 * w) / 3, y - h / 2, y + h / 2, 0xf4f4f4), stripe(z0 + (2 * w) / 3, z0 + w, y - h / 2, y + h / 2, 0xef4135));
  } else if (k === 1) {
    // Italy
    parts.push(stripe(z0, z0 + w / 3, y - h / 2, y + h / 2, 0x008c45), stripe(z0 + w / 3, z0 + (2 * w) / 3, y - h / 2, y + h / 2, 0xf4f4f4), stripe(z0 + (2 * w) / 3, z0 + w, y - h / 2, y + h / 2, 0xcd212a));
  } else if (k === 2) {
    // Belgium
    parts.push(stripe(z0, z0 + w / 3, y - h / 2, y + h / 2, 0x1a1a1a), stripe(z0 + w / 3, z0 + (2 * w) / 3, y - h / 2, y + h / 2, 0xfada00), stripe(z0 + (2 * w) / 3, z0 + w, y - h / 2, y + h / 2, 0xef3340));
  } else if (k === 3) {
    // Netherlands
    parts.push(stripe(z0, z0 + w, y + h / 6, y + h / 2, 0xae1c28), stripe(z0, z0 + w, y - h / 6, y + h / 6, 0xf4f4f4), stripe(z0, z0 + w, y - h / 2, y - h / 6, 0x21468b));
  } else if (k === 4) {
    // Spain
    parts.push(stripe(z0, z0 + w, y + h / 4, y + h / 2, 0xc60b1e), stripe(z0, z0 + w, y - h / 4, y + h / 4, 0xffc400), stripe(z0, z0 + w, y - h / 2, y - h / 4, 0xc60b1e));
  } else if (k === 5) {
    // Germany
    parts.push(stripe(z0, z0 + w, y + h / 6, y + h / 2, 0x1a1a1a), stripe(z0, z0 + w, y - h / 6, y + h / 6, 0xdd0000), stripe(z0, z0 + w, y - h / 2, y - h / 6, 0xffce00));
  } else if (k === 6) {
    // Slovenia
    parts.push(stripe(z0, z0 + w, y + h / 6, y + h / 2, 0xf4f4f4), stripe(z0, z0 + w, y - h / 6, y + h / 6, 0x005ce5), stripe(z0, z0 + w, y - h / 2, y - h / 6, 0xe4002b));
  } else {
    // Denmark
    parts.push(colored(new THREE.BoxGeometry(0.03, h, w).translate(x, y, z0 + w / 2), 0xc60c30));
    parts.push(colored(new THREE.BoxGeometry(0.031, h, 0.12).translate(x, y, z0 + w * 0.38), 0xf4f4f4));
    parts.push(colored(new THREE.BoxGeometry(0.031, 0.12, w).translate(x, y, z0 + w / 2), 0xf4f4f4));
  }
  return merge(parts);
}

export function flagPole(): THREE.BufferGeometry {
  return merge([colored(new THREE.CylinderGeometry(0.035, 0.04, 2.5, 5).translate(0, 1.25, 0), 0xc5c8ce)]);
}

/**
 * Crowd motion for instanced spectators.
 * `bob` is a cheer: the body bounces, and a fist or flag out past the shoulders
 * pumps. The head stays on the bounce because it sits inside that reach.
 * `flag` waves cloth near the top of a pole.
 */
export function addCrowdMotion(material: THREE.Material, time: { value: number }, kind: 'bob' | 'flag'): void {
  const motion =
    kind === 'bob'
      ? `float w = sin(uTime * 3.2 + ph);
  transformed.y += w * 0.028 * smoothstep(0.2, 0.85, transformed.y);
  float reach = length(transformed.xz);
  // Whole limb crosses this together, so a fist stays on its wrist. Body and head stay inside it.
  float member = smoothstep(0.23, 0.28, reach) * smoothstep(0.62, 0.88, transformed.y);
  float wave = sin(uTime * 5.2 + ph);
  transformed.y += wave * 0.045 * member;
  transformed.z += cos(uTime * 4.4 + ph) * 0.06 * member;
  float cloth = smoothstep(0.5, 0.62, reach);
  transformed.y += sin(uTime * 7.5 + ph * 1.4 + reach * 8.0) * 0.03 * cloth;
  transformed.x += cos(uTime * 6.0 + ph) * 0.018 * cloth;`
      : `float w = sin(uTime * 3.1 + ph);
  float h = smoothstep(1.5, 2.3, transformed.y);
  transformed.x += w * 0.28 * h;
  transformed.z += cos(uTime * 2.3 + ph * 1.3) * 0.1 * h;`;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
#ifdef USE_INSTANCING
  vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
  float ph = ip.x * 0.35 + ip.z * 0.47;
  ${motion}
#endif`,
      );
  };
}

/** Adds gentle wind sway to instanced vegetation. */
export function addWindSway(material: THREE.Material, time: { value: number }, strength = 0.02): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
#ifdef USE_INSTANCING
  vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
  float ph = ip.x * 0.05 + ip.z * 0.07;
  float hgt = max(transformed.y - 2.0, 0.0);
  transformed.x += sin(uTime * 1.4 + ph) * ${strength.toFixed(3)} * hgt;
  transformed.z += cos(uTime * 1.1 + ph * 1.3) * ${(strength * 0.8).toFixed(3)} * hgt;
#endif`,
      );
  };
}
