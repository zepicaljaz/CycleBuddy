// Real towns on the real roads: how many buildings each one has, where it begins and
// ends along the road, and where along the street they stand.
//   node scripts/real-track/buildings.mjs            (uses the cached Overpass answers)
//   node scripts/real-track/buildings.mjs --fetch    (asks Overpass again)
//   node scripts/real-track/buildings.mjs <id> ...   (only these roads)
// In:  src/routes/real/tracks/<id>.json (road line, origin, towns), Overpass answers
//      cached in data/osm/buildings-<id>.json (© OpenStreetMap contributors, ODbL):
//      the centre and building=* value of every mapped building near each town.
// Out: src/routes/real/towns/<id>.json, one entry per town on that road: the street's
//      real extent (fromM/toM, metres from the valley end like the track's own towns),
//      how many buildings OpenStreetMap has there, and the street-front and back-row
//      houses as positions along the road. The game builds from that file and never
//      fetches anything. Re-run (without --fetch) after a road's track is rebuilt: the
//      positions are measured on the track's line.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { projection } from './geo.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const ENDPOINTS = [
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

/** Street front: a building whose centre is this close to the road's centre line. */
export const FRONT_M = 60;
/** Back row: further than the front, up to this. Beyond it a house is not on this street. */
export const BACK_M = 150;
/** A gap this long between street-front houses ends a village. */
const GAP_M = 80;
/** Street-front houses per 100 m below which a village's end is a lone farm, not the street. */
const TAIL_MIN = 4;
/** How far past the configured ends to look for the real ones. */
const SEARCH_M = 600;
/**
 * Small outbuildings OpenStreetMap maps one by one: garages, sheds, carports, roofs,
 * kiosks. Counted, but not built as houses (the game draws a yard, not every shed).
 */
const MINOR = new Set([
  'garage', 'garages', 'shed', 'roof', 'carport', 'hut', 'kiosk', 'service', 'transformer_tower',
  'container', 'cabin', 'shelter', 'toilets', 'bunker', 'ruins', 'construction', 'greenhouse', 'storage_tank',
]);

async function overpass(q) {
  let last;
  for (const url of ENDPOINTS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'cyclebuddy-track-builder' },
          body: 'data=' + encodeURIComponent(q),
          signal: AbortSignal.timeout(120000),
        });
        if (!res.ok) throw new Error(`${url} HTTP ${res.status}`);
        return await res.json();
      } catch (e) {
        last = e;
        console.warn(String(e));
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  }
  throw last;
}

/** The way up: track points from the valley end to just past the published climb, with distances. */
function upLine(track) {
  const upTo = track.sections[0] + track.sections[1] + 30;
  const xs = [];
  const zs = [];
  const cum = [];
  let s = 0;
  for (let i = 0; i < track.x.length; i++) {
    if (i) s += Math.hypot(track.x[i] - track.x[i - 1], track.z[i] - track.z[i - 1]);
    if (s > upTo) break;
    xs.push(track.x[i]);
    zs.push(track.z[i]);
    cum.push(s);
  }
  return { xs, zs, cum };
}

/**
 * Where (x, z) sits on the road: metres along it, distance from the centre line, and
 * side (+1 right of the direction of travel, -1 left; z grows south). Null when the
 * point lies beyond either end of the line.
 */
function project(line, x, z) {
  const { xs, zs, cum } = line;
  let best = null;
  for (let i = 1; i < xs.length; i++) {
    const ax = xs[i - 1], az = zs[i - 1];
    const dx = xs[i] - ax, dz = zs[i] - az;
    const len2 = dx * dx + dz * dz || 1;
    let t = ((x - ax) * dx + (z - az) * dz) / len2;
    const before = t < 0 && i === 1;
    const after = t > 1 && i === xs.length - 1;
    t = Math.max(0, Math.min(1, t));
    const px = ax + dx * t, pz = az + dz * t;
    const d = Math.hypot(x - px, z - pz);
    if (!best || d < best.d) {
      // Cross product: positive is to the right when travelling along +s (x east, z south).
      const cross = dx * (z - az) - dz * (x - ax);
      best = { s: cum[i - 1] + t * (cum[i] - cum[i - 1]), d, side: cross > 0 ? 1 : -1, beyond: before || after };
    }
  }
  return best && !best.beyond ? best : null;
}

const r1 = (v) => Math.round(v * 10) / 10;
const fetchAgain = process.argv.includes('--fetch');
const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const trackDir = path.join(ROOT, 'src/routes/real/tracks');
const ids = fs.readdirSync(trackDir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
const outDir = path.join(ROOT, 'src/routes/real/towns');
fs.mkdirSync(outDir, { recursive: true });

for (const id of ids) {
  if (only.length && !only.includes(id)) continue;
  const track = JSON.parse(fs.readFileSync(path.join(trackDir, `${id}.json`), 'utf8'));
  const towns = track.towns ?? (track.town ? [track.town] : []);
  const out = path.join(outDir, `${id}.json`);
  if (!towns.length) {
    if (fs.existsSync(out)) fs.rmSync(out);
    console.log(`${id}: no towns on this road`);
    continue;
  }
  const { toXZ, toLL } = projection(track.origin.lat, track.origin.lon);
  const line = upLine(track);
  const cache = path.join(ROOT, `data/osm/buildings-${id}.json`);
  if (fetchAgain || !fs.existsSync(cache)) {
    const raw = { source: 'Buildings © OpenStreetMap contributors (ODbL), via Overpass. Centre and building=* value; only those within ' + BACK_M + ' m of the road.', towns: {} };
    for (const town of towns) {
      // Box around the stretch of road the town could cover, plus the back row.
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      line.cum.forEach((s, i) => {
        if (s < town.fromM - SEARCH_M || s > town.toM + SEARCH_M) return;
        x0 = Math.min(x0, line.xs[i]); x1 = Math.max(x1, line.xs[i]);
        z0 = Math.min(z0, line.zs[i]); z1 = Math.max(z1, line.zs[i]);
      });
      const pad = BACK_M + 20;
      const a = toLL(x0 - pad, z1 + pad);
      const b = toLL(x1 + pad, z0 - pad);
      const bb = `${a.lat.toFixed(5)},${a.lon.toFixed(5)},${b.lat.toFixed(5)},${b.lon.toFixed(5)}`;
      const q = `[out:json][timeout:90];(way["building"](${bb});relation["building"](${bb}););out center;`;
      const json = await overpass(q);
      const list = [];
      for (const el of json.elements) {
        const c = el.center ?? el;
        if (c.lat == null) continue;
        const p = toXZ({ lat: c.lat, lon: c.lon });
        const at = project(line, p.x, p.z);
        if (!at || at.d > BACK_M) continue;
        list.push([+c.lat.toFixed(6), +c.lon.toFixed(6), el.tags?.building ?? 'yes']);
      }
      raw.towns[town.name] = { query: q, timestamp: json.osm3s?.timestamp_osm_base, buildings: list };
      console.log(`${id} ${town.name}: fetched ${json.elements.length}, kept ${list.length} within ${BACK_M} m`);
      await new Promise((r) => setTimeout(r, 2000));
    }
    fs.writeFileSync(cache, JSON.stringify(raw) + '\n');
  }
  const raw = JSON.parse(fs.readFileSync(cache, 'utf8'));
  const result = { source: 'Buildings © OpenStreetMap contributors (ODbL); raw answers in data/osm/buildings-' + id + '.json.', towns: [] };
  const taken = new Set();
  const sorted = [...towns].sort((p, q) => p.fromM - q.fromM);
  for (const town of towns) {
    const got = raw.towns[town.name];
    // Never reach into the next village: stop halfway to its configured street.
    const k = sorted.indexOf(town);
    const lo = k > 0 ? (sorted[k - 1].toM + town.fromM) / 2 : -Infinity;
    const hi = k < sorted.length - 1 ? (town.toM + sorted[k + 1].fromM) / 2 : Infinity;
    if (!got) throw new Error(`${id}: no cached buildings for ${town.name}; run with --fetch`);
    const all = [];
    for (const [lat, lon, kind] of got.buildings) {
      const key = `${lat},${lon}`;
      const p = toXZ({ lat, lon });
      const at = project(line, p.x, p.z);
      if (!at || at.d > BACK_M) continue;
      all.push({ ...at, kind, key, minor: MINOR.has(kind) });
    }
    // The real street: clusters of street-front houses, split where they stop for GAP_M,
    // keeping every cluster that reaches the configured span (or the nearest one).
    const front = all.filter((b) => b.d <= FRONT_M && b.s >= Math.max(lo, town.fromM - SEARCH_M) && b.s <= Math.min(hi, town.toM + SEARCH_M)).sort((p, q) => p.s - q.s);
    const clusters = [];
    for (const b of front) {
      const c = clusters.at(-1);
      if (c && b.s - c.s1 <= GAP_M) {
        c.s1 = b.s;
        c.n++;
      } else clusters.push({ s0: b.s, s1: b.s, n: 1 });
    }
    const big = clusters.filter((c) => c.n >= 2);
    let keep = big.filter((c) => c.s1 >= town.fromM - 50 && c.s0 <= town.toM + 50);
    if (!keep.length && big.length) {
      const mid = (town.fromM + town.toM) / 2;
      keep = [big.reduce((p, q) => (Math.abs((q.s0 + q.s1) / 2 - mid) < Math.abs((p.s0 + p.s1) / 2 - mid) ? q : p))];
    }
    let fromM = town.fromM;
    let toM = town.toM;
    if (keep.length) {
      // A bigger village frays out into lone farms: trim each end to where at least
      // TAIL_MIN street-front houses stand within the next 100 m. Hamlets keep every house.
      const street = front.filter((b) => b.s >= keep[0].s0 && b.s <= keep.at(-1).s1);
      let a = 0;
      let z = street.length - 1;
      if (street.length >= 20) {
        const within = (i, dir) => street.filter((b) => (b.s - street[i].s) * dir >= 0 && (b.s - street[i].s) * dir <= 100).length;
        while (a < z && within(a, 1) < TAIL_MIN) a++;
        while (z > a && within(z, -1) < TAIL_MIN) z--;
      }
      fromM = Math.max(0, Math.round(street[a].s - 10));
      toM = Math.round(street[z].s + 10);
    }
    const inTown = all.filter((b) => b.s >= fromM - 20 && b.s <= toM + 20 && !taken.has(b.key));
    for (const b of inTown) taken.add(b.key);
    const mid = (fromM + toM) / 2;
    const houses = inTown.filter((b) => !b.minor);
    const entry = {
      name: town.name,
      fromM,
      toM,
      configured: [town.fromM, town.toM],
      osm: { all: inTown.length, houses: houses.length, front: houses.filter((b) => b.d <= FRONT_M).length },
      // [metres from the street's middle, side] for houses on the street front, and
      // [metres from the middle, signed distance from the centre line] for the back row.
      front: houses.filter((b) => b.d <= FRONT_M).sort((p, q) => p.s - q.s).map((b) => [r1(b.s - mid), b.side]),
      back: houses.filter((b) => b.d > FRONT_M).sort((p, q) => p.s - q.s).map((b) => [r1(b.s - mid), r1(b.side * b.d)]),
    };
    result.towns.push(entry);
    console.log(
      `${id} ${town.name}: configured ${town.fromM}–${town.toM} m, real street ${fromM}–${toM} m; OSM ${entry.osm.all} buildings (${entry.osm.houses} houses, ${entry.osm.front} on the street front)`,
    );
  }
  fs.writeFileSync(out, JSON.stringify(result) + '\n');
}
