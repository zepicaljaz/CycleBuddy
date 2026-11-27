# scripts/real-track: the real-road builder

Offline Node scripts that turn an OpenStreetMap road + a published climb profile + open
elevation data into a 1:1 road for the game. The game only reads the output, so a real road
costs no more to ride than a generated one. Full method, per-road choices and the hairpin
ground rules: `docs/REAL_ROADS.md`.

## What lives here
- `build.mjs`: the builder. `CONFIGS` holds one entry per road (`vrsic`, `alpe`, `stelvio`, `angliru`, `tourmalet`, `ventoux`, `galibier`, `giau`, `krvavec`).
- `dem.mjs`: Terrain Tiles (Terrarium PNG) download, a small PNG decoder, and a bilinear lat/lon sampler.

## Inputs and outputs
- In: `data/osm/<road>.json` (Overpass, `out geom tags`; also `*-places.json` for lakes and parking, `*-landcover.json` for meadows and woods), the climb in `data/real-climbs.research.json` (profile in `source_segments`, `sources`), elevation tiles from `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/` cached in `data/dem-cache/` (gitignored).
- Out: `src/routes/real/tracks/<id>.json` and `src/assets/terrain/<id>.bin`. Format in `src/routes/real/CLAUDE.md`.

## Rebuild a road
1. `node scripts/real-track/build.mjs <key>` (key from `CONFIGS`, e.g. `vrsic`). The first run downloads tiles; later runs use the cache.
2. Read the printed checks: climb length on OSM vs published (aim within ~2 %), road start and summit elevation, DEM error along the climb, balloon closure error at top and bottom, hairpins found vs published.
3. `LENGTH_ONLY=1 node scripts/real-track/build.mjs <key>` prints only the climb length, for quick tuning of `from`/`to`/`climbStart`.
4. Run `npx vitest run src/routes/real/track.test.ts src/routes/real/data.test.ts`.
5. `npm run track-index` if the road's length or climbing changed (`trackIndex.test.ts` says so).
6. Commit the track JSON, `.bin` and `trackIndex.json` together. Never hand-edit the track or `.bin`.

## Add a new road
1. The climb must exist in `data/real-climbs.research.json` and in `src/routes/real/climbs.json` (same id), with published sources.
2. Fetch the OSM ways into `data/osm/<name>.json`.
3. Add a config: `id`/`climbId`, `osm`, `from`/`to` points, `climbStartWay` (way name) or `climbStart` (coordinate), `summit` (a `mountain_pass` node), elevations, `hairpins` 'up' or 'down', `towns` (metres from the valley end), optional `leadIn`, `climbFromSection`, `places`, `cover`, `minRadius`.
4. Build, check, then add a `describe` for it in `src/routes/real/track.test.ts`.
5. `npm run track-index` (regenerates `src/routes/real/trackIndex.json`; `trackIndex.test.ts` fails without it). The game finds the road by its file name; tracks load on demand.
6. Add the road to `ATTRIBUTION.md` and a section to `docs/REAL_ROADS.md`.

## Rules
- Road elevation comes from the published profile, never from the terrain tiles (30 m data is off by ~13–16 m along hairpin roads and makes fake ramps). Terrain data is only for the mountains and the valley run-in.
- Every data source gets a credit in `ATTRIBUTION.md`. Track files are ODbL-derived; the credit line in `track.source` is built by `creditLine()`.
- Hairpins: the ground must stay a slope (no wall, fin or hole). See `docs/REAL_ROADS.md` → "Hairpins and the ground mesh".
- Don't commit `data/dem-cache/`; `tests/conventions.test.js` fails on it.

Land cover: see docs/REAL_ROADS.md → Land cover (added Nov 2026)

## Traps
- `minRadius` defaults to 7 m (bends tighter than that are widened). Some roads set `0` to keep bends as mapped; changing it changes the length and hairpin count.
- `from` and `to` must be exact way end nodes in the OSM file; the path search joins ways only at shared end points (`no road between from and to` otherwise).
- OSM land cover tagged `source=CORINE` is skipped on purpose; only polygons within 400 m of the road are kept.
- Heights are written as unsigned decimetres: below 0 m clamps to 0.
- The script is heavy (1 m resampling, large grids). Run one road at a time.
