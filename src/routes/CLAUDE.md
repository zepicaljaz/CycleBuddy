# src/routes: roads

A route is a closed loop. It is either **generated** (a list of sections: length, grades,
style) or **real** (a traced OpenStreetMap line with the published profile, see
`real/CLAUDE.md`). `Route` samples either one every 2 m (`ROUTE_DS`) and is what the
physics, AI, world and HUD read.

## What lives here
- `types.ts`: `RouteDef`, `SectionDef`, `SectionStyle` (straight, winding, hairpins, traced), `ClimbDef`, `TrackDef`, `DemGrid`, scenery and towns.
- `route.ts`: `Route` (turtle path or `trackPath`, grades, loop closing, climbs, reverse travel), `getRoute` (cached by id), `routeStarts`, `riddenClimbs`, `excerptRoute`.
- `sections.ts`: section helpers: `climb`, `profile`, `steady`, `level`, `rolling`, `descent`, `lakeside`; styles `bend`, `winding`, `hairpins`, `larchBends`.
- `grades.ts`: km pieces to 100 m grade steps (`kmPieces`, `piecesToGrades`, `piecesGain`).
- `definitions.ts`: the hand-written loops plus `...CAREER_WORLDS` = `ROUTES`; `getRouteDef` falls back to `ROUTES[0]` for an unknown id.
- `moreWorlds.ts`, `careerWorlds.ts`: spec-built worlds and career worlds, with `STAGE_SEGMENTS` (stretches of a world used as stages).
- `regions.ts`: the six Free ride landscapes, `REAL_RIDE` category, `climbHairpinFence` (stone or metal by landscape).
- `validate.ts`: `routeDefProblems`, run by `getRoute` (throws on a broken def).
- `real/`: real climbs, stages and real roads. Own CLAUDE.md.

## Rules
- Every route is a loop. `buildGrades` closes the elevation by scaling descents, or the non-climb ascents, so a designed climb keeps its exact profile.
- Trainer limit: every sample stays under 16 % (`route.test.ts`). Descents are capped at -15.2 % when scaled.
- At most 255 sections (section index is a `Uint8Array`). Grades within ±30 %.
- `ClimbDef.inspiredBy` says in plain words what a climb is modelled on. Never a race trademark as a name.
- Real climb gradients come only from published profiles with sources (`real/`). Generated loops are fictional; don't put a real climb's name on one.
- `Route.sample(s, out)` and `place(s, lateral, out)` take an `out` object. In per-frame or per-step code pass a reused one; don't allocate. See `docs/PERFORMANCE.md`.

## Add a Free ride loop
1. Write the `RouteDef` in `definitions.ts` (or a spec in `moreWorlds.ts`): unique `id`, `seed`, sections, climbs (section ranges), scenery, towns.
2. Add the id to exactly one landscape in `regions.ts` (`RIDE_REGIONS`). `route.test.ts` fails if a loop is in none or two.
3. Add `public/route-previews/<id>.jpg` (400×225). `tests/conventions.test.js` fails without it.
4. Add new files to the README map. Run `npx vitest run src/routes/route.test.ts`.

## Add a career stage
1. A stage is a stretch of one world: add a `StageSegment` (`STAGE_SEGMENTS` in `careerWorlds.ts`, or `segments` of a `moreWorlds.ts` spec) with `from`/`to` = section indices of that world, `kind` road or tt, `finish`.
2. Career worlds are in `ROUTES` too, so a new world also needs a landscape in `regions.ts` and a preview still.
3. Point a calendar stage at the segment id in `src/career/calendar.ts` (`segmentById` throws on an unknown id). Run `npx vitest run src/career/career.test.ts src/routes/route.test.ts`.

## Tests
- `npx vitest run src/routes/route.test.ts`: every loop in `ROUTES`: length 12–90 km, closes in position and elevation, under 16 %, climbs match their sections (±6 %), 5 distinct start points, reversible, never folds or crosses itself, roads above water, every loop in exactly one landscape.
- Real roads: `npx vitest run src/routes/real` (see `real/CLAUDE.md`).

## Traps
- `getRoute` caches by `def.id` forever. Two defs with the same id get the first one's `Route`. Tests that tweak a def must change its id or build `new Route(def)`.
- `route.test.ts` builds every loop, so it is slow. Run it once you're done, not on every edit.
- Changing a shared helper in `sections.ts` or the closing logic in `route.ts` moves every loop; the preview stills in `public/route-previews/` then no longer match. There is no script that renders them (`renderRoutePreview` in `src/world/routePreview.ts` has no caller).
