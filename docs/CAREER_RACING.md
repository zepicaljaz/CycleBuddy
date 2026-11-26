# How a Career road race is raced

This is how the AI races a Career road stage: the early break, the chase, the climbs, the sprint,
descents and day form. It explains what each rider does and why, gives the numbers, says what it
means for the player on the trainer, and shows what the measuring tool says about it.

The code is in `src/ai/road.ts` (each rider's move in `decideRoad`, group speeds and the chase in
`shapeRoad`, whole-race decisions in `directRace`) and `src/ai/raceBrain.ts` (the shared race state
and the physiology helpers). Time trials and the free ride are not changed.

## The one rule

**The bunch rides your sliders.** One W/kg for the flat, one for hills, one for mountains, the
same for every AI rider. That keeps the peloton compact and lets you ride a steady tempo on the
trainer, which is the point of a training app.

Everything above the slider is short and bounded, and is always a multiple of the slider, so it
is an interval you can match:

| Effort | How hard | How long |
|---|---|---|
| Attack that forms the early break | 1.25-1.35 x flat slider | 25-40 s |
| Bridge across to the break | 1.45 x flat slider | up to 60 s |
| Break riding together | 1.16 x slider on the flat, 1.03 on a climb, falling as they tire | until caught |
| Chase of the break (riders in the wind) | up to 1.20-1.38 x flat slider | a few km |
| Team tempo on the final climb | 1.04-1.05 x from 30% of the way up, 1.06-1.08 from 70% | the climb |
| Attack on the final climb | 1.16-1.28 x the climb slider | 30-60 s |
| Lead-out (riders in the wind) | 1.15 x, 1.28 in the last km, 1.38 in the last 500 m | about 3 km |
| Sprint | up to 4.7 x flat slider (16 W/kg cap) | 3 s ramp, 9-12 s peak |
| Uphill kick | up to 2.4 x the climb slider | 2 s ramp, 9-12 s peak |

A rider sitting in the wheels of a group that rides "1.3 x" is not riding 1.3 x: the number is the
power of the riders in the wind, and the group's speed is the speed that power gives alone. In
the draft you, and the AI, ride close to the slider at that speed.

## Scaling to short stages

Career stages are 15-30 km (25-50 minutes), not 150-200 km. Anything measured in kilometres is
scaled; anything that is physiology and runs in seconds is not.

| | Real race | Career stage (about 20 km) | In the code |
|---|---|---|---|
| Chase speed | Chapatte: about 1 min per 10 km, 6 s per km | 6 s per km, unscaled (it is a speed difference) | `CHASE_SEC_PER_KM`, `chaseSpeedNeeded` |
| Biggest gap given to the break | 3-5 min | about 2.2 s per km of stage, 25-75 s, ±20% by day | `gapCap` |
| Catch point, sprint stage | 10-15 km out | 13% of the stage, 1.5-3.5 km out | `catchRemaining` |
| Catch point, climb finish | on the last climb | 40% of the way up the final ascent | `catchRemaining` |
| Break forms | first 30-50 km | first quarter of the stage, at most 6 km | `brainFor` (`breakFrom`, `breakTo`) |
| Break size | often around 5 | 3-6 riders | `breakTarget` |
| Lead-out | last 5-10 km | last 13% of the stage, 1.5-3 km | `sprintRampFrom`, `flatRunIn` |
| Attack, sprint, kick | 20-60 s, 10-15 s | unscaled | surge lengths, `sprintHold` |

## The surge reserve

Every AI rider has a **surge reserve** from 0 to 1 (`RoadActor.reserve`). It is a W'-balance model
measured against the slider for the slope, in `tickReserve` and `tickRoadReserve`:

- Each rider can hold a multiple of the slider for as long as they like, the **critical ratio**:
  `1.09 + (rating - best rating today) / 120`, between 0.90 and 1.12. The best rider for this slope
  holds 9% over the slider; a rider 11 points behind holds the slider exactly; 22 behind, 9% under.
  The rating is the flat rating on the flat and the climbing rating for the slope on a climb.
- Above the critical ratio the reserve empties in proportion to the excess. The reserve is
  `10 + (rating - (best - 30)) / 4` "slider-seconds", 10 to 17.5: riding 0.25 over the critical
  ratio empties 12.5 in 50 s.
- Below it, it refills, faster the easier the effort: slowly in a steady bunch, quickly on a descent
  (on a descent the effort is measured against the flat slider).
- It is measured against **today's field**, not a fixed number. The slider is the bunch's tempo in
  every division, so a Continental field is not weaker against it than a World Tour field.
- What a rider "spends" in a group is set by `shapeRoad`: riders in the wind pay the group's multiple;
  in the wheels on the flat they pay 80% of the slider plus half of any extra; on a climb 98% of it.
- A sprint does not touch the reserve. The stamina bar (`energy`) is unchanged and still runs on its own.

**Cracking.** When the reserve is empty on a climb (or the stamina bar is under 15%), the rider
cracks. A cracked rider rides **97% of the slider** while still on a climb and until the reserve is
back to 30%, then the full slider again. See "Where this differs from what we agreed" for why 97%.
On the flat a cracked rider rides normally and can get back on.

## The early break

Decided for the whole race in `directRace`, carried out by each rider in `decideRoad`.

1. **When.** Attempts start between 500 m and 3% of the stage, and the window closes at a quarter
   of the stage (at most 6 km, at most 40% of it). Never on a descent: an attempt waits until the
   bunch is on the flat or climbing.
2. **Who.** Riders who are not today's danger: not the protected leader of a team, not within 6
   points of the best rider for this finish, not in the top 10 overall, fresh (stamina 70%+, reserve
   60%+), flat rating 60+, not riding for the player's team. One rider per team per attempt.
3. **Attempts.** Every 600-1,200 m an attempt goes: 1-3 riders at 1.25-1.35 x for 25-40 s.
   The race plans which attempt sticks (the first, second or third, at random). Attempts that do
   not stick are chased down at once, and their riders ease off to 80% until the bunch passes them.
4. **The one that sticks** goes with most of the planned 3-6 riders. One or two more bridge across
   at 1.45 x while the gap is under 12 s.
5. **No break today.** About one race in ten the planned attempt never comes. A field smaller than
   20 riders never sends a break.
6. **If the break is caught** while the window is still open, the attacking starts again.

A break rides `breakPace`: 1.16 x the slider for a group on the flat (they share the wind), 1.10 for
a rider alone, 1.03 on a climb where the wind matters little. It fades to 86% of that as the stamina
bar empties, which is what brings a break back in the end.

## The chase director

The biggest group decides how hard to ride from the gap to the front of the race (`chaseFactor` in
`shapeRoad`):

| Situation | What the bunch does |
|---|---|
| The break has no dangerous rider, the gap is under the day's cap | Lets it go: the slider |
| The gap has reached the cap | Holds it: rides the break's speed |
| Close enough to the catch point that 5 s per km is needed | Chases at the speed that closes the gap by the catch point, about 6 s per km |
| Anyone in front is a danger: a leader for today, top 5 overall, or a late attacker who is not in the agreed break | Chases at once, about 8 s per km |

The chase is limited by `chaseCap`: 1.20 to 1.38 x the slider, depending on how much the teams
commit today (random per race) and how fresh the riders at the front are. On a climb it is 1.06 at
most. So on some days the chase is late or weak, and the break stays away. The riders in the wind
pay for the chase from their stamina bar and reserve, which shows up later on the climbs.

## Splits close again

Before, any two groups more than 16 m apart rode the same pace forever, so a split never closed.
Now a group that is behind another group closes on it: at 1.20 x on the flat (gap under 45 s) and
at 1.05 x on a climb (gap under 15 s). Not in the finale of a climb finish, where the splits are the race.

## The front of the bunch

Found in a Harbour Race screenshot: on a descent the first 10-15 riders rode a few metres apart, with gaps
of one or two seconds that looked like a small break, while the rest of the bunch was fine.

**Why.** Every rider in a group has a place (a slot) behind the front. The places just behind the front
were given to riders who should be there, the next riders to pull and the riders of the strongest teams,
even when they were 20-140 m back in the bunch. They move up at about 0.3 m/s, so those places stayed
empty for minutes, and the riders really at the front lined up behind the empty places.

**Now** (`shapeRoad`, `roadPlaces`, `tempoOrder`, `orderPull`):

- A rider's place counts only the riders ordered ahead of them who are already ahead on the road. A rider
  still coming up takes no room until they get there, so no empty place opens behind the front rider.
- The riders of the teams that set the tempo work 8 places ahead of where they ride, and the next pullers
  20, so they come up through the bunch a few places at a time instead of being given the front at once.
- The pull rotation uses a fixed rider order, so it changes only when a pull ends.
- A rider whose attempt failed eases to 65% of the slider (was 80%) until the bunch is back.
- The gap bar in the HUD splits groups at 16 m, like the AI (`ROAD_GROUP_M`). It used 8 m, so a 10 m hole
  inside the bunch showed up as a separate group with its own time.
- The race leader (first overall, or in a leader's jersey) is never in the early move, never in a descent
  attack (nor is anyone in the top 5 overall), and never takes a turn in the wind (`leadsRace`).

Gaps over 8 m among the first 15 riders, share of samples from 1.5 km to the last climb, seeds 1 and 2:

| Stage | Before | Now |
|---|---|---|
| Harbour Race | 64-83% | 2-5% |
| Regional Tour, stage 3 (flat) | 14-46% | 1% |
| South Week, Colle di Vino | 55-61% | 0-1% |
| Autumn Classic | 23-31% | 11-13% |
| Ardenne Peak | 26-27% | 9% |
| North Week, Slenaken | 28-60% | 11-13% |

What is left happens on 9-12% walls and steep descents, where riders lose and close wheels; at 20 m/s a
10 m gap is half a second. Test: `Harbour Race, from the bunch to the last climb` in `raceMeasure.test.ts`.

## The final climb

**Finding it.** `finaleStart` walks back from the line while the road keeps climbing (200 m
average of 2%+), across dips of up to 700 m, so a finish over two or three short walls counts from
the first wall. If the last 300 m do not climb, it uses the plan's last climb.

**Phases**, as fractions of the way from the foot of the final ascent to the line:

| From | What happens |
|---|---|
| foot | Every rider decides whether they race this climb (see below). The others ride it easy. |
| 0% | The bunch rides the slider. Riders in the reserve's red start to crack. |
| 30% | The leaders' teams set a tempo on the bunch: 1.06 x on a mountain finish, 1.05 on a hill finish. |
| 42-90% | Planned attacks. A contender (within 8 points of the best rider still in reach, and one of the ten best of them) attacks once, the very best twice, at 1.16-1.28 x for 40-90 s, at a point of their own. At most three attacks at the same time. |
| with an attack | Counters: a rival within 3 points of the attacker, with reserve left, goes with the move (seven times in ten). Only real attacks are countered, at most five moves at once. |
| after an attack | A rider who got clear rides the pace they can hold: their critical ratio, 0.05 more while the reserve lasts, at most 1.2 x. Otherwise they sit back in. |
| 70% | Tempo 1.10 x (mountain) or 1.08 x (hill). Riders whose reserve is gone crack and drop back. |
| last 300 m (hill) or 220 m (mountain) | The kick: everyone still near the front (within 60 m) and within 10 points of the best goes at up to 2.4 x the climb slider. |

In the finale, a few riders who slipped ahead without attacking do not ride away: their group rides
97% of the slider and the bunch brings them back.

**Riding it easy** (`climbEaseShare`). At the foot of the last climb each rider is placed in the day's
field for this finish, between the best and the worst rating. The top 30% ride the whole climb. The rest
know they will not win here and ride between 80% and just under 100% of the slider: the further down the field, the easier, and
easier still for a rider whose strengths are the flat and the sprint (0.6% less per point their flat or
sprint rating is above their climbing). The share is decided once, at the foot. They ride their own speed
inside the group, do not pull, and a rider who is racing goes round them. The player's teammates do not
ease; they follow the team orders.

**Cracking.** A rider whose reserve is empty on a climb falls to 88% of the slider, sinking to 80% over
the next 300 m (`crackedShare`), and stays cracked to the top of the climb. Before, they rode 97% and
were back at the full slider as soon as the reserve was at 30%, so they never really lost the wheel.

Harbour Race (21 km, the last 4.6 km at 7%), sliders 2.8 / 3.2 / 3.5, seeds 1 and 2:

| | Before | Now |
|---|---|---|
| Riders within 30 s of the front at 1 km to go | 124-128 | 20-26 |
| 10th rider at the finish | +10-13 s | +5-26 s |
| 40th | +33-35 s | +44-55 s |
| 100th | +49-50 s | +2:43 to +3:05 |
| Last | +1:28 to +1:30 | +5:11 to +5:12 |

On Ardenne Peak (mountain finish) the last riders now lose 6-7 minutes, and 22-23 riders are within 30 s at
1 km to go (was 95-99). On Harbour Race about 100 riders ride the climb easy and about 20 race it. Flat
stages that end in a sprint are unchanged.

## Team orders

"Teammates to the front" is an order for the player's group.

- The group rides the teammates' effort only while the player is in it. Once the player is off the back,
  that group rides its own pace again.
- Teammates on the front stay at most one line (11 m) ahead of the front of the player's group. If the
  player cannot hold their effort, they ride the player's pace. Before, they rode their effort and hovered
  about 16 m ahead of the group, or rode with a group the player was not in.
- Every other rider in the group keeps their place while the order is on. Before, nobody did, so a gap
  in the bunch never closed.
- A teammate who is spent on a climb cracks and drops out of the line instead of pulling on empty.

## The foot of a wall

Found by riding North Week stage 3 (Slenaken: three 500 m walls at 9-10%) at a steady 2.1 W/kg, below the
2.6 W/kg the bunch rides on the hills. The player went from 48th to 5th of 140 without touching the power.
Three things made the bunch slower than its own power on a wall, and each is a few percent only on the flat:

1. **The bunch took the slope under its front rider.** Every rider, however far back, slowed to the wall
   speed as soon as the front rider reached the wall. Each rider now takes the slope under his own wheels
   (`shapeRoad`, the speed of a rider who is not the nose). On a flat stage the slopes are all alike, so
   nothing changes there.
2. **The slot drift was a flat 0.2 m/s.** When the bunch squeezes together at a wall, a rider sits closer
   to the front than his slot wants, and was held 0.2 m/s under the pace until he had dropped back, which
   at 8 km/h is a tenth of the speed for about 90 s. The drift now scales with the pace (full strength at
   9 m/s and above, a quarter at the slowest, `DRIFT_PACE`). The same rule on the flat is unchanged.
3. **The pace lock braked 0.6 m/s² beyond physics on a climb.** On a wall gravity already slows a rider at
   about 1 m/s², and the extra threw away the speed the bunch carries in, especially off a descent. On a
   slope above 3% the extra is now 0.2 m/s² (`CLIMB_BRAKE` in `RideSim.step`). Less than that and the
   pace lock can no longer hold the bunch to the pace (the bunch ran 30-45 s ahead of the player).

A fourth change, easing the wheel-following rule (`FILE_SPACING`), was tried and dropped: it did nothing for
the wall and made the flat stage's bunch split (1.8 groups at 90% instead of 1.2).

Measured on that stage with the player at the bunch's own power (time against the 10th rider, 3 seeds,
before the first wall to the end of the third): the player gained 25-27 s on the first wall and 48-60 s over
the three before, and 5-10 s and 1-5 s now. At a constant 2.1 W/kg
he passed 56 and 67 riders on the first wall in two of three seeds before (5 in the third), and passes none now. This is `a rider holding steady power
at the foot of a wall` in `raceMeasure.test.ts`, which fails on the old code.

What is left: the player still gains a few seconds per wall, because a free rider keeps the speed he
carries into the wall and a rider in a bunch of 140 cannot (the riders ahead are slower). A real rider in
the bunch would lose it too, so this is roughly right. After the change the bunch also stretches and
closes up around the walls (two groups for a short time), which is how a real bunch looks there.

## The sprint

On a sprint finish (`flatRunIn`, `launchDistance`, `sprintPeakWkg`, `sprintCurve`):

- **Lead-out.** The front of the bunch rides 1.15 x from 13% of the stage out (1.5-3 km), 1.28 x in the
  last km and 1.38 x in the last 500 m. You in the wheels ride about the slider at that speed.
- **The jump.** Each sprinter jumps at a distance of their own, 120-340 m by rating and luck. About
  one in eight goes too early, from 300-380 m, and fades. A sprinter must be within 30 m of the front
  of their group. A sprint team's leader can go from up to 90 m back and jumps earlier the further back he is.
- **Power.** Peak = flat slider x (4.7 + (sprint rating - best sprint today) / 12), between 3.2 and 5
  times, capped at 16 W/kg, times day form. With a flat slider of 2.8: the day's best about 13.2 W/kg,
  12 points behind about 10.4. If you raise your flat slider, the sprint goes up with it.
- **Shape.** 3 s ramp from the lead-out effort, 9-12 s at the peak (by sprint rating), then a fade of 6%
  of the peak per second to no less than 55%.

There is no Easy/Normal/Hard setting in Career today, so nothing scales the sprint apart from the slider.

## Descents

- The bunch pedals at a share of the flat slider that tapers with the slope (`descentWkg`): 100% down to
  -1%, 60% at -3%, 30% at -5%, a tuck from -10%.
- **Descending skill.** Every rider has a fixed skill of about ±1.5% (`descentSkill`). It counts only
  for riders off the bunch (a break, an attacker) on a descent, so the bunch stays compact.
- **Descent attacks.** After 40% of the stage, on a descent steeper than -4% with more than 2 km
  to go, the race checks once per descent (at most twice per race): about one time in three, the best
  fresh descender in the bunch attacks. Never the race leader or anyone in the top 5 overall. He gains about 2% plus his skill on the bunch speed while the
  road falls, then rides as a lone attacker, and the chase director chases him at once.
- The reserve refills on descents, so climbs can be raced again.
- **Over the top: the effort carried** (`prepareCrests`, `paceWkgAt`). Riders carry the effort they
  climbed at over the summit (the mean of the climb's last 300 m) instead of falling back to the flat
  slider at the top, then ease off by the slope of the descent (`descentShare` of that effort: 100% to
  -1%, 60% at -3%, 30% at -5%, nothing from -10%), and ride the flat slider again once the road has been
  level for 300 m. No published table gives W/kg per descent gradient; this one is the one we agreed,
  and it matches the general finding that power falls with the gradient and riders stop pedalling on
  fast descents. The AI's W/kg never rose at the top: measured, it falls from about 3.2 on the climb to
  2.5 at the top and under 0.3 on a 10% descent.
- **Over the top: the speed** (`Racer.free`, `PHYSICS_SLACK`, `MOMENTUM_M_S` in `RideSim.step`). The player
  and the AI use the same physics (`stepSpeed`, `steadySpeed` and `makeBikeParams` in
  `src/physics/cycling.ts`: mass, air drag, rolling resistance, gravity, draft); the player rides pure
  physics. The AI also have a pace lock that sets every rider to the steady speed for the
  slope, and it let them reach it faster than physics: 0.55 m/s² extra on the summit and 1.8 m/s² on the
  descent, and then 0.6 m/s² of extra braking at the bottom. A player at the same power could not close
  on the descent, then rode away at the bottom and had to wait. Now:
  - from the top of a climb until the road levels out after the descent, and on any descent, each rider
    stays within 0.5 m/s of the speed their own power, draft and the slope give them;
  - a rider more than 1 m/s faster than the pace lock wants, whom physics is already slowing, loses that
    speed to the slope and the air only, not to the extra brake;
  - a group chasing another group on a descent pedals at the flat effort times the chase factor while
    below 60 km/h, as real riders do to close a gap there.

  Measured on four stages (AI speed change minus physics, mean over all bunch riders):

  | Where | Original | Now |
  |---|---|---|
  | First 100 m after a summit | +0.90 m/s² | +0.10 |
  | Last 100 m before a summit | +0.16 | +0.12 |
  | Last 100 m before the bottom | -0.32 | -0.24 |
  | First 100 m after the bottom | -0.29 | -0.08 |

  On Slenaken's 12% descents the bunch now speeds up as fast as physics (0.70 against 0.70 m/s²; it was
  2.36), and the biggest one-second change of the bunch speed fell from 8-9 km/h to about 3.5 km/h.
  Tests: `over the top of a climb` and `over the top and at the bottom` in `raceMeasure.test.ts`, and
  `over the top of a climb` in `terrain.test.ts`.

  What is left: the front of the bunch crosses the top first and is already going faster, so on long
  descents the bunch stretches and groups of 5-20 riders can sit 1.5-3 s ahead until the flat (riders
  ahead of the bunch 14-17% of the time on Ardenne Peak, 8-11% before). That is how a real bunch looks
  over a summit. The rule is only for summits and descents: on the flat and on climbs it split the bunch
  (riders without a wheel cannot hold the pace on physics alone), so there the pace lock is unchanged.

## Day form

Each rider gets a form from 0.93 to 1.07 per stage (`dayForm`), the same for the whole stage. It
changes the reserve size, the critical ratio (half the form difference), attack power and sprint power
(half the form difference). It never changes the bunch tempo.

## What it means for you on the trainer

- **Flat stage.** Hold the flat slider in the wheels. The chase and the lead-out are faster, but sitting
  in you ride about the slider. The last 300 m: a real sprint, up to about 13 W/kg for 10-12 s at a
  flat slider of 2.8.
- **Hilly or medium mountain.** Steady climbing at the hill slider, then on the final climb tempo at
  1.04-1.06, two or three 30-60 s efforts at 1.16-1.28, and a 10 s kick at the top.
- **Mountain.** Long climbing at the mountain slider; from 30% up the final climb about 5% over it,
  from 70% about 8% over it, with attacks of 30-60 s on top. The tempo phases are the main change for
  a rider who wants to finish with the leaders.
- If you ride only the slider all day, you finish in the bunch on a flat stage and lose time on the
  final climb of a climb finish, as a rider who cannot follow the leaders would.

## What the measuring tool says

`docs/RACE_MEASURING.md` explains the tool. Five seeds on one stage per terrain band, sliders flat 2.8,
hills 3.2, mountains 3.5. "Before" is the racing on `main`, measured on the same stages with the same tool.

| | Flat, sprint finish (Regional Tour 3, 19.8 km, 105 riders) | Hilly, short walls (Autumn Classic, 21.9 km, 140) | Medium mountain (South Week 2, 21.3 km, 140) | Mountain (Ardenne Peak, 18.9 km, 176) |
|---|---|---|---|---|
| Winner's rank for the finish, before | 17, 12, 28, 47, 1 | 1, 67, 1, 75, 75 | 81, 35, 53, 53, 35 | 3, 3, 3, 43, 1 |
| Winner's rank for the finish, now | 8, 8, 17, 12, 28 | 48, 75, 114, 107, 1 | 1, 1, 1, 1, 1 | 6, 3, 10, 1, 3 |
| Groups at 90% of the stage, before / now | 3.0 / 1.0 | 3.6 / 1.4 | 4.4 / 1.0 | 11.4 / 1.6 |
| Biggest group at 90%, before / now | 96 / 105 | 134 / 139 | 133 / 140 | 116 / 175 |
| Last rider behind the winner, worst, before / now | 5.3% / 1.2% | 6.6% / 3.6% | 8.0% / 2.1% | 15.4% / 4.1% |
| Fastest finish, before / now | 3.1 / 13.6 W/kg | 3.6 / 7.9 W/kg | 3.8 / 8.3 W/kg | 4.2 / 8.6 W/kg |
| Break: formed (20 s+), before / now | 100% / 20% | 100% / 40% | 100% / 60% | 100% / 40% |
| Break: biggest gap, before / now | 72 s / 38 s | 98 s / 36 s | 58 s / 45 s | 138 s / 25 s |
| Break wins, before / now | 80% / 0% | 100% / 60% | 0% / 0% | 100% / 40% |

How to read it:

- **The bunch is together now.** One group at 90% of the stage instead of three to eleven, and the last
  rider within 1-4% of the winner instead of 5-15%.
- **The finishes are real.** A sprint at 13.6 W/kg instead of 3.1 (the slider plus 10%), uphill kicks at 8 W/kg.
- **Climb finishes go to climbers.** Medium mountain: the best rider for the finish won all five (several
  riders share the top rating, so it was not the same rider). Mountain: the winner was always a top-10 rider.
- **Flat sprints mostly go to sprinters.** In this Continental field every team's leader is rated 68 or
  69, so "rank 8" means seven riders rated one point higher. The winners were rated 65 to 68, and riders
  rated 68-69 were usually among the first six. Not always: in one race a 65 won ahead of two 62s,
  because riders deep in the bunch cannot move up (weak spot 4 below).
- **Breaks are smaller and are caught.** Before, "the break" was usually the field split in two big
  parts that never came back together, which is why it "won" so often. Now the break is a few riders
  and the gap is 25-45 s. "Break wins" still counts any rider who spent a minute in a small group ahead
  before the last tenth of the stage, so on climb finishes it includes leaders who got clear late.
- **The hilly classic is still wrong.** See the next section.

These are five races per stage. Read the shares as "always", "mostly", "sometimes", "never".

## Known weak spots and next steps

1. **Finishes over short walls go to weak riders** (the hilly line above). On the Autumn Classic the
   final 2.5 km are three 500 m walls at 10% with steep descents between. Riders who happen to be at the
   front of a 140-rider bunch when the walls start, often tired domestiques, are still there at the top
   of each two-minute wall, and the kick goes to whoever is near the front. The contenders are buried
   60-150 m back, and the walls are too short for an attack to bring them up. The fix is a **positioning
   model**: in the last 2-3 km before a finale, contenders and sprint leaders move up through the bunch
   (a free lane, not through the wheel ahead). That needs a change to how lanes are chosen in
   `formRoadPack`, so it is left for its own change.
2. **Breaks tire quickly.** A break member drains the stamina bar as if alone in the wind, about half
   the bar every 10 minutes, so a break that goes early fades in 15-20 minutes and is caught further out
   than the 2-3 km aimed at (on average 4-10 km out). A shared-wind rate for break groups in
   `staminaPlace` would let breaks last longer. On a 20 km stage only 20-60% of breaks reach 20 s.
3. **Speed jumps at the top of steep descents** were 7-9 km/h in a second. That was the 1.8 m/s² allowance
   in the speed lock; fixed (see "Over the top: the speed" under Descents), now about 3.5 km/h.
4. **The sprint team's leader goes from deep** because riders cannot move up through a file. Same fix as 1.
5. **The bunch stretches over summits.** The front crosses the top first and goes faster, so groups of
   5-20 riders can sit 1.5-3 s ahead until the road flattens (14-17% of samples on Ardenne Peak, 8-11%
   before). Real bunches do this too, but it is not yet tuned against real data. The rule that keeps
   riders on their own physics is limited to summits and descents; on the flat and on climbs it split the
   bunch.
6. **Not played.** Everything here was measured headless. Nothing has been ridden on a trainer, and the
   numbers that matter most for the player (tempo phases, sprint power) need a playtest.

## Where this differs from what we agreed

- **Cracked riders ride 88% of the slider on a climb, sinking to 80%**, to the top of the climb. This was
  97% until the reserve was back to 30%; that let them drift back but not lose the group, and the whole
  field finished a climb within a minute or so.
- **Sprint power is measured against today's best sprinter**, not a fixed rating: the best gets 4.7 x the
  flat slider. With fixed ratings every Continental sprinter got nearly the same peak, and the sprint was a lottery.
- **The surge reserve is measured against today's field** for the same reason: with a fixed rating, a whole
  Continental field ran empty at the slider on the first climb.
- **No break in a field under 20 riders**, and about one race in ten with no break, as in real racing.

## Tuning knobs

| What | Where | Now |
|---|---|---|
| Break window, size, which attempt sticks | `brainFor` | first quarter, 3-6 riders, attempt 1-3, 10% no break |
| Gap the bunch allows | `gapCap` | 2.2 s per km, 25-75 s, ±20% |
| Chase strength | `chaseCap` | 1.20-1.38 x, 1.06 on a climb |
| Catch point | `catchRemaining` | 13% of the stage out (1.5-3.5 km), or 40% up the last climb |
| Break power | `breakPace` | 1.16 group, 1.10 alone, 1.03 climbing, fades to 86% |
| Critical ratio, reserve size | `criticalRatio`, `reserveBudget` | 1.09 for the best, 1/120 per point; 10-17.5 |
| Final-climb tempo | `shapeRoad` (frac 0.3 and 0.7) | 1.05/1.06, then 1.08/1.10 |
| Attack power, length | `decideRoad` (finale) | 1.16-1.28 x, 40-90 s; clear rider up to 1.2 x |
| Cracked share on a climb | `CRACKED_SHARE`, `CRACKED_FLOOR`, `CRACK_SINK_M` | 0.88, sinking to 0.80 over 300 m |
| Easy pace on the last climb | `climbEaseShare` (`EASE_FROM`, `EASE_FLOOR`) | top 30% race it; the rest 0.80 to just under 1 |
| Moving up through the bunch | `ENGINE_LIFT`, `WIND_LIFT` | 8 and 20 places |
| Failed attempt eases to | `SIT_UP_SHARE` | 0.65 |
| Same group | `ROAD_GROUP_M` | 16 m (AI and HUD) |
| Speed lock beyond physics | `EXTRA_ACCEL`, `PHYSICS_SLACK`, `MOMENTUM_M_S` | 0.55 m/s² on flat and climbs; over the top and on descents within 0.5 m/s of own physics; no extra brake when carrying 1 m/s+ |
| Effort carried over a summit | `prepareCrests` (`CREST_*`) | mean of the climb's last 300 m, until 300 m of level road after the descent |
| Chasing on a descent | `SPIN_OUT` | flat effort x chase factor below 60 km/h |
| Lead-out | `flatRunIn`, `sprintRampFrom` | 1.15 / 1.28 / 1.38 |
| Sprint peak, hold, jump | `sprintPeakWkg`, `sprintHold`, `launchDistance` | 4.7 x for the best, 9-12 s, 120-380 m |
| Uphill kick | `kickPeakWkg` | 2.4 x for the best |
| Descent attacks | `directRace` | 35% per descent, at most 2 |
| Day form | `dayForm` | 0.93-1.07 |

Change one, run the measuring tool before and after, and compare.

## How to test

```bash
git fetch && git checkout feature/career-realism-foundation
npm install
npx vitest run src/ai/raceBrain.test.ts src/ai/terrain.test.ts src/ai/peloton.test.ts src/career/career.test.ts
MEASURE=1 MEASURE_SEEDS=5 npx vitest run src/ai/raceMeasure.test.ts     # about 8 minutes on a laptop
npm run dev:local                                                        # then ride a Career stage
```

On Windows PowerShell: `$env:MEASURE=1; $env:MEASURE_SEEDS=5; npx vitest run src/ai/raceMeasure.test.ts`.

Worth riding: a flat stage (watch the break go, the chase, the lead-out and the sprint), a mountain-top
finish (the tempo from 30% and 70% up and the attacks), and a hilly classic (the weak spot above).
