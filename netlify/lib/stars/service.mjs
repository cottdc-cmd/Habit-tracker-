// Star chart service: reads state and applies taps. Talks only to `store`.

import { getStore } from '@netlify/blobs';
import { store } from './store.mjs';
import { buildState, planOp, newlyReady, userError } from './logic.mjs';
import { dayKey, addDays, timezone } from '../dates.mjs';

// Rows from the last RECENT_DAYS are read live on every load.
// Everything older is summed once a day and cached, so loads stay fast for years.
const RECENT_DAYS = 14;
const CACHE_KEY = 'older-sum';
const cache = () => getStore('stars');

async function readCache() {
  try { return await cache().get(CACHE_KEY, { type: 'json' }); } catch { return null; }
}

export async function refreshOlderSum(today = dayKey()) {
  const cutoff = addDays(today, -RECENT_DAYS);
  const sum = await store.sumBefore(cutoff);
  const value = { cutoff, sum, computedOn: today };
  try { await cache().setJSON(CACHE_KEY, value); } catch (e) { console.warn('stars cache write failed', e.message); }
  return value;
}

// Total of rows before the cutoff. Recomputed (full scan) at most once a day,
// so edits you make to old rows in Notion show up by the next morning.
async function olderSum(today) {
  const c = await readCache();
  if (c && c.computedOn === today) return c;
  return refreshOlderSum(today);
}

async function balanceNow(today) {
  const older = await olderSum(today);
  const recent = await store.getRows(older.cutoff);
  return { older, recent, balance: older.sum + recent.reduce((n, r) => n + (Number(r.stars) || 0), 0) };
}

export async function getState() {
  const today = dayKey();
  const [chores, rewards, { older, recent }, collected] = await Promise.all([
    store.getChores(), store.getRewards(), balanceNow(today), store.lastCollected(5),
  ]);
  return {
    ...buildState({ chores, rewards, olderSum: older.sum, recent, collected, today, timezone: timezone() }),
    name: process.env.STARS_CHILD_NAME || '',
  };
}

// Applies one tap. Safe to retry: every write has a unique Key and is skipped if it already exists.
export async function applyOp(op) {
  const today = dayKey();
  const [chores, rewards] = await Promise.all([store.getChores(), store.getRewards()]);
  const plan = planOp(op, { chores, rewards, today });

  if (plan.kind === 'remove') {
    const removed = await store.removeByKey(plan.key);
    return { ok: true, removed };
  }
  if (await store.findByKey(plan.row.key)) return { ok: true, duplicate: true };

  const { balance } = await balanceNow(today);
  if (plan.needs && balance < plan.needs) {
    throw userError(`Not enough stars for ${plan.row.name.replace(/^\S+\s/, '')} yet (${balance} of ${plan.needs}).`);
  }
  await store.addRow(plan.row);
  const after = balance + plan.row.stars;
  await notifyReady(newlyReady(rewards, balance, after), after);
  return { ok: true, balance: after };
}

// Optional push to your phone when a reward becomes affordable.
// Install the free ntfy app, subscribe to a hard-to-guess topic, set NTFY_TOPIC.
async function notifyReady(rewards, balance) {
  const topic = process.env.NTFY_TOPIC;
  if (!topic || !rewards.length) return;
  const who = process.env.STARS_CHILD_NAME || 'Your star';
  const list = rewards.map((r) => `${r.emoji} ${r.name} (${r.cost})`).join(', ');
  try {
    await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, {
      method: 'POST',
      headers: { Title: `${who} is ready for a prize!`, Tags: 'star,gift' },
      body: `${balance} stars. Ready for: ${list}. Hold the reward on the tablet to collect it.`,
      signal: AbortSignal.timeout(3000),
    });
  } catch (e) {
    console.warn('ntfy failed', e.message); // never blocks the star from saving
  }
}
