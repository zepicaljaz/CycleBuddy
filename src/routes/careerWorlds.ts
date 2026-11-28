import type { RouteDef } from './types';
import { MORE_SEGMENTS, MORE_WORLDS } from './moreWorlds';
import { bend, climb, descent, hairpins, level, rolling } from './sections';
import { flora } from './flora';

const pins = (count: number) => hairpins(count, 10, 14);

/**
 * Career worlds. Each one is a single connected road — valley, side junctions and
 * all — long enough that several stages are different stretches of it, not a new
 * map every day. Ordinary stages climb about as much as a hilly classic. Queen
 * stages are the ones with two or three climbs in a row.
 */
export const CAREER_WORLDS: RouteDef[] = [
  {
    id: 'lowlands',
    name: 'Lowland Plain',
    description: 'A fast northern plain. The sprint roads are flat. Two short bridge rises sit together in the middle of the loop.',
    difficulty: 'flat',
    seed: 12011,
    startElevation: 8,
    sections: [
      level(4.6),
      level(7),
      level(6.2),
      level(5.6),
      climb([4.2, 4.0, 3.6, 3.4], 1.7, bend(36, 280)),
      descent(1.8, -2.6, 120, bend(34, 300)),
      climb([4.4, 4.2, 3.8, 3.4], 1.6, bend(36, 260)),
      descent(1.7, -2.8, 121, bend(34, 280)),
      level(6.4),
      level(6.2),
      level(5.6),
    ],
    climbs: [
      { id: 'low-harbour', name: 'Harbour Rise', inspiredBy: 'A short bridge ramp on an otherwise flat plain', fromSection: 4, toSection: 4 },
      { id: 'low-dike', name: 'Dike Top', inspiredBy: 'A second short rise, steeper for a few hundred metres', fromSection: 6, toSection: 6 },
    ],
    scenery: { mountainHeight: 160, treeline: 400, snowline: 2200, waterLevel: 0, forestDensity: 0.18, trees: flora('lowland') },
  },
  {
    id: 'mistral',
    name: 'Mistral Valley',
    description: 'Flat valley roads for the sprints. The ridge is two climbs: a short cote, a brief drop, then Crest de Vent.',
    difficulty: 'hilly',
    seed: 12021,
    startElevation: 120,
    sections: [
      level(5.2),
      level(6.4),
      level(6.2),
      level(5.8),
      rolling(4.4, 3.2, 211, bend(40, 300)),
      climb([6.2, 7, 6.6, 6], 4.8, pins(8)),
      descent(3, -6.4, 212, bend(42, 260)),
      climb([5.8, 6.6, 7.2, 6.4, 5.8], 5.4, pins(8)),
      descent(5.2, -6.2, 213),
      level(6.4),
      level(6.2),
      level(5.6),
    ],
    climbs: [
      { id: 'mis-cote', name: 'Cote du Vent', inspiredBy: 'A short step before the exposed ridge', fromSection: 5, toSection: 5 },
      { id: 'mis-vent', name: 'Crest de Vent', inspiredBy: 'A bare ridge above a windy valley, steepest in the middle', fromSection: 7, toSection: 7 },
    ],
    scenery: { mountainHeight: 780, treeline: 1450, snowline: 2900, waterLevel: null, forestDensity: 0.42, trees: flora('mediterranean') },
  },
  {
    id: 'argent',
    name: 'Val d’Argent',
    description: 'Ten flat kilometres, then Col des Brumes and Col du Coteau. The valley returns, and Mur de Lune is near the end, with one short step straight before it.',
    difficulty: 'hilly',
    seed: 12031,
    startElevation: 680,
    sections: [
      level(5),
      level(5.2),
      climb([6.2, 6.8, 7.2, 6.4], 4.6, pins(8)),
      descent(3.2, -6.2, 312, bend(42, 260)),
      climb([6.4, 7.2, 7.4, 6.6], 4.4, pins(6)),
      descent(2.6, -6.2, 314, bend(42, 260)),
      level(6.4),
      level(6.2),
      level(5.6),
      rolling(5.2, 3.2, 318, bend(40, 280)),
      climb([6.8, 7.4, 7.8, 7], 4.2, pins(6)),
      descent(2.4, -6.2, 319, bend(42, 240)),
      climb([7.6, 8.4, 8.8, 8.2, 7.6], 5.4, pins(8)),
      descent(6.2, -6.4, 316, bend(42, 280)),
    ],
    climbs: [
      { id: 'arg-brumes', name: 'Col des Brumes', inspiredBy: 'The first col, a few kilometres after the valley', fromSection: 2, toSection: 2 },
      { id: 'arg-coteau', name: 'Col du Coteau', inspiredBy: 'The second col, starting as soon as Brumes is descended', fromSection: 4, toSection: 4 },
      { id: 'arg-rampe', name: 'Rampe de Lune', inspiredBy: 'The short step that leads straight into the Mur', fromSection: 10, toSection: 10 },
      { id: 'arg-lune', name: 'Mur de Lune', inspiredBy: 'The queen summit, near the end of the valley', fromSection: 12, toSection: 12 },
    ],
    scenery: { mountainHeight: 1780, treeline: 2050, snowline: 2550, waterLevel: null, forestDensity: 0.76, trees: flora('alps') },
  },
  {
    id: 'dolomite',
    name: 'Dolomite Crown',
    description: 'A flat crown valley, then two quieter passes with a valley between them. Monte Grigio is the queen, with two climbs straight before it.',
    difficulty: 'mountain',
    seed: 12041,
    startElevation: 760,
    sections: [
      level(4.8),
      level(6.4),
      level(6.2),
      level(5.6),
      rolling(4.8, 3.2, 411, bend(40, 280)),
      climb([6.2, 6.8, 6.4], 3.2, bend(42, 220)),
      descent(2.4, -6.2, 412, bend(42, 260)),
      rolling(4.2, 3, 413, bend(40, 280)),
      climb([6.6, 7.2, 6.8], 3.6, bend(42, 220)),
      descent(3, -6.2, 414, bend(42, 260)),
      rolling(4.4, 3, 415, bend(40, 280)),
      climb([7, 7.6, 7.2], 3.8, bend(44, 210)),
      descent(2.6, -6.4, 416, bend(42, 240)),
      climb([7.2, 7.8, 7.4], 3.6, bend(44, 200)),
      descent(2.4, -6.4, 417, bend(42, 240)),
      climb([7.4, 8.2, 8.4, 7.6], 4.8, pins(6)),
      descent(6.5, -6.4, 418, bend(42, 280)),
    ],
    climbs: [
      { id: 'dol-chiara', name: 'Sella Chiara', inspiredBy: 'The first pale wall, with a valley before Nevoso', fromSection: 5, toSection: 5 },
      { id: 'dol-nevoso', name: 'Passo Nevoso', inspiredBy: 'A dolomite pass after the valley, not stacked on Chiara', fromSection: 8, toSection: 8 },
      { id: 'dol-rosa', name: 'Forcella Rosa', inspiredBy: 'A pass of its own, after another valley', fromSection: 11, toSection: 11 },
      { id: 'dol-sella', name: 'Sella Grigia', inspiredBy: 'The step that starts the queen, straight before Monte Grigio', fromSection: 13, toSection: 13 },
      { id: 'dol-grigio', name: 'Monte Grigio', inspiredBy: 'The queen summit, the third climb of that final chain', fromSection: 15, toSection: 15 },
    ],
    scenery: { mountainHeight: 1740, treeline: 1980, snowline: 2500, waterLevel: null, forestDensity: 0.7, trees: flora('dolomites') },
  },
  {
    id: 'sierra',
    name: 'Sierra Roja',
    description: 'A flat plain, then separate red summits with valleys between them. Alto del Cielo is the queen, climbed straight after two shorter steps.',
    difficulty: 'hilly',
    seed: 12051,
    startElevation: 510,
    sections: [
      level(6.2),
      level(6),
      level(5.6),
      rolling(5, 3.2, 511, bend(40, 280)),
      climb([6.4, 7, 6.6], 3.2, bend(42, 220)),
      descent(2.6, -6.2, 513, bend(42, 260)),
      rolling(4.4, 3, 514, bend(40, 280)),
      climb([7.2, 7.8, 7.2], 3.8, bend(44, 210)),
      descent(3, -6.2, 515, bend(42, 260)),
      rolling(4.2, 3, 516, bend(40, 280)),
      climb([6.8, 7.4, 7], 3.6, bend(42, 220)),
      descent(2.6, -6.2, 517, bend(42, 240)),
      climb([7.2, 7.8, 7.4], 3.8, bend(44, 200)),
      descent(2.4, -6.4, 518, bend(42, 240)),
      climb([7.6, 8.4, 8.2, 7.6], 4.8, pins(6)),
      descent(5.2, -6.4, 519, bend(42, 280)),
      level(6.2),
      level(6),
      level(5.6),
      level(5),
    ],
    climbs: [
      { id: 'sie-collado', name: 'Collado Rojo', inspiredBy: 'The first red summit, with a valley before Peña', fromSection: 4, toSection: 4 },
      { id: 'sie-pena', name: 'Peña Roja', inspiredBy: 'A summit after the valley, not stacked on the collado', fromSection: 7, toSection: 7 },
      { id: 'sie-cruz', name: 'Alto de la Cruz', inspiredBy: 'A summit of its own, after another valley', fromSection: 10, toSection: 10 },
      { id: 'sie-paso', name: 'Paso del Cielo', inspiredBy: 'The step that leads straight into Alto del Cielo', fromSection: 12, toSection: 12 },
      { id: 'sie-cielo', name: 'Alto del Cielo', inspiredBy: 'The queen summit, the third climb of the final chain', fromSection: 14, toSection: 14 },
    ],
    scenery: { mountainHeight: 1520, treeline: 1650, snowline: 3100, waterLevel: null, forestDensity: 0.28, biome: 'limestone', trees: flora('mediterraneanMountain') },
  },
  {
    id: 'pyrenees',
    name: 'Pyrenean Crest',
    description: 'A flat valley, then Collet and Crest with a valley between them. Port del Foc is the queen, with two climbs straight before it.',
    difficulty: 'hilly',
    seed: 12061,
    startElevation: 690,
    sections: [
      level(6.4),
      level(6.2),
      level(5.6),
      rolling(4.8, 3.2, 611, bend(40, 280)),
      climb([6.2, 6.8, 6.4], 3.2, bend(42, 220)),
      descent(2.4, -6.2, 612, bend(42, 260)),
      rolling(4.2, 3, 613, bend(40, 280)),
      climb([6.8, 7.4, 7], 3.8, bend(44, 210)),
      descent(2.8, -6.2, 614, bend(42, 260)),
      climb([7, 7.6, 7.2], 3.6, bend(44, 200)),
      descent(2.4, -6.4, 615, bend(42, 240)),
      climb([7.6, 8.4, 8.6, 7.8], 4.8, pins(6)),
      descent(6.5, -6.4, 616, bend(42, 280)),
    ],
    climbs: [
      { id: 'pyr-collet', name: 'Collet du Port', inspiredBy: 'The first border step, with a valley before Crest', fromSection: 4, toSection: 4 },
      { id: 'pyr-crest', name: 'Col du Crest', inspiredBy: 'A border pass after the valley', fromSection: 7, toSection: 7 },
      { id: 'pyr-pas', name: 'Pas del Foc', inspiredBy: 'The step that leads straight into Port del Foc', fromSection: 9, toSection: 9 },
      { id: 'pyr-foc', name: 'Port del Foc', inspiredBy: 'The queen summit, the third climb of the final chain', fromSection: 11, toSection: 11 },
    ],
    scenery: { mountainHeight: 1860, treeline: 2000, snowline: 2480, waterLevel: null, forestDensity: 0.74, trees: flora('pyrenees') },
  },
  {
    id: 'flanders',
    name: 'Flanders Lanes',
    description: 'Flat lanes broken by short steep bergs. One classic finishes in town, another on the last hill.',
    difficulty: 'hilly',
    seed: 12071,
    // The lap dips just before Berg van Zand. Keep that hollow well above the sea.
    startElevation: 18,
    sections: [
      level(4.8),
      climb([8.5, 7.2, 5.5], 0.85, bend(48, 180)),
      level(2.4),
      climb([11.5, 9.5], 0.55, bend(50, 140)),
      level(3.2),
      climb([6.4, 7.2, 7.8, 6.2], 1.2, bend(46, 200)),
      level(2.6),
      climb([9.5, 8.0], 0.75, bend(48, 160)),
      level(3.4),
      climb([6.8, 10.5, 6.2], 0.95, bend(48, 170)),
      level(2.8),
      climb([12.5, 8.5], 0.6, bend(52, 140)),
      level(4.2),
      rolling(3.4, 2.6, 711, bend(40, 260)),
      level(4.8),
      level(6),
      rolling(4, 2.2, 712, bend(36, 280)),
      level(5),
    ],
    climbs: [
      { id: 'fla-zand', name: 'Berg van Zand', inspiredBy: 'The first short berg of a cobbled-style classic', fromSection: 1, toSection: 1 },
      { id: 'fla-kerk', name: 'Muur van Kerk', inspiredBy: 'A very steep chapel hill, only a few hundred metres long', fromSection: 3, toSection: 3 },
      { id: 'fla-eik', name: 'Kop van Eik', inspiredBy: 'A longer berg that drags on after the steepest part', fromSection: 5, toSection: 5 },
      { id: 'fla-pater', name: 'Paterheuvel', inspiredBy: 'A sharp berg just before the finishing towns', fromSection: 7, toSection: 7 },
      { id: 'fla-kassei', name: 'Oude Kassei', inspiredBy: 'A rough lane that kicks up in the middle', fromSection: 9, toSection: 9 },
      { id: 'fla-kapel', name: 'Kapelberg', inspiredBy: 'The last berg, steepest at the bottom', fromSection: 11, toSection: 11 },
    ],
    scenery: { mountainHeight: 240, treeline: 500, snowline: 2200, waterLevel: 0, forestDensity: 0.36, biome: 'spruce' },
  },
  {
    id: 'ardennes',
    name: 'Ardenne Ridges',
    description: 'Wooded ridges one after another. The Cote de la Roche is the long one; the others are steep and short.',
    difficulty: 'hilly',
    seed: 12081,
    startElevation: 210,
    sections: [
      rolling(9, 4.6, 811, bend(42, 280)),
      climb([7.6, 8.4, 8.8, 7.2], 2.6, pins(8)),
      descent(2.4, -7, 812, bend(44, 240)),
      rolling(4.8, 4.2, 813, bend(42, 260)),
      climb([9.2, 10.4, 8.6], 1.7, bend(48, 180)),
      descent(2, -7.5, 814, bend(44, 220)),
      rolling(3.6, 3.8, 815, bend(40, 260)),
      climb([7.2, 8.0, 8.4, 7.6, 6.8], 4.5, pins(12)),
      descent(5.5, -6.8, 816, pins(10)),
      rolling(7, 3.6, 817, bend(38, 300)),
      level(7),
      level(6.4),
      level(6.2),
      level(5.6),
    ],
    climbs: [
      { id: 'ard-chevre', name: 'Cote de Chevre', inspiredBy: 'A steep wooded ridge early in an Ardennes classic', fromSection: 1, toSection: 1 },
      { id: 'ard-mur', name: 'Cote de Mur', inspiredBy: 'A short wall, the kind of hill that splits a classic', fromSection: 4, toSection: 4 },
      { id: 'ard-roche', name: 'Cote de la Roche', inspiredBy: 'The long ridge that decides the hardest one-day race', fromSection: 7, toSection: 7 },
    ],
    scenery: { mountainHeight: 860, treeline: 1500, snowline: 2400, waterLevel: null, forestDensity: 0.74, trees: flora('jura') },
  },
  {
    id: 'glenmass',
    name: 'Glen Massif',
    description: 'A flat desert for the sprint. The Pass of Glen and the Brae of Loch are separate hills, each with a smaller step and a valley before it.',
    difficulty: 'hilly',
    seed: 12091,
    startElevation: 60,
    sections: [
      level(6.4),
      level(6.2),
      level(5.6),
      rolling(5, 3.2, 911, bend(40, 280)),
      climb([6.2, 6.8, 6.4], 3.4, bend(42, 220)),
      descent(2.6, -6.2, 912, bend(42, 260)),
      rolling(4.4, 3, 913, bend(40, 280)),
      climb([6.6, 7.2, 6.8], 3.8, bend(44, 210)),
      rolling(4.8, 3, 914, bend(40, 280)),
      climb([6.4, 7, 6.6], 3, bend(42, 200)),
      descent(2.4, -6.2, 915, bend(42, 240)),
      rolling(4, 2.8, 916, bend(38, 280)),
      climb([7, 7.6, 7.2], 3.6, bend(44, 200)),
      descent(5.5, -6.2, 917, bend(42, 280)),
    ],
    climbs: [
      { id: 'glen-bealach', name: 'Bealach Mor', inspiredBy: 'The first moorland step, with a valley before the pass', fromSection: 4, toSection: 4 },
      { id: 'glen-pass', name: 'Pass of Glen', inspiredBy: 'The pass after the valley, not stacked on the bealach', fromSection: 7, toSection: 7 },
      { id: 'glen-cnoc', name: 'Cnoc Beag', inspiredBy: 'A short moorland bump before the brae', fromSection: 9, toSection: 9 },
      { id: 'glen-brae', name: 'Brae of Loch', inspiredBy: 'The finish climb, after a valley of its own', fromSection: 12, toSection: 12 },
    ],
    scenery: { mountainHeight: 1120, treeline: 2400, snowline: 6000, waterLevel: null, forestDensity: 0.02, biome: 'desert' },
  },
  {
    id: 'levante',
    name: 'Levante Coast',
    description: 'Long flat sea roads. Col del Far and Costa Alta stay together. Cap de Marina sits on its own, near the end of the loop.',
    difficulty: 'hilly',
    seed: 12101,
    startElevation: 28,
    sections: [
      level(6.5),
      level(6.4),
      level(5.6),
      climb([6.4, 7.2, 7.6, 7, 6.6], 5.4, pins(8)),
      descent(3, -6.2, 1012, bend(44, 240)),
      climb([6.8, 7.4, 7, 6.4], 4.2, pins(6)),
      descent(2.8, -6.2, 1013, bend(44, 240)),
      level(6.4),
      level(6.2),
      level(5.6),
      climb([7.2, 8, 7.4], 3.8, bend(44, 200)),
      descent(4, -6.2, 1014, bend(42, 280)),
      level(6.2),
      level(6),
      level(5.6),
    ],
    climbs: [
      { id: 'lev-far', name: 'Col del Far', inspiredBy: 'The long lighthouse climb, the first of the two capes that stay together', fromSection: 3, toSection: 3 },
      { id: 'lev-costa', name: 'Costa Alta', inspiredBy: 'The second cape, straight after the descent of Col del Far', fromSection: 5, toSection: 5 },
      { id: 'lev-marina', name: 'Cap de Marina', inspiredBy: 'The last cape, set near the end of the loop', fromSection: 10, toSection: 10 },
    ],
    scenery: { mountainHeight: 980, treeline: 720, snowline: 2600, waterLevel: 0, forestDensity: 0.26, biome: 'limestone', trees: flora('mediterranean') },
  },
];

export type StageKind = 'road' | 'tt';
export type StageFinish = 'sprint' | 'hill' | 'mountain';

/** A stage is a stretch of one world, from the start of `from` to the end of `to`. */
export interface StageSegment {
  id: string;
  world: string;
  from: number;
  to: number;
  kind: StageKind;
  finish: StageFinish;
  name: string;
}

export const STAGE_SEGMENTS: StageSegment[] = [
  { id: 'low-tt', world: 'lowlands', from: 0, to: 0, kind: 'tt', finish: 'sprint', name: 'Harbour time trial' },
  { id: 'low-a', world: 'lowlands', from: 1, to: 3, kind: 'road', finish: 'sprint', name: 'Plain of the north' },
  { id: 'low-b', world: 'lowlands', from: 8, to: 10, kind: 'road', finish: 'sprint', name: 'Dike road' },

  { id: 'mis-tt', world: 'mistral', from: 0, to: 0, kind: 'tt', finish: 'sprint', name: 'Town time trial' },
  { id: 'mis-ridge', world: 'mistral', from: 3, to: 7, kind: 'road', finish: 'hill', name: 'Crest de Vent' },
  { id: 'mis-sprint', world: 'mistral', from: 1, to: 3, kind: 'road', finish: 'sprint', name: 'Valley run-in' },
  { id: 'mis-east', world: 'mistral', from: 9, to: 11, kind: 'road', finish: 'sprint', name: 'East wind' },
  { id: 'mis-hilly', world: 'mistral', from: 4, to: 7, kind: 'road', finish: 'hill', name: 'Over the ridge' },

  { id: 'arg-tt', world: 'argent', from: 0, to: 0, kind: 'tt', finish: 'sprint', name: 'Valley time trial' },
  { id: 'arg-hilly', world: 'argent', from: 1, to: 4, kind: 'road', finish: 'hill', name: 'Col du Coteau' },
  { id: 'arg-after', world: 'argent', from: 1, to: 6, kind: 'road', finish: 'hill', name: 'After Col du Coteau' },
  { id: 'arg-queen', world: 'argent', from: 9, to: 12, kind: 'road', finish: 'mountain', name: 'Mur de Lune' },
  { id: 'arg-valley', world: 'argent', from: 6, to: 8, kind: 'road', finish: 'sprint', name: 'After the moon' },

  { id: 'dol-tt', world: 'dolomite', from: 0, to: 0, kind: 'tt', finish: 'sprint', name: 'Lake time trial' },
  { id: 'dol-nevoso', world: 'dolomite', from: 4, to: 8, kind: 'road', finish: 'hill', name: 'Passo Nevoso' },
  { id: 'dol-rosa', world: 'dolomite', from: 7, to: 11, kind: 'road', finish: 'hill', name: 'Forcella Rosa' },
  { id: 'dol-valley', world: 'dolomite', from: 1, to: 3, kind: 'road', finish: 'sprint', name: 'Crown valley' },
  { id: 'dol-grigio', world: 'dolomite', from: 11, to: 15, kind: 'road', finish: 'mountain', name: 'Monte Grigio' },

  { id: 'sie-false', world: 'sierra', from: 0, to: 2, kind: 'road', finish: 'sprint', name: 'False flat' },
  { id: 'sie-pena', world: 'sierra', from: 3, to: 7, kind: 'road', finish: 'hill', name: 'Peña Roja' },
  { id: 'sie-cruz', world: 'sierra', from: 6, to: 10, kind: 'road', finish: 'hill', name: 'Alto de la Cruz' },
  { id: 'sie-run', world: 'sierra', from: 16, to: 18, kind: 'road', finish: 'sprint', name: 'Red plain' },
  { id: 'sie-cielo', world: 'sierra', from: 10, to: 14, kind: 'road', finish: 'mountain', name: 'Alto del Cielo' },
  { id: 'sie-tt', world: 'sierra', from: 19, to: 19, kind: 'tt', finish: 'sprint', name: 'Evening time trial' },

  { id: 'pyr-crest', world: 'pyrenees', from: 3, to: 7, kind: 'road', finish: 'hill', name: 'Col du Crest' },
  { id: 'pyr-after', world: 'pyrenees', from: 3, to: 8, kind: 'road', finish: 'hill', name: 'After Col du Crest' },
  { id: 'pyr-foc', world: 'pyrenees', from: 7, to: 11, kind: 'road', finish: 'mountain', name: 'Port del Foc' },
  { id: 'pyr-link', world: 'pyrenees', from: 0, to: 2, kind: 'road', finish: 'sprint', name: 'Far valley' },

  { id: 'fla-monument', world: 'flanders', from: 0, to: 12, kind: 'road', finish: 'sprint', name: 'Bergs to the square' },
  { id: 'fla-berg', world: 'flanders', from: 2, to: 11, kind: 'road', finish: 'hill', name: 'Kapelberg' },
  { id: 'fla-semi', world: 'flanders', from: 4, to: 14, kind: 'road', finish: 'sprint', name: 'Lanes of the south' },
  { id: 'fla-north', world: 'flanders', from: 14, to: 17, kind: 'road', finish: 'sprint', name: 'North lanes' },

  { id: 'ard-arrow', world: 'ardennes', from: 0, to: 4, kind: 'road', finish: 'hill', name: 'Cote de Mur' },
  { id: 'ard-roche', world: 'ardennes', from: 2, to: 7, kind: 'road', finish: 'mountain', name: 'Cote de la Roche' },
  { id: 'ard-run', world: 'ardennes', from: 11, to: 13, kind: 'road', finish: 'sprint', name: 'Valley road' },

  { id: 'glen-pass', world: 'glenmass', from: 3, to: 7, kind: 'road', finish: 'hill', name: 'Pass of Glen' },
  { id: 'glen-brae', world: 'glenmass', from: 8, to: 12, kind: 'road', finish: 'hill', name: 'Brae of Loch' },
  { id: 'glen-moor', world: 'glenmass', from: 0, to: 2, kind: 'road', finish: 'sprint', name: 'Home moor' },

  { id: 'lev-coast', world: 'levante', from: 0, to: 2, kind: 'road', finish: 'sprint', name: 'Sea road' },
  { id: 'lev-far', world: 'levante', from: 2, to: 5, kind: 'road', finish: 'hill', name: 'Col del Far' },
  { id: 'lev-town', world: 'levante', from: 7, to: 9, kind: 'road', finish: 'sprint', name: 'Bay town' },
  { id: 'lev-bay', world: 'levante', from: 12, to: 14, kind: 'road', finish: 'sprint', name: 'Long bay' },

  { id: 'lake-loop', world: 'lake', from: 0, to: 6, kind: 'road', finish: 'sprint', name: 'Mirror Lake' },
];

CAREER_WORLDS.push(...MORE_WORLDS);
STAGE_SEGMENTS.push(...MORE_SEGMENTS);

export function segmentById(id: string): StageSegment {
  const found = STAGE_SEGMENTS.find((s) => s.id === id);
  if (!found) throw new Error(`Unknown stage segment ${id}`);
  return found;
}
