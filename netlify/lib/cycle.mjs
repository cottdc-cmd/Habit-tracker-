// Menstrual phase from logged period days (Apple Health or tapped on the dashboard).
// Cycle length is learned from your last 3 cycles; until then it assumes 28 days.
// Phases are estimates for pacing yourself, not medical advice.

import { addDays } from './dates.mjs';

export const PHASES = ['menstrual', 'follicular', 'ovulatory', 'luteal'];
const DEFAULT_LENGTH = 28;

const diff = (a, b) => Math.round((new Date(`${b}T12:00:00Z`) - new Date(`${a}T12:00:00Z`)) / 864e5);

// Groups period days into runs. A gap of 2+ clear days starts a new period.
function runs(days) {
  const out = [];
  for (const d of days) {
    const run = out.at(-1);
    if (run && diff(run.at(-1), d) <= 2) run.push(d);
    else out.push([d]);
  }
  return out;
}

export function cycleInfo(periodDays, today) {
  const days = [...new Set(periodDays)].filter((d) => d <= today).sort();
  const periods = runs(days);
  if (!periods.length) return null;

  const current = periods.at(-1);
  const start = current[0];
  const day = diff(start, today) + 1;
  if (day > 60) return null; // too long since the last logged period to guess

  const lengths = periods.slice(1)
    .map((p, i) => diff(periods[i][0], p[0]))
    .filter((n) => n >= 21 && n <= 45)
    .slice(-3);
  const length = lengths.length
    ? Math.round(lengths.reduce((a, b) => a + b, 0) / lengths.length)
    : DEFAULT_LENGTH;

  // Trust the logged length once there are 3+ days and they've stopped.
  // A single tap on day 1 (or a period still going) assumes at least 5 days.
  const lastFlow = current.at(-1);
  const flowDays = diff(start, lastFlow) + 1;
  const ended = diff(lastFlow, today) >= 2;
  const menstrualDays = ended && flowDays >= 3 ? flowDays : Math.max(flowDays, 5);
  const ovulation = length - 14;

  let phase = 'luteal';
  if (day <= menstrualDays) phase = 'menstrual';
  else if (day < ovulation - 1) phase = 'follicular';
  else if (day <= ovulation + 1) phase = 'ovulatory';

  return {
    phase,
    day,
    length,
    learned: lengths.length > 0,
    lastStart: start,
    nextStart: addDays(start, length),
    nextIn: Math.max(0, length - day + 1),
    late: day > length,
    periodToday: days.at(-1) === today,
    // Where each phase starts (cycle day), for drawing the cycle bar.
    marks: { follicular: menstrualDays + 1, ovulatory: ovulation - 1, luteal: ovulation + 2 },
  };
}
