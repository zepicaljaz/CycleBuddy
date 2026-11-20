import { describe, expect, it } from 'vitest';
import { encodeSimulation, encodeTargetPower, parseIndoorBikeData } from './ftms';
import { fecMessage, parseFecMessage, targetPowerPage, trackResistancePage, userConfigPage } from './fec';
import { parseHeartRate } from './heartRate';
import { WriteQueue } from './types';

const view = (bytes: number[]) => new DataView(new Uint8Array(bytes).buffer);

describe('FTMS', () => {
  it('parses speed, cadence and power from Indoor Bike Data', () => {
    // flags: speed present (bit0=0), cadence (bit2), power (bit6) => 0x0044
    const data = view([0x44, 0x00, 0xc4, 0x09, 0xb4, 0x00, 0xfa, 0x00]);
    const r = parseIndoorBikeData(data);
    expect(r.speedKmh).toBeCloseTo(25);
    expect(r.cadence).toBe(90);
    expect(r.power).toBe(250);
  });

  it('skips optional fields correctly', () => {
    // flags: avg speed (bit1), cadence (bit2), total distance (bit4), power (bit6), HR (bit9)
    const flags = 0x0002 | 0x0004 | 0x0010 | 0x0040 | 0x0200;
    const data = view([flags & 0xff, flags >> 8, 0x10, 0x27, 0x10, 0x27, 0xa0, 0x00, 1, 2, 3, 0x2c, 0x01, 150]);
    const r = parseIndoorBikeData(data);
    expect(r.cadence).toBe(80);
    expect(r.power).toBe(300);
    expect(r.heartRate).toBe(150);
  });

  it('keeps the whole fields of a packet cut short', () => {
    // flags say speed, cadence and power, but power never arrived
    expect(parseIndoorBikeData(view([0x44, 0x00, 0xc4, 0x09, 0xb4]))).toEqual({ speedKmh: 25 });
    expect(parseIndoorBikeData(view([0x44]))).toEqual({});
  });

  it('encodes a target power for ERG mode', () => {
    const view = new DataView(encodeTargetPower(250).buffer);
    expect(view.getUint8(0)).toBe(0x05);
    expect(view.getInt16(1, true)).toBe(250);
  });

  it('encodes simulation parameters', () => {
    const b = encodeSimulation({ gradePct: 8.5, crr: 0.004, cw: 0.51 });
    expect([...b]).toEqual([0x11, 0, 0, 0x52, 0x03, 40, 51]);
    const neg = new DataView(encodeSimulation({ gradePct: -3.25, crr: 0.004, cw: 0.51 }).buffer);
    expect(neg.getInt16(3, true)).toBe(-325);
  });
});

describe('FE-C over BLE', () => {
  it('builds messages with a valid checksum', () => {
    const msg = fecMessage([0x33, 0xff, 0xff, 0xff, 0xff, 0x00, 0x00, 0x50]);
    expect(msg.length).toBe(13);
    let x = 0;
    for (let i = 0; i < 12; i++) x ^= msg[i];
    expect(msg[12]).toBe(x);
  });

  it('encodes target power in 0.25 W steps', () => {
    const msg = targetPowerPage(250);
    expect(msg[4]).toBe(0x31);
    // page bytes 1-5 reserved, power in page bytes 6-7 (message offset 4 + n)
    expect([...msg.slice(5, 10)]).toEqual([0xff, 0xff, 0xff, 0xff, 0xff]);
    expect(msg[10] | (msg[11] << 8)).toBe(1000);
  });

  it('encodes track resistance grade with -200% offset', () => {
    const msg = trackResistancePage(5, 0.004);
    const raw = msg[9] | (msg[10] << 8);
    expect(raw).toBe(20500);
    expect(msg[11]).toBe(80);
  });

  it('encodes user weight', () => {
    const msg = userConfigPage(72.5);
    expect(msg[5] | (msg[6] << 8)).toBe(7250);
  });

  it('parses general data and treats 0xFFFF speed as missing', () => {
    const r = parseFecMessage(view([0xa4, 0x09, 0x4e, 0x05, 0x10, 0x19, 0, 0, 0x10, 0x27, 140, 0x00, 0x00]));
    expect(r?.speedKmh).toBeCloseTo(36);
    expect(r?.heartRate).toBe(140);
    const none = parseFecMessage(view([0xa4, 0x09, 0x4e, 0x05, 0x10, 0x19, 0, 0, 0xff, 0xff, 0xff, 0x00, 0x00]));
    expect(none).toEqual({});
  });

  it('parses specific trainer data page', () => {
    const r = parseFecMessage(view([0xa4, 0x09, 0x4e, 0x05, 0x19, 0x01, 92, 0, 0, 0x2c, 0x01, 0x00, 0x00]));
    expect(r).toEqual({ cadence: 92, power: 300 });
  });
});

describe('Heart rate', () => {
  it('parses 8 and 16 bit values', () => {
    expect(parseHeartRate(view([0x00, 142]))).toBe(142);
    expect(parseHeartRate(view([0x01, 0x2c, 0x01]))).toBe(300);
  });
});

describe('WriteQueue', () => {
  it('replaces only queued writes with the same key and settles the dropped ones', async () => {
    const q = new WriteQueue();
    const ran: string[] = [];
    let release!: () => void;
    const first = q.push(() => new Promise<void>((r) => (release = () => { ran.push('first'); r(); })));
    const weight = q.push(async () => void ran.push('weight'));
    const grade1 = q.replace('control', async () => void ran.push('grade1'));
    const grade2 = q.replace('control', async () => void ran.push('grade2'));
    // The superseded write resolves at once, without running.
    await grade1;
    expect(ran).toEqual([]);
    release();
    await Promise.all([first, weight, grade2]);
    expect(ran).toEqual(['first', 'weight', 'grade2']);
  });
});
