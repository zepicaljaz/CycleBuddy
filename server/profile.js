/** Brands a rider can own. Kept in the same order as the game. */
const BRANDS = ['montvar', 'corsano', 'nordvik', 'falcora', 'zentra'];
const GRAPHICS = ['low', 'medium', 'high', 'ultra'];
const TIMES = ['morning', 'noon', 'golden', 'overcast'];
const CAMERAS = ['chase', 'close', 'aerial', 'heli', 'first'];
const MAPS = ['ahead', 'wide', 'loop'];
const PAINT = ['jersey', 'jerseyAccent', 'shorts', 'helmet', 'frame', 'wheels', 'shoes', 'skin'];

function hex(value) {
  const text = String(value ?? '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(text) ? text.toLowerCase() : null;
}

function brands(value) {
  if (!Array.isArray(value)) return null;
  const want = new Set(value.filter((id) => BRANDS.includes(id)));
  want.add('montvar');
  return BRANDS.filter((id) => want.has(id));
}

/** A client timestamp as ISO, never later than now. Missing or invalid means now. */
function clampedIso(value, now = Date.now()) {
  const ms = typeof value === 'string' ? Date.parse(value) : NaN;
  return new Date(Number.isFinite(ms) ? Math.min(ms, now) : now).toISOString();
}

function time(profile) {
  return Date.parse(profile.updatedAt);
}

function richness(profile) {
  return (profile.ownedFrames.length + profile.ownedWheels.length) * 1_000_000 + profile.coins;
}

function bareStarter(profile) {
  return profile.weightKg === 72 && profile.ftp === 230 && profile.coins === 0
    && profile.ownedFrames.length === 1 && profile.ownedWheels.length === 1;
}

/** The latest real weight and FTP. A fresh install's 72 kg / 230 W does not count. */
function chooseBody(prev, next) {
  if (bareStarter(next) && !bareStarter(prev)) return prev;
  if (bareStarter(prev) && !bareStarter(next)) return next;
  return time(next) > time(prev) ? next : prev;
}

function kitKey(profile) {
  const { updatedAt, ...rest } = profile;
  return JSON.stringify(rest);
}

/** A rider profile safe to store on the account, or null when the body is not one. */
export function cleanProfile(body) {
  if (!body || typeof body !== 'object') return null;
  const colorsIn = body.colors;
  if (!colorsIn || typeof colorsIn !== 'object') return null;
  const colors = {};
  for (const key of PAINT) {
    const paint = hex(colorsIn[key]);
    if (!paint) return null;
    colors[key] = paint;
  }
  if (!BRANDS.includes(colorsIn.bike)) return null;
  const wheel = colorsIn.wheelBrand ?? colorsIn.bike;
  if (!BRANDS.includes(wheel)) return null;
  const ownedFrames = brands(body.ownedFrames);
  const ownedWheels = brands(body.ownedWheels);
  if (!ownedFrames || !ownedWheels) return null;
  colors.bike = ownedFrames.includes(colorsIn.bike) ? colorsIn.bike : 'montvar';
  colors.wheelBrand = ownedWheels.includes(wheel) ? wheel : 'montvar';
  const weight = Number(body.weightKg);
  const ftp = Number(body.ftp);
  const difficulty = Number(body.difficulty);
  const coins = Number(body.coins);
  if (!(weight >= 35 && weight <= 150)) return null;
  if (!(ftp >= 80 && ftp <= 550)) return null;
  if (!(difficulty >= 0 && difficulty <= 100)) return null;
  if (!Number.isInteger(coins) || coins < 0 || coins > 1_000_000) return null;
  if (!GRAPHICS.includes(body.graphics)) return null;
  if (!TIMES.includes(body.timeOfDay)) return null;
  if (!CAMERAS.includes(body.camera)) return null;
  if (!MAPS.includes(body.map)) return null;
  const name = String(body.name ?? '').trim().replace(/\s+/g, ' ').slice(0, 24);
  // The client sets this, so it is only trusted as a past moment: a far-future
  // date must not win every later merge.
  const updatedAt = clampedIso(body.updatedAt);
  return {
    name,
    weightKg: Math.round(weight * 10) / 10,
    ftp: Math.round(ftp),
    difficulty: Math.round(difficulty),
    colors,
    coins,
    ownedFrames,
    ownedWheels,
    graphics: body.graphics,
    timeOfDay: body.timeOfDay,
    camera: body.camera,
    map: body.map,
    updatedAt,
  };
}

/**
 * Keep the fuller garage. A computer that still has the starter kit cannot
 * replace Coins or bikes already stored for this account.
 * Purchases from both computers stay owned.
 */
export function mergeProfiles(current, incoming) {
  const next = cleanProfile(incoming);
  if (!next) return null;
  const prev = current ? cleanProfile(current) : null;
  if (!prev) return next;
  const winner = richness(next) === richness(prev)
    ? (kitKey(next) === kitKey(prev) || time(next) <= time(prev) ? prev : next)
    : (richness(next) > richness(prev) ? next : prev);
  const ownedFrames = brands([...prev.ownedFrames, ...next.ownedFrames]);
  const ownedWheels = brands([...prev.ownedWheels, ...next.ownedWheels]);
  const colors = { ...winner.colors };
  if (!ownedFrames.includes(colors.bike)) colors.bike = 'montvar';
  if (!ownedWheels.includes(colors.wheelBrand)) colors.wheelBrand = 'montvar';
  const body = chooseBody(prev, next);
  return {
    ...winner,
    name: body.name,
    weightKg: body.weightKg,
    ftp: body.ftp,
    colors,
    ownedFrames,
    ownedWheels,
  };
}
