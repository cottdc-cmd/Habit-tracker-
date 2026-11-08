import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildState, validateOp, newlyReady, weekStrip, checksByDate, routinesByDate, routineComplete,
  checkKey, routineKey, validDate, totals, addTotals, jarToRemoveFrom, DELAY_NOTE,
} from '../netlify/lib/stars/logic.mjs';

const today = '2026-11-04';
const tasks = [
  { id: 'm1', emoji: '🪥', name: 'Brush teeth', group: 'Morning', coins: 0 },
  { id: 'm2', emoji: '🐶', name: 'Feed dogs', group: 'Morning', coins: 1 },
  { id: 'a1', emoji: '🛁', name: 'Bath', group: 'After school', coins: 0 },
  { id: 'c1', emoji: '🍽️', name: 'Plate to the sink', group: 'Money', coins: 1 },
];
const prizes = [{ id: 'p2', emoji: '🍬', name: 'Candy pick', cost: 2 }, { id: 'p4', emoji: '📺', name: 'Screen time', cost: 4 }];
const store = [
  { id: 's1', emoji: '⭐', name: 'Stickers', price: 2, jar: 'Spend' },
  { id: 's2', emoji: '🎨', name: 'Craft kit', price: 10, jar: 'Save' },
];
const ctx = { tasks, prizes, store, today };
const row = (type, extra = {}) => ({ type, stars: 0, coins: 0, date: today, ...extra });

test('totals: stars, and coins per jar', () => {
  const t = totals([
    row('Check', { taskId: 'm2', coins: 1, jar: 'Tray' }),
    row('Check', { taskId: 'c1', coins: 1, jar: 'Spend' }),
    row('Routine', { stars: 1 }),
    row('Purchase', { coins: -1, jar: 'Spend' }),
    row('Prize', { stars: -1 }),
  ]);
  assert.deepEqual(t, { stars: 0, coins: { Tray: 1, Spend: 0, Save: 0, Give: 0 } });
  assert.deepEqual(addTotals(t, { stars: 3, coins: { Save: 2 } }).coins.Save, 2);
});

test('routine star only when every item in that routine is checked', () => {
  assert.equal(routineComplete(tasks, 'Morning', ['m1']), false);
  assert.equal(routineComplete(tasks, 'Morning', ['m1', 'm2']), true);
  assert.equal(routineComplete(tasks, 'Money', []), false);
  assert.equal(routineComplete([], 'Morning', []), false, 'an empty routine never earns');
});

test('state: checks, routine stars, coins and week', () => {
  const recent = [
    row('Check', { taskId: 'm1' }),
    row('Check', { taskId: 'm2', coins: 1, jar: 'Tray' }),
    row('Routine', { stars: 1, group: 'Morning', note: 'All done' }),
    row('Routine', { stars: 1, group: 'After school', note: DELAY_NOTE }),
    row('Bonus', { stars: 1, date: '2026-11-03' }),
    row('Prize', { stars: -2 }),
  ];
  const s = buildState({ tasks, prizes, store, older: { stars: 5, coins: { Save: 3 } }, recent, collected: [], toDeliver: [], today, timezone: 'x' });
  assert.equal(s.stars, 6);
  assert.deepEqual(s.coins, { Tray: 1, Spend: 0, Save: 3, Give: 0 });
  assert.deepEqual(s.checks[today].sort(), ['m1', 'm2']);
  assert.deepEqual(s.routines[today], { Morning: 'done', 'After school': 'grownups' });
  assert.equal(s.week.at(-1).stars, 2, 'prizes do not reduce the stars earned that day');
  assert.equal(s.week.at(-2).stars, 1);
});

test('week strip: 7 days ending today, never negative', () => {
  const w = weekStrip([row('Removed', { stars: -1, date: '2026-11-01' }), row('Routine', { stars: 1, date: '2026-10-20' })], today);
  assert.equal(w.length, 7);
  assert.equal(w[0].date, '2026-10-29');
  assert.equal(w.find((d) => d.date === '2026-11-01').stars, 0);
});

test('keys: one check per item per day, one routine star per routine per day', () => {
  assert.equal(checkKey('a-b', today), `check:ab:${today}`);
  assert.equal(routineKey('After school', today), `routine:after-school:${today}`);
  assert.deepEqual(checksByDate([row('Check', { taskId: 'm1' }), row('Check', { taskId: 'm1' })]), { [today]: ['m1'] });
  assert.deepEqual(routinesByDate([row('Check', { group: 'Morning' })]), {});
});

test('remove a coin: tray first, then Spend, Save, Give', () => {
  assert.equal(jarToRemoveFrom({ Tray: 1, Spend: 3 }), 'Tray');
  assert.equal(jarToRemoveFrom({ Tray: 0, Spend: 0, Save: 2 }), 'Save');
  assert.equal(jarToRemoveFrom({ Tray: 0, Spend: 0, Save: 0, Give: 0 }), null);
});

test('taps are validated with readable messages', () => {
  assert.equal(validateOp({ type: 'check', taskId: 'm2', date: today }, ctx).task.coins, 1);
  assert.equal(validateOp({ type: 'collect', id: 'x', prizeId: 'p4', date: today }, ctx).prize.cost, 4);
  assert.equal(validateOp({ type: 'buy', id: 'x', itemId: 's1', date: today }, ctx).item.jar, 'Spend');
  assert.throws(() => validateOp({ type: 'check', taskId: 'gone', date: today }, ctx), /no longer exists/);
  assert.throws(() => validateOp({ type: 'place', id: 'x', jar: 'Piggy', date: today }, ctx), /Unknown jar/);
  assert.throws(() => validateOp({ type: 'delay', group: 'Money', date: today }, ctx), /Unknown routine/);
  assert.throws(() => validateOp({ type: 'goal', itemId: 's1', date: today }, ctx), /Save items/);
  assert.throws(() => validateOp({ type: 'bonus', date: today }, ctx), /id/);
  assert.throws(() => validateOp({ type: 'bonus', id: 'x', date: '2026-09-01' }, ctx), /odd date/);
});

test('dates: queued taps from the last week are fine, the future is not', () => {
  assert.ok(validDate('2026-10-28', today));
  assert.ok(!validDate('2026-10-27', today));
  assert.ok(validDate('2026-11-05', today));
  assert.ok(!validDate('2026-11-06', today));
});

test('notifies only when a prize first becomes affordable', () => {
  assert.deepEqual(newlyReady(prizes, 1, 2).map((p) => p.cost), [2]);
  assert.deepEqual(newlyReady(prizes, 2, 3), []);
  assert.deepEqual(newlyReady(prizes, 3, 2), []);
});

test('routine keys carry the kid, and the routine can be read back from any key', async () => {
  const { groupFromKey } = await import('../netlify/lib/stars/logic.mjs');
  assert.equal(routineKey('Morning', today, 'ab-12'), `routine:morning:${today}:ab12`);
  assert.equal(groupFromKey(routineKey('After school', today, 'k2')), 'After school');
  assert.equal(groupFromKey(`routine:morning:${today}`), 'Morning', 'keys from before kids still work');
  assert.equal(groupFromKey('bonus:x'), null);
});

test('extra effort items are awarded, not checked off', () => {
  const extra = { id: 'e1', emoji: '📚', name: 'School pages on her own', group: 'Extra', stars: 2 };
  const c = { ...ctx, tasks: [...tasks, extra] };
  assert.equal(validateOp({ type: 'extra', id: 'x', taskId: 'e1', date: today }, c).task.stars, 2);
  assert.throws(() => validateOp({ type: 'check', taskId: 'e1', date: today }, c), /no longer exists/);
  assert.throws(() => validateOp({ type: 'extra', id: 'x', taskId: 'm1', date: today }, c), /extra-effort/);
});
