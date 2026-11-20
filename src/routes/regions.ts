/**
 * Free Ride landscapes. Each loop is in one group, by how the ground looks:
 * high mountains, wooded hills, limestone, spruce, desert, or open grassland.
 * Real roads are a separate category (`REAL_RIDE`); they are not generated loops.
 */

/** The free-ride list of climbs that use a real road, up and back down the same way. */
export const REAL_RIDE = {
  id: 'real',
  name: 'Real climbs',
  line: 'Published climbs on their real roads. Ride up, turn at the top, and come back down the same way.',
} as const;
export interface RideRegion {
  id: string;
  name: string;
  line: string;
  /** Route id whose still is the card photo, unless `image` is set. Always one of `routes`. */
  cover: string;
  /** Card photo when the route still does not show this landscape. */
  image?: string;
  routes: readonly string[];
}

export const RIDE_REGIONS: readonly RideRegion[] = [
  {
    id: 'high',
    name: 'High Mountains',
    line: 'High peaks, snow and long cols.',
    cover: 'cielo',
    routes: [
      'alpine',
      'provence',
      'cielo',
      'twins',
      'jura',
      'massif',
      'savoy',
      'hautecombe',
      'lombardy',
      'apennine',
      'argent',
      'dolomite',
      'pyrenees',
    ],
  },
  {
    id: 'green',
    name: 'Green Hills',
    line: 'Trees, lower hills and flatter valleys.',
    cover: 'oakwood',
    image: '/route-previews/green-hills.jpg',
    routes: ['lake', 'riviera', 'lowlands', 'cypress', 'larch', 'mistral', 'oakwood', 'ardennes', 'hills'],
  },
  {
    id: 'limestone',
    name: 'Limestone Hills',
    line: 'Pale rock, pines and fewer trees.',
    cover: 'calobra',
    routes: ['calobra', 'tuscany', 'sicily', 'catalonia', 'andalucia', 'corsica', 'sierra', 'levante'],
  },
  {
    id: 'spruce',
    name: 'Sprucelands',
    line: 'Dark forest. The trees are spruce.',
    cover: 'vosges',
    routes: ['normandy', 'vosges', 'eifel', 'flanders'],
  },
  {
    id: 'desert',
    name: 'Desert',
    line: 'Sand and bare rock, with almost no trees.',
    cover: 'canyon',
    routes: ['canyon', 'dunes', 'badlands', 'glenmass'],
  },
  {
    id: 'grass',
    name: 'Grasslands',
    line: 'Open grass and moor, with fewer trees.',
    cover: 'highland',
    routes: ['condroz', 'galicia', 'limburg', 'brittany', 'highland'],
  },
];

export function rideRegion(id: string): RideRegion | undefined {
  return RIDE_REGIONS.find((region) => region.id === id);
}

const BRICK_HAIRPIN_REGIONS = new Set(['limestone', 'desert', 'grass']);

/** Limestone, desert and grassland climbs get a stone wall on hairpins. The other landscapes get a metal rail. */
export function climbHairpinFence(routeId: string): 'metal' | 'stone' {
  const region = RIDE_REGIONS.find((item) => item.routes.includes(routeId));
  return region && BRICK_HAIRPIN_REGIONS.has(region.id) ? 'stone' : 'metal';
}
