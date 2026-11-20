import { CLIMBERS } from '../ai/climbers';
import type { RaceAttrs } from '../ai/road';
import { mulberry32 } from '../util/math';
import { SURNAMES } from './surnames';
import { ROSTER_SIZE, TEAMS, teamById, type TeamDef } from './teams';
import type { Program } from './types';

export interface Rider {
  id: string;
  first: string;
  last: string;
  country: string;
  teamId: string;
  age: number;
  mass: number;
  program: Program;
  attrs: RaceAttrs;
  star: boolean;
}

export function riderName(r: Pick<Rider, 'first' | 'last'>): string {
  return `${r.first.charAt(0).toLocaleUpperCase('en-US')}. ${r.last}`;
}

interface NationPool {
  code: string;
  first: string[];
  last: string[];
}

const NAMES: NationPool[] = [
  { code: 'SLO', first: ['Tadej', 'Luka', 'Matej', 'Jan', 'Anze', 'Domen'], last: ['Novarik', 'Kranjec', 'Oblak', 'Zajc', 'Potocnik', 'Vidmar', 'Rozman'] },
  { code: 'DEN', first: ['Jonas', 'Mads', 'Magnus', 'Kasper', 'Mikkel', 'Anders'], last: ['Vinter', 'Skovlund', 'Holm', 'Dalgaard', 'Moller', 'Friis', 'Bak'] },
  { code: 'BEL', first: ['Remi', 'Wout', 'Jonathan', 'Tim', 'Arnaud', 'Yves', 'Seppe'], last: ['Evrault', 'van Aerde', 'Delaere', 'Merlo', 'Delacroix', 'Wouters', 'Goossens', 'Claes'] },
  { code: 'FRA', first: ['Paul', 'Romain', 'Bryan', 'Julien', 'Lenny', 'Valentin', 'Kevin'], last: ['Seigner', 'Gregand', 'Coquell', 'Morel', 'Durant', 'Lefort', 'Roux', 'Barbier'] },
  { code: 'ESP', first: ['Enric', 'Pello', 'Juan', 'Carlos', 'Mikel', 'Alex'], last: ['Masden', 'Rogov', 'Landaz', 'Navarro', 'Solano', 'Ibanez', 'Cruz'] },
  { code: 'ITA', first: ['Filippo', 'Giulio', 'Davide', 'Jason', 'Lorenzo', 'Matteo'], last: ['Gannotto', 'Milani', 'Cicorelli', 'Conti', 'Ferrari', 'Rinaldi', 'Greco'] },
  { code: 'GBR', first: ['Tom', 'Adam', 'Oscar', 'Simon', 'Ethan', 'Josh'], last: ['Pidmar', 'Yarrow', 'Walker', 'Clarke', 'Hughes', 'Bennett'] },
  { code: 'NOR', first: ['Tobias', 'Anders', 'Soren', 'Markus', 'Even'], last: ['Johansen', 'Lekneson', 'Hauge', 'Berge', 'Nilsen'] },
  { code: 'NED', first: ['Mathis', 'Dylan', 'Olav', 'Sam', 'Lars'], last: ['Poelman', 'de Wit', 'Bakker', 'Visser', 'Smit'] },
  { code: 'USA', first: ['Matteo', 'Sepp', 'Neil', 'Brandon', 'Quinn'], last: ['Jorgen', 'Kuster', 'Powel', 'McNair', 'Simmons'] },
  { code: 'AUS', first: ['Jai', 'Ben', 'Luke', 'Michael', 'Jack'], last: ['Hindon', 'Oconnell', 'Storer', 'Plummer', 'Matthews'] },
  { code: 'COL', first: ['Harold', 'Santiago', 'Daniel', 'Esteban'], last: ['Montes', 'Buitrago', 'Lopez', 'Higuita'] },
  { code: 'GER', first: ['Florian', 'Max', 'Nils', 'Leon'], last: ['Lipov', 'Keller', 'Braun', 'Schmitt'] },
  { code: 'SUI', first: ['Marc', 'Stefan', 'Gino', 'Silvan'], last: ['Hirzel', 'Kung', 'Mader', 'Dillier'] },
  { code: 'POR', first: ['Joao', 'Ruben', 'Antonio'], last: ['Almeida', 'Guerreiro', 'Silva'] },
  { code: 'MEX', first: ['Isaac', 'Pablo'], last: ['Vallarta', 'Reyes'] },
  { code: 'AUT', first: ['Felix', 'Patrick', 'Marco'], last: ['Galler', 'Konrad', 'Binder'] },
  { code: 'ECU', first: ['Richard', 'Jonathan'], last: ['Carvajo', 'Narvaez'] },
  { code: 'IRL', first: ['Ben', 'Eddie'], last: ['Healy', 'Dunne'] },
  { code: 'CZE', first: ['Josef', 'Adam', 'Tomas', 'Jakub'], last: ['Cerny', 'Novak', 'Svoboda', 'Horak'] },
  { code: 'ISR', first: ['Omer', 'Guy', 'Itamar', 'Nadav'], last: ['Benari', 'Levi', 'Cohen', 'Peretz'] },
];

function fill(base: number, peak: Partial<RaceAttrs>): RaceAttrs {
  const n = (key: keyof RaceAttrs) => peak[key] ?? base;
  return {
    flat: n('flat'), hills: n('hills'), medium: n('medium'), mountain: n('mountain'), tt: n('tt'),
    sprint: n('sprint'), recovery: n('recovery'), endurance: n('endurance'), stamina: n('stamina'),
  };
}

/** PCM-style bands. A specialty sits at the top of the band. A weakness sits at the bottom. */
function bandOf(division: TeamDef['division']): { lo: number; hi: number } {
  if (division === 'world') return { lo: 70, hi: 90 };
  if (division === 'pro') return { lo: 60, hi: 75 };
  return { lo: 50, hi: 70 };
}

function pick(lo: number, hi: number, rng: () => number): number {
  return lo + Math.floor(rng() * (Math.max(lo, hi) - lo + 1));
}

/** `from` and `to` are fractions of the division band. */
function zone(lo: number, hi: number, from: number, to: number, rng: () => number): number {
  const span = hi - lo;
  const a = lo + Math.round(span * from);
  const b = lo + Math.round(span * to);
  return pick(Math.min(a, b), Math.min(hi, Math.max(a, b)), rng);
}

interface StarSpec {
  team: string;
  first: string;
  last: string;
  country: string;
  age: number;
  mass: number;
  program: Program;
  base: number;
  peak: Partial<RaceAttrs>;
}

const STARS: StarSpec[] = [
  // The rare complete rider. High in several things, and still not a sprinter.
  { team: 'atlas', first: 'Tadej', last: 'Novarik', country: 'SLO', age: 25, mass: 66, program: 'gc', base: 74, peak: { mountain: 90, medium: 88, hills: 84, tt: 86, flat: 80, endurance: 88, stamina: 86, recovery: 84 } },
  { team: 'atlas', first: 'Isaac', last: 'Vallarta', country: 'MEX', age: 22, mass: 64, program: 'gc', base: 72, peak: { mountain: 86, medium: 83, hills: 78, tt: 76, flat: 73, endurance: 82, stamina: 80 } },
  { team: 'hive', first: 'Jonas', last: 'Vinter', country: 'DEN', age: 29, mass: 64, program: 'gc', base: 73, peak: { mountain: 86, medium: 84, tt: 84, hills: 76, flat: 74, endurance: 86, stamina: 85, recovery: 82 } },
  { team: 'hive', first: 'Matteo', last: 'Jorgen', country: 'USA', age: 26, mass: 67, program: 'hill', base: 73, peak: { medium: 84, mountain: 78, hills: 80, flat: 76, tt: 74 } },
  { team: 'bullion', first: 'Remi', last: 'Evrault', country: 'BEL', age: 26, mass: 69, program: 'classic', base: 74, peak: { hills: 86, sprint: 82, flat: 81, mountain: 78, medium: 80, tt: 76, endurance: 80 } },
  { team: 'marine', first: 'Paul', last: 'Seigner', country: 'FRA', age: 23, mass: 67, program: 'gc', base: 72, peak: { mountain: 86, medium: 83, hills: 78, tt: 76, flat: 73, endurance: 83, stamina: 81 } },
  { team: 'northfuel', first: 'Tobias', last: 'Johansen', country: 'NOR', age: 27, mass: 68, program: 'gc', base: 72, peak: { mountain: 86, medium: 82, tt: 78, hills: 76, flat: 73 } },
  { team: 'crimson', first: 'Jonathan', last: 'Delaere', country: 'BEL', age: 28, mass: 78, program: 'sprint', base: 71, peak: { sprint: 90, flat: 86, hills: 73, mountain: 71, medium: 72, recovery: 82, stamina: 74 } },
  { team: 'ivory', first: 'Mathis', last: 'Poelman', country: 'NED', age: 27, mass: 75, program: 'classic', base: 74, peak: { hills: 88, sprint: 82, flat: 82, mountain: 77, medium: 79, recovery: 84 } },
  { team: 'cobalt', first: 'Wout', last: 'van Aerde', country: 'BEL', age: 32, mass: 78, program: 'classic', base: 74, peak: { hills: 86, sprint: 84, flat: 84, mountain: 76, tt: 78, recovery: 82 } },
  { team: 'pinkedu', first: 'Tom', last: 'Pidmar', country: 'GBR', age: 27, mass: 68, program: 'classic', base: 72, peak: { hills: 86, flat: 80, mountain: 76, medium: 79, sprint: 78 } },
  { team: 'grenat', first: 'Filippo', last: 'Gannotto', country: 'ITA', age: 29, mass: 82, program: 'tt', base: 72, peak: { tt: 88, flat: 84, mountain: 72, hills: 74, sprint: 71 } },
  { team: 'pearl', first: 'Pello', last: 'Rogov', country: 'SLO', age: 36, mass: 65, program: 'gc', base: 72, peak: { mountain: 86, medium: 82, tt: 78, hills: 76, flat: 73 } },
  { team: 'jayline', first: 'Jai', last: 'Hindon', country: 'AUS', age: 29, mass: 67, program: 'gc', base: 72, peak: { mountain: 85, medium: 81, hills: 76, flat: 73, tt: 75 } },
  { team: 'loire', first: 'Romain', last: 'Gregand', country: 'FRA', age: 28, mass: 68, program: 'gc', base: 72, peak: { mountain: 84, medium: 80, hills: 77, flat: 73 } },
  { team: 'movara', first: 'Enric', last: 'Masden', country: 'ESP', age: 31, mass: 64, program: 'gc', base: 72, peak: { mountain: 86, medium: 83, hills: 76, flat: 72, tt: 75 } },
  { team: 'astera', first: 'Harold', last: 'Montes', country: 'COL', age: 28, mass: 64, program: 'gc', base: 72, peak: { mountain: 85, medium: 81, hills: 75, flat: 72 } },
  { team: 'goldhour', first: 'Marc', last: 'Hirzel', country: 'SUI', age: 28, mass: 67, program: 'classic', base: 73, peak: { hills: 85, flat: 80, mountain: 76, medium: 78, sprint: 77 } },
  { team: 'lottosun', first: 'Arnaud', last: 'Delacroix', country: 'BEL', age: 27, mass: 79, program: 'sprint', base: 71, peak: { sprint: 88, flat: 84, hills: 73, mountain: 71, medium: 72 } },
  { team: 'creditrouge', first: 'Bryan', last: 'Coquell', country: 'FRA', age: 33, mass: 70, program: 'sprint', base: 71, peak: { sprint: 86, flat: 83, hills: 74, mountain: 71 } },
  { team: 'malt', first: 'Tim', last: 'Merlo', country: 'BEL', age: 30, mass: 76, program: 'sprint', base: 62, peak: { sprint: 75, flat: 72, hills: 64, mountain: 61, medium: 62 } },
  { team: 'amber', first: 'Jason', last: 'Milani', country: 'ITA', age: 25, mass: 75, program: 'sprint', base: 61, peak: { sprint: 75, flat: 71, hills: 63, mountain: 60 } },
  { team: 'oakfuel', first: 'Anders', last: 'Lekneson', country: 'NOR', age: 26, mass: 66, program: 'gc', base: 62, peak: { mountain: 75, medium: 72, tt: 68, hills: 64, flat: 62 } },
  { team: 'eusko', first: 'Richard', last: 'Carvajo', country: 'ECU', age: 32, mass: 62, program: 'gc', base: 62, peak: { mountain: 75, medium: 72, hills: 65, flat: 61 } },
  { team: 'bullion', first: 'Felix', last: 'Galler', country: 'AUT', age: 27, mass: 66, program: 'hill', base: 73, peak: { medium: 84, hills: 80, mountain: 78, flat: 74 } },
];

function starRider(spec: StarSpec): Rider {
  return {
    id: `${spec.team}-${spec.last.toLowerCase().replace(/[^a-z]/g, '')}`,
    first: spec.first,
    last: spec.last,
    country: spec.country,
    teamId: spec.team,
    age: spec.age,
    mass: spec.mass,
    program: spec.program,
    attrs: fill(spec.base, spec.peak),
    star: true,
  };
}

function bump(team: TeamDef, program: Program, _base: number, rng: () => number): RaceAttrs {
  const { lo, hi } = bandOf(team.division);
  const spec = () => zone(lo, hi, 0.62, team.division === 'world' ? 0.82 : 0.95, rng);
  const fair = () => zone(lo, hi, 0.28, 0.58, rng);
  const weak = () => zone(lo, hi, 0, 0.2, rng);
  const attrs: RaceAttrs = {
    flat: fair(), hills: fair(), medium: fair(), mountain: fair(), tt: fair(), sprint: fair(),
    recovery: fair(), endurance: fair(), stamina: fair(),
  };
  if (program === 'sprint') {
    attrs.sprint = spec();
    attrs.flat = zone(lo, hi, 0.48, 0.74, rng);
    attrs.hills = zone(lo, hi, 0.05, 0.28, rng);
    attrs.mountain = weak();
    attrs.medium = weak();
    attrs.tt = weak();
    attrs.mountain = Math.max(lo, Math.min(attrs.mountain, attrs.sprint - 10));
    attrs.stamina = fair();
    attrs.endurance = fair();
    attrs.recovery = zone(lo, hi, 0.5, 0.78, rng);
  } else if (program === 'gc') {
    attrs.mountain = spec();
    attrs.medium = zone(lo, hi, 0.45, 0.72, rng);
    attrs.hills = fair();
    attrs.tt = fair();
    attrs.flat = weak();
    attrs.sprint = weak();
    attrs.flat = Math.max(lo, Math.min(attrs.flat, attrs.mountain - 8));
    attrs.sprint = Math.max(lo, Math.min(attrs.sprint, attrs.mountain - 10));
    attrs.endurance = zone(lo, hi, 0.45, 0.75, rng);
    attrs.stamina = zone(lo, hi, 0.4, 0.72, rng);
    attrs.recovery = fair();
    // A complete rider is rare, and only near the top of the sport.
    if (team.division === 'world' && rng() < 0.06) {
      attrs.flat = Math.max(lo, Math.min(fair(), attrs.mountain - 8));
      attrs.tt = zone(lo, hi, 0.5, 0.75, rng);
    }
  } else if (program === 'classic') {
    attrs.hills = spec();
    attrs.flat = zone(lo, hi, 0.42, 0.68, rng);
    attrs.mountain = zone(lo, hi, 0.3, 0.55, rng);
    attrs.sprint = zone(lo, hi, 0.4, 0.68, rng);
    attrs.medium = zone(lo, hi, 0.35, 0.62, rng);
    attrs.tt = fair();
    attrs.endurance = fair();
    attrs.stamina = fair();
    attrs.recovery = zone(lo, hi, 0.4, 0.7, rng);
  } else if (program === 'tt') {
    attrs.tt = spec();
    attrs.flat = zone(lo, hi, 0.45, 0.72, rng);
    attrs.mountain = weak();
    attrs.hills = zone(lo, hi, 0.1, 0.35, rng);
    attrs.sprint = weak();
    attrs.medium = weak();
    attrs.endurance = zone(lo, hi, 0.4, 0.7, rng);
    attrs.stamina = fair();
    attrs.recovery = fair();
  } else if (program === 'hill') {
    attrs.medium = spec();
    attrs.hills = zone(lo, hi, 0.4, 0.68, rng);
    attrs.mountain = zone(lo, hi, 0.28, 0.55, rng);
    attrs.flat = zone(lo, hi, 0.12, 0.4, rng);
    attrs.sprint = weak();
    attrs.tt = fair();
    attrs.endurance = fair();
    attrs.stamina = fair();
    attrs.recovery = fair();
  } else {
    attrs.flat = zone(lo, hi, 0.15, 0.45, rng);
    attrs.hills = zone(lo, hi, 0.1, 0.4, rng);
    attrs.medium = zone(lo, hi, 0.08, 0.38, rng);
    attrs.mountain = weak();
    attrs.sprint = weak();
    attrs.tt = weak();
    attrs.endurance = zone(lo, hi, 0.05, 0.35, rng);
    attrs.stamina = zone(lo, hi, 0.05, 0.32, rng);
    attrs.recovery = fair();
  }
  return attrs;
}

const BANNED_LAST = new Set(CLIMBERS.map((r) => r.last.toLocaleLowerCase('en-US')));
/** Star surnames stay with that one rider. */
const reservedLast = new Set<string>();

function surnamesLeft(country: string, used: Set<string>): number {
  const pool = SURNAMES[country] ?? [];
  let left = 0;
  for (const last of pool) {
    const key = last.toLocaleLowerCase('en-US');
    if (!used.has(key) && !reservedLast.has(key) && !BANNED_LAST.has(key)) left += 1;
  }
  return left;
}

/** Surnames kept back so a later home squad can still be mostly local. */
function homeReserve(): Map<string, number> {
  const need = new Map<string, number>();
  for (const team of TEAMS) {
    const cap = team.division === 'world' ? 4 : team.division === 'pro' ? 6 : 8;
    const stars = STARS.filter((spec) => spec.team === team.id && spec.country === team.nation).length;
    need.set(team.nation, (need.get(team.nation) ?? 0) + Math.max(0, cap - stars));
  }
  return need;
}

function chooseCountry(team: TeamDef, squad: Rider[], rng: () => number, used: Set<string>, reserve: Map<string, number>): string {
  const counts = new Map<string, number>();
  for (const rider of squad) counts.set(rider.country, (counts.get(rider.country) ?? 0) + 1);
  const homeCap = team.division === 'world' ? 4 : team.division === 'pro' ? 6 : 8;
  const otherCap = team.division === 'world' ? 2 : team.division === 'pro' ? 3 : 2;
  const homeBias = team.division === 'world' ? 0.14 : team.division === 'pro' ? 0.32 : 0.72;
  const home = team.nation;
  if ((counts.get(home) ?? 0) < homeCap && rng() < homeBias && surnamesLeft(home, used) > 0) return home;
  const options = Object.keys(SURNAMES).filter((code) => {
    const cap = code === home ? homeCap : otherCap;
    if ((counts.get(code) ?? 0) >= cap) return false;
    const left = surnamesLeft(code, used);
    if (left <= 0) return false;
    if (code !== home && left <= (reserve.get(code) ?? 0)) return false;
    return true;
  });
  if (options.length) return options[Math.floor(rng() * options.length)];
  const loose = Object.keys(SURNAMES).filter((code) => {
    const left = surnamesLeft(code, used);
    return left > 0 && (code === home || left > (reserve.get(code) ?? 0));
  });
  const pool = loose.length ? loose : Object.keys(SURNAMES).filter((code) => surnamesLeft(code, used) > 0);
  if (!pool.length) throw new Error(`No surname left for ${team.name}`);
  return pool[Math.floor(rng() * pool.length)];
}

function pickName(rng: () => number, used: Set<string>, country: string): { first: string; last: string; country: string } {
  const nation = NAMES.find((n) => n.code === country) ?? NAMES.find((n) => n.code === 'FRA')!;
  const pool = SURNAMES[country];
  if (!pool) throw new Error(`No surnames for ${country}`);
  const shift = Math.floor(rng() * pool.length);
  for (let i = 0; i < pool.length; i++) {
    const last = pool[(shift + i) % pool.length];
    const key = last.toLocaleLowerCase('en-US');
    if (reservedLast.has(key) || used.has(key) || BANNED_LAST.has(key)) continue;
    const first = nation.first[(shift + i) % nation.first.length];
    const display = `${first.charAt(0)}. ${last}`;
    if (used.has(display)) continue;
    used.add(key);
    used.add(display);
    return { first, last, country: nation.code };
  }
  throw new Error(`No surname left for ${country}`);
}

function build(): Rider[] {
  const riders = STARS.map(starRider);
  const used = new Set<string>();
  for (const rider of riders) {
    const key = rider.last.toLocaleLowerCase('en-US');
    used.add(riderName(rider));
    used.add(key);
    reservedLast.add(key);
  }
  const reserve = homeReserve();
  for (const team of TEAMS) {
    const have = riders.filter((r) => r.teamId === team.id);
    const need = ROSTER_SIZE[team.division] - have.length;
    const rng = mulberry32(team.id.split('').reduce((h, c) => h + c.charCodeAt(0), 1000) * 97);
    const base = team.division === 'world' ? 73 : team.division === 'pro' ? 68 : 63;
    for (let i = 0; i < need; i++) {
      const roll = rng();
      const program: Program = roll < 0.12 ? 'gc' : roll < 0.28 ? 'sprint' : roll < 0.42 ? 'classic' : roll < 0.52 ? 'tt' : roll < 0.66 ? 'hill' : 'helper';
      const name = pickName(rng, used, chooseCountry(team, riders.filter((r) => r.teamId === team.id), rng, used, reserve));
      const climber = program === 'gc';
      riders.push({
        id: `${team.id}-r${i}`,
        ...name,
        teamId: team.id,
        age: 21 + Math.floor(rng() * 13),
        mass: climber ? 61 + Math.floor(rng() * 8) : program === 'sprint' ? 74 + Math.floor(rng() * 8) : 68 + Math.floor(rng() * 8),
        program,
        attrs: bump(team, program, base, rng),
        star: false,
      });
    }
  }
  const star = riders.find((r) => r.last === 'Novarik' && r.country === 'SLO');
  if (star) {
    const overall = (r: Rider) => r.attrs.mountain * 2 + r.attrs.medium + r.attrs.tt + r.attrs.hills * 0.5 + r.attrs.flat * 0.35;
    let bestMountain = 0;
    let bestOverall = 0;
    for (const rider of riders) {
      if (rider === star) continue;
      bestMountain = Math.max(bestMountain, rider.attrs.mountain);
      bestOverall = Math.max(bestOverall, overall(rider));
    }
    star.attrs.mountain = Math.min(92, Math.max(star.attrs.mountain, bestMountain + 2));
    if (overall(star) <= bestOverall) star.attrs.medium += Math.ceil(bestOverall - overall(star)) + 1;
  }
  return riders;
}

export const RIDERS: Rider[] = build();

/**
 * Hill-climb start list. The best mountain riders in the career, strongest first.
 * A shorter field leaves out the weaker climbers.
 */
export function bestClimbers(count: number): Rider[] {
  const n = Math.max(0, Math.min(RIDERS.length, Math.floor(count)));
  return [...RIDERS].sort((a, b) => {
    if (b.attrs.mountain !== a.attrs.mountain) return b.attrs.mountain - a.attrs.mountain;
    if (b.attrs.medium !== a.attrs.medium) return b.attrs.medium - a.attrs.medium;
    if (b.attrs.hills !== a.attrs.hills) return b.attrs.hills - a.attrs.hills;
    return riderName(a).localeCompare(riderName(b), 'en-US');
  }).slice(0, n);
}

const BY_ID = new Map(RIDERS.map((r) => [r.id, r]));
const BY_TEAM = new Map<string, Rider[]>();
for (const rider of RIDERS) {
  const list = BY_TEAM.get(rider.teamId) ?? [];
  list.push(rider);
  BY_TEAM.set(rider.teamId, list);
}

export function riderById(id: string): Rider | undefined {
  return BY_ID.get(id);
}

export function ridersOf(teamId: string): Rider[] {
  return BY_TEAM.get(teamId) ?? [];
}

export function teamLeader(teamId: string): Rider | undefined {
  return [...ridersOf(teamId)].sort((a, b) => riderPeak(b) - riderPeak(a))[0];
}

function riderPeak(rider: Rider): number {
  return Math.max(rider.attrs.mountain, rider.attrs.hills, rider.attrs.medium, rider.attrs.sprint, rider.attrs.tt, rider.attrs.flat);
}

const TRAITS: { key: keyof Rider['attrs']; label: string }[] = [
  { key: 'mountain', label: 'climber' },
  { key: 'sprint', label: 'sprinter' },
  { key: 'hills', label: 'puncheur' },
  { key: 'tt', label: 'time trialist' },
  { key: 'flat', label: 'rouleur' },
];

export function riderTrait(rider: Rider): string {
  return TRAITS.reduce((best, trait) => (rider.attrs[trait.key] > rider.attrs[best.key] ? trait : best)).label;
}

/** How strong the squad is. The best rider counts more than the depth behind them. */
export function teamStrength(teamId: string): number {
  const peaks = ridersOf(teamId).map(riderPeak).sort((a, b) => b - a);
  if (!peaks.length) return 0;
  const depth = peaks.slice(0, 5).reduce((sum, n) => sum + n, 0) / Math.min(5, peaks.length);
  return peaks[0] * 0.62 + depth * 0.38;
}

/**
 * 1 is a thin Continental squad. 2 is as strong as a Continental team gets.
 * Pro squads land on 3. World Tour squads land on 4 or 5.
 */
export function teamStars(teamId: string): number {
  const score = teamStrength(teamId);
  if (score >= 87) return 5;
  if (score >= 80) return 4;
  if (score >= 70) return 3;
  if (score >= 68) return 2;
  return 1;
}

export function teamBest(teamId: string, key: keyof Rider['attrs']): number {
  return ridersOf(teamId).reduce((best, rider) => Math.max(best, rider.attrs[key]), 0);
}

export function teamByRider(id: string): TeamDef | undefined {
  const rider = riderById(id);
  return rider ? teamById(rider.teamId) : undefined;
}
