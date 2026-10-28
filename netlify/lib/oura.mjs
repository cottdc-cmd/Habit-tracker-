// Oura API v2. Uses OAuth (tokens kept in Netlify Blobs so refreshes survive).

import { getStore } from '@netlify/blobs';
import { workoutKey } from './workouts.mjs';

const API = 'https://api.ouraring.com/v2/usercollection';
const TOKEN_URL = 'https://api.ouraring.com/oauth/token';
export const AUTHORIZE_URL = 'https://cloud.ouraring.com/oauth/authorize';
export const SCOPES = 'daily workout personal';

const store = () => getStore('oura-auth');

async function saveTokens(json) {
  const tokens = {
    access_token: json.access_token,
    refresh_token: json.refresh_token,
    expires_at: Date.now() + (json.expires_in || 86400) * 1000,
  };
  await store().setJSON('tokens', tokens);
  return tokens;
}

async function tokenRequest(params) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.OURA_CLIENT_ID,
      client_secret: process.env.OURA_CLIENT_SECRET,
      ...params,
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Oura auth failed: ${json.error_description || json.error || res.status}`);
  return saveTokens(json);
}

export const exchangeCode = (code, redirectUri) =>
  tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri });

async function accessToken() {
  const saved = await store().get('tokens', { type: 'json' });
  if (saved) {
    if (Date.now() < saved.expires_at - 60_000) return saved.access_token;
    return (await tokenRequest({ grant_type: 'refresh_token', refresh_token: saved.refresh_token })).access_token;
  }
  if (process.env.OURA_PERSONAL_TOKEN) return process.env.OURA_PERSONAL_TOKEN;
  throw new Error('Oura not connected yet. Open /api/oura-connect once.');
}

export async function isConnected() {
  return !!(process.env.OURA_PERSONAL_TOKEN || (await store().get('tokens')));
}

async function get(token, path, start, end) {
  const url = `${API}/${path}?start_date=${start}&end_date=${end}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Oura ${path}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()).data || [];
  console.log(`Oura ${path} ${start}..${end}: ${data.length} records`);
  return data;
}

// Returns { 'YYYY-MM-DD': { date, sleep_score, readiness, ..., workouts: [] } }
export async function fetchOura(start, end, endExclusive) {
  const token = await accessToken();
  const [sleep, readiness, activity, workouts] = await Promise.all([
    get(token, 'daily_sleep', start, end),
    get(token, 'daily_readiness', start, end),
    get(token, 'daily_activity', start, endExclusive),
    get(token, 'workout', start, end),
  ]);

  const days = {};
  const day = (d) => (days[d] ||= { date: d, workouts: [] });

  for (const s of sleep) day(s.day).sleep_score = s.score;
  for (const r of readiness) day(r.day).readiness = r.score;
  for (const a of activity) {
    if (a.day > end) continue;
    Object.assign(day(a.day), {
      activity_score: a.score,
      steps: a.steps,
      active_calories: a.active_calories,
      exercise_minutes: Math.round(((a.high_activity_time || 0) + (a.medium_activity_time || 0)) / 60),
    });
  }
  for (const w of workouts) {
    const minutes = Math.round((new Date(w.end_datetime) - new Date(w.start_datetime)) / 60000);
    day(w.day).workouts.push({
      key: workoutKey(w.start_datetime),
      name: prettify(w.label || w.activity),
      minutes,
      source: 'Oura',
    });
  }
  return days;
}

const prettify = (s) => String(s || 'Workout').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
