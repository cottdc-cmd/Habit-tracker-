// Once a night, re-totals older star rows so the tablet's morning load is quick.
// 08:00 UTC = 3–4am Eastern. If it ever misses, the first load of the day does it instead.
import { refreshOlderTotals } from '../lib/stars/service.mjs';

export default async () => {
  const r = await refreshOlderTotals();
  console.log(`Stars: totals before ${r.cutoff}`, r.totals);
};

export const config = { schedule: '0 8 * * *' };
