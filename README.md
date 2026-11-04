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

A calm routine, star and coin chart for the kids, at `/stars/`. Try it with `/stars/?demo`.

**Two currencies.** Stars buy treats and experiences. Pretend coins teach money.

- **Routines (stars).** Morning and After school checklists. Finishing every item earns 1 ⭐ for that routine, so 2 a day at most. "Ready by 7:30" is just a family goal and never blocks the star.
- **Money chores (coins).** Each one earns 1 🪙. Items like 🐶 Feed dogs sit in a routine *and* earn a coin with one tap.
- **Coin tray and jars.** New coins wait in the tray. She taps 🛍️ Spend, 🐷 Save or 💝 Give to drop each one in.
- **Star prizes.** A ladder with progress bars. She can spend early or save up.
- **Coin store.** Spend jar items, one Save goal she picks herself, and Give gifts.
- Everything ticks over at local midnight. Balances never reset. It's fine to leave open for weeks.

## Grown-ups (press and hold)

| Hold | What it does |
|---|---|
| 🙋 Grown-ups were the delay (1 s) | Gives that routine's star even if items are unchecked |
| ＋ ⭐ Bonus / － ⭐ / － 🪙 (1 s) | Extra effort, or undo a star or coin (the tray first, then Spend, Save, Give) |
| A ready prize or store item (1 s) | Collects it, deducts the cost, and adds it to **To deliver** |
| ✓ Delivered (1 s) | Marks it handed over |
| ⚙️ Edit lists (2 s) | Opens the admin screen |

Quick taps on these do nothing, so a 5-year-old can't trigger them by accident.

## Edit the lists

Hold **⚙️ Edit lists** at the bottom of the tablet for 2 seconds. You can rename, re-price, add, or hide (untick Active) anything:

- **Routines & chores.** Group is `Morning`, `After school` or `Money`. Coins is what it earns (0 for routine-only items).
- **Star prizes.** Name, emoji and star cost.
- **Coin store.** Name, emoji, coin price and jar (`Spend`, `Save` or `Give`).

The same lists are Notion databases on the **Star Chart** page, so you can also edit them there.

## Your data (all in Notion → Star Chart)

**Star Ledger** has one row for everything that happened, with its date and the time it was logged:

| Type | Stars | Coins |
|---|---|---|
| Check (an item ticked) | 0 | the chore's coins, with **Jar** = where the coin is now |
| Routine (all done, or grown-ups were the delay) | +1 | |
| Bonus / Removed | ±1 | or −1 coin |
| Prize | −cost | Status: To deliver → Delivered |
| Purchase | | −price from its jar. Status: To deliver → Delivered |

- **Stars = the sum of Stars. Each jar = the sum of Coins for that Jar.** Add Sums in a Notion view to check them.
- Unticking an item moves its row to Notion's Trash. Nothing else is deleted.

## If saving fails

Every tap is stored on the tablet first, then sent to Notion. If that fails, a yellow message says how many taps are waiting, and it keeps retrying, even after a reload. Taps are never dropped silently. If a tap is refused outright (for example, not enough stars), it says why and undoes it on screen.

## Set up the tablet (Android, once)

1. In Chrome, open `https://debra-little-wins.netlify.app/stars/?k=YOUR_KIOSK_KEY`. Tap ⋮ → **Add to Home screen**, then open it from there for a full-screen app.
2. **Keep the screen on:** Settings → Display → Screen timeout → longest. Also turn on Settings → Developer options → **Stay awake** (screen stays on while charging). To unlock Developer options, tap Settings → About → Build number 7 times.
3. **Lock it to the page:** Settings → Security (or Security & privacy → More) → **App pinning** → on. Open the chart, go to Recent apps, tap the app icon above the window → **Pin**. To unpin, hold Back + Overview (or swipe up and hold).
4. Optional: for a true kiosk with auto-restart after power cuts, use **Fully Kiosk Browser** (free version is fine) with the same link as the Start URL.

## Setup from scratch (a new Notion workspace)

1. Make a **Star Chart** page in Notion and connect your integration (••• → Connections).
2. Put its ID in `.env` as `STARS_PARENT_PAGE_ID`, then run `npm run setup:stars`.
3. Copy the values it prints into Netlify's environment variables and redeploy.

Optional settings: `STARS_CHILD_NAME` ("June's stars"), `STARS_MORNING_GOAL` (default "Ready by 7:30"), and `NTFY_TOPIC` (a free push to your phone via the ntfy app when a star prize becomes affordable). Add `&theme=dark` to the link to force dark mode. Otherwise it follows the tablet.

## Run it locally

- `npm test` runs the logic tests.
- `npx netlify dev` runs the page and API with your `.env`. Open `http://localhost:8888/stars/?k=YOUR_KIOSK_KEY`.
- Or just open `public/stars/index.html?demo` through any static server to click around with pretend data.

## For developers

- `public/stars/`: the tablet page (plain HTML/CSS/JS, no build). `?demo` runs entirely in the browser.
- `netlify/functions/stars.mjs`: `GET`/`POST /api/stars` (and `?lists=1` for the admin screen), guarded by `KIOSK_KEY`.
- `netlify/lib/stars/logic.mjs`: balances, routine stars, week strip, tap validation (pure, tested).
- `netlify/lib/stars/service.mjs`: applies taps. Every write has a unique Key, so retries never double-count.
- `netlify/lib/stars/notion-store.mjs`: the only file that talks to Notion. To move to another database, write a file with the same exports and change the import in `store.mjs`.
