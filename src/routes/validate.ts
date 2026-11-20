import type { RouteDef } from './types';

/**
 * Catches a broken route definition before the builder turns it into NaN
 * elevations or a road that silently wraps. Section indices are stored in a
 * Uint8Array, so a route can hold at most 255 sections.
 */
export function routeDefProblems(def: RouteDef): string[] {
  const out: string[] = [];
  if (!def.sections.length) out.push('no sections');
  if (def.sections.length > 255) out.push(`${def.sections.length} sections, the limit is 255`);
  def.sections.forEach((s, i) => {
    if (!(s.length > 0) || !Number.isFinite(s.length)) out.push(`section ${i}: length ${s.length}`);
    if (!s.grades.length) out.push(`section ${i}: no grades`);
    else if (s.grades.some((g) => !Number.isFinite(g) || Math.abs(g) > 30)) out.push(`section ${i}: a grade is not a number or steeper than 30%`);
  });
  for (const c of def.climbs ?? []) {
    if (c.fromSection < 0 || c.toSection >= def.sections.length || c.fromSection > c.toSection) {
      out.push(`climb ${c.id}: sections ${c.fromSection}–${c.toSection} are outside the route`);
    }
  }
  return out;
}
