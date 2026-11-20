import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeviceManager } from './devices';
import type { SimulationParams, TrainerConnection, TrainerReading } from './types';

/** Records every write, so tests can see what reached the trainer. */
class FakeTrainer implements TrainerConnection {
  readonly protocol = 'ftms' as const;
  readonly name = 'Fake trainer';
  onReading: (r: TrainerReading) => void = () => {};
  onDisconnected: () => void = () => {};
  grades: number[] = [];
  targets: number[] = [];
  reconnects = 0;
  disconnects = 0;
  async reconnect(): Promise<void> {
    this.reconnects++;
  }
  async setSimulation(p: SimulationParams): Promise<void> {
    this.grades.push(p.gradePct);
  }
  async setTargetPower(watts: number): Promise<void> {
    this.targets.push(watts);
  }
  disconnect(): void {
    this.disconnects++;
  }
}

function withTrainer(): { dm: DeviceManager; t: FakeTrainer } {
  const dm = new DeviceManager();
  const t = new FakeTrainer();
  (dm as unknown as { attach(t: TrainerConnection): void }).attach(t);
  return { dm, t };
}

describe('DeviceManager trainer control', () => {
  it('throttles grade writes', () => {
    const { dm, t } = withTrainer();
    dm.updateGrade(8, 1000);
    dm.updateGrade(0, 1100);
    expect(t.grades).toEqual([8]);
  });

  it('releaseToFlat drops ERG and sends 0 % even right after another write', () => {
    const { dm, t } = withTrainer();
    dm.setErgWatts(250, 1000);
    expect(t.targets).toEqual([250]);
    dm.releaseToFlat(1050);
    expect(t.grades).toEqual([0]);
    // Grade mode again: the road is back in charge.
    dm.updateGrade(6, 1600);
    expect(t.grades).toEqual([0, 6]);
  });

  it('re-sends the same ERG target after a pause', () => {
    const { dm, t } = withTrainer();
    dm.setErgWatts(200, 1000);
    dm.releaseToFlat(2000);
    dm.resumeControl();
    dm.setErgWatts(200, 2100);
    expect(t.targets).toEqual([200, 200]);
  });
});

describe('DeviceManager trainer reconnect', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs one reconnect loop even when the drop fires twice', async () => {
    vi.useFakeTimers();
    const { dm, t } = withTrainer();
    t.onDisconnected();
    t.onDisconnected();
    await vi.advanceTimersByTimeAsync(2000);
    expect(t.reconnects).toBe(1);
    expect(dm.status.trainer).toBe('connected');
  });

  it('drops a trainer that came back after another one was attached', async () => {
    vi.useFakeTimers();
    const { dm, t } = withTrainer();
    let replaced = false;
    t.reconnect = async () => {
      t.reconnects++;
      // The rider switches trainers while this one is still reconnecting.
      const other = new FakeTrainer();
      (dm as unknown as { attach(t: TrainerConnection): void }).attach(other);
      replaced = true;
    };
    t.onDisconnected();
    await vi.advanceTimersByTimeAsync(2000);
    expect(replaced).toBe(true);
    expect(t.disconnects).toBe(1);
    expect(t.grades).toEqual([]);
  });
});

describe('DeviceManager heart-rate reconnect', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /** A strap that connects, then fails `failures` reconnects before it works again. */
  function strap(failures: number) {
    const ch = Object.assign(new EventTarget(), { startNotifications: async () => ch });
    let connects = 0;
    const device = Object.assign(new EventTarget(), {
      name: 'Strap',
      gatt: {
        connected: true,
        disconnect() {},
        async connect() {
          connects++;
          if (connects > 1 && connects <= 1 + failures) throw new Error('out of range');
          return { getPrimaryService: async () => ({ getCharacteristic: async () => ch }) };
        },
      },
    }) as unknown as BluetoothDevice;
    return { device, connects: () => connects };
  }

  async function withStrap(failures: number) {
    const { device, connects } = strap(failures);
    vi.stubGlobal('navigator', { bluetooth: { requestDevice: async () => device } });
    const dm = new DeviceManager();
    await dm.connectHeartRate();
    return { dm, device, connects };
  }

  it('reconnects a strap that dropped', async () => {
    vi.useFakeTimers();
    const { dm, device, connects } = await withStrap(2);
    device.dispatchEvent(new Event('gattserverdisconnected'));
    expect(dm.status.hr).toBe('reconnecting');
    await vi.advanceTimersByTimeAsync(10000);
    expect(connects()).toBe(4);
    expect(dm.status.hr).toBe('connected');
  });

  it('gives up after a few attempts', async () => {
    vi.useFakeTimers();
    const { dm, device } = await withStrap(0);
    // From now on every attempt fails.
    (device.gatt as unknown as { connect(): Promise<never> }).connect = async () => {
      throw new Error('out of range');
    };
    device.dispatchEvent(new Event('gattserverdisconnected'));
    await vi.advanceTimersByTimeAsync(60000);
    expect(dm.status.hr).toBe('disconnected');
  });
});
