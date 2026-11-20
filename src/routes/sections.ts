import { mulberry32 } from '../util/math';
import type { SectionDef, SectionStyle } from './types';

export const winding = (amplitudeDeg = 25, wavelength = 900): SectionStyle => ({ kind: 'winding', amplitudeDeg, wavelength });
/** Bendy road with straights in between. Wavelength is the typical gap between corners. */
export const bend = (amplitudeDeg = 52, wavelength = 240): SectionStyle => winding(amplitudeDeg, wavelength);
export const hairpins = (count: number, legAngleDeg = 11, radius = 12): SectionStyle => ({
  kind: 'hairpins',
  count,
  legAngleDeg,
  radius,
});

/**
 * A climb from a list of gradients spread evenly over its length (about one per km).
 * A short last km is not given its own length here; exact km tables go through routes/real (kmPieces).
 */
export function climb(perKm: number[], lengthKm: number, style: SectionStyle): SectionDef {
  return { length: lengthKm * 1000, grades: perKm, style };
}

/** Same as a climb profile, including a descent that eases from one grade to the next. */
export function profile(lengthKm: number, grades: number[], style: SectionStyle): SectionDef {
  return { length: lengthKm * 1000, grades, style };
}

/**
 * The bends from the foot of the climb up to the saddle.
 * Tight stacks first, where the slope is steepest, then a long wiggle.
 */
export function larchBends(): SectionStyle {
  const turn = (heading: number, hold: number, radius: number) => ({ heading, hold, radius });
  return {
    kind: 'traced',
    steps: [
      // Leaving the town at the foot. The first stacks are the steep lower slope.
      turn(-24, 60, 42),
      turn(68, 200, 28),
      turn(-72, 230, 26),
      turn(70, 190, 26),
      turn(-74, 240, 28),
      turn(66, 200, 28),
      turn(-48, 180, 36),
      turn(64, 210, 30),
      turn(-68, 220, 28),
      turn(62, 190, 30),
      turn(-60, 200, 32),
      // The slope eases. The road keeps turning, with longer legs, up to the saddle.
      turn(32, 200, 42),
      turn(-34, 190, 40),
      turn(26, 210, 48),
      turn(-28, 200, 46),
      turn(20, 220, 54),
      turn(-18, 200, 56),
      turn(14, 180, 60),
      turn(0, 160, 64),
    ],
  };
}

export function steady(lengthKm: number, gradePct: number, style: SectionStyle): SectionDef {
  return { length: lengthKm * 1000, grades: [gradePct], style };
}

/** Almost level, with one short rise so a lakeside road still has a crest to start from. */
export function lakeside(lengthKm: number, style: SectionStyle, crestKm = -1): SectionDef {
  return level(lengthKm, style, crestKm);
}

/**
 * A flat road. The whole section stays near ±0.2%, except one optional crest of
 * about 1% so a loop still has a few places to start.
 */
export function level(lengthKm: number, style: SectionStyle = bend(), crestKm = -1): SectionDef {
  const length = lengthKm * 1000;
  const n = Math.max(12, Math.round(length / 40));
  const crest = crestKm * 1000;
  const grades: number[] = [];
  for (let i = 0; i < n; i++) {
    const m = ((i + 0.5) / n) * length;
    const d = m - crest;
    let g = Math.sin((m / 5200) * Math.PI * 2) * 0.18;
    if (crestKm >= 0 && d >= -750 && d < 0) g = 1;
    else if (crestKm >= 0 && d >= 0 && d < 750) g = -1;
    grades.push(+g.toFixed(2));
  }
  return { length, grades, style };
}

interface GradePiece {
  metres: number;
  grade: number;
}

/** Spread pieces across equal samples so a long climb stays a long climb. */
function resample(length: number, pieces: GradePiece[]): number[] {
  const n = Math.max(8, Math.round(length / 80));
  const total = pieces.reduce((sum, p) => sum + p.metres, 0) || 1;
  const grades: number[] = [];
  let cursor = 0;
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const m = ((i + 0.5) / n) * total;
    while (cursor < pieces.length - 1 && acc + pieces[cursor].metres < m) {
      acc += pieces[cursor].metres;
      cursor++;
    }
    grades.push(pieces[cursor].grade);
  }
  return grades;
}

/**
 * Hills of uneven length and height. A climb is not matched by the descent after it,
 * and a few short flats break the pattern without turning the valley into a plain.
 * Net elevation stays near zero so the section does not drift into the sea.
 */
export function rolling(lengthKm: number, amplitudePct: number, seed: number, style: SectionStyle = bend()): SectionDef {
  const rng = mulberry32(seed);
  const length = lengthKm * 1000;
  const pieces: GradePiece[] = [];
  let remain = length;
  let elev = 0;

  const push = (metres: number, grade: number) => {
    if (remain < 30) return;
    const m = Math.min(Math.max(40, metres), remain);
    const g = Math.max(-7.5, Math.min(amplitudePct * 1.15, grade));
    pieces.push({ metres: m, grade: g });
    elev += (g / 100) * m;
    remain -= m;
  };

  while (remain > 50) {
    const high = elev > 24;
    const low = elev < -18;
    const roll = rng();
    if (!high && !low && roll < 0.16) {
      push(160 + rng() * 380, (rng() - 0.5) * 0.7);
      continue;
    }
    const up = high ? false : low ? true : rng() < 0.52;
    const long = rng() < 0.32;
    const dist = long ? 620 + rng() * 780 : 170 + rng() * 430;
    let mag = amplitudePct * (long ? 0.42 + rng() * 0.45 : 0.5 + rng() * 0.6);
    if (up && elev > 8) mag *= 0.72;
    if (!up && elev < -6) mag *= 0.72;
    const sign = up ? 1 : -1;
    if (long && remain > 200) {
      const split = 0.32 + rng() * 0.36;
      const mag2 = mag * (0.65 + rng() * 0.6);
      push(dist * split, sign * mag);
      push(dist * (1 - split), sign * mag2);
    } else {
      push(dist, sign * mag);
    }
  }

  const grades = resample(length, pieces);
  const mean = grades.reduce((a, b) => a + b, 0) / grades.length;
  let balanced = grades.map((g) => g - mean);
  const dm = length / balanced.length;
  let e = 0;
  let lo = 0;
  let hi = 0;
  for (const g of balanced) {
    e += (g / 100) * dm;
    lo = Math.min(lo, e);
    hi = Math.max(hi, e);
  }
  const swing = Math.max(-lo, hi, 1);
  const cap = 32;
  if (swing > cap) balanced = balanced.map((g) => g * (cap / swing));
  return { length, grades: balanced.map((g) => +g.toFixed(2)), style };
}

/** A net descent with uneven drops, the odd short rise, and a few easier stretches. */
export function descent(lengthKm: number, avgPct: number, seed: number, style: SectionStyle = bend(46, 280)): SectionDef {
  const rng = mulberry32(seed);
  const length = lengthKm * 1000;
  const pieces: GradePiece[] = [];
  let remain = length;

  const push = (metres: number, grade: number) => {
    if (remain < 30) return;
    const m = Math.min(Math.max(40, metres), remain);
    pieces.push({ metres: m, grade });
    remain -= m;
  };

  while (remain > 40) {
    const roll = rng();
    let dist: number;
    let grade: number;
    if (roll < 0.14) {
      dist = 140 + rng() * 300;
      grade = 1.3 + rng() * 3.2;
    } else if (roll < 0.3) {
      dist = 200 + rng() * 480;
      grade = avgPct * (0.18 + rng() * 0.32);
    } else if (roll < 0.58) {
      dist = 420 + rng() * 850;
      grade = avgPct * (0.62 + rng() * 0.5);
    } else {
      dist = 160 + rng() * 400;
      grade = avgPct * (1.1 + rng() * 0.5);
    }
    if (dist > 460 && roll >= 0.3 && remain > dist * 0.6) {
      const split = 0.34 + rng() * 0.32;
      push(dist * split, grade);
      push(dist * (1 - split), grade * (0.72 + rng() * 0.5));
    } else {
      push(dist, grade);
    }
  }

  const grades = resample(length, pieces);
  const mean = grades.reduce((a, b) => a + b, 0) / grades.length;
  return {
    length,
    grades: grades.map((g) => +Math.max(-13, Math.min(7.5, g - mean + avgPct)).toFixed(2)),
    style,
  };
}

