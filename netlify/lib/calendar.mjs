// Google Calendar via each calendar's "Secret address in iCal format".
// No OAuth needed; recurring events are expanded.

import ical from 'node-ical';
import { dayKey } from './dates.mjs';

export function calendarUrls() {
  return (process.env.GOOGLE_CALENDAR_ICS_URLS || '').split(',').map((s) => s.trim()).filter(Boolean);
}

// Returns { 'YYYY-MM-DD': [{ title, start }] } for events that have already started.
export async function fetchEvents(start, end) {
  const from = new Date(`${start}T00:00:00Z`);
  from.setUTCDate(from.getUTCDate() - 1);
  const to = new Date(`${end}T23:59:59Z`);
  to.setUTCDate(to.getUTCDate() + 1);
  const now = new Date();

  const byDay = {};
  for (const url of calendarUrls()) {
    const data = await ical.async.fromURL(url);
    for (const ev of Object.values(data)) {
      if (ev.type !== 'VEVENT' || ev.status === 'CANCELLED') continue;
      const instances = ev.rrule
        ? ical.expandRecurringEvent(ev, { from, to })
        : [{ summary: ev.summary, start: ev.start, isFullDay: ev.datetype === 'date' }];
      for (const inst of instances) {
        const startDate = new Date(inst.start);
        if (startDate > now) continue;
        // All-day events are stored as midnight UTC; read their date as-is.
        const key = inst.isFullDay ? startDate.toISOString().slice(0, 10) : dayKey(startDate);
        if (key < start || key > end) continue;
        const title = typeof inst.summary === 'object' ? inst.summary.val : inst.summary;
        (byDay[key] ||= []).push({ title: String(title || ''), start: startDate.toISOString() });
      }
    }
  }
  return byDay;
}
