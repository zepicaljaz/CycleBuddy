// Builds a real road for the game from OpenStreetMap + open elevation data.
//   node scripts/real-track/build.mjs vrsic
//   node scripts/real-track/build.mjs alpe
//   node scripts/real-track/build.mjs stelvio
//   node scripts/real-track/build.mjs angliru
//   node scripts/real-track/build.mjs tourmalet
//   node scripts/real-track/build.mjs ventoux
//   node scripts/real-track/build.mjs galibier
//   node scripts/real-track/build.mjs giau
//   node scripts/real-track/build.mjs krvavec
//   node scripts/real-track/build.mjs trecime
// Output: src/routes/real/tracks/<id>.json (road line, elevation, sections) and
// src/assets/terrain/<id>.bin (height grids around the road). See ATTRIBUTION.md.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { demSampler } from './dem.mjs';
import { lidarSampler } from './lidar.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const R = 6371000;
const rad = (d) => (d * Math.PI) / 180;

const CONFIGS = {
  vrsic: {
    id: 'vrsic-kranjska-gora',
    climbId: 'vrsic-kranjska-gora',
    // Road 206, plus Borovška cesta from where it leaves the valley road (ref 201).
    osm: ['data/osm/vrsic-206.json', 'data/osm/vrsic-kranjska-gora.json'],
    places: 'data/osm/vrsic-places.json',
    // West end of Borovška cesta. The path is walked from here, then cut back to leadIn.
    from: { lat: 46.4879848, lon: 13.7788728 },
    to: { lat: 46.4331118, lon: 13.7433478 },
    // The published profile starts at the Velika Pišnica bridge (Eriški most in OSM).
    climbStartWay: 'Eriški most',
    // OSM node 16521909, mountain_pass=yes, ele 1611.
    summit: { lat: 46.4347793, lon: 13.7437123 },
    startElevation: 850,
    summitElevation: 1611,
    hairpins: 'up',
    // The ride starts on the way out of Kranjska Gora, this far before Lake Jasna.
    // The streets through the town stay in the OSM file and are not part of the ride.
    leadIn: 500,
    // The published profile stays on section 1, from the bridge. The ride starts at section 0.
    climbFromSection: 0,
    // No generated town. The ride starts where the road has already left Kranjska Gora.
    towns: [],
  },
  alpe: {
    id: 'alpe-dhuez-bourg-doisans',
    climbId: 'alpe-dhuez-bourg-doisans',
    osm: 'data/osm/alpe-dhuez-d211.json',
    // Roundabout where the D 211 leaves the D 1091, north edge of Bourg-d'Oisans.
    from: { lat: 45.0593901, lon: 6.0379262 },
    // Top of Avenue du Rif Nel, where it meets the Rond-Point des Pistes.
    to: { lat: 45.0958784, lon: 6.0703245 },
    // The climb is this road from the first metre. The name is on the opening ways.
    climbStartWay: "Route de l'Alpe d'Huez",
    summit: { lat: 45.0958784, lon: 6.0703245 },
    startElevation: 728,
    summitElevation: 1840,
    // Signs count down: 21 at the foot, 1 at the top.
    hairpins: 'down',
    // Distances are metres from the valley end of the road. The resort sits on the
    // last half-kilometre, where the road eases through L'Alpe d'Huez.
    towns: [
      { name: "Bourg-d'Oisans", fromM: 0, toM: 500 },
      { name: "L'Alpe d'Huez", fromM: 14040, toM: 14570 },
    ],
  },
  stelvio: {
    id: 'stelvio-prato',
    climbId: 'stelvio-prato',
    osm: 'data/osm/stelvio-ss38.json',
    // Valley side of Prato, on the SS 38 toward Spondigna. The climb itself
    // starts further up, at climbStart.
    from: { lat: 46.6257813, lon: 10.6046756 },
    // OSM node 4353043451, the pass. The road stops here.
    to: { lat: 46.5286176, lon: 10.4532056 },
    // 25.3 km of SS 38 below the pass: the cols-cyclisme start at the edge of Prato.
    climbStart: { lat: 46.6190336, lon: 10.5965129 },
    summit: { lat: 46.5286176, lon: 10.4532056 },
    startElevation: 916,
    summitElevation: 2758,
    // The hairpins are tighter than the 7 m used on Vršič. Opening them to 7 m
    // cuts 800 m off the climb and still leaves kinks. The Gaussian pass above
    // is enough: it rounds polygon corners and keeps the length.
    minRadius: 0,
    // Signs count down: 48 at the first bend after Gomagoi, 1 at the last bend before the pass.
    hairpins: 'down',
    // Metres from the valley end. Replaced with measured distances after the first build
    // if smoothing moves them.
    // Metres from the valley end of the built road. Centres sit on the SS 38
    // where it passes each place (Prato 1,420 m, Ponte 5,830 m, Gomagoi 7,900 m, Trafoi 11,820 m).
    towns: [
      { name: 'Prato allo Stelvio', fromM: 1000, toM: 1800 },
      { name: 'Ponte di Stelvio', fromM: 5580, toM: 6080 },
      { name: 'Gomagoi', fromM: 7600, toM: 8200 },
      { name: 'Trafoi', fromM: 11450, toM: 12150 },
    ],
  },
  tourmalet: {
    id: 'tourmalet-luz',
    climbId: 'tourmalet-luz',
    osm: 'data/osm/tourmalet-d918.json',
    // Junction in Luz-Saint-Sauveur where Rue de Barèges (D 918) leaves the D 921.
    from: { lat: 42.8732265, lon: -0.0032656 },
    // D 918 endpoint on the pass. OSM mountain_pass node 261767485 (2,115 m) sits here.
    to: { lat: 42.9083884, lon: 0.145297 },
    climbStart: { lat: 42.8732265, lon: -0.0032656 },
    summit: { lat: 42.9083884, lon: 0.145297 },
    startElevation: 711,
    summitElevation: 2115,
    // The bends are not a numbered set. Signs count up from the foot, on the sharp corners only.
    hairpins: 'up',
    // Metres from the valley end. Luz is the opening street, Esterre the next village,
    // Cabadur a short row of houses, Barèges the spa street. Above that the road
    // is open pasture; Super Barèges is a ski name, not a village on the road.
    towns: [
      { name: 'Luz-Saint-Sauveur', fromM: 0, toM: 480 },
      { name: 'Esterre', fromM: 740, toM: 1060 },
      { name: 'Cabadur', fromM: 5450, toM: 6150 },
      { name: 'Barèges', fromM: 6760, toM: 7480 },
    ],
  },
  ventoux: {
    id: 'ventoux-bedoin',
    climbId: 'ventoux-bedoin',
    // D 974 from the roundabout at the edge of Bédoin to the road summit.
    // The north side, past this point, is not part of the ride.
    osm: 'data/osm/ventoux-bedoin.json',
    // Where the D 974 leaves the roundabout that separates it from the D 19.
    from: { lat: 44.1252611, lon: 5.180346 },
    // The vertex beside OpenStreetMap node 1334330072 (ele 1898), the top of the road.
    to: { lat: 44.1733027, lon: 5.2784022 },
    climbStartWay: 'Route du Mont-Ventoux',
    summit: { lat: 44.1733027, lon: 5.2784022 },
    startElevation: 314,
    summitElevation: 1903,
    // No numbered hairpin series. The sharp bends keep signs; the count is not published.
    hairpins: 'down',
    towns: [],
  },
  angliru: {
    id: 'angliru-la-vega',
    climbId: 'angliru-la-vega',
    osm: 'data/osm/angliru-la-vega.json',
    places: 'data/osm/angliru-places.json',
    // Meadows, grass and the hand-mapped woods. CORINE forest in this file is skipped.
    cover: 'data/osm/angliru-landcover.json',
    // Eastern end of the RI-2, where it leaves the valley road in La Vega.
    from: { lat: 43.2307334, lon: -5.8821195 },
    // Dead end of Carretera a L'Angliru, in the summit parking.
    to: { lat: 43.2210451, lon: -5.9420554 },
    // The published profile starts at this same junction.
    climbStart: { lat: 43.2307334, lon: -5.8821195 },
    // The tagged summit node is 12.46 km up. The published climb is 12.55 km, so the
    // profile ends this far past that node, still on the road to the parking.
    summit: { lat: 43.2250208, lon: -5.9392714 },
    startElevation: 322,
    summitElevation: 1570,
    // These bends are tighter than the 7 m used on Vršič. Opening them shortens
    // the climb and rounds the Cueña les Cabres wall. Same choice as the Stelvio.
    minRadius: 0,
    // The mapped road ends in the parking, past the 1,570 m point. Turn there.
    balloonAtEnd: true,
    hairpins: 'down',
    // The road is already out of the village within the first half kilometre.
    towns: [{ name: 'La Vega', fromM: 0, toM: 500 }],
  },
  galibier: {
    id: 'galibier-valloire',
    climbId: 'galibier-valloire',
    // D 902 from Valloire centre to the pass. This file is that chain only.
    // The tunnel is closed to bicycles and is not in it. The last kilometre
    // is the D 902 B over the top.
    osm: 'data/osm/galibier-d902.json',
    places: 'data/osm/galibier-places.json',
    // On the D 902 beside the OpenStreetMap "Valloire - centre" node.
    // 17.99 km of road below the pass; the published profile is 18.02 km.
    from: { lat: 45.1642238, lon: 6.4299563 },
    // OSM node 5541498001, mountain_pass, ele 2642. The road stops here.
    to: { lat: 45.0641384, lon: 6.407857 },
    climbStart: { lat: 45.1642238, lon: 6.4299563 },
    summit: { lat: 45.0641384, lon: 6.407857 },
    startElevation: 1406,
    summitElevation: 2642,
    // No numbered boards. The sharp bends keep signs, counting down toward the pass.
    hairpins: 'down',
    // Metres from the valley end. Valloire is the street through the second
    // roundabout. Plan Lachat and Les Granges are where the guideposts stand.
    towns: [
      { name: 'Valloire', fromM: 0, toM: 1100 },
      { name: 'Plan Lachat', fromM: 9350, toM: 9900 },
      { name: 'Les Granges du Galibier', fromM: 13400, toM: 14100 },
    ],
  },
  giau: {
    id: 'giau-selva',
    climbId: 'giau-selva',
    // SP 638 from Via IV Novembre in Selva di Cadore to the pass.
    // The north side, toward Pocol and Cortina, is not in this file.
    osm: 'data/osm/giau-sp638.json',
    places: 'data/osm/giau-places.json',
    // On Via IV Novembre, just south of the square. The timed climb starts at the junction.
    from: { lat: 46.4512076, lon: 12.036611 },
    // OSM node 141490497, mountain_pass, ele 2236. The road stops here.
    to: { lat: 46.4825196, lon: 12.053666 },
    // 30 m down Via IV Novembre from the SP 638 junction. The mapped climb from the
    // junction itself is 9.76 km (9.71 km after corner rounding). The cols-cyclisme
    // drawing is 10.12 km. These 30 m keep the ridden length inside 4% of that drawing.
    // The rest of the flat village street stays in section 0.
    climbStart: { lat: 46.4560665, lon: 12.0318092 },
    summit: { lat: 46.4825196, lon: 12.053666 },
    startElevation: 1314,
    summitElevation: 2236,
    // The upper bends are wide. Opening anything tighter than 7 m is left off so the
    // 29 tornanti keep the shape OpenStreetMap gives them. Same choice as the Stelvio.
    minRadius: 0,
    // Signs count down: 29 on the way out of Selva, 1 at the last bend before the pass.
    hairpins: 'down',
    towns: [{ name: 'Selva di Cadore', fromM: 0, toM: 680 }],
  },
  krvavec: {
    id: 'krvavec-cerklje',
    climbId: 'krvavec-cerklje',
    // Paved road from Grad to Plaža: tertiary Grad, then unclassified through
    // Ambrož pod Krvavcem, then the ski-area service road to the hotel.
    osm: 'data/osm/krvavec-grad.json',
    // OpenStreetMap hamlet Grad: the CyclingCols / Pogi timed start.
    from: { lat: 46.2701248, lon: 14.4924402 },
    // Service road vertex beside the Plaža restaurant (node 252493393).
    to: { lat: 46.3007269, lon: 14.5261189 },
    climbStart: { lat: 46.2701248, lon: 14.4924402 },
    summit: { lat: 46.3007269, lon: 14.5261189 },
    startElevation: 431,
    summitElevation: 1594,
    // Keep the mapped bends. Opening them shortens the climb past the published length.
    minRadius: 0,
    balloonAtEnd: true,
    // No published numbered series. Signs count up on the sharp bends.
    hairpins: 'up',
    // Metres from the valley end of the built road. Grad is the opening street;
    // Ambrož sits where the road passes the village around 1,085 m.
    towns: [
      { name: 'Grad', fromM: 0, toM: 400 },
      { name: 'Ambrož pod Krvavcem', fromM: 8000, toM: 9000 },
    ],
  },
  trecime: {
    id: 'tre-cime-misurina',
    climbId: 'tre-cime-misurina',
    // SP 49 (Via Monte Piana) from the south end of Lago di Misurina, Via Monte Piana
    // up to Lago d'Antorno, then Strada per il Rifugio Auronzo (the toll road).
    osm: 'data/osm/tre-cime-road.json',
    places: 'data/osm/tre-cime-places.json',
    cover: 'data/osm/tre-cime-landcover.json',
    // Scree, bare rock and mugo pine scrub are mapped here, so they are kept too.
    coverRock: true,
    // The road height comes from the Veneto LiDAR terrain model (5 m cells), not from
    // the published profile. Only for this road; the checks it has to pass are printed
    // below and written down in docs/REAL_ROADS.md.
    lidar: 'data/dem-cache/veneto-lidar5/raw',
    // A 10 m grid from the same survey around the road and the three towers.
    detail: { south: 46.567, north: 46.63, west: 12.237, east: 12.323, cell: 10 },
    // SP 49 where it starts at the south end of the lake, in Misurina.
    from: { lat: 46.5766503, lon: 12.2505232 },
    // Junction below Rifugio Auronzo where the one-way loop past the hut starts and ends.
    to: { lat: 46.6121329, lon: 12.2942138 },
    // Where Via Monte Piana leaves the SP 49 at the north end of the lake: the timed climb.
    climbStart: { lat: 46.5861176, lon: 12.2540668 },
    // The real one-way loop: past the parking to the hut, round it, back down through
    // the car park to the junction. Way ids in riding order; the summit is its top.
    topLoopWays: [25487505, 1178266940, 1178266939, 306448699, 1178266938, 826563816, 25487507, 1122061320],
    minRadius: 0,
    // Lots further from the road than this (other valleys, trailheads) are left out.
    lotsWithin: 250,
    // The three towers, from Sasso di Landro to Punta di Frida: drawn at 16 m cells
    // from anywhere on the ride, so they keep their shape from Misurina.
    landmarks: [{ name: 'Tre Cime di Lavaredo', south: 46.6125, north: 46.6235, west: 12.286, east: 12.3125 }],
    hairpins: 'up',
    towns: [{ name: 'Misurina', fromM: 0, toM: 900 }],
  },
};

const cfg = CONFIGS[process.argv[2]];
if (!cfg) throw new Error(`usage: build.mjs <${Object.keys(CONFIGS).join('|')}>`);
const research = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/real-climbs.research.json'), 'utf8'));
const climb = research.climbs.find((c) => c.id === cfg.climbId);
if (!climb) throw new Error('climb not in research data: ' + cfg.climbId);

// ---------------------------------------------------------------- road line from OSM ways
const osmFiles = Array.isArray(cfg.osm) ? cfg.osm : [cfg.osm];
const elements = [];
for (const file of osmFiles) {
  const osm = JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
  elements.push(...osm.elements);
}
const ways = elements.filter((w) => w.type === 'way' && w.geometry?.length >= 2);
const key = (p) => `${p.lat.toFixed(7)},${p.lon.toFixed(7)}`;
const adj = new Map();
for (const w of ways) {
  for (const [end, rev] of [[w.geometry[0], false], [w.geometry.at(-1), true]]) {
    if (!adj.has(key(end))) adj.set(key(end), []);
    adj.get(key(end)).push({ w, rev });
  }
}
const prev = new Map([[key(cfg.from), null]]);
const queue = [key(cfg.from)];
while (queue.length) {
  const k = queue.shift();
  for (const { w, rev } of adj.get(k) ?? []) {
    const g = rev ? [...w.geometry].reverse() : w.geometry;
    const nk = key(g.at(-1));
    if (prev.has(nk)) continue;
    prev.set(nk, { k, w, g });
    queue.push(nk);
  }
}
if (!prev.has(key(cfg.to))) throw new Error('no road between from and to');
const chain = [];
for (let k = key(cfg.to); prev.get(k); k = prev.get(k).k) chain.unshift(prev.get(k));
const ll = [];
let climbStartLL = cfg.climbStart ?? null;
for (const seg of chain) {
  if (!climbStartLL && seg.w.tags?.name === cfg.climbStartWay) climbStartLL = seg.g[0];
  for (let i = ll.length ? 1 : 0; i < seg.g.length; i++) ll.push(seg.g[i]);
}
if (!climbStartLL) throw new Error('climb start not found');

// Local metres: x east, z south, origin at the middle of the road.
const lat0 = ll.reduce((a, p) => a + p.lat, 0) / ll.length;
const lon0 = ll.reduce((a, p) => a + p.lon, 0) / ll.length;
const toXZ = (p) => ({ x: rad(p.lon - lon0) * Math.cos(rad(lat0)) * R, z: -rad(p.lat - lat0) * R });
const toLL = (x, z) => ({ lat: lat0 - (z / R) * (180 / Math.PI), lon: lon0 + (x / (R * Math.cos(rad(lat0)))) * (180 / Math.PI) });

function resample(pts, step) {
  const out = [pts[0]];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    let t = step - carry;
    while (t <= len) {
      out.push({ x: a.x + ((b.x - a.x) * t) / len, z: a.z + ((b.z - a.z) * t) / len });
      t += step;
    }
    carry = len - (t - step);
  }
  return out;
}
const curvature = (p, i) => {
  const a = p[i - 1], b = p[i], c = p[i + 1];
  const h1 = Math.atan2(b.z - a.z, b.x - a.x), h2 = Math.atan2(c.z - b.z, c.x - b.x);
  let d = h2 - h1;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d / Math.hypot(c.x - a.x, c.z - a.z) * 2;
};

// 1 m spacing, a light Gaussian blur to round OSM's polygon corners, then extra
// passes only where a bend is tighter than the road can turn.
let line = resample(ll.map(toXZ), 1);
const blur = (pts, sigma, mask) => {
  const r = Math.ceil(sigma * 3);
  const w = [];
  for (let k = -r; k <= r; k++) w.push(Math.exp(-(k * k) / (2 * sigma * sigma)));
  return pts.map((p, i) => {
    if (mask && !mask[i]) return p;
    if (i < r || i >= pts.length - r) return p;
    let sx = 0, sz = 0, sw = 0;
    for (let k = -r; k <= r; k++) { sx += pts[i + k].x * w[k + r]; sz += pts[i + k].z * w[k + r]; sw += w[k + r]; }
    return { x: sx / sw, z: sz / sw };
  });
};
line = blur(line, 2.5);
// 0 leaves the bends as mapped. 7 m is the usual minimum: tighter than that and
// the 7.6 m carriageway folds on itself. Vršič and Alpe d'Huez use 7.
const MIN_RADIUS = cfg.minRadius ?? 7;
for (let pass = 0; pass < 40 && MIN_RADIUS > 0; pass++) {
  const tight = new Uint8Array(line.length);
  let any = 0;
  for (let i = 1; i < line.length - 1; i++) {
    if (Math.abs(curvature(line, i)) > 1 / MIN_RADIUS) {
      for (let k = -12; k <= 12; k++) if (line[i + k]) tight[i + k] = 1;
      any++;
    }
  }
  if (!any) break;
  line = blur(line, 2, tight);
}
line = resample(line, 1);
const cum = [0];
for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + Math.hypot(line[i].x - line[i - 1].x, line[i].z - line[i - 1].z));
if (cfg.leadIn && cfg.places) {
  const src = JSON.parse(fs.readFileSync(path.join(ROOT, cfg.places), 'utf8'));
  const lake = src.lakes?.[0];
  if (!lake) throw new Error('lead-in needs a lake in ' + cfg.places);
  const ring = projectRing(lake.ring);
  let bestI = 0;
  let bestD = Infinity;
  for (let i = 0; i < line.length; i += 2) {
    const d = ringDistance(line[i].x, line[i].z, ring);
    if (d < bestD) {
      bestD = d;
      bestI = i;
    }
  }
  const startM = cum[bestI] - cfg.leadIn;
  if (!(startM > 1)) throw new Error(`lake is only ${cum[bestI].toFixed(0)} m along the road`);
  const cut = cum.findIndex((c) => c >= startM);
  const at = toLL(line[cut].x, line[cut].z);
  console.log(
    `lead-in: ${lake.name} is ${cum[bestI].toFixed(0)} m along the road, ride starts ${(cum[bestI] - cum[cut]).toFixed(0)} m before it at ${at.lat.toFixed(5)}, ${at.lon.toFixed(5)}`,
  );
  line = line.slice(cut);
  cum.length = 0;
  cum.push(0);
  for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + Math.hypot(line[i].x - line[i - 1].x, line[i].z - line[i - 1].z));
}
const L = cum.at(-1);

// ---------------------------------------------------------------- elevation
const lineBox = { south: 90, north: -90, west: 180, east: -180 };
for (const p of ll) {
  lineBox.south = Math.min(lineBox.south, p.lat); lineBox.north = Math.max(lineBox.north, p.lat);
  lineBox.west = Math.min(lineBox.west, p.lon); lineBox.east = Math.max(lineBox.east, p.lon);
}
const grow = (b, km) => {
  const dLat = km / 111.2, dLon = km / (111.2 * Math.cos(rad(lat0)));
  return { south: b.south - dLat, north: b.north + dLat, west: b.west - dLon, east: b.east + dLon };
};
const cache = path.join(ROOT, 'data/dem-cache');
const FINE_KM = 4, COARSE_KM = 15;
const demFine = await demSampler(grow(lineBox, FINE_KM + 0.5), 13, cache);
const demCoarse = await demSampler(grow(lineBox, COARSE_KM + 0.5), 11, cache);
const demAtXZ = (x, z, dem = demFine) => { const p = toLL(x, z); return dem(p.lat, p.lon); };
// LiDAR where the survey has data, the 30 m tiles elsewhere.
const lidar = cfg.lidar ? lidarSampler(path.join(ROOT, cfg.lidar)) : null;
const lidarAtXZ = (x, z) => { const p = toLL(x, z); return lidar(p.lat, p.lon); };
// The survey stops at the regional border. Past it the 30 m tiles take over, shifted by
// how far they sit from the LiDAR along that edge, so a peak cut by the border has no
// step in it. The shift fades out over 600 m. It is measured on a 50 m grid.
let edgeShift = null;
if (lidar && cfg.detail) {
  const { south, north, west, east } = cfg.detail;
  const a = toXZ({ lat: north, lon: west }), b = toXZ({ lat: south, lon: east });
  const C = 50;
  const w = Math.ceil((b.x - a.x) / C) + 1, h = Math.ceil((b.z - a.z) / C) + 1;
  const diff = new Float32Array(w * h).fill(NaN);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const x = a.x + i * C, z = a.z + j * C;
    const v = lidarAtXZ(x, z);
    if (!Number.isNaN(v)) diff[j * w + i] = v - demAtXZ(x, z);
  }
  const R = 12; // cells: 600 m
  const shift = new Float32Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    if (!Number.isNaN(diff[j * w + i])) continue;
    let s = 0, sw = 0, dmin = Infinity;
    for (let b2 = -R; b2 <= R; b2++) for (let a2 = -R; a2 <= R; a2++) {
      const ii = i + a2, jj = j + b2;
      if (ii < 0 || jj < 0 || ii >= w || jj >= h) continue;
      const d = diff[jj * w + ii];
      if (Number.isNaN(d)) continue;
      const r = Math.hypot(a2, b2);
      dmin = Math.min(dmin, r);
      const wt = 1 / (r * r);
      s += d * wt; sw += wt;
    }
    if (sw) shift[j * w + i] = (s / sw) * Math.max(0, 1 - dmin / R);
  }
  edgeShift = (x, z) => {
    const fx = (x - a.x) / C, fz = (z - a.z) / C;
    if (fx < 0 || fz < 0 || fx >= w - 1 || fz >= h - 1) return 0;
    const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
    const v = (k) => shift[k];
    return (v(j * w + i) * (1 - tx) + v(j * w + i + 1) * tx) * (1 - tz) + (v((j + 1) * w + i) * (1 - tx) + v((j + 1) * w + i + 1) * tx) * tz;
  };
}
const groundAtXZ = (x, z) => {
  if (!lidar) return demAtXZ(x, z);
  const v = lidarAtXZ(x, z);
  return Number.isNaN(v) ? demAtXZ(x, z) + (edgeShift ? edgeShift(x, z) : 0) : v;
};
if (lidar) console.log(`LiDAR: ${lidar.tiles} tiles from ${cfg.lidar}`);

// The real one-way loop at the top, as a ring that starts and ends at `to`.
let loopRing = null;
if (cfg.topLoopWays) {
  const byId = new Map(ways.map((w) => [w.id, w]));
  const same = (a, b) => key(a) === key(b);
  let at = cfg.to;
  const ringLL = [cfg.to];
  for (const id of cfg.topLoopWays) {
    const w = byId.get(id);
    if (!w) throw new Error('top loop way missing: ' + id);
    const g = same(w.geometry[0], at) ? w.geometry : same(w.geometry.at(-1), at) ? [...w.geometry].reverse() : null;
    if (!g) throw new Error(`top loop way ${id} does not continue from the previous one`);
    if (w.tags?.oneway === 'yes' && g !== w.geometry) throw new Error(`top loop rides one-way ${id} the wrong way`);
    ringLL.push(...g.slice(1));
    at = g.at(-1);
  }
  if (!same(at, cfg.to)) throw new Error('top loop does not close');
  let ring = resample(ringLL.map(toXZ), 1);
  // Round the parking-aisle corners; both ends stay pinned on the junction.
  ring = blur(ring, 2.5);
  loopRing = resample(ring, 1);
  // Resampling stops short of the last vertex. Close the ring on the junction exactly.
  const end = toXZ(cfg.to);
  if (Math.hypot(loopRing.at(-1).x - end.x, loopRing.at(-1).z - end.z) > 0.05) loopRing.push(end);
  loopRing[0] = { ...end };
}

// Where the climb starts and ends on the line.
const cs = toXZ(climbStartLL);
let s0 = 0, best = Infinity;
line.forEach((p, i) => { const d = Math.hypot(p.x - cs.x, p.z - cs.z); if (d < best) { best = d; s0 = cum[i]; } });
// The summit: the mapped pass point, or else the highest point of the DEM in the last 1.5 km.
let s1 = L, top = -Infinity;
if (loopRing) {
  // The climb runs to the end of the line and on into the loop; its top is found there.
  top = groundAtXZ(line.at(-1).x, line.at(-1).z);
} else if (cfg.summit) {
  const sp = toXZ(cfg.summit);
  let bestS = Infinity;
  line.forEach((p, i) => { const d = Math.hypot(p.x - sp.x, p.z - sp.z); if (d < bestS) { bestS = d; s1 = cum[i]; } });
  top = demAtXZ(sp.x, sp.z);
} else {
  for (let i = 0; i < line.length; i += 5) {
    if (cum[i] < L - 1500) continue;
    const h = demAtXZ(line[i].x, line[i].z);
    if (h > top) { top = h; s1 = cum[i]; }
  }
}
const climbLen = s1 - s0;
if (process.env.LENGTH_ONLY) { console.log(`climb ${(climbLen / 1000).toFixed(3)} km`); process.exit(0); }
const pubLen = climb.length_km * 1000;
console.log(`road ${(L / 1000).toFixed(2)} km · climb on OSM ${(climbLen / 1000).toFixed(2)} km vs published ${(pubLen / 1000).toFixed(2)} km (${(((climbLen - pubLen) / pubLen) * 100).toFixed(1)} %) · DEM summit ${top.toFixed(0)} m`);

const demRoad = line.map((p) => demAtXZ(p.x, p.z));
const smooth = (arr, half) => arr.map((_, i) => {
  let s = 0, n = 0;
  for (let k = Math.max(0, i - half); k <= Math.min(arr.length - 1, i + half); k++) { s += arr[k]; n++; }
  return s / n;
});
const i0 = cum.findIndex((c) => c >= s0);
const i1 = cum.findIndex((c) => c >= s1 - 0.5);
let y;
// Heights on the top loop, and the index of its highest point (the summit).
let loopY = null;
let loopTop = 0;
if (lidar) {
  // Road height from the LiDAR survey along the real line. A Gaussian over about
  // 12 m takes out the 5 m cell steps, kerbs and culverts and keeps a 100 m ramp
  // at its real gradient. Points are 1 m apart, so sigma is in metres.
  const SIGMA = 12;
  const gauss = (arr, sigma, ring) => {
    const r = Math.ceil(sigma * 3);
    const n = arr.length;
    return arr.map((_, i) => {
      let s = 0, sw = 0;
      for (let k = -r; k <= r; k++) {
        let j = i + k;
        if (ring) j = (j + n - 1) % (n - 1);
        else if (j < 0 || j >= n) continue;
        const w = Math.exp(-(k * k) / (2 * sigma * sigma));
        s += arr[j] * w;
        sw += w;
      }
      return s / sw;
    });
  };
  y = gauss(line.map((p) => groundAtXZ(p.x, p.z)), SIGMA, false);
  if (loopRing) {
    // The ring closes on itself, so it is smoothed round the join. Both of its ends
    // are then pinned onto the end of the line over the first and last 30 m.
    loopY = gauss(loopRing.map((p) => groundAtXZ(p.x, p.z)), SIGMA, true);
    const n = loopY.length;
    const d0 = y.at(-1) - loopY[0];
    const d1 = y.at(-1) - loopY[n - 1];
    loopY = loopY.map((v, k) => v + d0 * Math.max(0, 1 - k / 30) + d1 * Math.max(0, 1 - (n - 1 - k) / 30));
    loopY.forEach((v, k) => { if (v > loopY[loopTop]) loopTop = k; });
  }
  // ---- checks against the published figures
  const prof = [];
  for (let i = i0; i < line.length; i++) prof.push({ s: cum[i] - s0, y: y[i] });
  if (loopRing) {
    let s = prof.at(-1).s;
    for (let k = 1; k <= loopTop; k++) {
      s += Math.hypot(loopRing[k].x - loopRing[k - 1].x, loopRing[k].z - loopRing[k - 1].z);
      prof.push({ s, y: loopY[k] });
    }
  } else prof.length = i1 - i0 + 1;
  const len = prof.at(-1).s;
  const yAtS = (s) => {
    let lo = 0, hi = prof.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (prof[m].s <= s) lo = m; else hi = m; }
    const a = prof[lo], b = prof[hi];
    return a.y + ((b.y - a.y) * (s - a.s)) / (b.s - a.s || 1);
  };
  let ascent = 0;
  for (let k = 1; k < prof.length; k++) ascent += Math.max(0, prof[k].y - prof[k - 1].y);
  console.log(`LiDAR climb: ${(len / 1000).toFixed(2)} km, ${prof[0].y.toFixed(1)} m to ${prof.at(-1).y.toFixed(1)} m, gain ${(prof.at(-1).y - prof[0].y).toFixed(0)} m, total ascent ${ascent.toFixed(0)} m, average ${(((prof.at(-1).y - prof[0].y) / len) * 100).toFixed(1)} %`);
  const steepest = (win) => {
    let best = { g: -Infinity, at: 0 };
    for (let s = 0; s + win <= len; s += 5) { const g = ((yAtS(s + win) - yAtS(s)) / win) * 100; if (g > best.g) best = { g, at: s }; }
    return `${best.g.toFixed(1)} % at ${(best.at / 1000).toFixed(2)} km`;
  };
  console.log(`  steepest 20 m ${steepest(20)} · 100 m ${steepest(100)} · 250 m ${steepest(250)} · 500 m ${steepest(500)} · 1 km ${steepest(1000)}`);
  let peak = -Infinity, drop = 0, dropAt = 0;
  for (const p of prof) { peak = Math.max(peak, p.y); if (peak - p.y > drop) { drop = peak - p.y; dropAt = p.s; } }
  console.log(`  largest drop ${drop.toFixed(1)} m, bottom at ${(dropAt / 1000).toFixed(2)} km · last 400 m ${(((prof.at(-1).y - yAtS(len - 400)) / 400) * 100).toFixed(1)} %`);
  const rows = [];
  const pub = climb.source_segments ?? [];
  for (let s = 0, k = 0; s < len; s += 500, k++) {
    const e = Math.min(len, s + 500);
    const g = ((yAtS(e) - yAtS(s)) / (e - s)) * 100;
    const p = pub[k];
    rows.push(`${(s / 1000).toFixed(1)}–${(e / 1000).toFixed(2)} km ${g.toFixed(1).padStart(5)} %${p ? `  (cols-cyclisme ${p[0]}–${p[1]}: ${p[2]} %)` : ''}`);
  }
  console.log('  every 500 m from the start:\n    ' + rows.join('\n    '));
  const back = [];
  for (let k = 0; k < Math.min(9, pub.length); k++) {
    const e = len - k * 500, s = Math.max(0, e - 500);
    const p = pub[pub.length - 1 - k];
    back.push(`last ${((len - s) / 1000).toFixed(1)} km piece ${(((yAtS(e) - yAtS(s)) / (e - s)) * 100).toFixed(1)} % (cols-cyclisme ${p[0]}–${p[1]}: ${p[2]} %)`);
  }
  console.log('  aligned on the summit:\n    ' + back.join('\n    '));
} else {
  // Road elevation. Climb: the published segments laid along the real line.
  // Before it: the DEM, smoothed, eased onto the climb's start elevation.
  const segs = climb.source_segments; // [fromKm, toKm, grade%]
  const scale = climbLen / (segs.at(-1)[1] * 1000);
  const yAt = new Float64Array(line.length);
  const demSmooth = smooth(demRoad, 150);
  const shift = cfg.startElevation - demSmooth[i0];
  for (let i = 0; i <= i0; i++) yAt[i] = s0 > 0 ? demSmooth[i] + shift * (cum[i] / s0) : cfg.startElevation;
  let elev = cfg.startElevation;
  let seg = 0;
  for (let i = i0 + 1; i < line.length; i++) {
    const km = (cum[i] - s0) / scale / 1000;
    while (seg < segs.length - 1 && km > segs[seg][1]) seg++;
    const g = i <= i1 ? segs[seg][2] / 100 : 0;
    elev += g * (cum[i] - cum[i - 1]);
    yAt[i] = elev;
  }
  // Soften the steps between segments over ~30 m, keeping the overall rise.
  const grades = [];
  for (let i = 1; i < line.length; i++) grades.push((yAt[i] - yAt[i - 1]) / (cum[i] - cum[i - 1] || 1));
  const gs = smooth(grades, 15);
  y = [yAt[0]];
  for (let i = 1; i < line.length; i++) y.push(y[i - 1] + gs[i - 1] * (cum[i] - cum[i - 1]));
  const drift = cfg.summitElevation - y[i1];
  for (let i = i0; i < line.length; i++) y[i] += drift * Math.min(1, (cum[i] - s0) / climbLen);
}
console.log(`road elevation: start ${y[i0].toFixed(0)} m, summit ${(loopY ? loopY[loopTop] : y[i1]).toFixed(0)} m, 30 m tiles along the climb off by ${(Math.sqrt(line.slice(i0, i1).reduce((a, p, k) => a + (y[i0 + k] - demRoad[i0 + k]) ** 2, 0) / (i1 - i0))).toFixed(1)} m (rms)`);

// ---------------------------------------------------------------- the loop: up, turn, back down, turn
// A balloon loop at each end, so the descent is the same road back.
function balloon(at, heading, side, radius) {
  const pts = [];
  let h = heading, x = at.x, z = at.z;
  const arc = (ang, r) => {
    const n = Math.ceil((Math.abs(ang) * r) / 1);
    for (let k = 0; k < n; k++) {
      h += ang / n / 2; x += Math.cos(h) * Math.abs(ang) * r / n; z += Math.sin(h) * Math.abs(ang) * r / n; h += ang / n / 2;
      pts.push({ x, z });
    }
  };
  const a = Math.PI / 3; // 60° closes a balloon of equal radii exactly
  arc(side * a, radius);
  arc(-side * (Math.PI + 2 * a), radius);
  arc(side * a, radius);
  return pts;
}
const headingAt = (i, back) => Math.atan2(line[i].z - line[i - back].z, line[i].x - line[i - back].x);
const topEnd = loopRing || cfg.balloonAtEnd ? line.length - 1 : Math.min(line.length - 1, i1 + 40);
const topLoop = loopRing ? null : balloon(line[topEnd], headingAt(topEnd, 8), 1, 16);
const botLoop = balloon(line[0], headingAt(8, 8) + Math.PI, 1, 16);
const err = (lp, at) => Math.hypot(lp.at(-1).x - at.x, lp.at(-1).z - at.z).toFixed(2);
console.log(`balloon closure error: top ${loopRing ? `real loop ${err(loopRing, line[topEnd])}` : err(topLoop, line[topEnd])} m, bottom ${err(botLoop, line[0])} m`);

const loop = [];
const push = (p, yy, sec) => loop.push({ x: p.x, z: p.z, y: yy, sec });
if (loopRing) {
  // Up the line and on round the real loop to its highest point (the finish), the
  // rest of the loop back to the junction, then down the same road.
  for (let i = 0; i <= topEnd; i++) push(line[i], y[i], i < i0 ? 0 : 1);
  for (let k = 1; k < loopRing.length - 1; k++) push(loopRing[k], loopY[k], k <= loopTop ? 1 : 2);
  for (let i = topEnd; i >= 1; i--) push(line[i], y[i], 2);
} else {
  for (let i = 0; i <= topEnd; i++) push(line[i], y[i], i < i0 ? 0 : i <= i1 ? 1 : 2);
  for (const p of topLoop) push(p, y[topEnd], 2);
  for (let i = topEnd - 1; i >= 1; i--) push(line[i], y[i], 2);
}
for (const p of botLoop.slice(0, -1)) push(p, y[0], 2);

// Every 4 m on straights, every metre or so in bends (no more than 4° between points).
const out5 = [];
let acc = 0;
let lastH = null;
for (let i = 0; i < loop.length; i++) {
  if (i > 0) acc += Math.hypot(loop[i].x - loop[i - 1].x, loop[i].z - loop[i - 1].z);
  const prevOut = out5.at(-1);
  let turn = 0;
  if (prevOut && i + 1 < loop.length) {
    const h = Math.atan2(loop[i + 1].z - loop[i].z, loop[i + 1].x - loop[i].x);
    if (lastH !== null) { turn = h - lastH; while (turn > Math.PI) turn -= 2 * Math.PI; while (turn < -Math.PI) turn += 2 * Math.PI; }
  }
  if (i === 0 || acc >= 4 || Math.abs(turn) > (4 * Math.PI) / 180 || loop[i].sec !== loop[i - 1].sec || i === loop.length - 1) {
    out5.push(loop[i]);
    acc = 0;
    if (i + 1 < loop.length) lastH = Math.atan2(loop[i + 1].z - loop[i].z, loop[i + 1].x - loop[i].x);
  }
}
console.log(`loop ${out5.length} points, ${(loop.length / 1000).toFixed(1)} km`);

// Bends: where the line turns over 120° within 110 m.
let pins = 0;
{
  const head = [];
  for (let i = i0; i + 2 < line.length && i < i1; i += 2) head.push(Math.atan2(line[i + 2].z - line[i].z, line[i + 2].x - line[i].x));
  let k = 0;
  const unwrap = [head[0]];
  for (let j = 1; j < head.length; j++) { let d = head[j] - head[j - 1]; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; unwrap.push(unwrap[j - 1] + d); }
  while (k < unwrap.length - 55) {
    if (Math.abs(unwrap[k + 55] - unwrap[k]) > (120 * Math.PI) / 180) { pins++; k += 55; } else k++;
  }
}
console.log(`hairpins found on the climb: ${pins} (published ${climb.hairpins})`);

// ---------------------------------------------------------------- height grids, pulled onto the road
function grid(dem, km, cell, sample) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of line) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); }
  const m = km * 1000;
  const x0 = Math.floor((minX - m) / cell) * cell, z0 = Math.floor((minZ - m) / cell) * cell;
  const w = Math.ceil((maxX + m - x0) / cell) + 1, h = Math.ceil((maxZ + m - z0) / cell) + 1;
  const data = new Float32Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) data[j * w + i] = sample ? sample(x0 + i * cell, z0 + j * cell) : demAtXZ(x0 + i * cell, z0 + j * cell, dem);
  return { x0, z0, cell, w, h, data, lidar: !!sample };
}
// Mean of the LiDAR over a cell (a 3 x 3 pattern), so a coarse cell is not one 5 m spot.
const groundMean = (cell) => (x, z) => {
  let s = 0;
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) s += groundAtXZ(x + (a * cell) / 3, z + (b * cell) / 3);
  return s / 9;
};
const fine = grid(demFine, FINE_KM, 25, lidar ? groundMean(25) : null);
const coarse = grid(demCoarse, COARSE_KM, 100);
// The detail grid: the LiDAR at 10 m around the road and the towers. It is fine
// first in the file, so the game uses it wherever it reaches.
let detail = null;
if (lidar && cfg.detail) {
  const { south, north, west, east, cell } = cfg.detail;
  const a = toXZ({ lat: north, lon: west }), b = toXZ({ lat: south, lon: east });
  const x0 = Math.floor(a.x / cell) * cell, z0 = Math.floor(a.z / cell) * cell;
  const w = Math.ceil((b.x - x0) / cell) + 1, h = Math.ceil((b.z - z0) / cell) + 1;
  const data = new Float32Array(w * h);
  const mean = groundMean(cell);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) data[j * w + i] = mean(x0 + i * cell, z0 + j * cell);
  detail = { x0, z0, cell, w, h, data, lidar: true };
}
const grids = [detail, fine, coarse].filter(Boolean);
// Near the road, move the terrain onto the road's elevation. The 30 m tiles can't
// hold a road bench; on the LiDAR this only takes out the road smoothing. Fades out by 600 m.
{
  const samples = [];
  const lidarRoad = lidar ? line.map((p) => groundAtXZ(p.x, p.z)) : demRoad;
  for (let i = 0; i < line.length; i += 8) samples.push({ x: line[i].x, z: line[i].z, rD: y[i] - demRoad[i], rL: y[i] - lidarRoad[i] });
  if (loopRing) {
    for (let k = 0; k < loopRing.length; k += 8) {
      const p = loopRing[k];
      samples.push({ x: p.x, z: p.z, rD: loopY[k] - demAtXZ(p.x, p.z), rL: loopY[k] - groundAtXZ(p.x, p.z) });
    }
  }
  const H = 100;
  const hash = new Map();
  for (const s of samples) { const k = `${Math.floor(s.x / H)},${Math.floor(s.z / H)}`; if (!hash.has(k)) hash.set(k, []); hash.get(k).push(s); }
  for (const g of grids) {
    for (let j = 0; j < g.h; j++) {
      for (let i = 0; i < g.w; i++) {
        const x = g.x0 + i * g.cell, z = g.z0 + j * g.cell;
        const cx = Math.floor(x / H), cz = Math.floor(z / H);
        let ws = 0, rs = 0, dmin = Infinity;
        for (let a = -6; a <= 6; a++) for (let b = -6; b <= 6; b++) {
          for (const s of hash.get(`${cx + a},${cz + b}`) ?? []) {
            const d2 = (s.x - x) ** 2 + (s.z - z) ** 2;
            dmin = Math.min(dmin, d2);
            const wgt = Math.exp(-d2 / (2 * 90 * 90));
            ws += wgt; rs += wgt * (g.lidar ? s.rL : s.rD);
          }
        }
        if (ws < 1e-9) continue;
        const d = Math.sqrt(dmin);
        const fade = d < 150 ? 1 : d > 600 ? 0 : 1 - ((d - 150) / 450) ** 2 * (3 - 2 * ((d - 150) / 450));
        g.data[j * g.w + i] += (rs / ws) * fade;
      }
    }
  }
}
const toU16 = (g) => Uint16Array.from(g.data, (v) => Math.max(0, Math.min(65535, Math.round(v * 10))));
const bin = Buffer.concat(grids.map((g) => Buffer.from(toU16(g).buffer)));
fs.mkdirSync(path.join(ROOT, 'src/assets/terrain'), { recursive: true });
fs.writeFileSync(path.join(ROOT, `src/assets/terrain/${cfg.id}.bin`), bin);

// ---------------------------------------------------------------- town length and mapped places
if (cfg.townEnd) {
  const sp = toXZ(cfg.townEnd);
  let bestS = Infinity;
  let at = 0;
  line.forEach((p, i) => {
    const d = Math.hypot(p.x - sp.x, p.z - sp.z);
    if (d < bestS) {
      bestS = d;
      at = cum[i];
    }
  });
  if (bestS > 40) throw new Error(`town end is ${bestS.toFixed(0)} m off the road`);
  cfg.towns[0].fromM = 0;
  cfg.towns[0].toM = Math.round(at);
  console.log(`town ${cfg.towns[0].name} 0–${cfg.towns[0].toM} m (marker ${bestS.toFixed(0)} m off the line)`);
}

function projectRing(latlon) {
  const x = [];
  const z = [];
  for (const [lat, lon] of latlon) {
    const p = toXZ({ lat, lon });
    x.push(p.x);
    z.push(p.z);
  }
  if (x.length > 3 && Math.hypot(x[0] - x.at(-1), z[0] - z.at(-1)) < 0.05) {
    x.pop();
    z.pop();
  }
  return {
    x: x.map((v) => Math.round(v * 10) / 10),
    z: z.map((v) => Math.round(v * 10) / 10),
  };
}
function insideRing(px, pz, ring) {
  let inside = false;
  const xs = ring.x;
  const zs = ring.z;
  for (let i = 0, j = xs.length - 1; i < xs.length; j = i++) {
    if ((zs[i] > pz) !== (zs[j] > pz) && px < ((xs[j] - xs[i]) * (pz - zs[i])) / (zs[j] - zs[i] || 1e-9) + xs[i]) inside = !inside;
  }
  return inside;
}
function ringDistance(px, pz, ring) {
  let best = Infinity;
  const xs = ring.x;
  const zs = ring.z;
  for (let i = 0, j = xs.length - 1; i < xs.length; j = i++) {
    const dx = xs[i] - xs[j];
    const dz = zs[i] - zs[j];
    const l2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((px - xs[j]) * dx + (pz - zs[j]) * dz) / l2));
    best = Math.min(best, Math.hypot(px - (xs[j] + dx * t), pz - (zs[j] + dz * t)));
  }
  return best;
}
let places = undefined;
if (cfg.places) {
  const src = JSON.parse(fs.readFileSync(path.join(ROOT, cfg.places), 'utf8'));
  const lakes = [];
  for (const lake of src.lakes ?? []) {
    const ring = projectRing(lake.ring);
    const near = [];
    let shore = Infinity;
    for (let i = 0; i < line.length; i += 3) {
      const d = ringDistance(line[i].x, line[i].z, ring);
      shore = Math.min(shore, d);
      if (d < 40) near.push(y[i]);
    }
    if (!near.length) throw new Error(`${lake.name} is not beside the road`);
    near.sort((a, b) => a - b);
    let level = Math.round((near[Math.floor(near.length / 2)] - 0.8) * 10) / 10;
    if (lidar) {
      // The survey gives the water surface itself: the median inside the shore line.
      const xs = ring.x, zs = ring.z;
      const water = [];
      for (let x = Math.min(...xs); x < Math.max(...xs); x += 8) for (let z = Math.min(...zs); z < Math.max(...zs); z += 8) if (insideRing(x, z, ring)) water.push(groundAtXZ(x, z));
      water.sort((a, b) => a - b);
      if (water.length) level = Math.min(level, Math.round(water[water.length >> 1] * 10) / 10);
    }
    console.log(`lake ${lake.name}: shore ${shore.toFixed(1)} m from the road centre, water ${level.toFixed(1)} m`);
    lakes.push({ name: lake.name, level, ...ring });
  }
  const lots = [];
  for (const lot of src.lots) {
    const ring = projectRing(lot.ring);
    let shore = Infinity;
    for (let i = 0; i < line.length; i += 2) shore = Math.min(shore, ringDistance(line[i].x, line[i].z, ring));
    if (cfg.lotsWithin && shore > cfg.lotsWithin) continue;
    if (lot.viewpoint) {
      const p = toXZ(lot.viewpoint);
      const d = ringDistance(p.x, p.z, ring);
      const inside = insideRing(p.x, p.z, ring);
      if (!inside && d > 8) throw new Error(`${lot.name} viewpoint is ${d.toFixed(1)} m from its parking lot`);
      console.log(`lot ${lot.name}: viewpoint ${inside ? 'inside' : d.toFixed(1) + ' m from'} the lot, road ${shore.toFixed(1)} m`);
    } else console.log(`lot ${lot.name}: road ${shore.toFixed(1)} m`);
    if (lot.hut) {
      const p = toXZ(lot.hut);
      const d = ringDistance(p.x, p.z, ring);
      if (d > 100) throw new Error(`${lot.name} is ${d.toFixed(0)} m from the hut`);
    }
    lots.push({ name: lot.name, ...ring });
  }
  places = { lakes, lots };
}

const OPEN_COVER = new Set(['meadow', 'grass', 'grassland', 'farmland', 'scrub']);
// Douglas–Peucker on a projected ring, so a mapped scree fan is tens of points, not hundreds.
function simplifyRing(ring, tol) {
  const n = ring.x.length;
  if (n < 8) return ring;
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    const ax = ring.x[i], az = ring.z[i], dx = ring.x[j] - ax, dz = ring.z[j] - az;
    const l = Math.hypot(dx, dz) || 1;
    let far = -1, fd = tol;
    for (let k = i + 1; k < j; k++) {
      const d = Math.abs((ring.x[k] - ax) * dz - (ring.z[k] - az) * dx) / l;
      if (d > fd) { fd = d; far = k; }
    }
    if (far >= 0) { keep[far] = 1; stack.push([i, far], [far, j]); }
  }
  const x = [], z = [];
  for (let k = 0; k < n; k++) if (keep[k]) { x.push(ring.x[k]); z.push(ring.z[k]); }
  return { x, z };
}
let coverFile = null;
if (cfg.cover) {
  const src = JSON.parse(fs.readFileSync(path.join(ROOT, cfg.cover), 'utf8'));
  const open = [];
  const wood = [];
  const scrub = [];
  const scree = [];
  const rock = [];
  for (const el of src.elements ?? []) {
    if (el.type !== 'way' || !el.geometry?.length) continue;
    const tags = el.tags ?? {};
    if (String(tags.source ?? '').includes('CORINE')) continue;
    const kind = tags.landuse || tags.natural;
    let cls = kind === 'forest' || kind === 'wood' ? 'wood' : OPEN_COVER.has(kind) ? 'open' : null;
    if (cfg.coverRock) {
      // Mugo pine is mapped as scrub. Scree, shingle and bare rock are the mountain itself.
      if (kind === 'scrub') cls = 'scrub';
      else if (kind === 'heath') cls = 'open';
      else if (kind === 'scree' || kind === 'shingle') cls = 'scree';
      else if (kind === 'bare_rock') cls = 'rock';
      // A hole in a wood is a clearing. Holes in rock, scree or scrub are left out.
      if (tags.inner === 'yes') cls = cls === 'wood' ? 'open' : null;
    } else if (tags.inner === 'yes') cls = null;
    if (!cls) continue;
    let ring = projectRing(el.geometry.map((p) => [p.lat, p.lon]));
    if (ring.x.length < 3) continue;
    if (cfg.coverRock) {
      // The whole mapped area is kept: trees there grow only in the mapped woods.
      // Patches under ~2,000 m² are a few terrain cells and are left out; the rest
      // is simplified to 6 m, about the size of a near terrain cell.
      let area = 0;
      for (let i = 0, j = ring.x.length - 1; i < ring.x.length; j = i++) area += (ring.x[j] + ring.x[i]) * (ring.z[j] - ring.z[i]);
      if (Math.abs(area / 2) < 2000) continue;
      ring = simplifyRing(ring, 6);
      if (ring.x.length < 3) continue;
      const poly = { name: tags.name || kind, ...ring };
      ({ wood, open, scrub, scree, rock })[cls].push(poly);
      continue;
    }
    let shore = Infinity;
    let inside = false;
    for (let i = 0; i < line.length; i += 4) {
      shore = Math.min(shore, ringDistance(line[i].x, line[i].z, ring));
      if (!inside && insideRing(line[i].x, line[i].z, ring)) inside = true;
    }
    const dist = inside ? 0 : shore;
    if (dist > 400) continue;
    const poly = { name: tags.name || kind, ...ring };
    (cls === 'wood' ? wood : open).push(poly);
    console.log(`cover ${cls} ${poly.name}: ${dist.toFixed(0)} m, ${ring.x.length} pts`);
  }
  if (!places) places = { lakes: [], lots: [] };
  if (cfg.coverRock) {
    // The box the land cover was fetched for, a little inside its edge.
    const bb = src.bbox;
    const a = toXZ({ lat: bb.north, lon: bb.west }), b = toXZ({ lat: bb.south, lon: bb.east });
    const mapped = { minX: Math.round(a.x + 200), maxX: Math.round(b.x - 200), minZ: Math.round(a.z + 200), maxZ: Math.round(b.z - 200) };
    // Inside the box unmapped ground is open anyway, so a meadow only matters where
    // it cuts into a wood.
    const box = (r) => ({ minX: Math.min(...r.x), maxX: Math.max(...r.x), minZ: Math.min(...r.z), maxZ: Math.max(...r.z) });
    const woodBoxes = wood.map(box);
    const cuts = open.filter((o) => { const b = box(o); return woodBoxes.some((w) => b.minX < w.maxX && b.maxX > w.minX && b.minZ < w.maxZ && b.maxZ > w.minZ); });
    open.length = 0;
    open.push(...cuts);
    // Too large to ship with the road: it goes in its own file, loaded with the terrain.
    coverFile = { open, wood, scrub, scree, rock, mapped };
    const pts = (l) => l.reduce((s, p) => s + p.x.length, 0);
    console.log(`cover kept ${wood.length} wood (${pts(wood)} pts), ${open.length} open (${pts(open)}), ${scrub.length} scrub (${pts(scrub)}), ${scree.length} scree (${pts(scree)}), ${rock.length} rock (${pts(rock)}); mapped box ${mapped.maxX - mapped.minX} x ${mapped.maxZ - mapped.minZ} m`);
  } else {
    places.cover = { open, wood };
    console.log(`cover kept ${open.length} open and ${wood.length} wood (CORINE forest left out)`);
  }
}

function creditLine(places) {
  const bits = ['Road line'];
  if (places?.lakes?.length) bits.push('lake');
  if (coverFile || (places?.cover && (places.cover.open.length || places.cover.wood.length))) bits.push('land cover');
  if (places?.lots?.length) bits.push('parking');
  const what = bits.length === 1 ? bits[0] : `${bits.slice(0, -1).join(', ')} and ${bits.at(-1)}`;
  return `${what} © OpenStreetMap contributors (ODbL). `;
}

// ---------------------------------------------------------------- track file
const r1 = (v) => Math.round(v * 10) / 10;
const secLen = [0, 0, 0];
for (let i = 1; i < out5.length; i++) secLen[out5[i].sec] += Math.hypot(out5[i].x - out5[i - 1].x, out5[i].z - out5[i - 1].z);
const track = {
  id: cfg.id,
  source:
    creditLine(places) +
    (lidar
      ? 'Terrain and road profile: Regione del Veneto – L.R. n. 28/76 – Formazione della Carta Tecnica Regionale (DTM LiDAR 5 m, IODL 2.0); Terrain Tiles (SRTM, Copernicus EU-DEM) further out. Checked against ' +
        climb.sources[0]
      : 'Terrain: Terrain Tiles (SRTM, Copernicus EU-DEM). Road profile: ' + climb.sources[0]),
  origin: { lat: +lat0.toFixed(7), lon: +lon0.toFixed(7) },
  ...(places ? { places } : {}),
  ...(cfg.climbFromSection != null ? { climbFromSection: cfg.climbFromSection } : {}),
  hairpins: cfg.hairpins,
  ...(typeof climb.hairpins === 'number' ? { hairpinCount: climb.hairpins } : {}),
  town: cfg.towns[0],
  towns: cfg.towns,
  sections: secLen.map((v) => Math.round(v)),
  x: out5.map((p) => r1(p.x)),
  z: out5.map((p) => r1(p.z)),
  y: out5.map((p) => r1(p.y)),
  sec: out5.map((p) => p.sec),
  terrain: {
    file: `${cfg.id}.bin`,
    grids: grids.map(({ x0, z0, cell, w, h }) => ({ x0, z0, cell, w, h })),
    ...(coverFile ? { cover: `${cfg.id}.cover.json` } : {}),
  },
  ...(cfg.landmarks
    ? {
        landmarks: cfg.landmarks.map((b) => {
          const a = toXZ({ lat: b.north, lon: b.west }), c = toXZ({ lat: b.south, lon: b.east });
          return { name: b.name, minX: Math.round(a.x), maxX: Math.round(c.x), minZ: Math.round(a.z), maxZ: Math.round(c.z) };
        }),
      }
    : {}),
};
fs.mkdirSync(path.join(ROOT, 'src/routes/real/tracks'), { recursive: true });
fs.writeFileSync(path.join(ROOT, `src/routes/real/tracks/${cfg.id}.json`), JSON.stringify(track));
if (coverFile) {
  const r = (v) => Math.round(v);
  const slim = Object.fromEntries(Object.entries(coverFile).map(([k, v]) => [k, Array.isArray(v) ? v.map((p) => ({ name: p.name, x: p.x.map(r), z: p.z.map(r) })) : v]));
  const text = JSON.stringify(slim);
  fs.writeFileSync(path.join(ROOT, `src/assets/terrain/${cfg.id}.cover.json`), text);
  console.log(`wrote land cover (${(text.length / 1024).toFixed(0)} KB, loaded with the terrain)`);
}
console.log(`wrote track (${(JSON.stringify(track).length / 1024).toFixed(0)} KB) and terrain (${(bin.length / 1024).toFixed(0)} KB, ${grids.map((g) => `${g.cell} m ${g.w}×${g.h}`).join(', ')})`);
