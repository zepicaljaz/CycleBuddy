# Changes

One section per version, newest first. Each version is a git tag (`v0.9.0`); the home screen
shows the version and commit of the running build. How to release: `README.md` → Versions and
releases.

## Unreleased

- **Hill climb: your races** (`game/raceHistory.ts`, `game/session.ts`, `server/index.js`). The race screen has a My races tab listing every Hill climb race: climb, date, time, place, gap, average power, W/kg and the AI settings. Opening one shows power for every 2 minutes over the road at the same moments, your ride figures, the AI field and the full finishing order with who lost power near the top. Races ridden before this change show your ride and result only, as their AI settings were not saved. The account server has to be restarted to keep the new data.
- **Hill climb: the setup screen fits the window** (`styles.css`). It is as wide as Analytics, shows the climbs in two columns on a wide screen, and on a phone puts the sliders in one column and scrolls them away with the list.
- **Hill climb: leaving a race counts as not finishing** (`game/app.ts`). Ending a race before the line gave you a guessed time, a place and a climb best.
- **Hill climb: riders blow up near the top** (`ai/climbers.ts`, `ai/peloton.ts`). Each race, 25-35% of the AI lose power in the last 30% of the climb: the loss starts somewhere between 70% and 85% of the way up, builds over the next 10% of the climb, and is 10-50% of their effort, held to the line. The best climber never fades. So that a blown rider still moves on the steepest ramps, the bottom gear now reaches down to 0.36 km/h. Finishing a hill climb now rides the rest of the field on for up to 12 hours (was 4), so the slowest on the longest climbs get real times and not guessed ones.
- **Hill climb: live gaps from split times** (`ai/peloton.ts`, `ui/hud.ts`). The gaps in the live standings were the distance to the leader divided by a rider's speed at that moment, so they jumped with your power. Each rider's own time is now kept every 20 m, and a gap is your time at the point you have reached minus the first row's time at that same point. At the line it equals the gap in the result. A rider who got to a point sooner than the first row (they started further back on the grid) shows a minus.
- **Hill climb: the AI field spreads evenly** (`ai/climbers.ts`). W/kg was mapped from the mountain rating, and most of the best riders share a few ratings, so many held the same top effort while the rest were strung far behind. Riders are now ranked by rating plus race-day form and take even W/kg steps from Strongest down to Slowest. Vršič, 75 riders, 5.0 to 1.0 W/kg: 10th was +0:19 and is +3:26, 15th +1:08 and now +4:56, 38th +16:16 and now +19:41.
- **Slow riders no longer stop on steep ramps** (`physics/cycling.ts`). Below 1 m/s pedal force was capped so low that anyone under about 1.5 W/kg stalled on Vršič and never finished. A bottom gear now keeps them moving (up to 250 N below 1 m/s). Power above about 256 W behaves as before.
- **Look back with a key:** hold L during a ride to look behind you, and let go to return. The view turns smoothly, in under half a second. It turns the view half a circle from wherever the mouse has it, so the two work together. It has a Look back row with the L key under the ride stats, next to Brake, and is listed in Help → Keyboard shortcuts.
- **Career racing: fair summits and descents** (`ai/peloton.ts`, `ai/road.ts`). The AI's speed was not pure physics like the player's: over the top of a climb they could speed up 0.9 m/s² faster than physics, and 1.8 m/s² on the descent, then brake 0.3-0.6 m/s² harder than physics at the bottom. So a player at the same power could not close on the descent and then rode away at the bottom. From the top of a climb to the end of the descent the AI now stay within 0.5 m/s of their own physics and keep their momentum at the bottom. Over the top they carry the effort they climbed at, then ease off by the slope of the descent; a group chasing on a descent pedals to close. Tests: `over the top of a climb`, `over the top and at the bottom`.
- **Career racing: no small breaks at the front of the bunch** (`ai/road.ts`, `ui/hud.ts`). The first 10-15 riders often rode a few metres apart, which looked like a small break. Places at the front were kept for riders still far back in the bunch; a rider's place now counts only the riders already ahead of them on the road. Gaps over 8 m in the first 15 riders on Harbour Race: 64-83% of the time before, 2-5% now. A failed attack drops back sooner, the gap bar groups riders at 16 m like the AI, and the race leader stays out of early moves, descent attacks and the wind.
- **Career racing: the last climb splits the field** (`ai/road.ts`). Riders who are not racing for the win (the bottom 70% of the day's field for the finish, sprinters most of all) ride the last climb easier, down to 80% of the slider. A rider who cracks falls to 88%, then 80%, and stays dropped to the top. Climb attacks are longer and the leaders' tempo a little higher. Harbour Race at 1 km to go: 20-26 riders within 30 s of the front (was 124-128); the 100th rider finishes about 3 minutes down (was 50 s).
- **Career racing: "Teammates to the front" pulls your group** (`ai/road.ts`). The group takes the teammates' effort only while you are in it, the teammates stay on the front of your group instead of hovering 16 m ahead of it, the rest of the group keeps its places, and a spent teammate cracks instead of pulling on empty.
- **Career racing: the bunch no longer slows before a wall** (`ai/road.ts`, `ai/peloton.ts`, `docs/CAREER_RACING.md`). Found in a recording of North Week stage 3 at a steady 2.1 W/kg: the player passed most of the bunch at the foot of the first wall. Each rider now takes the slope under his own wheels, the slot drift scales with the pace instead of a flat 0.2 m/s, and the pace lock brakes less beyond physics on a climb. Test: `a rider holding steady power at the foot of a wall` (`raceMeasure.test.ts`).
- **Career racing: how a road race is raced** (`ai/raceBrain.ts`, `ai/road.ts`, `docs/CAREER_RACING.md`). The bunch still rides your sliders; everything else changed:
  - **Early break:** several attempts in the first quarter of the stage, a break of 3 to 6 riders who are not today's leaders, one or two more bridging across. About one race in ten has no break.
  - **Chase director:** the bunch lets the break go to about 2.2 s per km of stage, holds it there, then chases at Chapatte's 6 s per km to catch it about 2-3 km out (on the last climb for a climb finish). How hard the chase can ride depends on the day and on how fresh the pullers are, so a break sometimes stays away. A late attack by a leader is chased at once.
  - **Surges that cost something:** a surge reserve (a W'-balance model against the slider) for every rider, sized by their rating against today's best. Attacks are 1.16-1.35 times the slider for 30-60 s; a rider cracks when the reserve is empty on a climb, not from a fixed rating gap.
  - **Final climb:** the decisive ascent is found from the road profile, including a run of short walls. Team tempo from 30% of the way up (1.04-1.05 times the slider), 1.06-1.08 from 70%, planned attacks by the contenders, counters, then the uphill kick in the last 200-300 m at up to 2.4 times the slider.
  - **Sprint:** lead-out from about 13% of the stage out (1.15, then 1.28 in the last km, 1.38 in the last 500 m at the front), each sprinter jumping at a distance of their own, and a peak of 4.7 times the flat slider for the day's best sprinter (up to 16 W/kg), 3 s ramp, 9-12 s hold, fade.
  - **Splits close again:** a group that falls a few seconds behind another closes on the flat (and on climbs, before the finale), so the field no longer stays split in two.
  - **Descents:** a small descending skill per rider for riders off the bunch, the reserve refills on descents, and an occasional descent attack by a fresh, good descender.
  - **Day form:** 0.93 to 1.07 per rider and stage, on surge capacity and sprint power only.
- **Measuring tool:** measures one stage per terrain band with the finish that band usually has (a flat stage ends in a sprint), times gaps at a point on the road, and counts the break only up to 85% of the stage.
- **Career racing: measuring tool** (`ai/raceMeasure.ts`, `docs/RACE_MEASURING.md`). Rides a stage headless with a seeded field and reports the break and its gap, how often the break and the best rider win, how the bunch splits, how fast the bunch speed changes, and how hard the AI attacks and sprints. Off by default; run with `MEASURE=1`. The doc has the numbers before and after the descent fix.
- **Career racing: descents.** The AI bunch used to drop to a flat 1.15 W/kg the moment the road tipped down past 1.5%, so it rode slower there than on a 1% descent. It now pedals at a share of your flat W/kg that tapers smoothly with the slope: 90% at 1.5%, 60% at 3%, 30% at 5%, and a tuck with no pedalling from 10%. Steeper descents are always faster. (`descentWkg` in `ai/road.ts`)
- **Career racing: terrain steps.** The hill, medium and mountain sliders used to switch at exactly 3%, 5% and 7%, so the bunch's target jumped when the road tipped up. They now blend over a one percent ramp around each of those slopes.
- **Point at a rider to see their W/kg.** Move the mouse over any AI rider and a label above them shows their current W/kg; move away and it is gone. Free ride and training show the W/kg only. A hill-climb race adds the name. A career stage adds the name and, in a stage race after the first day, the place and time gap in the overall. The number is read from how the rider actually moves (speed, gradient, shelter, acceleration, weight), smoothed like a head unit, so a group riding together reads nearly the same W/kg whatever each rider weighs. In a road race slowing is not counted as soft-pedalling and a surge is capped at the effort the rider chose.
- **Analytics, rebuilt** for phones, tablets and the big screen. Six tabs: Overview (form today, this week vs last, weekly load, recent rides, totals), Fitness (fitness, fatigue and form over 6 weeks to all time, volume by time, load, distance or climbing, week by week, aerobic efficiency), Power (best 5 s to 1 h in W and W/kg, power curve against the period before, FTP estimate, time in zones), Rides (NP and load per ride; the detail adds IF, VI, kJ, heart rate, best efforts, zones and decoupling), Climbs and Calendar (with load per week). Each ride's load uses the FTP you had that day. How it is all worked out: `docs/ANALYTICS.md`.
- **Career screens use the whole screen width.** The season page has its page links along the top; on a wide screen the next race is on the left and the contract and season on the right, on a narrow one they stack.
- **Race brief**: Start stage sits at the top next to what the race pays. Then the stage profile, bunch pace, riders to watch, your teammates and team orders. From stage 2 the current results (overall, sprint and mountains) come last, side by side when there is room.
- **Contract offers need more points**: 300 for a Pro offer (was 160) and 1000 for a World Tour offer (was 450), a second World Tour offer from 1500, and a matching Pro offer for a Pro rider from 170. You set the bunch's W/kg, so you usually finish near the front; a season now takes about five Pro wins to move up to Pro and about fifteen to reach the World Tour.
- **Teammates are marked** in white next to your orange row: in the standings, the full results, the race results after a stage and the standings on the race brief.
- **Race brief, from stage 2**: you and your teammates are listed in overall order with each rider's place and time to the leader. The overall, sprint and mountains tables show the top 8, then you and your teammates further down in place.
- **Career team pick** opens with how a career works (ride races → score points → get contract offers → move up; Continental → Pro → World Tour). The bunch pace sliders are folded away, since they can be changed before every race, and the Start button stays at the bottom of the screen while you scroll the teams.
- **Career season review** comes before the offers: races ridden, wins, podiums, top 10s and best result, the final rankings, your contract points, and which offers they unlocked or missed by how much. Offers that move you up a division are marked.
- **Career standings** start with where you are: your place, how many riders are ranked, your points and the gap to 10th (or to the rider ahead) in the CYB ranking, the Continental ranking and wins. Then one ranking at a time (CYB, Continental, Wins, CYB teams, Continental teams), listing every rider with at least one point, in columns of the same width on every table.
- **Career record** starts with your totals (race wins, stage wins, podiums, top 10s, stages ridden, seasons), then your results season by season: top 10s first, every stage you rode in a fold.
- **Career calendar** opens on the month the season is in and has a key for its colours. On the grid your ticked races are solid, unticked ones an outline, the next race has a ring, and a race you rode shows your place. The race list says what a win pays and shows your place in big type. A "My races only" tick hides the rest.
- **Career race brief** says what the race pays in contract points (win or overall win, stage win, 10th), your points and what is left to the next offer, and in a stage race your place overall and the gap. Labels on the brief are a little larger.
- **Career race results** have a season line under the stats: contract points this stage added, the ranking move (41 → 18), the contract meter growing from where it was, and the next race.
- **Career season page** replaces the eight equal cards. The next race comes first and biggest, with its profile and the contract points a win, a stage win and 10th place pay. Under it a contract meter shows your points against the Pro (300) and World Tour (1000) marks and how many you still need; Pro and Continental points count at 75 %, as the offers do. Then the season month by month, one dot per race (ridden, top 10, next, ticked, skipped), with races done, best result, wins and top 10s. In a stage race it shows your place overall and the gap. The other pages are a row of links.
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
