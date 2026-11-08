// Star + coin chart service: reads state and applies taps. Talks only to `store`.
// Every kid has their own lists and balances. Anything without a kid belongs to the first kid.

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
const CACHE_KEY = 'older-totals-v3';
const cache = () => getStore('stars');

async function readCache() {
  try { return await cache().get(CACHE_KEY, { type: 'json' }); } catch { return null; }
}

export async function refreshOlderTotals(today = dayKey()) {
  const cutoff = addDays(today, -RECENT_DAYS);
  const value = { cutoff, byKid: await store.totalsBefore(cutoff), computedOn: today };
  try { await cache().setJSON(CACHE_KEY, value); } catch (e) { console.warn('stars cache write failed', e.message); }
  return value;
}

// Recomputed (full scan) at most once a day, so edits you make to old rows in Notion show by morning.
async function olderTotals(today) {
  const c = await readCache();
  if (c && c.computedOn === today) return c;
  return refreshOlderTotals(today);
}

// Who owns a row or list item: its kid, or the first kid if it has none.
const owner = (kids) => (x) => x.kidId || kids[0]?.id;
const mine = (kids, kidId) => (x) => owner(kids)(x) === kidId;

async function balances(today, kids, kidId) {
  const older = await olderTotals(today);
  const recent = (await store.getRows(older.cutoff)).filter(mine(kids, kidId));
  // Older totals are keyed by kid id, with '' for rows that have no kid (they belong to the first kid).
  let base = older.byKid[kidId];
  if (kidId === kids[0]?.id) base = addTotals(base, older.byKid['']);
  return { older, recent, now: addTotals(base, totals(recent)) };
}

async function loadLists() {
  const [kids, tasks, prizes, items] = await Promise.all([store.getKids(), store.getTasks(), store.getPrizes(), store.getStore()]);
  if (!kids.length) throw userError('Add a kid in the Kids list in Notion first.');
  return { kids, tasks, prizes, items };
}

export async function getState() {
  const today = dayKey();
  const [{ kids, tasks, prizes, items }, older, collected, toDeliver] = await Promise.all([
    loadLists(), olderTotals(today), store.lastCollected(30), store.toDeliver(),
  ]);
  const rows = await store.getRows(older.cutoff);
  const byKid = {};
  for (const kid of kids) {
    const is = mine(kids, kid.id);
    let base = older.byKid[kid.id];
    if (kid.id === kids[0].id) base = addTotals(base, older.byKid['']);
    byKid[kid.id] = buildState({
      tasks: tasks.filter(is), prizes: prizes.filter(is), store: items.filter(is),
      older: base, recent: rows.filter(is),
      collected: collected.filter(is).slice(0, 5), toDeliver: toDeliver.filter(is),
      today, timezone: timezone(),
    });
  }
  return {
    today,
    timezone: timezone(),
    morningGoal: process.env.STARS_MORNING_GOAL || 'Ready by 7:30',
    kids,
    byKid,
  };
}

// Everything the admin screen edits, including hidden items, with each item's kid filled in.
export async function getLists() {
  const [kids, tasks, prizes, items] = await Promise.all([store.getKids(), store.getTasks(true), store.getPrizes(true), store.getStore(true)]);
  const own = (x) => ({ ...x, kidId: owner(kids)(x) });
  return { kids, tasks: tasks.map(own), prizes: prizes.map(own), store: items.map(own) };
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
async function syncRoutine(ctx, group, date) {
  if (!ROUTINES.includes(group)) return;
  const { kids, kid, tasks } = ctx;
  const rows = (await store.getRows(date)).filter((r) => r.date === date && mine(kids, kid.id)(r));
  const checked = rows.filter((r) => r.type === 'Check' || r.type === 'Chore').map((r) => r.taskId);
  const done = routineComplete(tasks, group, checked);
  const existing = rows.filter((r) => r.type === 'Routine' && r.group === group);
  if (done && !existing.length) {
    await store.addRow({
      key: routineKey(group, date, kid.id), type: 'Routine', stars: 1, date, note: DONE_NOTE, kidId: kid.id,
      name: `${group === 'Morning' ? '☀️' : '🏡'} ${group} routine`,
    });
    await notifyIfReady(ctx, 1);
  } else if (!done) {
    for (const r of existing) if (r.note !== DELAY_NOTE) await store.removeRow(r.id);
  }
}

// Applies one tap. Safe to retry: every write has a unique Key (or Placed id) and is skipped if it already exists.
export async function applyOp(op) {
  const today = dayKey();
  const lists = await loadLists();
  const kids = lists.kids;
  const kid = kids.find((k) => k.id === op?.kidId) || (!op?.kidId ? kids[0] : null);
  if (!kid) throw userError('That kid is no longer in the Kids list.');
  const is = mine(kids, kid.id);
  const ctx = { kids, kid, tasks: lists.tasks.filter(is), prizes: lists.prizes.filter(is), items: lists.items.filter(is) };
  const { task, prize, item } = validateOp(op, { tasks: ctx.tasks, prizes: ctx.prizes, store: ctx.items, today });
  const { date, id } = op;
  const kidId = kid.id;
  const add = (row) => store.addRow({ ...row, kidId });

  switch (op.type) {
    case 'check': {
      const key = checkKey(task.id, date);
      if (!(await store.findByKey(key))) {
        await add({
          key, type: 'Check', stars: 0, coins: task.coins, jar: task.coins > 0 ? 'Tray' : null,
          date, taskId: task.id, name: `${task.emoji} ${task.name}`,
        });
      }
      await syncRoutine(ctx, task.group, date);
      return { ok: true };
    }
    case 'uncheck': {
      await store.removeByKey(checkKey(task.id, date));
      await syncRoutine(ctx, task.group, date);
      return { ok: true };
    }
    case 'delay': {
      const rows = (await store.getRows(date)).filter((r) => r.date === date && is(r));
      if (!rows.some((r) => r.type === 'Routine' && r.group === op.group)) {
        await add({ key: routineKey(op.group, date, kidId), type: 'Routine', stars: 1, date, note: DELAY_NOTE, name: `🙋 ${op.group} routine (grown-ups were the delay)` });
        await notifyIfReady(ctx, 1);
      }
      return { ok: true };
    }
    case 'bonus':
    case 'extra': {
      const key = `bonus:${id}`;
      if (await store.findByKey(key)) return { ok: true, duplicate: true };
      const stars = task ? task.stars : 1;
      await add({ key, type: 'Bonus', stars, date, taskId: task?.id, note: task?.name || '', name: task ? `${task.emoji} ${task.name}` : '⭐ Bonus star' });
      await notifyIfReady(ctx, stars);
      return { ok: true };
    }
    case 'removeStar': {
      const key = `remove-star:${id}`;
      if (await store.findByKey(key)) return { ok: true, duplicate: true };
      const { now } = await balances(today, kids, kidId);
      if (now.stars < 1) throw userError('There are no stars to remove.');
      await add({ key, type: 'Removed', stars: -1, date, name: '➖ Star removed' });
      return { ok: true };
    }
    case 'removeCoin': {
      const key = `remove-coin:${id}`;
      if (await store.findByKey(key)) return { ok: true, duplicate: true };
      const { now } = await balances(today, kids, kidId);
      const jar = jarToRemoveFrom(now.coins);
      if (!jar) throw userError('There are no coins to remove.');
      await add({ key, type: 'Removed', coins: -1, jar, date, name: `➖ Coin removed (${jar})` });
      return { ok: true };
    }
    case 'place': {
      if (await store.findPlaced(id)) return { ok: true, duplicate: true };
      const { older, now } = await balances(today, kids, kidId);
      const coin = now.coins.Tray > 0 ? (await store.trayCoins()).find(is) : null;
      if (!coin) throw userError('There are no coins in the tray to place.');
      await store.updateRow(coin.id, { jar: op.jar, placed: id });
      if (coin.date < older.cutoff) await refreshOlderTotals(today); // an old coin moved jars
      return { ok: true };
    }
    case 'collect': {
      const key = `prize:${id}`;
      if (await store.findByKey(key)) return { ok: true, duplicate: true };
      const { now } = await balances(today, kids, kidId);
      if (now.stars < prize.cost) throw userError(`Not enough stars for ${prize.name} yet (${now.stars} of ${prize.cost}).`);
      await add({ key, type: 'Prize', stars: -prize.cost, date, prizeId: prize.id, status: 'To deliver', name: `${prize.emoji} ${prize.name}` });
      return { ok: true };
    }
    case 'buy': {
      const key = `buy:${id}`;
      if (await store.findByKey(key)) return { ok: true, duplicate: true };
      const { now } = await balances(today, kids, kidId);
      if (now.coins[item.jar] < item.price) throw userError(`Not enough coins in the ${item.jar} jar for ${item.name} yet (${now.coins[item.jar]} of ${item.price}).`);
      await add({ key, type: 'Purchase', coins: -item.price, jar: item.jar, date, itemId: item.id, status: 'To deliver', name: `${item.emoji} ${item.name}` });
      return { ok: true };
    }
    case 'goal':
      await store.setGoal(item.id, is);
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
async function notifyIfReady({ kids, kid, prizes }, gained) {
  const topic = process.env.NTFY_TOPIC;
  if (!topic || !prizes.length) return;
  try {
    const { now } = await balances(dayKey(), kids, kid.id);
    const ready = newlyReady(prizes, now.stars - gained, now.stars);
    if (!ready.length) return;
    await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, {
      method: 'POST',
      headers: { Title: `${kid.name || 'Your star'} can pick a prize!`, Tags: 'star,gift' },
      body: `${now.stars} stars. Ready for: ${ready.map((p) => `${p.emoji} ${p.name} (${p.cost})`).join(', ')}.`,
      signal: AbortSignal.timeout(3000),
    });
  } catch (e) {
    console.warn('ntfy failed', e.message); // never blocks the star from saving
  }
}
