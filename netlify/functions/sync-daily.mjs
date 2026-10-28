// Runs once a day by itself. 10:00 UTC = 6am Eastern / 3am Pacific,
// after last night's sleep and readiness scores have landed.
import { runSync } from '../lib/sync.mjs';

export default async () => {
  const result = await runSync();
  console.log(`Daily sync: ${result.wins.length} new wins`, result.errors);
};

export const config = { schedule: '0 10 * * *' };
