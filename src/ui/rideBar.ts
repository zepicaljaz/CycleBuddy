/** A named climb, only the fields the lap bar needs. */
export interface BarClimb {
  name: string;
  start: number;
  end: number;
  length: number;
  startElevation: number;
  summitElevation: number;
}

export interface RideBar {
  title: string;
  /** 0–1. Grows as the rider travels, in whichever direction they face. */
  frac: number;
  detail: string;
}

export function wrapMetres(s: number, length: number): number {
  return ((s % length) + length) % length;
}

/** Metres to ride in `direction` before `target` is reached. */
export function distanceAhead(s: number, target: number, length: number, direction: 1 | -1): number {
  const from = wrapMetres(s, length);
  const to = wrapMetres(target, length);
  const raw = direction < 0 ? from - to : to - from;
  return ((raw % length) + length) % length;
}

/**
 * The top-of-screen bar. Forward, it is the lap from kilometre 0 and the next
 * climb start. Turned around, the marker still moves to the right, and the
 * next climb is the one now ahead.
 */
export function rideBar(args: {
  s: number;
  length: number;
  direction: 1 | -1;
  name: string;
  lap: number;
  climbs: BarClimb[];
  elevationAt: (s: number) => number;
}): RideBar {
  const s = wrapMetres(args.s, args.length);
  return args.direction < 0 ? reverseBar(args, s) : forwardBar(args, s);
}

function forwardBar(args: {
  length: number;
  name: string;
  lap: number;
  climbs: BarClimb[];
  elevationAt: (s: number) => number;
}, s: number): RideBar {
  const climb = args.climbs.find((c) => s >= c.start - 500 && s <= c.end);
  if (climb) {
    const frac = Math.max(0, Math.min(1, (s - climb.start) / climb.length));
    const left = Math.max(0, climb.end - s);
    return {
      title: s < climb.start ? `${climb.name} starts in ${Math.round(climb.start - s)} m` : climb.name,
      frac,
      detail: `${(left / 1000).toFixed(1)} km to summit · ${Math.round(climb.summitElevation - args.elevationAt(s))} m to climb`,
    };
  }
  const next = nearest(args.climbs, (c) => distanceAhead(s, c.start, args.length, 1));
  return {
    title: `${args.name} · Lap ${args.lap}`,
    frac: s / args.length,
    detail: next
      ? `Next climb: ${next.climb.name} in ${(next.distance / 1000).toFixed(1)} km`
      : `${((args.length - s) / 1000).toFixed(1)} km to lap finish`,
  };
}

function reverseBar(args: {
  length: number;
  name: string;
  lap: number;
  climbs: BarClimb[];
  elevationAt: (s: number) => number;
}, s: number): RideBar {
  // A named climb is a descent this way: you meet the summit, then ride down to the foot.
  let on: BarClimb | null = null;
  let approach: BarClimb | null = null;
  let approachM = Infinity;
  for (const c of args.climbs) {
    if (s >= c.start && s <= c.end) {
      on = c;
      break;
    }
    const toSummit = distanceAhead(s, c.end, args.length, -1);
    if (toSummit > 0 && toSummit <= 500 && toSummit < approachM) {
      approach = c;
      approachM = toSummit;
    }
  }
  const climb = on ?? approach;
  if (climb) {
    const toFoot = distanceAhead(s, climb.start, args.length, -1);
    const frac = Math.max(0, Math.min(1, (climb.length - toFoot) / Math.max(climb.length, 1)));
    const drop = Math.max(0, Math.round(args.elevationAt(s) - climb.startElevation));
    return {
      title: on ? climb.name : `${climb.name} in ${Math.round(approachM)} m`,
      frac,
      detail: `${(toFoot / 1000).toFixed(1)} km to the bottom · ${drop} m to descend`,
    };
  }
  const next = nearest(args.climbs, (c) => distanceAhead(s, c.start, args.length, -1));
  let toFinish = distanceAhead(s, 0, args.length, -1);
  if (toFinish < 1) toFinish = args.length;
  return {
    title: `${args.name} · Lap ${args.lap}`,
    frac: (args.length - s) / args.length,
    detail: next
      ? `Next climb: ${next.climb.name} in ${(next.distance / 1000).toFixed(1)} km`
      : `${(toFinish / 1000).toFixed(1)} km to lap finish`,
  };
}

function nearest(climbs: BarClimb[], distanceOf: (c: BarClimb) => number): { climb: BarClimb; distance: number } | null {
  let best: { climb: BarClimb; distance: number } | null = null;
  for (const climb of climbs) {
    const distance = distanceOf(climb);
    if (!best || distance < best.distance) best = { climb, distance };
  }
  return best;
}
