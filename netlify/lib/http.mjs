import { timingSafeEqual, createHash } from 'node:crypto';

export const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

function safeEqual(a, b) {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

// Dashboard calls send the passcode in a header.
export function checkPasscode(req) {
  return safeEqual(req.headers.get('x-passcode'), process.env.DASHBOARD_PASSCODE);
}

// The Apple Health webhook sends its key as a header or ?key= query param.
export function checkWebhookKey(req) {
  const key = req.headers.get('x-webhook-key') || new URL(req.url).searchParams.get('key');
  return safeEqual(key, process.env.HEALTH_WEBHOOK_KEY);
}

export const unauthorized = () => json({ error: 'Wrong passcode' }, 401);

// Used as the OAuth "state" so only someone with the passcode can link Oura.
export const oauthState = () =>
  createHash('sha256').update(`oura:${process.env.DASHBOARD_PASSCODE || ''}`).digest('hex').slice(0, 32);
export const checkState = (s) => safeEqual(s, oauthState());

// Wraps a function so any crash comes back as a readable message
// (shown on the dashboard) instead of a bare 502.
export const safe = (fn) => async (req, ctx) => {
  try {
    return await fn(req, ctx);
  } catch (e) {
    console.error(e);
    let msg = e.message || String(e);
    if (/Could not find database|shared with your integration/i.test(msg)) {
      msg = 'Notion is blocking the app. In Notion, open the Little Wins page → ••• → Connections → add your integration.';
    } else if (/Missing env var/i.test(msg)) {
      msg = `${msg}. Add it in Netlify, then redeploy.`;
    }
    return json({ error: msg }, 500);
  }
};
