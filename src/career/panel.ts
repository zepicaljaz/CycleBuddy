import { canEnter, formatDate, MONTHS, monthsFor, raceDays, RACES, stageWindow, terrainBadge, terrainBand, terrainLabel, type RaceDef } from './calendar';
import { RIDERS, riderById, riderName, riderTrait, ridersOf, teamBest, teamLeader, teamStars, type Rider } from './roster';
import { careerTotals, contractProgress, racePayout, rankTop, seasonProgress, standingIn, type ContractProgress, type RankRow, type SeasonProgress, type SeasonRaceStatus, type SeasonUpdate } from './progress';
import { teammatesFor, teamRanking, type Career } from './season';
import { aiField, eligibleMates, favoursPunch, rate, startMateCount } from './squad';
import { DIVISION_BLURB, DIVISION_LABEL, FOCUS_LABEL, ROSTER_SIZE, teamById, teamCode, teamsIn } from './teams';
import type { CareerState, ClassRow } from './types';

const NATIONS = ['SLO', 'DEN', 'BEL', 'FRA', 'ESP', 'ITA', 'GBR', 'NED', 'NOR', 'AUS', 'USA', 'GER', 'SUI', 'COL'];

function esc(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c));
}

const NATION_NAME: Record<string, string> = {
  SLO: 'Slovenia', DEN: 'Denmark', BEL: 'Belgium', FRA: 'France', ESP: 'Spain', ITA: 'Italy',
  GBR: 'Britain', NED: 'Netherlands', NOR: 'Norway', AUS: 'Australia', USA: 'United States',
  GER: 'Germany', SUI: 'Switzerland', COL: 'Colombia', AUT: 'Austria', POR: 'Portugal',
  MEX: 'Mexico', ECU: 'Ecuador', IRL: 'Ireland', CZE: 'Czechia', ISR: 'Israel',
};

/** Front of the kit the riders wear: helmet, jersey, chest band, sleeves, shorts. */
function jerseyFigure(jersey: string, accent: string, shorts: string, helmet: string): string {
  return `<svg class="kit-figure" viewBox="0 0 72 96" aria-hidden="true">
    <ellipse cx="36" cy="16" rx="12" ry="11" fill="${helmet}"/>
    <path d="M24 24h24l-2 7H26z" fill="${accent}"/>
    <path d="M18 30c0-4 6-6 10-6h16c4 0 10 2 10 6l6 14-8 3-2 29H20l-2-29-8-3z" fill="${jersey}"/>
    <path d="M20 40h32l-1.5 9H21.5z" fill="${accent}"/>
    <path d="M18 32 8 46l7 4 8-12z" fill="${jersey}"/>
    <path d="M54 32l10 14-7 4-8-12z" fill="${jersey}"/>
    <path d="M9 44l6 3-1.5 4-6-3z" fill="${accent}"/>
    <path d="M63 44l-6 3 1.5 4 6-3z" fill="${accent}"/>
    <path d="M20 70h32l3 22H40l-4-12-4 12H17z" fill="${shorts}"/>
    <path d="M35 34v22" stroke="${accent}" stroke-width="1.4" opacity="0.85"/>
  </svg>`;
}

function stars(count: number): string {
  const on = '★'.repeat(count);
  const off = '☆'.repeat(5 - count);
  return `<span class="stars" aria-label="${count} out of 5 stars"><span class="on">${on}</span><span class="off">${off}</span></span>`;
}

function teamRow(teamId: string, selected: boolean, action = 'draft-team'): string {
  const team = teamById(teamId);
  if (!team) return '';
  const leader = teamLeader(team.id);
  const rating = teamStars(team.id);
  const squad = ridersOf(team.id);
  const countries = new Set(squad.map((rider) => rider.country)).size;
  const focusLine = team.focus === 'sprint'
    ? 'The squad is built to win flat finishes.'
    : team.focus === 'classics'
      ? 'The squad is built for short, steep hills.'
      : 'The squad is built for stage races and the mountains.';
  return `<button type="button" class="team-row ${selected ? 'selected' : ''}" data-career="${action}" data-team="${team.id}">
    ${jerseyFigure(team.kit.jersey, team.kit.accent, team.kit.shorts, team.kit.helmet)}
    <span class="team-row-body">
      <span class="team-row-top"><b>${esc(team.name)}</b>${stars(rating)}</span>
      <span class="team-row-meta">${esc(DIVISION_LABEL[team.division])} · ${esc(FOCUS_LABEL[team.focus])} · ${esc(NATION_NAME[team.nation] ?? team.nation)} · ${ROSTER_SIZE[team.division]} riders · ${countries} countries</span>
      <span>${leader ? `Leader ${esc(riderName(leader))}, ${esc(riderTrait(leader))}. ` : ''}${esc(focusLine)}</span>
      <span class="team-row-stats">Mountains ${attrNum(teamBest(team.id, 'mountain'))} · Hills ${attrNum(teamBest(team.id, 'hills'))} · Sprint ${attrNum(teamBest(team.id, 'sprint'))} · Time trial ${attrNum(teamBest(team.id, 'tt'))}</span>
      <span class="muted">${esc(team.sponsors)}</span>
    </span>
  </button>`;
}

export function careerHtml(career: Career, playerName = 'You'): string {
  if (!career.state || career.tab === 'pick') return pickHtml(career);
  if (career.tab === 'offers' && career.state.offers) return offersHtml(career);
  if (career.tab === 'hub') return hubHtml(career);
  const opened = career.tab === 'riders' ? teamById(career.browseTeam ?? '') : undefined;
  const titles: Record<string, string> = {
    calendar: 'Calendar',
    rankings: 'Standings',
    record: 'Record',
    team: 'Team',
    riders: opened?.name ?? 'All teams',
    field: 'All riders',
    brief: 'Next race',
  };
  const body = career.tab === 'calendar' ? calendarHtml(career)
    : career.tab === 'rankings' ? rankingsHtml(career, playerName)
      : career.tab === 'record' ? recordHtml(career)
        : career.tab === 'team' ? teamHtml(career)
          : career.tab === 'riders' ? (opened ? teamRosterHtml(career) : teamsListHtml())
            : career.tab === 'field' ? fieldHtml(career)
              : briefHtml(career);
  return `<div class="career">
    <div class="panel-head"><h2>${titles[career.tab] ?? 'Career'}</h2></div>
    <div class="panel-body">${body}</div>
  </div>`;
}

function pickHtml(career: Career): string {
  const cards = teamsIn('continental')
    .slice()
    .sort((a, b) => teamStars(b.id) - teamStars(a.id) || a.name.localeCompare(b.name))
    .map((team) => teamRow(team.id, career.draftTeam === team.id))
    .join('');
  const nations = NATIONS.map((code) => `<option value="${code}" ${code === career.draftNation ? 'selected' : ''}>${code}</option>`).join('');
  return `<div class="career">
    <div class="panel-head"><h2>Career</h2><p class="muted">You are the leader. You have no rating. The trainer is your engine, and the riders around you work for you.</p></div>
    <div class="panel-body">
      <p>${esc(DIVISION_BLURB)}</p>
      <p>You start in Continental. World Tour races are for World teams and four Pro wildcards. A good season of points brings offers from higher teams.</p>
      <label class="field">Your championship nation <select data-career="nation">${nations}</select></label>
      <p class="muted">Stars are the riders already on the team. On this list, three is the strongest Continental squad. World Tour teams, later, are four or five.</p>
      <div class="team-list">${cards}</div>
      <div class="effort-grid">
        ${slider('draft-flat', 'Flat bunch', career.draftFlat)}
        ${slider('draft-hill', 'Hills', career.draftHill)}
        ${slider('draft-mountain', 'Mountains', career.draftMountain)}
      </div>
      <p class="muted">These are the watts per kilo the bunch rides. Climbers can go a little over that on the last ascent. Sprinters go much harder in the final few hundred metres.</p>
      <button class="btn primary" type="button" data-career="create">Start with this team</button>
    </div>
  </div>`;
}

/** One line: label, slider, value. Used on the race brief, where three sit stacked. */
function paceRow(id: string, label: string, value: number, max = 6.2): string {
  return `<label class="pace-row"><span>${label}</span>
    <input data-career="${id}" type="range" min="1" max="${max}" step="0.1" value="${value}" />
    <b data-for="${id}">${value.toFixed(1)}</b><small>W/kg</small>
  </label>`;
}

function slider(id: string, label: string, value: number, max = 6.2): string {
  return `<label class="field">${label} <b data-for="${id}">${value.toFixed(1)}</b> W/kg
    <input data-career="${id}" type="range" min="1" max="${max}" step="0.1" value="${value}" />
  </label>`;
}

/**
 * The season page: the next race first and biggest, then how close the next contract is,
 * then the season month by month, then the other pages as plain links.
 */
function hubHtml(career: Career): string {
  const state = career.state!;
  const team = teamById(state.teamId);
  const division = team?.division ?? 'continental';
  const season = seasonProgress(state);
  const current = season.current ? ` · ${MONTHS[season.current]}` : '';
  const kit = team ? jerseyFigure(team.kit.jersey, team.kit.accent, team.kit.shorts, team.kit.helmet) : '';
  const simulate = !state.active && career.nextOpen() && !career.nextEntered()
    ? '<button type="button" data-career="advance">Simulate the rest</button>'
    : '';
  return `<div class="career-home season">
    <header class="season-head">
      ${kit}
      <div>
        <h2>${esc(team?.name ?? 'Career')}</h2>
        <p>${esc(DIVISION_LABEL[division])} · ${state.year}${current}</p>
      </div>
    </header>
    ${hubNext(career)}
    ${hubContract(state)}
    ${hubSeason(season)}
    <nav class="season-links" aria-label="Career pages">
      <button type="button" data-career="tab" data-tab="calendar">Calendar</button>
      <button type="button" data-career="tab" data-tab="rankings">Standings</button>
      <button type="button" data-career="tab" data-tab="record">Record</button>
      <button type="button" data-career="tab" data-tab="team">My team</button>
      <button type="button" data-career="tab" data-tab="riders">All teams</button>
      <button type="button" data-career="tab" data-tab="field">All riders</button>
      ${simulate}
      <button type="button" class="quiet" data-career="download">Download save</button>
    </nav>
  </div>`;
}

function hubNext(career: Career): string {
  const state = career.state!;
  const race = state.active ? RACES.find((item) => item.id === state.active?.raceId) : career.nextEntered();
  if (!race) {
    const waiting = !!career.nextOpen();
    return `<section class="season-next empty">
      <p class="season-label">${waiting ? 'No race ticked' : 'Season done'}</p>
      <h3>${waiting ? 'Pick your next race' : 'Every race on your list is done'}</h3>
      <p class="season-when">${waiting ? 'Tick a race on the calendar to ride it. Races you leave unticked are ridden without you.' : 'The offers for next season come when the last race of the year is over.'}</p>
      <div class="season-go">${waiting ? '<button class="btn primary big" type="button" data-career="tab" data-tab="calendar">Open the calendar</button>' : ''}</div>
    </section>`;
  }
  const stageIndex = state.active?.stageIndex ?? 0;
  const stage = race.stages[stageIndex];
  const window = stage ? stageWindow(stage) : null;
  const band = window ? terrainBand(window.ascent, window.km) : null;
  const when = raceDays(race, state.year)[stageIndex] ?? { month: race.month, day: race.day };
  const length = race.stages.length > 1 ? `Stage ${stageIndex + 1} of ${race.stages.length}` : 'One day';
  const facts = [
    formatDate(when.month, when.day),
    length,
    window ? `${window.km.toFixed(1)} km` : '',
    window ? `${Math.round(window.ascent)} m up` : '',
    window && band ? terrainLabel(window.kind, band) : '',
  ].filter(Boolean).join(' · ');
  const plainStage = stage ? stage.name.replace(/^Stage \d+\s*·\s*/, '') : '';
  const stageName = race.stages.length > 1 && plainStage && plainStage !== race.name ? `<p class="season-stage">${esc(plainStage)}</p>` : '';
  const stake = stakeLine(race);
  const gc = state.active && stageIndex > 0 ? overallLine(state.active.gc) : '';
  return `<section class="season-next">
    <p class="season-label">${state.active ? 'Race in progress' : 'Next race'}</p>
    <h3>${esc(race.name)}</h3>
    ${stageName}
    <p class="season-when">${esc(facts)}</p>
    ${stage ? `<canvas class="route-profile stage-profile" data-stage="${race.id}:${stageIndex}"></canvas>` : ''}
    <div class="season-go">
      <p class="season-stake">${gc ? `${gc}<br/>` : ''}${stake} contract points</p>
      <button class="btn primary big" type="button" data-career="brief">${state.active ? 'Continue the race' : 'Race brief'}</button>
    </div>
  </section>`;
}

/** "Win +27 · 10th +4": the contract points a race pays. Stage races pay the overall and each stage. */
function stakeLine(race: RaceDef): string {
  const pay = racePayout(race);
  return [
    `${pay.stageWin ? 'Overall win' : 'Win'} <b>+${pay.win}</b>`,
    pay.stageWin ? `stage win <b>+${pay.stageWin}</b>` : '',
    pay.tenth ? `10th <b>+${pay.tenth}</b>` : '',
  ].filter(Boolean).join(' · ');
}

/** "N to a Pro offer", or what is left when every mark is passed. */
function goalLine(next: ContractProgress['next'], division: string): string {
  if (next) return `<b>${next.left}</b> to ${esc(next.goal)}`;
  return division === 'world' ? 'Enough for extra World Tour offers' : 'Enough for a World Tour offer';
}

/**
 * The season line on the race results: points this stage added, the ranking move, and the
 * contract meter moving from where it was to where it is now.
 */
export function seasonUpdateHtml(update: SeasonUpdate, division: string, nextLabel = ''): string {
  const ranking = update.book === 'cyb' ? 'CYB ranking' : 'Continental ranking';
  const rank = update.rankAfter == null
    ? `Not ranked yet in the ${ranking}`
    : update.rankBefore == null
      ? `${placeWord(update.rankAfter)} in the ${ranking}`
      : update.rankBefore === update.rankAfter
        ? `Still ${placeWord(update.rankAfter)} in the ${ranking}`
        : `${ranking} <b>${update.rankBefore}</b> → <b>${update.rankAfter}</b>`;
  const pct = (share: number) => `${(share * 100).toFixed(1)}%`;
  return `<section class="season-update" aria-label="Season update">
    <p class="season-update-gain"><b>+${update.gained}</b> contract points</p>
    <div class="season-update-body">
      <p>${rank} · <b>${update.points}</b> points · ${goalLine(update.next, division)}</p>
      <div class="meter small" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(update.to * 100)}" aria-label="Contract points">
        <span class="meter-fill was" style="width:${pct(update.from)}"></span>
        <span class="meter-fill gain" style="left:${pct(update.from)};width:${pct(Math.max(0, update.to - update.from))}"></span>
      </div>
      ${nextLabel ? `<p class="muted">${esc(nextLabel)}</p>` : ''}
    </div>
  </section>`;
}

/** "4th overall, 0:42 behind" after the first stage of a stage race. */
function overallLine(gc: ClassRow[]): string {
  const index = gc.findIndex((row) => row.riderId === 'player');
  if (index < 0) return '';
  if (index === 0) return 'You lead the race overall';
  const gap = gc[index].value - gc[0].value;
  return `You are ${placeWord(index + 1)} overall, ${clock(gap)} behind`;
}

function hubContract(state: CareerState): string {
  const progress = contractProgress(state);
  const pct = (value: number) => `${Math.min(100, (value / progress.scale) * 100).toFixed(1)}%`;
  const marks = progress.steps.map((step) => `<span class="meter-mark${progress.points >= step.at ? ' passed' : ''}" style="left:${pct(step.at)}"><b>${step.at}</b><small>${esc(step.label)}</small></span>`).join('');
  const goal = goalLine(progress.next, progress.division);
  const note = progress.division === 'world'
    ? 'World Tour races and the championships count in full.'
    : 'World Tour races and the championships count in full. Pro and Continental races count at 75 %. Offers come at the end of the season.';
  return `<section class="season-contract" aria-label="Contract">
    <p class="season-label">Contract</p>
    <div class="contract-top">
      <p class="contract-points"><b>${progress.points}</b> points</p>
      <p class="contract-goal">${goal}</p>
    </div>
    <div class="meter" role="meter" aria-valuemin="0" aria-valuemax="${progress.scale}" aria-valuenow="${progress.points}" aria-label="Contract points">
      <span class="meter-fill" style="width:${pct(progress.points)}"></span>
      ${marks}
    </div>
    <p class="muted contract-note">${note}</p>
  </section>`;
}

const STATUS_WORD: Record<SeasonRaceStatus, string> = {
  ridden: 'ridden', skipped: 'skipped', now: 'in progress', next: 'next', planned: 'ticked',
};

function hubSeason(season: SeasonProgress): string {
  if (!season.months.length) {
    return `<section class="season-strip"><p class="season-label">Season</p><p class="muted">No races ticked. Open the calendar to pick your season.</p></section>`;
  }
  const months = season.months.map((month) => {
    const dots = month.races.map((race) => {
      const label = `${race.name}, ${formatDate(race.month, race.day)}: ${race.place ? `you were ${placeWord(race.place)}` : STATUS_WORD[race.status]}`;
      const top = race.place != null && race.place <= 10 ? ' top' : '';
      const mark = race.place != null && race.place <= 3 ? `<i>${race.place}</i>` : '';
      return `<span class="season-dot ${race.status}${top}" title="${esc(label)}"><span class="sr">${esc(label)}</span>${mark}</span>`;
    }).join('');
    return `<li class="${month.month === season.current ? 'current' : ''}"><b>${esc(month.name.slice(0, 3))}</b><span class="season-dots">${dots}</span></li>`;
  }).join('');
  const best = season.best ? ` · best <b>${placeWord(season.best.place)}</b>, ${esc(season.best.race)}` : '';
  const tally = season.ridden ? ` · ${season.wins} ${season.wins === 1 ? 'win' : 'wins'} · ${season.topTen} top 10` : '';
  return `<section class="season-strip">
    <p class="season-label">Season</p>
    <ol class="season-months">${months}</ol>
    <p class="season-tally"><b>${season.ridden}</b> of <b>${season.total}</b> raced${best}${tally}</p>
    <p class="season-key muted"><span class="season-dot ridden"></span> ridden <span class="season-dot ridden top"></span> top 10 <span class="season-dot next"></span> next <span class="season-dot planned"></span> ticked <span class="season-dot skipped"></span> skipped</p>
  </section>`;
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function raceTone(race: RaceDef): string {
  if (race.id === 'france-tour') return 'tone-france';
  if (race.id === 'italy-tour') return 'tone-italy';
  if (race.id === 'spanish-tour') return 'tone-spain';
  if (race.level === 'world' || race.level === 'champ') return 'tone-world';
  if (race.level === 'pro') return 'tone-pro';
  return 'tone-cont';
}

type ChipStatus = 'locked' | 'on' | 'off' | 'next' | 'now' | 'ridden' | 'skipped' | 'past';

/** Where a race stands for you: outside your division, ticked, not ticked, next, ridden, skipped, or gone by. */
function chipStatus(race: RaceDef, career: Career): { status: ChipStatus; place: number | null } {
  const state = career.state!;
  const division = teamById(state.teamId)?.division ?? 'continental';
  if (state.active?.raceId === race.id) return { status: 'now', place: null };
  if (!canEnter(race.level, division)) return { status: 'locked', place: null };
  if (state.skipped.includes(race.id)) return { status: 'skipped', place: null };
  if (state.done.includes(race.id)) {
    const saved = state.races.find((item) => item.raceId === race.id && item.year === state.year);
    const rode = saved?.playerPlace != null || (state.stageNotes ?? []).some((note) => note.raceId === race.id && note.year === state.year);
    return rode ? { status: 'ridden', place: saved?.playerPlace ?? null } : { status: 'past', place: null };
  }
  if (!state.active && career.nextEntered()?.id === race.id) return { status: 'next', place: null };
  return { status: state.entered.includes(race.id) ? 'on' : 'off', place: null };
}

const MINE: ChipStatus[] = ['on', 'next', 'now', 'ridden', 'skipped'];

/** Class of a race on the month grid. Exported so a tick on the calendar can restyle the grid in place. */
export function calendarChipClass(raceId: string, career: Career): string {
  const race = RACES.find((item) => item.id === raceId);
  if (!race || !career.state) return '';
  return `race-chip ${raceTone(race)} ${chipStatus(race, career).status}`;
}

function monthBoard(career: Career, month: number, races: RaceDef[]): string {
  const year = career.state!.year;
  const first = new Date(year, month - 1, 1);
  const lead = (first.getDay() + 6) % 7;
  const count = new Date(year, month, 0).getDate();
  const onDay = (day: number) => races.filter((race) => raceDays(race, year).some((slot) => slot.month === month && slot.day === day));
  const blanks = Array.from({ length: lead }, () => '<div class="day-cell empty"></div>').join('');
  const cells = Array.from({ length: count }, (_, index) => {
    const day = index + 1;
    const here = onDay(day);
    const names = here.map((race) => {
      const { status, place } = chipStatus(race, career);
      const mark = place ? ` <b>${placeWord(place)}</b>` : '';
      return `<span class="race-chip ${raceTone(race)} ${status}" data-race="${race.id}">${esc(race.name)}${mark}</span>`;
    }).join('');
    const finished = here.some((race) => career.state!.done.includes(race.id));
    return `<div class="day-cell${here.length ? ' has' : ''}${finished ? ' done' : ''}"><b>${day}</b>${names}</div>`;
  }).join('');
  return `<div class="month-grid">${WEEKDAYS.map((name) => `<div class="dow">${name}</div>`).join('')}${blanks}${cells}</div>`;
}

/** What the colours and the outlines on the month grid mean, drawn with the same chips. */
function calendarLegend(): string {
  const chip = (tone: string, status: string, text: string) => `<span class="race-chip ${tone} ${status}">${text}</span>`;
  return `<div class="cal-legend" aria-label="Calendar key">
    <div><span class="cal-legend-title">Level</span>
      ${chip('tone-france', 'on', 'Grand tour')}${chip('tone-world', 'on', 'World Tour')}${chip('tone-pro', 'on', 'Pro')}${chip('tone-cont', 'on', 'Continental')}${chip('tone-world', 'locked', 'Not your division')}
    </div>
    <div><span class="cal-legend-title">You</span>
      ${chip('tone-cont', 'next', 'Next race')}${chip('tone-cont', 'on', 'Riding')}${chip('tone-cont', 'off', 'Not ticked')}${chip('tone-cont', 'ridden', 'Ridden <b>4th</b>')}${chip('tone-cont', 'skipped', 'Skipped')}
    </div>
  </div>`;
}

function stageNote(kind: string, finish: string, climbs: { name: string }[], summitFinish: boolean): string {
  const last = climbs.at(-1)?.name;
  const names = climbs.map((climb) => climb.name).join(', ');
  if (kind === 'tt' && finish === 'mountain') return 'You ride alone, against the clock, on a climb. The time comes from the time trial and the mountains.';
  if (kind === 'tt') return 'You ride alone, against the clock. Drafting does not count.';
  if (climbs.length && !summitFinish && finish !== 'sprint') return `You cross ${names}. The finish is in the valley after ${last}.`;
  if (finish === 'sprint') return climbs.length ? `The road stays with the bunch. ${names} ${climbs.length > 1 ? 'are' : 'is'} on the way, and it ends in a sprint.` : 'A flat road. The bunch stays together until the sprint.';
  if (finish === 'hill') return last ? `The finish is on ${last}.` : 'It finishes uphill.';
  return last ? `The last climb is ${last}. That is where the time gaps open.` : 'A mountain finish.';
}

function calendarHtml(career: Career): string {
  const state = career.state!;
  const team = teamById(state.teamId)!;
  const months = monthsFor(team.division, state.year);
  // Open on the month the season is in: the race you are riding, the next one, or the last one you rode.
  const current = seasonProgress(state).current;
  const busy = months.find((item) => RACES.some((race) => raceDays(race, state.year).some((slot) => slot.month === item)));
  const start = current && months.includes(current) ? current : busy;
  const month = months.includes(career.calendarMonth ?? -1) ? career.calendarMonth! : (start ?? months[0]);
  if (!month) return '<p class="muted">No races on this calendar.</p>';
  career.calendarMonth = month;
  const index = months.indexOf(month);
  const inMonth = RACES.filter((race) => raceDays(race, state.year).some((slot) => slot.month === month));
  const races = career.calendarMine ? inMonth.filter((race) => MINE.includes(chipStatus(race, career).status)) : inMonth;
  const details = races.map((race) => raceDetail(race, career, month)).join('');
  const prev = index > 0
    ? `<button class="btn ghost" type="button" data-career="month" data-dir="-1">← ${MONTHS[months[index - 1]]}</button>`
    : '<span class="month-slot"></span>';
  const next = index < months.length - 1
    ? `<button class="btn ghost" type="button" data-career="month" data-dir="1">${MONTHS[months[index + 1]]} →</button>`
    : '<span class="month-slot"></span>';
  const empty = career.calendarMine ? 'None of your races are this month.' : 'Nothing is scheduled this month.';
  return `<div class="month-nav">${prev}<h3>${MONTHS[month]} ${state.year}</h3>${next}</div>
    <div class="cal-intro">
      <p>Tick the races you want to ride. You can start one race a day. A race you leave unticked is ridden without you, and you score nothing in it.</p>
      <label class="check cal-mine"><input type="checkbox" data-career="cal-mine" ${career.calendarMine ? 'checked' : ''}/> My races only</label>
    </div>
    ${calendarLegend()}
    <section class="month-block">
      ${monthBoard(career, month, races)}
      ${races.length ? '' : `<p class="muted">${empty}</p>`}
      <div class="race-folds">${details}</div>
    </section>`;
}

function raceSpan(race: RaceDef, year: number): string {
  const days = raceDays(race, year);
  const first = days[0];
  const last = days.at(-1);
  if (!first || !last) return '';
  if (first.month === last.month && first.day === last.day) return formatDate(first.month, first.day);
  if (first.month === last.month) return `${MONTHS[first.month]} ${first.day}–${last.day}`;
  return `${formatDate(first.month, first.day)} – ${formatDate(last.month, last.day)}`;
}

function raceDetail(race: RaceDef, career: Career, month: number): string {
  const state = career.state!;
  const team = teamById(state.teamId)!;
  const eligible = canEnter(race.level, team.division);
  const done = state.done.includes(race.id);
  const on = state.entered.includes(race.id);
  const saved = [...state.races, ...state.history].find((item) => item.raceId === race.id && item.year === state.year);
  const level = race.champ ? 'Championship' : DIVISION_LABEL[race.level === 'world' ? 'world' : race.level === 'pro' ? 'pro' : 'continental'];
  const days = raceDays(race, state.year);
  const when = raceSpan(race, state.year);
  const continued = race.month !== month ? ` · continues from ${MONTHS[race.month]}` : '';
  const { status, place } = chipStatus(race, career);
  let box = '';
  if (status === 'now') box = '<span class="race-result">Riding now</span>';
  else if (done) {
    const winner = saved ? `Won by ${esc(saved.winnerName)}` : 'Done';
    box = status === 'skipped'
      ? '<span class="muted">You sat this out</span>'
      : place
        ? `<span class="race-result"><b>${placeWord(place)}</b> <small>${winner}</small></span>`
        : `<span class="muted">${winner}</span>`;
  } else if (!eligible) box = '<span class="muted">Not your division</span>';
  else box = `<label class="check"><input type="checkbox" data-career="enter" data-race="${race.id}" ${on ? 'checked' : ''}/> Ride</label>`;
  const pays = eligible && !done ? ` · win +${racePayout(race).win}` : '';
  const windows = race.stages.map((stage) => stageWindow(stage));
  const km = windows.reduce((sum, window) => sum + window.km, 0);
  const ascent = windows.reduce((sum, window) => sum + window.ascent, 0);
  const count = race.stages.length === 1 ? 'One day' : `${race.stages.length} stages`;
  const stages = race.stages.map((stage, index) => {
    const window = windows[index];
    const climbs = window.climbs.map((climb) => `${climb.name} ${climb.km.toFixed(1)} km at ${climb.grade.toFixed(1)}%`).join(' · ');
    const band = terrainBand(window.ascent, window.km);
    const slot = days[index];
    const date = slot ? formatDate(slot.month, slot.day) : '';
    return `<div class="stage-detail">
      <div>
        <span class="badge ${terrainBadge(window.kind, band)}">${esc(terrainLabel(window.kind, band))}</span>
        <b>${esc(stage.name)}</b>
        <p>${date}${date ? ' · ' : ''}${window.km.toFixed(1)} km · ${Math.round(window.ascent)} m of climbing${race.stages.length > 1 ? ` · day ${index + 1}` : ''}</p>
        <p class="loop-note">Loop · ${esc(window.routeName)}${window.reverse ? ' · the other way' : ''}</p>
        <p>${esc(stageNote(window.kind, window.finish, window.climbs, window.summitFinish))}</p>
        ${climbs ? `<p class="climb-note">${esc(climbs)}</p>` : ''}
      </div>
      <canvas class="route-profile stage-profile" data-stage="${race.id}:${index}"></canvas>
    </div>`;
  }).join('');
  return `<details class="race-detail ${eligible ? '' : 'locked'} ${status}">
    <summary>
      <span class="race-fold-main"><b>${esc(race.name)}</b><small>${esc(when)} · ${esc(level)} · ${count}${esc(continued)}${pays}</small></span>
      <span class="race-fold-side">${box}</span>
    </summary>
    <div class="race-body">
      <p class="muted">${count} · ${km.toFixed(1)} km · ${Math.round(ascent)} m</p>
      ${stages}
    </div>
  </details>`;
}

function rankingsHtml(career: Career, playerName: string): string {
  const tabs = `<div class="sheet-tabs">
    <button type="button" data-career="rank" data-sheet="rankings" class="${career.rankSheet === 'rankings' ? 'on' : ''}">Rankings</button>
    <button type="button" data-career="rank" data-sheet="results" class="${career.rankSheet === 'results' ? 'on' : ''}">Full results</button>
  </div>`;
  return `${tabs}${career.rankSheet === 'results' ? seasonResultsHtml(career) : rankingTables(career, playerName)}`;
}

type RankTable = 'cont' | 'cyb' | 'wins' | 'teams';

const RANK_LABEL: Record<RankTable, string> = { cont: 'Continental', cyb: 'CYB', wins: 'Wins', teams: 'Teams' };

/** "18th of 210 · 86 points · 12 behind 10th", or why you are not on it yet. */
function standingLine(map: Record<string, number> | undefined, unit: string): string {
  const mine = standingIn(map);
  if (mine.place == null) {
    const others = mine.of === 1 ? `1 rider has ${unit}` : `${mine.of} riders have ${unit}`;
    return `<span class="stand-value muted">Not ranked yet${mine.of ? ` · ${others}` : ''}</span>`;
  }
  const behind = mine.place === 1
    ? 'you lead'
    : mine.toTen != null
      ? `${mine.toTen} behind 10th`
      : `${mine.toNext} behind ${placeWord(mine.place - 1)}`;
  return `<span class="stand-value"><b>${placeWord(mine.place)}</b> of ${mine.of} · ${mine.points} ${mine.points === 1 ? unit.replace(/s$/, '') : unit} · ${behind}</span>`;
}

function rankingTables(career: Career, playerName: string): string {
  const state = career.state!;
  const team = teamById(state.teamId);
  const division = team?.division ?? 'continental';
  const table: RankTable = career.rankTable ?? (division === 'world' ? 'cyb' : 'cont');
  const own = division === 'world' ? 'cyb' : 'cont';
  const teamBook = own === 'cyb' ? 'CYB' : 'Continental';
  const summary = `<section class="stand-summary" aria-label="Where you stand">
    <p><span>Continental ranking</span>${standingLine(state.cont, 'points')}</p>
    <p><span>CYB ranking</span>${standingLine(state.cyb, 'points')}</p>
    <p><span>Wins</span>${standingLine(state.wins, 'wins')}</p>
  </section>`;
  const switcher = `<div class="sheet-tabs rank-switch" role="tablist" aria-label="Ranking">${(Object.keys(RANK_LABEL) as RankTable[]).map((key) => `<button type="button" role="tab" aria-selected="${key === table}" data-career="rank-table" data-table="${key}" class="${key === table ? 'on' : ''}">${key === 'teams' ? `${teamBook} teams` : RANK_LABEL[key]}</button>`).join('')}</div>`;
  const about: Record<RankTable, string> = {
    cont: 'Points from Pro and Continental races. Contract offers count them at 75 %.',
    cyb: 'Points from World Tour races and the championships. Contract offers count them in full.',
    wins: 'Race and stage wins this season, in every division.',
    teams: own === 'cyb' ? 'World Tour teams, on CYB points.' : 'Pro and Continental teams share one standing.',
  };
  const body = table === 'teams' ? teamTableHtml(state, own) : riderRankHtml(table === 'cyb' ? state.cyb : table === 'wins' ? state.wins : state.cont ?? {}, table === 'wins' ? '' : 'pts', playerName, team?.name ?? '');
  return `${summary}${switcher}<p class="muted rank-about">${about[table]}</p>${body}
    <p class="muted rank-about">Rankings start again each season.</p>`;
}

function riderRankHtml(map: Record<string, number>, unit: string, playerName: string, playerTeam: string): string {
  const { top, pinned } = rankTop(map, 20);
  if (!top.length) return '<p class="muted">No results yet.</p>';
  const line = (row: RankRow) => {
    const rider = row.id === 'player' ? undefined : riderById(row.id);
    const name = row.id === 'player' ? playerName || 'You' : rider ? riderName(rider) : row.id;
    const teamName = row.id === 'player' ? playerTeam : teamById(rider?.teamId ?? '')?.name ?? '';
    return `<tr class="${row.id === 'player' ? 'me' : ''}"><td class="pos">${row.place}</td><td>${esc(name)}</td><td class="muted">${esc(teamName)}</td><td class="num">${row.value}${unit ? ` <small>${unit}</small>` : ''}</td></tr>`;
  };
  const gap = pinned ? `<tr class="gap" aria-hidden="true"><td colspan="4">⋮</td></tr>${line(pinned)}` : '';
  return `<table class="standings rank-table"><thead><tr><th class="pos">#</th><th>Rider</th><th>Team</th><th class="num">${unit ? 'Points' : 'Wins'}</th></tr></thead><tbody>${top.map(line).join('')}${gap}</tbody></table>`;
}

function teamTableHtml(state: CareerState, book: 'cyb' | 'cont'): string {
  const divisions: Array<'world' | 'pro' | 'continental'> = book === 'cyb' ? ['world'] : ['pro', 'continental'];
  const rows = teamRanking(state.teamPoints, divisions, 20, state.teamId);
  if (!rows.length) return '<p class="muted">No results yet.</p>';
  const body = rows.map((row, index) => {
    const gap = index > 0 && row.place > rows[index - 1].place + 1 ? '<tr class="gap" aria-hidden="true"><td colspan="3">⋮</td></tr>' : '';
    const division = divisions.length > 1 ? ` <span class="muted">${esc(DIVISION_LABEL[row.division])}</span>` : '';
    return `${gap}<tr class="${row.id === state.teamId ? 'me' : ''}"><td class="pos">${row.place}</td><td>${esc(row.name)}${division}</td><td class="num">${row.value} <small>pts</small></td></tr>`;
  }).join('');
  return `<table class="standings rank-table"><thead><tr><th class="pos">#</th><th>Team</th><th class="num">Points</th></tr></thead><tbody>${body}</tbody></table>`;
}

const FLAG_CC: Record<string, string> = {
  SLO: 'SI', DEN: 'DK', BEL: 'BE', FRA: 'FR', ESP: 'ES', ITA: 'IT', GBR: 'GB', NED: 'NL',
  NOR: 'NO', AUS: 'AU', USA: 'US', GER: 'DE', SUI: 'CH', COL: 'CO', POR: 'PT', MEX: 'MX',
  AUT: 'AT', ECU: 'EC', IRL: 'IE', CZE: 'CZ', ISR: 'IL',
};

function flagEmoji(code: string): string {
  const cc = FLAG_CC[code] ?? code.slice(0, 2);
  if (!/^[A-Z]{2}$/.test(cc)) return '';
  return String.fromCodePoint(...[...cc].map((ch) => 0x1F1E6 + ch.charCodeAt(0) - 65));
}

function attrTone(value: number): string {
  if (value > 90) return 'attr-red';
  if (value >= 85) return 'attr-orange';
  if (value >= 80) return 'attr-yellow';
  if (value >= 75) return 'attr-green';
  return '';
}

function attrNum(value: number): string {
  const tone = attrTone(value);
  return `<b${tone ? ` class="${tone}"` : ''}>${value}</b>`;
}

function attrCell(value: number): string {
  const tone = attrTone(value);
  const shown = Number.isInteger(value) ? String(value) : value.toFixed(1);
  return `<td${tone ? ` class="${tone}"` : ''}>${shown}</td>`;
}

function raceAvg(rider: { attrs: { flat: number; hills: number; medium: number; mountain: number; tt: number; sprint: number } }): number {
  const a = rider.attrs;
  return (a.flat + a.hills + a.medium + a.mountain + a.tt + a.sprint) / 6;
}

function teamsListHtml(): string {
  const divisions = ['world', 'pro', 'continental'] as const;
  const blocks = divisions.map((division) => {
    const rows = teamsIn(division).map((team) => teamRow(team.id, false, 'browse')).join('');
    return `<section><h3>${esc(DIVISION_LABEL[division])}</h3><div class="team-list">${rows}</div></section>`;
  }).join('');
  return `<div><p class="muted">Every team in the season. The jersey is the one the riders wear. Open a team to see its riders.</p><p><button class="btn" type="button" data-career="tab" data-tab="field">All riders</button></p>${blocks}</div>`;
}

function compareRiders(a: Rider, b: Rider, key: string, dir: 1 | -1): number {
  const num = (left: number, right: number) => (left - right) * dir;
  if (key === 'country') return a.country.localeCompare(b.country) * dir;
  if (key === 'age') return num(a.age, b.age);
  if (key === 'program') return a.program.localeCompare(b.program) * dir;
  if (key === 'flat') return num(a.attrs.flat, b.attrs.flat);
  if (key === 'hills') return num(a.attrs.hills, b.attrs.hills);
  if (key === 'medium') return num(a.attrs.medium, b.attrs.medium);
  if (key === 'mountain') return num(a.attrs.mountain, b.attrs.mountain);
  if (key === 'tt') return num(a.attrs.tt, b.attrs.tt);
  if (key === 'sprint') return num(a.attrs.sprint, b.attrs.sprint);
  if (key === 'endurance') return num(a.attrs.endurance, b.attrs.endurance);
  if (key === 'stamina') return num(a.attrs.stamina, b.attrs.stamina);
  if (key === 'recovery') return num(a.attrs.recovery, b.attrs.recovery);
  if (key === 'avg') return num(raceAvg(a), raceAvg(b));
  if (key === 'team') return (teamById(a.teamId)?.name ?? '').localeCompare(teamById(b.teamId)?.name ?? '') * dir;
  if (key === 'division') return (teamById(a.teamId)?.division ?? '').localeCompare(teamById(b.teamId)?.division ?? '') * dir;
  return riderName(a).localeCompare(riderName(b)) * dir;
}

function riderTable(riders: Rider[], sort: { key: string; dir: 1 | -1 }, withTeam: boolean): string {
  const mark = (key: string) => (sort.key === key ? (sort.dir < 0 ? ' ↓' : ' ↑') : '');
  const head = (key: string, label: string) => `<th><button type="button" data-career="sort" data-key="${key}">${label}${mark(key)}</button></th>`;
  const teamHeads = withTeam ? `${head('team', 'Team')}${head('division', 'Division')}` : '';
  const rows = riders.map((rider) => {
    const team = teamById(rider.teamId);
    const blob = `${riderName(rider)} ${rider.country} ${rider.program} ${team?.name ?? ''} ${team?.division ?? ''}`.toLocaleLowerCase('en-US');
    const a = rider.attrs;
    const teamCells = withTeam ? `<td>${esc(team?.name ?? '')}</td><td>${esc(DIVISION_LABEL[team?.division ?? 'continental'])}</td>` : '';
    return `<tr data-rider="${esc(blob)}"><td>${esc(riderName(rider))}</td><td><span class="flag" aria-hidden="true">${flagEmoji(rider.country)}</span> ${rider.country}</td><td>${rider.age}</td>${teamCells}${attrCell(a.flat)}${attrCell(a.hills)}${attrCell(a.medium)}${attrCell(a.mountain)}${attrCell(a.tt)}${attrCell(a.sprint)}${attrCell(a.endurance)}${attrCell(a.stamina)}${attrCell(a.recovery)}${attrCell(raceAvg(rider))}</tr>`;
  }).join('');
  return `<table class="rider-table"><thead><tr>${head('name', 'Rider')}${head('country', 'Country')}${head('age', 'Age')}${teamHeads}${head('flat', 'Flat')}${head('hills', 'Hill')}${head('medium', 'Med')}${head('mountain', 'Mtn')}${head('tt', 'TT')}${head('sprint', 'Spr')}${head('endurance', 'End')}${head('stamina', 'Sta')}${head('recovery', 'Rec')}${head('avg', 'Average')}</tr></thead><tbody>${rows}</tbody></table>`;
}

function teamRosterHtml(career: Career): string {
  const team = teamById(career.browseTeam ?? '');
  if (!team) return teamsListHtml();
  const riders = ridersOf(team.id).slice().sort((a, b) => compareRiders(a, b, career.riderSort.key, career.riderSort.dir));
  return `<div>
    <p class="team-open">${jerseyFigure(team.kit.jersey, team.kit.accent, team.kit.shorts, team.kit.helmet)}<span><b>${esc(team.name)}</b> · ${esc(DIVISION_LABEL[team.division])} · ${esc(team.sponsors)}</span></p>
    <div class="rider-tools"><input data-career="rider-search" type="search" placeholder="Search this team" /></div>
    ${riderTable(riders, career.riderSort, false)}
  </div>`;
}

function fieldHtml(career: Career): string {
  const riders = RIDERS.slice().sort((a, b) => compareRiders(a, b, career.riderSort.key, career.riderSort.dir));
  return `<div>
    <p class="muted">Every rider in the season. Click a column to put the best at the top.</p>
    <div class="rider-tools"><input data-career="rider-search" type="search" placeholder="Search riders" /></div>
    ${riderTable(riders, career.riderSort, true)}
  </div>`;
}

function placeWord(place: number): string {
  const mod = place % 100;
  const suffix = mod >= 11 && mod <= 13 ? 'th' : place % 10 === 1 ? 'st' : place % 10 === 2 ? 'nd' : place % 10 === 3 ? 'rd' : 'th';
  return `${place}${suffix}`;
}

function resultTable(title: string, rows: { riderId: string; name: string; teamId: string; value: number }[], unit: 'time' | 'pts'): string {
  if (!rows.length) return '';
  const body = rows.map((row, index) => {
    const value = unit === 'time' ? clock(row.value) : `${row.value} pts`;
    return `<tr class="${row.riderId === 'player' ? 'me' : ''}"><td>${index + 1}</td><td>${esc(row.name)}</td><td>${esc(teamCode(row.teamId))}</td><td>${value}</td></tr>`;
  }).join('');
  return `<section><h3>${title}</h3><table class="standings"><tbody>${body}</tbody></table></section>`;
}

function seasonResultsHtml(career: Career): string {
  const state = career.state!;
  const order = new Map(RACES.map((race, index) => [race.id, index]));
  const held = state.races
    .filter((race) => race.time?.length || race.podium?.length || race.winnerName)
    .slice()
    .sort((a, b) => (order.get(a.raceId) ?? 999) - (order.get(b.raceId) ?? 999) || a.name.localeCompare(b.name));
  if (!held.length) return '<p class="muted">No race has been held yet this season. This page clears when you sign for the next year.</p>';
  const blocks = held.map((race) => {
    const time = resultTable('Time', race.time ?? [], 'time');
    const sprint = resultTable('Sprint', race.sprint ?? [], 'pts');
    const mountains = resultTable('Mountains', race.mountains ?? [], 'pts');
    const sheets = time || sprint || mountains
      ? `<div class="rank-grid">${time}${sprint}${mountains}</div>`
      : `<p class="muted">Won by ${esc(race.winnerName)}. The full classification was not kept.</p>`;
    return `<details class="result-race"><summary><b>${esc(race.name)}</b>${race.skipped ? '<small>You sat this out</small>' : ''}</summary>${sheets}</details>`;
  }).join('');
  return `<p class="muted">Every competition held this season. Time is the final overall. Sprint and mountains are the points at the end of the race. A new season starts this list again.</p>${blocks}`;
}

function recordHtml(career: Career): string {
  const state = career.state!;
  const notes = state.stageNotes ?? [];
  const legacy = state.palmares.filter((item) => {
    if (item.kind === 'overall') return true;
    return !notes.some((note) => note.year === item.year && (note.raceId === item.raceId || item.name.startsWith(note.race)));
  });
  const totals = careerTotals(state);
  const total = (value: number, label: string) => `<div><dd>${value}</dd><dt>${label}</dt></div>`;
  const head = `<dl class="record-totals">
    ${total(totals.raceWins, totals.raceWins === 1 ? 'Race win' : 'Race wins')}
    ${total(totals.stageWins, totals.stageWins === 1 ? 'Stage win' : 'Stage wins')}
    ${total(totals.podiums, totals.podiums === 1 ? 'Podium' : 'Podiums')}
    ${total(totals.topTen, 'Top 10')}
    ${total(totals.stages, totals.stages === 1 ? 'Stage ridden' : 'Stages ridden')}
    ${total(totals.seasons, totals.seasons === 1 ? 'Season' : 'Seasons')}
  </dl>`;
  const years = [...new Set([...notes.map((note) => note.year), ...state.palmares.map((item) => item.year)])].sort((a, b) => b - a);
  const seasonBlock = (year: number) => {
    const finals = state.palmares
      .filter((item) => item.year === year && item.kind !== 'stage')
      .sort((a, b) => a.place - b.place || a.name.localeCompare(b.name))
      .map((item) => `<li class="${item.place <= 3 ? 'podium' : ''}"><b>${placeWord(item.place)}</b> ${esc(item.name)}${item.kind === 'overall' ? ' <small>overall</small>' : ''}</li>`)
      .join('');
    const older = legacy
      .filter((item) => item.year === year && item.kind === 'stage')
      .map((item) => `<li><b>${placeWord(item.place)}</b> ${esc(item.name)}</li>`)
      .join('');
    const stages = notes
      .filter((note) => note.year === year)
      .map((note) => `<tr class="${note.place <= 3 ? 'podium' : ''}"><td>${esc(note.race)}</td><td class="muted">${esc(note.stage === note.race ? '' : note.stage)}</td><td class="num"><b>${placeWord(note.place)}</b></td><td class="num">${clock(note.time)}</td></tr>`)
      .join('');
    return `<section class="record-season">
      <h3>${year}</h3>
      ${finals || older ? `<ul class="record-finals">${finals}${older}</ul>` : '<p class="muted">No top 10 overall this season.</p>'}
      ${stages ? `<details><summary>Every stage you rode</summary><table class="standings"><tbody>${stages}</tbody></table></details>` : ''}
    </section>`;
  };
  const yours = years.length ? years.map(seasonBlock).join('') : '<p class="muted">Nothing on the palmarès yet. Your top 10s and every stage you ride go here.</p>';
  const saved = [...state.history, ...state.races];
  const byRace = new Map<string, typeof saved>();
  for (const race of saved) {
    const list = byRace.get(race.raceId) ?? [];
    list.push(race);
    byRace.set(race.raceId, list);
  }
  const order = (id: string) => {
    const race = RACES.find((item) => item.id === id);
    if (!race) return 9;
    if (race.id === 'france-tour' || race.id === 'italy-tour' || race.id === 'spanish-tour') return 0;
    if (race.champ) return 1;
    if (race.level === 'world') return 2;
    if (race.level === 'pro') return 3;
    return 4;
  };
  const blocks = [...byRace.entries()]
    .sort((a, b) => order(a[0]) - order(b[0]) || a[1][0].name.localeCompare(b[1][0].name))
    .map(([id, years]) => {
      const race = RACES.find((item) => item.id === id);
      const level = !race ? '' : race.champ ? 'Championship' : DIVISION_LABEL[race.level === 'world' ? 'world' : race.level === 'pro' ? 'pro' : 'continental'];
      const rows = [...years].sort((a, b) => b.year - a.year).flatMap((item) => {
        const spots = item.podium?.length ? item.podium : [{ riderId: item.winnerId, name: item.winnerName, team: item.winnerTeam }];
        return spots.map((spot, index) => `<tr class="${spot.riderId === 'player' ? 'me' : ''}"><td>${index === 0 ? item.year : ''}</td><td>${index + 1}</td><td>${esc(spot.name)}</td><td>${esc(spot.team)}</td></tr>`);
      }).join('');
      return `<article><h3>${esc(years[0].name)} <small>${esc(level)}</small></h3><table class="standings"><tbody>${rows}</tbody></table></article>`;
    }).join('');
  return `<div class="career-record">${head}<section><h3>Your results</h3>${yours}</section><section class="podiums"><h3>Podiums</h3><p class="muted">First, second and third in every competition, kept from one season to the next.</p>${blocks || '<p>No races finished yet.</p>'}</section></div>`;
}

function teamHtml(career: Career): string {
  const state = career.state!;
  const team = teamById(state.teamId)!;
  const riders = ridersOf(team.id).slice().sort((a, b) => compareRiders(a, b, career.riderSort.key, career.riderSort.dir));
  return `<div>
    <p class="team-open">${jerseyFigure(team.kit.jersey, team.kit.accent, team.kit.shorts, team.kit.helmet)}<span><b>${esc(team.name)}</b> · ${esc(team.sponsors)}. ${ROSTER_SIZE[team.division]} riders on the books. You are the leader, so these ratings are theirs, not yours.</span></p>
    ${riderTable(riders, career.riderSort, false)}
    <button class="btn ghost danger" type="button" data-career="reset">Delete this career</button>
  </div>`;
}

function briefHtml(career: Career): string {
  const state = career.state!;
  const active = state.active;
  if (!active) return '<p>Pick a race from the calendar.</p>';
  const race = RACES.find((item) => item.id === active.raceId);
  if (!race) return '<p>That race is missing.</p>';
  const stage = race.stages[active.stageIndex];
  if (!stage) return '<p>That stage is missing.</p>';
  const window = stageWindow(stage);
  const when = raceDays(race, state.year)[active.stageIndex];
  const need = startMateCount(race);
  const chosen = new Set(active.squad ?? teammatesFor(state).map((rider) => rider.id));
  const picking = active.stageIndex === 0 && need > 0;
  const pool = picking ? eligibleMates(state.teamId, race) : [];
  const mateRow = (rider: (typeof pool)[number]) => {
    const { flat, mountain, sprint } = rider.attrs;
    const top = Math.max(flat, mountain, sprint);
    const cell = (value: number) => `<span class="num${value === top ? ' top' : ''}">${value}</span>`;
    return `<label class="mate${chosen.has(rider.id) ? ' on' : ''}"><input type="checkbox" data-career="squad" data-rider="${rider.id}" ${chosen.has(rider.id) ? 'checked' : ''}/><i aria-hidden="true"></i><span class="mate-name"><b>${esc(riderName(rider))}</b><small>${rider.country}</small></span>${cell(flat)}${cell(mountain)}${cell(sprint)}</label>`;
  };
  const mateHead = '<div class="mate-head" aria-hidden="true"><span></span><span>Rider</span><span>Flat</span><span>Mountain</span><span>Sprint</span></div>';
  const half = Math.ceil(pool.length / 2);
  const mates = picking
    ? [pool.slice(0, half), pool.slice(half)].filter((col) => col.length).map((col) => `<div class="mate-col">${mateHead}${col.map(mateRow).join('')}</div>`).join('')
    : teammatesFor(state).map((rider) => `<li><b>${esc(rider.name)}</b><span>${esc(rider.program)}</span></li>`).join('');
  const stars = aiField(race, state.teamId, true, active.squad)
    .sort((a, b) => rate(b.rider, race.profile, favoursPunch(race)) - rate(a.rider, race.profile, favoursPunch(race)))
    .slice(0, 8)
    .map((slot) => `<li><b>${esc(riderName(slot.rider))}</b><span>${esc(teamById(slot.rider.teamId)?.name ?? slot.rider.country)}</span></li>`)
    .join('');
  const standing = (title: string, rows: ClassRow[], unit: 'time' | 'pts') => `<section><h3>${title}</h3><ol>${rows.length ? rows.slice(0, 8).map((row) => `<li>${esc(row.name)} · ${esc(teamCode(row.teamId))} · ${unit === 'time' ? clock(row.value) : `${row.value} pts`}</li>`).join('') : '<li>No points yet</li>'}</ol></section>`;
  const results = active.stageIndex > 0
    ? `<div class="brief-results rank-grid">${standing('Overall', active.gc, 'time')}${standing('Sprint', active.sprint, 'pts')}${standing('Mountains', active.kom, 'pts')}</div>`
    : '';
  const TACTIC: Record<CareerState['tactic'], [string, string]> = {
    control: ['Control the race', 'They ride on the front at the bunch pace until the last 800 m.'],
    sprint: ['Lead out the sprint', 'They share the wind as the pace lifts from several kilometres out.'],
    climb: ['Pace the last climb', 'They set the tempo from the foot of the last climb.'],
  };
  const tactics = (Object.keys(TACTIC) as CareerState['tactic'][]).map((tactic) => `<label class="seg${state.tactic === tactic ? ' on' : ''}"><input type="radio" name="tactic" data-career="tactic" data-tactic="${tactic}" ${state.tactic === tactic ? 'checked' : ''}/><b>${TACTIC[tactic][0]}</b><span>${TACTIC[tactic][1]}</span></label>`).join('');
  const stageLine = [stage.name !== race.name ? esc(stage.name) : '', window.reverse ? 'Ridden the other way' : ''].filter(Boolean).join(' · ');
  const stat = (label: string, value: string, unit = '') => `<div><dt>${label}</dt><dd>${value}${unit ? `<small>${unit}</small>` : ''}</dd></div>`;
  const ready = !picking || chosen.size === need;
  return `<div class="career-brief">
    <header class="brief-title">
      <div class="brief-name">
        <h3>${esc(race.name)}</h3>
        ${stageLine ? `<p>${stageLine}</p>` : ''}
      </div>
      <dl class="brief-stats">
        ${stat('Date', when ? formatDate(when.month, when.day) : '–')}
        ${stat('Distance', window.km.toFixed(1), 'km')}
        ${stat('Climbing', String(Math.round(window.ascent)), 'm')}
        ${stat('Terrain', terrainLabel(window.kind, terrainBand(window.ascent, window.km)))}
        ${stat('Stage', `${active.stageIndex + 1}<small>/${race.stages.length}</small>`)}
      </dl>
    </header>
    ${briefStake(state, race, active)}
    <div class="brief-map">
      <div class="brief-profile">
        <canvas class="route-profile stage-profile" data-stage="${race.id}:${active.stageIndex}"></canvas>
        <div class="brief-pace">
          <h4>Bunch pace</h4>
          ${window.kind === 'tt'
            ? paceRow('diff-tt', 'Time trial', state.ttWkg, 10)
            : `${paceRow('diff-flat', 'Flat', state.flatWkg)}${paceRow('diff-hill', 'Hills', state.hillWkg)}${paceRow('diff-mountain', 'Mountains', state.mountainWkg)}`}
        </div>
      </div>
      <section class="brief-watch">
        <h4>Riders to watch</h4>
        <ol>${stars}</ol>
      </section>
    </div>
    <section class="brief-squad">
      <header class="squad-head">
        <h4>Teammates</h4>
        ${picking ? `<span class="squad-count${ready ? ' ready' : ''}"><b>${chosen.size}</b>/${need} picked</span><span class="muted">This squad starts every stage.</span>` : '<span class="muted">The riders you chose for this race.</span>'}
      </header>
      ${picking ? `<div class="squad-pick">${mates}</div>` : `<ul class="squad-list">${mates}</ul>`}
      <h4 class="tactic-title">Team orders</h4>
      <div class="tactic" role="radiogroup" aria-label="Team orders">${tactics}</div>
    </section>
    ${results}
    <div class="brief-actions">
      ${active.stageIndex === 0 ? '<button class="brief-skip" type="button" data-career="skip">Skip this race</button>' : ''}
      <button class="btn primary big" type="button" data-career="start">Start stage</button>
    </div>
  </div>`;
}

/** On the brief: where you stand in this race, what it pays, and how far the next contract is. */
function briefStake(state: CareerState, race: RaceDef, active: NonNullable<CareerState['active']>): string {
  const progress = contractProgress(state);
  const gc = active.stageIndex > 0 ? overallLine(active.gc) : '';
  return `<div class="brief-stake">
    ${gc ? `<p class="brief-gc">${gc}</p>` : ''}
    <p>${stakeLine(race)} contract points</p>
    <p class="muted">You have <b>${progress.points}</b> · ${goalLine(progress.next, progress.division)}</p>
  </div>`;
}

function offersHtml(career: Career): string {
  const state = career.state!;
  const cards = (state.offers ?? []).map((offer) => {
    const team = teamById(offer.teamId);
    if (!team) return '';
    return `<article class="team-row offer">
      ${jerseyFigure(team.kit.jersey, team.kit.accent, team.kit.shorts, team.kit.helmet)}
      <span class="team-row-body">
        <span class="team-row-top"><b>${esc(team.name)}</b>${stars(teamStars(team.id))}</span>
        <span class="team-row-meta">${esc(DIVISION_LABEL[team.division])} · ${esc(FOCUS_LABEL[team.focus])}</span>
        <span>${esc(offer.blurb)}</span>
      </span>
      <button class="btn primary" type="button" data-career="sign" data-team="${team.id}">Sign</button>
    </article>`;
  }).join('');
  return `<div class="career"><h2>Offers for ${state.year + 1}</h2><p>You scored ${state.cyb.player ?? 0} CYB points. One offer is from the team you ride for now.</p><div class="team-list">${cards}</div></div>`;
}

function clock(seconds: number): string {
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}
