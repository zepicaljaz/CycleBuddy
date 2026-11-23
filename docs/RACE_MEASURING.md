# Measuring Career races

`src/ai/raceMeasure.ts` rides a Career stage headless with a seeded field and prints numbers about
how the racing looks. It changes nothing in the game. Use it before and after any change to the AI
racing, and compare the two sets of numbers instead of trusting how a stage felt.

## Run it

```bash
MEASURE=1 npx vitest run src/ai/raceMeasure.test.ts          # macOS, Linux
$env:MEASURE=1; npx vitest run src/ai/raceMeasure.test.ts    # Windows PowerShell
```

It rides one road stage per terrain band (flat, hilly, medium mountain, mountain), the one closest
to 22 km, with three seeds each. About 20 seconds per stage and seed on a laptop, so a few minutes
in all. Options:

| Variable | What it does |
|---|---|
| `MEASURE_SEEDS=5` | Seeds per stage. More seeds make the shares less noisy. Default 3 |
| `MEASURE_STAGE=south-week:1` | One stage, as `raceId:stageIndex`, instead of one per band |

Without `MEASURE=1` only the quick checks run (grouping, summary, stage list), so `npm test` stays fast.

The player rides the slider tempo for the terrain the whole way, like a rider holding a steady
effort. The player is left out of every number. Sliders are flat 2.8, hills 3.2, mountains 3.5 W/kg
(`DEFAULT_SLIDERS`). The same seed always gives the same race.

## What the numbers mean

| Line | Meaning |
|---|---|
| break: formed | Share of races where a group of 20 riders or fewer got 20 s or more clear of the biggest group |
| break: wins | Share of races won by a rider who spent a minute or more in such a group before the last tenth of the stage |
| biggest gap, mean size, caught | The gap in seconds, the riders in small groups ahead, and the kilometres to go when the gap first fell under 3 s after its peak ("0.0" means it was only caught at the line, or never) |
| bunch split | Share of races where more than 20 riders got clear of the biggest group, so the field split in two big parts |
| winner | How often the strongest rider for this kind of finish (sprint, hills or mountain rating) won, and how often one of the top three did |
| bunch at 90% | Riders in the biggest group, and how many groups there are, nine tenths of the way along |
| speed | The biggest change of the median speed in one second before the last kilometre, with where it happened |
| power | The highest AI power while attacking as a multiple of the slider for that slope, and the highest AI power in the last 500 m in W/kg |
| gap trace | Gap in seconds, riders in small groups ahead, and riders in the biggest group, every 2 km |

A group is any run of riders where each is within 16 m of the one ahead (the AI uses the same value).

## Where the racing stood before the descent and terrain fix

Three seeds on each stage, the code on `main`. Three seeds are few: read the shares as "always",
"never" and "sometimes", not as exact percentages.

| Stage | Break wins | Biggest gap | Bunch splits | Best rider wins | Biggest speed change | Attacks | Fastest finish |
|---|---|---|---|---|---|---|---|
| Flat band: Italy Tour, Stage 19 (23.6 km, 176 riders) | 100% | 308 s | 100% | 0% | 8.7 km/h per s on a -7.6% descent | 1.23x | 3.4 W/kg |
| Hilly: Autumn Classic (21.9 km, 140 riders) | 100% | 315 s | 100% | 67% | 9.6 km/h per s on a -12.4% descent | 1.28x | 3.6 W/kg |
| Medium: South Week, Stage 2 (21.3 km, 140 riders) | 0% | 103 s | 100% | 0% | 6.3 km/h per s on a -4.5% descent | 1.23x | 3.8 W/kg |
| Mountain: France Tour, Stage 6 (19.8 km, 176 riders) | 0% | 374 s | 100% | 0% | 7.9 km/h per s on a -5.2% descent | 1.21x | 4.0 W/kg |

What this says about the racing:

- **The break is never chased.** On the flat and hilly stages the break wins every race. In the
  gap trace of the flat stage the gap climbs from 15 s to 74 s over the stage and is not closed.
- **The field splits in two in every race.** Groups of 50 to 95 riders get clear of the biggest
  group, and there are many small groups ahead of it as well, rather than one break.
- **The best rider rarely wins.** For the finish type of the stage, the strongest rider won 0 of 3
  races on three of the four stages.
- **There is no real sprint.** The fastest AI power in the last 500 m is 3.4 to 4.0 W/kg, about
  1.2 times the slider. A real sprint is 12 to 16 W/kg for 10 to 12 s.
- **Attacks are about 1.2 to 1.3 times the slider**, and the biggest speed changes happen at the
  start of steep descents.

## After the descent and terrain fix

The same seeds on this branch. A change to the descents moves everyone, so the races diverge and
the win shares move for reasons that are not the fix. What it does show is the speed and the gaps.

| Stage | Break wins | Biggest gap | Bunch splits | Best rider wins | Biggest speed change | Attacks | Fastest finish |
|---|---|---|---|---|---|---|---|
| Flat band | 100% | 141 s | 100% | 33% | 8.4 km/h per s on a -7.6% descent | 1.23x | 3.4 W/kg |
| Hilly | 100% | 305 s | 100% | 0% | 9.2 km/h per s on a -12.4% descent | 1.28x | 3.6 W/kg |
| Medium | 100% | 113 s | 67% | 0% | 3.6 km/h per s on a -9.2% descent | 1.20x | 3.8 W/kg |
| Mountain | 67% | 284 s | 100% | 0% | 7.3 km/h per s on a -9.5% descent | 1.20x | 4.0 W/kg |

The biggest speed changes now all happen at the start of steep descents (-7% and steeper), not at
the 3%, 5% and 7% steps. At the start of a steep descent the group
speed lock may add up to 1.8 m/s each second on top of what the physics gives (`accel` in
`RideSim.step`). That is more than gravity alone gives on a -10% slope, so it is a likely cause of
the 7 to 9 km/h jumps. I have not checked that, and nothing here changes it.

## Limits

- Three seeds on four stages is a first look, not a verdict. Use `MEASURE_SEEDS` for more.
- "Break wins" counts any rider who spent a minute or more in a small group ahead of the bunch,
  including leaders who got clear on the last climb.
- The speed number is the median speed of every rider still racing, so a split of the field moves it too.
