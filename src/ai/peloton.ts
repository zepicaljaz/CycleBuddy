import { BRAKE_DECEL, draftFromGap, makeBikeParams, steadySpeed, stepSpeed, type BikeParams } from '../physics/cycling';
import type { Route } from '../routes/route';
import { clamp, mulberry32, randRange, smoothstep } from '../util/math';
import type { RiderColors } from '../world/riders';
import { assignWindSlots, awardRoadFeatures, climbDrain, climbPeers, climbRating, decideRoad, FILE_SPACING, FILE_WIDTH, isProtectedRider, ROAD_GROUP_M, sealGroupTimes, shapeRoad, stageStrength, staminaPlace, teamTempoRank, terrainWkg, tickEnergy, tickRoadReserve, trialFactor, TT_GAP, ttStartOrder, type EnergyPlace, type RoadBody, type RoadOrders, type RoadPlan, type RoadStarter, type WindSlot } from './road';
import { climbEffortWatts, hillClimbWattsPerKilo } from './climbers';
import { NATIONS, TEAMS, teamColors } from './names';
import { bestClimbers, riderName } from '../career/roster';
import { teamById, teamKit } from '../career/teams';

export type RacerMode = 'steady' | 'follow' | 'attack' | 'cracked' | 'sprint' | 'finished' | 'pace';

export interface Racer {
  id: number;
  name: string;
  country: string;
  team: string;
  isPlayer: boolean;
  wkg: number;
  mass: number;
  ftp: number;
  /** Critical power and anaerobic reserve (W' in joules). */
  cp: number;
  wPrime: number;
  wBal: number;
  bike: BikeParams;
  s: number;
  lat: number;
  latTarget: number;
  v: number;
  power: number;
  targetPower: number;
  cadence: number;
  crank: number;
  draft: number;
  mode: RacerMode;
  modeTimer: number;
  aggression: number;
  pace: number;
  phase: number;
  decisionTimer: number;
  finishTime: number | null;
  /**
   * Clock time when this rider crossed the start line (opts.startS), interpolated like the finish.
   * Time trials and hill-climbs are timed from here, so a rider gridded further back does not ride extra.
   */
  startTime: number | null;
  colors: RiderColors;
  /** +1 rides the loop with you. -1 is coming the other way. */
  direction: 1 | -1;
  /** Riders in the same group hold the same power and start together. 0 rides alone. */
  group: number;
  /** Lane this rider returns to when they are not passing. */
  homeLat: number;
  /** Speed this rider's power would hold here, even while a wheel ahead is holding them back. */
  urge: number;
  /**
   * On a descent: the speed this rider's own power, draft and the slope would have given them since the
   * road tipped down. A pace-locked rider stays within DESCENT_SLACK of it. Undefined off a descent.
   */
  free?: number;
  /** Same speed with no draft, so a teammate sitting in the wheels is not treated as faster. */
  open: number;
  /** Free-ride pacer who stays just ahead of the player. */
  buddy: boolean;
  /** Road-race ratings. Null on a hill-climb or a free ride. */
  road: RoadBody | null;
  /** Bunch time. Riders in the same group share this. */
  officialTime: number | null;
  sprintPts: number;
  komPts: number;
  /** An attack by this rider has already been announced. */
  told: boolean;
  /** Fraction of the stamina bar still left. 1 is full. Road races only. */
  energy: number;
  /** Surge reserve, 0 to 1: what is left for attacks and for following them. Road races only. */
  reserve: number;
  /** W/kg it costs to hold the group this step. Set by the road shaping; undefined out of a group. */
  effort?: number;
  /** Race-clock second this rider is allowed to leave the line. 0 in a road race. */
  ttStart: number;
}

export interface RaceOptions {
  startS: number;
  /** Absolute route distance of the finish line, or Infinity for free rides. */
  finishS: number;
  aiCount: number;
  seed: number;
  /** Free-ride partners hold a fixed power and are spread around the loop. */
  freeRide?: boolean;
  /** Pacer who stays one wheel ahead. Efforts are W/kg on the flat, on 2–5% hills, and above 5%. */
  buddy?: { flat: number; hill: number; mountain: number };
  /** Free ride only. -1 starts the rider going backwards around the loop. */
  startDirection?: 1 | -1;
  /** Strongest and slowest AI efforts on a hill-climb, in W/kg. */
  topWkg?: number;
  bottomWkg?: number;
  /** Career road stage. Hill-climbs leave this unset. */
  road?: RoadPlan;
  roadField?: RoadStarter[];
  playerRoad?: RoadBody;
  player: { name: string; massKg: number; ftp: number; colors: RiderColors };
}

const LANE_LIMIT = 3.0;
/** Right-hand file, just inside the white line. */
const RIGHT_FILE = 2.3;
/** A pair rides this far apart, left file then right file. */
const FILE_GAP = 0.9;
/** Rows sit far enough apart that the bikes do not overlap. */
const ROW_GAP = 2.7;
/** An overtake passes this far to the left of the other rider. */
const PASS_GAP = 1.05;
/** Leftmost a normal pass reaches. The next lane is only for a faster rider. */
const PASS_LIMIT = -0.55;
/** Across the centre line, left of someone who is already passing. */
const FAST_LIMIT = -1.45;
const ONCOMING_RIGHT = -2.45;
/** A stopped bike. Slow enough that the speed readout is 0.0 km/h. */
const STILL = 0.014;
/** How long the bike takes to swing around and cross the road. */
const TURN_SEC = 1.7;

/** Free-ride neighbour lookups scan this far either way along the loop. Every rule reaches less than 30 m. */
const NEAR_M = 30;

/** Riders going one way round the loop, sorted by wrapped position. Rebuilt once a step. */
interface Lane {
  riders: Racer[];
  pos: number[];
  /** Index of each rider in `racers`, so ties resolve the way a scan of `racers` does. */
  idx: number[];
}

/** First index in an ascending list where `past` turns true. `past` must be false, then true. */
function firstWhere(list: number[], past: (value: number) => boolean): number {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (past(list[mid])) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

function fileFor(dir: 1 | -1): number {
  return dir > 0 ? RIGHT_FILE : ONCOMING_RIGHT;
}
/** How far ahead of the player the buddy sits, close enough to give a draft. */
const BUDDY_GAP = 2.3;
/** Seconds from the start before the buddy is holding the power you set. */
const BUDDY_WARMUP = 16;

/** m/s² a pace-locked rider may slow beyond what rolling resistance and the slope already do. */
const EXTRA_BRAKE = 0.6;
/** The same on a climb. Gravity already slows a rider hard there, and more would throw away the speed carried into the wall. */
const CLIMB_BRAKE = 0.2;
/**
 * m/s² a pace-locked rider may speed up beyond what their own power, draft and the slope give, on the
 * flat and on climbs. Lets the field roll out from the start and riders close up to a wheel.
 */
const EXTRA_ACCEL = 0.55;
/**
 * On a descent a pace-locked rider rides at most this much (m/s) faster than their own physics would have
 * taken them since the top (Racer.free), however long the descent. Riders behind close up through the
 * draft, as the player does. With a flat 1.8 m/s² extra here the bunch sped up nearly four times as fast
 * as physics over the top of a climb, overshot the speed the slope holds, and rode away from a player
 * holding the same power.
 */
const DESCENT_SLACK = 0.5;
/** A descent for that rule: steeper than this. Flat roads with a tenth of a percent down are not. */
const DESCENT_FROM = -0.01;

/** Simulates all riders (player included) with the same physics. */
export class RideSim {
  readonly racers: Racer[] = [];
  readonly player: Racer;
  readonly buddy: Racer | null = null;
  time = 0;
  started = false;
  private order: Racer[] = [];
  private rng: () => number;
  private aheadOf = new Map<Racer, { r: Racer; gap: number } | null>();
  private turn: { from: 1 | -1; to: 1 | -1; fromLat: number; toLat: number; elapsed: number; buddyFrom: number | null } | null = null;
  /** Lateral shift, shared by a group, for this frame. */
  private packShift = new Map<string, number>();
  /** Speeds before the road shaping, kept between substeps to avoid an allocation each time. */
  private rolledScratch: number[] = [];
  /** Per-step lookups. Positions, lanes and directions hold still from the top of a step until riders move. */
  private lanes = new Map<1 | -1, Lane>();
  private packs = new Map<string, Racer[]>();
  /** Who is in the wind this step. Road races only. */
  private windSlot = new Map<Racer, WindSlot>();
  private sheltered = new Set<number>();
  private peerAt: ((grade: number) => number) | null = null;
  paceOn = false;
  paceWkg = 3.5;
  waitOn = false;
  /** The pre-stage plan runs until you press a team button. */
  manual = false;
  /** True inside simulateToEnd. Teammates stop waiting for the player. */
  private fastForward = false;
  readonly events: string[] = [];

  constructor(private route: Route, readonly opts: RaceOptions) {
    this.rng = mulberry32(opts.seed);
    const p = opts.player;
    this.player = this.makeRacer(0, p.name, 'YOU', 'Independent', p.ftp / p.massKg, p.massKg, p.ftp, 20000, p.colors, true);
    if (opts.playerRoad) this.player.road = opts.playerRoad;
    this.racers.push(this.player);
    if (opts.freeRide && opts.buddy) {
      this.buddy = this.makeBuddy();
      this.racers.push(this.buddy);
    }
    if (opts.freeRide) {
      this.createFreeField(opts.aiCount);
      this.placeOnLoop();
    } else if (opts.roadField) {
      this.createRoadField(opts.roadField);
      this.placeRoadGrid();
    } else {
      this.createField(opts.aiCount);
      this.placeOnGrid();
    }
    this.order = [...this.racers];
    if (isFinite(opts.finishS)) {
      for (const r of this.racers) if (r.s >= opts.startS) r.startTime = 0;
    }
  }

  private makeRacer(
    id: number, name: string, country: string, team: string, wkg: number, mass: number, ftp: number, wPrime: number,
    colors: RiderColors, isPlayer: boolean,
  ): Racer {
    return {
      id, name, country, team, isPlayer, wkg, mass, ftp,
      cp: ftp * 1.04,
      wPrime,
      wBal: wPrime,
      bike: makeBikeParams(mass),
      s: 0, lat: 0, latTarget: 0, v: 0, power: 0, targetPower: 0, cadence: 0,
      crank: this.rng() * Math.PI * 2,
      draft: 0,
      mode: 'steady',
      modeTimer: 0,
      aggression: this.rng(),
      pace: 1,
      phase: this.rng() * 100,
      decisionTimer: this.rng(),
      finishTime: null,
      startTime: null,
      colors,
      direction: 1,
      group: 0,
      homeLat: RIGHT_FILE,
      urge: 0,
      open: 0,
      buddy: false,
      road: null,
      officialTime: null,
      sprintPts: 0,
      komPts: 0,
      told: false,
      energy: 1,
      reserve: 1,
      ttStart: 0,
    };
  }

  roadOrders(): RoadOrders {
    return { paceOn: this.paceOn, paceWkg: this.paceWkg, waitOn: this.waitOn, manual: this.manual, released: this.fastForward };
  }

  drainEvents(): string[] {
    return this.events.splice(0, this.events.length);
  }

  private createRoadField(list: RoadStarter[]) {
    list.forEach((rider, i) => {
      const trial = this.opts.road?.timeTrial;
      const pace = trial ? (this.opts.road?.ttWkg ?? this.opts.road?.flatWkg ?? 4) : (this.opts.road?.flatWkg ?? 4);
      const wkg = trial
        ? pace * trialFactor(rider.body.attrs, this.opts.road?.finishKind ?? 'sprint')
        : Math.max(rider.body.attrs.flat, rider.body.attrs.hills, rider.body.attrs.mountain) / 78 * pace;
      const ftp = Math.max(80, Math.round(wkg * rider.mass));
      const racer = this.makeRacer(i + 1, rider.name, rider.country, rider.team, wkg, rider.mass, ftp, 18000, rider.colors, false);
      racer.road = rider.body;
      racer.decisionTimer = 0;
      this.racers.push(racer);
    });
  }

  private createField(n: number) {
    const rng = this.rng;
    const hi = Math.max(this.opts.topWkg ?? 4.5, this.opts.bottomWkg ?? 3);
    const lo = Math.min(this.opts.topWkg ?? 4.5, this.opts.bottomWkg ?? 3);
    // Career climbers, strongest mountain rating first. A shorter start list leaves out the weaker ones.
    const field = bestClimbers(n);
    if (!field.length) return;
    // Mountain rating times 20, so 2 rating points match the 40-point form swing.
    const score = (rider: (typeof field)[number]) => rider.attrs.mountain * 20;
    const efforts = hillClimbWattsPerKilo(field.map(score), lo, hi, rng);
    const leaderFtp = climbEffortWatts(efforts[0], field[0].mass, lo, efforts[0], true);
    const leaderWkg = leaderFtp / field[0].mass;
    field.forEach((rider, i) => {
      const mass = rider.mass;
      const ftp = i === 0 ? leaderFtp : climbEffortWatts(efforts[i], mass, lo, leaderWkg, false);
      const team = teamById(rider.teamId);
      const colors = team ? teamKit(team) : this.player.colors;
      const racer = this.makeRacer(i + 1, riderName(rider), rider.country, team?.name ?? 'Independent', ftp / mass, mass, ftp, randRange(rng, 14000, 24000), colors, false);
      racer.pace = 1;
      this.racers.push(racer);
    });
  }

  /**
   * Body weight for an effort. A harder rider is usually lighter, and the
   * weight always stays in a normal adult range, so watts and W/kg describe
   * the same person.
   */
  private bodyMass(wkg: number, rng: () => number): number {
    const typical = 80 - (wkg - 2) * 4.5;
    return Math.round(clamp(typical + randRange(rng, -4, 4), 56, 85));
  }

  /** Easy spins, steady rides and harder efforts. Some of these are as light as 1 W/kg. */
  private freeEffort(rng: () => number): number {
    const roll = rng();
    if (roll < 0.3) return 1 + rng() * 0.7;
    if (roll < 0.75) return 1.7 + rng() * 1.7;
    return 3.4 + rng() * 1.6;
  }

  /**
   * Other people out training. Some ride alone, some share one power in a group,
   * and some come the other way on the left side of the road.
   */
  private createFreeField(n: number) {
    const rng = this.rng;
    const used = new Set<string>();
    let made = 0;
    let nextGroup = 1;
    while (made < n) {
      const room = n - made;
      const grouped = room >= 2 && rng() < 0.46;
      const size = grouped ? Math.min(room, 2 + Math.floor(rng() * 4)) : 1;
      const oncoming = rng() < 0.24;
      const wkg = this.freeEffort(rng);
      const mass = this.bodyMass(wkg, rng);
      const ftp = Math.max(50, Math.round(wkg * mass));
      const group = size > 1 ? nextGroup++ : 0;
      for (let g = 0; g < size; g++) {
        const { name, nation } = this.pickRider(rng, used);
        const team = TEAMS[Math.floor(rng() * TEAMS.length)];
        const racer = this.makeRacer(made + 1, name, nation.code, team.name, ftp / mass, mass, ftp, 20000, teamColors(team, rng), false);
        racer.pace = 1;
        racer.power = ftp;
        racer.targetPower = ftp;
        racer.direction = oncoming ? -1 : 1;
        racer.group = group;
        this.racers.push(racer);
        made++;
      }
    }
  }

  private pickRider(rng: () => number, used: Set<string>): { name: string; nation: (typeof NATIONS)[number] } {
    const nation = NATIONS[Math.floor(rng() * NATIONS.length)];
    let name = '';
    for (let k = 0; k < 10; k++) {
      name = `${nation.first[Math.floor(rng() * nation.first.length)][0]}. ${nation.last[Math.floor(rng() * nation.last.length)]}`;
      if (!used.has(name)) break;
    }
    used.add(name);
    return { name, nation };
  }

  private placeRoadGrid() {
    const trial = this.opts.road?.timeTrial;
    const dir = this.raceDir();
    if (trial) {
      const ordered = ttStartOrder(this.racers.map((racer) => ({ racer, name: racer.name, gcRank: racer.road?.gcRank }))).map((row) => row.racer);
      const line = fileFor(dir);
      ordered.forEach((r, i) => {
        r.ttStart = i * TT_GAP;
        r.direction = dir;
        r.s = this.opts.startS;
        r.lat = line;
        r.latTarget = line;
        r.homeLat = line;
        r.v = 0;
      });
      return;
    }
    const finish = this.opts.road?.finishKind ?? 'sprint';
    const punchy = this.opts.road?.punchy ?? false;
    const rank = teamTempoRank(this.racers, finish, punchy);
    const strength = (r: Racer) => (r.road ? stageStrength(r.road.attrs, finish, punchy) : 0);
    const groups: Racer[][] = [];
    const byTeam = new Map<string, Racer[]>();
    for (const r of this.racers) {
      const key = r.road?.teamId || r.team;
      let list = byTeam.get(key);
      if (!list) {
        list = [];
        byTeam.set(key, list);
        groups.push(list);
      }
      list.push(r);
    }
    for (const group of groups) {
      const peak = rank.get(group[0]?.road?.teamId || group[0]?.team || '') ?? 0;
      const mates = group.filter((r) => !r.isPlayer);
      const engine = mates.filter((r) => strength(r) >= peak - 14 && strength(r) >= 54).sort((a, b) => strength(a) - strength(b));
      const others = mates.filter((r) => !engine.includes(r)).sort((a, b) => strength(b) - strength(a));
      const player = group.find((r) => r.isPlayer);
      group.length = 0;
      group.push(...engine);
      if (player) group.push(player);
      group.push(...others);
    }
    groups.sort((a, b) => (rank.get(b[0]?.road?.teamId || b[0]?.team || '') ?? 0) - (rank.get(a[0]?.road?.teamId || a[0]?.team || '') ?? 0));
    const grid = groups.flat();
    const files = [-2.05, -1.2, -0.35, 0.5, 1.35, 2.15];
    grid.forEach((r, i) => {
      const row = Math.floor(i / files.length);
      const col = i % files.length;
      const back = 0.6 + row * FILE_SPACING;
      r.direction = dir;
      r.s = this.opts.startS - dir * back;
      r.lat = files[col] * dir;
      r.latTarget = r.lat;
      r.homeLat = r.lat;
    });
  }

  /** Still on the ramp. The bike stays on the line until this rider's start. */
  private holdingStart(r: Racer): boolean {
    return !!this.opts.road?.timeTrial && this.time < r.ttStart;
  }

  /** Elapsed riding time. A time trial starts when that rider leaves, not when the ramp opens. */
  ownClock(r: Racer): number {
    if (r.finishTime != null) return r.finishTime;
    if (!this.opts.road?.timeTrial) return this.time;
    return Math.max(0, this.time - r.ttStart);
  }

  /** A stable lane. The first five share one file. Everyone else is scattered, not in repeating columns. */
  private packLat(id: number, index: number): number {
    if (index < 5) {
      const jitter = ((id * 17) % 9 - 4) * 0.045;
      return 1.35 + jitter;
    }
    const n = Math.abs(Math.sin(id * 12.9898) * 43758.5453);
    const frac = n - Math.floor(n);
    return -2.05 + frac * 4.15;
  }

  /**
   * The first five in a group ride in one line, so each takes the wheel ahead.
   * Everyone after that spreads across the road.
   */
  private formRoadPack() {
    const dir = this.raceDir();
    const along = (s: number) => (s - this.opts.startS) * dir;
    const active = this.racers.filter((r) => r.finishTime == null);
    active.sort((a, b) => along(b.s) - along(a.s));
    const groups: Racer[][] = [];
    for (const r of active) {
      const group = groups[groups.length - 1];
      if (!group || along(group[group.length - 1].s) - along(r.s) > ROAD_GROUP_M) groups.push([r]);
      else group.push(r);
    }
    for (const group of groups) {
      group.forEach((r, index) => {
        const want = this.packLat(r.id, index) * dir;
        // Lanes are sticky: move across only when nobody is alongside on the way over.
        if (Math.abs(want - r.homeLat) > 0.05 && this.laneClear(r, want, active)) r.homeLat = want;
        r.latTarget = r.homeLat;
      });
    }
  }

  /** No rider within FILE_SPACING along the road sits between `r` and the lane at `lat`, or in that lane. */
  private laneClear(r: Racer, lat: number, bySDesc: Racer[]): boolean {
    const lo = lat > r.lat ? r.lat + FILE_WIDTH / 2 : lat - FILE_WIDTH;
    const hi = lat > r.lat ? lat + FILE_WIDTH : r.lat - FILE_WIDTH / 2;
    const i = bySDesc.indexOf(r);
    for (const step of [-1, 1]) {
      for (let j = i + step; j >= 0 && j < bySDesc.length; j += step) {
        const o = bySDesc[j];
        if (Math.abs(o.s - r.s) >= FILE_SPACING) break;
        const at = [o.lat, o.latTarget];
        if (at.some((x) => x > lo && x < hi)) return false;
      }
    }
    return true;
  }

  private placeOnGrid() {
    const perRow = 4;
    const ai = this.racers.filter((r) => !r.isPlayer);
    // The bunch lines up on the right. The left lane stays free for oncoming cars.
    ai.sort((a, b) => b.wkg - a.wkg);
    const grid = [...ai.slice(0, perRow), this.player, ...ai.slice(perRow)];
    grid.forEach((r, i) => {
      const row = Math.floor(i / perRow);
      const col = i % perRow;
      r.s = this.opts.startS - 1 - row * 2.0;
      r.lat = 0.55 + col * 0.7;
      r.latTarget = r.lat;
      r.homeLat = r.lat;
    });
  }

  private makeBuddy(): Racer {
    const effort = this.opts.buddy!;
    const wkg = effort.flat;
    const mass = this.player.mass;
    const ftp = Math.round(wkg * mass);
    const buddy = this.makeRacer(
      10000, 'Buddy', '', 'Cycle Buddy', wkg, mass, ftp, 20000,
      { ...this.player.colors },
      false,
    );
    buddy.buddy = true;
    buddy.power = 0;
    buddy.targetPower = 0;
    return buddy;
  }

  /** 0 at the start, 1 once the opening spin-up is finished. */
  private buddyWarmup(): number {
    const t = clamp(this.time / BUDDY_WARMUP, 0, 1);
    return t * t * (3 - 2 * t);
  }

  /** W/kg the buddy holds on this slope. Descents use the flat effort. */
  private buddyWkg(grade: number): number {
    const pace = this.opts.buddy!;
    if (grade >= 0.05) return pace.mountain;
    if (grade >= 0.02) return pace.hill;
    return pace.flat;
  }

  /** Power from the slope. The buddy does not speed up or slow down to match the player. */
  private applyBuddyPower() {
    const b = this.buddy;
    if (!b) return;
    const grade = Math.max(0, this.route.gradeAt(b.s));
    const wkg = this.buddyWkg(grade);
    const power = wkg * b.mass * this.buddyWarmup();
    b.wkg = wkg;
    b.power = power;
    b.targetPower = power;
    b.ftp = power;
    b.cp = power;
    b.cadence = power < 20 ? 0 : clamp(90 - grade * 80, 70, 96);
    b.draft = 0;
  }

  /** The climb foot or summit the player is crossing, otherwise the next one ahead. */
  private nextGate(s: number, dir: 1 | -1): number | null {
    const climbs = this.route.climbs;
    if (!climbs.length) return null;
    let ahead = Infinity;
    let aheadAt: number | null = null;
    let behind = Infinity;
    let behindAt: number | null = null;
    for (const c of climbs) {
      for (const gate of [c.start, c.end]) {
        const d = this.along(s, gate, dir);
        if (d >= -1 && d < ahead) {
          ahead = d;
          aheadAt = gate;
        }
        if (d < -1 && -d < behind && -d < 30) {
          behind = -d;
          behindAt = gate;
        }
      }
    }
    if (aheadAt !== null && ahead < 40) return aheadAt;
    if (behindAt !== null) return behindAt;
    return aheadAt;
  }

  /**
   * Ride the chosen power between climbs. At the foot and the summit, wait if
   * ahead of the player, or ride up to them if behind, so you cross together.
   */
  private regroupBuddy(dt: number) {
    const b = this.buddy;
    if (!b || this.turn) return;
    const dir = this.player.direction;
    const file = fileFor(dir);
    b.lat = file;
    b.latTarget = file;
    b.homeLat = file;
    if (this.time < BUDDY_WARMUP) return;
    const gate = this.nextGate(this.player.s, dir);
    if (gate === null) return;
    const playerDist = this.along(this.player.s, gate, dir);
    const rel = this.along(this.player.s, b.s, dir);
    const buddyDist = playerDist - rel;
    const together = this.route.wrap(this.player.s + dir * BUDDY_GAP);

    if (Math.abs(playerDist) < 22) {
      const delta = this.along(b.s, together, dir);
      b.s = Math.abs(delta) < 40 ? together : this.route.wrap(b.s + dir * clamp(delta, -22 * dt, 22 * dt));
      b.v = this.player.v;
      return;
    }

    // Ahead of the player and already at the foot or the summit: wait there.
    if (rel > 18 && buddyDist < 35 && playerDist > 0) {
      b.s = this.route.wrap(gate - dir * 10);
      b.v = 0;
      return;
    }

    // Behind on the way in: close the gap in the time the player has left.
    if (rel < -15 && playerDist > 22 && playerDist < 1600) {
      const t = Math.max(5, playerDist / Math.max(this.player.v, 1.2));
      const close = Math.min(8, (-rel - BUDDY_GAP) / t);
      b.s = this.route.wrap(b.s + dir * close * dt);
      b.v = Math.max(b.v, this.player.v + close);
    }
  }

  /** Scatter free-ride partners around the loop, clear of the player's start. Groups stay together. */
  private placeOnLoop() {
    const len = this.route.length;
    const ai = this.racers.filter((r) => !r.isPlayer && !r.buddy);
    const dir: 1 | -1 = this.opts.startDirection === -1 ? -1 : 1;
    const file = fileFor(dir);
    this.player.s = this.opts.startS;
    this.player.direction = dir;
    this.player.lat = file;
    this.player.latTarget = file;
    this.player.homeLat = file;
    const packs: Racer[][] = [];
    const seen = new Set<number>();
    for (const r of ai) {
      if (r.group === 0) packs.push([r]);
      else if (!seen.has(r.group)) {
        seen.add(r.group);
        packs.push(ai.filter((o) => o.group === r.group));
      }
    }
    const nearStart = (p: number) => {
      const d = Math.min(Math.abs(p - this.opts.startS), len - Math.abs(p - this.opts.startS));
      return d < 170;
    };
    packs.forEach((pack, i) => {
      let lead = this.route.wrap(((i + 0.37) / Math.max(1, packs.length)) * len + randRange(this.rng, -90, 90));
      const oncoming = pack[0].direction < 0;
      const rows = Math.ceil(pack.length / 2);
      const tail = (rows - 1) * ROW_GAP;
      const rear = this.route.wrap(lead + (oncoming ? tail : -tail));
      if (nearStart(lead) || nearStart(rear)) lead = this.route.wrap(this.opts.startS + 640);
      pack.forEach((r, k) => {
        const row = Math.floor(k / 2);
        const col = k % 2;
        const back = row * ROW_GAP;
        r.s = this.route.wrap(lead + (oncoming ? back : -back));
        const side = oncoming ? 1 : -1;
        const right = oncoming ? ONCOMING_RIGHT : RIGHT_FILE;
        r.homeLat = right + side * col * FILE_GAP;
        r.lat = r.homeLat;
        r.latTarget = r.homeLat;
        const grade = this.route.gradeAt(r.s) * r.direction;
        r.v = steadySpeed(r.ftp, Math.max(grade, -0.03), r.bike, this.route.elevationAt(r.s));
        r.urge = r.v;
      });
    });
    if (this.buddy) {
      this.buddy.direction = dir;
      this.buddy.s = this.route.wrap(this.player.s + dir * BUDDY_GAP);
      this.buddy.lat = file;
      this.buddy.latTarget = file;
      this.buddy.homeLat = file;
      this.buddy.v = 0;
      this.buddy.power = 0;
      this.buddy.targetPower = 0;
    }
  }

  get finishLine(): number {
    return this.opts.finishS;
  }

  /** Riders sorted by race position (finished first, by time; then by distance). */
  /** 1 when the finish is ahead at a higher metre. -1 when the stage rides back toward the start. */
  raceDir(): 1 | -1 {
    const road = this.opts.road;
    if (road?.dir === 1 || road?.dir === -1) return road.dir;
    if (!isFinite(this.opts.finishS)) return 1;
    return this.opts.finishS >= this.opts.startS ? 1 : -1;
  }

  standings(): Racer[] {
    const dir = this.raceDir();
    const timeOf = (r: Racer) => r.officialTime ?? r.finishTime;
    return [...this.racers].sort((a, b) => {
      const ta = timeOf(a);
      const tb = timeOf(b);
      if (ta !== null && tb !== null) {
        if (ta !== tb) return ta - tb;
        return (a.finishTime ?? 0) - (b.finishTime ?? 0);
      }
      if (ta !== null) return -1;
      if (tb !== null) return 1;
      return (b.s - a.s) * dir;
    });
  }

  /** Free rides and training only, and only once the bike has stopped. */
  canTurnAround(): boolean {
    return !isFinite(this.opts.finishS) && this.turn === null && this.player.v <= STILL;
  }

  /** Swing the bike around onto the right-hand lane of the other direction. */
  turnAround(): boolean {
    if (!this.canTurnAround()) return false;
    const from = this.player.direction;
    const to: 1 | -1 = from > 0 ? -1 : 1;
    this.player.v = 0;
    if (this.buddy) this.buddy.v = 0;
    this.turn = {
      from,
      to,
      fromLat: this.player.lat,
      toLat: fileFor(to),
      elapsed: 0,
      buddyFrom: this.buddy ? this.buddy.s : null,
    };
    return true;
  }

  /** Extra heading in radians. 0 follows the road, −π faces the other way. */
  facingAngle(): number {
    const t = this.turn;
    if (!t) return this.player.direction < 0 ? -Math.PI : 0;
    const u = smoothstep(0, 1, t.elapsed / TURN_SEC);
    return t.from < 0 ? -(1 - u) * Math.PI : -u * Math.PI;
  }

  private advanceTurn(dt: number): boolean {
    const t = this.turn;
    if (!t) return false;
    t.elapsed += dt;
    const u = smoothstep(0, 1, t.elapsed / TURN_SEC);
    const lat = t.fromLat + (t.toLat - t.fromLat) * u;
    this.player.lat = lat;
    this.player.latTarget = lat;
    this.player.v = 0;
    const buddy = this.buddy;
    if (buddy && t.buddyFrom !== null) {
      buddy.lat = lat;
      buddy.latTarget = lat;
      buddy.v = 0;
      const target = this.route.wrap(this.player.s + t.to * BUDDY_GAP);
      const delta = this.along(t.buddyFrom, target, 1);
      buddy.s = this.route.wrap(t.buddyFrom + delta * u);
    }
    if (u < 1) return true;
    this.player.direction = t.to;
    this.player.homeLat = t.toLat;
    this.player.lat = t.toLat;
    this.player.latTarget = t.toLat;
    if (buddy) {
      buddy.direction = t.to;
      buddy.homeLat = t.toLat;
      buddy.lat = t.toLat;
      buddy.latTarget = t.toLat;
      buddy.s = this.route.wrap(this.player.s + t.to * BUDDY_GAP);
    }
    this.turn = null;
    return true;
  }

  step(dt: number, playerPower: number, playerCadence: number, braking = false): void {
    if (!this.started) return;
    const holding = this.advanceTurn(dt);
    this.time += dt;
    this.order.sort((a, b) => (b.s - a.s) * this.raceDir());
    this.indexFrame();
    this.computeDrafting();
    for (const r of this.racers) {
      if (this.holdingStart(r)) {
        r.power = 0;
        r.targetPower = 0;
        r.cadence = 0;
        r.v = 0;
        r.s = this.opts.startS;
        continue;
      }
      if (r.buddy) {
        this.applyBuddyPower();
        continue;
      }
      if (r.isPlayer) {
        r.power = playerPower;
        r.cadence = playerCadence;
      } else {
        r.decisionTimer -= dt;
        if (r.decisionTimer <= 0) {
          r.decisionTimer = 0.8 + this.rng() * 0.4;
          this.decide(r);
        }
        // smooth power changes like a human
        r.power += (r.targetPower - r.power) * Math.min(1, dt * 1.5);
        const g = this.route.gradeAt(r.s) * r.direction;
        r.cadence = r.power < 20 ? 0 : clamp(92 - g * 120, 72, 96);
        if (this.opts.road && r.road) this.spendStamina(r, dt);
      }
    }
    // Lane choice uses the speed the power would hold. Matching a wheel must not cancel the pass.
    if (this.openRoad()) this.planFreeLanes();
    for (const r of this.racers) {
      this.updateWBal(r, dt);
      const held = holding && (r.isPlayer || r.buddy);
      const dir = r.direction;
      const grade = this.route.gradeAt(r.s) * dir;
      const alt = this.route.elevationAt(r.s);
      if (held || this.holdingStart(r)) r.v = 0;
      else {
        if (this.opts.road && !r.isPlayer && grade < DESCENT_FROM) {
          const from = Math.min(r.free ?? r.v, r.v + DESCENT_SLACK);
          r.free = stepSpeed(from, r.power, grade, r.bike, dt, alt, r.draft, 0);
        } else r.free = undefined;
        r.v = stepSpeed(r.v, r.power, grade, r.bike, dt, alt, r.draft, r.isPlayer && braking ? BRAKE_DECEL : 0);
      }
      if (!held && this.openRoad()) this.keepClear(r);
    }
    let rolled: number[] | null = null;
    if (this.opts.road) {
      // Reused every substep rather than allocated.
      rolled = this.rolledScratch;
      rolled.length = this.racers.length;
      for (let i = 0; i < this.racers.length; i++) rolled[i] = this.racers[i].v;
    }
    if (this.opts.road && !holding) {
      shapeRoad(this.racers, this.opts.road, this.roadOrders(), (s) => this.route.gradeAt(s), (s) => this.route.elevationAt(s));
      if (!this.opts.road.timeTrial) this.formRoadPack();
      // The pace lock wants the steady speed straight away. From a standing start that is a catapult,
      // and over the top of a climb the steady speed of the descent is far above what the riders carry.
      // So speed may climb only a little faster than physics allows, and on a descent not at all.
      for (let i = 0; i < this.racers.length; i++) {
        const r = this.racers[i];
        if (r.isPlayer || r.finishTime != null || !rolled || this.holdingStart(r)) continue;
        const g = this.route.gradeAt(r.s) * r.direction;
        let top = rolled[i] + EXTRA_ACCEL * dt;
        if (r.free != null) top = Math.min(top, r.free + DESCENT_SLACK);
        r.v = clamp(r.v, rolled[i] - (g > 0.03 ? CLIMB_BRAKE : EXTRA_BRAKE) * dt, top);
      }
    }
    for (const r of this.racers) {
      const held = holding && (r.isPlayer || r.buddy);
      const parked = this.holdingStart(r);
      const dir = r.direction;
      const prevS = r.s;
      if (parked) {
        r.v = 0;
        r.s = this.opts.startS;
      } else if (!held) r.s += r.v * dt * dir;
      r.crank += (r.cadence / 60) * Math.PI * 2 * dt;
      const raceDir = this.raceDir();
      const startS = this.opts.startS;
      const prevAlong = (prevS - startS) * raceDir;
      const along = (r.s - startS) * raceDir;
      const finishAlong = (this.opts.finishS - startS) * raceDir;
      if (!parked && r.startTime === null && prevAlong < 0 && along >= 0 && isFinite(this.opts.finishS)) {
        const frac = r.v > 0 ? -prevAlong / (r.v * dt) : 1;
        r.startTime = this.time - dt + dt * frac;
      }
      if (!parked && r.finishTime === null && prevAlong < finishAlong && along >= finishAlong) {
        const frac = r.v > 0 ? (finishAlong - prevAlong) / (r.v * dt) : 1;
        // A time trial's clock starts when the rider leaves the ramp (ttStart is 0 otherwise).
        r.finishTime = this.time - dt + dt * frac - r.ttStart;
        if (!r.isPlayer) r.mode = 'finished';
        // Hill-climbs start in rows. Each rider is timed from their own crossing of the start line.
        if (!this.opts.road) r.officialTime = r.finishTime - (r.startTime ?? 0);
      }
      if (!(holding && (r.isPlayer || r.buddy))) this.steer(r, dt);
    }
    if (this.opts.road) {
      awardRoadFeatures(this.racers, this.opts.road, this.events);
      for (const feature of this.opts.road.features) {
        if (feature.awarded && feature.doneAt == null) feature.doneAt = this.time;
      }
      sealGroupTimes(this.racers, this.opts.road.timeTrial);
    }
    if (!holding) this.regroupBuddy(dt);
  }

  private updateWBal(r: Racer, dt: number) {
    if (r.power > r.cp) r.wBal -= (r.power - r.cp) * dt;
    else r.wBal += ((r.cp - r.power) * (r.wPrime - r.wBal) / r.wPrime) * dt;
    r.wBal = clamp(r.wBal, 0, r.wPrime);
  }

  /** Distance `behind` must ride, in their own direction, to reach `ahead`. */
  private travelGap(ahead: Racer, behind: Racer): number {
    const len = this.route.length;
    const raw = (this.route.wrap(ahead.s) - this.route.wrap(behind.s) + len) % len;
    if (behind.direction < 0) return (len - raw) % len;
    return raw;
  }

  /** Finds the closest wheel ahead of every rider and the resulting draft. */
  private computeDrafting() {
    if (this.opts.road?.timeTrial) {
      for (const r of this.racers) {
        r.draft = 0;
        this.aheadOf.set(r, null);
      }
      return;
    }
    if (!isFinite(this.opts.finishS)) {
      this.computeLoopDrafting();
      return;
    }
    const order = this.order;
    const dir = this.raceDir();
    for (let i = 0; i < order.length; i++) {
      const r = order[i];
      let best: { r: Racer; gap: number } | null = null;
      let draft = 0;
      let wheels = 0;
      for (let j = i - 1; j >= 0; j--) {
        const a = order[j];
        const gap = (a.s - r.s) * dir;
        if (gap > 14) break;
        if (gap < 0.3) continue;
        const dl = a.lat - r.lat;
        const d = draftFromGap(gap, dl);
        if (d > 0) {
          wheels++;
          draft = Math.max(draft, d);
        }
        if (Math.abs(dl) < 0.8 && (!best || gap < best.gap)) best = { r: a, gap };
      }
      // riding deeper in a group shelters a bit more
      r.draft = Math.min(0.45, draft + Math.max(0, wheels - 1) * 0.03);
      this.aheadOf.set(r, best);
    }
  }

  /**
   * Builds the per-step lookups. Free rides: riders per direction sorted by wrapped position,
   * and each group's members. Road races: unfinished positions and the best climb rating per slope.
   */
  private indexFrame(): void {
    // Free rides and time trials use the open-road lane rules, which look neighbours up here.
    if (this.openRoad()) {
      this.lanes.clear();
      this.packs.clear();
      const rows: { r: Racer; w: number; i: number }[] = [];
      this.racers.forEach((r, i) => {
        rows.push({ r, w: this.route.wrap(r.s), i });
        if (r.group !== 0) {
          const key = this.packKey(r);
          const list = this.packs.get(key);
          if (list) list.push(r);
          else this.packs.set(key, [r]);
        }
      });
      rows.sort((a, b) => a.w - b.w);
      for (const dir of [1, -1] as const) {
        const lane: Lane = { riders: [], pos: [], idx: [] };
        for (const row of rows) {
          if (row.r.direction !== dir) continue;
          lane.riders.push(row.r);
          lane.pos.push(row.w);
          lane.idx.push(row.i);
        }
        this.lanes.set(dir, lane);
      }
    }
    if (this.opts.road) {
      const plan = this.opts.road;
      const dir = this.raceDir();
      const live = this.racers.filter((r) => r.finishTime == null);
      this.windSlot = assignWindSlots(live, (s) => (s - this.opts.startS) * dir);
      this.sheltered.clear();
      for (const r of live) {
        if (isProtectedRider(r, live, plan)) this.sheltered.add(r.id);
      }
      this.peerAt = climbPeers(this.racers, plan.punchy);
    }
  }

  /**
   * Calls `fn` once for every rider going `dir` whose wrapped position is within NEAR_M of `s`
   * around the loop. A superset of what any free-ride rule looks at; callers still apply their exact test.
   */
  private eachNear(dir: 1 | -1, s: number, fn: (o: Racer, index: number) => void): void {
    const lane = this.lanes.get(dir);
    if (!lane || !lane.riders.length) return;
    const len = this.route.length;
    const pos = lane.pos;
    const n = pos.length;
    const w = this.route.wrap(s);
    const start = firstWhere(pos, (p) => p >= w);
    let seen = 0;
    for (let k = 0; k < n; k++) {
      const j = (start + k) % n;
      let d = pos[j] - w;
      if (d < 0) d += len;
      if (d > NEAR_M) break;
      fn(lane.riders[j], lane.idx[j]);
      seen++;
    }
    for (let k = 1; k <= n - seen; k++) {
      const j = (((start - k) % n) + n) % n;
      let d = w - pos[j];
      if (d < 0) d += len;
      if (d > NEAR_M) break;
      fn(lane.riders[j], lane.idx[j]);
    }
  }

  private computeLoopDrafting() {
    for (const r of this.racers) {
      let best: { r: Racer; gap: number } | null = null;
      let bestIndex = Infinity;
      let draft = 0;
      let wheels = 0;
      this.eachNear(r.direction, r.s, (a, index) => {
        if (a === r) return;
        const gap = this.travelGap(a, r);
        if (gap > 14 || gap < 0.3) return;
        const dl = a.lat - r.lat;
        const d = draftFromGap(gap, dl);
        if (d > 0) {
          wheels++;
          draft = Math.max(draft, d);
        }
        // Equal gaps go to the rider listed first, as a scan of every rider in order would.
        if (Math.abs(dl) < 0.8 && (!best || gap < best.gap || (gap === best.gap && index < bestIndex))) {
          best = { r: a, gap };
          bestIndex = index;
        }
      });
      r.draft = Math.min(0.45, draft + Math.max(0, wheels - 1) * 0.03);
      this.aheadOf.set(r, best);
    }
  }

  private energyPlace(r: Racer): EnergyPlace {
    return staminaPlace(r.mode, r.draft, r.energy, this.windSlot.get(r) ?? null, this.sheltered.has(r.id));
  }

  /** The stamina bar. The front and a breakaway spend it; the draft spends much less. */
  private spendStamina(r: Racer, dt: number): void {
    const plan = this.opts.road;
    const attrs = r.road?.attrs;
    if (!plan || !attrs) return;
    const grade = Math.max(0, this.route.gradeAt(r.s) * r.direction);
    const tempo = terrainWkg(plan, grade);
    const peer = (this.peerAt ??= climbPeers(this.racers, plan.punchy))(grade);
    const tax = climbDrain(climbRating(attrs, grade, plan.punchy), peer, grade);
    r.energy = tickEnergy(r.energy, attrs, r.power / Math.max(40, r.mass), tempo, this.energyPlace(r), dt, tax);
    r.reserve = tickRoadReserve(r, plan, this.route.gradeAt(r.s) * r.direction, this.racers, dt);
  }

  private decide(r: Racer) {
    if (this.opts.road) {
      decideRoad(r, this.opts.road, this.roadOrders(), this.route.gradeAt(r.s) * r.direction, this.racers, this.events);
      return;
    }
    if (!isFinite(this.opts.finishS)) {
      r.mode = 'steady';
      r.targetPower = r.ftp;
      return;
    }
    if (r.mode === 'finished') {
      r.targetPower = r.ftp * 0.35;
      return;
    }
    const remaining = this.opts.finishS - r.s;
    // Hold the chosen effort the whole climb. Easing off to sit in a wheel is what
    // bunched the field at the slow end and left a gap to the few riders up the road.
    if (remaining < 100 && remaining > 0) {
      r.mode = 'sprint';
      r.targetPower = r.ftp * 1.15;
      return;
    }
    r.mode = 'steady';
    r.targetPower = r.ftp;
  }

  private pickPassingLane(r: Racer) {
    const dir = this.raceDir();
    const options = [0.4, 1.2, 2.0, 2.7].map((lane) => lane * dir).filter((l) => Math.abs(l - r.lat) > 0.55);
    if (!options.length) return;
    let best = options[0];
    let bestScore = -Infinity;
    for (const l of options) {
      let score = -Math.abs(l - r.lat) * 0.3;
      for (const o of this.racers) {
        if (o === r) continue;
        const gap = (o.s - r.s) * dir;
        if (gap > -2 && gap < 15 && Math.abs(o.lat - l) < 0.8) score -= 2;
      }
      if (score > bestScore) {
        bestScore = score;
        best = l;
      }
    }
    r.latTarget = best;
  }

  private packKey(r: Racer): string {
    return r.group === 0 ? `solo:${r.id}` : `group:${r.group}:${r.direction}`;
  }

  /** Signed distance along the direction of travel. Positive when `toS` is ahead of `fromS`. */
  private along(fromS: number, toS: number, dir: 1 | -1): number {
    const len = this.route.length;
    const raw = (((toS - fromS) * dir) % len + len) % len;
    return raw > len * 0.5 ? raw - len : raw;
  }

  private packOf(r: Racer): Racer[] {
    if (r.group === 0) return [r];
    return this.packs.get(this.packKey(r)) ?? this.racers.filter((o) => o.group === r.group && o.direction === r.direction);
  }

  /** How far a pack shifts left to pass someone slower, then back once the road is clear. */
  private packShiftAmount(r: Racer): number {
    const dir = r.direction;
    const members = this.packOf(r);
    let nose = members[0];
    for (const m of members) {
      if (this.along(nose.s, m.s, dir) > 0) nose = m;
    }
    const rightHome = dir > 0 ? Math.max(...members.map((m) => m.homeLat)) : Math.min(...members.map((m) => m.homeLat));
    const leftHome = dir > 0 ? Math.min(...members.map((m) => m.homeLat)) : Math.max(...members.map((m) => m.homeLat));
    const speed = members.reduce((sum, m) => sum + this.paceOf(m), 0) / members.length;
    const out = dir > 0 ? nose.lat < nose.homeLat - 0.28 : nose.lat > nose.homeLat + 0.28;
    let shift = 0;
    let any = false;
    let leftLaneTaken = false;
    // Only riders within NEAR_M of the nose can be caught (ahead < 22) or alongside (ahead > -9).
    const scan = !(r.buddy || (r.isPlayer && this.buddy));
    if (scan) this.eachNear(dir, nose.s, (o) => {
      if (o === r || o.buddy) return;
      if (r.group !== 0 && o.group === r.group) return;
      const ahead = this.along(nose.s, o.s, dir);
      const slower = this.paceOf(o) < speed - 0.12;
      const catching = ahead > 0.4 && ahead < 22 && slower;
      // Stay wide until the slower rider is behind. Someone faster coming past does not pull us further left.
      const alongside = out && slower && ahead > -9 && ahead < 4;
      if (!catching && !alongside) return;
      any = true;
      const need = dir > 0 ? o.lat - PASS_GAP - rightHome : o.lat + PASS_GAP - rightHome;
      if (dir > 0) shift = Math.min(shift, need);
      else shift = Math.max(shift, need);
      // Someone is already out on the left, and we are faster than them.
      if (dir > 0 && o.lat < 0.9 && this.paceOf(o) < speed - 0.15) leftLaneTaken = true;
    });
    if (!any) return 0;
    if (dir > 0) {
      shift = Math.min(0, shift);
      const limit = leftLaneTaken ? FAST_LIMIT : PASS_LIMIT;
      shift = Math.max(shift, limit - leftHome);
    } else {
      shift = Math.max(0, shift);
      let limit = -0.7;
      this.eachNear(dir > 0 ? -1 : 1, nose.s, (o) => {
        const ahead = this.along(nose.s, o.s, dir);
        if (ahead < -18 || ahead > 28) return;
        if (o.lat < 0.2 && o.lat > FAST_LIMIT - 0.3) limit = Math.min(limit, o.lat - PASS_GAP);
      });
      shift = Math.min(shift, limit - leftHome);
    }
    return shift;
  }

  /** Speed the current power would hold. Sitting on a wheel does not lower it. */
  private paceOf(r: Racer): number {
    return r.urge > 0.3 ? r.urge : r.v;
  }

  /** Free rides and time trials share the road: right-hand file, and left to pass. */
  private openRoad(): boolean {
    return !isFinite(this.opts.finishS) || !!this.opts.road?.timeTrial;
  }

  private planFreeLanes() {
    for (const r of this.racers) {
      const dir = r.direction;
      const grade = this.route.gradeAt(r.s) * dir;
      const alt = this.route.elevationAt(r.s);
      r.urge = steadySpeed(Math.max(0, r.power), grade, r.bike, alt, r.draft);
      // Out of the wind the two are the same; skip the second solve.
      r.open = r.draft === 0 ? r.urge : steadySpeed(Math.max(0, r.power), grade, r.bike, alt, 0);
    }
    this.packShift.clear();
    for (const r of this.racers) {
      const key = this.packKey(r);
      if (!this.packShift.has(key)) this.packShift.set(key, this.packShiftAmount(r));
    }
  }

  /**
   * Same-pace riders leave a gap. A faster rider still moves left to pass, and overlaps
   * through anyone who is still in the way so a full road cannot hold them back.
   */
  private keepClear(r: Racer) {
    if (r.buddy) return;
    const dir = r.direction;
    this.eachNear(dir, r.s, (o) => {
      if (o === r || o.buddy) return;
      if (Math.abs(o.lat - r.lat) > 0.72) return;
      const ahead = this.along(r.s, o.s, dir);
      if (ahead <= 0.35 || ahead >= 2.35) return;
      if (r.open > o.open + 0.35) return;
      r.v = Math.min(r.v, o.v);
    });
  }

  private steer(r: Racer, dt: number) {
    if (!isFinite(this.opts.finishS) && (r.buddy || (r.isPlayer && this.buddy))) {
      r.latTarget = fileFor(this.player.direction);
      const dl = r.latTarget - r.lat;
      r.lat += clamp(dl, -2.2 * dt, 2.2 * dt);
      return;
    }
    if (this.openRoad()) {
      const shift = this.packShift.get(this.packKey(r)) ?? 0;
      const dir = r.direction;
      const min = dir > 0 ? FAST_LIMIT : -LANE_LIMIT;
      const max = dir > 0 ? RIGHT_FILE + 0.25 : -0.5;
      r.latTarget = clamp(r.homeLat + shift, min, max);
    } else if (!r.isPlayer && r.direction !== this.raceDir()) {
      r.latTarget = clamp(r.latTarget, -LANE_LIMIT, -1.6);
    } else if (!r.isPlayer) {
      const ahead = this.aheadOf.get(r);
      if (ahead && ahead.gap < 1.6 && ahead.r.v < r.v - 0.05 && Math.abs(ahead.r.lat - r.lat) < 0.6 && r.mode !== 'follow') {
        this.pickPassingLane(r);
      }
      r.latTarget = clamp(r.latTarget, -LANE_LIMIT, LANE_LIMIT);
    }
    const rate = this.openRoad() ? 2.2 : 0.7;
    const dl = r.latTarget - r.lat;
    r.lat += clamp(dl, -rate * dt, rate * dt);
  }

  /** Fast-forwards AI riders until everyone has finished (player keeps their result or DNF). */
  simulateToEnd(maxSeconds = 4 * 3600): void {
    if (!isFinite(this.opts.finishS)) return;
    const dt = 0.5;
    const playerFinished = this.player.finishTime !== null;
    const holdS = this.player.s;
    const holdV = this.player.v;
    const holdLat = this.player.lat;
    let guard = 0;
    // The player is parked, so teammates told to wait (or held near the player) would crawl to the guard.
    this.fastForward = true;
    while (this.racers.some((r) => !r.isPlayer && r.finishTime === null) && guard < maxSeconds / dt) {
      guard++;
      this.step(dt, 0, 0);
      if (playerFinished) {
        this.player.s = holdS;
        this.player.v = holdV;
        this.player.lat = holdLat;
      } else {
        const dir = this.raceDir();
        const behind = this.opts.startS - dir * 50;
        this.player.s = dir > 0 ? Math.min(this.player.s, behind) : Math.max(this.player.s, behind);
        this.player.lat = 3.4 * dir;
      }
    }
    this.fastForward = false;
  }
}
