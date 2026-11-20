import { WriteQueue, delay, writeChar, type GattServiceHandle, type SimulationParams, type TrainerConnection, type TrainerReading } from './types';

/** Tacx "FE-C over BLE": ANT+ FE-C pages tunnelled through a custom GATT service. */
export const FEC_SERVICE = '6e40fec1-b5a3-f393-e0a9-e50e24dcca9e';
const FEC_NOTIFY = '6e40fec2-b5a3-f393-e0a9-e50e24dcca9e';
const FEC_WRITE = '6e40fec3-b5a3-f393-e0a9-e50e24dcca9e';

const SYNC = 0xa4;
const MSG_ACK_DATA = 0x4f;
const CHANNEL = 0x05;

export function fecMessage(payload: number[]): Uint8Array {
  const msg = [SYNC, 0x09, MSG_ACK_DATA, CHANNEL, ...payload];
  let checksum = 0;
  for (const b of msg) checksum ^= b;
  return new Uint8Array([...msg, checksum]);
}

/**
 * ANT+ FE-C data page 0x31, target power, 0.25 W per bit.
 * Bytes 1-5 are reserved (0xFF); the power sits in bytes 6-7, little endian.
 */
export function targetPowerPage(watts: number): Uint8Array {
  const raw = Math.round(Math.max(0, Math.min(4000, watts)) / 0.25);
  return fecMessage([0x31, 0xff, 0xff, 0xff, 0xff, 0xff, raw & 0xff, (raw >> 8) & 0xff]);
}

export function trackResistancePage(gradePct: number, crr: number): Uint8Array {
  const raw = Math.round((Math.max(-200, Math.min(200, gradePct)) + 200) / 0.01);
  const crrRaw = Math.round(crr / 0.00005);
  return fecMessage([0x33, 0xff, 0xff, 0xff, 0xff, raw & 0xff, (raw >> 8) & 0xff, crrRaw & 0xff]);
}

export function userConfigPage(userKg: number, bikeKg = 8, wheelDiameterM = 0.7): Uint8Array {
  const user = Math.round(userKg / 0.01);
  const bike = Math.round(bikeKg / 0.05);
  return fecMessage([
    0x37,
    user & 0xff,
    (user >> 8) & 0xff,
    0xff,
    ((bike & 0x0f) << 4) | 0x0,
    (bike >> 4) & 0xff,
    Math.round(wheelDiameterM / 0.01),
    0x00,
  ]);
}

/** Parses an incoming ANT broadcast message (sync, len, id, channel, 8-byte page, checksum). */
export function parseFecMessage(view: DataView): TrainerReading | null {
  if (view.byteLength < 12 || view.getUint8(0) !== SYNC) return null;
  const p = (i: number) => view.getUint8(4 + i);
  const page = p(0);
  if (page === 0x10) {
    const rawSpeed = p(4) | (p(5) << 8);
    const hr = p(6);
    const r: TrainerReading = {};
    // 0xFFFF means the trainer has no speed to report.
    if (rawSpeed !== 0xffff) r.speedKmh = rawSpeed * 0.001 * 3.6; // 0.001 m/s per bit
    if (hr > 0 && hr < 255) r.heartRate = hr;
    return r;
  }
  if (page === 0x19) {
    const cadence = p(2);
    const power = p(5) | ((p(6) & 0x0f) << 8);
    return { cadence: cadence === 0xff ? undefined : cadence, power: power === 0xfff ? undefined : power };
  }
  return null;
}

export class FecTrainer implements TrainerConnection {
  readonly protocol = 'fec' as const;
  onReading: (r: TrainerReading) => void = () => {};
  onDisconnected: () => void = () => {};
  private tx: BluetoothRemoteGATTCharacteristic | null = null;
  private queue = new WriteQueue();

  constructor(private device: BluetoothDevice) {
    device.addEventListener('gattserverdisconnected', () => this.onDisconnected());
  }

  get name(): string {
    return this.device.name ?? 'Tacx trainer';
  }

  async connect(found?: GattServiceHandle): Promise<void> {
    const service = found?.service ?? (await this.discover());
    const rx = await service.getCharacteristic(FEC_NOTIFY);
    rx.addEventListener('characteristicvaluechanged', (e) => {
      const v = (e.target as BluetoothRemoteGATTCharacteristic).value;
      if (!v) return;
      try {
        const r = parseFecMessage(v);
        if (r) this.onReading(r);
      } catch {
        // A malformed packet. The next one will do.
      }
    });
    await rx.startNotifications();
    this.tx = await service.getCharacteristic(FEC_WRITE);
  }

  private async discover(): Promise<BluetoothRemoteGATTService> {
    const server = await this.device.gatt!.connect();
    await delay(400);
    return server.getPrimaryService(FEC_SERVICE);
  }

  async reconnect(): Promise<void> {
    await this.connect();
  }

  setSimulation(p: SimulationParams): Promise<void> {
    if (!this.tx) return Promise.resolve();
    const tx = this.tx;
    return this.queue.replace('control', () => writeChar(tx, trackResistancePage(p.gradePct, p.crr)));
  }

  setTargetPower(watts: number): Promise<void> {
    if (!this.tx) return Promise.resolve();
    const tx = this.tx;
    return this.queue.replace('control', () => writeChar(tx, targetPowerPage(watts)));
  }

  setUserWeight(kg: number): Promise<void> {
    if (!this.tx) return Promise.resolve();
    const tx = this.tx;
    return this.queue.push(() => writeChar(tx, userConfigPage(kg)));
  }

  disconnect(): void {
    if (this.device.gatt?.connected) this.device.gatt.disconnect();
  }
}
