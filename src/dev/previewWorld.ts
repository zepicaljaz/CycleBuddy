import * as THREE from 'three';
import { getRouteDef } from '../routes/definitions';
import { getRoute } from '../routes/route';
import { ensureTrack, realClimbRoute } from '../routes/real/build';
import { REAL_CLIMB_MAP } from '../routes/real/data';
import { loadRouteTerrain } from '../routes/real/terrain';
import type { TimeOfDay } from '../world/atmosphere';
import { BRAND_IDS } from '../world/bikes';
import type { GraphicsQuality } from '../world/graphics';
import { DEFAULT_COLORS, type RiderPose } from '../world/riders';
import { planTowns } from '../world/scenery';
import { World, type CameraMode } from '../world/world';

// Dev-only: a real world with a small group riding through it. /preview.html?scene=world&route=lake&s=800

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('c') as HTMLCanvasElement;
const hud = document.getElementById('hud')!;
const requested = params.get('route') ?? 'lake';
const climb = REAL_CLIMB_MAP.get(requested);
if (climb) await ensureTrack(climb.id); // real-road tracks load on demand
const route = getRoute(climb ? realClimbRoute(climb) : getRouteDef(requested));
await loadRouteTerrain(route);
const names = params.get('names') === 'race' ? { dir: 1 as const } : undefined;
const world = new World(route, canvas, null, (params.get('q') as GraphicsQuality) || 'ultra', (params.get('time') as TimeOfDay) || 'noon', { roadWriting: names });
world.cameraMode = (params.get('cam') as CameraMode) || 'chase';
const count = Number(params.get('riders') ?? 6);
const jerseys = ['#e94e1b', '#1f5fbf', '#2fa84f', '#ffcd1f', '#ffffff', '#c8102e', '#7b3fbf', '#18191c'];
world.setRiderColors(
  Array.from({ length: count }, (_, i) => ({ ...DEFAULT_COLORS, jersey: jerseys[i % jerseys.length], helmet: jerseys[(i + 3) % jerseys.length], bike: BRAND_IDS[i % BRAND_IDS.length] })),
);
let s = Number(params.get('s') ?? 400);
let speed = Number(params.get('v') ?? 9);
const poses: RiderPose[] = Array.from({ length: count }, () => ({ x: 0, y: 0, z: 0, tx: 1, tz: 0, grade: 0, crank: 0, wheel: 0, effort: 0.5, visible: true }));
const slot = (i: number) => ({ back: Math.floor(i / 2) * 2.1, lat: i % 2 ? 1.25 : 0.65 });

let free: { pos: THREE.Vector3; look: THREE.Vector3 } | null = null;
const internals = world as unknown as { updateCamera: (...a: unknown[]) => void };
const followCamera = internals.updateCamera.bind(world);
internals.updateCamera = (...a: unknown[]) => {
  if (!free) return followCamera(...a);
  world.camera.position.copy(free.pos);
  world.camera.lookAt(free.look);
};

let paused = params.has('still');
const api = {
  world,
  route,
  towns: planTowns(route),
  goto(at: number) {
    s = route.wrap(at);
    world.snapCamera();
  },
  climb(i = 0) {
    api.goto(route.climbs[i]?.start ?? 0);
  },
  cam(mode: CameraMode) {
    free = null;
    world.cameraMode = mode;
    world.snapCamera();
  },
  /** Free camera at an offset from the road point `at`: right, up, back, looking `ahead` down the road. */
  look(at: number, right = 12, up = 6, back = 20, ahead = 30) {
    const p = route.sample(route.wrap(at - back));
    const q = route.sample(route.wrap(at + ahead));
    free = { pos: new THREE.Vector3(p.x - p.tz * right, p.y + up, p.z + p.tx * right), look: new THREE.Vector3(q.x, q.y + 1, q.z) };
    s = route.wrap(at);
  },
  free(x: number, y: number, z: number, lx: number, ly: number, lz: number) {
    free = { pos: new THREE.Vector3(x, y, z), look: new THREE.Vector3(lx, ly, lz) };
  },
  speed(v: number) {
    speed = v;
  },
  pause(p = true) {
    paused = p;
  },
};
(window as unknown as { preview: typeof api }).preview = api;

window.addEventListener('resize', () => world.resize());
world.resize();

let last = performance.now();
let fps = 60;
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  fps += (1 / Math.max(dt, 1e-3) - fps) * 0.05;
  if (!paused) s = route.wrap(s + speed * dt);
  const lead = slot(0);
  poses.forEach((p, i) => {
    const { back, lat } = slot(i);
    world.poseAt(s - back, lat, p);
    if (!paused) {
      p.crank += dt * speed * 1.05;
      p.wheel = ((s - back) / 0.34) % (Math.PI * 2);
    }
  });
  const riders = poses.map((_, i) => ({ s: s - slot(i).back, lat: slot(i).lat, speed, dir: 1 as const }));
  const info = world.graphicsRef.renderer.info;
  info.autoReset = false;
  info.reset();
  world.update(paused ? 0 : dt, s, lead.lat, poses, riders);
  hud.textContent = `${route.def.id}  s ${s.toFixed(0)} / ${route.length.toFixed(0)}  calls ${info.render.calls}  tris ${info.render.triangles}  fps ${fps.toFixed(0)}`;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
