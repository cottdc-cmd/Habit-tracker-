// One-time setup for the star chart: builds Routines & Chores, Star Prizes,
// Coin Store and Star Ledger databases inside a Notion page, seeds the starters, and prints the IDs.
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

const choresDb = await makeDb('Routines & Chores', '🧺', {
  Name: { title: {} },
  Emoji: text,
  Group: select(['Morning', 'After school', 'Money']),
  Coins: { number: {} },
  Order: { number: {} },
  Active: { checkbox: {} },
});

const prizesDb = await makeDb('Star Prizes', '🏆', {
  Name: { title: {} },
  Emoji: text,
  Cost: { number: {} },
  Active: { checkbox: {} },
});

const storeDb = await makeDb('Coin Store', '🛍️', {
  Name: { title: {} },
  Emoji: text,
  Price: { number: {} },
  Jar: select(['Spend', 'Save', 'Give']),
  Goal: { checkbox: {} },
  Active: { checkbox: {} },
});

const ledgerDb = await makeDb('Star Ledger', '⭐', {
  Name: { title: {} },
  Type: select(['Check', 'Routine', 'Bonus', 'Removed', 'Prize', 'Purchase']),
  Stars: { number: {} },
  Coins: { number: {} },
  Jar: select(['Tray', 'Spend', 'Save', 'Give']),
  Status: select(['To deliver', 'Delivered']),
  Date: { date: {} },
  Chore: { relation: { database_id: choresDb, single_property: {} } },
  Reward: { relation: { database_id: prizesDb, single_property: {} } },
  Item: { relation: { database_id: storeDb, single_property: {} } },
  Key: text,
  Placed: text,
  Note: text,
  Logged: { created_time: {} },
});

// [emoji, name, group, coins]
const tasks = [
  ['🥣', 'Eat breakfast', 'Morning', 0], ['🛏️', 'Make bed', 'Morning', 0], ['🪥', 'Brush teeth', 'Morning', 0],
  ['💇‍♀️', 'Brush hair', 'Morning', 0], ['👗', 'Get dressed', 'Morning', 0], ['🐶', 'Feed dogs', 'Morning', 1],
  ['🚗', 'Ready to leave', 'Morning', 0],
  ['📝', 'Pull out homework', 'After school', 0], ['👟', 'Put away shoes', 'After school', 0], ['🍝', 'Eat dinner', 'After school', 0],
  ['🛁', 'Bath', 'After school', 0], ['🪥', 'Brush teeth', 'After school', 0], ['🐶', 'Feed dogs', 'After school', 1],
  ['🍽️', 'Plate to the sink', 'Money', 1], ['🧺', 'Clothes in the hamper', 'Money', 1], ['🍴', 'Set the table', 'Money', 1],
  ['🪴', 'Water plants', 'Money', 1], ['🧦', 'Match socks', 'Money', 1], ['🧽', 'Wipe the table', 'Money', 1],
  ['🧸', 'Toys in bins', 'Money', 1],
];
for (const [i, [emoji, name, group, coins]] of tasks.entries()) {
  await createPage(choresDb, { Name: P.title(name), Emoji: P.text(emoji), Group: P.select(group), Coins: P.number(coins), Order: P.number(i + 1), Active: P.checkbox(true) });
}
console.log(`✓ ${tasks.length} routine items and money chores`);

const prizes = [['🍬', 'Candy pick', 2], ['📺', '15 min screen time', 4], ['🍨', 'Dessert pick', 6], ['🎬', 'Movie night pick', 12], ['🎡', 'Family outing', 30]];
for (const [emoji, name, cost] of prizes) {
  await createPage(prizesDb, { Name: P.title(name), Emoji: P.text(emoji), Cost: P.number(cost), Active: P.checkbox(true) });
}
console.log(`✓ ${prizes.length} star prizes`);

const items = [
  ['⭐', 'Stickers', 2, 'Spend'], ['🎀', 'Hair clip', 5, 'Spend'], ['🧸', 'Small toy', 5, 'Spend'],
  ['🎨', 'Craft kit', 10, 'Save'], ['📚', 'Book or bigger toy', 20, 'Save'],
  ['🎁', 'Gift for a friend', 5, 'Give'], ['🐾', 'Animal shelter gift', 5, 'Give'],
];
for (const [emoji, name, price, jar] of items) {
  await createPage(storeDb, { Name: P.title(name), Emoji: P.text(emoji), Price: P.number(price), Jar: P.select(jar), Active: P.checkbox(true) });
}
console.log(`✓ ${items.length} store items`);

console.log(`\nAdd these to .env and to Netlify (Site configuration → Environment variables):\n
STARS_CHORES_DB=${choresDb}
STARS_REWARDS_DB=${prizesDb}
STARS_STORE_DB=${storeDb}
STARS_LEDGER_DB=${ledgerDb}
KIOSK_KEY=${randomBytes(12).toString('hex')}

Then open this on the tablet:  https://YOUR-SITE.netlify.app/stars/?k=<KIOSK_KEY>\n`);
