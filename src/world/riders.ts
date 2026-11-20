import * as THREE from 'three';
import { InstancedModel, markRange, prepare } from './batch';
import { BB, BRANDS, brandAtlas, brandSpec, buildBike, crankModel, CRANK, decalColor, FRONT_AXLE, REAR_AXLE, type BikeBrand } from './bikes';
import { ANKLE, buildBody, FOOT_Z, HIP, LEG_Z, SHIN, THIGH } from './riderBody';

export interface RiderColors {
  jersey: string;
  jerseyAccent: string;
  shorts: string;
  helmet: string;
  frame: string;
  wheels: string;
  shoes: string;
  skin: string;
  /** Mountains jersey dots. Absent on every other kit. */
  polka?: string;
  /** Frame brand. Cosmetic only. */
  bike: BikeBrand;
  /** Wheel brand. Cosmetic only, and bought separately from the frame. Defaults to the frame. */
  wheelBrand?: BikeBrand;
}

export const DEFAULT_COLORS: RiderColors = {
  jersey: '#1fa39a',
  jerseyAccent: '#ffffff',
  shorts: '#1b1f27',
  helmet: '#f4f4f4',
  frame: '#e2412e',
  wheels: '#20232a',
  shoes: '#f4f4f4',
  skin: '#e0b48f',
  bike: 'montvar',
  wheelBrand: 'montvar',
};

export interface RiderPose {
  x: number;
  y: number;
  z: number;
  /** Unit direction of travel in XZ. */
  tx: number;
  tz: number;
  grade: number;
  /** Crank angle in radians. */
  crank: number;
  /** Wheel rotation in radians. */
  wheel: number;
  /** 0..1 how much the rider is standing / rocking (climbing efforts). */
  effort: number;
  visible: boolean;
  /** First person: draw the bike and hide the body, so the bars stay in frame. */
  cockpit?: boolean;
  /** Gold ring on the road under the player's bike, used in a race. */
  mark?: boolean;
  /** Coloured ring under a teammate or a classification leader. */
  ring?: 'team' | 'yellow' | 'green' | 'polka' | 'pink' | 'red';
}

/** Riders closer than this to the camera get the detailed models, up to NEAR_MAX of them. */
const NEAR = 30;
const NEAR_MAX = 16;
/** Beyond this, the far models. */
const MID = 70;

interface Look {
  brand: number;
  wheel: number;
  tint: Record<string, THREE.Color>;
  decal: THREE.Color;
}

function lookFor(rc: RiderColors): Look {
  const spec = brandSpec(rc.bike);
  const wheels = brandSpec(rc.wheelBrand ?? rc.bike);
  const c = (hex: string) => new THREE.Color(hex);
  return {
    brand: Math.max(0, BRANDS.indexOf(spec)),
    wheel: Math.max(0, BRANDS.indexOf(wheels)),
    tint: {
      jersey: c(rc.jersey),
      jerseyAccent: c(rc.jerseyAccent),
      shorts: c(rc.shorts),
      helmet: c(rc.helmet),
      skin: c(rc.skin),
      shoes: c(rc.shoes),
      socks: c(rc.shoes).lerp(c('#ffffff'), 0.35),
      frame: c(rc.frame),
      wheels: c(rc.wheels),
      bottle: c(rc.jersey),
      crank: c(spec.crank),
    },
    decal: c(decalColor(rc.frame, rc.jerseyAccent)),
  };
}

/** One instanced model filled from scratch each frame, re-tinting a slot only when its rider changes. */
class Layer {
  n = 0;
  private owner: Int32Array;
  private slots: string[];

  constructor(readonly model: InstancedModel) {
    this.owner = new Int32Array(model.capacity).fill(-1);
    this.slots = [...new Set(model.meshes.map((m) => m.tint).filter((t): t is string => !!t))];
  }

  put(rider: number, m: THREE.Matrix4, look: Look): void {
    const k = this.n++;
    this.model.setMatrix(k, m);
    if (this.owner[k] === rider) return;
    this.owner[k] = rider;
    for (const s of this.slots) this.model.setTint(k, s, look.tint[s]);
  }

  invalidate(): void {
    this.owner.fill(-1);
  }

  finish(): void {
    this.model.count = this.n;
    this.model.commit();
    this.n = 0;
  }
}

/** Down-tube logos for one brand, coloured per rider. */
class DecalLayer {
  n = 0;
  readonly mesh: THREE.InstancedMesh;
  private owner: Int32Array;

  constructor(geom: THREE.BufferGeometry, mat: THREE.Material, capacity: number) {
    this.mesh = new THREE.InstancedMesh(geom, mat, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.renderOrder = 1;
    this.owner = new Int32Array(capacity).fill(-1);
    for (let i = 0; i < capacity; i++) this.mesh.setColorAt(i, new THREE.Color(1, 1, 1));
  }

  put(rider: number, m: THREE.Matrix4, look: Look): void {
    const k = this.n++;
    this.mesh.setMatrixAt(k, m);
    if (this.owner[k] === rider) return;
    this.owner[k] = rider;
    this.mesh.setColorAt(k, look.decal);
    this.colorDirty = true;
  }

  private colorDirty = true;

  invalidate(): void {
    this.owner.fill(-1);
  }

  finish(): void {
    this.mesh.count = this.n;
    this.mesh.visible = this.n > 0;
    if (this.n > 0) {
      markRange(this.mesh.instanceMatrix, this.n * 16);
      if (this.colorDirty && this.mesh.instanceColor) markRange(this.mesh.instanceColor, this.n * 3);
      this.colorDirty = false;
    }
    this.n = 0;
  }
}

interface LodSet {
  body: Layer;
  /** Red circles, only for the mountains jersey. */
  polka: Layer;
  thigh: Layer;
  shin: Layer;
  foot: Layer;
  crank: Layer;
  /** Per brand. */
  frame: Layer[];
  wheel: Layer[];
}

/**
 * All riders (AI + player). Each brand and level of detail is a set of InstancedMeshes,
 * filled each frame with only the riders that use it.
 */
export class RiderRenderer {
  readonly group = new THREE.Group();
  private lods: LodSet[] = [];
  private decals: DecalLayer[] = [];
  private looks: Look[] = [];
  private colors: RiderColors[] = [];
  private readonly capacity: number;
  private marker: THREE.Mesh;
  private teamRings: THREE.Mesh[] = [];
  private jerseyRings: THREE.Mesh[] = [];
  count = 0;

  constructor(capacity: number) {
    this.capacity = capacity;
    const atlas = brandAtlas();
    const decalMat = new THREE.MeshStandardMaterial({
      map: atlas.texture,
      transparent: true,
      alphaTest: 0.35,
      roughness: 0.3,
      metalness: 0.2,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      depthWrite: false,
    });
    for (const detail of [0, 1, 2] as const) {
      const body = buildBody(detail);
      const near = detail === 0;
      const cap = near ? Math.min(capacity, NEAR_MAX) : capacity;
      const layer = (model: Parameters<typeof prepare>[0], n = cap) => {
        // Sun shadows are too coarse for a person; they only show as blotches on the body.
        const im = new InstancedModel(prepare(model), n, { shadows: true, receive: false });
        this.group.add(im.group);
        return new Layer(im);
      };
      const set: LodSet = {
        body: layer(body.body),
        polka: layer(body.polka),
        thigh: layer(body.thigh, cap * 2),
        shin: layer(body.shin, cap * 2),
        foot: layer(body.foot, cap * 2),
        crank: layer(crankModel(detail)),
        frame: [],
        wheel: [],
      };
      BRANDS.forEach((spec, row) => {
        const bike = buildBike(spec, detail, row, atlas.rows);
        set.frame.push(layer(bike.frame));
        set.wheel.push(layer(bike.wheel, cap * 2));
        if (near && bike.decal) {
          const d = new DecalLayer(bike.decal, decalMat, cap);
          this.decals.push(d);
          this.group.add(d.mesh);
        }
      });
      this.lods.push(set);
    }

    const ringGeom = new THREE.TorusGeometry(0.95, 0.07, 8, 40);
    ringGeom.rotateX(Math.PI / 2);
    this.marker = new THREE.Mesh(
      ringGeom,
      new THREE.MeshBasicMaterial({
        color: 0xff7f2a,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    );
    this.marker.visible = false;
    this.marker.frustumCulled = false;
    this.marker.renderOrder = 3;
    this.group.add(this.marker);
    for (let i = 0; i < 8; i++) {
      const mate = new THREE.Mesh(
        ringGeom,
        new THREE.MeshBasicMaterial({
          color: 0x3ec6ff,
          transparent: true,
          opacity: 0.9,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
        }),
      );
      mate.visible = false;
      mate.frustumCulled = false;
      mate.renderOrder = 3;
      this.teamRings.push(mate);
      this.group.add(mate);
    }
    const discGeom = new THREE.CircleGeometry(1.35, 24);
    discGeom.rotateX(-Math.PI / 2);
    for (let i = 0; i < 6; i++) {
      const jersey = new THREE.Mesh(
        discGeom,
        new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0.92,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -4,
          polygonOffsetUnits: -4,
        }),
      );
      jersey.visible = false;
      jersey.frustumCulled = false;
      jersey.renderOrder = 3;
      this.jerseyRings.push(jersey);
      this.group.add(jersey);
    }
  }

  setColors(list: RiderColors[]): void {
    this.colors = list.slice(0, this.capacity);
    this.count = this.colors.length;
    this.looks = this.colors.map(lookFor);
    for (const set of this.lods) {
      for (const l of [set.body, set.polka, set.thigh, set.shin, set.foot, set.crank, ...set.frame, ...set.wheel]) l.invalidate();
    }
    for (const d of this.decals) d.invalidate();
  }

  setRiderColors(index: number, rc: RiderColors): void {
    if (index >= this.colors.length) return;
    this.colors[index] = rc;
    this.setColors(this.colors);
  }

  private base = new THREE.Matrix4();
  private local = new THREE.Matrix4();
  private tmp = new THREE.Matrix4();
  private quat = new THREE.Quaternion();
  private euler = new THREE.Euler();
  private pos = new THREE.Vector3();
  private one = new THREE.Vector3(1, 1, 1);
  private pedal = new THREE.Vector3();
  private ankle = new THREE.Vector3();
  private hip = new THREE.Vector3();
  private knee = new THREE.Vector3();

  /** @param eye camera position, for picking the level of detail */
  update(poses: RiderPose[], eye?: THREE.Vector3): void {
    const n = Math.min(poses.length, this.count);
    this.marker.visible = false;
    for (const ring of this.teamRings) ring.visible = false;
    for (const ring of this.jerseyRings) ring.visible = false;
    let teamRing = 0;
    let jerseyRing = 0;
    const jerseyColor: Record<string, number> = { yellow: 0xffe100, green: 0x128a3e, polka: 0xf4f4f4, pink: 0xf4a3c7, red: 0xe10600 };
    let nearCount = 0;
    for (let i = 0; i < n; i++) {
      const p = poses[i];
      if (!p.visible) continue;
      const look = this.looks[i];
      let lod = 1;
      if (!eye) lod = nearCount < NEAR_MAX ? 0 : 1;
      else {
        const dx = p.x - eye.x;
        const dy = p.y - eye.y;
        const dz = p.z - eye.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < NEAR * NEAR && nearCount < NEAR_MAX) lod = 0;
        else if (d2 > MID * MID) lod = 2;
      }
      if (lod === 0) nearCount++;
      const set = this.lods[lod];

      const yaw = Math.atan2(-p.tz, p.tx);
      const pitch = Math.atan(p.grade);
      const cockpit = p.cockpit === true;
      // A small rock with each pedal stroke. The first-person bike stays level under the camera.
      const sway = cockpit ? 0 : Math.sin(p.crank) * (0.008 + p.effort * 0.018);
      this.euler.set(sway, yaw, pitch, 'YZX');
      this.quat.setFromEuler(this.euler);
      this.pos.set(p.x, p.y, p.z);
      this.base.compose(this.pos, this.quat, this.one);
      const jersey = !cockpit && p.ring && p.ring !== 'team' ? this.jerseyRings[jerseyRing++] : undefined;
      const mesh = jersey ?? (!cockpit && p.mark ? this.marker : !cockpit && p.ring === 'team' ? this.teamRings[teamRing++] : undefined);
      if (mesh) {
        if (jersey) (jersey.material as THREE.MeshBasicMaterial).color.setHex(jerseyColor[p.ring!] ?? 0xffffff);
        mesh.visible = true;
        mesh.position.set(p.x, p.y + 0.07, p.z);
        this.euler.set(0, yaw, pitch, 'YZX');
        mesh.quaternion.setFromEuler(this.euler);
      }
      if (!cockpit) {
        set.body.put(i, this.base, look);
        if (this.colors[i].polka) set.polka.put(i, this.base, look);
      }
      set.frame[look.brand].put(i, this.base, look);
      if (lod === 0) this.decals[look.brand].put(i, this.base, look);

      const wheels = set.wheel[look.wheel];
      this.local.makeRotationZ(-p.wheel).setPosition(FRONT_AXLE);
      wheels.put(i, this.tmp.multiplyMatrices(this.base, this.local), look);
      this.local.makeRotationZ(-p.wheel - 1.3).setPosition(REAR_AXLE);
      wheels.put(i, this.tmp.multiplyMatrices(this.base, this.local), look);

      if (cockpit) continue;
      // Negative crank: viewed from the right, the feet turn clockwise, so the front foot goes down.
      this.local.makeRotationZ(-p.crank + Math.PI).setPosition(BB);
      set.crank.put(i, this.tmp.multiplyMatrices(this.base, this.local), look);

      for (let k = 0; k < 2; k++) {
        const side = k === 0 ? -1 : 1;
        const a = -p.crank + (k === 0 ? 0 : Math.PI);
        this.pedal.set(BB.x + Math.cos(a) * CRANK, BB.y + Math.sin(a) * CRANK, side * FOOT_Z);
        // Toes drop through the downstroke and lift over the top.
        const phi = 0.22 - 0.1 * Math.sin(a) - 0.06 * Math.cos(a);
        const c = Math.cos(-phi);
        const s = Math.sin(-phi);
        this.ankle.set(this.pedal.x + ANKLE.x * c - ANKLE.y * s, this.pedal.y + ANKLE.x * s + ANKLE.y * c, this.pedal.z);
        this.hip.set(HIP.x, HIP.y, side * LEG_Z);
        solveKnee(this.hip, this.ankle, this.knee);
        set.thigh.put(i, this.tmp.multiplyMatrices(this.base, segmentMatrix(this.hip, this.knee, this.local)), look);
        set.shin.put(i, this.tmp.multiplyMatrices(this.base, segmentMatrix(this.knee, this.ankle, this.local)), look);
        this.local.makeRotationZ(-phi).setPosition(this.pedal);
        set.foot.put(i, this.tmp.multiplyMatrices(this.base, this.local), look);
      }
    }
    for (const set of this.lods) {
      for (const l of [set.body, set.polka, set.thigh, set.shin, set.foot, set.crank, ...set.frame, ...set.wheel]) l.finish();
    }
    for (const d of this.decals) d.finish();
  }
}

const _dir = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _y = new THREE.Vector3(0, 1, 0);

/** Rotation that points +y from a to b, placed at a. Limbs are modelled at full length. */
function segmentMatrix(a: THREE.Vector3, b: THREE.Vector3, out: THREE.Matrix4): THREE.Matrix4 {
  _dir.subVectors(b, a).normalize();
  _q.setFromUnitVectors(_y, _dir);
  return out.makeRotationFromQuaternion(_q).setPosition(a);
}

/** Two-bone IK in the sagittal plane: knee bends forward. */
function solveKnee(hip: THREE.Vector3, foot: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  const dx = foot.x - hip.x;
  const dy = foot.y - hip.y;
  let d = Math.hypot(dx, dy);
  d = Math.min(d, THIGH + SHIN - 1e-3);
  const a = Math.acos(Math.max(-1, Math.min(1, (THIGH * THIGH + d * d - SHIN * SHIN) / (2 * THIGH * d))));
  const base = Math.atan2(dy, dx);
  const ang = base + a;
  out.set(hip.x + Math.cos(ang) * THIGH, hip.y + Math.sin(ang) * THIGH, (hip.z + foot.z) / 2);
  return out;
}
