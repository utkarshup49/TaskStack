# TaskStack

A to-do list, Eisenhower matrix, calendar, pomodoro timer, habit tracker and ColorTracker in one app. It runs on Windows, Android and iPad from one codebase.

**Live app:** https://utkarshup49.github.io/TaskStack/

## Features (v0.10)

- **ColorTracker Stats** (Paint | Stats switch): activities are grouped automatically into kinds (Sleep, Productive, Workout, Self-care, Social, Leisure, Time waste, Travel), even with Hinglish names. Six tabs: Overview (scores, daily insights, where your time goes, this week vs last/best, goals, ideal day, challenges), Sleep (every night charted, longest/shortest, bedtime and wake-up, regularity score, social jetlag, chronotype, sleep debt, naps, broken nights), Productive (golden hours heatmap, deep-work blocks, early-start effect, plan vs actual), Waste (danger hours, triggers, cost per year), Workout & more (WHO 150-minute bar, meals if you log them, social, travel, routine score, unlogged time), Patterns (links between days, typical day, best-day recipe, what leads to what, records, trends, periods). Stats unlock as you log more days.
- **Faster logging**: day card with a 24h ring, live "Now doing…" and "Going to sleep / I'm up", fill gaps with a smart guess, copy yesterday, day templates, notes and 👍/👎 on blocks, reminders to log every 2–3 hours, weekly report, monthly Wrapped image, Year in pixels, CSV export, printable month.

- **Lists**: College, Extracurricular, Projects, Self-growth, Personal (add, rename, recolour, reorder, delete your own). A chip row on Tasks, Matrix and Calendar picks what you see: tap a list for only it, hold (or Ctrl-click) to see several. Each task carries its list's colour. Type `/college` when adding.
- **Reminders** (in the app): at the task's time, N minutes / a day before, before a deadline, or an exact time; new timed tasks get one automatically (changeable in the profile). A reminder sheet with Done / Snooze / Tomorrow; on Android and Windows a notification with Done and Snooze buttons. Works while the app is open or recently used.
- **Plan your day / Wrap up / Weekly review**: a banner on Tasks in the morning, evening and on Sunday. Sort what's left over, pick a top 3, add time estimates (warns past your daily hours), note how the day went, review the week.
- **Top 3, This evening, Someday** (Things-style): stars on today's most important tasks; an evening part of Today; a folded Someday group for ideas with no date.
- **Time estimates**: type `~45m`; the row shows focused time against the estimate.
- **Logbook** (everything finished, searchable), **Countdowns** (days until exams and events), **Templates** (save a task with its checklist and reuse it).
- **Profile** (avatar, top right): name and Google photo, level and XP, daily goal ring and streak, this week's numbers, goals, reminder settings, show/hide sections, download a backup or a CSV, restore, delete everything, install tips, shortcuts, what's new.
- **Focus extras**: a "Got distracted" counter and this week's focus time per list.
- **Voice add** (mic next to the task box, where the browser supports it), **home-screen shortcuts** (long-press the installed icon: Add task, Focus, Tracker), **keyboard**: `1`–`6` switch sections, `?` lists the shortcuts.

- **Look and feel**: a signature colour per section (Matrix indigo, Focus orange, Habits green, ColorTracker violet), tuned dark mode, spring animations, sounds and vibration (both switchable in Settings), Undo on every toast.
- **Repeating tasks**: type it (`every mon`, `every 2 weeks`, `every 4 days after completion`, `every 2nd sat`, `every 10th`, `every last working day`) or use the Repeat picker. Three ways to come back: on a schedule, after you finish, or stack up (a new copy each time even if unfinished, max 5, shown as one row). After adding, a box explains exactly when it comes back.
- **Tasks** (main view): a normal to-do list grouped by date: Overdue (with "Move to today"), Today (plus every task with no date), Tomorrow, the next days, Later, Completed today. Quick-add row with date and box pickers. Each task has a box button (or hold the task) to sort it into the matrix.
- **Calendar**: six views: Day, 3 days and Week (hour grid: timed tasks sit at their time, tap an empty slot to add a task there), 2 weeks and Month (task names on a laptop, coloured dots on a phone), and Year (all 12 months). Days off are shaded (Sat + Sun by default; change in Settings). Swipe or use the arrow keys to move.
- **Deadlines**: separate from the planned date ("3 days left", "2 days late").
- **Matrix**: fills the screen (each box scrolls on its own); a **+** on each box opens an add pop-up with date, time and deadline; tap a box's title to rename it; tick animation, swipe right = done, swipe left = delete, hold a task and drag it to another box, quick add that understands `tomorrow 5pm !1 #college`, due dates, checklists, notes, tags, collapsed "Done" list per box, and a "Not sorted" tray for tasks that aren't in a box yet.
- **Focus**: say what you'll do before, note what you did after, a plant that grows while you focus, background sounds (brown noise, rain, waves), 7-day chart, screen stays awake.
- **Habits**: colour per habit, strength score (forgives a missed day), best streak, milestone celebrations. Tap a habit for stat cards, a month calendar you can tick in (back-to-back days join into a streak band) and a 12-month bar chart.
- **ColorTracker**: paint your day hour by hour; a striped **One-off** colour for rare things (exam, trip) that asks for a name each time and lists each name separately; strokes never cover logged time; tap a block to stretch, lock, recolour or delete it; sleep-to-sleep and 24-hour views of the same data; warning when two activity colours look alike.
- **Sheets** close with a swipe down or the phone's back button.
- **Command bar**: `Ctrl+K` (or the search button) to add tasks, jump to sections, tick habits, start focus.
- **Sync**: sign in with Google and your data syncs between devices through your own Google Drive. Changes go up about a second after you make them; other devices pick them up when opened, when brought back on screen, and every 15 seconds.
- **Backup**: Settings → Copy backup, then paste on another device to merge.

## Install it like an app

- **Android (Chrome)**: open the live link → ⋮ menu → *Add to Home screen* / *Install app*.
- **iPad (Safari)**: open the live link → Share → *Add to Home Screen*.
- **Windows (Chrome / Edge)**: open the live link → install icon in the address bar.

## Where the data lives

| Stage | Storage | How to inspect it |
|---|---|---|
| On each device | Browser `localStorage`, key `taskstack.v1` | DevTools → Application → Local Storage, or Settings → Copy backup |
| Synced (after Sign in with Google) | One JSON file per user in **their own Google Drive** (`TaskStack/taskstack-data.json`) | Open the file in Google Drive on any PC |

There is no server and no central database, so hosting costs nothing however many people use it.

### Data shape

```json
{
  "version": 1,
  "tasks":    [{ "id": "…", "title": "…", "q": 1, "done": false, "createdAt": 0, "updatedAt": 0, "deleted": false }],
  "habits":   [{ "id": "…", "name": "…", "done": { "2026-11-02": { "on": true, "at": 0 } }, "updatedAt": 0, "deleted": false }],
  "sessions": [{ "id": "…", "taskId": "…", "minutes": 25, "endedAt": 0, "day": "2026-11-02", "updatedAt": 0 }],
  "settings": { "focus": 25, "short": 5, "long": 15, "updatedAt": 0 },
  "categories": [{ "id": "sleep", "name": "Sleep", "color": "#6b6b6b", "sleep": true, "updatedAt": 0, "deleted": false }],
  "ranges":   [{ "id": "…", "start": 0, "end": 0, "cat": "sleep", "updatedAt": 0, "deleted": false }],
  "timer":    { "…": "device-only, never synced" }
}
```

ColorTracker stores one continuous timeline of `ranges` (exact times, rounded to the minute). Days are never stored: the 24-hour view cuts the timeline at midnight, and the sleep-to-sleep view cuts it where each main sleep starts (sleep of 3 h or more; sleeps under 1 h apart are joined; a day longer than 36 h is split at midnight and marked estimated).

Sync rule (`mergeState` in `js/core.js`, used by `js/sync.js`): for each item, the copy with the newer `updatedAt` wins. Deletes are kept as `deleted: true` so other devices learn about them. Habit ticks merge day by day.

## Project files

```
index.html             page layout
css/app.css            design system: colours, dark mode, animations
js/core.js             saved data, undo, toasts, sounds, sheets, quick-add parser
js/matrix.js           shared task rows, swipes, drag between boxes, task details, Eisenhower matrix
js/tasks.js            Tasks list (main view)
js/calendar.js         Calendar
js/focus.js            pomodoro, plant, background sounds, chart, reflection
js/habits.js           habits, strength score, heatmap, milestones
js/colortracker.js     ColorTracker
js/sync.js             Google sign-in and Google Drive sync
js/main.js             section switching, settings, Ctrl+K command bar, shortcuts
manifest.webmanifest   app name and icons for "Install app"
sw.js                  service worker: opens offline; bump CACHE_NAME after changes
icons/                 app icons
```

## Run locally

Any static server works:

```bash
python -m http.server 8000
# open http://localhost:8000
```

## Roadmap

1. Reminders
2. Plan vs actual
3. Habit stats (monthly heatmap)
4. Android / iPad store apps via Capacitor

## Google Drive sync setup (once, by the app owner)

Sync needs a free Google Cloud "OAuth client ID". The ID is public (it goes in `js/sync.js`); there is no secret and no server.

1. Go to https://console.cloud.google.com/ → create a project (e.g. `TaskStack`).
2. **APIs & Services → Library** → enable **Google Drive API**.
3. **Google Auth Platform** (or **OAuth consent screen**) → set it up: app name `TaskStack`, your email, audience **External**.
   - **Data access**: add the scopes `.../auth/drive.file` and `.../auth/userinfo.email`.
   - **Audience**: add your Gmail as a **test user** (or press **Publish app**; these scopes don't need Google's review).
4. **Clients** (or **Credentials → Create credentials → OAuth client ID**) → type **Web application**:
   - Authorized JavaScript origins: `https://utkarshup49.github.io` and `http://localhost:8000`
   - Authorized redirect URIs: `https://utkarshup49.github.io/TaskStack/` and `http://localhost:8000/`
5. Copy the client ID (`….apps.googleusercontent.com`) into `GOOGLE_CLIENT_ID` at the top of `js/sync.js`.

How it works: the app asks only for `drive.file`, so it can see the files it created and nothing else in your Drive. Google sign-ins last one hour; when one runs out, the app renews it the next time it opens (a quick hop to Google and back). If it runs out while you're using the app, the cloud button turns red: tap it once.
