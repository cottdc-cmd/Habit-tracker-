// The "Sync now" button on the dashboard.
import { runSync } from '../lib/sync.mjs';
import { json, checkPasscode, unauthorized, safe } from '../lib/http.mjs';

export default safe(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  if (!checkPasscode(req)) return unauthorized();
  return json(await runSync());
});

export const config = { path: '/api/sync' };
