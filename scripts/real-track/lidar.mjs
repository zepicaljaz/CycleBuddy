// Veneto LiDAR terrain model, 5 m cells (Regione del Veneto, IODL 2.0).
// Tiles are ESRI ASCII grids of 2 x 2 km in the region's "Fuso 12":
// transverse Mercator on GRS80, central meridian 12° E, scale 0.9996,
// false easting 3,000,000 m. See docs/REAL_ROADS.md (Tre Cime) and ATTRIBUTION.md.
import fs from 'node:fs';
import path from 'node:path';

const A = 6378137;
const F = 1 / 298.257222101;
const E2 = F * (2 - F);
const EP2 = E2 / (1 - E2);
const K0 = 1;
const LON0 = 12;
const FE = 3000000;
const rad = (d) => (d * Math.PI) / 180;

function meridianArc(phi) {
  const e4 = E2 * E2, e6 = e4 * E2;
  return A * ((1 - E2 / 4 - (3 * e4) / 64 - (5 * e6) / 256) * phi
    - ((3 * E2) / 8 + (3 * e4) / 32 + (45 * e6) / 1024) * Math.sin(2 * phi)
    + ((15 * e4) / 256 + (45 * e6) / 1024) * Math.sin(4 * phi)
    - ((35 * e6) / 3072) * Math.sin(6 * phi));
}

/** Latitude/longitude (ETRS89) to Fuso 12 easting/northing in metres. */
export function toFuso12(lat, lon) {
  const phi = rad(lat);
  const l = rad(lon - LON0);
  const s = Math.sin(phi), c = Math.cos(phi), t = Math.tan(phi);
  const N = A / Math.sqrt(1 - E2 * s * s);
  const T = t * t, C = EP2 * c * c, Am = l * c;
  const M = meridianArc(phi);
  const x = K0 * N * (Am + ((1 - T + C) * Am ** 3) / 6 + ((5 - 18 * T + T * T + 72 * C - 58 * EP2) * Am ** 5) / 120);
  const y = K0 * (M + N * t * ((Am * Am) / 2 + ((5 - T + 9 * C + 4 * C * C) * Am ** 4) / 24 + ((61 - 58 * T + T * T + 600 * C - 330 * EP2) * Am ** 6) / 720));
  return { e: FE + x, n: y };
}

function readAsc(file) {
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split('\n');
  const head = {};
  let i = 0;
  for (; i < 6; i++) {
    const [k, v] = lines[i].trim().split(/\s+/);
    head[k.toLowerCase()] = Number(v);
  }
  const w = head.ncols, h = head.nrows, cell = head.cellsize;
  const nodata = head.nodata_value;
  const data = new Float32Array(w * h);
  let k = 0;
  for (; i < lines.length && k < w * h; i++) {
    for (const tok of lines[i].trim().split(/\s+/)) {
      if (!tok) continue;
      const v = Number(tok);
      data[k++] = v === nodata ? NaN : v;
    }
  }
  if (k !== w * h) throw new Error(`${file}: ${k} of ${w * h} values`);
  // Cell centres: column 0 at xllcenter, the first row is the northernmost.
  const e0 = head.xllcenter ?? head.xllcorner + cell / 2;
  const nTop = (head.yllcenter ?? head.yllcorner + cell / 2) + (h - 1) * cell;
  return { w, h, cell, e0, nTop, data };
}

/**
 * Height sampler over every .asc tile in a folder. Returns NaN outside the tiles
 * or where the survey has no data (the Veneto data stops at the regional border).
 */
export function lidarSampler(dir) {
  const tiles = fs.readdirSync(dir).filter((f) => f.endsWith('.asc')).map((f) => readAsc(path.join(dir, f)));
  if (!tiles.length) throw new Error('no LiDAR tiles in ' + dir);
  const at = (e, n) => {
    for (const t of tiles) {
      const fx = (e - t.e0) / t.cell;
      const fy = (t.nTop - n) / t.cell;
      if (fx < 0 || fy < 0 || fx > t.w - 1 || fy > t.h - 1) continue;
      const x = Math.min(t.w - 2, Math.floor(fx)), y = Math.min(t.h - 2, Math.floor(fy));
      const tx = fx - x, ty = fy - y;
      const d = t.data, W = t.w;
      const a = d[y * W + x], b = d[y * W + x + 1], c = d[(y + 1) * W + x], dd = d[(y + 1) * W + x + 1];
      const v = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + dd * tx) * ty;
      if (!Number.isNaN(v)) return v;
    }
    return NaN;
  };
  const sample = (lat, lon) => { const p = toFuso12(lat, lon); return at(p.e, p.n); };
  sample.tiles = tiles.length;
  return sample;
}
