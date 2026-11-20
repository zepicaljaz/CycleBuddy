import type * as THREE from 'three';

/**
 * Developer overlay, on only with `?perf` in the URL: frame rate, frame time,
 * draw calls and triangles for the whole frame (shadow, AO and post passes
 * included), live GPU geometries and textures, and the JS heap where the
 * browser reports it.
 */
export class PerfOverlay {
  private el: HTMLElement;
  private frames = 0;
  private cpuMs = 0;
  private calls = 0;
  private triangles = 0;
  private windowStart = performance.now();
  private renderer: THREE.WebGLRenderer | null = null;

  constructor() {
    this.el = document.createElement('pre');
    this.el.id = 'perf-overlay';
    this.el.style.cssText =
      'position:fixed;left:8px;bottom:8px;z-index:99999;margin:0;padding:6px 8px;font:11px/1.35 ui-monospace,monospace;' +
      'color:#e8ffe8;background:rgba(0,0,0,0.72);border-radius:4px;pointer-events:none;white-space:pre';
    document.body.appendChild(this.el);
  }

  /** Call once per rendered frame, after the frame is drawn. cpuMs is the time spent building and submitting it. */
  frame(renderer: THREE.WebGLRenderer, cpuMs: number): void {
    if (this.renderer !== renderer) {
      // The composer renders several times a frame; count the whole frame, not the last pass.
      renderer.info.autoReset = false;
      renderer.info.reset();
      this.renderer = renderer;
      return;
    }
    const info = renderer.info;
    this.frames++;
    this.cpuMs += cpuMs;
    this.calls += info.render.calls;
    this.triangles += info.render.triangles;
    info.reset();
    const now = performance.now();
    const span = now - this.windowStart;
    if (span < 500) return;
    const n = Math.max(1, this.frames);
    const mem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
    this.el.textContent = [
      `fps        ${((this.frames * 1000) / span).toFixed(1)}`,
      `frame      ${(span / n).toFixed(2)} ms  (cpu ${(this.cpuMs / n).toFixed(2)} ms)`,
      `draw calls ${Math.round(this.calls / n)}`,
      `triangles  ${Math.round(this.triangles / n).toLocaleString('en')}`,
      `geometries ${info.memory.geometries}  textures ${info.memory.textures}  programs ${info.programs?.length ?? 0}`,
      `resolution ${renderer.getPixelRatio().toFixed(2)}x  ${renderer.domElement.width}×${renderer.domElement.height}`,
      `js heap    ${mem ? `${(mem.usedJSHeapSize / 1048576).toFixed(1)} MB` : 'n/a'}`,
    ].join('\n');
    this.frames = 0;
    this.cpuMs = 0;
    this.calls = 0;
    this.triangles = 0;
    this.windowStart = now;
  }
}

let shared: PerfOverlay | null | undefined;

/** The overlay when the page was opened with `?perf`, otherwise null. One per page. */
export function perfOverlay(): PerfOverlay | null {
  if (shared !== undefined) return shared;
  const on = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('perf');
  shared = on ? new PerfOverlay() : null;
  return shared;
}
