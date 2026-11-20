/** Gradient resolution handed to the route builder. Finer than a km so the steep ramps stay where they are. */
export const STEP_M = 100;

export interface GradePiece {
  metres: number;
  grade: number;
}

/** The published km table as pieces. The last km may be shorter than 1000 m. */
export function kmPieces(kmGrades: number[], lastKmLength = 1): GradePiece[] {
  return kmGrades.map((grade, i) => ({
    metres: i === kmGrades.length - 1 ? Math.max(0.05, lastKmLength) * 1000 : 1000,
    grade,
  }));
}

/** Pieces resampled to fixed steps, so each entry of `grades` covers exactly STEP_M metres. */
export function piecesToGrades(pieces: GradePiece[]): { length: number; grades: number[] } {
  const length = pieces.reduce((sum, p) => sum + p.metres, 0);
  const n = Math.max(2, Math.round(length / STEP_M));
  const step = length / n;
  const grades: number[] = [];
  let cursor = 0;
  let start = 0;
  for (let i = 0; i < n; i++) {
    // Average the pieces that overlap this step, weighted by overlap, so the gain is kept.
    const a = i * step;
    const b = a + step;
    let sum = 0;
    while (cursor < pieces.length - 1 && start + pieces[cursor].metres <= a) {
      start += pieces[cursor].metres;
      cursor++;
    }
    let c = cursor;
    let cs = start;
    while (c < pieces.length && cs < b) {
      const lo = Math.max(a, cs);
      const hi = Math.min(b, cs + pieces[c].metres);
      if (hi > lo) sum += pieces[c].grade * (hi - lo);
      cs += pieces[c].metres;
      c++;
    }
    grades.push(+(sum / step).toFixed(2));
  }
  return { length, grades };
}

/** Elevation gained by a set of pieces, in metres. */
export function piecesGain(pieces: GradePiece[]): number {
  return pieces.reduce((sum, p) => sum + (p.grade / 100) * p.metres, 0);
}

