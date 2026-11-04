import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildState, planOp, newlyReady, weekStrip, checksByDate, choreKey, validDate } from '../netlify/lib/stars/logic.mjs';

const today = '2026-11-04';
const chores = [
  { id: 'a1', emoji: '🪥', name: 'Brush teeth', group: 'Morning' },
  { id: 'b2', emoji: '🍽️', name: 'Plate to the sink', group: 'After school' },
];
const rewards = [
  { id: 'r10', emoji: '🍭', name: 'Pick a treat', cost: 10 },
  { id: 'r20', emoji: '🎬', name: 'Pick the Friday movie', cost: 20 },
];
const row = (type, stars, date, extra = {}) => ({ type, stars, date, ...extra });

test('balance = older cached sum + recent rows, rewards deducted', () => {
  const recent = [
    row('Chore', 1, today, { choreId: 'a1' }),
    row('Bonus', 1, today),
    row('Removed', -1, '2026-11-03'),
    row('Reward', -10, '2026-11-02'),
  ];
  const s = buildState({ chores, rewards, olderSum: 15, recent, collected: [], today, timezone: 'America/New_York' });
  assert.equal(s.balance, 6);
  assert.deepEqual(s.checks, { [today]: ['a1'] });
  assert.equal(s.rewards[0].ready, false);
});

test('week strip: 7 days ending today, rewards excluded, never negative', () => {
  const w = weekStrip([
    row('Chore', 1, today), row('Chore', 1, today), row('Bonus', 1, '2026-11-01'),
    row('Reward', -20, today), row('Removed', -1, '2026-10-31'), row('Chore', 1, '2026-10-20'),
  ], today);
  assert.equal(w.length, 7);
  assert.equal(w[0].date, '2026-10-29');
  assert.equal(w[6].date, today);
  assert.equal(w[6].stars, 2);
  assert.equal(w.find((d) => d.date === '2026-11-01').stars, 1);
  assert.equal(w.find((d) => d.date === '2026-10-31').stars, 0);
});

test('checks dedupe and ignore non-chore rows', () => {
  const c = checksByDate([row('Chore', 1, today, { choreId: 'a1' }), row('Chore', 1, today, { choreId: 'a1' }), row('Bonus', 1, today)]);
  assert.deepEqual(c, { [today]: ['a1'] });
});

test('chore taps use one key per chore per day, so retries never double count', () => {
  const p1 = planOp({ type: 'check', choreId: 'a1', date: today }, { chores, rewards, today });
  const p2 = planOp({ type: 'check', choreId: 'a1', date: today, id: 'other' }, { chores, rewards, today });
  assert.equal(p1.row.key, p2.row.key);
  assert.equal(p1.row.key, choreKey('a1', today));
  assert.equal(p1.row.stars, 1);
  const u = planOp({ type: 'uncheck', choreId: 'a1', date: today }, { chores, rewards, today });
  assert.deepEqual(u, { kind: 'remove', key: p1.row.key });
});

test('grown-up taps', () => {
  const ctx = { chores, rewards, today };
  assert.equal(planOp({ type: 'bonus', id: 'x', date: today }, ctx).row.stars, 1);
  assert.equal(planOp({ type: 'remove', id: 'y', date: today }, ctx).row.stars, -1);
  const c = planOp({ type: 'collect', id: 'z', rewardId: 'r20', date: today }, ctx);
  assert.equal(c.row.stars, -20);
  assert.equal(c.needs, 20);
  assert.equal(c.row.key, 'collect:z');
});

test('bad taps get a readable message', () => {
  const ctx = { chores, rewards, today };
  assert.throws(() => planOp({ type: 'check', choreId: 'gone', date: today }, ctx), /no longer exists/);
  assert.throws(() => planOp({ type: 'bonus', id: 'x', date: '2026-09-01' }, ctx), /odd date/);
  assert.throws(() => planOp({ type: 'collect', id: 'x', rewardId: 'nope', date: today }, ctx), /reward/);
  assert.throws(() => planOp({ type: 'bonus', date: today }, ctx), /id/);
});

test('dates: queued taps from the last week are fine, the future is not', () => {
  assert.ok(validDate(today, today));
  assert.ok(validDate('2026-10-28', today));
  assert.ok(!validDate('2026-10-27', today));
  assert.ok(validDate('2026-11-05', today), 'tablet clock a bit ahead');
  assert.ok(!validDate('2026-11-06', today));
});

test('tells you only when a reward first becomes affordable', () => {
  assert.deepEqual(newlyReady(rewards, 9, 10).map((r) => r.cost), [10]);
  assert.deepEqual(newlyReady(rewards, 10, 11), []);
  assert.deepEqual(newlyReady(rewards, 19, 20).map((r) => r.cost), [20]);
  assert.deepEqual(newlyReady(rewards, 11, 10), [], 'going down never notifies');
});
