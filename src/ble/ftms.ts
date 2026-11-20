import { WriteQueue, delay, writeChar, type GattServiceHandle, type SimulationParams, type TrainerConnection, type TrainerReading } from './types';

export const FTMS_SERVICE = 0x1826;
const INDOOR_BIKE_DATA = 0x2ad2;
const CONTROL_POINT = 0x2ad9;

const OP_REQUEST_CONTROL = 0x00;
const OP_SET_TARGET_POWER = 0x05;
const OP_START = 0x07;
const OP_SET_SIMULATION = 0x11;
const OP_RESPONSE = 0x80;

const RESULT_SUCCESS = 0x01;
const RESULT_NOT_PERMITTED = 0x05;
/** How long to wait for the trainer to answer Request Control before carrying on. */
const CONTROL_REPLY_MS = 1500;

export const CONTROL_REFUSED =
  'The trainer did not give CycleBuddy control. Another app may be controlling it: quit Zwift, Rouvy or the trainer app on your phone, then reconnect.';

/** Parses a control-point indication: [0x80, request opcode, result code]. */
export function parseControlResponse(view: DataView): { op: number; result: number } | null {
  if (view.byteLength < 3 || view.getUint8(0) !== OP_RESPONSE) return null;
  return { op: view.getUint8(1), result: view.getUint8(2) };
}

/**
 * Parses the FTMS Indoor Bike Data characteristic (Bluetooth FTMS spec 4.9).
 * A packet cut short keeps the fields that arrived whole.
 */
export function parseIndoorBikeData(view: DataView): TrainerReading {
  const r: TrainerReading = {};
  if (view.byteLength < 2) return r;
  const flags = view.getUint16(0, true);
  const len = view.byteLength;
  let o = 2;
  const has = (bytes: number) => o + bytes <= len;
  // bit 0 "More Data": when 0, instantaneous speed is present
  if ((flags & 0x0001) === 0) {
    if (!has(2)) return r;
    r.speedKmh = view.getUint16(o, true) / 100;
    o += 2;
  }
  if (flags & 0x0002) o += 2; // average speed
  if (flags & 0x0004) {
    if (!has(2)) return r;
    r.cadence = view.getUint16(o, true) / 2;
    o += 2;
  }
  if (flags & 0x0008) o += 2; // average cadence
  if (flags & 0x0010) o += 3; // total distance
  if (flags & 0x0020) o += 2; // resistance level
  if (flags & 0x0040) {
    if (!has(2)) return r;
    r.power = view.getInt16(o, true);
    o += 2;
  }
  if (flags & 0x0080) o += 2; // average power
  if (flags & 0x0100) o += 5; // expended energy
  if (flags & 0x0200) {
    if (!has(1)) return r;
    const hr = view.getUint8(o);
    if (hr > 0) r.heartRate = hr;
    o += 1;
  }
  return r;
}

/** FTMS control-point Set Target Power (opcode 0x05): sint16 watts. */
export function encodeTargetPower(watts: number): Uint8Array {
  const buf = new DataView(new ArrayBuffer(3));
  buf.setUint8(0, OP_SET_TARGET_POWER);
  buf.setInt16(1, Math.round(Math.max(0, Math.min(2000, watts))), true);
  return new Uint8Array(buf.buffer);
}

export function encodeSimulation(p: SimulationParams): Uint8Array {
  const buf = new DataView(new ArrayBuffer(7));
  buf.setUint8(0, OP_SET_SIMULATION);
  buf.setInt16(1, 0, true); // wind speed, 0.001 m/s
  buf.setInt16(3, Math.round(Math.max(-40, Math.min(40, p.gradePct)) * 100), true); // 0.01 %
  buf.setUint8(5, Math.round(p.crr / 0.0001)); // 0.0001
  buf.setUint8(6, Math.round(p.cw / 0.01)); // 0.01 kg/m
  return new Uint8Array(buf.buffer);
}

export class FtmsTrainer implements TrainerConnection {
  readonly protocol = 'ftms' as const;
  onReading: (r: TrainerReading) => void = () => {};
  onDisconnected: () => void = () => {};
  onControlError: (message: string | null) => void = () => {};
  private cp: BluetoothRemoteGATTCharacteristic | null = null;
  private queue = new WriteQueue();
  /** True once the control point accepted the indication subscription. */
  private indications = false;
  /** Callers waiting for the reply to a control-point opcode. */
  private waiting = new Map<number, (result: number | null) => void>();
  /** The last simulation or ERG write, replayed after control is regained. */
  private lastControl: Uint8Array | null = null;
  /** Set after one re-request of control; cleared when a control write succeeds again. */
  private reacquired = false;

  private onData = (e: Event) => {
    const v = (e.target as BluetoothRemoteGATTCharacteristic).value;
    if (!v) return;
    try {
      this.onReading(parseIndoorBikeData(v));
    } catch {
      // A short or malformed packet. The next one will do.
    }
  };

  private onControlPoint = (e: Event) => {
    const v = (e.target as BluetoothRemoteGATTCharacteristic).value;
    const reply = v ? parseControlResponse(v) : null;
    if (reply) this.handleReply(reply.op, reply.result);
  };

  constructor(private device: BluetoothDevice) {
    device.addEventListener('gattserverdisconnected', () => this.onDisconnected());
  }

  get name(): string {
    return this.device.name ?? 'Smart trainer';
  }

  async connect(found?: GattServiceHandle): Promise<void> {
    const service = found?.service ?? (await this.discover());
    const data = await service.getCharacteristic(INDOOR_BIKE_DATA);
    // Reconnects may hand back the same characteristic object, so never listen twice.
    data.removeEventListener('characteristicvaluechanged', this.onData);
    data.addEventListener('characteristicvaluechanged', this.onData);
    await data.startNotifications();
    const cp = await service.getCharacteristic(CONTROL_POINT);
    this.cp = cp;
    cp.removeEventListener('characteristicvaluechanged', this.onControlPoint);
    cp.addEventListener('characteristicvaluechanged', this.onControlPoint);
    try {
      // Responses arrive as indications. Some Tacx firmware rejects this
      // subscription; the commands below still work without it.
      await cp.startNotifications();
      this.indications = true;
    } catch {
      this.indications = false;
    }
    this.reacquired = false;
    await this.requestControl(cp);
  }

  /** Request Control, wait for the answer when the trainer can give one, then Start. */
  private async requestControl(cp: BluetoothRemoteGATTCharacteristic): Promise<boolean> {
    const reply = this.indications ? this.awaitReply(OP_REQUEST_CONTROL, CONTROL_REPLY_MS) : null;
    await this.queue.push(() => writeChar(cp, new Uint8Array([OP_REQUEST_CONTROL])));
    // Without indications there is no answer to wait for, so give the trainer a moment.
    const result = reply ? await reply : (await delay(200), null);
    const granted = result == null || result === RESULT_SUCCESS;
    this.onControlError(granted ? null : CONTROL_REFUSED);
    await this.queue.push(() => writeChar(cp, new Uint8Array([OP_START])));
    return granted;
  }

  /** Resolves with the result code, or null when no answer arrives in time. */
  private awaitReply(op: number, ms: number): Promise<number | null> {
    this.waiting.get(op)?.(null);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (this.waiting.get(op) === done) this.waiting.delete(op);
        resolve(null);
      }, ms);
      const done = (result: number | null) => {
        clearTimeout(timer);
        if (this.waiting.get(op) === done) this.waiting.delete(op);
        resolve(result);
      };
      this.waiting.set(op, done);
    });
  }

  private handleReply(op: number, result: number) {
    this.waiting.get(op)?.(result);
    if (op !== OP_SET_SIMULATION && op !== OP_SET_TARGET_POWER) return;
    if (result === RESULT_SUCCESS) {
      if (this.reacquired) this.onControlError(null);
      this.reacquired = false;
      return;
    }
    if (result !== RESULT_NOT_PERMITTED) return;
    // Another app took control, or the trainer reset. Ask for it back once.
    if (!this.reacquired) {
      this.reacquired = true;
      void this.regainControl();
    } else this.onControlError(CONTROL_REFUSED);
  }

  private async regainControl(): Promise<void> {
    const cp = this.cp;
    if (!cp) return;
    try {
      const granted = await this.requestControl(cp);
      const last = this.lastControl;
      if (granted && last) await this.queue.replace('control', () => writeChar(cp, last));
    } catch {
      // The next control write tries again through the normal path.
    }
  }

  private async discover(): Promise<BluetoothRemoteGATTService> {
    const server = await this.device.gatt!.connect();
    await delay(400);
    return server.getPrimaryService(FTMS_SERVICE);
  }

  async reconnect(): Promise<void> {
    await this.connect();
  }

  setSimulation(p: SimulationParams): Promise<void> {
    if (!this.cp) return Promise.resolve();
    const cp = this.cp;
    const bytes = encodeSimulation(p);
    this.lastControl = bytes;
    return this.queue.replace('control', () => writeChar(cp, bytes));
  }

  setTargetPower(watts: number): Promise<void> {
    if (!this.cp) return Promise.resolve();
    const cp = this.cp;
    const bytes = encodeTargetPower(watts);
    this.lastControl = bytes;
    return this.queue.replace('control', () => writeChar(cp, bytes));
  }

  disconnect(): void {
    if (this.device.gatt?.connected) this.device.gatt.disconnect();
  }
}
