import * as THREE from 'three';
import { ROUTE_DS } from '../routes/route';
import { lerp, smoothstep } from '../util/math';
import { building } from './buildings';
import { placement, v3 } from './geometry';
import { flume, waterWheel, windmillSails, windmillTower, WINDMILL_HUB } from './mills';
import { material } from './materials';
import { drape } from './props';
import { EDGE, Frame, FRONT, patch, type Site } from './site';
import type { Junction, TownSpan } from './scenery';
import { parkedTractor, TractorRig } from './tractor';
import { parkedMotorhome } from './motorhome';

const WHEAT = 0xc4a84a;
const GREEN = 0x5a8a3a;
const PLOUGH = 0x6b4a32;
const VINE = 0x3d5c28;
const GRAVEL = 0x9a8c78;
const CROPS = [WHEAT, GREEN, PLOUGH, VINE];
/** Fallow desert plots: straw, dust, rust soil, pale sand. */
const DESERT_CROPS = [0xd2b07a, 0xc49558, 0xa56a3a, 0xe0c896];

function inTown(towns: TownSpan[], s: number, pad: number): boolean {
  return towns.some((t) => s >= t.s0 - pad && s <= t.s1 + pad);
}

function fieldPatch(site: Site, s: number, side: 1 | -1, lat0: number, lat1: number, along: number, color: number, rows = false): boolean {
  const f = new Frame(site, s, side);
  const samples: [number, number][] = [];
  for (let u = 0; u <= 4; u++) {
    for (let v = 0; v <= 3; v++) {
      const d = lat0 + ((lat1 - lat0) * v) / 3;
      const w = ((u / 4) - 0.5) * along;
      const x = f.x(d, w);
      const z = f.z(d, w);
      const h = site.ground(x, z);
      if (site.field.onLake(x, z) || site.field.blocksProp(x, z)) return false;
      if (site.water !== null && h < site.water + 1.4) return false;
      if (Math.abs(h - f.y) > 0.12 * d + 2.2) return false;
      samples.push([x, z]);
    }
  }
  if (!site.freeStrip(s - along / 2, s + along / 2, lat0, lat1, side)) return false;
  site.occupyStrip(s - along / 2, s + along / 2, lat0, lat1, side, 2);
  const spanLat = Math.abs(lat1 - lat0);
  const nu = Math.max(10, Math.ceil(along / 4));
  const nv = Math.max(6, Math.ceil(spanLat / 4));
  // Cover this cell, so a terrain vertex inside the crop cannot stand above it.
  const cover = Math.hypot(along / nu, spanLat / nv) + 1;
  const geom = drape(site.field, nu, nv, (u, v) => {
    const d = lat0 + v * (lat1 - lat0);
    const w = (u - 0.5) * along;
    return [f.x(d, w), f.z(d, w)];
  }, 0.1, undefined, cover);
  site.add(geom, color, 'ground', rows ? 0.08 : 0.04, 0.4);
  if (rows && color === VINE) {
    for (let i = 1; i < 8; i++) {
      const w = (i / 8 - 0.5) * along * 0.9;
      site.add(
        drape(site.field, 8, 1, (u) => {
          const d = lat0 + 2 + u * (lat1 - lat0 - 4);
          return [f.x(d, w), f.z(d, w)];
        }, 0.16, undefined, 6),
        0x2f4a20,
        'foliage',
        0.05,
        0,
      );
    }
  }
  void samples;
  return true;
}

function gravelLane(site: Site, s: number, side: 1 | -1, end: number): void {
  const f = new Frame(site, s, side);
  const yAt = (d: number, w: number) => Math.max(site.ground(f.x(d, w), f.z(d, w)) + 0.03, lerp(f.y + 0.01, site.ground(f.x(end, 0), f.z(end, 0)) + 0.03, smoothstep(EDGE, end, d)));
  site.add(
    patch(Math.ceil((end - EDGE) / 3), 2, (u, v) => {
      const d = EDGE - 0.1 + u * (end - EDGE + 0.1);
      const w = (v - 0.5) * 2.6;
      return v3(f.x(d, w), yAt(d, w), f.z(d, w));
    }),
    GRAVEL,
    'ground',
    0.06,
  );
}

/** Farms on the flatter valley floor: mixed fields, a yard, a mill and a working tractor. */
export function buildFarms(site: Site, towns: TownSpan[], junctions: Junction[]): void {
  const { route, rng } = site;
  const crops = route.def.scenery.biome === 'desert' ? DESERT_CROPS : CROPS;
  const treeline = route.def.scenery.treeline;
  let next = 1400;
  let farms = 0;
  while (next < route.length - 1200 && farms < 5) {
    const idx = Math.floor(next / ROUTE_DS);
    let flat = Math.abs(route.grade[idx]) < 0.035 && !route.hairpin[idx] && route.y[idx] < treeline - 140 && !site.field.isOpenRoad(idx);
    for (let k = -40; k <= 40 && flat; k += 10) {
      if (Math.abs(route.grade[(idx + k + route.count) % route.count]) > 0.05) flat = false;
    }
    if (!flat || inTown(towns, next, 180) || junctions.some((j) => Math.abs(j.idx * ROUTE_DS - next) < 80)) {
      next += 380;
      continue;
    }
    const side: 1 | -1 = rng() < 0.5 ? 1 : -1;
    const lat0 = FRONT + 8;
    const lat1 = lat0 + 28 + rng() * 18;
    const along = 42 + rng() * 28;
    const crop = crops[Math.floor(rng() * crops.length)];
    if (!fieldPatch(site, next, side, lat0, lat1, along, crop, crop === VINE || rng() < 0.4)) {
      next += 420;
      continue;
    }
    if (rng() < 0.7) fieldPatch(site, next + along * 0.55, side, lat0, lat1 - 4, along * 0.7, crops[Math.floor(rng() * crops.length)], rng() < 0.5);
    gravelLane(site, next, side, lat0 + 4);
    const yardS = next + (rng() - 0.5) * 10;
    const barn = building('barn', Math.floor(rng() * 4));
    const farmhouse = building('farmhouse', Math.floor(rng() * 4));
    const silo = building('silo', Math.floor(rng() * 3));
    site.put(farmhouse, yardS, side, lat0 + 2, { bury: 1.3 });
    site.put(barn, yardS + 14, side, lat0 + 10, { bury: 1.2 });
    site.put(silo, yardS + 20, side, lat0 + 8, { bury: 1 });
    {
      const p = site.at(yardS + 8, side * (lat0 + 6));
      site.props.place(parkedTractor(Math.floor(rng() * 4)), placement(p.x, site.ground(p.x, p.z), p.z, site.facing(yardS, side) + 0.4));
    }

    const millS = next - along * 0.35;
    const millLat = lat0 + 6;
    const millAt = site.at(millS, side * millLat);
    const millY = site.ground(millAt.x, millAt.z);
    if (site.water === null || millY > site.water + 2) {
      const yaw = site.facing(millS, side);
      site.props.place(windmillTower(Math.floor(rng() * 2)), placement(millAt.x, millY, millAt.z, yaw));
      site.occupy(millAt.x, millAt.z, yaw, 10, 10, 4);
      site.solid(millAt.x, millAt.z, yaw, 10, 10, millY, 16);
      const sails = new THREE.Group();
      for (const g of windmillSails().groups) {
        const m = new THREE.Mesh(g.geom, material(g.mat));
        m.castShadow = g.mat !== 'cloth';
        sails.add(m);
      }
      const hub = WINDMILL_HUB.clone().applyMatrix4(placement(millAt.x, millY, millAt.z, yaw));
      sails.position.copy(hub);
      sails.rotation.y = yaw;
      site.props.group.add(sails);
      site.props.onUpdate((dt) => {
        sails.rotateX(-dt * 0.55);
      }, millAt);
    }
    if (site.water !== null) {
      const wheelAt = site.at(next + 8, side * (lat0 + 2));
      if (Math.abs(site.ground(wheelAt.x, wheelAt.z) - site.water) < 4) {
        site.props.place(flume(7, 4.1), placement(wheelAt.x, site.water, wheelAt.z, site.facing(next, side)));
        const wheel = new THREE.Group();
        for (const g of waterWheel().groups) {
          const m = new THREE.Mesh(g.geom, material(g.mat));
          m.castShadow = true;
          wheel.add(m);
        }
        wheel.position.set(wheelAt.x, site.water + 1.4, wheelAt.z);
        wheel.rotation.y = site.facing(next, side);
        site.props.group.add(wheel);
        site.props.onUpdate((dt) => {
          wheel.rotateZ(dt * 0.7);
        }, wheelAt);
      }
    }

    const rig = new TractorRig(Math.floor(rng() * 4));
    site.props.group.add(rig.group);
    const f = new Frame(site, next, side);
    const pathLat0 = lat0 + 6;
    const pathLat1 = lat1 - 4;
    const half = along * 0.32;
    let travelled = rng() * 40;
    site.props.onUpdate((dt) => {
      travelled += dt * 2.4;
      const loop = (pathLat1 - pathLat0) * 2 + half * 4;
      const d = travelled % loop;
      let lat = pathLat0;
      let alongOff = -half;
      let yaw = f.yaw(0, 1);
      let steer = 0;
      const up = pathLat1 - pathLat0;
      if (d < up) {
        lat = pathLat0 + d;
        alongOff = -half;
        yaw = f.yaw(0, 1);
      } else if (d < up + half * 2) {
        lat = pathLat1;
        alongOff = -half + (d - up);
        yaw = f.yaw(1, 0);
        steer = 0.15;
      } else if (d < up * 2 + half * 2) {
        lat = pathLat1 - (d - up - half * 2);
        alongOff = half;
        yaw = f.yaw(0, -1);
      } else {
        lat = pathLat0;
        alongOff = half - (d - up * 2 - half * 2);
        yaw = f.yaw(-1, 0);
        steer = 0.15;
      }
      const x = f.x(lat, alongOff);
      const z = f.z(lat, alongOff);
      rig.pose(x, site.ground(x, z), z, yaw, 0, 0, travelled, steer);
    }, { x: f.x(0.5 * (pathLat0 + pathLat1), 0), z: f.z(0.5 * (pathLat0 + pathLat1), 0) });

    farms++;
    next += 2800 + rng() * 2400;
  }
}

/** A parked van needs a level pad, not the face of a roadside bank. */
function levelPad(site: Site, s: number, side: 1 | -1, lat: number): boolean {
  const here = site.at(s, side * lat);
  const y = site.ground(here.x, here.z);
  const road = site.at(s, 0);
  const roadY = site.ground(road.x, road.z);
  if (y - roadY > 1.1 || roadY - y > 1.6) return false;
  const further = site.at(s, side * (lat + 7));
  if (site.ground(further.x, further.z) - y > 1.4) return false;
  const nose = site.at(s + 5, side * lat);
  const tail = site.at(s - 5, side * lat);
  if (Math.abs(site.ground(nose.x, nose.z) - y) > 1.1) return false;
  if (Math.abs(site.ground(tail.x, tail.z) - y) > 1.1) return false;
  return true;
}

/** Motorhomes parked on the verge of climbs, for race days. */
export function placeMotorhomes(site: Site, climbs: { start: number; end: number }[]): void {
  const { rng } = site;
  for (const climb of climbs) {
    const len = climb.end - climb.start;
    if (len < 400) continue;
    for (let k = 0; k < 3; k++) {
      const s = climb.start + 80 + rng() * Math.min(len - 120, 900);
      const prefer: 1 | -1 = rng() < 0.5 ? 1 : -1;
      const other: 1 | -1 = prefer === 1 ? -1 : 1;
      const lat = EDGE + 3.4 + rng() * 1.2;
      let placed = false;
      for (const side of [prefer, other]) {
        if (!levelPad(site, s, side, lat)) continue;
        const p = site.at(s, side * lat);
        if (site.field.onLake(p.x, p.z) || site.field.blocksProp(p.x, p.z)) continue;
        if (!site.free(p.x, p.z, site.facing(s, side), 8, 3.2)) continue;
        const y = site.ground(p.x, p.z);
        if (site.water !== null && y < site.water + 1.2) continue;
        site.props.place(parkedMotorhome(), placement(p.x, y, p.z, site.facing(s, side) + Math.PI * (rng() < 0.5 ? 1 : 0)), {
          paint: rng() < 0.5 ? 0xf1f2f3 : rng() < 0.5 ? 0xe8d9a8 : 0x7a1528,
        });
        site.occupy(p.x, p.z, site.facing(s, side), 8, 3.2, 2);
        site.solid(p.x, p.z, site.facing(s, side), 8, 3.2, y, 3.6);
        placed = true;
        break;
      }
      if (!placed) continue;
    }
  }
}
