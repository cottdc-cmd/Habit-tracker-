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
  };
}
