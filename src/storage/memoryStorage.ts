import type { ActiveRideSnapshot, ClimbEffort, Profile, RideSample, RideSummary, StorageProvider } from './types';

/**
 * Storage that lives only until the tab closes. Used when IndexedDB cannot be
 * opened (storage blocked, some private modes), so the app still runs and rides
 * still reach the account.
 */
export class MemoryStorage implements StorageProvider {
  private profile: Profile | null = null;
  private rides = new Map<string, RideSummary>();
  private samples = new Map<string, RideSample[]>();
  private fits = new Map<string, Uint8Array>();
  private efforts = new Map<string, ClimbEffort>();
  private active: ActiveRideSnapshot | null = null;

  async getProfile(): Promise<Profile | null> {
    return this.profile ? structuredClone(this.profile) : null;
  }

  async saveProfile(p: Profile): Promise<void> {
    this.profile = structuredClone({ ...p, updatedAt: new Date().toISOString() });
  }

  async clearProfile(): Promise<void> {
    this.profile = null;
  }

  async listRides(): Promise<RideSummary[]> {
    return [...this.rides.values()].sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0));
  }

  async getRide(id: string): Promise<RideSummary | null> {
    return this.rides.get(id) ?? null;
  }

  async saveRide(summary: RideSummary, samples: RideSample[], fit: Uint8Array | null): Promise<void> {
    this.rides.set(summary.id, summary);
    this.samples.set(summary.id, samples);
    if (fit) this.fits.set(summary.id, fit);
  }

  async deleteRide(id: string): Promise<void> {
    this.rides.delete(id);
    this.samples.delete(id);
    this.fits.delete(id);
    for (const [key, effort] of this.efforts) if (effort.rideId === id) this.efforts.delete(key);
  }

  async getRideSamples(id: string): Promise<RideSample[] | null> {
    return this.samples.get(id) ?? null;
  }

  async getRideFit(id: string): Promise<Uint8Array | null> {
    return this.fits.get(id) ?? null;
  }

  async listClimbEfforts(climbId?: string): Promise<ClimbEffort[]> {
    const list = [...this.efforts.values()].filter((e) => !climbId || e.climbId === climbId);
    return list.sort((a, b) => a.timeSec - b.timeSec);
  }

  async saveClimbEffort(e: ClimbEffort): Promise<void> {
    this.efforts.set(e.id, e);
  }

  async saveActiveRide(s: ActiveRideSnapshot): Promise<void> {
    this.active = s;
  }

  async getActiveRide(): Promise<ActiveRideSnapshot | null> {
    return this.active;
  }

  async clearActiveRide(): Promise<void> {
    this.active = null;
  }

  async clearRideHistory(): Promise<void> {
    this.rides.clear();
    this.samples.clear();
    this.fits.clear();
    this.efforts.clear();
    this.active = null;
  }
}
