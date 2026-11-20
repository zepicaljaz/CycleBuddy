import type { SimulationParams, TrainerConnection, TrainerReading } from './types';

/**
 * Keyboard-driven stand-in for a real trainer, for trying the game without a bike.
 * Arrow Up/Down change power by 10 W (Shift: 50 W).
 */
export class VirtualTrainer implements TrainerConnection {
  readonly protocol = 'virtual' as const;
  readonly name = 'Virtual trainer (keyboard)';
  onReading: (r: TrainerReading) => void = () => {};
  onDisconnected: () => void = () => {};
  power: number;
  /** While a workout is in ERG, arrow keys do not change watts. The workout owns the target. */
  private locked = false;
  private timer: number;
  private keyHandler = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    if (this.locked) {
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') e.preventDefault();
      return;
    }
    const step = e.shiftKey ? 50 : 10;
    if (e.key === 'ArrowUp') this.power = Math.min(5000, this.power + step);
    else if (e.key === 'ArrowDown') this.power = Math.max(0, this.power - step);
    else return;
    e.preventDefault();
  };

  constructor(initialPower: number) {
    this.power = initialPower;
    window.addEventListener('keydown', this.keyHandler);
    this.timer = window.setInterval(() => {
      const jitter = this.power > 0 ? (Math.random() - 0.5) * 8 : 0;
      this.onReading({
        power: Math.max(0, Math.round(this.power + jitter)),
        cadence: this.power > 0 ? 88 + Math.round((Math.random() - 0.5) * 4) : 0,
      });
    }, 250);
  }

  setSimulation(_p: SimulationParams): Promise<void> {
    return Promise.resolve();
  }

  holdPower(watts: number): void {
    this.locked = true;
    this.power = Math.max(0, Math.min(2000, watts));
  }

  releasePowerLock(): void {
    this.locked = false;
  }

  disconnect(): void {
    window.clearInterval(this.timer);
    window.removeEventListener('keydown', this.keyHandler);
    this.onDisconnected();
  }
}
