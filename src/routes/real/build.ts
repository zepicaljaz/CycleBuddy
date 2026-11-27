import { mulberry32 } from '../../util/math';
import { bend, descent, level, rolling } from '../sections';
import type { ClimbDef, Difficulty, RouteDef, SectionDef, SectionStyle, TownDef, TraceStep, TrackDef } from '../types';
import { REAL_CLIMBS } from './data';
import type { RealClimb, RealStage, StagePoint } from './types';
import TRACK_INDEX from './trackIndex.json';
import { kmPieces, piecesGain, piecesToGrades, type GradePiece } from '../grades';

export { kmPieces, piecesGain, piecesToGrades, type GradePiece };

/** Two legs of a hairpin are this far off the valley line, in degrees. The builder clamps at about 73°. */
const PIN_DEG = 72;
const PIN_R = 13;

export function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * Where the hairpins sit along a climb, in metres from the foot. The total is the
 * real count. Real roads stack their hairpins where the slope is steep and, on the
 * big passes, high up where the valley closes in.
 */
export function hairpinPositions(pieces: GradePiece[], count: number, where: RealClimb['hairpinsWhere'] = 'steep'): number[] {
  if (count <= 0) return [];
  const { length, grades } = piecesToGrades(pieces);
  const n = grades.length;
  const step = length / n;
  const weights = grades.map((g, i) => {
    const pos = (i + 0.5) / n;
    const steep = Math.max(0.15, g - 4.5);
    if (where === 'even') return 1;
    if (where === 'top') return steep * (0.2 + pos * pos * 2);
    if (where === 'bottom') return steep * (0.2 + (1 - pos) * (1 - pos) * 2);
    return steep * steep;
  });
  // Keep the first and last 150 m clear: the town at the foot and the summit.
  const margin = Math.min(150, length * 0.05);
  const total = weights.reduce((sum, w, i) => {
    const mid = (i + 0.5) * step;
    return mid < margin || mid > length - margin ? sum : sum + w;
  }, 0);
  const out: number[] = [];
  let acc = 0;
  let next = 0.5;
  for (let i = 0; i < n && out.length < count; i++) {
    const mid = (i + 0.5) * step;
    if (mid < margin || mid > length - margin) continue;
    const w = (weights[i] / total) * count;
    while (acc + w >= next && out.length < count) {
      const t = (next - acc) / w;
      out.push(i * step + t * step);
      next += 1;
    }
    acc += w;
  }
  // A hairpin and its two legs need about 55 m. Spread any that came out closer.
  const MIN_GAP = 58;
  for (let pass = 0; pass < 4; pass++) {
    for (let i = 1; i < out.length; i++) {
      if (out[i] - out[i - 1] < MIN_GAP) out[i] = out[i - 1] + MIN_GAP;
    }
    const over = out.length ? out[out.length - 1] - (length - margin) : 0;
    if (over > 0) for (let i = 0; i < out.length; i++) out[i] -= over * ((i + 1) / out.length);
  }
  return out;
}

/**
 * The bends of a real climb as traced steps: stacks of switchbacks where the
 * hairpins are, gentle bends in between. Distances are approximate; the builder
 * runs the steps until the section ends.
 */
export function hairpinTrace(length: number, pins: number[], seed: number): SectionStyle {
  const rng = mulberry32(seed);
  const steps: TraceStep[] = [];
  let head = 0;
  let used = 0;
  let lateral = 0;
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const push = (heading: number, radius: number, hold: number) => {
    const r = Math.max(PIN_R, radius);
    const arc = Math.abs(rad(heading - head)) * r;
    const h = Math.max(0, hold);
    steps.push({ heading, hold: h, radius: r });
    lateral += Math.sin(rad(heading)) * h;
    used += arc + h;
    head = heading;
  };
  const wander = (until: number) => {
    let sign = lateral > 40 ? -1 : lateral < -40 ? 1 : rng() < 0.5 ? -1 : 1;
    while (until - used > 120) {
      const heading = sign * (5 + rng() * 14);
      const r = 40 + rng() * 30;
      const arc = Math.abs(rad(heading - head)) * r;
      const seg = Math.min(until - used - arc, 180 + rng() * 220);
      if (seg < 40) break;
      push(heading, r, seg);
      sign = lateral > 60 ? -1 : lateral < -60 ? 1 : -sign;
    }
  };

  let side = 1;
  for (let k = 0; k < pins.length; k++) {
    const p = pins[k];
    const prev = pins[k - 1];
    const next = pins[k + 1];
    const stacked = prev !== undefined && p - prev < 300;
    if (!stacked) {
      // Approach: wander up the slope, then turn onto a traverse just before the hairpin.
      const approachArc = rad(PIN_DEG) * 26;
      wander(p - 70 - approachArc);
      side = lateral > 0 ? 1 : -1;
      push(-side * PIN_DEG, 26, Math.max(10, p - used - PIN_R * rad(PIN_DEG * 2) * 0.5));
    }
    const turnArc = rad(PIN_DEG * 2) * PIN_R;
    const gap = next !== undefined && next - p < 300 ? next - p : 70;
    push(side * PIN_DEG, PIN_R, Math.max(8, gap - turnArc));
    side = -side;
    if (next === undefined || next - p >= 300) {
      // Leave the stack back onto a gentle line.
      push(Math.sign(-lateral || 1) * (6 + rng() * 8), 30, 40);
    }
  }
  wander(length - 60);
  return { kind: 'traced', steps };
}

function difficultyFor(gain: number): Difficulty {
  if (gain >= 1300) return 'epic';
  if (gain >= 500) return 'mountain';
  return 'hilly';
}

function climbStyle(c: { pieces: GradePiece[]; hairpins: number; where?: RealClimb['hairpinsWhere']; seed: number }): SectionStyle {
  const length = c.pieces.reduce((sum, p) => sum + p.metres, 0);
  if (c.hairpins >= 2) return hairpinTrace(length, hairpinPositions(c.pieces, c.hairpins, c.where), c.seed);
  return length < 2000 ? bend(24, 180) : bend(40, 240);
}

/**
 * A loop around one real climb. A short valley road to the foot, the climb exactly
 * as published, a little summit plateau, then a descent and a valley back. Free
 * rides lap it; hill-climb races start at the foot and finish on the summit.
 */
type TrackTown = { name: string; fromM: number; toM: number };
type TrackFile = TrackDef & { id: string; sections: number[]; town?: TrackTown; towns?: TrackTown[]; climbFromSection?: number };

/**
 * Real road lines built by scripts/real-track/build.mjs. The file name is the climb id.
 * Perf: lazy glob. The tracks are ~1.6 MB of JSON (5,800-12,600 points each); eager,
 * they sat in the boot chunk and every player downloaded and parsed all of them before
 * the menu. Each file is now its own chunk, fetched by `ensureTrack` when a screen or a
 * ride needs that road. The glob keys alone say which roads exist.
 */
const TRACK_LOADERS = new Map(
  Object.entries(import.meta.glob('./tracks/*.json', { import: 'default' }) as Record<string, () => Promise<TrackFile>>).map(
    ([path, load]) => [path.slice(path.lastIndexOf('/') + 1, -'.json'.length), load] as const,
  ),
);
/** Tracks fetched so far, by id. */
const TRACKS = new Map<string, TrackFile>();
const trackLoads = new Map<string, Promise<void>>();

export function hasRealRoad(id: string): boolean {
  return TRACK_LOADERS.has(id);
}

/** True when `realClimbRoute` can build this climb now: it has no real road, or its track is fetched. */
export function trackReady(id: string): boolean {
  return !TRACK_LOADERS.has(id) || TRACKS.has(id);
}

/** True when every real road's track is fetched. */
export function allTracksReady(): boolean {
  return TRACKS.size === TRACK_LOADERS.size;
}

/** Fetches one real road's track (once). Resolves at once for climbs without a real road. */
export function ensureTrack(id: string): Promise<void> {
  const load = TRACK_LOADERS.get(id);
  if (!load || TRACKS.has(id)) return Promise.resolve();
  let p = trackLoads.get(id);
  if (!p) {
    p = load().then((t) => {
      if (t.id !== id) throw new Error(`tracks/${id}.json has id "${t.id}": the file name must be the climb id`);
      TRACKS.set(id, t);
    });
    // A failed fetch (offline, a new deploy) may be retried by the next caller.
    p.catch(() => trackLoads.delete(id));
    trackLoads.set(id, p);
  }
  return p;
}

/** Fetches every real road's track. The hill-climb list and the Real climbs list need them all. */
export function ensureAllTracks(): Promise<void> {
  return Promise.all([...TRACK_LOADERS.keys()].map(ensureTrack)).then(() => undefined);
}

/** The real-road climbs, by name. These are the Free ride "Real climbs" category. */
export function realRoadClimbs(): RealClimb[] {
  return REAL_CLIMBS.filter((c) => TRACK_LOADERS.has(c.id)).sort((a, b) => a.name.localeCompare(b.name));
}

/** Difficulty of a climb on its real road, without its track (the list shows it before tracks arrive). */
export function realRoadDifficulty(c: RealClimb): Difficulty {
  return difficultyFor(c.summitElevation - c.startElevation);
}

/**
 * A climb on its real road: the OpenStreetMap line with the published profile laid
 * along it, up and back down the same way. Section 0 is the valley before the
 * published profile, section 1 the profile, section 2 the turn at the top, the
 * descent and the turn at the bottom. climbFromSection 0 starts the ride at the
 * beginning of the valley (Vršič, in Kranjska Gora).
 */
/** A town measured from the start of the road, placed in whichever section that distance falls in. */
function townOnTrack(sections: number[], place: TrackTown): TownDef {
  const mid = (place.fromM + place.toM) / 2;
  let start = 0;
  let section = 0;
  for (let s = 0; s < sections.length; s++) {
    const len = sections[s];
    if (len <= 0) continue;
    section = s;
    if (mid <= start + len) break;
    start += len;
  }
  return { name: place.name, section, along: mid - start, length: Math.max(180, place.toM - place.fromM) };
}

function trackClimbRoute(c: RealClimb, t: TrackFile): RouteDef {
  const seed = hashId(c.id) % 100000;
  const avg = (sec: number) => {
    let first = -1;
    let last = -1;
    t.sec.forEach((s, i) => {
      if (s !== sec) return;
      if (first < 0) first = i;
      last = i;
    });
    if (first < 0 || t.sections[sec] <= 0) return 0;
    return Math.max(-25, Math.min(25, ((t.y[last] - t.y[first]) / t.sections[sec]) * 100));
  };
  const sections: SectionDef[] = t.sections.map((length, i) => ({ length: Math.max(1, length), grades: [avg(i)], style: { kind: 'straight' } }));
  const relief = c.summitElevation - c.startElevation;
  const places = t.towns ?? (t.town ? [t.town] : [{ name: c.side, fromM: 0, toM: 800 }]);
  return {
    id: c.id,
    name: c.name,
    description: c.description,
    difficulty: realRoadDifficulty(c),
    seed,
    startElevation: t.y[0],
    sections,
    climbs: [{ id: c.id, name: c.name, inspiredBy: `From ${c.side} · ${c.country}`, fromSection: t.climbFromSection ?? 1, toSection: 1 }],
    scenery: {
      mountainHeight: Math.max(500, Math.min(2200, relief * 1.25 + 300)),
      treeline: c.treeline ?? 2050,
      snowline: c.snowline ?? 2850,
      screeLine: c.screeLine,
      waterLevel: null,
      forestDensity: c.forestDensity ?? 0.78,
      biome: c.biome,
      pasture: c.pasture,
      pastureAbove: c.pastureAbove,
      broadleaf: c.broadleaf,
      openAlong: c.openAlong,
    },
    towns: places.map((place) => townOnTrack(t.sections, place)),
    track: t,
  };
}

/**
 * The climb's route. A climb with a real road needs its track fetched first
 * (`ensureTrack`); building it before would cache a generated road under the same id
 * in `getRoute`, so that throws instead of falling back.
 */
export function realClimbRoute(c: RealClimb): RouteDef {
  const track = TRACKS.get(c.id);
  if (track) return trackClimbRoute(c, track);
  if (TRACK_LOADERS.has(c.id)) throw new Error(`Real road "${c.id}" is not loaded yet: await ensureTrack("${c.id}") first`);
  const seed = hashId(c.id) % 100000;
  const pieces = kmPieces(c.kmGrades, c.lastKmLength);
  const { length, grades } = piecesToGrades(pieces);
  const climbSection: SectionDef = {
    length,
    grades,
    style: climbStyle({ pieces, hairpins: c.hairpins, where: c.hairpinsWhere, seed }),
  };
  const gain = piecesGain(pieces);
  const downKm = Math.max(6, Math.min(40, (gain / 1000) / 0.068));
  const sections: SectionDef[] = [
    level(3, bend(30, 300), 1.6),
    climbSection,
    level(0.8, bend(20, 200)),
    descent(downKm, -Math.min(8, (gain / (downKm * 1000)) * 100), seed + 3, bend(46, 260)),
    rolling(6, 2.6, seed + 5, bend(36, 320)),
    level(4, bend(30, 300)),
  ];
  const climbs: ClimbDef[] = [{ id: c.id, name: c.name, inspiredBy: `From ${c.side} · ${c.country}`, fromSection: 1, toSection: 1 }];
  const relief = c.summitElevation - c.startElevation;
  return {
    id: c.id,
    name: c.name,
    description: c.description,
    difficulty: difficultyFor(gain),
    seed,
    startElevation: c.startElevation,
    sections,
    climbs,
    scenery: {
      mountainHeight: Math.max(500, Math.min(2200, relief * 1.25 + 300)),
      treeline: c.treeline ?? 2050,
      snowline: c.snowline ?? 2850,
      screeLine: c.screeLine,
      waterLevel: c.waterLevel ?? null,
      forestDensity: 0.72,
      biome: c.biome,
    },
    towns: [{ name: c.side, section: 0, along: 2100, length: 300 }],
  };
}

export interface StageMark {
  kind: 'climb' | 'sprint';
  name: string;
  /** Section the mark sits in, and how far along it (0..1). Turned into metres once the road is built. */
  section: number;
  frac: number;
  category?: string;
  climbId?: string;
}

export interface StageRoute {
  def: RouteDef;
  /** First section after the finish line. The road beyond it only closes the loop. */
  finishSection: number;
  marks: StageMark[];
}

type InlineClimb = { name: string; lengthKm: number; avgGrade: number; kmGrades?: number[] };

function inlinePieces(c: InlineClimb): GradePiece[] {
  if (c.kmGrades?.length) {
    const whole = Math.floor(c.lengthKm);
    const last = c.lengthKm - whole;
    return kmPieces(c.kmGrades, c.kmGrades.length > whole && last > 0.05 ? last : 1);
  }
  return [{ metres: c.lengthKm * 1000, grade: c.avgGrade }];
}

/** Valley road between two points of a stage, in pieces of at most 12 km. */
function valley(km: number, terrain: RealStage['terrain'], seed: number): SectionDef[] {
  const out: SectionDef[] = [];
  let left = km;
  let i = 0;
  while (left > 0.25) {
    const take = left > 14 ? 12 : left;
    if (terrain === 'flat') out.push(level(take, bend(30, 340)));
    else {
      const amp = terrain === 'rolling' ? 2.6 : terrain === 'hilly' ? 3.8 : 3.2;
      out.push(rolling(take, amp, seed + i * 31, bend(38, 300)));
    }
    left -= take;
    i++;
  }
  return out;
}

/** A gentle valley rise or a descent so the road reaches `toElev` over `km`. */
function slope(km: number, fromElev: number, toElev: number, seed: number, terrain: RealStage['terrain']): SectionDef[] {
  const drop = toElev - fromElev;
  if (km < 0.3) return [];
  if (Math.abs(drop) < 40) return valley(km, terrain, seed);
  if (drop < 0) {
    // Come down at about 6.5%, then the rest is valley.
    const downKm = Math.min(km, Math.max(2, -drop / 65));
    const pct = Math.max(-8.5, (drop / (downKm * 1000)) * 100);
    return [descent(downKm, pct, seed, bend(46, 260)), ...valley(km - downKm, terrain, seed + 7)];
  }
  // A valley that rises toward the next climb: a false flat of at most 2.5%.
  const pct = Math.min(2.5, (drop / (km * 1000)) * 100);
  const sections: SectionDef[] = [];
  let left = km;
  while (left > 0.25) {
    const take = left > 14 ? 12 : left;
    sections.push({ length: take * 1000, grades: [pct * 0.8, pct * 1.1, pct * 0.9, pct * 1.2], style: bend(34, 320) });
    left -= take;
  }
  return sections;
}

/**
 * A pro stage as one road: the valleys, every climb with its real profile, and the
 * run-in. A return road closes the loop after the line and is never raced.
 */
export function realStageRoute(stage: RealStage, climbs: Map<string, RealClimb>): StageRoute {
  const seed = hashId(stage.id) % 100000;
  const sections: SectionDef[] = [];
  const marks: StageMark[] = [];
  const climbDefs: ClimbDef[] = [];
  let km = 0;
  let elev = stage.startElevation;
  const points = [...stage.points].sort((a, b) => a.km - b.km);
  sections.push(...valley(Math.min(4, points[0]?.km ?? 4), stage.terrain === 'flat' ? 'flat' : 'rolling', seed));
  km = sections.reduce((sum, s) => sum + s.length, 0) / 1000;

  const placeOnRoad = (atKm: number): { section: number; frac: number } => {
    let start = 0;
    for (let i = 0; i < sections.length; i++) {
      const len = sections[i].length / 1000;
      if (atKm <= start + len) return { section: i, frac: Math.max(0, Math.min(1, (atKm - start) / len)) };
      start += len;
    }
    return { section: sections.length - 1, frac: 1 };
  };

  const sprints: { km: number; name: string }[] = [];
  points.forEach((point: StagePoint, index) => {
    if (point.type === 'sprint') {
      sprints.push({ km: point.km, name: point.name });
      return;
    }
    const real = typeof point.climb === 'string' ? climbs.get(point.climb) : undefined;
    const inline = typeof point.climb === 'string' ? undefined : point.climb;
    if (!real && !inline) return;
    const pieces = real ? kmPieces(real.kmGrades, real.lastKmLength) : inlinePieces(inline!);
    const lengthKm = pieces.reduce((sum, p) => sum + p.metres, 0) / 1000;
    const footKm = Math.max(km, point.km - lengthKm);
    const footElev = real ? real.startElevation : elev;
    sections.push(...slope(footKm - km, elev, footElev, seed + index * 97, stage.terrain));
    km = sections.reduce((sum, s) => sum + s.length, 0) / 1000;
    elev = footElev;
    const { length, grades } = piecesToGrades(pieces);
    const name = real?.name ?? inline!.name;
    sections.push({
      length,
      grades,
      style: climbStyle({ pieces, hairpins: real?.hairpins ?? 0, where: real?.hairpinsWhere, seed: seed + index * 13 }),
    });
    const idx = sections.length - 1;
    climbDefs.push({ id: `${stage.id}-${index}`, name, inspiredBy: real ? `From ${real.side}` : point.category ? `Cat. ${point.category}` : 'Climb on the stage', fromSection: idx, toSection: idx });
    marks.push({ kind: 'climb', name, section: idx, frac: 1, category: point.category, climbId: real?.id });
    km += length / 1000;
    elev += piecesGain(pieces);
  });

  // A summit or uphill finish sits on the last climb only when that climb tops out
  // at the end of the stage. Otherwise there is road after it (Mortirolo, then the
  // drag up to Ponte di Legno) and the stage gets its run-in.
  const lastClimbKm = [...stage.points].reverse().find((p) => p.type === 'climb')?.km ?? 0;
  const lastClimbAtEnd = (stage.finish === 'summit' || stage.finish === 'hill') && stage.totalKm - lastClimbKm < 2;
  if (!lastClimbAtEnd) {
    const runIn = Math.max(1, stage.totalKm - km);
    sections.push(...slope(runIn, elev, stage.startElevation + (stage.finish === 'descent' ? 0 : 20), seed + 501, stage.terrain === 'mountain' ? 'rolling' : stage.terrain));
    elev = stage.startElevation;
  } else {
    // The line is a few hundred metres past the top of the last climb.
    sections.push(level(0.3, bend(16, 200)));
  }
  const finishSection = sections.length;

  for (const sprint of sprints) {
    const at = placeOnRoad(sprint.km);
    marks.push({ kind: 'sprint', name: sprint.name, section: at.section, frac: at.frac });
  }

  // Return road: never raced, only there so the world is one loop.
  const drop = elev - stage.startElevation;
  if (drop > 60) {
    const downKm = Math.max(4, Math.min(45, drop / 70));
    sections.push(descent(downKm, -Math.min(8, (drop / (downKm * 1000)) * 100), seed + 900, bend(46, 260)));
  }
  sections.push(level(5, bend(30, 320)));

  const gain = climbDefs.length ? sections.reduce((sum, s, i) => (i < finishSection ? sum + Math.max(0, s.grades.reduce((a, g) => a + Math.max(0, g), 0) / s.grades.length) * s.length / 100 : sum), 0) : 0;
  const maxElev = Math.max(stage.startElevation, ...[...climbs.values()].filter((c) => marks.some((m) => m.climbId === c.id)).map((c) => c.summitElevation));
  const def: RouteDef = {
    id: `stage-${stage.id}`,
    name: stage.name,
    description: stage.description,
    difficulty: difficultyFor(gain / Math.max(1, climbDefs.length) + (stage.terrain === 'mountain' ? 600 : 0)),
    seed,
    startElevation: stage.startElevation,
    sections,
    climbs: climbDefs,
    scenery: {
      mountainHeight: Math.max(400, Math.min(2200, (maxElev - stage.startElevation) * 1.2 + 300)),
      treeline: stage.treeline ?? 2050,
      snowline: stage.snowline ?? 2850,
      waterLevel: null,
      forestDensity: stage.terrain === 'flat' ? 0.4 : 0.7,
      biome: stage.biome,
    },
  };
  return { def, finishSection, marks };
}

/**
 * Length and climbing of each real road's loop, as `getRoute` measures them, so the
 * Free ride list can sort and show them before any track is fetched. Generated by
 * `npm run track-index` (from the tracks); `trackIndex.test.ts` fails when it is stale.
 */
export type TrackIndexRow = { length: number; ascent: number };

export function realRoadStats(id: string): TrackIndexRow | undefined {
  return (TRACK_INDEX as Record<string, TrackIndexRow>)[id];
}
