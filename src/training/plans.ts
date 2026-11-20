import {
  durationSec,
  expandBlocks,
  peakPct,
  prescribedLoad,
  type ActiveWorkout,
  type Block,
  type Workout,
} from './workout';

/**
 * Plans follow the shape used by Zwift and Rouvy: weeks of workouts, each workout a
 * warm-up, a main set and a cool-down, with targets as a percent of FTP.
 * Power zones are the indoor set both apps use: recovery, endurance, tempo,
 * sweet spot, threshold, VO2max, anaerobic and sprint.
 */

export type PlanGroup = 'start' | 'build' | 'rider' | 'event' | 'keep';
export type PlanLevel = 'Beginner' | 'Intermediate' | 'Advanced';

export interface PlanWeek {
  title: string;
  note: string;
  /** Shorter than the week before, so the previous work can stick. */
  recovery?: boolean;
  workouts: Workout[];
}

export interface TrainingPlan {
  id: string;
  name: string;
  group: PlanGroup;
  level: PlanLevel;
  who: string;
  goal: string;
  weeks: PlanWeek[];
}

export const GROUPS: { id: PlanGroup; label: string; copy: string }[] = [
  { id: 'start', label: 'Getting started', copy: 'New to structured riding, or coming back after time away.' },
  { id: 'build', label: 'Build power', copy: 'Raise the power you can hold. A first FTP block, sweet spot, a longer build, VO2max, and base miles.' },
  { id: 'rider', label: 'Rider type', copy: 'Climb, time trial, punch, sprint, do a bit of everything, or train as a master with shorter days.' },
  { id: 'event', label: 'Event', copy: 'A gran fondo, a race week, a triathlon bike leg, or a gravel day.' },
  { id: 'keep', label: 'Maintain', copy: 'Hold the fitness you have. The hard day changes, and you can ride the week again.' },
];

export const TRAINING_METHOD: { title: string; text: string }[] = [
  {
    title: 'Weeks that build, then ease',
    text: 'A plan is a run of weeks. The work rises for two or three weeks, then a shorter week lets it stick. Zwift Build Me Up and the Rouvy rider plans are built this way. The four-week specialist plans rise through the last week, and the week after that is easy riding.',
  },
  {
    title: 'Every interval is a percent of FTP',
    text: 'FTP is the power you can hold for about an hour. Warm-ups, steady blocks, repeats and cool-downs are all a percent of that number. Type a number when you sign in, or ride the 20-minute FTP test and that result replaces it. FTP Builder, Build Me Up and Back to Fitness also include a ramp test: the target rises each minute, and the estimate is 75% of your best 60-second average power during the test.',
  },
  {
    title: 'The same zones as the big apps',
    text: 'Recovery under 55%, endurance 56–75%, tempo 76–87%, sweet spot 88–94%, threshold 95–105%, VO2max 106–120%, then anaerobic efforts and short sprints. Rouvy labels workouts by those zones. Zwift builds the same blocks: warm-up, steady, repeats, ramp, cool-down.',
  },
  {
    title: 'ERG holds the watts',
    text: 'During a workout the trainer targets the watts, so you pick a cadence and pedal. The arrow keys nudge that target by 1% when your FTP is a little off. Press E and the road sets the resistance, and you chase the number on screen.',
  },
];

export const FEATURED_IDS = ['ftp-builder', 'climber', 'masters', 'gran-fondo'] as const;

const C = {
  easy: '85–95 rpm',
  brisk: '95–105 rpm',
  low: '60–70 rpm',
  mid: '80–90 rpm',
  sprint: '110+ rpm',
};

const steady = (sec: number, pct: number, text: string, cadence = C.easy): Block => ({ kind: 'steady', sec, pct, text, cadence });
const ramp = (sec: number, from: number, to: number, text: string, cadence = C.easy): Block => ({ kind: 'ramp', sec, from, to, text, cadence });
const repeats = (
  times: number,
  on: number,
  onPct: number,
  off: number,
  offPct: number,
  text: string,
  onCadence = C.mid,
  offCadence = C.easy,
): Block => ({ kind: 'reps', times, on, onPct, off, offPct, text, onCadence, offCadence });

function wu(hard = false): Block[] {
  const base: Block[] = [
    ramp(6 * 60, 0.45, 0.65, 'Settle in. Smooth circles, light hands.', C.easy),
    steady(2 * 60, 0.72, 'A little more pressure. Stay seated.', C.brisk),
  ];
  if (!hard) return [...base, steady(2 * 60, 0.55, 'Easy before the work starts.', C.easy)];
  return [
    ...base,
    repeats(3, 15, 1.25, 45, 0.55, 'Short opener. Fast legs, then stop.', C.sprint, C.easy),
    steady(90, 0.5, 'Shake the legs out.', C.easy),
  ];
}

function cd(min = 6): Block[] {
  return [ramp(min * 60, 0.6, 0.45, 'Cool down. Soft pedals, tall posture.', C.easy)];
}

function W(id: string, name: string, focus: string, blurb: string, blocks: Block[], ftpTest?: 'ramp' | 'twenty'): Workout {
  return ftpTest ? { id, name, focus, blurb, blocks, ftpTest } : { id, name, focus, blurb, blocks };
}

function spin(id: string, name: string, totalMin: number, pct: number, blurb: string, focus = 'Endurance'): Workout {
  const work = Math.max(5, totalMin - 7) * 60;
  return W(id, name, focus, blurb, [
    ramp(4 * 60, 0.4, Math.min(pct, 0.62), 'Easy start. Find a gear you can spin.', C.easy),
    steady(work, pct, pct <= 0.66 ? 'Keep it light. Finish wanting a little more.' : 'A little more pressure. Still smooth.', C.easy),
    ramp(3 * 60, pct, 0.42, 'Soft pedals to the end.', C.easy),
  ]);
}

function endurance(id: string, name: string, workMin: number, pct = 0.65, blurb = 'Zone 2. You should be able to talk in full sentences.'): Workout {
  const cue = workMin >= 60
    ? 'Steady aerobic pace. Drink every ten minutes, and eat once you are past an hour.'
    : 'Steady aerobic pace. You should finish able to talk.';
  return W(id, name, 'Endurance', blurb, [
    ...wu(false),
    steady(workMin * 60, pct, cue, C.easy),
    ...cd(5),
  ]);
}

function recovery(id: string, name: string, workMin = 22): Workout {
  return W(id, name, 'Recovery', 'Truly easy. If you are pushing, the gear is too big. This day is here so the other days work.', [
    ramp(3 * 60, 0.4, 0.5, 'Soft start.', C.easy),
    steady(workMin * 60, 0.5, 'Recovery. Light gear, relaxed hands.', C.easy),
    ramp(3 * 60, 0.5, 0.4, 'Roll to the end.', C.easy),
  ]);
}

function cadenceDrill(id: string, name: string): Workout {
  return W(id, name, 'Cadence', 'The same easy power at three cadences. Change gear when the legs ask, and keep the shoulders quiet.', [
    ramp(4 * 60, 0.4, 0.58, 'Easy start.', C.easy),
    steady(4 * 60, 0.6, 'Comfortable cadence.', '88–94 rpm'),
    steady(4 * 60, 0.6, 'A lighter gear. Let the legs spin.', '100–108 rpm'),
    steady(4 * 60, 0.6, 'A harder gear. Stay smooth.', '75–82 rpm'),
    steady(4 * 60, 0.6, 'Back to comfortable.', '88–94 rpm'),
    ramp(3 * 60, 0.55, 0.4, 'Soft finish.', C.easy),
  ]);
}

function sweet(id: string, name: string, times: number, onMin: number, offMin: number, pct = 0.91, cadence = C.mid, hard = true, blurb?: string): Workout {
  return W(
    id,
    name,
    'Sweet spot',
    blurb ?? `${times} × ${onMin} min at ${Math.round(pct * 100)}% of FTP, with ${offMin} min easy between. Hard enough to matter, and you can still ride tomorrow.`,
    [...(hard ? wu(true) : wu(false)), repeats(times, onMin * 60, pct, offMin * 60, 0.55, 'Sweet spot. Smooth force, quiet shoulders.', cadence, C.easy), ...cd(6)],
  );
}

function tempo(id: string, name: string, times: number, onMin: number, offMin: number, pct = 0.82, cadence = C.mid, hard = true, blurb?: string): Workout {
  return W(
    id,
    name,
    'Tempo',
    blurb ?? `${times} × ${onMin} min at ${Math.round(pct * 100)}% of FTP. Strong, and still in control.`,
    [...(hard ? wu(true) : wu(false)), repeats(times, onMin * 60, pct, offMin * 60, 0.55, 'Tempo. Pressure on the pedals, shoulders loose.', cadence, C.easy), ...cd(6)],
  );
}

function threshold(id: string, name: string, times: number, onMin: number, offMin: number, pct = 1): Workout {
  return W(id, name, 'Threshold', `${times} × ${onMin} min at ${Math.round(pct * 100)}% of FTP. This is the pace that decides a long effort.`, [
    ...wu(true),
    repeats(times, onMin * 60, pct, offMin * 60, 0.5, 'Threshold. Sit in and breathe on a count.', C.mid, C.easy),
    ...cd(6),
  ]);
}

function vo2(id: string, name: string, times: number, onSec: number, offSec: number, pct = 1.15, cue = 'VO2max. Hard, and keep the pedal stroke round.', blurb?: string): Workout {
  const onLabel = onSec >= 60 ? `${Math.round(onSec / 60)} min` : `${onSec} s`;
  return W(id, name, 'VO2max', blurb ?? `${times} × ${onLabel} at ${Math.round(pct * 100)}% of FTP. These raise the ceiling the other workouts sit under.`, [
    ...wu(true),
    repeats(times, onSec, pct, offSec, 0.5, cue, C.brisk, C.easy),
    ...cd(6),
  ]);
}

function bursts(id: string, name: string, focus: string, times: number, onSec: number, offSec: number, pct: number, cue: string, blurb: string, cadence = C.sprint): Workout {
  return W(id, name, focus, blurb, [...wu(true), repeats(times, onSec, pct, offSec, 0.48, cue, cadence, C.easy), ...cd(6)]);
}

function torque(id: string, name: string, times: number, onMin: number, pct = 0.84): Workout {
  return W(id, name, 'Strength', `${times} × ${onMin} min in a big gear at ${Math.round(pct * 100)}% of FTP. Low cadence is the force you use when a climb steepens.`, [
    ...wu(true),
    repeats(times, onMin * 60, pct, 2 * 60, 0.5, 'Big gear, 60–70 rpm. Quiet shoulders.', C.low, C.easy),
    ...cd(5),
  ]);
}

function overUnder(id: string, name: string, times: number): Workout {
  const blocks: Block[] = [...wu(true)];
  for (let i = 0; i < times; i++) {
    const n = `${i + 1}/${times}`;
    blocks.push(steady(2 * 60, 0.95, `Just under threshold (${n}).`, C.mid));
    blocks.push(steady(60, 1.08, `Just over threshold (${n}). Stay seated.`, C.mid));
    blocks.push(steady(90, 0.55, `Spin easy (${n}).`, C.easy));
  }
  blocks.push(...cd(6));
  return W(id, name, 'Over-under', `${times} rounds of two minutes just under threshold and one minute just over. This is how a time trialist learns to sit on the number.`, blocks);
}

function ttPiece(id: string, name: string, steadyMin: number, starts = 3): Workout {
  const blocks: Block[] = [...wu(true)];
  for (let i = 0; i < starts; i++) {
    blocks.push(steady(20, 1.55, `Start ${i + 1}. Out of the saddle, then sit.`, C.sprint));
    blocks.push(steady(90, 0.55, 'Roll it out.', C.easy));
  }
  blocks.push(steady(steadyMin * 60, 0.98, 'Time-trial pace. Even power, still head.', C.mid));
  blocks.push(...cd(6));
  return W(id, name, 'Time trial', `${starts} practice starts, then ${steadyMin} minutes at threshold. The first minute is a skill. The even pace after it decides the ride.`, blocks);
}

function openers(id: string, name: string): Workout {
  return W(id, name, 'Openers', 'The day before a hard ride or a race. Short and sharp, then stop while you still feel good.', [
    ramp(8 * 60, 0.45, 0.7, 'Easy spin.', C.easy),
    repeats(3, 30, 1.3, 90, 0.5, 'Opener. Fast, then stop.', C.sprint, C.easy),
    ...cd(5),
  ]);
}

function rampTest(id: string): Workout {
  const blocks: Block[] = [
    ramp(5 * 60, 0.4, 0.6, 'Ramp test warm-up. Easy spin.', C.easy),
    steady(2 * 60, 0.65, 'Settle the cadence near 90.', C.mid),
  ];
  for (let i = 0; i < 16; i++) {
    const pct = +(0.7 + i * 0.05).toFixed(2);
    blocks.push(steady(60, pct, pct < 1 ? 'Ramp test. Sit and spin. Stop when you cannot hold the power.' : 'Stay seated. Stop pedalling when the target wins.', '90–100 rpm'));
  }
  blocks.push(...cd(5));
  return W(
    id,
    'Ramp test',
    'FTP test',
    'The target climbs every minute, from 70% to 145% of your current FTP. When you cannot hold it, stop pedalling. The estimate is 75% of your best 60-second average power during the test.',
    blocks,
    'ramp',
  );
}

function wk(title: string, note: string, workouts: Workout[], recovery = false): PlanWeek {
  return { title, note, workouts, recovery };
}

export const PLANS: TrainingPlan[] = [
  {
    id: 'first-pedals',
    name: 'First Pedal Strokes',
    group: 'start',
    level: 'Beginner',
    who: 'Someone new to indoor riding, or new to riding with a power target.',
    goal: 'Four weeks, three short rides. You learn to spin, to change cadence, and to do a small tempo effort without emptying the tank. Finish the plan, then move to Back to Fitness or FTP Builder.',
    weeks: [
      wk('Week 1', 'Show up, spin easy, and stop while it still feels friendly.', [
        spin('fp-1a', 'First spin', 20, 0.58, 'Twenty easy minutes. The only job is to finish smiling.'),
        cadenceDrill('fp-1b', 'Three cadences'),
        spin('fp-1c', 'Easy again', 25, 0.6, 'A little longer than the first ride, still well inside endurance.'),
      ]),
      wk('Week 2', 'The same easy base, plus the first minute-long pushes.', [
        spin('fp-2a', 'Easy twenty-five', 25, 0.6, 'Another easy day. Keep the gear light.'),
        W('fp-2b', 'Little pushes', 'Tempo', 'Three one-minute efforts a touch above endurance. The first time the plan asks for more than easy.', [
          ramp(5 * 60, 0.4, 0.6, 'Easy start.', C.easy),
          repeats(3, 60, 0.8, 2 * 60, 0.55, 'One minute a little harder. Sit tall.', C.mid, C.easy),
          steady(8 * 60, 0.58, 'Back to easy.', C.easy),
          ramp(3 * 60, 0.55, 0.42, 'Soft finish.', C.easy),
        ]),
        spin('fp-2c', 'Easy thirty', 30, 0.62, 'End the week with a calm half hour.'),
      ]),
      wk('Week 3', 'The easy rides grow, and the tempo efforts get a minute longer.', [
        spin('fp-3a', 'Easy thirty', 30, 0.62, 'Aerobic only. This is the day that makes Thursday possible.'),
        tempo('fp-3b', 'Four by three', 4, 3, 3, 0.8, C.mid, false, 'Four times three minutes at a strong endurance pace. You should still finish with something left.'),
        spin('fp-3c', 'Easy thirty-five', 35, 0.62, 'Longest easy ride of the plan so far.'),
      ]),
      wk('Week 4', 'One more small step. After this week, take three or four days of very easy spinning before the next plan.', [
        spin('fp-4a', 'Easy thirty', 30, 0.6, 'Shake the week open. Nothing heroic.'),
        tempo('fp-4b', 'Four by four', 4, 4, 3, 0.82, C.mid, false, 'Four minutes is long enough to learn what tempo feels like, and short enough to repeat.'),
        spin('fp-4c', 'Easy forty', 40, 0.62, 'A calm forty minutes to close the plan.'),
      ]),
    ],
  },
  {
    id: 'back-to-fitness',
    name: 'Back to Fitness',
    group: 'start',
    level: 'Beginner',
    who: 'A rider who has trained before and has been off the bike for a while.',
    goal: 'Six weeks back to a steady aerobic base, then a first taste of sweet spot. Week 4 is easier on purpose. Week 6 ends with a ramp test so the next plan uses a fresh FTP. Ride easy the week after you finish.',
    weeks: [
      wk('Week 1', 'Volume you can repeat. All three days stay aerobic.', [
        spin('bf-1a', 'Welcome back', 30, 0.6, 'Thirty minutes, light gear. Relearn the trainer before you add intensity.'),
        spin('bf-1b', 'A little longer', 40, 0.62, 'Forty calm minutes. Drink before you feel thirsty.'),
        cadenceDrill('bf-1c', 'Cadence reminder'),
      ]),
      wk('Week 2', 'The aerobic rides grow, and one day adds short tempo.', [
        endurance('bf-2a', 'Aerobic spin', 25, 0.64, 'Endurance with a proper warm-up. Stay where you can talk.'),
        spin('bf-2b', 'Midweek easy', 35, 0.6, 'Easy between the two longer days.'),
        tempo('bf-2c', 'Four short tempos', 4, 2, 3, 0.8, C.mid, false, 'Two-minute tempos. Enough to wake the legs up, not enough to dig a hole.'),
      ]),
      wk('Week 3', 'The first week that feels like training. Keep the easy days honest.', [
        endurance('bf-3a', 'Steady hour shape', 35, 0.66, 'A longer aerobic ride. Even power, even cadence.'),
        tempo('bf-3b', 'Three by six', 3, 6, 4, 0.82, C.mid, false, 'Six-minute tempos. Sit tall and keep the breath quiet.'),
        endurance('bf-3c', 'Easy endurance', 30, 0.62, 'Close the week aerobic. Tomorrow is the easier week.'),
      ]),
      wk('Week 4', 'Shorter and easier, so the first three weeks can settle.', [
        recovery('bf-4a', 'Soft half hour', 24),
        spin('bf-4b', 'Easy spin', 30, 0.58, 'Keep the habit. Leave the intensity alone this week.'),
        recovery('bf-4c', 'Short and light', 18),
      ], true),
      wk('Week 5', 'Sweet spot arrives, in small pieces. This is the bridge into a real build.', [
        sweet('bf-5a', 'Two by eight', 2, 8, 4, 0.9, C.mid, true, 'Two eight-minute sweet-spot efforts. Hard, and still repeatable.'),
        endurance('bf-5b', 'Aerobic support', 40, 0.65, 'The day after sweet spot is aerobic. Resist the urge to add more.'),
        tempo('bf-5c', 'Three by eight', 3, 8, 4, 0.84, C.mid, true, 'Tempo again, a notch longer than week 3.'),
      ]),
      wk('Week 6', 'A ramp test, one sweet-spot session, and an easy close. Update FTP in Settings if the estimate feels right.', [
        rampTest('bf-6a'),
        sweet('bf-6b', 'Two by ten', 2, 10, 4, 0.9),
        spin('bf-6c', 'Plan complete', 35, 0.58, 'Easy spinning to finish. Next week, ride in zone 2 before you start a harder plan.'),
      ]),
    ],
  },
  {
    id: 'ftp-builder',
    name: 'FTP Builder',
    group: 'build',
    level: 'Intermediate',
    who: 'A rider who can already do four rides a week and wants a higher sustainable power.',
    goal: 'Six weeks in the shape of Zwift FTP Builder: endurance and tempo first, then sweet spot and threshold. Most workouts are under an hour and a quarter. Week 4 eases off. A ramp test opens the plan and another closes it.',
    weeks: [
      wk('Week 1', 'Test, then teach the legs what endurance and tempo feel like at this FTP.', [
        rampTest('ftp-1a'),
        endurance('ftp-1b', 'Aerobic base', 40),
        tempo('ftp-1c', 'Two by eight', 2, 8, 4, 0.84),
        endurance('ftp-1d', 'Easy support', 30, 0.62, 'Short aerobic ride. Keep it truly easy after the tempo day.'),
      ]),
      wk('Week 2', 'Sweet spot replaces the short tempos. The aerobic rides get longer.', [
        sweet('ftp-2a', 'Two by twelve', 2, 12, 4),
        endurance('ftp-2b', 'Longer aerobic', 50),
        tempo('ftp-2c', 'Three by eight', 3, 8, 3, 0.84),
        endurance('ftp-2d', 'Recovery miles', 35, 0.6, 'Spin. The quality was earlier in the week.'),
      ]),
      wk('Week 3', 'The load peaks for this block: longer sweet spot, and the first real threshold.', [
        sweet('ftp-3a', 'Two by fifteen', 2, 15, 5),
        endurance('ftp-3b', 'Endurance hour', 55),
        threshold('ftp-3c', 'Two by eight', 2, 8, 5),
        endurance('ftp-3d', 'Easy spin', 35, 0.62),
      ]),
      wk('Week 4', 'Fewer minutes and one modest sweet-spot day. Sleep and eat like it is a training week anyway.', [
        endurance('ftp-4a', 'Short aerobic', 30, 0.62),
        sweet('ftp-4b', 'Two by eight', 2, 8, 4, 0.9),
        recovery('ftp-4c', 'Legs up', 20),
      ], true),
      wk('Week 5', 'Back to work. Three sweet-spot repeats, threshold, and a longer aerobic ride.', [
        sweet('ftp-5a', 'Three by twelve', 3, 12, 4),
        threshold('ftp-5b', 'Three by six', 3, 6, 4),
        endurance('ftp-5c', 'Long aerobic', 65),
        overUnder('ftp-5d', 'Three over-unders', 3),
      ]),
      wk('Week 6', 'Retest, one solid sweet-spot workout, then ease down. Put the new FTP into Settings before the next plan.', [
        rampTest('ftp-6a'),
        sweet('ftp-6b', 'Two by ten', 2, 10, 4),
        endurance('ftp-6c', 'Aerobic close', 35, 0.62),
        recovery('ftp-6d', 'Done', 18),
      ]),
    ],
  },
  {
    id: 'sweet-spot',
    name: 'Sweet Spot Block',
    group: 'build',
    level: 'Intermediate',
    who: 'A rider who wants the classic indoor block: a lot of work just under threshold.',
    goal: 'Four weeks. The sweet-spot repeats grow from 12 minutes to 20, then week 4 shortens so you absorb it. Expect to be tired in week 3. That is the point of the block, and the reason the last week is easier.',
    weeks: [
      wk('Week 1', 'Learn the pace. Sweet spot should feel hard at the end of the interval, not in the first minute.', [
        sweet('ss-1a', 'Two by twelve', 2, 12, 4),
        endurance('ss-1b', 'Aerobic', 40),
        sweet('ss-1c', 'Three by eight', 3, 8, 3, 0.9),
        endurance('ss-1d', 'Easy spin', 30, 0.62),
      ]),
      wk('Week 2', 'The intervals get longer. Keep the cadence you had in week 1.', [
        sweet('ss-2a', 'Two by fifteen', 2, 15, 5),
        endurance('ss-2b', 'Aerobic', 45),
        sweet('ss-2c', 'Three by ten', 3, 10, 4, 0.91),
        endurance('ss-2d', 'Easy spin', 35, 0.62),
      ]),
      wk('Week 3', 'The big week. Two twenties, then three twelves. Fuel these rides.', [
        sweet('ss-3a', 'Two by twenty', 2, 20, 5, 0.9),
        endurance('ss-3b', 'Support ride', 50),
        sweet('ss-3c', 'Three by twelve', 3, 12, 4, 0.92),
        endurance('ss-3d', 'Easy hour shape', 40, 0.62),
      ]),
      wk('Week 4', 'A short week. One modest sweet-spot day is enough to stay in touch with the pace.', [
        endurance('ss-4a', 'Aerobic', 35, 0.62),
        sweet('ss-4b', 'Two by eight', 2, 8, 4, 0.9),
        recovery('ss-4c', 'Absorb', 22),
      ], true),
    ],
  },
  {
    id: 'build-me-up',
    name: 'Build Me Up',
    group: 'build',
    level: 'Intermediate',
    who: 'A rider with a base who wants the longer build Zwift made famous, fitted into eight weeks.',
    goal: 'Two blocks of three build weeks and one easier week. Block one lives under FTP: tempo, sweet spot and over-unders. Block two adds VO2max on top of that base. Weekday workouts stay around an hour. The aerobic ride is the long one. Ride easy the week after week 8.',
    weeks: [
      wk('Week 1', 'Phase one starts under FTP. The ramp test sets the zones for the rest of the plan.', [
        rampTest('bmu-1a'),
        endurance('bmu-1b', 'Aerobic', 40),
        sweet('bmu-1c', 'Two by eight', 2, 8, 4, 0.9),
        endurance('bmu-1d', 'Easy spin', 30, 0.62),
      ]),
      wk('Week 2', 'Longer sweet spot, and a tempo day. The jump from week 1 should be obvious and still doable.', [
        sweet('bmu-2a', 'Two by twelve', 2, 12, 4),
        endurance('bmu-2b', 'Aerobic', 50),
        tempo('bmu-2c', 'Three by eight', 3, 8, 3, 0.84),
        endurance('bmu-2d', 'Easy spin', 35, 0.62),
      ]),
      wk('Week 3', 'The first overload. Sweet spot, a long aerobic ride, and over-unders.', [
        sweet('bmu-3a', 'Two by fifteen', 2, 15, 5),
        endurance('bmu-3b', 'Long aerobic', 55),
        overUnder('bmu-3c', 'Three over-unders', 3),
        endurance('bmu-3d', 'Easy spin', 40, 0.62),
      ]),
      wk('Week 4', 'Regeneration. Shorter rides, one small sweet-spot reminder, then rest.', [
        endurance('bmu-4a', 'Short aerobic', 30, 0.62),
        sweet('bmu-4b', 'Two by eight', 2, 8, 4, 0.9),
        recovery('bmu-4c', 'Down week', 20),
      ], true),
      wk('Week 5', 'Phase two. VO2max joins the week. Recover fully between the repeats.', [
        vo2('bmu-5a', 'Four by three', 4, 3 * 60, 3 * 60),
        endurance('bmu-5b', 'Aerobic', 45),
        sweet('bmu-5c', 'Two by twelve', 2, 12, 4),
        endurance('bmu-5d', 'Easy spin', 30, 0.62),
      ]),
      wk('Week 6', 'One more VO2 repeat, and threshold comes back beside it.', [
        vo2('bmu-6a', 'Five by three', 5, 3 * 60, 3 * 60),
        endurance('bmu-6b', 'Aerobic', 50),
        threshold('bmu-6c', 'Two by ten', 2, 10, 5),
        endurance('bmu-6d', 'Easy spin', 35, 0.62),
      ]),
      wk('Week 7', 'The hardest week of the plan. Longer VO2 efforts and over-unders. Sleep matters this week.', [
        vo2('bmu-7a', 'Five by four', 5, 4 * 60, 4 * 60),
        endurance('bmu-7b', 'Long aerobic', 55),
        overUnder('bmu-7c', 'Four over-unders', 4),
        endurance('bmu-7d', 'Easy spin', 40, 0.62),
      ]),
      wk('Week 8', 'The second regeneration week. A few short VO2 efforts keep the feeling, then you stop.', [
        endurance('bmu-8a', 'Short aerobic', 30, 0.62),
        vo2('bmu-8b', 'Four by two', 4, 2 * 60, 3 * 60, 1.12, 'Short VO2. Sharp, then easy. Leave the big efforts for the next plan.'),
        recovery('bmu-8c', 'Plan complete', 20),
      ], true),
    ],
  },
  {
    id: 'vo2-booster',
    name: 'VO2 Booster',
    group: 'build',
    level: 'Advanced',
    who: 'A rider who already has a base and wants a short, hard block for the top end.',
    goal: 'Four weeks, three rides. The work is VO2max: three- and four-minute repeats, then 30/15s and short anaerobic efforts. Week 4 is short. Do this on top of your own easy rides if you want more volume, and keep those easy.',
    weeks: [
      wk('Week 1', 'Classic three-minute repeats, plus a first set of thirties.', [
        vo2('vo-1a', 'Five by three', 5, 3 * 60, 3 * 60),
        endurance('vo-1b', 'Aerobic between', 35, 0.62),
        vo2('vo-1c', 'Thirty-fifteens', 12, 30, 15, 1.2, 'Thirty seconds hard, fifteen easy. Stay seated if you can.', 'Twelve 30/15s at 120%. Short enough to repeat, hard enough to breathe.'),
      ]),
      wk('Week 2', 'One more three-minute repeat, and the micro-intervals get a little longer.', [
        vo2('vo-2a', 'Six by three', 6, 3 * 60, 3 * 60),
        endurance('vo-2b', 'Aerobic between', 40, 0.62),
        vo2('vo-2c', 'Forty-twenties', 10, 40, 20, 1.18, 'Forty seconds on, twenty off. Hold the cadence up.', 'Ten 40/20s. The rest is short, so the power has to stay smooth.'),
      ]),
      wk('Week 3', 'Four-minute repeats, then anaerobic efforts. This is the week you respect.', [
        vo2('vo-3a', 'Five by four', 5, 4 * 60, 4 * 60),
        endurance('vo-3b', 'Aerobic between', 40, 0.62),
        bursts('vo-3c', 'Anaerobic forties', 'Anaerobic', 8, 40, 80, 1.4, 'Forty seconds hard. Stand if you need the first pedal strokes.', 'Eight times forty seconds. Full enough rest that each one is a real effort.'),
      ]),
      wk('Week 4', 'A few sharp reminders, then stop. The adaptation shows up after this week, not during it.', [
        vo2('vo-4a', 'Four by two', 4, 2 * 60, 3 * 60, 1.15),
        endurance('vo-4b', 'Easy aerobic', 25, 0.6),
        recovery('vo-4c', 'Down', 18),
      ], true),
    ],
  },
  {
    id: 'base-miles',
    name: 'Base Miles',
    group: 'build',
    level: 'Intermediate',
    who: 'A rider building the winter base: mostly endurance, one harder day.',
    goal: 'Six weeks, polarized the way an off-season plan is. Three aerobic rides and one intensity day. The long ride grows, week 4 drops back, then the long ride returns. Intensity stays sweet spot and threshold, never a pile of sprints.',
    weeks: [
      wk('Week 1', 'Aerobic habit, plus a small tempo day so the week is not only spinning.', [
        endurance('base-1a', 'Aerobic', 40),
        endurance('base-1b', 'Aerobic', 45),
        tempo('base-1c', 'Two by eight', 2, 8, 4, 0.82),
        endurance('base-1d', 'Short aerobic', 30, 0.62),
      ]),
      wk('Week 2', 'The long ride steps up. Sweet spot is the hard day.', [
        endurance('base-2a', 'Aerobic', 45),
        endurance('base-2b', 'Longer aerobic', 55),
        sweet('base-2c', 'Two by ten', 2, 10, 4, 0.9),
        endurance('base-2d', 'Easy spin', 35, 0.6),
      ]),
      wk('Week 3', 'The biggest aerobic week of the first block.', [
        endurance('base-3a', 'Aerobic', 50),
        endurance('base-3b', 'Long ride', 70),
        sweet('base-3c', 'Two by twelve', 2, 12, 4),
        endurance('base-3d', 'Easy spin', 35, 0.62),
      ]),
      wk('Week 4', 'Shorter. One tempo workout keeps a little intensity, and the long ride waits.', [
        endurance('base-4a', 'Aerobic', 30, 0.62),
        tempo('base-4b', 'Two by six', 2, 6, 4, 0.8, C.mid, false),
        recovery('base-4c', 'Easy', 20),
      ], true),
      wk('Week 5', 'Long ride back, and the hard day moves up to threshold.', [
        endurance('base-5a', 'Aerobic', 50),
        endurance('base-5b', 'Long ride', 75),
        threshold('base-5c', 'Three by six', 3, 6, 4),
        endurance('base-5d', 'Easy spin', 35, 0.62),
      ]),
      wk('Week 6', 'One more long aerobic week, then you can start a build or an event plan.', [
        endurance('base-6a', 'Aerobic', 45),
        endurance('base-6b', 'Long ride', 65),
        sweet('base-6c', 'Two by twelve', 2, 12, 4),
        endurance('base-6d', 'Easy close', 30, 0.6),
      ]),
    ],
  },
  {
    id: 'climber',
    name: 'Climber',
    group: 'rider',
    level: 'Intermediate',
    who: 'A rider who wants to hold a pace on long climbs and still have a kick when the grade kicks.',
    goal: 'Four weeks in the shape of a Rouvy climber plan: sweet spot and tempo in a bigger gear, low-cadence strength, then seated attacks. The weeks get longer. Take an easy week when you finish, spinning in zone 2.',
    weeks: [
      wk('Week 1', 'Sustain a climbing pace. Low cadence on the tempo day, sweet spot once you are warm.', [
        endurance('cl-1a', 'Legs open', 35, 0.64, 'Aerobic, with a cadence you could hold on a long climb.'),
        tempo('cl-1b', 'Tempo hills', 3, 8, 4, 0.84, C.low, true, 'Three times eight minutes at tempo, 60–70 rpm. This is seated climbing force.'),
        sweet('cl-1c', 'Steady climbing', 2, 10, 4, 0.9, C.low),
        torque('cl-1d', 'Torque turns', 4, 3, 0.82),
      ]),
      wk('Week 2', 'Longer tempo, more torque, and the first attacks.', [
        tempo('cl-2a', 'Tempo endurance', 3, 10, 4, 0.86, C.low, true, 'Ten-minute tempos in a big gear. Stay seated and keep the upper body still.'),
        torque('cl-2b', 'Torque again', 5, 3, 0.85),
        vo2('cl-2c', 'Attacks', 5, 2 * 60, 3 * 60, 1.15, 'Seated attack. Two minutes, then spin the easy part.'),
        endurance('cl-2d', 'Aerobic climbs', 45, 0.66, 'Aerobic, imagining a steady mountain road.'),
      ]),
      wk('Week 3', 'The repeats get longer, the way Rouvy extends week 3 of the climber plan.', [
        sweet('cl-3a', 'Sweet-spot climbs', 2, 15, 5, 0.91, C.low),
        torque('cl-3b', 'Longer torque', 5, 4, 0.85),
        vo2('cl-3c', 'More attacks', 6, 2 * 60, 2 * 60, 1.16, 'Attack, sit, hold it to the end of the two minutes.'),
        tempo('cl-3d', 'Tempo block', 2, 15, 5, 0.86, C.mid, true, 'Two fifteens at tempo. Cadence can come up now. The force work was yesterday.'),
      ]),
      wk('Week 4', 'Threshold on the climb, torque, attacks, and a long sweet-spot finish to the plan.', [
        threshold('cl-4a', 'Climbing threshold', 3, 8, 5, 0.98),
        torque('cl-4b', 'Last torque', 5, 4, 0.86),
        vo2('cl-4c', 'Attack to the top', 5, 3 * 60, 3 * 60, 1.12, 'Three-minute attacks. These are the efforts that open a gap on a steep pitch.'),
        sweet('cl-4d', 'Tempo block', 2, 20, 5, 0.9, C.mid, true, 'Two twenties at sweet spot. Hold the pace you want on a long climb.'),
      ]),
    ],
  },
  {
    id: 'time-trialist',
    name: 'Time Trialist',
    group: 'rider',
    level: 'Intermediate',
    who: 'A rider who needs even power, a clean start, and the ability to sit just over and just under threshold.',
    goal: 'Four weeks, three rides. Each week has a start-and-settle workout, then sweet spot or over-unders. The steady piece grows from 10 minutes to 25. Rouvy builds the TT plan the same way: longer sustained efforts each week. Ride easy the week after.',
    weeks: [
      wk('Week 1', 'Learn the start, then sit on a number. The aerobic ride keeps the week honest.', [
        ttPiece('tt-1a', 'Starts and ten', 10),
        sweet('tt-1b', 'Sweet spot', 2, 10, 4, 0.9),
        endurance('tt-1c', 'Aerobic', 40, 0.64),
      ]),
      wk('Week 2', 'A longer settle, and the first over-unders.', [
        ttPiece('tt-2a', 'Starts and fifteen', 15),
        overUnder('tt-2b', 'Three over-unders', 3),
        endurance('tt-2c', 'Aerobic', 45, 0.64),
      ]),
      wk('Week 3', 'Twenty minutes at time-trial pace, longer sweet spot, more over-unders.', [
        ttPiece('tt-3a', 'Starts and twenty', 20),
        sweet('tt-3b', 'Two by fifteen', 2, 15, 5, 0.92),
        overUnder('tt-3c', 'Four over-unders', 4),
      ]),
      wk('Week 4', 'The longest settle of the plan, threshold repeats, and one more pacing workout.', [
        ttPiece('tt-4a', 'Starts and twenty-five', 25, 2),
        threshold('tt-4b', 'Two by twelve', 2, 12, 6),
        overUnder('tt-4c', 'Four over-unders', 4),
      ]),
    ],
  },
  {
    id: 'puncheur',
    name: 'Puncheur',
    group: 'rider',
    level: 'Advanced',
    who: 'A rider who races short climbs, criteriums, and roads that never stay flat.',
    goal: 'Four weeks of changing pace, the way Rouvy builds the puncheur plan. Week 1 is one-minute surges. Later weeks add VO2max and anaerobic repeats. You still get an endurance ride so the punches have an engine under them. Easy week after you finish.',
    weeks: [
      wk('Week 1', 'Change pace often. The one-minute efforts should feel snappy, not fatal.', [
        bursts('pu-1a', 'Minute surges', 'Attacks', 8, 60, 60, 1.25, 'One minute on. Stand for the first pedal strokes if you like, then sit.', 'Eight one-minute surges with a minute easy. This is the race that never settles.', C.brisk),
        endurance('pu-1b', 'Between the punches', 40, 0.64),
        vo2('pu-1c', 'Five by two', 5, 2 * 60, 2 * 60, 1.15, 'Two minutes hard. Hold the cadence up as the legs get heavy.'),
      ]),
      wk('Week 2', 'More surges, and the VO2 efforts grow to three minutes.', [
        bursts('pu-2a', 'Ten surges', 'Attacks', 10, 60, 60, 1.28, 'Surge. The easy minute is short, so do not empty the first one.', 'Ten one-minute surges. A busier version of week 1.', C.brisk),
        vo2('pu-2b', 'Five by three', 5, 3 * 60, 3 * 60),
        endurance('pu-2c', 'Aerobic', 45, 0.64),
      ]),
      wk('Week 3', 'Anaerobic repeats and a VO2 day. This is the sharp end of the plan.', [
        bursts('pu-3a', 'Thirties', 'Anaerobic', 10, 30, 90, 1.45, 'Thirty seconds all-in, then a full easy minute and a half.', 'Ten thirties with long rest. Each one should be as hard as the first.'),
        vo2('pu-3b', 'Six by two', 6, 2 * 60, 2 * 60, 1.18),
        sweet('pu-3c', 'Fatigue sweet spot', 2, 12, 4, 0.9, C.mid, true, 'Sweet spot after a hard week of surges. Practise holding a pace when the legs are already talking.'),
      ]),
      wk('Week 4', 'Longer anaerobic efforts, threshold so you can close, and ninety-second attacks.', [
        bursts('pu-4a', 'Forties', 'Anaerobic', 8, 45, 90, 1.4, 'Forty-five seconds. Hard from the first pedal.', 'Eight efforts of forty-five seconds. The rest is long enough to do them properly.'),
        threshold('pu-4b', 'Three by five', 3, 5, 4, 1),
        bursts('pu-4c', 'Ninety-second hills', 'Attacks', 8, 90, 90, 1.2, 'Ninety seconds at VO2. This is a short climb in a race.', 'Eight times ninety seconds. Sit in and finish each one.', C.brisk),
      ]),
    ],
  },
  {
    id: 'sprinter',
    name: 'Sprinter',
    group: 'rider',
    level: 'Advanced',
    who: 'A rider who wins or loses in the last fifteen seconds and needs the legs fresh enough to do it again.',
    goal: 'Four weeks. Sprints are short, with full rest, so each one is a real sprint. Low-cadence strength sits in the middle of the plan. An endurance ride keeps the aerobic system from disappearing. Easy spinning the week after.',
    weeks: [
      wk('Week 1', 'Open the sprint. Twelve-second efforts with three minutes of rest.', [
        bursts('sp-1a', 'Fresh twelves', 'Sprint', 8, 12, 3 * 60, 1.9, 'Sprint. Fast legs, then stop completely.', 'Eight twelves. If the last one is slower, you started too hard, or the rest was too short.'),
        endurance('sp-1b', 'Engine', 40, 0.64, 'Sprinters still need an aerobic ride. Keep this one easy.'),
        bursts('sp-1c', 'Fifteens', 'Sprint', 6, 15, 3 * 60, 1.85, 'Fifteen seconds. Shift up, jump, and stop.', 'Six fifteens. Full rest between them.'),
      ]),
      wk('Week 2', 'Slightly longer sprints, plus the strength day that makes the jump.', [
        bursts('sp-2a', 'Fifteens again', 'Sprint', 8, 15, 3 * 60, 1.9, 'Jump and hold the speed for fifteen seconds.', 'Eight fifteens. Quality over a bigger number.'),
        torque('sp-2b', 'Sprint strength', 5, 2, 0.88),
        endurance('sp-2c', 'Engine', 40, 0.64),
      ]),
      wk('Week 3', 'Anaerobic speed endurance, then very short jumps, then an easy aerobic ride.', [
        bursts('sp-3a', 'Speed endurance', 'Anaerobic', 8, 30, 3 * 60, 1.5, 'Thirty seconds. This is the effort that dies in the last ten if you start too fast.', 'Eight thirties with three minutes rest. Hard, and still a sprint.'),
        bursts('sp-3b', 'Tens', 'Sprint', 10, 10, 3 * 60, 2, 'Ten seconds. Maximum jump.', 'Ten jumps of ten seconds. Rest until you want the next one.'),
        endurance('sp-3c', 'Engine', 35, 0.62),
      ]),
      wk('Week 4', 'The fastest week: twenties, strength, and a last set of twelves.', [
        bursts('sp-4a', 'Twenties', 'Sprint', 6, 20, 3 * 60, 1.8, 'Twenty seconds. A long sprint. Pace the first five so the last five still move.', 'Six twenties. This is a long sprint. Commit, and stop when the time is up.'),
        torque('sp-4b', 'Last strength', 4, 3, 0.86),
        bursts('sp-4c', 'Closing twelves', 'Sprint', 8, 12, 3 * 60, 1.95, 'The last sprints of the plan. Make them clean.', 'Eight twelves to finish. Then take an easy week.'),
      ]),
    ],
  },
  {
    id: 'all-rounder',
    name: 'All-rounder',
    group: 'rider',
    level: 'Intermediate',
    who: 'A rider who races a bit of everything and does not want to specialise yet.',
    goal: 'Six weeks. Each build week has endurance, a sustained day, a hard day, and something short and fast. Week 4 is the easier week. You come out able to climb, time-trial and sprint a little, which is what an all-rounder actually needs.',
    weeks: [
      wk('Week 1', 'Touch every system once. Nothing is at full dose yet.', [
        endurance('ar-1a', 'Aerobic', 40),
        sweet('ar-1b', 'Sweet spot', 2, 10, 4, 0.9),
        vo2('ar-1c', 'Four by three', 4, 3 * 60, 3 * 60),
        bursts('ar-1d', 'Six jumps', 'Sprint', 6, 12, 3 * 60, 1.8, 'A small sprint day. Fresh jumps, then stop.', 'Six twelves so the snap does not disappear while you build.'),
      ]),
      wk('Week 2', 'The sustained day moves toward threshold. The VO2 day stays.', [
        endurance('ar-2a', 'Aerobic', 45),
        threshold('ar-2b', 'Two by eight', 2, 8, 5),
        vo2('ar-2c', 'Five by three', 5, 3 * 60, 3 * 60),
        bursts('ar-2d', 'Surges', 'Attacks', 8, 40, 80, 1.35, 'Forty seconds hard. A punch, not a sprint.', 'Eight forties. The all-rounder version of a short climb.'),
      ]),
      wk('Week 3', 'The big mixed week. Fuel the long ride and respect the VO2 day.', [
        endurance('ar-3a', 'Long aerobic', 60),
        sweet('ar-3b', 'Two by fifteen', 2, 15, 5),
        vo2('ar-3c', 'Five by four', 5, 4 * 60, 4 * 60, 1.12),
        bursts('ar-3d', 'Jumps', 'Sprint', 8, 12, 3 * 60, 1.85, 'Jump.', 'Eight fresh sprints after a hard week. Full rest.'),
      ]),
      wk('Week 4', 'Shorter. One modest sweet-spot day, two easy rides.', [
        endurance('ar-4a', 'Aerobic', 35, 0.62),
        sweet('ar-4b', 'Two by eight', 2, 8, 4, 0.9),
        recovery('ar-4c', 'Down', 20),
      ], true),
      wk('Week 5', 'Over-unders for pacing, VO2 again, and a few sprints.', [
        endurance('ar-5a', 'Aerobic', 50),
        overUnder('ar-5b', 'Four over-unders', 4),
        vo2('ar-5c', 'Five by three', 5, 3 * 60, 3 * 60),
        bursts('ar-5d', 'Jumps', 'Sprint', 6, 15, 3 * 60, 1.8, 'Fifteen seconds.', 'Six fifteens. Keep them sharp.'),
      ]),
      wk('Week 6', 'A threshold day, a last VO2 session, and an easier aerobic close.', [
        endurance('ar-6a', 'Aerobic', 45),
        threshold('ar-6b', 'Three by eight', 3, 8, 5),
        vo2('ar-6c', 'Four by four', 4, 4 * 60, 4 * 60),
        endurance('ar-6d', 'Easy close', 30, 0.6),
      ]),
    ],
  },
  {
    id: 'masters',
    name: 'Masters',
    group: 'rider',
    level: 'Intermediate',
    who: 'Riders over 50 who want a real plan, with two days a week and sessions that stay under an hour.',
    goal: 'Six weeks, twelve sessions, in the shape of the Rouvy masters plan. Endurance and cadence first, then short VO2, strength, and finally threshold. Week 4 is easier. Leave a rest day between the two rides. The week after the plan is easy spinning at a comfortable cadence.',
    weeks: [
      wk('Week 1', 'Ease in. Low and middle intensity, plus a cadence day so the neuromuscular system wakes up without a long hard ride.', [
        spin('ma-1a', 'Easy money', 35, 0.6, 'Thirty-five easy minutes. The plan starts gently on purpose.'),
        cadenceDrill('ma-1b', 'Cadence and base'),
      ]),
      wk('Week 2', 'Short VO2 efforts, then an aerobic ride. The repeats are short so the dose stays reasonable.', [
        vo2('ma-2a', 'Four by two', 4, 2 * 60, 3 * 60, 1.12, 'Two minutes. Hard, and stop while your form is still good.'),
        endurance('ma-2b', 'Aerobic', 25, 0.64, 'Aerobic support. Keep it inside an hour including the warm-up.'),
      ]),
      wk('Week 3', 'Strength through cadence, and a little more oxygen work.', [
        torque('ma-3a', 'Strength turns', 4, 2, 0.8),
        vo2('ma-3b', 'Five by two', 5, 2 * 60, 3 * 60, 1.12, 'Two minutes again, one more repeat than last week.'),
      ]),
      wk('Week 4', 'The easier week. Two soft rides. Do not fill the gap with a hard group ride.', [
        recovery('ma-4a', 'Soft', 22),
        spin('ma-4b', 'Easy spin', 30, 0.58, 'Keep the habit. Leave the intensity for next week.'),
      ], true),
      wk('Week 5', 'Threshold, in pieces you can repeat. This is where the FTP work lives.', [
        threshold('ma-5a', 'Three by five', 3, 5, 4, 0.98),
        endurance('ma-5b', 'Aerobic', 30, 0.64),
      ]),
      wk('Week 6', 'A last threshold workout and a short sweet-spot day. Then an easy week outdoors or indoors, zone 2 only.', [
        threshold('ma-6a', 'Two by eight', 2, 8, 5, 0.98),
        sweet('ma-6b', 'Two by eight', 2, 8, 4, 0.9, C.mid, true, 'Sweet spot to close. Strong, and still something left at the end.'),
      ]),
    ],
  },
  {
    id: 'gran-fondo',
    name: 'Gran Fondo',
    group: 'event',
    level: 'Intermediate',
    who: 'A rider preparing for a long day: a gran fondo, a sportive, or a big club ride.',
    goal: 'Eight weeks. The long aerobic ride grows, sweet spot teaches you to hold a strong pace for a long time, and weeks 4 and 8 are shorter. Eat on every ride that passes an hour. The fondo is won by the rider who is still pedalling at the end.',
    weeks: [
      wk('Week 1', 'Set the routine: one long ride, one sweet-spot ride, one easy ride.', [
        endurance('gf-1a', 'Long ride', 50, 0.64, 'The first long ride. Practise drinking on a schedule.'),
        sweet('gf-1b', 'Sweet spot', 2, 10, 4, 0.9),
        endurance('gf-1c', 'Easy', 35, 0.6),
      ]),
      wk('Week 2', 'The long ride steps up. Sweet spot gets a little longer.', [
        endurance('gf-2a', 'Long ride', 65, 0.65, 'Start eating on this one. A little, early.'),
        sweet('gf-2b', 'Two by twelve', 2, 12, 4),
        endurance('gf-2c', 'Easy', 40, 0.62),
      ]),
      wk('Week 3', 'The biggest week before the first rest. The long ride is the workout.', [
        endurance('gf-3a', 'Long ride', 80, 0.65, 'This is the rehearsal. Fuel, cadence, and patience.'),
        sweet('gf-3b', 'Two by fifteen', 2, 15, 5, 0.9),
        endurance('gf-3c', 'Easy', 40, 0.62),
      ]),
      wk('Week 4', 'Shorter long ride, an easy day, and a small sweet-spot reminder.', [
        endurance('gf-4a', 'Medium ride', 40, 0.62),
        recovery('gf-4b', 'Soft', 22),
        sweet('gf-4c', 'Two by eight', 2, 8, 4, 0.9),
      ], true),
      wk('Week 5', 'Build again. The long ride comes back, still shy of week 3 so you can add more next week.', [
        endurance('gf-5a', 'Long ride', 75, 0.65),
        sweet('gf-5b', 'Two by fifteen', 2, 15, 5, 0.91),
        endurance('gf-5c', 'Easy', 45, 0.62),
      ]),
      wk('Week 6', 'The long ride passes the old peak. Sweet spot goes to twenty minutes.', [
        endurance('gf-6a', 'Long ride', 90, 0.65, 'Ninety minutes of work plus the warm-up. Eat. This is fondo pace practice.'),
        sweet('gf-6b', 'Two by twenty', 2, 20, 5, 0.9),
        endurance('gf-6c', 'Easy', 40, 0.62),
      ]),
      wk('Week 7', 'The longest week. If this ride goes well, the event is inside what you have trained.', [
        endurance('gf-7a', 'Long ride', 100, 0.66, 'The longest ride of the plan. Start easier than you want to.'),
        sweet('gf-7b', 'Two by twenty', 2, 20, 5, 0.91),
        endurance('gf-7c', 'Easy', 45, 0.6),
      ]),
      wk('Week 8', 'Ease down into the event. Fresh beats fit-and-tired.', [
        endurance('gf-8a', 'Medium ride', 45, 0.62),
        recovery('gf-8b', 'Soft', 20),
        openers('gf-8c', 'Day before'),
      ], true),
    ],
  },
  {
    id: 'race-peak',
    name: 'Race Peak',
    group: 'event',
    level: 'Advanced',
    who: 'A rider who already has fitness and has a race, a hill-climb, or a hard event inside a month.',
    goal: 'Four weeks of sharpening. The work stays intense and the minutes come down, so you arrive fresh. Week 4 is the taper: an easy ride, openers, and a short aerobic spin. Do the openers the day before you race.',
    weeks: [
      wk('Week 1', 'Threshold and VO2, with an aerobic ride between them. This is still a training week.', [
        threshold('pk-1a', 'Three by six', 3, 6, 4),
        endurance('pk-1b', 'Aerobic', 40, 0.64),
        vo2('pk-1c', 'Four by three', 4, 3 * 60, 3 * 60),
      ]),
      wk('Week 2', 'A little more intensity, a little less junk volume.', [
        vo2('pk-2a', 'Five by three', 5, 3 * 60, 3 * 60),
        threshold('pk-2b', 'Two by eight', 2, 8, 5),
        endurance('pk-2c', 'Aerobic', 35, 0.62),
      ]),
      wk('Week 3', 'Sharpen. Shorter VO2, a ten-minute time-trial piece, and a moderate aerobic ride.', [
        vo2('pk-3a', 'Four by two', 4, 2 * 60, 2 * 60, 1.18, 'Two minutes, high. These are race openers with a little more meat.'),
        ttPiece('pk-3b', 'Ten at pace', 10, 2),
        endurance('pk-3c', 'Aerobic', 40, 0.62),
      ]),
      wk('Week 4', 'Taper. The fitness is already there. This week just lets you feel it.', [
        recovery('pk-4a', 'Soft', 20),
        openers('pk-4b', 'Day before'),
        endurance('pk-4c', 'Shakeout', 25, 0.6, 'The day after openers, or two days out. Easy, and stop.'),
      ], true),
    ],
  },
  {
    id: 'triathlon-bike',
    name: 'Triathlon Bike',
    group: 'event',
    level: 'Intermediate',
    who: 'A triathlete who needs a stronger bike leg and still wants to run after it.',
    goal: 'Six weeks of steady riding. The work is endurance, tempo and sweet spot, with one short VO2 session late in the plan. There are no sprint days, so the run still has legs. Week 4 is easier. Ride the day after a hard run as the easy bike, or swap the days.',
    weeks: [
      wk('Week 1', 'Aerobic and a first tempo. Get used to holding a number on the bike.', [
        endurance('tri-1a', 'Aerobic', 40, 0.64),
        tempo('tri-1b', 'Three by eight', 3, 8, 4, 0.8, C.mid, false),
        endurance('tri-1c', 'Easy spin', 30, 0.6),
      ]),
      wk('Week 2', 'Sweet spot arrives in ten-minute pieces. Tempo gets a little longer.', [
        endurance('tri-2a', 'Aerobic', 45, 0.65),
        sweet('tri-2b', 'Two by ten', 2, 10, 4, 0.9),
        tempo('tri-2c', 'Three by ten', 3, 10, 4, 0.82),
      ]),
      wk('Week 3', 'The biggest bike week. Long aerobic, longer sweet spot, a sustained tempo.', [
        endurance('tri-3a', 'Long ride', 60, 0.65, 'Practise the fuel you will use on race day. The run will want it too.'),
        sweet('tri-3b', 'Two by fifteen', 2, 15, 5, 0.9),
        tempo('tri-3c', 'Two by fifteen', 2, 15, 5, 0.84),
      ]),
      wk('Week 4', 'Easier bike week. If the run plan is heavy, this is the week that saves you.', [
        endurance('tri-4a', 'Aerobic', 30, 0.62),
        recovery('tri-4b', 'Soft', 18),
        tempo('tri-4c', 'Two by six', 2, 6, 4, 0.8, C.mid, false),
      ], true),
      wk('Week 5', 'One VO2 session, short enough that the run the next day is still possible. The rest of the week is steady.', [
        endurance('tri-5a', 'Aerobic', 50, 0.65),
        sweet('tri-5b', 'Two by twelve', 2, 12, 4, 0.9),
        vo2('tri-5c', 'Four by three', 4, 3 * 60, 3 * 60, 1.12, 'Controlled VO2. Sit, breathe, and do not turn it into a sprint.'),
      ]),
      wk('Week 6', 'Settle. Aerobic, a last sweet-spot ride, and tempo. Then race, or go back to maintenance.', [
        endurance('tri-6a', 'Aerobic', 45, 0.64),
        sweet('tri-6b', 'Two by ten', 2, 10, 4, 0.9),
        tempo('tri-6c', 'Three by eight', 3, 8, 4, 0.82),
      ]),
    ],
  },
  {
    id: 'gravel',
    name: 'Gravel Day',
    group: 'event',
    level: 'Intermediate',
    who: 'A rider preparing for a long gravel ride: hours of endurance, a few steep punches, and some strength in a big gear.',
    goal: 'Six weeks. The long ride is the spine. Low-cadence strength stands in for loose steep pitches, and short surges stand in for the moment the road kicks. Week 4 is easier. Eat on the long rides the way you will on the day.',
    weeks: [
      wk('Week 1', 'Endurance, a first strength day, and short surges.', [
        endurance('gv-1a', 'Long ride', 45, 0.64),
        torque('gv-1b', 'Loose-climb strength', 4, 3, 0.82),
        bursts('gv-1c', 'Little kicks', 'Attacks', 8, 30, 90, 1.3, 'Thirty seconds. Like a short ramp out of a corner.', 'Eight thirties. Sit back down and finish them smoothly.', C.mid),
      ]),
      wk('Week 2', 'The long ride grows. Strength and surges get a small bump.', [
        endurance('gv-2a', 'Long ride', 60, 0.65),
        torque('gv-2b', 'Strength', 5, 3, 0.84),
        bursts('gv-2c', 'Forties', 'Attacks', 10, 40, 80, 1.28, 'Forty seconds. A gravel pinch.', 'Ten forties with a short rest. This is a rolling road.', C.mid),
      ]),
      wk('Week 3', 'The long week. Sweet spot for the pace you will hold for hours, plus longer surges.', [
        endurance('gv-3a', 'Long ride', 75, 0.65, 'Practise eating. Gravel days go wrong when the food goes wrong.'),
        sweet('gv-3b', 'Pace', 2, 12, 4, 0.9),
        bursts('gv-3c', 'Minute kicks', 'Attacks', 8, 60, 90, 1.22, 'One minute. A steeper pitch.', 'Eight one-minute surges. Then spin.', C.mid),
      ]),
      wk('Week 4', 'Shorter. Keep a little strength so the feeling stays, and let the hours come down.', [
        endurance('gv-4a', 'Medium', 35, 0.62),
        recovery('gv-4b', 'Soft', 20),
        torque('gv-4c', 'Short strength', 4, 2, 0.8),
      ], true),
      wk('Week 5', 'Hours back, sweet spot longer, surges still there.', [
        endurance('gv-5a', 'Long ride', 70, 0.65),
        sweet('gv-5b', 'Two by fifteen', 2, 15, 5, 0.9),
        bursts('gv-5c', 'Minute kicks', 'Attacks', 8, 60, 90, 1.25, 'One minute again.', 'Eight surges. Strong, and save a little.', C.mid),
      ]),
      wk('Week 6', 'The longest ride, a last set of surges, and sweet spot so the race pace is familiar.', [
        endurance('gv-6a', 'Long ride', 85, 0.66, 'Dress rehearsal. Same food, same cadence, same patience at the start.'),
        bursts('gv-6b', 'Last kicks', 'Attacks', 10, 45, 75, 1.25, 'Forty-five seconds.', 'Ten efforts. Then you are ready to ease into the event.', C.mid),
        sweet('gv-6c', 'Pace', 2, 12, 4, 0.9),
      ]),
    ],
  },
  {
    id: 'in-season',
    name: 'In Season',
    group: 'keep',
    level: 'Intermediate',
    who: 'A rider who is already fit and racing, and wants to hold that fitness without starting another build.',
    goal: 'Four weeks you can ride again next month. One aerobic ride, one hard day, one easy day. The hard day rotates: sweet spot, VO2max, threshold, then openers. Week 4 is the lighter week. When a month has a race, swap the openers onto the day before it.',
    weeks: [
      wk('Week 1', 'Sweet spot is the hard day. Enough to keep threshold honest.', [
        endurance('is-1a', 'Aerobic', 45, 0.64),
        sweet('is-1b', 'Two by ten', 2, 10, 4, 0.91),
        recovery('is-1c', 'Easy', 22),
      ]),
      wk('Week 2', 'VO2max is the hard day. The aerobic ride stays the same length so life can stay the same.', [
        endurance('is-2a', 'Aerobic', 45, 0.64),
        vo2('is-2b', 'Five by three', 5, 3 * 60, 3 * 60),
        recovery('is-2c', 'Easy', 22),
      ]),
      wk('Week 3', 'Threshold. Two eights are enough when you are also racing.', [
        endurance('is-3a', 'Aerobic', 50, 0.64),
        threshold('is-3b', 'Two by eight', 2, 8, 5),
        recovery('is-3c', 'Easy', 22),
      ]),
      wk('Week 4', 'The lighter week. Openers if you have a race, or just to keep the snap. Then repeat the plan, or take a bigger rest.', [
        endurance('is-4a', 'Aerobic', 35, 0.62),
        openers('is-4b', 'Openers'),
        recovery('is-4c', 'Easy', 18),
      ], true),
    ],
  },
];

export interface PlanStats {
  weeks: number;
  workouts: number;
  minSec: number;
  maxSec: number;
  avgTss: number;
  hoursLabel: string;
}

export function weekSeconds(week: PlanWeek): number {
  return week.workouts.reduce((sum, workout) => sum + durationSec(expandBlocks(workout.blocks)), 0);
}

function hoursPhrase(sec: number): string {
  const hours = sec / 3600;
  if (hours < 1) return `${Math.round(sec / 60)} min`;
  const quarter = Math.round(hours * 2) / 2;
  return Number.isInteger(quarter) ? `${quarter} h` : `${quarter.toFixed(1)} h`;
}

export function planStats(plan: TrainingPlan): PlanStats {
  const secs = plan.weeks.map(weekSeconds);
  const tss = plan.weeks.map((week) =>
    week.workouts.reduce((sum, workout) => sum + prescribedLoad(expandBlocks(workout.blocks)).tss, 0),
  );
  const minSec = Math.min(...secs);
  const maxSec = Math.max(...secs);
  return {
    weeks: plan.weeks.length,
    workouts: plan.weeks.reduce((n, week) => n + week.workouts.length, 0),
    minSec,
    maxSec,
    avgTss: tss.reduce((a, b) => a + b, 0) / tss.length,
    hoursLabel: minSec === maxSec ? `About ${hoursPhrase(minSec)} a week` : `${hoursPhrase(minSec)} to ${hoursPhrase(maxSec)} a week`,
  };
}

export const FTP_TEST_PLAN: TrainingPlan = {
  id: 'ftp-test',
  name: 'FTP Test',
  group: 'start',
  level: 'Intermediate',
  who: 'Any rider who wants a measured FTP instead of the number typed at sign-in.',
  goal: 'Warm up, ride 20 minutes as hard as you can hold, then cool down. FTP is 95% of the average power from those 20 minutes. Finishing the test replaces the FTP on your profile. Every finished test is kept on this screen.',
  weeks: [
    wk('The test', 'The warm-up and the cool-down are easy. Only the 20 minutes count toward the FTP.', [
      W(
        'ftp-20',
        '20-minute FTP test',
        'FTP test',
        'Eight minutes to warm up, then 20 minutes as hard as you can hold, then an easy spin. The trainer does not hold a target during the 20 minutes. Your FTP becomes 95% of the average power.',
        [
          ramp(6 * 60, 0.45, 0.65, 'Warm up. Easy spin, then a little more pressure.', C.easy),
          steady(2 * 60, 0.55, 'Shake the legs out. The 20 minutes start next.', C.easy),
          { kind: 'max', sec: 20 * 60, text: '20 minutes. As hard as you can hold, right to the end.', cadence: 'Your own cadence' },
          ...cd(5),
        ],
        'twenty',
      ),
    ]),
  ],
};

export function planById(id: string): TrainingPlan | undefined {
  if (id === FTP_TEST_PLAN.id) return FTP_TEST_PLAN;
  return PLANS.find((plan) => plan.id === id);
}

export function flattenWorkouts(plan: TrainingPlan): { weekNumber: number; week: PlanWeek; workout: Workout }[] {
  return plan.weeks.flatMap((week, index) => week.workouts.map((workout) => ({ weekNumber: index + 1, week, workout })));
}

export function nextWorkout(plan: TrainingPlan, done: Set<string>): { weekNumber: number; workout: Workout } | null {
  for (const item of flattenWorkouts(plan)) {
    if (!done.has(`${plan.id}/${item.workout.id}`)) return { weekNumber: item.weekNumber, workout: item.workout };
  }
  return null;
}

export function activateWorkout(plan: TrainingPlan, workout: Workout): ActiveWorkout {
  const steps = expandBlocks(workout.blocks);
  return {
    planId: plan.id,
    planName: plan.name,
    workoutId: workout.id,
    workoutName: workout.name,
    focus: workout.focus,
    ftpTest: Boolean(workout.ftpTest),
    ftpProtocol: workout.ftpTest ?? null,
    steps,
    durationSec: durationSec(steps),
  };
}

export function workoutPeakWatts(workout: Workout, ftp: number): number {
  return Math.round(peakPct(expandBlocks(workout.blocks)) * ftp);
}
