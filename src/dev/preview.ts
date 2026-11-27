import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Atmosphere, ATMOSPHERES, type TimeOfDay } from '../world/atmosphere';
import { Graphics, QUALITY } from '../world/graphics';
import { InstancedModel, StaticBatch } from '../world/batch';
import { building, PALETTES, type BuildingKind } from '../world/buildings';
import { BRANDS } from '../world/bikes';
import { buildCar, buildCarWheel, CAR_SPECS, wheelMatrices } from '../world/cars';
import { RiderRenderer, DEFAULT_COLORS, type RiderColors, type RiderPose } from '../world/riders';
import { material } from '../world/materials';
import { boat, BOAT_KINDS, pier } from '../world/boats';
import { flume, waterWheel, windmillSails, windmillTower, WINDMILL_HUB } from '../world/mills';
import { motorcycle } from '../world/motorcycle';
import { parkedMotorhome, organizerCar } from '../world/motorhome';
import { parkedTractor, TRACTOR_SCHEMES, TractorRig } from '../world/tractor';
import { addCrowdMotion } from '../world/models';
import { alpineHotel } from '../world/alpineHotel';
import { modernHotel } from '../world/modernHotel';
import { alpineRestaurant } from '../world/alpineRestaurant';
import { fencePost, fenceSpan, guardrailBeam, guardrailPost, stoneWall, woodPost, woodRails } from '../world/fences';
import { buildSpectator, SPECTATOR_LOOKS, type SpectatorKind } from '../world/spectators';

// Dev-only page for looking at models up close: /preview.html?scene=riders

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('c') as HTMLCanvasElement;
const hud = document.getElementById('hud')!;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 20000);
const graphics = new Graphics(canvas, scene, camera);
graphics.setQuality(QUALITY.ultra);
const atmosphere = new Atmosphere(scene, 2600, new THREE.Vector3());
const time = (params.get('time') as TimeOfDay) || 'noon';
atmosphere.apply(ATMOSPHERES[time], graphics.renderer);
graphics.applyAtmosphere(ATMOSPHERES[time]);
scene.fog = null;

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
camera.position.set(3.2, 1.5, 3.2);
controls.target.set(0, 0.8, 0);

const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x5f7a3a, roughness: 0.95 }));
ground.receiveShadow = true;
scene.add(ground);
const road = new THREE.Mesh(new THREE.PlaneGeometry(600, 7.6).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x3a3b3e, roughness: 0.9 }));
road.position.y = 0.005;
road.receiveShadow = true;
scene.add(road);

type Updater = (dt: number, t: number) => void;
/** Riders scene: a fixed crank angle in radians (`&crank=` or `preview.crank(a)`), NaN to pedal. */
let fixedCrank = Number(params.get('crank') ?? NaN);
const scenes: Record<string, () => Updater> = {
  riders() {
    const kits: Partial<RiderColors>[] = [
      { jersey: '#e94e1b', jerseyAccent: '#ffffff', frame: '#1d1d1f', helmet: '#e94e1b', shorts: '#1d1d1f' },
      { jersey: '#1f5fbf', jerseyAccent: '#ffd23f', frame: '#e8e8e8', helmet: '#ffffff', shorts: '#14213d', wheels: '#1c1d22' },
      { jersey: '#2fa84f', jerseyAccent: '#ffffff', frame: '#2a6fd6', helmet: '#2fa84f', shoes: '#1c1d22', skin: '#a8724f' },
      { jersey: '#ffcd1f', jerseyAccent: '#1d1d1f', frame: '#ffcd1f', helmet: '#1d1d1f', shorts: '#1d1d1f' },
      { jersey: '#ffffff', jerseyAccent: '#c8102e', frame: '#c8102e', helmet: '#ffffff', shorts: '#c8102e', skin: '#f1c7a5' },
    ];
    const n = BRANDS.length;
    const riders = new RiderRenderer(n);
    riders.setColors(BRANDS.map((b, i) => ({ ...DEFAULT_COLORS, ...kits[i % kits.length], bike: b.id })));
    scene.add(riders.group);
    const only = params.get('brand');
    const poses: RiderPose[] = BRANDS.map((b, i) => ({
      x: 0, y: 0, z: only ? (b.id === only ? 0 : 1e4) : (i - (n - 1) / 2) * 1.5, tx: 1, tz: 0, grade: 0,
      crank: 0, wheel: 0, effort: 0, visible: !only || b.id === only,
    }));
    const lod = params.get('lod');
    const far = lod === '1' ? new THREE.Vector3(50, 0, 0) : lod === '2' ? new THREE.Vector3(1e5, 0, 0) : undefined;
    return (dt) => {
      for (const p of poses) {
        if (isNaN(fixedCrank)) p.crank += dt * 9.4;
        else p.crank = fixedCrank;
        p.wheel += dt * 9.4 * 0.9;
      }
      riders.update(poses, far ?? camera.position);
    };
  },
};

scenes.cars = () => {
  const detail = Number(params.get('lod') ?? 0) as 0 | 1 | 2;
  const paints = [0xa31d22, 0xf1f2f3, 0x1f3f7a, 0x6d7177, 0x18191c];
  const wheels = new InstancedModel(buildCarWheel(detail), CAR_SPECS.length * 4);
  scene.add(wheels.group);
  const bodies = CAR_SPECS.map((spec, i) => {
    const im = new InstancedModel(buildCar(spec.kind, detail), 1);
    im.count = 1;
    im.setTint(0, 'paint', paints[i % paints.length]);
    im.setTint(0, 'brake', new THREE.Color(1, 1, 1));
    scene.add(im.group);
    const base = params.has('row') ? new THREE.Matrix4().makeTranslation((i - 2) * 5.6, 0, 0) : new THREE.Matrix4().makeTranslation(0, 0, (i - 2) * 3.2);
    return { spec, im, base };
  });
  const mats = Array.from({ length: 4 }, () => new THREE.Matrix4());
  wheels.count = CAR_SPECS.length * 4;
  let spin = 0;
  return (dt, t) => {
    spin += dt * 4;
    bodies.forEach(({ spec, im, base }, i) => {
      im.setMatrix(0, base);
      const b = Math.sin(t * 2 + i) > 0.3 ? 5 : 1;
      im.setTint(0, 'brake', new THREE.Color(b, b, b));
      im.commit();
      wheelMatrices(spec, base, spin, mats);
      mats.forEach((m, k) => wheels.setMatrix(i * 4 + k, m));
    });
    wheels.commit();
  };
};

scenes.buildings = () => {
  const kinds: BuildingKind[] = (params.get('kinds')?.split(',') as BuildingKind[]) ?? ['cottage', 'house', 'gablefront', 'modern', 'townhouse', 'shop', 'farmhouse', 'adobe', 'villa', 'duplex', 'apartment', 'tower', 'garage', 'garage2', 'barn', 'silo', 'church'];
  const pal = PALETTES[(params.get('pal') as keyof typeof PALETTES) || 'alpine'];
  const batch = new StaticBatch();
  const variant = Number(params.get('v') ?? 0);
  let x = 0;
  kinds.forEach((kind, i) => {
    const b = building(kind, variant);
    const m = new THREE.Matrix4().makeRotationY(-Math.PI / 2).setPosition(x + b.w / 2, 0, -12);
    x += b.w + 4;
    batch.add(b.model, m, { wall: pal.walls[i % pal.walls.length], roof: pal.roofs[i % pal.roofs.length], accent: pal.accents[i % pal.accents.length] });
  });
  scene.add(batch.build('buildings'));
  ground.scale.set(4, 1, 4);
  return () => undefined;
};

scenes.farm = () => {
  const batch = new StaticBatch();
  batch.add(parkedTractor(1), new THREE.Matrix4().makeRotationY(0.6).setPosition(-6, 0, 4));
  batch.add(windmillTower(Number(params.get('v') ?? 0)), new THREE.Matrix4().makeRotationY(-Math.PI / 2).setPosition(18, 0, -22));
  batch.add(waterWheel(), new THREE.Matrix4().makeTranslation(-14, 1.4, -10));
  batch.add(flume(7, 4.1), new THREE.Matrix4().makeTranslation(-14, 0, -10));
  scene.add(batch.build('farm'));
  const sails = new THREE.Group();
  for (const g of windmillSails().groups) sails.add(new THREE.Mesh(g.geom, material(g.mat)));
  const hub = WINDMILL_HUB.clone().applyMatrix4(new THREE.Matrix4().makeRotationY(-Math.PI / 2));
  sails.position.set(18 + hub.x, hub.y, -22 + hub.z);
  sails.rotation.y = -Math.PI / 2;
  sails.traverse((o) => (o.castShadow = true));
  scene.add(sails);
  const wheel = new THREE.Group();
  for (const g of waterWheel().groups) wheel.add(new THREE.Mesh(g.geom, material(g.mat)));
  const rigs = TRACTOR_SCHEMES.map((_, i) => {
    const rig = new TractorRig(i);
    scene.add(rig.group);
    return rig;
  });
  ground.scale.set(4, 1, 4);
  let d = 0;
  return (dt, t) => {
    sails.rotateX(-dt * 0.9);
    d += dt * 2.5;
    rigs.forEach((rig, i) => {
      if (params.has('still')) return rig.pose(i * 4.5 - 6, 0, -2, 0, 0, 0, 0, 0.3);
      const a = d / 9 + (i * Math.PI) / 2;
      rig.pose(Math.cos(a) * 9, 0, Math.sin(a) * 9 - 2, -a - Math.PI / 2, 0, 0, d, 0.25);
    });
    void t;
  };
};

scenes.spectators = () => {
  const time = { value: 0 };
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, flatShading: true });
  addCrowdMotion(mat, time, 'bob');
  const kinds = Object.keys(SPECTATOR_LOOKS) as SpectatorKind[];
  let x = 0;
  for (const kind of kinds) {
    SPECTATOR_LOOKS[kind].forEach((_, i) => {
      const mesh = new THREE.InstancedMesh(buildSpectator(kind, i), mat, 1);
      mesh.setMatrixAt(0, new THREE.Matrix4().makeTranslation(0, 0, x));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      scene.add(mesh);
      x += kind === 'child' ? 1.05 : 1.35;
    });
    x += 0.35;
  }
  controls.target.set(0, 0.9, x / 2);
  camera.position.set(3.4, 1.35, x / 2);
  return (_dt, t) => {
    time.value = t;
  };
};

scenes.fences = () => {
  road.visible = false;
  (ground.material as THREE.MeshStandardMaterial).color.set(0x8e9290);
  const metalMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.68, metalness: 0.16 });
  const woodMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.92 });
  const stoneMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.97 });
  const toward = new THREE.Vector3(0, 0, 1);
  const place = (geom: THREE.BufferGeometry, mat: THREE.Material, matrices: THREE.Matrix4[]) => {
    if (!matrices.length) return;
    const mesh = new THREE.InstancedMesh(geom, mat, matrices.length);
    matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  };
  const run = (x0: number, x1: number, z: number, step: number, kind: 'metal' | 'wood' | 'stone') => {
    const posts: THREE.Matrix4[][] = [[], [], []];
    const spans: THREE.Matrix4[][] = [[], [], [], []];
    let n = 0;
    for (let x = x0; x <= x1 + 1e-3; x += step) {
      if (kind !== 'stone') {
        const bucket = kind === 'metal' ? posts[0] : posts[n % 3];
        bucket.push(fencePost(new THREE.Vector3(x, 0, z), toward));
      }
      if (n > 0) {
        const along = new THREE.Vector3(step, 0, 0);
        const mid = new THREE.Vector3(x - step / 2, 0, z);
        spans[kind === 'stone' ? (n - 1) % 4 : 0].push(fenceSpan(mid, along, toward, kind === 'stone' ? step / 2 : step));
      }
      n++;
    }
    if (kind === 'metal') {
      place(guardrailPost(), metalMat, posts[0]);
      place(guardrailBeam(), metalMat, spans[0]);
    } else if (kind === 'wood') {
      posts.forEach((list, variant) => place(woodPost(variant), woodMat, list));
      place(woodRails(), woodMat, spans[0]);
    } else {
      spans.forEach((list, variant) => place(stoneWall(variant), stoneMat, list));
    }
  };
  run(-5.2, 0.8, 0, 2, 'metal');
  run(2.4, 7.4, 0, 2, 'wood');
  run(9, 15, 0, 2, 'stone');
  const crowd = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.78 });
  const people: Array<[SpectatorKind, number, number]> = [
    ['man', 0, -4.2],
    ['woman', 1, -2.4],
    ['elder', 0, -0.6],
    ['child', 1, 10],
    ['woman', 2, 12.2],
  ];
  const face = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2);
  for (const [kind, look, x] of people) {
    const mesh = new THREE.InstancedMesh(buildSpectator(kind, look), crowd, 1);
    mesh.setMatrixAt(0, new THREE.Matrix4().compose(new THREE.Vector3(x, 0, -1.25), face, new THREE.Vector3(1, 1, 1)));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }
  controls.target.set(4.6, 0.6, 0);
  camera.position.set(4.6, 1.7, 7.4);
  return () => undefined;
};

scenes.hotel = () => {
  const batch = new StaticBatch();
  batch.add(alpineHotel(), new THREE.Matrix4());
  scene.add(batch.build('hotel'));
  ground.scale.set(1.4, 1, 1.4);
  controls.target.set(0, 4.6, -1);
  camera.position.set(34, 13, -18);
  return () => undefined;
};

scenes.modern = () => {
  const batch = new StaticBatch();
  batch.add(modernHotel(), new THREE.Matrix4());
  scene.add(batch.build('modern-hotel'));
  ground.scale.set(0.5, 1, 0.5);
  (ground.material as THREE.MeshStandardMaterial).color.set(0x8d928c);
  controls.target.set(1.4, 3.4, -0.4);
  camera.position.set(16, 8.5, -12);
  return () => undefined;
};

scenes.restaurant = () => {
  const batch = new StaticBatch();
  batch.add(alpineRestaurant('wood'), new THREE.Matrix4());
  scene.add(batch.build('restaurant'));
  ground.scale.set(0.55, 1, 0.55);
  (ground.material as THREE.MeshStandardMaterial).color.set(0x8d928c);
  controls.target.set(0.6, 2.8, 0.2);
  camera.position.set(15, 9.5, 13);
  return () => undefined;
};

scenes.waterfront = () => {
  const batch = new StaticBatch();
  batch.add(pier(14, 2.4), new THREE.Matrix4().makeTranslation(-8, 0, 6));
  BOAT_KINDS.forEach((kind, i) => batch.add(boat(kind), new THREE.Matrix4().makeTranslation(i * 8 - 8, 0.2, -4)));
  batch.add(parkedMotorhome(), new THREE.Matrix4().makeTranslation(-4, 0, 10));
  batch.add(organizerCar(), new THREE.Matrix4().makeTranslation(4, 0, 10));
  batch.add(motorcycle(true), new THREE.Matrix4().makeTranslation(8, 0, 6));
  scene.add(batch.build('waterfront'));
  return () => undefined;
};

const name = params.get('scene') ?? 'riders';
const update = (scenes[name] ?? scenes.riders)();

let paused = params.has('still');
const api = {
  cam(x: number, y: number, z: number, lx = 0, ly = 0.8, lz = 0) {
    camera.position.set(x, y, z);
    controls.target.set(lx, ly, lz);
    controls.update();
  },
  pause(p = true) {
    paused = p;
  },
  /** Riders scene: hold the crank at `a` radians, or pedal again with no argument. */
  crank(a = NaN) {
    fixedCrank = a;
  },
  ao(on: boolean) {
    graphics.setQuality({ ...QUALITY.ultra, ao: on });
  },
  scene,
  camera,
  graphics,
};
(window as unknown as { preview: typeof api }).preview = api;

function resize() {
  graphics.resize();
}
window.addEventListener('resize', resize);
resize();

let last = performance.now();
let t = 0;
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!paused) {
    t += dt;
    update(dt, t);
  }
  controls.update();
  atmosphere.update(camera, controls.target);
  graphics.renderer.info.autoReset = false;
  graphics.renderer.info.reset();
  graphics.render(dt);
  hud.textContent = `${name}  calls ${graphics.renderer.info.render.calls}  tris ${graphics.renderer.info.render.triangles}`;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
