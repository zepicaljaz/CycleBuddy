import type { TreeHints } from './types';

/**
 * Tree sets for the generated worlds: which Blender tree models (src/assets/models) fill a
 * world's forest, so a world only grows trees that belong together there. A world sets one in
 * `scenery.trees`; without it the biome's own set in terrain.ts `propGeomsFor` is used.
 * `conifers` fill prop slot 0, `broadleaves` slot 1 (lower slopes, under ~1,100 m); a name
 * listed twice is twice as common. Real roads set their own, sourced, in climbs.json.
 *
 * The models stand in for their nearest relatives: `aleppo_pine` for the Mediterranean pines
 * (Aleppo, stone, maritime), `scots_pine` also for black and laricio pine, `spruce_b` also for
 * silver fir, `holm_oak` for the evergreen Mediterranean oaks, `beech` for the deciduous
 * broadleaf woods (beech, oak, chestnut).
 */
export const FLORA = {
  /** Northern and western Alps: spruce woods with larch higher up, beech in the valleys. */
  alps: { conifers: ['spruce_a', 'spruce_a', 'spruce_b', 'larch'], broadleaves: ['beech'] },
  /** Sunny inner-Alpine slopes (Oisans, Vinschgau, Engadine): larch first, then spruce. */
  larchAlps: { conifers: ['larch', 'larch', 'spruce_a', 'spruce_b'], broadleaves: ['beech'] },
  /** Dolomites: spruce and larch (and Swiss stone pine) to the treeline, beech low down. */
  dolomites: { conifers: ['spruce_a', 'larch', 'larch', 'spruce_b'], broadleaves: ['beech'] },
  /** Jura, Vosges-style middle mountains: spruce and fir with beech, no larch. */
  jura: { conifers: ['spruce_a', 'spruce_a', 'spruce_b'], broadleaves: ['beech'] },
  /** Pyrenees: beech-fir woods, mountain pine above. */
  pyrenees: { conifers: ['spruce_b', 'scots_pine', 'scots_pine'], broadleaves: ['beech'] },
  /** Apennines and Massif Central: beech woods with black/Scots pine and planted spruce. */
  uplands: { conifers: ['scots_pine', 'scots_pine', 'spruce_a'], broadleaves: ['beech'] },
  /** Low wooded hills and plains of central and western Europe: broadleaf with a few pines. */
  lowland: { conifers: ['scots_pine', 'spruce_a'], broadleaves: ['beech'] },
  /** Mont Ventoux-like Provence: holm oak low, beech, then cedar/pine (larch, spruce_b stand-ins). */
  provenceMountain: { conifers: ['larch', 'spruce_b'], broadleaves: ['holm_oak', 'holm_oak', 'beech'] },
  /** Mediterranean coast and sierras: Aleppo / stone pine and holm oak. */
  mediterranean: { conifers: ['aleppo_pine'], broadleaves: ['holm_oak'] },
  /** Mediterranean mountains (Corsica, Spanish sierras): pines that reach higher, holm oak low. */
  mediterraneanMountain: { conifers: ['aleppo_pine', 'scots_pine'], broadleaves: ['holm_oak'] },
  /** Riviera and Tuscan hills: umbrella pines with cypress, holm oak. */
  cypressCoast: { conifers: ['aleppo_pine', 'aleppo_pine', 'cypress'], broadleaves: ['holm_oak'] },
} as const satisfies Record<string, TreeHints>;

/** A copy the world can own (the scenery object is not frozen). */
export const flora = (name: keyof typeof FLORA): TreeHints => ({
  conifers: [...FLORA[name].conifers],
  broadleaves: [...FLORA[name].broadleaves],
});
