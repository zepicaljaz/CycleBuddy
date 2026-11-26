import { describe, expect, it } from 'vitest';
import { freeRiderCount } from '../game/session';
import { raceById, stageCourse } from '../career/calendar';
import { getRouteDef } from '../routes/definitions';
import { Route } from '../routes/route';
import { DEFAULT_COLORS } from '../world/riders';
import { bestClimbers, riderName } from '../career/roster';
import { RideSim, type Racer } from './peloton';
import { assignWindSlots, climbPeers, climbRating, isProtectedRider, staminaPlace, ttStartOrder, type RoadBody, type RoadPlan, type RoadStarter } from './road';
import { draftFromGap } from '../physics/cycling';

describe('AI hill-climb race', () => {
  const route = new Route(getRouteDef('alpine'));
  const climb = route.climbs[0];

  it('rides a reversed stage back toward the start and still finishes', () => {
    const stage = raceById('ridge-race')!.stages[0];
    const course = stageCourse(stage);
    expect(course.dir).toBe(-1);
    expect(course.from).toBeGreaterThan(course.to);
    const plan: RoadPlan = {
      flatWkg: 3.4,
      hillWkg: 3.8,
      mountainWkg: 4.3,
      oneDay: true,
      timeTrial: false,
      startS: course.from,
      finishS: course.to,
      dir: -1,
      lastClimbS: null,
      finishKind: 'hill',
      tactic: 'control',
      features: [],
    };
    const sim = new RideSim(course.route, {
      startS: course.from,
      finishS: course.to,
      aiCount: 0,
      seed: 3,
      road: plan,
      roadField: [],
      player: { name: 'Me', massKg: 72, ftp: 280, colors: DEFAULT_COLORS },
    });
    expect(sim.player.direction).toBe(-1);
    expect(sim.raceDir()).toBe(-1);
    expect(sim.player.s).toBeGreaterThan(course.from);
    sim.started = true;
    const began = sim.player.s;
    for (let i = 0; i < 30; i++) sim.step(0.2, 260, 90);
    expect(sim.player.s).toBeLessThan(began);
    let guard = 0;
    while (sim.player.finishTime === null && guard < 24000) {
      sim.step(0.5, 280, 90);
      guard++;
    }
    expect(sim.player.finishTime).not.toBeNull();
    expect(sim.player.s).toBeLessThanOrEqual(course.to);
  });

  it('produces realistic finishing times with the field spread by effort', () => {
    const sim = new RideSim(route, {
      startS: climb.start,
      finishS: climb.end,
      aiCount: 75,
      topWkg: 6,
      bottomWkg: 2.5,
      seed: 7,
      player: { name: 'Me', massKg: 72, ftp: 250, colors: DEFAULT_COLORS },
    });
    sim.started = true;
    let spreadM = 0;
    const dt = 0.1;
    for (let t = 0; t < 3 * 3600 && sim.racers.some((r) => r.finishTime === null); t += dt) {
      sim.step(dt, 245, 85);
      if (Math.abs(t - 600) < dt / 2) {
        const ai = sim.racers.filter((r) => !r.isPlayer);
        const front = Math.max(...ai.map((r) => r.s));
        const back = Math.min(...ai.map((r) => r.s));
        spreadM = front - back;
      }
    }
    const times = sim.racers.filter((r) => !r.isPlayer).map((r) => r.finishTime!);
    const best = Math.min(...times) / 60;
    const worst = Math.max(...times) / 60;
    const player = sim.player.finishTime! / 60;
    const pos = sim.standings().indexOf(sim.player) + 1;
    console.log(`winner ${best.toFixed(1)} min, last ${worst.toFixed(1)} min, player (3.4 W/kg) ${player.toFixed(1)} min, P${pos}/76, spread at 10 min: ${spreadM.toFixed(0)} m`);
    expect(best).toBeGreaterThan(36);
    expect(best).toBeLessThan(48);
    expect(worst).toBeGreaterThan(65);
    expect(worst).toBeLessThan(95);
    expect(spreadM).toBeGreaterThan(1500);
  });

  it('times a hill-climb from each rider\'s own crossing of the start line', () => {
    const sim = new RideSim(route, {
      startS: climb.start,
      finishS: climb.start + 250,
      aiCount: 15,
      topWkg: 5,
      bottomWkg: 3,
      seed: 4,
      player: { name: 'Me', massKg: 72, ftp: 250, colors: DEFAULT_COLORS },
    });
    sim.started = true;
    for (let t = 0; t < 600 && sim.racers.some((r) => r.finishTime === null); t += 0.2) sim.step(0.2, 245, 85);
    const done = sim.racers.filter((r) => r.finishTime !== null);
    expect(done.length).toBe(sim.racers.length);
    for (const r of done) expect(r.officialTime).toBeCloseTo(r.finishTime! - r.startTime!, 6);
    // Riders further back on the grid reach the line later.
    expect(Math.max(...done.map((r) => r.startTime!))).toBeGreaterThan(0.5);
    const clock = (r: (typeof done)[number]) => r.officialTime ?? r.finishTime!;
    const st = sim.standings();
    for (let i = 1; i < st.length; i++) expect(clock(st[i])).toBeGreaterThanOrEqual(clock(st[i - 1]));
  });

  it('rides the buddy at the set power and meets the player at a climb gate', () => {
    const route = new Route(getRouteDef('alpine'));
    const climb = route.climbs[0];
    expect(climb.end - climb.start).toBeGreaterThan(400);
    const sim = new RideSim(route, {
      startS: 400,
      finishS: Infinity,
      aiCount: 6,
      freeRide: true,
      seed: 2,
      buddy: { flat: 2.5, hill: 3.4, mountain: 4.2 },
      player: { name: 'Me', massKg: 72, ftp: 230, colors: { ...DEFAULT_COLORS, jersey: '#112233', frame: '#445566' } },
    });
    const buddy = sim.buddy!;
    expect(buddy.buddy).toBe(true);
    expect(buddy.mass).toBe(72);
    expect(buddy.v).toBe(0);
    expect(buddy.colors.jersey).toBe('#112233');
    expect(buddy.colors.frame).toBe('#445566');
    sim.started = true;
    const len = route.length;
    const gap = (a: number, b: number) => {
      const d = (a - b + len) % len;
      return Math.min(d, len - d);
    };
    const mid = (climb.start + climb.end) / 2;
    sim.player.s = mid;
    sim.player.v = 3;
    sim.player.lat = 2.3;
    buddy.s = mid + 2.3;
    buddy.v = 3;
    buddy.lat = 2.3;
    sim.step(0.1, 40, 60);
    const grade = Math.max(0, route.gradeAt(buddy.s));
    const want = grade >= 0.05 ? 4.2 : grade >= 0.02 ? 3.4 : 2.5;
    expect(buddy.wkg).toBeCloseTo(want, 5);
    expect(buddy.power).toBeLessThan(want * 72 * 0.15);
    sim.time = 40;
    sim.step(0.1, 40, 60);
    expect(buddy.power).toBeCloseTo(want * 72, 0);
    for (let i = 0; i < 80; i++) sim.step(0.1, 40, 60);
    expect(gap(buddy.s, sim.player.s)).toBeGreaterThan(8);

    sim.player.s = climb.end - 220;
    sim.player.v = 4;
    sim.player.lat = 2.3;
    buddy.s = climb.end - 15;
    buddy.v = 6;
    buddy.lat = 2.3;
    for (let i = 0; i < 30; i++) sim.step(0.1, 80, 70);
    const toTop = ((climb.end - buddy.s) % len + len) % len;
    const signed = toTop > len / 2 ? toTop - len : toTop;
    expect(Math.abs(signed)).toBeLessThan(40);
    const playerToTop = ((climb.end - sim.player.s) % len + len) % len;
    expect(playerToTop > len / 2 ? len - playerToTop : playerToTop).toBeGreaterThan(80);

    sim.player.s = climb.end - 8;
    sim.player.v = 4;
    for (let i = 0; i < 15; i++) sim.step(0.1, 80, 70);
    expect(gap(buddy.s, sim.player.s)).toBeLessThan(15);
    expect(sim.player.lat).toBeGreaterThan(2);
  });

  it('puts free-ride riders on the loop, including slow riders, groups and oncoming traffic', () => {
    const route = new Route(getRouteDef('alpine'));
    const n = freeRiderCount(route.length);
    const sim = new RideSim(route, {
      startS: 0,
      finishS: Infinity,
      aiCount: n,
      freeRide: true,
      seed: 3,
      player: { name: 'Me', massKg: 72, ftp: 230, colors: DEFAULT_COLORS },
    });
    const ai = sim.racers.filter((r) => !r.isPlayer);
    expect(ai.length).toBeGreaterThan(18);
    expect(ai).toHaveLength(n);
    for (const r of ai) {
      expect(r.wkg).toBeGreaterThanOrEqual(0.95);
      expect(r.wkg).toBeLessThanOrEqual(5.15);
      const gap = Math.min(Math.abs(r.s), route.length - Math.abs(r.s));
      expect(gap).toBeGreaterThan(30);
    }
    expect(Math.min(...ai.map((r) => r.wkg))).toBeLessThan(1.8);
    for (const r of ai) {
      expect(r.mass).toBeGreaterThanOrEqual(56);
      expect(r.mass).toBeLessThanOrEqual(85);
      expect(Math.abs(r.ftp / r.mass - r.wkg)).toBeLessThan(0.02);
    }
    const oncoming = ai.filter((r) => r.direction < 0);
    expect(oncoming.length).toBeGreaterThan(0);
    for (const r of oncoming) expect(r.lat).toBeLessThan(-1.5);
    const groups = new Map<number, typeof ai>();
    for (const r of ai) {
      if (r.group === 0) continue;
      const list = groups.get(r.group) ?? [];
      list.push(r);
      groups.set(r.group, list);
    }
    expect(groups.size).toBeGreaterThan(0);
    for (const pack of groups.values()) {
      expect(pack.length).toBeGreaterThan(1);
      expect(new Set(pack.map((r) => r.ftp)).size).toBe(1);
      expect(new Set(pack.map((r) => r.direction)).size).toBe(1);
    }
    sim.started = true;
    for (let t = 0; t < 30; t += 0.1) sim.step(0.1, 180, 85);
    for (const r of ai) expect(Math.abs(r.power - r.ftp)).toBeLessThan(1);
    for (const r of oncoming) expect(r.s).toBeLessThan(route.length);
  });

  it('passes slower riders on the left and keeps a group side by side without overlapping', () => {
    const route = new Route(getRouteDef('alpine'));
    const sim = new RideSim(route, {
      startS: 0,
      finishS: Infinity,
      aiCount: freeRiderCount(route.length),
      freeRide: true,
      seed: 5,
      player: { name: 'Me', massKg: 72, ftp: 230, colors: DEFAULT_COLORS },
    });
    const sameWay = sim.racers.filter((r) => !r.isPlayer && r.direction === 1);
    const packs = new Map<number, typeof sameWay>();
    for (const r of sim.racers) {
      if (r.isPlayer || r.group === 0) continue;
      const list = packs.get(r.group) ?? [];
      list.push(r);
      packs.set(r.group, list);
    }
    expect(packs.size).toBeGreaterThan(0);
    for (const pack of packs.values()) {
      expect(new Set(pack.map((r) => r.homeLat.toFixed(2))).size).toBe(2);
      for (let i = 0; i < pack.length; i++) {
        for (let j = i + 1; j < pack.length; j++) {
          const ds = Math.abs(pack[i].s - pack[j].s);
          const gap = Math.min(ds, route.length - ds);
          const dl = Math.abs(pack[i].homeLat - pack[j].homeLat);
          if (dl < 0.6) expect(gap).toBeGreaterThan(2.2);
          else expect(dl).toBeGreaterThan(0.8);
        }
      }
    }
    const ahead = sameWay[0];
    for (const r of sim.racers) {
      if (r !== sim.player && r !== ahead) r.s = route.wrap(5000);
    }
    ahead.group = 0;
    ahead.s = route.wrap(sim.player.s + 14);
    ahead.homeLat = 2.3;
    ahead.lat = 2.3;
    ahead.latTarget = 2.3;
    ahead.v = 5;
    ahead.power = 90;
    ahead.targetPower = 90;
    sim.player.v = 9;
    sim.started = true;
    for (let i = 0; i < 30; i++) sim.step(0.1, 420, 90);
    expect(sim.player.lat).toBeLessThan(ahead.lat - 0.7);
    expect(ahead.lat).toBeGreaterThan(1.7);
  });

  it('passes on the left when riders ahead are already overtaking three abreast', () => {
    const route = new Route(getRouteDef('alpine'));
    const sim = new RideSim(route, {
      startS: 0,
      finishS: Infinity,
      aiCount: 8,
      freeRide: true,
      seed: 9,
      player: { name: 'Me', massKg: 72, ftp: 230, colors: DEFAULT_COLORS },
    });
    const others = sim.racers.filter((r) => !r.isPlayer);
    const [a, b, c] = others;
    for (const r of others) r.s = route.wrap(4000);
    const base = route.wrap(sim.player.s + 16);
    for (const r of [a, b, c]) {
      r.s = base;
      r.direction = 1;
      r.group = 0;
      r.v = 5;
      r.urge = 5;
      r.power = 100;
      r.targetPower = 100;
    }
    a.homeLat = 2.3;
    a.lat = 2.3;
    a.latTarget = 2.3;
    b.homeLat = 1.4;
    b.lat = 1.4;
    b.latTarget = 1.4;
    b.group = 99;
    a.group = 99;
    c.homeLat = 2.3;
    c.lat = 0.25;
    c.latTarget = 0.25;
    c.v = 6.5;
    c.urge = 6.5;
    sim.player.v = 11;
    sim.player.urge = 11;
    sim.started = true;
    for (let i = 0; i < 45; i++) sim.step(0.1, 460, 90);
    const leftEdge = Math.min(a.lat, b.lat, c.lat);
    expect(sim.player.lat).toBeLessThan(leftEdge - 0.8);
  });

  it('still moves left to pass when a group has already held the player at its speed', () => {
    const route = new Route(getRouteDef('alpine'));
    const sim = new RideSim(route, {
      startS: 200,
      finishS: Infinity,
      aiCount: 6,
      freeRide: true,
      seed: 4,
      player: { name: 'Me', massKg: 56, ftp: 230, colors: DEFAULT_COLORS },
    });
    const ahead = sim.racers.find((r) => !r.isPlayer && r.direction === 1)!;
    for (const r of sim.racers) {
      if (r !== sim.player && r !== ahead) r.s = route.wrap(sim.player.s + 3000);
    }
    ahead.group = 0;
    ahead.s = route.wrap(sim.player.s + 1.6);
    ahead.homeLat = 2.3;
    ahead.lat = 2.3;
    ahead.latTarget = 2.3;
    ahead.power = 140;
    ahead.targetPower = 140;
    ahead.v = 2.1;
    ahead.urge = 2.1;
    sim.player.lat = 2.3;
    sim.player.latTarget = 2.3;
    sim.player.homeLat = 2.3;
    sim.player.v = 2.1;
    sim.player.urge = 2.1;
    sim.player.power = 480;
    sim.started = true;
    for (let i = 0; i < 25; i++) sim.step(0.1, 480, 88);
    expect(sim.player.lat).toBeLessThan(ahead.lat - 0.75);
    expect(ahead.lat).toBeGreaterThan(1.6);
  });

  it('overlaps through a line of riders when there is no free lane to the left', () => {
    const route = new Route(getRouteDef('alpine'));
    const sim = new RideSim(route, {
      startS: 200,
      finishS: Infinity,
      aiCount: 8,
      freeRide: true,
      seed: 6,
      player: { name: 'Me', massKg: 72, ftp: 230, colors: DEFAULT_COLORS },
    });
    const wall = sim.racers.filter((r) => !r.isPlayer).slice(0, 5);
    for (const r of sim.racers) {
      if (r.isPlayer || wall.includes(r)) continue;
      r.s = route.wrap(sim.player.s + 4000);
    }
    const lats = [2.3, 1.45, 0.55, -0.35, -1.25];
    wall.forEach((r, i) => {
      r.group = 0;
      r.direction = 1;
      r.s = route.wrap(sim.player.s + 2);
      r.homeLat = lats[i];
      r.lat = lats[i];
      r.latTarget = lats[i];
      r.power = 110;
      r.targetPower = 110;
      r.v = 2.2;
      r.open = 2.2;
    });
    sim.player.lat = 1.45;
    sim.player.latTarget = 1.45;
    sim.player.homeLat = 2.3;
    sim.player.v = 2.2;
    sim.player.open = 2.2;
    sim.started = true;
    const start = sim.player.s;
    for (let i = 0; i < 50; i++) sim.step(0.1, 500, 90);
    const gained = (sim.player.s - start + route.length) % route.length;
    expect(gained).toBeGreaterThan(12);
    const stillAhead = wall.some((r) => {
      const gap = (r.s - sim.player.s + route.length) % route.length;
      return gap > 0.5 && gap < 30;
    });
    expect(stillAhead).toBe(false);
  });

  it('rides at the W/kg the player chose, and only sprints in the last 100 m', () => {
    const sim = new RideSim(route, {
      startS: climb.start,
      finishS: climb.end,
      aiCount: 40,
      topWkg: 4,
      bottomWkg: 3,
      seed: 11,
      player: { name: 'Me', massKg: 72, ftp: 288, colors: DEFAULT_COLORS },
    });
    const ai = sim.racers.filter((r) => !r.isPlayer);
    const wkgs = ai.map((r) => r.wkg);
    for (const w of wkgs) {
      expect(w).toBeGreaterThanOrEqual(2.99);
      expect(w).toBeLessThanOrEqual(4.001);
    }
    expect(Math.max(...wkgs)).toBeGreaterThan(3.95);
    expect(Math.min(...wkgs)).toBeLessThan(3.05);
    // Even steps down the band: half the field in each half, and no cluster under the leader.
    const strong = wkgs.filter((w) => w >= 3.5).length;
    expect(strong).toBeGreaterThanOrEqual(18);
    expect(strong).toBeLessThanOrEqual(22);
    expect(wkgs.filter((w) => w >= 3.9).length).toBeLessThanOrEqual(6);

    sim.started = true;
    let highest = 0;
    let lowest = Infinity;
    for (let t = 0; t < 180; t += 0.1) {
      sim.step(0.1, 288, 85);
      if (t < 15) continue;
      for (const r of ai) {
        if (sim.finishLine - r.s <= 120) continue;
        const ratio = r.power / r.ftp;
        highest = Math.max(highest, ratio);
        lowest = Math.min(lowest, ratio);
      }
    }
    expect(highest).toBeLessThan(1.03);
    expect(lowest).toBeGreaterThan(0.97);
    const byDistance = [...ai].sort((a, b) => b.s - a.s);
    expect(byDistance[0].wkg).toBeGreaterThan(3.9);
    expect(byDistance[byDistance.length - 1].wkg).toBeLessThan(3.12);
    const mid = byDistance[Math.floor(byDistance.length / 2)];
    expect(mid.wkg).toBeGreaterThan(3.15);
    expect(mid.wkg).toBeLessThan(3.85);
    const leader = ai.reduce((a, b) => (a.wkg > b.wkg ? a : b));
    expect(Math.abs(leader.s - sim.player.s)).toBeLessThan(40);

    for (const r of ai) {
      r.s = sim.finishLine - 50;
      r.finishTime = null;
      r.mode = 'steady';
      r.power = r.ftp;
    }
    for (let i = 0; i < 30; i++) sim.step(0.1, 288, 85);
    for (const r of ai) {
      if (r.finishTime !== null) continue;
      expect(r.targetPower).toBeGreaterThan(r.ftp * 1.1);
      expect(r.targetPower).toBeLessThan(r.ftp * 1.25);
    }
  });

  it('names hill-climb riders after the career climbers and ranks the effort by mountain rating', () => {
    const sim = new RideSim(route, {
      startS: climb.start,
      finishS: climb.end,
      aiCount: 75,
      topWkg: 5,
      bottomWkg: 3,
      seed: 4,
      player: { name: 'Me', massKg: 72, ftp: 250, colors: DEFAULT_COLORS },
    });
    const ai = sim.racers.filter((r) => !r.isPlayer);
    expect(ai).toHaveLength(75);
    const names = ai.map((r) => r.name);
    expect(names[0]).toBe('T. Novarik');
    expect(names).toContain('J. Vinter');
    expect(names).not.toContain('T. Pogačnik');
    expect(new Set(names).size).toBe(75);
    for (const r of ai) {
      expect(r.name).toMatch(/^[A-Z]\. .+/);
      expect(r.wkg).toBeGreaterThanOrEqual(2.99);
      expect(r.wkg).toBeLessThanOrEqual(5.001);
    }
    const novarik = ai[0];
    const vinter = ai.find((r) => r.name === 'J. Vinter')!;
    const last = ai[ai.length - 1];
    expect(novarik.country).toBe('SLO');
    expect(novarik.team).toBe('Atlas Emirates');
    expect(novarik.mass).toBe(66);
    expect(novarik.colors.jersey).toBe('#f4f4f4');
    expect(novarik.wkg).toBeGreaterThan(vinter.wkg);
    expect(vinter.wkg).toBeGreaterThan(last.wkg);
  });

  it('lets climbers with a similar mountain rating change order from race to race', () => {
    const ranked = bestClimbers(40);
    let closeA = ranked[0];
    let closeB = ranked[1];
    for (let i = 1; i < ranked.length; i++) {
      if (ranked[i - 1].attrs.mountain - ranked[i].attrs.mountain <= 1) {
        closeA = ranked[i - 1];
        closeB = ranked[i];
        break;
      }
    }
    expect(closeA.attrs.mountain - closeB.attrs.mountain).toBeLessThanOrEqual(1);
    const field = (seed: number) => {
      const sim = new RideSim(route, {
        startS: climb.start,
        finishS: climb.end,
        aiCount: 40,
        topWkg: 5,
        bottomWkg: 3,
        seed,
        player: { name: 'Me', massKg: 72, ftp: 250, colors: DEFAULT_COLORS },
      });
      return sim.racers.filter((r) => !r.isPlayer);
    };
    const gaps = Array.from({ length: 24 }, (_, i) => {
      const ai = field(i + 1);
      const novarik = ai.find((r) => r.name === 'T. Novarik')!;
      const vinter = ai.find((r) => r.name === 'J. Vinter')!;
      expect(novarik.wkg).toBeGreaterThan(vinter.wkg);
      const next = Math.max(...ai.filter((r) => r !== novarik).map((r) => r.wkg));
      // One even step of the 2 W/kg band over 39 chasers, give or take the jitter and whole watts.
      expect(novarik.wkg - next).toBeGreaterThan(0.01);
      expect(novarik.wkg - next).toBeLessThan(0.09);
      const ahead = ai.find((r) => r.name === riderName(closeA))!;
      const behind = ai.find((r) => r.name === riderName(closeB))!;
      return ahead.wkg - behind.wkg;
    });
    expect(gaps.some((g) => g > 0.002)).toBe(true);
    expect(gaps.some((g) => g < -0.002)).toBe(true);
  });

  it('turns a stopped free-ride rider onto the other lane and rides back', () => {
    const loop = new Route(getRouteDef('lake'));
    const sim = new RideSim(loop, {
      startS: 400,
      finishS: Infinity,
      aiCount: 0,
      freeRide: true,
      seed: 1,
      player: { name: 'Me', massKg: 72, ftp: 230, colors: DEFAULT_COLORS },
    });
    sim.started = true;
    sim.player.v = 3;
    expect(sim.turnAround()).toBe(false);
    sim.player.v = 0;
    expect(sim.turnAround()).toBe(true);
    const held = sim.player.s;
    sim.step(0.2, 300, 90);
    expect(sim.player.s).toBeCloseTo(held, 4);
    expect(sim.player.direction).toBe(1);
    expect(sim.facingAngle()).toBeLessThan(0);
    for (let i = 0; i < 20; i++) sim.step(0.1, 0, 0);
    expect(sim.player.direction).toBe(-1);
    expect(sim.player.lat).toBeCloseTo(-2.45, 1);
    expect(sim.facingAngle()).toBeCloseTo(-Math.PI, 2);
    const before = sim.player.s;
    sim.step(0.4, 250, 90);
    expect(sim.player.s).toBeLessThan(before);

    const race = new RideSim(loop, {
      startS: 0,
      finishS: 1000,
      aiCount: 0,
      seed: 1,
      player: { name: 'Me', massKg: 72, ftp: 230, colors: DEFAULT_COLORS },
    });
    race.started = true;
    race.player.v = 0;
    expect(race.turnAround()).toBe(false);
    expect(race.player.direction).toBe(1);
  });

  it('brakes the player to a stop on a free ride', () => {
    const loop = new Route(getRouteDef('lake'));
    const sim = new RideSim(loop, {
      startS: 400,
      finishS: Infinity,
      aiCount: 0,
      freeRide: true,
      seed: 1,
      player: { name: 'Me', massKg: 72, ftp: 230, colors: DEFAULT_COLORS },
    });
    sim.started = true;
    sim.player.v = 12;
    const before = sim.player.v;
    sim.step(0.5, 300, 90, true);
    expect(sim.player.v).toBeLessThan(before - 0.5);
    expect(sim.player.v).toBeGreaterThan(6);
    for (let i = 0; i < 80; i++) sim.step(0.1, 300, 90, true);
    expect(sim.player.v).toBe(0);
    expect(sim.canTurnAround()).toBe(true);
  });
});

/* eslint-disable @typescript-eslint/no-explicit-any */
describe('neighbour lookups match the full scan', () => {
  it('drafting, keep-clear and pack shifts on a seeded free-ride loop', () => {
    const route = new Route(getRouteDef('lake'));
    const sim = new RideSim(route, {
      startS: 400,
      finishS: Infinity,
      aiCount: freeRiderCount(route.length),
      freeRide: true,
      seed: 11,
      buddy: { flat: 2.6, hill: 3.2, mountain: 3.8 },
      player: { name: 'Me', massKg: 72, ftp: 240, colors: DEFAULT_COLORS },
    });
    const any = sim as any;
    const len = route.length;
    const travelGap = (a: Racer, b: Racer) => {
      const raw = (route.wrap(a.s) - route.wrap(b.s) + len) % len;
      return b.direction < 0 ? (len - raw) % len : raw;
    };
    const packOf = (r: Racer) => (r.group === 0 ? [r] : sim.racers.filter((o) => o.group === r.group && o.direction === r.direction));
    const bruteDraft = (r: Racer) => {
      let best: { r: Racer; gap: number } | null = null;
      let draft = 0;
      let wheels = 0;
      for (const a of sim.racers) {
        if (a === r || a.direction !== r.direction) continue;
        const gap = travelGap(a, r);
        if (gap > 14 || gap < 0.3) continue;
        const dl = a.lat - r.lat;
        const d = draftFromGap(gap, dl);
        if (d > 0) {
          wheels++;
          draft = Math.max(draft, d);
        }
        if (Math.abs(dl) < 0.8 && (!best || gap < best.gap)) best = { r: a, gap };
      }
      return { draft: Math.min(0.45, draft + Math.max(0, wheels - 1) * 0.03), best };
    };
    const bruteShift = (r: Racer): number => {
      const dir = r.direction;
      const members = packOf(r);
      let nose = members[0];
      for (const m of members) if (any.along(nose.s, m.s, dir) > 0) nose = m;
      const rightHome = dir > 0 ? Math.max(...members.map((m) => m.homeLat)) : Math.min(...members.map((m) => m.homeLat));
      const leftHome = dir > 0 ? Math.min(...members.map((m) => m.homeLat)) : Math.max(...members.map((m) => m.homeLat));
      const speed = members.reduce((sum, m) => sum + any.paceOf(m), 0) / members.length;
      const out = dir > 0 ? nose.lat < nose.homeLat - 0.28 : nose.lat > nose.homeLat + 0.28;
      let shift = 0;
      let found = false;
      let leftLaneTaken = false;
      for (const o of sim.racers) {
        if (o.direction !== dir || o === r || o.buddy) continue;
        if (r.buddy || (r.isPlayer && sim.buddy)) continue;
        if (r.group !== 0 && o.group === r.group) continue;
        const ahead = any.along(nose.s, o.s, dir);
        const slower = any.paceOf(o) < speed - 0.12;
        const catching = ahead > 0.4 && ahead < 22 && slower;
        const alongside = out && slower && ahead > -9 && ahead < 4;
        if (!catching && !alongside) continue;
        found = true;
        const need = dir > 0 ? o.lat - 1.05 - rightHome : o.lat + 1.05 - rightHome;
        shift = dir > 0 ? Math.min(shift, need) : Math.max(shift, need);
        if (dir > 0 && o.lat < 0.9 && any.paceOf(o) < speed - 0.15) leftLaneTaken = true;
      }
      if (!found) return 0;
      if (dir > 0) return Math.max(Math.min(0, shift), (leftLaneTaken ? -1.45 : -0.55) - leftHome);
      let limit = -0.7;
      for (const o of sim.racers) {
        if (o.direction === dir) continue;
        const ahead = any.along(nose.s, o.s, dir);
        if (ahead < -18 || ahead > 28) continue;
        if (o.lat < 0.2 && o.lat > -1.45 - 0.3) limit = Math.min(limit, o.lat - 1.05);
      }
      return Math.min(Math.max(0, shift), limit - leftHome);
    };
    const bruteKeepClear = (r: Racer) => {
      for (const o of sim.racers) {
        if (o === r || o.direction !== r.direction || o.buddy || r.buddy) continue;
        if (Math.abs(o.lat - r.lat) > 0.72) continue;
        const ahead = any.along(r.s, o.s, r.direction);
        if (ahead <= 0.35 || ahead >= 2.35) continue;
        if (r.open > o.open + 0.35) continue;
        r.v = Math.min(r.v, o.v);
      }
    };

    sim.started = true;
    let checked = 0;
    let drafting = 0;
    let shifted = 0;
    let held = 0;
    for (let k = 0; k < 200; k++) {
      sim.step(0.2, 230, 88);
      if (k % 25 !== 0) continue;
      any.indexFrame();
      any.computeLoopDrafting();
      for (const r of sim.racers) {
        const brute = bruteDraft(r);
        const fast = any.aheadOf.get(r);
        expect(r.draft).toBe(brute.draft);
        expect(fast?.r ?? null).toBe(brute.best?.r ?? null);
        expect(fast?.gap ?? null).toBe(brute.best?.gap ?? null);
        if (r.draft > 0) drafting++;
        const shift = any.packShiftAmount(r);
        expect(shift).toBe(bruteShift(r));
        if (shift !== 0) shifted++;
      }
      // A rider can be held by a wheel that was itself just held, so compare the whole sequence.
      const v0 = sim.racers.map((r) => r.v);
      sim.racers.forEach((r) => any.keepClear(r));
      const fastV = sim.racers.map((r) => r.v);
      sim.racers.forEach((r, i) => (r.v = v0[i]));
      sim.racers.forEach((r) => bruteKeepClear(r));
      expect(fastV).toEqual(sim.racers.map((r) => r.v));
      held += fastV.filter((v, i) => v !== v0[i]).length;
      checked++;
    }
    expect(checked).toBe(8);
    // The field is busy enough that every rule actually fires.
    expect(drafting).toBeGreaterThan(20);
    expect(shifted).toBeGreaterThan(0);
    expect(held).toBeGreaterThan(0);
  });

  it('stamina place and climb peers on a road stage', () => {
    const route = new Route(getRouteDef('alpine'));
    const climb = route.climbs[0];
    const start = climb.start - 600;
    const finish = climb.start + 400;
    const field: RoadStarter[] = bestClimbers(40).map((rider) => ({
      name: riderName(rider), country: rider.country, team: rider.teamId, mass: rider.mass, colors: DEFAULT_COLORS,
      body: { riderId: rider.id, teamId: rider.teamId, age: rider.age, teammate: false, attrs: rider.attrs, kit: DEFAULT_COLORS },
    }));
    for (const punchy of [false, true]) {
      const sim = new RideSim(route, {
        startS: start,
        finishS: finish,
        aiCount: 0,
        seed: 9,
        road: {
          flatWkg: 3.6, hillWkg: 4, mountainWkg: 4.4, oneDay: false, timeTrial: false, punchy,
          startS: start, finishS: finish, lastClimbS: climb.start, firstClimbS: climb.start, finishKind: 'hill', tactic: 'control', features: [],
        },
        roadField: field,
        player: { name: 'Me', massKg: 72, ftp: 260, colors: DEFAULT_COLORS },
      });
      const any = sim as any;
      sim.started = true;
      const peers = climbPeers(sim.racers, punchy);
      for (let g = -0.04; g <= 0.12; g += 0.0025) {
        let peer = 0;
        for (const o of sim.racers) if (o.road && !o.isPlayer) peer = Math.max(peer, climbRating(o.road.attrs, g, punchy));
        expect(peers(g)).toBe(peer);
      }
      const places = new Set<string>();
      const road = {
        flatWkg: 3.6, hillWkg: 4, mountainWkg: 4.4, oneDay: false, timeTrial: false, punchy,
        startS: start, finishS: finish, lastClimbS: climb.start, firstClimbS: climb.start, finishKind: 'hill' as const, tactic: 'control' as const, features: [],
      };
      for (let k = 0; k < 360; k++) {
        sim.step(0.25, 260, 90);
        if (k % 40 !== 0) continue;
        any.indexFrame();
        const live = sim.racers.filter((r) => r.finishTime == null);
        const slots = assignWindSlots(live, (s) => s - start);
        for (const r of sim.racers) {
          const sheltered = isProtectedRider(r, live, road);
          const fast = any.energyPlace(r);
          expect(fast).toBe(staminaPlace(r.mode, r.draft, r.energy, slots.get(r) ?? null, sheltered));
          places.add(fast);
        }
      }
      expect(places.size).toBeGreaterThan(1);
    }
  });
});

describe('time trial ramp', () => {
  it('puts riders with no time yet first and the overall leader last', () => {
    const rows = ttStartOrder([
      { name: 'Leader', gcRank: 0 },
      { name: 'New' },
      { name: 'Last', gcRank: 2 },
      { name: 'Second', gcRank: 1 },
    ]);
    expect(rows.map((row) => row.name)).toEqual(['New', 'Last', 'Second', 'Leader']);
  });

  it('leaves later riders on the line and times each rider from their own start', () => {
    const route = new Route(getRouteDef('alpine'));
    const start = route.climbs[0].start;
    const plan: RoadPlan = {
      flatWkg: 3.4,
      hillWkg: 4,
      mountainWkg: 4.4,
      ttWkg: 5,
      oneDay: false,
      timeTrial: true,
      startS: start,
      finishS: start + 70,
      dir: 1,
      lastClimbS: null,
      finishKind: 'sprint',
      tactic: 'control',
      features: [],
    };
    const body = (id: string, rank?: number): RoadBody => ({
      riderId: id,
      teamId: 'atlas',
      age: 27,
      teammate: false,
      attrs: { flat: 74, hills: 74, medium: 74, mountain: 70, tt: 80, sprint: 70, recovery: 80, endurance: 80, stamina: 80 },
      kit: DEFAULT_COLORS,
      gcRank: rank,
    });
    const sim = new RideSim(route, {
      startS: start,
      finishS: start + 70,
      aiCount: 0,
      seed: 1,
      road: plan,
      roadField: [
        { name: 'Early', country: 'FRA', team: 'A', mass: 70, colors: DEFAULT_COLORS, body: body('early', 2) },
        { name: 'Leader', country: 'FRA', team: 'A', mass: 70, colors: DEFAULT_COLORS, body: body('leader', 0) },
      ],
      playerRoad: body('player', 1),
      player: { name: 'Me', massKg: 72, ftp: 280, colors: DEFAULT_COLORS },
    });
    expect([...sim.racers].sort((a, b) => a.ttStart - b.ttStart).map((r) => r.name)).toEqual(['Early', 'Me', 'Leader']);
    expect(sim.player.ttStart).toBe(5);
    expect(sim.racers.find((r) => r.name === 'Leader')!.ttStart).toBe(10);
    sim.started = true;
    for (let i = 0; i < 6; i++) sim.step(0.5, 320, 90);
    const early = sim.racers.find((r) => r.name === 'Early')!;
    expect(early.s).toBeGreaterThan(start + 1);
    expect(sim.player.s).toBe(start);
    expect(sim.racers.find((r) => r.name === 'Leader')!.s).toBe(start);
    let guard = 0;
    while (sim.player.finishTime == null && guard < 4000) {
      sim.step(0.2, 320, 90);
      guard++;
    }
    expect(sim.player.finishTime).not.toBeNull();
    expect(Math.abs((sim.player.finishTime ?? 0) - (sim.time - sim.player.ttStart))).toBeLessThan(0.3);
    expect(sim.player.finishTime ?? 0).toBeLessThan(sim.time - 4);
  });

  it('rides the right side and passes a slower rider on the left', () => {
    const route = new Route(getRouteDef('alpine'));
    const start = route.climbs[0].start;
    const plan: RoadPlan = {
      flatWkg: 3.4,
      hillWkg: 4,
      mountainWkg: 4.4,
      ttWkg: 4,
      oneDay: false,
      timeTrial: true,
      startS: start,
      finishS: start + 400,
      dir: 1,
      lastClimbS: null,
      finishKind: 'sprint',
      tactic: 'control',
      features: [],
    };
    const slow: RoadBody = {
      riderId: 'slow',
      teamId: 'atlas',
      age: 27,
      teammate: false,
      attrs: { flat: 60, hills: 60, medium: 60, mountain: 60, tt: 55, sprint: 60, recovery: 80, endurance: 80, stamina: 80 },
      kit: DEFAULT_COLORS,
    };
    const sim = new RideSim(route, {
      startS: start,
      finishS: start + 400,
      aiCount: 0,
      seed: 2,
      road: plan,
      roadField: [{ name: 'Slow', country: 'FRA', team: 'A', mass: 78, colors: DEFAULT_COLORS, body: slow }],
      player: { name: 'Me', massKg: 72, ftp: 320, colors: DEFAULT_COLORS },
    });
    const ahead = sim.racers.find((r) => r.name === 'Slow')!;
    expect(sim.player.homeLat).toBeGreaterThan(2);
    expect(ahead.homeLat).toBeGreaterThan(2);
    ahead.s = start + 8;
    ahead.ttStart = 0;
    ahead.v = 6;
    ahead.power = 120;
    ahead.targetPower = 120;
    sim.player.s = start;
    sim.player.ttStart = 0;
    sim.player.v = 10;
    sim.started = true;
    for (let i = 0; i < 20; i++) sim.step(0.1, 460, 90);
    expect(sim.player.lat).toBeLessThan(ahead.lat - 0.6);
    expect(ahead.lat).toBeGreaterThan(1.6);
  });
});
