// Thin wrapper over the Notion REST API (no SDK, so API changes don't break the build).

const API = 'https://api.notion.com/v1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const db = {
  habits: () => required('NOTION_HABITS_DB'),
  log: () => required('NOTION_LOG_DB'),
  stats: () => required('NOTION_STATS_DB'),
};

function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
}

export async function notion(path, method = 'GET', body) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(API + path, {
      method,
      headers: {
        Authorization: `Bearer ${required('NOTION_TOKEN')}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 429 || res.status >= 500) {
      await sleep(800 * (attempt + 1));
      continue;
    }
    const json = await res.json();
    if (!res.ok) throw new Error(`Notion ${method} ${path}: ${json.message}`);
    return json;
  }
  throw new Error(`Notion ${method} ${path}: gave up after retries`);
}

export async function queryAll(databaseId, body = {}) {
  const results = [];
  let cursor;
  do {
    const page = await notion(`/databases/${databaseId}/query`, 'POST', {
      ...body, page_size: 100, start_cursor: cursor,
    });
    results.push(...page.results);
    cursor = page.has_more ? page.next_cursor : undefined;
  } while (cursor);
  return results;
}

export const createPage = (databaseId, properties) =>
  notion('/pages', 'POST', { parent: { database_id: databaseId }, properties });

export const updatePage = (pageId, properties) =>
  notion(`/pages/${pageId}`, 'PATCH', { properties });

export const archivePage = (pageId) =>
  notion(`/pages/${pageId}`, 'PATCH', { archived: true });

// Property writers
export const P = {
  title: (v) => ({ title: [{ text: { content: String(v) } }] }),
  text: (v) => ({ rich_text: v ? [{ text: { content: String(v).slice(0, 2000) } }] : [] }),
  number: (v) => ({ number: v ?? null }),
  date: (v) => ({ date: v ? { start: v } : null }),
  select: (v) => ({ select: v ? { name: v } : null }),
  checkbox: (v) => ({ checkbox: !!v }),
  relation: (id) => ({ relation: id ? [{ id }] : [] }),
};

// Property readers
export const R = {
  title: (p) => (p?.title || []).map((t) => t.plain_text).join(''),
  text: (p) => (p?.rich_text || []).map((t) => t.plain_text).join(''),
  number: (p) => p?.number ?? null,
  date: (p) => p?.date?.start?.slice(0, 10) ?? null,
  select: (p) => p?.select?.name ?? null,
  checkbox: (p) => !!p?.checkbox,
  relation: (p) => p?.relation?.[0]?.id ?? null,
};
