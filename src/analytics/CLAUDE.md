# src/analytics: the Analytics page

Training numbers after a ride: overview, fitness/fatigue/form, power curve and zones, every ride, climbs, calendar. Visited mostly on a phone after riding, not on the trainer. What each number means and its sources: [docs/ANALYTICS.md](../../docs/ANALYTICS.md).

## What lives here
- `metrics.ts`: the training maths. Ride load (NP, IF, TSS), FTP on the day (`ftpTimeline`), fitness/fatigue/form (`loadSeries`, 42 and 7 days), form bands, ramp, power curve (`powerData`, `mergeCurves`), FTP estimate, zones, decoupling.
- `model.ts`: ride lists and totals: ride kinds, week and month buckets, sorting, segment (climb) series, goals, calendar grid, number formatting.
- `view.ts`: the six pages as HTML strings (`analyticsHtml`), ride traces (`rideTraceHtml`), `powerRides`.
- `charts.ts`: SVG charts (load, form, columns, power curve, dots, segments). One `plot()` frame: SVG body with `viewBox` + `preserveAspectRatio="none"`, axis labels as HTML so they stay readable at any width.
- `shape.ts`: small ride sketches: elevation and grade profiles, power bars by zone.

Wired from `game/app.ts` (`loadAnalytics`, `paintAnalytics`, `loadRangePower`).

## Rules
- The page is a lazy chunk: `app.ts` loads it with `import('../analytics/view')` and `import('../analytics/model')` on first open. Outside this folder use `import type` only; a value import from here pulls the whole page into the game bundle.
- Pure functions. Pass `now: Date` in (it is on `AnalyticsState`); no `new Date()` or `Date.now()` inside metrics, model or view, so tests and screens stay deterministic.
- Zones come from `ZONES` in `training/workout.ts`. Don't define a second zone table.
- FTP for a ride is the FTP on that day (`ftpTimeline`): a new FTP test must not rewrite older rides' load.
- Samples are heavy. The Power page reads each ride's samples once per visit and keeps only `PowerData` (best efforts, zone seconds), cached in `app.ts` by `rideId:ftp`. Don't keep sample arrays for the whole range.
- UI: one column on a phone, sections divided by rules not boxed in cards, no pills or emoji, numbers in tabular figures (`font-variant-numeric: tabular-nums`, styles in the Analytics block of `src/styles.css`). `esc()` every label that comes from data.
- Every empty state renders: a rider with no rides, no HR or no power must see a sentence, not "NaN" or a blank chart.

## Common jobs
Add a metric:
1. Write the maths in `metrics.ts` with a test in `metrics.test.ts` (known input, known number).
2. Show it in `view.ts`; add the explanation to the page's folded "What these numbers mean" text.
3. Add how it is worked out (and the source) to `docs/ANALYTICS.md`.
4. Run the tests below, including `screens.test.ts`.

Add a chart: build it on `plot()` in `charts.ts` so axes, grid and sizing match the others; give it an `aria` label and an `empty` text.

## Tests
- `npx vitest run src/analytics/metrics.test.ts`: ride load, FTP over time, fitness/fatigue/form, power from samples.
- `npx vitest run src/analytics/model.test.ts`: kinds, totals, segments and goals, calendar, formatting and charts, ride traces, every page.
- `npx vitest run src/screens.test.ts`: each analytics page with rides and with none; fails on "undefined", "NaN", "Infinity" or empty output.

## Traps
- NP itself is computed by the recorder (`game/recorder.ts`) when a ride is saved, not here. A change to NP maths goes there and only affects new rides.
- Form is yesterday's fitness minus yesterday's fatigue (TrainingPeaks convention), not today's.
- `model.ts` imports `ROUTES` from `routes/definitions.ts` (route names and sketches in the climb catalog), so that module is part of this chunk's dependencies.
- The `power` cache key includes the rounded FTP; changing how FTP on the day is found invalidates it, which is intended.
