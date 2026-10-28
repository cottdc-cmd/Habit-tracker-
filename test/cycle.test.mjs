import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cycleInfo } from '../netlify/lib/cycle.mjs';
import { evaluate } from '../netlify/lib/rules.mjs';
import { parseHealth } from '../netlify/lib/health.mjs';
import { mergeDay } from '../netlify/lib/data.mjs';

const run = (start, n) => Array.from({ length: n }, (_, i) => {
  const d = new Date(`${start}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + i); return d.toISOString().slice(0, 10);
});

test('no data, or stale data, means no guess', () => {
  assert.equal(cycleInfo([], '2026-10-28'), null);
  assert.equal(cycleInfo(run('2026-07-01', 5), '2026-10-28'), null);
});

test('first logged period assumes 28 days and at least 5 period days', () => {
  const c = cycleInfo(['2026-10-27'], '2026-10-28');
  assert.equal(c.day, 2);
  assert.equal(c.phase, 'menstrual');
  assert.equal(c.length, 28);
  assert.equal(c.learned, false);
  assert.equal(cycleInfo(['2026-10-24'], '2026-10-28').phase, 'menstrual', 'day 5 is still menstrual');
});

test('learns cycle length and walks through every phase', () => {
  // Periods 30 days apart, 4 days each.
  const days = [...run('2026-08-01', 4), ...run('2026-08-31', 4), ...run('2026-09-30', 4)];
  const at = (n) => cycleInfo(days, run('2026-09-30', n).at(-1));
  assert.equal(at(1).length, 30);
  assert.equal(at(1).learned, true);
  assert.equal(at(4).phase, 'menstrual');
  assert.equal(at(7).phase, 'follicular');
  assert.equal(at(16).phase, 'ovulatory'); // ovulation ~ day 16
  assert.equal(at(20).phase, 'luteal');
  assert.equal(at(20).nextIn, 11);
  assert.equal(at(33).late, true);
});

test('period days make rest count; phase rule works', () => {
  assert.ok(evaluate('rest_day', { phase: 'menstrual', workouts: [] }));
  assert.equal(evaluate('rest_day', { phase: 'menstrual', workouts: [{ name: 'Walk' }] }), null);
  assert.equal(evaluate('rest_day', { phase: 'luteal', readiness: 80, workouts: [] }), null);
  assert.ok(evaluate('phase:luteal', { phase: 'luteal', workouts: [] }));
});

test('Apple Health menstrual flow and Shortcut period flag', () => {
  const days = parseHealth({ data: { metrics: [{ name: 'menstrual_flow', data: [
    { date: '2026-10-27 00:00:00 -0400', value: 'Medium' },
    { date: '2026-10-28 00:00:00 -0400', value: 'None' },
  ] }] } });
  assert.equal(days.find((d) => d.date === '2026-10-27').period, true);
  assert.equal(days.find((d) => d.date === '2026-10-28'), undefined);
  assert.equal(parseHealth({ date: '2026-10-28', period: true })[0].period, true);
  assert.equal(mergeDay({ period: true, workouts: [] }, { date: 'd', steps: 10, workouts: [] }).period, true);
});
