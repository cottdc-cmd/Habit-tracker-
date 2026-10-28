import { getStore } from '@netlify/blobs';
import { getHabits, getLogs, getStats, periodDays } from '../lib/data.mjs';
import { cycleInfo } from '../lib/cycle.mjs';
import { summarize } from '../lib/summary.mjs';
import { dayKey, addDays } from '../lib/dates.mjs';
import { json, checkPasscode, unauthorized } from '../lib/http.mjs';

export default async (req) => {
  if (!checkPasscode(req)) return unauthorized();
  const today = dayKey();
  const [habits, logs, stats, lastSync] = await Promise.all([
    getHabits(),
    getLogs(addDays(today, -365)),
    getStats(addDays(today, -120)),
    getStore('meta').get('last-sync', { type: 'json' }),
  ]);
  // Show today's body stats, or yesterday's if today's haven't landed yet.
  const todayStats = stats.get(today) || stats.get(addDays(today, -1)) || null;
  const cycle = cycleInfo(periodDays(stats), today);
  return json({ ...summarize({ habits, logs, today, stats: todayStats }), cycle, lastSync });
};

export const config = { path: '/api/dashboard' };
