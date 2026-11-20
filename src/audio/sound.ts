/**
 * Ride sound. Wind and the freewheel are made here from noise, so they follow
 * speed exactly and cost nothing to download. Crowds, the start horn, the summit
 * sting and the music are recorded files in src/assets/audio, loaded after the first
 * click (browsers keep audio locked until then) and streamed, never in the bundle.
 */

export type MusicMood = 'menu' | 'ride' | 'climb' | 'finale' | 'off';

export interface SoundSettings {
  master: number;
  music: number;
  effects: number;
  muted: boolean;
}

export interface RideSoundState {
  /** Rider speed, m/s. */
  speed: number;
  power: number;
  /** Rise over run. */
  grade: number;
  /** 0..1 how many fans are on the road here. */
  crowd: number;
  /** Metres to the finish line, or null in free rides. */
  toFinish: number | null;
  /** True while the game is paused or a menu is up. */
  paused: boolean;
}

/** Vite turns each file into a hashed URL. Nothing is put in the JS bundle. */
const AUDIO_URLS = import.meta.glob('../assets/audio/*', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

const STORE_KEY = 'cb-sound';
const DEFAULTS: SoundSettings = { master: 0.8, music: 0.45, effects: 0.8, muted: false };

const FILES = {
  crowdClimb: 'sfx-crowd-climb',
  crowdFinish: 'sfx-crowd-finish',
  startHorn: 'sfx-start-horn',
  freewheel: 'sfx-freewheel',
  bell: 'sfx-bell',
  cowbell: 'sfx-cowbell',
  kom: 'sfx-kom',
  alpine: 'sfx-alpine',
  sprint: 'sfx-sprint',
  windFast: 'sfx-wind',
  'music-menu': 'music-menu',
  'music-ride': 'music-ride',
  'music-climb': 'music-climb',
  'music-finale': 'music-finale',
} as const;
type FileKey = keyof typeof FILES;

function loadSettings(): SoundSettings {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    /* Private window or blocked storage: defaults are fine. */
  }
  return { ...DEFAULTS };
}

interface Loop {
  el: HTMLAudioElement;
  gain: GainNode;
  target: number;
}

class SoundEngine {
  settings = loadSettings();
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicBus!: GainNode;
  private fxBus!: GainNode;
  private wind: { src: AudioBufferSourceNode; filter: BiquadFilterNode; gain: GainNode } | null = null;
  private tickGain!: GainNode;
  private tickPhase = 0;
  private loops = new Map<FileKey, Loop>();
  private buffers = new Map<FileKey, AudioBuffer>();
  private music: { key: FileKey; loop: Loop } | null = null;
  private mood: MusicMood = 'off';
  private cowbellAt = 0;

  /** Call from a click or key handler. Safe to call often. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.musicBus = this.ctx.createGain();
    this.musicBus.connect(this.master);
    this.fxBus = this.ctx.createGain();
    this.fxBus.connect(this.master);
    this.tickGain = this.ctx.createGain();
    this.tickGain.gain.value = 0.32;
    this.tickGain.connect(this.fxBus);
    this.applySettings();
    this.buildWind();
    this.discover();
    if (this.mood !== 'off') this.setMusic(this.mood);
  }

  /** Preload the short effects. Missing files are simply silent, so the game never waits on audio. */
  private discover(): void {
    for (const key of ['startHorn', 'kom', 'bell', 'cowbell'] as FileKey[]) void this.buffer(key);
  }

  private url(key: FileKey): string | null {
    const base = FILES[key];
    for (const [path, url] of Object.entries(AUDIO_URLS)) {
      const name = path.split('/').pop() ?? '';
      if (name.startsWith(`${base}.`)) return url;
    }
    return null;
  }

  saveSettings(next: Partial<SoundSettings>): void {
    this.settings = { ...this.settings, ...next };
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(this.settings));
    } catch {
      /* Not saved; the change still applies to this session. */
    }
    this.applySettings();
  }

  toggleMute(): boolean {
    this.saveSettings({ muted: !this.settings.muted });
    return this.settings.muted;
  }

  private applySettings(): void {
    if (!this.ctx) return;
    const s = this.settings;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(s.muted ? 0 : s.master, t, 0.05);
    this.musicBus.gain.setTargetAtTime(s.music, t, 0.05);
    this.fxBus.gain.setTargetAtTime(s.effects, t, 0.05);
  }

  private buildWind(): void {
    const ctx = this.ctx!;
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    // Brown-ish noise: smoother than white, closer to air past your ears.
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      data[i] = last * 3.2;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 300;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter).connect(gain).connect(this.fxBus);
    src.start();
    this.wind = { src, filter, gain };
  }

  /** One freewheel pawl click: a very short filtered noise burst. */
  private tick(at: number): void {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * 0.006);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 3200;
    src.connect(hp).connect(this.tickGain);
    src.start(at);
  }

  private async buffer(key: FileKey): Promise<AudioBuffer | null> {
    if (!this.ctx) return null;
    const have = this.buffers.get(key);
    if (have) return have;
    const url = this.url(key);
    if (!url) return null;
    try {
      const res = await fetch(url);
      const buf = await this.ctx.decodeAudioData(await res.arrayBuffer());
      this.buffers.set(key, buf);
      return buf;
    } catch {
      return null;
    }
  }

  /** Short one-shot effect. */
  play(key: 'startHorn' | 'kom' | 'bell' | 'cowbell', volume = 1): void {
    if (!this.ctx) return;
    void this.buffer(key).then((buf) => {
      if (!buf || !this.ctx) return;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const g = this.ctx.createGain();
      g.gain.value = volume;
      src.connect(g).connect(this.fxBus);
      src.start();
    });
  }

  /** Countdown pip. The last one is longer and higher, like a start clock. */
  beep(final = false): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = final ? 1320 : 880;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.25, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (final ? 0.6 : 0.16));
    osc.connect(g).connect(this.fxBus);
    osc.start(t);
    osc.stop(t + 0.7);
  }

  /** Streamed loop (music, crowds, ambience). Created once, faded in and out by gain. */
  private loop(key: FileKey, bus: 'music' | 'fx'): Loop | null {
    if (!this.ctx) return null;
    const had = this.loops.get(key);
    if (had) return had;
    const url = this.url(key);
    if (!url) return null;
    const el = new Audio(url);
    el.loop = true;
    el.crossOrigin = 'anonymous';
    el.preload = 'auto';
    const node = this.ctx.createMediaElementSource(el);
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    node.connect(gain).connect(bus === 'music' ? this.musicBus : this.fxBus);
    const loop = { el, gain, target: 0 };
    this.loops.set(key, loop);
    return loop;
  }

  private fade(loop: Loop, target: number, seconds = 0.8): void {
    if (!this.ctx) return;
    if (Math.abs(loop.target - target) < 0.01) return;
    loop.target = target;
    if (target > 0 && loop.el.paused) void loop.el.play().catch(() => undefined);
    loop.gain.gain.setTargetAtTime(target, this.ctx.currentTime, seconds / 3);
    if (target === 0) {
      window.setTimeout(() => {
        if (loop.target === 0) loop.el.pause();
      }, seconds * 1000 + 200);
    }
  }

  setMusic(mood: MusicMood): void {
    this.mood = mood;
    if (!this.ctx) return;
    const key = mood === 'off' ? null : (`music-${mood}` as FileKey);
    if (this.music && this.music.key !== key) {
      this.fade(this.music.loop, 0, 2.5);
      this.music = null;
    }
    if (!key || this.music) return;
    const loop = this.loop(key, 'music');
    if (!loop) return;
    this.music = { key, loop };
    this.fade(loop, 1, 2.5);
  }

  /** Call every frame while riding. */
  updateRide(state: RideSoundState, dt: number): void {
    if (!this.ctx || !this.wind) return;
    const t = this.ctx.currentTime;
    const v = state.paused ? 0 : Math.max(0, state.speed);
    // Wind rises with the square of speed, and the hiss opens up as you go faster.
    const windLevel = Math.min(0.55, (v / 18) ** 2 * 0.55);
    this.wind.gain.gain.setTargetAtTime(windLevel, t, 0.25);
    this.wind.filter.frequency.setTargetAtTime(250 + v * 70, t, 0.25);

    // Freewheel: clicks only when you stop pedalling and the bike still rolls.
    const coasting = !state.paused && state.power < 12 && v > 1.5;
    if (coasting) {
      // About 36 pawl clicks per wheel turn would be a buzz. Real hubs sound like 6–10 clicks a second at speed.
      const rate = Math.min(14, 2 + v * 0.75);
      this.tickPhase += rate * dt;
      while (this.tickPhase >= 1) {
        this.tickPhase -= 1;
        this.tick(t + Math.random() * 0.01);
      }
    } else this.tickPhase = 0;

    // Recorded rush of air on fast descents, on top of the synth wind.
    const fast = this.loop('windFast', 'fx');
    if (fast) this.fade(fast, v > 12 ? Math.min(0.5, (v - 12) / 10) : 0, 1);

    const crowd = state.paused ? 0 : Math.max(0, Math.min(1, state.crowd));
    const climbLoop = this.loop('crowdClimb', 'fx');
    if (climbLoop) this.fade(climbLoop, crowd * 0.7, 1.2);
    const finishLoop = this.loop('crowdFinish', 'fx');
    const near = state.toFinish !== null && state.toFinish < 400 && state.toFinish > -60 && !state.paused;
    if (finishLoop) this.fade(finishLoop, near ? 0.85 : 0, near ? 1.5 : 3);
    const ambience = this.loop('alpine', 'fx');
    if (ambience) this.fade(ambience, state.paused ? 0 : 0.18 * (1 - crowd), 2);

    if (crowd > 0.45 && performance.now() > this.cowbellAt) {
      this.cowbellAt = performance.now() + 6000 + Math.random() * 9000;
      this.play('cowbell', 0.35 + crowd * 0.3);
    }
  }

  /** Leave a ride: quiet the road sounds, keep the music. */
  stopRide(): void {
    if (!this.ctx || !this.wind) return;
    this.wind.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2);
    for (const key of ['crowdClimb', 'crowdFinish', 'alpine', 'windFast'] as FileKey[]) {
      const loop = this.loops.get(key);
      if (loop) this.fade(loop, 0, 1);
    }
  }
}

export const sound = new SoundEngine();
