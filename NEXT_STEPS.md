# Next steps

In order. Each step says how you know it's done.

## 1. Run it and playtest on a real trainer
- `npm install`, then `npm run dev:local` → http://localhost:5173/play (private local
  database; the test account is created in `.localdb/test-account.json`).
- Ride with your trainer and check:
  - [ ] ERG holds the target in a training plan (FTMS and, if you have one, a Tacx on FE-C).
  - [ ] Resistance follows the road on Vršič; the hairpins and the last 2 km (11–12 %) feel right.
  - [ ] Pause releases the trainer to flat.
  - [ ] The road-ahead panel (big gradient, next km) is readable from the saddle.
  - [ ] Sound levels (Settings → Sound): music, crowd, wind.
  - [ ] Pro race at 25 % on Easy / Normal / Hard: does the bunch feel beatable at the right level?
- Done when: a list of what felt wrong, fixed or noted.

## 2. Read what changed
- `CHANGES.md`: everything since v0.8. `docs/REAL_ROADS.md`: how Vršič was made.
- Done when: anything you disagree with is reverted or changed.

## 3. More real roads
- Same pipeline as Vršič (`node scripts/real-track/build.mjs <name>`, steps in
  `docs/REAL_ROADS.md`). Vršič, Alpe d'Huez, Stelvio from Prato, Mont Ventoux from Bédoin, Tourmalet from Luz, Angliru from La Vega, Galibier from Valloire and Passo Giau from Selva di Cadore are in. Good next ones: Mangart, Krvavec (Slovenia).
- Then real land cover from OpenStreetMap: forest vs meadow vs rock, villages,
  lakes (Lake Jasna is on Vršič), landmarks (Russian Chapel, huts).
- Done when: 3–5 climbs ride 1:1 and look like the place.

## 4. Quick wins riders ask for
- Ghost rider of your best time on every climb (a rider on the road, not a number).
- HUD modes (full / race / minimal) and a text-size slider.
- First ride for beginners: a no-drop group with a sweeper.
- Done when: each is in and playtested.

## 5. Make progress cheat-proof
- Coins are kept in the browser and can be edited. Move coins and purchases to the server.
- Then climb leaderboards in W/kg bands.

## 6. More ways to race
- Points race, elimination, chase/handicap; use them in Pro race and Career.

## 7. Connect to what riders already use
- Strava upload, `.zwo` workout import/export, phone as a remote (QR code).

## 8. Before anything goes public
- Naming: stage texts mention the real races they're modelled on. No race trademarks as product or mode names.
- Credits: show "© OpenStreetMap contributors" and the terrain credit (`ATTRIBUTION.md`).
- Server: set `TRUST_PROXY` behind a proxy; add a test for Google account linking.
- Known bug: the bottom profile in the HUD shows its elevation labels the wrong way round.

Research behind this list (what indoor riders want, ranked): ask Domen for the
cycling community research note.
