// Pure star + coin chart logic. No I/O, so it's easy to test and works with any store.
//
// The ledger is the single source of truth. Every row has Stars and Coins (either can be 0):
//   Check     a routine item or money chore checked off today. Coins = the chore's coin value,
//             landing in Jar "Tray" until she places it in Spend, Save or Give.
//   Routine   +1 star: a whole checklist done, or "Grown-ups were the delay"
//   Bonus     +1 star from a grown-up
//   Removed   -1 star or -1 coin from a grown-up
//   Prize     -N stars for a star prize (Status: To deliver / Delivered)
//   Purchase  -N coins from a jar for a store item (Status: To deliver / Delivered)
// Star balance = sum of Stars. Each jar's balance = sum of Coins in that jar.

import { addDays } from '../dates.mjs';

export const ROUTINES = ['Morning', 'After school'];
export const JARS = ['Spend', 'Save', 'Give'];
export const DELAY_NOTE = 'Grown-ups were the delay';
export const DONE_NOTE = 'All done';

const bare = (id) => String(id || '').replace(/-/g, '');
export const checkKey = (taskId, date) => `check:${bare(taskId)}:${date}`;
export const routineKey = (group, date) => `routine:${group.toLowerCase().replace(/\s+/g, '-')}:${date}`;

const n = (v) => Number(v) || 0;
const isCheck = (r) => r.type === 'Check' || r.type === 'Chore'; // "Chore" = rows from the first version

// Sums over rows: stars and coins per jar.
export function totals(rows) {
  const t = { stars: 0, coins: { Tray: 0, Spend: 0, Save: 0, Give: 0 } };
  for (const r of rows) {
    t.stars += n(r.stars);
    if (r.jar && r.jar in t.coins) t.coins[r.jar] += n(r.coins);
  }
  return t;
}
export function addTotals(a, b) {
  const out = { stars: n(a?.stars) + n(b?.stars), coins: {} };
  for (const j of ['Tray', ...JARS]) out.coins[j] = n(a?.coins?.[j]) + n(b?.coins?.[j]);
  return out;
}

// Stars earned per day for the 7 days ending today (prizes don't count; removals do).
export function weekStrip(rows, today) {
  const days = [];
  for (let i = 6; i >= 0; i--) days.push({ date: addDays(today, -i), stars: 0 });
  const byDate = new Map(days.map((d) => [d.date, d]));
  for (const r of rows) {
    if (r.type === 'Prize' || r.type === 'Reward') continue;
    const d = byDate.get(r.date);
    if (d) d.stars += n(r.stars);
  }
  for (const d of days) d.stars = Math.max(0, d.stars);
  return days;
}

export function checksByDate(rows) {
  const out = {};
  for (const r of rows) {
    if (!isCheck(r) || !r.taskId) continue;
    const list = (out[r.date] ||= []);
    if (!list.includes(r.taskId)) list.push(r.taskId);
  }
  return out;
}

// { date: { Morning: 'done' | 'grownups', ... } }
export function routinesByDate(rows) {
  const out = {};
  for (const r of rows) {
    if (r.type !== 'Routine' || !r.group) continue;
    (out[r.date] ||= {})[r.group] = r.note === DELAY_NOTE ? 'grownups' : 'done';
  }
  return out;
}

// Is every active item in this routine checked on this date?
export function routineComplete(tasks, group, checkedIds) {
  const items = tasks.filter((t) => t.group === group);
  return items.length > 0 && items.every((t) => checkedIds.includes(t.id));
}

export function buildState({ tasks, prizes, store, older, recent, collected, toDeliver, today, timezone }) {
  const t = addTotals(older, totals(recent));
  return {
    today,
    timezone,
    stars: t.stars,
    coins: t.coins,
    tasks,
    prizes,
    store,
    checks: checksByDate(recent),
    routines: routinesByDate(recent),
    week: weekStrip(recent, today),
    collected,
    toDeliver,
  };
}

// Prizes that just became affordable when stars went from `before` to `after`.
export function newlyReady(prizes, before, after) {
  if (after <= before) return [];
  return prizes.filter((p) => p.cost > before && p.cost <= after);
}

// Queued taps from the last week are fine (the tablet may have been offline), never the future.
export function validDate(date, today) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return false;
  return date >= addDays(today, -7) && date <= addDays(today, 1);
}

// Which jar a grown-up "- coin" comes out of: the tray first, then Spend, Save, Give.
export function jarToRemoveFrom(coins) {
  return ['Tray', ...JARS].find((j) => n(coins[j]) > 0) || null;
}

export function userError(message) {
  const e = new Error(message);
  e.status = 400;
  return e;
}

// Checks a tap's shape and returns the item it refers to.
export function validateOp(op, { tasks, prizes, store, today }) {
  const { type, id, date } = op || {};
  if (!validDate(date, today)) throw userError(`That tap has an odd date (${date}).`);
  const needId = !['check', 'uncheck', 'delay', 'goal', 'deliver'].includes(type);
  if (needId && !id) throw userError('Missing tap id.');
  switch (type) {
    case 'check':
    case 'uncheck': {
      const task = tasks.find((t) => t.id === op.taskId);
      if (!task) throw userError('That chore no longer exists. It may have been removed in the admin screen.');
      return { task };
    }
    case 'delay':
      if (!ROUTINES.includes(op.group)) throw userError(`Unknown routine "${op.group}".`);
      return {};
    case 'place':
      if (!JARS.includes(op.jar)) throw userError(`Unknown jar "${op.jar}".`);
      return {};
    case 'collect': {
      const prize = prizes.find((p) => p.id === op.prizeId);
      if (!prize) throw userError('That prize no longer exists.');
      return { prize };
    }
    case 'buy':
    case 'goal': {
      const item = store.find((s) => s.id === op.itemId);
      if (!item) throw userError('That store item no longer exists.');
      if (type === 'goal' && item.jar !== 'Save') throw userError('Only Save items can be a goal.');
      return { item };
    }
    case 'deliver':
      if (!op.rowId) throw userError('Missing which item was delivered.');
      return {};
    case 'bonus':
    case 'removeStar':
    case 'removeCoin':
      return {};
    default:
      throw userError(`Unknown tap type "${type}".`);
  }
}
