# Career mode UI: what was built, and why

The record of the career mode makeover (November 2026, branch `feature/career-mode-UI`).
The original audit and plan are in `docs/CAREER_UI_PLAN.md`; this file is what the screens
do now, the decisions behind them, and what is still open. Update it when the career
screens change.

Goal: a rider opens Career and knows in five seconds **where they are in the season, what
the next race is worth, and how close they are to moving up a division.**

House rules that shaped it (`CLAUDE.md`): no card grids, no pills, no emoji; big type you
can read from the saddle; numbers in tabular figures; keep the low-poly look.

---

## Where the code is

| File | What it holds |
|---|---|
| `src/career/panel.ts` | Every career screen as an HTML string: team pick, season page (`hubHtml`), calendar, standings, record, team, all teams, all riders, race brief, season review and offers. Also `seasonUpdateHtml` (the line on the race results) and `calendarChipClass` |
| `src/career/progress.ts` | Read-only numbers for the screens: `contractProgress`, `racePayout`, `seasonProgress`, `seasonSnapshot` / `seasonUpdate`, `bookFor`, `rankIn`, `standingIn`, `rankTop`, `careerTotals`. Nothing here changes career state |
| `src/career/classify.ts` | Points tables and contract marks: `PRO_OFFER`, `WORLD_OFFER`, `WORLD_OFFER_SECOND`, `PRO_RIVAL_OFFER`, `CONT_OFFER_WEIGHT`, `buildOffers` |
| `src/career/season.ts` | `Career`: `commit()` now also returns `season` (the update shown after a stage). UI state: `calendarMine`, `rankTable` |
| `src/career/simulate.ts` | Races you do not ride. `quality()` is the rating score for a finish |
| `src/game/app.ts` | Career clicks (`rank-table`, `cal-mine`, ticks restyling the grid in place) and the race results modal with the season line and teammate rows |
| `src/styles.css` | Career styles; the newer blocks are commented by screen near the end of the file |
| Tests | `src/career/progress.test.ts`, `src/career/career.test.ts`, `src/screens.test.ts` (every career screen, mid-season states included) |

---

## The screens

### Team pick (new career)
- Opens with how a career works: **Ride races → Score points → Get contract offers → Move up**,
  and the ladder **Continental → Pro → World Tour** with your division underlined.
- One short line on divisions, then the teams. Bunch pace sliders and the long division text
  are folded under "Bunch pace: you can change it before every race".
- A bar at the bottom shows the chosen team and **Start with this team**, and stays in view
  while you scroll.

### Season page (the career home)
- Team name, kit, division, year and the current month.
- **Links along the top**: Calendar, Standings, Record, My team, All teams, All riders,
  Simulate the rest (when it applies), Download save.
- **Next race**: name, stage, date, distance, climbing, terrain, profile, what it pays in
  contract points (win or overall win, stage win, 10th) and, in a stage race from stage 2,
  "You are 4th overall, 0:19 behind". One primary button: Race brief / Continue the race.
  With nothing ticked it sends you to the calendar.
- **Contract**: your points as offers count them, a meter with the Pro and World Tour marks,
  and "N to a Pro offer".
- **Season**: the months with one dot per race (ridden, top 10 with podium place, next,
  ticked, skipped), races done, best result, wins and top 10s, and a key.
- Wide screens (1100 px and up): next race on the left, contract and season on the right.
  Narrow screens stack them.

### Race brief (Next race)
Top to bottom:
1. Race name and stats (date, distance, climbing, terrain, stage).
2. Your overall place and gap (from stage 2), what the race pays, your contract points and
   what is left, with **Start stage** (and Skip this race on stage 1) on the right.
3. Stage profile and bunch pace, with riders to watch beside them.
4. Teammates: on stage 1 the picker; from stage 2 you and your teammates in overall order,
   each with place and time to the leader. Then team orders.
5. **Current results · after stage N of M**: overall, sprint and mountains, the top 8 then
   you and your teammates further down in place, side by side when there is room.

### Race results (after a career stage)
- A season line under the stats: **+27 contract points**, the ranking move
  ("Continental ranking 41 → 18"), total and what is left to the next offer, a small meter
  (grey: where you were, orange: what this race added) and the next stage or race.
- Your row orange, teammates marked white in every table.

### Calendar
- Opens on the month the season is in.
- A key for the colours (grand tour, World Tour, Pro, Continental, not your division) and the
  marks: solid = riding, outline = not ticked, ring = next race, place after the name =
  ridden, dashed = skipped. Ticking or unticking restyles the grid without closing the open race.
- The race list says what a win pays, shows your place in big type on races you rode, and
  marks the race in progress.
- **My races only** hides other divisions and races you have not ticked.

### Standings
- First, where you stand in the **CYB ranking, Continental ranking and wins**: place, field
  size, points, gap to 10th or the rider ahead, or "Not ranked yet".
- Then one table at a time: **CYB → Continental → Wins → CYB teams → Continental teams**
  (CYB opens first). Every rider (or team) with at least one point is listed.
- Columns are fixed widths, the same on every table. Your row orange, teammates white.
- Full results (every race held this season) also marks teammates.

### Record
- Career totals first: race wins, stage wins, podiums, top 10s, stages ridden, seasons.
- Your results season by season: top 10s overall (podiums in orange), every stage you rode
  in a fold. Then the podium history of every race, as before.

### Season review and offers
- "Season 2026 is over": races ridden, wins, podiums, top 10s, best result; final CYB and
  Continental rankings; contract points and which offers they unlocked or missed by how much.
- Then the offers. Offers that move you up a division are marked **Move up**.

### Layout on every screen
- Career screens use the whole screen width (16 px each side) and lay themselves out for the
  space they get. Checked at 1920, 1280, 875 px and phone width; nothing scrolls sideways.
- Thin scrollbar on the career panels, sitting against the content.

---

## Decisions

| Decision | Why |
|---|---|
| **Contract marks: Pro 300, World Tour 1000** (second World Tour offer 1500, a matching Pro offer for a Pro rider 170). Were 160 / 450 / 670 / 90 | The player sets the bunch's W/kg, so they usually finish near the front. Now about five Pro one-day wins for a Pro offer, about fifteen for World Tour |
| Contract points = CYB + 0.75 × Continental (`offerPoints`) | Unchanged from before; now shown everywhere a contract number appears |
| The meter shows the exact marks | Domen's choice when 1000 was picked; no "close / far" bands |
| Offers still come only at the end of the season | Not changed; the review screen explains what unlocked them |
| CYB first on Standings | Domen's choice |
| Every rider with a point is listed | Domen's choice, instead of top 20 plus your row |
| Teammate rows use class `teammate`, never `mate` | `.mate` is the teammate picker's 5-column grid; reusing it broke the tables |
| Work on one branch after Step 1 | Step 1 went through pull request #6 into the career branch; Steps 2–5 and the fixes are commits on `feature/career-mode-UI`, merged into `main` by one pull request |

---

## Races you do not ride

`simulateRace` scores every AI rider from their ratings for the day's terrain:

| Finish | Score |
|---|---|
| Sprint | sprint 40 %, flat 28 %, hills 16 %, endurance 16 % |
| Hill | hills 38 %, medium 22 %, sprint 14 %, endurance 14 %, flat 12 % (punchy hills use the punch rating) |
| Mountain | mountain 46 %, medium 20 %, endurance 16 %, stamina 10 %, time trial 8 % |
| Time trial | time trial 72 %, flat 16 %, endurance 12 % (mountain TT mixes time trial and mountain) |

In stage races fatigue lowers the score each day (less for riders with good recovery). A
small random spread (±1.6 on ratings of about 60–95) is added. Riders who share a bunch time
keep the order they crossed the line.

Tests in `career.test.ts` hold this: in every race the finish order follows the rating order
(rank correlation above 0.75, above 0.6 for flat sprints, median above 0.85) and the winner
is in the best-rated tenth of the field; no race comes out in name order.

A save that simulated a race with an older build can still show an alphabetical result for
that race (seen on Gulf Classic 2026 in Domen's save). Saved results are not re-simulated;
rankings start again the next season.

---

## Still open

- Flag emoji in the rider tables (`flagEmoji` in `panel.ts`) break the no-emoji rule; use the
  three-letter code alone.
- Terrain badges are pill-shaped; make them plain coloured text or a left rule.
- The season line on the race results has been checked with sample numbers; check it after a
  real ridden stage before merging.
- Offers mid-season (after a big win) were discussed, not built.
