# Performance

CycleBuddy has to ride smoothly on an ordinary laptop with a trainer connected. The low-poly look is part of that budget. This file says what to watch, how to measure it, the rules for code that runs often, and a log of every performance change so nobody undoes one by accident.

Every optimization in the code carries a short `Perf:` comment saying why. Search for `Perf:` to find them.

## Budgets

Targets marked TODO are not set yet. Measure on the reference laptop before setting one, then fill it in.

| What | Target | Where to read it |
|---|---|---|
| Start file size (main JS chunk, gzip) | TODO kB (boot chunk 150 kB gzip on 2026-11-27, was 696 kB with the tracks inside) | `npm run build` output (`boot-*.js`) |
| Frame time while riding (CPU, ms per frame) | TODO ms (16.7 ms is 60 fps) | `?perf` overlay |
| Draw calls per frame, riding in a bunch | TODO | `?perf` overlay |
| Triangles per frame | TODO | `?perf` overlay |
| Physics step cost, 150-rider road race | TODO ms per 0.05 s step | targeted vitest timing (see below) |
| JS heap after 30 min of riding | flat, no growth | `?perf` overlay (Chrome) |

What to watch:

- **Start file size.** Everything in the first chunk loads before the menu. Analytics, training and real-road data (track JSON and terrain grids) load on demand; keep it that way. Never import a `tracks/*.json` statically or make that glob eager (see `src/routes/real/CLAUDE.md`).
- **Frame time.** The ride view draws every display frame. Anything per frame competes with the renderer.
- **Draw calls and triangles.** Riders and props are instanced and scenery is batched per cell. A new kind of object should join a batch or an instanced mesh, not add a mesh per copy.
- **Physics step cost.** The ride is stepped in 0.05 s substeps, and a background tab catches up to 75 s at once. Cost per step times the number of riders is what matters.

## How to measure

- **`?perf` overlay.** Open the game with `?perf` in the URL (for example `http://localhost:5173/?perf`). A small box in the bottom-left shows frame rate, CPU frame time, draw calls and triangles for the whole frame (shadow, AO and post passes included), live GPU geometries and textures, and the JS heap where the browser reports it. Code: `src/world/perf.ts`, wired up in `src/world/world.ts`.
- **Build sizes.** `npm run build` prints each chunk with its size and gzip size. Compare the main chunk before and after a change.
- **Targeted tests.** The laptop lags under heavy runs, so run only the test file you touched, e.g. `npx vitest run src/ai/powerMeter.test.ts`. The full suite runs once at the end.
- **Race outcomes must not move.** A performance change to the race AI must give bit-identical races. `MEASURE=1 npx vitest run src/ai/raceMeasure.test.ts` rides whole stages (slow). For a quick check, hash `measureStage(spec, seed)` for a few short stages before and after the change and compare the hashes.

## Rules for hot paths

Hot paths are code that runs per frame, per physics step, or per rider per step. In them:

- **No allocations.** No `new Map`, `new Set`, `[...array]`, `.map`, `.filter` or object literals per step if it can be avoided. Reuse scratch arrays and maps (clear them after use so they do not keep riders alive).
- **No string keys.** Do not build template strings to key a Map or to hash a value per rider per step. Use numbers, or cache the value per rider id (see `dayForm`, `descentSkill`, `packKey`).
- **No O(n²) over the field.** A loop over all riders inside a loop over all riders is too slow for a 150-rider bunch. Sort once, then walk neighbours.
- **Cache per race.** Ratings, teams and route data do not change during a race. Work them out once per race (or per field) and key the cache by something stable, not a new array per step.
- **Do not re-sort sorted data.** If the input is already in the right order, use it. `Array.prototype.sort` is stable, so a tie-break by original index is the same as no tie-break.
- **DOM: write only on change.** Compare with the last value written (the HUD's `text`, `html` and `style` helpers do this) before touching the DOM.
- **DOM: never read layout after writing.** Reading `getBoundingClientRect`, `clientWidth` or `offsetHeight` after a write forces a layout. Cache sizes and update them on resize (`ResizeObserver` or the window `resize` event; see `CssSize` in `src/ui/profileChart.ts`).
- **Three.js: static objects do not update matrices.** Anything that never moves after it is placed gets `matrixAutoUpdate = false` and one `updateMatrix()`. Move such an object only together with a new `updateMatrix()`.
- **Display-only values do not run in physics.** Values only a screen shows (the power meter) are read once per drawn frame, never per substep or in a hidden tab's catch-up.

## Log

One entry per change. Newest last.

| Date | Change | Where | Why it is safe |
|---|---|---|---|
| 2026-11-26 | `isProtectedRider` looks each team's best rider up from a cached `teamTempoRank` instead of looping the field per call (PR #9) | `src/ai/road.ts` (`teamBestCached`) | Ratings and teams do not change in a race; the cache is rebuilt when the field size or finish changes |
| 2026-11-26 | `dayForm` keeps each rider's form for the current race instead of hashing a new string per rider per step (PR #9) | `src/ai/raceBrain.ts` | Same seed and rider give the same value; cache is cleared when the seed changes |
| 2026-11-26 | `uiBlocksLook` checks the session state first and the overlay's `firstChild` instead of serializing its HTML every frame (PR #9) | `src/game/app.ts` | An overlay with no children is exactly an overlay with empty HTML |
| 2026-11-27 | AI power meter: substeps only note their time; the meter reads the riders once per drawn frame and before the hover tag reads it. A hidden tab never reads it; after a gap longer than its 1.5 s smoothing it restarts from the current motion | `src/ai/powerMeter.ts` (`defer`, `settle`), `src/game/session.ts`, `src/game/app.ts` (`loop`) | Its only reader is the hover tag. At 60 fps a frame is one substep, so the reading is the same; tests in `powerMeter.test.ts` cover settle and the long gap. Race results do not read it |
| 2026-11-27 | `syncOverlayPointer` checks `firstChild` and writes the canvas class and style only when the state flips | `src/game/app.ts` | `releaseLook` sets the class itself and clears the remembered state, so the next frame writes again, as before |
| 2026-11-27 | Hover tag: the canvas box is read once and kept until a window resize or a `ResizeObserver` change, instead of `getBoundingClientRect` per pointer move and `clientWidth/Height` per frame | `src/game/app.ts` (`canvasRect`) | The canvas is `position: fixed; inset: 0`, so only a resize (or display change) moves it |
| 2026-11-27 | Terrain chunk group, mesh and prop instances: `matrixAutoUpdate = false` and one `updateMatrix()` after placing | `src/world/terrain.ts` (`buildMesh`) | Chunks never move: LOD swaps replace them and shadows only flip flags |
| 2026-11-27 | `Route.totalAscent` cached per route; the free-ride sort reads each key once before sorting | `src/routes/route.ts`, `src/game/app.ts` (`sortedFreeRoutes`) | Heights are final after the constructor (excerpt routes start with no cache) |
| 2026-11-27 | `ProfileChart.draw` samples its 301 heights only when the cached drawing is rebuilt; markers use that drawing's height range | `src/ui/profileChart.ts` | Markers now sit on the cached line's scale; the cache key already rounds `s0`/`s1` to the metre, so any shift is under a pixel |
| 2026-11-27 | HUD side panel goes through the write-on-change `html()` helper; coach class toggled only when it flips | `src/ui/hud.ts` (`updateSide`) | Same string, same DOM; nothing else writes `#h-side` |
| 2026-11-27 | Road races: `shapeRoad` uses each group as cut from the sorted field instead of copying and re-sorting it; `tempoOrder` skips its sort when the group is already in road order and drops the index tie-break; `tempoOrder`, `orderPull` and `shapeRoad` reuse scratch Maps/Sets; `shapeRoad` takes the team ranking from the same per-race cache as `isProtectedRider` | `src/ai/road.ts` | Stable sort of sorted input is the identity, and a tie-break by original index equals stability. Hashes of `measureStage` for 4 stages x 2 seeds are identical before and after |
| 2026-11-27 | `indexFrame` keeps the unfinished-riders array as the same object while that set is unchanged, so `isProtectedRider`'s team-best cache hits instead of rebuilding every step | `src/ai/peloton.ts` (`liveRacers`) | A new array is made whenever a rider finishes or the field changes, which is exactly when the team best over unfinished riders can change |
| 2026-11-27 | `descentSkill` cached per rider id instead of hashing a string per call | `src/ai/raceBrain.ts` | Pure function of the rider id |
| 2026-11-27 | Free rides: `packKey` is a number (negative per solo rider, positive per group and direction) instead of a template string per rider per step | `src/ai/peloton.ts` | Same grouping, no collisions; a 10-minute free-ride state hash is identical before and after |
| 2026-11-27 | Real-road tracks load on demand: the `tracks/*.json` glob is lazy (one chunk per road), `ensureTrack`/`ensureAllTracks` fetch them before a route is built, and the Free ride list sorts and shows length/climbing from `trackIndex.json` until they arrive. Boot chunk 2,070 kB → 445 kB (gzip 696 → 150 kB) | `src/routes/real/build.ts`, `src/routes/real/trackIndex.json`, `src/game/app.ts` (`sortedFreeRoutes`, `bindFree`, `viewRace`/`bindRace`, `bindHome`, `startRide`) | Same track data, same routes once fetched. `realClimbRoute` throws for an unfetched real road instead of caching a generated one; `trackIndex.test.ts` keeps the index equal to the routes, so the list order is the same before and after the fetch |
| 2026-11-27 | Auto quality step-down while riding: once dynamic resolution is at its floor and the median frame stays over 20 ms for 3 s, AO goes off, then the 4096² shadow map drops to 2048², then bloom goes off; after 10 s keeping up they come back in reverse, before resolution climbs; a step up that falls back within 8 s blocks retries for 2 min. Never above the chosen preset; the `?perf` overlay shows the effective level. New installs default to Medium (saved profiles keep theirs). Headless M3 preview, alpine s=4000, High, 1440×900: 51.6 ms → 29.3 ms per frame after it stepped all three down (indicative) | `src/world/graphics.ts` (`adapt`, `setLevel`, `assemble`), `src/world/world.ts` (`setQuality`), `src/game/app.ts` (`defaultProfile`) | Only while riding and only below the user's preset; Settings resets it. Changing the AO/bloom chain keeps the AO pass instance (no rebuild) |
| 2026-11-27 | Menus behind a glass panel covering ≥ 55 % of the window draw at 10 fps instead of 30, with AO and bloom out of the chain (`Graphics.lite`). Panels are translucent (82 % + blur), so it never stops drawing. Headless preview, same spot: 51.6 → 30.3 ms per drawn frame, at a third of the frames | `src/game/app.ts` (`updateMenuCover`, `loop`), `src/world/graphics.ts` (`lite`) | Home, career hub and garage never count; covered state comes from a `ResizeObserver` on the panel (no layout reads per frame); closing the panel restores 30 fps and AO/bloom on the next frame |
| 2026-11-27 | Near-chunk prop shadows: the per-model prop meshes of near detailed chunks no longer cast; per-model 128 m sub-cell `ShadowCaster`s (sharing the matrices) cast instead and draw only for the sun's shadow frustum, so the shadow camera culls them per cell. Headless preview, High: triangles per frame alpine 2.96 M → 2.37 M, Giau 3.26 M → 2.92 M, Tourmalet 1.16 M → 1.12 M; draw calls +10 to +20; frame time within the noise of the shared laptop | `src/world/terrain.ts` (`buildMesh`, `ShadowCaster`, `updateShadowFlags`) | Which chunks cast is unchanged (near, within 260 m); the shadow frustum test is exact, so the shadow map is the same. Main pass unchanged (same meshes, instance order sorted by cell; tints follow the prop index). Matrices stay static (`matrixAutoUpdate = false`) |
