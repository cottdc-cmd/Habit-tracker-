// Manual tap from the dashboard: mark (or un-mark) a habit for a day.
import { getHabits, markDone, unmark, existingLogMap } from '../lib/data.mjs';
import { dayKey } from '../lib/dates.mjs';
import { json, checkPasscode, unauthorized } from '../lib/http.mjs';

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  if (!checkPasscode(req)) return unauthorized();
  const { habitId, date = dayKey(), undo = false } = await req.json();
  if (undo) return json(await unmark(habitId, date));
  const habit = (await getHabits()).find((h) => h.id === habitId);
  if (!habit) return json({ error: 'Unknown habit' }, 404);
  return json(await markDone(habit, date, 'Manual', 'You did it', await existingLogMap(date)));
};

export const config = { path: '/api/checkin' };
