import * as THREE from 'three';
import type { RiderPose } from './riders';

/** A rider on a bike, in metres: about this tall and this wide seen from any side. */
const RIDER_HEIGHT = 1.75;
const RIDER_HALF_WIDTH = 0.6;
/** A rider far away is a few pixels tall. The cursor still gets this much room. */
const MIN_HALF_PX = 7;
/** Past this the rider is a speck. Nothing to read. */
const MAX_PICK_M = 220;

export interface RiderPick {
  index: number;
  /** Screen point just above the rider's head, in the same pixels as the cursor. */
  x: number;
  y: number;
}

const tmp = new THREE.Vector3();
const head = new THREE.Vector3();

/**
 * The rider under the cursor, or null. Each visible rider is a box on screen
 * from wheels to helmet. When boxes overlap, the rider nearest the camera wins,
 * because that is the one you can see. `skip` leaves riders out (the player).
 * Cursor and result are in pixels from the top-left of a `width` × `height` view.
 */
export function pickRider(
  poses: readonly RiderPose[],
  camera: THREE.PerspectiveCamera,
  width: number,
  height: number,
  cursorX: number,
  cursorY: number,
  skip: (index: number) => boolean,
): RiderPick | null {
  if (width <= 0 || height <= 0) return null;
  camera.updateMatrixWorld();
  const pxPerM = height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  let best: RiderPick | null = null;
  let bestDist = Infinity;
  for (let i = 0; i < poses.length; i++) {
    const p = poses[i];
    if (!p.visible || skip(i)) continue;
    const dist = camera.position.distanceTo(tmp.set(p.x, p.y + RIDER_HEIGHT / 2, p.z));
    if (dist > MAX_PICK_M || dist >= bestDist || dist < 0.5) continue;
    tmp.project(camera);
    if (tmp.z > 1 || tmp.z < -1) continue;
    const cx = (tmp.x * 0.5 + 0.5) * width;
    const cy = (-tmp.y * 0.5 + 0.5) * height;
    const scale = pxPerM / dist;
    const halfW = Math.max(MIN_HALF_PX, RIDER_HALF_WIDTH * scale);
    const halfH = Math.max(MIN_HALF_PX, (RIDER_HEIGHT / 2) * scale);
    if (Math.abs(cursorX - cx) > halfW || Math.abs(cursorY - cy) > halfH) continue;
    head.set(p.x, p.y + RIDER_HEIGHT + 0.25, p.z).project(camera);
    best = { index: i, x: (head.x * 0.5 + 0.5) * width, y: (-head.y * 0.5 + 0.5) * height };
    bestDist = dist;
  }
  return best;
}
