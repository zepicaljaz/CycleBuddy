import { BRAND_IDS, brandSpec, type BikeBrand, type BrandSpec } from '../world/bikes';
import type { Profile } from '../storage/types';

/** The frame and the wheels a new rider starts with. */
export const STARTER_BIKE: BikeBrand = 'montvar';

/** Coins to unlock a frame. The starter is free. */
export const FRAME_COST: Record<BikeBrand, number> = {
  montvar: 0,
  corsano: 50,
  nordvik: 80,
  falcora: 120,
  zentra: 180,
};

/** Coins to unlock that brand's wheels. Bought separately from the frame. */
export const WHEEL_COST: Record<BikeBrand, number> = {
  montvar: 0,
  corsano: 30,
  nordvik: 50,
  falcora: 80,
  zentra: 120,
};

export type ShopKind = 'frame' | 'wheels';

/** One Coin for each full kilometre. */
export function coinsForDistance(distanceM: number): number {
  if (!Number.isFinite(distanceM) || distanceM <= 0) return 0;
  return Math.floor(distanceM / 1000);
}

export function coinWord(n: number): string {
  return `${n} Coin${n === 1 ? '' : 's'}`;
}

export function wheelLabel(spec: BrandSpec): string {
  const mm = Math.round(spec.rim * 1000);
  return spec.gumwall ? `${mm} mm gumwall` : `${mm} mm rims`;
}

export function shopCost(kind: ShopKind, id: BikeBrand): number {
  return kind === 'frame' ? FRAME_COST[id] : WHEEL_COST[id];
}

function asBrand(id: string | undefined, fallback: BikeBrand): BikeBrand {
  return brandSpec(id).id === id ? (id as BikeBrand) : brandSpec(id ?? fallback).id;
}

/**
 * Fill in a wallet for saves from before Coins. The starter kit is owned.
 * A bike the rider had already chosen stays theirs.
 */
export function settleEquipment(profile: Profile): Profile {
  const raw = profile as Profile & { ownedFrames?: BikeBrand[]; ownedWheels?: BikeBrand[]; coins?: number };
  const hadWallet = Array.isArray(raw.ownedFrames) && Array.isArray(raw.ownedWheels);
  let bike = asBrand(profile.colors.bike, STARTER_BIKE);
  // No separate wheel choice yet: the wheels were the ones on that frame.
  let wheelBrand = profile.colors.wheelBrand ? asBrand(profile.colors.wheelBrand, bike) : bike;
  const frames = new Set<BikeBrand>(hadWallet ? raw.ownedFrames : []);
  const wheels = new Set<BikeBrand>(hadWallet ? raw.ownedWheels : []);
  frames.add(STARTER_BIKE);
  wheels.add(STARTER_BIKE);
  if (!hadWallet) {
    frames.add(bike);
    wheels.add(wheelBrand);
  }
  if (!frames.has(bike)) bike = STARTER_BIKE;
  if (!wheels.has(wheelBrand)) wheelBrand = STARTER_BIKE;
  const coins = Math.max(0, Math.floor(Number.isFinite(raw.coins) ? Number(raw.coins) : 0));
  return {
    ...profile,
    coins,
    ownedFrames: BRAND_IDS.filter((id) => frames.has(id)),
    ownedWheels: BRAND_IDS.filter((id) => wheels.has(id)),
    colors: { ...profile.colors, bike, wheelBrand },
  };
}

export type ShopResult =
  | { ok: true; profile: Profile; bought: boolean }
  | { ok: false; profile: Profile; need: number };

function equip(profile: Profile, kind: ShopKind, id: BikeBrand): Profile {
  const colors = kind === 'frame'
    ? { ...profile.colors, bike: id }
    : { ...profile.colors, wheelBrand: id };
  return { ...profile, colors };
}

/** Equip an owned frame or wheelset, or buy it when the rider has the Coins. */
export function takeFromShop(profile: Profile, kind: ShopKind, id: BikeBrand): ShopResult {
  const owned = new Set(kind === 'frame' ? profile.ownedFrames : profile.ownedWheels);
  if (owned.has(id)) return { ok: true, bought: false, profile: equip(profile, kind, id) };
  const cost = shopCost(kind, id);
  if (profile.coins < cost) return { ok: false, profile, need: cost - profile.coins };
  owned.add(id);
  const next: Profile = {
    ...profile,
    coins: profile.coins - cost,
    ownedFrames: kind === 'frame' ? BRAND_IDS.filter((b) => owned.has(b)) : profile.ownedFrames,
    ownedWheels: kind === 'wheels' ? BRAND_IDS.filter((b) => owned.has(b)) : profile.ownedWheels,
  };
  return { ok: true, bought: true, profile: equip(next, kind, id) };
}
