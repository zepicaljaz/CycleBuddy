import { REAL_STAGES } from '../routes/real/data';
import type { RealStage } from '../routes/real/types';
import { drawRoadbook, GRADE_LEGEND } from '../ui/roadbook';
import { cutStage, RACE_LENGTHS, RACE_LEVELS, type RaceLength, type RaceLevel } from './quickRace';

export interface ProRaceChoice {
  stageId: string;
  length: RaceLength;
  level: RaceLevel;
}

const STORE = 'cb-pro-race';

export function loadChoice(): ProRaceChoice {
  const fallback: ProRaceChoice = { stageId: REAL_STAGES[0]?.id ?? '', length: 0.25, level: 'normal' };
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) ?? 'null') as ProRaceChoice | null;
    if (saved && REAL_STAGES.some((s) => s.id === saved.stageId)) return { ...fallback, ...saved };
  } catch {
    /* Ignore a broken or blocked store. */
  }
  return fallback;
}

export function saveChoice(choice: ProRaceChoice): void {
  try {
    localStorage.setItem(STORE, JSON.stringify(choice));
  } catch {
    /* Not remembered; the race still starts. */
  }
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}

function hm(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`;
}

/**
 * Ride time for a stretch of road at the rider's FTP, 100 m at a time: on the flat
 * about 29 km/h at 3 W/kg in a bunch, and uphill whichever is slower of that and the
 * climbing rate (VAM close to 310 × W/kg at 95% of FTP). Descents are faster.
 */
export function estimateSeconds(route: { elevationAt(s: number): number }, from: number, to: number, ftpWkg: number): number {
  const flat = 8 + (ftpWkg - 3) * 0.9;
  const vam = 310 * ftpWkg * 0.95;
  let t = 0;
  for (let s = from; s < to; s += 100) {
    const d = Math.min(100, to - s);
    const rise = route.elevationAt(s + d) - route.elevationAt(s);
    if (rise < -2) t += d / (flat * 1.45);
    else t += Math.max(d / flat, (Math.max(0, rise) / vam) * 3600);
  }
  return t;
}

function finishLabel(stage: RealStage): string {
  if (stage.finish === 'summit') return 'Summit finish';
  if (stage.finish === 'hill') return 'Uphill finish';
  if (stage.finish === 'descent') return 'Finish after the descent';
  return 'Flat finish';
}

/** The race setup page: pick a stage, how much of it, and how hard the bunch rides. */
export function proRaceHtml(choice: ProRaceChoice, ftpWkg: number): string {
  const stage = REAL_STAGES.find((s) => s.id === choice.stageId) ?? REAL_STAGES[0];
  if (!stage) return '<div class="panel-body"><p>No stages yet.</p></div>';
  const cut = cutStage(stage, choice.length);
  const raced = cut.finishS - cut.startS;
  let gain = 0;
  for (let s = cut.startS; s < cut.finishS; s += 50) {
    const d = cut.route.elevationAt(Math.min(cut.finishS, s + 50)) - cut.route.elevationAt(s);
    if (d > 0) gain += d;
  }
  const est = estimateSeconds(cut.route, cut.startS, cut.finishS, ftpWkg);
  const level = RACE_LEVELS.find((l) => l.id === choice.level) ?? RACE_LEVELS[1];
  const stageList = REAL_STAGES.map((s) => {
    const on = s.id === stage.id;
    return `<button type="button" class="pr-stage${on ? ' on' : ''}" data-pr-stage="${s.id}" aria-pressed="${on}">
      <span class="pr-stage-name">${esc(s.name)}</span>
      <span class="pr-stage-meta">${s.totalKm} km · ${esc(finishLabel(s))}</span>
    </button>`;
  }).join('');
  const lengths = RACE_LENGTHS.map((l) => `<button type="button" class="pr-seg${l.id === choice.length ? ' on' : ''}" data-pr-length="${l.id}">
      <b>${l.label}</b><span>${l.blurb}</span></button>`).join('');
  const levels = RACE_LEVELS.map((l) => `<button type="button" class="pr-seg${l.id === choice.level ? ' on' : ''}" data-pr-level="${l.id}">
      <b>${l.label}</b></button>`).join('');
  const climbs = cut.climbs.map((c) => `<li><span class="cat cat-${(c.category ?? '').toLowerCase()}">${esc(c.category ?? '')}</span>
      <span class="pr-climb-name">${esc(c.name)}</span>
      <span class="pr-climb-num">${(c.length / 1000).toFixed(1)} km · ${(c.avgGrade * 100).toFixed(1)}%</span></li>`).join('');
  const legend = GRADE_LEGEND.map((g) => `<span><i style="background:${g.colour}"></i>${g.label}</span>`).join('');
  return `<div class="pro-race">
    <div class="panel-head"><h2>Pro race</h2><p class="muted">Famous stages built from the real climbs. Ride the whole day, or only the finale.</p></div>
    <div class="panel-body"><div class="pr-grid">
      <nav class="pr-stages" aria-label="Stages">${stageList}</nav>
      <section class="pr-main">
        <header class="pr-title">
          <h3>${esc(stage.name)}</h3>
          <p class="muted">${esc(stage.inspiredBy)}</p>
        </header>
        <div class="pr-profile"><canvas id="pr-roadbook" aria-label="Stage profile"></canvas></div>
        <div class="pr-legend">${legend}<span><i class="sprint-dot"></i>Sprint</span></div>
        <p class="pr-desc">${esc(stage.description)}</p>
        <div class="pr-facts">
          <div><span>You ride</span><b>${(raced / 1000).toFixed(1)} km</b></div>
          <div><span>Climbing</span><b>${Math.round(gain)} m</b></div>
          <div><span>Your time, about</span><b>${hm(est)}</b></div>
          <div><span>Field</span><b>${choice.length === 0.25 ? 64 : choice.length === 0.5 ? 80 : 96} riders</b></div>
        </div>
        ${climbs ? `<ul class="pr-climbs">${climbs}</ul>` : ''}
        <div class="pr-pick">
          <div class="pr-pick-row"><span class="pr-label">Length</span><div class="pr-segs">${lengths}</div></div>
          <div class="pr-pick-row"><span class="pr-label">Difficulty</span><div class="pr-segs">${levels}</div></div>
          <p class="muted pr-level-blurb">${esc(level.blurb)}</p>
        </div>
        <button class="btn primary big pr-start" type="button" id="pr-start">Start race</button>
      </section>
    </div></div>
  </div>`;
}

export function bindProRace(panel: HTMLElement, choice: ProRaceChoice, rerender: () => void, start: () => void): void {
  const stage = REAL_STAGES.find((s) => s.id === choice.stageId) ?? REAL_STAGES[0];
  const canvas = panel.querySelector<HTMLCanvasElement>('#pr-roadbook');
  if (stage && canvas) {
    const cut = cutStage(stage, choice.length);
    requestAnimationFrame(() =>
      drawRoadbook(canvas, cut.route, {
        from: 0,
        to: cut.finishS,
        raceStart: choice.length < 1 ? cut.startS : undefined,
        climbs: cutStage(stage, 1).climbs.map((c) => ({ name: c.name, s: c.end, category: c.category })),
        sprints: cutStage(stage, 1).sprints,
      }),
    );
  }
  panel.querySelectorAll<HTMLElement>('[data-pr-stage]').forEach((b) =>
    b.addEventListener('click', () => {
      choice.stageId = b.dataset.prStage!;
      saveChoice(choice);
      rerender();
    }),
  );
  panel.querySelectorAll<HTMLElement>('[data-pr-length]').forEach((b) =>
    b.addEventListener('click', () => {
      choice.length = Number(b.dataset.prLength) as RaceLength;
      saveChoice(choice);
      rerender();
    }),
  );
  panel.querySelectorAll<HTMLElement>('[data-pr-level]').forEach((b) =>
    b.addEventListener('click', () => {
      choice.level = b.dataset.prLevel as RaceLevel;
      saveChoice(choice);
      rerender();
    }),
  );
  panel.querySelector('#pr-start')?.addEventListener('click', start);
}
