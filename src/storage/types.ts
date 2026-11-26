import type { TimeOfDay } from '../world/atmosphere';
import type { BikeBrand } from '../world/bikes';
import type { GraphicsQuality } from '../world/graphics';
import type { RiderColors } from '../world/riders';
import type { CameraMode } from '../world/world';

/** Cameras the rider can pick while riding. */
export type RideCamera = Exclude<CameraMode, 'flyover' | 'garage' | 'showcase'>;
/** Nearby road, a wider stretch of it, or the whole loop. */
export type RideMap = 'ahead' | 'wide' | 'loop';

export interface Profile {
  id: 'me';
  name: string;
  weightKg: number;
  ftp: number;
  /** 0..100: how much of the real gradient the trainer simulates. */
  difficulty: number;
  colors: RiderColors;
  /** Spent in Equipment. One Coin for each full kilometre of a saved ride. */
  coins: number;
  ownedFrames: BikeBrand[];
  ownedWheels: BikeBrand[];
  graphics: GraphicsQuality;
  timeOfDay: TimeOfDay;
  /** Last camera chosen while riding. */
  camera: RideCamera;
  /** Last map chosen while riding. */
  map: RideMap;
  createdAt: string;
  updatedAt: string;
}

/** One sample per second. */
export interface RideSample {
  t: number;
  power: number;
  cadence: number;
  heartRate: number;
  speed: number;
  distance: number;
  altitude: number;
  grade: number;
}

export interface WorkoutResult {
  planId: string;
  workoutId: string;
  name: string;
  /** 0–100, share of the steady efforts spent on the target. Null when there was nothing to score. */
  compliance: number | null;
  ftpEstimate: number | null;
  /** ramp climbs each minute. twenty is the self-paced 20-minute test. */
  ftpKind?: 'ramp' | 'twenty' | null;
  /** Average power across the 20-minute effort. */
  ftpAverage?: number | null;
  /** FTP on the profile when this test was scored, before it was replaced. */
  previousFtp?: number | null;
  weightKg?: number | null;
  completed: boolean;
}

export interface HillClimbResult {
  name: string;
  country: string;
  /** Null for a rider who did not finish. */
  timeSec: number | null;
  /** The effort the rider set out with. For you, the average you rode. */
  wkg: number;
  /** Part of that effort an AI rider lost near the top, 0 to 1. */
  drop: number;
  player?: boolean;
}

/** What a Hill climb race was, kept with the ride for the list of your races. */
export interface HillClimbRecord {
  climbName: string;
  lengthM: number;
  gainM: number;
  /** Rise over run: 0.08 is 8 %. */
  avgGrade: number;
  weightKg: number;
  ftp: number;
  aiCount: number;
  /** The Strongest and Slowest settings the race was started with, W/kg. */
  topWkg: number;
  bottomWkg: number;
  /** The finishing order. */
  results: HillClimbResult[];
}

export interface RideSummary {
  id: string;
  createdAt: string;
  updatedAt: string;
  startedAt: string;
  mode: 'free' | 'race' | 'train';
  workout?: WorkoutResult;
  routeId: string;
  routeName: string;
  climbId?: string;
  title: string;
  durationSec: number;
  movingSec: number;
  distanceM: number;
  ascentM: number;
  avgPower: number;
  maxPower: number;
  normalizedPower: number;
  avgCadence: number;
  avgHeartRate: number;
  maxHeartRate: number;
  avgSpeedKmh: number;
  laps?: number;
  race?: { position: number; field: number; finishTimeSec: number | null; winnerTimeSec: number | null; hill?: HillClimbRecord };
  hasFit: boolean;
}

export interface ClimbEffort {
  id: string;
  climbId: string;
  climbName: string;
  routeId?: string;
  routeName?: string;
  /** Segment length in metres. */
  lengthM?: number;
  rideId: string;
  createdAt: string;
  timeSec: number;
  avgPower: number;
  wkg: number;
}

/** An unfinished ride snapshot, so a browser crash doesn't lose the whole ride. */
export interface ActiveRideSnapshot {
  id: 'current';
  summary: RideSummary;
  samples: RideSample[];
  savedAt: string;
}

/**
 * All persistence goes through this interface.
 * v1 uses IndexedDB; a Supabase implementation can be added later without touching the game.
 */
export interface StorageProvider {
  getProfile(): Promise<Profile | null>;
  saveProfile(p: Profile): Promise<void>;
  /** Removes the saved rider profile (used when another account signs in on this computer). */
  clearProfile(): Promise<void>;
  listRides(): Promise<RideSummary[]>;
  getRide(id: string): Promise<RideSummary | null>;
  saveRide(summary: RideSummary, samples: RideSample[], fit: Uint8Array | null): Promise<void>;
  deleteRide(id: string): Promise<void>;
  getRideSamples(id: string): Promise<RideSample[] | null>;
  getRideFit(id: string): Promise<Uint8Array | null>;
  listClimbEfforts(climbId?: string): Promise<ClimbEffort[]>;
  saveClimbEffort(e: ClimbEffort): Promise<void>;
  saveActiveRide(s: ActiveRideSnapshot): Promise<void>;
  getActiveRide(): Promise<ActiveRideSnapshot | null>;
  clearActiveRide(): Promise<void>;
  /** Removes saved rides, samples, FIT files, climb efforts, and any unfinished ride. The rider profile stays. */
  clearRideHistory(): Promise<void>;
}
