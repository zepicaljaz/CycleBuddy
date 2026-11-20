/** Workout keys saved on finished training rides, so the ticks follow the account. */
export function progressFromRides(
  rides: { mode: string; workout?: { planId?: string; workoutId?: string; completed?: boolean } | null }[],
): Set<string> {
  const done = new Set<string>();
  for (const ride of rides) {
    const workout = ride.workout;
    if (ride.mode === 'train' && workout?.completed && workout.planId && workout.workoutId) {
      done.add(`${workout.planId}/${workout.workoutId}`);
    }
  }
  return done;
}

export function workoutKey(planId: string, workoutId: string): string {
  return `${planId}/${workoutId}`;
}
