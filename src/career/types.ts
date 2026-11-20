import type { RaceAttrs, RoadTactic } from '../ai/road';

export type Division = 'world' | 'pro' | 'continental';
export type Focus = 'sprint' | 'classics' | 'stage';
export type RaceLevel = 'world' | 'pro' | 'continental' | 'champ';
export type RaceProfile = 'sprint' | 'hilly' | 'classic' | 'gc' | 'tt';
export type JerseyColor = 'yellow' | 'pink' | 'red' | 'none';
export type Program = 'gc' | 'sprint' | 'classic' | 'hill' | 'tt' | 'helper';

export interface ClassRow {
  riderId: string;
  name: string;
  teamId: string;
  country: string;
  age: number;
  value: number;
  /** Overall time only: sum of stage places, which splits equal times. */
  places?: number;
  /** Overall time only: stages finished. A rider who missed one is out of the classification. */
  stages?: number;
}

export interface ActiveRace {
  raceId: string;
  /** Index of the next stage to ride. */
  stageIndex: number;
  gc: ClassRow[];
  sprint: ClassRow[];
  kom: ClassRow[];
  stageWinners: { name: string; riderId: string; label: string }[];
  /** Teammate ids on the start line. Chosen before the first stage, then kept for the race. */
  squad?: string[];
  /** Everyone who started stage 1, apart from the player. They ride every later stage. */
  startList?: string[];
}

export interface PodiumSpot {
  riderId: string;
  name: string;
  team: string;
}

/** One line of a classification kept for the season standings. */
export interface ResultSheet {
  riderId: string;
  name: string;
  teamId: string;
  value: number;
}

export interface SavedRace {
  raceId: string;
  name: string;
  year: number;
  winnerId: string;
  winnerName: string;
  winnerTeam: string;
  /** First, second and third. Older saves may only have the winner. */
  podium?: PodiumSpot[];
  playerPlace: number | null;
  skipped: boolean;
  /** Final classifications. Present for races held after this was added. */
  time?: ResultSheet[];
  sprint?: ResultSheet[];
  mountains?: ResultSheet[];
}

/** A stage the player actually rode. Kept on the record across seasons. */
export interface StageNote {
  year: number;
  raceId: string;
  race: string;
  stage: string;
  place: number;
  time: number;
}

export interface PalmaresEntry {
  year: number;
  raceId: string;
  name: string;
  place: number;
  kind: 'stage' | 'overall' | 'one-day' | 'champ';
}

export interface ContractOffer {
  teamId: string;
  blurb: string;
}

export interface Champions {
  worldRoad?: string;
  worldTt?: string;
  euroRoad?: string;
  euroTt?: string;
}

export interface CareerState {
  version: 1;
  year: number;
  age: number;
  nation: string;
  teamId: string;
  flatWkg: number;
  hillWkg: number;
  mountainWkg: number;
  /** Watts per kilo a time trial is ridden at. */
  ttWkg: number;
  tactic: RoadTactic;
  entered: string[];
  /** Set once, so emptying the calendar later does not tick every race again. */
  enteredSeeded?: boolean;
  /** Race ids the player has already been offered. New races get ticked; unticked ones stay off. */
  seenRaces?: string[];
  /** Races the player switched off. They stay off, and they are not the next race. */
  declined?: string[];
  done: string[];
  skipped: string[];
  active: ActiveRace | null;
  races: SavedRace[];
  /** Winners kept after you sign for a new season. */
  history: SavedRace[];
  cyb: Record<string, number>;
  /** Points from Pro and Continental races. */
  cont?: Record<string, number>;
  /** Yellow, pink and red, worn only after that tour has finished. */
  jerseyWear?: Partial<Record<'yellow' | 'pink' | 'red', string>>;
  wins: Record<string, number>;
  teamPoints: Record<string, number>;
  palmares: PalmaresEntry[];
  /** Every stage the player has ridden, newest last. */
  stageNotes?: StageNote[];
  champions: Champions;
  offers: ContractOffer[] | null;
}

export type { RaceAttrs };
