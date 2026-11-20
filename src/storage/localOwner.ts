import type { StorageProvider } from './types';

/** The account id whose rides, rider and career this browser holds. */
export const OWNER_KEY = 'cb-owner';
/** localStorage keys that belong to one account. */
const ACCOUNT_KEYS = ['cb-synced-ride-ids', 'cyclebuddy-career'];

type LocalData = Pick<StorageProvider, 'clearRideHistory' | 'clearProfile'>;

function store(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Removes everything this browser keeps for an account: rides, rider profile, career and the sync list. */
export async function clearLocalAccountData(storage: LocalData, ls: Storage | null = store()): Promise<void> {
  await storage.clearRideHistory();
  await storage.clearProfile();
  for (const key of [...ACCOUNT_KEYS, OWNER_KEY]) ls?.removeItem(key);
}

/**
 * Called once a signed-in user is known. When this browser holds another
 * account's data, it is removed first, so it is not uploaded to (or shown in)
 * this account. Browsers from before this check have no owner yet: their data
 * is kept and claimed. Returns true when data was cleared.
 */
export async function claimLocalData(userId: string, storage: LocalData, ls: Storage | null = store()): Promise<boolean> {
  const owner = ls?.getItem(OWNER_KEY) ?? null;
  let cleared = false;
  if (owner && owner !== userId) {
    await clearLocalAccountData(storage, ls);
    cleared = true;
  }
  ls?.setItem(OWNER_KEY, userId);
  return cleared;
}
