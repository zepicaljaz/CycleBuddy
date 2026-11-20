import type { Profile, RideCamera, RideMap } from '../storage/types';
import type { TimeOfDay } from '../world/atmosphere';
import { BRAND_IDS, type BikeBrand } from '../world/bikes';
import type { GraphicsQuality } from '../world/graphics';
import { DEFAULT_COLORS, type RiderColors } from '../world/riders';
import { settleEquipment } from './coins';

/** The rider record stored on the account. Preferences travel with the Coins and the kit. */
export interface AccountProfile {
  name: string;
  weightKg: number;
  ftp: number;
  difficulty: number;
  colors: RiderColors;
  coins: number;
  ownedFrames: BikeBrand[];
  ownedWheels: BikeBrand[];
  graphics: GraphicsQuality;
  timeOfDay: TimeOfDay;
  camera: RideCamera;
  map: RideMap;
  updatedAt: string;
}

export type AccountProfileFetch =
  | { signedIn: false }
  | { signedIn: true; profile: AccountProfile | null };

/** Fields compared when deciding whether the account copy needs an update. */
function kitKey(profile: Profile): string {
  const colors = profile.colors;
  return JSON.stringify({
    name: profile.name,
    weightKg: profile.weightKg,
    ftp: profile.ftp,
    difficulty: profile.difficulty,
    colors: {
      jersey: colors.jersey,
      jerseyAccent: colors.jerseyAccent,
      shorts: colors.shorts,
      helmet: colors.helmet,
      frame: colors.frame,
      wheels: colors.wheels,
      shoes: colors.shoes,
      skin: colors.skin,
      bike: colors.bike,
      wheelBrand: colors.wheelBrand ?? colors.bike,
    },
    coins: profile.coins,
    ownedFrames: [...profile.ownedFrames].sort(),
    ownedWheels: [...profile.ownedWheels].sort(),
    graphics: profile.graphics,
    timeOfDay: profile.timeOfDay,
    camera: profile.camera,
    map: profile.map,
  });
}

/** Owned parts count first, then the Coin balance. A fresh computer does not outrank a garage. */
function richness(profile: Profile): number {
  return (profile.ownedFrames.length + profile.ownedWheels.length) * 1_000_000 + profile.coins;
}

function unionBrands(a: BikeBrand[], b: BikeBrand[]): BikeBrand[] {
  const owned = new Set([...a, ...b]);
  return BRAND_IDS.filter((id) => owned.has(id));
}

/** The numbers a brand-new install shows before anyone saves a rider. */
const STARTER_WEIGHT_KG = 72;
const STARTER_FTP = 230;

/** A profile that was never given a real weight, FTP, or garage. */
function bareStarter(profile: Profile): boolean {
  return profile.weightKg === STARTER_WEIGHT_KG
    && profile.ftp === STARTER_FTP
    && profile.coins === 0
    && profile.ownedFrames.length === 1
    && profile.ownedWheels.length === 1;
}

/** Weight, FTP and name follow the latest real save. The starter 72 kg / 230 W does not replace one. */
function bodySource(local: Profile, account: Profile): Profile {
  if (bareStarter(local) && !bareStarter(account)) return account;
  if (bareStarter(account) && !bareStarter(local)) return local;
  return local.updatedAt > account.updatedAt ? local : account;
}

function asProfile(local: Profile, remote: AccountProfile): Profile {
  return settleEquipment({
    ...local,
    name: remote.name,
    weightKg: remote.weightKg,
    ftp: remote.ftp,
    difficulty: remote.difficulty,
    colors: { ...DEFAULT_COLORS, ...remote.colors },
    coins: remote.coins,
    ownedFrames: remote.ownedFrames,
    ownedWheels: remote.ownedWheels,
    graphics: remote.graphics,
    timeOfDay: remote.timeOfDay,
    camera: remote.camera,
    map: remote.map,
    updatedAt: remote.updatedAt,
  });
}

/**
 * Choose the profile this computer should keep.
 * A computer with no saved profile takes the account, including weight and FTP.
 * Otherwise the fuller garage wins. Weight, FTP and name still follow the latest real save,
 * so the starter 72 kg / 230 W on a new computer cannot replace them.
 * Owned parts from both sides stay owned.
 */
export function mergeAccountProfile(local: Profile, remote: AccountProfile | null, hadLocal: boolean): { profile: Profile; upload: boolean } {
  if (!remote) return { profile: local, upload: hadLocal };
  const account = asProfile(local, remote);
  if (!hadLocal) return { profile: account, upload: false };
  const winner = richness(local) === richness(account)
    ? (kitKey(local) === kitKey(account) || local.updatedAt <= account.updatedAt ? account : local)
    : (richness(local) > richness(account) ? local : account);
  const body = bodySource(local, account);
  const profile = settleEquipment({
    ...winner,
    id: 'me',
    createdAt: local.createdAt,
    name: body.name,
    weightKg: body.weightKg,
    ftp: body.ftp,
    ownedFrames: unionBrands(local.ownedFrames, account.ownedFrames),
    ownedWheels: unionBrands(local.ownedWheels, account.ownedWheels),
  });
  return { profile, upload: kitKey(profile) !== kitKey(account) };
}

/** Everything the account stores, except the timestamp, so a resave does not look like a change. */
export function riderRecordKey(profile: Profile): string {
  const body = accountProfileBody(profile);
  body.updatedAt = '';
  return JSON.stringify(body);
}

export function accountProfileBody(profile: Profile): AccountProfile {
  const settled = settleEquipment(profile);
  return {
    name: settled.name,
    weightKg: settled.weightKg,
    ftp: settled.ftp,
    difficulty: settled.difficulty,
    colors: { ...settled.colors, wheelBrand: settled.colors.wheelBrand ?? settled.colors.bike },
    coins: settled.coins,
    ownedFrames: settled.ownedFrames,
    ownedWheels: settled.ownedWheels,
    graphics: settled.graphics,
    timeOfDay: settled.timeOfDay,
    camera: settled.camera,
    map: settled.map,
    updatedAt: settled.updatedAt,
  };
}

/** The account profile, or signed-out when there is no session or the server is down. */
export async function fetchAccountProfile(): Promise<AccountProfileFetch> {
  let res: Response;
  try {
    res = await fetch('/api/profile');
  } catch {
    return { signedIn: false };
  }
  if (res.status === 401 || res.status === 503 || !res.ok) return { signedIn: false };
  const data = (await res.json()) as { profile?: AccountProfile | null };
  return { signedIn: true, profile: data.profile ?? null };
}

/** Write the rider profile onto the signed-in account. Returns the profile the account kept. */
export async function pushAccountProfile(profile: Profile): Promise<AccountProfile | null> {
  try {
    const res = await fetch('/api/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(accountProfileBody(profile)),
    });
    if (res.status === 401) return null;
    if (!res.ok) {
      console.error('Could not save the rider profile to the account.');
      return null;
    }
    const data = (await res.json()) as { profile?: AccountProfile | null };
    return data.profile ?? null;
  } catch (err) {
    console.error(err);
    return null;
  }
}
