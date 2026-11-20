/** Named climbs that sit fully inside a career stage, long enough to count as a segment. */
export function climbsInside<T extends { start: number; end: number; length: number }>(climbs: T[], startS: number, finishS: number): T[] {
  const start = Math.min(startS, finishS);
  const end = Math.max(startS, finishS);
  return climbs.filter((climb) => climb.start >= start - 40 && climb.end <= end + 50 && climb.length > 180);
}

/**
 * True when a rider moving toward smaller route metres passes `mark` on this step.
 * A wrap from the start of the loop back onto the end counts. A normal forward step does not.
 */
export function passedMarkBackward(prevS: number, s: number, mark: number, length: number): boolean {
  if (!(length > 0)) return false;
  if (s < prevS) return s < mark && mark <= prevS;
  if (s === prevS) return false;
  const forward = s - prevS;
  const back = prevS + (length - s);
  if (!(back > 0) || back > forward) return false;
  return mark <= prevS || mark > s;
}
