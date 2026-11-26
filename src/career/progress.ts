import { canEnter, MONTHS, raceDays, RACES, type RaceDef } from './calendar';
import { CONT_OFFER_WEIGHT, cybPoints, offerPoints, PRO_OFFER, WORLD_OFFER } from './classify';
import { teamById } from './teams';
import type { CareerState, Division } from './types';

/** A points mark that unlocks something at the end of the season. */
export interface ContractStep {
  at: number;
  /** Under the mark on the meter. */
  label: string;
  /** After "N to": "a Pro offer". */
  goal: string;
}

export interface ContractProgress {
  division: Division;
  /** The total teams look at: CYB points plus weighted Pro and Continental points. */
  points: number;
  steps: ContractStep[];
  /** The first mark still ahead, and how far it is. Null once every mark is passed. */
  next: (ContractStep & { left: number }) | null;
  /** Right end of the meter, so the last mark and the current total both fit. */
  scale: number;
}

/**
 * Where the player stands on the way to a contract. The marks are the ones `buildOffers`
 * uses: Pro teams look at PRO_OFFER (300), World Tour teams at WORLD_OFFER (1000), and from
 * PRO_OFFER on a late offer can come
 * from the same division.
 */
export function contractProgress(state: CareerState): ContractProgress {
  const division = teamById(state.teamId)?.division ?? 'continental';
  const points = offerPoints(state.cyb.player ?? 0, state.cont?.player ?? 0);
  const steps: ContractStep[] = division === 'continental'
    ? [{ at: PRO_OFFER, label: 'Pro offer', goal: 'a Pro offer' }, { at: WORLD_OFFER, label: 'World Tour offer', goal: 'a World Tour offer' }]
    : division === 'pro'
      ? [{ at: PRO_OFFER, label: 'Extra Pro offers', goal: 'extra Pro offers' }, { at: WORLD_OFFER, label: 'World Tour offer', goal: 'a World Tour offer' }]
      : [{ at: PRO_OFFER, label: 'Extra offers', goal: 'extra World Tour offers' }];
  const ahead = steps.find((step) => step.at > points);
  const last = steps.at(-1)?.at ?? PRO_OFFER;
  return {
    division,
    points,
    steps,
    next: ahead ? { ...ahead, left: ahead.at - points } : null,
    scale: Math.max(Math.round(last * 1.1), Math.ceil(points * 1.05)),
  };
}

/** Contract points a race pays, already weighted the way contract offers weigh them. */
export interface RacePayout {
  win: number;
  tenth: number;
  /** Stage races only: a stage win, on top of the overall. */
  stageWin: number;
}

export function racePayout(race: RaceDef): RacePayout {
  const weight = race.level === 'pro' || race.level === 'continental' ? CONT_OFFER_WEIGHT : 1;
  const pts = (kind: 'overall' | 'stage', place: number) => Math.round(cybPoints(race, kind, place) * weight);
  return {
    win: pts('overall', 1),
    tenth: pts('overall', 10),
    stageWin: race.stages.length > 1 ? pts('stage', 1) : 0,
  };
}

export type SeasonRaceStatus = 'ridden' | 'skipped' | 'now' | 'next' | 'planned';

export interface SeasonRace {
  id: string;
  name: string;
  month: number;
  day: number;
  status: SeasonRaceStatus;
  /** Your final place, when you rode it and finished. */
  place: number | null;
}

export interface SeasonMonth {
  month: number;
  name: string;
  races: SeasonRace[];
}

export interface SeasonProgress {
  months: SeasonMonth[];
  /** The month the season is in: the race in progress, the next race, or the last one ridden. */
  current: number | null;
  ridden: number;
  /** Races ridden plus races still on your list. Skipped races are not counted. */
  total: number;
  left: number;
  wins: number;
  podiums: number;
  topTen: number;
  best: { place: number; race: string } | null;
}

/** Your races this season, month by month: the ones you rode, skipped, are riding and still have ticked. */
export function seasonProgress(state: CareerState): SeasonProgress {
  const division = teamById(state.teamId)?.division ?? 'continental';
  const done = new Set(state.done);
  const skipped = new Set(state.skipped);
  const entered = new Set(state.entered);
  const ridden = new Set((state.stageNotes ?? []).filter((note) => note.year === state.year).map((note) => note.raceId));
  const saved = new Map(state.races.filter((race) => race.year === state.year).map((race) => [race.raceId, race]));
  for (const [id, race] of saved) if (race.playerPlace != null) ridden.add(id);
  const activeId = state.active?.raceId ?? null;
  const nextId = activeId ? null : RACES.find((race) => entered.has(race.id) && !done.has(race.id))?.id ?? null;

  const races: SeasonRace[] = [];
  for (const race of RACES) {
    if (!canEnter(race.level, division)) continue;
    let status: SeasonRaceStatus | null = null;
    if (race.id === activeId) status = 'now';
    else if (skipped.has(race.id)) status = 'skipped';
    else if (done.has(race.id)) status = ridden.has(race.id) ? 'ridden' : null;
    else if (race.id === nextId) status = 'next';
    else if (entered.has(race.id)) status = 'planned';
    if (!status) continue;
    const first = raceDays(race, state.year)[0] ?? { month: race.month, day: race.day };
    const place = status === 'ridden' ? saved.get(race.id)?.playerPlace ?? null : null;
    races.push({ id: race.id, name: race.name, month: first.month, day: first.day, status, place });
  }
  races.sort((a, b) => a.month - b.month || a.day - b.day);

  const byMonth = new Map<number, SeasonRace[]>();
  for (const race of races) byMonth.set(race.month, [...(byMonth.get(race.month) ?? []), race]);
  const months = [...byMonth.entries()].map(([month, list]) => ({ month, name: MONTHS[month], races: list }));

  const rodeList = races.filter((race) => race.status === 'ridden');
  const places = rodeList.map((race) => race.place).filter((place): place is number => place != null);
  const bestRace = rodeList
    .filter((race) => race.place != null)
    .sort((a, b) => a.place! - b.place! || a.month - b.month || a.day - b.day)[0];
  const focus = races.find((race) => race.status === 'now' || race.status === 'next') ?? rodeList.at(-1);
  const left = races.filter((race) => race.status === 'now' || race.status === 'next' || race.status === 'planned').length;
  return {
    months,
    current: focus?.month ?? null,
    ridden: rodeList.length,
    total: rodeList.length + left,
    left,
    wins: places.filter((place) => place === 1).length,
    podiums: places.filter((place) => place <= 3).length,
    topTen: places.filter((place) => place <= 10).length,
    best: bestRace ? { place: bestRace.place!, race: bestRace.name } : null,
  };
}

/** The ranking a race scores in: CYB for World Tour races and championships, Continental for the rest. */
export type RankingBook = 'cyb' | 'cont';

export function bookFor(race: RaceDef): RankingBook {
  return race.level === 'pro' || race.level === 'continental' ? 'cont' : 'cyb';
}

/** Your place in a ranking, or null while you have no points in it. */
export function rankIn(points: Record<string, number> | undefined): number | null {
  const mine = points?.player ?? 0;
  if (mine <= 0) return null;
  return 1 + Object.entries(points ?? {}).filter(([id, value]) => id !== 'player' && value > mine).length;
}

/** What the contract and ranking looked like before a stage was counted. */
export interface SeasonSnapshot {
  points: number;
  rank: number | null;
  book: RankingBook;
}

export function seasonSnapshot(state: CareerState, race: RaceDef): SeasonSnapshot {
  const book = bookFor(race);
  return {
    points: contractProgress(state).points,
    rank: rankIn(book === 'cyb' ? state.cyb : state.cont),
    book,
  };
}

/** The line after a race: points gained, ranking move, and what is left to the next contract. */
export interface SeasonUpdate {
  gained: number;
  points: number;
  book: RankingBook;
  rankBefore: number | null;
  rankAfter: number | null;
  next: (ContractStep & { left: number }) | null;
  /** The share of the meter filled before and after, 0 to 1. */
  from: number;
  to: number;
}

export function seasonUpdate(before: SeasonSnapshot, state: CareerState): SeasonUpdate {
  const after = contractProgress(state);
  const rankAfter = rankIn(before.book === 'cyb' ? state.cyb : state.cont);
  return {
    gained: Math.max(0, after.points - before.points),
    points: after.points,
    book: before.book,
    rankBefore: before.rank,
    rankAfter,
    next: after.next,
    from: Math.min(1, before.points / after.scale),
    to: Math.min(1, after.points / after.scale),
  };
}

/** Where you stand in one ranking. */
export interface Standing {
  /** Null while you have no points in it. */
  place: number | null;
  /** Riders with points. */
  of: number;
  points: number;
  /** Points to the rider just ahead, or null when you lead or are not ranked. */
  toNext: number | null;
  /** Points to 10th place, when you are below it. */
  toTen: number | null;
}

export function standingIn(map: Record<string, number> | undefined): Standing {
  const values = Object.values(map ?? {}).filter((value) => value > 0).sort((a, b) => b - a);
  const points = map?.player ?? 0;
  const place = rankIn(map);
  const ahead = place && place > 1 ? Math.min(...values.filter((value) => value > points)) : null;
  const tenth = values[9];
  return {
    place,
    of: values.length,
    points,
    toNext: ahead != null && Number.isFinite(ahead) ? ahead - points : null,
    toTen: place && place > 10 && tenth != null ? tenth - points : null,
  };
}

/** One line of a ranking table, with the place it really has (a pinned row keeps its own). */
export interface RankRow {
  place: number;
  id: string;
  value: number;
}

/** The top of a ranking, and your row under it when you are further down. Ties share a place. */
export function rankTop(map: Record<string, number> | undefined, limit: number, pinId = 'player'): { top: RankRow[]; pinned: RankRow | null } {
  const sorted = Object.entries(map ?? {})
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const rows = sorted.map(([id, value]) => ({ id, value, place: 1 + sorted.filter(([, other]) => other > value).length }));
  const top = rows.slice(0, limit);
  const mine = rows.find((row) => row.id === pinId) ?? null;
  return { top, pinned: mine && !top.includes(mine) ? mine : null };
}

/** Your career in numbers, over every season. */
export interface CareerTotals {
  seasons: number;
  stages: number;
  raceWins: number;
  stageWins: number;
  podiums: number;
  topTen: number;
}

export function careerTotals(state: CareerState): CareerTotals {
  const notes = state.stageNotes ?? [];
  const finals = state.palmares.filter((item) => item.kind !== 'stage');
  const multi = new Set(RACES.filter((race) => race.stages.length > 1).map((race) => race.id));
  const first = Math.min(state.year, ...notes.map((note) => note.year), ...state.palmares.map((item) => item.year));
  return {
    seasons: state.year - first + 1,
    stages: notes.length,
    raceWins: finals.filter((item) => item.place === 1).length,
    stageWins: notes.filter((note) => note.place === 1 && multi.has(note.raceId)).length,
    podiums: finals.filter((item) => item.place <= 3).length,
    topTen: finals.filter((item) => item.place <= 10).length,
  };
}
