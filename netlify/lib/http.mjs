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
