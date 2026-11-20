import { FEC_SERVICE, FecTrainer } from './fec';
import { FTMS_SERVICE, FtmsTrainer } from './ftms';
import { HeartRateMonitor } from './heartRate';
import { delay, type TrainerConnection } from './types';
import { VirtualTrainer } from './virtualTrainer';

export type LinkState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

export interface DeviceStatus {
  trainer: LinkState;
  trainerName: string;
  trainerProtocol: string;
  hr: LinkState;
  hrName: string;
  error: string | null;
}

export const bluetoothSupported = (): boolean => typeof navigator !== 'undefined' && 'bluetooth' in navigator;

const STALE_MS = 3000;

/** Owns trainer + HR connections and exposes the latest readings. */
export class DeviceManager {
  power = 0;
  cadence = 0;
  heartRate = 0;
  trainerSpeedKmh = 0;
  private lastPowerAt = 0;
  private lastHrAt = 0;
  private trainer: TrainerConnection | null = null;
  private hrm: HeartRateMonitor | null = null;
  private lastSentGrade = Infinity;
  private lastSentPower = -1;
  private lastSentAt = 0;
  /** Set while the trainer refuses control (another app holds it). */
  private controlError: string | null = null;
  /** Watts the trainer should hold, or null while the road grade is in charge. */
  private ergWatts: number | null = null;
  private listeners = new Set<(s: DeviceStatus) => void>();
  /** Trainers and heart-rate straps with a reconnect loop running. */
  private reconnecting = new WeakSet<TrainerConnection | HeartRateMonitor>();
  /** The Bluetooth device behind each trainer connection. */
  private deviceOf = new WeakMap<TrainerConnection, BluetoothDevice>();
  /** The device being set up by connectTrainer, before it is attached. */
  private connectingDevice: BluetoothDevice | null = null;
  riderWeightKg = 75;
  status: DeviceStatus = {
    trainer: 'disconnected',
    trainerName: '',
    trainerProtocol: '',
    hr: 'disconnected',
    hrName: '',
    error: null,
  };

  subscribe(fn: (s: DeviceStatus) => void): () => void {
    this.listeners.add(fn);
    fn(this.status);
    return () => this.listeners.delete(fn);
  }

  private emit(patch: Partial<DeviceStatus>) {
    this.status = { ...this.status, ...patch };
    this.listeners.forEach((fn) => fn(this.status));
  }

  get hasTrainer(): boolean {
    return this.trainer !== null;
  }

  get isVirtual(): boolean {
    return this.trainer?.protocol === 'virtual';
  }

  /** Current power; drops to 0 if the trainer stops reporting. */
  currentPower(now = performance.now()): number {
    return now - this.lastPowerAt > STALE_MS ? 0 : this.power;
  }

  currentCadence(now = performance.now()): number {
    return now - this.lastPowerAt > STALE_MS ? 0 : this.cadence;
  }

  currentHeartRate(now = performance.now()): number {
    return now - this.lastHrAt > 5000 ? 0 : this.heartRate;
  }

  setVirtualPower(watts: number): void {
    if (this.trainer instanceof VirtualTrainer) this.trainer.power = watts;
  }

  get virtualPower(): number {
    return this.trainer instanceof VirtualTrainer ? this.trainer.power : 0;
  }

  private attach(t: TrainerConnection) {
    this.trainer = t;
    t.onReading = (r) => {
      const now = performance.now();
      if (r.power !== undefined) {
        this.power = Math.max(0, r.power);
        this.lastPowerAt = now;
      }
      if (r.cadence !== undefined) this.cadence = r.cadence;
      if (r.speedKmh !== undefined) this.trainerSpeedKmh = r.speedKmh;
      if (r.heartRate !== undefined && !this.hrm) {
        this.heartRate = r.heartRate;
        this.lastHrAt = now;
      }
    };
    t.onDisconnected = () => {
      if (this.trainer !== t || t.protocol === 'virtual') return;
      void this.tryReconnect(t);
    };
  }

  private async tryReconnect(t: TrainerConnection) {
    // A drop during a reconnect fires another disconnect event; one loop per trainer is enough.
    if (this.reconnecting.has(t)) return;
    this.reconnecting.add(t);
    try {
      await this.reconnectLoop(t);
    } finally {
      this.reconnecting.delete(t);
    }
  }

  private async reconnectLoop(t: TrainerConnection) {
    this.emit({ trainer: 'reconnecting' });
    for (let attempt = 0; attempt < 10 && this.trainer === t; attempt++) {
      await new Promise((r) => setTimeout(r, 1500 + attempt * 1000));
      if (this.trainer !== t) return;
      try {
        await t.reconnect?.();
        // The rider may have picked another trainer while this one came back.
        if (this.trainer !== t) {
          if (!this.deviceInUse(t)) t.disconnect();
          return;
        }
        this.lastSentGrade = Infinity;
        this.lastSentPower = -1;
        await t.setUserWeight?.(this.riderWeightKg);
        if (this.ergWatts != null) await t.setTargetPower?.(this.ergWatts);
        this.emit({ trainer: 'connected', error: this.controlError });
        return;
      } catch {
        // keep trying
      }
    }
    if (this.trainer === t) {
      this.trainer = null;
      this.emit({ trainer: 'disconnected', error: 'Lost connection to the trainer. Click Pair next to Trainer to connect again.' });
    }
  }

  /** True when a stale connection shares its device with the current or incoming trainer, so closing it would cut that one too. */
  private deviceInUse(stale: TrainerConnection): boolean {
    const device = this.deviceOf.get(stale);
    if (!device) return false;
    return device === this.connectingDevice || (this.trainer !== null && device === this.deviceOf.get(this.trainer));
  }

  async connectTrainer(): Promise<void> {
    if (!bluetoothSupported()) {
      this.emit({ error: 'Web Bluetooth is not available. Use Google Chrome or Microsoft Edge on Mac or Windows.' });
      return;
    }
    this.disconnectTrainer();
    this.controlError = null;
    this.emit({ trainer: 'connecting', error: null });
    let device: BluetoothDevice | null = null;
    try {
      device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [FTMS_SERVICE] }, { services: [FEC_SERVICE] }, { namePrefix: 'Tacx' }],
        optionalServices: [FTMS_SERVICE, FEC_SERVICE, 'cycling_power', 'heart_rate'],
      });
      this.connectingDevice = device;
      const link = await this.openTrainer(device);
      this.deviceOf.set(link, device);
      this.attach(link);
      // Neither of these is required to receive power; a failure here must not
      // look like the connection itself failed.
      try {
        await link.setUserWeight?.(this.riderWeightKg);
      } catch {
        /* weight only improves the trainer's inertia model */
      }
      // Mid-workout in ERG: hold the target straight away rather than a flat road.
      this.lastSentPower = -1;
      const erg = this.ergWatts;
      if (erg != null && link.setTargetPower) {
        this.lastSentGrade = Infinity;
        try {
          await link.setTargetPower(erg);
        } catch {
          /* the next workout update sends it again */
        }
      } else {
        try {
          await link.setSimulation({ gradePct: 0, crr: 0.004, cw: 0.51 });
          this.lastSentGrade = 0;
        } catch {
          this.lastSentGrade = Infinity;
        }
      }
      this.emit({
        trainer: 'connected',
        trainerName: link.name,
        trainerProtocol: link.protocol === 'ftms' ? 'FTMS' : 'FE-C',
        error: this.controlError,
      });
    } catch (e) {
      try {
        device?.gatt?.disconnect();
      } catch {
        /* already closed */
      }
      const err = e as Error;
      const cancelled = err.name === 'NotFoundError' && /cancel/i.test(err.message);
      this.emit({ trainer: 'disconnected', error: cancelled ? null : `Trainer connection failed. ${friendlyBleError(err)}` });
    } finally {
      this.connectingDevice = null;
    }
  }

  /**
   * Connects and sets the trainer up, retrying the handshake.
   * Chrome on macOS throws "GATT operation failed for unknown reason" when service
   * discovery starts in the same turn as the connection, and listing every service
   * at once triggers the same error. Tacx trainers also keep a half-open connection
   * and then refuse the next attempt, so every failure disconnects before retrying.
   * Tacx's own FE-C service is tried first: its FTMS implementation often rejects setup.
   */
  private async openTrainer(device: BluetoothDevice): Promise<TrainerConnection> {
    const tacx = /tacx/i.test(device.name ?? '');
    const order: BluetoothServiceUUID[] = tacx ? [FEC_SERVICE, FTMS_SERVICE] : [FTMS_SERVICE, FEC_SERVICE];
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      let server: BluetoothRemoteGATTServer;
      try {
        server = await device.gatt!.connect();
        await delay(400 + attempt * 300);
        if (!server.connected) throw new Error('The trainer disconnected during setup.');
      } catch (e) {
        lastError = e;
        try {
          device.gatt?.disconnect();
        } catch {
          /* already closed */
        }
        if (attempt < 2) await delay(900);
        continue;
      }
      let foundAny = false;
      for (const candidate of order) {
        if (!server.connected) break;
        try {
          const service = await server.getPrimaryService(candidate);
          foundAny = true;
          const conn = candidate === FEC_SERVICE ? new FecTrainer(device) : new FtmsTrainer(device);
          if (conn instanceof FtmsTrainer) {
            conn.onControlError = (message) => {
              this.controlError = message;
              // Only show it once the trainer is attached; connectTrainer reports it otherwise.
              if (this.trainer === conn) this.emit({ error: message });
            };
          }
          await conn.connect({ server, service });
          return conn;
        } catch (e) {
          if ((e as Error).name === 'NotFoundError') continue;
          lastError = e;
        }
      }
      if (!foundAny) {
        lastError = new Error('This device does not support trainer control (FTMS or FE-C over Bluetooth).');
        try {
          device.gatt?.disconnect();
        } catch {
          /* already closed */
        }
        break;
      }
      try {
        device.gatt?.disconnect();
      } catch {
        /* already closed */
      }
      if (attempt < 2) await delay(900);
    }
    throw lastError instanceof Error ? lastError : new Error('Could not connect to the trainer.');
  }

  useVirtualTrainer(initialPower: number): void {
    this.disconnectTrainer();
    const v = new VirtualTrainer(initialPower);
    this.attach(v);
    this.emit({ trainer: 'connected', trainerName: v.name, trainerProtocol: 'Keyboard', error: null });
  }

  disconnectTrainer(): void {
    const t = this.trainer;
    this.trainer = null;
    this.controlError = null;
    t?.disconnect();
    this.power = 0;
    this.cadence = 0;
    this.emit({ trainer: 'disconnected', trainerName: '', trainerProtocol: '' });
  }

  async connectHeartRate(): Promise<void> {
    if (!bluetoothSupported()) {
      this.emit({ error: 'Web Bluetooth is not available. Use Google Chrome or Microsoft Edge on Mac or Windows.' });
      return;
    }
    this.emit({ hr: 'connecting', error: null });
    try {
      // Clear it first, so the old strap's disconnect does not start a reconnect.
      const old = this.hrm;
      this.hrm = null;
      old?.disconnect();
      const m = await HeartRateMonitor.request();
      m.onHeartRate = (bpm) => {
        if (this.hrm !== m) return;
        this.heartRate = bpm;
        this.lastHrAt = performance.now();
      };
      m.onDisconnected = () => {
        if (this.hrm === m) void this.reconnectHeartRate(m);
      };
      this.hrm = m;
      this.emit({ hr: 'connected', hrName: m.name });
    } catch (e) {
      const err = e as Error;
      const cancelled = err.name === 'NotFoundError' && /cancel/i.test(err.message);
      this.emit({ hr: 'disconnected', error: cancelled ? null : `Heart rate connection failed: ${err.message}` });
    }
  }

  /** Straps drop out when the rider moves away or sweat breaks contact. Try a few times before giving up. */
  private async reconnectHeartRate(m: HeartRateMonitor) {
    if (this.reconnecting.has(m)) return;
    this.reconnecting.add(m);
    try {
      this.emit({ hr: 'reconnecting' });
      for (let attempt = 0; attempt < 5 && this.hrm === m; attempt++) {
        await new Promise((r) => setTimeout(r, 1500 + attempt * 1000));
        if (this.hrm !== m) return;
        try {
          await m.reconnect();
          if (this.hrm !== m) {
            // Picked another strap meanwhile. Close this one unless it is the same device.
            if (this.hrm && this.hrm.device !== m.device) m.disconnect();
            return;
          }
          this.emit({ hr: 'connected', hrName: m.name });
          return;
        } catch {
          // keep trying
        }
      }
      if (this.hrm === m) {
        this.hrm = null;
        this.emit({ hr: 'disconnected', hrName: '' });
      }
    } finally {
      this.reconnecting.delete(m);
    }
  }

  disconnectHeartRate(): void {
    const m = this.hrm;
    this.hrm = null;
    m?.disconnect();
    this.emit({ hr: 'disconnected', hrName: '' });
  }

  /**
   * ERG target in watts. Pass null to hand the trainer back to the road gradient.
   * Virtual trainers lock to the number. Bluetooth trainers get a throttled write.
   */
  setErgWatts(watts: number | null, now = performance.now()): void {
    if (watts == null) {
      if (this.ergWatts == null) return;
      this.ergWatts = null;
      this.lastSentPower = -1;
      this.lastSentGrade = Infinity;
      if (this.trainer instanceof VirtualTrainer) this.trainer.releasePowerLock();
      return;
    }
    const rounded = Math.max(0, Math.min(2000, Math.round(watts)));
    this.ergWatts = rounded;
    if (!this.trainer) return;
    if (this.trainer instanceof VirtualTrainer) {
      this.trainer.holdPower(rounded);
      return;
    }
    if (!this.trainer.setTargetPower) return;
    if (rounded === this.lastSentPower && now - this.lastSentAt < 5000) return;
    if (now - this.lastSentAt < 400) return;
    this.lastSentPower = rounded;
    this.lastSentAt = now;
    void this.trainer.setTargetPower(rounded);
  }

  /**
   * Pause, finish and leaving the ride: drop ERG and put the trainer on a flat road,
   * so the rider is not left pushing a held target or a steep climb.
   */
  releaseToFlat(now = performance.now()): void {
    this.setErgWatts(null);
    this.updateGrade(0, now, true);
  }

  /** After a pause: forget what was last sent, so the next update writes ERG or grade straight away. */
  resumeControl(): void {
    this.lastSentPower = -1;
    this.lastSentGrade = Infinity;
    this.lastSentAt = 0;
  }

  /**
   * Sends the road gradient to the trainer. Throttled: at most ~2 updates per second,
   * and only when the gradient changes by at least 0.1%. Ignored while ERG is holding a target.
   * `force` skips the throttle, for writes that must not be dropped.
   */
  updateGrade(gradePct: number, now = performance.now(), force = false): void {
    if (!this.trainer || this.ergWatts != null) return;
    const clamped = Math.max(-10, Math.min(20, gradePct));
    if (!force) {
      if (Math.abs(clamped - this.lastSentGrade) < 0.1 && now - this.lastSentAt < 5000) return;
      if (now - this.lastSentAt < 450) return;
    }
    this.lastSentGrade = clamped;
    this.lastSentAt = now;
    this.trainer.setSimulation({ gradePct: clamped, crr: 0.004, cw: 0.51 }).catch(() => {
      this.lastSentGrade = Infinity;
    });
  }
}

function friendlyBleError(err: Error): string {
  const msg = err.message || 'Unknown error';
  if (err.name === 'SecurityError') {
    return 'Bluetooth permission was blocked. Allow Bluetooth for Chrome in System Settings, Privacy & Security, Bluetooth, then reload the page.';
  }
  if (err.name === 'NetworkError' || /GATT|unknown reason/i.test(msg)) {
    return 'The trainer did not answer the Bluetooth handshake. Quit Zwift, Rouvy and the trainer app on your phone, turn the trainer off and on, pedal once to wake it, then click Pair next to Trainer again.';
  }
  return msg;
}
