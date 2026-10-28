// Turns habits + logs into everything the dashboard shows.
// Streaks are weekly, not daily: a missed Tuesday never breaks anything.

import { weekStart, addDays, daysBetween } from './dates.mjs';

export const XP_PER_WIN = 10;
export const XP_PER_WEEKLY_GOAL = 25;

// Level n starts at 50 * n * (n - 1) XP: 0, 100, 300, 600, 1000...
export function levelFor(xp) {
  let level = 1;
  while (50 * (level + 1) * level <= xp) level++;
  const floor = 50 * level * (level - 1);
  const next = 50 * (level + 1) * level;
  return { level, xp, into: xp - floor, span: next - floor };
}

// Mirrors the Protein Prize Wheel page in Notion: streak days unlock prize sizes,
// and after the 7-day prize the streak starts over at day 1.
export const PRIZE_TIERS = [
  { day: 1, size: 'XS', budget: 15 },
  { day: 3, size: 'S', budget: 30 },
  { day: 5, size: 'M', budget: 50 },
  { day: 7, size: 'L', budget: 100 },
];

// Daily streak for the habit whose rule includes "prize_wheel".
// Today not done yet doesn't break it; the streak simply hasn't grown.
export function prizeWheel(habits, logs, today) {
  const habit = habits.find((h) => /\bprize_wheel\b/i.test(h.rule || ''));
  if (!habit) return null;
  const days = new Set(logs.filter((l) => l.habitId === habit.id).map((l) => l.date));
  const doneToday = days.has(today);
  let streak = 0;
  for (let d = doneToday ? today : addDays(today, -1); days.has(d); d = addDays(d, -1)) streak++;
  const cycleDay = streak ? ((streak - 1) % 7) + 1 : 0;
  const unlocked = doneToday ? PRIZE_TIERS.find((t) => t.day === cycleDay) || null : null;
  const next = PRIZE_TIERS.find((t) => t.day > cycleDay) || PRIZE_TIERS[0];
  return {
    habitId: habit.id, name: habit.name, emoji: habit.emoji,
    streak, cycleDay, doneToday, unlocked,
    next: { ...next, daysAway: next.day > cycleDay ? next.day - cycleDay : next.day },
    tiers: PRIZE_TIERS,
  };
}

// Burnout guardrail: how many days in a row (ending today or yesterday)
// Oura readiness has been under 70. Missing days end the run.
export function lowReadinessRun(statsByDate, today) {
  let run = 0;
  let d = statsByDate.get(today)?.readiness != null ? today : addDays(today, -1);
  for (; statsByDate.get(d)?.readiness != null && statsByDate.get(d).readiness < 70; d = addDays(d, -1)) run++;
  return run;
}

export function summarize({ habits, logs, today, stats }) {
  const thisWeek = weekStart(today);
  const weekDays = daysBetween(thisWeek, addDays(thisWeek, 6));

  // counts[habitId][weekStart] = completions that week
  const counts = {};
  const doneOn = {};
  for (const l of logs) {
    const wk = weekStart(l.date);
    ((counts[l.habitId] ||= {})[wk] ||= 0);
    counts[l.habitId][wk]++;
    (doneOn[l.habitId] ||= {})[l.date] = l;
  }

  let xp = logs.length * XP_PER_WIN;
  const rows = habits.map((h) => {
    const id = h.id;
    const weeks = counts[id] || {};
    const goal = h.goal || 0;
    if (goal > 0) for (const n of Object.values(weeks)) if (n >= goal) xp += XP_PER_WEEKLY_GOAL;

    // Weekly streak: this week counts once it's hit; an unfinished week doesn't break it.
    let streak = 0;
    if (goal > 0) {
      if ((weeks[thisWeek] || 0) >= goal) streak++;
      for (let wk = addDays(thisWeek, -7); (weeks[wk] || 0) >= goal; wk = addDays(wk, -7)) streak++;
    }
    const todayLog = doneOn[id]?.[today];
    return {
      ...h,
      doneToday: !!todayLog,
      todaySource: todayLog?.source || null,
      todayDetail: todayLog?.detail || null,
      weekCount: weeks[thisWeek] || 0,
      weekDays: weekDays.map((d) => !!doneOn[id]?.[d]),
      goalHit: goal > 0 && (weeks[thisWeek] || 0) >= goal,
      streak,
    };
  });

  const byId = Object.fromEntries(habits.map((h) => [h.id, h]));
  const recentWins = logs
    .filter((l) => byId[l.habitId])
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, 8)
    .map((l) => ({ ...l, name: byId[l.habitId].name, emoji: byId[l.habitId].emoji }));

  // "Weeks you showed up": any win at all counts. Gentle by design.
  let showUpWeeks = 0;
  const allWeeks = new Set(logs.map((l) => weekStart(l.date)));
  for (let wk = allWeeks.has(thisWeek) ? thisWeek : addDays(thisWeek, -7); allWeeks.has(wk); wk = addDays(wk, -7)) showUpWeeks++;

  return {
    today,
    weekDays,
    habits: rows,
    stats: stats || null,
    level: levelFor(xp),
    winsThisWeek: logs.filter((l) => l.date >= thisWeek).length,
    showUpWeeks,
    recentWins,
    prize: prizeWheel(habits, logs, today),
  };
}
