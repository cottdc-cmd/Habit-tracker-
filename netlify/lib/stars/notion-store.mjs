// Notion implementation of the star-chart store.
//
// To move to another database, write a file with these same exports
// and change the one import in ./store.mjs. Nothing else needs to know.
//
//   getChores()            active chores, in order
//   getRewards()           active rewards, cheapest first
//   getRows(since)         ledger rows dated on/after `since`
//   sumBefore(date)        total Stars of every row dated before `date`
//   findByKey(key)         one ledger row, or null
//   addRow(row)            write one ledger row
//   removeByKey(key)       remove a ledger row (Notion keeps it in Trash)
//   lastCollected(n)       the n most recent Reward rows

import { notion, queryAll, createPage, archivePage, P, R } from '../notion.mjs';

const env = (name) => {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
};
const db = {
  chores: () => env('STARS_CHORES_DB'),
  rewards: () => env('STARS_REWARDS_DB'),
  ledger: () => env('STARS_LEDGER_DB'),
};
const bare = (id) => String(id || '').replace(/-/g, '');
const active = { property: 'Active', checkbox: { equals: true } };

export async function getChores() {
  const pages = await queryAll(db.chores(), { filter: active, sorts: [{ property: 'Order', direction: 'ascending' }] });
  return pages.map((p) => ({
    id: bare(p.id),
    name: R.title(p.properties.Name),
    emoji: R.text(p.properties.Emoji) || '⭐',
    group: R.select(p.properties.Group) || 'Morning',
  })).filter((c) => c.name);
}

export async function getRewards() {
  const pages = await queryAll(db.rewards(), { filter: active, sorts: [{ property: 'Cost', direction: 'ascending' }] });
  return pages.map((p) => ({
    id: bare(p.id),
    name: R.title(p.properties.Name),
    emoji: R.text(p.properties.Emoji) || '🎁',
    cost: Math.max(1, R.number(p.properties.Cost) ?? 10),
  })).filter((r) => r.name);
}

function toRow(p) {
  const pr = p.properties;
  return {
    id: p.id,
    key: R.text(pr.Key),
    type: R.select(pr.Type),
    stars: R.number(pr.Stars) ?? 0,
    date: R.date(pr.Date),
    choreId: bare(R.relation(pr.Chore)) || null,
    rewardId: bare(R.relation(pr.Reward)) || null,
    name: R.title(pr.Name),
    loggedAt: p.created_time,
  };
}

export async function getRows(since) {
  const pages = await queryAll(db.ledger(), { filter: { property: 'Date', date: { on_or_after: since } } });
  return pages.map(toRow).filter((r) => r.date);
}

export async function sumBefore(date) {
  const pages = await queryAll(db.ledger(), { filter: { property: 'Date', date: { before: date } } });
  return pages.reduce((n, p) => n + (R.number(p.properties.Stars) || 0), 0);
}

export async function findByKey(key) {
  const res = await notion(`/databases/${db.ledger()}/query`, 'POST', {
    filter: { property: 'Key', rich_text: { equals: key } }, page_size: 5,
  });
  return res.results[0] ? toRow(res.results[0]) : null;
}

export async function addRow(row) {
  await createPage(db.ledger(), {
    Name: P.title(row.name),
    Type: P.select(row.type),
    Stars: P.number(row.stars),
    Date: P.date(row.date),
    Key: P.text(row.key),
    ...(row.choreId ? { Chore: P.relation(row.choreId) } : {}),
    ...(row.rewardId ? { Reward: P.relation(row.rewardId) } : {}),
  });
}

export async function removeByKey(key) {
  const res = await notion(`/databases/${db.ledger()}/query`, 'POST', {
    filter: { property: 'Key', rich_text: { equals: key } }, page_size: 20,
  });
  for (const p of res.results) await archivePage(p.id);
  return res.results.length > 0;
}

export async function lastCollected(n = 5) {
  const res = await notion(`/databases/${db.ledger()}/query`, 'POST', {
    filter: { property: 'Type', select: { equals: 'Reward' } },
    sorts: [{ property: 'Date', direction: 'descending' }, { timestamp: 'created_time', direction: 'descending' }],
    page_size: n,
  });
  return res.results.map(toRow).map((r) => ({ name: r.name, stars: -r.stars, date: r.date }));
}
