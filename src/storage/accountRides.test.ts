import { afterEach, describe, expect, it, vi } from 'vitest';
import { planRideSync, publishRide, syncAccountRides } from './accountRides';
import type { StorageProvider } from './types';

describe('planRideSync', () => {
  it('uploads rides this browser has not sent, and downloads rides from the account', () => {
    const plan = planRideSync(['local-only', 'both'], ['both', 'other-device'], []);
    expect(plan.upload).toEqual(['local-only']);
    expect(plan.download).toEqual(['other-device']);
    expect(plan.removeLocal).toEqual([]);
  });

  it('removes a ride here after it was deleted from the account', () => {
    const plan = planRideSync(['gone', 'kept'], ['kept'], ['gone', 'kept']);
    expect(plan.removeLocal).toEqual(['gone']);
    expect(plan.upload).toEqual([]);
    expect(plan.download).toEqual([]);
  });
});

function memoryLocalStorage(): Storage {
  const map = new Map<string, string>();
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

function emptyStorage(): StorageProvider {
  const summary = { id: 'ride-local-1' } as never;
  return {
    listRides: async () => [summary],
    getRide: async () => summary,
    getRideSamples: async () => [],
    getRideFit: async () => null,
    listClimbEfforts: async () => [],
    saveClimbEffort: async () => undefined,
    saveRide: async () => undefined,
    deleteRide: async () => undefined,
  } as unknown as StorageProvider;
}

describe('syncAccountRides', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('runs one sync at a time and keeps ids written while it ran', async () => {
    vi.stubGlobal('localStorage', memoryLocalStorage());
    let releaseList!: () => void;
    const listGate = new Promise<void>((resolve) => {
      releaseList = resolve;
    });
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (url === '/api/rides') {
        await listGate;
        return new Response(JSON.stringify({ rides: [], efforts: [] }), { status: 200 });
      }
      return new Response('{"ok":true}', { status: 200 });
    });
    const storage = emptyStorage();
    const first = syncAccountRides(storage);
    const second = syncAccountRides(storage);
    // A ride published while the sync is waiting on the server.
    await publishRide(storage, 'ride-other-2');
    releaseList();
    await Promise.all([first, second]);
    expect(calls.filter((call) => call === 'GET /api/rides')).toHaveLength(1);
    const synced = JSON.parse(localStorage.getItem('cb-synced-ride-ids') ?? '[]') as string[];
    expect(synced.sort()).toEqual(['ride-local-1', 'ride-other-2']);
  });
});
