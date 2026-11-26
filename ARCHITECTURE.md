# Architecture

TypeScript + Vite, Three.js for the world, a small Node server for accounts. No framework: screens are HTML strings rendered by `game/app.ts`.

## Folders

File-by-file map: `README.md` → Where everything is.


| Folder | What it does |
|---|---|
| `ble/` | Web Bluetooth: FTMS and FE-C trainers, heart rate, a virtual trainer. Write queue, reconnects, control-point replies |
| `physics/` | Rider speed from power, grade, mass, drag and drafting (`steadySpeed` solves it directly) |
| `routes/` | Roads. A route is a closed loop of sections (length + grades + a style: bends, hairpins or a traced shape). `route.ts` samples it every 2 m, smooths the grade, closes the loop and finds the climbs. `validate.ts` rejects broken definitions |
| `routes/real/` | Real climbs and stages: data (`climbs.json`, `stages.json`), checks (`data.ts`) and the builders (`build.ts`: exact km pieces, real hairpin counts, a stage laid out km by km) |
| `routes/real/tracks/`, `assets/terrain/` | Real roads (Vršič, Alpe d'Huez, Stelvio from Prato, Mont Ventoux from Bédoin, Tourmalet from Luz, Angliru from La Vega, Galibier from Valloire, Passo Giau from Selva, Krvavec, Col de la Madeleine from La Chambre): OSM line + profile per point, and height grids loaded on ride start (`routes/real/terrain.ts`). The Madeleine also has a 10 m tree-cover grid (`<id>.cover.bin`, ESA WorldCover) that decides where trees grow (`TerrainField.coverAt`). Built by `scripts/real-track/`; see `docs/REAL_ROADS.md` |
| `ai/` | The peloton: pacing, drafting, lanes, attacks, road-race plans (`road.ts`) |
| `career/` | Calendar, teams, riders, season state, simulated races, classifications, jerseys |
| `game/` | `app.ts` (screens and the ride loop), `session.ts` (one ride), recorder, coins, the pro-race builder (`quickRace.ts`) and its page (`proRaceView.ts`), the home menu (`homeView.ts`) |
| `world/` | The 3D world: terrain chunks in a worker, instanced riders and props, traffic, climb furniture (`climbs.ts`), graphics presets and post-processing |
| `ui/` | HUD, minimap, profile charts, the roadbook profile (`roadbook.ts`), the road-ahead panel (`roadAhead.ts`), menu styles (`menus.css`) |
| `audio/` | Sound: wind and freewheel made from noise and tied to speed; crowds, horn, summit sting and music from `assets/audio` (loaded after the first click) |
| `storage/` | IndexedDB (versioned, memory fallback), FIT import/export, account sync |
| `analytics/` | The Analytics page (dashboard, all rides, segment analyzer, calendar). Loaded on first open |
| `training/` | Training plans, workouts, FTP test |
| `site/` | The public homepage and sign-in |
| `server/` | Node http server: accounts (scrypt), sessions, Google sign-in, rate limits, profile + ride sync, static files |

## A ride

`app.startRide(mode)` builds a `RideSession` (route, climb, AI field, optional career/pro-race plan). Each frame `advanceSession` steps it in 0.1 s chunks (a hidden tab keeps going on a timer), the world draws the riders, and every 100 ms the HUD and road-ahead panel update. The trainer gets the felt grade (scaled by trainer difficulty) or the ERG target.

## Pro race

`quickRace.launchQuickRace` builds a career-shaped launch with no career state: the stage route, a start moved back by the chosen length (never halfway up a climb), a field from the career rosters, KOM and sprint points, and the bunch's W/kg from the difficulty. `app.quickRide` stops it from writing career results.
