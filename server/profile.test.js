import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_COLORS } from '../src/world/riders';
import { cleanProfile, mergeProfiles } from './profile.js';

function body(over = {}) {
  return {
    name: 'Aljaz',
    weightKg: 72,
    ftp: 230,
    difficulty: 50,
    colors: { ...DEFAULT_COLORS, bike: 'corsano', wheelBrand: 'nordvik' },
    coins: 12,
    ownedFrames: ['montvar', 'corsano'],
    ownedWheels: ['montvar', 'nordvik'],
    graphics: 'high',
    timeOfDay: 'golden',
    camera: 'chase',
    map: 'ahead',
    updatedAt: '2026-04-01T00:00:00.000Z',
    ...over,
  };
}

describe('account profile record', () => {
  it('keeps coins and the equipped kit', () => {
    const saved = cleanProfile(body());
    expect(saved.coins).toBe(12);
    expect(saved.colors.bike).toBe('corsano');
    expect(saved.colors.wheelBrand).toBe('nordvik');
    expect(saved.ownedFrames).toEqual(['montvar', 'corsano']);
    expect(saved.name).toBe('Aljaz');
  });

  it('rejects a profile that is not a rider record', () => {
    expect(cleanProfile(null)).toBeNull();
    expect(cleanProfile(body({ coins: -1 }))).toBeNull();
    expect(cleanProfile(body({ coins: 1.5 }))).toBeNull();
    expect(cleanProfile(body({ weightKg: 10 }))).toBeNull();
    expect(cleanProfile(body({ graphics: 'cinematic' }))).toBeNull();
    expect(cleanProfile(body({ colors: { ...DEFAULT_COLORS, bike: 'made-up' } }))).toBeNull();
    expect(cleanProfile(body({ ownedFrames: 'montvar' }))).toBeNull();
    expect(cleanProfile(body({ map: 'satellite' }))).toBeNull();
  });

  it('keeps the wider road as a saved map', () => {
    expect(cleanProfile(body({ map: 'wide' })).map).toBe('wide');
  });

  it('keeps saved Coins when a new computer sends the starter kit', () => {
    const saved = mergeProfiles(
      body({ coins: 25, ownedFrames: ['montvar', 'zentra'], ownedWheels: ['montvar'], colors: { ...DEFAULT_COLORS, bike: 'zentra', wheelBrand: 'montvar' } }),
      body({ coins: 0, ownedFrames: ['montvar'], ownedWheels: ['montvar'], colors: { ...DEFAULT_COLORS }, updatedAt: '2026-08-01T00:00:00.000Z' }),
    );
    expect(saved.coins).toBe(25);
    expect(saved.colors.bike).toBe('zentra');
    expect(saved.ownedFrames).toContain('zentra');
  });

  it('keeps the saved weight and FTP when a new computer sends the starter rider', () => {
    const saved = mergeProfiles(
      body({ weightKg: 56, ftp: 200, coins: 35, ownedWheels: ['montvar', 'nordvik'] }),
      body({
        weightKg: 72,
        ftp: 230,
        coins: 0,
        ownedFrames: ['montvar'],
        ownedWheels: ['montvar'],
        colors: { ...DEFAULT_COLORS },
        updatedAt: '2026-08-01T00:00:00.000Z',
      }),
    );
    expect(saved.weightKg).toBe(56);
    expect(saved.ftp).toBe(200);
    expect(saved.coins).toBe(35);
  });

  it('stores a newer weight and FTP from Settings', () => {
    const saved = mergeProfiles(
      body({ weightKg: 56, ftp: 200, coins: 35 }),
      body({ weightKg: 58, ftp: 210, coins: 35, updatedAt: '2026-08-01T00:00:00.000Z' }),
    );
    expect(saved.weightKg).toBe(58);
    expect(saved.ftp).toBe(210);
  });

  it('keeps bikes bought on either computer', () => {
    const saved = mergeProfiles(
      body({ ownedFrames: ['montvar', 'corsano'], ownedWheels: ['montvar'], coins: 10 }),
      body({ ownedFrames: ['montvar'], ownedWheels: ['montvar', 'nordvik'], colors: { ...DEFAULT_COLORS }, coins: 10, updatedAt: '2026-05-01T00:00:00.000Z' }),
    );
    expect(saved.ownedFrames).toContain('corsano');
    expect(saved.ownedWheels).toContain('nordvik');
  });

  it('does not equip a brand the rider does not own', () => {
    const saved = cleanProfile(body({ colors: { ...DEFAULT_COLORS, bike: 'zentra', wheelBrand: 'zentra' } }));
    expect(saved.colors.bike).toBe('montvar');
    expect(saved.colors.wheelBrand).toBe('montvar');
    expect(saved.ownedFrames).toContain('montvar');
  });
});

describe('profile timestamps', () => {
  it('stores updatedAt as ISO and never in the future', () => {
    expect(cleanProfile(body({ updatedAt: 'Wed, 01 Apr 2026 10:00:00 GMT' })).updatedAt).toBe('2026-04-01T10:00:00.000Z');
    const future = cleanProfile(body({ updatedAt: '9999-01-01T00:00:00.000Z' }));
    expect(Date.parse(future.updatedAt)).toBeLessThanOrEqual(Date.now());
    expect(Date.parse(cleanProfile(body({ updatedAt: 12 })).updatedAt)).toBeLessThanOrEqual(Date.now());
  });

  it('compares times as dates, not strings', () => {
    // As strings '2026-05-01T00:00:00+02:00' sorts after '2026-04-30T23:30:00.000Z', but it is earlier.
    const saved = mergeProfiles(
      body({ weightKg: 60, ftp: 220, updatedAt: '2026-04-30T23:30:00.000Z' }),
      body({ weightKg: 61, ftp: 221, updatedAt: '2026-05-01T00:00:00+02:00' }),
    );
    expect(saved.weightKg).toBe(60);
  });

  it('a far-future timestamp from a client cannot pin its settings forever', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-06-01T00:00:00.000Z'));
      const poisoned = mergeProfiles(null, body({ weightKg: 60, updatedAt: '9999-01-01T00:00:00.000Z' }));
      vi.setSystemTime(new Date('2026-06-02T00:00:00.000Z'));
      const saved = mergeProfiles(poisoned, body({ weightKg: 64, updatedAt: '2026-06-02T00:00:00.000Z' }));
      expect(saved.weightKg).toBe(64);
    } finally {
      vi.useRealTimers();
    }
  });
});