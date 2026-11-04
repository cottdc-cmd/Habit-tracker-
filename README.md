# 🌱 Little Wins

A habit tracker that mostly fills itself in.

Work out and Apple Health or Oura ticks the habit. Have tennis on your calendar and it counts. Then you get confetti.

**Try the demo first:** open the site with `?demo` on the end of the URL.

---

## How it works

```
Apple Health ──(app on your phone)──┐
Oura ring ─────(once a day)─────────┼──▶  Notion  ──▶  Dashboard
Google Calendar ─(once a day)───────┘   (your data)    (confetti)
```

- **Notion** holds everything: your habits, a log of every win, and daily body stats.
- **Oura + Calendar** sync once a day, every morning. Tap **Sync** anytime for an instant update.
- **Apple Health** sends data from your phone. Apple has no cloud connection, so an app does it.

## Built for an ADHD brain

- **Weekly goals, not daily streaks.** "3 workouts this week" instead of "every day". Missing a Tuesday breaks nothing.
- **Streaks count weeks**, and an unfinished week never resets one.
- **Rest counts.** On a low-readiness day or a period day, not working out ticks "Rested when my body asked".
- **Cycle-aware.** Shows your phase as an "inner season" with a gentle note on pacing yourself.
- **Instant rewards:** confetti, +XP, levels and a buzz on every tap.
- **Big moments** get a full celebration: hitting a weekly goal, levelling up, and wins that landed while you were away.
- **No shame copy.** No red numbers, no "you missed".

---

## Setup (about 30 minutes, once)

Do one step at a time. Each is short.

### 1. Notion
1. Go to [notion.so/my-integrations](https://www.notion.so/my-integrations), create an integration and copy the token.
2. Create an empty page called **Little Wins**. Under ••• → **Connections**, add your integration.
3. Copy `.env.example` to `.env`. Fill in `NOTION_TOKEN` and `NOTION_PARENT_PAGE_ID` (the ID at the end of the page URL).
4. Run `npm install` and then `npm run setup:notion`. Paste the three IDs it prints into `.env`.

### 2. Deploy to Netlify
1. Import this repo into Netlify. There's no build command; it just works.
2. Add every value from `.env` under **Site configuration → Environment variables**.

### 3. Oura 💍 (recommended)
Oura's form also asks for a privacy policy and terms. Use `/privacy.html` and `/terms.html` on your site.

1. At [cloud.ouraring.com/oauth/applications](https://cloud.ouraring.com/oauth/applications), create an app.
   Set the redirect URI to `https://YOUR-SITE.netlify.app/api/oura-callback`.
2. Add `OURA_CLIENT_ID` and `OURA_CLIENT_SECRET` to Netlify, then redeploy.
3. Visit `https://YOUR-SITE.netlify.app/api/oura-connect?passcode=YOUR_PASSCODE` and approve. Done for good.

### 4. Google Calendar 📅
1. In Google Calendar, open **Settings → (your calendar) → Integrate calendar**.
2. Copy the **Secret address in iCal format** into `GOOGLE_CALENDAR_ICS_URLS`. Separate several with commas.

### 5. Apple Health ❤️ (optional)
Oura already picks up workouts and steps, so skip this unless you want automatic period logging or Apple Watch workouts.

The easiest option is the **Health Auto Export** app (iOS, paid tier needed for automations):
1. Create a **REST API** automation.
2. URL: `https://YOUR-SITE.netlify.app/api/health`
3. Header: `x-webhook-key` = your `HEALTH_WEBHOOK_KEY`
4. Format **JSON**. Include **Workouts** plus the metrics *Step Count*, *Apple Exercise Time*, *Active Energy* and *Menstrual Flow*. Set it to sync daily or hourly.

<details>
<summary>Prefer a free iOS Shortcut?</summary>

Create a Personal Automation (for example, "When a workout ends" or "at 9pm"). Add a **Get Contents of URL** action:
POST to `/api/health?key=YOUR_KEY` with JSON like this:

```json
{ "date": "2026-10-28", "steps": 8000, "workout": { "name": "Pilates", "minutes": 45 } }
```
</details>

### 6. Open it on your phone
Open your site, enter your passcode and choose **Share → Add to Home Screen**. It now looks and feels like an app.

---

## Cycle tracking 🌸

Tap **🩸 Period today** on the dashboard, or let Apple Health send *Menstrual Flow*. One tap on day 1 is enough.

| Phase | Season | The vibe |
|---|---|---|
| Menstrual | 🌙 Inner winter | Rest is productive. Resting counts as a win |
| Follicular | 🌱 Inner spring | Energy climbs. Good for starting things |
| Ovulatory | ☀️ Inner summer | Often peak energy and social battery |
| Luteal | 🍂 Inner autumn | Energy dips. Lower the bar on purpose |

- It assumes a 28-day cycle until it has learned yours from your last 3 periods.
- Phases are estimates for pacing yourself, not medical advice.

## Make it yours (all in Notion)

Edit the **Habits** database. Changes show up on the next load.

| Column | What it does |
|---|---|
| Emoji, Name | What you see |
| Area | `Move`, `Rest`, `Joy` or `Grow` (sets the colour) |
| Weekly goal | Target per week. `0` = a bonus habit with no target |
| Rule | When it ticks itself (see below) |
| Active | Untick to hide without deleting |

**Rules**

| Rule | Ticks when… |
|---|---|
| `manual` | You tap it |
| `workout` | Any workout is logged |
| `workout:yoga` | A workout with "yoga" in its name |
| `steps>=7000` | Steps reach 7,000. Also works with `sleep_score`, `readiness`, `activity_score`, `active_calories`, `exercise_minutes` and `workout_minutes` |
| `calendar:tennis` | A calendar event containing "tennis" has started |
| `rest_day` | No workout on a low-readiness day (under 70) or a period day |
| `phase:follicular` | You're in that phase (`menstrual`, `follicular`, `ovulatory`, `luteal`) |
| `workout \| steps>=10000` | Either one |

You can always tap a habit by hand too, even an automatic one.

---

## For developers

- `public/`: the dashboard (plain HTML/CSS/JS, no build).
- `netlify/functions/`: the API, the daily schedule (`sync-daily`, 10:00 UTC) and the webhooks.
- `netlify/lib/`: Notion, Oura, Calendar, Apple Health, rules and scoring.
- `npm test`: tests the rules, scoring, streaks and Apple Health parsing.

---

# ⭐ Star Chart (wall tablet)

A calm chore and star chart for the kids, at `/stars/`. Try it with `/stars/?demo`.

- Big picture tiles in **Morning** and **After school**. Tap to check, tap again to undo. Each one is worth 1 ⭐.
- The star total, rewards with progress bars, and a 7-day strip are always on screen.
- It resets itself at local midnight and is fine to leave open for days or weeks.
- **Grown-ups press and hold for 1 second** to add a bonus star, remove a star, or collect a ready reward. Quick taps do nothing.

## Setup (about 10 minutes, once)

1. In Notion, create a page called **Star Chart** and connect your integration to it (••• → **Connections**).
2. Put its ID in `.env` as `STARS_PARENT_PAGE_ID`, then run `npm run setup:stars`.
3. Copy the four values it prints into Netlify's environment variables and redeploy.
4. On the tablet, open `https://YOUR-SITE.netlify.app/stars/?k=YOUR_KIOSK_KEY` and pin the screen. There's no login.

**Optional: a ping when she's ready for a prize.** Install the free **ntfy** app and subscribe to a hard-to-guess topic name. Set `NTFY_TOPIC` to that name in Netlify. You'll get a push the moment a reward becomes affordable.

Also optional: `STARS_CHILD_NAME` (shown as "June's stars"). For a dark screen, add `&theme=dark` to the link. Otherwise it follows the tablet.

## Your data (all in Notion)

| Database | What it is |
|---|---|
| **Chores** | Emoji, Name, Group (`Morning` / `After school`), Order, Active. Edit freely |
| **Rewards** | Emoji, Name, Cost, Active. Edit freely |
| **Star Ledger** | Every star ever: chores (+1), bonus (+1), removed (−1), rewards collected (−cost), with the date and the time it was logged |

- **The balance is the sum of the Stars column.** Add a Sum to that column in Notion to check it.
- You can fix mistakes right in the ledger. Changes show on the tablet within 5 minutes. Edits to rows over 2 weeks old show the next morning.
- Untapping a chore moves its row to Notion's Trash. Nothing else is ever deleted.

## If saving fails

Every tap is stored on the tablet first, then sent to Notion. If that fails, a yellow message says how many taps are waiting, and it keeps retrying, even after a reload. Taps are never dropped silently. If Notion refuses a tap outright (for example, a reward was collected with too few stars), it says why and undoes it on screen.

## For developers

- `public/stars/`: the tablet page (plain HTML/CSS/JS).
- `netlify/functions/stars.mjs`: `GET`/`POST /api/stars`, guarded by `KIOSK_KEY`.
- `netlify/lib/stars/logic.mjs`: balance, week strip and tap rules (pure, tested).
- `netlify/lib/stars/notion-store.mjs`: the only file that talks to Notion. To move to another database, write a file with the same exports and change the import in `store.mjs`.
- Every write has a unique `Key`, so retries never double-count.
