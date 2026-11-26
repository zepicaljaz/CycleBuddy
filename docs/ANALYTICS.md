# Analytics

What the Analytics page shows, how each number is worked out, and the research behind it.
Code: `src/analytics/` (`metrics.ts` has the training maths, `view.ts` the pages,
`charts.ts` the charts).

## What riders get elsewhere (research, November 2026)

Most cycling analysis tools give a rider the same core views:

| Tool | Core views |
|---|---|
| TrainingPeaks | Performance Management Chart (fitness CTL, fatigue ATL, form TSB), TSS per ride, NP, IF, efficiency factor and Pw:HR decoupling, mean-max power |
| Intervals.icu | Fitness / fatigue / form chart with coloured form bands, power curve against earlier seasons in W and W/kg, eFTP, time in zones, weekly load |
| Strava | Fitness & Freshness (same impulse-response model), power curve 1 s to 3 h with two periods compared, best efforts, segment history |
| Indoor apps | Ride list, ride detail with power and HR traces, FTP history, W/kg |

Before this change CycleBuddy showed volume (rides, km, metres, hours), a dual-axis
distance/elevation chart, average power per ride, and segments. It had no training load,
no fitness or form, no power curve and no zones. These are the numbers riders use to plan
their training.

On a phone, the advice from dashboard design guides is the same everywhere. Keep each view
focused, use simple charts with few labels, make touch targets bigger than mouse targets,
keep controls few and easy to tap, and give a next step from the data. CycleBuddy gets
visited on a phone after a ride, not during one. So the page is one column on a phone, and
labels are HTML text that stays readable at any width.

## Pages

| Page | What it answers |
|---|---|
| Overview | How fresh am I today? How does this week compare with last? Recent rides, totals |
| Fitness | Fitness, fatigue and form over 6 weeks to all time. Volume by time, load, distance or climbing. Week by week. Aerobic efficiency |
| Power | Best 5 s, 1 min, 5 min, 20 min, 1 h (W and W/kg) against the period before. Power curve. FTP estimate. Time in zones |
| Rides | Every ride with NP and load. The detail opens IF, VI, kJ, HR, EF, best efforts, zones and decoupling |
| Climbs | Each named climb: best time, best power, last attempt, every attempt with W/kg |
| Calendar | The month with load per week |

## How the numbers are worked out

- **FTP on the day.** An accepted FTP test sets FTP from its day on. Rides before the first
  test use the FTP the test replaced, and rides after the last test use the profile. A new
  test does not rewrite the load of older rides.
- **Normalized Power (NP):** 30 s rolling average, fourth power mean, fourth root
  (`game/recorder.ts`). Average power when the ride is under 30 s.
- **Intensity (IF)** = NP / FTP. **Load (TSS)** = seconds × NP × IF / (FTP × 3600) × 100, so one
  hour at FTP is 100.
- **Fitness (CTL)** and **fatigue (ATL)** are exponentially weighted daily load with time
  constants of 42 and 7 days: `x += (load − x) / days`. **Form (TSB)** is yesterday's fitness
  minus yesterday's fatigue (the TrainingPeaks convention).
- **Form bands** (the ranges Intervals.icu uses): above +25 very fresh, +5 to +25 fresh,
  −10 to +5 balanced, −10 to −30 training, below −30 very tired. Form is not a score: negative
  is normal while training, positive is what you want before a race or a test.
- **Short history.** Fitness and fatigue start at zero on the first saved ride. Fatigue catches
  up in about a week, fitness in about six, so form reads low at first. Until there are 42 days
  of history the page says so. Every page has a folded "What these numbers mean" link that
  opens the explanations.
- **Ramp** = fitness today minus fitness 7 days ago.
- **Efficiency factor (EF)** = NP / average heart rate, on rides of 20 min or more with HR.
- **Pw:HR decoupling** = (power/HR in the first half − in the second half) / first half. Needs
  20 min of heart rate. Under 5% is the usual sign of good aerobic endurance.
- **Power curve:** the best average for 1 s to 2 h from the 1 Hz samples. **Estimated FTP** =
  95% of the best 20 minutes.
- **Zones** are the same as the training plans (`ZONES` in `training/workout.ts`): Recovery
  under 55% of FTP, Endurance, Tempo, Sweet spot, Threshold, VO2max, Anaerobic, Sprint above
  150%.

The Power page reads the samples of each ride in the range once per visit. It keeps only
the best efforts and zone seconds, not the samples.

## Sources

- TrainingPeaks, the science of the Performance Manager: https://www.trainingpeaks.com/learn/articles/the-science-of-the-performance-manager/
- TrainingPeaks, a coach's guide to ATL, CTL and TSB: https://www.trainingpeaks.com/coach-blog/a-coachs-guide-to-atl-ctl-tsb/
- TrainingPeaks, Normalized Power, Intensity Factor and TSS: https://www.trainingpeaks.com/learn/articles/normalized-power-intensity-factor-training-stress/
- TrainingPeaks, power training levels (Coggan zones): https://www.trainingpeaks.com/learn/articles/power-training-levels/
- TrainingPeaks help, aerobic decoupling and efficiency factor: https://help.trainingpeaks.com/hc/en-us/articles/204071724-Aerobic-Decoupling-and-Efficiency-Factor
- Intervals.icu, fitness chart: https://www.intervals.icu/features/fitness-chart/
- Intervals.icu, power curve: https://www.intervals.icu/features/power-curve/
- Strava, Fitness & Freshness: https://support.strava.com/hc/en-us/articles/216918477-Fitness-Freshness-Summit-
- Tableau, why mobile data visualisation isn't just a small viz: https://www.tableau.com/fr-ca/blog/why-mobile-data-visualization-isnt-just-small-viz-61612
- ArcGIS Dashboards on a smartphone: https://enterprise.arcgis.com/en/dashboards/latest/reference/dashboards-on-your-smartphone.htm
