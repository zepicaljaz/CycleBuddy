import { hashString, mulberry32 } from '../util/math';
import type { RaceDef } from './calendar';
import { teamById, teamsIn, type TeamDef } from './teams';
import type { ContractOffer, Division, RaceLevel } from './types';

const WORLD_ONEDAY = [200, 160, 130, 110, 90, 70, 55, 45, 35, 25, 15, 10, 8, 5, 3];
const WORLD_GC = [420, 340, 280, 230, 190, 150, 120, 95, 75, 55, 40, 30, 22, 16, 10];
const WORLD_STAGE = [45, 32, 24, 18, 14, 10, 8, 6, 4, 3, 2];

export const FINISH_POINTS = [40, 30, 24, 20, 16, 14, 12, 10, 8, 7, 6, 5, 4, 3, 2];
export const PRO_OFFER = 160;
export const WORLD_OFFER = 450;

/**
 * Weight of Pro and Continental points when teams decide on a contract.
 * Those points are already scaled down by level (a Pro one-day win is 90, a Continental one 36,
 * a Pro stage-race GC win 189), so a weight near 1 only trims them a little more:
 * at 0.75, three Pro wins (202) reach PRO_OFFER and about seven (472), or a Pro stage-race GC
 * plus five one-day wins, reach WORLD_OFFER. Six Continental wins also earn a Pro offer.
 */
export const CONT_OFFER_WEIGHT = 0.75;

/** Points a contract offer looks at: CYB points plus weighted Pro and Continental points. */
export function offerPoints(cyb: number, cont: number): number {
  return Math.round(cyb + CONT_OFFER_WEIGHT * cont);
}

function levelScale(level: RaceLevel): number {
  if (level === 'world') return 1;
  if (level === 'pro') return 0.45;
  if (level === 'continental') return 0.18;
  return 1;
}

/** CYB ranking points for a place. Place is 1-based. */
export function cybPoints(race: RaceDef, kind: 'overall' | 'stage', place: number): number {
  if (place < 1) return 0;
  if (race.champ === 'world-road') return [520, 380, 280, 200, 150, 110, 80, 60, 40, 20][place - 1] ?? 0;
  if (race.champ === 'world-tt') return [320, 220, 160, 120, 90, 60, 40, 25][place - 1] ?? 0;
  if (race.champ === 'euro-road') return [260, 180, 140, 100, 70, 50, 30, 20][place - 1] ?? 0;
  if (race.champ === 'euro-tt') return [170, 120, 90, 60, 40, 25][place - 1] ?? 0;
  const table = race.stages.length > 1 ? (kind === 'overall' ? WORLD_GC : WORLD_STAGE) : WORLD_ONEDAY;
  if (race.stages.length === 1 && kind === 'stage') return 0;
  return Math.round((table[place - 1] ?? 0) * levelScale(race.level));
}

export function finishJerseyPoints(place: number, timeTrial: boolean): number {
  const raw = FINISH_POINTS[place - 1] ?? 0;
  return timeTrial ? Math.round(raw / 2) : raw;
}

function pickFrom(division: Division, salt: string, n: number, skip: Set<string>): TeamDef[] {
  const pool = teamsIn(division).filter((t) => !skip.has(t.id));
  const rng = mulberry32(hashString(salt));
  const bag = [...pool];
  const out: TeamDef[] = [];
  while (bag.length && out.length < n) out.push(bag.splice(Math.floor(rng() * bag.length), 1)[0]);
  return out;
}

/** Three to five contracts. The current team is always one of them. */
export function buildOffers(points: number, teamId: string): ContractOffer[] {
  const current = teamById(teamId);
  if (!current) return [];
  const offers: ContractOffer[] = [{ teamId: current.id, blurb: `${current.name} want you back as leader.` }];
  const skip = new Set([current.id]);
  const add = (team: TeamDef, blurb: string) => {
    if (offers.length >= 5 || skip.has(team.id)) return;
    skip.add(team.id);
    offers.push({ teamId: team.id, blurb });
  };
  if (current.division === 'continental' && points >= PRO_OFFER) {
    for (const team of pickFrom('pro', `pro-${points}-${teamId}`, 2, skip)) add(team, `${team.name} will make you leader next season.`);
  }
  if (current.division !== 'world' && points >= WORLD_OFFER) {
    const count = points >= WORLD_OFFER + 220 ? 2 : 1;
    const top = teamsIn('world').filter((t) => !skip.has(t.id)).slice(0, count);
    for (const team of top) add(team, `${team.name} will build the season around you.`);
  }
  if (current.division === 'pro' && points >= 90) {
    for (const team of pickFrom('pro', `rival-${points}`, 1, skip)) add(team, `${team.name} matched your contract.`);
  }
  const filler = current.division === 'world' ? 'world' : current.division === 'pro' ? 'pro' : 'continental';
  for (const team of pickFrom(filler, `fill-${teamId}`, 4, skip)) {
    if (offers.length >= 3) break;
    add(team, `${team.name} have a place in the same division.`);
  }
  if (offers.length < 5 && points >= PRO_OFFER) {
    for (const team of pickFrom(filler, `extra-${points}`, 2, skip)) {
      if (offers.length >= 5) break;
      add(team, `${team.name} sent a late offer.`);
    }
  }
  return offers.slice(0, 5);
}
