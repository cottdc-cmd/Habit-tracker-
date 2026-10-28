// Reads and writes the three Notion databases: Habits, Log, Daily Stats.

import { db, queryAll, createPage, updatePage, archivePage, P, R } from './notion.mjs';

// ---------- Habits ----------

export async function getHabits() {
  const pages = await queryAll(db.habits(), {
    filter: { property: 'Active', checkbox: { equals: true } },
    sorts: [{ property: 'Order', direction: 'ascending' }],
  });
  return pages.map((p) => ({
    id: p.id,
    name: R.title(p.properties.Name),
    emoji: R.text(p.properties.Emoji) || '✨',
    area: R.select(p.properties.Area) || 'Me',
    goal: R.number(p.properties['Weekly goal']) ?? 0,
    rule: R.text(p.properties.Rule) || 'manual',
  }));
}

// ---------- Log (one row = one habit done on one day) ----------

export async function getLogs(sinceKey) {
  const pages = await queryAll(db.log(), {
    filter: { property: 'Date', date: { on_or_after: sinceKey } },
    sorts: [{ property: 'Date', direction: 'descending' }],
  });
  return pages.map((p) => ({
    id: p.id,
    habitId: R.relation(p.properties.Habit),
    date: R.date(p.properties.Date),
    source: R.select(p.properties.Source),
    detail: R.text(p.properties.Detail),
  })).filter((l) => l.habitId && l.date);
}

const logKey = (habitId, date) => `${habitId.replace(/-/g, '')}:${date}`;

// `existing` is a Map of logKey -> log row, shared across a sync so we query once.
export async function existingLogMap(sinceKey) {
  const logs = await getLogs(sinceKey);
  return new Map(logs.map((l) => [logKey(l.habitId, l.date), l]));
}

export async function markDone(habit, date, source, detail, existing) {
  const key = logKey(habit.id, date);
  if (existing?.has(key)) return { created: false };
  const page = await createPage(db.log(), {
    Name: P.title(`${habit.emoji} ${habit.name}`),
    Habit: P.relation(habit.id),
    Date: P.date(date),
    Source: P.select(source),
    Detail: P.text(detail),
  });
  existing?.set(key, { id: page.id, habitId: habit.id, date, source, detail });
  return { created: true };
}

export async function unmark(habitId, date) {
  const map = await existingLogMap(date);
  const row = map.get(logKey(habitId, date));
  if (row) await archivePage(row.id);
  return { removed: !!row };
}

// ---------- Daily Stats (one row per day, merged from every source) ----------

const NUMBERS = {
  steps: 'Steps',
  sleep_score: 'Sleep score',
  readiness: 'Readiness',
  activity_score: 'Activity score',
  active_calories: 'Active calories',
  exercise_minutes: 'Exercise minutes',
};

function rowToDay(page) {
  const day = { pageId: page.id, date: R.date(page.properties.Day), workouts: [] };
  for (const [k, prop] of Object.entries(NUMBERS)) day[k] = R.number(page.properties[prop]);
  day.workouts = R.text(page.properties['Workout log'])
    .split('\n').filter(Boolean)
    .map((line) => {
      const [key, name, minutes, source] = line.split('|');
      return { key, name, minutes: Number(minutes) || 0, source };
    });
  return day;
}

export async function getStats(sinceKey) {
  const pages = await queryAll(db.stats(), {
    filter: { property: 'Day', date: { on_or_after: sinceKey } },
  });
  return new Map(pages.map((p) => { const d = rowToDay(p); return [d.date, d]; }));
}

// Merge new data into a day's row. Numbers keep the highest value seen
// (Oura and Apple Health both count steps; we don't want to double them).
// Workouts are de-duplicated by key (start time rounded to 10 minutes).
export function mergeDay(existing, incoming) {
  const out = { ...(existing || { workouts: [] }), date: incoming.date };
  for (const k of Object.keys(NUMBERS)) {
    const a = existing?.[k], b = incoming[k];
    out[k] = b == null ? a ?? null : a == null ? b : Math.max(a, b);
  }
  const byKey = new Map((existing?.workouts || []).map((w) => [w.key, w]));
  for (const w of incoming.workouts || []) {
    const prev = byKey.get(w.key);
    if (!prev || (w.minutes || 0) > (prev.minutes || 0)) byKey.set(w.key, w);
  }
  out.workouts = [...byKey.values()];
  return out;
}

export async function saveDay(existing, incoming) {
  const day = mergeDay(existing, incoming);
  const props = {
    Name: P.title(day.date),
    Day: P.date(day.date),
    Workouts: P.number(day.workouts.length),
    'Workout minutes': P.number(day.workouts.reduce((s, w) => s + (w.minutes || 0), 0)),
    'Workout log': P.text(day.workouts.map((w) => [w.key, w.name, w.minutes, w.source].join('|')).join('\n')),
  };
  for (const [k, prop] of Object.entries(NUMBERS)) props[prop] = P.number(day[k]);
  if (existing?.pageId) await updatePage(existing.pageId, props);
  else day.pageId = (await createPage(db.stats(), props)).id;
  return day;
}

export function hasData(d) {
  return Object.keys(NUMBERS).some((k) => d[k] != null) || (d.workouts || []).length > 0;
}
