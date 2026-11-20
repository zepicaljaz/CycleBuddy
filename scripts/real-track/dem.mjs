// Elevation from the open Terrain Tiles (Terrarium PNGs on AWS Open Data).
// Sources: SRTM, EU-DEM (Copernicus) and others; see ATTRIBUTION.md.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const URL = (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;

/** Minimal PNG decoder for 8-bit RGB/RGBA, non-interlaced (what Terrarium tiles are). */
export function decodePng(buf) {
  let off = 8;
  let w = 0, h = 0, ct = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      if (data[8] !== 8 || data[12] !== 0) throw new Error('unsupported png');
      ct = data[9];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  const bpp = ct === 6 ? 4 : ct === 2 ? 3 : 0;
  if (!bpp) throw new Error('unsupported colour type ' + ct);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = out.subarray(y * stride, (y + 1) * stride);
    const prev = y ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? row[i - bpp] : 0;
      const b = prev ? prev[i] : 0;
      const c = prev && i >= bpp ? prev[i - bpp] : 0;
      let v = src[i];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c; const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      row[i] = v & 255;
    }
  }
  return { w, h, bpp, data: out };
}

const tileX = (lon, z) => ((lon + 180) / 360) * 2 ** z;
const tileY = (lat, z) => ((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * 2 ** z;

/** Loads every tile covering the box (cached on disk) and returns a bilinear sampler in lat/lon. */
export async function demSampler({ south, north, west, east }, z, cacheDir) {
  fs.mkdirSync(cacheDir, { recursive: true });
  const x0 = Math.floor(tileX(west, z)), x1 = Math.floor(tileX(east, z));
  const y0 = Math.floor(tileY(north, z)), y1 = Math.floor(tileY(south, z));
  const tiles = new Map();
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      const file = path.join(cacheDir, `${z}-${x}-${y}.png`);
      if (!fs.existsSync(file)) {
        const res = await fetch(URL(z, x, y));
        if (!res.ok) throw new Error(`tile ${z}/${x}/${y}: ${res.status}`);
        fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
      }
      const png = decodePng(fs.readFileSync(file));
      const hgt = new Float32Array(256 * 256);
      for (let i = 0; i < 256 * 256; i++) {
        const p = i * png.bpp;
        hgt[i] = png.data[p] * 256 + png.data[p + 1] + png.data[p + 2] / 256 - 32768;
      }
      tiles.set(`${x},${y}`, hgt);
    }
  }
  const px = (gx, gy) => {
    const tx = Math.floor(gx / 256), ty = Math.floor(gy / 256);
    const t = tiles.get(`${tx},${ty}`);
    if (!t) return NaN;
    return t[(gy - ty * 256) * 256 + (gx - tx * 256)];
  };
  return (lat, lon) => {
    const gx = tileX(lon, z) * 256 - 0.5, gy = tileY(lat, z) * 256 - 0.5;
    const ix = Math.floor(gx), iy = Math.floor(gy), fx = gx - ix, fy = gy - iy;
    const a = px(ix, iy), b = px(ix + 1, iy), c = px(ix, iy + 1), d = px(ix + 1, iy + 1);
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  };
}
