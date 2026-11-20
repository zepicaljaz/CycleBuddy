export interface TrainerReading {
  power?: number;
  cadence?: number;
  speedKmh?: number;
  heartRate?: number;
}

export type TrainerProtocol = 'ftms' | 'fec' | 'virtual';

export interface SimulationParams {
  /** Road gradient in percent (already scaled by trainer difficulty). */
  gradePct: number;
  crr: number;
  /** Wind resistance coefficient in kg/m. */
  cw: number;
}

export interface TrainerConnection {
  readonly protocol: TrainerProtocol;
  readonly name: string;
  onReading: (r: TrainerReading) => void;
  onDisconnected: () => void;
  setSimulation(p: SimulationParams): Promise<void>;
  /** ERG mode: hold a target power in watts. Simulation grade is not sent while this is active. */
  setTargetPower?(watts: number): Promise<void>;
  /** Sends rider weight to the trainer when supported (improves inertia simulation). */
  setUserWeight?(kg: number): Promise<void>;
  /** Called with a message when the trainer refuses control, and with null once it is granted. */
  onControlError?: (message: string | null) => void;
  reconnect?(): Promise<void>;
  disconnect(): void;
}

interface QueuedWrite {
  key: string | null;
  run: () => Promise<void>;
  /** Settles the caller's promise without running, when a newer write replaces this one. */
  drop: () => void;
}

/** Serialises GATT writes; Web Bluetooth rejects overlapping operations. */
export class WriteQueue {
  private busy = false;
  private queue: QueuedWrite[] = [];

  push(op: () => Promise<void>, key: string | null = null): Promise<void> {
    return new Promise((resolve, reject) => {
      this.queue.push({ key, run: () => op().then(resolve, reject), drop: () => resolve() });
      void this.drain();
    });
  }

  /**
   * Replace any queued (not yet running) operation with the same key by this one.
   * Writes under other keys stay queued. Replaced writes resolve without running.
   */
  replace(key: string, op: () => Promise<void>): Promise<void> {
    const kept: QueuedWrite[] = [];
    for (const w of this.queue) {
      if (w.key === key) w.drop();
      else kept.push(w);
    }
    this.queue = kept;
    return this.push(op, key);
  }

  private async drain() {
    if (this.busy) return;
    this.busy = true;
    while (this.queue.length) {
      const w = this.queue.shift()!;
      try {
        await w.run();
      } catch {
        // errors are surfaced to the caller via the promise
      }
    }
    this.busy = false;
  }
}

/** A service already discovered by the connection setup, so trainers don't connect twice. */
export interface GattServiceHandle {
  server: BluetoothRemoteGATTServer;
  service: BluetoothRemoteGATTService;
}

export const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Writes to a characteristic using the method it actually supports.
 * Tacx FE-C only allows write-without-response; write-with-response fails there
 * with "GATT operation failed for unknown reason".
 */
export async function writeChar(c: BluetoothRemoteGATTCharacteristic, data: Uint8Array): Promise<void> {
  const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  const props = c.properties;
  if (props?.writeWithoutResponse && !props.write) {
    await c.writeValueWithoutResponse(buf);
    return;
  }
  if (props?.write && 'writeValueWithResponse' in c) await c.writeValueWithResponse(buf);
  else await c.writeValue(buf);
}
