import type { RealClimb, RealStage } from './types';
import climbsJson from './climbs.json';
import stagesJson from './stages.json';

/**
 * Real climbs and stages. The numbers come from published profiles (sources are
 * on each entry). A climb whose km gradients don't add up to its published gain
 * (more than 8% off), or has no gradients, is dropped instead of shown wrong.
 */
export function checkClimb(c: RealClimb): string | null {
  if (!Array.isArray(c.kmGrades) || c.kmGrades.length === 0) return 'no km gradients';
  if (c.kmGrades.some((g) => !Number.isFinite(g) || g < -15 || g > 30)) return 'gradient out of range';
  const last = c.lastKmLength > 0 && c.lastKmLength <= 1.25 ? c.lastKmLength : 1;
  let gain = 0;
  c.kmGrades.forEach((g, i) => (gain += g * 10 * (i === c.kmGrades.length - 1 ? last : 1)));
  if (c.gain > 0 && Math.abs(gain - c.gain) / c.gain > 0.08) return `gradients give ${Math.round(gain)} m, published ${c.gain} m`;
  return null;
}

export const REAL_CLIMBS: RealClimb[] = (climbsJson as unknown as RealClimb[]).filter((c) => {
  const err = checkClimb(c);
  if (err && import.meta.env?.DEV) console.warn(`[climbs] ${c.id}: ${err}`);
  return !err;
});

export const REAL_CLIMB_MAP: Map<string, RealClimb> = new Map(REAL_CLIMBS.map((c) => [c.id, c]));

export const REAL_STAGES: RealStage[] = (stagesJson as unknown as RealStage[]).filter((s) =>
  s.points.every((p) => p.type !== 'climb' || typeof p.climb !== 'string' || REAL_CLIMB_MAP.has(p.climb)),
);
