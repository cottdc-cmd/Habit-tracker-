// Star chart API for the wall tablet. No login: the tablet's kiosk link carries KIOSK_KEY.
//   GET  /api/stars        today's chart
//   POST /api/stars        one tap { id, type, date, choreId?, rewardId? }
import { timingSafeEqual } from 'node:crypto';
import { getState, applyOp } from '../lib/stars/service.mjs';
import { json } from '../lib/http.mjs';

function keyOk(req) {
  const a = Buffer.from(String(req.headers.get('x-kiosk-key') || ''));
  const b = Buffer.from(String(process.env.KIOSK_KEY || ''));
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

export default async (req) => {
  if (!process.env.KIOSK_KEY) return json({ error: 'Missing env var KIOSK_KEY. Add it in Netlify, then redeploy.' }, 500);
  if (!keyOk(req)) return json({ error: 'This link is missing the kiosk key.' }, 401);
  try {
    if (req.method === 'GET') return json(await getState());
    if (req.method === 'POST') return json(await applyOp(await req.json()));
    return json({ error: 'GET or POST only' }, 405);
  } catch (e) {
    console.error(e);
    let msg = e.message || String(e);
    if (/Could not find database|shared with your integration/i.test(msg)) {
      msg = 'Notion is blocking the star chart. Open the Star Chart page in Notion → ••• → Connections → add your integration.';
    } else if (/Missing env var/i.test(msg)) msg = `${msg}. Add it in Netlify, then redeploy.`;
    return json({ error: msg }, e.status || 500);
  }
};

export const config = { path: '/api/stars' };
