import * as THREE from 'three';
import type { Route } from '../routes/route';
import { ROUTE_DS } from '../routes/route';
import { mulberry32 } from '../util/math';
import { InstancedModel, prepare, type Prepared } from './batch';
import { buildCar, buildCarWheel, CAR_KINDS, carSpec, pickPaint, wheelMatrices, type CarKind, type CarSpec } from './cars';
import type { Detail } from './geometry';
import type { Signal } from './settlement';

interface Car {
  id: number;
  kind: CarKind;
  spec: CarSpec;
  paint: THREE.Color;
  s: number;
  /** Current speed, m/s. */
  speed: number;
  /** Speed the driver settles at on a clear road. */
  cruise: number;
  lat: number;
  /** +1 rides with the cyclists, -1 is oncoming. */
  dir: 1 | -1;
  /** Wheel angle, radians. */
  spin: number;
  /** Brake light level, 0..1. */
  brake: number;
}

/** A cyclist the cars should pull out for. */
export interface LaneUser {
  s: number;
  lat: number;
  speed: number;
  dir: 1 | -1;
  /** Last rider off a time-trial ramp. The tail bike follows this one and ignores the others. */
  broom?: boolean;
}

/** Right-hand lane for traffic going with the riders. */
const WITH_RIGHT = 2.25;
/** Oncoming traffic's own right-hand lane (our left). */
const AGAINST_RIGHT = -2.2;
/** Other lane, used only while a pass is in progress. Far enough that the body stays off the centre line. */
const PASS_LAT = 1.9;

export interface LaneOccupant {
  s: number;
  lat: number;
  speed: number;
  dir: 1 | -1;
  length: number;
}

/**
 * Right lane, unless a slower vehicle just ahead is in the way and the other lane is free.
 * A finished pass does not leave the car on the centre line: once its tail is clear it aims home.
 */
export function chooseLane(
  car: LaneOccupant & { cruise: number },
  home: number,
  len: number,
  others: LaneOccupant[],
): number {
  const dir = car.dir;
  const pass = dir === 1 ? -PASS_LAT : PASS_LAT;
  const committed = dir === 1 ? car.lat < home - 1.2 : car.lat > home + 1.2;
  let need = false;
  for (const other of others) {
    if (other.dir !== dir) continue;
    const inOurLane = dir === 1 ? other.lat > 0.3 : other.lat < -0.3;
    if (!inOurLane) continue;
    const ahead = gapAhead(car.s, other.s, len, dir);
    const behind = (len - ahead) % len;
    const nose = (car.length + other.length) / 2;
    if (ahead > 0.5 && ahead < nose + 16 && other.speed < car.cruise - 0.3) need = true;
    if (committed && behind < nose + 4 && behind < len * 0.5) need = true;
  }
  if (!need) return home;
  if (!committed && oncomingClose(car, len, others)) return home;
  return pass;
}

/** An oncoming vehicle close enough that pulling out would meet it. */
function oncomingClose(car: LaneOccupant, len: number, others: LaneOccupant[]): boolean {
  for (const other of others) {
    if (other.dir === car.dir) continue;
    if (gapAhead(car.s, other.s, len, car.dir) < 70) return true;
  }
  return false;
}

function gapAhead(from: number, to: number, len: number, dir: 1 | -1): number {
  return (((to - from) * dir) % len + len) % len;
}

/** Hatchbacks and SUVs are the commonest, vans the rarest. */
const KIND_WEIGHTS: Record<CarKind, number> = { city: 20, hatch: 30, sedan: 20, suv: 22, van: 8 };
const ACCEL = 1.8;
const BRAKE = 4.5;
/** Full detail inside this range, middle detail inside MID, cheap beyond, hidden past FAR. */
const NEAR = 40;
const MID = 150;
const FAR = 900;
const NEAR_MAX = 6;
/** Lane choice only looks at vehicles and riders this close along the road. */
const LANE_REACH = 90;

function pickKind(r: number): CarKind {
  const total = CAR_KINDS.reduce((a, k) => a + KIND_WEIGHTS[k], 0);
  let t = r * total;
  for (const k of CAR_KINDS) {
    t -= KIND_WEIGHTS[k];
    if (t <= 0) return k;
  }
  return 'hatch';
}

/** Instances of one car model at one detail, packed from slot 0 every frame. */
class Layer {
  readonly model: InstancedModel;
  private n = 0;
  private owner: Int32Array;
  private lit: Float32Array;
  private readonly brake = new THREE.Color();

  constructor(prepared: Prepared, capacity: number, shadows: boolean) {
    this.model = new InstancedModel(prepared, capacity, { shadows });
    this.owner = new Int32Array(capacity).fill(-1);
    this.lit = new Float32Array(capacity).fill(-1);
  }

  put(car: Car, m: THREE.Matrix4, brake: number): boolean {
    if (this.n >= this.model.capacity) return false;
    const i = this.n++;
    this.model.setMatrix(i, m);
    if (this.owner[i] !== car.id) {
      this.owner[i] = car.id;
      this.model.setTint(i, 'paint', car.paint);
      this.lit[i] = -1;
    }
    if (this.lit[i] !== brake) {
      this.lit[i] = brake;
      this.model.setTint(i, 'brake', this.brake.setScalar(brake));
    }
    return true;
  }

  finish(): void {
    this.model.count = this.n;
    this.model.commit();
    this.n = 0;
  }
}

class WheelLayer {
  readonly model: InstancedModel;
  private n = 0;

  constructor(prepared: Prepared, capacity: number, shadows: boolean) {
    this.model = new InstancedModel(prepared, capacity, { shadows });
  }

  put(ms: THREE.Matrix4[]): void {
    for (const m of ms) {
      if (this.n >= this.model.capacity) return;
      this.model.setMatrix(this.n++, m);
    }
  }

  finish(): void {
    this.model.count = this.n;
    this.model.commit();
    this.n = 0;
  }
}

/** Cars keep the right lane and move left only while passing, then return. */
export class Traffic {
  readonly group = new THREE.Group();
  private cars: Car[] = [];
  private layers = new Map<CarKind, Layer[]>();
  private wheels: WheelLayer[] = [];
  private dummy = new THREE.Object3D();
  private wheelMats = Array.from({ length: 4 }, () => new THREE.Matrix4());
  private enabled = true;
  /** Every car, then every rider, refilled once per update. Objects are reused. */
  private occupants: LaneOccupant[] = [];
  private occupantCount = 0;
  /** Occupants near the car whose lane is being chosen. */
  private nearby: LaneOccupant[] = [];
  private sample = { x: 0, y: 0, z: 0, tx: 1, tz: 0, grade: 0 };

  constructor(
    private route: Route,
    private signals: Signal[] = [],
  ) {
    const rng = mulberry32(route.def.seed + 321);
    const each = Math.max(8, Math.min(26, Math.round(route.length / 2500)));
    const add = (s: number, cruise: number, lat: number, dir: 1 | -1) => {
      const kind = pickKind(rng());
      const spec = carSpec(kind);
      // Vans and city cars potter along, the rest go a little quicker.
      const pace = kind === 'van' ? 0.9 : kind === 'city' ? 0.94 : 1;
      this.cars.push({
        id: this.cars.length, kind, spec, paint: new THREE.Color(pickPaint(rng())),
        s, speed: cruise * pace, cruise: cruise * pace, lat, dir, spin: rng() * 6, brake: 0,
      });
    };
    for (let i = 0; i < each; i++) {
      add(((i + rng()) / each) * route.length, 11 + rng() * 8, WITH_RIGHT + (rng() - 0.5) * 0.15, 1);
      add(((i + 0.5) / each) * route.length, 12 + rng() * 9, AGAINST_RIGHT + (rng() - 0.5) * 0.15, -1);
    }

    const counts = new Map<CarKind, number>();
    for (const c of this.cars) counts.set(c.kind, (counts.get(c.kind) ?? 0) + 1);
    for (const kind of CAR_KINDS) {
      const n = counts.get(kind) ?? 0;
      if (!n) continue;
      const lods = ([0, 1, 2] as Detail[]).map((d) => new Layer(prepare(buildCar(kind, d)), d === 0 ? Math.min(n, NEAR_MAX) : n, d < 2));
      for (const l of lods) this.group.add(l.model.group);
      this.layers.set(kind, lods);
    }
    const total = this.cars.length;
    // Each kind keeps up to NEAR_MAX cars at full detail, so the near wheels need room for all of them.
    this.wheels = ([0, 1, 2] as Detail[]).map((d) => new WheelLayer(prepare(buildCarWheel(d)), 4 * (d === 0 ? Math.min(total, NEAR_MAX * CAR_KINDS.length) : total), d < 2));
    for (const w of this.wheels) this.group.add(w.model.group);
    this.group.name = 'traffic';
  }

  /** Hill-climb races keep the road clear. */
  setEnabled(on: boolean): void {
    this.enabled = on;
    this.group.visible = on;
  }

  update(dt: number, riders: LaneUser[] = [], eye?: THREE.Vector3): void {
    if (!this.enabled) return;
    const route = this.route;
    const len = route.length;
    this.fillOccupants(riders);
    for (let ci = 0; ci < this.cars.length; ci++) {
      const car = this.cars[ci];
      const home = car.dir === 1 ? WITH_RIGHT : AGAINST_RIGHT;
      const hold = this.holdForCyclists(car, len, riders);
      const target = hold ? home : this.laneTarget(ci, car, home, len);
      // Stay at cruise only while actually moving into the other lane. In the right lane, match whoever is ahead.
      const changing = car.dir === 1 ? target < home - 0.5 : target > home + 0.5;
      const pace = hold || !changing ? this.waitingSpeed(car, len, riders) : car.cruise;
      const want = Math.max(0, Math.min(pace, this.signalSpeed(car, len), this.followSpeed(car, len)));
      car.speed = Math.max(0, car.speed + Math.max(-BRAKE * dt, Math.min(ACCEL * dt, want - car.speed)));
      const braking = want < car.speed - 0.25 || (car.speed < 0.5 && want < 0.5) ? 1 : 0;
      car.brake += (braking - car.brake) * Math.min(1, dt * (braking ? 12 : 4));
      car.lat += Math.max(-3.2 * dt, Math.min(3.2 * dt, target - car.lat));
      car.s = route.wrap(car.s + car.dir * car.speed * dt);
      car.spin = (car.spin + (car.speed * dt) / car.spec.wheelR) % (Math.PI * 2);
    }
    this.draw(eye);
  }

  private draw(eye?: THREE.Vector3): void {
    const route = this.route;
    const sample = this.sample;
    for (const car of this.cars) {
      route.sample(car.s, sample);
      const idx = Math.floor(route.wrap(car.s) / ROUTE_DS);
      // Right vector, as rightVector() gives it, without the array.
      const rx = -route.tz[idx];
      const rz = route.tx[idx];
      const x = sample.x + rx * car.lat;
      const z = sample.z + rz * car.lat;
      const d = eye ? Math.hypot(x - eye.x, sample.y - eye.y, z - eye.z) : MID;
      if (d > FAR) continue;
      const yaw = Math.atan2(-sample.tz, sample.tx) + (car.dir === -1 ? Math.PI : 0);
      const pitch = Math.atan(sample.grade) * car.dir;
      this.dummy.position.set(x, sample.y + 0.02, z);
      this.dummy.rotation.set(0, yaw, pitch, 'YZX');
      this.dummy.updateMatrix();
      const lods = this.layers.get(car.kind)!;
      let lod = d < NEAR ? 0 : d < MID ? 1 : 2;
      const brake = 1 + Math.round(car.brake * 8) * 0.5;
      if (!lods[lod].put(car, this.dummy.matrix, brake)) {
        lod = 1;
        lods[1].put(car, this.dummy.matrix, brake);
      }
      wheelMatrices(car.spec, this.dummy.matrix, car.spin, this.wheelMats);
      this.wheels[lod].put(this.wheelMats);
    }
    for (const lods of this.layers.values()) for (const l of lods) l.finish();
    for (const w of this.wheels) w.finish();
  }

  /** Ease to a stop before a red light, unless already too close to stop comfortably. */
  private signalSpeed(car: Car, len: number): number {
    let v = Infinity;
    for (const sig of this.signals) {
      if (!sig.red || sig.dir !== car.dir) continue;
      const gap = this.gapAhead(car.s, sig.s, len, car.dir) - car.spec.length / 2 - 0.6;
      if (gap > 70 || gap < -0.3) continue;
      const stopping = (car.speed * car.speed) / (2 * 3.2);
      if (car.speed > 4 && gap < stopping * 0.6) continue;
      v = Math.min(v, Math.sqrt(2 * 2.6 * Math.max(0, gap)));
    }
    return v;
  }

  /** Keep a few metres behind the car ahead in the same lane. */
  private followSpeed(car: Car, len: number): number {
    let v = Infinity;
    for (const other of this.cars) {
      if (other === car || other.dir !== car.dir || Math.abs(other.lat - car.lat) > 1.7) continue;
      const gap = this.gapAhead(car.s, other.s, len, car.dir) - (car.spec.length + other.spec.length) / 2;
      if (gap > 45) continue;
      v = Math.min(v, other.speed + (gap - 3) * 0.5);
    }
    return v;
  }

  /** Distance `from` must travel, in its own direction, to reach `to`. */
  private gapAhead(from: number, to: number, len: number, dir: 1 | -1): number {
    return gapAhead(from, to, len, dir);
  }

  /** A cyclist who has pulled out of the right-hand files to pass someone. */
  private riderIsPassing(car: Car, rider: LaneUser): boolean {
    if (rider.dir !== car.dir) return false;
    return car.dir === 1 ? rider.lat < 1.05 : rider.lat > -1.15;
  }

  /** Stay in lane while cyclists are alongside, passing each other. Pull out only after they close up. */
  private holdForCyclists(car: Car, len: number, riders: LaneUser[]): boolean {
    for (const rider of riders) {
      if (!this.riderIsPassing(car, rider)) continue;
      const ahead = this.gapAhead(car.s, rider.s, len, car.dir);
      const behind = (len - ahead) % len;
      if (ahead < 40 || behind < 12) return true;
    }
    return false;
  }

  /** Match the riders ahead so the car does not drive into them while it stays in lane. */
  private waitingSpeed(car: Car, len: number, riders: LaneUser[]): number {
    let pace = car.cruise;
    for (const rider of riders) {
      if (rider.dir !== car.dir) continue;
      const ahead = this.gapAhead(car.s, rider.s, len, car.dir);
      if (ahead > 22) continue;
      pace = Math.min(pace, ahead < 12 ? rider.speed * 0.92 : rider.speed);
    }
    return Math.max(2, pace);
  }

  /** Snapshot of every car and rider for this frame's lane choices, in pooled objects. */
  private fillOccupants(riders: LaneUser[]): void {
    const pool = this.occupants;
    let n = 0;
    const put = (s: number, lat: number, speed: number, dir: 1 | -1, length: number) => {
      const o = pool[n] ?? (pool[n] = { s: 0, lat: 0, speed: 0, dir: 1, length: 0 });
      o.s = s;
      o.lat = lat;
      o.speed = speed;
      o.dir = dir;
      o.length = length;
      n++;
    };
    for (const c of this.cars) put(c.s, c.lat, c.speed, c.dir, c.spec.length);
    for (const r of riders) put(r.s, r.lat, r.speed, r.dir, 1.8);
    this.occupantCount = n;
  }

  /** Other lane for a close pass, then home. Never the centre line. */
  private laneTarget(index: number, car: Car, home: number, len: number): number {
    const near = this.nearby;
    near.length = 0;
    for (let i = 0; i < this.occupantCount; i++) {
      if (i === index) continue;
      const o = this.occupants[i];
      const d = Math.abs(o.s - car.s) % len;
      if (Math.min(d, len - d) > LANE_REACH) continue;
      near.push(o);
    }
    // Same values as the car's live state; chooseLane reads them before this car moves.
    const self = this.occupants[index];
    this.selfLane.s = self.s;
    this.selfLane.lat = self.lat;
    this.selfLane.speed = self.speed;
    this.selfLane.dir = self.dir;
    this.selfLane.length = self.length;
    this.selfLane.cruise = car.cruise;
    return chooseLane(this.selfLane, home, len, near);
  }

  private selfLane: LaneOccupant & { cruise: number } = { s: 0, lat: 0, speed: 0, dir: 1, length: 0, cruise: 0 };
}
