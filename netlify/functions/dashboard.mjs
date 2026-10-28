import { getStore } from '@netlify/blobs';
import { getHabits, getLogs, getStats, periodDays } from '../lib/data.mjs';
import { cycleInfo } from '../lib/cycle.mjs';
import { summarize } from '../lib/summary.mjs';
import { dayKey, addDays } from '../lib/dates.mjs';
import { json, checkPasscode, unauthorized, safe } from '../lib/http.mjs';

export default safe(async (req) => {
  if (!checkPasscode(req)) return unauthorized();
  const today = dayKey();
  const [habits, logs, stats, lastSync] = await Promise.all([
    getHabits(),
    getLogs(addDays(today, -365)),
    getStats(addDays(today, -120)),
    readLastSync(),
  ]);
  // Show today's body stats, or yesterday's if today's haven't landed yet.
  const todayStats = stats.get(today) || stats.get(addDays(today, -1)) || null;
  const cycle = cycleInfo(periodDays(stats), today);
  return json({ ...summarize({ habits, logs, today, stats: todayStats }), cycle, lastSync });
});

// "Last synced" is nice to have; never let it break the dashboard.
async function readLastSync() {
  try { return await getStore('meta').get('last-sync', { type: 'json' }); }
  catch { return null; }
}

export const config = { path: '/api/dashboard' };
