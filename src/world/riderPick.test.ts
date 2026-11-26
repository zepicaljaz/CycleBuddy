import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { pickRider } from './riderPick';
import type { RiderPose } from './riders';

const pose = (x: number, z: number, visible = true): RiderPose => ({ x, y: 0, z, tx: 1, tz: 0, grade: 0, crank: 0, wheel: 0, effort: 0, visible });

function camera(): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(58, 800 / 600, 0.3, 4000);
  cam.position.set(0, 0.875, 0);
  cam.lookAt(0, 0.875, -10);
  return cam;
}

describe('pickRider', () => {
  it('finds the rider under the cursor and places the tag above the head', () => {
    const hit = pickRider([pose(5, 0), pose(0, -20)], camera(), 800, 600, 400, 300, (i) => i === 0);
    expect(hit?.index).toBe(1);
    expect(hit!.y).toBeLessThan(300);
    expect(hit!.x).toBeCloseTo(400, 0);
  });

  it('misses empty road, skipped and hidden riders', () => {
    expect(pickRider([pose(0, -20)], camera(), 800, 600, 50, 50, () => false)).toBeNull();
    expect(pickRider([pose(0, -20)], camera(), 800, 600, 400, 300, () => true)).toBeNull();
    expect(pickRider([pose(0, -20, false)], camera(), 800, 600, 400, 300, () => false)).toBeNull();
    expect(pickRider([pose(0, 20)], camera(), 800, 600, 400, 300, () => false)).toBeNull();
  });

  it('takes the nearer rider when two overlap on screen', () => {
    expect(pickRider([pose(0, -40), pose(0, -15)], camera(), 800, 600, 400, 300, () => false)?.index).toBe(1);
  });
});
