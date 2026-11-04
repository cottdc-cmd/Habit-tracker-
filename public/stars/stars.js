// Star chart for the wall tablet. Plain JS, no build.
//
// Every tap goes into an "outbox" saved on the tablet first, then to the server.
// If saving fails, the tap stays in the outbox and is retried until it lands,
// even across a page reload. A clear message shows while anything is unsaved.

(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const params = new URLSearchParams(location.search);
  const DEMO = params.has('demo');
  const HOLD_MS = 1000;
  const REFRESH_MS = 5 * 60 * 1000;

  // ---------- Small safe storage (works even if storage is blocked) ----------
  const mem = {};
  const ls = {
    ok: (() => { try { localStorage.setItem('__t', '1'); localStorage.removeItem('__t'); return true; } catch { return false; } })(),
    get(k, fallback) {
      try { const v = localStorage.getItem(k); return v == null ? fallback : JSON.parse(v); } catch { return k in mem ? mem[k] : fallback; }
    },
    set(k, v) { mem[k] = v; try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* memory only */ } },
  };
  const NS = DEMO ? 'stars-demo:' : 'stars:';

  const theme = params.get('theme');
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;

  // ---------- Kiosk key ----------
  let kioskKey = params.get('k') || ls.get('stars:key', '');
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

  // ---------- API ----------
  class SaveError extends Error {
    constructor(message, permanent) { super(message); this.permanent = permanent; }
  }
  async function call(method, body) {
    let res;
    try {
      res = await fetch('/api/stars', {
        method,
        headers: { 'Content-Type': 'application/json', 'x-kiosk-key': kioskKey },
        body: body ? JSON.stringify(body) : undefined,
        cache: 'no-store',
        signal: AbortSignal.timeout ? AbortSignal.timeout(20000) : undefined,
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
  const api = DEMO ? demoApi() : { load: () => call('GET'), send: (op) => call('POST', op) };

  // ---------- State ----------
  let server = ls.get(NS + 'last', null); // last good state from the server
  let outbox = ls.get(NS + 'outbox', []);
  const saveOutbox = () => ls.set(NS + 'outbox', outbox);

  // What the screen shows: the server state with unsaved taps replayed on top.
  function view() {
    const today = dayKey();
    const s = server || { chores: [], rewards: [], balance: 0, checks: {}, week: [], collected: [] };
    let balance = s.balance;
    const checks = Object.fromEntries(Object.entries(s.checks || {}).map(([d, ids]) => [d, new Set(ids)]));
    const perDay = Object.fromEntries((s.week || []).map((d) => [d.date, d.stars]));
    const collected = [...(s.collected || [])];
    for (const op of outbox) {
      const set = (checks[op.date] ||= new Set());
      if (op.type === 'check' && !set.has(op.choreId)) { set.add(op.choreId); balance++; perDay[op.date] = (perDay[op.date] || 0) + 1; }
      else if (op.type === 'uncheck' && set.has(op.choreId)) { set.delete(op.choreId); balance--; perDay[op.date] = (perDay[op.date] || 0) - 1; }
      else if (op.type === 'bonus') { balance++; perDay[op.date] = (perDay[op.date] || 0) + 1; }
      else if (op.type === 'remove') { balance--; perDay[op.date] = (perDay[op.date] || 0) - 1; }
      else if (op.type === 'collect') {
        const r = s.rewards.find((x) => x.id === op.rewardId);
        if (r) { balance -= r.cost; collected.unshift({ name: `${r.emoji} ${r.name}`, stars: r.cost, date: op.date }); }
      }
    }
    const week = [];
    for (let i = 6; i >= 0; i--) { const date = addDays(today, -i); week.push({ date, stars: Math.max(0, perDay[date] || 0) }); }
    return { ...s, today, balance, done: checks[today] || new Set(), week, collected: collected.slice(0, 5) };
  }

  // ---------- Rendering ----------
  let lastBalance = null;
  function render() {
    if (!server) return;
    const v = view();
    $('#title').textContent = v.name ? `${v.name}'s stars` : 'My stars';
    $('#today-label').textContent = fmt(v.today, { weekday: 'long', month: 'long', day: 'numeric' });
    $('#balance').textContent = v.balance;
    if (lastBalance !== null && v.balance > lastBalance) bump();
    lastBalance = v.balance;

    for (const section of document.querySelectorAll('.group')) {
      const chores = v.chores.filter((c) => c.group === section.dataset.group);
      section.hidden = chores.length === 0;
      $('.tiles', section).innerHTML = chores.map((c) => {
        const done = v.done.has(c.id);
        return `<button class="tile${done ? ' done' : ''}" data-chore="${esc(c.id)}" aria-pressed="${done}">
          <span class="check" aria-hidden="true">⭐</span>
          <span class="emoji" aria-hidden="true">${esc(c.emoji)}</span>
          <span class="label">${esc(c.name)}</span>
        </button>`;
      }).join('');
    }

    $('#rewards').innerHTML = v.rewards.map((r) => {
      const ready = v.balance >= r.cost;
      const pct = Math.max(0, Math.min(100, (v.balance / r.cost) * 100));
      return `<button class="reward hold${ready ? ' ready' : ''}" data-action="collect" data-reward="${esc(r.id)}"
          aria-label="${esc(r.name)}: ${Math.min(v.balance, r.cost)} of ${r.cost} stars${ready ? '. Ready! Grown-ups, hold to collect.' : ''}">
        <span class="hold-fill"></span>
        <span class="emoji" aria-hidden="true">${esc(r.emoji)}</span>
        <span class="name"><span>${esc(r.name)}</span><span class="cost">${ready ? 'Ready! 🎉' : `${Math.max(0, v.balance)} / ${r.cost} ⭐`}</span></span>
        <span class="bar"><span class="bar-fill" style="width:${pct}%"></span></span>
      </button>`;
    }).join('') || '<p class="empty">Add rewards in Notion.</p>';

    $('#week').innerHTML = v.week.map((d) => `
      <div class="day${d.date === v.today ? ' today' : ''}" aria-label="${fmt(d.date, { weekday: 'long' })}: ${d.stars} stars">
        <span class="dow">${fmt(d.date, { weekday: 'narrow' })}</span>
        <span class="count">${d.stars}</span>
        <span class="stars" aria-hidden="true">${'⭐'.repeat(Math.min(d.stars, 5))}</span>
      </div>`).join('');

    $('#collected').innerHTML = v.collected.length
      ? v.collected.map((c) => `<li><span>${esc(c.name)}</span><span class="when">${fmt(c.date, { month: 'short', day: 'numeric' })} · ${c.stars} ⭐</span></li>`).join('')
      : '<li class="when">Nothing yet</li>';
  }
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function bump() { const t = $('.total'); t.classList.remove('bump'); void t.offsetWidth; t.classList.add('bump'); }

  // ---------- Save status ----------
  let stickyError = null;
  function showStatus() {
    const el = $('#status');
    if (stickyError) {
      el.className = 'status warn';
      el.innerHTML = `<span>⚠️ ${esc(stickyError)}</span><button type="button" data-dismiss>OK</button>`;
      el.hidden = false;
    } else if (outbox.length && retryMsg) {
      el.className = 'status warn';
      el.innerHTML = `<span>⚠️ ${outbox.length} tap${outbox.length > 1 ? 's' : ''} not saved yet. Kept on this tablet and trying again. (${esc(retryMsg)})</span>`;
      el.hidden = false;
    } else if (!ls.ok) {
      el.className = 'status warn';
      el.innerHTML = '<span>⚠️ This browser is blocking storage, so unsaved taps would be lost on reload.</span>';
      el.hidden = false;
    } else if (loadMsg) {
      el.className = 'status warn';
      el.innerHTML = `<span>⚠️ Can't reach the star chart. Showing the last saved view. (${esc(loadMsg)})</span>`;
      el.hidden = false;
    } else {
      el.hidden = true;
    }
  }
  $('#status').addEventListener('click', (e) => {
    if (e.target.closest('[data-dismiss]')) { stickyError = null; showStatus(); }
  });

  // ---------- Outbox ----------
  let draining = false, retryMsg = '', retryTimer = null, retryDelay = 5000;
  function enqueue(op) {
    outbox.push({ id: uid(), date: dayKey(), at: new Date().toISOString(), ...op });
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
  let loadMsg = '', loading = false;
  async function refresh() {
    if (loading || draining || outbox.length) return; // don't overwrite unsaved taps
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

  // ---------- Taps ----------
  document.addEventListener('click', (e) => {
    const tile = e.target.closest('.tile');
    if (!tile) return;
    const id = tile.dataset.chore;
    const done = view().done.has(id);
    enqueue({ type: done ? 'uncheck' : 'check', choreId: id });
    if (!done && navigator.vibrate) navigator.vibrate(15);
  });

  // ---------- Press and hold (grown-ups) ----------
  let hold = null;
  function startHold(e) {
    const el = e.target.closest('.hold');
    if (!el || (e.button != null && e.button > 0)) return;
    cancelHold();
    el.classList.add('holding');
    hold = { el, x: e.clientX, y: e.clientY, timer: setTimeout(() => finishHold(el), HOLD_MS) };
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
    const action = el.dataset.action;
    if (navigator.vibrate) navigator.vibrate(40);
    if (action === 'bonus') enqueue({ type: 'bonus' });
    else if (action === 'remove') {
      if (view().balance <= 0) { el.classList.remove('nope'); void el.offsetWidth; el.classList.add('nope'); return; }
      enqueue({ type: 'remove' });
    }
    else if (action === 'collect') {
      const v = view();
      const r = v.rewards.find((x) => x.id === el.dataset.reward);
      if (!r) return;
      if (v.balance < r.cost) {
        el.classList.remove('nope'); void el.offsetWidth; el.classList.add('nope');
        return;
      }
      enqueue({ type: 'collect', rewardId: r.id });
      cheer(r.emoji, `${r.name}! Enjoy!`);
    }
  }
  document.addEventListener('pointerdown', startHold);
  document.addEventListener('pointermove', (e) => {
    if (hold && Math.hypot(e.clientX - hold.x, e.clientY - hold.y) > 24) cancelHold();
  });
  for (const ev of ['pointerup', 'pointercancel']) document.addEventListener(ev, cancelHold);
  window.addEventListener('blur', cancelHold);
  // No long-press menus, image drags or selection anywhere.
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('dragstart', (e) => e.preventDefault());
  document.addEventListener('selectstart', (e) => e.preventDefault());

  let cheerTimer;
  function cheer(emoji, text) {
    $('#cheer-emoji').textContent = emoji;
    $('#cheer-text').textContent = text;
    $('#cheer').hidden = false;
    clearTimeout(cheerTimer);
    cheerTimer = setTimeout(() => { $('#cheer').hidden = true; }, 3500);
  }
  $('#cheer').addEventListener('click', () => { $('#cheer').hidden = true; });

  // ---------- Runs for days without babysitting ----------
  let shownDay = dayKey();
  setInterval(() => {
    const now = dayKey();
    if (now === shownDay) return;
    shownDay = now;
    // New day: fresh tiles. Reload for a clean page (and any new version) once nothing is unsaved.
    if (!outbox.length && !DEMO) location.reload();
    else { render(); refresh(); }
  }, 15000);
  setInterval(refresh, REFRESH_MS);
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

  // ---------- Demo (?demo): everything stays in this browser ----------
  function demoApi() {
    const today = dayKey();
    const chores = [
      { id: 'c1', emoji: '👗', name: 'Get dressed', group: 'Morning' },
      { id: 'c2', emoji: '🪥', name: 'Brush teeth', group: 'Morning' },
      { id: 'c3', emoji: '🎒', name: 'Backpack and shoes away', group: 'After school' },
      { id: 'c4', emoji: '🍽️', name: 'Plate to the sink', group: 'After school' },
    ];
    const rewards = [
      { id: 'r1', emoji: '🍭', name: 'Pick a treat', cost: 10 },
      { id: 'r2', emoji: '🎬', name: 'Pick the Friday movie', cost: 20 },
      { id: 'r3', emoji: '🎡', name: 'Choose a family outing', cost: 40 },
    ];
    const seed = [3, 4, 2, 4, 3, 1].flatMap((n, i) => Array.from({ length: n }, (_, j) => ({ type: 'Chore', stars: 1, date: addDays(today, -(6 - i)), choreId: `c${j + 1}`, key: `chore:c${j + 1}:${addDays(today, -(6 - i))}` })));
    seed.push({ type: 'Reward', stars: -10, date: addDays(today, -3), name: '🍭 Pick a treat', key: 'r' });
    const rows = ls.get('stars-demo:rows', seed);
    const save = () => ls.set('stars-demo:rows', rows);
    const balance = () => rows.reduce((n, r) => n + r.stars, 0);
    return {
      async load() {
        const checks = {}, week = {};
        for (const r of rows) {
          if (r.type === 'Chore') (checks[r.date] ||= []).push(r.choreId);
          if (r.type !== 'Reward') week[r.date] = (week[r.date] || 0) + r.stars;
        }
        return {
          today, timezone: tz, name: 'Demo', balance: balance(), chores, rewards, checks,
          week: Object.entries(week).map(([date, stars]) => ({ date, stars })),
          collected: rows.filter((r) => r.type === 'Reward').slice(-5).reverse().map((r) => ({ name: r.name, stars: -r.stars, date: r.date })),
        };
      },
      async send(op) {
        if (params.has('fail')) throw new SaveError('Demo: pretending the internet is down.', false);
        const key = op.type.endsWith('check') ? `chore:${op.choreId}:${op.date}` : op.id;
        if (op.type === 'uncheck') { const i = rows.findIndex((r) => r.key === key); if (i >= 0) rows.splice(i, 1); }
        else if (!rows.some((r) => r.key === key)) {
          if (op.type === 'check') rows.push({ type: 'Chore', stars: 1, date: op.date, choreId: op.choreId, key });
          if (op.type === 'bonus') rows.push({ type: 'Bonus', stars: 1, date: op.date, key });
          if (op.type === 'remove') rows.push({ type: 'Removed', stars: -1, date: op.date, key });
          if (op.type === 'collect') {
            const r = rewards.find((x) => x.id === op.rewardId);
            if (balance() < r.cost) throw new SaveError(`Not enough stars for ${r.name} yet.`, true);
            rows.push({ type: 'Reward', stars: -r.cost, date: op.date, name: `${r.emoji} ${r.name}`, key });
          }
        }
        save();
        return { ok: true };
      },
    };
  }
})();
