# src/world: the 3D world

Everything drawn in a ride or behind the menus. Three.js, low-poly, vertex colours. Keep it that way: the look is cheap on CPU and GPU on purpose. Per-frame cost rules: `docs/PERFORMANCE.md`.

## What lives here
- `world.ts`: owns the scene, camera modes and `World.update()` (the per-frame entry). `dispose()` / `disposeObject()` free GPU memory but keep `SHARED_MATERIALS`.
- `graphics.ts`: renderer, `QUALITY` presets (low/medium/high/ultra, incl. terrain distances), post-processing, dynamic resolution while riding. One `Graphics` is reused across worlds.
- `terrainField.ts`: the height field (generated, or real DEM grids on real roads), road cut/bank, lakes, pads, clearings, `ROAD_HALF_WIDTH`.
- `terrain.ts` (`TerrainManager`), `terrainChunk.ts` (`ChunkBuilder`), `terrainWorker.ts`: tiles built in 2–3 workers with LOD and trees; buffers are transferred back.
- `materials.ts`: `MatKind` (matte, rough, gloss, paint, carpaint, metal, chrome, glass, glow, rubber, cloth, foliage, ground, marks), `material(kind)` cache, `Part` / `Model` (geometry + surface + optional tint slot).
- `geometry.ts`: builders (`paint`, `colored`, `merge`, `loft`, `sweep`, `tube`, `placement`...) and detail levels: `Detail` 0/1/2, `atDetail()`, `q(close, mid)`.
- `batch.ts`: `prepare()` (merge a model per surface), `StaticBatch` (bake static things into one mesh per surface per map cell, cull by cell), `InstancedModel` (many copies, per-instance matrix + tint, `commit()` uploads only used slots).
- `props.ts`: `Props` = a `StaticBatch(240)` + tree clearings + animated updaters (only within `UPDATE_RANGE` 1500 m); shared prop models.
- `scenery.ts`, `site.ts`, `settlement.ts`, `buildings.ts`: roadside, towns and the `Site` placement helper (`at`, `ground`, `free`, `occupy`, `solid`).
- `climbs.ts`, `fences.ts`, `spectators.ts`: climb furniture, hairpin fences, crowds.
- `riders.ts`, `riderBody.ts`, `bikes.ts`, `riderPick.ts`: instanced riders with three detail levels; mouse picking without raycasts.
- Landmarks: `alpineHotel.ts`, `modernHotel.ts`, `alpineRestaurant.ts`, `ventouxAntenna.ts`, `island.ts`, `mappedPlaces.ts` (OSM lakes, car parks).
- Movers: `traffic.ts`, `cars.ts`, `convoy.ts`, `motorcycle.ts`, `motorhome.ts`, `tractor.ts`, `boats.ts`, `birds.ts`. `perf.ts` = the `?perf` overlay.

## Rules
- Per frame (`World.update` and everything it calls): no allocations. Reuse module-level scratch objects (`_v`, `_m`, `tmpPose`), no `new THREE.*`, no array literals, no closures, no string keys.
- Static things: bake into a `StaticBatch` / `Props.place()`, or set `matrixAutoUpdate = false` and call `updateMatrix()` once.
- Share materials: use `material(kind)`. A material you cache yourself at module level must go through `keepShared()`, or `World.dispose` destroys it and the next world recompiles it.
- Colour lives in vertex colours; per-instance colour goes in a `tint` slot (geometry white where tinted), not in a new material.
- Low poly: use `q(close, mid)` for segment counts so detail levels 1 and 2 come out cheaper.
- Animated props register `props.onUpdate(f, at)` with a position so they sleep out of range.
- Hairpins: the ground must stay a slope (no wall, fin or hole). Rules in `docs/REAL_ROADS.md` → "Hairpins and the ground mesh".

## Add a model
1. Build a `Model` (list of `Part`s) from `geometry.ts` helpers; one `MatKind` per part, `tint` for recolourable parts.
2. `prepare()` it once and cache the `Prepared` at module level (see `ventouxAntenna.ts` `built`).
3. Many moving copies: `InstancedModel`, set matrices, `count`, then `commit()` each frame. Static copies: `props.place(prepared, placement(...), tints)`.
4. Add a scene to `src/dev/preview.ts` and look at it.

## Add a landmark
1. Write `placeX(site)` that finds its climb by id (`site.route.climbs.find(...)`) and returns on every other route.
2. Pick a side with `site.ground`, place with `site.props.place`, then reserve space: `site.occupy` (no buildings/trees), `site.solid` (collision box), `site.props.clearing` (no trees).
3. A flat terrace needs a pad: `field.setPads(...)` (see `alpineHotel.ts`).
4. Call it from `buildScenery` in `scenery.ts`.

## Dev preview
`npm run dev:local`, then `/preview.html?scene=<name>`: riders, cars, buildings, farm, spectators, fences, hotel, modern, restaurant, waterfront. `?scene=world&route=<id>&q=ultra&time=noon&cam=chase&riders=6` loads a whole world. `&still` pauses.

## Tests
- `npx vitest run src/world/terrainField.test.ts` (road sits on terrain, lakes, tree seating, hairpin banks per real road; slow-ish)
- `npx vitest run src/world/climbs.test.ts src/world/fences.test.ts src/world/traffic.test.ts src/world/convoy.test.ts src/world/riderPick.test.ts`
- Rendering has no tests: look at it in the preview, and check `/play?perf` (fps, draw calls, triangles) for perf work.

## Traps
- The main thread and every worker build their own `TerrainField` from the same `FieldInput`. `World` creates the main field first, `buildScenery` then sets clearings and pads on it (`setClearings`, `setPads`) and copies them into `input` before `TerrainManager` starts the workers. Anything new that changes heights must reach both, or trees and buildings sit on a different ground than the one drawn.
- `StaticBatch` stores positions cell-local (float precision far from the origin) and files a model by its matrix translation. For world-space geometry use `Props.addWorld()`, which recentres it first.
- `models.ts` and `geometry.ts` both export `colored()`; the `models.ts` one has its own `merge` that does not skip empty parts.
- `InstancedModel` defaults to `frustumCulled = false`; call `finalize()` for static instances so they cull.
