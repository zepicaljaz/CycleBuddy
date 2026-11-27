# src/training: plans, workouts, FTP tests

Structured training: week-by-week plans, the workouts in them, the ERG targets a training ride follows, and the two FTP tests. Data and pure functions only; the ride that follows a workout is `game/session.ts` (`followWorkout`), the screens are in `game/app.ts`, `site/trainingPage.ts` and `ui/hud.ts`.

## What lives here
- `workout.ts`: workout building blocks (`steady`, `ramp`, `reps`, `max`), `expandBlocks` → timed `WorkoutStep`s, the cue for a moment (`cueAt`, `targetPct`, `stepAt`), prescribed load, workout bars. `ZONES` (the one zone table; Analytics uses it too).
- `plans.ts`: `PLANS` (16+ plans in groups `start` / `build` / `rider` / `event` / `keep`), `FTP_TEST_PLAN`, `planStats`, `nextWorkout`, `activateWorkout` (a plan workout → `ActiveWorkout` for the ride).
- `ftp.ts`: ramp test (`RampTest`: 75% of the best 60 s, only ramp steps count, a step counts only if held at 85% of its target) and 20-minute test (`sampleTwentyMinute`: 95% of the 20-minute average). FTP limits 80–550 W. `ftpTestsFromRides` lists saved tests.
- `progress.ts`: which workouts are done, read from saved training rides (`planId/workoutId` keys).

## Rules
- Targets are a share of FTP (`pct`, 1 = FTP), never watts. Watts come from `cue.watts` with the rider's FTP and the ERG bias.
- `max` blocks become `open` steps: ERG goes off, the rider chooses the power, and the average is what counts. Don't give an open step an ERG target.
- Plan and workout `id`s are saved on every finished training ride (`workout.planId` / `workoutId`) and drive the ticks on the account. Never rename or reuse an id; add a new one instead.
- Workout ids are unique within a plan; plan ids are unique overall (tested).
- Plan text is shown on the public site and in the game: plain English, no emoji, no invented physiology claims.
- One zone table: change `ZONES` and both the workout bars and Analytics follow. Update `docs/ANALYTICS.md` if the bands move.

## Common jobs
Add a workout or plan:
1. Write it with blocks (`steady`, `ramp`, `reps`, `max`) in `plans.ts`; give it a new, stable `id`.
2. Keep within what the test allows: 15–160 min, targets 35%–220% of FTP, 2–4 workouts a week, at least 4 weeks, a recovery week shorter than the week before.
3. If it is featured, add its id to `FEATURED_IDS`.
4. Run `npx vitest run src/training/plans.test.ts src/screens.test.ts`.

Change FTP test scoring:
1. Edit `ftp.ts` (constants `RAMP_FACTOR`, `RAMP_HOLD`, `TWENTY_MINUTE_FACTOR`).
2. Check `game/session.ts` `watchFtpTest` / `watchTwenty`, which feed it per frame with the target actually asked of the trainer (ERG bias included).
3. Run `npx vitest run src/training/ftp.test.ts`.

## Tests
- `npx vitest run src/training/plans.test.ts`: timeline, every plan's shape and limits, ramp test past threshold, 20-minute test, `progressFromRides`.
- `npx vitest run src/training/ftp.test.ts`: ramp and 20-minute scoring, frame-rate independence, saved tests compared.
- `npx vitest run src/screens.test.ts`: the training plans page renders.

## Traps
- `progressFromRides` builds the key inline as `` `${planId}/${workoutId}` `` instead of calling `workoutKey()`; keep the two formats identical if either changes.
- `stepAt` scans the steps with `find`, and `cueAt` runs every frame on a training ride. Fine for workouts of a few hundred steps; don't put anything heavier there (see [docs/PERFORMANCE.md](../../docs/PERFORMANCE.md)).
- A completed ride only ticks its workout when `workout.completed` is true; a ride that is stopped early saves but doesn't tick.
- An FTP test only changes FTP for rides from its day on (`analytics/metrics.ts` `ftpTimeline`).
