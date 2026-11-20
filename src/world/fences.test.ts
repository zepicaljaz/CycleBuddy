import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ROUTES } from '../routes/definitions';
import { climbHairpinFence } from '../routes/regions';
import { Route } from '../routes/route';
import { fenceSpan, guardrailBeam, guardrailPost, stoneWall, woodPost, woodRails, yardRailFence } from './fences';
import { planRoadsideFences } from './scenery';

function bounds(g: THREE.BufferGeometry): THREE.Box3 {
  g.computeBoundingBox();
  return g.boundingBox!;
}

describe('fences', () => {
  it('builds a W-beam one metre long, facing the road', () => {
    const b = bounds(guardrailBeam());
    expect(b.max.x - b.min.x).toBeCloseTo(1, 1);
    expect(b.max.z).toBeGreaterThan(0.05);
    expect(b.min.y).toBeGreaterThan(0.2);
    expect(b.max.y).toBeLessThan(0.85);
  });

  it('stands the guardrail post on the ground', () => {
    const b = bounds(guardrailPost());
    expect(b.min.y).toBeGreaterThan(-0.001);
    expect(b.min.y).toBeLessThan(0.01);
    expect(b.max.y).toBeGreaterThan(0.55);
    expect(b.max.x - b.min.x).toBeGreaterThan(0.18);
  });

  it('builds a three-rail wooden bay taller than the rails', () => {
    const post = bounds(woodPost(0));
    const rails = bounds(woodRails());
    expect(post.min.y).toBeGreaterThan(-0.001);
    expect(post.max.y).toBeGreaterThan(1.15);
    expect(rails.max.x - rails.min.x).toBeCloseTo(1, 1);
    expect(rails.max.z).toBeGreaterThan(0.08);
    expect(rails.max.y).toBeLessThan(post.max.y);
  });

  it('stacks a stone wall about two metres long', () => {
    const b = bounds(stoneWall(1));
    expect(b.max.x - b.min.x).toBeGreaterThan(1.7);
    expect(b.max.x - b.min.x).toBeLessThan(2.35);
    expect(b.min.y).toBeGreaterThan(-0.08);
    expect(b.max.y).toBeGreaterThan(0.9);
    expect(b.max.y).toBeLessThan(1.35);
  });

  it('keeps a sloping bay upright on both sides of the road', () => {
    const along = new THREE.Vector3(0, 0.4, 2);
    for (const toward of [new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0)]) {
      const m = fenceSpan(new THREE.Vector3(0, 10, 0), along, toward, 2);
      const up = new THREE.Vector3(0, 1, 0).transformDirection(m);
      const face = new THREE.Vector3(0, 0, 1).transformDirection(m);
      expect(up.y).toBeGreaterThan(0.9);
      expect(face.dot(toward.clone().normalize())).toBeGreaterThan(0.9);
      expect(new THREE.Vector3(0, 0.6, 0.05).applyMatrix4(m).y).toBeGreaterThan(10.4);
    }
  });

  it('turns the yard fence along Z for a two-metre bay', () => {
    const [, rails] = yardRailFence();
    const b = bounds(rails.geom);
    expect(b.min.z).toBeGreaterThan(-0.05);
    expect(b.max.z).toBeCloseTo(2, 0);
    expect(b.max.x).toBeGreaterThan(0.05);
  });

  function onClimb(route: Route, i: number): boolean {
    const s = i * 2;
    return route.climbs.some((c) => {
      const lo = Math.min(c.start, c.end);
      const hi = Math.max(c.start, c.end);
      if (s < lo || s > hi) return false;
      const dir = c.end >= c.start ? 1 : -1;
      return (c.end - s) * dir >= 250;
    });
  }

  function hairpinPlacement(routeId: string) {
    const route = new Route(ROUTES.find((r) => r.id === routeId)!);
    const marks = planRoadsideFences(route, [], []);
    let corners = 0;
    let outsideKind = 0;
    let insideFenced = 0;
    let offClimb = 0;
    let metal = 0;
    let stone = 0;
    for (let i = 6; i < route.count - 6; i++) {
      const left = marks[0][i];
      const right = marks[1][i];
      if (left === 1 || right === 1) metal++;
      if (left === 2 || right === 2) stone++;
      if (!onClimb(route, i) && (left || right)) offClimb++;
      const dot = route.tx[i - 2] * route.tx[i + 2] + route.tz[i - 2] * route.tz[i + 2];
      if (dot >= 0.85 || !onClimb(route, i)) continue;
      corners++;
      const mx = (route.x[i - 4] + route.x[i + 4]) / 2;
      const mz = (route.z[i - 4] + route.z[i + 4]) / 2;
      const bulge = (route.x[i] - mx) * -route.tz[i] + (route.z[i] - mz) * route.tx[i];
      const outside = bulge >= 0 ? 1 : -1;
      const outMark = outside > 0 ? right : left;
      const inMark = outside > 0 ? left : right;
      if (outMark !== 0) outsideKind++;
      if (inMark !== 0) insideFenced++;
    }
    return { corners, outsideKind, insideFenced, offClimb, metal, stone };
  }

  it('picks the hairpin fence from the landscape', () => {
    expect(climbHairpinFence('alpine')).toBe('metal');
    expect(climbHairpinFence('oakwood')).toBe('metal');
    expect(climbHairpinFence('vosges')).toBe('metal');
    expect(climbHairpinFence('calobra')).toBe('stone');
    expect(climbHairpinFence('canyon')).toBe('stone');
    expect(climbHairpinFence('highland')).toBe('stone');
  });

  it('uses a metal rail only on the outside of climb hairpins in the high mountains', () => {
    const placed = hairpinPlacement('alpine');
    expect(placed.corners).toBeGreaterThan(80);
    expect(placed.outsideKind / placed.corners).toBeGreaterThan(0.75);
    expect(placed.insideFenced).toBe(0);
    expect(placed.offClimb).toBe(0);
    expect(placed.metal).toBeGreaterThan(0);
    expect(placed.stone).toBe(0);
  });

  it('uses a stone wall only on the outside of climb hairpins in limestone, desert and grassland', () => {
    for (const id of ['calobra', 'canyon', 'highland']) {
      const placed = hairpinPlacement(id);
      expect(placed.corners, id).toBeGreaterThan(8);
      expect(placed.outsideKind / placed.corners, id).toBeGreaterThan(0.75);
      expect(placed.insideFenced, id).toBe(0);
      expect(placed.offClimb, id).toBe(0);
      expect(placed.stone, id).toBeGreaterThan(0);
      expect(placed.metal, id).toBe(0);
    }
  });
});
