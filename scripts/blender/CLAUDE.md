# scripts/blender: low-poly tree and rock models

Python scripts that build the game's region-specific trees and rocks in Blender and
export one small GLB per model to `src/assets/models/`. The game loads them on ride
start (`src/world/propAssets.ts`) and falls back to the code-built props in
`src/world/models.ts` when a model is missing. Same low-poly, flat-shaded look as the
rest of the world: crisp facets, one colour per face, no textures.

## Run

Blender 5.3 CLI, headless, from the repo root. No Blender MCP, no paid or AI 3D generation.

```
blender -b --factory-startup --python scripts/blender/trees.py -- [--preview DIR] [name ...]
blender -b --factory-startup --python scripts/blender/rocks.py -- [--preview DIR] [name ...]
blender -b --factory-startup --python scripts/blender/landmarks.py -- [--preview DIR] [name ...]
```

- No names = every model in that script. Each run prints triangles, KB and size per model.
- `--preview DIR` renders Workbench sheets (vertex colours, white background):
  `trees.png`, `trees_far.png`, `trees_small.png` (about the size a tree is at 30 m),
  `rocks_boulders.png`, `rocks_scree.png`, `rocks_cliffs.png`. Look at them before
  committing a change.
- Output is deterministic: every model has a fixed seed, so rebuilding unchanged code
  gives the same files. Commit the GLBs with the script change.
- Then `npx vitest run src/world/propAssets.test.ts`.

## Files

| File | What |
|---|---|
| `common.py` | `Model` (verts + faces with one linear colour per face), primitives (`frustum`, `star_cone`, `blob`, `lathe`, `hull`), `xform`, GLB export, preview sheets |
| `trees.py` | One function per species, `far=True` gives the far version |
| `rocks.py` | Boulders (sliced-box convex hulls), scree patches, cliff faces |
| `landmarks.py` | Russian Chapel, two mountain huts, wayside shrine and cross: boxes, gable/hip prisms, lathed onion domes. Preview `landmarks.png` (front) and `landmarks_turned.png` (back, from above) |

## Models

| Name | Tris (near / far) | Size at scale 1 | What it is |
|---|---|---|---|
| `spruce_a` | 202 / 72 | 10.5 m, 5.1 m wide | Norway spruce, eight dense dark drooping tiers, branch tips to the ground |
| `spruce_b` | 170 / 72 | 11.6 m, 3.4 m wide | Narrow high-altitude spruce, green from 0.65 m |
| `larch` | 170 / 72 | 10.4 m, 4.4 m wide | Light yellow-green whorls from 1.2 m, a little trunk between them |
| `mugo` | 160 / 60 | 1.9 m tall, 3.5 m wide | Dwarf mountain pine mound (scrub) |
| `scots_pine` | 156 / 76 | 11.1 m | Orange upper trunk, layered lopsided crown over the upper half (from ~5.5 m) |
| `aleppo_pine` | 128 / 32 | 8.9 m, 9 m wide | Mediterranean umbrella pine |
| `cypress` | 106 / 30 | 11.2 m, 2 m wide | Italian columnar cypress |
| `beech` | 168 / 68 | 11.6 m | Grey trunk, fresh-green crown from ~3 m, widest low down |
| `holm_oak` | 110 / 48 | 7.5 m, 7.7 m wide | Dense round dark-olive crown |
| `boulder_a`..`e` | 32-46 | 1.4-3.1 m | Angular limestone / granite: block, slab, shard, split, chunky |
| `scree_patch_a`, `_b` | 144 | 5.5-6 m across, 0.4 m tall | 12 small flat stones as one mesh |
| `cliff_face_a`, `_b`, `_c` | 84 / 112 / 72 | 14x10, 18x14, 11x8 m | Rock face with ledges (green tops), ribs, ragged top |

| `ruska_kapelica` | 429 | 9.5 x 6.3 m, 13.5 m to the cross | Russian Chapel on Vršič: dark log walls on a stone plinth, steep grey shingle roof, octagonal drum + big onion dome, porch tower + small dome; door end at +X |
| `mountain_hut_a` | 242 | 11.8 x 9.8 m, 10.4 m | Small hut: stone ground floor, board upper floor, steep gable, front balcony (+Z), green shutters |
| `mountain_hut_b` | 430 | 18.4 x 14.7 m, 13.2 m | Big dom/refuge: two stone storeys, board top floor, hipped roof, front terrace, lean-to at -X |
| `wayside_shrine` | 68 | 1.9 x 2 m, 4.2 m | Whitewashed kapelica, blue niche facing +Z, gable toward the road |
| `wayside_cross` | 58 | 1.7 x 0.9 m, 4.2 m | Wooden crucifix with a little roof, on a stone foot |

## Landmarks

- One copy each per road, so the budget is richer than for props: chapel <= 1,500
  triangles, huts <= 800, wayside pieces <= 200, files under 64 KB (checked by
  `propAssets.test.ts`, families `chapel`, `hut`, `wayside`).
- Walls go 0.6 m (wayside 0.4 m) below z = 0, so the game can seat a building on its
  lowest corner and the downhill side is bedded in. Everything else on z >= 0.
- Front (balcony, door, niche) faces Blender -Y = three.js +Z; the long axis is X. The
  chapel's door is at +X. `src/world/landmarks.ts` matches X to the OSM outline's long
  axis and turns the front (or door end) toward the road, and scales huts to the outline
  (0.75-1.5 per axis), so keep huts near their nominal 10 x 7.4 / 14 x 10 m walls. If a
  model's size changes, update `LANDMARK_MODELS` there (a test compares them).
- Colours: weathered wood 0x4b3727 / 0x6b4c32, grey shingle 0x6c6964, dark domes
  0x3b3734, stone 0x9a948a.

## Rules

- **Canopies reach low** (playtest, Nov 2026: "the crowns sit too high"). Spruce is green
  to the ground, larch from ~1.2 m, beech from ~3 m, Scots pine over the upper half. A
  long bare trunk reads as a lollipop from the saddle. The code-built fallbacks in
  `models.ts` (home page, previews) follow the same rule.

- **Budgets** (checked by `src/world/propAssets.test.ts`): trees 100-300 triangles and a
  `<name>_far` at most half of that (aim for 40 %); boulders, scree and cliffs 30-150;
  every file under 30 KB. About 100 bytes per triangle, so 300 triangles is the ceiling.
- **Naming**: lower snake case, `family_variant` (`boulder_c`, `cliff_face_b`), far
  versions `<name>_far`. The file name is the name the game asks for.
- **Axes and origin**: build in Blender Z up, metres, origin at the ground centre, base
  on z = 0. The exporter writes +Y up. Cliff fronts face Blender -Y = three.js +Z.
- **Colours**: write sRGB hex like `models.ts` and convert with `common.hex_rgb` (stored
  linear, which is what glTF COLOR_0 and three.js `Color(hex)` both use). Take greens and
  greys from the existing palettes (`models.ts`, `terrainChunk.ts` PALETTES) so new props
  sit with the ground. One colour per face; variation comes from a small per-face jitter
  (5-7 %) and lighting by normal (tops lighter, undersides darker), never from noise
  textures. Moor trees stay olive-dark (a bright crown reads as a different green than the
  moor grass).
- **Only POSITION, NORMAL, COLOR_0** in the GLB: no UVs, no materials, no textures.
  Blender's exporter only quantises through Draco or meshopt, which need a decoder in the
  game; at about 10 KB a model that is not worth it (meshopt took spruce_a from 16 to
  10 KB), so the files are plain.
- **Winding**: three.js culls back faces. `Model.add` warns about inward faces for parts
  that are convex around their centre; pass `check=False` only for parts that are not
  (drooping tiers, cliff grids). Previews render with backface culling on, so a hole shows.
- **Far versions** keep the silhouette and colour (what reads at a distance) and drop
  detail: fewer tiers, fewer segments, no limbs. Nothing may float: if limbs go, the
  trunk must reach the crown.

## In the game

- `src/world/propAssets.ts`: `preloadPropAssets()` loads every GLB once (GLTFLoader is a
  dynamic import, each GLB a separate hashed asset, nothing in the boot chunk) and never
  rejects; failures are logged once. `propAsset(name, far?)` returns the geometry
  (non-indexed `position`, `normal`, `color`, Float32, like `models.ts`) or null; with
  `far` it returns `<name>_far`, else the near one. `PROP_MODELS` lists names by family.
- Awaited in `src/game/app.ts` next to `loadRouteTerrain` before the ride's `World` is
  built. Worlds built without it (home page, route previews) use the code-built props.
- `src/world/terrain.ts` `propGeomsFor`: per biome, each prop slot (0 conifer,
  1 broadleaf, 2 rock) is a list of models; a prop picks one by its position. Near chunks
  use the near models, far chunks `_far`. A slot falls back to the code-built prop only
  when none of its models loaded.
  - alpine: spruce_a x2, spruce_b, larch / beech / boulders a-e
  - limestone: spruce_a, larch, scots_pine / beech / boulders
  - spruce: spruce_a x2, spruce_b / (same) / boulders
  - moor: code-built olive shrub / holm_oak / boulders
  - desert: unchanged (code-built shrub, cactus, warm rock)
  - every biome but desert also has slot 3 `mugo` (land-cover scrub, and forest above
    the treeline), slot 4 `cliff_face_a-c` and slot 5 `scree_patch_a/b` (land-cover
    cliffs and scree on real roads, no code-built fallback).
  - a road's `scenery.trees` hint (climbs.json) replaces slots 0/1 by name, e.g. Ventoux
    holm_oak/beech + larch/spruce_b.
- Cliffs and scree (and boulders) draw with a plain `rockMaterial` in `terrain.ts`, not
  the wind-sway prop material (sway grows with height above 2 m and would bend a 14 m
  cliff). Cliffs face +Z and the worker turns each so +Z points downhill.
- Not placed yet: `aleppo_pine`, `cypress` (no sourced road wants them yet).
- Mediterranean limestone worlds (Tuscany, Sicily, Catalonia, Andalusia, Corsica) share
  the biome with Vršič, Giau and Ventoux, so they get the alpine set for now. A scenery
  flag (for example `flora: 'mediterranean'`) could switch them to aleppo_pine, cypress
  and holm_oak.
