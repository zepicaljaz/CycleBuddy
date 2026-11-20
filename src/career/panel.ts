import { brandLogo } from '../brand';
import { canEnter, formatDate, MONTHS, monthsFor, raceDays, RACES, stageWindow, terrainBadge, terrainBand, terrainLabel, type RaceDef } from './calendar';
import { RIDERS, riderName, riderTrait, ridersOf, teamBest, teamLeader, teamStars, type Rider } from './roster';
import { teammatesFor, rankingRows, teamRanking, type Career } from './season';
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

function hubHtml(career: Career): string {
  const state = career.state!;
  const team = teamById(state.teamId);
  const next = state.active ? RACES.find((race) => race.id === state.active?.raceId) : career.nextEntered();
  const points = state.cyb.player ?? 0;
  const rank = Object.keys(state.cyb).length ? 1 + Object.values(state.cyb).filter((value) => value > points).length : null;
  const entered = state.entered.filter((id) => !state.done.includes(id)).length;
  const waiting = !state.active && !next && !!career.nextOpen();
  const stageIndex = state.active?.stageIndex ?? 0;
  const stage = next?.stages[stageIndex];
  const rideLabel = state.active
    ? `Stage ${stageIndex + 1} of ${next?.stages.length ?? 1}${stage && (next?.stages.length ?? 0) > 1 ? ` · ${stage.name}` : ''}`
    : next
      ? `${formatDate(next.month, next.day)} · ${next.stages.length > 1 ? `${next.stages.length} stages` : 'one day'}`
      : waiting
        ? 'Tick a race on the calendar'
        : 'Every race on your list is done';
  const rideTitle = state.active ? 'Continue' : next ? 'Next race' : waiting ? 'No race ticked' : 'Season done';
  const rideAct = state.active || next ? 'brief' : 'tab';
  const rideTab = state.active || next ? '' : ' data-tab="calendar"';
  return `<div class="career-home">
    <div class="home-brand">
      ${brandLogo()}
      <p>${esc(team?.name ?? 'Career')} · ${state.year}</p>
      <p class="home-rider">${esc(DIVISION_LABEL[team?.division ?? 'continental'])} · ${points} CYB${rank ? ` · rank ${rank}` : ''} · ${entered} races left</p>
    </div>
    <nav class="home-menu">
      <button class="menu-card" type="button" data-career="${rideAct}"${rideTab}><b>${rideTitle}</b><span>${esc(next ? `${next.name}. ${rideLabel}` : rideLabel)}</span>${next && stage ? hubStage(next, stageIndex) : ''}</button>
      <button class="menu-card" type="button" data-career="tab" data-tab="calendar"><b>Calendar</b><span>The months, the days, and the profile of every stage</span></button>
      <button class="menu-card" type="button" data-career="tab" data-tab="rankings"><b>Standings</b><span>CYB for the World Tour, Continental for Pro and Continental</span></button>
      <button class="menu-card" type="button" data-career="tab" data-tab="record"><b>Record</b><span>Your results, and who won each race</span></button>
      <button class="menu-card quiet" type="button" data-career="tab" data-tab="team"><b>My team</b><span>${esc(team?.name ?? 'Squad')}, the riders and their ratings</span></button>
      <button class="menu-card quiet" type="button" data-career="tab" data-tab="riders"><b>All teams</b><span>Every team, then the riders on that team</span></button>
      <button class="menu-card quiet" type="button" data-career="tab" data-tab="field"><b>All riders</b><span>Every rider, so you can sort who leads each attribute</span></button>
      <button class="menu-card quiet" type="button" data-career="download"><b>Download save</b><span>A file of this career, kept on your computer</span></button>
      ${!state.active && career.nextOpen() && !career.nextEntered() ? '<button class="menu-card quiet" type="button" data-career="advance"><b>Simulate</b><span>Races you unticked are ridden without you</span></button>' : ''}
    </nav>
  </div>`;
}

function hubStage(race: RaceDef, stageIndex: number): string {
  const stage = race.stages[stageIndex];
  if (!stage) return '';
  const window = stageWindow(stage);
  const band = terrainBand(window.ascent, window.km);
  return `<span class="ride-stage"><canvas class="route-profile stage-profile" data-stage="${race.id}:${stageIndex}"></canvas><span class="badge ${terrainBadge('road', band)}">${esc(terrainLabel('road', band))}</span></span>`;
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

function monthBoard(year: number, month: number, races: RaceDef[], done: Set<string>, division: 'world' | 'pro' | 'continental'): string {
  const first = new Date(year, month - 1, 1);
  const lead = (first.getDay() + 6) % 7;
  const count = new Date(year, month, 0).getDate();
  const onDay = (day: number) => races.filter((race) => raceDays(race, year).some((slot) => slot.month === month && slot.day === day));
  const blanks = Array.from({ length: lead }, () => '<div class="day-cell empty"></div>').join('');
  const cells = Array.from({ length: count }, (_, index) => {
    const day = index + 1;
    const here = onDay(day);
    const names = here.map((race) => {
      const locked = !canEnter(race.level, division);
      return `<span class="race-chip ${raceTone(race)}${locked ? ' locked' : ''}">${esc(race.name)}</span>`;
    }).join('');
    const finished = here.some((race) => done.has(race.id));
    return `<div class="day-cell${here.length ? ' has' : ''}${finished ? ' done' : ''}"><b>${day}</b>${names}</div>`;
  }).join('');
  return `<div class="month-grid">${WEEKDAYS.map((name) => `<div class="dow">${name}</div>`).join('')}${blanks}${cells}</div>`;
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
  const busy = months.find((item) => RACES.some((race) => raceDays(race, state.year).some((slot) => slot.month === item)));
  const month = months.includes(career.calendarMonth ?? -1) ? career.calendarMonth! : (busy ?? months[0]);
  if (!month) return '<p class="muted">No races on this calendar.</p>';
  career.calendarMonth = month;
  const index = months.indexOf(month);
  const done = new Set(state.done);
  const races = RACES.filter((race) => raceDays(race, state.year).some((slot) => slot.month === month));
  const details = races.map((race) => raceDetail(race, career, month)).join('');
  const prev = index > 0
    ? `<button class="btn ghost" type="button" data-career="month" data-dir="-1">← ${MONTHS[months[index - 1]]}</button>`
    : '<span class="month-slot"></span>';
  const next = index < months.length - 1
    ? `<button class="btn ghost" type="button" data-career="month" data-dir="1">${MONTHS[months[index + 1]]} →</button>`
    : '<span class="month-slot"></span>';
  return `<div class="month-nav">${prev}<h3>${MONTHS[month]} ${state.year}</h3>${next}</div>
    <p class="muted">Every competition is on the calendar. Dimmed races are outside your division. You can start only one race on a day. Untick a race to stay home, and you score nothing for it.</p>
    <section class="month-block">
      ${monthBoard(state.year, month, races, done, team.division)}
      ${races.length ? '' : '<p class="muted">Nothing is scheduled this month.</p>'}
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
  let box = '';
  if (done) box = `<span class="muted">${saved?.skipped ? 'You sat this out' : saved ? `Won by ${esc(saved.winnerName)}${saved.playerPlace ? ` · you ${saved.playerPlace}` : ''}` : 'Done'}</span>`;
  else if (!eligible) box = '<span class="muted">Not your division</span>';
  else box = `<label class="check"><input type="checkbox" data-career="enter" data-race="${race.id}" ${on ? 'checked' : ''}/> Ride</label>`;
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
  return `<details class="race-detail ${eligible ? '' : 'locked'}">
    <summary>
      <span class="race-fold-main"><b>${esc(race.name)}</b><small>${esc(when)} · ${esc(level)} · ${count}${esc(continued)}</small></span>
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

function rankingTables(career: Career, playerName: string): string {
  const state = career.state!;
  const cyb = rankingRows(state.cyb, 20, playerName);
  const cont = rankingRows(state.cont ?? {}, 20, playerName);
  const wins = rankingRows(state.wins, 15, playerName);
  const table = (title: string, rows: { id: string; name: string; team: string; value: number }[], unit: string) => `
    <section><h3>${title}</h3><table class="standings"><tbody>
      ${rows.map((row, i) => `<tr class="${row.id === 'player' ? 'me' : ''}"><td>${i + 1}</td><td>${esc(row.name)}</td><td>${esc(row.team)}</td><td>${row.value} ${unit}</td></tr>`).join('') || '<tr><td>No results yet</td></tr>'}
    </tbody></table></section>`;
  const teamTable = (title: string, divisions: Array<'world' | 'pro' | 'continental'>, limit: number) => {
    const rows = teamRanking(state.teamPoints, divisions, limit, state.teamId);
    const body = rows.map((row) => {
      const division = divisions.length > 1 ? ` <span class="muted">${esc(DIVISION_LABEL[row.division])}</span>` : '';
      return `<tr class="${row.id === state.teamId ? 'me' : ''}"><td>${row.place}</td><td>${esc(row.name)}${division}</td><td>${row.value} pts</td></tr>`;
    }).join('') || '<tr><td>No results yet</td></tr>';
    return `<section><h3>${title}</h3><table class="standings"><tbody>${body}</tbody></table></section>`;
  };
  return `<p class="muted">CYB ranking is World Tour races and the championships. Continental ranking is Pro and Continental races. World Tour teams have a CYB standing. Pro and Continental teams share the Continental standing.</p><div class="rank-grid">
    ${table('CYB ranking', cyb, 'pts')}
    ${table('Continental ranking', cont, 'pts')}
    ${table('Wins', wins, '')}
    ${teamTable('CYB teams', ['world'], 22)}
    ${teamTable('Continental teams', ['pro', 'continental'], 20)}
  </div>`;
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
  const lines = [
    ...notes.map((note) => `<li>${note.year} · ${esc(note.race)} · ${esc(note.stage)} · ${placeWord(note.place)} · ${clock(note.time)}</li>`),
    ...legacy.map((item) => `<li>${item.year} · ${esc(item.name)} · ${item.place === 1 ? 'winner' : placeWord(item.place)}</li>`),
  ];
  const yours = lines.length ? lines.join('') : '<li>Nothing on the palmarès yet.</li>';
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
  return `<div class="career-record"><section><h3>Your results</h3><ul>${yours}</ul></section><section class="podiums"><h3>Podiums</h3><p class="muted">First, second and third in every competition, kept from one season to the next.</p>${blocks || '<p>No races finished yet.</p>'}</section></div>`;
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
