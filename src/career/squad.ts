import { punchScore } from '../ai/road';
import { punchyStage, raceById, segmentFinish, segmentKind, type RaceDef } from './calendar';
import { riderById, riderName, ridersOf, RIDERS, type Rider } from './roster';
import { teamById, teamsIn, type TeamDef } from './teams';
import type { RaceProfile } from './types';

const START_TEAMS = { world: 22, pro: 20, continental: 15 } as const;
const START_RIDERS = { world: 8, pro: 7, continental: 7 } as const;

/** How many teammates ride with the player. The start list is this many, plus the player. */
export function startMateCount(race: RaceDef): number {
  if (race.level === 'champ') return 0;
  const per = race.level === 'world' ? START_RIDERS.world : race.level === 'pro' ? START_RIDERS.pro : START_RIDERS.continental;
  return per - 1;
}

/** Riders the player may put on the start line. */
export function eligibleMates(teamId: string, race: RaceDef): Rider[] {
  return ridersOf(teamId).filter((rider) => !benched(rider, race));
}

function withPlayer(teams: TeamDef[], player: TeamDef | undefined, entered: boolean, count: number): TeamDef[] {
  const list = teams.slice(0, count);
  if (!entered || !player) return list;
  if (list.some((team) => team.id === player.id)) return list;
  return [...list.slice(0, Math.max(0, count - 1)), player];
}

export function invitedTeams(race: RaceDef, playerTeamId: string | null, playerEntered: boolean): TeamDef[] {
  if (race.level === 'champ') return [];
  const player = playerTeamId ? teamById(playerTeamId) : undefined;
  if (race.level === 'world') return withPlayer(teamsIn('world'), player, playerEntered, START_TEAMS.world);
  if (race.level === 'pro') return withPlayer(teamsIn('pro'), player, playerEntered, START_TEAMS.pro);
  const continental = teamsIn('continental');
  const ordered = player?.division === 'continental' ? [player, ...continental.filter((team) => team.id !== player.id)] : continental;
  return withPlayer(ordered, player, playerEntered, START_TEAMS.continental);
}

function benched(rider: Rider, race: RaceDef): boolean {
  if (race.level === 'champ') return false;
  if (rider.program === 'gc' && rider.attrs.mountain >= 89 && (race.level === 'pro' || race.level === 'continental' || race.profile === 'classic' || race.profile === 'sprint')) return true;
  if (rider.program === 'sprint' && rider.attrs.mountain < 76 && race.profile === 'gc' && !race.stages.some((stage) => segmentFinish(stage) === 'sprint' && segmentKind(stage) === 'road')) return true;
  return false;
}

/** A hilly or classic race whose road is the short walls. */
export function favoursPunch(race: RaceDef): boolean {
  return (race.profile === 'hilly' || race.profile === 'classic')
    && race.stages.some((stage) => segmentKind(stage) === 'road' && punchyStage(stage));
}

export function rate(rider: Rider, profile: RaceProfile, punchy = false): number {
  const a = rider.attrs;
  if (punchy && (profile === 'hilly' || profile === 'classic')) return a.hills * 1.45 + a.sprint * 1.2 + a.flat * 0.4;
  if (profile === 'gc') return a.mountain * 2 + a.medium + a.tt * 0.45 + a.endurance * 0.25;
  if (profile === 'sprint') return a.sprint * 2 + a.flat * 0.8;
  if (profile === 'classic') return a.hills * 1.5 + a.sprint * 0.7 + a.flat * 0.45;
  if (profile === 'tt') return a.tt * 2 + a.flat * 0.4;
  return a.hills * 1.35 + a.medium + a.sprint * 0.25;
}

export function squadFor(teamId: string, race: RaceDef, count: number): Rider[] {
  const pool = ridersOf(teamId).filter((r) => !benched(r, race));
  const picked: Rider[] = [];
  const wantsSprint = race.stages.some((stage) => segmentFinish(stage) === 'sprint' && segmentKind(stage) === 'road');
  if (wantsSprint) {
    const sprinter = [...pool].sort((a, b) => b.attrs.sprint - a.attrs.sprint)[0];
    if (sprinter) picked.push(sprinter);
  }
  const wantsPunch = race.profile === 'gc' && race.stages.some((stage) => segmentKind(stage) === 'road' && punchyStage(stage));
  if (wantsPunch) {
    const puncher = [...pool].sort((a, b) => punchScore(b.attrs) - punchScore(a.attrs))[0];
    if (puncher && !picked.includes(puncher)) picked.push(puncher);
  }
  const punch = favoursPunch(race);
  const ranked = [...pool].sort((a, b) => rate(b, race.profile, punch) - rate(a, race.profile, punch));
  for (const rider of ranked) {
    if (picked.length >= count) break;
    if (!picked.includes(rider)) picked.push(rider);
  }
  return picked.slice(0, count);
}

export interface Slot {
  rider: Rider;
  teammate: boolean;
}

/** Riders on the start line, not including the human. `chosen` replaces the player's automatic squad. */
export function aiField(race: RaceDef, playerTeamId: string | null, playerEntered: boolean, chosen?: string[]): Slot[] {
  const teams = invitedTeams(race, playerTeamId, playerEntered);
  const per = race.level === 'world' ? START_RIDERS.world : race.level === 'pro' ? START_RIDERS.pro : START_RIDERS.continental;
  const slots: Slot[] = [];
  for (const team of teams) {
    const mine = team.id === playerTeamId && playerEntered;
    const riders = mine ? playerSquad(team.id, race, per - 1, chosen) : squadFor(team.id, race, per);
    for (const rider of riders) slots.push({ rider, teammate: mine });
  }
  return slots;
}

/** The saved stage-1 start list, in that order. Missing ids are skipped. */
export function fieldFromList(ids: string[], playerTeamId: string): Slot[] {
  const slots: Slot[] = [];
  for (const id of ids) {
    const rider = riderById(id);
    if (!rider) continue;
    slots.push({ rider, teammate: rider.teamId === playerTeamId });
  }
  return slots;
}

function playerSquad(teamId: string, race: RaceDef, count: number, chosen?: string[]): Rider[] {
  const known = new Map(ridersOf(teamId).map((rider) => [rider.id, rider]));
  const picked = (chosen ?? []).map((id) => known.get(id)).filter((rider): rider is Rider => !!rider);
  if (!picked.length) return squadFor(teamId, race, count);
  const fill = squadFor(teamId, race, count + picked.length).filter((rider) => !picked.includes(rider));
  return [...picked, ...fill].slice(0, count);
}

const MAJOR = new Set(['SLO', 'DEN', 'BEL', 'FRA', 'ESP', 'ITA', 'GBR', 'NED', 'NOR', 'AUS', 'COL', 'USA']);

export function champField(race: RaceDef, nation: string): Slot[] {
  const byCountry = new Map<string, Rider[]>();
  for (const rider of RIDERS) {
    if (benched(rider, race) && rider.attrs.mountain >= 88 && race.profile === 'classic') continue;
    const list = byCountry.get(rider.country) ?? [];
    list.push(rider);
    byCountry.set(rider.country, list);
  }
  const slots: Slot[] = [];
  const punch = favoursPunch(race);
  for (const [country, list] of byCountry) {
    const n = country === nation ? 5 : MAJOR.has(country) ? 4 : 2;
    const ranked = [...list].sort((a, b) => rate(b, race.profile, punch) - rate(a, race.profile, punch)).slice(0, n);
    for (const rider of ranked) slots.push({ rider, teammate: false });
  }
  return slots.sort((a, b) => rate(b.rider, race.profile, punch) - rate(a.rider, race.profile, punch)).slice(0, 88);
}

export function raceOrThrow(id: string): RaceDef {
  const race = raceById(id);
  if (!race) throw new Error(`Unknown race ${id}`);
  return race;
}

export function teammateNames(teamId: string, race: RaceDef): string[] {
  const per = race.level === 'world' ? START_RIDERS.world : START_RIDERS.pro;
  const count = race.level === 'continental' ? START_RIDERS.continental : per;
  return squadFor(teamId, race, count - 1).map(riderName);
}
