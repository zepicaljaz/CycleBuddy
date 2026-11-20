import type { ClimbEffort, RideSample, RideSummary, StorageProvider } from './types';

const SYNCED_KEY = 'cb-synced-ride-ids';

export interface RideSyncPlan {
  upload: string[];
  download: string[];
  removeLocal: string[];
}

/** Local rides the server has never seen are uploaded. Rides removed from the account are removed here. */
export function planRideSync(localIds: string[], remoteIds: string[], syncedIds: string[]): RideSyncPlan {
  const local = new Set(localIds);
  const remote = new Set(remoteIds);
  const synced = new Set(syncedIds);
  return {
    upload: localIds.filter((id) => !remote.has(id) && !synced.has(id)),
    download: remoteIds.filter((id) => !local.has(id)),
    removeLocal: localIds.filter((id) => !remote.has(id) && synced.has(id)),
  };
}

interface RemoteCatalog {
  rides: RideSummary[];
  efforts: ClimbEffort[];
}

interface RemoteRide {
  summary: RideSummary;
  samples: RideSample[];
  fit: Uint8Array | null;
  efforts: ClimbEffort[];
}

let inflight: Promise<void> | null = null;

/**
 * Two-way ride sync with the account. Only one runs at a time: a second call while
 * one is running shares it (or, with uploadAllLocal, runs right after it).
 */
export function syncAccountRides(storage: StorageProvider, options?: { uploadAllLocal?: boolean }): Promise<void> {
  if (inflight) {
    if (!options?.uploadAllLocal) return inflight;
    return inflight.catch(() => undefined).then(() => syncAccountRides(storage, options));
  }
  const run = runRideSync(storage, options).finally(() => {
    if (inflight === run) inflight = null;
  });
  inflight = run;
  return run;
}

async function runRideSync(storage: StorageProvider, options?: { uploadAllLocal?: boolean }): Promise<void> {
  const remote = await listRemoteRides();
  if (!remote) return;
  const local = await storage.listRides();
  const localIds = local.map((ride) => ride.id);
  const remoteIds = remote.rides.map((ride) => ride.id);
  const plan = options?.uploadAllLocal
    ? { upload: localIds, download: remoteIds.filter((id) => !new Set(localIds).has(id)), removeLocal: [] as string[] }
    : planRideSync(localIds, remoteIds, readSynced());
  const uploaded = new Set(plan.upload);
  // Only the changes made here are written back, onto a fresh read at the end, so a
  // publishRide or deleteAccountRide that ran meanwhile is not overwritten.
  const added = new Set<string>();
  const removed = new Set<string>();
  const next = {
    add(id: string) {
      added.add(id);
      removed.delete(id);
    },
    delete(id: string) {
      removed.add(id);
      added.delete(id);
    },
  };

  for (const id of plan.removeLocal) {
    await storage.deleteRide(id);
    next.delete(id);
  }
  for (const id of plan.upload) {
    try {
      await pushStoredRide(storage, id);
      next.add(id);
    } catch (err) {
      console.error('Ride upload failed', err);
    }
  }
  for (const id of plan.download) {
    try {
      const full = await fetchRemoteRide(id);
      if (!full) continue;
      await storage.saveRide(full.summary, full.samples, full.fit);
      for (const effort of full.efforts) await storage.saveClimbEffort(effort);
      next.add(id);
    } catch (err) {
      console.error('Ride download failed', err);
    }
  }

  const remoteEffortIds = new Set(remote.efforts.map((effort) => effort.id));
  const effortRides = new Set<string>();
  for (const effort of await storage.listClimbEfforts()) {
    if (!remoteEffortIds.has(effort.id) && !uploaded.has(effort.rideId)) effortRides.add(effort.rideId);
  }
  for (const id of effortRides) {
    try {
      await pushStoredRide(storage, id);
      next.add(id);
    } catch (err) {
      console.error('Ride upload failed', err);
    }
  }
  for (const effort of remote.efforts) await storage.saveClimbEffort(effort);
  const synced = new Set(readSynced());
  for (const id of removed) synced.delete(id);
  for (const id of added) synced.add(id);
  writeSynced(synced);
}

export async function publishRide(storage: StorageProvider, rideId: string): Promise<void> {
  await pushStoredRide(storage, rideId);
  const synced = new Set(readSynced());
  synced.add(rideId);
  writeSynced(synced);
}

export async function deleteAccountRide(storage: StorageProvider, rideId: string): Promise<void> {
  const res = await fetch(`/api/rides/${encodeURIComponent(rideId)}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 404) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || 'Could not delete the ride from your account.');
  }
  await storage.deleteRide(rideId);
  const synced = new Set(readSynced());
  synced.delete(rideId);
  writeSynced(synced);
}

async function listRemoteRides(): Promise<RemoteCatalog | null> {
  let res: Response;
  try {
    res = await fetch('/api/rides');
  } catch {
    return null;
  }
  if (res.status === 401 || res.status === 503) return null;
  const data = (await res.json().catch(() => ({}))) as { error?: string; rides?: RideSummary[]; efforts?: ClimbEffort[] };
  if (!res.ok) throw new Error(data.error || 'Could not load rides from your account.');
  return { rides: data.rides ?? [], efforts: data.efforts ?? [] };
}

async function fetchRemoteRide(rideId: string): Promise<RemoteRide | null> {
  const res = await fetch(`/api/rides/${encodeURIComponent(rideId)}`);
  if (res.status === 404) return null;
  const data = (await res.json().catch(() => ({}))) as {
    error?: string;
    summary?: RideSummary;
    samples?: RideSample[];
    fitBase64?: string | null;
    efforts?: ClimbEffort[];
  };
  if (!res.ok || !data.summary) throw new Error(data.error || 'Could not download that ride.');
  return {
    summary: data.summary,
    samples: data.samples ?? [],
    fit: data.fitBase64 ? base64ToBytes(data.fitBase64) : null,
    efforts: data.efforts ?? [],
  };
}

async function pushStoredRide(storage: StorageProvider, rideId: string): Promise<void> {
  const summary = await storage.getRide(rideId);
  if (!summary) return;
  const samples = (await storage.getRideSamples(rideId)) ?? [];
  const fit = await storage.getRideFit(rideId);
  const efforts = (await storage.listClimbEfforts()).filter((effort) => effort.rideId === rideId);
  const res = await fetch(`/api/rides/${encodeURIComponent(rideId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      summary,
      samples,
      fitBase64: fit ? bytesToBase64(fit) : null,
      efforts,
    }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || 'Could not save the ride to your account.');
  }
}

function readSynced(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(SYNCED_KEY) || '[]') as unknown;
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function writeSynced(ids: Set<string>): void {
  localStorage.setItem(SYNCED_KEY, JSON.stringify([...ids]));
}

function bytesToBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += 0x8000) {
    parts.push(String.fromCharCode(...bytes.subarray(i, i + 0x8000)));
  }
  return btoa(parts.join(''));
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
