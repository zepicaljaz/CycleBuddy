import { describe, expect, it } from 'vitest';
import type { Profile } from '../storage/types';
import { DEFAULT_COLORS, type RiderColors } from '../world/riders';
import { mergeAccountProfile, type AccountProfile } from './accountProfile';

function profile(over: Partial<Omit<Profile, 'colors'>> & { colors?: Partial<RiderColors> } = {}): Profile {
  const { colors, ...rest } = over;
  return {
    id: 'me',
    name: 'Aljaz',
    weightKg: 72,
    ftp: 230,
    difficulty: 50,
    graphics: 'high',
    timeOfDay: 'golden',
    camera: 'chase',
    map: 'ahead',
    coins: 0,
    ownedFrames: ['montvar'],
    ownedWheels: ['montvar'],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...rest,
    colors: { ...DEFAULT_COLORS, ...colors },
  };
}

function account(over: Partial<Omit<AccountProfile, 'colors'>> & { colors?: Partial<RiderColors> } = {}): AccountProfile {
  const base = profile();
  const { colors, ...rest } = over;
  return {
    name: base.name,
    weightKg: base.weightKg,
    ftp: base.ftp,
    difficulty: base.difficulty,
    coins: base.coins,
    ownedFrames: base.ownedFrames,
    ownedWheels: base.ownedWheels,
    graphics: base.graphics,
    timeOfDay: base.timeOfDay,
    camera: base.camera,
    map: base.map,
    updatedAt: base.updatedAt,
    ...rest,
    colors: { ...base.colors, ...colors },
  };
}

describe('account profile', () => {
  it('uploads a local garage when the account has none yet', () => {
    const local = profile({ coins: 12, ownedFrames: ['montvar', 'corsano'], colors: { bike: 'corsano' } });
    const merged = mergeAccountProfile(local, null, true);
    expect(merged.upload).toBe(true);
    expect(merged.profile.coins).toBe(12);
    expect(merged.profile.colors.bike).toBe('corsano');
  });

  it('does not upload a brand new computer over an empty account', () => {
    const merged = mergeAccountProfile(profile(), null, false);
    expect(merged.upload).toBe(false);
  });

  it('loads coins and the equipped kit from the account onto a new computer', () => {
    const remote = account({
      coins: 40,
      ownedFrames: ['montvar', 'falcora'],
      ownedWheels: ['montvar', 'nordvik'],
      colors: { bike: 'falcora', wheelBrand: 'nordvik', jersey: '#112233' },
      updatedAt: '2026-02-01T00:00:00.000Z',
    });
    const merged = mergeAccountProfile(profile({ updatedAt: '2026-06-01T00:00:00.000Z' }), remote, false);
    expect(merged.upload).toBe(false);
    expect(merged.profile.coins).toBe(40);
    expect(merged.profile.ownedFrames).toEqual(['montvar', 'falcora']);
    expect(merged.profile.ownedWheels).toEqual(['montvar', 'nordvik']);
    expect(merged.profile.colors.bike).toBe('falcora');
    expect(merged.profile.colors.wheelBrand).toBe('nordvik');
    expect(merged.profile.colors.jersey).toBe('#112233');
  });

  it('keeps the fuller local garage when the account is still the starter kit', () => {
    const local = profile({
      coins: 15,
      ownedFrames: ['montvar', 'zentra'],
      colors: { bike: 'zentra', frame: '#abcdef' },
      updatedAt: '2026-01-02T00:00:00.000Z',
    });
    const merged = mergeAccountProfile(local, account({ updatedAt: '2026-03-01T00:00:00.000Z' }), true);
    expect(merged.upload).toBe(true);
    expect(merged.profile.coins).toBe(15);
    expect(merged.profile.colors.bike).toBe('zentra');
    expect(merged.profile.colors.frame).toBe('#abcdef');
  });

  it('does not let a newer computer with no Coins replace the account garage', () => {
    const local = profile({ coins: 0, updatedAt: '2026-08-01T00:00:00.000Z' });
    const remote = account({
      coins: 25,
      ownedFrames: ['montvar', 'zentra'],
      colors: { bike: 'zentra' },
      updatedAt: '2026-02-01T00:00:00.000Z',
    });
    const merged = mergeAccountProfile(local, remote, true);
    expect(merged.upload).toBe(false);
    expect(merged.profile.coins).toBe(25);
    expect(merged.profile.colors.bike).toBe('zentra');
  });

  it('loads weight and FTP from the account onto a new computer', () => {
    const remote = account({ name: 'AljazZ', weightKg: 56, ftp: 200, coins: 35, updatedAt: '2026-02-01T00:00:00.000Z' });
    const merged = mergeAccountProfile(profile({ weightKg: 72, ftp: 230, updatedAt: '2026-08-01T00:00:00.000Z' }), remote, false);
    expect(merged.upload).toBe(false);
    expect(merged.profile.weightKg).toBe(56);
    expect(merged.profile.ftp).toBe(200);
    expect(merged.profile.name).toBe('AljazZ');
  });

  it('does not let the starter weight and FTP replace the saved rider', () => {
    const local = profile({ name: 'Aljaz', weightKg: 72, ftp: 230, coins: 0, updatedAt: '2026-08-01T00:00:00.000Z' });
    const remote = account({
      name: 'AljazZ',
      weightKg: 56,
      ftp: 200,
      coins: 35,
      ownedWheels: ['montvar', 'nordvik'],
      updatedAt: '2026-02-01T00:00:00.000Z',
    });
    const merged = mergeAccountProfile(local, remote, true);
    expect(merged.upload).toBe(false);
    expect(merged.profile.weightKg).toBe(56);
    expect(merged.profile.ftp).toBe(200);
    expect(merged.profile.name).toBe('AljazZ');
  });

  it('uploads a newer weight and FTP from Settings', () => {
    const local = profile({ weightKg: 58, ftp: 210, coins: 35, updatedAt: '2026-08-01T00:00:00.000Z' });
    const remote = account({ weightKg: 56, ftp: 200, coins: 35, updatedAt: '2026-02-01T00:00:00.000Z' });
    const merged = mergeAccountProfile(local, remote, true);
    expect(merged.upload).toBe(true);
    expect(merged.profile.weightKg).toBe(58);
    expect(merged.profile.ftp).toBe(210);
  });

  it('keeps purchases from both computers', () => {
    const local = profile({
      coins: 10,
      ownedFrames: ['montvar', 'corsano'],
      colors: { bike: 'corsano' },
      updatedAt: '2026-04-01T00:00:00.000Z',
    });
    const remote = account({
      coins: 10,
      ownedWheels: ['montvar', 'nordvik'],
      colors: { wheelBrand: 'nordvik' },
      updatedAt: '2026-03-01T00:00:00.000Z',
    });
    const merged = mergeAccountProfile(local, remote, true);
    expect(merged.profile.ownedFrames).toEqual(['montvar', 'corsano']);
    expect(merged.profile.ownedWheels).toEqual(['montvar', 'nordvik']);
    expect(merged.profile.colors.bike).toBe('corsano');
    expect(merged.upload).toBe(true);
  });
});
