// Open /api/oura-connect?passcode=YOUR_PASSCODE once to link your Oura account.
import { AUTHORIZE_URL, SCOPES } from '../lib/oura.mjs';
import { oauthState, checkPasscode, unauthorized } from '../lib/http.mjs';

export default async (req) => {
  const passcode = new URL(req.url).searchParams.get('passcode');
  if (!checkPasscode(new Request(req.url, { headers: { 'x-passcode': passcode || '' } }))) return unauthorized();
  const redirect = new URL('/api/oura-callback', req.url).toString();
  const url = new URL(AUTHORIZE_URL);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.OURA_CLIENT_ID,
    redirect_uri: redirect,
    scope: SCOPES,
    state: oauthState(),
  });
  return Response.redirect(url.toString(), 302);
};

export const config = { path: '/api/oura-connect' };
