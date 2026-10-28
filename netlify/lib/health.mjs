// Turns Apple Health payloads into day objects.
//
// Two formats are accepted:
//  1. Health Auto Export app (REST API automation, JSON v2):
//     { data: { metrics: [{ name, data: [{ date, qty }] }], workouts: [{ name, start, end, duration }] } }
//  2. A simple iOS Shortcut payload:
//     { date: "2026-10-28", steps: 8000, period: true, workout: { name: "Run", minutes: 30, start: "..." } }

import { workoutKey } from './workouts.mjs';
import { dayKey } from './dates.mjs';

const HAE_METRICS = {
  step_count: 'steps',
  apple_exercise_time: 'exercise_minutes',
  active_energy: 'active_calories',
};

// "2026-10-28 07:00:00 -0500" -> "2026-10-28T07:00:00-05:00"
export function haeDate(s) {
  const m = String(s).match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})\s*([+-]\d{2}):?(\d{2})$/);
  return m ? `${m[1]}T${m[2]}${m[3]}:${m[4]}` : String(s);
}

export function parseHealth(body) {
  const days = {};
  const day = (d) => (days[d] ||= { date: d, workouts: [] });

  if (body?.data) {
    for (const metric of body.data.metrics || []) {
      if (/menstrual/i.test(metric.name)) {
        for (const point of metric.data || []) {
          const v = String(point.value ?? point.qty ?? '').toLowerCase();
          if (v && v !== 'none' && v !== '0') day(String(point.date).slice(0, 10)).period = true;
        }
        continue;
      }
      const field = HAE_METRICS[metric.name];
      if (!field) continue;
      const totals = {};
      for (const point of metric.data || []) {
        const d = String(point.date).slice(0, 10);
        totals[d] = (totals[d] || 0) + (Number(point.qty) || 0);
      }
      for (const [d, total] of Object.entries(totals)) day(d)[field] = Math.round(total);
    }
    for (const w of body.data.workouts || []) {
      const start = haeDate(w.start);
      const minutes = w.duration
        ? Math.round(Number(w.duration) / 60)
        : Math.round((new Date(haeDate(w.end)) - new Date(start)) / 60000);
      day(String(w.start).slice(0, 10)).workouts.push({
        key: workoutKey(start), name: w.name || 'Workout', minutes, source: 'Apple Health',
      });
    }
    return Object.values(days);
  }

  const d = body?.date ? String(body.date).slice(0, 10) : dayKey();
  const out = day(d);
  for (const f of ['steps', 'exercise_minutes', 'active_calories']) {
    if (body?.[f] != null && body[f] !== '') out[f] = Math.round(Number(body[f]));
  }
  if (body?.period === true || body?.period === 'true') out.period = true;
  if (body?.workout) {
    const start = body.workout.start || new Date().toISOString();
    out.workouts.push({
      key: workoutKey(start),
      name: body.workout.name || 'Workout',
      minutes: Math.round(Number(body.workout.minutes) || 0),
      source: 'Apple Health',
    });
  }
  return [out];
}
