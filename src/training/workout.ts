/** One slice of a workout. Ramps move from `fromPct` to `toPct` of FTP. */
export interface WorkoutStep {
  start: number;
  end: number;
  fromPct: number;
  toPct: number;
  text: string;
  cadence: string;
  /** The rider chooses the power. ERG stays off and the average is what counts. */
  open?: boolean;
}

export type Block =
  | { kind: 'steady'; sec: number; pct: number; text: string; cadence?: string }
  | { kind: 'ramp'; sec: number; from: number; to: number; text: string; cadence?: string }
  | {
      kind: 'reps';
      times: number;
      on: number;
      onPct: number;
      off: number;
      offPct: number;
      text: string;
      onCadence?: string;
      offCadence?: string;
    }
  | { kind: 'max'; sec: number; text: string; cadence?: string };

/** How an FTP test is scored. A ramp climbs until the rider stops. Twenty is a self-paced 20-minute effort. */
export type FtpProtocol = 'ramp' | 'twenty';

export interface Workout {
  id: string;
  name: string;
  focus: string;
  blurb: string;
  blocks: Block[];
  ftpTest?: FtpProtocol;
}

export interface ActiveWorkout {
  planId: string;
  planName: string;
  workoutId: string;
  workoutName: string;
  focus: string;
  ftpTest: boolean;
  ftpProtocol: FtpProtocol | null;
  steps: WorkoutStep[];
  durationSec: number;
}

export interface WorkoutCue {
  index: number;
  count: number;
  pct: number;
  watts: number;
  leftSec: number;
  workoutLeftSec: number;
  text: string;
  cadence: string;
  zone: string;
  next: string;
  step: WorkoutStep;
}

const ZONES = [
  { max: 0.55, name: 'Recovery', color: '#7f93a8' },
  { max: 0.76, name: 'Endurance', color: '#3cba78' },
  { max: 0.88, name: 'Tempo', color: '#e6c14a' },
  { max: 0.95, name: 'Sweet spot', color: '#f0a202' },
  { max: 1.06, name: 'Threshold', color: '#ff7f2a' },
  { max: 1.21, name: 'VO2max', color: '#e23b3b' },
  { max: 1.51, name: 'Anaerobic', color: '#c13b8a' },
  { max: Infinity, name: 'Sprint', color: '#8b5cff' },
] as const;

export function zoneAt(pct: number): { name: string; color: string } {
  return ZONES.find((z) => pct < z.max) ?? ZONES[ZONES.length - 1];
}

export function zoneName(pct: number): string {
  return zoneAt(pct).name;
}

export function expandBlocks(blocks: Block[]): WorkoutStep[] {
  const steps: WorkoutStep[] = [];
  let t = 0;
  const push = (sec: number, from: number, to: number, text: string, cadence = '85–95 rpm', open = false) => {
    if (sec <= 0) return;
    steps.push({ start: t, end: t + sec, fromPct: from, toPct: to, text, cadence, ...(open ? { open: true } : {}) });
    t += sec;
  };
  for (const block of blocks) {
    if (block.kind === 'steady') push(block.sec, block.pct, block.pct, block.text, block.cadence);
    else if (block.kind === 'ramp') push(block.sec, block.from, block.to, block.text, block.cadence);
    else if (block.kind === 'max') push(block.sec, 1, 1, block.text, block.cadence ?? 'Your own cadence', true);
    else {
      for (let i = 0; i < block.times; i++) {
        const n = `${i + 1}/${block.times}`;
        push(block.on, block.onPct, block.onPct, `${block.text} (${n})`, block.onCadence);
        if (block.off > 0) push(block.off, block.offPct, block.offPct, `Easy spin (${n})`, block.offCadence ?? '85–95 rpm');
      }
    }
  }
  return steps;
}

export function durationSec(steps: WorkoutStep[]): number {
  return steps.length ? steps[steps.length - 1].end : 0;
}

export function stepAt(steps: WorkoutStep[], t: number): WorkoutStep | null {
  if (!steps.length) return null;
  if (t <= steps[0].start) return steps[0];
  const last = steps[steps.length - 1];
  if (t >= last.end) return last;
  return steps.find((step) => t >= step.start && t < step.end) ?? last;
}

export function targetPct(steps: WorkoutStep[], t: number): number {
  const step = stepAt(steps, t);
  if (!step) return 0.5;
  const span = step.end - step.start;
  const u = span <= 0 ? 1 : Math.min(1, Math.max(0, (t - step.start) / span));
  return step.fromPct + (step.toPct - step.fromPct) * u;
}

export function peakPct(steps: WorkoutStep[]): number {
  return steps.reduce((max, step) => Math.max(max, step.fromPct, step.toPct), 0);
}

/** Prescribed TSS from the target, one sample per second. IF is the normalized percent of FTP. */
export function prescribedLoad(steps: WorkoutStep[]): { tss: number; intensity: number } {
  const dur = Math.round(durationSec(steps));
  if (dur <= 0) return { tss: 0, intensity: 0 };
  let sum4 = 0;
  for (let i = 0; i < dur; i++) sum4 += targetPct(steps, i + 0.5) ** 4;
  const intensity = (sum4 / dur) ** 0.25;
  return { tss: intensity * intensity * (dur / 3600) * 100, intensity };
}

export function formatSession(sec: number): string {
  if (sec < 90) return `${Math.max(1, Math.round(sec))} s`;
  const minutes = Math.round(sec / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

export function cueAt(steps: WorkoutStep[], t: number, ftp: number, bias = 1): WorkoutCue {
  const dur = durationSec(steps);
  const clamped = Math.min(Math.max(0, t), Math.max(0, dur - 0.001));
  const step = stepAt(steps, clamped)!;
  const index = Math.max(0, steps.indexOf(step));
  const next = steps[index + 1];
  const pct = targetPct(steps, clamped);
  return {
    index,
    count: steps.length,
    pct,
    watts: Math.max(0, Math.round(pct * ftp * bias)),
    leftSec: Math.max(0, step.end - t),
    workoutLeftSec: Math.max(0, dur - t),
    text: step.text,
    cadence: step.cadence,
    zone: zoneName(pct),
    next: next ? next.text : 'End of the workout',
    step,
  };
}

/** Compact power trace for a workout row. `atSec` dims the part still ahead. */
export function barsHtml(steps: WorkoutStep[], atSec?: number, n = 48): string {
  const dur = durationSec(steps) || 1;
  let html = '<span class="power-bar" aria-hidden="true">';
  for (let i = 0; i < n; i++) {
    const t = ((i + 0.5) / n) * dur;
    const pct = targetPct(steps, t);
    const height = Math.max(8, Math.min(100, (pct / 1.75) * 100));
    const ahead = atSec != null && t > atSec ? ' is-ahead' : '';
    html += `<i class="${ahead}" style="height:${height.toFixed(0)}%;background:${zoneAt(pct).color}"></i>`;
  }
  html += '</span>';
  return html;
}
