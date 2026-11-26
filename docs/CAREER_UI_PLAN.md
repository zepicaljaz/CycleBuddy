# Career mode UI: what is there, and the plan

> **What was actually built, the decisions and what is still open: `docs/CAREER_UI.md`.**
> This file is the original audit and plan, kept as it was written.

Branch: `feature/career-mode-UI`. Goal: a rider opens Career and knows in five seconds
**where they are in the season, what the next race is worth, and how close they are to
moving up a division.** Nothing in the race engine changes; this is screens and a few small
read-only helpers.

House rules that apply (from `CLAUDE.md`): no card grids, no pills, no emoji; big type you can
read from the saddle; numbers in tabular figures; keep the low-poly look.

---

## 1. How it is set up now

### Code

| Where | What |
|---|---|
| `src/career/panel.ts` | All career screens as HTML strings: `pickHtml`, `hubHtml`, `calendarHtml`, `rankingsHtml`, `recordHtml`, `teamHtml`, `teamRosterHtml`, `fieldHtml`, `briefHtml`, `offersHtml` |
| `src/career/season.ts` | `Career` class: state in `localStorage`, `tab`, commit of a stage, offers at season end (`maybeOffers`), `acceptOffer` |
| `src/career/classify.ts` | Points tables, `offerPoints` (CYB + 0.75 × Continental), thresholds `PRO_OFFER = 160`, `WORLD_OFFER = 450`, `buildOffers` |
| `src/career/types.ts` | `CareerState`: `cyb`, `cont`, `entered`, `done`, `active`, `races`, `history`, `palmares`, `stageNotes`, `offers` |
| `src/game/app.ts` (~2945, ~3095) | After a career stage: a toast headline and the wide "Race results" modal with a Next stage button |
| `src/styles.css` (~975–1060) | Career styles |
| `src/screens.test.ts` | Renders every career tab and fails on `undefined`/`NaN`/empty |

### Screens, as a player meets them

1. **Pick a team.** A heading, three paragraphs about divisions, a nation select, 20 team rows,
   then three W/kg sliders, then "Start with this team" at the very bottom.
2. **Hub.** The logo, one line (`Continental · 0 CYB · 38 races left`), then **eight equal cards
   in a 4 × 2 grid**: Next race, Calendar, Standings, Record, My team, All teams, All riders,
   Download save (and Simulate when it applies).
3. **Calendar.** One month at a time: a 7-column grid with coloured race names, then a fold-out
   list of the month's races with a Ride tick box, stages, profiles and climbs.
4. **Next race (brief).** Race name and stats, stage profile, bunch pace sliders, riders to watch,
   teammate picker, team orders, overall/sprint/mountains after stage 1, Start stage.
5. **Standings.** Five tables of equal weight (CYB riders, Continental riders, Wins, CYB teams,
   Continental teams), top 15–22 each, plus a Full results sheet.
6. **Record.** A plain list of every stage you rode, then podiums per race across seasons.
7. **Offers.** Only after **every** race in the calendar is done: 3–5 team rows with Sign.

### What is unclear to a player

| # | Problem | Why it hurts |
|---|---|---|
| 1 | **No visible goal.** Offers come from `offerPoints` vs 160 (Pro) and 450 (World Tour), but the player never sees those numbers or a meter. | The core loop (ride → points → contract → move up) is invisible until the season is over. |
| 2 | **The hub shows the wrong number.** It shows CYB only. A Continental rider earns mostly Continental points, so it reads `0 CYB` after good results, while the offer actually counts CYB + 0.75 × Continental. | Feels like results don't count. |
| 3 | **Everything has the same weight on the hub.** "Next race" is the same size as "Download save". It is also a card grid, which the house rules forbid. | No obvious "what do I do now". |
| 4 | **No sense of time in the season.** Only "38 races left". No done / now / next, no month. | The player can't tell if they are early, mid or late season. |
| 5 | **Calendar has no legend and no status.** Green / blue / orange / yellow / pink / red mean something, but it's never said. A ticked race looks the same as an unticked one on the grid; done races get only a faint outline; no result shown. | The grid is pretty but doesn't answer "which of these am I riding, and how did it go". |
| 6 | **The brief doesn't say what's at stake.** No "a win is worth 36 points", no "top 10 pays", no "you're 4th overall, 0:42 down". | Nothing to ride for beyond finishing. |
| 7 | **After a race, nothing tells you what changed.** A toast and result tables. No points gained, no rank move, no progress to the next contract. | The payoff moment is lost. |
| 8 | **Standings bury the player.** Five tables side by side; if you are 37th you are not on any of them. | "Where am I?" has no answer. |
| 9 | **Record is a flat list.** No wins / podiums / top 10 count, no season grouping. | Hard to feel progress over seasons. |
| 10 | **Pick screen is a wall of text**, and the pace sliders (a difficulty choice) sit between the teams and the Start button. | First impression is homework. |
| 11 | **Small type in places.** Brief and calendar use 11–12 px. | Not readable from the saddle. |
| 12 | **House-rule breaks.** Flag emoji in rider tables (`flagEmoji`), terrain badges styled as pills, the hub card grid. | Rules in `CLAUDE.md`. |

---

## 2. The plan

**Status (2026-11-26): all five steps are built on `feature/career-mode-UI`.** Step 1 went in
through pull request #6; Steps 2–5 are commits on the branch. The contract meter shows the exact
marks, since raised to 300 (Pro) and 1000 (World Tour); offers still come only at the end of the season. Not done yet from the
clean-up list: flag emoji in the rider tables and the pill-shaped terrain badges.

Five steps, each its own sub-branch off `feature/career-mode-UI` (per `CONTRIBUTING.md`),
each one playable on its own. Order is by how much clarity it buys.

### Step 1: Season hub (biggest win)

Replace the 4 × 2 card grid with one page that reads top to bottom:

```
 SLOVENE RISING · 2026 · CONTINENTAL                         FEBRUARY

 NEXT RACE ─────────────────────────────────────────────────────────────
 OPENING CLASSIC                              Sat 7 Feb · one day · Flat
 [ stage profile, full width ]
 A win pays 36 points · top 10 pays                        [ BRIEF  → ]

 CONTRACT ──────────────────────────────────────────────────────────────
 86 offer points                          74 to a Pro offer · 364 to World
 [██████████░░░░░░░░░░░░|░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░|░░░░░░░░░]
 0                     160 Pro                              450 World Tour
 Pro and Continental points count at 75 %.

 SEASON ───────────────────────────────────────────────────────────────
 Feb   Mar   Apr   May   Jun   Jul   Aug   Sep   Oct
 ●●○   ○○○○  ○○○   ...                     (● done, ◉ next, ○ ticked)
 3 of 38 raced · best 4th, Dike Race · 1 top 10

 Calendar     Standings     Record     My team     All teams     All riders
 Download save · Delete career
```

- **Next race** is the only big block with a primary button.
- **Contract meter**: one bar with the two thresholds marked, the current offer points,
  and "N to a Pro offer". Copy changes by division (World Tour riders see "keep your place").
- **Season strip**: months across, one dot per entered race; done, next, ticked, skipped.
- **Form line**: races done, best result, top 10s.
- The rest is a plain row of text links, not cards.

New read-only helpers in `src/career/` (unit tested, no state changes):
- `contractProgress(state)` → `{ points, division, next: { label, at, left } | null, steps }`,
  built on `offerPoints`, `PRO_OFFER`, `WORLD_OFFER`.
- `seasonProgress(state)` → months with races and their status, counts, best result.

### Step 2: What's at stake, and what changed

- **Brief:** an "At stake" line from `cybPoints` (win / podium / top 10) and, in a stage race
  after stage 1, your overall place and gap ("4th overall, 0:42 behind"). Raise the 11–12 px
  type in the brief to the saddle size used elsewhere.
- **After the race** (results modal in `app.ts`): a "Season update" strip above the tables:
  `+36 points · Continental rank 41 → 18 · 122 / 160 to a Pro offer`, the meter animating once,
  and "Next: North Week, 22 Feb". `Career.commit` already has the before/after state; it
  returns the deltas alongside `classifications`.

### Step 3: Calendar you can read

- Legend under the month title: Grand tour colours, World Tour, Pro, Continental, locked.
- Status on the grid: ticked races solid, unticked outlined, done races with your place
  (`4th`), the next race marked.
- In the race list: points a win pays, and "Not your division" explained once at the top.
- A toggle "My races only" that hides other divisions.

### Step 4: Standings and record

- Standings: a sentence at the top that answers "where am I" ("18th of 280 in the
  Continental ranking, 86 points, 12 behind 10th"); one ranking at a time with a switcher;
  the player's row always shown (pinned below the top N with a gap marker).
- Record: totals first (wins, podiums, top 10s, stages ridden), then results grouped by
  season, then the podium history as it is.

### Step 5: First season and season end

- Pick screen: one line on how a career works
  (`Ride races → score points → get offers → move up: Continental → Pro → World Tour`),
  teams next, pace sliders folded under "Bunch pace (you can change it before every race)".
- Season review before the offers: final ranks, points, best results, which offers your points
  unlocked and which you missed by how much.

### Clean-up that rides along

- Replace flag emoji with three-letter codes (already shown next to them).
- Terrain badges: plain coloured text or a left rule instead of pill shapes.
- Tabular figures on every number in career screens.

---

## 3. Testing

- Unit tests for `contractProgress` and `seasonProgress` in `src/career/career.test.ts`.
- `src/screens.test.ts` keeps rendering every tab; add a mid-season career (a few races done)
  so the meter, strip and pinned standings row are rendered with real numbers.
- Targeted runs while working (`npx vitest run src/career src/screens.test.ts`), full suite once
  at the end of each step.

## 4. Questions for Domen

1. Show the exact thresholds (160 / 450) on the meter, or only "close / far"?
2. Should offers be able to arrive mid-season (e.g. after a big win), or stay at season end?
3. Keep the ★ team ratings on the pick screen? (Text characters, not emoji, but close.)
4. Start with Step 1 alone as the first PR?
