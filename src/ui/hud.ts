import type { DeviceManager } from '../ble/devices';
import type { RideSession } from '../game/session';
import type { RideCamera, RideMap } from '../storage/types';
import { ftpFromTwentyMinutes } from '../training/ftp';
import { barsHtml } from '../training/workout';
import { formatDuration } from '../util/math';
import { ATMOSPHERES, type TimeOfDay } from '../world/atmosphere';
import { CAMERA_LABEL } from '../world/world';
import { $, esc, gradeColor } from './dom';
import { Minimap, type MapMode } from './minimap';
import { ProfileChart, type ChartMarker } from './profileChart';
import { rideBar } from './rideBar';

const ICON = {
  power: '<svg viewBox="0 0 24 24"><path d="M13 2 4 14h7l-1 8 9-12h-7z" fill="currentColor"/></svg>',
  cadence: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M12 12 17 8" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
  heart: '<svg viewBox="0 0 24 24"><path d="M12 21s-7.5-4.6-9.6-9.3C1 8.3 3.2 4.5 7 4.5c2.1 0 3.6 1.2 5 3 1.4-1.8 2.9-3 5-3 3.8 0 6 3.8 4.6 7.2C19.5 16.4 12 21 12 21z" fill="currentColor"/></svg>',
  speed: '<svg viewBox="0 0 24 24"><path d="M4 17a8 8 0 1 1 16 0" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="m12 17 4.5-5.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
};

const MAP_NAME: Record<RideMap, string> = {
  ahead: 'Nearby road',
  wide: 'Wider road',
  loop: 'Full loop',
};

export class Hud {
  readonly root: HTMLElement;
  private chart: ProfileChart;
  private map: Minimap;
  private lastStandings = 0;
  private tools: { camera: () => void; time: () => void; map: () => void; reverse: () => void; brake: (held: boolean) => void } | null = null;
  private onOrder: ((kind: 'pace' | 'wait' | 'wkg', value?: number) => void) | null = null;

  constructor(host: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'hud';
    this.root.innerHTML = `
      <div class="hud-left">
        <div class="hud-metrics glass">
          <div class="metric big"><span class="ico">${ICON.power}</span><div><b id="h-power">0</b><small>W</small><div class="sub" id="h-wkg">0.0 W/kg</div></div></div>
          <div class="metric"><span class="ico">${ICON.cadence}</span><b id="h-cad">0</b><small>rpm</small></div>
          <div class="metric"><span class="ico heart">${ICON.heart}</span><b id="h-hr">--</b><small>bpm</small></div>
          <div class="metric"><span class="ico">${ICON.speed}</span><b id="h-speed">0.0</b><small>km/h</small></div>
          <div class="hud-brake" id="h-brake">BRAKE</div>
          <div class="hud-draft" id="h-draft">DRAFT</div>
        </div>
        <div class="hud-map glass"><canvas id="h-map"></canvas></div>
      </div>
      <div class="hud-top glass" id="h-top">
        <div class="hud-top-title" id="h-title"></div>
        <div class="hud-progress"><div class="bar" id="h-bar"></div><div class="marker" id="h-marker"></div></div>
        <div class="hud-top-sub"><span id="h-left"></span><span class="grade" id="h-grade">0.0%</span></div>
        <div class="hud-tt-start" id="h-tt-start" hidden><span>Your start</span><b id="h-tt-start-time"></b></div>
      </div>
      <div class="hud-ride glass">
        <div><small>Time</small><b id="h-time">0:00</b></div>
        <div><small>Distance</small><b id="h-dist">0.00 km</b></div>
        <div><small>Elevation</small><b id="h-alt">0 m</b></div>
        <div><small>Avg power</small><b id="h-avg">0 W</b></div>
        <div><small>Avg speed</small><b id="h-avgs">0.0 km/h</b></div>
      </div>
      <div class="hud-side glass" id="h-side-wrap">
        <div id="h-side"></div>
        <div id="h-orders" class="hidden">
          <button type="button" data-order="pace"><span>Teammates to the front</span></button>
          <label class="order-wkg">Their effort <b id="h-order-wkg">3.5</b> W/kg
            <input id="h-order-slider" type="range" min="1" max="6.5" step="0.1" value="3.5" />
          </label>
          <button type="button" data-order="wait"><span>Riders in the breakaway wait</span></button>
        </div>
      </div>
      <div class="hud-tools glass">
        <button type="button" data-tool="camera"><kbd>C</kbd><span id="h-tool-camera">Chase camera</span></button>
        <button type="button" data-tool="time"><kbd>T</kbd><span id="h-tool-time">Golden hour</span></button>
        <button type="button" data-tool="map"><kbd>M</kbd><span id="h-tool-map">Nearby road</span></button>
        <button type="button" data-tool="reverse" class="is-dim"><kbd>R</kbd><span id="h-tool-reverse">Turn around</span></button>
        <button type="button" data-tool="brake"><kbd>B</kbd><span id="h-tool-brake">Brake</span></button>
      </div>
      <div class="hud-bottom glass">
        <div class="hud-elev"><span id="h-elev-a"></span><span id="h-elev-b"></span></div>
        <div class="hud-profile">
          <div class="hud-gaps" id="h-gaps"></div>
          <canvas id="h-profile"></canvas>
        </div>
      </div>
      <div class="hud-hint" id="h-hint"></div>
      <div class="hud-countdown" id="h-countdown"></div>
      <div class="hud-status" id="h-status"></div>
    `;
    host.appendChild(this.root);
    this.chart = new ProfileChart($('#h-profile', this.root) as HTMLCanvasElement);
    this.map = new Minimap($('#h-map', this.root) as HTMLCanvasElement);
    this.root.querySelector('.hud-tools')?.addEventListener('click', (event) => {
      const tool = (event.target as HTMLElement).closest('button')?.dataset.tool;
      if (tool === 'camera') this.tools?.camera();
      else if (tool === 'time') this.tools?.time();
      else if (tool === 'map') this.tools?.map();
      else if (tool === 'reverse') this.tools?.reverse();
    });
    const brake = this.root.querySelector<HTMLButtonElement>('[data-tool="brake"]');
    let holding = false;
    const holdBrake = (held: boolean) => {
      if (holding === held) return;
      holding = held;
      this.tools?.brake(held);
    };
    brake?.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      holdBrake(true);
    });
    const release = () => holdBrake(false);
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    this.root.querySelector('#h-orders')?.addEventListener('click', (event) => {
      const kind = (event.target as HTMLElement).closest('button')?.dataset.order;
      if (kind === 'pace' || kind === 'wait') this.onOrder?.(kind);
    });
    this.root.querySelector<HTMLInputElement>('#h-order-slider')?.addEventListener('input', (event) => {
      const value = Number((event.target as HTMLInputElement).value);
      $('#h-order-wkg', this.root).textContent = value.toFixed(1);
      this.onOrder?.('wkg', value);
    });
  }

  bindOrders(handler: (kind: 'pace' | 'wait' | 'wkg', value?: number) => void): void {
    this.onOrder = handler;
  }

  /** Team orders sit under the live standings. Hidden outside a career road stage. */
  setOrders(show: boolean, pace: boolean, wkg: number, wait: boolean): void {
    const box = $('#h-orders', this.root);
    box.classList.toggle('hidden', !show);
    box.querySelector('[data-order="pace"]')?.classList.toggle('on', pace);
    box.querySelector('[data-order="wait"]')?.classList.toggle('on', wait);
    $('#h-order-wkg', this.root).textContent = wkg.toFixed(1);
    const slider = this.root.querySelector<HTMLInputElement>('#h-order-slider');
    if (slider && document.activeElement !== slider && slider.value !== wkg.toFixed(1)) slider.value = wkg.toFixed(1);
  }

  /** Clicks on the camera, time and map rows. Brake is held for as long as the row is pressed. */
  bindTools(tools: { camera: () => void; time: () => void; map: () => void; reverse: () => void; brake: (held: boolean) => void }): void {
    this.tools = tools;
  }

  setMap(mode: MapMode): void {
    this.map.setMode(mode);
  }

  mapMode(): RideMap {
    return this.map.current();
  }

  /** Names on the shortcut rows under the ride stats. */
  setTools(camera: RideCamera, time: TimeOfDay, map: RideMap): void {
    this.text('#h-tool-camera', CAMERA_LABEL[camera]);
    this.text('#h-tool-time', ATMOSPHERES[time].label);
    this.text('#h-tool-map', MAP_NAME[map]);
  }

  /** Highlights the Brake row while the bike is slowing. */
  setBrake(on: boolean): void {
    this.root.querySelector('[data-tool="brake"]')?.classList.toggle('is-on', on);
  }

  /** R is hidden in a race, and faded until the bike is stopped. */
  setReverse(show: boolean, ready: boolean): void {
    const btn = this.root.querySelector<HTMLButtonElement>('[data-tool="reverse"]');
    if (!btn) return;
    btn.hidden = !show;
    btn.classList.toggle('is-dim', !ready);
  }

  show(v: boolean): void {
    this.root.classList.toggle('hidden', !v);
  }

  toggle(): void {
    this.root.classList.toggle('collapsed');
  }

  /** Switch the minimap: nearby road, wider road, then the whole loop. */
  toggleMap(): string {
    return this.map.toggle();
  }

  update(session: RideSession, devices: DeviceManager, now: number): void {
    const p = session.player;
    const route = session.route;
    const weight = session.config.profile.weightKg;
    const pw = Math.round(session.power3s);
    this.text('#h-power', String(pw));
    const trainCue = session.config.mode === 'train' ? session.workoutCue(session.config.profile.ftp) : null;
    if (trainCue) {
      const tol = Math.max(12, trainCue.watts * 0.06);
      this.style('#h-power', 'color', Math.abs(pw - trainCue.watts) <= tol ? '#b6ffd0' : pw < trainCue.watts ? '#ffd0a8' : '#ffb4ae');
      this.text('#h-wkg', `target ${trainCue.watts} W`);
    } else {
      this.style('#h-power', 'color', '');
      this.text('#h-wkg', `${(pw / weight).toFixed(1)} W/kg`);
    }
    this.text('#h-cad', String(Math.round(devices.currentCadence())));
    const hr = devices.currentHeartRate();
    this.text('#h-hr', hr > 0 ? String(hr) : '--');
    this.text('#h-speed', (p.v * 3.6).toFixed(1));
    this.node('#h-brake').classList.toggle('on', session.braking);
    this.setBrake(session.braking);
    this.node('#h-draft').classList.toggle('on', p.draft > 0.08);

    this.map.draw(session);

    const grade = session.feltGrade(0);
    const gradeFill = gradeColor(grade);
    this.text('#h-grade', `${(grade * 100).toFixed(1)}%`);
    this.style('#h-grade', 'background', gradeFill);
    this.style('#h-grade', 'color', gradeFill === '#f39237' ? '#fff' : '#111');

    // Top bar: current climb or lap info. A race always runs forward.
    const s = route.wrap(p.s);
    if (session.config.mode === 'train') {
      const cue = trainCue;
      const dur = session.config.workout?.durationSec ?? 1;
      const frac = Math.max(0, Math.min(1, session.rideTime / dur));
      this.text('#h-title', cue ? `${cue.zone} · ${cue.watts} W` : session.config.workout?.workoutName ?? 'Workout');
      this.style('#h-bar', 'width', `${frac * 100}%`);
      this.style('#h-marker', 'left', `${frac * 100}%`);
      this.text('#h-left', cue ? `${formatDuration(cue.leftSec)} in this block · ${formatDuration(cue.workoutLeftSec)} left` : '');
    } else if (session.config.mode === 'race') {
      const climb = session.config.climb!;
      const cs = p.s;
      const rideDir: 1 | -1 = climb.end >= climb.start ? 1 : -1;
      const along = (cs - climb.start) * rideDir;
      const frac = Math.max(0, Math.min(1, along / climb.length));
      const left = Math.max(0, climb.length - along);
      const title = session.config.career?.title ?? climb.name;
      this.text('#h-title', along < 0 ? `${title} starts in ${Math.round(-along)} m` : title);
      this.style('#h-bar', 'width', `${frac * 100}%`);
      this.style('#h-marker', 'left', `${frac * 100}%`);
      const still = Math.round(climb.summitElevation - route.elevationAt(cs));
      this.text('#h-left', session.config.career
        ? careerCountdown(session, cs)
        : `${(left / 1000).toFixed(1)} km to summit · ${still} m to climb`);
    } else {
      const bar = rideBar({
        s: p.s,
        length: route.length,
        direction: p.direction,
        name: route.def.name,
        lap: session.lap,
        climbs: route.climbs,
        elevationAt: (at) => route.elevationAt(at),
      });
      this.text('#h-title', bar.title);
      this.style('#h-bar', 'width', `${bar.frac * 100}%`);
      this.style('#h-marker', 'left', `${bar.frac * 100}%`);
      this.text('#h-left', bar.detail);
    }

    const trialClock = session.config.career?.road.timeTrial === true;
    this.text('#h-time', formatDuration(trialClock ? session.sim.ownClock(session.player) : session.config.mode === 'race' ? session.sim.time : session.rideTime));
    this.text('#h-dist', `${(session.distance / 1000).toFixed(2)} km`);
    this.text('#h-alt', `+${Math.round(session.climbedM)} m`);
    this.text('#h-avg', `${Math.round(session.avgPower)} W`);
    this.text('#h-avgs', `${session.avgSpeedKmh.toFixed(1)} km/h`);

    // Profile
    const markers: ChartMarker[] = [];
    if (session.config.mode === 'race') {
      const c = session.config.climb!;
      const rideDir: 1 | -1 = c.end >= c.start ? 1 : -1;
      for (const r of session.sim.racers) {
        if (r.isPlayer || (session.config.career?.road.timeTrial && session.sim.time < r.ttStart)) continue;
        const past = (r.s - c.end) * rideDir > 0;
        markers.push({ s: past ? c.end : r.s, color: 'rgba(255,255,255,0.75)', size: 2 });
      }
      for (const feature of session.config.career?.road.features ?? []) {
        markers.push({
          s: feature.s,
          color: feature.kind === 'sprint' ? '#3ddc84' : '#ff4d4d',
          size: 4,
          label: feature.kind === 'sprint' ? 'S' : 'M',
        });
      }
      markers.push({ s: p.s, color: '#ff7f2a', size: 5 });
      const lo = Math.min(c.start, c.end);
      const hi = Math.max(c.start, c.end);
      const backward = c.end < c.start;
      this.chart.draw(route, lo - (backward ? 100 : 150), hi + (backward ? 150 : 100), markers, { reverse: backward });
      this.html('#h-gaps', session.config.career && !session.config.career.road.timeTrial ? groupGaps(session) : '');
      // Top label is the top of the chart: the higher of start and finish.
      const high = Math.max(c.startElevation, c.summitElevation);
      const low = Math.min(c.startElevation, c.summitElevation);
      this.text('#h-elev-a', `${Math.round(high)} m`);
      this.text('#h-elev-b', `${Math.round(low)} m`);
    } else {
      markers.push({ s, color: '#ff7f2a', size: 5 });
      this.chart.draw(route, 0, route.length, markers, { wrap: true, reverse: p.direction < 0 });
      this.text('#h-gaps', '');
      this.text('#h-elev-a', `Lap ${session.lap}`);
      this.text('#h-elev-b', `${(route.length / 1000).toFixed(1)} km`);
    }

    if (now - this.lastStandings > 400) {
      this.lastStandings = now;
      this.updateSide(session);
    }

    const trial = session.config.career?.road.timeTrial === true;
    const cue = trial ? ttStartCue(session.sim.started, session.sim.time, session.player.ttStart) : { big: null, wait: null };
    if (session.state === 'countdown') {
      this.style('#h-countdown', 'display', 'flex');
      this.text('#h-countdown', String(Math.ceil(session.countdown)));
    } else if (cue.big) {
      this.style('#h-countdown', 'display', 'flex');
      this.text('#h-countdown', cue.big);
    } else if (!trial && session.sim.started && session.sim.time < 1.5 && session.config.mode === 'race') {
      this.style('#h-countdown', 'display', 'flex');
      this.text('#h-countdown', 'GO!');
    } else {
      this.style('#h-countdown', 'display', 'none');
    }
    const waiting = cue.wait != null;
    if (this.written.get('#h-tt-start|hidden') !== String(waiting)) {
      this.written.set('#h-tt-start|hidden', String(waiting));
      this.node('#h-tt-start').hidden = !waiting;
    }
    this.text('#h-tt-start-time', cue.wait ?? '');

    if (session.config.career && this.mapMode() === 'loop') this.text('#h-tool-map', 'This stage');
    this.html('#h-hint', session.inOpenEffort
      ? `Your power for 20 minutes. ${devices.isVirtual ? '<kbd>&uarr;</kbd>/<kbd>&darr;</kbd> change watts. ' : ''}The road sets the resistance.`
      : session.config.mode === 'train' && session.erg
      ? `ERG <b>${trainCue?.watts ?? 0} W</b> &nbsp;<kbd>&uarr;</kbd>/<kbd>&darr;</kbd> nudge the target &nbsp;<kbd>E</kbd> slope`
      : devices.isVirtual
        ? `Virtual trainer: <b>${devices.virtualPower} W</b> &nbsp;<kbd>&uarr;</kbd>/<kbd>&darr;</kbd> change power`
        : '');
    const st = devices.status;
    const status =
      st.trainer === 'reconnecting'
        ? 'Trainer connection lost, reconnecting...'
        : st.trainer === 'disconnected'
          ? 'No trainer connected. Press Esc and connect your trainer.'
          : '';
    this.text('#h-status', status);
    this.style('#h-status', 'display', status ? 'block' : 'none');
  }

  // Ten updates a second wrote some twenty values each time, most of them unchanged.
  // Each write dirties layout; only real changes reach the DOM now.
  private els = new Map<string, HTMLElement>();
  private written = new Map<string, string>();

  private node(sel: string): HTMLElement {
    let el = this.els.get(sel);
    if (!el) this.els.set(sel, (el = $(sel, this.root)));
    return el;
  }

  private text(sel: string, value: string): void {
    const key = `${sel}|text`;
    if (this.written.get(key) === value) return;
    this.written.set(key, value);
    this.node(sel).textContent = value;
  }

  private html(sel: string, value: string): void {
    const key = `${sel}|html`;
    if (this.written.get(key) === value) return;
    this.written.set(key, value);
    this.node(sel).innerHTML = value;
  }

  private style(sel: string, prop: 'color' | 'background' | 'width' | 'left' | 'display', value: string): void {
    const key = `${sel}|${prop}`;
    if (this.written.get(key) === value) return;
    this.written.set(key, value);
    this.node(sel).style[prop] = value;
  }

  private updateSide(session: RideSession) {
    const wrap = $('#h-side-wrap', this.root);
    const side = $('#h-side', this.root);
    if (session.config.mode === 'train') {
      wrap.classList.add('coach');
      const workout = session.config.workout;
      const cue = session.workoutCue(session.config.profile.ftp);
      const compliance = session.compliance;
      if (!workout || !cue) {
        side.innerHTML = '';
        return;
      }
      if (workout.ftpProtocol === 'twenty' && (session.inOpenEffort || session.ftpEstimate != null)) {
        const done = session.ftpEstimate != null;
        const average = session.twentyAverage;
        const shown = done ? session.ftpEstimate : average == null ? null : Math.round(average);
        const liveFtp = !done && average != null ? ftpFromTwentyMinutes(average) : null;
        side.innerHTML = `
          <div class="side-title">${esc(workout.planName)}</div>
          <div class="coach-target"><b>${shown == null ? '—' : shown}</b><span>${done ? 'W · FTP' : 'W · 20-min average'}</span></div>
          <p class="coach-text">${done ? `Test done. 20-minute average was ${session.ftpAverage ?? shown} W. Spin easy. This becomes your FTP when the ride is saved.` : 'As hard as you can hold, right to the end. Keep it even.'}</p>
          ${done ? '' : `<div class="kv"><span>FTP at this pace</span><b>${liveFtp == null ? '—' : `${liveFtp} W`}</b></div>`}
          <div class="kv"><span>This block</span><b>${formatDuration(cue.leftSec)}</b></div>
          <div class="kv"><span>Workout left</span><b>${formatDuration(cue.workoutLeftSec)}</b></div>
          <p class="coach-next">${done ? 'Cool down, then save the ride.' : 'FTP is 95% of this average.'}</p>
          ${barsHtml(workout.steps, session.rideTime, 42)}
        `;
        return;
      }
      side.innerHTML = `
        <div class="side-title">${esc(workout.planName)}</div>
        <div class="coach-target"><b>${cue.watts}</b><span>W · ${esc(cue.zone)}</span></div>
        <p class="coach-text">${esc(cue.text)}</p>
        <div class="kv"><span>Cadence</span><b>${esc(cue.cadence)}</b></div>
        <div class="kv"><span>This block</span><b>${formatDuration(cue.leftSec)}</b></div>
        <div class="kv"><span>Workout left</span><b>${formatDuration(cue.workoutLeftSec)}</b></div>
        <div class="kv"><span>Block</span><b>${cue.index + 1} / ${cue.count}</b></div>
        <div class="kv"><span>${session.erg ? 'ERG' : 'Slope'}</span><b>${session.erg ? `${Math.round(session.ergBias * 100)}%` : 'Road'}</b></div>
        ${compliance == null ? '' : `<div class="kv"><span>On target</span><b>${Math.round(compliance * 100)}%</b></div>`}
        <p class="coach-next">Next: ${esc(cue.next)}</p>
        ${barsHtml(workout.steps, session.rideTime, 42)}
      `;
      return;
    }
    wrap.classList.remove('coach');
    if (session.config.mode !== 'race') {
      const efforts = session.newEfforts.slice(-3).reverse();
      side.innerHTML = `
        <div class="side-title">Ride</div>
        <div class="kv"><span>Lap</span><b>${session.lap}</b></div>
        <div class="kv"><span>Lap progress</span><b>${((session.route.wrap(session.playerS) / session.route.length) * 100).toFixed(0)}%</b></div>
        <div class="kv"><span>Energy</span><b>${Math.round(session.energyJ / 1000)} kJ</b></div>
        <div class="kv"><span>Difficulty</span><b>${session.config.profile.difficulty}%</b></div>
        ${efforts.length ? `<div class="side-title small">Climbs completed</div>${efforts.map((e) => `<div class="kv"><span>${esc(e.climbName)}</span><b>${formatDuration(e.timeSec)}</b></div>`).join('')}` : ''}
      `;
      return;
    }
    const st = session.sim.standings();
    const me = st.indexOf(session.player);
    const trial = session.config.career?.road.timeTrial === true;
    const leaders = session.config.career?.leaders;
    const points = leaders
      ? `<div class="kv"><span>Time</span><b>${esc(leaders.time || '—')}</b></div><div class="kv"><span>Sprint</span><b>${esc(leaders.sprint || '—')}</b></div><div class="kv"><span>Mountains</span><b>${esc(leaders.mountains || '—')}</b></div>`
      : '';
    const rideDir: 1 | -1 = session.player.direction < 0 ? -1 : 1;
    const mates = session.config.career
      ? session.sim.racers.filter((r) => r.road?.teammate && !r.isPlayer).sort((a, b) => (b.s - a.s) * rideDir)
      : [];
    const energy = mates.length
      ? `<div class="side-title small">Team stamina</div>${mates.map((r) => {
        const left = Math.round((r.energy ?? 1) * 100);
        const tone = left < 30 ? 'low' : left < 55 ? 'mid' : 'ok';
        return `<div class="energy-row"><span>${esc(r.name)}</span><span class="energy-bar ${tone}" title="${left}%"><i style="width:${left}%"></i></span></div>`;
      }).join('')}`
      : '';
    const board = session.config.career ? '' : standingsBoard(st, me);
    const prime = primeBoard(session);
    const still = trial ? session.sim.racers.filter((r) => r.finishTime == null).length : 0;
    const waiting = trial && session.sim.time < session.player.ttStart;
    const title = trial
      ? waiting
        ? `Your start in ${formatDuration(Math.ceil(session.player.ttStart - session.sim.time))}`
        : session.player.finishTime != null
          ? `Your time ${formatDuration(session.player.finishTime)} · ${still} still riding`
          : 'Time trial'
      : `Position <b>${me + 1}</b> / ${st.length}`;
    side.innerHTML = `
      <div class="side-title">${title}</div>
      ${board}
      ${points}
      ${energy}
      ${prime}
    `;
  }
}

/** Big centre count for the last 10 seconds, and the smaller clock from the first rider until you. */
export function ttStartCue(started: boolean, time: number, ttStart: number): { big: string | null; wait: string | null } {
  if (!started) return { big: null, wait: null };
  if (ttStart <= 0) return { big: time < 1.5 ? 'GO!' : null, wait: null };
  const until = ttStart - time;
  if (until > 0) {
    const left = Math.ceil(until);
    return { big: left <= 10 ? String(left) : null, wait: formatDuration(left) };
  }
  if (time < ttStart + 1.5) return { big: 'GO!', wait: null };
  return { big: null, wait: null };
}

function careerCountdown(session: RideSession, s: number): string {
  const plan = session.config.career?.road;
  if (!plan) return '';
  const dir: 1 | -1 = plan.dir === -1 ? -1 : 1;
  const remain = (mark: number) => (mark - s) * dir;
  const ahead = plan.features.filter((feature) => remain(feature.s) > 8).sort((a, b) => remain(a.s) - remain(b.s));
  const sprint = ahead.find((feature) => feature.kind === 'sprint');
  const climb = ahead.find((feature) => feature.kind === 'kom');
  const parts: string[] = [];
  if (sprint) parts.push(`Sprint ${(remain(sprint.s) / 1000).toFixed(1)} km`);
  if (climb) parts.push(`${climb.name} ${(remain(climb.s) / 1000).toFixed(1)} km`);
  parts.push(`Finish ${(Math.max(0, remain(plan.finishS)) / 1000).toFixed(1)} km`);
  return parts.join(' · ');
}

function primeBoard(session: RideSession): string {
  const plan = session.config.career?.road;
  if (!plan) return '';
  const time = session.sim.time;
  const live = plan.features.filter((feature) => feature.scored.length > 0 && (feature.doneAt == null || time - feature.doneAt < 9));
  const feature = live.find((item) => item.doneAt == null) ?? live[live.length - 1];
  if (!feature) return '';
  const age = feature.doneAt == null ? 0 : time - feature.doneAt;
  const opacity = age < 5 ? 1 : Math.max(0, 1 - (age - 5) / 4);
  const title = feature.kind === 'sprint' ? 'Sprint' : 'Mountains';
  const rows = feature.scored.map((row, index) => `<div class="prime-row"><span>${index + 1}</span><b>${esc(row.name)}</b><span>${row.pts}</span></div>`).join('');
  return `<div class="prime-board" style="opacity:${opacity.toFixed(2)}"><div class="side-title small">${title} · ${esc(feature.name)}</div>${rows}</div>`;
}

const JERSEY_PIP: Record<string, { color: string; title: string }> = {
  Y: { color: '#ffe100', title: 'Yellow jersey' },
  P: { color: '#f4a3c7', title: 'Pink jersey' },
  R: { color: '#e10600', title: 'Red jersey' },
  S: { color: '#128a3e', title: 'Points jersey' },
  M: { color: '#d0121a', title: 'Mountains jersey' },
  W: { color: '#f4f4f4', title: 'Youth jersey' },
  C: { color: '#6f2dbd', title: 'World champion' },
  E: { color: '#ffcc00', title: 'European champion' },
};

function jerseyPips(badges: string[]): string {
  if (!badges.length) return '';
  return `<span class="gap-pips">${badges.map((badge) => {
    const pip = JERSEY_PIP[badge] ?? { color: '#fff', title: 'Leader jersey' };
    return `<i class="gap-pip" style="background:${pip.color}" title="${esc(pip.title)}"></i>`;
  }).join('')}</span>`;
}

/** Riders kept in the live classification besides the pinned leader and last place. */
const STANDINGS_NEARBY = 11;

interface StandingRider {
  s: number;
  v: number;
  officialTime: number | null;
  finishTime: number | null;
  isPlayer: boolean;
  name: string;
  country: string;
  colors: { jersey: string };
}

/** Leader on the first row, last place on the last row, and the riders around you between them. */
function standingsBoard(st: StandingRider[], me: number): string {
  if (me < 0 || st.length === 0) return '';
  const leader = st[0];
  const ranks = standingRanks(st.length, me, nearbyCount());
  let prev = -1;
  const rows: string[] = [];
  for (const rank of ranks) {
    if (prev >= 0 && rank > prev + 1) rows.push('<div class="skip">···</div>');
    rows.push(standingRow(st[rank], rank, leader, rank === st.length - 1));
    prev = rank;
  }
  return rows.join('');
}

function nearbyCount(): number {
  if (window.innerWidth > 1000) return STANDINGS_NEARBY;
  const room = window.innerHeight - 520;
  if (room < 190) return 1;
  if (room < 250) return 3;
  if (room < 330) return 5;
  return STANDINGS_NEARBY;
}

function standingRanks(count: number, me: number, nearby = STANDINGS_NEARBY): number[] {
  if (count <= nearby + 2) return Array.from({ length: count }, (_, i) => i);
  const last = count - 1;
  const half = Math.floor(nearby / 2);
  let from = Math.max(0, me - half);
  let to = Math.min(last, from + nearby - 1);
  from = Math.max(0, to - nearby + 1);
  const ranks = new Set<number>([0, last]);
  for (let i = from; i <= to; i++) ranks.add(i);
  return [...ranks].sort((a, b) => a - b);
}

function standingRow(rider: StandingRider, rank: number, leader: StandingRider, last: boolean): string {
  const classes = ['row'];
  if (rider.isPlayer) classes.push('me');
  else if (rank === 0 || last) classes.push('pin');
  const jersey = /^#[0-9a-fA-F]{3,8}$/.test(rider.colors.jersey) ? rider.colors.jersey : '#888';
  const country = rider.isPlayer ? '' : esc(rider.country);
  return `<div class="${classes.join(' ')}"><span class="pos">${rank + 1}</span><span class="dot" style="background:${jersey}"></span><span class="name">${esc(rider.name)}</span><span class="ctry">${country}</span><span class="gap">${liveGap(leader, rider)}</span></div>`;
}

/** Clock gap once both have finished. Otherwise the distance, at the speed of whoever is still riding. */
function liveGap(leader: StandingRider, rider: StandingRider, dir: 1 | -1 = 1): string {
  if (rider === leader) return '';
  const leaderClock = leader.officialTime ?? leader.finishTime;
  const clock = rider.officialTime ?? rider.finishTime;
  if (leaderClock != null && clock != null) {
    const delta = clock - leaderClock;
    return delta < 0.5 ? '<i>s.t.</i>' : `+${formatDuration(delta)}`;
  }
  const behind = (leader.s - rider.s) * dir;
  if (behind < 2) return '<i>s.t.</i>';
  const moving = Math.max(leaderClock == null ? leader.v : 0, rider.v);
  if (moving < 1) return '<i>s.t.</i>';
  const seconds = behind / moving;
  return seconds < 1 ? '<i>s.t.</i>' : `+${formatDuration(seconds)}`;
}

/** Every group's time gap to the player. The player's own group is marked. */
function groupGaps(session: RideSession): string {
  const dir: 1 | -1 = session.player.direction < 0 ? -1 : 1;
  const riders = session.sim.racers.filter((r) => r.finishTime == null).sort((a, b) => (b.s - a.s) * dir);
  if (riders.length < 2) return '';
  const groups: { count: number; front: number; back: number; v: number; mine: boolean; badges: string[] }[] = [];
  for (const r of riders) {
    const badge = r.road?.badge ?? '';
    const group = groups[groups.length - 1];
    if (!group || (group.back - r.s) * dir > 8) groups.push({ count: 1, front: r.s, back: r.s, v: Math.max(2, r.v), mine: r.isPlayer, badges: badge ? [badge] : [] });
    else {
      group.count += 1;
      group.back = r.s;
      group.v = Math.max(group.v, r.v);
      group.mine = group.mine || r.isPlayer;
      if (badge && !group.badges.includes(badge)) group.badges.push(badge);
    }
  }
  const player = session.player;
  const speed = Math.max(2, player.v);
  return groups.slice(0, 8).map((group) => {
    const pips = jerseyPips(group.badges);
    if (group.mine) return `<span class="gap-chip me"><b>${esc(session.player.name)}</b><small>${group.count}</small>${pips}</span>`;
    const ahead = (group.back - player.s) * dir > 0;
    const metres = ahead ? (group.back - player.s) * dir : (player.s - group.front) * dir;
    const sign = ahead ? '−' : '+';
    return `<span class="gap-chip"><b>${sign}${formatDuration(metres / speed)}</b><small>${group.count}</small>${pips}</span>`;
  }).join('');
}
