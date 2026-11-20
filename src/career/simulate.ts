import { punchScore, shareFinishTimes } from '../ai/road';
import { finishJerseyPoints } from './classify';
import { hashString, mulberry32 } from '../util/math';
import { punchyStage, stageKm, stageSegment, type RaceDef } from './calendar';
import { riderName, type Rider } from './roster';
import { aiField, champField } from './squad';

export interface SimRow {
  riderId: string;
  name: string;
  teamId: string;
  country: string;
  age: number;
  time: number;
  sprint: number;
  kom: number;
}

export interface SimRace {
  raceId: string;
  name: string;
  overall: SimRow[];
  stages: { label: string; rows: SimRow[] }[];
}

function quality(rider: Rider, finish: string, kind: string, punchy = false): number {
  const a = rider.attrs;
  if (kind === 'tt' && finish === 'mountain') return a.tt * 0.46 + a.mountain * 0.42 + a.endurance * 0.12;
  if (kind === 'tt') return a.tt * 0.72 + a.flat * 0.16 + a.endurance * 0.12;
  if (finish === 'sprint') return a.sprint * 0.4 + a.flat * 0.28 + a.hills * 0.16 + a.endurance * 0.16;
  if (finish === 'hill' && punchy) return punchScore(a) * 0.62 + a.flat * 0.16 + a.endurance * 0.14 + a.medium * 0.08;
  if (finish === 'hill') return a.hills * 0.38 + a.medium * 0.22 + a.sprint * 0.14 + a.endurance * 0.14 + a.flat * 0.12;
  return a.mountain * 0.46 + a.medium * 0.2 + a.endurance * 0.16 + a.stamina * 0.1 + a.tt * 0.08;
}

/** Result of a race the human did not ride. The player's team may still start. */
export function simulateRace(race: RaceDef, year: number, nation: string): SimRace {
  const rng = mulberry32(hashString(`${year}:${race.id}`));
  const slots = race.level === 'champ' ? champField(race, nation) : aiField(race, null, false);
  const byId = new Map(slots.map((slot) => [slot.rider.id, slot.rider]));
  const fatigue = new Map<string, number>();
  const gc = new Map<string, SimRow>();
  /** Sum of stage places. Splits equal overall times. */
  const places = new Map<string, number>();
  const stages: SimRace['stages'] = [];

  for (const stage of race.stages) {
    const seg = stageSegment(stage);
    const km = Math.max(3, stageKm(stage));
    const punchy = seg.kind === 'road' && punchyStage(stage);
    const speed = seg.kind === 'tt' ? (seg.finish === 'mountain' ? 22 : 48) : seg.finish === 'mountain' ? 30 : seg.finish === 'hill' ? 36 : 44;
    const base = (km / speed) * 3600;
    const gapScale = seg.kind === 'tt' ? 2.2 : seg.finish === 'sprint' ? 0.14 : seg.finish === 'hill' ? 1.15 : 3.1;
    const scored = slots.map((slot) => {
      const tired = fatigue.get(slot.rider.id) ?? 0;
      const raw = quality(slot.rider, seg.finish, seg.kind, punchy) * (1 - tired) + (rng() - 0.5) * 3.2;
      return { rider: slot.rider, raw };
    }).sort((a, b) => b.raw - a.raw);
    const best = scored[0]?.raw ?? 1;
    const gaps = shareFinishTimes(scored.map((row) => (best - row.raw) * gapScale));
    const rows: SimRow[] = scored.map((row, i) => ({
      riderId: row.rider.id,
      name: riderName(row.rider),
      teamId: row.rider.teamId,
      country: row.rider.country,
      age: row.rider.age,
      time: base + gaps[i],
      sprint: 0,
      kom: 0,
    }));
    // `scored` is already the crossing order. A stable sort on time keeps it inside a bunch.
    rows.sort((a, b) => a.time - b.time);
    const trial = seg.kind === 'tt';
    const oneDay = race.stages.length === 1;
    const climbFinish = oneDay && seg.kind === 'road' && seg.finish !== 'sprint';
    rows.forEach((row, index) => {
      row.sprint = finishJerseyPoints(index + 1, trial);
      row.kom = climbFinish ? finishJerseyPoints(index + 1, false) : 0;
    });
    if (!oneDay && (seg.finish === 'hill' || seg.finish === 'mountain')) {
      const punchyHill = seg.finish === 'hill' && punchy;
      const rank = (rider: Rider) => punchyHill ? punchScore(rider.attrs) : rider.attrs[seg.finish === 'hill' ? 'hills' : 'mountain'];
      [...scored].sort((a, b) => rank(b.rider) - rank(a.rider)).slice(0, 6).forEach((row, i) => {
        const found = rows.find((r) => r.riderId === row.rider.id);
        if (found) found.kom += [10, 8, 6, 4, 2, 1][i] ?? 0;
      });
    }
    stages.push({ label: stage.name, rows });
    rows.forEach((row, index) => places.set(row.riderId, (places.get(row.riderId) ?? 0) + index + 1));
    for (const row of rows) {
      const prev = gc.get(row.riderId);
      if (prev) {
        prev.time += row.time;
        prev.sprint += row.sprint;
        prev.kom += row.kom;
      } else gc.set(row.riderId, { ...row });
      const rider = byId.get(row.riderId);
      if (!rider) continue;
      const load = seg.finish === 'mountain' ? 0.075 : 0.032;
      const keep = 0.32 + (100 - rider.attrs.recovery) / 150;
      fatigue.set(rider.id, Math.min(0.32, (fatigue.get(rider.id) ?? 0) * keep + load));
    }
  }

  const overall = [...gc.values()].sort((a, b) => a.time - b.time || (places.get(a.riderId) ?? 0) - (places.get(b.riderId) ?? 0));
  return { raceId: race.id, name: race.name, overall, stages };
}
