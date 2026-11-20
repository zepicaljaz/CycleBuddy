import { describe, expect, it } from 'vitest';
import type { Climb, Route } from '../routes/route';
import { ROUTE_DS } from '../routes/route';
import { findHairpins, gradeBand, isBigClimb, planRoadPaint, ROAD_WORDS, uphillRuns, writingSpans } from './climbs';
import { ROAD_HALF_WIDTH } from './terrainField';

/** A flat path from straights and constant-radius turns. A positive turn swings toward the rider's right. */
function path(legs: { straight?: number; turnDeg?: number; radius?: number }[]): Route {
  const tx: number[] = [];
  const tz: number[] = [];
  let heading = 0;
  const step = (dh: number) => {
    heading += dh;
    tx.push(Math.cos(heading));
    tz.push(Math.sin(heading));
  };
  for (const leg of legs) {
    if (leg.straight) for (let d = 0; d < leg.straight; d += ROUTE_DS) step(0);
    if (leg.turnDeg) {
      const sweep = (leg.turnDeg * Math.PI) / 180;
      const n = Math.max(1, Math.round((Math.abs(sweep) * (leg.radius ?? 15)) / ROUTE_DS));
      for (let k = 0; k < n; k++) step(sweep / n);
    }
  }
  return { count: tx.length, tx: Float32Array.from(tx), tz: Float32Array.from(tz) } as unknown as Route;
}

const climbOver = (route: Route): Climb =>
  ({ start: 0, end: (route.count - 1) * ROUTE_DS, length: (route.count - 1) * ROUTE_DS }) as Climb;

describe('findHairpins', () => {
  it('finds tight switchbacks and numbers them down to 1 at the top', () => {
    const route = path([
      { straight: 200 },
      { turnDeg: 175, radius: 15 },
      { straight: 160 },
      { turnDeg: -175, radius: 15 },
      { straight: 160 },
      { turnDeg: 170, radius: 16 },
      { straight: 200 },
    ]);
    const pins = findHairpins(route, climbOver(route));
    expect(pins.map((p) => p.number)).toEqual([3, 2, 1]);
    // A right-hand bend has its outside on the left.
    expect(pins.map((p) => p.outside)).toEqual([-1, 1, -1]);
    expect(pins[0].idx * ROUTE_DS).toBeGreaterThan(200);
    expect(pins[0].idx * ROUTE_DS).toBeLessThan(250);
  });

  it('ignores sweeping bends and gentle corners', () => {
    const route = path([
      { straight: 150 },
      { turnDeg: 90, radius: 20 },
      { straight: 150 },
      { turnDeg: -150, radius: 120 },
      { straight: 150 },
    ]);
    expect(findHairpins(route, climbOver(route))).toEqual([]);
  });
});

describe('gradeBand', () => {
  it('follows the Alpine kilometre-borne colours', () => {
    expect(gradeBand(0.03)).toBe('#2f9a46');
    expect(gradeBand(0.05)).toBe('#1f63c6');
    expect(gradeBand(0.07)).toBe('#d22a2a');
    expect(gradeBand(0.095)).toBe('#18191b');
  });
});

describe('road paint', () => {
  const banned = ['CICCONE', 'PIDCOCK', 'QUINTANA', 'KUSS', 'LANDA', 'HIRSCHI', 'PEDERSEN', 'POGACAR', 'VINGEGAARD', 'ROGLIC', 'MOHORIC', 'NOVAK'];

  it('uses fictional first and last names', () => {
    const names = ROAD_WORDS.filter((word) => word.includes(' '));
    expect(names.length).toBeGreaterThan(12);
    for (const word of ROAD_WORDS) {
      const tokens = word.split(' ');
      for (const bad of banned) expect(tokens.includes(bad), `${word} contains ${bad}`).toBe(false);
    }
  });

  it('writes race names every 10 m in the top fifth, and rarely at the foot', () => {
    const list = planRoadPaint(0, 1000, 3, 'race');
    const bottom = list.filter((paint) => paint.s < 400);
    const middle = list.filter((paint) => paint.s >= 400 && paint.s < 800);
    const top = list.filter((paint) => paint.s >= 800).sort((a, b) => a.s - b.s);
    expect(top.length).toBeGreaterThan(middle.length);
    expect(middle.length).toBeGreaterThan(bottom.length);
    expect(bottom.length).toBeLessThan(5);
    for (let i = 1; i < top.length; i++) expect(top[i].s - top[i - 1].s).toBe(10);
    const full = list.filter((paint) => paint.width > ROAD_HALF_WIDTH * 1.8).length;
    const narrow = list.filter((paint) => paint.width < ROAD_HALF_WIDTH * 1.5).length;
    expect(full).toBeGreaterThan(5);
    expect(narrow).toBeGreaterThan(5);
    for (const paint of list) {
      expect(Math.abs(paint.lat) + paint.width / 2).toBeLessThanOrEqual(ROAD_HALF_WIDTH);
      expect(paint.flip).toBe(false);
    }
  });

  it('turns the letters around when asked', () => {
    expect(planRoadPaint(0, 40, 1, 'race', true).every((paint) => paint.flip)).toBe(true);
  });

  it('writes a free ride rarely at the foot and most often in the top fifth', () => {
    const list = planRoadPaint(0, 4000, 3, 'ride');
    const bottom = list.filter((paint) => paint.s < 1600).length;
    const middle = list.filter((paint) => paint.s >= 1600 && paint.s < 3200).length;
    const top = list.filter((paint) => paint.s >= 3200).length;
    expect(top).toBeGreaterThan(middle);
    expect(middle).toBeGreaterThan(bottom);
    expect(bottom).toBeLessThan(10);
  });
});

describe('uphill runs', () => {
  function road(elev: (s: number) => number) {
    return { wrap: (s: number) => s, elevationAt: elev } as Route;
  }

  it('finds a climb in the direction of travel', () => {
    const route = road((s) => (s < 400 ? 100 : s < 2400 ? 100 + (s - 400) * 0.08 : 260));
    const up = uphillRuns(route, 0, 3000, 1);
    expect(up.length).toBe(1);
    expect(up[0].gain).toBeGreaterThan(100);
    expect(up[0].start).toBeGreaterThan(200);
    expect(up[0].end).toBeGreaterThan(up[0].start);
  });

  it('finds the same rise when the stage rides back down the stored road', () => {
    const route = road((s) => 500 - s * 0.07);
    const back = uphillRuns(route, 4000, 0, -1);
    expect(back.length).toBe(1);
    expect(back[0].start).toBeGreaterThan(back[0].end);
    expect(back[0].gain).toBeGreaterThan(200);
    const spans = writingSpans(route, { dir: -1, from: 4000, to: 0 });
    expect(spans.length).toBe(1);
    expect(spans[0].flip).toBe(true);
    expect(spans[0].to).toBeGreaterThan(spans[0].from);
  });
});

describe('isBigClimb', () => {
  it('needs length and either gain or steepness', () => {
    expect(isBigClimb({ length: 12000, gain: 900, avgGrade: 0.075 } as Climb)).toBe(true);
    expect(isBigClimb({ length: 2500, gain: 200, avgGrade: 0.08 } as Climb)).toBe(false);
    expect(isBigClimb({ length: 6000, gain: 150, avgGrade: 0.025 } as Climb)).toBe(false);
  });
});
