import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { MemoryStorage } from './memoryStorage';
import type { ActiveRideSnapshot, ClimbEffort, Profile, RideSample, RideSummary, StorageProvider } from './types';

interface CycleBuddyDB extends DBSchema {
  profile: { key: string; value: Profile };
  rides: { key: string; value: RideSummary; indexes: { byStartedAt: string } };
  rideSamples: { key: string; value: { id: string; samples: RideSample[] } };
  rideFiles: { key: string; value: { id: string; fit: Blob } };
  climbEfforts: { key: string; value: ClimbEffort; indexes: { byClimb: string } };
  activeRide: { key: string; value: ActiveRideSnapshot };
}

type DB = IDBPDatabase<CycleBuddyDB>;

const VERSION = 1;

export class IndexedDbStorage implements StorageProvider {
  /** Null when IndexedDB could not be opened; then everything goes to `memory`. */
  private db: Promise<DB | null>;
  private memory: MemoryStorage | null = null;

  constructor(name = 'cyclebuddy') {
    this.db = openDB<CycleBuddyDB>(name, VERSION, {
      // Each step only runs for databases older than it, so future versions add steps below.
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          db.createObjectStore('profile', { keyPath: 'id' });
          const rides = db.createObjectStore('rides', { keyPath: 'id' });
          rides.createIndex('byStartedAt', 'startedAt');
          db.createObjectStore('rideSamples', { keyPath: 'id' });
          db.createObjectStore('rideFiles', { keyPath: 'id' });
          const efforts = db.createObjectStore('climbEfforts', { keyPath: 'id' });
          efforts.createIndex('byClimb', 'climbId');
          db.createObjectStore('activeRide', { keyPath: 'id' });
        }
      },
      // A newer CycleBuddy in another tab wants to upgrade: let it, and reload into the new version.
      blocking(_current, blockedVersion, event) {
        (event.target as IDBDatabase | null)?.close();
        if (blockedVersion !== null) location.reload();
      },
      blocked() {
        console.warn('CycleBuddy is open in another tab with an older version. Close it to finish updating.');
      },
    }).catch((err: unknown) => {
      console.error('IndexedDB is not available; this session will not be kept on this computer.', err);
      this.memory = new MemoryStorage();
      return null;
    });
    // Ask the browser not to evict our data under storage pressure.
    void navigator.storage?.persist?.();
  }

  /** Runs `idb` against the database, or `mem` against the in-memory fallback. */
  private async use<T>(idb: (db: DB) => Promise<T>, mem: (m: MemoryStorage) => Promise<T>): Promise<T> {
    const db = await this.db;
    return db ? idb(db) : mem(this.memory as MemoryStorage);
  }

  async getProfile(): Promise<Profile | null> {
    return this.use(async (db) => (await db.get('profile', 'me')) ?? null, (m) => m.getProfile());
  }

  async saveProfile(p: Profile): Promise<void> {
    return this.use(
      async (db) => void (await db.put('profile', { ...p, updatedAt: new Date().toISOString() })),
      (m) => m.saveProfile(p),
    );
  }

  async clearProfile(): Promise<void> {
    return this.use((db) => db.delete('profile', 'me'), (m) => m.clearProfile());
  }

  async listRides(): Promise<RideSummary[]> {
    return this.use(async (db) => (await db.getAllFromIndex('rides', 'byStartedAt')).reverse(), (m) => m.listRides());
  }

  async getRide(id: string): Promise<RideSummary | null> {
    return this.use(async (db) => (await db.get('rides', id)) ?? null, (m) => m.getRide(id));
  }

  async saveRide(summary: RideSummary, samples: RideSample[], fit: Uint8Array | null): Promise<void> {
    return this.use(async (db) => {
      const tx = db.transaction(['rides', 'rideSamples', 'rideFiles'], 'readwrite');
      await tx.objectStore('rides').put(summary);
      await tx.objectStore('rideSamples').put({ id: summary.id, samples });
      if (fit) await tx.objectStore('rideFiles').put({ id: summary.id, fit: new Blob([fit as BlobPart], { type: 'application/octet-stream' }) });
      await tx.done;
    }, (m) => m.saveRide(summary, samples, fit));
  }

  async deleteRide(id: string): Promise<void> {
    return this.use(async (db) => {
      const tx = db.transaction(['rides', 'rideSamples', 'rideFiles', 'climbEfforts'], 'readwrite');
      await tx.objectStore('rides').delete(id);
      await tx.objectStore('rideSamples').delete(id);
      await tx.objectStore('rideFiles').delete(id);
      const efforts = await tx.objectStore('climbEfforts').getAll();
      for (const e of efforts) if (e.rideId === id) await tx.objectStore('climbEfforts').delete(e.id);
      await tx.done;
    }, (m) => m.deleteRide(id));
  }

  async getRideSamples(id: string): Promise<RideSample[] | null> {
    return this.use(async (db) => (await db.get('rideSamples', id))?.samples ?? null, (m) => m.getRideSamples(id));
  }

  async getRideFit(id: string): Promise<Uint8Array | null> {
    return this.use(async (db) => {
      const rec = await db.get('rideFiles', id);
      return rec ? new Uint8Array(await rec.fit.arrayBuffer()) : null;
    }, (m) => m.getRideFit(id));
  }

  async listClimbEfforts(climbId?: string): Promise<ClimbEffort[]> {
    return this.use(async (db) => {
      const list = climbId ? await db.getAllFromIndex('climbEfforts', 'byClimb', climbId) : await db.getAll('climbEfforts');
      return list.sort((a, b) => a.timeSec - b.timeSec);
    }, (m) => m.listClimbEfforts(climbId));
  }

  async saveClimbEffort(e: ClimbEffort): Promise<void> {
    return this.use(async (db) => void (await db.put('climbEfforts', e)), (m) => m.saveClimbEffort(e));
  }

  async saveActiveRide(s: ActiveRideSnapshot): Promise<void> {
    return this.use(async (db) => void (await db.put('activeRide', s)), (m) => m.saveActiveRide(s));
  }

  async getActiveRide(): Promise<ActiveRideSnapshot | null> {
    return this.use(async (db) => (await db.get('activeRide', 'current')) ?? null, (m) => m.getActiveRide());
  }

  async clearActiveRide(): Promise<void> {
    return this.use((db) => db.delete('activeRide', 'current'), (m) => m.clearActiveRide());
  }

  async clearRideHistory(): Promise<void> {
    return this.use(async (db) => {
      const tx = db.transaction(['rides', 'rideSamples', 'rideFiles', 'climbEfforts', 'activeRide'], 'readwrite');
      await Promise.all([
        tx.objectStore('rides').clear(),
        tx.objectStore('rideSamples').clear(),
        tx.objectStore('rideFiles').clear(),
        tx.objectStore('climbEfforts').clear(),
        tx.objectStore('activeRide').clear(),
      ]);
      await tx.done;
    }, (m) => m.clearRideHistory());
  }
}
