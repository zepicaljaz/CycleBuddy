/** One bend of a hand-traced road. Heading 0 follows the valley line. */
export interface TraceStep {
  heading: number;
  /** Metres to run on after the turn. */
  hold: number;
  /** Turn radius in metres. */
  radius: number;
}

export type SectionStyle =
  | { kind: 'straight' }
  | { kind: 'winding'; amplitudeDeg: number; wavelength: number }
  | { kind: 'hairpins'; count: number; legAngleDeg?: number; radius?: number }
  | { kind: 'traced'; steps: TraceStep[] };

export interface SectionDef {
  /** Road length of this section in metres. */
  length: number;
  /** Gradients in percent, evenly spread over the section (e.g. one per km). */
  grades: number[];
  style: SectionStyle;
}

export interface ClimbDef {
  id: string;
  name: string;
  inspiredBy: string;
  /** Inclusive section index range that makes up the climb. */
  fromSection: number;
  toSection: number;
}

export type Difficulty = 'flat' | 'hilly' | 'mountain' | 'epic';

/** Ground colours and vegetation. Existing routes stay alpine when this is omitted. */
export type Biome = 'alpine' | 'limestone' | 'desert' | 'moor' | 'spruce';

export interface SceneryDef {
  /** Height of procedural mountains around the road, metres. */
  mountainHeight: number;
  treeline: number;
  snowline: number;
  /** Metres. Above this the ground is loose gravel. Omitted on routes that stay grass or rock. */
  screeLine?: number;
  /** Sea / lake level, or null for no water. */
  waterLevel: number | null;
  /** 0..1, how forested the lower slopes are. */
  forestDensity: number;
  biome?: Biome;
  /**
   * Above the treeline the slope stays grass. A low treeline would otherwise
   * turn that ground to scree, which is right for a bare summit and wrong for pasture.
   */
  pasture?: boolean;
  /**
   * Unmapped ground from this elevation up is grazed: no trees, and the grass
   * is not tinted as forest. A mapped wood still stands. The ordinary treeline
   * fades in over a noisy band, so a shelf that should be bare needs this hard line.
   */
  pastureAbove?: number;
  /** The trees below the pasture are broadleaf. Omitted keeps the usual mix of pine and broadleaf. */
  broadleaf?: boolean;
  /**
   * Stretches of this road, in metres from the start, where the verge is open
   * ground. The way back along the same bend is included. Outside the radius
   * the forest is unchanged.
   */
  openAlong?: { fromM: number; toM: number; radius: number }[];
  /** The inside of the loop is a lake that meets the verge. The outside stays land. */
  lakeshore?: boolean;
}

/** A town the road passes through. Longer streets read as the bigger town. */
export interface TownDef {
  name: string;
  /** Section the town sits in. */
  section: number;
  /** Metres from the start of that section to the middle of the street. */
  along: number;
  /** Street length along the road, metres. */
  length: number;
}

/** Size and place of one height grid around a real road, in world metres. */
export interface DemGridInfo {
  x0: number;
  z0: number;
  cell: number;
  w: number;
  h: number;
}

export interface DemGrid extends DemGridInfo {
  /** Heights in metres, row by row from (x0, z0). */
  data: Float32Array;
}

/** Ground cover per cell, from a land-cover map: 0 no data, 1 trees, 2 open ground. */
export interface CoverGrid extends DemGridInfo {
  data: Uint8Array;
}

/** A polygon in the road's local metres (x east, z south). The first point is not repeated. */
export interface MapPolygon {
  name: string;
  x: number[];
  z: number[];
  /** Water surface, metres above the same datum as the road. Set for a lake. */
  level?: number;
}

/** Meadow and woodland polygons taken from OpenStreetMap, in the road's frame. */
export interface TrackCover {
  /** Grazed ground: meadow, grass, grassland, scrub, farmland. No trees. */
  open: MapPolygon[];
  /** Hand-mapped woodland. */
  wood: MapPolygon[];
}

/** Lakes, parking and land cover taken from OpenStreetMap and stored in the road's frame. */
export interface TrackPlaces {
  lakes: MapPolygon[];
  lots: MapPolygon[];
  /** Present when this road uses mapped ground cover instead of a forest everywhere. */
  cover?: TrackCover;
}

/**
 * A road taken from real map data (OpenStreetMap line, published profile, open
 * elevation). Points are about 4 m apart on straights and closer in bends. The road
 * goes up, turns in a loop at the top, comes back down the same way and turns at
 * the bottom, so it is a closed lap like every other route.
 */
export interface TrackDef {
  x: number[];
  z: number[];
  y: number[];
  /** Section index of each point. */
  sec: number[];
  /** OpenStreetMap water and parking, already projected into this track's x/z. */
  places?: TrackPlaces;
  /** 0 when the hill climb starts at the beginning of this road, rather than at section 1. */
  climbFromSection?: number;
  /** Numbered hairpin signs count 'up' from 1 at the foot (Vršič) or 'down' to 1 at the top (Alpe d'Huez). */
  hairpins?: 'up' | 'down';
  /** Published number of hairpins on the climb; the sharpest bends of the real line get the signs. */
  hairpinCount?: number;
  /** Height grids (fine first) in a binary file under src/assets/terrain, loaded when the ride starts. */
  terrain?: {
    file: string;
    grids: DemGridInfo[];
    /** Tree cover grids (fine first), run-length encoded in their own file. See `CoverGrid`. */
    cover?: { file: string; grids: DemGridInfo[] };
  };
  /** Where the data comes from, for the credits. */
  source?: string;
}

export interface RouteDef {
  id: string;
  name: string;
  description: string;
  difficulty: Difficulty;
  seed: number;
  startElevation: number;
  sections: SectionDef[];
  climbs: ClimbDef[];
  scenery: SceneryDef;
  /**
   * Valley line in travel order, closed by the builder. When set, the road
   * follows this shape instead of a generated loop. Bends and traced turns
   * sit off the line.
   */
  outline?: { x: number; z: number }[];
  /** Named towns. When set, the usual generated village names are not used. */
  towns?: TownDef[];
  /** A real road line. When set, it replaces the generated shape and elevation. */
  track?: TrackDef;
  /** Streets added on top of the villages the route already has. */
  extraTowns?: TownDef[];
  /**
   * Ride the finished loop the other way from the same start. The road stays
   * where it is; only the direction, profile and climbs turn around.
   */
  reversed?: boolean;
}
