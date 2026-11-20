import * as THREE from 'three';

/**
 * The lake is a grid projected from the camera onto the water plane. A world-sized
 * mesh centred on the camera had triangles that crossed the near plane; those
 * clipped into a black sheet for a frame whenever the road ran past houses.
 */
const VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
varying vec3 vWorld;
varying vec3 vView;
varying float vValid;
uniform float uTime;
uniform float uLevel;
uniform mat4 uInvVP;

vec3 gerstner(vec3 p, vec2 dir, float steep, float wave, float speed) {
  float k = 6.28318 / wave;
  float a = steep / k;
  float f = k * (dot(dir, p.xz) - speed * uTime);
  float s = sin(f);
  float c = cos(f);
  return vec3(dir.x * a * c, a * s, dir.y * a * c);
}

void main() {
  vec4 n4 = uInvVP * vec4(position.xy, -1.0, 1.0);
  vec4 f4 = uInvVP * vec4(position.xy, 1.0, 1.0);
  vec3 nearW = n4.xyz / n4.w;
  vec3 farW = f4.xyz / f4.w;
  vec3 dir = farW - nearW;
  float denom = dir.y;
  float t = (uLevel - nearW.y) / denom;
  vec3 p;
  bool hit = abs(denom) > 1e-5 && t > 0.0;
  if (hit) {
    p = nearW + dir * t;
    vec2 h = p.xz - cameraPosition.xz;
    float hl = length(h);
    if (hl > 1800.0) p.xz = cameraPosition.xz + h * (1800.0 / hl);
  } else {
    vec3 horiz = vec3(dir.x, 0.0, dir.z);
    float fl = length(horiz);
    horiz = fl > 1e-5 ? horiz / fl : vec3(0.0, 0.0, 1.0);
    p = vec3(cameraPosition.x, uLevel, cameraPosition.z) + horiz * 1800.0;
  }
  p += gerstner(p, normalize(vec2(0.82, 0.38)), 0.18, 18.0, 1.6);
  p += gerstner(p, normalize(vec2(-0.45, 0.89)), 0.12, 9.5, 1.15);
  p += gerstner(p, normalize(vec2(0.2, -0.98)), 0.07, 4.2, 1.9);
  vWorld = p;
  vView = cameraPosition - vWorld;
  vec4 mvPosition = viewMatrix * vec4(p, 1.0);
  vec4 clip = projectionMatrix * mvPosition;
  // A wave that crosses the camera gets a negative clip w. Dividing by that
  // wraps one triangle over the whole picture. Push the vertex just outside
  // the frustum on the same side and let the clipper cut it.
  if (!hit) {
    gl_Position = vec4(position.xy, 1.0, 1.0);
    vValid = 0.0;
  } else if (clip.w <= 0.0) {
    gl_Position = vec4(clip.xy, 0.0, 0.0001);
    vValid = 0.0;
  } else {
    gl_Position = clip;
    vValid = 1.0;
  }
  #include <fog_vertex>
  #include <logdepthbuf_vertex>
}
`;

const FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
varying vec3 vWorld;
varying vec3 vView;
varying float vValid;
uniform float uTime;
uniform vec3 uSun;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform float uLevel;

void main() {
  // A grid cell that misses the plane interpolates into a sheet across the
  // picture. Keep only cells where every corner actually hit the water.
  if (vValid < 0.999) discard;
  #include <logdepthbuf_fragment>
  vec3 V = normalize(vView);
  vec3 N = normalize(vec3(
    0.08 * sin(vWorld.x * 0.18 + uTime * 0.7) + 0.04 * sin(vWorld.z * 0.41 + uTime * 1.1),
    1.0,
    0.08 * cos(vWorld.z * 0.16 + uTime * 0.6) + 0.04 * cos(vWorld.x * 0.33 + uTime * 0.9)
  ));
  float fres = pow(1.0 - max(0.0, dot(N, V)), 3.2);
  float sun = pow(max(0.0, dot(reflect(-normalize(uSun), N), V)), 48.0);
  float sparkle = pow(max(0.0, sin(vWorld.x * 2.4 + vWorld.z * 1.7 + uTime * 3.0)), 24.0) * 0.12;
  float depth = smoothstep(0.0, 7.0, max(0.0, uLevel + 0.4 - vWorld.y));
  vec3 col = mix(uShallow, uDeep, depth);
  col = mix(col, vec3(0.78, 0.88, 0.92), fres * 0.55);
  col += vec3(1.0, 0.96, 0.85) * sun * 0.85;
  col += vec3(0.9, 0.95, 1.0) * sparkle;
  float foam = pow(max(0.0, sin(vWorld.x * 0.7 + uTime) * 0.5 + 0.5), 8.0) * 0.04;
  col = mix(col, vec3(0.92, 0.95, 0.97), foam);
  if (col.r != col.r || col.g != col.g || col.b != col.b) discard;
  gl_FragColor = vec4(clamp(col, 0.0, 2.5), 0.9);
  #include <fog_fragment>
}
`;

const COLORS: Record<string, { deep: number; shallow: number }> = {
  alpine: { deep: 0x1b5f78, shallow: 0x3aa0b5 },
  limestone: { deep: 0x147a88, shallow: 0x3eb8c4 },
  desert: { deep: 0x1c6a7a, shallow: 0x4aa8b0 },
  moor: { deep: 0x2a4650, shallow: 0x4d6e78 },
  spruce: { deep: 0x1a4040, shallow: 0x3a6e62 },
};

export class Water {
  readonly mesh: THREE.Mesh;
  private readonly mat: THREE.ShaderMaterial;
  private readonly sun = new THREE.Vector3(0.4, 0.8, 0.3);
  private readonly invVP = new THREE.Matrix4();
  private readonly projInv = new THREE.Matrix4();

  constructor(level: number, biome: string) {
    const pal = COLORS[biome] ?? COLORS.alpine;
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uSun: { value: this.sun },
        uDeep: { value: new THREE.Color(pal.deep) },
        uShallow: { value: new THREE.Color(pal.shallow) },
        uLevel: { value: level },
        uInvVP: { value: new THREE.Matrix4() },
        fogColor: { value: new THREE.Color(0xffffff) },
        fogDensity: { value: 0.00025 },
        fogNear: { value: 1 },
        fogFar: { value: 2000 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      lights: false,
      fog: true,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2, 96, 96), this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.receiveShadow = false;
    this.mesh.castShadow = false;
    this.mesh.name = 'water';
  }

  update(dt: number, camera: THREE.PerspectiveCamera, sunDir: THREE.Vector3): void {
    this.mat.uniforms.uTime.value += dt;
    this.sun.copy(sunDir);
    camera.updateMatrixWorld();
    this.projInv.copy(camera.projectionMatrix).invert();
    this.invVP.multiplyMatrices(camera.matrixWorld, this.projInv);
    (this.mat.uniforms.uInvVP.value as THREE.Matrix4).copy(this.invVP);
  }
}
