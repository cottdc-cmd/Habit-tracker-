// One-time setup for the star chart: builds Chores, Rewards and Star Ledger
// databases inside a Notion page, seeds the starters, and prints the IDs.
//
//   npm run setup:stars
//
// Uses STARS_PARENT_PAGE_ID if set, otherwise NOTION_PARENT_PAGE_ID.

import { randomBytes } from 'node:crypto';
import { notion, createPage, P } from '../netlify/lib/notion.mjs';

const parent = process.env.STARS_PARENT_PAGE_ID || process.env.NOTION_PARENT_PAGE_ID;
if (!parent) throw new Error('Set STARS_PARENT_PAGE_ID (or NOTION_PARENT_PAGE_ID) in .env first');

const select = (names) => ({ select: { options: names.map((name) => ({ name })) } });
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

const choresDb = await makeDb('Chores', '🧺', {
  Name: { title: {} },
  Emoji: text,
  Group: select(['Morning', 'After school']),
  Order: { number: {} },
  Active: { checkbox: {} },
});

const rewardsDb = await makeDb('Rewards', '🎁', {
  Name: { title: {} },
  Emoji: text,
  Cost: { number: {} },
  Active: { checkbox: {} },
});

const ledgerDb = await makeDb('Star Ledger', '⭐', {
  Name: { title: {} },
  Type: select(['Chore', 'Bonus', 'Removed', 'Reward']),
  Stars: { number: {} },
  Date: { date: {} },
  Chore: { relation: { database_id: choresDb, single_property: {} } },
  Reward: { relation: { database_id: rewardsDb, single_property: {} } },
  Key: text,
  Logged: { created_time: {} },
});

const chores = [
  ['👗', 'Get dressed', 'Morning'],
  ['🪥', 'Brush teeth', 'Morning'],
  ['🎒', 'Backpack and shoes away', 'After school'],
  ['🍽️', 'Plate to the sink', 'After school'],
];
for (const [i, [emoji, name, group]] of chores.entries()) {
  await createPage(choresDb, { Name: P.title(name), Emoji: P.text(emoji), Group: P.select(group), Order: P.number(i + 1), Active: P.checkbox(true) });
}
console.log(`✓ ${chores.length} starter chores`);

const rewards = [
  ['🍭', 'Pick a treat', 10],
  ['🎬', 'Pick the Friday movie', 20],
  ['🎡', 'Choose a family outing', 40],
];
for (const [emoji, name, cost] of rewards) {
  await createPage(rewardsDb, { Name: P.title(name), Emoji: P.text(emoji), Cost: P.number(cost), Active: P.checkbox(true) });
}
console.log(`✓ ${rewards.length} starter rewards`);

console.log(`\nAdd these to .env and to Netlify (Site configuration → Environment variables):\n
STARS_CHORES_DB=${choresDb}
STARS_REWARDS_DB=${rewardsDb}
STARS_LEDGER_DB=${ledgerDb}
KIOSK_KEY=${randomBytes(12).toString('hex')}

Then open this on the tablet:  https://YOUR-SITE.netlify.app/stars/?k=<KIOSK_KEY>\n`);
