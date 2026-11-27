# src/game: the app shell and one ride

`app.ts` is the whole game UI: screens, navigation, keys, the render loop, results, top bar, pause dialog. `session.ts` is one ride. No framework: screens are HTML strings set with `innerHTML`, then listeners are wired.

## What lives here
- `app.ts` (`App`): screens (`Screen` union + the `views` record in `render()`), `go(screen)`, `/play` vs `/play/career` paths, `loadWorld()`, `startRide(mode)`, `loop()`, `advanceSession()`, pause (`showPause`), finish and results.
- `session.ts` (`RideSession`): state (`countdown` → `riding` ↔ `paused` → `finished`), physics steps, distance/energy/climbing, trainer commands, climb segments, workout following, FTP test.
- `boot.ts`, `playBoot.ts`: startup (which account owns local data) and the loading screen. `main.ts` (one level up) lazy-loads the game or the site.
- `homeView.ts`: home menu HTML (`homeHtml`, `HOME_KEYS`). `proRaceView.ts` + `quickRace.ts`: Pro race setup page and its stage launch.
- `recorder.ts`: one sample per second, ride stats. `coins.ts`, `accountProfile.ts`, `climbRecord.ts`, `estimates.ts`: coins/kit, the rider record on the account, climb segments, lap-time estimates.

## What runs when
- `loop()` every display frame (requestAnimationFrame). Menus draw at ~30 fps (`MENU_FRAME_MS`); behind a glass panel that covers ≥ 55 % of the window (`updateMenuCover`, from a `ResizeObserver` on `#panel`, not a layout read) they draw at 10 fps (`COVERED_FRAME_MS`) with `graphics.lite` (AO and bloom off). Home, the career hub and the garage never count as covered. A ride draws every frame, render `dt` capped at 0.1 s.
- `advanceSession(now, maxSec)` first, every frame: steps the ride to real time in chunks of ≤ 0.1 s, capped at `FRAME_CATCH_UP_SEC` (5 s). Autosaves the active ride every 30 s.
- Hidden tab: frames stop, so a 1 s `setInterval` calls `advanceSession(..., BACKGROUND_CATCH_UP_SEC)` (75 s, because Chrome throttles background timers). `sessionClock` is shared, so nothing is stepped twice.
- `RideSession.update(dt)` splits each chunk into physics steps of ≤ 0.05 s: `sim.step()` (the peloton, `src/ai/CLAUDE.md`) + `meter.update()`. That is the hot path.
- Then `world.update()` every frame; HUD, road-ahead panel, tools, segment announcements and career sync every 100 ms (`hudTimer > 0.1`).

## Rules
- Per frame and per step: no allocations, no string building, no DOM reads. Reuse buffers (`laneUsers`, `garagePose`). See `docs/PERFORMANCE.md`.
- Ride time comes from `advanceSession` only. Never step the session from anywhere else, or a ride gets stepped twice.
- Trainer: free ride and races send `devices.updateGrade(feltGrade * difficulty)` and `setErgWatts(null)`; workouts drive ERG. Pausing calls `devices.releaseToFlat()` (pause, finish, leaving a ride). Keep that in any new exit path.
- Leaving the tab releases the brake and look-back (`visibilitychange`).
- Real-road tracks load on demand (`src/routes/real/CLAUDE.md` → Loading tracks): `await ensureTrack(id)` / `ensureAllTracks()` before `realClimbRoute` or `defById` on a real climb. A screen that needs them renders without them first (index numbers or "Loading") and re-renders when they arrive.
- Escape every user or data string in HTML with `esc()` from `ui/dom.ts`.
- No `alert()`/`prompt()`; no new `confirm()` (the conventions test caps it at 3). Use an in-game dialog.
- `app.ts` is ~3700 lines. Put new screen HTML in its own view module (like `homeView.ts`, `proRaceView.ts`) when it is more than a few lines, so `screens.test.ts` can render it without the app.

## Add a screen
1. Add the name to `Screen` and a function to the `views` record in `render()`.
2. Write the HTML builder as a pure function in its own file; wire listeners after `innerHTML` is set.
3. Navigate with `go('name')` / `data-go="name"` buttons.
4. Add a case to `src/screens.test.ts` (fails on `undefined`, `NaN`, `Infinity` or an empty screen).
5. Update the README map ("Where everything is") if you added a file.

## Add something to a ride
1. State and per-step logic go in `RideSession` (keep `update()` allocation-free).
2. Display goes in the HUD (`src/ui/CLAUDE.md`), updated in the 100 ms block, not every frame.
3. Anything saved goes through `snapshot()` / `summary()` and `storage/`.

## Tests
- `npx vitest run src/screens.test.ts` (every menu screen renders; slow, the pro race case has a 60 s timeout)
- `npx vitest run src/game/quickRace.test.ts src/game/recorder.test.ts src/game/climbRecord.test.ts src/game/coins.test.ts src/game/accountProfile.test.ts`
- `app.ts` and `session.ts` have no direct tests: start a ride and look.

## Traps
- New installs default to the Medium preset (`defaultProfile`); a saved profile keeps its own, and one saved without a quality stays on High (the old default). The preset is the ceiling for the auto step-down in `world/graphics.ts`.
- `advanceSession` resets the clock (returns without stepping) on the first call for a new session; the first frame of a ride steps nothing.
- In `countdown` the sim does not step but the trainer already gets the grade; in `finished` the rider keeps rolling (`rollOn`) but nothing is recorded.
- A time trial records only after the player's `ttStart`; `syncLaneUsers` leaves riders still on the ramp off the road.
- `render()` empties the panel while a session exists; ride UI lives in the HUD and overlay, not in screens.
