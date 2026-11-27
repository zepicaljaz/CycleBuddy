// Real land cover for a real road: one class byte per terrain grid point, so the game
// can colour and place rock, scree, forest, meadow, snow and water where they really are
// instead of guessing from slope.
//   node scripts/real-track/cover.mjs stelvio-prato
//   node scripts/real-track/cover.mjs --all
// build.mjs calls buildCover() at the end, so a newly built road gets its cover too.
//
// Reads  src/routes/real/tracks/<id>.json (origin + terrain grids) and
//        src/assets/terrain/<id>.bin (heights, for slope and "downhill").
// Writes src/assets/terrain/<id>.cover.bin and adds terrain.cover to the track JSON.
//
// Sources (see ATTRIBUTION.md and docs/REAL_ROADS.md "Land cover"):
//   - OpenStreetMap via Overpass, one query per road, raw answer cached in data/cover-cache/osm/.
//   - ESA WorldCover 10 m 2021 v200, read straight from the public COG tiles with HTTP
//     range requests (only the window around the road), cached in data/cover-cache/worldcover/.
// data/cover-cache/ is gitignored: never commit it.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { projection } from './geo.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TRACKS = path.join(ROOT, 'src/routes/real/tracks');
const TERRAIN = path.join(ROOT, 'src/assets/terrain');
const CACHE = path.join(ROOT, 'data/cover-cache');

/** Class bytes. The runtime codes against these numbers: never renumber. */
export const COVER = {
  unknown: 0,
  forest: 1,
  meadow: 2,
  scrub: 3,
  rock: 4,
  scree: 5,
  cliff: 6,
  glacier: 7,
  water: 8,
  built: 9,
};
export const COVER_NAMES = ['unknown', 'forest', 'meadow', 'scrub', 'rock', 'scree', 'cliff', 'glacier', 'water', 'built'];

// ---------------------------------------------------------------- OpenStreetMap

const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];
// Generic client name: no personal details go to outside services.
const UA = 'CycleBuddy-real-track/1.0 (land cover build script)';

const NATURAL = 'wood|scrub|heath|grassland|bare_rock|scree|shingle|cliff|glacier|water|fell';
const LANDUSE = 'forest|meadow|grass|farmland|residential|farmyard|industrial|commercial|retail';

/**
 * OSM tags → class and tier. Tier 1 = specific ground (always wins), tier 2 = vegetation
 * (wins over WorldCover). Cliffs are lines and handled separately.
 */
function osmClass(tags) {
  const n = tags.natural;
  const l = tags.landuse;
  if (n === 'glacier') return { cls: COVER.glacier, tier: 1 };
  if (n === 'water' || tags.waterway === 'riverbank' || (tags.water && !n && !l)) return { cls: COVER.water, tier: 1 };
  if (n === 'bare_rock') return { cls: COVER.rock, tier: 1 };
  if (n === 'scree' || n === 'shingle') return { cls: COVER.scree, tier: 1 };
  if (['residential', 'farmyard', 'industrial', 'commercial', 'retail'].includes(l)) return { cls: COVER.built, tier: 1 };
  if (n === 'wood' || l === 'forest') return { cls: COVER.forest, tier: 2 };
  if (n === 'scrub' || n === 'heath') return { cls: COVER.scrub, tier: 2 };
  // fell: open ground above the treeline with low plants. farmland: cut fields in the
  // valleys, which read as grass from the saddle (WorldCover's cropland maps to meadow too).
  if (n === 'grassland' || n === 'fell' || l === 'meadow' || l === 'grass' || l === 'farmland') return { cls: COVER.meadow, tier: 2 };
  return null;
}

export async function overpass(id, bbox, tries = 4, endpoints = OVERPASS) {
  const file = path.join(CACHE, 'osm', `${id}.json`);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const b = `${bbox.south.toFixed(5)},${bbox.west.toFixed(5)},${bbox.north.toFixed(5)},${bbox.east.toFixed(5)}`;
  // One query per road. Relations matter: most big forests are multipolygons.
  const q = `[out:json][timeout:300][maxsize:1073741824];
(
  way["natural"~"^(${NATURAL})$"](${b});
  relation["type"="multipolygon"]["natural"~"^(${NATURAL})$"](${b});
  way["landuse"~"^(${LANDUSE})$"](${b});
  relation["type"="multipolygon"]["landuse"~"^(${LANDUSE})$"](${b});
  way["waterway"="riverbank"](${b});
  relation["type"="multipolygon"]["waterway"="riverbank"](${b});
  way["water"](${b});
  relation["type"="multipolygon"]["water"](${b});
);
out geom;`;
  let wait = 20;
  for (let attempt = 0; attempt < tries; attempt++) {
    const url = endpoints[attempt % endpoints.length];
    try {
      console.log(`  overpass ${new URL(url).host} (try ${attempt + 1})…`);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(q),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 120)}`);
      const json = JSON.parse(text);
      if (json.remark && /error|timed out|runtime/i.test(json.remark)) throw new Error(json.remark);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text);
      return json;
    } catch (e) {
      console.log(`  overpass failed: ${String(e.message).slice(0, 160)}; waiting ${wait} s`);
      await new Promise((r) => setTimeout(r, wait * 1000));
      wait = Math.min(wait * 2, 120);
    }
  }
  throw new Error('overpass unavailable');
}

/** Polygons (with their segments in game metres) and cliff lines from the Overpass answer. */
function osmShapes(osm, toXZ) {
  const polys = [];
  const cliffs = [];
  const proj = (geom) => geom.map((p) => toXZ(p));
  let broken = 0, corine = 0;
  for (const el of osm.elements ?? []) {
    const tags = el.tags ?? {};
    if (el.type === 'way' && tags.natural === 'cliff' && el.geometry?.length >= 2) {
      cliffs.push(proj(el.geometry));
      continue;
    }
    // CORINE Land Cover imports (France, Spain): 25 ha blobs traced from 2006 satellite
    // classes. WorldCover's 10 m pixels are sharper and newer, so let it fill those areas.
    // build.mjs drops them from the Angliru's cover for the same reason.
    if (/CORINE/i.test(String(tags.source ?? ''))) { corine++; continue; }
    const c = osmClass(tags);
    if (!c) continue;
    let rings = [];
    if (el.type === 'way') {
      const g = el.geometry;
      if (!g || g.length < 4) continue;
      // An open way with an area tag is a mapping error; skip it rather than guess.
      if (g[0].lat !== g.at(-1).lat || g[0].lon !== g.at(-1).lon) continue;
      rings = [proj(g)];
    } else if (el.type === 'relation') {
      const parts = (el.members ?? []).filter((m) => m.type === 'way' && m.geometry?.length >= 2 && (m.role === 'outer' || m.role === 'inner' || m.role === ''));
      if (!parts.length) continue;
      // Filled by even-odd over ALL member segments, so outer and inner ways never need
      // joining into rings. That only works when every ring is closed: each end point
      // must be shared by an even number of way ends. Relations that fail are skipped.
      const ends = new Map();
      const k = (p) => `${p.lat},${p.lon}`;
      for (const m of parts) for (const p of [m.geometry[0], m.geometry.at(-1)]) ends.set(k(p), (ends.get(k(p)) ?? 0) + 1);
      if ([...ends.values()].some((v) => v % 2)) { broken++; continue; }
      rings = parts.map((m) => proj(m.geometry.filter(Boolean)));
    }
    polys.push({ ...c, rings });
  }
  if (broken) console.log(`  skipped ${broken} multipolygons with open rings`);
  if (corine) console.log(`  left out ${corine} CORINE-imported areas`);
  return { polys, cliffs };
}

/** Cell indices whose grid point lies inside the polygon (even-odd, scanline). */
function rasterPoly(rings, g) {
  const rows = new Map();
  for (const ring of rings) {
    for (let s = 1; s < ring.length; s++) {
      const a = ring[s - 1], b = ring[s];
      if (a.z === b.z) continue;
      const lo = Math.min(a.z, b.z), hi = Math.max(a.z, b.z);
      // Rows whose z is in [lo, hi): half-open so a vertex exactly on a row counts once.
      const j0 = Math.max(0, Math.ceil((lo - g.z0) / g.cell));
      const j1 = Math.min(g.h - 1, Math.ceil((hi - g.z0) / g.cell) - 1);
      for (let j = j0; j <= j1; j++) {
        const z = g.z0 + j * g.cell;
        const x = a.x + ((z - a.z) / (b.z - a.z)) * (b.x - a.x);
        if (!rows.has(j)) rows.set(j, []);
        rows.get(j).push(x);
      }
    }
  }
  const cells = [];
  for (const [j, xs] of rows) {
    xs.sort((p, q) => p - q);
    for (let t = 0; t + 1 < xs.length; t += 2) {
      const i0 = Math.max(0, Math.ceil((xs[t] - g.x0) / g.cell));
      const i1 = Math.min(g.w - 1, Math.ceil((xs[t + 1] - g.x0) / g.cell) - 1);
      for (let i = i0; i <= i1; i++) cells.push(j * g.w + i);
    }
  }
  return cells;
}

// ---------------------------------------------------------------- ESA WorldCover

const WC_RES = 12000; // pixels per degree (10 m product: 1/12000° pixels, 3°×3° tiles)
const WC_URL = (tile) => `https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_${tile}_Map.tif`;
const tileName = (lat, lon) =>
  `${lat >= 0 ? 'N' : 'S'}${String(Math.abs(lat)).padStart(2, '0')}${lon >= 0 ? 'E' : 'W'}${String(Math.abs(lon)).padStart(3, '0')}`;
// WorldCover 60 = "bare / sparse vegetation". It is resolved per cell from the slope (see resolveBare).
const BARE = 60;
const SNOW = 70;
// WorldCover 70 is "snow and ice" seen over 2021, so it also catches snow that lay late
// into the summer. Glaciers in these ranges reach down to ~2,500 m at most (Ortles,
// Marmolada); below that it is old snow on stones, and is treated as bare ground.
// (Stelvio: ~11,000 near-grid points of "snow" between 1,400 and 2,500 m without this.)
const GLACIER_BELOW = 2500;
const WC_MAP = { 10: COVER.forest, 20: COVER.scrub, 30: COVER.meadow, 40: COVER.meadow, 50: COVER.built, 70: COVER.glacier, 80: COVER.water, 90: COVER.meadow, 95: COVER.forest, 100: COVER.meadow };

/** The WorldCover window around the road, stitched from as many tiles as it touches. */
export async function worldCover(id, bbox) {
  const file = path.join(CACHE, 'worldcover', `${id}.json`);
  const gx0 = Math.floor((bbox.west + 180) * WC_RES), gx1 = Math.ceil((bbox.east + 180) * WC_RES);
  const gy0 = Math.floor((90 - bbox.north) * WC_RES), gy1 = Math.ceil((90 - bbox.south) * WC_RES);
  const W = gx1 - gx0, H = gy1 - gy0;
  const raw = file.replace(/\.json$/, '.bin.gz');
  if (fs.existsSync(file) && fs.existsSync(raw)) {
    const meta = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (meta.gx0 === gx0 && meta.gy0 === gy0 && meta.W === W && meta.H === H) {
      return { gx0, gy0, W, H, data: new Uint8Array(zlib.gunzipSync(fs.readFileSync(raw))) };
    }
  }
  const { fromUrl } = await import('geotiff');
  const data = new Uint8Array(W * H);
  for (let la = Math.floor(bbox.south / 3) * 3; la < bbox.north; la += 3) {
    for (let lo = Math.floor(bbox.west / 3) * 3; lo < bbox.east; lo += 3) {
      const tile = tileName(la, lo);
      // S3 sometimes drops one of the many range requests; retry the whole window.
      for (let attempt = 1; ; attempt++) {
        try {
          console.log(`  worldcover ${tile} (range read)…`);
          const tiff = await fromUrl(WC_URL(tile));
          const img = await tiff.getImage();
          const [ox, oy] = img.getOrigin();
          const [rx] = img.getResolution();
          if (Math.abs(rx * WC_RES - 1) > 1e-6) throw new Error(`${tile}: unexpected resolution ${rx}`);
          const tx = Math.round((ox + 180) * WC_RES), ty = Math.round((90 - oy) * WC_RES);
          const ax = Math.max(gx0, tx), bx = Math.min(gx1, tx + img.getWidth());
          const ay = Math.max(gy0, ty), by = Math.min(gy1, ty + img.getHeight());
          if (ax < bx && ay < by) {
            const [r] = await img.readRasters({ window: [ax - tx, ay - ty, bx - tx, by - ty], samples: [0] });
            const rw = bx - ax;
            for (let y = ay; y < by; y++) data.set(r.subarray((y - ay) * rw, (y - ay + 1) * rw), (y - gy0) * W + (ax - gx0));
          }
          break;
        } catch (e) {
          if (attempt >= 4) throw e;
          console.log(`  worldcover ${tile} failed (${e.message}); retrying`);
          await new Promise((r) => setTimeout(r, 5000 * attempt));
        }
      }
    }
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(raw, zlib.gzipSync(data, { level: 6 }));
  fs.writeFileSync(file, JSON.stringify({ gx0, gy0, W, H }));
  return { gx0, gy0, W, H, data };
}

/**
 * Majority vote of the WorldCover pixels inside the cell around each grid point.
 * Sub-samples spaced under the 10 m pixel stand in for "every pixel in the cell"
 * (3×3 per 25 m cell, 10×10 per 100 m cell). Returns raw WorldCover codes.
 */
function wcGrid(wc, g, toLL) {
  const out = new Uint8Array(g.w * g.h);
  const n = Math.max(3, Math.round(g.cell / 10));
  const counts = new Uint16Array(256);
  for (let j = 0; j < g.h; j++) {
    for (let i = 0; i < g.w; i++) {
      counts.fill(0);
      let best = 0, bestN = 0;
      for (let a = 0; a < n; a++) {
        for (let b = 0; b < n; b++) {
          const x = g.x0 + i * g.cell + ((a + 0.5) / n - 0.5) * g.cell;
          const z = g.z0 + j * g.cell + ((b + 0.5) / n - 0.5) * g.cell;
          const { lat, lon } = toLL(x, z);
          const px = Math.floor((lon + 180) * WC_RES) - wc.gx0, py = Math.floor((90 - lat) * WC_RES) - wc.gy0;
          if (px < 0 || py < 0 || px >= wc.W || py >= wc.H) continue;
          const v = wc.data[py * wc.W + px];
          if (!v) continue; // 0 = no data
          if (++counts[v] > bestN) { bestN = counts[v]; best = v; }
        }
      }
      out[j * g.w + i] = best;
    }
  }
  return out;
}

// ---------------------------------------------------------------- heights

function readHeights(track) {
  const raw = fs.readFileSync(path.join(TERRAIN, track.terrain.file));
  const u16 = new Uint16Array(raw.buffer, raw.byteOffset, raw.length / 2);
  let off = 0;
  return track.terrain.grids.map((g) => {
    const n = g.w * g.h;
    const data = Float32Array.from(u16.subarray(off, off + n), (v) => v / 10);
    off += n;
    return { ...g, data };
  });
}

/** Height gradient (metres per metre) at a grid point, central differences. */
function gradient(g, i, j) {
  const at = (a, b) => g.data[Math.min(g.h - 1, Math.max(0, b)) * g.w + Math.min(g.w - 1, Math.max(0, a))];
  const dx = (at(i + 1, j) - at(i - 1, j)) / ((Math.min(g.w - 1, i + 1) - Math.max(0, i - 1)) * g.cell);
  const dz = (at(i, j + 1) - at(i, j - 1)) / ((Math.min(g.h - 1, j + 1) - Math.max(0, j - 1)) * g.cell);
  return { dx, dz };
}

// WorldCover "bare / sparse vegetation" covers both solid rock and loose ground. On the
// 25–100 m grid the slope is the best tell we have: faces steeper than ~35° can't hold
// loose stones (scree rests at 30–35°), so they are rock; anything gentler is scree /
// gravel / sparse alpine ground. We don't use the treeline: above it both kinds are common
// (Ventoux's summit is a gentle stone field, the Stelvio's ridges are steep rock).
const ROCK_SLOPE = Math.tan((35 * Math.PI) / 180);
function resolveBare(g, i, j) {
  const { dx, dz } = gradient(g, i, j);
  return Math.hypot(dx, dz) > ROCK_SLOPE ? COVER.rock : COVER.scree;
}

// ---------------------------------------------------------------- one road

function trackBox(track, toLL, grids = track.terrain.grids, margin = 300) {
  // WorldCover: the biggest grid (the far one) plus 300 m, so edge cells have all their pixels.
  let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity;
  for (const g of grids) {
    for (const [x, z] of [[g.x0 - margin, g.z0 - margin], [g.x0 + (g.w - 1) * g.cell + margin, g.z0 + (g.h - 1) * g.cell + margin]]) {
      const p = toLL(x, z);
      west = Math.min(west, p.lon); east = Math.max(east, p.lon);
      south = Math.min(south, p.lat); north = Math.max(north, p.lat);
    }
  }
  return { west, east, south, north };
}

export function coverStats(classes) {
  const n = new Array(10).fill(0);
  for (const v of classes) n[v]++;
  return n.map((c) => (100 * c) / classes.length);
}

/**
 * OSM is asked for the near grid plus 2 km, not the whole 30–40 km far grid: that query
 * is 7–10× lighter, which is the difference between an answer and a 504 on the public
 * Overpass servers. Polygons that reach into the box come back whole, so the far grid
 * still gets OSM wherever those polygons go; past them it is WorldCover alone.
 */
const OSM_MARGIN = 2000;
export function osmBox(track) {
  const { toLL } = projection(track.origin.lat, track.origin.lon);
  return trackBox(track, toLL, [track.terrain.grids[0]], OSM_MARGIN);
}

/**
 * Builds src/assets/terrain/<id>.cover.bin and adds terrain.cover to the track.
 * osm: false skips OpenStreetMap (WorldCover only), for when Overpass is down.
 */
export async function buildCover(id, { osm: useOsm = true, tries = 4 } = {}) {
  const jsonFile = path.join(TRACKS, `${id}.json`);
  const track = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
  if (!track.terrain?.grids?.length) throw new Error(`${id}: no terrain grids`);
  // The origin in the JSON is what the game uses to place everything, so the cover is
  // projected from it too (it is build.mjs's lat0/lon0 rounded to 1 cm).
  const { toXZ, toLL } = projection(track.origin.lat, track.origin.lon);
  const bbox = trackBox(track, toLL);
  console.log(`${id}: box ${bbox.south.toFixed(3)}–${bbox.north.toFixed(3)} N, ${bbox.west.toFixed(3)}–${bbox.east.toFixed(3)} E`);
  const heights = readHeights(track);

  const sources = [];
  let shapes = { polys: [], cliffs: [] };
  try {
    if (!useOsm) throw new Error('skipped (--no-osm)');
    const osm = await overpass(id, osmBox(track), tries);
    shapes = osmShapes(osm, toXZ);
    sources.push('OpenStreetMap');
    console.log(`  osm: ${shapes.polys.length} areas, ${shapes.cliffs.length} cliff lines`);
  } catch (e) {
    console.log(`  !! OpenStreetMap failed (${e.message}); WorldCover only for ${id}`);
  }
  const wc = await worldCover(id, bbox);
  sources.push('ESA WorldCover 2021 v200');

  const outGrids = [];
  for (const g of heights) {
    const N = g.w * g.h;
    // Layers, lowest priority first. Merge rule: OSM specific (tier 1, cliffs) >
    // scree below cliffs > OSM vegetation (tier 2) > WorldCover > unknown.
    const tier1 = new Uint8Array(N), tier2 = new Uint8Array(N), cliff = new Uint8Array(N), below = new Uint8Array(N);
    // Within a tier, big areas are painted first and smaller ones on top: the smaller
    // polygon is the more specific mapping (a scree field inside a bare_rock area, a
    // clearing of meadow inside a forest).
    const painted = shapes.polys.map((p) => ({ ...p, cells: rasterPoly(p.rings, g) })).filter((p) => p.cells.length);
    painted.sort((a, b) => b.cells.length - a.cells.length);
    for (const p of painted) {
      const layer = p.tier === 1 ? tier1 : tier2;
      for (const c of p.cells) layer[c] = p.cls;
    }
    // Cliffs: every cell the line passes through, then the next cells downhill are the
    // scree that falls off it (2 cells = 50 m on the near grid, 1 cell = 100 m far).
    const downN = g.cell <= 25 ? 2 : 1;
    for (const line of shapes.cliffs) {
      for (let s = 1; s < line.length; s++) {
        const a = line[s - 1], b = line[s];
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        const steps = Math.max(1, Math.ceil(len / (g.cell / 3)));
        for (let t = 0; t <= steps; t++) {
          const x = a.x + ((b.x - a.x) * t) / steps, z = a.z + ((b.z - a.z) * t) / steps;
          const i = Math.round((x - g.x0) / g.cell), j = Math.round((z - g.z0) / g.cell);
          if (i < 0 || j < 0 || i >= g.w || j >= g.h) continue;
          cliff[j * g.w + i] = 1;
          // Downhill from the heights. Where the DEM is too smooth to tell (a short
          // cliff inside a 30 m pixel), use OSM's rule: the low side is right of the way.
          let { dx, dz } = gradient(g, i, j);
          let m = Math.hypot(dx, dz);
          if (m < 0.1) { dx = (b.z - a.z) / len; dz = -(b.x - a.x) / len; m = 1; } // -(right of travel) → uphill
          const ux = -dx / m, uz = -dz / m;
          for (let k = 1; k <= downN; k++) {
            const ii = Math.round(i + ux * k), jj = Math.round(j + uz * k);
            if (ii < 0 || jj < 0 || ii >= g.w || jj >= g.h) continue;
            below[jj * g.w + ii] = 1;
          }
        }
      }
    }
    const wcRaw = wcGrid(wc, g, toLL);
    const out = new Uint8Array(N);
    let fromOsm = 0;
    for (let j = 0; j < g.h; j++) {
      for (let i = 0; i < g.w; i++) {
        const c = j * g.w + i;
        let v;
        if (cliff[c]) v = COVER.cliff;
        else if (tier1[c]) v = tier1[c];
        else if (below[c]) v = COVER.scree;
        else if (tier2[c]) v = tier2[c];
        if (v) fromOsm++;
        else if (wcRaw[c] === BARE || (wcRaw[c] === SNOW && g.data[c] < GLACIER_BELOW)) v = resolveBare(g, i, j);
        else v = WC_MAP[wcRaw[c]] ?? COVER.unknown;
        out[c] = v;
      }
    }
    const pct = coverStats(out);
    console.log(
      `  ${g.cell} m grid ${g.w}×${g.h}: ` + pct.map((p, k) => (p >= 0.05 ? `${COVER_NAMES[k]} ${p.toFixed(1)}%` : null)).filter(Boolean).join(', ') +
        ` (OSM decides ${((100 * fromOsm) / N).toFixed(0)}%)`,
    );
    outGrids.push(out);
  }

  const bin = Buffer.concat(outGrids.map((a) => Buffer.from(a.buffer, a.byteOffset, a.length)));
  const file = `${id}.cover.bin`;
  fs.writeFileSync(path.join(TERRAIN, file), bin);
  // Only terrain.cover is added. The track files are one-line JSON written by
  // JSON.stringify, and parse → stringify gives back the same text, so nothing else moves.
  track.terrain.cover = {
    file,
    grids: track.terrain.grids.map(({ x0, z0, cell, w, h }) => ({ x0, z0, cell, w, h })),
    sources,
  };
  fs.writeFileSync(jsonFile, JSON.stringify(track));
  console.log(`  wrote ${file} (${(bin.length / 1024).toFixed(0)} KB)`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const flags = process.argv.slice(2).filter((a) => a.startsWith('--') && a !== '--all');
  const arg = process.argv.slice(2).find((a) => !flags.includes(a));
  const ids =
    arg === '--all'
      ? fs.readdirSync(TRACKS).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''))
      : arg
        ? [arg]
        : null;
  if (!ids) throw new Error('usage: cover.mjs <track id> | --all  [--no-osm] [--fetch-osm]');
  if (flags.includes('--fetch-osm')) {
    // Only download + cache the Overpass answers, patiently (for a busy Overpass day).
    // One worker per public server, each starting on a different one, so there are never
    // more requests in flight than servers and each road is still asked one query at a time.
    const queue = ids.filter((id) => !fs.existsSync(path.join(CACHE, 'osm', `${id}.json`)));
    await Promise.all(
      OVERPASS.map(async (_, w) => {
        const order = OVERPASS.map((_, k) => OVERPASS[(w + k) % OVERPASS.length]);
        for (let id = queue.shift(); id; id = queue.shift()) {
          const track = JSON.parse(fs.readFileSync(path.join(TRACKS, `${id}.json`), 'utf8'));
          console.log(`${id} (worker ${w})`);
          await overpass(id, osmBox(track), 6, order).then(
            () => console.log(`  ok ${id}`),
            (e) => console.log(`  !! ${id}: ${e.message}`),
          );
        }
      }),
    );
  } else for (const id of ids) await buildCover(id, { osm: !flags.includes('--no-osm') });
}
