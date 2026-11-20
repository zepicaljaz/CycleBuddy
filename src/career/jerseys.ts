import type { RoadBody } from '../ai/road';
import type { RiderColors } from '../world/riders';
import type { Champions, JerseyColor } from './types';

export interface Paintable {
  colors: RiderColors;
  sprintPts: number;
  komPts: number;
  road: RoadBody | null;
}

export interface PaintContext {
  /** Overnight race leader. Null on stage 1 and in one-day races. */
  gcId: string | null;
  /** General classification, best first. The jersey moves to the next starter if the leader is not racing. */
  gcOrder?: string[];
  /** Best young riders, best first. The jersey passes the rider who already wears a higher one. */
  youthIds: string[];
  sprintBase: Record<string, number>;
  komBase: Record<string, number>;
  jersey: JerseyColor;
  champions: Champions;
  /** Leaders of finished grand tours. They wear that colour in later races. */
  tour?: Partial<Record<'yellow' | 'pink' | 'red', string>>;
}

function coat(base: RiderColors, jersey: string, accent: string, shorts: string, helmet: string, frame: string): RiderColors {
  const next = { ...base, jersey, jerseyAccent: accent, shorts, helmet, frame, wheels: frame };
  delete next.polka;
  return next;
}

function leaderKit(base: RiderColors, kind: 'gc' | 'sprint' | 'kom' | 'youth' | 'world' | 'euro', jersey: JerseyColor): RiderColors {
  if (kind === 'gc') {
    const color = jersey === 'pink' ? '#f4a3c7' : jersey === 'red' ? '#e10600' : '#ffe100';
    if (jersey !== 'pink' && jersey !== 'red') return coat(base, color, color, color, color, color);
    const accent = jersey === 'red' ? '#f2c14e' : '#111111';
    return coat(base, color, accent, color, color, color);
  }
  if (kind === 'sprint') return coat(base, '#128a3e', '#f4f4f4', '#128a3e', '#128a3e', '#128a3e');
  if (kind === 'kom') return { ...coat(base, '#f7f7f7', '#d0121a', '#f7f7f7', '#f7f7f7', '#f7f7f7'), polka: '#d0121a' };
  if (kind === 'youth') return coat(base, '#f4f4f4', '#c8c8c8', '#f4f4f4', '#f4f4f4', '#f4f4f4');
  if (kind === 'world') return coat(base, '#f7f7f7', '#6f2dbd', '#111111', '#e31c3d', '#111111');
  return coat(base, '#003399', '#ffcc00', '#003399', '#ffcc00', '#003399');
}

function same(a: RiderColors, b: RiderColors): boolean {
  return a.jersey === b.jersey && a.jerseyAccent === b.jerseyAccent && a.shorts === b.shorts && a.frame === b.frame && a.helmet === b.helmet && a.polka === b.polka;
}

function bestId(rows: { id: string; pts: number }[], taken: Set<string>): string | null {
  let id: string | null = null;
  let pts = 0;
  for (const row of rows) {
    if (row.pts > pts && !taken.has(row.id)) {
      pts = row.pts;
      id = row.id;
    }
  }
  return id;
}

/** Dress classification leaders. Returns true when any kit changed. */
export function paintKits(riders: Paintable[], ctx: PaintContext): boolean {
  const sprintRows: { id: string; pts: number }[] = [];
  const komRows: { id: string; pts: number }[] = [];
  for (const rider of riders) {
    const id = rider.road?.riderId;
    if (!id) continue;
    sprintRows.push({ id, pts: (ctx.sprintBase[id] ?? 0) + rider.sprintPts });
    komRows.push({ id, pts: (ctx.komBase[id] ?? 0) + rider.komPts });
  }
  const taken = new Set<string>();
  for (const id of [ctx.tour?.yellow, ctx.tour?.pink, ctx.tour?.red]) if (id) taken.add(id);
  const present = new Set(riders.map((rider) => rider.road?.riderId).filter((id): id is string => !!id));
  const gcWear = ctx.jersey === 'none' ? null : [ctx.gcId, ...(ctx.gcOrder ?? [])].find((id) => !!id && present.has(id)) ?? null;
  if (gcWear) taken.add(gcWear);
  const sprintId = bestId(sprintRows, taken);
  if (sprintId) taken.add(sprintId);
  const komId = bestId(komRows, taken);
  if (komId) taken.add(komId);
  const youthId = ctx.youthIds.find((id) => !taken.has(id)) ?? null;

  let dirty = false;
  for (const rider of riders) {
    const body = rider.road;
    if (!body) continue;
    const id = body.riderId;
    const tour = ctx.tour?.yellow === id ? 'yellow' : ctx.tour?.pink === id ? 'pink' : ctx.tour?.red === id ? 'red' : null;
    let next = body.kit;
    let badge = '';
    if (tour) {
      next = leaderKit(body.kit, 'gc', tour);
      badge = tour === 'pink' ? 'P' : tour === 'red' ? 'R' : 'Y';
    } else if (id === gcWear) {
      next = leaderKit(body.kit, 'gc', ctx.jersey);
      badge = ctx.jersey === 'pink' ? 'P' : ctx.jersey === 'red' ? 'R' : 'Y';
    } else if (id === sprintId) {
      next = leaderKit(body.kit, 'sprint', ctx.jersey);
      badge = 'S';
    } else if (id === komId) {
      next = leaderKit(body.kit, 'kom', ctx.jersey);
      badge = 'M';
    } else if (id === youthId) {
      next = leaderKit(body.kit, 'youth', ctx.jersey);
      badge = 'W';
    } else if (id === ctx.champions.worldRoad || id === ctx.champions.worldTt) {
      next = leaderKit(body.kit, 'world', ctx.jersey);
      badge = 'C';
    } else if (id === ctx.champions.euroRoad || id === ctx.champions.euroTt) {
      next = leaderKit(body.kit, 'euro', ctx.jersey);
      badge = 'E';
    }
    body.badge = badge;
    if (!same(rider.colors, next)) {
      rider.colors = next;
      dirty = true;
    }
  }
  return dirty;
}

export const NATION_KIT: Record<string, { jersey: string; accent: string; shorts: string }> = {
  SLO: { jersey: '#ffffff', accent: '#005da4', shorts: '#ed1c24' },
  DEN: { jersey: '#c60c30', accent: '#ffffff', shorts: '#c60c30' },
  BEL: { jersey: '#000000', accent: '#fdda24', shorts: '#ef3340' },
  FRA: { jersey: '#002395', accent: '#ffffff', shorts: '#ed2939' },
  ESP: { jersey: '#c60b1e', accent: '#ffc400', shorts: '#c60b1e' },
  ITA: { jersey: '#009246', accent: '#ffffff', shorts: '#ce2b37' },
  GBR: { jersey: '#012169', accent: '#ffffff', shorts: '#cf142b' },
  NED: { jersey: '#ff7f00', accent: '#ffffff', shorts: '#21468b' },
  NOR: { jersey: '#ba0c2f', accent: '#ffffff', shorts: '#00205b' },
  AUS: { jersey: '#00843d', accent: '#ffcd00', shorts: '#012169' },
  COL: { jersey: '#fcd116', accent: '#003893', shorts: '#ce1126' },
  USA: { jersey: '#3c3b6e', accent: '#ffffff', shorts: '#b22234' },
  GER: { jersey: '#000000', accent: '#dd0000', shorts: '#ffce00' },
  SUI: { jersey: '#d52b1e', accent: '#ffffff', shorts: '#d52b1e' },
  POR: { jersey: '#006600', accent: '#ffcc00', shorts: '#ff0000' },
  MEX: { jersey: '#006847', accent: '#ffffff', shorts: '#ce1126' },
};

export function nationColors(base: RiderColors, nation: string): RiderColors {
  const kit = NATION_KIT[nation] ?? { jersey: '#1f4e9c', accent: '#ffffff', shorts: '#1f4e9c' };
  return coat(base, kit.jersey, kit.accent, kit.shorts, kit.jersey, kit.accent);
}
