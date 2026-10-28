// Little Wins dashboard. Plain JS, no build step.

const DEMO = new URLSearchParams(location.search).has('demo');
const $ = (id) => document.getElementById(id);

const storage = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode: fine */ } },
};

let passcode = storage.get('passcode');
let state = null;

// ---------- Copy (variety keeps it fresh for an ADHD brain) ----------

const CHEERS = ['Nice!', 'Yes! 🙌', 'Look at you!', 'That counts!', 'Boom. ✨', 'Love that for you.', 'Little win, big deal.', 'Done and done.'];
const NUDGES = [
  'Progress, not perfection.',
  "You don't have to do it all. Just the next one.",
  'Every tick is a vote for who you\'re becoming.',
  'Small and steady still gets there.',
  'Rest is part of the plan, not a break from it.',
];
const LEVEL_TITLES = ['Getting started', 'Finding my rhythm', 'Showing up', 'On a roll', 'Steady glow', 'In my era', 'Gently unstoppable', 'Legend'];
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// ---------- API ----------

async function api(path, opts = {}) {
  if (DEMO) return window.Demo.api(path, opts);
  const res = await fetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', 'x-passcode': passcode || '' },
  });
  if (res.status === 401) { showGate(true); throw new Error('auth'); }
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
  return res.json();
}

// ---------- Gate ----------

function showGate(error = false) {
  $('app').hidden = true;
  $('gate').hidden = false;
  $('gate-error').hidden = !error;
  $('passcode').focus();
}

$('gate-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  passcode = $('passcode').value.trim();
  storage.set('passcode', passcode);
  await load();
});

// ---------- Rendering ----------

function render() {
  const s = state;
  const now = new Date();
  const hour = now.getHours();
  $('greeting').textContent = `${hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'}, Debra`;
  $('today-label').textContent = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  // Level
  const L = s.level;
  $('level-num').textContent = L.level;
  $('level-title').textContent = LEVEL_TITLES[Math.min(L.level - 1, LEVEL_TITLES.length - 1)];
  $('level-xp').textContent = `${L.into} / ${L.span} XP`;
  requestAnimationFrame(() => { $('level-bar').style.width = `${Math.min(100, (L.into / L.span) * 100)}%`; });
  $('wins-week').textContent = `${s.winsThisWeek} win${s.winsThisWeek === 1 ? '' : 's'} this week`;
  $('showup').textContent = s.showUpWeeks > 1 ? `🌱 ${s.showUpWeeks} weeks showing up` : '';

  // Nudge
  const doneCount = s.habits.filter((h) => h.doneToday).length;
  const readiness = s.stats?.readiness;
  let nudge = pick(NUDGES);
  if (readiness != null && readiness < 70) nudge = `🌙 Readiness is ${readiness}. It's a low-battery day, so resting counts as a win.`;
  else if (doneCount === s.habits.length && doneCount > 0) nudge = "💛 Everything's ticked. Go enjoy the rest of your day.";
  else if (doneCount === 0 && hour < 12) nudge = '☀️ One small thing is enough today.';
  $('nudge').textContent = nudge;

  // Habits
  const wrap = $('habits');
  wrap.replaceChildren(...s.habits.map(habitCard));

  // Stats
  const st = s.stats;
  const stats = $('stats');
  if (!st) {
    stats.innerHTML = '<div class="card stat-empty">No body data yet. It lands after your first sync. 💍</div>';
    $('stats-day').textContent = '';
  } else {
    const items = [
      ['😴', 'Sleep', st.sleep_score],
      ['🔋', 'Readiness', st.readiness],
      ['👟', 'Steps', st.steps != null ? st.steps.toLocaleString() : null],
      ['⏱️', 'Active min', st.exercise_minutes],
    ];
    stats.innerHTML = items.map(([e, label, v]) =>
      `<div class="card stat"><div class="stat-val">${v ?? '–'}</div><div class="stat-label">${e} ${label}</div></div>`).join('');
    $('stats-day').textContent = st.date && st.date !== s.today ? 'from yesterday' : '';
  }

  // Wins
  $('wins').innerHTML = s.recentWins.length
    ? s.recentWins.map((w) => `
      <li class="card win">
        <span class="win-emoji">${esc(w.emoji)}</span>
        <span class="win-text"><strong>${esc(w.name)}</strong><span class="muted small">${esc(w.detail || '')}</span></span>
        <span class="win-src">${relDay(w.date)} · ${sourceLabel(w.source)}</span>
      </li>`).join('')
    : '<li class="card win muted">Your wins will show up here. The first one is the best one.</li>';

  // Footer
  const last = s.lastSync?.at ? `Last synced ${timeAgo(s.lastSync.at)}` : 'Not synced yet';
  $('foot').textContent = `${last} · Syncs by itself every morning${DEMO ? ' · Demo mode' : ''}`;
}

function habitCard(h) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = `habit${h.doneToday ? ' done' : ''}`;
  el.dataset.area = h.area;
  el.setAttribute('aria-pressed', h.doneToday);

  const auto = h.doneToday && h.todaySource && h.todaySource !== 'Manual'
    ? `<span class="auto">✨ ${sourceLabel(h.todaySource)} noticed${h.todayDetail ? `: ${esc(h.todayDetail)}` : ''}</span>` : '';

  let progress = '';
  if (h.goal > 0) {
    const dots = Array.from({ length: h.goal }, (_, i) => `<span class="dot${i < h.weekCount ? ' on' : ''}"></span>`).join('');
    progress = h.goalHit
      ? `<span class="goal-hit">Goal hit! ${h.weekCount}/${h.goal}</span>`
      : `<span class="dots" aria-label="${h.weekCount} of ${h.goal} this week">${dots}</span>`;
  } else {
    progress = `<span>${h.weekCount ? `${h.weekCount}× this week` : 'Bonus win'}</span>`;
  }
  const streak = h.streak > 1 ? `<span class="streak">🔥 ${h.streak} wks</span>` : '';

  el.innerHTML = `
    <div class="habit-top">
      <span class="habit-emoji">${esc(h.emoji)}</span>
      <span class="habit-name">${esc(h.name)}</span>
      <span class="habit-check">${h.doneToday ? '✓' : ''}</span>
    </div>
    ${auto}
    <div class="habit-meta">${progress}${streak}</div>`;

  if (h.doneToday && h.todaySource === 'Manual') {
    const undo = document.createElement('span');
    undo.className = 'undo';
    undo.textContent = 'undo';
    undo.setAttribute('role', 'button');
    undo.addEventListener('click', (e) => { e.stopPropagation(); undoHabit(h); });
    el.querySelector('.habit-meta').style.paddingRight = '40px';
    el.append(undo);
  }

  el.addEventListener('click', () => { if (!h.doneToday) complete(h, el); else toast(pick(CHEERS)); });
  return el;
}

// ---------- Actions ----------

async function complete(h, el) {
  const before = snapshot();
  // Optimistic: celebrate first, save second.
  h.doneToday = true; h.todaySource = 'Manual'; h.weekCount++;
  state.winsThisWeek++;
  burstFrom(el, h);
  floatPlus(el, '+10 XP');
  navigator.vibrate?.(30);
  toast(pick(CHEERS));
  setTimeout(render, 450);

  try {
    await api('/api/checkin', { method: 'POST', body: JSON.stringify({ habitId: h.id }) });
    await refresh(before);
  } catch (e) {
    if (e.message === 'auth') return;
    h.doneToday = false; h.weekCount--; state.winsThisWeek--;
    render();
    toast("Couldn't save that one. Try again?");
  }
}

async function undoHabit(h) {
  try {
    await api('/api/checkin', { method: 'POST', body: JSON.stringify({ habitId: h.id, undo: true }) });
    state = await api('/api/dashboard');
    render();
    toast('Undone. No big deal.');
  } catch { toast("Couldn't undo. Try again?"); }
}

async function sync() {
  const btn = $('sync');
  btn.classList.add('syncing');
  btn.disabled = true;
  const before = snapshot();
  try {
    const res = await api('/api/sync', { method: 'POST' });
    if (res.errors?.length) toast(`Heads up: ${res.errors[0]}`);
    if (res.wins?.length) {
      bigConfetti();
      celebrate('✨', `${res.wins.length} new win${res.wins.length === 1 ? '' : 's'}!`,
        res.wins.map((w) => `${w.emoji} ${w.habit} (${sourceLabel(w.source)})`).join(' · '));
      markSeen(res.wins);
    } else if (!res.errors?.length) toast('All caught up ✨');
    await refresh(before);
  } catch (e) {
    if (e.message !== 'auth') toast("Sync didn't work. Try again in a bit.");
  } finally {
    btn.classList.remove('syncing');
    btn.disabled = false;
  }
}
$('sync').addEventListener('click', sync);

// Reload data and celebrate anything that crossed a line (weekly goal, level up).
async function refresh(before) {
  state = await api('/api/dashboard');
  render();
  if (!before) return;
  if (state.level.level > before.level) {
    bigConfetti();
    celebrate('🌟', `Level ${state.level.level}!`, `"${LEVEL_TITLES[Math.min(state.level.level - 1, LEVEL_TITLES.length - 1)]}". You earned this one.`);
    return;
  }
  const newlyHit = state.habits.find((h) => h.goalHit && !before.goalHit.has(h.id));
  if (newlyHit) {
    bigConfetti();
    celebrate(newlyHit.emoji, 'Weekly goal hit!', `${newlyHit.name}: ${newlyHit.weekCount} of ${newlyHit.goal}. +25 bonus XP.${newlyHit.streak > 1 ? ` That's ${newlyHit.streak} weeks in a row.` : ''}`);
  }
}

function snapshot() {
  return state ? { level: state.level.level, goalHit: new Set(state.habits.filter((h) => h.goalHit).map((h) => h.id)) } : null;
}

// ---------- "While you were away" ----------
// Automatic wins that landed since the last visit get their own celebration.

const seenKey = 'seen-wins';
const winId = (w) => `${w.habitId}:${w.date}`;

function markSeen(wins) {
  const seen = new Set(JSON.parse(storage.get(seenKey) || '[]'));
  for (const w of wins) seen.add(winId(w));
  storage.set(seenKey, JSON.stringify([...seen].slice(-300)));
}

function celebrateNewAutoWins() {
  const raw = storage.get(seenKey);
  const autoWins = state.recentWins.filter((w) => w.source !== 'Manual');
  if (raw == null) { markSeen(state.recentWins); return; } // first visit: don't flood
  const seen = new Set(JSON.parse(raw));
  const fresh = autoWins.filter((w) => !seen.has(winId(w)));
  markSeen(state.recentWins);
  if (!fresh.length) return;
  bigConfetti();
  celebrate('💌', 'While you were away…',
    `${fresh.map((w) => `${w.emoji} ${w.name}`).join(' · ')}. Tracked for you, automatically.`);
}

// ---------- Celebration helpers ----------

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

function burstFrom(el, h) {
  if (!window.confetti) return;
  const r = el.getBoundingClientRect();
  const color = getComputedStyle(el).getPropertyValue('--c').trim() || '#e07a5f';
  confetti({
    particleCount: reduceMotion ? 15 : 60,
    spread: 70, startVelocity: 32, scalar: .9, ticks: 120,
    origin: { x: (r.left + r.width / 2) / innerWidth, y: (r.top + r.height / 2) / innerHeight },
    colors: [color, '#f7c873', '#ffffff', '#7b8cc4'],
  });
}

function bigConfetti() {
  if (!window.confetti) return;
  const end = Date.now() + (reduceMotion ? 200 : 900);
  (function frame() {
    confetti({ particleCount: 6, angle: 60, spread: 60, origin: { x: 0, y: .7 } });
    confetti({ particleCount: 6, angle: 120, spread: 60, origin: { x: 1, y: .7 } });
    if (Date.now() < end) requestAnimationFrame(frame);
  })();
  navigator.vibrate?.([30, 50, 30]);
}

function floatPlus(el, text) {
  const s = document.createElement('span');
  s.className = 'plus';
  s.textContent = text;
  el.append(s);
  setTimeout(() => s.remove(), 1100);
}

const queue = [];
function celebrate(emoji, title, body) {
  queue.push({ emoji, title, body });
  if (queue.length === 1) showNext();
}
function showNext() {
  const c = queue[0];
  if (!c) return;
  $('celebrate-emoji').textContent = c.emoji;
  $('celebrate-title').textContent = c.title;
  $('celebrate-body').textContent = c.body;
  $('celebrate').hidden = false;
  $('celebrate-close').focus();
}
$('celebrate-close').addEventListener('click', () => {
  $('celebrate').hidden = true;
  queue.shift();
  setTimeout(showNext, 200);
});

let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

// ---------- Utils ----------

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function sourceLabel(s) {
  return { Oura: 'Oura', 'Apple Health': 'Apple Health', Calendar: 'Calendar', Manual: 'You' }[s] || s || '';
}
function relDay(key) {
  const diff = Math.round((new Date(`${state.today}T12:00`) - new Date(`${key}T12:00`)) / 864e5);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return new Date(`${key}T12:00`).toLocaleDateString('en-US', { weekday: 'short' });
}
function timeAgo(iso) {
  const m = Math.round((Date.now() - new Date(iso)) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

// ---------- Boot ----------

async function load() {
  if (!DEMO && !passcode) return showGate();
  try {
    state = await api('/api/dashboard');
  } catch (e) {
    if (e.message !== 'auth') {
      $('gate').hidden = true;
      $('app').hidden = false;
      $('nudge').textContent = `Couldn't load your data: ${e.message}`;
    }
    return;
  }
  $('gate').hidden = true;
  $('app').hidden = false;
  render();
  if (!DEMO) celebrateNewAutoWins();
}

load();
