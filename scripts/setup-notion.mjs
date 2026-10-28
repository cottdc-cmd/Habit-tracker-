// One-time setup: builds the Habits, Log and Daily Stats databases inside
// NOTION_PARENT_PAGE_ID, adds starter habits, and prints the IDs for .env.
//
//   npm run setup:notion

import { notion, createPage, P } from '../netlify/lib/notion.mjs';

const parent = process.env.NOTION_PARENT_PAGE_ID;
if (!parent) throw new Error('Set NOTION_PARENT_PAGE_ID in .env first');

const select = (names) => ({ select: { options: names.map((name) => ({ name })) } });
const num = { number: {} };
const text = { rich_text: {} };

async function makeDb(title, emoji, properties) {
  const res = await notion('/databases', 'POST', {
    parent: { type: 'page_id', page_id: parent },
    icon: { type: 'emoji', emoji },
    title: [{ text: { content: title } }],
    properties,
  });
  console.log(`✓ ${title}`);
  return res.id;
}

const habitsDb = await makeDb('Habits', '🌱', {
  Name: { title: {} },
  Emoji: text,
  Area: select(['Move', 'Rest', 'Joy', 'Grow', 'Fuel', 'Boundaries']),
  'Weekly goal': num,
  Rule: text,
  Order: num,
  Active: { checkbox: {} },
});

const logDb = await makeDb('Habit Log', '✅', {
  Name: { title: {} },
  Habit: { relation: { database_id: habitsDb, single_property: {} } },
  Date: { date: {} },
  Source: select(['Oura', 'Apple Health', 'Calendar', 'Manual']),
  Detail: text,
});

const statsDb = await makeDb('Daily Stats', '💍', {
  Name: { title: {} },
  Day: { date: {} },
  Steps: num,
  'Sleep score': num,
  Readiness: num,
  'Activity score': num,
  'Active calories': num,
  'Exercise minutes': num,
  Workouts: num,
  'Workout minutes': num,
  'Workout log': text,
  Period: { checkbox: {} },
});

// Starter habits. Edit, rename or add more right in Notion.
const starters = [
  ['🏃‍♀️', 'Move my body', 'Move', 3, 'workout'],
  ['👟', '7,000 steps', 'Move', 4, 'steps>=7000'],
  // Switch to 'sleep_score>=75' once Oura is connected.
  ['😴', 'Slept well', 'Rest', 4, 'manual'],
  ['🌙', 'Rested when my body asked', 'Rest', 0, 'rest_day'],
  ['📚', 'Reading', 'Grow', 3, 'calendar:reading'],
  ['✨', 'Something just for me', 'Joy', 2, 'manual'],
  ['🥩', 'Protein goal', 'Fuel', 5, 'manual | prize_wheel'],
  // Burnout guardrails. Work meetings aren't on Google Calendar, so most are a quick tap.
  ['🛑', 'Logged off on time', 'Boundaries', 4, 'manual'],
  ['☕', 'Took a real break', 'Boundaries', 3, 'manual'],
  ['🛡️', 'Protected my time', 'Boundaries', 0, 'calendar:focus | calendar:me time'],
];
for (const [i, [emoji, name, area, goal, rule]] of starters.entries()) {
  await createPage(habitsDb, {
    Name: P.title(name), Emoji: P.text(emoji), Area: P.select(area),
    'Weekly goal': P.number(goal), Rule: P.text(rule), Order: P.number(i + 1), Active: P.checkbox(true),
  });
}
console.log(`✓ ${starters.length} starter habits`);

console.log(`\nAdd these to .env and to Netlify (Site settings → Environment variables):\n
NOTION_HABITS_DB=${habitsDb}
NOTION_LOG_DB=${logDb}
NOTION_STATS_DB=${statsDb}\n`);
