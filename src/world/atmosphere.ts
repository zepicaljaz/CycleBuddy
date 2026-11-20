import * as THREE from 'three';
import { cloud } from './models';
import { mulberry32 } from '../util/math';

export type TimeOfDay = 'morning' | 'noon' | 'golden' | 'overcast';

export interface AtmospherePreset {
  label: string;
  sunElevation: number;
  sunAzimuth: number;
  sunColor: number;
  sunIntensity: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  zenith: number;
  horizon: number;
  sunGlow: number;
  fogColor: number;
  fogDensity: number;
  exposure: number;
  saturation: number;
  bloom: number;
  cloudColor: number;
  envIntensity: number;
  /** Even light under the sun. Golden Hour needs it; a face the low sun misses would otherwise go black. */
  fillColor: number;
  fillIntensity: number;
}

// Fog is the colour of the low sky in that light (a touch denser than it was), so
// far ridges fade into the horizon instead of into a grey or purple wash. Hemisphere
// skies lean cyan-grey rather than lavender, and the ground bounce is warmer.
export const ATMOSPHERES: Record<TimeOfDay, AtmospherePreset> = {
  morning: {
    label: 'Fresh morning',
    sunElevation: 18, sunAzimuth: 110,
    sunColor: 0xffdcb2, sunIntensity: 3.0,
    hemiSky: 0xb6d2ec, hemiGround: 0x82775a, hemiIntensity: 1.6,
    zenith: 0x5a8ed8, horizon: 0xe3e7e2, sunGlow: 0xfff0d8,
    fogColor: 0xd9e0e0, fogDensity: 0.0001,
    exposure: 1.0, saturation: 0.1, bloom: 0.45,
    cloudColor: 0xfffaf2, envIntensity: 0.8,
    fillColor: 0xfff2e4, fillIntensity: 0,
  },
  noon: {
    label: 'Bright noon',
    sunElevation: 58, sunAzimuth: 160,
    sunColor: 0xfff2de, sunIntensity: 3.4,
    hemiSky: 0xbed8f0, hemiGround: 0x786b50, hemiIntensity: 1.6,
    zenith: 0x3d7fd9, horizon: 0xd0e0ec, sunGlow: 0xffffff,
    fogColor: 0xcbdae6, fogDensity: 0.00008,
    exposure: 1.0, saturation: 0.12, bloom: 0.35,
    cloudColor: 0xffffff, envIntensity: 0.8,
    fillColor: 0xfff6ea, fillIntensity: 0,
  },
  golden: {
    label: 'Golden hour',
    sunElevation: 15, sunAzimuth: 250,
    sunColor: 0xffb066, sunIntensity: 4,
    hemiSky: 0xa9bfd6, hemiGround: 0x8a6a4b, hemiIntensity: 1.8,
    zenith: 0x4a78b8, horizon: 0xf4c792, sunGlow: 0xffc078,
    fogColor: 0xe8c49e, fogDensity: 0.000115,
    exposure: 1.05, saturation: 0.16, bloom: 0.8,
    cloudColor: 0xffd9b2, envIntensity: 0.75,
    fillColor: 0xffe0bc, fillIntensity: 0.65,
  },
  overcast: {
    label: 'Moody overcast',
    sunElevation: 40, sunAzimuth: 200,
    sunColor: 0xeeece6, sunIntensity: 1.3,
    hemiSky: 0xc8d0d6, hemiGround: 0x6e6b5e, hemiIntensity: 2.4,
    zenith: 0x8e9aa4, horizon: 0xc6ccd0, sunGlow: 0xe2e6e8,
    fogColor: 0xbfc5ca, fogDensity: 0.00017,
    exposure: 1.0, saturation: -0.02, bloom: 0.2,
    cloudColor: 0xd6dade, envIntensity: 0.9,
    fillColor: 0xece9e2, fillIntensity: 0,
  },
};

const skyVertex = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize((modelMatrix * vec4(position, 1.0)).xyz - cameraPosition);
  vec4 p = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

const skyFragment = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGlow;
uniform vec3 uSunDir;
uniform float uSunSize;
uniform vec3 uGround;
uniform float uGroundMix;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float h = clamp(d.y, -1.0, 1.0);
  float t = pow(clamp(h, 0.0, 1.0), 0.45);
  vec3 col = mix(uHorizon, uZenith, t);
  col = mix(col, mix(uHorizon * 0.85, uGround, uGroundMix), smoothstep(0.0, -0.25, h));
  float s = max(dot(d, uSunDir), 0.0);
  col += uGlow * pow(s, 8.0) * 0.35;
  col += uGlow * pow(s, 64.0) * 0.6;
  col += uGlow * smoothstep(uSunSize, uSunSize + 0.0006, s) * 6.0;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function linearToSrgb(x: number): number {
  return x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
}

/** Same sky the shader draws, as a texture the environment map can be built from. */
function skyImage(preset: AtmospherePreset, sun: THREE.Vector3): THREE.CanvasTexture {
  const w = 512;
  const h = 256;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('sky image');
  const img = ctx.createImageData(w, h);
  const data = img.data;
  const zenith = new THREE.Color(preset.zenith);
  const horizon = new THREE.Color(preset.horizon);
  const ground = new THREE.Color(preset.hemiGround);
  const glow = new THREE.Color(preset.sunGlow);
  for (let y = 0; y < h; y++) {
    // Canvas top is up. Equirectangular v = 1 is +Y, and a canvas texture is flipped on upload.
    const v = 1 - (y + 0.5) / h;
    const dirY = Math.sin((v - 0.5) * Math.PI);
    const cosLat = Math.cos(Math.asin(Math.min(1, Math.max(-1, dirY))));
    const up = Math.min(1, Math.max(-1, dirY));
    const skyT = Math.pow(Math.max(up, 0), 0.45);
    const below = smoothstep(0, -0.25, up);
    for (let x = 0; x < w; x++) {
      const lon = ((x + 0.5) / w - 0.5) * Math.PI * 2;
      const dx = Math.cos(lon) * cosLat;
      const dz = Math.sin(lon) * cosLat;
      let r = horizon.r + (zenith.r - horizon.r) * skyT;
      let g = horizon.g + (zenith.g - horizon.g) * skyT;
      let b = horizon.b + (zenith.b - horizon.b) * skyT;
      r += (ground.r - r) * below;
      g += (ground.g - g) * below;
      b += (ground.b - b) * below;
      const s = Math.max(dx * sun.x + dirY * sun.y + dz * sun.z, 0);
      const disc = smoothstep(0.9996, 0.9996 + 0.0006, s);
      const glowAmt = Math.pow(s, 8) * 0.35 + Math.pow(s, 64) * 0.6 + disc * 6;
      r += glow.r * glowAmt;
      g += glow.g * glowAmt;
      b += glow.b * glowAmt;
      const i = (y * w + x) * 4;
      data[i] = Math.min(255, Math.round(linearToSrgb(Math.max(0, r)) * 255));
      data[i + 1] = Math.min(255, Math.round(linearToSrgb(Math.max(0, g)) * 255));
      data[i + 2] = Math.min(255, Math.round(linearToSrgb(Math.max(0, b)) * 255));
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class Atmosphere {
  readonly sun = new THREE.DirectionalLight(0xffffff, 3);
  readonly hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
  readonly fill = new THREE.AmbientLight(0xffe2c4, 0);
  readonly sky: THREE.Mesh;
  readonly clouds: THREE.InstancedMesh;
  readonly sunDir = new THREE.Vector3();
  preset: AtmospherePreset = ATMOSPHERES.golden;
  private skyMat: THREE.ShaderMaterial;
  private cloudMat: THREE.MeshStandardMaterial;
  private envTarget: THREE.WebGLRenderTarget | null = null;

  constructor(private scene: THREE.Scene, cloudAltitude: number, center: THREE.Vector3) {
    this.skyMat = new THREE.ShaderMaterial({
      vertexShader: skyVertex,
      fragmentShader: skyFragment,
      uniforms: {
        uZenith: { value: new THREE.Color() },
        uHorizon: { value: new THREE.Color() },
        uGlow: { value: new THREE.Color() },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunSize: { value: 0.9996 },
        uGround: { value: new THREE.Color() },
        uGroundMix: { value: 0 },
      },
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 16), this.skyMat);
    this.sky.renderOrder = -1000;
    this.sky.frustumCulled = false;
    scene.add(this.sky);

    this.sun.castShadow = true;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 1200;
    this.sun.shadow.bias = -0.0004;
    // The constant bias above, plus the high-precision depth write, keeps a low
    // sun from turning a face black. A 12 cm normal push is a different problem:
    // at 15° it slides the shadow about half a metre off a person's shoes, so
    // the crowd reads as standing in the air. A 60 cm push was worse — it
    // sampled an 8 cm barrier into its own shadow. A few millimetres is enough.
    this.sun.shadow.normalBias = 0.005;
    this.setShadowExtent(110);
    scene.add(this.sun, this.sun.target, this.hemi, this.fill);

    this.cloudMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, emissive: 0x222222 });
    const count = 70;
    this.clouds = new THREE.InstancedMesh(cloud(), this.cloudMat, count);
    const rng = mulberry32(42);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    for (let i = 0; i < count; i++) {
      const a = rng() * Math.PI * 2;
      const r = 2000 + rng() * 16000;
      const s = 0.8 + rng() * 2.2;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * Math.PI * 2);
      m.compose(
        new THREE.Vector3(center.x + Math.cos(a) * r, cloudAltitude + rng() * 900, center.z + Math.sin(a) * r),
        q,
        new THREE.Vector3(s, s * (0.7 + rng() * 0.5), s),
      );
      this.clouds.setMatrixAt(i, m);
    }
    this.clouds.computeBoundingSphere();
    this.clouds.frustumCulled = false;
    scene.add(this.clouds);
  }

  setShadowExtent(halfSize: number): void {
    const cam = this.sun.shadow.camera;
    cam.left = -halfSize;
    cam.right = halfSize;
    cam.top = halfSize;
    cam.bottom = -halfSize;
    cam.updateProjectionMatrix();
  }

  apply(preset: AtmospherePreset, renderer: THREE.WebGLRenderer): void {
    this.preset = preset;
    const el = THREE.MathUtils.degToRad(preset.sunElevation);
    const az = THREE.MathUtils.degToRad(preset.sunAzimuth);
    this.sunDir.set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)).normalize();
    this.sun.color.set(preset.sunColor);
    this.sun.intensity = preset.sunIntensity;
    this.sun.shadow.intensity = 1;
    this.sun.shadow.normalBias = 0.005;
    this.sun.shadow.radius = 1;
    this.hemi.color.set(preset.hemiSky);
    this.hemi.groundColor.set(preset.hemiGround);
    this.hemi.intensity = preset.hemiIntensity;
    this.fill.color.set(preset.fillColor);
    this.fill.intensity = preset.fillIntensity;
    const u = this.skyMat.uniforms;
    u.uZenith.value.set(preset.zenith);
    u.uHorizon.value.set(preset.horizon);
    u.uGlow.value.set(preset.sunGlow);
    u.uSunDir.value.copy(this.sunDir);
    this.scene.fog = new THREE.FogExp2(preset.fogColor, preset.fogDensity);
    this.cloudMat.color.set(preset.cloudColor);
    this.cloudMat.emissive.set(preset.cloudColor).multiplyScalar(0.25);
    this.updateEnvironment(renderer, preset);
  }

  private updateEnvironment(renderer: THREE.WebGLRenderer, preset: AtmospherePreset): void {
    // The old capture rendered the sky mesh into a cube. On some Mac GPUs that
    // mesh is dropped (the far-plane trick plus the logarithmic depth buffer),
    // the environment comes back black, and every face the sun does not hit —
    // the underside of a tree, the shaded side of a rider — falls to pitch black.
    // An equirectangular image of the same sky does not depend on that pass.
    const tex = skyImage(preset, this.sunDir);
    const pmrem = new THREE.PMREMGenerator(renderer);
    this.envTarget?.dispose();
    this.envTarget = pmrem.fromEquirectangular(tex);
    pmrem.dispose();
    tex.dispose();
    this.scene.environment = this.envTarget.texture;
    this.scene.environmentIntensity = preset.envIntensity;
  }

  /** Shadow map and environment map. Meshes and their materials go with the scene. */
  dispose(): void {
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
    this.sun.shadow.dispose();
    this.envTarget?.dispose();
    this.envTarget = null;
    this.scene.environment = null;
  }

  /** Keeps the sky centred on the camera and the shadow frustum on the focus point. */
  update(camera: THREE.Camera, focus: THREE.Vector3): void {
    this.sky.position.copy(camera.position);
    const snap = 4;
    const fx = Math.round(focus.x / snap) * snap;
    const fz = Math.round(focus.z / snap) * snap;
    this.sun.target.position.set(fx, focus.y, fz);
    this.sun.position.set(fx + this.sunDir.x * 500, focus.y + this.sunDir.y * 500, fz + this.sunDir.z * 500);
  }
}
