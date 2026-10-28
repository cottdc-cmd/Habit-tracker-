// All "day keys" are YYYY-MM-DD strings in the user's timezone.

export const timezone = () => process.env.TIMEZONE || 'America/New_York';

export function dayKey(date = new Date(), tz = timezone()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}

export function addDays(key, n) {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Weeks start on Monday.
export function weekStart(key) {
  const dow = (new Date(`${key}T12:00:00Z`).getUTCDay() + 6) % 7;
  return addDays(key, -dow);
}

export function daysBetween(start, end) {
  const out = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}
