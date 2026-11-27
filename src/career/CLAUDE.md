# src/career: Career mode

The season: calendar, teams, riders, entries, results, classifications, jerseys, contract offers, and the Career screens. The racing itself is in `src/ai/` (see `src/ai/CLAUDE.md`); the 3D stage roads are in `src/routes/careerWorlds.ts`.

## What lives here
- `season.ts`: `Career` class (state, `load`/`save`, `launch()` builds a ride, `commit()` takes the result rows), `adoptCalendar`, `mergeTime`, `stagePrimes`, rankings, palmarès.
- `types.ts`: `CareerState` (saved, `version: 1`), divisions, race levels and profiles.
- `calendar.ts`: `RACES` (every race and its stages), stage km, terrain bands, `stageWindow`, `punchyStage`, race days and clashes.
- `teams.ts`, `roster.ts`, `surnames.ts`: teams and divisions; `RIDERS` built once at import from a seeded rng per team; names.
- `squad.ts`: who starts a race: invited teams, `aiField`, `champField`, the player's teammates.
- `simulate.ts`: races the player does not ride, scored from ratings (seeded by year + race id).
- `classify.ts`: points tables (`FINISH_POINTS`, CYB / continental points) and contract offer marks.
- `progress.ts`: read-only numbers for the screens (contract meter, season strip, standings). Never changes state.
- `jerseys.ts`: kit colours, leader's jerseys, national champion kits.
- `panel.ts`: every Career screen as an HTML string (`careerHtml`, `seasonUpdateHtml`).

Docs: [docs/CAREER_UI.md](../../docs/CAREER_UI.md) (screens and decisions), [docs/CAREER_RACING.md](../../docs/CAREER_RACING.md) (how a stage is raced).

## Rules
- Career state lives in `localStorage` under `cyclebuddy-career`. `storage/localOwner.ts` clears it when another account takes the device, so keep that key name.
- Saves from older builds must keep loading. A new `CareerState` field is optional or gets a default in `Career.load()` (`parsed.x = parsed.x ?? ...`). Only bump `version` with a migration; a mismatched version silently drops the career.
- Everything is seeded (`mulberry32`, `hashString`). No `Math.random()`: the same year and race must simulate the same way, and the roster must be the same on every device.
- Race and stage names are made up. No race trademarks (see root `CLAUDE.md`).
- Screens: HTML strings, `esc()` anything that comes from data, no card grids, pills or emoji; numbers in tabular figures. `progress.ts` stays read-only.

## Common jobs
Add a race:
1. Add a `RaceDef` to `RACES` in `calendar.ts` with stages pointing at existing segment ids from `routes/careerWorlds.ts` (`segmentById` throws on an unknown id).
2. Check it doesn't clash with races the same teams ride (`sharesDay`, `resolveClashes`).
3. `adoptCalendar` ticks it on for existing saves; nothing else is needed for old careers.
4. Run `npx vitest run src/career/career.test.ts src/screens.test.ts`.

Add a stage road: add the segment in `routes/careerWorlds.ts` (see `src/routes/CLAUDE.md`), then reference it here.

Change points or offers: edit `classify.ts`, update the tables in `docs/CAREER_UI.md`, run `progress.test.ts` and `career.test.ts`.

## Tests
- `npx vitest run src/career/career.test.ts`: season, results, time trials, fast-forward, pack shape; simulated finishes follow the ratings.
- `npx vitest run src/career/progress.test.ts`: contract meter, payouts, season strip, standings, totals.
- `npx vitest run src/screens.test.ts`: every Career tab renders without "undefined", "NaN" or an empty screen.

## Traps
- `RIDERS` is built at import time. Changing roster maths changes every rider in existing saves (ids stay, ratings move).
- Saved results are not re-simulated: a save from an older build keeps its old results (see "Races you do not ride" in `docs/CAREER_UI.md`).
- `calendar.ts` imports `routes/route.ts` and `routes/definitions.ts`; `stageKm` reads section lengths without building the road, keep it that way in loops over `RACES`.
- `Career.load()` swallows errors and leaves `state = null`, so a load bug looks like "no career". Check the console and the saved JSON.
- The Pro race (`game/quickRace.ts`) reuses Career races and rosters with no career state; `app.quickRide` stops it from writing results. Test both when changing `launch()`.
