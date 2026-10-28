// The same workout often arrives from both Apple Health and Oura.
// Keying on start time rounded to 10 minutes lets us count it once.
export function workoutKey(start) {
  const t = new Date(start).getTime();
  if (Number.isNaN(t)) return `t${start}`;
  return `t${Math.round(t / 600_000)}`;
}
