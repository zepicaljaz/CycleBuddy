import { describe, expect, it } from 'vitest';
import type { RideSession } from '../game/session';
import { realClimbRoute } from '../routes/real/build';
import { REAL_CLIMB_MAP } from '../routes/real/data';
import { getRoute, ROUTE_DS } from '../routes/route';
import { gradeColor } from './dom';
import { legPaintRank, Minimap, nearbyReachMetres, type MapMode } from './minimap';

describe('nearby map reach', () => {
  it('covers a wide map out to both side edges', () => {
    const width = 420;
    const height = 130;
    const reach = nearbyReachMetres(width, height);
    const scale = (Math.min(width, height) - 20) / 480;
    expect(reach).toBeGreaterThanOrEqual(width / 2 / scale);
    expect(reach).toBeGreaterThanOrEqual(height / 2 / scale);
  });

  it('looks five times further on the wider road', () => {
    expect(nearbyReachMetres(280, 220, 2400)).toBeCloseTo(nearbyReachMetres(280, 220) * 5);
  });
});

describe('out-and-back colours', () => {
  it('paints the climb on top while riding up, and the descent once the top loop starts', () => {
    const climb = REAL_CLIMB_MAP.get('giau-selva');
    expect(climb).toBeTruthy();
    const route = getRoute(realClimbRoute(climb!));
    const col = route.climbs[0];
    const up = Math.floor((col.start + col.length * 0.45) / ROUTE_DS);
    let back = up;
    let best = Infinity;
    for (let i = Math.floor(col.end / ROUTE_DS) + 40; i < route.count; i += 2) {
      const d = Math.hypot(route.x[i] - route.x[up], route.z[i] - route.z[up]);
      if (d < best) {
        best = d;
        back = i;
      }
    }
    expect(best).toBeLessThan(8);
    expect(route.section[up]).not.toBe(2);
    expect(route.section[back]).toBe(2);
    expect(route.grade[up]).toBeGreaterThan(0.03);
    expect(route.grade[back]).toBeLessThan(-0.02);
    expect(legPaintRank(route.section[up], false, true)).toBeGreaterThan(legPaintRank(route.section[back], false, true));
    expect(legPaintRank(route.section[back], true, true)).toBeGreaterThan(legPaintRank(route.section[up], true, true));
    expect(gradeColor(route.grade[up])).not.toBe(gradeColor(route.grade[back]));
  });
});

describe('nearby map drawing', () => {
  const g = globalThis as { window?: { devicePixelRatio: number } };
  g.window ??= { devicePixelRatio: 1 };

  function straightOutAndBack() {
    const half = 3000;
    const count = half * 2;
    const x = new Float32Array(count);
    const z = new Float32Array(count);
    const grade = new Float32Array(count);
    const section = new Uint8Array(count);
    for (let i = 0; i < half; i++) {
      x[i] = (i - half / 2) * ROUTE_DS;
      grade[i] = 0.09;
      section[i] = 1;
    }
    for (let i = 0; i < half; i++) {
      x[half + i] = x[half - 1 - i];
      grade[half + i] = -0.09;
      section[half + i] = 2;
    }
    const length = count * ROUTE_DS;
    return {
      count,
      length,
      x,
      z,
      grade,
      section,
      def: { track: { id: 'fake' } },
      wrap: (s: number) => ((s % length) + length) % length,
      sample(s: number) {
        const i = Math.min(count - 1, Math.floor(this.wrap(s) / ROUTE_DS));
        return { x: x[i], y: 0, z: z[i], tx: section[i] === 2 ? -1 : 1, tz: 0, grade: grade[i] };
      },
    };
  }

  function draw(at: number, mode: MapMode = 'ahead') {
    const strokes: { width: number; color: string; x0: number; x1: number }[] = [];
    let x0 = 0;
    let x1 = 0;
    const ctx = {
      lineJoin: '',
      lineCap: '',
      lineWidth: 1,
      strokeStyle: '',
      fillStyle: '',
      setTransform() {},
      clearRect() {},
      beginPath() {},
      moveTo(x: number) {
        x0 = x;
      },
      lineTo(x: number) {
        x1 = x;
      },
      stroke() {
        strokes.push({ width: ctx.lineWidth, color: String(ctx.strokeStyle), x0, x1 });
      },
      save() {},
      restore() {},
      translate() {},
      rotate() {},
      fill() {},
      arc() {},
      closePath() {},
    };
    const canvas = {
      width: 0,
      height: 0,
      clientWidth: 420,
      clientHeight: 130,
      getContext: () => ctx,
    };
    const map = new Minimap(canvas as unknown as HTMLCanvasElement);
    map.setMode(mode);
    const route = straightOutAndBack();
    const session = {
      route,
      player: { s: at, direction: 1, lat: 0 },
      config: { mode: 'free' },
      sim: { facingAngle: () => 0, racers: [] },
    };
    map.draw(session as unknown as RideSession);
    return strokes.filter((stroke) => stroke.width === (mode === 'wide' ? 3 : 4));
  }

  it('draws the road out to the side edges of a wide map', () => {
    const colours = draw((3000 / 2) * ROUTE_DS);
    const xs = colours.flatMap((stroke) => [stroke.x0, stroke.x1]);
    expect(Math.min(...xs)).toBeLessThan(8);
    expect(Math.max(...xs)).toBeGreaterThan(412);
  });

  it('keeps the climb colour on top while the rider is still going up', () => {
    const colours = draw((3000 / 2) * ROUTE_DS);
    expect(colours.some((stroke) => stroke.color === '#4d9de0')).toBe(true);
    expect(colours[colours.length - 1].color).toBe('#e2412e');
  });

  it('switches to the descent colour on the way back down', () => {
    const colours = draw((3000 + 3000 / 2) * ROUTE_DS);
    expect(colours[colours.length - 1].color).toBe('#4d9de0');
  });

  it('draws a wider stretch that stays inside the map on a short road', () => {
    const colours = draw((3000 / 2) * ROUTE_DS, 'wide');
    const xs = colours.flatMap((stroke) => [stroke.x0, stroke.x1]);
    expect(Math.min(...xs)).toBeGreaterThan(40);
    expect(Math.max(...xs)).toBeLessThan(380);
    expect(colours[colours.length - 1].color).toBe('#e2412e');
  });

  it('cycles nearby road, wider road, then the full loop', () => {
    const canvas = { width: 0, height: 0, clientWidth: 200, clientHeight: 160, getContext: () => ({}) };
    const map = new Minimap(canvas as unknown as HTMLCanvasElement);
    expect(map.current()).toBe('ahead');
    expect(map.toggle()).toBe('Map: wider road');
    expect(map.current()).toBe('wide');
    expect(map.toggle()).toBe('Map: full loop');
    expect(map.current()).toBe('loop');
    expect(map.toggle()).toBe('Map: nearby road');
    expect(map.current()).toBe('ahead');
  });
});
