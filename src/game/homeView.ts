import { REAL_CLIMBS } from '../routes/real/data';
import type { RealClimb } from '../routes/real/types';

/**
 * The play menu. The 3D valley stays the picture; the menu is one column of
 * big words you can read from the saddle, each with its number key, and one
 * real climb of the day on the right.
 */

export interface HomeRider {
  name: string;
  weightKg: number;
  ftp: number;
  trainer: string;
}

const HOME_MODES: { go: string; title: string; line: string; hidden?: boolean }[] = [
  { go: 'free', title: 'Free ride', line: 'Free laps on any road, or a real climb' },
  { go: 'race', title: 'Hill climb race', line: 'Mass start at the foot, first to the top wins' },
  { go: 'pro', title: 'Pro race', line: 'Famous stages. 25, 50 or 100% of the day', hidden: true },
  { go: 'plans', title: 'Training plans', line: 'Plans and workouts in ERG' },
  { go: 'career', title: 'Career mode', line: 'A season as a team leader' },
];

/** Modes on the play menu. Hidden ones stay in the game, off this list, and the number keys stay in order. */
export const HOME_KEYS: { key: string; go: string; title: string; line: string }[] = HOME_MODES
  .filter((mode) => !mode.hidden)
  .map((mode, index) => ({ key: String(index + 1), go: mode.go, title: mode.title, line: mode.line }));

const QUIET: { go: string; title: string }[] = [
  { go: 'history', title: 'Analytics' },
  { go: 'garage', title: 'Bike and kit' },
  { go: 'settings', title: 'Settings' },
  { go: 'help', title: 'Trainer setup' },
];

/** Same climb all day, a different one tomorrow. */
export function climbOfTheDay(date = new Date()): RealClimb | undefined {
  if (!REAL_CLIMBS.length) return undefined;
  const day = Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000);
  return REAL_CLIMBS[(day * 7 + 3) % REAL_CLIMBS.length];
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}

/** Minutes up a climb at about 95% of FTP: VAM is close to 310 × W/kg. */
export function climbMinutes(c: RealClimb, ftpWkg: number): number {
  const vam = 310 * ftpWkg * 0.95;
  return Math.round((c.gain / vam) * 60 + c.lengthKm * 0.6);
}

export function homeHtml(rider: HomeRider, logo: string): string {
  const wkg = rider.ftp / Math.max(30, rider.weightKg);
  const today = climbOfTheDay();
  const items = HOME_KEYS.map((m) => `<button class="hm-item" type="button" data-go="${m.go}">
      <kbd class="hm-key" aria-hidden="true">${m.key}</kbd>
      <span class="hm-text"><b>${m.title}</b><span>${m.line}</span></span>
    </button>`).join('');
  const quiet = QUIET.map((q) => `<button class="hm-quiet" type="button" data-go="${q.go}">${q.title}</button>`).join('');
  const climb = today
    ? `<aside class="hm-today" aria-label="Climb of the day">
        <h3>${esc(today.name)}</h3>
        <p class="hm-today-side">Today's climb. From ${esc(today.side)}, ${esc(today.country)}</p>
        <canvas class="hm-today-profile" data-climb-profile="${today.id}" aria-hidden="true"></canvas>
        <dl class="hm-today-facts">
          <div><dt>Length</dt><dd>${today.lengthKm.toFixed(1)} km</dd></div>
          <div><dt>Average</dt><dd>${today.avgGrade.toFixed(1)}%</dd></div>
          <div><dt>Gain</dt><dd>${Math.round(today.gain)} m</dd></div>
          <div><dt>You, about</dt><dd>${wkg > 0 ? `${climbMinutes(today, wkg)} min` : '–'}</dd></div>
        </dl>
        <p class="hm-today-line">${esc(today.famousFor)}</p>
        <button class="btn primary" type="button" data-ride-climb="${today.id}">Ride it now</button>
      </aside>`
    : '';
  return `<div class="hm">
    <div class="hm-col">
      <div class="hm-brand">${logo}</div>
      <p class="hm-rider"><b>${esc(rider.name || 'Rider')}</b> · ${rider.ftp} W · ${wkg.toFixed(2)} W/kg · ${esc(rider.trainer)}</p>
      <nav class="hm-menu" aria-label="Ride modes">${items}</nav>
      <nav class="hm-quiet-row" aria-label="More">${quiet}</nav>
      <p class="hm-build" title="Built ${__APP_BUILT__}">v${__APP_VERSION__} · ${__APP_COMMIT__}</p>
    </div>
    ${climb}
  </div>`;
}
