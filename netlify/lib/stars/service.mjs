// Star + coin chart service: reads state and applies taps. Talks only to `store`.

import { getStore } from '@netlify/blobs';
import { store } from './store.mjs';
import {
  buildState, validateOp, newlyReady, userError, totals, addTotals, jarToRemoveFrom,
  checkKey, routineKey, routineComplete, ROUTINES, DELAY_NOTE, DONE_NOTE,
} from './logic.mjs';
import { dayKey, addDays, timezone } from '../dates.mjs';

// Rows from the last RECENT_DAYS are read live on every load.
// Everything older is totalled once a day and cached, so loads stay fast for years.
const RECENT_DAYS = 14;
const CACHE_KEY = 'older-totals-v2';
const cache = () => getStore('stars');

async function readCache() {
  try { return await cache().get(CACHE_KEY, { type: 'json' }); } catch { return null; }
}

export async function refreshOlderTotals(today = dayKey()) {
  const cutoff = addDays(today, -RECENT_DAYS);
  const value = { cutoff, totals: await store.totalsBefore(cutoff), computedOn: today };
  try { await cache().setJSON(CACHE_KEY, value); } catch (e) { console.warn('stars cache write failed', e.message); }
  return value;
}

// Recomputed (full scan) at most once a day, so edits you make to old rows in Notion show by morning.
async function olderTotals(today) {
  const c = await readCache();
  if (c && c.computedOn === today) return c;
  return refreshOlderTotals(today);
}

async function balances(today) {
  const older = await olderTotals(today);
  const recent = await store.getRows(older.cutoff);
  return { older, recent, now: addTotals(older.totals, totals(recent)) };
}

export async function getState() {
  const today = dayKey();
  const [tasks, prizes, items, { older, recent }, collected, toDeliver] = await Promise.all([
    store.getTasks(), store.getPrizes(), store.getStore(), balances(today), store.lastCollected(5), store.toDeliver(),
  ]);
  return {
    ...buildState({ tasks, prizes, store: items, older: older.totals, recent, collected, toDeliver, today, timezone: timezone() }),
    name: process.env.STARS_CHILD_NAME || '',
    morningGoal: process.env.STARS_MORNING_GOAL || 'Ready by 7:30',
  };
}

// Everything the admin screen edits, including hidden items.
export async function getLists() {
  const [tasks, prizes, items] = await Promise.all([store.getTasks(true), store.getPrizes(true), store.getStore(true)]);
  return { tasks, prizes, store: items };
}

export async function saveListItem({ list, id, fields }) {
  if (!['tasks', 'prizes', 'store'].includes(list)) throw userError('Unknown list.');
  if (!fields || typeof fields !== 'object') throw userError('Nothing to save.');
  if ('name' in fields && !String(fields.name).trim()) throw userError('Give it a name first.');
  await store.saveListItem(list, id || null, fields);
  return { ok: true };
}

// After a routine item changes: award the routine star when every item is done,
// take it back if an item is unchecked (unless grown-ups awarded it).
async function syncRoutine(tasks, group, date, prizes) {
  if (!ROUTINES.includes(group)) return;
  const rows = await store.getRows(date);
  const checked = rows.filter((r) => r.date === date && (r.type === 'Check' || r.type === 'Chore')).map((r) => r.taskId);
  const done = routineComplete(tasks, group, checked);
  const key = routineKey(group, date);
  const existing = rows.find((r) => r.key === key);
  if (done && !existing) {
    await store.addRow({ key, type: 'Routine', stars: 1, date, note: DONE_NOTE, name: `${group === 'Morning' ? '☀️' : '🏡'} ${group} routine` });
    await notifyIfReady(prizes, 1);
  } else if (!done && existing && existing.note !== DELAY_NOTE) {
    await store.removeByKey(key);
  }
}

// Applies one tap. Safe to retry: every write has a unique Key (or Placed id) and is skipped if it already exists.
export async function applyOp(op) {
  const today = dayKey();
  const [tasks, prizes, items] = await Promise.all([store.getTasks(), store.getPrizes(), store.getStore()]);
  const { task, prize, item } = validateOp(op, { tasks, prizes, store: items, today });
  const { date, id } = op;

  switch (op.type) {
    case 'check': {
      const key = checkKey(task.id, date);
      if (!(await store.findByKey(key))) {
        await store.addRow({
          key, type: 'Check', stars: 0, coins: task.coins, jar: task.coins > 0 ? 'Tray' : null,
          date, taskId: task.id, name: `${task.emoji} ${task.name}`,
        });
      }
      await syncRoutine(tasks, task.group, date, prizes);
      return { ok: true };
    }
    case 'uncheck': {
      await store.removeByKey(checkKey(task.id, date));
      await syncRoutine(tasks, task.group, date, prizes);
      return { ok: true };
    }
    case 'delay': {
      const key = routineKey(op.group, date);
      if (!(await store.findByKey(key))) {
        await store.addRow({ key, type: 'Routine', stars: 1, date, note: DELAY_NOTE, name: `🙋 ${op.group} routine (grown-ups were the delay)` });
        await notifyIfReady(prizes, 1);
      }
      return { ok: true };
    }
    case 'bonus': {
      const key = `bonus:${id}`;
      if (await store.findByKey(key)) return { ok: true, duplicate: true };
      await store.addRow({ key, type: 'Bonus', stars: 1, date, name: '⭐ Bonus star', note: op.note || '' });
      await notifyIfReady(prizes, 1);
      return { ok: true };
    }
    case 'removeStar': {
      const key = `remove-star:${id}`;
      if (await store.findByKey(key)) return { ok: true, duplicate: true };
      const { now } = await balances(today);
      if (now.stars < 1) throw userError('There are no stars to remove.');
      await store.addRow({ key, type: 'Removed', stars: -1, date, name: '➖ Star removed' });
      return { ok: true };
    }
    case 'removeCoin': {
      const key = `remove-coin:${id}`;
      if (await store.findByKey(key)) return { ok: true, duplicate: true };
      const { now } = await balances(today);
      const jar = jarToRemoveFrom(now.coins);
      if (!jar) throw userError('There are no coins to remove.');
      await store.addRow({ key, type: 'Removed', coins: -1, jar, date, name: `➖ Coin removed (${jar})` });
      return { ok: true };
    }
    case 'place': {
      if (await store.findPlaced(id)) return { ok: true, duplicate: true };
      const { older, now } = await balances(today);
      const coin = now.coins.Tray > 0 ? await store.trayCoin() : null;
      if (!coin) throw userError('There are no coins in the tray to place.');
      await store.updateRow(coin.id, { jar: op.jar, placed: id });
      if (coin.date < older.cutoff) await refreshOlderTotals(today); // an old coin moved jars
      return { ok: true };
    }
    case 'collect': {
      const key = `prize:${id}`;
      if (await store.findByKey(key)) return { ok: true, duplicate: true };
      const { now } = await balances(today);
      if (now.stars < prize.cost) throw userError(`Not enough stars for ${prize.name} yet (${now.stars} of ${prize.cost}).`);
      await store.addRow({ key, type: 'Prize', stars: -prize.cost, date, prizeId: prize.id, status: 'To deliver', name: `${prize.emoji} ${prize.name}` });
      return { ok: true };
    }
    case 'buy': {
      const key = `buy:${id}`;
      if (await store.findByKey(key)) return { ok: true, duplicate: true };
      const { now } = await balances(today);
      if (now.coins[item.jar] < item.price) throw userError(`Not enough coins in the ${item.jar} jar for ${item.name} yet (${now.coins[item.jar]} of ${item.price}).`);
      await store.addRow({ key, type: 'Purchase', coins: -item.price, jar: item.jar, date, itemId: item.id, status: 'To deliver', name: `${item.emoji} ${item.name}` });
      return { ok: true };
    }
    case 'goal':
      await store.setGoal(item.id);
      return { ok: true };
    case 'deliver':
      await store.updateRow(op.rowId, { status: 'Delivered' });
      return { ok: true };
    default:
      throw userError('Unknown tap.');
  }
}

// Optional push to your phone when a star prize becomes affordable.
// Install the free ntfy app, subscribe to a hard-to-guess topic, set NTFY_TOPIC.
async function notifyIfReady(prizes, gained) {
  const topic = process.env.NTFY_TOPIC;
  if (!topic) return;
  try {
    const { now } = await balances(dayKey());
    const ready = newlyReady(prizes, now.stars - gained, now.stars);
    if (!ready.length) return;
    const who = process.env.STARS_CHILD_NAME || 'Your star';
    await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, {
      method: 'POST',
      headers: { Title: `${who} can pick a prize!`, Tags: 'star,gift' },
      body: `${now.stars} stars. Ready for: ${ready.map((p) => `${p.emoji} ${p.name} (${p.cost})`).join(', ')}.`,
      signal: AbortSignal.timeout(3000),
    });
  } catch (e) {
    console.warn('ntfy failed', e.message); // never blocks the star from saving
  }
}

