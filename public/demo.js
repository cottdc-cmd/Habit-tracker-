// Demo mode (?demo): fake data so the dashboard can be tried before anything is connected.
window.Demo = (() => {
  const today = new Date();
  const key = (d) => d.toISOString().slice(0, 10);
  const ago = (n) => { const d = new Date(today); d.setDate(d.getDate() - n); return key(d); };
  const monday = new Date(today); monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  const weekDays = [...Array(7)].map((_, i) => { const d = new Date(monday); d.setDate(monday.getDate() + i); return key(d); });

  const habit = (id, emoji, name, area, goal, rule, weekCount, doneToday, source, detail, streak) => ({
    id, emoji, name, area, goal, rule, weekCount, doneToday,
    todaySource: doneToday ? source : null, todayDetail: doneToday ? detail : null,
    goalHit: goal > 0 && weekCount >= goal, streak, weekDays: weekDays.map(() => false),
  });

  const data = {
    today: key(today),
    weekDays,
    habits: [
      habit('h1', '🏃‍♀️', 'Move my body', 'Move', 3, 'workout', 2, true, 'Apple Health', 'Pilates', 4),
      habit('h2', '👟', '7,000 steps', 'Move', 4, 'steps>=7000', 2, false, null, null, 2),
      habit('h3', '😴', 'Slept well', 'Rest', 4, 'sleep_score>=75', 3, true, 'Oura', 'sleep score 82', 6),
      habit('h4', '🌙', 'Rested when my body asked', 'Rest', 0, 'rest_day', 1, false, null, null, 0),
      habit('h5', '🎾', 'Tennis', 'Joy', 1, 'calendar:tennis', 0, false, null, null, 3),
      habit('h6', '✨', 'Something just for me', 'Joy', 2, 'manual', 1, false, null, null, 1),
    ],
    stats: { date: key(today), sleep_score: 82, readiness: 74, steps: 5230, exercise_minutes: 34 },
    level: { level: 4, xp: 680, into: 80, span: 400 },
    winsThisWeek: 9,
    showUpWeeks: 7,
    recentWins: [
      { habitId: 'h1', emoji: '🏃‍♀️', name: 'Move my body', date: ago(0), source: 'Apple Health', detail: 'Pilates' },
      { habitId: 'h3', emoji: '😴', name: 'Slept well', date: ago(0), source: 'Oura', detail: 'sleep score 82' },
      { habitId: 'h6', emoji: '✨', name: 'Something just for me', date: ago(1), source: 'Manual', detail: 'You did it' },
      { habitId: 'h2', emoji: '👟', name: '7,000 steps', date: ago(1), source: 'Oura', detail: 'steps 8,912' },
    ],
    cycle: {
      phase: 'luteal', day: 21, length: 29, learned: true, nextIn: 9, late: false, periodToday: false,
      marks: { follicular: 6, ovulatory: 14, luteal: 17 },
    },
    lastSync: { at: new Date(Date.now() - 3 * 3600e3).toISOString(), wins: [], errors: [] },
  };
  for (const h of data.habits) for (let i = 0; i < h.weekCount; i++) h.weekDays[i] = true;

  function addXp(n) {
    const L = data.level;
    L.xp += n; L.into += n;
    while (L.into >= L.span) { L.into -= L.span; L.level++; L.span = 100 * L.level; }
  }

  const clone = (o) => JSON.parse(JSON.stringify(o));
  return {
    async api(path, opts = {}) {
      await new Promise((r) => setTimeout(r, 250));
      if (path === '/api/dashboard') return clone(data);
      if (path === '/api/checkin') {
        const { habitId, undo } = JSON.parse(opts.body);
        const h = data.habits.find((x) => x.id === habitId);
        const todayIdx = weekDays.indexOf(data.today);
        if (undo) {
          h.doneToday = false; h.weekCount--; h.weekDays[todayIdx] = false; data.winsThisWeek--;
          addXp(-10);
        } else {
          const wasHit = h.goalHit;
          h.doneToday = true; h.todaySource = 'Manual'; h.weekCount++; h.weekDays[todayIdx] = true; data.winsThisWeek++;
          addXp(10);
          h.goalHit = h.goal > 0 && h.weekCount >= h.goal;
          if (h.goalHit && !wasHit) { h.streak++; addXp(25); }
          data.recentWins.unshift({ habitId, emoji: h.emoji, name: h.name, date: data.today, source: 'Manual', detail: 'You did it' });
        }
        return { ok: true };
      }
      if (path === '/api/period') {
        const { on } = JSON.parse(opts.body);
        Object.assign(data.cycle, on
          ? { phase: 'menstrual', day: 1, nextIn: 29, periodToday: true }
          : { phase: 'luteal', day: 21, nextIn: 9, periodToday: false });
        return { ok: true, wins: [] };
      }
      if (path === '/api/sync') {
        const h = data.habits.find((x) => x.id === 'h2');
        if (h.doneToday) return { wins: [], errors: [] };
        h.doneToday = true; h.todaySource = 'Oura'; h.todayDetail = 'steps 7,412'; h.weekCount++;
        data.stats.steps = 7412; data.winsThisWeek++; addXp(10);
        data.recentWins.unshift({ habitId: 'h2', emoji: '👟', name: '7,000 steps', date: data.today, source: 'Oura', detail: 'steps 7,412' });
        data.lastSync.at = new Date().toISOString();
        return { wins: [{ habit: '7,000 steps', emoji: '👟', source: 'Oura' }], errors: [] };
      }
      throw new Error('Unknown demo route');
    },
  };
})();
