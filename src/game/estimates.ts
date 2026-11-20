import { makeBikeParams, steadySpeed } from '../physics/cycling';
import type { Route } from '../routes/route';

/**
 * Estimated riding time between two route distances at a fraction of FTP.
 * Riders ease off on descents, like real riders do.
 */
export function estimateTime(route: Route, s0: number, s1: number, ftp: number, massKg: number, intensity: number): number {
  const bike = makeBikeParams(massKg);
  const step = 100;
  let t = 0;
  for (let s = s0; s < s1; s += step) {
    const d = Math.min(step, s1 - s);
    const g = (route.elevationAt(s + d) - route.elevationAt(s)) / d;
    const p = ftp * (g < -0.02 ? intensity * 0.4 : g > 0.04 ? Math.min(1, intensity * 1.12) : intensity);
    const v = Math.max(1.5, Math.min(steadySpeed(p, g, bike, route.elevationAt(s)), 20));
    t += d / v;
  }
  return t;
}

/** One full lap. Riding the loop backwards changes the time, because speed depends on the grade. */
export function estimateLap(route: Route, ftp: number, massKg: number, intensity: number, reverse = false): number {
  if (!reverse) return estimateTime(route, 0, route.length, ftp, massKg, intensity);
  const bike = makeBikeParams(massKg);
  const step = 100;
  let t = 0;
  let travelled = 0;
  let s = 0;
  while (travelled < route.length - 1e-6) {
    const d = Math.min(step, route.length - travelled);
    const s2 = route.wrap(s - d);
    const g = (route.elevationAt(s2) - route.elevationAt(s)) / d;
    const p = ftp * (g < -0.02 ? intensity * 0.4 : g > 0.04 ? Math.min(1, intensity * 1.12) : intensity);
    const v = Math.max(1.5, Math.min(steadySpeed(p, g, bike, route.elevationAt(s)), 20));
    t += d / v;
    s = s2;
    travelled += d;
  }
  return t;
}
