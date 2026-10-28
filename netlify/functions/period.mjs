// "Period today" tap on the dashboard. Also re-checks habits for that day,
// since a period day can complete "Rested when my body asked".
import { setPeriod } from '../lib/data.mjs';
import { applyDays } from '../lib/sync.mjs';
import { dayKey } from '../lib/dates.mjs';
import { json, checkPasscode, unauthorized, safe } from '../lib/http.mjs';

export default safe(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  if (!checkPasscode(req)) return unauthorized();
  const { date = dayKey(), on = true } = await req.json();
  await setPeriod(date, !!on);
  const wins = on ? await applyDays([{ date, workouts: [] }], 'Manual') : [];
  return json({ ok: true, wins });
});

export const config = { path: '/api/period' };
