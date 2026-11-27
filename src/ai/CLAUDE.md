# src/ai: the peloton and race AI

Every AI rider, in every mode. Free ride bunches, hill-climb races, time trials and Career / Pro race road stages all run through one class, `RideSim`.

## What lives here
- `peloton.ts`: `RideSim`, the whole field. `step(dt, power, cadence)` moves everyone; `simulateToEnd()` fast-forwards the AI after the player stops. Drafting, lanes and packs (free rides), finish and time-trial clocks.
- `road.ts`: road races only. `decideRoad` (each rider's move), `shapeRoad` (group speeds, the chase, the break), team orders, wind slots and stamina, KOM/sprint points (`awardRoadFeatures`), finish times per group (`sealGroupTimes`), terrain W/kg (`terrainWkg`, `paceWkgAt`, crest table).
- `raceBrain.ts`: shared race state per field (`brainFor`): the early break, chase director, surge reserve, sprint and kick power, day form, descending skill. Mostly pure maths.
- `powerMeter.ts`: each rider's W/kg read from how they actually move, smoothed like a head unit. Feeds the rider tag.
- `climbers.ts`, `names.ts`: hill-climb fields and W/kg spread; nations, names and team kits.
- `raceMeasure.ts`: headless measuring tool for Career stages. Changes nothing in the game.

How the racing is meant to look, and the tuning knobs: [docs/CAREER_RACING.md](../../docs/CAREER_RACING.md). How to measure it: [docs/RACE_MEASURING.md](../../docs/RACE_MEASURING.md).

## The hot path: what runs every physics step
`game/session.ts` calls `sim.step(h, ...)` in substeps of at most 0.05 s, then `meter.update(...)`. That is 20+ calls a second per ride, and many more while the tab is hidden and catching up, or in `simulateToEnd` (0.5 s steps until everyone finishes). A Career field is up to 176 riders.

Per step, `RideSim.step` does: sort `order`, `indexFrame()` (lanes and packs for open-road modes; wind slots, protected riders and climb peers for road races), `computeDrafting()`, power smoothing, `updateWBal`, `stepSpeed` per rider, then for road races `shapeRoad`, `formRoadPack`, `awardRoadFeatures`, `sealGroupTimes`. `decide(r)` / `decideRoad` run per rider only every 0.8–1.2 s (`decisionTimer`).

Rules for anything in that path (also see [docs/PERFORMANCE.md](../../docs/PERFORMANCE.md)):
- No O(n²) over the field. Use the sorted `order` (road drafting breaks out at 14 m) or `eachNear` (free rides). A new "who is near me" rule goes through those, not a `racers.filter` inside a per-rider loop.
- No per-step string building or hashing. Template strings for keys, `hash01(...)` and event text belong in once-per-race caches or behind a rare branch. Events go through `note()` (capped at 12).
- Cache per race what does not change in a race: ratings, team bests, crests, the brain. The existing pattern is a `WeakMap` keyed by the field array or the `RoadPlan` (`brainFor`, `crests`, `teamBestCache`), or a field on `RaceBrain` (`peers`, `finaleAlong`).
- Reuse scratch arrays (`rolledScratch`) instead of allocating per substep. Don't add new per-step `filter`/`map`/object literals.
- Determinism: all randomness comes from `mulberry32(seed)` / the brain's `rng`. Never `Math.random()`. The same seed must give the same race (raceMeasure and tests rely on it).

## Common jobs
Change how a road race is raced:
1. Read the matching section of `docs/CAREER_RACING.md` and the "Tuning knobs" table.
2. Measure before: `MEASURE=1 npx vitest run src/ai/raceMeasure.test.ts` (a few minutes; `MEASURE_STAGE=south-week:1` for one stage). Keep the output.
3. Make the change; keep pure maths in `raceBrain.ts` with a unit test.
4. Measure after with the same seeds and compare. Update the numbers in `docs/RACE_MEASURING.md` and the doc section you changed.

Add a per-race lookup: put it on `RaceBrain` or in a `WeakMap` keyed by the field / plan, fill it lazily on first use, never per step.

## Tests
- `npx vitest run src/ai/peloton.test.ts`: hill-climb races, time-trial ramp, and "neighbour lookups match the full scan" (guards `eachNear` against the O(n²) version).
- `npx vitest run src/ai/raceBrain.test.ts src/ai/terrain.test.ts`: reserve, break pace, sprint, chase, day form, descents, terrain W/kg, over the top.
- `npx vitest run src/ai/powerMeter.test.ts src/ai/climbers.test.ts`
- `npx vitest run src/ai/raceMeasure.test.ts`: quick checks only; the full ride needs `MEASURE=1`.
- Career results built on this: `npx vitest run src/career/career.test.ts`.

## Traps
- `teamBestCache` is keyed by the field array, but `indexFrame` passes a fresh `racers.filter(...)` array every step, so it is rebuilt once per step, not once per race (`road.ts` ~350, `peloton.ts` ~1006). `shapeRoad` also calls `teamTempoRank` uncached every step.
- `descentSkill()` hashes a new string on every call and `shapeRoad` calls it per attacking rider per step on descents. `packKey()` builds a string per rider per step in free rides. Known cost; don't copy the pattern.
- `brainFor` keys on the array you pass. Pass `sim.racers` (the same array every step), or each call gets a new brain and the race state resets.
- `decideRoad` runs on a timer, not every step: logic that must react within one step belongs in `shapeRoad`.
- Indexes into `PowerMeter` are positions in `sim.racers`; don't reorder that array (sort `order`, not `racers`).
- `simulateToEnd` parks the player and sets `fastForward`, so teammates stop waiting. Test fast-forward paths too (`career.test.ts` → "career fast-forward").
