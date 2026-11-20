import type { Biome } from '../types';

/**
 * A real, named climb. The profile is the published average gradient of each
 * kilometre from the foot, so the road you ride matches the one on the mountain:
 * same length, same gain, same steep kilometres.
 */
export interface RealClimb {
  id: string;
  name: string;
  /** The side you ride, named after the town at the foot. */
  side: string;
  country: string;
  region: string;
  lengthKm: number;
  startElevation: number;
  summitElevation: number;
  gain: number;
  avgGrade: number;
  maxGrade: number;
  /** Real hairpin count, or 0 when the road has none worth counting. */
  hairpins: number;
  /** True when the count is published. Otherwise it is an estimate from the climb's size. */
  hairpinsKnown?: boolean;
  /** How the max grade was measured, and the steeper short ramps riders quote. */
  maxGradeNote?: string | null;
  /** Average gradient of each kilometre, foot to summit. The last one may be a partial km. */
  kmGrades: number[];
  /** Length of the last entry in kmGrades, in km (1 when the climb ends on a whole km). */
  lastKmLength: number;
  /** Where along the climb the hairpins sit: 'top' (most in the upper part), 'bottom', 'even', 'steep'. */
  hairpinsWhere?: 'top' | 'bottom' | 'even' | 'steep';
  description: string;
  famousFor: string;
  /** Scenery hints. Treeline and snowline are real elevations. */
  biome?: Biome;
  treeline?: number;
  snowline?: number;
  /** 0..1. How much of the ground below the treeline is woodland. Omitted uses the usual alpine forest. */
  forestDensity?: number;
  /** The slopes above the treeline are grazed grass, not scree. */
  pasture?: boolean;
  /** Where the ground turns to loose gravel, in metres. Trees still follow the treeline. */
  screeLine?: number;
  /** Lake or sea next to the foot. */
  waterLevel?: number | null;
  sources: string[];
}

/** One thing that happens on a stage, at a kilometre from the stage start. */
export type StagePoint =
  | { km: number; type: 'climb'; climb: string; category?: 'HC' | '1' | '2' | '3' | '4' }
  | {
      km: number;
      type: 'climb';
      climb: { name: string; lengthKm: number; avgGrade: number; kmGrades?: number[] };
      category?: 'HC' | '1' | '2' | '3' | '4';
    }
  | { km: number; type: 'sprint'; name: string };

export type StageFinish = 'summit' | 'descent' | 'sprint' | 'hill';

/** A famous kind of pro stage, built from real climbs. `km` of a climb is where its summit is. */
export interface RealStage {
  id: string;
  name: string;
  /** The real race day this is modelled on, in plain words. */
  inspiredBy: string;
  description: string;
  totalKm: number;
  startElevation: number;
  finish: StageFinish;
  /** Character of the road between the named climbs. */
  terrain: 'flat' | 'rolling' | 'hilly' | 'mountain';
  points: StagePoint[];
  biome?: Biome;
  treeline?: number;
  snowline?: number;
}
