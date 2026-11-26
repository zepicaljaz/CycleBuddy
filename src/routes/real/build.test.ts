import { describe, expect, it } from 'vitest';
import { Route, ROUTE_DS } from '../route';
import { hairpinPositions, hasRealRoad, kmPieces, piecesGain, piecesToGrades, realClimbRoute, realRoadClimbs } from './build';
import type { RealClimb } from './types';

const fixture: RealClimb = {
  id: 'test-pass',
  name: 'Test Pass',
  side: 'Foot Town',
  country: 'ITA',
  region: 'Alps',
  lengthKm: 12.4,
  startElevation: 900,
  summitElevation: 1830,
  gain: 930,
  avgGrade: 7.5,
  maxGrade: 11,
  hairpins: 24,
  kmGrades: [5.1, 6.2, 7.0, 7.8, 8.1, 9.0, 8.4, 7.9, 8.6, 8.8, 7.2, 6.4, 5.0],
  lastKmLength: 0.4,
  hairpinsWhere: 'top',
  description: 'Fixture',
  famousFor: 'Tests',
  sources: [],
};

/** Hairpins on the built road: heading turns of more than 120° within 90 m. */
export function countHairpins(route: Route, from: number, to: number): number {
  const i0 = Math.floor(from / ROUTE_DS);
  const i1 = Math.floor(to / ROUTE_DS);
  const w = Math.round(90 / ROUTE_DS);
  let count = 0;
  let cool = 0;
  for (let i = i0; i + w < i1; i++) {
    if (cool > 0) {
      cool--;
      continue;
    }
    const a = Math.atan2(route.tz[i], route.tx[i]);
    const b = Math.atan2(route.tz[i + w], route.tx[i + w]);
    let d = Math.abs(b - a);
    if (d > Math.PI) d = Math.PI * 2 - d;
    if (d > (120 * Math.PI) / 180) {
      count++;
      cool = w;
    }
  }
  return count;
}

describe('real road climbs', () => {
  it('lists every tracked climb, by name', () => {
    const roads = realRoadClimbs();
    expect(roads.map((c) => c.id).sort()).toEqual([
      'alpe-dhuez-bourg-doisans',
      'angliru-la-vega',
      'galibier-valloire',
      'giau-selva',
      'krvavec-cerklje',
      'madeleine-la-chambre',
      'stelvio-prato',
      'tourmalet-luz',
      'ventoux-bedoin',
      'vrsic-kranjska-gora',
    ]);
    expect(roads.map((c) => c.name)).toEqual([...roads.map((c) => c.name)].sort((a, b) => a.localeCompare(b)));
    for (const climb of roads) expect(hasRealRoad(climb.id)).toBe(true);
  });
});

describe('real climbs', () => {
  it('resampling keeps length and gain, including a partial last km', () => {
    const pieces = kmPieces(fixture.kmGrades, fixture.lastKmLength);
    const { length, grades } = piecesToGrades(pieces);
    expect(length).toBeCloseTo(12400, 0);
    const gain = grades.reduce((sum, g) => sum + (g / 100) * (length / grades.length), 0);
    expect(Math.abs(gain - piecesGain(pieces))).toBeLessThan(2);
  });

  it('places the real number of hairpins, none closer than a hairpin needs', () => {
    const pins = hairpinPositions(kmPieces(fixture.kmGrades, fixture.lastKmLength), 24, 'top');
    expect(pins.length).toBe(24);
    for (let i = 1; i < pins.length; i++) expect(pins[i] - pins[i - 1]).toBeGreaterThanOrEqual(57);
  });

  it('builds a road whose climb matches the published numbers', () => {
    const route = new Route(realClimbRoute(fixture));
    const c = route.climbs[0];
    const pieces = kmPieces(fixture.kmGrades, fixture.lastKmLength);
    expect(Math.abs(c.length - 12400) / 12400).toBeLessThan(0.03);
    expect(Math.abs(c.gain - piecesGain(pieces)) / piecesGain(pieces)).toBeLessThan(0.05);
    const pins = countHairpins(route, c.start, c.end);
    expect(pins).toBeGreaterThanOrEqual(18);
    expect(pins).toBeLessThanOrEqual(28);
  });
});
