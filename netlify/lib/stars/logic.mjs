// Pure star-chart logic. No I/O, so it's easy to test and works with any store.
//
// The ledger is the single source of truth. One row = one star event:
//   Chore   +1  a chore checked off (key "chore:<choreId>:<date>")
//   Bonus   +1  a grown-up bonus star
//   Removed -1  a grown-up took a star away
//   Reward  -N  a reward was collected (N = its cost)
// The balance is simply the sum of every row's Stars.

import { addDays } from '../dates.mjs';

export const TYPES = ['Chore', 'Bonus', 'Removed', 'Reward'];
export const choreKey = (choreId, date) => `chore:${String(choreId).replace(/-/g, '')}:${date}`;

const sum = (rows) => rows.reduce((n, r) => n + (Number(r.stars) || 0), 0);

// Stars earned per day for the 7 days ending today (chores + bonus - removed; rewards don't count).
export function weekStrip(rows, today) {
  const days = [];
  for (let i = 6; i >= 0; i--) days.push({ date: addDays(today, -i), stars: 0 });
  const byDate = new Map(days.map((d) => [d.date, d]));
  for (const r of rows) {
    if (r.type === 'Reward') continue;
    const d = byDate.get(r.date);
    if (d) d.stars += Number(r.stars) || 0;
  }
  for (const d of days) d.stars = Math.max(0, d.stars);
  return days;
}

// Chore ids checked on each day, from the recent ledger rows.
export function checksByDate(rows) {
  const out = {};
  for (const r of rows) {
    if (r.type !== 'Chore' || !r.choreId) continue;
    (out[r.date] ||= []).includes(r.choreId) || out[r.date].push(r.choreId);
  }
  return out;
}

// Builds what the tablet shows.
//   olderSum: sum of all rows dated before `cutoff` (cached)
//   recent:   every row dated on/after `cutoff`
export function buildState({ chores, rewards, olderSum, recent, collected, today, timezone }) {
  const balance = olderSum + sum(recent);
  return {
    today,
    timezone,
    balance,
    chores,
    rewards: rewards.map((r) => ({ ...r, ready: balance >= r.cost })),
    checks: checksByDate(recent),
    week: weekStrip(recent, today),
    collected,
  };
}

// Rewards that just became affordable when the balance moved from `before` to `after`.
export function newlyReady(rewards, before, after) {
  if (after <= before) return [];
  return rewards.filter((r) => r.cost > before && r.cost <= after);
}

// Allow queued taps from the last week (the tablet may have been offline), never the future.
export function validDate(date, today) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return false;
  return date >= addDays(today, -7) && date <= addDays(today, 1);
}

// Turns a tap from the tablet into a ledger write. Throws a readable message for bad input.
//   returns { kind: 'add', row, needs? } or { kind: 'remove', key }
// `needs` = stars the balance must cover (collecting a reward). The caller checks it
// after the duplicate check, so a retried collect never fails as "not enough".
export function planOp(op, { chores, rewards, today }) {
  const { type, id, date } = op || {};
  if (!validDate(date, today)) throw userError(`That tap has an odd date (${date}).`);
  if (!id && type !== 'check' && type !== 'uncheck') throw userError('Missing tap id.');

  if (type === 'check' || type === 'uncheck') {
    const chore = chores.find((c) => c.id === op.choreId);
    if (!chore) throw userError('That chore no longer exists. It may have been removed in Notion.');
    const key = choreKey(chore.id, date);
    if (type === 'uncheck') return { kind: 'remove', key };
    return { kind: 'add', row: { key, type: 'Chore', stars: 1, date, choreId: chore.id, name: `${chore.emoji} ${chore.name}` } };
  }
  if (type === 'bonus') return { kind: 'add', row: { key: `bonus:${id}`, type: 'Bonus', stars: 1, date, name: '⭐ Bonus star' } };
  if (type === 'remove') return { kind: 'add', row: { key: `remove:${id}`, type: 'Removed', stars: -1, date, name: '➖ Star removed' } };
  if (type === 'collect') {
    const reward = rewards.find((r) => r.id === op.rewardId);
    if (!reward) throw userError('That reward no longer exists. It may have been removed in Notion.');
    return { kind: 'add', needs: reward.cost, row: { key: `collect:${id}`, type: 'Reward', stars: -reward.cost, date, rewardId: reward.id, name: `${reward.emoji} ${reward.name}` } };
  }
  throw userError(`Unknown tap type "${type}".`);
}

export function userError(message) {
  const e = new Error(message);
  e.status = 400;
  return e;
}
