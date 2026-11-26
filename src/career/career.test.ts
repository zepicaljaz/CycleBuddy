import { describe, expect, it } from 'vitest';
import { RideSim } from '../ai/peloton';
import { awardRoadFeatures, breakFactor, decideRoad, flatRunIn, punchScore, shareFinishTimes, tickEnergy, trialFactor, type RaceAttrs, type RoadActor, type RoadBody, type RoadFeature, type RoadPlan } from '../ai/road';
import { CLIMBERS } from '../ai/climbers';
import { canEnter, climbOnStage, climbScoresOnStage, monthsFor, punchyStage, raceById, raceDays, RACES, stageKm, stageSegment, stageWindow, terrainBand } from './calendar';
import { aiField, fieldFromList } from './squad';
import { adoptCalendar, Career, mergeTime, repairClassifications, stagePrimes, teamRanking } from './season';
import { buildOffers } from './classify';
import { CAREER_WORLDS, STAGE_SEGMENTS } from '../routes/careerWorlds';
import { getRouteDef } from '../routes/definitions';
import { getRoute } from '../routes/route';
import { FREE_RIDE_RISE, freeRideProfileSpan } from '../ui/profileChart';
import { RIDERS, bestClimbers, riderName, ridersOf, teamStars, teamStrength } from './roster';
import { simulateRace } from './simulate';
import { CONTINENTAL_TEAMS, PRO_TEAMS, ROSTER_SIZE, TEAMS, WORLD_TEAMS, teamsIn } from './teams';
import { DEFAULT_COLORS } from '../world/riders';

const attrs = (flat: number): RaceAttrs => ({
  flat, hills: flat, medium: flat - 4, mountain: flat - 8, tt: flat - 2, sprint: flat,
  recovery: 80, endurance: 80, stamina: 80,
});

function starter(id: string, flat: number) {
  const body: RoadBody = { riderId: id, teamId: 'atlas', age: 27, teammate: false, attrs: attrs(flat), kit: DEFAULT_COLORS };
  return { name: id, country: 'FRA', team: 'Atlas', mass: 70, colors: DEFAULT_COLORS, body };
}

describe('career season', () => {
  it('adds every stage of a race into one total, even when the ids do not match', () => {
    const stage = (riderId: string, name: string, time: number) => ({
      riderId, name, teamId: 'galpeak', country: 'ESP', age: 27, value: time,
    });
    const active = {
      raceId: 'south-week',
      stageIndex: 2,
      gc: [stage('M. Bech', 'M. Bech', 24 * 60 + 6), stage('galpeak-r4', 'M. Bech', 44 * 60)],
      sprint: [stage('V. Moulin', 'V. Moulin', 40), stage('malt-r2', 'V. Moulin', 12)],
      kom: [stage('D. Korosec', 'D. Korosec', 10), stage('polsun-r1', 'D. Korosec', 8)],
      stageWinners: [],
    };
    expect(repairClassifications(active)).toBe(true);
    expect(active.gc).toHaveLength(1);
    expect(active.gc[0].name).toBe('M. Bech');
    expect(active.gc[0].value).toBe(24 * 60 + 6 + 44 * 60);
    expect(active.sprint[0].value).toBe(52);
    expect(active.kom[0].value).toBe(18);
    expect(active.sprint.some((row) => row.name === 'D. Korosec')).toBe(false);
    expect(active.kom.some((row) => row.name === 'V. Moulin')).toBe(false);
    expect(repairClassifications(active)).toBe(false);
  });

  it('draws every stage profile at the same elevation ratio', () => {
    for (const race of RACES) {
      for (const stage of race.stages) {
        const piece = stageWindow(stage);
        const route = getRoute(getRouteDef(piece.routeId));
        const len = Math.max(1, piece.end - piece.start);
        let minY = Infinity;
        let maxY = -Infinity;
        const n = 160;
        for (let i = 0; i <= n; i++) {
          const y = route.elevationAt(piece.start + (len * i) / n);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
        }
        const range = Math.max(1, maxY - minY);
        const span = freeRideProfileSpan(len, range);
        const mountainTrial = piece.kind === 'tt' && terrainBand(piece.ascent, piece.km) === 'mountain';
        if (!mountainTrial) expect(span / len, `${race.id} ${stage.name}`).toBeCloseTo(FREE_RIDE_RISE, 5);
        expect(range, `${race.id} ${stage.name}`).toBeLessThan(span * 0.96);
      }
    }
  });

  it('matches the real division sizes and roster averages', () => {
    expect(teamsIn('world')).toHaveLength(WORLD_TEAMS);
    expect(teamsIn('pro')).toHaveLength(PRO_TEAMS);
    expect(teamsIn('continental')).toHaveLength(CONTINENTAL_TEAMS);
    expect(WORLD_TEAMS).toBe(22);
    expect(PRO_TEAMS).toBe(20);
    expect(ROSTER_SIZE).toEqual({ world: 28, pro: 23, continental: 14 });
    for (const team of TEAMS) expect(RIDERS.filter((r) => r.teamId === team.id)).toHaveLength(ROSTER_SIZE[team.division]);
  });

  it('lists World Tour teams on CYB and Pro with Continental teams together', () => {
    const points = { atlas: 40, hive: 8, oakfuel: 30, malt: 4, slorising: 12, unknown: 99 };
    expect(teamRanking(points, ['world'], 22).map((row) => row.id)).toEqual(['atlas', 'hive']);
    const cont = teamRanking(points, ['pro', 'continental'], 20);
    expect(cont.map((row) => [row.id, row.division])).toEqual([
      ['oakfuel', 'pro'],
      ['slorising', 'continental'],
      ['malt', 'pro'],
    ]);
    const buried = Object.fromEntries(teamsIn('pro').map((team, index) => [team.id, 100 - index]));
    buried.slorising = 1;
    const shown = teamRanking(buried, ['pro', 'continental'], 2, 'slorising');
    expect(shown.map((row) => row.id)).toEqual([teamsIn('pro')[0].id, teamsIn('pro')[1].id, 'slorising']);
    expect(shown.at(-1)?.place).toBe(teamsIn('pro').length + 1);
  });

  it('marks the intermediate sprint, the mountain points, and the finish', () => {
    const flat = stagePrimes(raceById('opening-classic')!.stages[0], true);
    expect(flat.some((mark) => mark.kind === 'sprint' || mark.kind === 'kom')).toBe(false);
    const finish = flat.find((mark) => mark.kind === 'finish');
    expect(finish?.at).toBe(1);
    expect(finish?.points[0]).toBe(40);
    const hill = stagePrimes(raceById('dike-race')!.stages[0], true);
    expect(hill.some((mark) => mark.kind === 'sprint' || mark.kind === 'kom')).toBe(false);
    const week = raceById('south-week')!;
    const sprint = stagePrimes(week.stages[0]).find((mark) => mark.kind === 'sprint');
    expect(sprint?.at).toBeGreaterThan(0.2);
    expect(sprint?.points).toEqual([12, 8, 6, 4, 2]);
    const climbed = stagePrimes(week.stages[1]);
    expect(climbed.filter((mark) => mark.kind === 'kom').length).toBeGreaterThan(0);
    const trial = stagePrimes(week.stages[3]);
    expect(trial.some((mark) => mark.kind === 'sprint')).toBe(false);
    for (const race of RACES) {
      const oneDay = race.stages.length === 1;
      for (const stage of race.stages) {
        const sprint = stagePrimes(stage, oneDay).find((mark) => mark.kind === 'sprint');
        if (!sprint) continue;
        const piece = stageWindow(stage);
        const road = getRoute(getRouteDef(piece.routeId));
        const span = piece.end - piece.start;
        const at = piece.from + piece.dir * sprint.at * span;
        for (let d = -40; d <= 40; d += 20) {
          const g = road.gradeAt(at + piece.dir * d) * piece.dir;
          expect(Math.abs(g), `${race.id} ${stage.name} at ${d} m`).toBeLessThan(0.02);
        }
      }
    }
    expect(trial.find((mark) => mark.kind === 'finish')?.points[0]).toBe(20);
  });

  it('ticks every race a new continental rider is allowed to start', () => {
    const career = new Career();
    career.create('slorising', 'SLO', 3.4, 3.8, 4.3);
    expect(career.state?.entered).toContain('lowland-trophy');
    expect(career.state?.entered).toContain('riviera-tour');
    expect(career.state?.entered).not.toContain('france-tour');
    expect(career.state?.entered).not.toContain('italy-tour');
  });

  it('puts a stage race on each day it occupies, including the next month', () => {
    for (const id of ['france-tour', 'italy-tour', 'spanish-tour']) {
      expect(RACES.find((race) => race.id === id)!.stages, id).toHaveLength(21);
    }
    const spain = RACES.find((race) => race.id === 'spanish-tour')!;
    const days = raceDays(spain, 2026);
    expect(days[0]).toEqual({ month: 8, day: 16 });
    expect(days.at(-1)).toEqual({ month: 9, day: 5 });
    expect(days).toHaveLength(spain.stages.length);
    const window = stageWindow(spain.stages[0]);
    expect(window.km).toBeGreaterThan(15);
    expect(window.kind).toBe('road');
    expect(CAREER_WORLDS.length).toBeGreaterThanOrEqual(22);
    expect(RACES.length).toBeGreaterThanOrEqual(45);
  });

  it('rates squads from one to five stars, and continental teams are not all the same', () => {
    const continental = TEAMS.filter((t) => t.division === 'continental').map((t) => teamStars(t.id));
    const world = TEAMS.filter((t) => t.division === 'world').map((t) => teamStars(t.id));
    for (const stars of [...continental, ...world]) {
      expect(stars).toBeGreaterThanOrEqual(1);
      expect(stars).toBeLessThanOrEqual(5);
    }
    expect(new Set(continental).size).toBeGreaterThan(1);
    expect(Math.max(...world)).toBeGreaterThan(Math.max(...continental));
    expect(teamStrength('atlas')).toBeGreaterThan(teamStrength('alpendev'));
  });

  it('spreads a team, names riders for their country, and keeps the best Slovenian', () => {
    const flats = ridersOf('slorising').map((r) => r.attrs.flat);
    const flatSpread = Math.max(...flats) - Math.min(...flats);
    expect(flatSpread).toBeGreaterThan(6);
    expect(flatSpread).toBeLessThan(22);
    const band = (division: 'world' | 'pro' | 'continental') => {
      const lo = division === 'world' ? 70 : division === 'pro' ? 60 : 50;
      const hi = division === 'world' ? 92 : division === 'pro' ? 75 : 70;
      return RIDERS.filter((r) => TEAMS.find((t) => t.id === r.teamId)?.division === division).every((r) => {
        const vals = [r.attrs.flat, r.attrs.hills, r.attrs.medium, r.attrs.mountain, r.attrs.tt, r.attrs.sprint];
        return vals.every((n) => n >= lo && n <= hi);
      });
    };
    expect(band('continental')).toBe(true);
    expect(band('pro')).toBe(true);
    expect(band('world')).toBe(true);
    for (const rider of RIDERS.filter((r) => r.program === 'sprint')) {
      expect(rider.attrs.sprint - rider.attrs.mountain, riderName(rider)).toBeGreaterThanOrEqual(8);
    }
    for (const rider of RIDERS.filter((r) => r.program === 'gc' && r.attrs.mountain >= 84)) {
      expect(rider.attrs.mountain - rider.attrs.flat, riderName(rider)).toBeGreaterThanOrEqual(6);
    }
    for (const team of TEAMS) {
      const lasts = ridersOf(team.id).map((r) => r.last.toLocaleLowerCase('en-US'));
      expect(new Set(lasts).size, team.name).toBe(lasts.length);
    }
    const slo = RIDERS.filter((r) => r.country === 'SLO').map((r) => r.last);
    const nik = slo.filter((last) => last.toLocaleLowerCase('en-US').endsWith('nik')).length;
    expect(nik / slo.length).toBeLessThan(0.2);
    const lists = new Map<string, Set<string>>();
    for (const rider of RIDERS) {
      const bag = lists.get(rider.last.toLocaleLowerCase('en-US')) ?? new Set<string>();
      bag.add(rider.country);
      lists.set(rider.last.toLocaleLowerCase('en-US'), bag);
    }
    for (const [last, countries] of lists) expect(countries.size, last).toBe(1);
    const overall = (r: (typeof RIDERS)[number]) => r.attrs.mountain * 2 + r.attrs.medium + r.attrs.tt + r.attrs.hills * 0.5 + r.attrs.flat * 0.35;
    const bestClimb = [...RIDERS].sort((a, b) => b.attrs.mountain - a.attrs.mountain)[0];
    const bestAll = [...RIDERS].sort((a, b) => overall(b) - overall(a))[0];
    expect(bestClimb.country).toBe('SLO');
    expect(bestAll.country).toBe('SLO');
    expect(bestClimb.last).toBe('Novarik');
  });

  it('starts the right number of teams and riders', () => {
    const continental = RACES.find((race) => race.id === 'lowland-trophy')!;
    const pro = RACES.find((race) => race.id === 'riviera-tour')!;
    const world = RACES.find((race) => race.id === 'france-tour')!;
    const cont = aiField(continental, 'slorising', true);
    const proField = aiField(pro, 'slorising', true);
    const worldField = aiField(world, 'atlas', true);
    expect(new Set(cont.map((slot) => slot.rider.teamId)).size).toBe(15);
    expect(cont.filter((slot) => slot.rider.teamId === 'slorising')).toHaveLength(6);
    expect(new Set(proField.map((slot) => slot.rider.teamId)).size).toBe(20);
    expect(proField.filter((slot) => slot.teammate)).toHaveLength(6);
    expect(new Set(worldField.map((slot) => slot.rider.teamId)).size).toBe(22);
    expect(worldField.filter((slot) => slot.rider.teamId === 'atlas')).toHaveLength(7);
    const locked = fieldFromList(proField.map((slot) => slot.rider.id), 'slorising');
    expect(locked.map((slot) => slot.rider.id)).toEqual(proField.map((slot) => slot.rider.id));
  });

  it('fills a hill-climb with the best career climbers', () => {
    const field = bestClimbers(75);
    expect(field).toHaveLength(75);
    expect(riderName(field[0])).toBe('T. Novarik');
    expect(field[0].country).toBe('SLO');
    expect(field[0].teamId).toBe('atlas');
    for (let i = 1; i < field.length; i++) {
      const ahead = field[i - 1].attrs.mountain;
      const here = field[i].attrs.mountain;
      expect(here).toBeLessThanOrEqual(ahead);
    }
    const everyone = bestClimbers(RIDERS.length + 10);
    expect(everyone).toHaveLength(RIDERS.length);
    expect(field.some((rider) => rider.id === everyone[everyone.length - 1].id)).toBe(false);
    expect(bestClimbers(0)).toHaveLength(0);
  });

  it('keeps career surnames unique and off the old climber ranking', () => {
    const banned = new Set(CLIMBERS.map((r) => r.last.toLocaleLowerCase('en-US')));
    const seen = new Set<string>();
    for (const rider of RIDERS) {
      expect(banned.has(rider.last.toLocaleLowerCase('en-US')), rider.last).toBe(false);
      expect(rider.last.startsWith('Rider')).toBe(false);
      expect(rider.last, riderName(rider)).not.toMatch(/\d/);
      const name = riderName(rider);
      expect(seen.has(name), name).toBe(false);
      seen.add(name);
    }
  });

  it('lets a continental rider into Pro and championships, not the World Tour', () => {
    expect(canEnter('world', 'continental')).toBe(false);
    expect(canEnter('world', 'pro')).toBe(true);
    expect(canEnter('world', 'world')).toBe(true);
    expect(canEnter('pro', 'continental')).toBe(true);
    expect(canEnter('champ', 'continental')).toBe(true);
    expect(canEnter('continental', 'world')).toBe(false);
  });

  it('offers the current team, then higher teams only after enough points', () => {
    const quiet = buildOffers(20, 'slorising');
    expect(quiet.length).toBeGreaterThanOrEqual(3);
    expect(quiet.length).toBeLessThanOrEqual(5);
    expect(quiet[0].teamId).toBe('slorising');
    expect(quiet.some((offer) => TEAMS.find((t) => t.id === offer.teamId)?.division === 'world')).toBe(false);
    const promoted = buildOffers(1100, 'slorising');
    expect(promoted.some((offer) => TEAMS.find((t) => t.id === offer.teamId)?.division === 'world')).toBe(true);
    expect(promoted.some((offer) => TEAMS.find((t) => t.id === offer.teamId)?.division === 'pro')).toBe(true);
  });

  it('promotes a continental rider on Pro race results, not only championships', () => {
    const divisionOf = (id: string) => TEAMS.find((t) => t.id === id)?.division;
    const season = (cont: number) => {
      const career = new Career();
      career.create('slorising', 'SLO', 3.4, 3.8, 4.3);
      const state = career.state!;
      state.done = RACES.map((race) => race.id);
      state.cont = { player: cont };
      career.simulateAhead();
      return state.offers ?? [];
    };
    expect(divisionOf('slorising')).toBe('continental');
    expect(season(0).some((offer) => divisionOf(offer.teamId) !== 'continental')).toBe(false);
    // Four Pro one-day wins (4 × 90 × 0.75 = 270) are not yet enough; five (338) are.
    expect(season(360).some((offer) => divisionOf(offer.teamId) === 'pro')).toBe(false);
    expect(season(450).some((offer) => divisionOf(offer.teamId) === 'pro')).toBe(true);
    // About fifteen Pro wins earn a World Tour offer; fourteen do not.
    expect(season(1260).some((offer) => divisionOf(offer.teamId) === 'world')).toBe(false);
    expect(season(1350).some((offer) => divisionOf(offer.teamId) === 'world')).toBe(true);
  });

  it('gives one time to a bunch and a new time after a gap', () => {
    const official = shareFinishTimes([10, 10.4, 10.9, 12.2, 12.5]);
    expect(official.slice(0, 3)).toEqual([10, 10, 10]);
    expect(official.slice(3)).toEqual([12.2, 12.2]);
  });

  it('keeps road stages near 20–30 km and time trials near 5 km', () => {
    for (const race of RACES) {
      for (const stage of race.stages) {
        const km = stageKm(stage);
        const seg = STAGE_SEGMENTS.find((item) => item.id === stage.segment)!;
        if (seg.kind === 'tt' && seg.finish === 'mountain') expect(km, stage.name).toBeGreaterThan(2);
        else if (seg.kind === 'tt') expect(km, stage.name).toBeGreaterThan(3);
        else if (seg.world === 'lake') expect(km, stage.name).toBeGreaterThan(14);
        else expect(km, stage.name).toBeGreaterThan(17);
        if (seg.kind === 'tt' && seg.finish === 'mountain') expect(km, stage.name).toBeLessThan(3);
        else if (seg.kind === 'tt') expect(km, stage.name).toBeLessThan(6.5);
        else if (seg.world === 'lake') expect(km, stage.name).toBeLessThan(16);
        else expect(km, stage.name).toBeLessThan(33);
      }
    }
    const argent = getRoute(getRouteDef('argent'));
    const moon = argent.climbs.find((c) => c.id === 'arg-lune')!;
    expect(moon.length / 1000).toBeGreaterThan(4);
    expect(moon.length / 1000).toBeLessThan(6.5);
    expect(argent.def.scenery.mountainHeight).toBeGreaterThan(1500);
  });

  it('tags a stage from the climbing in every ten kilometres', () => {
    expect(terrainBand(301, 10)).toBe('mountain');
    expect(terrainBand(300, 10)).toBe('medium');
    expect(terrainBand(200, 10)).toBe('medium');
    expect(terrainBand(199, 10)).toBe('hilly');
    expect(terrainBand(50, 10)).toBe('hilly');
    expect(terrainBand(49, 10)).toBe('flat');
    const band = (id: string, index: number) => {
      const window = stageWindow(raceById(id)!.stages[index]);
      return terrainBand(window.ascent, window.km);
    };
    expect(band('south-week', 2)).toBe('mountain');
    expect(raceById('south-week')!.stages[2].segment).toBe('and-cal');
    expect(band('north-week', 2)).toBe('hilly');
    expect(band('harbour-race', 0)).toBe('hilly');
    const riviera = raceById('riviera-tour')!;
    expect(band('riviera-tour', 3)).toBe('mountain');
    const ridge = new Set(stageWindow(riviera.stages[1]).climbs.map((climb) => climb.name));
    const other = stageWindow(riviera.stages[3]).climbs.map((climb) => climb.name);
    expect(other.some((name) => ridge.has(name))).toBe(false);
    const easier = stageWindow(raceById('mountain-week')!.stages[1]);
    expect(raceById('mountain-week')!.stages[1].segment).not.toBe('mas-queen');
    expect(easier.ascent).toBeLessThan(650);
    const moor = stageWindow(raceById('moor-classic')!.stages[0]);
    expect(moor.ascent).toBeGreaterThan(160);
    expect(moor.ascent).toBeLessThan(240);
    expect(terrainBand(moor.ascent, moor.km)).toMatch(/flat|hilly/);
    expect(band('vosges-tour', 0)).toBe('flat');
    const trial = stageWindow(raceById('france-tour')!.stages[8]);
    expect(trial.kind).toBe('tt');
    expect(trial.km).toBeGreaterThan(2);
    expect(trial.km).toBeLessThan(3);
    expect(terrainBand(trial.ascent, trial.km)).toBe('mountain');
    expect(band('coast-classic', 0)).toBe('hilly');
    const cup = stageWindow(raceById('hill-cup')!.stages[0]);
    const cupPer = (cup.ascent / cup.km) * 10;
    expect(terrainBand(cup.ascent, cup.km), `${Math.round(cupPer)} m per 10 km`).toBe('hilly');
    expect(cupPer).toBeGreaterThan(180);
    expect(band('pass-race', 0)).toBe('hilly');
    const lake = stageWindow(raceById('lake-race')!.stages[0]);
    expect(lake.routeName).toBe('Mirror Lake');
    expect(terrainBand(lake.ascent, lake.km), `${Math.round(lake.ascent)} m over ${lake.km.toFixed(1)} km`).toBe('flat');
    expect(band('plateau', 1)).toBe('hilly');
    expect(band('island-tour', 1)).toBe('hilly');
    const harvest = raceById('harvest')!;
    expect(harvest.stages).toHaveLength(5);
    expect(band('harvest', 4)).toBe('mountain');
    const climber = trialFactor({ tt: 70, mountain: 90 }, 'mountain');
    const specialist = trialFactor({ tt: 90, mountain: 60 }, 'mountain');
    const flatTrial = trialFactor({ tt: 90, mountain: 60 }, 'sprint');
    expect(climber).toBeGreaterThan(specialist);
    expect(flatTrial).toBeGreaterThan(specialist);
    expect(flatTrial).toBeCloseTo(1, 5);
  });

  it('keeps eight France summit finishes and mountains in the last week of Spain', () => {
    const france = RACES.find((race) => race.id === 'france-tour')!;
    const summits = france.stages.filter((stage) => {
      const window = stageWindow(stage);
      return window.kind === 'road' && window.summitFinish;
    });
    const valleys = france.stages.filter((stage) => {
      const window = stageWindow(stage);
      return window.kind === 'road' && window.climbs.length > 0 && !window.summitFinish;
    });
    expect(summits).toHaveLength(8);
    expect(valleys).toHaveLength(4);
    const spain = RACES.find((race) => race.id === 'spanish-tour')!;
    const lastWeek = spain.stages.slice(-6).filter((stage) => stageWindow(stage).finish === 'mountain');
    expect(lastWeek.length).toBeGreaterThanOrEqual(3);
  });

  it('saves the short walls for riders who can climb and sprint', () => {
    const score = (last: string) => punchScore(RIDERS.find((rider) => rider.last === last)!.attrs);
    for (const puncher of ['van Aerde', 'Poelman', 'Evrault']) {
      expect(score(puncher), puncher).toBeGreaterThan(score('Vinter'));
      expect(score(puncher), puncher).toBeGreaterThan(score('Delaere'));
    }
    const place = (stage: (typeof RACES)[number]['stages'][number]) => {
      const window = stageWindow(stage);
      const first = Math.min(...window.climbs.map((climb) => climb.atKm - climb.km));
      const last = Math.max(...window.climbs.map((climb) => climb.atKm));
      return { first, tail: window.km - last, climbs: window.climbs.length };
    };
    const cape = place(RACES.find((race) => race.id === 'south-week')!.stages[4]);
    expect(cape.first).toBeGreaterThan(3);
    expect(cape.tail).toBeLessThan(1.6);
    expect(punchyStage(RACES.find((race) => race.id === 'south-week')!.stages[4])).toBe(true);
    const spain = RACES.find((race) => race.id === 'spanish-tour')!;
    const day3 = place(spain.stages[2]);
    expect(day3.climbs).toBe(3);
    expect(day3.first).toBeGreaterThan(5);
    expect(day3.tail).toBeLessThan(1.2);
    const day7 = place(spain.stages[6]);
    expect(day7.climbs).toBe(2);
    expect(day7.first).toBeGreaterThan(8);
    expect(day7.tail).toBeLessThan(2);
    expect(spain.stages[9].name).toContain('Alto de la Cruz');
    expect(spain.stages[14].name).toContain('Wijlreberg');
  });

  it('rides some valley stages back the other way without changing the climb', () => {
    const reversed = RACES.flatMap((race) => race.stages.filter((stage) => stage.reverse).map((stage) => ({ race, stage })));
    expect(reversed.length).toBeGreaterThanOrEqual(8);
    for (const { race, stage } of reversed) {
      const back = stageWindow(stage);
      const forward = stageWindow({ segment: stage.segment, name: stage.name });
      const label = `${race.id} ${stage.name}`;
      expect(back.km, label).toBeCloseTo(forward.km, 2);
      expect(back.kind, label).toBe(forward.kind);
      expect(back.finish, label).toBe(forward.finish);
      expect(back.summitFinish, label).toBe(forward.summitFinish);
      expect(Math.abs(back.ascent - forward.ascent), label).toBeLessThanOrEqual(Math.max(80, forward.ascent * 0.25));
      expect(back.climbs.length, label).toBeGreaterThan(0);
      expect(back.start, label).toBeLessThan(back.end);
      expect(back.dir, label).toBe(-1);
    }
  });

  it('keeps flat sprints flat and gives queen stages two or three climbs', () => {
    const queens = new Set([
      'arg-queen', 'mas-queen', 'sav-blanche', 'vos-ballon', 'sie-cielo',
      'dol-grigio', 'ape-ferro', 'sic-vulcano', 'and-blanca', 'cat-turo',
      'lom-rovere', 'pyr-foc',
    ]);
    const sprintWithClimbs = new Set(['fla-monument', 'fla-semi']);
    const classics = new Set(['fla-berg', 'ard-arrow', 'ard-roche']);
    for (const race of RACES) {
      for (const stage of race.stages) {
        const window = stageWindow(stage);
        const label = `${race.name} ${stage.name}`;
        if (queens.has(stage.segment)) {
          expect(window.climbs.length, label).toBeGreaterThanOrEqual(2);
          expect(window.climbs.length, label).toBeLessThanOrEqual(3);
          expect(window.finish, label).toBe('mountain');
          expect(window.ascent, label).toBeGreaterThan(650);
          expect(window.ascent, label).toBeLessThan(1200);
        } else if (window.kind === 'road' && window.finish === 'hill' && !classics.has(stage.segment)) {
          expect(window.ascent, label).toBeLessThan(780);
          const longClimbs = window.climbs.filter((climb) => climb.km >= 1.2);
          expect(longClimbs.length, label).toBeLessThanOrEqual(2);
        } else if (window.kind === 'road' && window.finish === 'mountain' && !classics.has(stage.segment)) {
          expect(window.ascent, label).toBeLessThan(900);
        }
        if (window.kind === 'road' && window.finish === 'sprint' && !sprintWithClimbs.has(stage.segment)) {
          expect(window.climbs, label).toEqual([]);
          expect(window.ascent, label).toBeLessThan(120);
        }
      }
    }
  });

  it('simulates a race the same way twice', () => {
    const race = RACES.find((item) => item.id === 'flandres')!;
    const a = simulateRace(race, 2026, 'SLO');
    const b = simulateRace(race, 2026, 'SLO');
    expect(a.overall[0].riderId).toBe(b.overall[0].riderId);
    expect(a.overall[0].time).toBeGreaterThan(60);
    expect(a.overall.length).toBeGreaterThan(20);
  });

  it('ticks races added to an old calendar and leaves an unticked race off', () => {
    const state = {
      version: 1 as const,
      year: 2026,
      age: 24,
      nation: 'SLO',
      teamId: 'slorising',
      flatWkg: 3.4,
      hillWkg: 3.8,
      mountainWkg: 4.3,
      ttWkg: 4.6,
      tactic: 'control' as const,
      entered: ['lowland-trophy', 'riviera-tour'],
      enteredSeeded: true,
      done: [],
      skipped: [],
      active: null,
      races: [],
      history: [],
      cyb: {},
      wins: {},
      teamPoints: {},
      palmares: [],
      champions: {},
      offers: null,
    };
    expect(adoptCalendar(state)).toBe(true);
    expect(state.entered).toContain('opening-classic');
    expect(state.entered).toContain('vosges-tour');
    expect(state.entered).not.toContain('france-tour');
    expect(state.entered).not.toContain('hill-cup');
    expect(adoptCalendar(state)).toBe(false);
  });

  it('keeps an unticked race off the calendar and out of the next race', () => {
    const career = new Career();
    career.create('slorising', 'SLO', 3.4, 3.8, 4.3);
    const id = career.nextEntered()!.id;
    career.setEnter(id, false);
    expect(career.state!.entered).not.toContain(id);
    expect(career.state!.declined).toContain(id);
    adoptCalendar(career.state!);
    expect(career.state!.entered).not.toContain(id);
    expect(career.nextEntered()?.id).not.toBe(id);
  });

  it('keeps every stage the player rides, and the final classification of the race', () => {
    const career = new Career();
    career.create('slorising', 'SLO', 3.4, 3.8, 4.3);
    career.state!.active = {
      raceId: 'opening-classic',
      stageIndex: 0,
      gc: [],
      sprint: [],
      kom: [],
      stageWinners: [],
    };
    const row = (riderId: string, name: string, time: number, isPlayer = false) => ({
      riderId, name, teamId: 'slorising', country: 'SLO', age: 24, time, sprint: 0, kom: 0, isPlayer,
    });
    career.commit([row('other', 'A. Rider', 90), row('player', 'You', 100, true)]);
    expect(career.state!.stageNotes?.[0]).toMatchObject({ race: 'Opening Classic', place: 2, time: 100 });
    const saved = career.state!.races.find((race) => race.raceId === 'opening-classic');
    expect(saved?.time?.[0].riderId).toBe('other');
    expect(saved?.time?.[1].riderId).toBe('player');
    expect(saved?.time?.[1].value).toBe(100);
    expect(saved?.sprint?.map((row) => row.value)).toEqual([40, 30]);
    expect(saved?.mountains ?? []).toEqual([]);
  });

  it('pays a one-day climb at the finish for both sprint and mountains', () => {
    const career = new Career();
    career.create('slorising', 'SLO', 3.4, 3.8, 4.3);
    career.state!.active = {
      raceId: 'dike-race',
      stageIndex: 0,
      gc: [],
      sprint: [],
      kom: [],
      stageWinners: [],
    };
    const row = (riderId: string, name: string, time: number, isPlayer = false) => ({
      riderId, name, teamId: 'slorising', country: 'SLO', age: 24, time, sprint: 12, kom: 10, isPlayer,
    });
    career.commit([row('other', 'A. Rider', 90), row('player', 'You', 100, true)]);
    const saved = career.state!.races.find((race) => race.raceId === 'dike-race');
    expect(saved?.sprint?.map((line) => [line.riderId, line.value])).toEqual([['other', 40], ['player', 30]]);
    expect(saved?.mountains?.map((line) => [line.riderId, line.value])).toEqual([['other', 40], ['player', 30]]);
  });

  it('shows January and lets several races share a day, with the rider entered in only one', () => {
    expect(monthsFor('continental', 2026)[0]).toBe(1);
    const seen = new Map<string, string[]>();
    for (const race of RACES) {
      for (const slot of raceDays(race, 2026)) {
        const key = `${slot.month}-${slot.day}`;
        const list = seen.get(key) ?? [];
        list.push(race.name);
        seen.set(key, list);
      }
    }
    expect([...seen.values()].some((list) => list.length > 1)).toBe(true);
    const career = new Career();
    career.create('slorising', 'SLO', 3.4, 3.8, 4.3);
    const days = new Map<string, string>();
    for (const id of career.state!.entered) {
      const race = raceById(id)!;
      for (const slot of raceDays(race, 2026)) {
        const key = `${slot.month}-${slot.day}`;
        expect(days.has(key), `${race.name} and ${days.get(key)}`).toBe(false);
        days.set(key, race.name);
      }
    }
    expect(career.state!.entered).toContain('opening-classic');
    expect(career.state!.entered).not.toContain('gulf-classic');
    expect(career.state!.entered).toContain('south-week');
    expect(career.state!.entered).not.toContain('vineyard-day');
    career.toggleEnter('vineyard-day');
    expect(career.state!.entered).toContain('vineyard-day');
    expect(career.state!.entered).not.toContain('south-week');
  });

  it('mixes nationalities, with World Tour squads more mixed than Continental ones', () => {
    for (const team of TEAMS) {
      const counts = new Map<string, number>();
      for (const rider of ridersOf(team.id)) counts.set(rider.country, (counts.get(rider.country) ?? 0) + 1);
      const home = counts.get(team.nation) ?? 0;
      const biggest = Math.max(...counts.values());
      const countries = counts.size;
      if (team.division === 'world') {
        expect(biggest, team.name).toBeLessThanOrEqual(5);
        expect(countries, team.name).toBeGreaterThanOrEqual(8);
      } else if (team.division === 'continental') {
        expect(home, team.name).toBeGreaterThanOrEqual(6);
        expect(home, team.name).toBe(biggest);
      }
    }
  });

  it('starts the teams that suit the finish at the front', () => {
    const route = getRoute(getRouteDef('lowlands'));
    const start = route.sectionStart[1] + 30;
    const rider = (id: string, team: string, sprint: number, mountain: number) => {
      const body: RoadBody = {
        riderId: id, teamId: team, age: 27, teammate: false,
        attrs: { ...attrs(60), sprint, mountain, flat: sprint },
        kit: DEFAULT_COLORS,
      };
      return { name: id, country: 'FRA', team, mass: 72, colors: DEFAULT_COLORS, body };
    };
    const field = [
      rider('climber', 'climb', 55, 92),
      rider('climber-2', 'climb', 50, 84),
      rider('sprinter', 'sprint', 90, 48),
      rider('helper', 'sprint', 78, 46),
    ];
    const road = {
      flatWkg: 3.4, hillWkg: 4, mountainWkg: 4.4, oneDay: true, timeTrial: false,
      startS: start, finishS: start + 8000, lastClimbS: null, finishKind: 'sprint' as const, tactic: 'sprint' as const, features: [],
    };
    const ride = (finishKind: 'sprint' | 'mountain') => {
      const sim = new RideSim(route, {
        startS: start, finishS: start + 8000, aiCount: 0, seed: 2,
        road: { ...road, finishKind }, roadField: field,
        player: { name: 'Me', massKg: 72, ftp: 250, colors: DEFAULT_COLORS },
      });
      sim.started = true;
      for (let t = 0; t < 150; t += 0.2) sim.step(0.2, 250, 90);
      return sim;
    };
    const nose = (sim: RideSim) => [...sim.racers].filter((r) => !r.isPlayer && r.mode !== 'attack').sort((a, b) => b.s - a.s)[0]?.road?.teamId;
    expect(nose(ride('sprint'))).toBe('sprint');
    expect(nose(ride('mountain'))).toBe('climb');
  });

  it('waits for teammates to reach the front before the group takes their pace', () => {
    const route = getRoute(getRouteDef('lowlands'));
    const start = route.sectionStart[1] + 400;
    const body = (id: string, teammate: boolean): RoadBody => ({
      riderId: id, teamId: 'sprint', age: 27, teammate,
      attrs: { ...attrs(74), sprint: 80, flat: 76 },
      kit: DEFAULT_COLORS,
    });
    const field = [body('mate', true), body('a', false), body('b', false)].map((item) => ({
      name: item.riderId, country: 'FRA', team: 'Sprint', mass: 74, colors: DEFAULT_COLORS, body: item,
    }));
    const sim = new RideSim(route, {
      startS: start, finishS: start + 8000, aiCount: 0, seed: 4,
      road: {
        flatWkg: 2.2, hillWkg: 3, mountainWkg: 3.6, oneDay: true, timeTrial: false,
        startS: start, finishS: start + 8000, lastClimbS: null, firstClimbS: start, finishKind: 'sprint', tactic: 'control', features: [],
      },
      roadField: field,
      player: { name: 'Me', massKg: 74, ftp: 163, colors: DEFAULT_COLORS },
    });
    sim.started = true;
    for (let t = 0; t < 90; t += 0.05) sim.step(0.05, 160, 85);
    const mate = sim.racers.find((r) => r.road?.riderId === 'mate')!;
    const others = sim.racers.filter((r) => r.road && !r.road.teammate);
    mate.s = Math.min(...others.map((r) => r.s)) - 8;
    sim.manual = true;
    sim.paceOn = true;
    sim.paceWkg = 4.2;
    for (let t = 0; t < 2; t += 0.05) sim.step(0.05, 160, 85);
    const bunch = others.reduce((sum, r) => sum + r.v, 0) / others.length;
    expect(mate.v).toBeGreaterThan(bunch + 0.35);
    expect(mate.s).toBeLessThan(Math.min(...others.map((r) => r.s)));
    mate.s = Math.max(...others.map((r) => r.s)) + 6;
    for (let t = 0; t < 6; t += 0.05) sim.step(0.05, 160, 85);
    const lifted = others.reduce((sum, r) => sum + r.v, 0) / others.length;
    expect(lifted).toBeGreaterThan(bunch + 1.2);
  });

  it('spends stamina in the wind and holds it in the wheels', () => {
    const mid = { stamina: 70, endurance: 70, recovery: 70 };
    const frail = { stamina: 48, endurance: 50, recovery: 44 };
    let wind = 1;
    let wheels = 1;
    let weak = 1;
    for (let t = 0; t < 600; t += 1) {
      wind = tickEnergy(wind, mid, 2.2, 2.2, 'front', 1);
      wheels = tickEnergy(wheels, mid, 2.2, 2.2, 'draft', 1);
      weak = tickEnergy(weak, frail, 2.2, 2.2, 'break', 1);
    }
    expect(wind).toBeCloseTo(0.6, 2);
    expect(wheels).toBe(1);
    expect(weak).toBeLessThan(wind - 0.1);
    let rested = 0.5;
    for (let t = 0; t < 300; t += 1) rested = tickEnergy(rested, mid, 1.1, 2.2, 'draft', 1);
    expect(rested).toBeCloseTo(0.65, 2);
  });

  it('lets a fresh break keep a small edge and a tired break fall under the pace', () => {
    expect(breakFactor(0.9)).toBe(1.04);
    expect(breakFactor(0.6)).toBeCloseTo(1.02, 2);
    expect(breakFactor(0.3)).toBeCloseTo(0.93, 2);
    expect(breakFactor(0.1)).toBe(0.84);
    const plan: RoadPlan = {
      flatWkg: 2.2, hillWkg: 3, mountainWkg: 3.6, oneDay: false, timeTrial: false,
      startS: 0, finishS: 18000, lastClimbS: null, finishKind: 'sprint', tactic: 'control', features: [],
    };
    const rider = (energy: number): RoadActor => ({
      id: 1, name: 'Break', isPlayer: false, s: 4000, lat: 1, v: 8, mass: 70,
      bike: { mass: 78, cda: 0.32, crr: 0.004 },
      mode: 'attack', targetPower: 0, finishTime: null, officialTime: null,
      sprintPts: 0, komPts: 0, told: true, phase: 90,
      road: {
        riderId: 'break', teamId: 'sprint', age: 27, teammate: false,
        attrs: attrs(60), kit: DEFAULT_COLORS,
      },
      energy,
    });
    const orders = { paceOn: false, paceWkg: 2.2, waitOn: false, manual: false };
    const fresh = rider(0.9);
    const tired = rider(0.1);
    decideRoad(fresh, plan, orders, 0, [fresh], []);
    decideRoad(tired, plan, orders, 0, [tired], []);
    expect(fresh.mode).toBe('attack');
    expect(fresh.targetPower / fresh.mass).toBeCloseTo(2.2 * 1.04, 2);
    expect(tired.targetPower / tired.mass).toBeCloseTo(2.2 * 0.84, 2);
  });

  it('lifts a flat sprint in steps and leaves a hill finish on the slider', () => {
    const sprint: RoadPlan = {
      flatWkg: 2.2, hillWkg: 3, mountainWkg: 3.6, oneDay: false, timeTrial: false,
      startS: 0, finishS: 18200, lastClimbS: null, finishKind: 'sprint', tactic: 'sprint', features: [],
    };
    const hill: RoadPlan = { ...sprint, finishKind: 'hill', finishS: 21000, lastClimbS: 18000 };
    expect(flatRunIn(sprint, 7000, 0, 0)).toBe(1);
    expect(flatRunIn(sprint, 7000, 20, 0)).toBe(1.04);
    expect(flatRunIn(sprint, 5000, 0, 0)).toBe(1.05);
    expect(flatRunIn(sprint, 2000, 0, 0)).toBe(1.08);
    expect(flatRunIn(sprint, 500, 30, 0)).toBe(1.1);
    expect(flatRunIn(sprint, 500, 30, 0.04)).toBe(1);
    expect(flatRunIn(hill, 500, 30, 0)).toBe(1);
  });

  it('rolls the bunch up to the set pace instead of jumping there', () => {
    const route = getRoute(getRouteDef('lowlands'));
    const start = route.sectionStart[1] + 30;
    const body: RoadBody = {
      riderId: 'helper', teamId: 'sprint', age: 27, teammate: false,
      attrs: { ...attrs(70), sprint: 80, flat: 74 },
      kit: DEFAULT_COLORS,
    };
    const sim = new RideSim(route, {
      startS: start, finishS: start + 8000, aiCount: 0, seed: 1,
      road: {
        flatWkg: 2.2, hillWkg: 3, mountainWkg: 3.6, oneDay: true, timeTrial: false,
        startS: start, finishS: start + 8000, lastClimbS: null, finishKind: 'sprint', tactic: 'control', features: [],
      },
      roadField: [{ name: 'helper', country: 'FRA', team: 'Sprint', mass: 74, colors: DEFAULT_COLORS, body }],
      player: { name: 'Me', massKg: 74, ftp: 163, colors: DEFAULT_COLORS },
    });
    sim.started = true;
    const fastest = () => Math.max(...sim.racers.filter((r) => !r.isPlayer).map((r) => r.v));
    for (let t = 0; t < 2; t += 0.05) sim.step(0.05, 160, 85);
    expect(fastest()).toBeLessThan(2.5);
    for (let t = 0; t < 22; t += 0.05) sim.step(0.05, 160, 85);
    expect(fastest()).toBeGreaterThan(6);
  });

  it('opens a gap when the best climbers attack', () => {
    const route = getRoute(getRouteDef('argent'));
    const climb = route.climbs.find((item) => item.id === 'arg-lune')!;
    const start = climb.start + 150;
    const climber = (id: string, mountain: number) => {
      const body: RoadBody = {
        riderId: id, teamId: 'hive', age: 27, teammate: false,
        attrs: { ...attrs(70), mountain, medium: mountain - 4, hills: mountain - 8 },
        kit: DEFAULT_COLORS,
      };
      return { name: id, country: 'FRA', team: 'Hive', mass: 64, colors: DEFAULT_COLORS, body };
    };
    const sim = new RideSim(route, {
      startS: start,
      finishS: climb.end,
      aiCount: 0,
      seed: 5,
      road: {
        flatWkg: 3.6, hillWkg: 4, mountainWkg: 4.6, oneDay: true, timeTrial: false,
        startS: start, finishS: climb.end, lastClimbS: climb.start, finishKind: 'mountain', tactic: 'climb', features: [],
      },
      roadField: [climber('star', 90), climber('star-2', 88), climber('dom', 62), climber('dom-2', 60)],
      player: { name: 'Me', massKg: 68, ftp: 280, colors: DEFAULT_COLORS },
    });
    sim.started = true;
    for (let t = 0; t < 150; t += 0.2) sim.step(0.2, 300, 85);
    const star = sim.racers.find((r) => r.road?.riderId === 'star')!;
    const dom = sim.racers.find((r) => r.road?.riderId === 'dom')!;
    expect(star.s - dom.s).toBeGreaterThan(40);
    expect(sim.events.some((text) => text.includes('attacks'))).toBe(true);
  });

  it('keeps the bunch together at the pace the player set', () => {
    const route = getRoute(getRouteDef('lowlands'));
    const start = route.sectionStart[1] + 30;
    const field = [
      ...Array.from({ length: 8 }, (_, i) => starter(`strong-${i}`, 82)),
      starter('weak', 52),
    ];
    const sim = new RideSim(route, {
      startS: start,
      finishS: start + 6000,
      aiCount: 0,
      seed: 3,
      road: {
        flatWkg: 3.6, hillWkg: 4, mountainWkg: 4.4, oneDay: false, timeTrial: false,
        startS: start, finishS: start + 6000, lastClimbS: null, firstClimbS: start, finishKind: 'sprint', tactic: 'control', features: [],
      },
      roadField: field,
      player: { name: 'Me', massKg: 72, ftp: 260, colors: DEFAULT_COLORS },
    });
    sim.started = true;
    for (let t = 0; t < 180; t += 0.2) sim.step(0.2, 260, 90);
    const strong = sim.racers.filter((r) => r.road && r.road.attrs.flat > 70);
    const weak = sim.racers.find((r) => r.road?.riderId === 'weak')!;
    const spread = Math.max(...strong.map((r) => r.s)) - Math.min(...strong.map((r) => r.s));
    expect(spread).toBeLessThan(50);
    expect(Math.max(...strong.map((r) => r.s)) - weak.s).toBeLessThan(40);
  });
});

describe('career results', () => {
  it('orders a simulated race by the race, never by name, even when the bunch shares a time', () => {
    for (const race of RACES.filter((item) => item.stages.length === 1 && item.level !== 'champ')) {
      const sim = simulateRace(race, 2026, 'SLO');
      const top = sim.overall.slice(0, 15).map((row) => row.name);
      const byName = sim.overall.map((row) => row.name).sort((a, b) => a.localeCompare(b)).slice(0, 15);
      expect(top, `${race.name} came out in name order`).not.toEqual(byName);
      // A bunch finish gives many riders one time; they keep the order they crossed the line.
      const shared = sim.overall.filter((row) => row.time === sim.overall[0].time);
      if (shared.length > 3) expect(shared.map((row) => row.name)).not.toEqual([...shared.map((row) => row.name)].sort((a, b) => a.localeCompare(b)));
    }
  });

  const row = (riderId: string, name: string, time: number, isPlayer = false) => ({
    riderId, name, teamId: 'atlas', country: 'FRA', age: 27, time, sprint: 0, kom: 0, isPlayer,
  });

  it('gives a shared bunch time to the rider who crossed first, not the first name', () => {
    const career = new Career();
    career.create('slorising', 'SLO', 3.4, 3.8, 4.3);
    career.openBrief();
    const active = career.state!.active!;
    const race = raceById(active.raceId)!;
    career.commit([row('zed', 'Z. Zorn', 100), row('abe', 'A. Abel', 100), row('player', 'You', 100, true)]);
    const winner = race.stages.length > 1 ? career.state!.active!.stageWinners[0].riderId : career.state!.races.at(-1)!.winnerId;
    expect(winner).toBe('zed');
  });

  it('splits equal overall times on stage places, not on names', () => {
    const one = mergeTime([], [row('b', 'B', 100), row('a', 'A', 100), row('c', 'C', 100)]);
    expect(one.map((r) => r.riderId)).toEqual(['b', 'a', 'c']);
    const two = mergeTime(one, [row('c', 'C', 50), row('a', 'A', 50), row('b', 'B', 50)], 1);
    // b: 1 + 3, a: 2 + 2, c: 3 + 1. All on 4, so the earlier order stands.
    expect(two.map((r) => r.riderId)).toEqual(['b', 'a', 'c']);
    const three = mergeTime(two, [row('a', 'A', 50), row('c', 'C', 50), row('b', 'B', 50)], 2);
    expect(three.map((r) => r.riderId)).toEqual(['a', 'c', 'b']);
  });

  it('pays mountain points on every profile climb whose summit is on the stage', () => {
    // Starts before the stage, top inside: listed and scored. Top past the finish: listed, not scored.
    expect(climbOnStage({ start: 900, end: 1600 }, 1000, 5000)).toBe(true);
    expect(climbScoresOnStage({ start: 900, end: 1600 }, 1000, 5000)).toBe(true);
    expect(climbOnStage({ start: 4500, end: 5400 }, 1000, 5000)).toBe(true);
    expect(climbScoresOnStage({ start: 4500, end: 5400 }, 1000, 5000)).toBe(false);
    expect(climbScoresOnStage({ start: 4500, end: 5040 }, 1000, 5000)).toBe(true);
    for (const race of RACES) {
      for (const stage of race.stages) {
        const window = stageWindow(stage);
        if (window.kind !== 'road') continue;
        const scored = stagePrimes(stage).filter((p) => p.kind === 'kom').map((p) => p.name);
        const summits = window.climbs.filter((c) => c.atKm <= window.km + 0.05).map((c) => c.name);
        expect(scored).toEqual(summits);
        for (const prime of stagePrimes(stage)) expect(prime.at).toBeLessThanOrEqual(1);
      }
    }
  });

  it('moves on to the next place when a place is worth no points', () => {
    const feature: RoadFeature = { s: 100, kind: 'kom', name: 'Col', points: [5, 0, 2], awarded: false, scored: [], doneAt: null };
    const plan = { features: [feature], startS: 0, finishS: 1000, dir: 1 } as unknown as RoadPlan;
    const rider = (id: number, s: number) => ({ id, name: `R${id}`, s, sprintPts: 0, komPts: 0 }) as unknown as RoadActor;
    const field = [rider(1, 103), rider(2, 102), rider(3, 101), rider(4, 50)];
    awardRoadFeatures(field, plan, []);
    expect(feature.scored.map((row) => [row.id, row.pts])).toEqual([[1, 5], [2, 0], [3, 2]]);
    expect(field.map((r) => r.komPts)).toEqual([5, 0, 2, 0]);
    expect(feature.awarded).toBe(true);
  });

  it('drops a rider who missed a stage from the overall time', () => {
    const one = mergeTime([], [row('a', 'A', 100), row('b', 'B', 130), row('c', 'C', 160)]);
    // b did not finish stage 2, so their 130 s must not lead a GC of 180 s totals.
    const two = mergeTime(one, [row('a', 'A', 80), row('c', 'C', 90), row('new', 'N', 60)], 1);
    expect(two.map((r) => r.riderId)).toEqual(['a', 'c']);
    expect(two[0].stages).toBe(2);
    // An older save without stage counts keeps everyone it listed.
    const old = one.map(({ stages: _stages, ...rest }) => rest);
    expect(mergeTime(old, [row('a', 'A', 1), row('b', 'B', 1), row('c', 'C', 1)], 3).map((r) => r.riderId)).toEqual(['a', 'b', 'c']);
  });

  it('keeps the crossing order inside a simulated bunch', () => {
    const race = RACES.find((r) => r.stages.length === 1 && stageSegment(r.stages[0]).finish === 'sprint')!;
    const sim = simulateRace(race, 2026, 'SLO');
    const lead = sim.overall[0].time;
    const bunch = sim.overall.filter((r) => r.time === lead);
    expect(bunch.length).toBeGreaterThan(10);
    const names = bunch.map((r) => r.name);
    expect(names).not.toEqual([...names].sort((a, b) => a.localeCompare(b)));
    expect(sim.overall[0].riderId).toBe(sim.stages[0].rows[0].riderId);
  });
});

describe('career time trials', () => {
  it('times each rider from their own start, so a later starter does not ride further', () => {
    const route = getRoute(getRouteDef('lowlands'));
    const start = route.sectionStart[1] + 30;
    const finish = start + 1500;
    const field = Array.from({ length: 8 }, (_, i) => starter(`tt-${i}`, 76));
    const sim = new RideSim(route, {
      startS: start,
      finishS: finish,
      aiCount: 0,
      seed: 5,
      road: {
        flatWkg: 3.6, hillWkg: 4, mountainWkg: 4.4, oneDay: false, timeTrial: true,
        startS: start, finishS: finish, lastClimbS: null, firstClimbS: null, finishKind: 'sprint', tactic: 'control', features: [],
      },
      roadField: field,
      player: { name: 'Me', massKg: 72, ftp: 260, colors: DEFAULT_COLORS },
    });
    sim.started = true;
    for (let t = 0; t < 900 && sim.racers.some((r) => !r.isPlayer && r.finishTime == null); t += 0.25) sim.step(0.25, 260, 90);
    const ai = sim.racers.filter((r) => !r.isPlayer);
    expect(ai.every((r) => r.finishTime != null)).toBe(true);
    // Riders leave the ramp one by one; finishTime is already their own clock.
    const gross = ai.map((r) => r.finishTime! + r.ttStart);
    const net = ai.map((r) => r.officialTime!);
    // Same riders: the clock from the gun spreads them by start slot, the clock from their own start does not.
    expect(Math.max(...gross) - Math.min(...gross)).toBeGreaterThan(5);
    expect(Math.max(...net) - Math.min(...net)).toBeLessThan(0.5);
    ai.forEach((r) => expect(r.officialTime).toBeCloseTo(r.finishTime!, 6));
  });
});

describe('career fast-forward', () => {
  it('lets teammates ride to the line instead of waiting for a parked player', () => {
    const route = getRoute(getRouteDef('lowlands'));
    const start = route.sectionStart[1] + 30;
    const finish = start + 1500;
    const field = Array.from({ length: 8 }, (_, i) => {
      const rider = starter(`ff-${i}`, 76);
      rider.body.teammate = i < 4;
      return rider;
    });
    const sim = new RideSim(route, {
      startS: start,
      finishS: finish,
      aiCount: 0,
      seed: 6,
      road: {
        flatWkg: 3.6, hillWkg: 4, mountainWkg: 4.4, oneDay: false, timeTrial: false,
        startS: start, finishS: finish, lastClimbS: null, firstClimbS: null, finishKind: 'sprint', tactic: 'control', features: [],
      },
      roadField: field,
      player: { name: 'Me', massKg: 72, ftp: 260, colors: DEFAULT_COLORS },
    });
    sim.started = true;
    sim.manual = true;
    sim.waitOn = true;
    for (let t = 0; t < 30; t += 0.5) sim.step(0.5, 200, 90);
    sim.simulateToEnd();
    const ai = sim.racers.filter((r) => !r.isPlayer);
    expect(ai.every((r) => r.finishTime != null)).toBe(true);
    // 1.5 km at racing speed. Held to a crawl beside the parked player it took over 800 s.
    expect(Math.max(...ai.map((r) => r.finishTime!))).toBeLessThan(400);
    expect(sim.roadOrders().released).toBe(false);
  });
});

describe('career pack shape', () => {
  it('keeps a file a bike length apart and riders in their own lane', () => {
    const route = getRoute(getRouteDef('lowlands'));
    const start = route.sectionStart[1] + 30;
    const finish = start + 8000;
    const field = Array.from({ length: 36 }, (_, i) => starter(`pk-${i}`, 66 + (i * 7) % 17));
    const sim = new RideSim(route, {
      startS: start,
      finishS: finish,
      aiCount: 0,
      seed: 8,
      road: {
        flatWkg: 3.4, hillWkg: 3.8, mountainWkg: 4.2, oneDay: false, timeTrial: false,
        startS: start, finishS: finish, lastClimbS: null, firstClimbS: null, finishKind: 'sprint', tactic: 'control', features: [],
      },
      roadField: field,
      player: { name: 'Me', massKg: 72, ftp: 250, colors: DEFAULT_COLORS },
    });
    sim.started = true;
    const ai = sim.racers.filter((r) => !r.isPlayer);
    let overlaps = 0;
    let samples = 0;
    let moves = 0;
    let lanes = ai.map((r) => r.homeLat);
    for (let k = 0; k < 600; k++) {
      sim.step(0.2, 250, 90);
      moves += ai.filter((r, i) => Math.abs(r.homeLat - lanes[i]) > 0.05).length;
      lanes = ai.map((r) => r.homeLat);
      if (k < 150 || k % 10 !== 0) continue;
      samples++;
      for (let i = 0; i < ai.length; i++) {
        for (let j = i + 1; j < ai.length; j++) {
          const a = ai[i];
          const b = ai[j];
          if (a.mode === 'attack' || b.mode === 'attack') continue;
          if (Math.abs(a.s - b.s) < 1.7 && Math.abs(a.lat - b.lat) < 0.45) overlaps++;
        }
      }
    }
    const pack = ai.filter((r) => r.mode !== 'attack').map((r) => r.s);
    console.log(`overlaps ${overlaps} in ${samples} samples, lane moves ${moves}, pack ${(Math.max(...pack) - Math.min(...pack)).toFixed(1)} m`);
    expect(overlaps / samples).toBeLessThan(0.5);
    // Riders settle into lanes; they do not hop every time the order changes.
    expect(moves).toBeLessThan(ai.length);
  });
});
