# CycleBuddy

Indoor cycling in the browser. Connect a Bluetooth smart trainer (FTMS or Tacx FE-C) and a
heart-rate strap, and ride low-poly 3D roads that set the trainer's resistance from the
gradient. Free rides, hill-climb races, pro races on real stages, training plans in ERG, and
a career season with a team.

**Current version: 0.9.0** (see [Versions and releases](#versions-and-releases)). The home
screen shows the version and the git commit the running build came from, e.g. `v0.9.0 · 080da92`.

## Contents

1. [Run it](#run-it)
2. [What the game has](#what-the-game-has)
3. [Where everything is](#where-everything-is)
4. [How a ride works](#how-a-ride-works)
5. [Versions and releases](#versions-and-releases)
6. [Where it runs (Vercel)](#where-it-runs-vercel)
7. [Working on it](#working-on-it)
8. [Tests](#tests)
9. [Other docs](#other-docs)

---

## Run it

```bash
git pull                # always start from the latest GitHub version
npm install
npm run dev:local       # private local MongoDB (no Atlas needed) + Vite on http://localhost:5173
npm test                # vitest, all tests
npm run typecheck       # tsc only
npm run build           # tsc + production build into dist/
npm run smoke           # after a build: the production server serves the game
npm start               # production server (after a build)
```

| Script | What it runs |
|---|---|
| `dev:local` | `server/local.js`: a private MongoDB in `.localdb/`, the API on `127.0.0.1:8787`, Vite on `5173` |
| `dev` | `server/dev.js`: API + Vite against the database set in `.env` |
| `start` | `server/index.js` in production: API + the built `dist/` |

- **Browser:** Web Bluetooth needs Chrome or Edge. Without a trainer, click **Virtual** next to
  Trainer in the top bar: the arrow keys set your power.
- **Production settings:** `MONGODB_URI`, `MONGODB_DB`, `SESSION_SECRET`, the Google sign-in
  keys, and `TRUST_PROXY=1` behind a proxy. Template: `.env.example`. The real `.env` is never
  committed.
- **Local test account:** `.localdb/test-account.json` (gitignored).

### Debug switches

| URL | Shows |
|---|---|
| `/play?perf` | fps, frame and CPU time, draw calls, triangles, render resolution, memory |
| `/preview.html?scene=riders` | Models up close (riders, bikes, cars, buildings…) |
| `/preview.html?scene=world&route=alpine&s=800` | A whole world with a small group at road position `s` (metres). `window.preview.goto(s)` moves it |

---

## What the game has

| Key | Mode | What it is |
|---|---|---|
| 1 | Free ride | Free laps on any loop, picked by landscape (six regions), plus Real climbs. Loops can be ridden in reverse |
| 2 | Hill climb race | Mass start at the foot, first to the top. Includes the 22 real climbs |
| 3 | Training plans | Training plans and workouts in ERG, FTP tests |
| 4 | Career mode | A season as a team leader: calendar, squad, team orders, classifications, contracts |

Pro race (six stages modelled on real ones, at 25, 50 or 100 % of the day) is built, and off the play menu for now.

Also on the home screen: **Analytics** (overview, fitness, power, rides, climbs, calendar),
**Bike and kit**, **Settings** and **Trainer setup** (help).

- **Real climbs:** `src/routes/real/climbs.json` holds 22 climbs (Stelvio, Alpe d'Huez, Ventoux,
  Mortirolo, Vršič, Mangart, Krvavec…). Per-km gradients are rebuilt from published profiles,
  each with its sources. Published length, gain and hairpin count are kept. A climb whose
  gradients don't add up to its gain is dropped (`checkClimb`).
- **Real road 1:1:** Vršič, Alpe d'Huez, Passo dello Stelvio from Prato, Mont Ventoux from
  Bédoin, Col du Tourmalet from Luz-Saint-Sauveur, Alto de l'Angliru from La Vega, Col du
  Galibier from Valloire, Passo Giau from Selva di Cadore and Krvavec from Grad to Plaža run
  on their real roads (OpenStreetMap line, published profile, real terrain). Free ride lists
  them under **Real climbs**. How they are built: `docs/REAL_ROADS.md`.
- **Time trials:** a start ramp, riders leave one by one (the GC leader last), each on their own
  clock, with a broom car behind the last rider.

---

## Where everything is

```
cyclebuddy/
├── index.html, preview.html   Entry pages: site + game, and the dev model preview
├── .gitignore                 Leaves out dependencies, secrets, the local database and build output
├── .env.example               Blank settings. Copy to .env on each computer; .env stays off GitHub
├── .github/CODEOWNERS         Asks DomenZepic to review every pull request
├── src/                       All game code (TypeScript), mapped below
├── server/                    Node API: accounts, sessions, ride sync, static files
├── api/index.js                Vercel: every /api/... request runs the same API handler
├── vercel.json                Vercel: build, page routes, asset caching
├── scripts/real-track/        Offline builder for real roads (OSM + elevation)
├── scripts/blender/           Blender scripts that build the low-poly tree and rock models (GLB)
├── scripts/smoke.mjs          After a build: checks the production server serves the game
├── tests/                     House-rule tests (versions, README map, no secrets, no alert())
├── .github/workflows/test.yml Checks every pull request: types, tests, build, smoke
├── data/                      Climb research data and OSM extracts; DEM cache (not in git)
├── public/route-previews/     Still image of each loop, for the Free ride picker
├── logo/                      Logo source files
├── docs/REAL_ROADS.md         How real roads are built
├── docs/CAREER_RACING.md      How a Career road race is raced: breaks, chase, climbs, sprints
├── docs/RACE_MEASURING.md     How to measure Career racing, and the numbers so far
├── docs/ANALYTICS.md          What the Analytics page shows and how each number is worked out
├── docs/CAREER_UI.md          Career screens: what they do, decisions, what is open
├── docs/CAREER_UI_PLAN.md     Career screens: the original audit and redesign plan
├── docs/PERFORMANCE.md        Budgets, how to measure, rules for hot paths, log of every perf change
├── README.md                  This file: what is where
├── ARCHITECTURE.md            How the parts fit together
├── CONTRIBUTING.md            How we work: branches, pull requests, versions (read this first)
├── CHANGES.md                 What changed in each version
├── NEXT_STEPS.md              What to do next
├── ATTRIBUTION.md             Data and asset credits (keep current)
├── CLAUDE.md                  Rules for AI-assisted work on this repo
└── vite.config.ts             Build config; stamps version + commit into the build
```

### `src/`, folder by folder

**Entry and app shell**

| File | What it does |
|---|---|
| `main.ts` | Entry point: the public site, or the game at `/play` |
| `brand.ts` | The CycleBuddy logo markup |
| `styles.css` | All game styles. The "Broadcast skin" section at the end styles the HUD, top bar, pause dialog and race brief |
| `game/app.ts` | **The game.** Every screen (HTML strings), navigation, keys, the ride loop, results, Analytics wiring, top bar, pause dialog |
| `game/session.ts` | One ride: state, physics steps, energy, distance, trainer commands, workout following |
| `game/boot.ts`, `game/playBoot.ts` | Startup: which account owns local data, the loading screen while `/play` builds |
| `game/homeView.ts` | Home menu: modes 1–4 (Pro race hidden), climb of the day, build stamp |
| `game/quickRace.ts`, `game/proRaceView.ts` | Pro race: builds a stage launch, and its setup page |
| `game/recorder.ts` | One sample per second of riding, ride statistics |
| `game/coins.ts`, `accountProfile.ts`, `climbRecord.ts`, `estimates.ts` | Coins and kit, the rider record on the account, climb segments, lap-time estimates |

**Riding: devices, physics, AI**

| Folder / file | What it does |
|---|---|
| `ble/` | Web Bluetooth. `devices.ts` owns trainer and HR connections and reconnects; `ftms.ts` and `fec.ts` are the two trainer protocols; `heartRate.ts`; `virtualTrainer.ts` (arrow keys) |
| `physics/cycling.ts` | Speed from power, grade, mass, drag, drafting and braking |
| `ai/peloton.ts` | The AI field: pacing, drafting, lanes and packs, attacks, finish and time-trial clocks |
| `ai/powerMeter.ts` | Each rider's power read from how they actually move (speed, grade, draft, acceleration), smoothed like a head unit. Feeds the W/kg tag |
| `ai/road.ts` | Road-race plans and the road AI: terrain W/kg, each rider's move (`decideRoad`), group speeds and the chase (`shapeRoad`), team orders, time-trial start order and gaps |
| `ai/climbers.ts`, `ai/names.ts` | Hill-climb fields and rider names |
| `ai/raceBrain.ts` | Career race state and physiology: the early break, the chase director's limits, surge reserve, sprint and kick power, day form, descending skill. See `docs/CAREER_RACING.md` |
| `ai/raceMeasure.ts` | Measuring tool for Career races: rides a stage headless and reports breaks, gaps, winners, bunch size and power. See `docs/RACE_MEASURING.md` |

**Roads**

| File | What it does |
|---|---|
| `routes/route.ts` | A route: samples a loop every 2 m, smooths the grade, finds the climbs, reverse travel |
| `routes/definitions.ts`, `moreWorlds.ts`, `careerWorlds.ts` | Every loop's definition (sections, styles, towns) |
| `routes/regions.ts` | The six Free ride landscapes, the loops in each, and the Real climbs category |
| `routes/sections.ts`, `grades.ts`, `types.ts`, `validate.ts` | Section shapes, gradient resolution, types, definition checks |
| `routes/real/` | Real climbs and stages: `climbs.json`, `stages.json`, checks (`data.ts`), builders (`build.ts`), real tracks (`tracks/`), terrain loading (`terrain.ts`) |

**The 3D world** (`world/`)

| File | What it does |
|---|---|
| `world.ts` | Owns the scene: camera modes, the per-frame update, race finish and crowd |
| `graphics.ts` | Renderer, quality presets, post-processing, dynamic resolution during rides |
| `terrain.ts`, `terrainChunk.ts`, `terrainWorker.ts`, `terrainField.ts` | Terrain tiles built in workers with levels of detail and trees; the height field (with real elevation for real roads) |
| `scenery.ts` | Roadside: towns, fences (culled per 500 m cell), race crowd (culled per 400 m cell), finish, signs |
| `climbs.ts` | Climb furniture: km bornes, hairpin numbers, stone walls, graffiti |
| `riders.ts`, `riderBody.ts`, `bikes.ts` | Instanced riders with three levels of detail; body and bike models |
| `riderPick.ts` | Which rider is under the mouse, found on screen without raycasting |
| `spectators.ts`, `fences.ts` | Spectator figures; hairpin fences (metal or stone by region) |
| `alpineHotel.ts`, `modernHotel.ts`, `alpineRestaurant.ts`, `ventouxAntenna.ts`, `island.ts`, `buildings.ts`, `settlement.ts`, `site.ts`, `farms.ts`, `mills.ts` | Buildings and places |
| `traffic.ts`, `cars.ts`, `convoy.ts`, `motorcycle.ts`, `motorhome.ts`, `tractor.ts`, `boats.ts`, `birds.ts` | Things that move: traffic, the race convoy and broom car, boats, birds |
| `props.ts`, `batch.ts`, `models.ts`, `geometry.ts`, `materials.ts`, `textures.ts` | Shared model building, merging and instancing |
| `propAssets.ts` | Loads the Blender tree and rock models (`assets/models/`) on ride start; terrain falls back to the code-built ones in `models.ts` |
| `atmosphere.ts`, `water.ts`, `mappedPlaces.ts`, `verge.ts`, `road.ts` | Sky, light and fog presets; water; OpenStreetMap lakes and parking lots on a real road; grass verge; road surface |
| `routePreview.ts` | Renders the loop preview stills |
| `perf.ts` | The `?perf` overlay |

**Screens and HUD** (`ui/`)

| File | What it does |
|---|---|
| `hud.ts` | In-ride HUD: metrics, map, key strip, ride stats, standings, profile, group gaps |
| `minimap.ts` | Nearby-road, wider-road and full-loop map |
| `riderTag.ts` | The label over the AI rider under the mouse: W/kg, plus name and overall standing where the ride has them |
| `profileChart.ts` | Elevation profiles (HUD, cards, stages) |
| `roadAhead.ts`, `roadbook.ts`, `rideBar.ts` | Road-ahead panel, roadbook profile, lap bar |
| `helpContent.ts` | Trainer setup and help text |
| `dom.ts` | Small DOM helpers (`$`, `esc`) and the gradient colours |
| `menus.css` | Home menu styles |

**Modes, data and the rest**

| Folder | What it does |
|---|---|
| `career/` | `season.ts` (career state, classifications), `calendar.ts` (races, stages, terrain bands), `panel.ts` (career screens incl. the season page and the race brief), `progress.ts` (contract meter and season strip numbers), `simulate.ts` (races you don't ride), `squad.ts`, `roster.ts`, `teams.ts`, `jerseys.ts`, `classify.ts` |
| `training/` | Plans, workouts, FTP test, progress ticks |
| `analytics/` | The Analytics page, loaded only when opened: `metrics.ts` (load, fitness/fatigue/form, power curve, zones), `model.ts` (ride lists and totals), `view.ts` (the six pages), `charts.ts` (responsive charts), `shape.ts` (ride profile and power bars). See `docs/ANALYTICS.md` |
| `storage/` | IndexedDB with a memory fallback, account ride sync, FIT import/export, backups |
| `site/` | Public homepage, sign-in, training-plans page |
| `audio/sound.ts` | Wind, freewheel, crowds, music (from `assets/audio/`) |
| `assets/` | Music, real-road terrain grids, tree and rock models (`models/`, built by `scripts/blender/`) |
| `dev/` | The `preview.html` model and world viewer |
| `util/` | Seeded random numbers, noise, rolling windows |
| `types/` | Type declarations: the build stamp, n8ao |

### `server/`

| File | What it does |
|---|---|
| `index.js` | HTTP server: accounts, sessions, Google sign-in, profile and ride sync, static files |
| `security.js` | Password hashing (scrypt), rate limits, origin checks against cross-site requests, body and path limits |
| `profile.js` | Checks the rider profile saved on the account |
| `local.js`, `dev.js` | Local and dev launchers |
| `api.test.js` | Runs the server against a throwaway MongoDB: sign-up, profile, rides, two accounts, sign-out |

---

## How a ride works

`app.startRide(mode)` builds a `RideSession` (route, climb, AI field, optional career or
pro-race plan). Each frame `advanceSession` steps it in 0.1 s chunks, the world draws the
riders, and every 100 ms the HUD and road-ahead panel update. The trainer gets the felt grade
(scaled by trainer difficulty) or the ERG target. More in `ARCHITECTURE.md`.

---

## Versions and releases

The GitHub repository is public, so it can be cloned on another computer. The owner adds the
other person as a collaborator so they can push. **`main` is always the version that is built
and played.** Database passwords and API keys stay in `.env` on each computer.

- **Version number:** `version` in `package.json` (and `package-lock.json`). Bump the minor
  (0.9.0 → 0.10.0) for new features, the patch (0.9.0 → 0.9.1) for fixes only.
- **Changelog:** every version gets a section at the top of `CHANGES.md`: what was added, fixed
  and changed, with the measurements for performance work.
- **Tag:** each release is a git tag `vX.Y.Z` on `main`, pushed to GitHub. `git tag` lists them;
  `git checkout v0.9.0` brings any old version back.
- **Build stamp:** `vite.config.ts` writes the version, the short commit and the build date
  into the build, and the home screen shows them (`v0.9.0 · 080da92`). `-dirty` after the commit
  means it was built with uncommitted changes, so it matches no exact commit.

| Version | Tag | What it is |
|---|---|---|
| 0.8.0 | `v0.8.0` | Career mode: the original version from the zip |
| 0.9.0 | `v0.9.0` | Real climbs, Vršič 1:1, pro race, fixes and perf work, merged with the brother's 16 Nov version (Analytics, time-trial ramp, regions, hotels, spectators), new in-game UI |

### Release steps

Version bump and changelog go through a branch and pull request like any change; the tag is
made on `main` after the merge. Full steps in `CONTRIBUTING.md` → Versions.

### Code from someone else's copy (a zip)

Put it on its own branch, made from the commit both copies started from, and name it
`brother-YYYY-MM-DD`. Commit it unchanged, then merge that branch into `main`. Both sides keep
their history and `git log` shows exactly what came from where. The 16 Nov copy is on
`brother-2026-11-16`.

---

## Where it runs (Vercel)

The Vercel project `cyclebuddy` is on Domen's **personal** Vercel account (not the Tasty Dose
one), connected to this GitHub repo.

| What | Where it is live | Who can open it |
|---|---|---|
| `main` | Production: https://cyclebuddy-mu.vercel.app | Anyone |
| Every pull request / branch | A preview URL, posted on the pull request by Vercel | Logged in to Vercel (team members) |

- **What is live = what is on `main`.** A merged pull request is live a minute or two later; an
  open one is only on its preview. The home screen's `v0.9.0 · abc1234` line says which commit a
  deployment is running.
- Vercel serves the built game (`dist/`) itself; `/api/...` runs `server/index.js`'s handler
  through `api/index.js` (a rewrite in `vercel.json`). `npm start` still runs everything on one machine.
- **Settings** (Vercel → cyclebuddy → Settings → Environment Variables): `MONGODB_URI` (Atlas),
  `MONGODB_DB` (`cyclebuddy` in Production, `cyclebuddy-preview` in Preview, so previews never
  touch real accounts), `SESSION_SECRET` (different per environment), `TRUST_PROXY=1`.
  Atlas → Network Access must allow `0.0.0.0/0`: Vercel has no fixed IP address.
- Deploy history and rollbacks: Vercel dashboard → cyclebuddy → Deployments. A broken
  production deploy is undone with "Instant Rollback" on the previous one.

---

## Working on it

**Read `CONTRIBUTING.md` first.** Branches, pull requests, versions and what to check before
a merge are there.

- Start every session with `git pull` on `main`, then make a branch for your change.
- Keep the low-poly look: it is cheap on CPU and GPU.
- While working, run the tests for the file you touch (`npx vitest run <file>`); run the whole
  suite before a release.
- UI: no card grids, pills or emoji. Big type you can read from the saddle, numbers in tabular
  figures.
- Real climb data comes only from published profiles, with sources.

---

## Tests

Every pull request and every push to `main` runs `.github/workflows/test.yml` on GitHub. The
pull request shows a green tick or a red cross; **red means don't merge**. The same checks run
on your computer:

```bash
npm run typecheck && npm test && npm run build && npm run smoke
```

| What | Where | What it catches |
|---|---|---|
| Unit tests | `src/**/*.test.ts` next to the code | Physics, routes, trainers (FTMS), career, peloton, analytics, FIT files |
| Screens | `src/screens.test.ts` | Every menu screen renders with real data: home, analytics, pro race, training, help, every career tab, the race brief. Fails on "undefined", "NaN", "Infinity" or an empty screen |
| Server | `server/api.test.js`, `server/security.test.js`, `server/profile.test.js` | The account server end to end on a throwaway MongoDB; password, origin and profile checks |
| House rules | `tests/conventions.test.js` | Versions agree (package, lock, CHANGES, README); the README map names every folder and file; no `.env`, keys, local database or recordings in git; no new `alert()`/`confirm()`; no emoji; every loop has its preview image |
| Build + smoke | `npm run build`, `scripts/smoke.mjs` | The game compiles and the production server serves `/`, `/play`, every built file and the API |

A new feature comes with a test for it. A bug fix comes with a test that fails without the fix.

---

## Other docs

| File | What it covers |
|---|---|
| `CONTRIBUTING.md` | How we work: branches, pull requests, versions |
| `ARCHITECTURE.md` | How the code fits together, a ride, the pro race |
| `CHANGES.md` | What changed in each version |
| `NEXT_STEPS.md` | What to do next |
| `docs/REAL_ROADS.md` | Building a real road 1:1 |
| `docs/ANALYTICS.md` | The Analytics page: metrics, formulas, sources |
| `docs/CAREER_UI.md` | Career screens: what they do, the decisions behind them, what is still open |
| `docs/CAREER_UI_PLAN.md` | The original audit and plan for the career screens |
| `ATTRIBUTION.md` | Credits for map, elevation and other data |
| `data/real-climbs.research.json` | Raw climb research: source segments, notes, references |
