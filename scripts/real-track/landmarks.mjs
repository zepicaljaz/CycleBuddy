// Mapped landmarks beside the real roads: the Russian Chapel on Vršič, mountain huts
// and refuges next to the road, wayside shrines and crosses at the verge.
//   node scripts/real-track/landmarks.mjs            (uses the cached Overpass answers)
//   node scripts/real-track/landmarks.mjs --fetch    (asks Overpass again)
// In:  src/routes/real/tracks/<id>.json (road line + origin), Overpass answers cached in
//      data/osm/landmarks-<id>.json (© OpenStreetMap contributors, ODbL).
// Out: src/routes/real/landmarks.json, one list per track: name, kind, OSM id, lat/lon,
//      and x/z in the road's own frame (same projection as build.mjs), plus the
//      distance to the road centre line. The game places from that file; it never
//      fetches anything.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const R = 6371000;
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

// Public Overpass instances; the first that answers wins. A generic User-Agent,
// nothing personal in the request.
const ENDPOINTS = [
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

/**
 * Which roads, and how far from the centre line each kind may be. Huts must
 * actually stand next to the road (150 m); a shrine or cross is a verge object
 * (30 m); the Russian Chapel is one named landmark that stands up in the forest
 * above the road, so it gets a wider allowance.
 */
// Huts get 180 m rather than a strict 150: Tičarjev dom (Vršič), Refuge du Galibier and
// Rifugio Garibaldi (Stelvio) are the huts at the top and stand 158-170 m from the centre line.
const TRACKS = ['vrsic-kranjska-gora', 'galibier-valloire', 'stelvio-prato', 'giau-selva'];
const MAX_DIST = { chapel: 250, hut: 180, shrine: 30 };

function classify(tags) {
  const name = tags.name ?? '';
  if (/Ruska kapelica/i.test(name)) return 'chapel';
  if (tags.historic === 'wayside_shrine' || tags.historic === 'wayside_cross') return 'shrine';
  // Unnamed huts are mostly imported sheds and shelters (fixme on Giau); only named ones.
  if ((tags.tourism === 'alpine_hut' || tags.tourism === 'wilderness_hut') && name) return 'hut';
  // Kiosks and gift shops are mapped as building=hut too; they are not mountain huts.
  if (tags.shop) return null;
  // A restaurant counts as a hut only when it is named like a mountain hut (dom, koča,
  // rifugio, refuge, Hütte...): a pizzeria in a village is not a refuge.
  if (tags.amenity === 'restaurant' && /(^|\s)(dom|koča|koca|rifugio|refuge|hütte|baita|chalet)(\s|$)/i.test(name)) return 'hut';
  return null;
}

async function overpass(q) {
  let last;
  for (const url of ENDPOINTS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'cyclebuddy-real-track/1.0' },
          body: 'data=' + encodeURIComponent(q),
          signal: AbortSignal.timeout(90000),
        });
        if (!res.ok) throw new Error(`${url} HTTP ${res.status}`);
        return await res.json();
      } catch (e) {
        last = e;
        console.warn(String(e));
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }
  throw last;
}

/**
 * Minimum-area rectangle around an outline (one of its edges is always a side):
 * length along the long side, width across, and the long side's angle in the x/z
 * plane (radians from +x toward +z), all rounded.
 */
function outline(pts) {
  let best = null;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const ang = Math.atan2(b.z - a.z, b.x - a.x);
    const c = Math.cos(ang);
    const sn = Math.sin(ang);
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const p of pts) {
      const u = p.x * c + p.z * sn;
      const v = -p.x * sn + p.z * c;
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
    }
    const area = (u1 - u0) * (v1 - v0);
    if (!best || area < best.area) best = { area, l: u1 - u0, w: v1 - v0, ang };
  }
  let { l, w, ang } = best;
  if (w > l) {
    [l, w] = [w, l];
    ang += Math.PI / 2;
  }
  ang = Math.atan2(Math.sin(ang * 2), Math.cos(ang * 2)) / 2; // a rectangle's axis is the same either way round
  return { length: Math.round(l * 10) / 10, width: Math.round(w * 10) / 10, angle: Math.round(ang * 1000) / 1000 };
}

const fetchAgain = process.argv.includes('--fetch');
const out = { source: 'Landmarks © OpenStreetMap contributors (ODbL), via Overpass; raw answers in data/osm/landmarks-<id>.json.' };

for (const id of TRACKS) {
  const track = JSON.parse(fs.readFileSync(path.join(ROOT, `src/routes/real/tracks/${id}.json`), 'utf8'));
  const { lat: lat0, lon: lon0 } = track.origin;
  const toXZ = (lat, lon) => ({ x: rad(lon - lon0) * Math.cos(rad(lat0)) * R, z: -rad(lat - lat0) * R });
  const toLL = (x, z) => ({ lat: lat0 - deg(z / R), lon: lon0 + deg(x / (R * Math.cos(rad(lat0)))) });
  const cache = path.join(ROOT, `data/osm/landmarks-${id}.json`);
  if (fetchAgain || !fs.existsSync(cache)) {
    const pad = 250;
    const a = toLL(Math.min(...track.x) - pad, Math.max(...track.z) + pad);
    const b = toLL(Math.max(...track.x) + pad, Math.min(...track.z) - pad);
    const bb = `${a.lat.toFixed(5)},${a.lon.toFixed(5)},${b.lat.toFixed(5)},${b.lon.toFixed(5)}`;
    const q = `[out:json][timeout:60];(nwr["tourism"~"^(alpine_hut|wilderness_hut)$"](${bb});nwr["building"="hut"]["name"](${bb});nwr["amenity"="restaurant"](${bb});nwr["historic"~"^(wayside_shrine|wayside_cross)$"](${bb});nwr["name"~"Ruska kapelica"](${bb}););out tags geom;`;
    const json = await overpass(q);
    fs.writeFileSync(cache, JSON.stringify({ query: q, osm3s: json.osm3s, elements: json.elements }, null, 1) + '\n');
    console.log(`${id}: fetched ${json.elements.length} elements`);
  }
  const raw = JSON.parse(fs.readFileSync(cache, 'utf8'));
  const list = [];
  for (const el of raw.elements) {
    const tags = el.tags ?? {};
    const kind = classify(tags);
    if (!kind) continue;
    // Ways: centre of the outline (mean of the distinct points), and the outline's
    // long axis and size so the model can be turned and sized like the real building.
    let lat = el.lat;
    let lon = el.lon;
    let shape = null;
    if (el.type === 'way' && el.geometry?.length) {
      const pts = el.geometry.slice(0, -1).map((g) => toXZ(g.lat, g.lon));
      const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
      const cz = pts.reduce((a, p) => a + p.z, 0) / pts.length;
      const back = toLL(cx, cz);
      lat = back.lat;
      lon = back.lon;
      shape = outline(pts);
    }
    if (lat == null) continue;
    const p = toXZ(lat, lon);
    let d = Infinity;
    let at = 0;
    for (let i = 0; i < track.x.length; i++) {
      const dd = Math.hypot(track.x[i] - p.x, track.z[i] - p.z);
      if (dd < d) {
        d = dd;
        at = i;
      }
    }
    const keep = d <= MAX_DIST[kind];
    console.log(`${id}: ${keep ? 'keep' : 'skip'} ${kind} ${el.type}/${el.id} ${tags.name ?? tags.historic ?? ''} ${d.toFixed(0)} m from the road`);
    if (!keep) continue;
    list.push({
      kind,
      name: tags.name ?? (tags.historic === 'wayside_cross' ? 'Wayside cross' : 'Wayside shrine'),
      osm: `${el.type}/${el.id}`,
      ...(tags.historic === 'wayside_cross' ? { cross: true } : {}),
      lat: +lat.toFixed(7),
      lon: +lon.toFixed(7),
      ...(shape ? shape : {}),
      x: Math.round(p.x * 10) / 10,
      z: Math.round(p.z * 10) / 10,
      road: Math.round(d * 10) / 10,
      i: at,
    });
  }
  list.sort((a, b) => a.i - b.i);
  // The same grotto is mapped twice on the Galibier (2.6 m apart): keep one per 15 m.
  for (let k = list.length - 1; k > 0; k--) {
    if (list.slice(0, k).some((o) => o.kind === list[k].kind && Math.hypot(o.x - list[k].x, o.z - list[k].z) < 15)) list.splice(k, 1);
  }
  out[id] = list.map(({ i, ...rest }) => rest);
}

fs.writeFileSync(path.join(ROOT, 'src/routes/real/landmarks.json'), JSON.stringify(out, null, 1) + '\n');
console.log('wrote src/routes/real/landmarks.json');
