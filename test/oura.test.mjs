import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

test('Oura: asks for one day past the range and keeps today', async () => {
  process.env.OURA_PERSONAL_TOKEN = 't';
  const seen = [];
  const rows = {
    daily_sleep: [{ day: '2026-10-29', score: 81 }],
    daily_readiness: [{ day: '2026-10-29', score: 66 }],
    daily_activity: [{ day: '2026-10-29', score: 72, steps: 2560, active_calories: 261, high_activity_time: 0, medium_activity_time: 4080 }, { day: '2026-10-30', steps: 1 }],
    workout: [{ day: '2026-10-29', activity: 'strength_training', start_datetime: '2026-10-29T08:04:00-04:00', end_datetime: '2026-10-29T09:04:00-04:00' }],
  };
  mock.method(globalThis, 'fetch', async (url) => {
    const u = new URL(url);
    const path = u.pathname.split('/').pop();
    seen.push([path, u.searchParams.get('end_date')]);
    return new Response(JSON.stringify({ data: rows[path] || [] }));
  });
  const { fetchOura } = await import('../netlify/lib/oura.mjs');
  const days = await fetchOura('2026-10-27', '2026-10-29', '2026-10-30');
  assert.ok(seen.every(([, end]) => end === '2026-10-30'));
  const d = days['2026-10-29'];
  assert.equal(d.sleep_score, 81);
  assert.equal(d.readiness, 66);
  assert.equal(d.exercise_minutes, 68);
  assert.equal(d.workouts[0].name, 'Strength Training');
  assert.equal(d.workouts[0].minutes, 60);
  assert.equal(days['2026-10-30'], undefined);
  mock.restoreAll();
});
