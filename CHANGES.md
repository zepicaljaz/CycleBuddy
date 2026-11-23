# Changes

One section per version, newest first. Each version is a git tag (`v0.9.0`); the home screen
shows the version and commit of the running build. How to release: `README.md` → Versions and
releases.

## Unreleased

- **Look back with a key:** hold L during a ride to look behind you, and let go to return. The view turns smoothly, in under half a second. It turns the view half a circle from wherever the mouse has it, so the two work together. Listed in Help → Keyboard shortcuts.
- **Krvavec from Grad to Plaža** on its real road: the Pogi Challenge climb from the end of Grad past Ambrož and Planina Jezerca to Plaža, with the published CyclingCols profile and a turnaround at the top. See `docs/REAL_ROADS.md`.
- **Map** has a step between the nearby road and the full loop. Wider road is the same world-fixed view, about five times further out, still coloured by gradient. Press M to cycle: nearby road, wider road, full loop. The map zooms out and back in as the setting changes.
- **First person** shows the handlebar. The rider's body stays hidden, so the view reads as the saddle.
- **Nearby map** on a real out-and-back road uses the climb colours while you are riding up, and the descent colours once you are on the loop at the top. The road line runs to the edges of the map.
- **Free ride** has a Real climbs category for the roads that go up and come back down the same way.
- **Hill-climb races and career stages** paint fictional riders' full names, and the cheers, rarely at the foot, more often through the middle, and about every 10 m in the top fifth of the climb. Some names cross the road and some sit on part of it. A free ride follows the same shape, a little further apart.
- **Alto de l'Angliru from La Vega** on its real road: the RI-2 and Carretera a L'Angliru from the valley junction to the summit parking, with the published profile to the 1,570 m point and the turnaround in the parking. The flat kilometre at Viapará, from 5 km to 6 km, is open ground. Above that the woods stay. See `docs/REAL_ROADS.md`.
- **Hill-climb race:** the strongest W/kg is the best climber's power. The rest of the field sits just under him and spreads down to the slowest W/kg, so a long climb opens its gaps near the summit.
- **Stage results** use the whole screen. The finish order and the time, sprint and mountains standings stay readable from a phone-sized window up to a wide monitor, and your row is scrolled into view.
- **Vršič starts on the way out of Kranjska Gora,** about half a kilometre before Lake Jasna, then the published climb from the Pišnica bridge. Parking at the Ajdovska deklica viewpoint and at Erjavčeva koča sits where OpenStreetMap maps it.
- **Passo dello Stelvio from Prato** on its real road: the SS 38 from the edge of Prato to the pass, 48 numbered hairpins, turnaround at the summit. Prato is a short street at the foot. The grass stays under the asphalt where the bends stack, including through Trafoi. See `docs/REAL_ROADS.md`.
- **Mont Ventoux from Bédoin** on its real road: the D 974 from the roundabout at the edge of Bédoin to the top of the road, then the same road back down. The upper slopes are light grey gravel, and the summit has the red and white transmitter. See `docs/REAL_ROADS.md`.
- **Col du Tourmalet from Luz-Saint-Sauveur** on its real road: the D 918 from the junction in Luz to the pass, through Barèges, then the same road back down. Above Barèges the slopes are open pasture, and Barèges itself is the short village street. See `docs/REAL_ROADS.md`.
- **Col du Galibier from Valloire** on its real road: the D 902 from the centre of Valloire to the pass, over the open summit road. The tunnel is not on the ride. A turn at the top brings you back down the same road. See `docs/REAL_ROADS.md`.
- Tests on every pull request (GitHub Actions): types, all tests, the production build and a
  smoke test of the production server.
- New tests: every menu screen renders clean (`src/screens.test.ts`), the account server end to
  end (`server/api.test.js`), house rules (`tests/conventions.test.js`).
- Fix: with no FTP set, the home screen's climb of the day said "about Infinity min".

## 0.9.0 (16 Nov 2026)

Work done 15–16 Nov 2026 on top of the v0.8 zip, merged with the brother's 16 Nov copy. Every
step is a separate commit; this is the short version.

### Bugs fixed
| Area | Fixes |
|---|---|
| Trainer | Tacx FE-C ERG sent watts in the wrong bytes. Trainer stayed in ERG or on a steep grade when paused. FTMS control-point replies ignored. Reconnect could run twice. HR strap never reconnected. Ride froze in a background tab. FIT import/export timing |
| Career / AI | Ties went to the rider first in the alphabet. Time trials had a distance handicap. Finish button could freeze the UI. Ramp-test FTP formula wrong. Riders missing a stage kept a short GC time. Continental riders could hardly get promoted. Riders overlapped in packs. O(n²) loops per frame |
| World / perf | Post-processing leaked on every rebuild. World dispose left GPU memory. Traffic made ~15,000 objects per frame. Bloom ran on Low. HUD forced layout twice per update. Minimap redrew everything every 100 ms. Menus draw at 30 fps |
| Server | Account takeover through Google sign-in on an unverified account. Login CSRF. No rate limits. Static server could crash. Coins could be granted twice. Local data not tied to the account. Weak password hashing. Mongo outage broke the app. Homepage JS 1.27 MB → 144 kB |
| Routes | Route definitions are validated (no more silent NaN roads; max 255 sections) |

### New
- **22 real climbs** from published profiles, with sources (`data/real-climbs.research.json`).
- **Vršič 1:1** on its real road and terrain. See `docs/REAL_ROADS.md`.
- **Pro race**: 6 stages modelled on real ones; length 25 / 50 / 100 % (finish fixed, start
  moves back, never mid-climb); Easy / Normal / Hard scaled to your FTP, WorldTour at pro W/kg.
- **Play menu**: big modes on keys 1–5, a real climb of the day with your estimated time.
- **Road-ahead panel**: big gradient, next km coloured by steepness, km to the top, power
  zone, pace against your best on hill climbs.
- **Graphics** (still low-poly): gradient-coloured km posts, numbered hairpin signs, summit
  sign, flamme rouge, names on the road, hairpin walls, warmer light, fog matched to the sky.
- **Sound**: wind and freewheel from code, tied to speed; crowds, cowbells, start horn,
  summit sting, 4 music tracks, volume settings.
- `npm run dev:local`: private local MongoDB, no Atlas needed.

### Open
- Coins live on the client and can be edited. Move them to the server before any leaderboard.
- Hairpin counts are published for only a few climbs; others are estimates.
- Stage descriptions name the races they were modelled on. Check naming before going public.
- `TRUST_PROXY` needs setting behind a proxy; Google account linking has no test yet.

### Merged from brother's version (16 Nov)
His work since v0.8 (`CycleBuddy.zip`), merged on top of ours. His copy is on branch `brother-2026-11-16`.
- **Analytics** page (dashboard, all rides, segment analyzer, calendar) replaces ride history.
- **Free ride by landscape**: six regions with preview images; loops can be ridden in reverse.
- **Time trials**: start ramp, riders leave one by one in GC order, own clock, broom car.
  Replaces our 400 m run-up. Hill-climbs keep our chip timing.
- **Career**: reversed stages, terrain bands (flat / hilly / medium / mountain), one-day races
  pay at the finish only, GC rows for the same rider are joined.
- **World**: alpine and modern hotels, restaurants, lake island, spectators, hairpin fences
  (metal or stone by region), 8-bit post-processing target (no flickering black squares).

Where both versions changed the same thing: our climb furniture (bornes, hairpin numbers,
stone walls) wins over his km signs and fences on the same stretch; our pack spacing, GC
tie-break and summit KOM rule stay and now follow the race direction.

Perf: his fences were one instanced mesh per loop (always drawn, ~1.2M extra triangles on
Alpine). They are now split into 500 m cells, culled by camera, sun and a 1 km range.
Same scenes before → after the merge: draw calls and CPU per frame level, triangles equal
or lower (Alpine climb 5.2M → 4.2M, Jura Crest ride 3.75M → 2.95M).

Not merged: his `.env` and `videos/` (177 MB of recordings nothing in the code uses).

### Performance and UI (16 Nov, after the merge)
- **Dynamic resolution** while riding: the render scale drops a step when frames run over
  20 ms and climbs back after 4 s at 60 fps, between 1x and the quality's cap. The `?perf`
  overlay shows the live resolution.
- **Race crowd** split into 400 m cells, hidden beyond 700 m. Alpe du Geant mass start:
  10.1M → 5.1M triangles.
- **Far trees** past 7 km are sparser and slightly bigger: about 40 % of their triangles.
- **Analytics** loads when it is opened: startup download 189 → 177 kB gzip.
- **New in-game UI** in a race-broadcast style:
  - Ride HUD: the map has its own space under the metrics, so no panel covers it. The key hints are one strip above the profile, and the profile labels are the right way up.
  - Top bar: trainer and heart-rate read-outs, with Pair and Virtual next to them.
  - Pause: big stats, and device read-outs that update while paused.
  - Race brief: a stat row, teammates as a table, and team orders that say what they do.
- **Fixed:** the top bar could not be clicked on the home screen (the menu panel covered it).
- **Build stamp:** version and commit on the home screen.

## 0.8.0

Career mode. The original version from `CycleBuddy.zip`, commit `2e31fc2`.
