import { describe, expect, it } from 'vitest';
import type { RealStage } from '../routes/real/types';
import { cutStage, levelWkg } from './quickRace';

const stage: RealStage = {
  id: 'test-mountain',
  name: 'Test mountain stage',
  inspiredBy: 'Made up for the tests',
  description: '',
  totalKm: 80,
  startElevation: 400,
  finish: 'summit',
  terrain: 'mountain',
  points: [
    { km: 25, type: 'sprint', name: 'Valley sprint' },
    { km: 45, type: 'climb', climb: { name: 'First col', lengthKm: 8, avgGrade: 6.5 }, category: '1' },
    { km: 80, type: 'climb', climb: { name: 'Summit', lengthKm: 12, avgGrade: 7.8 }, category: 'HC' },
  ],
};

describe('quick race cut', () => {
  it('keeps the finish and moves the start for shorter races', () => {
    const full = cutStage(stage, 1);
    const half = cutStage(stage, 0.5);
    const quarter = cutStage(stage, 0.25);
    expect(half.finishS).toBe(full.finishS);
    expect(quarter.finishS).toBe(full.finishS);
    expect(full.startS).toBeLessThan(half.startS);
    expect(half.startS).toBeLessThan(quarter.startS);
    expect(full.finishS / 1000).toBeGreaterThan(70);
    expect(full.finishS / 1000).toBeLessThan(90);
  });

  it('never starts a race halfway up a climb', () => {
    for (const len of [1, 0.5, 0.25] as const) {
      const cut = cutStage(stage, len);
      for (const c of cut.route.climbs) expect(cut.startS > c.start && cut.startS < c.end).toBe(false);
    }
  });

  it('a quarter race keeps the summit climb and drops the early sprint', () => {
    const cut = cutStage(stage, 0.25);
    expect(cut.climbs.map((c) => c.name)).toContain('Summit');
    expect(cut.sprints).toHaveLength(0);
    expect(cutStage(stage, 1).sprints.map((s) => s.name)).toContain('Valley sprint');
  });
});

describe('difficulty', () => {
  it('scales with the rider and caps pro at real numbers', () => {
    const easy = levelWkg('easy', 3.5);
    const hard = levelWkg('hard', 3.5);
    expect(easy.mountain).toBeLessThan(hard.mountain);
    expect(hard.mountain).toBeGreaterThan(3.5);
    expect(levelWkg('pro', 2.5).mountain).toBe(levelWkg('pro', 5).mountain);
  });
});
