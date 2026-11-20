import type { TeamKit } from './names';
import { clamp, randRange } from '../util/math';

/**
 * Older climber ranking of 5 Nov 2026, surnames altered.
 * Career riders must not copy these surnames. Hill-climb races use the career roster.
 */
export interface Climber {
  first: string;
  last: string;
  country: string;
  team: string;
  points: number;
}

/** Initial and last name, e.g. "T. Pogačnik". */
export function climberName(rider: Climber): string {
  const initial = rider.first.charAt(0).toLocaleUpperCase('en-US');
  return `${initial}. ${rider.last}`;
}

/** Top `count` climbers. Asking for more than the list returns the whole list. */
export function hillClimbField(count: number): Climber[] {
  const n = Math.max(0, Math.min(CLIMBERS.length, Math.floor(count)));
  return CLIMBERS.slice(0, n);
}

/**
 * Points place a rider between the slowest and strongest W/kg.
 * Each race adds a small form swing, about 40 ranking points, so riders
 * with similar points can change order. A gap bigger than that holds.
 */
export function climbWattsPerKilo(
  points: number,
  lowPoints: number,
  highPoints: number,
  lowWkg: number,
  highWkg: number,
  rng: () => number,
): number {
  const span = highPoints - lowPoints;
  const level = span > 0 ? (points - lowPoints) / span : 1;
  const base = lowWkg + (highWkg - lowWkg) * level;
  const swing = span > 0 && highWkg > lowWkg ? ((highWkg - lowWkg) * 40) / span : 0;
  const form = randRange(rng, -swing, swing);
  return clamp(base + form, lowWkg, highWkg);
}

/**
 * How far the next climber sits under the strongest W/kg.
 * A tenth is about a minute on a long climb. A narrow band keeps half of
 * itself, so the slowest setting still has room under him.
 */
export function hillClimbLeaderGap(lowWkg: number, highWkg: number): number {
  const band = Math.max(0, highWkg - lowWkg);
  return Math.min(0.1, band / 2);
}

/**
 * W/kg for one hill-climb. `scores` is mountain rating times 20, strongest
 * climber first. He rides `highWkg` exactly: that setting is his power.
 * Everyone else is spread from `lowWkg` up to just under him, across their
 * own rating span, so his lead is not an empty piece of the band. Close
 * ratings can still change order.
 */
export function hillClimbWattsPerKilo(
  scores: number[],
  lowWkg: number,
  highWkg: number,
  rng: () => number,
): number[] {
  if (!scores.length) return [];
  const hi = Math.max(lowWkg, highWkg);
  const lo = Math.min(lowWkg, highWkg);
  const efforts = [hi];
  if (scores.length === 1) return efforts;
  let best = scores[1];
  let worst = scores[1];
  for (let i = 2; i < scores.length; i++) {
    if (scores[i] > best) best = scores[i];
    if (scores[i] < worst) worst = scores[i];
  }
  const chaseHi = hi - hillClimbLeaderGap(lo, hi);
  for (let i = 1; i < scores.length; i++) {
    efforts.push(climbWattsPerKilo(scores[i], worst, best, lo, chaseHi, rng));
  }
  return efforts;
}

/**
 * Watts for one hill-climb effort. The leader's watts are the strongest
 * W/kg at his weight. Every other rider stays strictly under that W/kg
 * after rounding.
 */
export function climbEffortWatts(
  wkg: number,
  mass: number,
  lowWkg: number,
  leaderWkg: number,
  leader: boolean,
): number {
  if (leader) return Math.max(1, Math.round(wkg * mass));
  const aimed = Math.round(wkg * mass);
  let cap = Math.floor(leaderWkg * mass - 1e-9);
  if (!(cap / mass < leaderWkg)) cap -= 1;
  cap = Math.max(1, cap);
  const floorW = Math.min(cap, Math.ceil(lowWkg * mass - 1e-6));
  return clamp(aimed, floorW, cap);
}

const KITS: Record<string, TeamKit> = {
  uae: { name: 'UAE Team Emirates', jersey: '#f4f4f4', accent: '#e10600', shorts: '#16171a', helmet: '#f4f4f4', frame: '#111111' },
  vis: { name: 'Visma-Lease a Bike', jersey: '#ffe100', accent: '#111111', shorts: '#111111', helmet: '#ffe100', frame: '#111111' },
  rbh: { name: 'Red Bull-BORA', jersey: '#1a2744', accent: '#e10600', shorts: '#10141c', helmet: '#e10600', frame: '#1a2744' },
  dec: { name: 'Decathlon CMA CGM', jersey: '#0b4ea2', accent: '#ffffff', shorts: '#0a2e66', helmet: '#0b4ea2', frame: '#ffffff' },
  uno: { name: 'Uno-X', jersey: '#111111', accent: '#f5c400', shorts: '#111111', helmet: '#f5c400', frame: '#111111' },
  tbv: { name: 'Bahrain Victorious', jersey: '#d0121a', accent: '#f2c14e', shorts: '#2a0a0e', helmet: '#d0121a', frame: '#1a1a1a' },
  efe: { name: 'EF Education', jersey: '#f4a3c7', accent: '#1b1f27', shorts: '#1b1f27', helmet: '#f4a3c7', frame: '#1b1f27' },
  ltk: { name: 'Lidl-Trek', jersey: '#ee2a2a', accent: '#ffd100', shorts: '#1b1f27', helmet: '#ffd100', frame: '#1b1f27' },
  ast: { name: 'XDS Astana', jersey: '#3ec3ff', accent: '#0a3d66', shorts: '#0a3d66', helmet: '#3ec3ff', frame: '#0a3d66' },
  q36: { name: 'Q36.5', jersey: '#24262b', accent: '#ffffff', shorts: '#16171a', helmet: '#ffffff', frame: '#c81d25' },
  mov: { name: 'Movistar', jersey: '#0a4ea3', accent: '#7ec8e3', shorts: '#062a5c', helmet: '#0a4ea3', frame: '#0a4ea3' },
  tud: { name: 'Tudor', jersey: '#1a1a1a', accent: '#c4a35a', shorts: '#111111', helmet: '#1a1a1a', frame: '#c4a35a' },
  alp: { name: 'Alpecin', jersey: '#f2f2f2', accent: '#222222', shorts: '#1b1f27', helmet: '#222222', frame: '#f2f2f2' },
  jay: { name: 'Jayco-AlUla', jersey: '#f7f7f7', accent: '#0b7a3b', shorts: '#123524', helmet: '#0b7a3b', frame: '#f7f7f7' },
  ine: { name: 'INEOS', jersey: '#c8102e', accent: '#111111', shorts: '#111111', helmet: '#c8102e', frame: '#111111' },
  fdj: { name: 'Groupama-FDJ', jersey: '#ffffff', accent: '#0033a0', shorts: '#0033a0', helmet: '#0033a0', frame: '#ffffff' },
  cof: { name: 'Cofidis', jersey: '#e10600', accent: '#ffffff', shorts: '#ffffff', helmet: '#e10600', frame: '#1b1f27' },
  soq: { name: 'Soudal Quick-Step', jersey: '#123a8f', accent: '#ffffff', shorts: '#0c245c', helmet: '#123a8f', frame: '#ffffff' },
  ten: { name: 'TotalEnergies', jersey: '#ffe14a', accent: '#e10600', shorts: '#1b1f27', helmet: '#ffe14a', frame: '#e10600' },
  mbh: { name: 'MBH Bank', jersey: '#1f8a4c', accent: '#ffffff', shorts: '#143d28', helmet: '#1f8a4c', frame: '#ffffff' },
  lot: { name: 'Lotto', jersey: '#e23b2f', accent: '#f2c14e', shorts: '#2a1210', helmet: '#e23b2f', frame: '#1b1f27' },
  ker: { name: 'Kern Pharma', jersey: '#163a5f', accent: '#f28c28', shorts: '#0e2438', helmet: '#163a5f', frame: '#f28c28' },
  uni: { name: 'Unibet', jersey: '#14804a', accent: '#ffffff', shorts: '#0e3d24', helmet: '#14804a', frame: '#111111' },
  pol: { name: 'Polti', jersey: '#f2d024', accent: '#111111', shorts: '#111111', helmet: '#111111', frame: '#f2d024' },
  nsn: { name: 'NSN', jersey: '#5b2d8e', accent: '#ffffff', shorts: '#2a1844', helmet: '#5b2d8e', frame: '#ffffff' },
};

export function climberKit(team: string): TeamKit {
  return KITS[team] ?? KITS.uae;
}

export const CLIMBERS: Climber[] = [
  { first: 'T', last: 'Pogačnik', country: 'SLO', team: 'uae', points: 1493 },
  { first: 'I', last: 'de Torres', country: 'MEX', team: 'uae', points: 1301 },
  { first: 'R', last: 'Everpoel', country: 'BEL', team: 'rbh', points: 1274 },
  { first: 'P', last: 'Seixat', country: 'FRA', team: 'dec', points: 1247 },
  { first: 'T', last: 'Johannestad', country: 'NOR', team: 'uno', points: 1135 },
  { first: 'J', last: 'Vingerdal', country: 'DEN', team: 'vis', points: 1114 },
  { first: 'L', last: 'Martinel', country: 'FRA', team: 'tbv', points: 979 },
  { first: 'R', last: 'Caravaz', country: 'ECU', team: 'efe', points: 972 },
  { first: 'M', last: 'Skjelstrand', country: 'DEN', team: 'ltk', points: 956 },
  { first: 'F', last: 'Gallet', country: 'AUT', team: 'dec', points: 927 },
  { first: 'C', last: 'Scaronni', country: 'ITA', team: 'ast', points: 818 },
  { first: 'F', last: 'Lipovski', country: 'GER', team: 'rbh', points: 798 },
  { first: 'T', last: 'Pidmore', country: 'GBR', team: 'q36', points: 769 },
  { first: 'G', last: 'Ciccioni', country: 'ITA', team: 'ltk', points: 657 },
  { first: 'J', last: 'Ayusol', country: 'ESP', team: 'ltk', points: 652 },
  { first: 'G', last: 'Pellizari', country: 'ITA', team: 'rbh', points: 621 },
  { first: 'S', last: 'Kussek', country: 'USA', team: 'vis', points: 602 },
  { first: 'D', last: 'Piganzoni', country: 'ITA', team: 'vis', points: 563 },
  { first: 'P', last: 'Roglin', country: 'SLO', team: 'rbh', points: 536 },
  { first: 'H', last: 'Tejalda', country: 'COL', team: 'ast', points: 527 },
  { first: 'E', last: 'Masell', country: 'ESP', team: 'mov', points: 512 },
  { first: 'M', last: 'Rondell', country: 'FRA', team: 'tud', points: 503 },
  { first: 'R', last: 'Debruin', country: 'BEL', team: 'alp', points: 498 },
  { first: 'M', last: 'Schmidli', country: 'SUI', team: 'jay', points: 494 },
  { first: 'A', last: 'Baudrin', country: 'FRA', team: 'efe', points: 484 },
  { first: 'M', last: 'Jorgensson', country: 'USA', team: 'vis', points: 482 },
  { first: 'T', last: 'Arendsen', country: 'NED', team: 'ine', points: 479 },
  { first: 'E', last: 'Bernali', country: 'COL', team: 'ine', points: 478 },
  { first: 'J', last: 'Hindsley', country: 'AUS', team: 'rbh', points: 478 },
  { first: 'O', last: 'Onleigh', country: 'GBR', team: 'ine', points: 476 },
  { first: 'R', last: 'Grégorier', country: 'FRA', team: 'fdj', points: 474 },
  { first: 'I', last: 'Izagirren', country: 'ESP', team: 'cof', points: 445 },
  { first: 'B', last: 'Tullett', country: 'GBR', team: 'vis', points: 424 },
  { first: 'A', last: 'Leknesund', country: 'NOR', team: 'uno', points: 421 },
  { first: 'S', last: 'Buitraga', country: 'COL', team: 'tbv', points: 416 },
  { first: 'V', last: 'Paret-Paintre', country: 'FRA', team: 'soq', points: 409 },
  { first: 'J', last: 'Jegatt', country: 'FRA', team: 'ten', points: 404 },
  { first: 'D', last: 'Gee-Wester', country: 'CAN', team: 'ltk', points: 401 },
  { first: 'M', last: 'Riccitelli', country: 'USA', team: 'dec', points: 386 },
  { first: 'M', last: 'Storrer', country: 'AUS', team: 'tud', points: 384 },
  { first: 'I', last: 'Arrietta', country: 'ESP', team: 'uae', points: 380 },
  { first: 'J', last: 'Omrzal', country: 'SLO', team: 'tbv', points: 378 },
  { first: 'L', last: 'Bisiaud', country: 'FRA', team: 'dec', points: 369 },
  { first: 'K', last: 'Vauquelain', country: 'FRA', team: 'ine', points: 368 },
  { first: 'J', last: 'Christens', country: 'SUI', team: 'uae', points: 366 },
  { first: 'L', last: 'van Eetfeld', country: 'BEL', team: 'lot', points: 356 },
  { first: 'A', last: 'Vlasow', country: 'RUS', team: 'rbh', points: 354 },
  { first: 'B', last: 'MacNulty', country: 'USA', team: 'uae', points: 350 },
  { first: 'C', last: 'Rodrígues', country: 'ESP', team: 'ast', points: 348 },
  { first: 'A', last: 'Eulário', country: 'POR', team: 'tbv', points: 342 },
  { first: 'P', last: 'Bilvao', country: 'ESP', team: 'tbv', points: 336 },
  { first: 'A', last: 'Aranburo', country: 'ESP', team: 'cof', points: 334 },
  { first: 'I', last: 'van Wilden', country: 'BEL', team: 'soq', points: 332 },
  { first: 'Q', last: 'Simmonds', country: 'USA', team: 'ltk', points: 330 },
  { first: 'Y', last: 'Voisart', country: 'SUI', team: 'tud', points: 322 },
  { first: 'L', last: 'Fortunati', country: 'ITA', team: 'ast', points: 320 },
  { first: 'A', last: 'Fancelli', country: 'ITA', team: 'mbh', points: 318 },
  { first: 'F', last: 'Zanna', country: 'ITA', team: 'soq', points: 313 },
  { first: 'J', last: 'Nordhaggen', country: 'NOR', team: 'vis', points: 313 },
  { first: 'K', last: 'Vermaercke', country: 'USA', team: 'uae', points: 310 },
  { first: 'R', last: 'García Pierra', country: 'ESP', team: 'mov', points: 309 },
  { first: 'A', last: 'Tiberio', country: 'ITA', team: 'tbv', points: 308 },
  { first: 'A', last: 'Yattes', country: 'GBR', team: 'uae', points: 302 },
  { first: 'J', last: 'Narvaes', country: 'ECU', team: 'uae', points: 301 },
  { first: 'G', last: 'Martins', country: 'FRA', team: 'fdj', points: 301 },
  { first: 'J', last: 'Widarr', country: 'BEL', team: 'lot', points: 296 },
  { first: 'B', last: 'Cosnefroi', country: 'FRA', team: 'uae', points: 289 },
  { first: 'G', last: 'Silvas', country: 'URU', team: 'ast', points: 284 },
  { first: 'B', last: "O'Connors", country: 'AUS', team: 'jay', points: 272 },
  { first: 'C', last: 'Berthez', country: 'FRA', team: 'fdj', points: 272 },
  { first: 'N', last: 'Tesfation', country: 'ERI', team: 'mov', points: 262 },
  { first: 'M', last: 'Brennar', country: 'GER', team: 'tud', points: 262 },
  { first: 'D', last: 'Carusso', country: 'ITA', team: 'tbv', points: 262 },
  { first: 'C', last: 'Braz Alfonso', country: 'FRA', team: 'fdj', points: 262 },
  { first: 'W', last: 'van Aertsen', country: 'BEL', team: 'vis', points: 262 },
  { first: 'L', last: 'Plapps', country: 'AUS', team: 'jay', points: 260 },
  { first: 'A', last: 'Augustin', country: 'USA', team: 'ine', points: 256 },
  { first: 'J', last: 'Hirth', country: 'CZE', team: 'nsn', points: 253 },
  { first: 'B', last: 'Healey', country: 'IRL', team: 'efe', points: 247 },
  { first: 'U', last: 'Berradi', country: 'ESP', team: 'ker', points: 242 },
  { first: 'A', last: 'Kroner', country: 'DEN', team: 'uno', points: 239 },
  { first: 'C', last: 'Champousin', country: 'FRA', team: 'ast', points: 238 },
  { first: 'C', last: 'Uijtdebroek', country: 'BEL', team: 'mov', points: 236 },
  { first: 'M', last: 'van Gilz', country: 'BEL', team: 'rbh', points: 234 },
  { first: 'M', last: 'van der Poelen', country: 'NED', team: 'alp', points: 234 },
  { first: 'W', last: 'Poelz', country: 'NED', team: 'uni', points: 232 },
  { first: 'L', last: 'Cresciolo', country: 'ITA', team: 'pol', points: 232 },
  { first: 'I', last: 'Sossa', country: 'COL', team: 'ker', points: 232 },
  { first: 'M', last: 'Valgrenn', country: 'DEN', team: 'efe', points: 230 },
  { first: 'S', last: 'Higuitas', country: 'COL', team: 'ast', points: 228 },
  { first: 'M', last: 'Vansevennant', country: 'BEL', team: 'soq', points: 220 },
  { first: 'N', last: 'Breuillart', country: 'FRA', team: 'ten', points: 218 },
  { first: 'F', last: 'Fischer-Black', country: 'NZL', team: 'rbh', points: 218 },
  { first: 'L', last: 'Tuckwall', country: 'AUS', team: 'rbh', points: 216 },
  { first: 'B', last: 'Lemmens', country: 'NED', team: 'vis', points: 214 },
  { first: 'C', last: 'Harpers', country: 'AUS', team: 'q36', points: 213 },
  { first: 'P', last: 'Lapeiro', country: 'FRA', team: 'dec', points: 212 },
  { first: 'G', last: 'Muhlberg', country: 'AUT', team: 'dec', points: 210 },
  { first: 'D', last: 'Ulisso', country: 'ITA', team: 'ast', points: 206 },
  { first: 'P', last: 'Castrilho', country: 'ESP', team: 'mov', points: 206 },
];
