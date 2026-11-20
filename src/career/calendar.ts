import { getRouteDef } from '../routes/definitions';
import { getRoute } from '../routes/route';
import { segmentById, type StageFinish, type StageKind, type StageSegment } from '../routes/careerWorlds';
import type { JerseyColor, RaceLevel, RaceProfile } from './types';

export interface RaceStage {
  segment: string;
  name: string;
  /** Ride this road back toward its start. The distance is the same; the climbs come the other way. */
  reverse?: boolean;
}

export interface RaceDef {
  id: string;
  name: string;
  month: number;
  day: number;
  level: RaceLevel;
  profile: RaceProfile;
  jerseys: JerseyColor;
  /** Set on the October championships. */
  champ?: 'world-road' | 'world-tt' | 'euro-road' | 'euro-tt';
  stages: RaceStage[];
}

const s = (segment: string, name: string, reverse = false): RaceStage => (
  reverse ? { segment, name, reverse: true } : { segment, name }
);

const FRANCE: RaceStage[] = [
  s('nor-sprint', 'Stage 1 · Normandy run-in'),
  s('bri-coast', 'Stage 2 · Cove road'),
  s('mis-sprint', 'Stage 3 · Valley run-in'),
  s('nor-hilly', 'Stage 4 · After Cap de Falaise'),
  s('vos-tt', 'Stage 5 · Forest time trial'),
  s('vos-fagnes', 'Stage 6 · Col des Fagnes'),
  s('jur-recul', 'Stage 7 · After the Reculée'),
  s('mas-plat', 'Stage 8 · Plateau run'),
  s('nor-falaise-tt', 'Stage 9 · Cap de Falaise'),
  s('pyr-after', 'Stage 10 · After Col du Crest'),
  s('lim-slena', 'Stage 11 · Slenaken'),
  s('vos-sapin', 'Stage 12 · Cote du Sapin'),
  s('pyr-foc', 'Stage 13 · Port del Foc'),
  s('vos-ballon', 'Stage 14 · Ballon Noir'),
  s('sav-valley', 'Stage 15 · Savoy valley'),
  s('sav-tt', 'Stage 16 · Alpine time trial'),
  s('sav-neige', 'Stage 17 · Col de la Neige'),
  s('arg-after', 'Stage 18 · After Col du Coteau'),
  s('sav-blanche', 'Stage 19 · Aiguille Blanche'),
  s('arg-queen', 'Stage 20 · Mur de Lune'),
  s('mis-east', 'Stage 21 · East wind'),
];

const ITALY: RaceStage[] = [
  s('lev-coast', 'Stage 1 · Sea road'),
  s('tus-sprint', 'Stage 2 · Vineyard run-in'),
  s('cor-north', 'Stage 3 · Northern capes', true),
  s('tus-poggio', 'Stage 4 · Poggio Alto'),
  s('lom-tt', 'Stage 5 · Lake time trial'),
  s('ape-first', 'Stage 6 · Passo del Corvo'),
  s('sic-coast', 'Stage 7 · Coast road'),
  s('dol-nevoso', 'Stage 8 · Passo Nevoso'),
  s('tus-tt', 'Stage 9 · Town time trial'),
  s('lom-rovere', 'Stage 10 · Passo di Rovere'),
  s('con-trio', 'Stage 11 · After Trixhe', true),
  s('dol-valley', 'Stage 12 · Crown valley'),
  s('sic-vulcano', 'Stage 13 · Vulcano Alto'),
  s('lom-madonna', 'Stage 14 · Madonna del Lago'),
  s('dol-rosa', 'Stage 15 · Forcella Rosa'),
  s('ape-home', 'Stage 16 · Spine valley'),
  s('sic-tt', 'Stage 17 · Harbour time trial'),
  s('dol-grigio', 'Stage 18 · Monte Grigio'),
  s('eif-west', 'Stage 19 · Western ramps'),
  s('lev-far', 'Stage 20 · Col del Far'),
  s('lev-bay', 'Stage 21 · Long bay'),
];

const SPAIN: RaceStage[] = [
  s('gal-sprint', 'Stage 1 · Cape sprint'),
  s('cat-coast', 'Stage 2 · Pine coast'),
  s('cor-south', 'Stage 3 · Southern capes'),
  s('and-plain', 'Stage 4 · White plain'),
  s('cat-tt', 'Stage 5 · Coast time trial'),
  s('eif-north', 'Stage 6 · Northern ramps', true),
  s('con-late', 'Stage 7 · Côte d\'Esneux'),
  s('pyr-link', 'Stage 8 · Far valley'),
  s('gal-tt', 'Stage 9 · Ria time trial'),
  s('sie-cruz', 'Stage 10 · Alto de la Cruz'),
  s('gal-hill', 'Stage 11 · Serra Baixa'),
  s('and-tt', 'Stage 12 · Town time trial'),
  s('sie-pena', 'Stage 13 · Peña Roja'),
  s('cat-riba', 'Stage 14 · Coll de la Riba'),
  s('lim-late', 'Stage 15 · Wijlreberg'),
  s('and-cal', 'Stage 16 · Alto de la Cal'),
  s('and-blanca', 'Stage 17 · Sierra Blanca'),
  s('sie-cielo', 'Stage 18 · Alto del Cielo'),
  s('cat-turo', 'Stage 19 · Turó Major'),
  s('sie-tt', 'Stage 20 · Evening time trial'),
  s('and-home', 'Stage 21 · Closing road'),
];

export const RACES: RaceDef[] = [
  { id: 'opening-classic', name: 'Opening Classic', month: 2, day: 7, level: 'continental', profile: 'sprint', jerseys: 'none', stages: [s('nor-sprint', 'Opening Classic')] },
  { id: 'gulf-classic', name: 'Gulf Classic', month: 2, day: 7, level: 'world', profile: 'hilly', jerseys: 'none', stages: [s('lev-coast', 'Gulf Classic')] },
  { id: 'south-week', name: 'South Week', month: 2, day: 10, level: 'pro', profile: 'hilly', jerseys: 'none', stages: [
    s('tus-sprint', 'Stage 1 · Vineyard run-in'), s('tus-hill', 'Stage 2 · Colle di Vino'), s('and-cal', 'Stage 3 · Alto de la Cal'), s('cat-tt', 'Stage 4 · Coast time trial'), s('cor-cape', 'Stage 5 · Cape ramps'),
  ] },
  { id: 'vineyard-day', name: 'Vineyard Day', month: 2, day: 10, level: 'continental', profile: 'sprint', jerseys: 'none', stages: [s('tus-poggio', 'Vineyard Day')] },
  { id: 'dike-race', name: 'Dike Race', month: 2, day: 16, level: 'continental', profile: 'hilly', jerseys: 'none', stages: [s('eif-mid', 'Dike Race')] },
  { id: 'lowland-trophy', name: 'Lowland Trophy', month: 2, day: 18, level: 'continental', profile: 'sprint', jerseys: 'none', stages: [s('low-a', 'Lowland Trophy')] },
  { id: 'north-week', name: 'North Week', month: 2, day: 22, level: 'pro', profile: 'sprint', jerseys: 'none', stages: [
    s('low-b', 'Stage 1 · Dike road'), s('bri-run', 'Stage 2 · Headland run-in'), s('lim-slena', 'Stage 3 · Slenaken'), s('low-tt', 'Stage 4 · Harbour time trial'), s('nor-coast', 'Stage 5 · Cliff road'),
  ] },
  { id: 'harbour-race', name: 'Harbour Race', month: 2, day: 28, level: 'pro', profile: 'hilly', jerseys: 'none', stages: [s('jur-cret', 'Harbour Race')] },
  { id: 'valley-cup', name: 'Valley Cup', month: 3, day: 2, level: 'continental', profile: 'gc', jerseys: 'none', stages: [
    s('arg-valley', 'Stage 1 · After the moon'), s('con-early', 'Stage 2 · Mur de Huyon', true), s('vos-sapin', 'Stage 3 · Cote du Sapin'), s('arg-queen', 'Stage 4 · Mur de Lune'),
  ] },
  { id: 'san-mare', name: 'San Mare Classic', month: 3, day: 9, level: 'world', profile: 'hilly', jerseys: 'none', stages: [s('lev-far', 'San Mare Classic')] },
  { id: 'coast-classic', name: 'Coast Classic', month: 3, day: 12, level: 'pro', profile: 'hilly', jerseys: 'none', stages: [s('nor-hilly', 'Coast Classic')] },
  { id: 'flandres', name: 'Flandres Monument', month: 3, day: 15, level: 'world', profile: 'classic', jerseys: 'none', stages: [s('fla-monument', 'Flandres Monument')] },
  { id: 'riviera-tour', name: 'Riviera Tour', month: 3, day: 18, level: 'pro', profile: 'hilly', jerseys: 'none', stages: [
    s('mis-sprint', 'Stage 1 · Valley run-in'), s('mis-hilly', 'Stage 2 · Over the ridge'), s('mis-tt', 'Stage 3 · Town time trial'), s('hcb-aret', 'Stage 4 · Mur des Arêtes'),
  ] },
  { id: 'ridge-race', name: 'Ridge Race', month: 3, day: 23, level: 'pro', profile: 'hilly', jerseys: 'none', stages: [s('cor-pair', 'Ridge Race', true)] },
  { id: 'ardenne-arrow', name: 'Ardenne Arrow', month: 3, day: 25, level: 'world', profile: 'classic', jerseys: 'none', stages: [s('ard-arrow', 'Ardenne Arrow')] },
  { id: 'ardenne-peak', name: 'Ardenne Peak', month: 3, day: 29, level: 'world', profile: 'classic', jerseys: 'none', stages: [s('ard-roche', 'Ardenne Peak')] },
  { id: 'walloon-cup', name: 'Walloon Cup', month: 4, day: 1, level: 'continental', profile: 'classic', jerseys: 'none', stages: [s('lim-chain', 'Walloon Cup')] },
  { id: 'basque-week', name: 'Basque Week', month: 4, day: 5, level: 'world', profile: 'gc', jerseys: 'none', stages: [
    s('sie-false', 'Stage 1 · False flat'), s('sie-cruz', 'Stage 2 · Alto de la Cruz'), s('sie-pena', 'Stage 3 · Peña Roja'), s('sie-run', 'Stage 4 · Red plain'), s('sie-cielo', 'Stage 5 · Alto del Cielo'),
  ] },
  { id: 'hill-cup', name: 'Hill Cup', month: 4, day: 12, level: 'continental', profile: 'hilly', jerseys: 'none', stages: [s('fla-berg', 'Hill Cup')] },
  { id: 'lake-race', name: 'Lake Race', month: 4, day: 14, level: 'world', profile: 'sprint', jerseys: 'none', stages: [s('lake-loop', 'Lake Race')] },
  { id: 'italia-week', name: 'Italia Week', month: 4, day: 16, level: 'pro', profile: 'gc', jerseys: 'none', stages: [
    s('dol-valley', 'Stage 1 · Crown valley'), s('dol-nevoso', 'Stage 2 · Passo Nevoso'), s('dol-tt', 'Stage 3 · Lake time trial'), s('dol-rosa', 'Stage 4 · Forcella Rosa'),
  ] },
  { id: 'regional-tour', name: 'Regional Tour', month: 4, day: 23, level: 'continental', profile: 'hilly', jerseys: 'none', stages: [
    s('fla-semi', 'Stage 1 · South lanes'), s('eif-south', 'Stage 2 · Southern ramps', true), s('fla-north', 'Stage 3 · North lanes'), s('glen-brae', 'Stage 4 · Brae of Loch'),
  ] },
  { id: 'jur-day', name: 'Jura Day', month: 4, day: 29, level: 'continental', profile: 'sprint', jerseys: 'none', stages: [s('jur-valley', 'Jura Day')] },
  { id: 'italy-tour', name: 'Italy Tour', month: 5, day: 3, level: 'world', profile: 'gc', jerseys: 'pink', stages: ITALY },
  { id: 'spring-classic', name: 'Spring Classic', month: 5, day: 10, level: 'pro', profile: 'hilly', jerseys: 'none', stages: [s('lom-lake', 'Spring Classic')] },
  { id: 'continental-alps', name: 'Continental Alps', month: 5, day: 27, level: 'continental', profile: 'gc', jerseys: 'none', stages: [
    s('glen-pass', 'Stage 1 · Pass of Glen'), s('glen-moor', 'Stage 2 · Home moor'), s('dol-grigio', 'Stage 3 · Monte Grigio'), s('arg-tt', 'Stage 4 · Valley time trial'),
  ] },
  { id: 'pass-race', name: 'Pass Race', month: 6, day: 2, level: 'world', profile: 'hilly', jerseys: 'none', stages: [s('jur-cret', 'Pass Race')] },
  { id: 'alpine-week', name: 'Alpine Week', month: 6, day: 4, level: 'world', profile: 'gc', jerseys: 'none', stages: [
    s('arg-hilly', 'Stage 1 · Col du Coteau'), s('pyr-crest', 'Stage 2 · Col du Crest'), s('pyr-foc', 'Stage 3 · Port del Foc'), s('arg-queen', 'Stage 4 · Mur de Lune'), s('mas-down', 'Stage 5 · Descent to the plain'),
  ] },
  { id: 'mountain-week', name: 'Mountain Week', month: 6, day: 12, level: 'pro', profile: 'gc', jerseys: 'none', stages: [
    s('pyr-link', 'Stage 1 · Far valley'), s('hcb-plan', 'Stage 2 · Col du Plan'), s('sie-cruz', 'Stage 3 · Alto de la Cruz'), s('sie-cielo', 'Stage 4 · Alto del Cielo'),
  ] },
  { id: 'crest-race', name: 'Crest Race', month: 6, day: 16, level: 'pro', profile: 'hilly', jerseys: 'none', stages: [s('pyr-link', 'Crest Race')] },
  { id: 'moor-classic', name: 'Moor Classic', month: 6, day: 18, level: 'continental', profile: 'hilly', jerseys: 'none', stages: [s('lim-early', 'Moor Classic')] },
  { id: 'vosges-tour', name: 'Vosges Tour', month: 6, day: 22, level: 'continental', profile: 'gc', jerseys: 'none', stages: [
    s('jur-valley', 'Stage 1 · Jura valley'), s('lim-south', 'Stage 2 · Limburg bergs', true), s('vos-sapin', 'Stage 3 · Cote du Sapin'), s('vos-tt', 'Stage 4 · Forest time trial'), s('vos-ballon', 'Stage 5 · Ballon Noir'), s('vos-after', 'Stage 6 · After the ballon'),
  ] },
  { id: 'queen-race', name: 'Queen Race', month: 6, day: 29, level: 'world', profile: 'gc', jerseys: 'none', stages: [s('arg-queen', 'Queen Race')] },
  { id: 'festival', name: 'Festival Race', month: 7, day: 2, level: 'continental', profile: 'sprint', jerseys: 'none', stages: [s('mis-sprint', 'Festival Race')] },
  { id: 'france-tour', name: 'France Tour', month: 7, day: 4, level: 'world', profile: 'gc', jerseys: 'yellow', stages: FRANCE },
  { id: 'town-race', name: 'Town Race', month: 7, day: 14, level: 'continental', profile: 'sprint', jerseys: 'none', stages: [s('mis-east', 'Town Race')] },
  { id: 'bastille', name: 'Bastille Race', month: 7, day: 26, level: 'continental', profile: 'hilly', jerseys: 'none', stages: [s('lim-early', 'Bastille Race')] },
  { id: 'plateau', name: 'Plateau Race', month: 7, day: 28, level: 'pro', profile: 'gc', jerseys: 'none', stages: [
    s('sie-false', 'Stage 1 · False flat'), s('lim-slena', 'Stage 2 · Slenaken'), s('sie-tt', 'Stage 3 · Evening time trial'), s('sie-cielo', 'Stage 4 · Alto del Cielo'),
  ] },
  { id: 'highland-tour', name: 'Highland Tour', month: 8, day: 4, level: 'continental', profile: 'hilly', jerseys: 'none', stages: [
    s('glen-pass', 'Stage 1 · Pass of Glen'), s('glen-brae', 'Stage 2 · Brae of Loch'), s('glen-moor', 'Stage 3 · Home moor'), s('fla-north', 'Stage 4 · North lanes'),
  ] },
  { id: 'bay-race', name: 'Bay Race', month: 8, day: 9, level: 'continental', profile: 'sprint', jerseys: 'none', stages: [s('lev-town', 'Bay Race')] },
  { id: 'northern-tour', name: 'Northern Tour', month: 8, day: 11, level: 'pro', profile: 'sprint', jerseys: 'none', stages: [
    s('low-a', 'Stage 1 · Plain of the north'), s('eif-east', 'Stage 2 · Eastern ramps', true), s('fla-semi', 'Stage 3 · South lanes'), s('low-tt', 'Stage 4 · Harbour time trial'),
  ] },
  { id: 'spanish-tour', name: 'Spanish Tour', month: 8, day: 16, level: 'world', profile: 'gc', jerseys: 'red', stages: SPAIN },
  { id: 'ria-race', name: 'Ria Race', month: 8, day: 20, level: 'continental', profile: 'hilly', jerseys: 'none', stages: [s('gal-hill', 'Ria Race')] },
  { id: 'harvest', name: 'Harvest Tour', month: 9, day: 8, level: 'continental', profile: 'gc', jerseys: 'none', stages: [
    s('fla-north', 'Stage 1 · North lanes'), s('low-b', 'Stage 2 · Dike road'), s('mis-east', 'Stage 3 · East wind'), s('con-home', 'Stage 4 · Home ramps', true), s('lev-far', 'Stage 5 · Col del Far'),
  ] },
  { id: 'cape-race', name: 'Cape Race', month: 9, day: 12, level: 'continental', profile: 'sprint', jerseys: 'none', stages: [s('gal-cape', 'Cape Race')] },
  { id: 'maple', name: 'Maple Classic', month: 9, day: 14, level: 'world', profile: 'hilly', jerseys: 'none', stages: [s('mis-ridge', 'Maple Classic')] },
  { id: 'autumn', name: 'Autumn Classic', month: 9, day: 17, level: 'pro', profile: 'classic', jerseys: 'none', stages: [s('lim-bergs', 'Autumn Classic')] },
  { id: 'late-sprint', name: 'Late Sprint', month: 9, day: 20, level: 'pro', profile: 'sprint', jerseys: 'none', stages: [s('nor-coast', 'Late Sprint')] },
  { id: 'island-tour', name: 'Island Tour', month: 9, day: 23, level: 'continental', profile: 'gc', jerseys: 'none', stages: [
    s('sic-coast', 'Stage 1 · Coast road'), s('cor-south', 'Stage 2 · Southern capes'), s('sic-vulcano', 'Stage 3 · Vulcano Alto'), s('sic-town', 'Stage 4 · Town finish'),
  ] },
  { id: 'last-hill', name: 'Last Hill', month: 9, day: 29, level: 'pro', profile: 'classic', jerseys: 'none', stages: [s('ard-arrow', 'Last Hill')] },
  { id: 'euro-tt', name: 'European Time Trial', month: 10, day: 2, level: 'champ', profile: 'tt', jerseys: 'none', champ: 'euro-tt', stages: [s('arg-tt', 'European Time Trial')] },
  { id: 'euro-road', name: 'European Road Race', month: 10, day: 4, level: 'champ', profile: 'hilly', jerseys: 'none', champ: 'euro-road', stages: [s('con-all', 'European Road Race')] },
  { id: 'world-tt', name: 'World Time Trial', month: 10, day: 8, level: 'champ', profile: 'tt', jerseys: 'none', champ: 'world-tt', stages: [s('mis-tt', 'World Time Trial')] },
  { id: 'world-road', name: 'World Road Race', month: 10, day: 11, level: 'champ', profile: 'classic', jerseys: 'none', champ: 'world-road', stages: [s('ard-roche', 'World Road Race')] },
];

export function raceById(id: string): RaceDef | undefined {
  return RACES.find((r) => r.id === id);
}

export function raceEnd(race: RaceDef, year = 2026): { month: number; day: number } {
  return raceDays(race, year).at(-1) ?? { month: race.month, day: race.day };
}

export function stageSegment(stage: RaceStage): StageSegment {
  return segmentById(stage.segment);
}

/** Design length in km, without building the 3D road. */
export function stageKm(stage: RaceStage): number {
  const seg = segmentById(stage.segment);
  const def = getRouteDef(seg.world);
  let metres = 0;
  for (let i = seg.from; i <= seg.to; i++) metres += def.sections[i]?.length ?? 0;
  return metres / 1000;
}

export function raceKm(race: RaceDef): number {
  return race.stages.reduce((sum, stage) => sum + stageKm(stage), 0);
}

export function segmentKind(stage: RaceStage): StageKind {
  return segmentById(stage.segment).kind;
}

export function segmentFinish(stage: RaceStage): StageFinish {
  return segmentById(stage.segment).finish;
}

export interface StageClimb {
  name: string;
  km: number;
  grade: number;
  /** Kilometres from the stage start to the top of the climb. */
  atKm: number;
}

export interface StageWindow {
  routeId: string;
  /** Free-ride loop this stage is cut from. */
  routeName: string;
  /** Low point of the road, in metres along the loop. */
  start: number;
  /** High point of the road, in metres along the loop. */
  end: number;
  /** Riders line up here. On a reversed stage this is `end`. */
  from: number;
  /** The finish banner is here. On a reversed stage this is `start`. */
  to: number;
  /** 1 rides toward higher metres. -1 rides back toward the start. */
  dir: 1 | -1;
  reverse: boolean;
  km: number;
  ascent: number;
  kind: StageKind;
  finish: StageFinish;
  /** The road finishes on the last climb, rather than in the valley after it. */
  summitFinish: boolean;
  climbs: StageClimb[];
}

/** A climb the stage profile lists: any part of it is ridden on the stage. */
export function climbOnStage(climb: { start: number; end: number }, start: number, end: number): boolean {
  return climb.end > start + 80 && climb.start < end - 40;
}

/** Summits may sit this far past the stage end (a summit finish) and still count. */
export const SUMMIT_SLACK = 50;

/** A listed climb that also pays mountain points: its summit is on the stage. */
export function climbScoresOnStage(climb: { start: number; end: number }, start: number, end: number): boolean {
  return climbOnStage(climb, start, end) && climb.end <= end + SUMMIT_SLACK;
}

export type TerrainBand = 'flat' | 'hilly' | 'medium' | 'mountain';

/**
 * Climbing in every 10 km of the ridden road.
 * More than 300 m is a mountain. 200–300 m is a medium mountain.
 * 50–200 m is hilly. Under 50 m is flat.
 * A shared edge sits in the higher band, so 200 m is a medium mountain and 50 m is hilly.
 */
export function terrainBand(ascent: number, km: number): TerrainBand {
  const per = km > 0 ? (ascent / km) * 10 : 0;
  if (per > 300) return 'mountain';
  if (per >= 200) return 'medium';
  if (per >= 50) return 'hilly';
  return 'flat';
}

export function terrainLabel(kind: StageKind, band: TerrainBand): string {
  if (kind === 'tt' && band === 'mountain') return 'Mountain time trial';
  if (kind === 'tt' && band === 'medium') return 'Medium mountain time trial';
  if (kind === 'tt' && band === 'hilly') return 'Hilly time trial';
  if (kind === 'tt') return 'Time trial';
  if (band === 'medium') return 'Medium mountain';
  if (band === 'mountain') return 'Mountain';
  if (band === 'hilly') return 'Hilly';
  return 'Flat';
}

/** Badge colour. A flat time trial keeps the purple trial badge. A climbing trial uses its road colour. */
export function terrainBadge(kind: StageKind, band: TerrainBand): string {
  if (kind === 'tt' && band === 'flat') return 'epic';
  return band;
}

export interface TravelClimb {
  name: string;
  /** World position where the riders enter the climb. */
  entry: number;
  /** World position of the top. */
  top: number;
  length: number;
  gain: number;
  avgGrade: number;
}

/** The piece of loop a stage uses, and which way the bunch rides it. */
export function stageCourse(stage: RaceStage): {
  route: ReturnType<typeof getRoute>;
  start: number;
  end: number;
  from: number;
  to: number;
  dir: 1 | -1;
  reverse: boolean;
} {
  const seg = segmentById(stage.segment);
  const route = getRoute(getRouteDef(seg.world));
  const start = route.sectionStart[seg.from] ?? 0;
  const end = seg.to + 1 < route.def.sections.length ? route.sectionStart[seg.to + 1] : route.length - 2;
  const reverse = stage.reverse === true;
  return {
    route,
    start,
    end,
    from: reverse ? end : start,
    to: reverse ? start : end,
    dir: reverse ? -1 : 1,
    reverse,
  };
}

function ascentAlong(route: ReturnType<typeof getRoute>, from: number, to: number): number {
  const dir = to >= from ? 1 : -1;
  const span = Math.abs(to - from);
  const step = 40;
  let ascent = 0;
  let prev = route.elevationAt(from);
  for (let d = step; d <= span + 0.01; d += step) {
    const y = route.elevationAt(from + dir * Math.min(d, span));
    if (y > prev) ascent += y - prev;
    prev = y;
  }
  return ascent;
}

function summitName(route: ReturnType<typeof getRoute>, top: number): string {
  let best = '';
  let bestD = 600;
  for (const climb of route.climbs) {
    const summit = climb.summitElevation >= climb.startElevation ? climb.end : climb.start;
    const distance = Math.abs(summit - top);
    if (distance < bestD) {
      bestD = distance;
      best = climb.name;
    }
  }
  return best;
}

/** Uphill runs in the direction the stage is ridden. A reversed stage climbs the other side of each col. */
export function risesOnCourse(stage: RaceStage): TravelClimb[] {
  const { route, from, to, dir } = stageCourse(stage);
  const span = Math.abs(to - from);
  const step = 20;
  const pts: { d: number; s: number; y: number }[] = [];
  for (let d = 0; d <= span; d += step) pts.push({ d, s: from + dir * Math.min(d, span), y: route.elevationAt(from + dir * Math.min(d, span)) });
  const found: TravelClimb[] = [];
  let i = 0;
  while (i < pts.length - 1) {
    if (pts[i + 1].y <= pts[i].y + 0.3) {
      i += 1;
      continue;
    }
    const begin = i;
    let peak = i;
    let j = i + 1;
    while (j < pts.length) {
      if (pts[j].y >= pts[peak].y - 0.01) peak = j;
      if (pts[peak].y - pts[j].y >= 8) break;
      j += 1;
    }
    const gain = pts[peak].y - pts[begin].y;
    const length = pts[peak].d - pts[begin].d;
    const name = summitName(route, pts[peak].s);
    if (name && gain >= 18 && length >= 180 && gain / Math.max(1, length) >= 0.025) {
      found.push({
        name,
        entry: pts[begin].s,
        top: pts[peak].s,
        length,
        gain,
        avgGrade: gain / length,
      });
    }
    i = Math.max(j, begin + 1);
  }
  const byName = new Map<string, TravelClimb>();
  for (const climb of found) {
    const had = byName.get(climb.name);
    if (!had || climb.gain > had.gain) byName.set(climb.name, climb);
  }
  return [...byName.values()].sort((a, b) => (a.entry - from) * dir - (b.entry - from) * dir);
}

/** The piece of road a stage actually uses, plus the climbs that sit on it. */
export function stageWindow(stage: RaceStage): StageWindow {
  const seg = segmentById(stage.segment);
  const course = stageCourse(stage);
  const { route, start, end, from, to, dir, reverse } = course;
  let ascent = 0;
  if (reverse) ascent = ascentAlong(route, from, to);
  else {
    const step = 40;
    let prev = route.elevationAt(start);
    for (let s = start + step; s <= end; s += step) {
      const y = route.elevationAt(Math.min(s, end));
      if (y > prev) ascent += y - prev;
      prev = y;
    }
  }
  const climbs = reverse
    ? risesOnCourse(stage).map((climb) => ({
      name: climb.name,
      km: climb.length / 1000,
      grade: climb.avgGrade * 100,
      atKm: Math.abs(climb.top - from) / 1000,
    }))
    : route.climbs
      .filter((climb) => climbOnStage(climb, start, end))
      .map((climb) => ({ name: climb.name, km: climb.length / 1000, grade: climb.avgGrade * 100, atKm: Math.max(0, climb.end - start) / 1000 }));
  const km = Math.max(0, end - start) / 1000;
  const topAt = climbs.reduce((max, climb) => Math.max(max, climb.atKm), 0);
  return {
    routeId: seg.world,
    routeName: route.def.name,
    start,
    end,
    from,
    to,
    dir,
    reverse,
    km,
    ascent,
    kind: seg.kind,
    finish: seg.finish,
    summitFinish: climbs.length > 0 && km - topAt < 0.8,
    climbs,
  };
}

/** Short walls one after another. A rider needs hills and a sprint, not a long mountain. */
export function punchyStage(stage: RaceStage): boolean {
  const window = stageWindow(stage);
  if (window.kind !== 'road' || window.climbs.length < 2) return false;
  return window.climbs.every((climb) => climb.km <= 1.6);
}

/** Every calendar day a race occupies, including a stage race that runs into the next month. */
export function raceDays(race: RaceDef, year = 2026): { month: number; day: number }[] {
  const days: { month: number; day: number }[] = [];
  let month = race.month;
  let day = race.day;
  for (let i = 0; i < race.stages.length; i++) {
    days.push({ month, day });
    day += 1;
    const inMonth = new Date(year, month, 0).getDate();
    if (day > inMonth) {
      day = 1;
      month += 1;
    }
  }
  return days;
}

export function canEnter(level: RaceLevel, division: 'world' | 'pro' | 'continental'): boolean {
  if (level === 'champ') return true;
  if (level === 'world') return division === 'world' || division === 'pro';
  if (level === 'pro') return true;
  return division !== 'world';
}

export function dayKey(slot: { month: number; day: number }): string {
  return `${slot.month}-${slot.day}`;
}

/** True when the two races take the same calendar day. A rider can start only one of them. */
export function sharesDay(a: RaceDef, b: RaceDef, year = 2026): boolean {
  const days = new Set(raceDays(a, year).map(dayKey));
  return raceDays(b, year).some((slot) => days.has(dayKey(slot)));
}

/** January through every month that has a race, including a January with nothing on it. */
export function monthsFor(_division: 'world' | 'pro' | 'continental', year = 2026): number[] {
  const months = new Set<number>([1]);
  for (const race of RACES) {
    for (const slot of raceDays(race, year)) months.add(slot.month);
  }
  return [...months].sort((a, b) => a - b);
}

export const MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function formatDate(month: number, day: number): string {
  return `${MONTHS[month]} ${day}`;
}
