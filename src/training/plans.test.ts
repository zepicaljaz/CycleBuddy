import { describe, expect, it } from 'vitest';
import { progressFromRides } from './progress';
import { GROUPS, PLANS, planById, planStats, weekSeconds } from './plans';
import { cueAt, durationSec, expandBlocks, prescribedLoad, targetPct, zoneName, type Block } from './workout';

describe('workout timeline', () => {
  const blocks: Block[] = [
    { kind: 'ramp', sec: 60, from: 0.4, to: 0.6, text: 'Warm' },
    { kind: 'reps', times: 2, on: 30, onPct: 1.2, off: 15, offPct: 0.5, text: 'Hard' },
    { kind: 'steady', sec: 40, pct: 0.45, text: 'Down' },
  ];
  const steps = expandBlocks(blocks);

  it('lays steps end to end', () => {
    expect(steps[0].start).toBe(0);
    for (let i = 1; i < steps.length; i++) expect(steps[i].start).toBeCloseTo(steps[i - 1].end);
    expect(durationSec(steps)).toBe(60 + 2 * (30 + 15) + 40);
  });

  it('ramps halfway and holds a steady target', () => {
    expect(targetPct(steps, 30)).toBeCloseTo(0.5);
    expect(targetPct(steps, 60)).toBeCloseTo(1.2);
    expect(zoneName(0.5)).toBe('Recovery');
    expect(zoneName(0.91)).toBe('Sweet spot');
    expect(zoneName(1.15)).toBe('VO2max');
    expect(zoneName(1.8)).toBe('Sprint');
  });

  it('scores a positive training load and a cue inside the workout', () => {
    const load = prescribedLoad(steps);
    expect(load.tss).toBeGreaterThan(0);
    expect(load.intensity).toBeGreaterThan(0.4);
    const cue = cueAt(steps, 70, 200, 1);
    expect(cue.watts).toBeGreaterThan(150);
    expect(cue.count).toBe(steps.length);
    expect(cue.leftSec).toBeGreaterThan(0);
  });
});

describe('training plans', () => {
  it('covers every group with a full plan', () => {
    expect(PLANS.length).toBeGreaterThanOrEqual(16);
    for (const group of GROUPS) expect(PLANS.some((plan) => plan.group === group.id)).toBe(true);
    expect(new Set(PLANS.map((plan) => plan.id)).size).toBe(PLANS.length);
  });

  it('gives every plan real weeks, unique workouts, and sane targets', () => {
    for (const plan of PLANS) {
      expect(plan.weeks.length, plan.id).toBeGreaterThanOrEqual(4);
      expect(plan.who.length).toBeGreaterThan(20);
      expect(plan.goal.length).toBeGreaterThan(40);
      const ids = plan.weeks.flatMap((week) => week.workouts.map((workout) => workout.id));
      expect(new Set(ids).size, plan.id).toBe(ids.length);
      for (const week of plan.weeks) {
        expect(week.workouts.length).toBeGreaterThanOrEqual(2);
        expect(week.workouts.length).toBeLessThanOrEqual(4);
        for (const workout of week.workouts) {
          const steps = expandBlocks(workout.blocks);
          const sec = durationSec(steps);
          expect(sec, `${plan.id}/${workout.id}`).toBeGreaterThanOrEqual(15 * 60);
          expect(sec, `${plan.id}/${workout.id}`).toBeLessThanOrEqual(160 * 60);
          expect(prescribedLoad(steps).tss).toBeGreaterThan(5);
          for (const step of steps) {
            expect(step.fromPct).toBeGreaterThanOrEqual(0.35);
            expect(step.toPct).toBeLessThanOrEqual(2.2);
            expect(step.text.length).toBeGreaterThan(3);
          }
        }
      }
      const stats = planStats(plan);
      expect(stats.workouts).toBe(ids.length);
      expect(stats.hoursLabel.length).toBeGreaterThan(4);
    }
  });

  it('makes each easier week shorter than the week before it', () => {
    for (const plan of PLANS) {
      plan.weeks.forEach((week, index) => {
        if (!week.recovery) return;
        expect(index, plan.id).toBeGreaterThan(0);
        const easier = weekSeconds(week);
        const before = weekSeconds(plan.weeks[index - 1]);
        expect(easier, `${plan.id} week ${index + 1}: ${easier}s vs ${before}s`).toBeLessThan(before);
      });
    }
  });

  it('includes a ramp test that climbs past threshold', () => {
    const tests = PLANS.flatMap((plan) => plan.weeks.flatMap((week) => week.workouts)).filter((workout) => workout.ftpTest);
    expect(tests.length).toBeGreaterThanOrEqual(3);
    for (const workout of tests) {
      expect(workout.ftpTest).toBe('ramp');
      const steps = expandBlocks(workout.blocks);
      const top = Math.max(...steps.map((step) => step.toPct));
      expect(top).toBeGreaterThanOrEqual(1.4);
    }
  });

  it('offers a 20-minute FTP test beside the week plans', () => {
    expect(PLANS.some((plan) => plan.id === 'ftp-test')).toBe(false);
    const plan = planById('ftp-test');
    expect(plan?.name).toBe('FTP Test');
    const workout = plan!.weeks[0].workouts[0];
    expect(workout.ftpTest).toBe('twenty');
    const open = expandBlocks(workout.blocks).filter((step) => step.open);
    expect(open).toHaveLength(1);
    expect(open[0].end - open[0].start).toBe(20 * 60);
  });
});

describe('progressFromRides', () => {
  it('ticks a training workout only when the ride was completed', () => {
    const done = progressFromRides([
      { mode: 'train', workout: { planId: 'climber', workoutId: 'cl-1a', completed: true } },
      { mode: 'train', workout: { planId: 'climber', workoutId: 'cl-1b', completed: false } },
      { mode: 'free', workout: { planId: 'climber', workoutId: 'cl-1c', completed: true } },
    ]);
    expect([...done]).toEqual(['climber/cl-1a']);
  });
});
