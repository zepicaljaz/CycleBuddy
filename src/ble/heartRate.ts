export function parseHeartRate(view: DataView): number {
  const flags = view.getUint8(0);
  return flags & 0x01 ? view.getUint16(1, true) : view.getUint8(1);
}

export class HeartRateMonitor {
  onHeartRate: (bpm: number) => void = () => {};
  onDisconnected: () => void = () => {};

  constructor(readonly device: BluetoothDevice) {
    device.addEventListener('gattserverdisconnected', () => this.onDisconnected());
  }

  get name(): string {
    return this.device.name ?? 'Heart rate monitor';
  }

  private onValue = (e: Event) => {
    const v = (e.target as BluetoothRemoteGATTCharacteristic).value;
    if (!v || v.byteLength < 2) return;
    try {
      this.onHeartRate(parseHeartRate(v));
    } catch {
      // A short packet. The next one will do.
    }
  };

  async connect(): Promise<void> {
    const server = await this.device.gatt!.connect();
    const service = await server.getPrimaryService('heart_rate');
    const ch = await service.getCharacteristic('heart_rate_measurement');
    // Reconnects may hand back the same characteristic object, so never listen twice.
    ch.removeEventListener('characteristicvaluechanged', this.onValue);
    ch.addEventListener('characteristicvaluechanged', this.onValue);
    await ch.startNotifications();
  }

  /** Connects to the same strap again and resubscribes, after it dropped. */
  async reconnect(): Promise<void> {
    await this.connect();
  }

  disconnect(): void {
    if (this.device.gatt?.connected) this.device.gatt.disconnect();
  }

  static async request(): Promise<HeartRateMonitor> {
    const device = await navigator.bluetooth.requestDevice({ filters: [{ services: ['heart_rate'] }] });
    const m = new HeartRateMonitor(device);
    await m.connect();
    return m;
  }
}
