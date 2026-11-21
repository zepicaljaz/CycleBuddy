import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { getRoute, ROUTE_DS } from '../route';
import { REAL_CLIMB_MAP } from './data';
import { hasRealRoad, realClimbRoute } from './build';
import { findHairpins } from '../../world/climbs';
import { planTowns } from '../../world/scenery';
import { ChunkBuilder } from '../../world/terrainChunk';
import { ROAD_HALF_WIDTH, TerrainField } from '../../world/terrainField';
import { ventouxAntennaGroup } from '../../world/ventouxAntenna';

describe('Vršič on its real road', () => {
  const c = REAL_CLIMB_MAP.get('vrsic-kranjska-gora')!;
  const def = realClimbRoute(c);
  const route = getRoute(def);
  const climb = route.climbs[0];

  it('uses the OpenStreetMap line', () => {
    expect(hasRealRoad(c.id)).toBe(true);
    expect(def.track).toBeDefined();
  });

  it('starts on the way out of Kranjska Gora and keeps the published climb from the bridge', () => {
    expect(climb.start).toBe(0);
    expect(route.y[0]).toBeLessThan(850);
    const published = route.def.sections[1].length;
    expect(Math.abs(published - c.lengthKm * 1000) / (c.lengthKm * 1000)).toBeLessThan(0.02);
    const bridge = route.section.findIndex((s) => s === 1);
    expect(route.y[bridge]).toBeCloseTo(850, -1);
    expect(climb.summitElevation).toBeCloseTo(1611, -1);
    expect(Math.abs(climb.summitElevation - route.y[bridge] - c.gain)).toBeLessThan(12);
    expect(planTowns(route).some((t) => t.s0 < 800)).toBe(false);
  });

  it('puts Lake Jasna and both parking lots beside the road, in valley order', () => {
    const places = def.track!.places!;
    expect(places.lakes.map((l) => l.name)).toEqual(['Jasna']);
    expect(places.lots.map((l) => l.name)).toEqual(['Ajdovska deklica', 'Erjavčeva koča']);
    const near = (xs: number[], zs: number[]) => {
      let d = Infinity;
      let y = 0;
      let s = 0;
      for (let k = 0; k < xs.length; k++) {
        for (let i = 0; i < route.count; i += 2) {
          const dist = Math.hypot(route.x[i] - xs[k], route.z[i] - zs[k]);
          if (dist < d) {
            d = dist;
            y = route.y[i];
            s = i * ROUTE_DS;
          }
        }
      }
      return { d, y, s };
    };
    const lake = places.lakes[0];
    const water = near(lake.x, lake.z);
    const viewpoint = near(places.lots[0].x, places.lots[0].z);
    const hut = near(places.lots[1].x, places.lots[1].z);
    const bridge = route.sectionStart[1];
    const level = lake.level ?? 0;
    expect(level).toBeGreaterThan(820);
    expect(level).toBeLessThan(850);
    expect(water.d).toBeLessThan(40);
    expect(water.y).toBeGreaterThan(820);
    expect(water.y).toBeLessThan(860);
    expect(water.s).toBeGreaterThan(400);
    expect(water.s).toBeLessThan(700);
    expect(water.s).toBeLessThan(bridge);
    expect(viewpoint.d).toBeLessThan(15);
    expect(viewpoint.y).toBeGreaterThan(1200);
    expect(viewpoint.y).toBeLessThan(1480);
    expect(viewpoint.s).toBeGreaterThan(bridge);
    expect(hut.d).toBeLessThan(40);
    expect(hut.y).toBeGreaterThan(1450);
    expect(hut.y).toBeLessThan(1580);
    expect(hut.s).toBeGreaterThan(viewpoint.s);
    expect(hut.s).toBeLessThan(climb.end);

    const field = new TerrainField({ x: route.x, z: route.z, y: route.y, seed: def.seed, scenery: def.scenery, places });
    let wetH = Infinity;
    const x0 = Math.min(...lake.x);
    const x1 = Math.max(...lake.x);
    const z0 = Math.min(...lake.z);
    const z1 = Math.max(...lake.z);
    for (let x = x0; x <= x1; x += 8) {
      for (let z = z0; z <= z1; z += 8) {
        if (!field.overWater(x, z)) continue;
        if (field.roadDistance(x, z) < ROAD_HALF_WIDTH + 12) continue;
        wetH = Math.min(wetH, field.heightAt(x, z));
      }
    }
    expect(wetH).toBeLessThan(level - 0.4);
    const roadNearLake = Math.round(water.s / ROUTE_DS);
    expect(field.heightAt(route.x[roadNearLake], route.z[roadNearLake])).toBeGreaterThan(level - 0.5);
    const hutLot = places.lots[1];
    let onHut = false;
    for (let x = Math.min(...hutLot.x); x <= Math.max(...hutLot.x) && !onHut; x += 4) {
      for (let z = Math.min(...hutLot.z); z <= Math.max(...hutLot.z); z += 4) {
        if (field.onLot(x, z) && field.roadDistance(x, z) > ROAD_HALF_WIDTH + 2) {
          onHut = true;
          expect(Math.abs(field.heightAt(x, z) - hut.y)).toBeLessThan(8);
        }
      }
    }
    expect(onHut).toBe(true);
  });

  it('has the 24 numbered hairpins, counting up from the foot', () => {
    const pins = findHairpins(route, climb);
    expect(pins.length).toBe(24);
    expect(pins[0].number).toBe(1);
    expect(pins[0].idx).toBeLessThan(pins[pins.length - 1].idx);
  });

  it('closes the lap and never jumps', () => {
    let worst = 0;
    for (let i = 0; i < route.count; i++) {
      const j = (i + 1) % route.count;
      worst = Math.max(worst, Math.hypot(route.x[j] - route.x[i], route.z[j] - route.z[i]));
    }
    expect(worst).toBeLessThan(2.5);
    expect(Math.max(...Array.from(route.grade, Math.abs))).toBeLessThan(0.16);
  });
});

describe("Alpe d'Huez on its real road", () => {
  const c = REAL_CLIMB_MAP.get('alpe-dhuez-bourg-doisans')!;
  const def = realClimbRoute(c);
  const route = getRoute(def);
  const climb = route.climbs[0];

  it('uses the OpenStreetMap line', () => {
    expect(hasRealRoad(c.id)).toBe(true);
    expect(def.track).toBeDefined();
    expect(def.track?.hairpins).toBe('down');
  });

  it('keeps the published length, start and summit', () => {
    expect(Math.abs(climb.length - c.lengthKm * 1000) / (c.lengthKm * 1000)).toBeLessThan(0.02);
    expect(climb.startElevation).toBeCloseTo(728, -1);
    expect(climb.summitElevation).toBeCloseTo(1840, -1);
    expect(Math.abs(climb.gain - c.gain)).toBeLessThan(20);
  });

  it('numbers 21 hairpins down to 1 at the top', () => {
    const pins = findHairpins(route, climb);
    expect(pins.length).toBe(21);
    expect(pins[0].number).toBe(21);
    expect(pins[pins.length - 1].number).toBe(1);
    expect(pins[0].idx).toBeLessThan(pins[pins.length - 1].idx);
    // Altitudes published by the resort for bends 21, 17, 15, 12 and 1.
    const at = (n: number) => route.y[pins.find((p) => p.number === n)!.idx];
    for (const [n, elev] of [[21, 806], [17, 965], [15, 1025], [12, 1161], [1, 1713]] as const) {
      expect(Math.abs(at(n) - elev), `bend ${n}`).toBeLessThan(25);
    }
    const along = pins.map((p) => (p.idx - Math.floor(climb.start / ROUTE_DS)) * ROUTE_DS);
    for (let i = 1; i < along.length; i++) expect(along[i] - along[i - 1]).toBeGreaterThan(80);
  });

  it("has Bourg-d'Oisans at the foot and a small resort at the top", () => {
    const towns = planTowns(route);
    const foot = towns.find((t) => t.name === "Bourg-d'Oisans");
    const top = towns.find((t) => t.name === "L'Alpe d'Huez");
    expect(foot).toBeDefined();
    expect(foot!.s0).toBeLessThan(50);
    expect(foot!.s1).toBeGreaterThan(400);
    expect(foot!.s1).toBeLessThan(700);
    expect(top).toBeDefined();
    expect(top!.s0).toBeGreaterThan(climb.length - 800);
    expect(top!.s1).toBeLessThanOrEqual(climb.length + 40);
    expect(top!.s1 - top!.s0).toBeGreaterThan(400);
    expect(top!.s1 - top!.s0).toBeLessThan(700);
  });

  it('closes the lap and never jumps', () => {
    let worst = 0;
    for (let i = 0; i < route.count; i++) {
      const j = (i + 1) % route.count;
      worst = Math.max(worst, Math.hypot(route.x[j] - route.x[i], route.z[j] - route.z[i]));
    }
    expect(worst).toBeLessThan(2.5);
    expect(Math.max(...Array.from(route.grade, Math.abs))).toBeLessThan(0.16);
  });
});

describe('Passo dello Stelvio from Prato on its real road', () => {
  const c = REAL_CLIMB_MAP.get('stelvio-prato')!;
  const def = realClimbRoute(c);
  const route = getRoute(def);
  const climb = route.climbs[0];

  it('uses the OpenStreetMap line of the SS 38', () => {
    expect(hasRealRoad(c.id)).toBe(true);
    expect(def.track).toBeDefined();
    expect(def.track?.hairpins).toBe('down');
  });

  it('keeps the published length, start, summit and gain', () => {
    expect(Math.abs(climb.length - c.lengthKm * 1000) / (c.lengthKm * 1000)).toBeLessThan(0.02);
    expect(climb.startElevation).toBeCloseTo(916, 0);
    expect(climb.summitElevation).toBeCloseTo(2758, 0);
    expect(Math.abs(climb.gain - c.gain)).toBeLessThan(5);
  });

  it('rides each published kilometre at that gradient', () => {
    const i0 = Math.floor(climb.start / ROUTE_DS);
    for (let k = 0; k < c.kmGrades.length - 1; k++) {
      const a = i0 + Math.round((k * 1000) / ROUTE_DS);
      const b = i0 + Math.round(((k + 1) * 1000) / ROUTE_DS);
      const grade = ((route.y[b] - route.y[a]) / ((b - a) * ROUTE_DS)) * 100;
      expect(Math.abs(grade - c.kmGrades[k]), `km ${k}`).toBeLessThan(0.35);
    }
  });

  it('numbers 48 hairpins down to 1 at the pass', () => {
    const pins = findHairpins(route, climb);
    expect(pins.length).toBe(48);
    expect(pins[0].number).toBe(48);
    expect(pins[pins.length - 1].number).toBe(1);
    const along = pins.map((p) => (p.idx - Math.floor(climb.start / ROUTE_DS)) * ROUTE_DS);
    for (let i = 1; i < along.length; i++) expect(along[i]).toBeGreaterThan(along[i - 1]);
    // 48 and 47 are the pair after Gomagoi, before Trafoi. 1 is the last bend before the pass.
    const gomagoi = planTowns(route).find((t) => t.name === 'Gomagoi')!;
    const trafoi = planTowns(route).find((t) => t.name === 'Trafoi')!;
    expect(climb.start + along[0]).toBeGreaterThan(gomagoi.s1);
    expect(climb.start + along[0]).toBeLessThan(trafoi.s0);
    expect(along[1] - along[0]).toBeLessThan(200);
    expect(along[along.length - 1]).toBeGreaterThan(climb.length - 800);
    // 46 and 45 are the two bends in Trafoi.
    expect(climb.start + along[2]).toBeGreaterThan(trafoi.s0 - 200);
    expect(climb.start + along[3]).toBeLessThan(trafoi.s1 + 250);
  });

  it('has Prato at the foot, then Ponte, Gomagoi and Trafoi', () => {
    const towns = planTowns(route);
    const at = (name: string) => towns.find((t) => t.name === name)!;
    const prato = at('Prato allo Stelvio');
    expect(prato.s1 - prato.s0).toBeLessThan(900);
    expect(prato.s0).toBeGreaterThan(900);
    expect(prato.s0).toBeLessThan(climb.start + 200);
    expect(prato.s1).toBeGreaterThan(climb.start);
    expect(at('Ponte di Stelvio').s0).toBeGreaterThan(5000);
    expect(at('Ponte di Stelvio').s1).toBeLessThan(6500);
    expect(at('Gomagoi').s0).toBeGreaterThan(7000);
    expect(at('Gomagoi').s1).toBeLessThan(9000);
    expect(at('Trafoi').s0).toBeGreaterThan(11000);
    expect(at('Trafoi').s1).toBeLessThan(13000);
  });

  it('closes the lap and never jumps', () => {
    let worst = 0;
    for (let i = 0; i < route.count; i++) {
      const j = (i + 1) % route.count;
      worst = Math.max(worst, Math.hypot(route.x[j] - route.x[i], route.z[j] - route.z[i]));
    }
    expect(worst).toBeLessThan(2.5);
    expect(Math.max(...Array.from(route.grade, Math.abs))).toBeLessThan(0.16);
  });
});

describe('Mont Ventoux from Bédoin on its real road', () => {
  const c = REAL_CLIMB_MAP.get('ventoux-bedoin')!;
  const def = realClimbRoute(c);
  const route = getRoute(def);
  const climb = route.climbs[0];
  const origin = (def.track as { origin?: { lat: number; lon: number } }).origin!;
  const R = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const xz = (lat: number, lon: number) => ({
    x: rad(lon - origin.lon) * Math.cos(rad(origin.lat)) * R,
    z: -rad(lat - origin.lat) * R,
  });
  /** Closest sample on the way up. */
  const nearest = (lat: number, lon: number) => {
    const p = xz(lat, lon);
    const a = Math.floor(climb.start / ROUTE_DS);
    const b = Math.floor(climb.end / ROUTE_DS);
    let d = Infinity;
    let idx = a;
    for (let i = a; i <= b; i++) {
      const dist = Math.hypot(route.x[i] - p.x, route.z[i] - p.z);
      if (dist < d) {
        d = dist;
        idx = i;
      }
    }
    return { d, idx, along: (idx - a) * ROUTE_DS, y: route.y[idx] };
  };

  it('uses the OpenStreetMap line of the D 974', () => {
    expect(hasRealRoad(c.id)).toBe(true);
    expect(def.track).toBeDefined();
    expect(def.scenery.biome).toBe('limestone');
    expect(def.scenery.treeline).toBe(1500);
    expect(def.scenery.screeLine).toBe(1520);
    expect(planTowns(route)).toEqual([]);
  });

  it('keeps the published length, start, summit and each kilometre', () => {
    expect(Math.abs(climb.length - c.lengthKm * 1000) / (c.lengthKm * 1000)).toBeLessThan(0.02);
    expect(climb.startElevation).toBeCloseTo(314, 0);
    expect(climb.summitElevation).toBeCloseTo(1903, 0);
    expect(Math.abs(climb.gain - c.gain)).toBeLessThan(8);
    const i0 = Math.floor(climb.start / ROUTE_DS);
    for (let k = 0; k < c.kmGrades.length - 1; k++) {
      const a = i0 + Math.round((k * 1000) / ROUTE_DS);
      const b = i0 + Math.round(((k + 1) * 1000) / ROUTE_DS);
      const grade = ((route.y[b] - route.y[a]) / ((b - a) * ROUTE_DS)) * 100;
      expect(Math.abs(grade - c.kmGrades[k]), `km ${k + 1}`).toBeLessThan(0.35);
    }
  });

  it('passes the real bends and the chalet, and stops at the road summit', () => {
    // The roundabout where the D 974 leaves the D 19, the two named bends,
    // the road at Chalet Reynard, and the vertex at the top of the road.
    const start = nearest(44.1252611, 5.180346);
    const esteve = nearest(44.11354, 5.23971);
    const bois = nearest(44.12874, 5.28376);
    const chalet = nearest(44.15217, 5.31874);
    const summit = nearest(44.1733027, 5.2784022);
    expect(start.d).toBeLessThan(20);
    expect(start.along).toBeLessThan(40);
    expect(start.y).toBeCloseTo(314, 0);
    expect(esteve.d, 'Saint-Estève').toBeLessThan(25);
    expect(esteve.along).toBeGreaterThan(5400);
    expect(esteve.along).toBeLessThan(6000);
    expect(esteve.y).toBeGreaterThan(520);
    expect(esteve.y).toBeLessThan(570);
    expect(bois.d, 'Virage du Bois').toBeLessThan(25);
    expect(bois.along).toBeGreaterThan(10000);
    expect(bois.along).toBeLessThan(10800);
    expect(bois.y).toBeGreaterThan(960);
    expect(bois.y).toBeLessThan(1040);
    expect(chalet.d, 'Chalet Reynard').toBeLessThan(30);
    expect(chalet.along).toBeGreaterThan(14800);
    expect(chalet.along).toBeLessThan(15600);
    expect(chalet.along).toBeGreaterThan(esteve.along);
    expect(summit.d).toBeLessThan(20);
    expect(summit.y).toBeCloseTo(1903, 0);
    expect(climb.end - summit.idx * ROUTE_DS).toBeLessThan(40);
    // The north road toward Malaucène is not part of the ride.
    const malaucene = xz(44.173, 5.132);
    let west = Infinity;
    for (let i = 0; i < route.count; i += 4) west = Math.min(west, Math.hypot(route.x[i] - malaucene.x, route.z[i] - malaucene.z));
    expect(west).toBeGreaterThan(3000);
  });

  it('turns at the summit and comes back down the same road', () => {
    const up = Math.floor((climb.start + 8000) / ROUTE_DS);
    let back = Infinity;
    for (let i = Math.floor(climb.end / ROUTE_DS) + 20; i < route.count; i += 2) {
      back = Math.min(back, Math.hypot(route.x[i] - route.x[up], route.z[i] - route.z[up]));
    }
    expect(back).toBeLessThan(6);
    expect(route.y[Math.floor(climb.end / ROUTE_DS)]).toBeCloseTo(1903, 0);
  });

  it('closes the lap and never jumps', () => {
    let worst = 0;
    for (let i = 0; i < route.count; i++) {
      const j = (i + 1) % route.count;
      worst = Math.max(worst, Math.hypot(route.x[j] - route.x[i], route.z[j] - route.z[i]));
    }
    expect(worst).toBeLessThan(2.5);
    expect(Math.max(...Array.from(route.grade, Math.abs))).toBeLessThan(0.16);
  });

  it('stands the transmitter off the road on the summit knob', () => {
    const field = new TerrainField({ x: route.x, z: route.z, y: route.y, seed: def.seed, scenery: def.scenery });
    const group = ventouxAntennaGroup(route, field);
    expect(group?.name).toBe('ventoux-antenna');
    const box = new THREE.Box3().setFromObject(group!);
    expect(box.max.y - box.min.y).toBeGreaterThan(60);
    const cx = (box.min.x + box.max.x) / 2;
    const cz = (box.min.z + box.max.z) / 2;
    let d = Infinity;
    const a = Math.floor((climb.end - 120) / ROUTE_DS);
    const b = Math.min(route.count - 1, Math.ceil((climb.end + 280) / ROUTE_DS));
    for (let i = a; i <= b; i++) d = Math.min(d, Math.hypot(route.x[i] - cx, route.z[i] - cz));
    expect(d).toBeGreaterThan(ROAD_HALF_WIDTH + 8);
    expect(d).toBeLessThan(50);
    const peak = xz(44.17396, 5.2784);
    expect(Math.hypot(cx - peak.x, cz - peak.z)).toBeLessThan(90);
    expect(box.min.y).toBeGreaterThan(climb.summitElevation - 40);
    expect(box.max.y).toBeGreaterThan(climb.summitElevation + 50);
    expect(ventouxAntennaGroup(getRoute(realClimbRoute(REAL_CLIMB_MAP.get('vrsic-kranjska-gora')!)), field)).toBeNull();
  });
});

describe('Col du Tourmalet from Luz-Saint-Sauveur on its real road', () => {
  const c = REAL_CLIMB_MAP.get('tourmalet-luz')!;
  const def = realClimbRoute(c);
  const route = getRoute(def);
  const climb = route.climbs[0];
  const origin = (def.track as { origin?: { lat: number; lon: number } }).origin!;
  const R = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const xz = (lat: number, lon: number) => ({
    x: rad(lon - origin.lon) * Math.cos(rad(origin.lat)) * R,
    z: -rad(lat - origin.lat) * R,
  });
  const nearest = (lat: number, lon: number) => {
    const p = xz(lat, lon);
    const a = Math.floor(climb.start / ROUTE_DS);
    const b = Math.floor(climb.end / ROUTE_DS);
    let d = Infinity;
    let idx = a;
    for (let i = a; i <= b; i++) {
      const dist = Math.hypot(route.x[i] - p.x, route.z[i] - p.z);
      if (dist < d) {
        d = dist;
        idx = i;
      }
    }
    return { d, idx, along: (idx - a) * ROUTE_DS, y: route.y[idx] };
  };

  it('uses the OpenStreetMap line of the D 918', () => {
    expect(hasRealRoad(c.id)).toBe(true);
    expect(def.track).toBeDefined();
    expect(def.track?.hairpins).toBe('up');
  });

  it('keeps the published length, start, summit and each kilometre', () => {
    expect(Math.abs(climb.length - c.lengthKm * 1000) / (c.lengthKm * 1000)).toBeLessThan(0.02);
    expect(climb.startElevation).toBeCloseTo(711, 0);
    expect(climb.summitElevation).toBeCloseTo(2115, 0);
    expect(Math.abs(climb.gain - c.gain)).toBeLessThan(12);
    const i0 = Math.floor(climb.start / ROUTE_DS);
    // The published kilometres are laid along the real line, which is 0.9% shorter.
    const scale = climb.length / (c.lengthKm * 1000);
    for (let k = 0; k < c.kmGrades.length; k++) {
      const a = i0 + Math.round((k * 1000 * scale) / ROUTE_DS);
      const endM = Math.min((k + 1) * 1000, c.lengthKm * 1000) * scale;
      const b = i0 + Math.round(endM / ROUTE_DS);
      const grade = ((route.y[b] - route.y[a]) / ((b - a) * ROUTE_DS)) * 100;
      expect(Math.abs(grade - c.kmGrades[k]), `km ${k + 1}`).toBeLessThan(0.35);
    }
  });

  it('follows the D 918 through Barèges and stops on the pass', () => {
    const start = nearest(42.8732265, -0.0032656);
    const esterre = nearest(42.8749, 0.00608);
    const ramond = nearest(42.896581, 0.0643815);
    const bareges = nearest(42.89588, 0.06224);
    const superBareges = nearest(42.90528, 0.13155);
    const summit = nearest(42.9083884, 0.145297);
    expect(start.d).toBeLessThan(25);
    expect(start.along).toBeLessThan(40);
    expect(start.y).toBeCloseTo(711, 0);
    expect(esterre.d, 'Esterre').toBeLessThan(30);
    expect(esterre.along).toBeGreaterThan(700);
    expect(esterre.along).toBeLessThan(1100);
    expect(esterre.y).toBeGreaterThan(720);
    expect(esterre.y).toBeLessThan(820);
    expect(ramond.d, 'Rue Ramond').toBeLessThan(20);
    expect(ramond.along).toBeGreaterThan(bareges.along);
    expect(ramond.y).toBeGreaterThan(1120);
    expect(ramond.y).toBeLessThan(1280);
    expect(bareges.d, 'Barèges').toBeLessThan(45);
    expect(bareges.along).toBeGreaterThan(6800);
    expect(bareges.along).toBeLessThan(7600);
    expect(superBareges.d, 'the road above Barèges').toBeLessThan(60);
    expect(superBareges.along).toBeGreaterThan(13500);
    expect(superBareges.along).toBeLessThan(15000);
    expect(superBareges.y).toBeGreaterThan(1650);
    expect(superBareges.y).toBeLessThan(1800);
    expect(summit.d).toBeLessThan(20);
    expect(summit.y).toBeCloseTo(2115, 0);
    expect(climb.end - summit.idx * ROUTE_DS).toBeLessThan(50);
    const mongie = xz(42.9102, 0.175);
    let east = Infinity;
    for (let i = 0; i < route.count; i += 4) east = Math.min(east, Math.hypot(route.x[i] - mongie.x, route.z[i] - mongie.z));
    expect(east).toBeGreaterThan(1500);
  });

  it('has Luz, Esterre, Cabadur and a short Barèges, and no town above it', () => {
    const towns = planTowns(route);
    const at = (name: string) => towns.find((t) => t.name === name)!;
    const luz = at('Luz-Saint-Sauveur');
    const esterre = at('Esterre');
    const cabadur = at('Cabadur');
    const bareges = at('Barèges');
    expect(towns.map((t) => t.name)).toEqual(['Luz-Saint-Sauveur', 'Esterre', 'Cabadur', 'Barèges']);
    expect(luz.s0).toBeLessThan(40);
    expect(luz.s1).toBeGreaterThan(400);
    expect(luz.s1).toBeLessThan(600);
    expect(esterre.s0).toBeGreaterThan(luz.s1);
    expect(esterre.s0).toBeGreaterThan(650);
    expect(esterre.s1).toBeLessThan(1200);
    expect(cabadur.s0).toBeGreaterThan(5000);
    expect(cabadur.s1).toBeLessThan(6500);
    expect(bareges.s0).toBeGreaterThan(cabadur.s1);
    expect(bareges.s0).toBeGreaterThan(6600);
    expect(bareges.s1).toBeLessThan(7600);
    expect(bareges.s1 - bareges.s0).toBeLessThan(800);
    const luzY = route.y[Math.round(luz.s0 / ROUTE_DS)];
    const baregesY = route.y[Math.round(((bareges.s0 + bareges.s1) / 2) / ROUTE_DS)];
    expect(luzY).toBeCloseTo(711, -1);
    expect(baregesY).toBeGreaterThan(1100);
    expect(baregesY).toBeLessThan(1280);
    expect(def.scenery.treeline).toBe(1280);
    expect(def.scenery.forestDensity).toBeCloseTo(0.42);
    expect(def.scenery.pasture).toBe(true);
  });

  it('numbers the sharp bends up from the foot', () => {
    const pins = findHairpins(route, climb);
    expect(pins[0].number).toBe(1);
    expect(pins[pins.length - 1].number).toBe(pins.length);
    expect(pins[0].idx).toBeLessThan(pins[pins.length - 1].idx);
    const along = pins.map((p) => (p.idx - Math.floor(climb.start / ROUTE_DS)) * ROUTE_DS);
    expect(along[0], along.map((m) => Math.round(m)).join(',')).toBeGreaterThan(2500);
    for (let i = 1; i < along.length; i++) expect(along[i]).toBeGreaterThan(along[i - 1]);
    expect(along[along.length - 1]).toBeGreaterThan(climb.length - 2500);
  });

  it('turns at the pass and comes back down the same road', () => {
    const up = Math.floor((climb.start + 8000) / ROUTE_DS);
    let back = Infinity;
    for (let i = Math.floor(climb.end / ROUTE_DS) + 30; i < route.count; i += 2) {
      back = Math.min(back, Math.hypot(route.x[i] - route.x[up], route.z[i] - route.z[up]));
    }
    expect(back).toBeLessThan(6);
    expect(route.y[Math.floor(climb.end / ROUTE_DS)]).toBeCloseTo(2115, 0);
  });

  it('closes the lap and never jumps', () => {
    let worst = 0;
    for (let i = 0; i < route.count; i++) {
      const j = (i + 1) % route.count;
      worst = Math.max(worst, Math.hypot(route.x[j] - route.x[i], route.z[j] - route.z[i]));
    }
    expect(worst).toBeLessThan(2.5);
    expect(Math.max(...Array.from(route.grade, Math.abs))).toBeLessThan(0.16);
  });
});

describe("Alto de l'Angliru from La Vega on its real road", () => {
  const c = REAL_CLIMB_MAP.get('angliru-la-vega')!;
  const def = realClimbRoute(c);
  const route = getRoute(def);
  const climb = route.climbs[0];
  const origin = (def.track as { origin?: { lat: number; lon: number } }).origin!;
  const R = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const xz = (lat: number, lon: number) => ({
    x: rad(lon - origin.lon) * Math.cos(rad(origin.lat)) * R,
    z: -rad(lat - origin.lat) * R,
  });
  const nearest = (lat: number, lon: number) => {
    const p = xz(lat, lon);
    let d = Infinity;
    let idx = 0;
    const from = Math.floor(climb.start / ROUTE_DS);
    const to = Math.min(route.count - 1, Math.floor((climb.end + 1200) / ROUTE_DS));
    for (let i = from; i <= to; i++) {
      const dist = Math.hypot(route.x[i] - p.x, route.z[i] - p.z);
      if (dist < d) {
        d = dist;
        idx = i;
      }
    }
    return { d, idx, along: (idx - from) * ROUTE_DS, y: route.y[idx] };
  };

  it('uses the OpenStreetMap line from La Vega to the summit parking', () => {
    expect(hasRealRoad(c.id)).toBe(true);
    expect(def.track).toBeDefined();
    expect(def.track?.hairpins).toBe('down');
    expect(def.track?.places?.lots.map((l) => l.name)).toEqual(["Aparcamiento L'Angliru"]);
  });

  it('keeps the published length, start, summit and gain', () => {
    expect(Math.abs(climb.length - c.lengthKm * 1000) / (c.lengthKm * 1000)).toBeLessThan(0.02);
    expect(climb.startElevation).toBeCloseTo(322, 0);
    expect(climb.summitElevation).toBeCloseTo(1570, 0);
    expect(Math.abs(climb.gain - c.gain)).toBeLessThan(8);
  });

  it('rides each published kilometre at that gradient', () => {
    const i0 = Math.floor(climb.start / ROUTE_DS);
    for (let k = 0; k < c.kmGrades.length; k++) {
      const len = k === c.kmGrades.length - 1 ? c.lastKmLength * 1000 : 1000;
      const a = i0 + Math.round((k * 1000) / ROUTE_DS);
      const b = i0 + Math.round((k * 1000 + len) / ROUTE_DS);
      const grade = ((route.y[b] - route.y[a]) / ((b - a) * ROUTE_DS)) * 100;
      expect(Math.abs(grade - c.kmGrades[k]), `km ${k}`).toBeLessThan(0.4);
    }
  });

  it('follows the road through Les Cabanes and Cueña les Cabres to the parking', () => {
    const start = nearest(43.2307334, -5.8821195);
    const cabanes = nearest(43.2421215, -5.9271348);
    const cuena = nearest(43.2335059, -5.9384352);
    const summit = nearest(43.2256877, -5.9380347);
    const parking = nearest(43.221642, -5.941796);
    expect(start.d).toBeLessThan(25);
    expect(start.along).toBeLessThan(40);
    expect(start.y).toBeCloseTo(322, 0);
    expect(cabanes.d, 'Cuesta Les Cabanes').toBeLessThan(30);
    expect(cabanes.along).toBeGreaterThan(6400);
    expect(cabanes.along).toBeLessThan(7500);
    expect(cabanes.y).toBeGreaterThan(750);
    expect(cabanes.y).toBeLessThan(950);
    expect(cuena.d, 'La Cueña Les Cabres').toBeLessThan(25);
    expect(cuena.along).toBeGreaterThan(10000);
    expect(cuena.along).toBeLessThan(11200);
    expect(cuena.y).toBeGreaterThan(1200);
    expect(cuena.y).toBeLessThan(1450);
    expect(cuena.along).toBeGreaterThan(cabanes.along);
    expect(summit.d).toBeLessThan(25);
    // The tagged 1,570 m node is just short of the published 12.55 km, which ends further up this road.
    expect(summit.y).toBeGreaterThan(1540);
    expect(summit.y).toBeLessThan(1575);
    expect(climb.end - summit.idx * ROUTE_DS).toBeGreaterThan(60);
    expect(climb.end - summit.idx * ROUTE_DS).toBeLessThan(250);
    expect(parking.d).toBeLessThan(20);
    expect(parking.along).toBeGreaterThan(climb.length);
    expect(parking.along).toBeLessThan(climb.length + 900);
    expect(parking.y).toBeGreaterThan(1555);
    expect(parking.y).toBeLessThan(1580);
  });

  it('has La Vega at the foot', () => {
    const towns = planTowns(route);
    const vega = towns.find((t) => t.name === 'La Vega');
    expect(vega).toBeDefined();
    expect(vega!.s0).toBeLessThan(80);
    expect(vega!.s1).toBeGreaterThan(400);
    expect(vega!.s1).toBeLessThan(700);
  });

  it('numbers the sharp bends down toward the top', () => {
    const pins = findHairpins(route, climb);
    expect(pins.length).toBeGreaterThan(8);
    expect(pins[0].number).toBe(pins.length);
    expect(pins[pins.length - 1].number).toBe(1);
    expect(pins[0].idx).toBeLessThan(pins[pins.length - 1].idx);
  });

  it('turns in the summit parking and comes back down the same road', () => {
    const up = Math.floor((climb.start + 8000) / ROUTE_DS);
    let back = Infinity;
    for (let i = Math.floor(climb.end / ROUTE_DS) + 30; i < route.count; i += 2) {
      back = Math.min(back, Math.hypot(route.x[i] - route.x[up], route.z[i] - route.z[up]));
    }
    expect(back).toBeLessThan(6);
    expect(route.length).toBeGreaterThan(26_000);
  });

  it('closes the lap and keeps the steep kilometre', () => {
    let worst = 0;
    for (let i = 0; i < route.count; i++) {
      const j = (i + 1) % route.count;
      worst = Math.max(worst, Math.hypot(route.x[j] - route.x[i], route.z[j] - route.z[i]));
    }
    expect(worst).toBeLessThan(2.5);
    const max = Math.max(...Array.from(route.grade, Math.abs));
    expect(max).toBeGreaterThan(0.16);
    expect(max).toBeLessThan(0.2);
  });

  it('opens only the flat kilometre at Viapará, and keeps the woods above it', () => {
    expect(def.scenery.treeline).toBe(1500);
    expect(def.scenery.pastureAbove).toBeUndefined();
    expect(def.scenery.forestDensity).toBeCloseTo(0.78);
    expect(def.scenery.openAlong).toEqual([{ fromM: 5000, toM: 6000, radius: 80 }]);
    const field = new TerrainField({
      x: route.x,
      z: route.z,
      y: route.y,
      seed: def.seed,
      scenery: def.scenery,
      places: def.track!.places,
    });
    const side = (along: number, metres: number) => {
      const i = Math.floor((climb.start + along) / ROUTE_DS);
      const dx = route.x[i + 1] - route.x[i - 1];
      const dz = route.z[i + 1] - route.z[i - 1];
      const len = Math.hypot(dx, dz) || 1;
      const x = route.x[i] + (-dz / len) * metres;
      const z = route.z[i] + (dx / len) * metres;
      return { x, z, h: field.heightAt(x, z) };
    };
    for (const along of [5200, 5600, 5900]) {
      for (const metres of [16, -24]) {
        const p = side(along, metres);
        expect(field.groundCover(p.x, p.z, p.h), `${along} m`).toBe('pasture');
      }
    }
    for (const along of [1800, 4200, 6800, 10500]) {
      const p = side(along, 20);
      expect(field.groundCover(p.x, p.z, p.h), `${along} m`).toBe('forest');
    }
    const treesAt = (along: number) => {
      const i = Math.floor((climb.start + along) / ROUTE_DS);
      const chunk = new ChunkBuilder(field, def.seed).build({
        id: 1,
        x0: route.x[i] - 40,
        z0: route.z[i] - 40,
        size: 80,
        segs: 6,
        treeSpacing: 9,
        propDetail: 1,
        treeScale: 1,
      });
      let trees = 0;
      for (let k = 5; k < chunk.props.length; k += 6) if (chunk.props[k] < 2) trees++;
      return trees;
    };
    expect(treesAt(5500)).toBe(0);
    expect(treesAt(7500)).toBeGreaterThan(8);
  });
});

describe('Col du Galibier from Valloire on its real road', () => {
  const c = REAL_CLIMB_MAP.get('galibier-valloire')!;
  const def = realClimbRoute(c);
  const route = getRoute(def);
  const climb = route.climbs[0];
  const origin = (def.track as { origin?: { lat: number; lon: number } }).origin!;
  const R = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const xz = (lat: number, lon: number) => ({
    x: rad(lon - origin.lon) * Math.cos(rad(origin.lat)) * R,
    z: -rad(lat - origin.lat) * R,
  });
  const nearest = (lat: number, lon: number) => {
    const p = xz(lat, lon);
    const a = Math.floor(climb.start / ROUTE_DS);
    const b = Math.floor(climb.end / ROUTE_DS);
    let d = Infinity;
    let idx = a;
    for (let i = a; i <= b; i++) {
      const dist = Math.hypot(route.x[i] - p.x, route.z[i] - p.z);
      if (dist < d) {
        d = dist;
        idx = i;
      }
    }
    return { d, idx, along: (idx - a) * ROUTE_DS, y: route.y[idx] };
  };

  it('uses the OpenStreetMap line of the D 902', () => {
    expect(hasRealRoad(c.id)).toBe(true);
    expect(def.track).toBeDefined();
    expect(def.track?.hairpins).toBe('down');
  });

  it('keeps the published length, start, summit and each kilometre', () => {
    expect(Math.abs(climb.length - c.lengthKm * 1000) / (c.lengthKm * 1000)).toBeLessThan(0.02);
    expect(climb.startElevation).toBeCloseTo(1406, 0);
    expect(climb.summitElevation).toBeCloseTo(2642, 0);
    expect(Math.abs(climb.gain - c.gain)).toBeLessThan(5);
    const i0 = Math.floor(climb.start / ROUTE_DS);
    for (let k = 0; k < c.kmGrades.length - 1; k++) {
      const a = i0 + Math.round((k * 1000) / ROUTE_DS);
      const b = i0 + Math.round(((k + 1) * 1000) / ROUTE_DS);
      const grade = ((route.y[b] - route.y[a]) / ((b - a) * ROUTE_DS)) * 100;
      expect(Math.abs(grade - c.kmGrades[k]), `km ${k}`).toBeLessThan(0.4);
    }
  });

  it('starts in Valloire centre, passes Plan Lachat and Les Granges, and ends at the pass', () => {
    const centre = nearest(45.164321, 6.429875);
    const lachat = nearest(45.09024, 6.43542);
    const granges = nearest(45.07997, 6.42209);
    expect(centre.d).toBeLessThan(20);
    expect(centre.along).toBeLessThan(80);
    expect(centre.y).toBeCloseTo(1406, 0);
    expect(lachat.d).toBeLessThan(15);
    expect(lachat.along).toBeGreaterThan(9000);
    expect(lachat.along).toBeLessThan(10200);
    expect(lachat.y).toBeGreaterThan(1920);
    expect(lachat.y).toBeLessThan(2010);
    expect(granges.d).toBeLessThan(20);
    expect(granges.along).toBeGreaterThan(13000);
    expect(granges.y).toBeGreaterThan(2250);
    expect(granges.y).toBeLessThan(2350);
    const towns = planTowns(route);
    expect(towns.map((t) => t.name)).toEqual(['Valloire', 'Plan Lachat', 'Les Granges du Galibier']);
  });

  it('puts the summit parking beside the pass', () => {
    const lot = def.track!.places!.lots[0];
    expect(lot.name).toBe('Col du Galibier');
    const top = Math.floor(climb.end / ROUTE_DS);
    let d = Infinity;
    for (let k = 0; k < lot.x.length; k++) d = Math.min(d, Math.hypot(route.x[top] - lot.x[k], route.z[top] - lot.z[k]));
    expect(d).toBeLessThan(40);
  });

  it('numbers the sharp bends down toward the pass, with the last lacets above the tunnel', () => {
    const pins = findHairpins(route, climb);
    expect(pins.length).toBeGreaterThan(8);
    expect(pins[0].number).toBe(pins.length);
    expect(pins[pins.length - 1].number).toBe(1);
    const along = pins.map((p) => (p.idx - Math.floor(climb.start / ROUTE_DS)) * ROUTE_DS);
    expect(along[0]).toBeGreaterThan(4000);
    expect(route.y[pins[0].idx]).toBeGreaterThan(1600);
    const high = pins.filter((p) => route.y[p.idx] > 2500);
    expect(high.length).toBeGreaterThan(2);
    expect(along[along.length - 1]).toBeGreaterThan(climb.length - 1200);
  });

  it('turns at the pass and comes back down the same road', () => {
    const up = Math.floor((climb.start + 8000) / ROUTE_DS);
    let back = Infinity;
    for (let i = Math.floor(climb.end / ROUTE_DS) + 30; i < route.count; i += 2) {
      back = Math.min(back, Math.hypot(route.x[i] - route.x[up], route.z[i] - route.z[up]));
    }
    expect(back).toBeLessThan(6);
    expect(route.y[Math.floor(climb.end / ROUTE_DS)]).toBeCloseTo(2642, 0);
  });

  it('closes the lap and never jumps', () => {
    let worst = 0;
    for (let i = 0; i < route.count; i++) {
      const j = (i + 1) % route.count;
      worst = Math.max(worst, Math.hypot(route.x[j] - route.x[i], route.z[j] - route.z[i]));
    }
    expect(worst).toBeLessThan(2.5);
    expect(Math.max(...Array.from(route.grade, Math.abs))).toBeLessThan(0.16);
  });
});

describe('Passo Giau from Selva di Cadore on its real road', () => {
  const c = REAL_CLIMB_MAP.get('giau-selva')!;
  const def = realClimbRoute(c);
  const route = getRoute(def);
  const climb = route.climbs[0];
  const origin = (def.track as { origin?: { lat: number; lon: number } }).origin!;
  const R = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const xz = (lat: number, lon: number) => ({
    x: rad(lon - origin.lon) * Math.cos(rad(origin.lat)) * R,
    z: -rad(lat - origin.lat) * R,
  });
  /** Closest sample on the way up, from the valley end to the pass. */
  const nearest = (lat: number, lon: number) => {
    const p = xz(lat, lon);
    const b = Math.floor(climb.end / ROUTE_DS);
    let d = Infinity;
    let idx = 0;
    for (let i = 0; i <= b; i++) {
      const dist = Math.hypot(route.x[i] - p.x, route.z[i] - p.z);
      if (dist < d) {
        d = dist;
        idx = i;
      }
    }
    return { d, idx, along: idx * ROUTE_DS, y: route.y[idx] };
  };

  it('uses the OpenStreetMap line of the SP 638', () => {
    expect(hasRealRoad(c.id)).toBe(true);
    expect(def.track).toBeDefined();
    expect(def.track?.hairpins).toBe('down');
    expect(def.scenery.biome).toBe('limestone');
    expect(def.scenery.treeline).toBe(2000);
  });

  it('keeps the published start, summit and gain on the mapped road', () => {
    // The cols-cyclisme drawing is 10.12 km. The SP 638 from the village junction is 9.76 km.
    expect(Math.abs(climb.length - c.lengthKm * 1000) / (c.lengthKm * 1000)).toBeLessThan(0.04);
    expect(climb.length).toBeGreaterThan(9600);
    expect(climb.startElevation).toBeCloseTo(1314, 0);
    expect(climb.summitElevation).toBeCloseTo(2236, 0);
    expect(Math.abs(climb.gain - c.gain)).toBeLessThan(8);
    const i0 = Math.floor(climb.start / ROUTE_DS);
    for (let k = 0; k < c.kmGrades.length - 1; k++) {
      const a = i0 + Math.round((k * 1000) / ROUTE_DS);
      const b = i0 + Math.round(((k + 1) * 1000) / ROUTE_DS);
      const grade = ((route.y[b] - route.y[a]) / ((b - a) * ROUTE_DS)) * 100;
      expect(Math.abs(grade - c.kmGrades[k]), `km ${k + 1}`).toBeLessThan(0.8);
    }
  });

  it('numbers 29 hairpins down to 1 at the pass', () => {
    const pins = findHairpins(route, climb);
    expect(pins.length).toBe(29);
    expect(pins[0].number).toBe(29);
    expect(pins[pins.length - 1].number).toBe(1);
    const along = pins.map((p) => (p.idx - Math.floor(climb.start / ROUTE_DS)) * ROUTE_DS);
    for (let i = 1; i < along.length; i++) expect(along[i]).toBeGreaterThan(along[i - 1]);
    expect(along[0]).toBeGreaterThan(80);
    expect(along[0]).toBeLessThan(1500);
    expect(along[along.length - 1]).toBeGreaterThan(climb.length - 700);
  });

  it('leaves Selva, passes the galleries and Fedare, and stops at the pass', () => {
    const start = nearest(46.4560665, 12.0318092);
    const junction = nearest(46.4562732, 12.0315927);
    const fedare = nearest(46.487493, 12.0340061);
    const pass = nearest(46.4825196, 12.053666);
    expect(start.d).toBeLessThan(15);
    expect(start.y).toBeCloseTo(1314, 0);
    expect(Math.abs(start.along - climb.start)).toBeLessThan(40);
    expect(junction.d).toBeLessThan(20);
    expect(junction.along).toBeGreaterThan(climb.start);
    expect(junction.along - climb.start).toBeLessThan(80);
    for (const [lat, lon] of [
      [46.4755572, 12.037828],
      [46.4752302, 12.0379473],
      [46.4821529, 12.0343232],
    ] as const) {
      const g = nearest(lat, lon);
      expect(g.d, `${lat}`).toBeLessThan(25);
      expect(g.along).toBeGreaterThan(junction.along);
      expect(g.along).toBeLessThan(pass.along);
    }
    expect(fedare.d).toBeLessThan(90);
    expect(fedare.y).toBeGreaterThan(1950);
    expect(fedare.y).toBeLessThan(2050);
    expect(fedare.along).toBeGreaterThan(climb.start + 6500);
    expect(fedare.along).toBeLessThan(climb.start + 7600);
    expect(pass.d).toBeLessThan(20);
    expect(pass.y).toBeCloseTo(2236, 0);
    expect(climb.end - pass.along).toBeLessThan(40);
    const pocol = xz(46.516, 12.14);
    let east = Infinity;
    for (let i = 0; i < route.count; i += 4) east = Math.min(east, Math.hypot(route.x[i] - pocol.x, route.z[i] - pocol.z));
    expect(east).toBeGreaterThan(3000);
  });

  it('has Selva at the foot, a restaurant at the pass, and the mapped parking', () => {
    const towns = planTowns(route);
    const selva = towns.find((t) => t.name === 'Selva di Cadore')!;
    expect(towns.some((t) => t.name === 'Passo Giau')).toBe(false);
    expect(selva.s0).toBeLessThan(40);
    expect(selva.s1).toBeGreaterThan(600);
    expect(selva.s1).toBeLessThan(climb.start + 40);
    expect(def.track!.places!.lots.map((l) => l.name)).toEqual([
      'Passo Giau',
      'Passo Giau ovest',
      'Passo Giau sella',
      'Rifugio Piezza',
    ]);
    const piezza = nearest(46.4849379, 12.0466691);
    expect(piezza.d).toBeLessThan(40);
    expect(piezza.y).toBeGreaterThan(2100);
    expect(piezza.y).toBeLessThan(2200);
    expect(piezza.along).toBeGreaterThan(climb.start + 8000);
  });

  it('turns at the pass and comes back down the same road', () => {
    const up = Math.floor((climb.start + 4000) / ROUTE_DS);
    let back = Infinity;
    for (let i = Math.floor(climb.end / ROUTE_DS) + 20; i < route.count; i += 2) {
      back = Math.min(back, Math.hypot(route.x[i] - route.x[up], route.z[i] - route.z[up]));
    }
    expect(back).toBeLessThan(6);
    expect(route.y[Math.floor(climb.end / ROUTE_DS)]).toBeCloseTo(2236, 0);
  });

  it('closes the lap and never jumps', () => {
    let worst = 0;
    for (let i = 0; i < route.count; i++) {
      const j = (i + 1) % route.count;
      worst = Math.max(worst, Math.hypot(route.x[j] - route.x[i], route.z[j] - route.z[i]));
    }
    expect(worst).toBeLessThan(2.5);
    expect(Math.max(...Array.from(route.grade, Math.abs))).toBeLessThan(0.16);
  });
});

describe('Krvavec on its real road', () => {
  const c = REAL_CLIMB_MAP.get('krvavec-cerklje')!;
  const def = realClimbRoute(c);
  const route = getRoute(def);
  const climb = route.climbs[0];
  const origin = def.track!.origin!;
  const R = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const xz = (lat: number, lon: number) => ({
    x: rad(lon - origin.lon) * Math.cos(rad(origin.lat)) * R,
    z: -rad(lat - origin.lat) * R,
  });
  const nearest = (lat: number, lon: number) => {
    const p = xz(lat, lon);
    let d = Infinity;
    let y = 0;
    let along = 0;
    const iEnd = Math.floor(climb.end / ROUTE_DS);
    for (let i = 0; i <= iEnd; i++) {
      const dist = Math.hypot(route.x[i] - p.x, route.z[i] - p.z);
      if (dist < d) {
        d = dist;
        y = route.y[i];
        along = i * ROUTE_DS;
      }
    }
    return { d, y, along };
  };

  it('uses the OpenStreetMap line', () => {
    expect(hasRealRoad(c.id)).toBe(true);
    expect(def.track).toBeDefined();
  });

  it('starts at Grad and climbs the published road to Plaža', () => {
    expect(Math.abs(climb.length - c.lengthKm * 1000) / (c.lengthKm * 1000)).toBeLessThan(0.025);
    expect(route.y[Math.floor(climb.start / ROUTE_DS)]).toBeCloseTo(431, -1);
    expect(climb.summitElevation).toBeCloseTo(1594, -1);
    expect(Math.abs(climb.gain - c.gain) / c.gain).toBeLessThan(0.03);
    const grad = nearest(46.2701248, 14.4924402);
    const plaza = nearest(46.3011603, 14.5263809);
    const tiha = nearest(46.3004116, 14.5265222);
    expect(grad.d).toBeLessThan(20);
    expect(grad.along).toBeLessThan(climb.start + 40);
    expect(tiha.d).toBeLessThan(30);
    expect(tiha.y).toBeGreaterThan(1580);
    expect(climb.end - tiha.along).toBeLessThan(80);
    expect(plaza.d).toBeLessThan(80);
    expect(plaza.y).toBeGreaterThan(1580);
  });

  it('passes Ambrož and Planina Jezerca on the way up', () => {
    const ambroz = nearest(46.27468, 14.52894);
    const jezerca = nearest(46.2848431, 14.5330196);
    expect(ambroz.d).toBeLessThan(120);
    expect(ambroz.y).toBeGreaterThan(1050);
    expect(ambroz.y).toBeLessThan(1200);
    expect(ambroz.along).toBeGreaterThan(climb.start + 7500);
    expect(ambroz.along).toBeLessThan(climb.start + 9500);
    expect(jezerca.d).toBeLessThan(120);
    expect(jezerca.y).toBeGreaterThan(1380);
    expect(jezerca.y).toBeLessThan(1460);
    expect(jezerca.along).toBeGreaterThan(climb.start + 11000);
    expect(jezerca.along).toBeLessThan(climb.start + 13500);
    const towns = planTowns(route);
    expect(towns.some((t) => t.name === 'Grad' && t.s0 < 50)).toBe(true);
    expect(towns.some((t) => t.name === 'Ambrož pod Krvavcem')).toBe(true);
  });

  it('turns at Plaža and comes back down the same road', () => {
    const up = Math.floor((climb.start + 5000) / ROUTE_DS);
    let back = Infinity;
    for (let i = Math.floor(climb.end / ROUTE_DS) + 20; i < route.count; i += 2) {
      back = Math.min(back, Math.hypot(route.x[i] - route.x[up], route.z[i] - route.z[up]));
    }
    expect(back).toBeLessThan(6);
    expect(route.y[Math.floor(climb.end / ROUTE_DS)]).toBeCloseTo(1594, 0);
  });

  it('closes the lap and never jumps', () => {
    let worst = 0;
    for (let i = 0; i < route.count; i++) {
      const j = (i + 1) % route.count;
      worst = Math.max(worst, Math.hypot(route.x[j] - route.x[i], route.z[j] - route.z[i]));
    }
    expect(worst).toBeLessThan(2.5);
    expect(Math.max(...Array.from(route.grade, Math.abs))).toBeLessThan(0.16);
  });
});
