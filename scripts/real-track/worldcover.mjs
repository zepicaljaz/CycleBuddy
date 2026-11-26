// Land cover from ESA WorldCover 10 m 2021 v200 (CC BY 4.0), read straight from
// the open Cloud-Optimised GeoTIFFs on AWS. Only the 1024 px tiles that cover the
// box are fetched (HTTP range requests) and cached in data/dem-cache/worldcover/.
// See ATTRIBUTION.md.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const BASE = 'https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map';

/** WorldCover class codes. */
export const WC = { tree: 10, shrub: 20, grass: 30, crop: 40, built: 50, bare: 60, snow: 70, water: 80, wetland: 90, moss: 100 };

function tileName(lat, lon) {
  const la = Math.floor(lat / 3) * 3;
  const lo = Math.floor(lon / 3) * 3;
  const ns = (la >= 0 ? 'N' : 'S') + String(Math.abs(la)).padStart(2, '0');
  const ew = (lo >= 0 ? 'E' : 'W') + String(Math.abs(lo)).padStart(3, '0');
  return `ESA_WorldCover_10m_2021_v200_${ns}${ew}_Map.tif`;
}

async function range(url, from, to) {
  const res = await fetch(url, { headers: { Range: `bytes=${from}-${to}` } });
  if (res.status !== 206 && res.status !== 200) throw new Error(`WorldCover ${res.status} for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Reads the first IFD of a little-endian tiled GeoTIFF: size, tiles, geo origin. */
async function readHeader(url, cache) {
  const file = path.join(cache, path.basename(url) + '.head');
  let head;
  if (fs.existsSync(file)) head = fs.readFileSync(file);
  else {
    head = await range(url, 0, 65535);
    fs.writeFileSync(file, head);
  }
  if (head.toString('ascii', 0, 2) !== 'II') throw new Error('WorldCover: expected little-endian TIFF');
  const ifd = head.readUInt32LE(4);
  const n = head.readUInt16LE(ifd);
  const tags = new Map();
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12;
    tags.set(head.readUInt16LE(e), { type: head.readUInt16LE(e + 2), count: head.readUInt32LE(e + 4), at: e + 8 });
  }
  const scalar = (t) => {
    const v = tags.get(t);
    return v.type === 3 ? head.readUInt16LE(v.at) : head.readUInt32LE(v.at);
  };
  const longs = (t) => {
    const v = tags.get(t);
    const off = head.readUInt32LE(v.at);
    return Array.from({ length: v.count }, (_, i) => head.readUInt32LE(off + i * 4));
  };
  const doubles = (t) => {
    const v = tags.get(t);
    const off = head.readUInt32LE(v.at);
    return Array.from({ length: v.count }, (_, i) => head.readDoubleLE(off + i * 8));
  };
  if (scalar(259) !== 8 || scalar(258) !== 8 || scalar(277) !== 1) throw new Error('WorldCover: expected 8-bit deflate, one band');
  const predictor = tags.has(317) ? scalar(317) : 1;
  if (predictor !== 1) throw new Error('WorldCover: predictor not supported');
  const scale = doubles(33550);
  const tie = doubles(33922);
  return {
    w: scalar(256),
    h: scalar(257),
    tw: scalar(322),
    th: scalar(323),
    offsets: longs(324),
    counts: longs(325),
    lon0: tie[3],
    lat0: tie[4],
    dLon: scale[0],
    dLat: scale[1],
  };
}

/**
 * Loads every tile covering the box and returns a nearest-pixel class sampler in
 * lat/lon. Outside the loaded tiles it returns 0 (no data).
 */
export async function worldCoverSampler({ south, north, west, east }, cacheDir) {
  const cache = path.join(cacheDir, 'worldcover');
  fs.mkdirSync(cache, { recursive: true });
  const files = new Map();
  for (const lat of [south, north]) for (const lon of [west, east]) files.set(tileName(lat, lon), null);
  for (const name of files.keys()) {
    const url = `${BASE}/${name}`;
    const h = await readHeader(url, cache);
    const across = Math.ceil(h.w / h.tw);
    const c0 = Math.max(0, Math.floor((west - h.lon0) / h.dLon / h.tw));
    const c1 = Math.min(across - 1, Math.floor((east - h.lon0) / h.dLon / h.tw));
    const r0 = Math.max(0, Math.floor((h.lat0 - north) / h.dLat / h.th));
    const r1 = Math.min(Math.ceil(h.h / h.th) - 1, Math.floor((h.lat0 - south) / h.dLat / h.th));
    const tiles = new Map();
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const k = r * across + c;
        const file = path.join(cache, `${name}.${k}.raw`);
        let raw;
        if (fs.existsSync(file)) raw = fs.readFileSync(file);
        else {
          const z = await range(url, h.offsets[k], h.offsets[k] + h.counts[k] - 1);
          raw = zlib.inflateSync(z);
          fs.writeFileSync(file, raw);
        }
        tiles.set(k, raw);
      }
    }
    files.set(name, { h, across, tiles });
    console.log(`worldcover ${name}: ${tiles.size} tiles`);
  }
  return (lat, lon) => {
    const f = files.get(tileName(lat, lon));
    if (!f) return 0;
    const { h, across, tiles } = f;
    const px = Math.floor((lon - h.lon0) / h.dLon);
    const py = Math.floor((h.lat0 - lat) / h.dLat);
    const t = tiles.get(Math.floor(py / h.th) * across + Math.floor(px / h.tw));
    if (!t) return 0;
    return t[(py % h.th) * h.tw + (px % h.tw)];
  };
}
