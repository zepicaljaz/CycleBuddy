import { describe, expect, it } from 'vitest';
import { canEnter, RACES } from './calendar';
import { CONT_OFFER_WEIGHT, cybPoints, PRO_OFFER, WORLD_OFFER } from './classify';
import { contractProgress, racePayout, seasonProgress } from './progress';
import { Career } from './season';
import { teamsIn } from './teams';

function fresh(teamId = 'slorising'): Career {
  const career = new Career();
  career.create(teamId, 'SLO', 3.4, 3.8, 4.3);
  return career;
}

function rideOpeningClassic(career: Career, playerTime: number): void {
  career.state!.active = { raceId: 'opening-classic', stageIndex: 0, gc: [], sprint: [], kom: [], stageWinners: [] };
  const row = (riderId: string, name: string, time: number, isPlayer = false) => ({
    riderId, name, teamId: 'slorising', country: 'SLO', age: 24, time, sprint: 0, kom: 0, isPlayer,
  });
  career.commit([row('other', 'A. Rider', 90), row('player', 'You', playerTime, true)]);
}

describe('contract progress', () => {
  it('starts a Continental rider at zero, with the Pro offer next', () => {
    const progress = contractProgress(fresh().state!);
    expect(progress.points).toBe(0);
    expect(progress.steps.map((step) => step.at)).toEqual([PRO_OFFER, WORLD_OFFER]);
    expect(progress.next).toMatchObject({ at: PRO_OFFER, left: PRO_OFFER, label: 'Pro offer' });
    expect(progress.scale).toBeGreaterThan(WORLD_OFFER);
  });

  it('counts Continental points at the offer weight, the way offers do', () => {
    const state = fresh().state!;
    state.cyb.player = 50;
    state.cont = { player: 120 };
    const progress = contractProgress(state);
    expect(progress.points).toBe(Math.round(50 + 120 * CONT_OFFER_WEIGHT));
    expect(progress.next?.left).toBe(PRO_OFFER - progress.points);
  });

  it('has nothing left once every mark is passed, and the meter still fits the total', () => {
    const state = fresh().state!;
    state.cyb.player = WORLD_OFFER + 300;
    const progress = contractProgress(state);
    expect(progress.next).toBeNull();
    expect(progress.scale).toBeGreaterThanOrEqual(progress.points);
  });

  it('gives a World Tour rider one mark: extra offers', () => {
    const progress = contractProgress(fresh(teamsIn('world')[0].id).state!);
    expect(progress.division).toBe('world');
    expect(progress.steps).toHaveLength(1);
  });
});

describe('race payout', () => {
  it('weighs a Continental win like a contract offer does', () => {
    const race = RACES.find((item) => item.id === 'opening-classic')!;
    expect(racePayout(race).win).toBe(Math.round(cybPoints(race, 'overall', 1) * CONT_OFFER_WEIGHT));
    expect(racePayout(race).stageWin).toBe(0);
  });

  it('pays a stage win in a stage race', () => {
    const race = RACES.find((item) => item.stages.length > 1 && item.level === 'world')!;
    expect(racePayout(race).stageWin).toBe(cybPoints(race, 'stage', 1));
  });
});

describe('season progress', () => {
  it('lists the ticked races of a new season, the first one next', () => {
    const career = fresh();
    const season = seasonProgress(career.state!);
    const all = season.months.flatMap((month) => month.races);
    expect(season.ridden).toBe(0);
    expect(season.total).toBe(career.state!.entered.length);
    expect(all.filter((race) => race.status === 'next')).toHaveLength(1);
    expect(all.find((race) => race.status === 'next')?.id).toBe(career.nextEntered()?.id);
    expect(season.current).toBe(all.find((race) => race.status === 'next')?.month);
    expect(season.best).toBeNull();
  });

  it('marks a ridden race with the place, and moves next on', () => {
    const career = fresh();
    rideOpeningClassic(career, 100);
    const season = seasonProgress(career.state!);
    const all = season.months.flatMap((month) => month.races);
    expect(all.find((race) => race.id === 'opening-classic')).toMatchObject({ status: 'ridden', place: 2 });
    expect(season).toMatchObject({ ridden: 1, podiums: 1, topTen: 1, wins: 0, best: { place: 2, race: 'Opening Classic' } });
    expect(all.find((race) => race.status === 'next')?.id).toBe(career.nextEntered()?.id);
  });

  it('shows a skipped race, and leaves it out of the count', () => {
    const career = fresh();
    const before = seasonProgress(career.state!).total;
    const id = career.nextEntered()!.id;
    career.skipNext();
    const season = seasonProgress(career.state!);
    expect(season.months.flatMap((month) => month.races).find((race) => race.id === id)?.status).toBe('skipped');
    expect(season.total).toBe(before - 1);
  });

  it('keeps races outside your division off the strip', () => {
    const career = fresh();
    const ids = new Set(seasonProgress(career.state!).months.flatMap((month) => month.races.map((race) => race.id)));
    for (const race of RACES) if (!canEnter(race.level, 'continental')) expect(ids.has(race.id)).toBe(false);
  });
});
