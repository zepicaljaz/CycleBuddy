import * as THREE from 'three';
import type { Climb, Route } from '../routes/route';
import { Atmosphere, ATMOSPHERES, type TimeOfDay } from './atmosphere';
import { Flock } from './birds';
import { RaceConvoy } from './convoy';
import { Graphics, QUALITY, type GraphicsQuality } from './graphics';
import { SHARED_MATERIALS } from './materials';
import { perfOverlay } from './perf';
import { RiderRenderer, type RiderColors, type RiderPose } from './riders';
import { buildRoad, rightVector } from './road';
import { writingSpans, type RoadWriting } from './climbs';
import { buildPrimeArches, buildRaceFinish, buildScenery, crowdTime, cullRaceCrowd, planTowns, raceCrowdCells, type CrowdLevel, type FenceCell, type Scenery } from './scenery';
import { TerrainManager, type TerrainQuality } from './terrain';
import { TerrainField, type FieldInput } from './terrainField';
import { Traffic, type LaneUser } from './traffic';
import { VergeGrass } from './verge';
import { Water } from './water';
import { ROUTE_DS } from '../routes/route';

export type CameraMode = 'chase' | 'close' | 'aerial' | 'heli' | 'first' | 'flyover' | 'garage' | 'showcase';
export const RIDE_CAMERAS = ['chase', 'close', 'aerial', 'heli', 'first'] as const satisfies readonly CameraMode[];
export const CAMERA_LABEL: Record<(typeof RIDE_CAMERAS)[number], string> = {
  chase: 'Chase camera',
  close: 'Close camera',
  aerial: 'Aerial camera',
  heli: 'Helicopter',
  first: 'First person',
};

const MAX_RIDERS = 241;
/** Time for the look-behind key to turn the view half a circle. */
const LOOK_BACK_SECONDS = 0.45;

export interface WorldOptions {
  /** Instanced rider slots. A ride uses 241. The homepage only draws a handful. */
  riderCapacity?: number;
  /** Replace parts of the quality preset's terrain streaming. Does not change the preset itself. */
  terrain?: Partial<TerrainQuality>;
  /** Stream the first terrain around this point instead of the map origin. */
  focus?: { x: number; z: number };
  /** Road, fences and terrain only. No villages, side roads or arches. */
  corridor?: boolean;
  /** Names painted across the climbs. Set for a hill-climb race or a career stage. */
  roadWriting?: RoadWriting;
}

/** Owns the Three.js scene for one route. */
export class World {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(58, 1, 0.3, 40000);
  readonly field: TerrainField;
  readonly riders: RiderRenderer;
  private graphics: Graphics;
  private atmosphere: Atmosphere;
  private terrain: TerrainManager;
  private waterSim: Water | null = null;
  private routeGroup = new THREE.Group();
  private scenery: Scenery;
  cameraMode: CameraMode = 'flyover';
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private camInit = false;
  private flyS = 0;
  /** When set, the flyover stays on flyS for a landscape still. */
  private previewHold = false;
  /** Still of the valley ahead, in the same alley as the homepage. */
  private valleyHold = false;
  /** A fixed still camera, used for the lake-island card. */
  private frameHold = false;
  private framePos = new THREE.Vector3();
  private frameLook = new THREE.Vector3();
  /** Road distance the homepage camera stays on, while a rider loops through the view. */
  private showcaseS = 0;
  private showcaseTime = 0;
  private garageAngle = 0.6;
  /** Helicopter orbit. It drifts on its own; the mouse does not steer it. */
  private heliYaw = 0.6;
  private heliYawRate = 0.07;
  private heliDist = 32;
  private heliHeight = 18;
  private heliTargetDist = 32;
  private heliTargetHeight = 18;
  private heliRetarget = 4;
  private focus = new THREE.Vector3();
  private traffic: Traffic;
  /** Tufts on the verge around the followed point. */
  private grass: VergeGrass | null = null;
  private convoy = new RaceConvoy();
  private flock = new Flock();
  private raceFinish: THREE.Group | null = null;
  /** Set when this world was built with race names on the climbs. */
  readonly roadWriting: RoadWriting | undefined = undefined;
  private raceCrowd: FenceCell[] = [];
  private hiddenForRace: THREE.Object3D[] = [];
  /** Mouse look, in radians. Yaw wraps through a full turn; zero looks down the road. */
  private lookYaw = 0;
  private lookPitch = 0;
  /** Look-behind key: 0 looks ahead, 1 looks back. Eases over LOOK_BACK_SECONDS, so the turn is smooth. */
  private lookBackTarget = 0;
  private lookBackAmount = 0;
  /** Mouse yaw plus the look-behind turn, as used by the camera this frame. */
  private viewYaw = 0;

  constructor(
    readonly route: Route,
    canvas: HTMLCanvasElement,
    graphics: Graphics | null,
    quality: GraphicsQuality,
    timeOfDay: TimeOfDay,
    options?: WorldOptions,
  ) {
    const towns = options?.corridor ? [] : planTowns(route);
    const town = new Uint8Array(route.count);
    for (const span of towns) {
      const a = Math.max(0, Math.floor((span.s0 - 24) / ROUTE_DS));
      const b = Math.min(route.count - 1, Math.ceil((span.s1 + 24) / ROUTE_DS));
      for (let i = a; i <= b; i++) town[i] = 1;
    }
    if (route.def.track) markOverlappingTown(route, town);
    const input: FieldInput = { x: route.x, z: route.z, y: route.y, seed: route.def.seed, scenery: route.def.scenery, town, dem: route.terrain, places: route.def.track?.places };
    this.field = new TerrainField(input);
    // Buildings and yards first, so the terrain workers know where trees must not grow.
    this.roadWriting = options?.roadWriting;
    this.scenery = buildScenery(route, this.field, towns, options?.corridor ?? false, this.roadWriting);
    input.clear = this.scenery.clear;
    input.pads = this.scenery.pads;
    this.graphics = graphics ?? new Graphics(canvas, this.scene, this.camera);
    if (graphics) graphics.setTarget(this.scene, this.camera);

    const center = new THREE.Vector3((route.bounds.minX + route.bounds.maxX) / 2, 0, (route.bounds.minZ + route.bounds.maxZ) / 2);
    this.atmosphere = new Atmosphere(this.scene, Math.max(route.bounds.maxY + 1400, 2600), center);
    this.terrain = new TerrainManager(input, QUALITY[quality].terrain);
    this.scene.add(this.terrain.group);

    this.routeGroup.add(buildRoad(route));
    this.routeGroup.add(this.scenery.group);
    this.scene.add(this.routeGroup);

    if (route.def.scenery.waterLevel !== null) {
      const water = new Water(route.def.scenery.waterLevel, route.def.scenery.biome ?? 'alpine');
      this.waterSim = water;
      this.scene.add(water.mesh);
    }

    if (!options?.corridor) {
      this.grass = new VergeGrass(route, this.field);
      this.scene.add(this.grass.mesh);
    }

    this.riders = new RiderRenderer(options?.riderCapacity ?? MAX_RIDERS);
    this.scene.add(this.riders.group);

    this.traffic = new Traffic(route, this.scenery.signals);
    this.scene.add(this.traffic.group);
    this.scene.add(this.convoy.group);
    this.scene.add(this.flock.group);

    if (options?.focus) this.focus.set(options.focus.x, 0, options.focus.z);
    this.setQuality(quality);
    if (options?.terrain) {
      this.terrain.quality = { ...this.terrain.quality, ...options.terrain };
      this.terrain.refresh(this.focus);
    }
    this.setTimeOfDay(timeOfDay);
  }

  get graphicsRef(): Graphics {
    return this.graphics;
  }

  get loadProgress(): number {
    return this.terrain.progress;
  }

  setQuality(q: GraphicsQuality): void {
    const settings = QUALITY[q];
    this.graphics.setQuality(settings);
    this.atmosphere.sun.shadow.mapSize.set(settings.shadowMapSize, settings.shadowMapSize);
    this.atmosphere.sun.shadow.map?.dispose();
    this.atmosphere.sun.shadow.map = null;
    this.atmosphere.setShadowExtent(settings.shadowExtent);
    this.terrain.quality = settings.terrain;
    this.terrain.refresh(this.focus);
  }

  setTimeOfDay(t: TimeOfDay): void {
    const preset = { ...ATMOSPHERES[t] };
    const biome = this.route.def.scenery.biome ?? 'alpine';
    if (biome === 'desert') {
      preset.hemiGround = 0xb88858;
      if (t !== 'overcast') preset.fogColor = 0xe4cba8;
    } else if (biome === 'moor') {
      preset.hemiGround = 0x5a6050;
      preset.fogDensity *= 1.35;
    } else if (biome === 'limestone') {
      preset.hemiGround = 0x8a7a58;
    } else if (biome === 'spruce') {
      preset.hemiGround = 0x1c4428;
    }
    this.atmosphere.apply(preset, this.graphics.renderer);
    this.graphics.applyAtmosphere(preset);
  }

  setRiderColors(colors: RiderColors[]): void {
    this.riders.setColors(colors);
  }

  resize(): void {
    this.graphics.resize();
  }

  /** Pose for a rider at distance s with a lateral offset (positive = right). */
  poseAt(s: number, lateral: number, out: RiderPose): RiderPose {
    const sample = this.route.place(s, lateral, this.placeTmp);
    out.x = sample.x;
    out.z = sample.z;
    out.y = sample.y + 0.02;
    out.tx = sample.tx;
    out.tz = sample.tz;
    out.grade = sample.grade;
    return out;
  }

  private placeTmp = { x: 0, y: 0, z: 0, tx: 1, tz: 0, grade: 0 };
  private tmpPose: RiderPose = { x: 0, y: 0, z: 0, tx: 1, tz: 0, grade: 0, crank: 0, wheel: 0, effort: 0, visible: true };

  /**
   * @param focusS distance of the followed rider along the route
   * @param focusLat lateral offset of the followed rider
   */
  setTrafficEnabled(on: boolean): void {
    this.traffic.setEnabled(on);
  }

  /** Green sprint arches for a career stage. Pass an empty list to clear them. */
  setPrimeArches(marks: { s: number; name: string }[], face: 1 | -1 = 1): void {
    const old = this.routeGroup.getObjectByName('prime-arches');
    if (old) {
      this.routeGroup.remove(old);
      disposeObject(old);
    }
    if (!marks.length) return;
    const arches = buildPrimeArches(this.route, marks, face);
    this.routeGroup.add(arches);
  }

  /** Summit fences, finish line, arch and the red flag one kilometre out. Races only. */
  setRaceClimb(climb: Climb | null, crowd: CrowdLevel = 'normal'): void {
    if (this.raceFinish) {
      this.routeGroup.remove(this.raceFinish);
      disposeObject(this.raceFinish);
      this.raceFinish = null;
      this.raceCrowd = [];
    }
    for (const o of this.hiddenForRace) o.visible = true;
    this.hiddenForRace = [];
    this.convoy.setEnabled(!!climb);
    if (!climb) return;
    const painted = this.roadWriting != null && writingSpans(this.route, this.roadWriting).length > 0;
    this.raceFinish = buildRaceFinish(this.route, climb, this.field, crowd, painted);
    this.raceCrowd = raceCrowdCells(this.raceFinish);
    this.routeGroup.add(this.raceFinish);
    const hide = new Set([`summit-arch:${climb.id}`, 'summit-rails']);
    this.routeGroup.traverse((o) => {
      if (!hide.has(o.name) || o.parent === this.raceFinish) return;
      o.visible = false;
      this.hiddenForRace.push(o);
    });
  }

  /** Look offset in radians. Yaw wraps a full circle. Zero looks straight down the road. */
  setMouseLook(yaw: number, pitch: number): void {
    const tau = Math.PI * 2;
    this.lookYaw = ((yaw + Math.PI) % tau + tau) % tau - Math.PI;
    this.lookPitch = THREE.MathUtils.clamp(pitch, -0.42, 0.48);
  }

  /** Hold-to-look-behind. The view turns half a circle and back with an eased motion. */
  setLookBack(on: boolean): void {
    this.lookBackTarget = on ? 1 : 0;
  }

  private stepLookBack(dt: number): void {
    const step = Math.min(dt, 0.1) / LOOK_BACK_SECONDS;
    if (this.lookBackAmount < this.lookBackTarget) this.lookBackAmount = Math.min(this.lookBackTarget, this.lookBackAmount + step);
    else if (this.lookBackAmount > this.lookBackTarget) this.lookBackAmount = Math.max(this.lookBackTarget, this.lookBackAmount - step);
    const t = this.lookBackAmount;
    this.viewYaw = this.lookYaw + t * t * (3 - 2 * t) * Math.PI;
  }

  update(dt: number, focusS: number, focusLat: number, poses: RiderPose[], riders: LaneUser[] = [], spin = 0, ramp?: { s: number; dir: 1 | -1 }): void {
    const started = this.perf ? performance.now() : 0;
    this.stepLookBack(dt);
    crowdTime.value += dt;
    this.traffic.update(dt, riders, this.camera.position);
    this.scenery.update(dt, this.camera.position);
    if (this.raceCrowd.length) cullRaceCrowd(this.raceCrowd, this.camera.position);
    this.convoy.update(dt, this.route, this.field, riders, ramp);
    this.flock.update(dt, this.camera.position);
    if (poses[0]) poses[0].cockpit = this.cameraMode === 'first' && poses[0].visible;
    this.riders.update(poses, this.camera.position);
    const pose = this.poseAt(focusS, focusLat, this.tmpPose);
    this.focus.set(pose.x, pose.y, pose.z);
    this.updateCamera(dt, focusS, focusLat, pose, spin, poses[0]);
    this.grass?.update(this.cameraMode === 'flyover' ? this.flyS : this.cameraMode === 'showcase' ? this.showcaseS : focusS);
    const wide = this.cameraMode === 'flyover' || this.cameraMode === 'showcase';
    this.terrain.update(wide ? this.camera.position : this.focus, dt);
    this.atmosphere.update(this.camera, wide ? this.camLook : this.focus);
    this.waterSim?.update(dt, this.camera, this.atmosphere.sunDir);
    this.graphics.render(dt);
    this.perf?.frame(this.graphics.renderer, performance.now() - started);
  }

  /** `?perf` in the URL: fps, draw calls, triangles and heap in a corner. */
  private perf = perfOverlay();

  private desiredPos = new THREE.Vector3();
  private desiredLook = new THREE.Vector3();
  private tmpPose2: RiderPose = { x: 0, y: 0, z: 0, tx: 1, tz: 0, grade: 0, crank: 0, wheel: 0, effort: 0, visible: true };
  private tmpPose3: RiderPose = { x: 0, y: 0, z: 0, tx: 1, tz: 0, grade: 0, crank: 0, wheel: 0, effort: 0, visible: true };
  private lookForward = new THREE.Vector3();

  private updateCamera(dt: number, s: number, lat: number, pose: RiderPose, spin = 0, rider?: RiderPose) {
    const along = Math.cos(spin);
    const swing = Math.sin(spin);
    const r = this.route;
    const mode = this.cameraMode;
    const first = mode === 'first';
    if (this.camera.fov !== (first ? 74 : 58) || this.camera.near !== (first ? 0.08 : 0.3)) {
      this.camera.fov = first ? 74 : 58;
      this.camera.near = first ? 0.08 : 0.3;
      this.camera.updateProjectionMatrix();
    }
    if (mode === 'flyover' && this.previewHold) {
      this.framePreview();
    } else if (mode === 'flyover') {
      this.flyS = r.wrap(this.flyS + dt * 22);
      const ahead = r.sample(this.flyS + 260);
      const here = r.sample(this.flyS);
      const [rx, rz] = rightVector(r, Math.floor(this.flyS / ROUTE_DS));
      this.desiredPos.set(here.x + rx * 90, here.y + 75, here.z + rz * 90);
      this.desiredLook.set(ahead.x, ahead.y + 10, ahead.z);
    } else if (mode === 'showcase') {
      // Stay in one alley. A slow sway shifts the view; it does not fly off down the route.
      this.showcaseTime += dt;
      const t = this.showcaseTime;
      const anchor = this.showcaseS;
      const sway = Math.sin(t * 0.14);
      const lift = Math.sin(t * 0.1 + 0.8);
      const breathe = Math.sin(t * 0.08 + 1.2);
      const side = sway * 6.4;
      const back = 32 + breathe * 4;
      const up = 4.6 + lift * 1.7;
      const behind = this.poseAt(r.wrap(anchor - back), side, this.tmpPose2);
      this.desiredPos.set(behind.x, behind.y + up, behind.z);
      const look = this.poseAt(r.wrap(anchor + 64 + sway * 12), side * 0.25, this.tmpPose3);
      this.desiredLook.set(look.x, look.y + 2.1 + lift * 0.9, look.z);
    } else if (mode === 'garage') {
      this.garageAngle += dt * 0.25;
      const fwdX = pose.tx;
      const fwdZ = pose.tz;
      const a = this.garageAngle;
      const dx = Math.cos(a) * fwdX - Math.sin(a) * fwdZ;
      const dz = Math.sin(a) * fwdX + Math.cos(a) * fwdZ;
      this.desiredPos.set(pose.x + dx * 3.2, pose.y + 1.4, pose.z + dz * 3.2);
      this.desiredLook.set(pose.x, pose.y + 0.85, pose.z);
    } else if (mode === 'heli') {
      this.flyHelicopter(dt, pose);
    } else if (mode === 'first') {
      this.placeFirstPerson(rider?.visible ? rider : pose);
    } else {
      const cfg =
        mode === 'close'
          ? { back: 3.4, up: 1.55, ahead: 12 }
          : mode === 'aerial'
            ? { back: 16, up: 9, ahead: 14 }
            : { back: 6.2, up: 1.85, ahead: 16 };
      const behind = this.poseAt(s - cfg.back * along, lat * 0.6 + cfg.back * 0.42 * swing, this.tmpPose2);
      this.desiredPos.set(behind.x, behind.y + cfg.up, behind.z);
      const look = this.poseAt(s + cfg.ahead * along, lat * 0.4 - cfg.ahead * 0.12 * swing, this.tmpPose3);
      const lookLift = mode === 'aerial' ? 2 : cfg.up * 0.72;
      this.desiredLook.set(look.x, look.y + lookLift, look.z);
    }
    // keep the camera above the terrain
    const ground = this.field.heightAt(this.desiredPos.x, this.desiredPos.z);
    this.desiredPos.y = Math.max(this.desiredPos.y, ground + (mode === 'first' ? 0.35 : 1.2));

    if (!this.camInit || mode === 'first') {
      this.camPos.copy(this.desiredPos);
      this.camLook.copy(this.desiredLook);
      this.camInit = true;
    } else {
      const follow = mode === 'heli' ? 0.55 : mode === 'flyover' ? 1.5 : mode === 'showcase' ? 0.7 : 6;
      const k = 1 - Math.exp(-dt * follow);
      this.camPos.lerp(this.desiredPos, k);
      const lookRate = mode === 'heli' ? 0.9 : mode === 'showcase' ? 0.9 : 8;
      this.camLook.lerp(this.desiredLook, 1 - Math.exp(-dt * lookRate));
    }
    // The flight back to the menu is a straight line. Lift it where that line would pass through a hill.
    this.keepAboveGround(mode);
    if (mode === 'chase' || mode === 'close' || mode === 'aerial') this.orbitAroundRider(pose);
    else if (mode === 'heli') {
      this.camera.position.copy(this.camPos);
      this.aimed.copy(this.camLook);
    } else {
      this.camera.position.copy(this.camPos);
      this.aimedLook();
    }
    this.keepOutOfBuildings();
    this.camera.lookAt(this.aimed);
    this.frameGarage(mode === 'garage');
  }

  private firstEuler = new THREE.Euler();
  private firstQuat = new THREE.Quaternion();
  private firstOffset = new THREE.Vector3();

  /**
   * Sit just behind the stem, a little above the bars, so the handlebar fills
   * the bottom of the frame. The bike is drawn; the rider's body is not.
   */
  private placeFirstPerson(bike: RiderPose): void {
    const yaw = Math.atan2(-bike.tz, bike.tx);
    const pitch = Math.atan(bike.grade);
    this.firstEuler.set(0, yaw, pitch, 'YZX');
    this.firstQuat.setFromEuler(this.firstEuler);
    this.firstOffset.set(0.16, 1.0, 0).applyQuaternion(this.firstQuat);
    this.desiredPos.set(bike.x, bike.y, bike.z).add(this.firstOffset);
    this.firstOffset.set(8, 0.78, 0).applyQuaternion(this.firstQuat);
    this.desiredLook.set(bike.x, bike.y, bike.z).add(this.firstOffset);
  }

  /** A slow orbit above the rider. Distance, height and spin keep changing on their own. */
  private flyHelicopter(dt: number, pose: RiderPose): void {
    this.heliRetarget -= dt;
    if (this.heliRetarget <= 0) {
      this.heliRetarget = 7 + Math.random() * 9;
      this.heliTargetDist = 14 + Math.random() * 46;
      this.heliTargetHeight = 8 + Math.random() * 26;
      this.heliYawRate = (Math.random() < 0.5 ? -1 : 1) * (0.035 + Math.random() * 0.11);
    }
    this.heliYaw += this.heliYawRate * dt;
    this.heliDist += (this.heliTargetDist - this.heliDist) * Math.min(1, dt * 0.18);
    this.heliHeight += (this.heliTargetHeight - this.heliHeight) * Math.min(1, dt * 0.18);
    const cy = Math.cos(this.heliYaw);
    const sy = Math.sin(this.heliYaw);
    this.desiredPos.set(pose.x + sy * this.heliDist, pose.y + this.heliHeight, pose.z + cy * this.heliDist);
    this.desiredLook.set(pose.x, pose.y + 1.05, pose.z);
  }

  /**
   * Houses, mills and motorhomes sit close to the road. A chase camera that cuts a
   * corner otherwise passes through a wall for a frame, and the ambient occlusion
   * turns that into a full black flash.
   */
  private keepOutOfBuildings(): void {
    const mode = this.cameraMode;
    if (mode === 'flyover' || mode === 'garage') return;
    const boxes = this.scenery.solids;
    const cam = this.camera.position;
    const margin = 0.6;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < boxes.length; i += 8) {
        const dx = cam.x - boxes[i];
        const dz = cam.z - boxes[i + 1];
        if (dx * dx + dz * dz > 70 * 70) continue;
        const c = boxes[i + 2];
        const s = boxes[i + 3];
        const lx = dx * c - dz * s;
        const lz = dx * s + dz * c;
        const hd = boxes[i + 4] + margin;
        const hw = boxes[i + 5] + margin;
        if (Math.abs(lx) >= hd || Math.abs(lz) >= hw) continue;
        const base = boxes[i + 6];
        const top = base + boxes[i + 7];
        if (cam.y >= top || cam.y <= base - 0.5) continue;
        const penX = hd - Math.abs(lx);
        const penZ = hw - Math.abs(lz);
        if (penX < penZ) {
          const dir = lx >= 0 ? 1 : -1;
          cam.x += c * dir * penX;
          cam.z += -s * dir * penX;
        } else {
          const dir = lz >= 0 ? 1 : -1;
          cam.x += s * dir * penZ;
          cam.z += c * dir * penZ;
        }
      }
    }
  }

  /** The smoothed camera can dip under a slope even when the destination sits above it. */
  private keepAboveGround(mode: CameraMode): void {
    const ground = this.field.heightAt(this.camPos.x, this.camPos.z);
    const clearance = mode === 'first' ? 0.35 : mode === 'flyover' ? 14 : 1.2;
    if (this.camPos.y < ground + clearance) this.camPos.y = ground + clearance;
  }

  /** Slide the garage view right so the rider sits clear of the side menu. */
  private frameGarage(on: boolean): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const panel = document.getElementById('panel');
    const shift = on && panel ? panel.getBoundingClientRect().width / 2 : 0;
    if (shift > 1) this.camera.setViewOffset(w, h, -shift, 0, w, h);
    else if (this.camera.view) this.camera.clearViewOffset();
  }

  private aimed = new THREE.Vector3();
  private orbitPivot = new THREE.Vector3();
  private camOff = new THREE.Vector3();
  private lookOff = new THREE.Vector3();
  private orbitRight = new THREE.Vector3();

  /** First person looks around from the rider's eye. The camera stays on the bike. */
  private aimedLook(): void {
    this.aimed.copy(this.camLook);
    if (this.cameraMode === 'flyover' || this.cameraMode === 'garage' || this.cameraMode === 'showcase') return;
    if (Math.abs(this.viewYaw) < 0.001 && Math.abs(this.lookPitch) < 0.001) return;
    this.lookForward.subVectors(this.camLook, this.camPos);
    const len = this.lookForward.length();
    if (len < 0.05) return;
    this.lookForward.multiplyScalar(1 / len);
    this.yawRotate(this.lookForward, this.viewYaw);
    const horiz = Math.hypot(this.lookForward.x, this.lookForward.z) || 1;
    const pitched = THREE.MathUtils.clamp(Math.atan2(this.lookForward.y, horiz) + this.lookPitch, -0.85, 0.9);
    const h = Math.cos(pitched);
    this.lookForward.set((this.lookForward.x / horiz) * h, Math.sin(pitched), (this.lookForward.z / horiz) * h);
    this.aimed.copy(this.camPos).addScaledVector(this.lookForward, len);
  }

  /**
   * Chase, close and aerial cameras swing around the rider, so the cyclist stays in frame
   * through a full turn. Applied after the road-follow smoothing.
   */
  private orbitAroundRider(pose: RiderPose): void {
    if (Math.abs(this.viewYaw) < 0.001 && Math.abs(this.lookPitch) < 0.001) {
      this.camera.position.copy(this.camPos);
      this.aimed.copy(this.camLook);
      return;
    }
    this.orbitPivot.set(pose.x, pose.y + 1.05, pose.z);
    this.camOff.subVectors(this.camPos, this.orbitPivot);
    this.lookOff.subVectors(this.camLook, this.orbitPivot);
    this.yawRotate(this.camOff, this.viewYaw);
    this.yawRotate(this.lookOff, this.viewYaw);
    if (Math.abs(this.lookPitch) > 0.001) {
      this.orbitRight.set(this.camOff.z, 0, -this.camOff.x);
      if (this.orbitRight.lengthSq() < 1e-8) this.orbitRight.set(1, 0, 0);
      else this.orbitRight.normalize();
      this.camOff.applyAxisAngle(this.orbitRight, this.lookPitch);
      this.lookOff.applyAxisAngle(this.orbitRight, this.lookPitch);
    }
    this.camera.position.copy(this.orbitPivot).add(this.camOff);
    const ground = this.field.heightAt(this.camera.position.x, this.camera.position.z);
    if (this.camera.position.y < ground + 1.2) this.camera.position.y = ground + 1.2;
    this.aimed.copy(this.orbitPivot).add(this.lookOff);
  }

  /** Same yaw sense as a head turn: positive yaw swings the view to the rider's right. */
  private yawRotate(v: THREE.Vector3, yaw: number): void {
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const x = v.x * cy - v.z * sy;
    const z = v.x * sy + v.z * cy;
    v.x = x;
    v.z = z;
  }

  snapCamera(): void {
    this.camInit = false;
  }

  setFlyoverStart(s: number): void {
    this.flyS = s;
    this.camInit = false;
  }

  /**
   * Park the flyover on one stretch for a still of the landscape.
   * The rider is not part of the frame; the camera looks across the open side.
   */
  holdPreview(s: number): void {
    this.cameraMode = 'flyover';
    this.previewHold = true;
    this.valleyHold = false;
    this.frameHold = false;
    this.flyS = this.route.wrap(s);
    this.camInit = false;
  }

  /** Park the still camera at one point, looking at another. */
  holdFrame(x: number, y: number, z: number, lookX: number, lookY: number, lookZ: number): void {
    this.cameraMode = 'flyover';
    this.previewHold = true;
    this.valleyHold = false;
    this.frameHold = true;
    this.framePos.set(x, y, z);
    this.frameLook.set(lookX, lookY, lookZ);
    this.camInit = false;
  }

  /** Look up the valley from the homepage alley. No rider is framed. */
  holdValley(s: number): void {
    this.cameraMode = 'flyover';
    this.previewHold = true;
    this.valleyHold = true;
    this.frameHold = false;
    this.flyS = this.route.wrap(s);
    this.camInit = false;
  }

  /** Landscape frame: off the road, on the lower or lakeside, looking along the country. */
  private framePreview(): void {
    const r = this.route;
    if (this.frameHold) {
      this.desiredPos.copy(this.framePos);
      this.desiredLook.copy(this.frameLook);
      return;
    }
    if (this.valleyHold) {
      const here = r.sample(r.wrap(this.flyS - 70));
      const look = r.sample(r.wrap(this.flyS + 220));
      this.desiredPos.set(here.x, here.y + 22, here.z);
      this.desiredLook.set(look.x, look.y + 10, look.z);
      return;
    }
    const here = r.sample(this.flyS);
    const ahead = r.sample(r.wrap(this.flyS + 380));
    const idx = Math.min(r.count - 1, Math.max(0, Math.floor(this.flyS / ROUTE_DS)));
    const [rx, rz] = rightVector(r, idx);
    const leftY = this.field.heightAt(here.x - rx * 90, here.z - rz * 90);
    const rightY = this.field.heightAt(here.x + rx * 90, here.z + rz * 90);
    let side: 1 | -1 = rightY <= leftY ? 1 : -1;
    if (r.def.scenery.waterLevel !== null && r.def.scenery.lakeshore) {
      const leftLake = this.field.onLake(here.x - rx * 50, here.z - rz * 50);
      const rightLake = this.field.onLake(here.x + rx * 50, here.z + rz * 50);
      if (leftLake !== rightLake) side = leftLake ? -1 : 1;
    }
    const lat = 115 * side;
    this.desiredPos.set(here.x + rx * lat, here.y + 52, here.z + rz * lat);
    const look = 55 * side;
    this.desiredLook.set(ahead.x + rx * look, ahead.y + 1, ahead.z + rz * look);
  }

  /** Hold the homepage camera in one stretch of road. The rider is drawn by the caller. */
  setShowcase(s: number): void {
    this.showcaseS = s;
    this.cameraMode = 'showcase';
    this.camInit = false;
    const p = this.poseAt(s, 0, this.tmpPose);
    this.focus.set(p.x, p.y, p.z);
    this.terrain.refresh(this.focus);
  }

  dispose(): void {
    this.terrain.dispose();
    this.atmosphere.dispose();
    disposeObject(this.scene);
    this.scene.environment = null;
    this.scene.fog = null;
    this.scene.clear();
  }
}

/**
 * Frees the GPU side of everything under root: geometry, instance buffers, materials
 * and their textures. Module-cached materials (materials.ts, town signs) are kept,
 * since the next World uses them again.
 */
export function disposeObject(root: THREE.Object3D): void {
  const geos = new Set<THREE.BufferGeometry>();
  const mats = new Set<THREE.Material>();
  root.traverse((o) => {
    if (o instanceof THREE.InstancedMesh) o.dispose();
    if (!(o instanceof THREE.Mesh || o instanceof THREE.Points || o instanceof THREE.Line)) return;
    geos.add(o.geometry);
    const list = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of list) if (m && !SHARED_MATERIALS.has(m)) mats.add(m);
  });
  for (const g of geos) g.dispose();
  for (const m of mats) {
    for (const value of Object.values(m)) if (value instanceof THREE.Texture) value.dispose();
    m.dispose();
  }
}

/**
 * A real road comes back down the same way it went up. The town is planned on the
 * way up, so mark the way down through the same streets too, or trees would grow
 * in them wherever the descent happens to be the nearest road sample.
 */
function markOverlappingTown(route: Route, town: Uint8Array): void {
  const cell = 16;
  const keyOf = (x: number, z: number) => `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
  const cells = new Set<string>();
  for (let i = 0; i < route.count; i++) if (town[i]) cells.add(keyOf(route.x[i], route.z[i]));
  if (!cells.size) return;
  for (let i = 0; i < route.count; i++) if (!town[i] && cells.has(keyOf(route.x[i], route.z[i]))) town[i] = 1;
}
