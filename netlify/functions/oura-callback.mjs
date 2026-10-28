import { exchangeCode } from '../lib/oura.mjs';
import { runSync } from '../lib/sync.mjs';
import { checkState } from '../lib/http.mjs';

const page = (msg) => new Response(
  `<!doctype html><meta name="viewport" content="width=device-width"><body style="font:18px system-ui;padding:40px;text-align:center;background:#f6f1e9">${msg}<p><a href="/">Back to my dashboard</a></p>`,
  { headers: { 'Content-Type': 'text/html' } },
);

export default async (req) => {
  const params = new URL(req.url).searchParams;
  if (!checkState(params.get('state'))) return page(`That link didn't come from your dashboard. Try again from /api/oura-connect.`);
  if (!params.get('code')) return page(`Oura didn't connect: ${params.get('error') || 'no code returned'}`);
  try {
    await exchangeCode(params.get('code'), new URL('/api/oura-callback', req.url).toString());
    const { wins } = await runSync();
    return page(`<h1>💍 Oura connected!</h1><p>First sync found ${wins.length} win${wins.length === 1 ? '' : 's'}.</p>`);
  } catch (e) {
    return page(`Oura didn't connect: ${e.message}`);
  }
};

export const config = { path: '/api/oura-callback' };
