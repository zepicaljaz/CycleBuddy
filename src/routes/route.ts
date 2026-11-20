import { clamp, mulberry32 } from '../util/math';
import { Noise2D } from '../util/noise';
import type { ClimbDef, DemGrid, RouteDef, SectionDef, SectionStyle, TrackDef } from './types';
import { routeDefProblems } from './validate';

export const ROUTE_DS = 2; // metres between route samples

export interface RouteSample {
  x: number;
  y: number;
  z: number;
  /** Unit tangent (direction of travel) in the XZ plane. */
  tx: number;
  tz: number;
  /** Rise over run. */
  grade: number;
}

export interface Climb {
  id: string;
  name: string;
  inspiredBy: string;
  start: number;
  end: number;
  length: number;
  gain: number;
  avgGrade: number;
  maxGrade: number;
  startElevation: number;
  summitElevation: number;
}

interface LocalPoint {
  u: number;
  v: number;
  section: number;
  frac: number;
}

/** Walks a section with a turtle in local (u = along base loop, v = lateral) space. */
function buildLocalPath(sections: SectionDef[]): LocalPoint[] {
  const pts: LocalPoint[] = [];
  let u = 0;
  let v = 0;
  let heading = 0;
  const step = 1;
  // The asphalt is about 10 m wide, so a tighter bend folds the road over itself.
  const MIN_BEND = 13;
  const approach = (target: number, dist: number) => {
    let delta = target - heading;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    const max = Math.max(0, dist) / MIN_BEND;
    if (delta > max) delta = max;
    else if (delta < -max) delta = -max;
    heading += delta;
  };
  pts.push({ u, v, section: 0, frac: 0 });

  sections.forEach((sec, si) => {
    const L = sec.length;
    let travelled = 0;
    const emit = () => pts.push({ u, v, section: si, frac: clamp(travelled / L, 0, 1) });
    const advance = (dist: number, turnRate: number) => {
      let remaining = dist;
      while (remaining > 1e-6) {
        const d = Math.min(step, remaining);
        const rate = Math.max(-1 / MIN_BEND, Math.min(1 / MIN_BEND, turnRate));
        heading += rate * d * 0.5;
        u += Math.cos(heading) * d;
        v += Math.sin(heading) * d;
        heading += rate * d * 0.5;
        remaining -= d;
        travelled += d;
        emit();
      }
    };

    const style: SectionStyle = sec.style;
    if (style.kind === 'straight') {
      advance(L, 0);
    } else if (style.kind === 'winding') {
      // Straights, then a real corner or a longer gentle bend. Not a continuous slalom,
      // and not kilometres of ruler-straight road.
      const rng = mulberry32(
        (Math.imul(si + 1, 10007) + Math.round(style.amplitudeDeg * 17) + Math.round(style.wavelength) + Math.round(L / 10)) >>> 0,
      );
      const amp = (style.amplitudeDeg * Math.PI) / 180;
      const move = (dist: number, headingAt: (t: number) => number) => {
        let done = 0;
        let remaining = dist;
        while (remaining > 1e-6 && travelled < L - 1e-6) {
          const d = Math.min(step, remaining, L - travelled);
          if (d < 1e-8) break;
          const t = dist <= 1e-6 ? 1 : Math.min(1, (done + d) / dist);
          approach(headingAt(t), d);
          u += Math.cos(heading) * d;
          v += Math.sin(heading) * d;
          remaining -= d;
          done += d;
          travelled += d;
          emit();
        }
      };
      const room = () => L - 160 - travelled;
      const ease = (dist: number, target: number) => {
        const from = heading;
        const len = Math.min(dist, Math.max(0, room()));
        if (len < 20) return;
        move(len, (t) => {
          const e = t * t * (3 - 2 * t);
          return from + (target - from) * e;
        });
      };
      while (room() > 60) {
        // Pull back toward the valley if a corner has carried the road off to one side.
        if (Math.abs(v) > 60 && room() > 40) {
          const targetH = Math.max(-0.3, Math.min(0.3, -v / 480));
          const from = heading;
          const len = Math.min(90, room());
          move(len, (t) => {
            const e = t * t * (3 - 2 * t);
            return from + (targetH - from) * e;
          });
        }
        const roll = rng();
        let straight = 140 + rng() * 180;
        if (roll < 0.15) straight = 420 + rng() * 260;
        else if (roll < 0.32) straight = 75 + rng() * 50;
        const hold = heading;
        move(Math.min(straight, room()), () => hold);
        if (room() < 40) break;
        const side = v > 50 ? -1 : v < -50 ? 1 : rng() < 0.5 ? -1 : 1;
        const gentle = rng() < 0.36;
        const target = side * amp * (gentle ? 0.32 + rng() * 0.38 : 0.58 + rng() * 0.42);
        const sweep = Math.abs(target - heading);
        ease(gentle ? 140 + rng() * 120 : 50 + sweep * 38 + rng() * 20, target);
        if (room() < 30) break;
        const leg = Math.min(40 + rng() * 80, room());
        const held = heading;
        move(leg, () => held);
        if (room() < 30) break;
        const back = Math.max(-0.22, Math.min(0.22, -v / 420));
        const backSweep = Math.abs(back - heading);
        ease(gentle ? 120 + rng() * 80 : 50 + backSweep * 34, back);
      }
      const from = heading;
      const left = L - travelled;
      if (left > 1) {
        move(left, (t) => {
          const e = t * t * (3 - 2 * t);
          return from * (1 - e);
        });
      }
    } else if (style.kind === 'traced') {
      // A specific sequence of bends, used when a climb's turns are known.
      for (const bend of style.steps) {
        if (L - travelled < 16) break;
        const target = Math.max(-1.28, Math.min(1.28, (bend.heading * Math.PI) / 180));
        let delta = target - heading;
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        const radius = Math.max(13, bend.radius);
        const arc = Math.abs(delta) * radius;
        const room = L - travelled - 8;
        if (arc > 0.5 && room > 6) advance(Math.min(arc, room), delta / arc);
        const hold = Math.min(Math.max(0, bend.hold), Math.max(0, L - travelled - 8));
        if (hold > 0.5) advance(hold, 0);
      }
      // Come back onto the valley line before the section ends.
      if (Math.abs(v) > 12 && L - travelled > 36) {
        const back = Math.max(-1.05, Math.min(1.05, Math.atan2(-v, Math.max(70, L - travelled))));
        let delta = back - heading;
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        const radius = 28;
        const arc = Math.abs(delta) * radius;
        if (arc > 0.5 && L - travelled > arc + 16) advance(Math.min(arc, L - travelled - 16), delta / arc);
        const hold = Math.min(Math.max(0, L - travelled - 30), Math.abs(v) + 20);
        if (hold > 1) advance(hold, 0);
      }
      const from = heading;
      const left = L - travelled;
      if (left > 1) {
        let done = 0;
        let remaining = left;
        while (remaining > 1e-6) {
          const d = Math.min(step, remaining);
          const t = left <= 1 ? 1 : Math.min(1, (done + d) / left);
          const e = t * t * (3 - 2 * t);
          approach(from * (1 - e), d);
          u += Math.cos(heading) * d;
          v += Math.sin(heading) * d;
          remaining -= d;
          done += d;
          travelled += d;
          emit();
        }
      }
    } else {
      // A climb is a mountainside road, not a ladder. Hairpins come in short
      // stacks. Between them the road traverses (long legs, corners that often
      // keep turning the same way) or just wanders uphill with small bends.
      const rng = mulberry32(
        (Math.imul(si + 1, 9176) + style.count * 19 + Math.round(L / 10) + Math.round((style.radius ?? 14) * 10)) >>> 0,
      );
      const baseR = Math.max(13, style.radius ?? 14);
      const v0 = v;
      const maxH = 1.32;
      const band = 180;
      const exitKeep = 170;
      const room = () => L - travelled - exitKeep;
      const clampH = (h: number) => Math.max(-maxH, Math.min(maxH, h));
      const drift = () => v - v0;

      const turnTo = (target: number, radius: number) => {
        target = clampH(target);
        const sweep = target - heading;
        if (Math.abs(sweep) < 0.04) {
          heading = target;
          return;
        }
        const radiusUsed = Math.max(12.5, radius);
        const arc = Math.abs(sweep) * radiusUsed;
        const available = Math.max(0, L - travelled - 12);
        if (arc + 6 > available) {
          if (available > 10) advance(Math.min(arc, available), Math.sign(sweep) / radiusUsed);
          return;
        }
        advance(arc, Math.sign(sweep) / radiusUsed);
      };

      // Constant heading. Stop early if this leg is walking off the hillside.
      const hold = (dist: number) => {
        let remaining = Math.min(dist, Math.max(0, L - travelled - 12));
        while (remaining > 1e-6) {
          if (Math.abs(drift()) > band && Math.sin(heading) * drift() > 0) break;
          const d = Math.min(step, remaining);
          u += Math.cos(heading) * d;
          v += Math.sin(heading) * d;
          remaining -= d;
          travelled += d;
          emit();
        }
      };

      // Only take over once the road is near the edge. Earlier than that, a
      // corner is allowed to keep turning the same way.
      const steer = (prefer: number) => {
        const d = drift();
        if (Math.abs(d) < band * 0.85) return clampH(prefer);
        return clampH(-Math.sign(d) * Math.min(0.9, 0.35 + Math.abs(d) / 280));
      };

      let stacksLeft = L < 3800 ? 1 : L < 7500 ? 2 : L < 12000 ? 3 : 4;
      if (style.count >= 44) stacksLeft += 1;
      let regularUsed = false;
      let wantOpen = rng() < 0.75;

      while (room() > 110) {
        const mark = travelled;
        const gradeNow = sectionGrade(sec, clamp(travelled / L, 0, 1));
        if (gradeNow > 6 && room() > 160) {
          // Above 6% the road switchbacks. A short link keeps one stack from
          // running into the next, without opening into a long traverse.
          const n = 4 + Math.floor(rng() * 4);
          let dir = Math.abs(drift()) > 45 ? -Math.sign(drift()) : rng() < 0.5 ? -1 : 1;
          for (let i = 0; i < n && room() > 64; i++) {
            if (i > 0 && sectionGrade(sec, clamp(travelled / L, 0, 1)) <= 6) break;
            const mag = 1.08 + rng() * 0.2;
            const radius = Math.max(13, Math.min(19, baseR * (0.92 + rng() * 0.22)));
            const leg = 38 + rng() * 32;
            turnTo(dir * mag, radius);
            if (room() < 18) break;
            hold(Math.min(leg, room()));
            dir = -dir;
          }
          if (room() > 70 && sectionGrade(sec, clamp(travelled / L, 0, 1)) > 6) {
            const side = Math.abs(drift()) > 30 ? -Math.sign(drift()) : dir;
            turnTo(steer(side * (0.28 + rng() * 0.2)), 24);
            hold(Math.min(55 + rng() * 40, room()));
          }
        } else if (!wantOpen && stacksLeft > 0 && room() > 340) {
          const n = 3 + Math.floor(rng() * 4);
          const regular = !regularUsed && rng() < 0.75;
          if (regular) regularUsed = true;
          let dir = Math.abs(drift()) > 45 ? -Math.sign(drift()) : rng() < 0.5 ? -1 : 1;
          const evenMag = 1.02 + rng() * 0.2;
          const evenR = baseR * (1.02 + rng() * 0.18);
          const evenLeg = 46 + rng() * 26;
          for (let i = 0; i < n && room() > 80; i++) {
            const mag = regular ? evenMag * (0.96 + rng() * 0.08) : 0.98 + rng() * 0.28;
            const radius = Math.max(13, Math.min(28, regular ? evenR * (0.94 + rng() * 0.1) : baseR * (0.95 + rng() * 0.65)));
            let leg = regular ? evenLeg * (0.88 + rng() * 0.22) : 42 + rng() * 80;
            if (!regular && rng() < 0.22) leg = 120 + rng() * 60;
            turnTo(dir * mag, radius);
            if (room() < 24) break;
            hold(Math.min(leg, room()));
            dir = -dir;
          }
          stacksLeft--;
          wantOpen = true;
        } else if (rng() < 0.58) {
          // Long diagonal. Two or three corners keep turning the same way,
          // then the road bends back across the slope.
          let side = drift() > 40 ? -1 : drift() < -40 ? 1 : rng() < 0.5 ? -1 : 1;
          let h = side * (0.12 + rng() * 0.16);
          let sameRun = 0;
          const bends = 4 + Math.floor(rng() * 2);
          for (let i = 0; i < bends && room() > 90; i++) {
            const before = travelled;
            turnTo(steer(h), 28 + rng() * 18);
            const leg = 240 + rng() * 220;
            hold(Math.min(leg, Math.max(0, room())));
            const finished = travelled - before > leg * 0.65;
            const sign = Math.sign(h) || side;
            if (sameRun < 3 && finished && Math.abs(drift()) < band * 0.62) {
              h = sign * Math.min(0.72, Math.abs(h) + 0.1 + rng() * 0.16);
              sameRun++;
            } else {
              side = -sign;
              h = side * (0.12 + rng() * 0.2);
              sameRun = 0;
            }
          }
          wantOpen = stacksLeft > 0 ? rng() < 0.4 : true;
        } else {
          // Gentle uphill. A bend often continues, and only then swings the other way a little.
          let h = (rng() < 0.5 ? -1 : 1) * (0.06 + rng() * 0.1);
          if (Math.abs(drift()) > 50) h = -Math.sign(drift()) * Math.abs(h);
          let sameRun = 0;
          const bends = 4 + Math.floor(rng() * 2);
          for (let i = 0; i < bends && room() > 80; i++) {
            const before = travelled;
            turnTo(steer(h), 32 + rng() * 18);
            const straight = 160 + rng() * 180;
            hold(Math.min(straight, Math.max(0, room())));
            const sign = Math.sign(h) || 1;
            const finished = travelled - before > straight * 0.65;
            if (sameRun < 3 && finished && Math.abs(drift()) < band * 0.6) {
              h = sign * Math.min(0.42, Math.abs(h) + 0.06 + rng() * 0.1);
              sameRun++;
            } else {
              h = -sign * (0.06 + rng() * 0.12);
              sameRun = 0;
            }
          }
          wantOpen = stacksLeft > 0 ? rng() < 0.45 : true;
        }
        if (travelled - mark < 20) {
          turnTo(steer(0), 26);
          hold(Math.min(100, Math.max(0, room())));
          if (travelled - mark < 12) break;
        }
      }

      // Come back toward the line this section started on, then straighten.
      if (Math.abs(drift()) > 20 && L - travelled > 40) {
        const back = clampH(Math.atan2(-drift(), Math.max(90, L - travelled)));
        turnTo(back, 22);
        hold(Math.max(0, L - travelled - 36));
      }
      const from = heading;
      const left = L - travelled;
      if (left > 1) {
        let done = 0;
        let remaining = left;
        while (remaining > 1e-6) {
          const d = Math.min(step, remaining);
          const t = left <= 1 ? 1 : Math.min(1, (done + d) / left);
          const e = t * t * (3 - 2 * t);
          approach(from * (1 - e), d);
          u += Math.cos(heading) * d;
          v += Math.sin(heading) * d;
          remaining -= d;
          done += d;
          travelled += d;
          emit();
        }
      }
    }
  });
  return pts;
}

type PlanPoint = { x: number; z: number };

function cornerTurn(prev: PlanPoint, curr: PlanPoint, next: PlanPoint) {
  const d1x = curr.x - prev.x;
  const d1z = curr.z - prev.z;
  const d2x = next.x - curr.x;
  const d2z = next.z - curr.z;
  const l1 = Math.hypot(d1x, d1z) || 1;
  const l2 = Math.hypot(d2x, d2z) || 1;
  const u1x = d1x / l1;
  const u1z = d1z / l1;
  const u2x = d2x / l2;
  const u2z = d2z / l2;
  const turn = Math.atan2(u1x * u2z - u1z * u2x, u1x * u2x + u1z * u2z);
  return { l1, l2, u1x, u1z, u2x, u2z, turn };
}

/**
 * Pull a corner toward its neighbours until a fillet of `minRadius` fits on
 * both edges. A carriageway drawn further out than this radius cusps and the
 * asphalt folds over itself.
 */
function fitCorners(verts: PlanPoint[], minRadius: number): PlanPoint[] {
  const v = verts.map((p) => ({ x: p.x, z: p.z }));
  const n = v.length;
  for (let pass = 0; pass < 48; pass++) {
    let moved = false;
    for (let i = 0; i < n; i++) {
      const prev = v[(i - 1 + n) % n];
      const next = v[(i + 1) % n];
      const { l1, l2, turn } = cornerTurn(prev, v[i], next);
      const deflect = Math.abs(turn);
      if (deflect < 0.12) continue;
      const maxCut = Math.min(l1, l2) * 0.46;
      const need = minRadius * Math.tan(deflect / 2);
      if (need <= maxCut) continue;
      const pull = Math.min(0.45, 0.12 + (need / Math.max(maxCut, 1) - 1) * 0.15);
      v[i] = {
        x: v[i].x + ((prev.x + next.x) / 2 - v[i].x) * pull,
        z: v[i].z + ((prev.z + next.z) / 2 - v[i].z) * pull,
      };
      moved = true;
    }
    if (!moved) break;
  }
  return v;
}

/** Open corners that are sharp enough for the offset road to fold back on itself. */
function relaxSharp(verts: PlanPoint[]): PlanPoint[] {
  const v = verts.map((p) => ({ x: p.x, z: p.z }));
  const n = v.length;
  for (let pass = 0; pass < 8; pass++) {
    for (let i = 0; i < n; i++) {
      const prev = v[(i - 1 + n) % n];
      const next = v[(i + 1) % n];
      const { turn } = cornerTurn(prev, v[i], next);
      if (Math.abs(turn) < 1.7) continue;
      const pull = Math.min(0.4, (Math.abs(turn) - 1.45) * 0.45);
      v[i] = {
        x: v[i].x + ((prev.x + next.x) / 2 - v[i].x) * pull,
        z: v[i].z + ((prev.z + next.z) / 2 - v[i].z) * pull,
      };
    }
  }
  return v;
}

/**
 * Circular fillet. The road is drawn up to ~180 m off this line, so a tighter
 * corner makes that offset curve cusp and the asphalt folds over itself.
 */
function filletClosed(verts: PlanPoint[], minRadius: number): PlanPoint[] {
  const n = verts.length;
  const out: PlanPoint[] = [];
  for (let i = 0; i < n; i++) {
    const prev = verts[(i - 1 + n) % n];
    const curr = verts[i];
    const next = verts[(i + 1) % n];
    const { l1, l2, u1x, u1z, u2x, u2z, turn } = cornerTurn(prev, curr, next);
    const deflect = Math.abs(turn);
    if (deflect < 0.12) {
      out.push(curr);
      continue;
    }
    const maxCut = Math.min(l1, l2) * 0.46;
    let radius = minRadius;
    let tLen = radius * Math.tan(deflect / 2);
    if (tLen > maxCut) {
      tLen = maxCut;
      radius = tLen / Math.tan(deflect / 2);
    }
    if (!(radius > 8) || !(tLen > 2)) {
      out.push(curr);
      continue;
    }
    const side = Math.sign(turn) || 1;
    const p1x = curr.x - u1x * tLen;
    const p1z = curr.z - u1z * tLen;
    const cx = p1x + side * -u1z * radius;
    const cz = p1z + side * u1x * radius;
    const a0 = Math.atan2(p1z - cz, p1x - cx);
    let sweep = Math.atan2(curr.z + u2z * tLen - cz, curr.x + u2x * tLen - cx) - a0;
    while (sweep > Math.PI) sweep -= Math.PI * 2;
    while (sweep < -Math.PI) sweep += Math.PI * 2;
    if (sweep * side < 0) sweep += side * Math.PI * 2;
    // Short chords. A coarse corner, blended for a road sitting hundreds of
    // metres off this line, swings that road backward and the asphalt folds.
    const steps = Math.max(4, Math.ceil((Math.abs(sweep) * radius) / 4));
    for (let s = 0; s <= steps; s++) {
      const a = a0 + sweep * (s / steps);
      out.push({ x: cx + Math.cos(a) * radius, z: cz + Math.sin(a) * radius });
    }
  }
  return out;
}

function scaleLoop(verts: PlanPoint[], perimeter: number): PlanPoint[] {
  let len = 0;
  for (let i = 0; i < verts.length; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % verts.length];
    len += Math.hypot(b.x - a.x, b.z - a.z);
  }
  const s = perimeter / (len || 1);
  return verts.map((p) => ({ x: p.x * s, z: p.z * s }));
}

/**
 * A ride around a massif: long valley sides and a few real corners, not a circle.
 * Vertices stay in angular order, so the outline cannot cross itself.
 */
function buildBaseCurve(perimeter: number, seed: number, minRadius: number, valleyLine?: { x: number; z: number }[]) {
  const rng = mulberry32(seed);
  const n = 4 + Math.floor(rng() * 4);
  const weights = Array.from({ length: n }, () => 0.75 + rng() * 1.55);
  const wSum = weights.reduce((sum, w) => sum + w, 0);
  let ang = rng() * Math.PI * 2;
  const notch = Math.floor(rng() * n);
  const corners: PlanPoint[] = [];
  for (let i = 0; i < n; i++) {
    let radius = 0.62 + rng() * 0.85;
    if (i === notch) radius *= 0.72;
    corners.push({ x: Math.cos(ang) * radius, z: Math.sin(ang) * radius });
    ang += (weights[i] / wSum) * Math.PI * 2;
  }
  const bowed: PlanPoint[] = [];
  for (let i = 0; i < n; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % n];
    bowed.push(a);
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    let nx = -dz / len;
    let nz = dx / len;
    const mx = (a.x + b.x) / 2;
    const mz = (a.z + b.z) / 2;
    if (nx * mx + nz * mz < 0) {
      nx = -nx;
      nz = -nz;
    }
    const bow = (0.04 + rng() * 0.08) * (rng() < 0.28 ? -0.45 : 1);
    bowed.push({ x: mx + nx * bow * len, z: mz + nz * bow * len });
  }
  const valley = valleyLine && valleyLine.length >= 4 ? valleyLine.map((p) => ({ x: p.x, z: p.z })) : bowed;
  // Wider than the furthest this route's carriageway sits off the valley line,
  // so the offset curve stays outside the centre of curvature.
  const sized = scaleLoop(relaxSharp(valley), perimeter);
  const outline = filletClosed(fitCorners(sized, minRadius), minRadius);
  const segCount = outline.length;
  const edge = new Float64Array(segCount + 1);
  for (let i = 0; i < segCount; i++) {
    const a = outline[i];
    const b = outline[(i + 1) % segCount];
    edge[i + 1] = edge[i] + Math.hypot(b.x - a.x, b.z - a.z);
  }
  const total = edge[segCount];
  const M = 4096;
  const xs = new Float64Array(M + 1);
  const zs = new Float64Array(M + 1);
  const cum = new Float64Array(M + 1);
  let seg = 0;
  for (let i = 0; i <= M; i++) {
    const dist = (i / M) * total;
    while (seg < segCount - 1 && edge[seg + 1] < dist) seg++;
    const span = edge[seg + 1] - edge[seg] || 1;
    const t = Math.min(1, (dist - edge[seg]) / span);
    const a = outline[seg];
    const b = outline[(seg + 1) % segCount];
    xs[i] = a.x + (b.x - a.x) * t;
    zs[i] = a.z + (b.z - a.z) * t;
    if (i > 0) cum[i] = cum[i - 1] + Math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1]);
  }
  xs[M] = xs[0];
  zs[M] = zs[0];
  cum[M] = cum[M - 1] + Math.hypot(xs[M] - xs[M - 1], zs[M] - zs[M - 1]);
  const scale = perimeter / (cum[M] || 1);
  for (let i = 0; i <= M; i++) {
    xs[i] *= scale;
    zs[i] *= scale;
    cum[i] *= scale;
  }
  let cursor = 0;
  const tangentAt = (i: number) => {
    const j = Math.min(M, i + 1);
    const tx = xs[j] - xs[i];
    const tz = zs[j] - zs[i];
    const len = Math.hypot(tx, tz) || 1;
    return { tx: tx / len, tz: tz / len };
  };
  return (u: number) => {
    const uu = ((u % perimeter) + perimeter) % perimeter;
    if (cum[cursor] > uu) cursor = 0;
    while (cursor < M - 1 && cum[cursor + 1] < uu) cursor++;
    const t = (uu - cum[cursor]) / (cum[cursor + 1] - cum[cursor] || 1);
    const x = xs[cursor] + (xs[cursor + 1] - xs[cursor]) * t;
    const z = zs[cursor] + (zs[cursor + 1] - zs[cursor]) * t;
    // Blend the neighbouring tangents. A single chord's normal jumps at each
    // knot, and on a climb the road sits far off the valley, so that jump
    // becomes a kink in the carriageway.
    const a = tangentAt(cursor);
    const b = tangentAt(Math.min(cursor + 1, M - 1));
    let tx = a.tx * (1 - t) + b.tx * t;
    let tz = a.tz * (1 - t) + b.tz * t;
    const len = Math.hypot(tx, tz) || 1;
    tx /= len;
    tz /= len;
    // left normal: for a counter-clockwise loop this points inward
    return { x, z, nx: -tz, nz: tx };
  };
}

/** A real road line as world points, with the section and how far along it each point is. */
function trackPath(track: TrackDef): { wx: number[]; wz: number[]; local: LocalPoint[] } {
  const n = track.x.length;
  const secLen = new Map<number, number>();
  const along: number[] = [];
  for (let i = 0; i < n; i++) {
    const d = i === 0 ? 0 : Math.hypot(track.x[i] - track.x[i - 1], track.z[i] - track.z[i - 1]);
    const sec = track.sec[i];
    const at = (secLen.get(sec) ?? 0) + (i > 0 && track.sec[i - 1] === sec ? d : 0);
    secLen.set(sec, at);
    along.push(at);
  }
  const local = track.sec.map((section, i) => ({ u: 0, v: 0, section, frac: clamp(along[i] / (secLen.get(section) || 1), 0, 1) }));
  // Close the lap back onto the first point.
  return { wx: [...track.x, track.x[0]], wz: [...track.z, track.z[0]], local: [...local, { ...local[n - 1], frac: 1 }] };
}

function sectionGrade(sec: SectionDef, frac: number): number {
  const g = sec.grades;
  if (g.length === 1) return g[0];
  // chunks are centred; interpolate between neighbours for smooth transitions
  const pos = frac * g.length - 0.5;
  const i0 = clamp(Math.floor(pos), 0, g.length - 1);
  const i1 = clamp(i0 + 1, 0, g.length - 1);
  const t = clamp(pos - i0, 0, 1);
  return g[i0] + (g[i1] - g[i0]) * t;
}

export class Route {
  readonly def: RouteDef;
  readonly length: number;
  readonly count: number;
  readonly x: Float32Array;
  readonly z: Float32Array;
  readonly y: Float32Array;
  readonly grade: Float32Array;
  readonly tx: Float32Array;
  readonly tz: Float32Array;
  /** Section index per sample. */
  readonly section: Uint8Array;
  /** 1 where the sample is on a hairpin-style section. */
  readonly hairpin: Uint8Array;
  readonly climbs: Climb[];
  readonly sectionStart: number[];
  readonly bounds: { minX: number; maxX: number; minZ: number; maxZ: number; minY: number; maxY: number };
  /** Real height grids around a track road, loaded before the world is built. Null for generated roads. */
  terrain: DemGrid[] | null = null;

  constructor(def: RouteDef) {
    this.def = def;
    const track = def.track ?? null;
    let local: LocalPoint[];
    let wx: number[] = [];
    let wz: number[] = [];
    if (track) {
      ({ wx, wz, local } = trackPath(track));
    } else {
      local = buildLocalPath(def.sections);
      const endU = local[local.length - 1].u;
      const endV = local[local.length - 1].v;
      // The road must stay inside the valley's corner radius, or the carriageway
      // folds over itself where a bend passes the centre of that corner.
      let maxOff = 0;
      for (const p of local) maxOff = Math.max(maxOff, Math.abs(p.v));
      // Closing the loop slides the road sideways by endV, so the real offset is larger.
      const base = buildBaseCurve(endU, def.seed, maxOff + Math.abs(endV) + 140, def.outline);

      // Map local path to world, closing the loop laterally.
      for (let i = 0; i < local.length; i++) {
        const p = local[i];
        const vOff = p.v - (p.u / endU) * endV;
        const b = base(p.u);
        wx.push(b.x + b.nx * vOff);
        wz.push(b.z + b.nz * vOff);
      }
    }
    const wcum: number[] = [];
    // A corner of the valley can kick one sample backward. Pull those spurs
    // out so the carriageway does not reverse for a few metres.
    for (let pass = 0; pass < (track ? 0 : 6); pass++) {
      for (let i = 1; i < wx.length - 1; i++) {
        const ax = wx[i] - wx[i - 1];
        const az = wz[i] - wz[i - 1];
        const bx = wx[i + 1] - wx[i];
        const bz = wz[i + 1] - wz[i];
        const la = Math.hypot(ax, az) || 1;
        const lb = Math.hypot(bx, bz) || 1;
        const turn = Math.atan2((ax / la) * (bz / lb) - (az / la) * (bx / lb), (ax / la) * (bx / lb) + (az / la) * (bz / lb));
        if (Math.abs(turn) < 0.9) continue;
        const pull = Math.min(0.7, (Math.abs(turn) - 0.6) * 0.45);
        wx[i] += ((wx[i - 1] + wx[i + 1]) / 2 - wx[i]) * pull;
        wz[i] += ((wz[i - 1] + wz[i + 1]) / 2 - wz[i]) * pull;
      }
    }
    for (let i = 0; i < wx.length; i++) {
      wcum.push(i === 0 ? 0 : wcum[i - 1] + Math.hypot(wx[i] - wx[i - 1], wz[i] - wz[i - 1]));
    }
    const total = wcum[wcum.length - 1];
    const count = Math.floor(total / ROUTE_DS);
    this.count = count;
    this.length = count * ROUTE_DS;

    this.x = new Float32Array(count);
    this.z = new Float32Array(count);
    this.y = new Float32Array(count);
    this.grade = new Float32Array(count);
    this.tx = new Float32Array(count);
    this.tz = new Float32Array(count);
    this.section = new Uint8Array(count);
    this.hairpin = new Uint8Array(count);
    const frac = new Float32Array(count);
    const trackY = track ? new Float32Array(count) : null;
    const ty = track ? [...track.y, track.y[0]] : null;

    let j = 0;
    for (let i = 0; i < count; i++) {
      const s = (i * total) / count;
      while (j < wcum.length - 2 && wcum[j + 1] < s) j++;
      const t = (s - wcum[j]) / (wcum[j + 1] - wcum[j] || 1);
      this.x[i] = wx[j] + (wx[j + 1] - wx[j]) * t;
      this.z[i] = wz[j] + (wz[j + 1] - wz[j]) * t;
      if (trackY && ty) trackY[i] = ty[j] + (ty[j + 1] - ty[j]) * t;
      const lp = t < 0.5 ? local[j] : local[j + 1];
      this.section[i] = lp.section;
      frac[i] = lp.frac;
      const kind = def.sections[lp.section].style.kind;
      this.hairpin[i] = kind === 'hairpins' || kind === 'traced' ? 1 : 0;
    }

    // One more pass on the sampled line. A hairpin turns about 9° between
    // samples; anything sharper is a spur and gets pulled back onto the road.
    for (let pass = 0; pass < (track ? 0 : 8); pass++) {
      const nx = new Float32Array(this.x);
      const nz = new Float32Array(this.z);
      for (let i = 0; i < count; i++) {
        const a = (i - 1 + count) % count;
        const b = (i + 1) % count;
        const ax = this.x[i] - this.x[a];
        const az = this.z[i] - this.z[a];
        const bx = this.x[b] - this.x[i];
        const bz = this.z[b] - this.z[i];
        const la = Math.hypot(ax, az) || 1;
        const lb = Math.hypot(bx, bz) || 1;
        const turn = Math.abs(Math.atan2((ax / la) * (bz / lb) - (az / la) * (bx / lb), (ax / la) * (bx / lb) + (az / la) * (bz / lb)));
        if (turn < 0.55) continue;
        const pull = Math.min(0.8, (turn - 0.35) * 0.55);
        nx[i] = this.x[i] + ((this.x[a] + this.x[b]) / 2 - this.x[i]) * pull;
        nz[i] = this.z[i] + ((this.z[a] + this.z[b]) / 2 - this.z[i]) * pull;
      }
      this.x.set(nx);
      this.z.set(nz);
    }

    // Tangents
    for (let i = 0; i < count; i++) {
      const a = (i - 1 + count) % count;
      const b = (i + 1) % count;
      let dx = this.x[b] - this.x[a];
      let dz = this.z[b] - this.z[a];
      const l = Math.hypot(dx, dz) || 1;
      this.tx[i] = dx / l;
      this.tz[i] = dz / l;
    }

    if (track && trackY) {
      // A real road: its own elevation, and hairpin flags where it really bends.
      this.y.set(trackY);
      for (let i = 0; i < count; i++) {
        const a = (i - 3 + count) % count;
        const b = (i + 3) % count;
        this.grade[i] = (trackY[b] - trackY[a]) / (6 * ROUTE_DS);
      }
      this.markTrackHairpins();
    } else {
      this.buildGrades(def, count, frac);
    }
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < count; i++) {
      minY = Math.min(minY, this.y[i]);
      maxY = Math.max(maxY, this.y[i]);
    }
    // Waves stand about 0.8 m above the water plane. A road that dips to that
    // plane comes up wet. Lift the whole lap so the surface stays clear.
    const water = def.scenery.waterLevel;
    const dry = 3.5;
    if (water !== null && minY < water + dry) {
      const lift = water + dry - minY;
      for (let i = 0; i < count; i++) this.y[i] += lift;
      minY += lift;
      maxY += lift;
    }

    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < count; i++) {
      minX = Math.min(minX, this.x[i]);
      maxX = Math.max(maxX, this.x[i]);
      minZ = Math.min(minZ, this.z[i]);
      maxZ = Math.max(maxZ, this.z[i]);
    }
    this.bounds = { minX, maxX, minZ, maxZ, minY, maxY };

    if (def.reversed) this.reverseTravel();

    this.sectionStart = [];
    for (let i = 0; i < count; i++) {
      if (this.sectionStart[this.section[i]] === undefined) this.sectionStart[this.section[i]] = i * ROUTE_DS;
    }
    this.climbs = def.climbs.map((c) => this.buildClimb(c));
  }

  /** Samples inside a bend that turns more than 60° within 40 m count as hairpin road. */
  private markTrackHairpins(): void {
    const n = this.count;
    this.hairpin.fill(0);
    const w = 10;
    for (let i = 0; i < n; i++) {
      const a = (i - w + n) % n;
      const b = (i + w) % n;
      const dot = this.tx[a] * this.tx[b] + this.tz[a] * this.tz[b];
      if (dot < 0.5) this.hairpin[i] = 1;
    }
  }

  /** Generated roads: section profile + small natural variation, smoothed, closed in elevation. */
  private buildGrades(def: RouteDef, count: number, frac: Float32Array): void {
    // Grades: section profile + small natural variation, smoothed.
    const noise = new Noise2D(def.seed + 7);
    const raw = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const sec = def.sections[this.section[i]];
      const base = sectionGrade(sec, frac[i]);
      const wiggle = Math.abs(base) > 2 ? noise.noise(i * ROUTE_DS * 0.004, 0.5) * 0.9 : noise.noise(i * ROUTE_DS * 0.003, 3.5) * 0.4;
      raw[i] = base + wiggle;
    }
    const smoothed = movingAverage(raw, 15);

    // Close the elevation loop by scaling descents (or ascents) so the net gain is zero.
    let up = 0;
    let down = 0;
    for (let i = 0; i < count; i++) {
      if (smoothed[i] > 0) up += smoothed[i];
      else down -= smoothed[i];
    }
    const climbSections = new Set<number>();
    def.climbs.forEach((c) => {
      for (let s = c.fromSection; s <= c.toSection; s++) climbSections.add(s);
    });
    if (down > 0 && up > 0) {
      if (up > down) {
        const k = up / down;
        // Steep climbs add elevation. Spread that extra drop over the descents,
        // but keep every sample inside the trainer's 16% limit.
        const cap = -15.2;
        let leftover = 0;
        for (let i = 0; i < count; i++) {
          if (smoothed[i] >= 0) continue;
          const g = smoothed[i] * k;
          if (g < cap) {
            leftover += g - cap;
            smoothed[i] = cap;
          } else smoothed[i] = g;
        }
        if (leftover < 0) {
          let roomSum = 0;
          for (let i = 0; i < count; i++) if (smoothed[i] < -0.4 && smoothed[i] > cap) roomSum += smoothed[i] - cap;
          if (roomSum > 1e-3) {
            const take = Math.max(leftover / roomSum, -1);
            for (let i = 0; i < count; i++) {
              if (smoothed[i] < -0.4 && smoothed[i] > cap) smoothed[i] += (smoothed[i] - cap) * take;
            }
          }
        }
      } else {
        // scale only non-climb ascents so designed climbs keep their exact profile
        let freeUp = 0;
        for (let i = 0; i < count; i++) if (smoothed[i] > 0 && !climbSections.has(this.section[i])) freeUp += smoothed[i];
        const needed = down - (up - freeUp);
        if (freeUp > 0 && needed > 0) {
          const k = needed / freeUp;
          for (let i = 0; i < count; i++) if (smoothed[i] > 0 && !climbSections.has(this.section[i])) smoothed[i] *= k;
        } else {
          const k = up / down;
          for (let i = 0; i < count; i++) if (smoothed[i] < 0) smoothed[i] *= k;
        }
      }
    }

    let elev = def.startElevation;
    for (let i = 0; i < count; i++) {
      this.y[i] = elev;
      this.grade[i] = smoothed[i] / 100;
      elev += (smoothed[i] / 100) * ROUTE_DS;
    }
  }

  /** Same start, opposite direction. Sample 0 stays put and the lap runs backwards. */
  private reverseTravel(): void {
    const n = this.count;
    const flip = (src: Float32Array | Uint8Array) => {
      const copy = src.slice();
      for (let i = 0; i < n; i++) src[i] = copy[(n - i) % n];
    };
    flip(this.x);
    flip(this.z);
    flip(this.y);
    flip(this.section);
    flip(this.hairpin);
    for (let i = 0; i < n; i++) {
      const a = (i - 1 + n) % n;
      const b = (i + 1) % n;
      const dx = this.x[b] - this.x[a];
      const dz = this.z[b] - this.z[a];
      const l = Math.hypot(dx, dz) || 1;
      this.tx[i] = dx / l;
      this.tz[i] = dz / l;
      const next = (i + 1) % n;
      this.grade[i] = (this.y[next] - this.y[i]) / ROUTE_DS;
    }
  }

  private buildClimb(c: ClimbDef): Climb {
    const n = this.count;
    const inClimb = (i: number) => {
      const section = this.section[i];
      return section >= c.fromSection && section <= c.toSection;
    };
    let i0 = 0;
    while (i0 < n && !inClimb(i0)) i0++;
    let i1 = i0;
    while (i1 + 1 < n && inClimb(i1 + 1)) i1++;
    const start = i0 * ROUTE_DS;
    const end = i1 + 1 >= n ? this.length - ROUTE_DS : (i1 + 1) * ROUTE_DS;
    const endIndex = Math.floor(end / ROUTE_DS);
    let maxGrade = 0;
    // Max grade over 100 m windows like real climb stats
    const w = 50;
    for (let i = i0; i + w <= endIndex; i += 5) {
      maxGrade = Math.max(maxGrade, (this.y[i + w] - this.y[i]) / (w * ROUTE_DS));
    }
    const gain = this.y[endIndex] - this.y[i0];
    return {
      id: c.id,
      name: c.name,
      inspiredBy: c.inspiredBy,
      start,
      end,
      length: end - start,
      gain,
      avgGrade: gain / (end - start),
      maxGrade,
      startElevation: this.y[i0],
      summitElevation: this.y[endIndex],
    };
  }

  wrap(s: number): number {
    return ((s % this.length) + this.length) % this.length;
  }

  /** Interpolated sample at distance s (wraps around the loop). */
  sample(s: number, out: RouteSample = { x: 0, y: 0, z: 0, tx: 1, tz: 0, grade: 0 }): RouteSample {
    const ss = this.wrap(s) / ROUTE_DS;
    const i0 = Math.floor(ss) % this.count;
    const i1 = (i0 + 1) % this.count;
    const t = ss - Math.floor(ss);
    out.x = this.x[i0] + (this.x[i1] - this.x[i0]) * t;
    out.z = this.z[i0] + (this.z[i1] - this.z[i0]) * t;
    out.y = this.y[i0] + (this.y[i1] - this.y[i0]) * t;
    out.grade = this.grade[i0] + (this.grade[i1] - this.grade[i0]) * t;
    const tx = this.tx[i0] + (this.tx[i1] - this.tx[i0]) * t;
    const tz = this.tz[i0] + (this.tz[i1] - this.tz[i0]) * t;
    const l = Math.hypot(tx, tz) || 1;
    out.tx = tx / l;
    out.tz = tz / l;
    return out;
  }

  /**
   * Centreline sample shifted sideways (positive = right). The shift follows the
   * interpolated heading, so a rider does not hop along the road when a bend
   * crosses a sample. Using the heading of only the previous sample snaps the
   * offset by a few centimetres on every corner.
   */
  place(s: number, lateral: number, out: RouteSample = { x: 0, y: 0, z: 0, tx: 1, tz: 0, grade: 0 }): RouteSample {
    this.sample(s, out);
    out.x -= out.tz * lateral;
    out.z += out.tx * lateral;
    return out;
  }

  elevationAt(s: number): number {
    const ss = this.wrap(s) / ROUTE_DS;
    const i0 = Math.floor(ss) % this.count;
    const i1 = (i0 + 1) % this.count;
    const t = ss - Math.floor(ss);
    return this.y[i0] + (this.y[i1] - this.y[i0]) * t;
  }

  gradeAt(s: number): number {
    const ss = this.wrap(s) / ROUTE_DS;
    const i0 = Math.floor(ss) % this.count;
    const i1 = (i0 + 1) % this.count;
    const t = ss - Math.floor(ss);
    return this.grade[i0] + (this.grade[i1] - this.grade[i0]) * t;
  }

  get totalAscent(): number {
    let up = 0;
    for (let i = 0; i < this.count; i++) {
      const d = this.y[(i + 1) % this.count] - this.y[i];
      if (d > 0) up += d;
    }
    return up;
  }
}

function movingAverage(a: Float32Array, halfWindow: number): Float32Array {
  const n = a.length;
  const out = new Float32Array(n);
  let sum = 0;
  const w = halfWindow * 2 + 1;
  for (let k = -halfWindow; k <= halfWindow; k++) sum += a[((k % n) + n) % n];
  for (let i = 0; i < n; i++) {
    out[i] = sum / w;
    sum -= a[(((i - halfWindow) % n) + n) % n];
    sum += a[(i + halfWindow + 1) % n];
  }
  return out;
}

export interface RouteStart {
  name: string;
  /** Distance along the loop, metres. */
  s: number;
}

interface StartCandidate {
  s: number;
  kind: 'bottom' | 'top';
  /** Set when this is the foot or summit of a named climb. */
  climb?: string;
}

function loopDist(a: number, b: number, len: number): number {
  const d = Math.abs(a - b) % len;
  return Math.min(d, len - d);
}

function insideNamedClimb(route: Route, s: number): boolean {
  return route.climbs.some((c) => s > c.start + 500 && s < c.end - 500);
}

/** Walk back from a climb foot to the valley it leaves, not a point already on the slope. */
function snapBottom(route: Route, s: number): number {
  let best = s;
  let bestY = route.elevationAt(s);
  for (let d = 40; d <= 3000; d += 40) {
    const p = route.wrap(s - d);
    if (insideNamedClimb(route, p)) break;
    const y = route.elevationAt(p);
    if (y < bestY) {
      bestY = y;
      best = p;
    } else if (bestY < route.elevationAt(s) - 4 && y > bestY + 6) break;
  }
  return best;
}

/** Walk forward from a summit marker to the high point, where the descent actually begins. */
function snapTop(route: Route, s: number): number {
  let best = s;
  let bestY = route.elevationAt(s);
  for (let d = 40; d <= 2500; d += 40) {
    const p = route.wrap(s + d);
    if (insideNamedClimb(route, p)) break;
    const y = route.elevationAt(p);
    if (y > bestY) {
      bestY = y;
      best = p;
    } else if (y < bestY - 6) break;
  }
  return best;
}

/** Valley bottoms and crests. A steady climb or descent has none of these in the middle. */
function extrema(route: Route, prominence: number): StartCandidate[] {
  const n = route.count;
  const y = movingAverage(route.y, 25);
  const half = Math.round(500 / ROUTE_DS);
  const step = Math.round(50 / ROUTE_DS);
  const at = (i: number) => y[(i + n) % n];
  const out: StartCandidate[] = [];
  for (let i = 0; i < n; i += step) {
    const here = at(i);
    const left = at(i - step);
    const right = at(i + step);
    let upL = 0;
    let upR = 0;
    let downL = 0;
    let downR = 0;
    for (let k = step; k <= half; k += step) {
      upL = Math.max(upL, at(i - k) - here);
      upR = Math.max(upR, at(i + k) - here);
      downL = Math.max(downL, here - at(i - k));
      downR = Math.max(downR, here - at(i + k));
    }
    const s = i * ROUTE_DS;
    if (insideNamedClimb(route, s)) continue;
    if (here <= left && here <= right && Math.min(upL, upR) >= prominence) out.push({ s, kind: 'bottom' });
    else if (here >= left && here >= right && Math.min(downL, downR) >= prominence) out.push({ s, kind: 'top' });
  }
  return out;
}

function dedupeStarts(cands: StartCandidate[], len: number, gap: number): StartCandidate[] {
  const sorted = [...cands].sort((a, b) => a.s - b.s || Number(Boolean(b.climb)) - Number(Boolean(a.climb)));
  const out: StartCandidate[] = [];
  for (const c of sorted) {
    const prev = out[out.length - 1];
    if (prev && c.s - prev.s < gap) {
      if (c.climb && !prev.climb) out[out.length - 1] = c;
      continue;
    }
    out.push(c);
  }
  if (out.length > 1 && loopDist(out[0].s, out[out.length - 1].s, len) < gap) {
    if (out[0].climb && !out[out.length - 1].climb) out.pop();
    else out.shift();
  }
  return out;
}

function pickSpread(pool: StartCandidate[], len: number, count: number): StartCandidate[] {
  if (pool.length <= count) return [...pool].sort((a, b) => a.s - b.s);
  const left = [...pool];
  const picked: StartCandidate[] = [];
  let seed = 0;
  for (let i = 1; i < left.length; i++) if (left[i].climb && !left[seed].climb) seed = i;
  picked.push(left.splice(seed, 1)[0]);
  while (picked.length < count && left.length) {
    let best = 0;
    let bestScore = -1;
    for (let i = 0; i < left.length; i++) {
      let d = Infinity;
      for (const p of picked) d = Math.min(d, loopDist(left[i].s, p.s, len));
      const score = d + (left[i].climb ? 2500 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    picked.push(left.splice(best, 1)[0]);
  }
  return picked.sort((a, b) => a.s - b.s);
}

function startName(c: StartCandidate): string {
  if (c.climb) return c.kind === 'bottom' ? `Below ${c.climb}` : `Top of ${c.climb}`;
  const km = Math.round(c.s / 1000);
  return c.kind === 'bottom' ? `Below a climb · km ${km}` : `Top of a climb · km ${km}`;
}

/**
 * Climbs in the order and with the grades a rider meets them.
 * Backwards, each named climb is a descent, listed as the reversed profile reads from left to right.
 */
export function riddenClimbs(route: Route, reverse = false): Climb[] {
  if (!reverse) return route.climbs;
  return route.climbs
    .map((c) => ({
      ...c,
      start: c.end,
      end: c.start,
      gain: -c.gain,
      avgGrade: -c.avgGrade,
      maxGrade: -c.maxGrade,
      startElevation: c.summitElevation,
      summitElevation: c.startElevation,
    }))
    .sort((a, b) => b.start - a.start || a.name.localeCompare(b.name));
}

/** Five free-ride starts: the loop start, plus feet and summits of climbs. */
export function routeStarts(route: Route): RouteStart[] {
  const named: StartCandidate[] = route.climbs.flatMap((c) => [
    { s: snapBottom(route, c.start), kind: 'bottom' as const, climb: c.name },
    { s: snapTop(route, c.end), kind: 'top' as const, climb: c.name },
  ]);
  const awayFromOrigin = (pool: StartCandidate[], gap: number) => pool.filter((c) => loopDist(c.s, 0, route.length) >= gap);
  let pool = dedupeStarts([...named, ...extrema(route, 8)], route.length, 500);
  let choices = awayFromOrigin(pool, 1200);
  if (choices.length < 4) {
    pool = dedupeStarts([...named, ...extrema(route, 5)], route.length, 350);
    choices = awayFromOrigin(pool, 1200);
  }
  if (choices.length < 4) choices = awayFromOrigin(dedupeStarts([...named, ...extrema(route, 3)], route.length, 250), 700);
  const picked = [{ s: 0, kind: 'bottom' as const }, ...pickSpread(choices, route.length, 4)];
  const counts = new Map<string, number>();
  const names = picked.map(startName);
  for (const name of names.slice(1)) counts.set(name, (counts.get(name) ?? 0) + 1);
  const seen = new Map<string, number>();
  return picked.map((c, i) => {
    if (i === 0) return { name: 'Kilometre 0', s: 0 };
    let name = names[i];
    if ((counts.get(name) ?? 0) > 1) {
      const n = (seen.get(name) ?? 0) + 1;
      seen.set(name, n);
      name = `${name} · km ${Math.round(c.s / 1000)}`;
    }
    return { name, s: c.s };
  });
}

const cache = new Map<string, Route>();
export function getRoute(def: RouteDef): Route {
  let r = cache.get(def.id);
  if (!r) {
    const problems = routeDefProblems(def);
    if (problems.length) throw new Error(`Route "${def.id}" is broken: ${problems.join('; ')}`);
    r = new Route(def);
    cache.set(def.id, r);
  }
  return r;
}

/**
 * A short open piece of an existing route, in the same world position.
 * The homepage uses this so the valley in frame does not build the whole loop.
 * `from` is the source distance of sample 0, so callers can rebase metres.
 */
export function excerptRoute(route: Route, fromS: number, toS: number): { route: Route; from: number } {
  const fromIndex = Math.max(0, Math.min(route.count - 2, Math.floor(fromS / ROUTE_DS)));
  const toIndex = Math.max(fromIndex + 1, Math.min(route.count - 1, Math.ceil(toS / ROUTE_DS)));
  const count = toIndex - fromIndex + 1;
  const cut = <T extends Float32Array | Uint8Array>(src: T): T => src.slice(fromIndex, toIndex + 1) as T;
  const out = Object.create(Route.prototype) as Route;
  const data = out as {
    def: Route['def'];
    length: number;
    count: number;
    x: Float32Array;
    z: Float32Array;
    y: Float32Array;
    grade: Float32Array;
    tx: Float32Array;
    tz: Float32Array;
    section: Uint8Array;
    hairpin: Uint8Array;
    climbs: Route['climbs'];
    sectionStart: number[];
    bounds: Route['bounds'];
  };
  data.def = route.def;
  data.count = count;
  data.length = count * ROUTE_DS;
  data.x = cut(route.x);
  data.z = cut(route.z);
  data.y = cut(route.y);
  data.grade = cut(route.grade);
  data.tx = cut(route.tx);
  data.tz = cut(route.tz);
  data.section = cut(route.section);
  data.hairpin = cut(route.hairpin);
  data.climbs = [];
  data.sectionStart = [];
  for (let i = 0; i < count; i++) {
    if (data.sectionStart[data.section[i]] === undefined) data.sectionStart[data.section[i]] = i * ROUTE_DS;
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < count; i++) {
    minX = Math.min(minX, data.x[i]);
    maxX = Math.max(maxX, data.x[i]);
    minZ = Math.min(minZ, data.z[i]);
    maxZ = Math.max(maxZ, data.z[i]);
    minY = Math.min(minY, data.y[i]);
    maxY = Math.max(maxY, data.y[i]);
  }
  data.bounds = { minX, maxX, minZ, maxZ, minY, maxY };
  return { route: out, from: fromIndex * ROUTE_DS };
}
