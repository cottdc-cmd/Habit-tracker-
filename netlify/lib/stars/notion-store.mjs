// Notion implementation of the star + coin chart store.
//
// To move to another database, write a file with these same exports
// and change the one import in ./store.mjs. Nothing else needs to know.
//
//   getTasks(all)            routine items + money chores (all = include inactive)
//   getPrizes(all)           star prizes, cheapest first
//   getStore(all)            coin store items
//   getRows(since)           ledger rows dated on/after `since`
//   totalsBefore(date)       { stars, coins: { Tray, Spend, Save, Give } } of rows before `date`
//   findByKey(key)           one ledger row, or null
//   findPlaced(opId)         the row a "place coin" tap already moved, or null
//   trayCoin()               one row with a coin still waiting in the tray, or null
//   addRow(row)              write one ledger row
//   updateRow(id, fields)    change jar / placed / status on a row
//   removeByKey(key)         remove ledger rows (Notion keeps them in Trash)
//   lastCollected(n)         the n most recent star prizes
//   toDeliver()              prizes and purchases not yet delivered
//   saveListItem(list, id, fields)   admin: create or update a task / prize / store item
//   setGoal(itemId)          make one Save item the goal

import { notion, queryAll, createPage, updatePage, archivePage, P, R } from '../notion.mjs';
import { ROUTINES, routineKey } from './logic.mjs';

const env = (name) => {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
};
const db = {
  tasks: () => env('STARS_CHORES_DB'),
  prizes: () => env('STARS_REWARDS_DB'),
  store: () => env('STARS_STORE_DB'),
  ledger: () => env('STARS_LEDGER_DB'),
};
const bare = (id) => String(id || '').replace(/-/g, '');
const activeOnly = (all) => (all ? {} : { filter: { property: 'Active', checkbox: { equals: true } } });

export async function getTasks(all = false) {
  const pages = await queryAll(db.tasks(), { ...activeOnly(all), sorts: [{ property: 'Order', direction: 'ascending' }] });
  return pages.map((p) => ({
    id: bare(p.id),
    name: R.title(p.properties.Name),
    emoji: R.text(p.properties.Emoji) || '⭐',
    group: R.select(p.properties.Group) || 'Morning',
    order: R.number(p.properties.Order) ?? 0,
    coins: Math.max(0, R.number(p.properties.Coins) ?? 0),
    active: R.checkbox(p.properties.Active),
  })).filter((t) => t.name);
}

export async function getPrizes(all = false) {
  const pages = await queryAll(db.prizes(), { ...activeOnly(all), sorts: [{ property: 'Cost', direction: 'ascending' }] });
  return pages.map((p) => ({
    id: bare(p.id),
    name: R.title(p.properties.Name),
    emoji: R.text(p.properties.Emoji) || '🎁',
    cost: Math.max(1, R.number(p.properties.Cost) ?? 1),
    active: R.checkbox(p.properties.Active),
  })).filter((r) => r.name);
}

export async function getStore(all = false) {
  const pages = await queryAll(db.store(), { ...activeOnly(all), sorts: [{ property: 'Price', direction: 'ascending' }] });
  return pages.map((p) => ({
    id: bare(p.id),
    name: R.title(p.properties.Name),
    emoji: R.text(p.properties.Emoji) || '🛍️',
    price: Math.max(1, R.number(p.properties.Price) ?? 1),
    jar: R.select(p.properties.Jar) || 'Spend',
    goal: R.checkbox(p.properties.Goal),
    active: R.checkbox(p.properties.Active),
  })).filter((s) => s.name);
}

function toRow(p) {
  const pr = p.properties;
  const key = R.text(pr.Key);
  const date = R.date(pr.Date);
  return {
    id: bare(p.id),
    key,
    type: R.select(pr.Type),
    stars: R.number(pr.Stars) ?? 0,
    coins: R.number(pr.Coins) ?? 0,
    jar: R.select(pr.Jar),
    status: R.select(pr.Status),
    date,
    taskId: bare(R.relation(pr.Chore)) || null,
    prizeId: bare(R.relation(pr.Reward)) || null,
    itemId: bare(R.relation(pr.Item)) || null,
    note: R.text(pr.Note),
    placed: R.text(pr.Placed),
    name: R.title(pr.Name),
    group: ROUTINES.find((g) => key === routineKey(g, date)) || null,
  };
}

const query = (filter, extra = {}) => queryAll(db.ledger(), { filter, ...extra });
const queryOne = async (filter) => {
  const res = await notion(`/databases/${db.ledger()}/query`, 'POST', { filter, page_size: 1 });
  return res.results[0] ? toRow(res.results[0]) : null;
};

export async function getRows(since) {
  return (await query({ property: 'Date', date: { on_or_after: since } })).map(toRow).filter((r) => r.date);
}

export async function totalsBefore(date) {
  const t = { stars: 0, coins: { Tray: 0, Spend: 0, Save: 0, Give: 0 } };
  for (const p of await query({ property: 'Date', date: { before: date } })) {
    const r = toRow(p);
    t.stars += Number(r.stars) || 0;
    if (r.jar && r.jar in t.coins) t.coins[r.jar] += Number(r.coins) || 0;
  }
  return t;
}

export const findByKey = (key) => queryOne({ property: 'Key', rich_text: { equals: key } });
export const findPlaced = (opId) => queryOne({ property: 'Placed', rich_text: { equals: opId } });
export const trayCoin = () => queryOne({
  and: [{ property: 'Jar', select: { equals: 'Tray' } }, { property: 'Coins', number: { greater_than: 0 } }],
});

export async function addRow(row) {
  await createPage(db.ledger(), {
    Name: P.title(row.name),
    Type: P.select(row.type),
    Stars: P.number(row.stars || 0),
    Coins: P.number(row.coins || 0),
    Date: P.date(row.date),
    Key: P.text(row.key),
    ...(row.jar ? { Jar: P.select(row.jar) } : {}),
    ...(row.status ? { Status: P.select(row.status) } : {}),
    ...(row.note ? { Note: P.text(row.note) } : {}),
    ...(row.taskId ? { Chore: P.relation(row.taskId) } : {}),
    ...(row.prizeId ? { Reward: P.relation(row.prizeId) } : {}),
    ...(row.itemId ? { Item: P.relation(row.itemId) } : {}),
  });
}

export async function updateRow(id, fields) {
  const props = {};
  if ('jar' in fields) props.Jar = P.select(fields.jar);
  if ('placed' in fields) props.Placed = P.text(fields.placed);
  if ('status' in fields) props.Status = P.select(fields.status);
  await updatePage(id, props);
}

export async function removeByKey(key) {
  const rows = await query({ property: 'Key', rich_text: { equals: key } });
  for (const p of rows) await archivePage(p.id);
  return rows.length > 0;
}

export async function lastCollected(n = 5) {
  const res = await notion(`/databases/${db.ledger()}/query`, 'POST', {
    filter: { or: [{ property: 'Type', select: { equals: 'Prize' } }, { property: 'Type', select: { equals: 'Reward' } }] },
    sorts: [{ property: 'Date', direction: 'descending' }, { timestamp: 'created_time', direction: 'descending' }],
    page_size: n,
  });
  return res.results.map(toRow).map((r) => ({ name: r.name, stars: -r.stars, date: r.date }));
}

export async function toDeliver() {
  const rows = await query({ property: 'Status', select: { equals: 'To deliver' } }, { sorts: [{ property: 'Date', direction: 'ascending' }] });
  return rows.map(toRow).map((r) => ({ rowId: r.id, name: r.name, date: r.date, type: r.type, jar: r.jar }));
}

// ---------- Admin edits ----------

const LISTS = {
  tasks: {
    db: () => db.tasks(),
    props: (f) => ({
      ...('name' in f ? { Name: P.title(f.name) } : {}),
      ...('emoji' in f ? { Emoji: P.text(f.emoji) } : {}),
      ...('group' in f ? { Group: P.select(f.group) } : {}),
      ...('order' in f ? { Order: P.number(Number(f.order) || 0) } : {}),
      ...('coins' in f ? { Coins: P.number(Math.max(0, Number(f.coins) || 0)) } : {}),
      ...('active' in f ? { Active: P.checkbox(f.active) } : {}),
    }),
  },
  prizes: {
    db: () => db.prizes(),
    props: (f) => ({
      ...('name' in f ? { Name: P.title(f.name) } : {}),
      ...('emoji' in f ? { Emoji: P.text(f.emoji) } : {}),
      ...('cost' in f ? { Cost: P.number(Math.max(1, Number(f.cost) || 1)) } : {}),
      ...('active' in f ? { Active: P.checkbox(f.active) } : {}),
    }),
  },
  store: {
    db: () => db.store(),
    props: (f) => ({
      ...('name' in f ? { Name: P.title(f.name) } : {}),
      ...('emoji' in f ? { Emoji: P.text(f.emoji) } : {}),
      ...('price' in f ? { Price: P.number(Math.max(1, Number(f.price) || 1)) } : {}),
      ...('jar' in f ? { Jar: P.select(f.jar) } : {}),
      ...('active' in f ? { Active: P.checkbox(f.active) } : {}),
    }),
  },
};

export async function saveListItem(list, id, fields) {
  const l = LISTS[list];
  if (!l) throw new Error(`Unknown list ${list}`);
  const props = l.props(fields);
  if (id) await updatePage(id, props);
  else await createPage(l.db(), { Active: P.checkbox(true), ...props });
}

export async function setGoal(itemId) {
  const items = await getStore(true);
  for (const s of items) {
    const want = s.id === itemId;
    if (s.goal !== want && (want || s.jar === 'Save' || s.goal)) await updatePage(s.id, { Goal: P.checkbox(want) });
  }
}
