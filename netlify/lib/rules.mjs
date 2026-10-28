// A habit's "Rule" (set in Notion) decides when it completes itself.
//
//   manual                 only you can tick it
//   workout                any workout from Apple Health or Oura
//   workout:yoga           a workout whose name contains "yoga"
//   steps>=8000            any daily metric (see METRICS) compared to a number
//   calendar:tennis        a calendar event containing "tennis" that has started
//   rest_day               no workout on a low-readiness day (under 70) or a period day
//   phase:luteal           you're in that phase (menstrual, follicular, ovulatory, luteal)
//   prize_wheel            not a trigger: marks the habit whose daily streak powers the prize wheel
//
// Join options with "|" to accept any of them, e.g. "workout | steps>=10000".

export const METRICS = [
  'steps', 'sleep_score', 'readiness', 'activity_score',
  'active_calories', 'exercise_minutes', 'workout_minutes', 'workouts',
];

export function parseRule(rule) {
  return String(rule || '').split('|').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

export function isAutomatic(rule) {
  return parseRule(rule).some((r) => r !== 'manual');
}

// Returns a short "why" string when the rule matches, otherwise null.
export function evaluate(rule, day, events = []) {
  for (const r of parseRule(rule)) {
    const why = one(r, day, events);
    if (why) return why;
  }
  return null;
}

function one(r, day, events) {
  const workouts = day.workouts || [];
  if (r === 'manual') return null;

  if (r === 'workout') {
    return workouts.length ? workouts.map((w) => w.name).join(', ') : null;
  }
  if (r.startsWith('workout:')) {
    const q = r.slice(8).trim();
    const hit = workouts.find((w) => w.name.toLowerCase().includes(q));
    return hit ? hit.name : null;
  }
  if (r.startsWith('calendar:')) {
    const q = r.slice(9).trim();
    const hit = events.find((e) => e.title.toLowerCase().includes(q));
    return hit ? hit.title : null;
  }
  if (r === 'rest_day') {
    if (workouts.length) return null;
    if (day.readiness != null && day.readiness < 70) return `Readiness ${day.readiness}, you rested`;
    if (day.phase === 'menstrual') return 'Period day, you rested';
    return null;
  }
  if (r.startsWith('phase:')) {
    return day.phase && day.phase === r.slice(6).trim() ? `${day.phase} phase` : null;
  }

  const m = r.match(/^([a-z_]+)\s*(>=|<=|>|<|=)\s*(\d+(?:\.\d+)?)$/);
  if (m) {
    const [, metric, op, raw] = m;
    const v = metricValue(day, metric);
    if (v == null) return null;
    const n = Number(raw);
    const ok = { '>=': v >= n, '<=': v <= n, '>': v > n, '<': v < n, '=': v === n }[op];
    return ok ? `${metric.replace(/_/g, ' ')} ${v.toLocaleString('en-US')}` : null;
  }
  return null;
}

function metricValue(day, metric) {
  const workouts = day.workouts || [];
  if (metric === 'workouts') return workouts.length;
  if (metric === 'workout_minutes') return workouts.reduce((s, w) => s + (w.minutes || 0), 0);
  return day[metric] ?? null;
}
