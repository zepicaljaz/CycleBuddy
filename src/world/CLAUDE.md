# src/world: the 3D world

Everything drawn in a ride or behind the menus. Three.js, low-poly, vertex colours. Keep it that way: the look is cheap on CPU and GPU on purpose. Per-frame cost rules: `docs/PERFORMANCE.md`.

## What lives here
- `world.ts`: owns the scene, camera modes and `World.update()` (the per-frame entry). `dispose()` / `disposeObject()` free GPU memory but keep `SHARED_MATERIALS`.
- `graphics.ts`: renderer, `QUALITY` presets (low/medium/high/ultra, incl. terrain distances), post-processing, dynamic resolution while riding, the auto quality step-down below the chosen preset (AO off → shadow map 2048 → bloom off, only while riding, never above the preset), and `lite` (AO and bloom out of the chain behind a covering menu panel). It also owns the sun's shadow map size (`setQuality(settings, sun)`). One `Graphics` is reused across worlds.
- `terrainField.ts`: the height field (generated, or real DEM grids on real roads), road cut/bank, lakes, pads, clearings, `ROAD_HALF_WIDTH`.
- `terrain.ts` (`TerrainManager`), `terrainChunk.ts` (`ChunkBuilder`), `terrainWorker.ts`: tiles built in 2–3 workers with LOD and trees; buffers are transferred back. Near detailed chunks draw props per model (`byModel`) with `castShadow` off, and cast shadows through `ShadowCaster` sub-cells (128 m, sharing the matrices) that only the sun's shadow frustum sees.
  - Prop types (worker → `propGeomsFor` slot): 0 conifer, 1 broadleaf, 2 boulder, 3 scrub (`mugo`), 4 cliff face (`PROP_CLIFF`), 5 scree patch (`PROP_SCREE`). 2/4/5 draw with `rockMaterial` (no wind sway, grey tints × `ROCK_TINT`) but are ordinary `byModel` entries, so they share the sub-cell shadows and the frozen matrices. Cliffs and scree exist only on real roads with land cover and only as Blender models (no fallback). Placement rules: `docs/REAL_ROADS.md` → "Land cover at runtime".
  - Per-road hints from `climbs.json`: `scenery.rockTone` (ground rock colours via `paletteFor`, prop tint) and `scenery.trees` (model names for slots 0/1). Source them in the climb's `sceneryNote`.
- `materials.ts`: `MatKind` (matte, rough, gloss, satin, paint, carpaint, metal, chrome, glass, glow, rubber, cloth, foliage, ground, marks), `material(kind)` cache, `Part` / `Model` (geometry + surface + optional tint slot).
- `geometry.ts`: builders (`paint`, `colored`, `merge`, `loft`, `sweep`, `tube`, `placement`...) and detail levels: `Detail` 0/1/2, `atDetail()`, `q(close, mid)`.
- `batch.ts`: `prepare()` (merge a model per surface), `StaticBatch` (bake static things into one mesh per surface per map cell, cull by cell), `InstancedModel` (many copies, per-instance matrix + tint, `commit()` uploads only used slots).
- `props.ts`: `Props` = a `StaticBatch(240)` + tree clearings + animated updaters (only within `UPDATE_RANGE` 1500 m); shared prop models.
- `scenery.ts`, `site.ts`, `settlement.ts`, `buildings.ts`: roadside, towns and the `Site` placement helper (`at`, `ground`, `free`, `occupy`, `solid`).
- `climbs.ts`, `fences.ts`, `spectators.ts`: climb furniture, hairpin fences, crowds.
- `riders.ts`, `riderBody.ts`, `bikes.ts`, `riderPick.ts`: instanced riders with three detail levels; mouse picking without raycasts.
  - `riderHead.ts`: the head in its own frame (origin in the cranium, +x to the face), placed by `riderBody.ts` with `HEAD` and `HEAD_TILT`. The skin is a loft of horizontal sections (two half superellipses each); above the brow they are one egg, `CRANIUM`, and the helmet's inner surface is that egg grown by `PAD`, so the shell fits the hair by construction. Nose, brow, eye sockets, cheekbones, lips and chin are reliefs on the sections (`relief`). Hair is a shell over the skin down to a hairline by angle. Straps, the cradle and the glasses' arms are laid on the skin through `headPoint`/`headNormal` (and `jawUnderside` under the chin). The helmet is a four-sided patch (brow edge, back edge, the two sides over the ears) on angles round the cranium; vents are whole grid cells, sunk to a dark floor with walls. Close up: 40 columns, ears, vents, straps, cradle, glasses frame and arms. Mid: the three big vent pairs only. Far: shell, lens band, skin. Surfaces: shell `satin` with the helmet tint, liner/hair/straps `matte`, frame `gloss`, lens `glass`.
- Landmarks: `alpineHotel.ts`, `modernHotel.ts`, `alpineRestaurant.ts`, `ventouxAntenna.ts`, `island.ts`, `mappedPlaces.ts` (OSM lakes, car parks), `landmarks.ts` (OSM-mapped Russian Chapel, mountain huts, wayside shrines and crosses on the real roads; Blender models).
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

A real landmark that OpenStreetMap maps (hut, chapel, shrine) goes through `landmarks.ts` instead, no new placer:
1. Make the model in `scripts/blender/landmarks.py` (rules in `scripts/blender/CLAUDE.md`) and add its name to `PROP_MODELS.landmarks` and its size to `LANDMARK_MODELS`.
2. Teach `classify()` in `scripts/real-track/landmarks.mjs` the OSM tags (and the road in `TRACKS`), run it with `--fetch` once, then without; it writes `src/routes/real/landmarks.json` with the OSM id as the source.
3. `placeMappedLandmarks` (called from `buildScenery` after the hand-placed buildings) seats it at the mapped point: outline angle and size from OSM, front/door toward the road, moved straight away from the road only to clear the verge (`MAX_SHIFT`), skipped where `site.free` says something is built, terrace pad cut at most `MAX_CUT` deep. `src/world/landmarks.test.ts` checks source, distance and clearance per road.
4. Landmarks need the prop models (`preloadPropAssets`): rides and `?scene=road` have them, the home page and route previews do not, and simply show no landmarks.

## Dev preview
`npm run dev:local`, then `/preview.html?scene=<name>`: riders, cars, buildings, farm, spectators, fences, hotel, modern, restaurant, waterfront. `?scene=world&route=<id>&q=ultra&time=noon&cam=chase&riders=6` loads a whole world. `&still` pauses.

## Tests
- `npx vitest run src/world/terrainField.test.ts` (road sits on terrain, lakes, tree seating, hairpin banks per real road; slow-ish)
- `npx vitest run src/world/terrainCover.test.ts src/routes/real/sceneryHints.test.ts` (land cover: colours, props by class, cliffs face downhill and keep off the road, scree only on scree, dwarf pine above the treeline, hints valid and sourced; pins roads without cover)
- `npx vitest run src/world/landmarks.test.ts src/world/propAssets.test.ts` (mapped landmarks: sources, placement, model budgets; ~2 min)
- `npx vitest run src/world/climbs.test.ts src/world/fences.test.ts src/world/traffic.test.ts src/world/convoy.test.ts src/world/riderPick.test.ts`
- `npx vitest run src/world/riderHead.test.ts` (head: triangle budgets, outward faces, no flipped shell face, helmet clears skull/hair/ears and sits close, lens off the face, glasses touch the nose and the head, straps on the skin with their tops under the shell; under a second)
- Rendering has no tests: look at it in the preview, and check `/play?perf` (fps, draw calls, triangles) for perf work.

## Quality and shadows (perf)
- The chosen preset is the ceiling. While riding, once dynamic resolution is at its floor and frames stay over 20 ms for 3 s, `Graphics` drops AO, then the 4096² shadow map to 2048², then bloom; after 10 s keeping up it brings them back in reverse, before resolution. A step up that falls back within 8 s blocks the next try for 2 minutes. `?perf` shows the level on the `quality` line.
- Menus behind a big glass panel (career, settings, plans, analytics on a laptop) draw at 10 fps with `graphics.lite` (AO and bloom out). App decides it from the panel size (`updateMenuCover`); no panel is opaque, so it never stops drawing.
- Shadows: a new kind of static prop that casts shadows should get bounds no bigger than ~128 m (or go through `ShadowCaster`), or the shadow pass draws all of it wherever the shadow camera is. Set the sun's shadow map size through `Graphics.setQuality`, not on the light.
- Dev preview: `&adaptive` turns on dynamic resolution and the step-down as in a ride; `&perf` adds the overlay.

## Traps
- `ShadowCaster` draws only when the frustum is the one in `terrain.shadowView` (World sets it to `sun.shadow.getFrustum()`). A new world or a replaced sun must set it again, or near props lose their shadows.
- The main thread and every worker build their own `TerrainField` from the same `FieldInput`. `World` creates the main field first, `buildScenery` then sets clearings and pads on it (`setClearings`, `setPads`) and copies them into `input` before `TerrainManager` starts the workers. Anything new that changes heights must reach both, or trees and buildings sit on a different ground than the one drawn.
- `StaticBatch` stores positions cell-local (float precision far from the origin) and files a model by its matrix translation. For world-space geometry use `Props.addWorld()`, which recentres it first.
- `models.ts` and `geometry.ts` both export `colored()`; the `models.ts` one has its own `merge` that does not skip empty parts.
- `InstancedModel` defaults to `frustumCulled = false`; call `finalize()` for static instances so they cull.
- The helmet is fitted to `CRANIUM` in `riderHead.ts`, and the face table joins it at the brow. Change the skull, `PAD`, the rim heights (`RIM_Y`), the face sections above the ears, or move straps or glasses, and run `riderHead.test.ts`: it checks the shell clears the hair and ears at every detail level and the straps and glasses sit on the skin.
