import { describe, expect, it } from 'vitest';
import { CONTROL_REFUSED, FtmsTrainer, parseControlResponse } from './ftms';

/** A control point that answers each write through an indication, like a real trainer. */
class FakeControlPoint extends EventTarget {
  value: DataView | null = null;
  properties = { write: true, writeWithoutResponse: false };
  writes: number[][] = [];
  constructor(private answer: (op: number) => number | null) {
    super();
  }
  async startNotifications() {
    return this;
  }
  async writeValueWithResponse(buf: ArrayBuffer) {
    const bytes = [...new Uint8Array(buf)];
    this.writes.push(bytes);
    const result = this.answer(bytes[0]);
    if (result == null) return;
    setTimeout(() => {
      this.value = new DataView(new Uint8Array([0x80, bytes[0], result]).buffer);
      this.dispatchEvent(new Event('characteristicvaluechanged'));
    }, 5);
  }
}

class FakeData extends EventTarget {
  async startNotifications() {
    return this;
  }
}

function trainerWith(answer: (op: number) => number | null) {
  const cp = new FakeControlPoint(answer);
  const service = {
    getCharacteristic: async (uuid: number) => (uuid === 0x2ad9 ? cp : new FakeData()),
  } as unknown as BluetoothRemoteGATTService;
  const device = new EventTarget() as unknown as BluetoothDevice;
  const t = new FtmsTrainer(device);
  const errors: (string | null)[] = [];
  t.onControlError = (m) => errors.push(m);
  return { t, cp, service, errors };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const server = {} as BluetoothRemoteGATTServer;

describe('FTMS control point', () => {
  it('parses responses', () => {
    expect(parseControlResponse(new DataView(new Uint8Array([0x80, 0x00, 0x01]).buffer))).toEqual({ op: 0, result: 1 });
    expect(parseControlResponse(new DataView(new Uint8Array([0x80, 0x00]).buffer))).toBeNull();
    expect(parseControlResponse(new DataView(new Uint8Array([0x05, 0x00, 0x01]).buffer))).toBeNull();
  });

  it('waits for Request Control and reports a refusal', async () => {
    const { t, cp, service, errors } = trainerWith((op) => (op === 0x00 ? 0x05 : 0x01));
    await t.connect({ server, service });
    expect(cp.writes.map((w) => w[0])).toEqual([0x00, 0x07]);
    expect(errors).toEqual([CONTROL_REFUSED]);
  });

  it('asks for control again once when a write is not permitted, then replays it', async () => {
    let refuse = true;
    const { t, cp, service, errors } = trainerWith((op) => {
      if (op === 0x11 && refuse) {
        refuse = false;
        return 0x05;
      }
      return 0x01;
    });
    await t.connect({ server, service });
    await t.setSimulation({ gradePct: 4, crr: 0.004, cw: 0.51 });
    await wait(60);
    expect(cp.writes.map((w) => w[0])).toEqual([0x00, 0x07, 0x11, 0x00, 0x07, 0x11]);
    expect(errors).toEqual([null, null, null]);
  });

  it('does not keep re-requesting while control stays refused', async () => {
    const { t, cp, service, errors } = trainerWith((op) => (op === 0x11 ? 0x05 : 0x01));
    await t.connect({ server, service });
    await t.setSimulation({ gradePct: 4, crr: 0.004, cw: 0.51 });
    await wait(80);
    expect(cp.writes.filter((w) => w[0] === 0x00).length).toBe(2);
    expect(errors[errors.length - 1]).toBe(CONTROL_REFUSED);
  });
});
