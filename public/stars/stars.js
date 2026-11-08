// Star + coin chart for the wall tablet. Plain JS, no build.
//
// Every tap goes into an "outbox" saved on the tablet first, then to the server.
// If saving fails, the tap stays in the outbox and is retried until it lands,
// even across a page reload. A clear message shows while anything is unsaved.
// The screen always shows the server's last state with unsaved taps replayed on top.

(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const params = new URLSearchParams(location.search);
  const DEMO = params.has('demo');
  const REFRESH_MS = 5 * 60 * 1000;
  const ROUTINES = ['Morning', 'After school'];
  const JARS = ['Spend', 'Save', 'Give'];

  // ---------- Small safe storage (works even if storage is blocked) ----------
  const mem = {};
  const ls = {
    ok: (() => { try { localStorage.setItem('__t', '1'); localStorage.removeItem('__t'); return true; } catch { return false; } })(),
    get(k, fallback) {
      try { const v = localStorage.getItem(k); return v == null ? fallback : JSON.parse(v); } catch { return k in mem ? mem[k] : fallback; }
    },
    set(k, v) { mem[k] = v; try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* memory only */ } },
  };
  const NS = DEMO ? 'stars-demo:' : 'stars2:';

  const theme = params.get('theme');
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;

  // ---------- Kiosk key ----------
  const kioskKey = params.get('k') || ls.get('stars:key', '');
  if (params.get('k')) ls.set('stars:key', params.get('k'));

  // ---------- Dates in the family's timezone ----------
  let tz = ls.get(NS + 'tz', Intl.DateTimeFormat().resolvedOptions().timeZone);
  const dayKey = (d = new Date()) => {
    try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d); }
    catch { return new Intl.DateTimeFormat('en-CA').format(d); }
  };
  const addDays = (key, n) => { const d = new Date(`${key}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const fmt = (key, opts) => new Date(`${key}T12:00:00Z`).toLocaleDateString(undefined, { timeZone: 'UTC', ...opts });
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- API ----------
  class SaveError extends Error {
    constructor(message, permanent) { super(message); this.permanent = permanent; }
  }
  async function call(method, body, query = '') {
    let res;
    try {
      res = await fetch(`/api/stars${query}`, {
        method,
        headers: { 'Content-Type': 'application/json', 'x-kiosk-key': kioskKey },
        body: body ? JSON.stringify(body) : undefined,
        cache: 'no-store',
        signal: AbortSignal.timeout ? AbortSignal.timeout(25000) : undefined,
      });
    } catch {
      throw new SaveError('No internet connection right now.', false);
    }
    let data = {};
    try { data = await res.json(); } catch { /* not JSON */ }
    if (res.status === 401) { showSetup(data.error); throw new SaveError(data.error || 'Wrong kiosk key.', false); }
    if (!res.ok) throw new SaveError(data.error || `The server said ${res.status}.`, res.status >= 400 && res.status < 500);
    return data;
  }
  const api = DEMO ? demoApi() : {
    load: () => call('GET'),
    send: (op) => call('POST', op),
    lists: () => call('GET', null, '?lists=1'),
    saveItem: (body) => call('POST', { admin: true, ...body }),
  };

  // ---------- State ----------
  let server = ls.get(NS + 'last', null); // last good state from the server
  if (server && !server.byKid) server = null; // saved by an older version
  let outbox = ls.get(NS + 'outbox', []);
  let kidId = ls.get('stars:kid', null);
  const kids = () => server?.kids || [];
  const currentKid = () => kids().find((k) => k.id === kidId) || kids()[0] || { id: 'default', name: '' };
  const opKid = (o) => o.kidId || kids()[0]?.id;
  const saveOutbox = () => ls.set(NS + 'outbox', outbox);

  // Replays taps on top of a server-shaped state. Mirrors the server's rules.
  function replay(s, ops, today = dayKey()) {
    const tasks = s.tasks || [];
    const taskById = Object.fromEntries(tasks.map((t) => [t.id, t]));
    let stars = s.stars || 0;
    const coins = { Tray: 0, Spend: 0, Save: 0, Give: 0, ...(s.coins || {}) };
    const checks = Object.fromEntries(Object.entries(s.checks || {}).map(([d, ids]) => [d, new Set(ids)]));
    const routines = JSON.parse(JSON.stringify(s.routines || {}));
    const perDay = Object.fromEntries((s.week || []).map((d) => [d.date, d.stars]));
    const collected = [...(s.collected || [])];
    let toDeliver = [...(s.toDeliver || [])];
    const store = (s.store || []).map((x) => ({ ...x }));
    const touched = new Map(); // "date|group" -> { date, group, delayed }
    const day = (d, n) => { perDay[d] = (perDay[d] || 0) + n; };
    const takeCoin = (n) => {
      for (let i = 0; i < n; i++) {
        const j = ['Tray', ...JARS].find((k) => coins[k] > 0);
        if (j) coins[j]--;
      }
    };

    for (const op of ops) {
      const set = (checks[op.date] ||= new Set());
      const t = taskById[op.taskId];
      const touch = (group, delayed = false) => {
        if (!ROUTINES.includes(group)) return;
        const k = `${op.date}|${group}`;
        const cur = touched.get(k) || { date: op.date, group, delayed: false };
        touched.set(k, { ...cur, delayed: cur.delayed || delayed });
      };
      switch (op.type) {
        case 'check':
          if (t && !set.has(t.id)) { set.add(t.id); coins.Tray += t.coins || 0; touch(t.group); }
          break;
        case 'uncheck':
          if (t && set.has(t.id)) { set.delete(t.id); takeCoin(t.coins || 0); touch(t.group); }
          break;
        case 'delay': touch(op.group, true); break;
        case 'bonus': stars++; day(op.date, 1); break;
        case 'extra': { const n = t ? t.stars ?? 1 : 1; stars += n; day(op.date, n); break; }
        case 'removeStar': stars--; day(op.date, -1); break;
        case 'removeCoin': takeCoin(1); break;
        case 'place': if (coins.Tray > 0) { coins.Tray--; coins[op.jar]++; } break;
        case 'collect': {
          const p = (s.prizes || []).find((x) => x.id === op.prizeId);
          if (p) {
            stars -= p.cost;
            collected.unshift({ name: `${p.emoji} ${p.name}`, stars: p.cost, date: op.date });
            toDeliver.push({ rowId: `pending-${op.id}`, name: `${p.emoji} ${p.name}`, date: op.date, type: 'Prize' });
          }
          break;
        }
        case 'buy': {
          const it = store.find((x) => x.id === op.itemId);
          if (it) {
            coins[it.jar] -= it.price;
            toDeliver.push({ rowId: `pending-${op.id}`, name: `${it.emoji} ${it.name}`, date: op.date, type: 'Purchase', jar: it.jar });
          }
          break;
        }
        case 'goal': for (const x of store) if (x.jar === 'Save') x.goal = x.id === op.itemId; break;
        case 'deliver': toDeliver = toDeliver.filter((x) => x.rowId !== op.rowId); break;
      }
    }

    // Routine stars: earned when every item is checked, or when grown-ups were the delay.
    for (const { date, group, delayed } of touched.values()) {
      const before = routines[date]?.[group] || null;
      const items = tasks.filter((x) => x.group === group);
      const complete = items.length > 0 && items.every((x) => checks[date]?.has(x.id));
      let after;
      if (before === 'grownups' || (delayed && !before)) after = 'grownups';
      else if (complete) after = 'done';
      else if (delayed) after = before || 'grownups';
      else after = null;
      if (!!after !== !!before) { const d = after ? 1 : -1; stars += d; day(date, d); }
      (routines[date] ||= {})[group] = after;
    }

    const week = [];
    for (let i = 6; i >= 0; i--) { const date = addDays(today, -i); week.push({ date, stars: Math.max(0, perDay[date] || 0) }); }
    return {
      ...s, stars, coins, store, routines, week, collected: collected.slice(0, 5), toDeliver,
      checks: Object.fromEntries(Object.entries(checks).map(([d, ids]) => [d, [...ids]])),
    };
  }

  function view() {
    const today = dayKey();
    const kid = currentKid();
    const base = { ...(server.byKid?.[kid.id] || {}), morningGoal: server.morningGoal };
    const v = replay(base, outbox.filter((o) => opKid(o) === kid.id), today);
    return { ...v, kid, today, done: new Set(v.checks[today] || []), routineToday: v.routines[today] || {} };
  }

  // ---------- Rendering ----------
  let last = { stars: null, coins: null, Morning: undefined, 'After school': undefined };
  let lastKid = null;
  function render() {
    if (!server) return;
    const v = view();
    const ks = kids();
    $('#title').textContent = v.kid.name ? `${v.kid.name}'s stars` : 'My stars';
    document.body.classList.toggle('simple', !!v.kid.simple);
    $('#kids').hidden = ks.length < 2;
    $('#kids').innerHTML = ks.map((k) => `<button class="kid-tab${k.id === v.kid.id ? ' on' : ''}" data-kid="${esc(k.id)}" aria-pressed="${k.id === v.kid.id}">${esc(k.emoji)} ${esc(k.name)}</button>`).join('');
    if (lastKid !== v.kid.id) { last = { stars: null, coins: null, Morning: undefined, 'After school': undefined }; lastKid = v.kid.id; }
    $('#today-label').textContent = fmt(v.today, { weekday: 'long', month: 'long', day: 'numeric' });
    $('#morning-goal').textContent = `⏰ ${v.morningGoal || 'Ready by 7:30'}`;
    const coinTotal = v.coins.Tray + v.coins.Spend + v.coins.Save + v.coins.Give;
    $('#stars').textContent = v.stars;
    $('#coins').textContent = coinTotal;
    if (last.stars !== null && v.stars > last.stars) bump($('#stars').parentElement);
    if (last.coins !== null && coinTotal > last.coins) bump($('#coins').parentElement);

    // Checklists + money chores
    for (const section of $$('[data-group]', $('#app')).filter((el) => el.matches('section'))) {
      const group = section.dataset.group;
      const items = v.tasks.filter((t) => t.group === group);
      section.hidden = !items.length && group !== 'Money';
      $('.tiles', section).innerHTML = items.map((t) => {
        const done = v.done.has(t.id);
        return `<button class="tile${done ? ' done' : ''}" data-task="${esc(t.id)}" aria-pressed="${done}">
          ${t.coins > 0 ? `<span class="badge" aria-label="earns a coin">+${t.coins} 🪙</span>` : ''}
          <span class="check" aria-hidden="true">✅</span>
          <span class="emoji" aria-hidden="true">${esc(t.emoji)}</span>
          <span class="label">${esc(t.name)}</span>
        </button>`;
      }).join('') || '<p class="empty">Nothing here yet. Add some in ⚙️ Edit lists.</p>';

      const slot = $('.routine-star', section);
      if (slot) {
        const status = v.routineToday[group];
        const doneCount = items.filter((t) => v.done.has(t.id)).length;
        slot.classList.toggle('earned', !!status);
        slot.innerHTML = `<span class="slot" aria-hidden="true">⭐</span>
          <span>${status === 'grownups' ? 'Star earned! Thanks for your patience 💛' : status ? 'Star earned! All done 🎉' : 'Finish them all for a star'}</span>
          <span class="dots" aria-label="${doneCount} of ${items.length} done">${items.map((t) => `<span class="dot${v.done.has(t.id) ? ' on' : ''}"></span>`).join('')}</span>`;
        if (status && last[group] === null) bump(slot); // just earned
        last[group] = status || null;
      }
    }

    // Week strip
    $('#week').innerHTML = v.week.map((d) => `
      <div class="day${d.date === v.today ? ' today' : ''}" aria-label="${fmt(d.date, { weekday: 'long' })}: ${d.stars} stars">
        <span class="dow">${fmt(d.date, { weekday: 'narrow' })}</span>
        <span class="count">${d.stars}</span>
        <span class="stars" aria-hidden="true">${'⭐'.repeat(Math.min(d.stars, 4))}</span>
      </div>`).join('');

    // Tray + jars
    const tray = $('#tray');
    tray.classList.toggle('empty-tray', v.coins.Tray <= 0);
    tray.innerHTML = v.coins.Tray > 0
      ? `${'<span class="coin" aria-hidden="true">🪙</span>'.repeat(Math.min(v.coins.Tray, 8))}${v.coins.Tray > 8 ? `<span>+${v.coins.Tray - 8}</span>` : ''}<span class="tip">👇 Tap a jar for each coin</span>`
      : '<span>🪙 New coins land here</span>';
    const biggest = Math.max(10, ...JARS.map((j) => v.coins[j]));
    for (const el of $$('.jar')) {
      const n = v.coins[el.dataset.jar];
      $('.jar-num', el).textContent = n;
      $('.jar-fill', el).style.height = `${Math.min(100, (Math.max(0, n) / biggest) * 100)}%`;
      el.classList.toggle('can-place', v.coins.Tray > 0);
      el.setAttribute('aria-label', `${el.dataset.jar} jar: ${n} coins${v.coins.Tray > 0 ? '. Tap to put a coin in.' : ''}`);
    }
    last.stars = v.stars; last.coins = coinTotal;

    // Star prize ladder
    $('#prizes').innerHTML = v.prizes.map((p) => progressItem({
      action: 'collect', idAttr: `data-prize="${esc(p.id)}"`, emoji: p.emoji, name: p.name,
      have: v.stars, cost: p.cost, unit: '⭐', readyText: 'Ready! 🎉',
    })).join('') || '<p class="empty">Add star prizes in ⚙️ Edit lists.</p>';
    $('#prizes-card').hidden = !!v.kid.simple && !v.prizes.length;

    const extras = v.tasks.filter((t) => t.group === 'Extra');
    $('#extras').innerHTML = extras.map((t) => `<button class="hold pill small" data-action="extra" data-task="${esc(t.id)}">
        <span class="hold-fill"></span><span>${esc(t.emoji)} ${esc(t.name)} · +${t.stars ?? 1} ⭐</span></button>`).join('')
      || '<p class="empty">Add reasons in ⚙️ Edit lists (group: Extra).</p>';

    // Coin store
    const byJar = (j) => v.store.filter((x) => x.jar === j);
    const spend = byJar('Spend').map((x) => storeItem(x, v.coins.Spend)).join('');
    const saveItems = byJar('Save');
    const goal = saveItems.find((x) => x.goal);
    const save = goal
      ? storeItem(goal, v.coins.Save, '🎯 ') + (saveItems.length > 1
        ? `<div class="goal-picks">${saveItems.filter((x) => x !== goal).map((x) => `<button class="goal-pick" data-goal="${esc(x.id)}">${esc(x.emoji)} ${esc(x.name)} · ${x.price} 🪙</button>`).join('')}</div>` : '')
      : `<p class="empty">Pick a goal to save for:</p><div class="goal-picks">${saveItems.map((x) => `<button class="goal-pick" data-goal="${esc(x.id)}">${esc(x.emoji)} ${esc(x.name)} · ${x.price} 🪙</button>`).join('')}</div>`;
    const give = byJar('Give').map((x) => storeItem(x, v.coins.Give)).join('');
    $('#store').innerHTML = `
      <div class="store-group"><h3>🛍️ Spend jar</h3><div class="list">${spend || '<p class="empty">No items yet.</p>'}</div></div>
      <div class="store-group"><h3>🐷 Save jar goal</h3><div class="list">${save}</div></div>
      <div class="store-group"><h3>💝 Give jar</h3><div class="list">${give || '<p class="empty">No items yet.</p>'}</div></div>`;

    // Grown-up lists
    $('#deliver').innerHTML = v.toDeliver.length
      ? v.toDeliver.map((d) => `<li><span>${esc(d.name)} <span class="when">${fmt(d.date, { month: 'short', day: 'numeric' })}</span></span>
          ${outbox.some((o) => `pending-${o.id}` === d.rowId)
            ? '<span class="when">saving…</span>'
            : `<button class="hold pill small" data-action="deliver" data-row="${esc(d.rowId)}"><span class="hold-fill"></span><span>✓ Delivered</span></button>`}</li>`).join('')
      : '<li class="when">Nothing waiting</li>';
    $('#collected').innerHTML = v.collected.length
      ? v.collected.map((c) => `<li><span>${esc(c.name)}</span><span class="when">${fmt(c.date, { month: 'short', day: 'numeric' })} · ${c.stars} ⭐</span></li>`).join('')
      : '<li class="when">Nothing yet</li>';
  }

  function progressItem({ action, idAttr, emoji, name, have, cost, unit, readyText, coin }) {
    const ready = have >= cost;
    const pct = Math.max(0, Math.min(100, (have / cost) * 100));
    return `<button class="item hold${ready ? ' ready' : ''}${coin ? ' coin-item' : ''}" data-action="${action}" ${idAttr}
        aria-label="${esc(name)}: ${Math.max(0, Math.min(have, cost))} of ${cost}${ready ? '. Ready! Grown-ups, hold to give it.' : ''}">
      <span class="hold-fill"></span>
      <span class="emoji" aria-hidden="true">${esc(emoji)}</span>
      <span class="name"><span>${esc(name)}</span><span class="cost">${ready ? readyText : `${Math.max(0, have)} / ${cost} ${unit}`}</span></span>
      <span class="bar"><span class="bar-fill" style="width:${pct}%"></span></span>
    </button>`;
  }
  const storeItem = (x, have, prefix = '') => progressItem({
    action: 'buy', idAttr: `data-item="${esc(x.id)}"`, emoji: x.emoji, name: prefix + x.name,
    have, cost: x.price, unit: '🪙', readyText: x.jar === 'Give' ? 'Ready to give! 💝' : x.jar === 'Save' ? 'Unlocked! 🎉' : 'Ready! 🎉', coin: true,
  });
  function bump(el) { if (!el) return; el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
  function nope(el) { if (!el) return; el.classList.remove('nope'); void el.offsetWidth; el.classList.add('nope'); }

  // ---------- Save status ----------
  let stickyError = null, retryMsg = '', loadMsg = '';
  function showStatus() {
    const el = $('#status');
    let html = '';
    if (stickyError) html = `<span>⚠️ ${esc(stickyError)}</span><button type="button" data-dismiss>OK</button>`;
    else if (outbox.length && retryMsg) html = `<span>⚠️ ${outbox.length} tap${outbox.length > 1 ? 's' : ''} not saved yet. Kept on this tablet and trying again. (${esc(retryMsg)})</span>`;
    else if (!ls.ok) html = '<span>⚠️ This browser is blocking storage, so unsaved taps would be lost on reload.</span>';
    else if (loadMsg) html = `<span>⚠️ Can't reach the star chart. Showing the last saved view. (${esc(loadMsg)})</span>`;
    el.className = 'status warn';
    el.innerHTML = html;
    el.hidden = !html;
  }
  $('#status').addEventListener('click', (e) => {
    if (e.target.closest('[data-dismiss]')) { stickyError = null; showStatus(); }
  });

  // ---------- Outbox ----------
  let draining = false, retryTimer = null, retryDelay = 5000;
  function enqueue(op) {
    outbox.push({ id: uid(), date: dayKey(), at: new Date().toISOString(), kidId: currentKid().id, ...op });
    saveOutbox();
    render();
    drain();
  }
  async function drain() {
    if (draining) return;
    draining = true;
    clearTimeout(retryTimer);
    while (outbox.length) {
      const op = outbox[0];
      try {
        await api.send(op);
        outbox.shift(); saveOutbox();
        retryMsg = ''; retryDelay = 5000;
      } catch (e) {
        if (e.permanent) {
          // The server refused this tap for a reason retrying won't fix. Undo it on screen and say why.
          outbox.shift(); saveOutbox();
          stickyError = `Couldn't save that: ${e.message}`;
          render(); showStatus();
          continue;
        }
        retryMsg = e.message;
        showStatus();
        retryTimer = setTimeout(drain, retryDelay);
        retryDelay = Math.min(retryDelay * 2, 60000);
        draining = false;
        return;
      }
    }
    draining = false;
    showStatus();
    refresh();
  }

  // ---------- Loading ----------
  let loading = false;
  async function refresh() {
    if (loading || draining || outbox.length) return; // never overwrite unsaved taps
    loading = true;
    try {
      const s = await api.load();
      if (!outbox.length) {
        server = s; tz = s.timezone || tz;
        ls.set(NS + 'last', s); ls.set(NS + 'tz', tz);
      }
      loadMsg = '';
      showApp();
    } catch (e) {
      loadMsg = e.message;
      if (server) showApp();
    } finally {
      loading = false;
      showStatus();
    }
  }
  function showApp() { $('#setup').hidden = true; $('#app').hidden = false; render(); }
  function showSetup(msg) {
    $('#app').hidden = true; $('#setup').hidden = false;
    if (msg) $('#setup-msg').innerHTML = `${esc(msg)} Open it as <code>/stars/?k=YOUR_KIOSK_KEY</code>.`;
  }

  // ---------- Kid taps ----------
  document.addEventListener('click', (e) => {
    if (!$('#admin').hidden) return;
    const tab = e.target.closest('.kid-tab');
    if (tab) { kidId = tab.dataset.kid; ls.set('stars:kid', kidId); render(); window.scrollTo(0, 0); return; }
    const tile = e.target.closest('.tile');
    if (tile) {
      const done = view().done.has(tile.dataset.task);
      enqueue({ type: done ? 'uncheck' : 'check', taskId: tile.dataset.task });
      if (!done && navigator.vibrate) navigator.vibrate(15);
      return;
    }
    const jar = e.target.closest('.jar');
    if (jar) {
      if (view().coins.Tray <= 0) { nope(jar); return; }
      enqueue({ type: 'place', jar: jar.dataset.jar });
      bump($('.jar-body', jar));
      if (navigator.vibrate) navigator.vibrate(15);
      return;
    }
    const pick = e.target.closest('[data-goal]');
    if (pick) enqueue({ type: 'goal', itemId: pick.dataset.goal });
  });

  // ---------- Press and hold (grown-ups) ----------
  let hold = null;
  function startHold(e) {
    const el = e.target.closest('.hold');
    if (!el || (e.button != null && e.button > 0)) return;
    cancelHold();
    const ms = Number(el.dataset.hold) || 1000;
    el.style.setProperty('--hold', `${ms}ms`);
    el.classList.add('holding');
    hold = { el, x: e.clientX, y: e.clientY, timer: setTimeout(() => finishHold(el), ms) };
  }
  function cancelHold() {
    if (!hold) return;
    clearTimeout(hold.timer);
    hold.el.classList.remove('holding');
    hold = null;
  }
  function finishHold(el) {
    el.classList.remove('holding');
    hold = null;
    const v = view();
    const a = el.dataset.action;
    if (navigator.vibrate) navigator.vibrate(40);
    if (a === 'bonus') enqueue({ type: 'bonus' });
    else if (a === 'extra') {
      const t = v.tasks.find((x) => x.id === el.dataset.task);
      if (!t) return;
      enqueue({ type: 'extra', taskId: t.id });
      cheer(t.emoji, `${t.name}! +${t.stars ?? 1} ⭐`);
    }
    else if (a === 'removeStar') { if (v.stars < 1) return nope(el); enqueue({ type: 'removeStar' }); }
    else if (a === 'removeCoin') {
      const total = v.coins.Tray + v.coins.Spend + v.coins.Save + v.coins.Give;
      if (total < 1) return nope(el);
      enqueue({ type: 'removeCoin' });
    } else if (a === 'delay') {
      if (v.routineToday[el.dataset.group]) return nope(el);
      enqueue({ type: 'delay', group: el.dataset.group });
    } else if (a === 'collect') {
      const p = v.prizes.find((x) => x.id === el.dataset.prize);
      if (!p || v.stars < p.cost) return nope(el);
      enqueue({ type: 'collect', prizeId: p.id });
      cheer(p.emoji, `${p.name}! Enjoy!`);
    } else if (a === 'buy') {
      const it = v.store.find((x) => x.id === el.dataset.item);
      if (!it || v.coins[it.jar] < it.price) return nope(el);
      enqueue({ type: 'buy', itemId: it.id });
      cheer(it.emoji, it.jar === 'Give' ? `${it.name}. How kind! 💝` : `${it.name}! You did it!`);
    } else if (a === 'deliver') enqueue({ type: 'deliver', rowId: el.dataset.row });
    else if (a === 'admin') openAdmin();
  }
  document.addEventListener('pointerdown', startHold);
  document.addEventListener('pointermove', (e) => {
    if (hold && Math.hypot(e.clientX - hold.x, e.clientY - hold.y) > 24) cancelHold();
  });
  for (const ev of ['pointerup', 'pointercancel']) document.addEventListener(ev, cancelHold);
  window.addEventListener('blur', cancelHold);

  // No long-press menus, image drags, selection or zoom anywhere (inputs in the admin screen excepted).
  const isInput = (t) => t && t.closest && t.closest('input, select, textarea');
  document.addEventListener('contextmenu', (e) => { if (!isInput(e.target)) e.preventDefault(); });
  document.addEventListener('dragstart', (e) => e.preventDefault());
  document.addEventListener('selectstart', (e) => { if (!isInput(e.target)) e.preventDefault(); });
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('touchmove', (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
  document.addEventListener('wheel', (e) => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });

  let cheerTimer;
  function cheer(emoji, text) {
    $('#cheer-emoji').textContent = emoji;
    $('#cheer-text').textContent = text;
    $('#cheer').hidden = false;
    clearTimeout(cheerTimer);
    cheerTimer = setTimeout(() => { $('#cheer').hidden = true; }, 3500);
  }
  $('#cheer').addEventListener('click', () => { $('#cheer').hidden = true; });

  // ---------- Admin screen (grown-ups only: hold ⚙️ for 2 seconds) ----------
  let lists = null, tab = 'tasks';
  const COLS = {
    tasks: { hint: 'Morning and After school make the checklists. Money chores earn coins ("Coins" on a routine item, like Feed dogs, earns a coin too). Extra = reasons grown-ups hold to award stars ("Stars" is how many). Untick Active to hide. To switch kids, close this and tap their name.' },
    prizes: { hint: 'Star prizes, cheapest first. Untick Active to hide.' },
    store: { hint: 'Each item belongs to one jar: Spend (store), Save (goals), Give (gifts). Untick Active to hide.' },
  };
  async function openAdmin() {
    $('#admin').hidden = false;
    $('#admin-body').innerHTML = '<p class="hint">Loading…</p>';
    try { lists = await api.lists(); renderAdmin(); } catch (e) { $('#admin-body').innerHTML = `<p class="arow"><span class="msg err">Couldn't load the lists: ${esc(e.message)}</span></p>`; }
  }
  function renderAdmin() {
    for (const b of $$('.tab')) b.classList.toggle('on', b.dataset.tab === tab);
    const kid = currentKid();
    $('#admin-title').textContent = `⚙️ Edit ${kid.name ? `${kid.name}'s` : ''} lists`;
    $('#admin-hint').textContent = COLS[tab].hint;
    $('#admin-body').innerHTML = lists[tab].filter((x) => (x.kidId || kids()[0]?.id) === kid.id).map(adminRow).join('');
  }
  function adminRow(x) {
    const id = x.id || '';
    const num = (f, v, label) => `<label>${label}<input class="f-num" type="number" inputmode="numeric" data-f="${f}" value="${esc(v ?? '')}"></label>`;
    const sel = (f, v, opts) => `<select data-f="${f}">${opts.map((o) => `<option${o === v ? ' selected' : ''}>${o}</option>`).join('')}</select>`;
    let extra = '';
    if (tab === 'tasks') extra = sel('group', x.group || 'Morning', ['Morning', 'After school', 'Money', 'Extra']) + num('coins', x.coins ?? 0, 'Coins') + num('stars', x.stars ?? 1, 'Stars') + num('order', x.order ?? 99, 'Order');
    if (tab === 'prizes') extra = num('cost', x.cost ?? 5, 'Stars');
    if (tab === 'store') extra = sel('jar', x.jar || 'Spend', JARS) + num('price', x.price ?? 5, 'Coins');
    return `<div class="arow${x.active === false ? ' off' : ''}" data-id="${esc(id)}">
      <input class="f-emoji" data-f="emoji" value="${esc(x.emoji || '')}" aria-label="Emoji">
      <input class="f-name" data-f="name" value="${esc(x.name || '')}" placeholder="Name" aria-label="Name">
      ${extra}
      <label><input type="checkbox" data-f="active"${x.active === false ? '' : ' checked'}> Active</label>
      <button class="pill small" data-save>Save</button>
      <span class="msg"></span>
    </div>`;
  }
  $('#admin').addEventListener('click', async (e) => {
    const t = e.target;
    if (t.closest('[data-admin-close]')) { $('#admin').hidden = true; refresh(); return; }
    const tb = t.closest('.tab');
    if (tb) { tab = tb.dataset.tab; renderAdmin(); return; }
    if (t.closest('[data-admin-add]')) {
      $('#admin-body').insertAdjacentHTML('beforeend', adminRow({ emoji: '⭐', name: '', active: true }));
      $('#admin-body').lastElementChild.querySelector('.f-name').focus();
      return;
    }
    const save = t.closest('[data-save]');
    if (!save) return;
    const row = save.closest('.arow');
    const msg = $('.msg', row);
    const fields = {};
    for (const inp of $$('[data-f]', row)) fields[inp.dataset.f] = inp.type === 'checkbox' ? inp.checked : inp.value.trim();
    if (!row.dataset.id) fields.kidId = currentKid().id;
    msg.className = 'msg'; msg.textContent = 'Saving…';
    save.disabled = true;
    try {
      await api.saveItem({ list: tab, id: row.dataset.id || null, fields });
      lists = await api.lists();
      renderAdmin();
      const again = row.dataset.id && $(`.arow[data-id="${CSS.escape(row.dataset.id)}"] .msg`);
      if (again) again.textContent = 'Saved ✓';
    } catch (err) {
      msg.className = 'msg err';
      msg.textContent = `Not saved: ${err.message}`; // the row keeps what you typed, so nothing is lost
      save.disabled = false;
    }
  });

  // ---------- Runs for days without babysitting ----------
  let shownDay = dayKey();
  setInterval(() => {
    const now = dayKey();
    if (now === shownDay) return;
    shownDay = now;
    // New day: fresh checklists. Reload for a clean page (and any new version) once nothing is unsaved.
    if (!outbox.length && !DEMO && $('#admin').hidden) location.reload();
    else { render(); refresh(); }
  }, 15000);
  setInterval(() => { if ($('#admin').hidden) refresh(); }, REFRESH_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { refresh(); drain(); keepAwake(); } });
  window.addEventListener('online', () => { drain(); refresh(); });
  async function keepAwake() {
    try { if (navigator.wakeLock && !document.hidden) await navigator.wakeLock.request('screen'); } catch { /* fine */ }
  }

  // ---------- Start ----------
  if (!kioskKey && !DEMO) { showSetup(); return; }
  if (server) showApp();
  keepAwake();
  showStatus();
  if (outbox.length) drain(); else refresh();

  // ---------- Demo (?demo): a pretend server that lives in this browser ----------
  function demoApi() {
    const today = dayKey();
    const T = (id, emoji, name, group, coins = 0) => ({ id, emoji, name, group, coins, active: true });
    const lists = ls.get('stars-demo:lists', {
      tasks: [
        T('m1', '🥣', 'Eat breakfast', 'Morning'), T('m2', '🛏️', 'Make bed', 'Morning'), T('m3', '🪥', 'Brush teeth', 'Morning'),
        T('m4', '💇‍♀️', 'Brush hair', 'Morning'), T('m5', '👗', 'Get dressed', 'Morning'), T('m6', '🐶', 'Feed dogs', 'Morning', 1),
        T('m7', '🚗', 'Ready to leave', 'Morning'),
        T('a1', '📝', 'Pull out homework', 'After school'), T('a2', '👟', 'Put away shoes', 'After school'), T('a3', '🍝', 'Eat dinner', 'After school'),
        T('a4', '🛁', 'Bath', 'After school'), T('a5', '🪥', 'Brush teeth', 'After school'), T('a6', '🐶', 'Feed dogs', 'After school', 1),
        T('c1', '🍽️', 'Plate to the sink', 'Money', 1), T('c2', '🧺', 'Clothes in the hamper', 'Money', 1), T('c3', '🍴', 'Set the table', 'Money', 1),
        T('c4', '🪴', 'Water plants', 'Money', 1), T('c5', '🧦', 'Match socks', 'Money', 1), T('c6', '🧽', 'Wipe the table', 'Money', 1),
        T('c7', '🧸', 'Toys in bins', 'Money', 1),
      ],
      prizes: [
        { id: 'p1', emoji: '🍬', name: 'Candy pick', cost: 2, active: true }, { id: 'p2', emoji: '📺', name: '15 min screen time', cost: 4, active: true },
        { id: 'p3', emoji: '🍨', name: 'Dessert pick', cost: 6, active: true }, { id: 'p4', emoji: '🎬', name: 'Movie night pick', cost: 12, active: true },
        { id: 'p5', emoji: '🎡', name: 'Family outing', cost: 30, active: true },
      ],
      store: [
        { id: 's1', emoji: '⭐', name: 'Stickers', price: 2, jar: 'Spend', active: true }, { id: 's2', emoji: '🎀', name: 'Hair clip', price: 5, jar: 'Spend', active: true },
        { id: 's3', emoji: '🧸', name: 'Small toy', price: 5, jar: 'Spend', active: true }, { id: 's4', emoji: '🎨', name: 'Craft kit', price: 10, jar: 'Save', goal: true, active: true },
        { id: 's5', emoji: '📚', name: 'Book or bigger toy', price: 20, jar: 'Save', active: true }, { id: 's6', emoji: '🎁', name: 'Gift for a friend', price: 5, jar: 'Give', active: true },
        { id: 's7', emoji: '🐾', name: 'Animal shelter gift', price: 5, jar: 'Give', active: true },
      ],
    });
    const KIDS = [{ id: 'k1', name: 'Bianca', emoji: '🌸', simple: false }, { id: 'k2', name: 'Aria', emoji: '🐣', simple: true }];
    for (const x of [...lists.tasks, ...lists.prizes, ...lists.store]) x.kidId ||= 'k1';
    if (!lists.tasks.some((x) => x.kidId === 'k2')) {
      lists.tasks.push(T('t1', '🥣', 'Eat', 'Morning'), T('t2', '🪥', 'Brush teeth', 'Morning'), T('t3', '👕', 'Get dressed', 'Morning'));
      for (const x of lists.tasks.slice(-3)) x.kidId = 'k2';
      lists.tasks.push({ ...T('e1', '📚', 'School pages on her own', 'Extra'), stars: 2, kidId: 'k1' }, { ...T('e2', '🤝', 'Helped pick up', 'Extra'), stars: 1, kidId: 'k1' });
    }
    const of = (arr, k) => arr.filter((x) => x.active && x.kidId === k);
    const base = () => ({
      today, timezone: tz, morningGoal: 'Ready by 7:30', kids: KIDS,
      byKid: {
        k1: {
          tasks: of(lists.tasks, 'k1'), prizes: of(lists.prizes, 'k1'), store: of(lists.store, 'k1'),
          stars: 7, coins: { Tray: 2, Spend: 3, Save: 6, Give: 2 }, checks: {}, routines: {},
          week: [2, 1, 2, 2, 1, 2].map((stars, i) => ({ date: addDays(today, i - 6), stars })),
          collected: [{ name: '🍬 Candy pick', stars: 2, date: addDays(today, -2) }], toDeliver: [],
        },
        k2: {
          tasks: of(lists.tasks, 'k2'), prizes: of(lists.prizes, 'k2'), store: [],
          stars: 3, coins: { Tray: 0, Spend: 0, Save: 0, Give: 0 }, checks: {}, routines: {},
          week: [1, 1, 0, 1, 0, 0].map((stars, i) => ({ date: addDays(today, i - 6), stars })), collected: [], toDeliver: [],
        },
      },
    });
    let done = ls.get('stars-demo:done', []);
    return {
      async load() {
        const st = base();
        for (const k of KIDS) st.byKid[k.id] = replay(st.byKid[k.id], done.filter((o) => (o.kidId || 'k1') === k.id), today);
        return st;
      },
      async send(op) {
        if (params.has('fail')) throw new SaveError('Demo: pretending the internet is down.', false);
        if (done.some((d) => d.id === op.id)) return { ok: true };
        done.push(op); ls.set('stars-demo:done', done);
        return { ok: true };
      },
      async lists() { return JSON.parse(JSON.stringify(lists)); },
      async saveItem({ list, id, fields }) {
        if (!fields.name) throw new SaveError('Give it a name first.', true);
        const clean = { ...fields };
        for (const k of ['coins', 'order', 'cost', 'price']) if (k in clean) clean[k] = Number(clean[k]) || 0;
        if (id) Object.assign(lists[list].find((x) => x.id === id), clean);
        else lists[list].push({ id: uid(), active: true, ...clean });
        ls.set('stars-demo:lists', lists);
        return { ok: true };
      },
    };
  }
})();
