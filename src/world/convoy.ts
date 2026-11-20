import * as THREE from 'three';
import type { Route } from '../routes/route';
import { InstancedModel } from './batch';
import { motorcycle } from './motorcycle';
import { organizerCar } from './motorhome';
import { placement } from './geometry';
import type { LaneUser } from './traffic';
import type { TerrainField } from './terrainField';

const _m = new THREE.Matrix4();
const TAIL_GAP = 14;

/** Where the tail bike sits. In a time trial it waits at the ramp until the last rider leaves, then follows that rider. */
export function tailAnchor(riders: LaneUser[], ramp?: { s: number; dir: 1 | -1 }): number | null {
  if (ramp) {
    const broom = riders.find((rider) => rider.broom);
    const dir = broom?.dir ?? ramp.dir;
    const anchor = broom ? broom.s : ramp.s;
    return anchor - dir * TAIL_GAP;
  }
  if (!riders.length) return null;
  let last = riders[0].s;
  for (const rider of riders) if (rider.s < last) last = rider.s;
  return last - TAIL_GAP;
}

/** Race vehicles: director's car, a camera bike on the nose, another on the tail. */
export class RaceConvoy {
  readonly group = new THREE.Group();
  private org = new InstancedModel(organizerCar(), 1);
  private nose = new InstancedModel(motorcycle(true), 1);
  private tail = new InstancedModel(motorcycle(true), 1);
  private on = false;
  private orgS = 0;
  private noseS = 0;
  private tailS = 0;
  private init = false;

  constructor() {
    this.group.name = 'race-convoy';
    this.group.add(this.org.group, this.nose.group, this.tail.group);
    this.org.count = 0;
    this.nose.count = 0;
    this.tail.count = 0;
  }

  setEnabled(on: boolean): void {
    this.on = on;
    this.init = false;
    if (!on) {
      this.org.count = 0;
      this.nose.count = 0;
      this.tail.count = 0;
      this.org.commit();
      this.nose.commit();
      this.tail.commit();
    }
  }

  update(dt: number, route: Route, field: TerrainField, riders: LaneUser[], ramp?: { s: number; dir: 1 | -1 }): void {
    if (!this.on || !riders.length) {
      if (this.org.count) {
        this.org.count = 0;
        this.nose.count = 0;
        this.tail.count = 0;
        this.org.commit();
        this.nose.commit();
        this.tail.commit();
      }
      return;
    }
    let lead = riders[0].s;
    let last = riders[0].s;
    for (const r of riders) {
      if (r.s > lead) lead = r.s;
      if (r.s < last) last = r.s;
    }
    const wantOrg = lead + 48;
    const wantNose = lead + 18;
    const wantTail = tailAnchor(riders, ramp) ?? last - TAIL_GAP;
    if (!this.init) {
      this.orgS = wantOrg;
      this.noseS = wantNose;
      this.tailS = wantTail;
      this.init = true;
    }
    const chase = (cur: number, want: number, max: number) => {
      const d = want - cur;
      const step = Math.sign(d) * Math.min(Math.abs(d), max * dt);
      return cur + step;
    };
    this.orgS = chase(this.orgS, wantOrg, 18);
    this.noseS = chase(this.noseS, wantNose, 20);
    this.tailS = chase(this.tailS, wantTail, 18);
    this.place(this.org, route, field, this.orgS, 1.55, 0);
    this.place(this.nose, route, field, this.noseS, -1.35, 0);
    this.place(this.tail, route, field, this.tailS, -1.35, 0);
  }

  private place(model: InstancedModel, route: Route, field: TerrainField, s: number, lat: number, pitchExtra: number): void {
    const p = route.place(s, lat);
    const y = Math.max(p.y, field.heightAt(p.x, p.z));
    placement(p.x, y, p.z, Math.atan2(-p.tz, p.tx), 1, Math.atan(p.grade) + pitchExtra, 0, _m);
    model.count = 1;
    model.setMatrix(0, _m);
    model.commit();
  }
}
