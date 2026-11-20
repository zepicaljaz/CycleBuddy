import { describe, expect, it } from 'vitest';
import { DEFAULT_COLORS } from '../world/riders';
import type { Profile } from '../storage/types';
import { coinsForDistance, settleEquipment, takeFromShop } from './coins';

function profile(over: Partial<Profile> = {}): Profile {
  const now = '2026-01-01T00:00:00.000Z';
  return {
    id: 'me',
    name: 'Me',
    weightKg: 72,
    ftp: 230,
    difficulty: 50,
    colors: { ...DEFAULT_COLORS },
    graphics: 'high',
    timeOfDay: 'golden',
    camera: 'chase',
    map: 'ahead',
    coins: 0,
    ownedFrames: ['montvar'],
    ownedWheels: ['montvar'],
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

describe('coins', () => {
  it('pays one Coin for each full kilometre', () => {
    expect(coinsForDistance(0)).toBe(0);
    expect(coinsForDistance(999)).toBe(0);
    expect(coinsForDistance(1000)).toBe(1);
    expect(coinsForDistance(2599)).toBe(2);
    expect(coinsForDistance(Number.NaN)).toBe(0);
  });

  it('keeps a bike the rider already had when Coins arrive', () => {
    const colors = { ...DEFAULT_COLORS, bike: 'zentra' as const };
    delete colors.wheelBrand;
    const saved = profile({
      colors,
      coins: undefined as unknown as number,
      ownedFrames: undefined as unknown as Profile['ownedFrames'],
      ownedWheels: undefined as unknown as Profile['ownedWheels'],
    });
    const settled = settleEquipment(saved);
    expect(settled.coins).toBe(0);
    expect(settled.ownedFrames).toContain('montvar');
    expect(settled.ownedFrames).toContain('zentra');
    expect(settled.ownedWheels).toEqual(['montvar', 'zentra']);
    expect(settled.colors.bike).toBe('zentra');
    expect(settled.colors.wheelBrand).toBe('zentra');
  });

  it('does not hand back a frame the rider has not bought', () => {
    const settled = settleEquipment(profile({
      coins: 10,
      ownedFrames: ['montvar'],
      ownedWheels: ['montvar'],
      colors: { ...DEFAULT_COLORS, bike: 'falcora', wheelBrand: 'falcora' },
    }));
    expect(settled.colors.bike).toBe('montvar');
    expect(settled.colors.wheelBrand).toBe('montvar');
    expect(settled.ownedFrames).toEqual(['montvar']);
  });

  it('buys a wheelset without buying the frame, and refuses a short wallet', () => {
    const start = profile({ coins: 80 });
    const wheels = takeFromShop(start, 'wheels', 'nordvik');
    expect(wheels.ok).toBe(true);
    if (!wheels.ok) return;
    expect(wheels.bought).toBe(true);
    expect(wheels.profile.coins).toBe(30);
    expect(wheels.profile.ownedWheels).toContain('nordvik');
    expect(wheels.profile.ownedFrames).toEqual(['montvar']);
    expect(wheels.profile.colors.wheelBrand).toBe('nordvik');
    expect(wheels.profile.colors.bike).toBe('montvar');

    const frame = takeFromShop(wheels.profile, 'frame', 'falcora');
    expect(frame.ok).toBe(false);
    if (frame.ok) return;
    expect(frame.need).toBe(90);
    expect(frame.profile.coins).toBe(30);

    const again = takeFromShop(wheels.profile, 'wheels', 'nordvik');
    expect(again.ok && again.bought).toBe(false);
    if (!again.ok) return;
    expect(again.profile.coins).toBe(30);
  });
});
