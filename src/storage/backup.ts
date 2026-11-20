import type { ClimbEffort, Profile, RideSample, RideSummary, StorageProvider } from './types';

interface BackupFile {
  app: 'CycleBuddy';
  version: 1;
  exportedAt: string;
  profile: Profile | null;
  rides: { summary: RideSummary; samples: RideSample[] }[];
  climbEfforts: ClimbEffort[];
}

export async function exportBackup(storage: StorageProvider): Promise<string> {
  const rides = await storage.listRides();
  const data: BackupFile = {
    app: 'CycleBuddy',
    version: 1,
    exportedAt: new Date().toISOString(),
    profile: await storage.getProfile(),
    rides: await Promise.all(rides.map(async (summary) => ({ summary, samples: (await storage.getRideSamples(summary.id)) ?? [] }))),
    climbEfforts: await storage.listClimbEfforts(),
  };
  return JSON.stringify(data);
}

/** Imports a backup; existing rides with the same id are overwritten. Returns number of rides imported. */
export async function importBackup(storage: StorageProvider, json: string): Promise<number> {
  const data = JSON.parse(json) as BackupFile;
  if (data.app !== 'CycleBuddy' || !Array.isArray(data.rides)) throw new Error('This is not a CycleBuddy backup file.');
  // @garmin/fitsdk is large; load it only when a backup is imported.
  const { encodeFit } = await import('./fit');
  if (data.profile) await storage.saveProfile(data.profile);
  for (const r of data.rides) {
    const fit = r.samples.length ? encodeFit(r.summary, r.samples) : null;
    await storage.saveRide(r.summary, r.samples, fit);
  }
  for (const e of data.climbEfforts ?? []) await storage.saveClimbEffort(e);
  return data.rides.length;
}
