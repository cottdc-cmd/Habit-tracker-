import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from '../netlify/lib/rules.mjs';
import { summarize, levelFor } from '../netlify/lib/summary.mjs';
import { parseHealth, haeDate } from '../netlify/lib/health.mjs';
import { mergeDay } from '../netlify/lib/data.mjs';
import { workoutKey } from '../netlify/lib/workouts.mjs';
import { weekStart } from '../netlify/lib/dates.mjs';

const day = { date: '2026-10-28', steps: 8123, sleep_score: 80, readiness: 65, workouts: [{ name: 'Outdoor Walk', minutes: 30 }] };

test('rules', () => {
  assert.equal(evaluate('manual', day), null);
  assert.equal(evaluate('workout', day), 'Outdoor Walk');
  assert.equal(evaluate('workout:yoga', day), null);
  assert.equal(evaluate('workout:walk', day), 'Outdoor Walk');
  assert.equal(evaluate('steps>=8000', day), 'steps 8,123');
  assert.equal(evaluate('steps>=9000', day), null);
  assert.equal(evaluate('steps>=9000 | sleep_score>=75', day), 'sleep score 80');
  assert.equal(evaluate('workout_minutes>=30', day), 'workout minutes 30');
  assert.equal(evaluate('calendar:tennis', day, [{ title: 'Tennis w/ Sam' }]), 'Tennis w/ Sam');
  assert.equal(evaluate('rest_day', day), null, 'worked out, so not a rest day');
  assert.ok(evaluate('rest_day', { ...day, workouts: [] }));
  assert.equal(evaluate('steps>=1', { date: 'x', workouts: [] }), null, 'missing data never matches');
});

test('apple health: Health Auto Export format', () => {
  const days = parseHealth({ data: {
    metrics: [{ name: 'step_count', data: [
      { date: '2026-10-28 08:00:00 -0400', qty: 3000 },
      { date: '2026-10-28 12:00:00 -0400', qty: 2500.4 },
      { date: '2026-10-27 12:00:00 -0400', qty: 9000 },
    ] }],
    workouts: [{ name: 'Pilates', start: '2026-10-28 07:00:00 -0400', end: '2026-10-28 07:45:00 -0400' }],
  } });
  const d28 = days.find((d) => d.date === '2026-10-28');
  assert.equal(d28.steps, 5500);
  assert.equal(d28.workouts[0].minutes, 45);
  assert.equal(days.find((d) => d.date === '2026-10-27').steps, 9000);
  assert.equal(haeDate('2026-10-28 07:00:00 -0400'), '2026-10-28T07:00:00-04:00');
});

test('apple health: simple Shortcut format', () => {
  const [d] = parseHealth({ date: '2026-10-28', steps: '7200', workout: { name: 'Run', minutes: 25, start: '2026-10-28T11:00:00Z' } });
  assert.equal(d.steps, 7200);
  assert.equal(d.workouts[0].name, 'Run');
});

test('merging sources keeps max numbers and dedupes the same workout', () => {
  const apple = { date: 'd', steps: 7000, workouts: [{ key: workoutKey('2026-10-28T11:00:00Z'), name: 'Run', minutes: 30 }] };
  const oura = { date: 'd', steps: 7400, readiness: 80, workouts: [{ key: workoutKey('2026-10-28T11:02:00Z'), name: 'Running', minutes: 31 }] };
  const m = mergeDay(mergeDay(null, apple), oura);
  assert.equal(m.steps, 7400);
  assert.equal(m.readiness, 80);
  assert.equal(m.workouts.length, 1);
});

test('levels', () => {
  assert.equal(levelFor(0).level, 1);
  assert.equal(levelFor(99).level, 1);
  assert.equal(levelFor(100).level, 2);
  assert.deepEqual(levelFor(350), { level: 3, xp: 350, into: 50, span: 300 });
});

test('weekly streaks forgive an unfinished current week', () => {
  const today = '2026-10-28'; // Wednesday
  assert.equal(weekStart(today), '2026-10-26');
  const habits = [{ id: 'a', name: 'Move', emoji: '🏃', goal: 2, rule: 'workout' }];
  const logs = [
    { habitId: 'a', date: '2026-10-21' }, { habitId: 'a', date: '2026-10-22' }, // last week: hit
    { habitId: 'a', date: '2026-10-13' }, { habitId: 'a', date: '2026-10-15' }, // week before: hit
    { habitId: 'a', date: '2026-10-28' },                                        // this week: 1 of 2
  ];
  const s = summarize({ habits, logs, today });
  const h = s.habits[0];
  assert.equal(h.streak, 2);
  assert.equal(h.weekCount, 1);
  assert.equal(h.doneToday, true);
  assert.equal(s.showUpWeeks, 3);
  assert.equal(s.level.xp, 5 * 10 + 2 * 25);
});

test('prize wheel follows the Notion page rules', async () => {
  const { prizeWheel } = await import('../netlify/lib/summary.mjs');
  const habits = [{ id: 'p', name: 'Protein goal', emoji: '🥩', rule: 'manual | prize_wheel' }];
  const run = (n, end) => Array.from({ length: n }, (_, i) => ({ habitId: 'p', date: weekStartFree(end, -i) }));
  function weekStartFree(key, n) { const d = new Date(`${key}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

  assert.equal(prizeWheel([], [], '2026-10-28'), null);
  let p = prizeWheel(habits, run(1, '2026-10-28'), '2026-10-28');
  assert.deepEqual([p.streak, p.cycleDay, p.unlocked.size], [1, 1, 'XS']);
  p = prizeWheel(habits, run(2, '2026-10-27'), '2026-10-28'); // today not done yet
  assert.deepEqual([p.streak, p.doneToday, p.unlocked, p.next.size, p.next.daysAway], [2, false, null, 'S', 1]);
  p = prizeWheel(habits, run(5, '2026-10-28'), '2026-10-28');
  assert.equal(p.unlocked.size, 'M');
  p = prizeWheel(habits, run(8, '2026-10-28'), '2026-10-28'); // after the 7-day prize it starts over
  assert.deepEqual([p.cycleDay, p.unlocked.size], [1, 'XS']);
  p = prizeWheel(habits, run(4, '2026-10-28'), '2026-10-28');
  assert.deepEqual([p.unlocked, p.next.size, p.next.daysAway], [null, 'M', 1]);
});
