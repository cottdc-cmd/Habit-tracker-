// Apple Health lands here (Health Auto Export app or an iOS Shortcut).
import { parseHealth } from '../lib/health.mjs';
import { applyDays } from '../lib/sync.mjs';
import { json, checkWebhookKey, safe } from '../lib/http.mjs';

export default safe(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  if (!checkWebhookKey(req)) return json({ error: 'Bad key' }, 401);
  const days = parseHealth(await req.json());
  const wins = await applyDays(days, 'Apple Health');
  return json({ ok: true, days: days.length, wins });
});

export const config = { path: '/api/health' };
