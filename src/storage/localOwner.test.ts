import { describe, expect, it } from 'vitest';
import { claimLocalData, clearLocalAccountData, OWNER_KEY } from './localOwner';

function memoryStorage(entries: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(entries));
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (key) => void map.delete(key),
    setItem: (key, value) => void map.set(key, String(value)),
  };
}

function fakeData() {
  const calls: string[] = [];
  return {
    calls,
    clearRideHistory: async () => void calls.push('rides'),
    clearProfile: async () => void calls.push('profile'),
  };
}

const accountKeys = { 'cb-synced-ride-ids': '["a"]', 'cyclebuddy-career': '{}', 'cb-local-rides-cleared': '1' };

describe('claimLocalData', () => {
  it('claims data from before owners were tracked without clearing it', async () => {
    const ls = memoryStorage(accountKeys);
    const data = fakeData();
    expect(await claimLocalData('user-1', data, ls)).toBe(false);
    expect(data.calls).toEqual([]);
    expect(ls.getItem(OWNER_KEY)).toBe('user-1');
    expect(ls.getItem('cyclebuddy-career')).toBe('{}');
  });

  it('keeps data for the same account', async () => {
    const ls = memoryStorage({ ...accountKeys, [OWNER_KEY]: 'user-1' });
    const data = fakeData();
    expect(await claimLocalData('user-1', data, ls)).toBe(false);
    expect(data.calls).toEqual([]);
  });

  it("clears another account's rides, rider, career and sync list", async () => {
    const ls = memoryStorage({ ...accountKeys, [OWNER_KEY]: 'user-1' });
    const data = fakeData();
    expect(await claimLocalData('user-2', data, ls)).toBe(true);
    expect(data.calls).toEqual(['rides', 'profile']);
    expect(ls.getItem('cb-synced-ride-ids')).toBeNull();
    expect(ls.getItem('cyclebuddy-career')).toBeNull();
    expect(ls.getItem('cb-local-rides-cleared')).toBe('1');
    expect(ls.getItem(OWNER_KEY)).toBe('user-2');
  });
});

describe('clearLocalAccountData', () => {
  it('forgets the owner too, so the next sign-in starts clean', async () => {
    const ls = memoryStorage({ ...accountKeys, [OWNER_KEY]: 'user-1' });
    const data = fakeData();
    await clearLocalAccountData(data, ls);
    expect(data.calls).toEqual(['rides', 'profile']);
    expect(ls.getItem(OWNER_KEY)).toBeNull();
    expect(ls.getItem('cyclebuddy-career')).toBeNull();
  });
});
