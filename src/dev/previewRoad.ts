import * as THREE from 'three';
import { getRoute } from '../routes/route';
import { realClimbRoute } from '../routes/real/build';
import { REAL_CLIMB_MAP } from '../routes/real/data';
import { loadRouteTerrain } from '../routes/real/terrain';
import type { TimeOfDay } from '../world/atmosphere';
import { QUALITY } from '../world/graphics';
import { World } from '../world/world';

/**
 * Dev-only: a fixed camera on a real road, for before/after screenshots.
 *
 *   /preview.html?scene=road&id=<trackId>&km=<km>&look=<ahead|back|left|right|up-slope|down-slope>
 *     &h=<camera height above the road, m, default 1.7>&off=<m right of the centre line, default 0>
 *     &pitch=<deg, added to the look's own tilt>&t=<morning|noon|golden|overcast, default noon>
 *
 * Builds the world the way the ride does (app.ts mountWorld: realClimbRoute → loadRouteTerrain → World),
 * without trainer, session or HUD. Always the High preset at pixel ratio 1 with no traffic, so two shots
 * of the same spot differ only by what the code changed. Sets `window.__viewReady = true` once every
 * terrain chunk the camera wants is built and on screen; `window.__viewInfo` says how long that took.
 * Spots for the screenshot script live in scripts/viewpoints.json.
 */

type Look = 'ahead' | 'back' | 'left' | 'right' | 'up-slope' | 'down-slope';
interface ViewInfo {
  id: string;
  km: number;
  look: Look;
  s: number;
  camera: [number, number, number];
  target: [number, number, number];
  buildMs: number;
  readyMs: number;
  chunks: number;
  timedOut: boolean;
}
type ViewWindow = Window & { __viewReady?: boolean; __viewInfo?: ViewInfo; __viewError?: string; preview?: unknown };
const win = window as ViewWindow;
window.addEventListener('error', (e) => (win.__viewError = String(e.message)));
window.addEventListener('unhandledrejection', (e) => (win.__viewError = String(e.reason)));

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('c') as HTMLCanvasElement;
const hud = document.getElementById('hud')!;
if (!params.has('hud')) hud.style.display = 'none';
const t0 = performance.now();

const id = params.get('id') ?? 'vrsic-kranjska-gora';
const climb = REAL_CLIMB_MAP.get(id);
if (!climb) throw new Error(`No real climb "${id}"`);
const def = realClimbRoute(climb);
if (!def.track) throw new Error(`"${id}" has no real road (src/routes/real/tracks)`);
const route = getRoute(def);
await loadRouteTerrain(route);

const time = (params.get('t') as TimeOfDay) || 'noon';
const world = new World(route, canvas, null, 'high', time);
// Fixed pixel ratio 1 (the High preset caps at 1.5 on a retina screen), so every shot has the same pixels.
world.graphicsRef.setQuality({ ...QUALITY.high, pixelRatio: 1 });
world.setTrafficEnabled(false);
world.resize();
const buildMs = performance.now() - t0;

let look = (params.get('look') as Look) || 'ahead';
const km = Number(params.get('km') ?? 1);
const h = Number(params.get('h') ?? 1.7);
const lat = Number(params.get('off') ?? 0);
const s = route.wrap(km * 1000);
const here = route.place(s, lat);
const ground = lat === 0 ? here.y : Math.max(here.y, world.field.heightAt(here.x, here.z));
const pos = new THREE.Vector3(here.x, ground + h, here.z);

/** Horizontal unit direction and tilt (radians) for each look. */
function lookDirection(): { dx: number; dz: number; tilt: number } {
  const roadSlope = (a: number, b: number) => (route.sample(route.wrap(b)).y - route.sample(route.wrap(a)).y) / Math.abs(b - a);
  // Right of travel is (-tz, tx): x is east, z is south.
  switch (look) {
    case 'back':
      return { dx: -here.tx, dz: -here.tz, tilt: Math.atan(-roadSlope(s - 40, s)) };
    case 'left':
      return { dx: here.tz, dz: -here.tx, tilt: THREE.MathUtils.degToRad(-3) };
    case 'right':
      return { dx: -here.tz, dz: here.tx, tilt: THREE.MathUtils.degToRad(-3) };
    case 'up-slope':
    case 'down-slope': {
      // Ground gradient over ±30 m from the height field (the same one the terrain mesh uses).
      const f = world.field;
      const gx = (f.heightAt(pos.x + 30, pos.z) - f.heightAt(pos.x - 30, pos.z)) / 60;
      const gz = (f.heightAt(pos.x, pos.z + 30) - f.heightAt(pos.x, pos.z - 30)) / 60;
      const len = Math.hypot(gx, gz) || 1;
      const sign = look === 'up-slope' ? 1 : -1;
      return { dx: (sign * gx) / len, dz: (sign * gz) / len, tilt: sign * Math.atan(len) * 0.5 };
    }
    default:
      return { dx: here.tx, dz: here.tz, tilt: Math.atan(roadSlope(s, s + 40)) };
  }
}
const target = new THREE.Vector3();
function aim(): void {
  const dir = lookDirection();
  const tilt = dir.tilt + THREE.MathUtils.degToRad(Number(params.get('pitch') ?? 0));
  target.set(pos.x + dir.dx * 100 * Math.cos(tilt), pos.y + 100 * Math.sin(tilt), pos.z + dir.dz * 100 * Math.cos(tilt));
  // holdPreview parks the verge grass and scenery on this stretch; holdFrame pins the camera.
  world.holdPreview(s);
  world.holdFrame(pos.x, pos.y, pos.z, target.x, target.y, target.z);
}
aim();
// The flyover still camera keeps 14 m above the ground (World.keepAboveGround), which is no use for a
// rider's-eye view. Pin the camera exactly instead; camLook is what shadows and the sky follow.
const cam = world as unknown as { updateCamera: (...a: unknown[]) => void; camLook: THREE.Vector3; camPos: THREE.Vector3 };
cam.updateCamera = () => {
  cam.camPos.copy(pos);
  cam.camLook.copy(target);
  world.camera.position.copy(pos);
  world.camera.lookAt(target);
};

// Ready = terrain workers up, every desired chunk live, nothing in flight, for a run of frames in a row.
const terrain = (world as unknown as { terrain: { ready: boolean; progress: number; inflight: Map<number, unknown>; live: Map<string, unknown> } }).terrain;
const STABLE_FRAMES = 30;
const MIN_MS = 1500;
const TIMEOUT_MS = Number(params.get('timeout') ?? 55_000);
let stable = 0;
let settled = 0;
let readyAt = 0;
win.preview = { world, route, pos, target };
/**
 * Turn the same camera to another look without rebuilding the world (the screenshot script uses this
 * for the second look of a spot). Terrain streams by camera position, so it is already complete;
 * `__viewReady` comes back after the settle frames.
 */
(win as ViewWindow & { __setLook?: (l: Look) => void }).__setLook = (l: Look) => {
  look = l;
  aim();
  win.__viewReady = false;
  settled = 0;
};

let last = performance.now();
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  world.update(dt, s, lat, []);
  const elapsed = now - t0;
  const done = terrain.ready && terrain.progress >= 1 && terrain.inflight.size === 0;
  stable = done ? stable + 1 : 0;
  if (!readyAt && ((stable >= STABLE_FRAMES && elapsed > MIN_MS) || elapsed > TIMEOUT_MS)) readyAt = now;
  // A few more frames after the last chunk so shadows and AO have caught up.
  if (readyAt && !win.__viewReady && ++settled > 10) {
    win.__viewInfo = {
      id, km, look, s,
      camera: [pos.x, pos.y, pos.z],
      target: [target.x, target.y, target.z],
      buildMs: Math.round(buildMs),
      readyMs: Math.round(readyAt - t0),
      chunks: terrain.live.size,
      timedOut: stable < STABLE_FRAMES,
    };
    win.__viewReady = true;
  }
  if (params.has('hud')) hud.textContent = `${id} km ${km} ${look}  chunks ${terrain.live.size} ${(terrain.progress * 100).toFixed(0)}%${win.__viewReady ? '  ready' : ''}`;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
