import { RideSim, type Racer } from '../ai/peloton';
import { PowerMeter } from '../ai/powerMeter';
import type { RoadBody, RoadPlan, RoadStarter } from '../ai/road';
import type { DeviceManager } from '../ble/devices';
import type { Climb, Route } from '../routes/route';
import type { ClimbEffort, Profile, RideSample, RideSummary, WorkoutResult } from '../storage/types';
import { isRampTestStep, RampTest, sampleTwentyMinute, type TwentyWindow } from '../training/ftp';
import { cueAt, stepAt, zoneName, type ActiveWorkout, type WorkoutCue } from '../training/workout';
import { uuid } from '../util/math';
import { RollingMean } from '../util/rolling';
import { WHEEL_R } from '../world/bikes';
import type { RiderPose } from '../world/riders';
import { climbsInside, passedMarkBackward } from './climbRecord';
import { RideRecorder } from './recorder';

export type SessionMode = 'free' | 'race' | 'train';
export type SessionState = 'countdown' | 'riding' | 'paused' | 'finished';

export interface SessionConfig {
  mode: SessionMode;
  route: Route;
  climb?: Climb;
  aiCount: number;
  /** Hill-climb only: strongest and slowest AI, in W/kg. */
  topWkg?: number;
  bottomWkg?: number;
  profile: Profile;
  seed?: number;
  /** Free-ride start along the loop. Races ignore this and start at the climb. */
  startS?: number;
  /** Free ride only. -1 starts the rider going backwards around the loop. */
  startDirection?: 1 | -1;
  /** Free-ride pacer, in W/kg. Flat, hills of 2–5%, and steeper climbs. */
  buddy?: { flat: number; hill: number; mountain: number };
  /** Structured workout. Training rides only. */
  workout?: ActiveWorkout;
  /** Career road stage. Hill-climbs leave this unset. */
  career?: {
    title: string;
    road: RoadPlan;
    field: RoadStarter[];
    playerBody: RoadBody;
    leaders?: { time: string; sprint: string; mountains: string };
  };
}

interface ClimbTracker {
  climb: Climb;
  startTime: number | null;
  startEnergy: number;
}

const COUNTDOWN = 10;
const VISIBLE_RANGE = 450;

/** Other riders out on a free-ride loop, dense enough that the road stays busy. */
export function freeRiderCount(lengthM: number): number {
  return Math.max(80, Math.min(240, Math.round(lengthM / 150)));
}

export class RideSession {
  readonly sim: RideSim;
  readonly recorder: RideRecorder;
  state: SessionState;
  countdown = COUNTDOWN;
  /** Distance ridden by the player from the start. */
  distance = 0;
  rideTime = 0;
  energyJ = 0;
  /** Metres of climbing already ridden. Descents do not add to this. */
  climbedM = 0;
  private startS: number;
  /** Last 3 s of power. Sized for 120 updates a second, the most the window keeps. */
  private powerWindow = new RollingMean(361);
  private climbTrackers: ClimbTracker[];
  readonly newEfforts: ClimbEffort[] = [];
  /** True only while the rider is rolling through the banner, before the results card. */
  coasting = false;
  /** Time trial: the camera sits on the finish while riders who were behind come through. */
  watchingFinish = false;
  private ttLine = false;
  private lineWatchIds: number[] = [];
  /** Shown when you cross the line and riders are still behind. */
  onLine?: () => void;
  /** The riders who were behind have all finished. */
  onWatched?: () => void;
  /** True while B is held and the ride is underway. Speed is falling toward a stop. */
  braking = false;
  /** Training: the trainer holds the workout target. */
  erg = true;
  /** 1 means the plan as written. Arrow keys nudge this while ERG is on. */
  ergBias = 1;
  ftpEstimate: number | null = null;
  /** Average watts across the 20-minute effort, once that window is complete. */
  ftpAverage: number | null = null;
  private twenty: TwentyWindow = { joules: 0, sec: 0 };
  private ftpFromStop = false;
  /** Per-second power through the ramp test. FTP is 75% of its best 60-second average. */
  private ramp = new RampTest();
  private failArm = 0;
  private ftpFailedAt: number | null = null;
  private hit = 0;
  private miss = 0;
  private workoutClosed = false;
  private poses: RiderPose[] = [];
  /** Every rider's power, read from how they actually move. Shown when you point at a rider. */
  readonly meter = new PowerMeter();
  onFinish?: () => void;

  constructor(readonly config: SessionConfig) {
    const { route, profile, mode, climb } = config;
    const startS = mode === 'race' && climb ? climb.start : (config.startS ?? 0);
    this.startS = startS;
    this.sim = new RideSim(route, {
      startS,
      finishS: mode === 'race' && climb ? climb.end : Infinity,
      aiCount: mode === 'race' ? config.aiCount : freeRiderCount(route.length),
      topWkg: config.topWkg,
      bottomWkg: config.bottomWkg,
      road: config.career?.road,
      roadField: config.career?.field,
      playerRoad: config.career?.playerBody,
      freeRide: mode !== 'race',
      buddy: mode === 'free' ? config.buddy : undefined,
      startDirection: mode === 'free' ? config.startDirection : undefined,
      seed: config.seed ?? Math.floor(Math.random() * 1e9),
      player: { name: profile.name || 'You', massKg: profile.weightKg, ftp: profile.ftp, colors: profile.colors },
    });
    this.recorder = new RideRecorder();
    this.state = mode === 'race' ? 'countdown' : 'riding';
    if (mode !== 'race') this.sim.started = true;
    this.climbTrackers = this.trackersForRoute();
    this.poses = this.sim.racers.map(() => ({ x: 0, y: 0, z: 0, tx: 1, tz: 0, grade: 0, crank: 0, wheel: 0, effort: 0, visible: true }));
  }

  get route(): Route {
    return this.config.route;
  }

  get player(): Racer {
    return this.sim.player;
  }

  get playerS(): number {
    return this.sim.player.s;
  }

  /** Slope the rider feels, looking `ahead` metres along the way they are facing. */
  feltGrade(ahead = 0): number {
    const p = this.sim.player;
    return this.route.gradeAt(p.s + ahead * p.direction) * p.direction;
  }

  /** Free rides and training plans, and only while the bike is stopped. */
  canTurnAround(): boolean {
    return this.config.mode !== 'race' && this.state === 'riding' && this.sim.canTurnAround();
  }

  /** Turn across the road and ride back the other way. */
  turnAround(): boolean {
    return this.canTurnAround() && this.sim.turnAround();
  }

  get lap(): number {
    return Math.floor(Math.max(0, this.sim.player.s) / this.route.length) + 1;
  }

  get power3s(): number {
    return this.powerWindow.mean;
  }

  get avgPower(): number {
    return this.rideTime > 0 ? this.energyJ / this.rideTime : 0;
  }

  /** Average speed from the distance ridden and the time spent riding. */
  get avgSpeedKmh(): number {
    const trial = this.config.career?.road.timeTrial === true;
    const t = trial ? this.sim.ownClock(this.sim.player) : this.config.mode === 'race' ? this.sim.time : this.rideTime;
    return t > 1 ? (this.distance / t) * 3.6 : 0;
  }

  pause(): void {
    if (this.state === 'riding' || this.state === 'countdown') this.state = 'paused';
  }

  resume(): void {
    if (this.state === 'paused') this.state = this.sim.started ? 'riding' : 'countdown';
  }

  update(dt: number, devices: DeviceManager, braking = false): void {
    const now = performance.now();
    const power = devices.currentPower(now);
    const cadence = devices.currentCadence(now);
    const hr = devices.currentHeartRate(now);
    const p = this.sim.player;
    const difficulty = this.config.profile.difficulty / 100;
    this.braking = braking && this.state === 'riding';

    if (this.state === 'countdown') {
      this.countdown -= dt;
      devices.updateGrade(this.feltGrade(0) * 100 * difficulty, now);
      if (this.countdown <= 0) {
        this.state = 'riding';
        this.sim.started = true;
      }
      return;
    }
    // The result is already recorded. Keep rolling so the rider passes the banner.
    if (this.state === 'finished') {
      if (this.coasting) this.rollOn(dt, power, cadence, devices, now, difficulty);
      return;
    }
    if (this.state !== 'riding') return;

    const steps = Math.max(1, Math.ceil(dt / 0.05));
    const h = dt / steps;
    const prevS = p.s;
    const trial = this.config.career?.road.timeTrial === true;
    for (let i = 0; i < steps; i++) {
      this.sim.step(h, power, cadence, this.braking);
      this.readMeter(h);
    }
    const recording = (!trial || this.sim.time >= p.ttStart) && p.finishTime === null;
    if (recording) {
      this.distance += Math.abs(p.s - prevS);
      this.rideTime += dt;
      this.energyJ += power * dt;
      this.climbedM += Math.max(0, this.route.elevationAt(p.s) - this.route.elevationAt(prevS));
    }

    this.powerWindow.push(power, Math.max(1, Math.round(3 / Math.max(dt, 1 / 120))));

    if (this.config.mode === 'train' && this.config.workout) this.followWorkout(dt, power, devices, now);
    else {
      devices.setErgWatts(null);
      devices.updateGrade(this.feltGrade(3) * 100 * difficulty, now);
    }

    const moving = p.v > 0.3 || power > 0;
    if (recording && (this.config.mode === 'race' || moving)) {
      this.recorder.add(dt, {
        power,
        cadence,
        heartRate: hr,
        speed: p.v,
        distance: this.distance,
        altitude: this.route.elevationAt(p.s),
        grade: this.feltGrade(0),
      });
    }

    if (this.config.career && p.direction < 0) this.trackClimbsBackward(prevS, p.s);
    else if (p.direction < 0) {
      for (const t of this.climbTrackers) t.startTime = null;
    } else this.trackClimbs(prevS, p.s);

    if (this.config.mode === 'race' && this.state === 'riding') {
      if (trial) this.noteTimeTrial(p);
      else if (p.finishTime !== null) {
        this.state = 'finished';
        this.coasting = true;
        this.onFinish?.();
      }
    }
  }

  /** Start watching the line. Called after the place and time have been on screen. */
  beginFinishWatch(): void {
    if (this.lineWatchIds.length) this.watchingFinish = true;
  }

  private noteTimeTrial(p: { id: number; s: number; finishTime: number | null }): void {
    if (this.watchingFinish) {
      const pending = this.lineWatchIds.some((id) => this.sim.racers.find((r) => r.id === id)?.finishTime == null);
      if (!pending) {
        this.watchingFinish = false;
        this.state = 'finished';
        this.onWatched?.();
      }
      return;
    }
    if (p.finishTime == null || this.ttLine) return;
    this.ttLine = true;
    const dir = this.sim.raceDir();
    this.lineWatchIds = this.sim.racers
      .filter((r) => r.id !== p.id && r.finishTime == null && (r.s - p.s) * dir < -3)
      .map((r) => r.id);
    if (!this.lineWatchIds.length) {
      this.state = 'finished';
      this.coasting = true;
      this.onFinish?.();
      return;
    }
    this.onLine?.();
  }

  /** Physics only: the rider keeps pedalling past the line, but the ride file stays at the finish. */
  private rollOn(dt: number, power: number, cadence: number, devices: DeviceManager, now: number, difficulty: number): void {
    const steps = Math.max(1, Math.ceil(dt / 0.05));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      this.sim.step(h, power, cadence);
      this.readMeter(h);
    }
    devices.updateGrade(this.feltGrade(3) * 100 * difficulty, now);
  }

  // Perf: a physics substep only notes its time; the meter reads the riders once per drawn frame
  // (settleMeter), never per substep or during a hidden tab's catch-up. Its only reader is the hover tag.
  private readMeter(dt: number): void {
    this.meter.defer(dt);
  }

  private readonly meterGrade = (s: number) => this.route.gradeAt(s);
  private readonly meterElevation = (s: number) => this.route.elevationAt(s);

  /** Brings the power meter up to the current physics step. Called once per drawn frame, and before a read. */
  settleMeter(): void {
    this.meter.settle(this.sim.racers, this.meterGrade, this.meterElevation, this.config.career != null);
  }

  /** Current W/kg of a rider, from the power meter. */
  wkgOf(index: number): number {
    this.settleMeter();
    const r = this.sim.racers[index];
    return r ? this.meter.wkgOf(index, r.mass) : 0;
  }

  /** Hill climbs stay one race segment. Career stages record each named climb on the road. */
  private trackersForRoute(): ClimbTracker[] {
    const { mode, route, career } = this.config;
    const climbs = mode === 'race' ? (career ? climbsInside(route.climbs, career.road.startS, career.road.finishS) : []) : route.climbs;
    return climbs.map((climb) => ({ climb, startTime: null, startEnergy: 0 }));
  }

  private trackClimbs(prevS: number, s: number) {
    const L = this.route.length;
    const crossed = (mark: number) => {
      const a = prevS - mark;
      const b = s - mark;
      return Math.floor(a / L) !== Math.floor(b / L);
    };
    for (const t of this.climbTrackers) {
      if (crossed(t.climb.start)) {
        t.startTime = this.rideTime;
        t.startEnergy = this.energyJ;
      }
      if (crossed(t.climb.end)) this.recordClimb(t);
    }
  }

  /** A reversed career stage enters a climb at the summit and leaves it at the bottom. */
  private trackClimbsBackward(prevS: number, s: number) {
    const length = this.route.length;
    for (const t of this.climbTrackers) {
      if (passedMarkBackward(prevS, s, t.climb.end, length)) {
        t.startTime = this.rideTime;
        t.startEnergy = this.energyJ;
      }
      if (passedMarkBackward(prevS, s, t.climb.start, length)) this.recordClimb(t);
    }
  }

  private recordClimb(t: ClimbTracker): void {
    if (t.startTime === null) return;
    const time = this.rideTime - t.startTime;
    const avgPower = (this.energyJ - t.startEnergy) / Math.max(1, time);
    t.startTime = null;
    if (!(time > 0)) return;
    this.newEfforts.push({
      id: uuid(),
      climbId: t.climb.id,
      climbName: t.climb.name,
      routeId: this.route.def.id,
      routeName: this.route.def.name,
      lengthM: t.climb.length,
      rideId: this.recorder.id,
      createdAt: new Date().toISOString(),
      timeSec: time,
      avgPower,
      wkg: avgPower / this.config.profile.weightKg,
    });
  }

  private loopGap(a: number, b: number): number {
    const len = this.route.length;
    const d = Math.abs(this.route.wrap(a) - this.route.wrap(b));
    return Math.min(d, len - d);
  }

  /** Turn the bike in the road plane. A negative angle swings the nose to the left. */
  private spinPose(pose: RiderPose, angle: number): void {
    if (Math.abs(angle) < 1e-4) return;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const tx = pose.tx * c - pose.tz * s;
    const tz = pose.tx * s + pose.tz * c;
    pose.tx = tx;
    pose.tz = tz;
    pose.grade *= c;
  }

  /** Poses for every rider, hiding those far from the player. */
  riderPoses(world: { poseAt(s: number, lat: number, out: RiderPose): RiderPose }): RiderPose[] {
    const ps = this.watchingFinish ? this.sim.finishLine : this.sim.player.s;
    const finish = this.sim.finishLine;
    this.sim.racers.forEach((r, i) => {
      const pose = this.poses[i];
      const gap = this.config.mode === 'race' ? Math.abs(r.s - ps) : this.loopGap(r.s, ps);
      const far = gap > VISIBLE_RANGE;
      const rideDir: 1 | -1 = this.player.direction < 0 ? -1 : 1;
      const gone = isFinite(finish) && (r.s - finish) * rideDir > 120 && !r.isPlayer;
      const waiting = this.config.career?.road.timeTrial === true && this.sim.time < r.ttStart;
      pose.visible = !far && !gone && !waiting;
      const badge = r.road?.badge;
      const jersey = badge === 'Y' ? 'yellow' : badge === 'P' ? 'pink' : badge === 'R' ? 'red' : badge === 'S' ? 'green' : badge === 'M' ? 'polka' : undefined;
      pose.ring = pose.visible ? jersey ?? (this.config.career && r.road?.teammate ? 'team' : undefined) : undefined;
      pose.mark = this.config.mode === 'race' && r.isPlayer && pose.visible && !jersey;
      if (!pose.visible) return;
      world.poseAt(r.s, r.lat, pose);
      if (r.isPlayer || r.buddy) this.spinPose(pose, this.sim.facingAngle());
      else if (r.direction < 0) {
        pose.tx = -pose.tx;
        pose.tz = -pose.tz;
        pose.grade = -pose.grade;
      }
      pose.crank = r.crank;
      pose.wheel = ((r.direction < 0 ? -r.s : r.s) / WHEEL_R) % (Math.PI * 2);
      pose.effort = r.mode === 'attack' || r.mode === 'sprint' ? 1 : Math.min(1, Math.max(0, (r.power / r.cp - 1) * 3));
    });
    return this.poses;
  }

  /** Snapshot for crash recovery. */
  snapshot(): { summary: RideSummary; samples: RideSample[] } {
    return { summary: this.summary(), samples: this.recorder.samples };
  }

  summary(): RideSummary {
    const { mode, route, climb } = this.config;
    let race: RideSummary['race'];
    if (mode === 'race') {
      const st = this.sim.standings();
      const winner = st[0];
      race = {
        position: st.indexOf(this.sim.player) + 1,
        field: st.length,
        finishTimeSec: this.sim.player.officialTime ?? this.sim.player.finishTime,
        winnerTimeSec: winner.officialTime ?? winner.finishTime,
      };
    }
    const workoutPlan = this.config.workout;
    const title = this.config.career
      ? this.config.career.title
      : mode === 'race' && climb
      ? `Hill-climb race: ${climb.name}`
      : mode === 'train' && workoutPlan
        ? `Training · ${workoutPlan.planName} · ${workoutPlan.workoutName}`
        : `Free ride: ${route.def.name}`;
    const compliance = this.compliance;
    const workout: WorkoutResult | undefined = mode === 'train' && workoutPlan
      ? {
          planId: workoutPlan.planId,
          workoutId: workoutPlan.workoutId,
          name: workoutPlan.workoutName,
          compliance: compliance == null ? null : Math.round(compliance * 100),
          ftpEstimate: this.ftpEstimate,
          ftpKind: workoutPlan.ftpProtocol,
          ftpAverage: this.ftpAverage,
          previousFtp: this.ftpEstimate != null ? this.config.profile.ftp : null,
          weightKg: this.ftpEstimate != null ? this.config.profile.weightKg : null,
          completed: this.workoutCompleted,
        }
      : undefined;
    return this.recorder.summarize({
      mode,
      routeId: route.def.id,
      routeName: route.def.name,
      climbId: climb?.id,
      title,
      laps: mode === 'free' ? Math.max(0, this.distance / route.length) : undefined,
      race,
      workout,
    });
  }

  nudgeErg(delta: number): void {
    this.ergBias = Math.min(1.15, Math.max(0.85, Math.round((this.ergBias + delta) * 100) / 100));
  }

  /** Share of the steady efforts spent within range of the target, or null when scoring has not started. */
  get compliance(): number | null {
    const total = this.hit + this.miss;
    return total < 20 ? null : this.hit / total;
  }

  get workoutCompleted(): boolean {
    const workout = this.config.workout;
    if (this.config.mode !== 'train' || !workout) return false;
    if (workout.ftpProtocol === 'twenty') return this.ftpEstimate != null;
    if (this.ftpEstimate != null) return true;
    return this.rideTime >= workout.durationSec * 0.8;
  }

  /** Running average of the 20-minute effort, or the finished average once it is scored. */
  get twentyAverage(): number | null {
    if (this.ftpAverage != null) return this.ftpAverage;
    if (this.twenty.sec < 1) return null;
    return this.twenty.joules / this.twenty.sec;
  }

  /** The self-paced part of the 20-minute test, before it has been scored. */
  get inOpenEffort(): boolean {
    const workout = this.config.workout;
    if (workout?.ftpProtocol !== 'twenty' || this.ftpEstimate != null) return false;
    return Boolean(stepAt(workout.steps, this.rideTime)?.open);
  }

  workoutCue(ftp: number): WorkoutCue | null {
    const workout = this.config.workout;
    if (!workout) return null;
    const cue = cueAt(workout.steps, Math.min(this.rideTime, Math.max(0, workout.durationSec - 0.001)), ftp, this.ergBias);
    if (this.ftpFailedAt == null) return cue;
    const pct = 0.48;
    return {
      ...cue,
      pct,
      watts: Math.max(0, Math.round(pct * ftp * this.ergBias)),
      zone: zoneName(pct),
      text: 'Test over. Spin easy. The FTP estimate is on the results screen.',
      cadence: '85–95 rpm',
      next: 'Save the ride when you are ready.',
    };
  }

  private followWorkout(dt: number, power: number, devices: DeviceManager, now: number): void {
    const workout = this.config.workout;
    if (!workout) return;
    const ftp = this.config.profile.ftp;
    this.watchFtpTest(dt, power, ftp);
    this.watchTwenty(dt, power);
    const cue = this.workoutCue(ftp);
    const open = this.inOpenEffort;
    if (open || !this.erg || !cue) {
      devices.setErgWatts(null);
      const difficulty = this.config.profile.difficulty / 100;
      devices.updateGrade(this.feltGrade(3) * 100 * difficulty, now);
    } else devices.setErgWatts(cue.watts, now);
    if (cue && !open && this.ftpFailedAt == null) this.scoreEffort(dt, power, cue);
    this.maybeFinishWorkout();
  }

  private watchTwenty(dt: number, power: number): void {
    const workout = this.config.workout;
    if (workout?.ftpProtocol !== 'twenty' || this.ftpEstimate != null) return;
    const step = workout.steps.find((item) => item.open);
    if (!step) return;
    const sample = sampleTwentyMinute(this.twenty, step, this.rideTime, dt, power);
    this.twenty = sample.window;
    if (sample.ftp == null || sample.average == null) return;
    this.ftpAverage = sample.average;
    this.ftpEstimate = sample.ftp;
  }

  private watchFtpTest(dt: number, power: number, ftp: number): void {
    const workout = this.config.workout;
    if (workout?.ftpProtocol !== 'ramp' || this.ftpEstimate != null || this.ftpFailedAt != null) return;
    const cue = cueAt(workout.steps, this.rideTime, ftp, 1);
    // The target the trainer was actually asked to hold, arrow-key bias included.
    const asked = cue.step.fromPct * ftp * this.ergBias;
    if (isRampTestStep(cue.step)) this.ramp.sample(cue.index, cue.step, dt, power, asked);
    if (asked >= ftp * 0.95 && power < asked * 0.7) {
      this.failArm += dt;
      const estimate = this.failArm >= 8 ? this.ramp.estimate() : null;
      if (estimate != null) {
        this.ftpEstimate = estimate;
        this.ftpFromStop = true;
        this.ftpFailedAt = this.rideTime;
      }
    } else this.failArm = 0;
  }

  private scoreEffort(dt: number, power: number, cue: WorkoutCue): void {
    const step = cue.step;
    if (step.open) return;
    if (step.end - step.start < 30) return;
    if (Math.abs(step.fromPct - step.toPct) > 0.02) return;
    if (this.rideTime - step.start < 8) return;
    if (step.fromPct < 0.6) return;
    const target = cue.watts;
    const tol = Math.max(15, target * 0.08);
    if (Math.abs(power - target) <= tol) this.hit += dt;
    else this.miss += dt;
  }

  private maybeFinishWorkout(): void {
    const workout = this.config.workout;
    if (!workout || this.workoutClosed || this.state !== 'riding') return;
    const endAt = this.ftpFailedAt != null ? Math.min(workout.durationSec, this.ftpFailedAt + 300) : workout.durationSec;
    if (this.rideTime + 0.001 < endAt) return;
    if (workout.ftpProtocol === 'ramp' && this.ftpEstimate == null) {
      this.ftpEstimate = this.ramp.estimate();
      this.ftpFromStop = false;
    }
    this.workoutClosed = true;
    this.state = 'finished';
    this.onFinish?.();
  }

  get stoppedTheRamp(): boolean {
    return this.ftpFromStop;
  }

  get startDistance(): number {
    return this.startS;
  }
}
