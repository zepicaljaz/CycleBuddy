import * as THREE from 'three';
import {
  BloomEffect,
  BrightnessContrastEffect,
  EffectComposer,
  EffectPass,
  HueSaturationEffect,
  RenderPass,
  SMAAEffect,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import type { AtmospherePreset } from './atmosphere';
import type { TerrainQuality } from './terrain';

// The orthographic shadow camera stores gl_FragCoord.z. Apple GPUs compute that
// coarsely, so with the sun 9° up a whole face fails the compare and goes black.
// The depth shader already has a high-precision zw; write that instead.
THREE.ShaderLib.depth.fragmentShader = THREE.ShaderLib.depth.fragmentShader.replace(
  '#include <logdepthbuf_fragment>',
  `#ifdef USE_REVERSED_DEPTH_BUFFER
	float fragZ = vHighPrecisionZW.x / vHighPrecisionZW.y;
#else
	float fragZ = vHighPrecisionZW.x / vHighPrecisionZW.y * 0.5 + 0.5;
#endif
#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )
	gl_FragDepth = vIsPerspective == 0.0 ? fragZ : log2( vFragDepth ) * logDepthBufFC * 0.5;
#else
	gl_FragDepth = fragZ;
#endif`,
);

export type GraphicsQuality = 'low' | 'medium' | 'high' | 'ultra';

export interface QualitySettings {
  label: string;
  pixelRatio: number;
  shadowMapSize: number;
  shadowExtent: number;
  ao: boolean;
  aoHalfRes: boolean;
  bloom: boolean;
  terrain: TerrainQuality;
}

export const QUALITY: Record<GraphicsQuality, QualitySettings> = {
  low: {
    label: 'Low', pixelRatio: 1, shadowMapSize: 1024, shadowExtent: 60, ao: false, aoHalfRes: true, bloom: false,
    terrain: { viewDistance: 6000, splitDistance: 900, lod0Distance: 300, treeDensity: 0.6 },
  },
  medium: {
    label: 'Medium', pixelRatio: 1.25, shadowMapSize: 2048, shadowExtent: 90, ao: true, aoHalfRes: true, bloom: true,
    terrain: { viewDistance: 9000, splitDistance: 1200, lod0Distance: 450, treeDensity: 0.8 },
  },
  high: {
    label: 'High', pixelRatio: 1.5, shadowMapSize: 4096, shadowExtent: 110, ao: true, aoHalfRes: true, bloom: true,
    terrain: { viewDistance: 12000, splitDistance: 1500, lod0Distance: 600, treeDensity: 1 },
  },
  ultra: {
    label: 'Ultra', pixelRatio: 2, shadowMapSize: 4096, shadowExtent: 130, ao: true, aoHalfRes: false, bloom: true,
    terrain: { viewDistance: 15000, splitDistance: 1800, lod0Distance: 750, treeDensity: 1.2 },
  },
};

/** WebGL renderer + cinematic post-processing chain. */
export class Graphics {
  readonly renderer: THREE.WebGLRenderer;
  private composer: EffectComposer;
  private renderPass: RenderPass;
  private aoPass: N8AOPostPass | null = null;
  private bloom: BloomEffect;
  private hueSat: HueSaturationEffect;
  private toneMapping: ToneMappingEffect;
  /** Built once each and reused. Disposing one would dispose the effects they share. */
  private effectPassBloom: EffectPass | null = null;
  private effectPassPlain: EffectPass | null = null;
  private contrast: BrightnessContrastEffect;
  private vignette: VignetteEffect;
  private smaa: SMAAEffect;
  private quality: QualitySettings = QUALITY.high;
  /** setTarget and setQuality usually come in pairs. The chain is rebuilt once, before the next frame. */
  private passesDirty = true;
  private dprQuery: MediaQueryList | null = null;
  /**
   * Dynamic resolution, on during a ride. The render scale steps down when frames run long
   * and back up when there is headroom, between 1 device pixel per CSS pixel and the quality's
   * own cap. Menus draw at a fixed 30 fps on purpose, so they never adapt.
   */
  adaptive = false;
  private scale = 1;
  private frameMs: number[] = [];
  private lastFrameAt = 0;
  private windowStart = 0;
  private goodSince = 0;
  /** After a step up that had to come straight back down, stay below it for a while. */
  private ceiling = 1;
  private ceilingUntil = 0;
  private lastStepUp = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    private scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
  ) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      stencil: false,
      depth: true,
      powerPreference: 'high-performance',
      // Near is 0.3 m and far is 40 km. A normal depth buffer spends its
      // precision on the bike, so a window a few centimetres proud of a wall
      // flickers once the building is a few hundred metres away.
      logarithmicDepthBuffer: true,
    });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    // Half-float framebuffers stamp flickering 32×32 black squares onto cars,
    // houses and trees while the camera or the world moves. An 8-bit target
    // does not. Headlights still bloom: they clip to white, which is over the
    // bloom threshold.
    this.composer = new EffectComposer(this.renderer, { frameBufferType: THREE.UnsignedByteType });
    this.renderPass = new RenderPass(scene, camera);
    // Mipmap bloom spreads one bright window or wave into a black frame. The
    // smaller blur stays finite, so a glint stays a glint.
    this.bloom = new BloomEffect({ intensity: 0.6, luminanceThreshold: 0.82, luminanceSmoothing: 0.2, mipmapBlur: false });
    this.hueSat = new HueSaturationEffect({ saturation: 0.12 });
    this.toneMapping = new ToneMappingEffect({ mode: ToneMappingMode.AGX });
    this.contrast = new BrightnessContrastEffect({ brightness: 0.0, contrast: 0.06 });
    this.vignette = new VignetteEffect({ offset: 0.3, darkness: 0.45 });
    this.smaa = new SMAAEffect();
    this.watchPixelRatio();
  }

  /** Point the pipeline at a different scene/camera (used when switching routes). */
  setTarget(scene: THREE.Scene, camera: THREE.PerspectiveCamera): void {
    this.scene = scene;
    this.camera = camera;
    this.passesDirty = true;
    this.resize();
  }

  /** The effect pass for the current bloom setting. Bloom that is off is left out, not drawn at zero. */
  private effectPass(): EffectPass {
    if (this.quality.bloom) {
      this.effectPassBloom ??= new EffectPass(this.camera, this.bloom, this.toneMapping, this.hueSat, this.contrast, this.vignette, this.smaa);
      return this.effectPassBloom;
    }
    this.effectPassPlain ??= new EffectPass(this.camera, this.toneMapping, this.hueSat, this.contrast, this.vignette, this.smaa);
    return this.effectPassPlain;
  }

  private rebuildPasses() {
    this.passesDirty = false;
    // removeAllPasses does not dispose anything. The render and effect passes are
    // reused; only the AO pass holds the old scene, so only it is thrown away.
    this.composer.removeAllPasses();
    this.aoPass?.dispose();
    this.aoPass = null;
    this.renderPass.mainScene = this.scene;
    this.renderPass.mainCamera = this.camera;
    this.composer.addPass(this.renderPass);
    if (this.quality.ao) {
      const w = this.canvas.clientWidth || window.innerWidth;
      const h = this.canvas.clientHeight || window.innerHeight;
      this.aoPass = new N8AOPostPass(this.scene, this.camera, w, h);
      const c = this.aoPass.configuration;
      c.aoRadius = 3;
      c.distanceFalloff = 1.5;
      // A near-black occlusion tint turned a shaded red or dark green into pure black
      // once the sun was low. Yellow and white stayed visible because they are brighter.
      // The tint now only darkens, and Golden Hour adds a fill light for the rest.
      c.intensity = 0.75;
      c.halfRes = this.quality.aoHalfRes;
      c.aoSamples = this.quality.aoHalfRes ? 12 : 16;
      c.denoiseSamples = 8;
      c.color = new THREE.Color(0xc8b6a6);
      c.gammaCorrection = false;
      // A wall grazing the camera used to flood the frame with the dark AO colour.
      const bias = c as typeof c & { biasOffset: number; biasMultiplier: number };
      bias.biasOffset = 0.05;
      bias.biasMultiplier = 0.35;
      // The constructor already looked for water and turned on a second scene
      // pass that clears to black. Turning the flag off after the fact is what
      // actually disables it; auto-detect alone comes too late.
      const ao = this.aoPass as N8AOPostPass & { autoDetectTransparency: boolean };
      ao.autoDetectTransparency = false;
      ao.configuration.transparencyAware = false;
      this.composer.addPass(this.aoPass);
    }
    const effects = this.effectPass();
    effects.mainCamera = this.camera;
    effects.mainScene = this.scene;
    this.composer.addPass(effects);
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.composer.setSize(w, h);
  }

  setQuality(q: QualitySettings): void {
    this.quality = q;
    this.scale = 1;
    this.ceilingUntil = 0;
    this.applyPixelRatio();
    this.passesDirty = true;
    this.resize();
  }

  private applyPixelRatio(): void {
    this.renderer.setPixelRatio(this.targetRatio());
  }

  /** Pixel ratio the scale asks for: the quality cap times the scale, never under 1 (or the screen's own). */
  private targetRatio(): number {
    const top = Math.min(window.devicePixelRatio || 1, this.quality.pixelRatio);
    const floor = Math.min(top, 1);
    return Math.max(floor, Math.round(top * this.scale * 20) / 20);
  }

  /** Current render pixel ratio, for the perf overlay. */
  get pixelRatio(): number {
    return this.renderer.getPixelRatio();
  }

  /**
   * One frame drawn. Over each 1 s window the median frame time decides: above 20 ms
   * (under 50 fps) the scale drops a step; at or under 17.5 ms (a 60 Hz display keeping up)
   * for 4 s it climbs a step. A climb that has to come back within 6 s caps the scale there for 60 s.
   */
  private adapt(now: number): void {
    const dt = this.lastFrameAt ? now - this.lastFrameAt : 0;
    this.lastFrameAt = now;
    if (!this.adaptive || dt <= 0 || dt > 250) {
      // Paused, hidden or not riding: start the next window fresh.
      this.frameMs.length = 0;
      this.windowStart = now;
      this.goodSince = 0;
      return;
    }
    this.frameMs.push(dt);
    if (now - this.windowStart < 1000) return;
    const sorted = this.frameMs.sort((a, b) => a - b);
    const median = sorted[sorted.length >> 1];
    this.frameMs.length = 0;
    this.windowStart = now;
    const before = this.targetRatio();
    if (median > 20) {
      this.goodSince = 0;
      if (now - this.lastStepUp < 6000) {
        this.ceiling = this.scale - 0.1;
        this.ceilingUntil = now + 60000;
      }
      this.scale = Math.max(0.3, this.scale - 0.1);
    } else if (median <= 17.5) {
      if (!this.goodSince) this.goodSince = now;
      const cap = now < this.ceilingUntil ? this.ceiling : 1;
      if (now - this.goodSince >= 4000 && this.scale < cap - 1e-6) {
        this.scale = Math.min(cap, this.scale + 0.1);
        this.lastStepUp = now;
        this.goodSince = now;
      }
    } else this.goodSince = 0;
    if (this.targetRatio() !== before) {
      this.applyPixelRatio();
      this.resize();
    } else if (median > 20) this.scale = Math.max(this.scale, this.floorScale());
  }

  /** The scale at which the ratio reaches its floor; going lower changes nothing. */
  private floorScale(): number {
    const top = Math.min(window.devicePixelRatio || 1, this.quality.pixelRatio);
    return Math.min(1, Math.min(top, 1) / top);
  }

  /** Moving the window to a screen with another pixel density changes devicePixelRatio. */
  private watchPixelRatio(): void {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const onChange = () => {
      this.applyPixelRatio();
      this.resize();
      this.watchPixelRatio();
    };
    this.dprQuery?.removeEventListener('change', this.dprListener);
    this.dprListener = onChange;
    this.dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    this.dprQuery.addEventListener('change', onChange, { once: true });
  }

  private dprListener: () => void = () => {};

  applyAtmosphere(p: AtmospherePreset): void {
    this.hueSat.saturation = p.saturation;
    this.bloom.intensity = p.bloom;
    this.toneMapping.mode = ToneMappingMode.AGX;
    this.renderer.toneMappingExposure = p.exposure;
  }

  resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  render(dt: number): void {
    this.adapt(performance.now());
    if (this.passesDirty) this.rebuildPasses();
    this.composer.render(dt);
  }
}
