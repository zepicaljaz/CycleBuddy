import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ROUTES } from '../routes/definitions';
import { getRoute } from '../routes/route';
import { ensureAllTracks, realClimbRoute, realRoadClimbs } from '../routes/real/build';
import { buildRoad } from './road';

await ensureAllTracks();

/**
 * Triangles of the road surface that face down. The road is one-sided, so a
 * triangle flipped over is not drawn at all: a hole you can see under the road
 * through. It happens on the inside of tight hairpins when the inner edge of the
 * road and verge swings backwards.
 */
function flipped(road: THREE.Group): { flipped: number; total: number } {
  let bad = 0;
  let total = 0;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  road.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const pos = o.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i += 3) {
      a.fromBufferAttribute(pos, i);
      b.fromBufferAttribute(pos, i + 1);
      c.fromBufferAttribute(pos, i + 2);
      // Up-facing for this winding (see quad() in road.ts): (b - a) x (c - a) points +y.
      const nx = b.clone().sub(a).cross(c.clone().sub(a));
      const area = nx.length() / 2;
      if (area < 0.01) continue; // collapsed on purpose, or a hairline sliver at a hairpin apex
      total++;
      // Upright slivers where a hairpin's inner edge pivots lie under the surface and
      // the side skirts are near-vertical; only a face clearly turned down is a hole.
      if (nx.y / (2 * area) < -0.05) bad++;
    }
  });
  return { flipped: bad, total };
}

describe('road surface', () => {
  const ids = realRoadClimbs().map((c) => c.id);

  it.each(ids)('%s: no road triangle faces down (no holes in hairpins)', (id) => {
    const climb = realRoadClimbs().find((c) => c.id === id)!;
    const road = buildRoad(getRoute(realClimbRoute(climb)));
    const r = flipped(road);
    expect(r.total).toBeGreaterThan(1000);
    expect(r.flipped).toBe(0);
  });

  it('generated roads: no road triangle faces down', () => {
    for (const def of ROUTES.slice(0, 6)) {
      const r = flipped(buildRoad(getRoute(def)));
      expect(r.flipped, def.id).toBe(0);
    }
  });
});
