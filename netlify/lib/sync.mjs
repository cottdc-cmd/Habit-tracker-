// The heart of the automation: take new data, save it, tick off any habits it satisfies.

import { getStore } from '@netlify/blobs';
import { getHabits, getStats, saveDay, existingLogMap, markDone, hasData } from './data.mjs';
import { evaluate } from './rules.mjs';
import { fetchOura, isConnected } from './oura.mjs';
import { fetchEvents, calendarUrls } from './calendar.mjs';
import { dayKey, addDays, daysBetween } from './dates.mjs';

// Apply a batch of day objects from one source. Returns the new wins.
export async function applyDays(incomingDays, source, { events = {}, habits, logs } = {}) {
  const dates = [...new Set([...incomingDays.map((d) => d.date), ...Object.keys(events)])].sort();
  if (!dates.length) return [];
  habits ||= await getHabits();
  logs ||= await existingLogMap(dates[0]);
  const stats = await getStats(dates[0]);
  const incomingByDate = Object.fromEntries(incomingDays.map((d) => [d.date, d]));

  const wins = [];
  for (const date of dates) {
    const incoming = incomingByDate[date];
    const day = incoming && hasData(incoming)
      ? await saveDay(stats.get(date), incoming)
      : stats.get(date) || { date, workouts: [] };
    for (const habit of habits) {
      const why = evaluate(habit.rule, day, events[date] || []);
      if (!why) continue;
      const from = /calendar:/i.test(habit.rule) && (events[date] || []).some((e) => why === e.title)
        ? 'Calendar' : source;
      const { created } = await markDone(habit, date, from, why, logs);
      if (created) wins.push({ habitId: habit.id, habit: habit.name, emoji: habit.emoji, date, why, source: from });
    }
  }
  return wins;
}

// Daily sync: Oura + Google Calendar for the last few days (Oura data can arrive late).
export async function runSync({ days = 3 } = {}) {
  const today = dayKey();
  const start = addDays(today, -(days - 1));
  const errors = [];

  let oura = {};
  if (await isConnected()) {
    try { oura = await fetchOura(start, today, addDays(today, 1)); }
    catch (e) { errors.push(`Oura: ${e.message}`); }
  }

  let events = {};
  if (calendarUrls().length) {
    try { events = await fetchEvents(start, today); }
    catch (e) { errors.push(`Calendar: ${e.message}`); }
  }

  const incoming = daysBetween(start, today).map((d) => oura[d] || { date: d, workouts: [] });
  const wins = await applyDays(incoming, 'Oura', { events });

  const result = { at: new Date().toISOString(), wins, errors };
  await getStore('meta').setJSON('last-sync', result);
  return result;
}
