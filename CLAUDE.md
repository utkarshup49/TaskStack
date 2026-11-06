# TaskStack: notes for Claude

Read this before changing anything. Both Claude Code (on Utkarsh's PC) and Claude chat (on his phone) work on this repo, so the code on GitHub is the source of truth.

## Before you start / when you finish
- Start: `git pull` (or `git fetch` + rebase) so you have the latest commits from the other side.
- Finish: commit and `git push`. Unpushed work is invisible to the other session.
- Read recent `git log` messages to see what changed and why.

## Commits
- Author and committer: **Utkarsh Pareek <utkarshpareekss@gmail.com>** (already set in this repo's git config).
- **Never** add `Co-Authored-By: Claude`, "Generated with Claude", or any other Claude/AI attribution line to commit messages or PRs.
- Message style: one short line saying what changed, e.g. `ColorTracker: tap a block to lock it`. Group a release as `v0.x: ...`.

## How Utkarsh likes the code
- Plain HTML, CSS and JavaScript. No framework, no build step, no npm packages in the app.
- Simple, beginner-readable syntax (`function`, `forEach`, clear names), but correct and efficient logic. Short comments that explain *why*.
- Each file starts with a comment block saying what it does.
- Prefer small focused edits over rewrites unless a rewrite is clearly simpler.

## How he likes to be answered
- Actionable bullet points and step-by-step instructions, not long paragraphs.
- When finishing a feature: say what changed, how to test it on his phone, and what's still missing. He may ask for a self-rating (out of 10) per change; be honest, not generous.

## Project layout
```
index.html             page layout (all sections, tabs, sheet, command bar, toast)
css/app.css            design system: colour tokens, dark mode, animations, all component styles
js/core.js             helpers, saved data (load/save/normalize), merge for sync, undo, toast,
                       sounds + vibration, bottom sheet (swipe-down + back button), box menu,
                       quick-add parser (parseQuickAdd)
js/repeat.js           repeating tasks: rule maths, "every ..." parser, Repeat picker, stacking copies,
                       the "how it comes back" explanation
js/lists.js            lists (College, Projects ...): chip filter bar on Tasks/Matrix/Calendar,
                       Edit lists sheet, /list quick-add lookup (listByToken), listPickHTML
js/remind.js           in-app reminders: reminderAt, 15 s checker, reminder sheet (Done/Snooze/Tomorrow),
                       notifications (sw.js handles their buttons), Reminders part of the task sheet
js/matrix.js           shared task rows (taskHTML), tick/swipe/hold-drag gestures,
                       task details sheet, Eisenhower matrix + "Not sorted" tray,
                       per-box add pop-up (+) and rename (...)
js/tasks.js            Tasks list, the main view (grouped by date)
js/calendar.js         Calendar: Day / 3 days / Week (hour grid), 2 weeks / Month (day grid), Year;
                       days off shaded; tap an empty hour slot to add a task there
js/focus.js            pomodoro, intent/reflection, growing plant, ambient sound, 7-day chart
js/habits.js           habits, strength score, milestones; details sheet with stat cards,
                       a tickable month calendar (streaks join into bands) and a 12-month chart
js/colortracker.js     ColorTracker (paint the day hour by hour)
js/plan.js             banner, Plan your day, Wrap up, Weekly review, Logbook, Countdowns, Templates,
                       day notes (state.days), completionsByDay()
js/profile.js          avatar + profile sheet: stats, level/XP, goals, reminder settings, sections on/off,
                       download/restore/CSV/delete-all, shortcuts sheet, what's new
js/sync.js             Google sign-in (redirect, no server) + Google Drive sync
js/main.js             section switching, settings sheet, Ctrl+K command bar, keyboard, start-up
sw.js                  service worker (offline)
manifest.webmanifest   install-as-app info
```
Scripts are plain `<script>` tags sharing globals, loaded in this order:
core, repeat, lists, remind, matrix, tasks, calendar, focus, habits, colortracker, plan, profile, sync, main. Top-level names must be unique across files.
Click handlers are registered as `actions.<name> = function (el, e) {...}` and triggered by `data-action="<name>"`.

## Must-do on every change
- **Bump `CACHE_NAME` in `sw.js`** (taskstack-v6 → v7 ...) or installed phones keep the old version.
- If you add a file, add it to the `FILES` list in `sw.js` and a `<script>`/`<link>` in `index.html`.
- Test at phone width (390px) and laptop width, light and dark mode, with no console errors.
- Never break saved data: add new fields in `normalize()` in core.js with safe defaults.

## Data (localStorage key `taskstack.v1`)
- One object: `tasks`, `habits`, `sessions`, `ranges` (ColorTracker), `categories` (ColorTracker activities), `lists`, `days`, `countdowns`, `templates`, `settings`, `timer`, `ui`. All the arrays sync and merge by id.
- Every item has `id` and `updatedAt`. Deletes set `deleted: true` (kept so sync can spread deletes).
- `mergeState()` merges two copies: newer `updatedAt` wins per item; habit ticks merge per day. Google Drive sync (sync.js) uses it.
- **Every edit must bump `updatedAt`** (habit ticks: `done[day].at`), or sync won't see it.
- `timer` and `ui` stay on the device and are never uploaded. Sync's own info (token, file id) is in localStorage key `taskstack.sync`.
- Calendar: `settings.offDays` = weekdays shaded as days off (0 = Sun … 6 = Sat, default [0, 6]; syncs). `ui.calMode` = the view (device-only). Timed tasks are drawn 1 hour tall (tasks have no duration yet).
- Repeating tasks: `task.repeat` = { unit day|week|month|year, every, days[], monthBy date|nth|workday, monthDay (-1 = last), nth (-1 = last), wd, mode fixed|after|stack, start, until }. fixed/after: ticking logs `task.history` and moves the date (never onto a past day). stack: one copy per date, same `seriesId`, id `seriesId_YYYY-MM-DD`, max 5 open; lists show only the oldest open copy with a "N stacked" button. Use `setupRepeat()` when adding, `applyTaskRepeat()` when editing.
- Box names: `quadName(q)` / `quadSub(q)` (core.js), renamable, stored in `settings.quadNames` so they sync. Never read `QUADS[i].name` directly for display.
- Task: `title, q (1-4 or null = not sorted), due (ms or null), hasTime, deadline (ms or null), done, doneAt, subtasks[], tags[], notes, listId, reminders[], someday, evening, est (minutes or null), top (dayKey when it's one of that day's top 3)`.
- New tasks: after `newTask()` call `finishNewTask(task, parsed)` (core.js): applies /list, ~estimate, someday and the default reminder.
- Lists: `state.lists` = { id, name, color, order }. Default ids personal/college/extra/projects/growth with updatedAt 1 (so devices don't duplicate them). `listOf(t)` always returns a live list. The filter is `ui.listFilter` (device-only, shared by Tasks/Matrix/Calendar); views use `listVisible(t)`. New tasks go to `defaultListId()` (the one list being viewed, else `settings.defaultList`).
- Reminders: `task.reminders` = { id, type 'due' (mins before its time, or before `settings.remindHour` on its day) | 'dl' (mins before remindHour on the deadline day) | 'abs' (at) , snooze? }. `reminderAt(t, r)` gives the moment. What fired is device-only in localStorage `taskstack.fired`. Only works while the app is open/recent; Telegram/web push need a server (not built yet).
- Someday tasks have no date and are hidden from Today, the Matrix and Calendar (a folded group at the bottom of Tasks). Setting a date clears `someday`.
- `state.days`: { id: "YYYY-MM-DD" (planned, wrapped, mood 1-5, note) or "wYYYY-MM-DD" = week starting that Monday (reviewed, note) }. The future Journal should build on this.
- Sessions also store `distractions` and `listId`.
- Settings added in v0.9 live in `SETTING_DEFAULTS` (core.js): dailyGoal, workHours, remindDefault, remindHour, defaultList, profileName, hiddenTabs, nudges.
- Tasks with no date show in Today. `taskDate(t)` = due, or deadline if there's no due.
- Far-off tasks (`isFarOff(t)`: planned date more than 6 days ahead): hidden from the Matrix (a note under it counts them), folded into a collapsed "Scheduled" group in Tasks, always shown in the Calendar. Ticking one asks "Done already?" first (`askDoneEarly`), because one stray tick on a repeating task silently moves it a whole month on. A task with only a far deadline stays visible.
- Snapshot before a change (`snapshot('label')`) so Undo works; show `toast(msg, { undo: true })` for anything destructive.

## Design rules
- Layout: phone/tablet = bottom tabs; 900px+ = tabs become a left sidebar and the Matrix and ColorTracker fill the whole width (other views max 1400px).
- Matrix: no add box on the page. Each box has its own + (shown on hover on a laptop, always on touch) that opens the add pop-up; tap a box title or ... to rename it.
- One signature colour per section (`--c-tasks`, `--c-cal`, `--c-matrix`, `--c-focus`, `--c-break`, `--c-habits`, `--c-ct`); the active section sets `--accent`.
- Quadrants: `--q1` red, `--q2` blue, `--q3` mustard, `--q4` slate. Keep every colour clearly different from the others, in light and dark mode (he dislikes colours that look alike).
- Use colour tokens, never hard-coded hex in components.
- Motion: 150–300 ms, springy, never blocks the next tap; respect reduced motion.
- Depth (trial on ColorTracker, "ColorTracker look" block in app.css): buttons are raised (coloured border, solid ledge `--edge` under them, soft `--drop` shadow; pressing pushes them down), cards float with an accent strip on top, activity chips are tinted in their own colour and the chosen one is filled. Tokens: `--raise --raise-line --edge --drop --hi`. If Utkarsh approves it, spread it to the other sections, each in its own colour.
- Nothing destructive happens by accident: confirm via Undo, require a deliberate gesture (hold, swipe past a threshold, pen button that turns itself off after one stroke).

## ColorTracker rules (his own feature, keep these)
- Pick a colour, tap **Pen**, drag; the pen turns off after one stroke. With the pen off, the grid scrolls and a tap selects a block.
- New paint never covers logged time (it fills only the gaps). Selected blocks can be stretched, recoloured, locked, deleted.
- Times are stored exactly (to the minute), no 5/10-minute snapping.
- "One-off" activity (category `oneoff: true`, id `oneoff`, striped): for rare things. After painting it, a sheet asks "What was this?" and the name goes in `range.label`. Entries, totals (one line per name) and the grid show the name; One-off blocks never join their neighbours. Use `rangeName(r)` for display.
- One continuous timeline; "Sleep to sleep" and "24-hour" are two views of it. Sleeps < 1 h apart merge. A sleep of at least `settings.napHours` (default 3.5 h, slider 0.5–6 h in ColorTracker Settings, syncs) starts a new day; shorter sleeps are naps (tagged "nap" in Entries) and never start a day, except when no big sleep is within 14 h: then the longest short sleep (≥ 1 h) in that stretch starts the day. A day longer than 36 h is split at midnight and marked estimated. The 24-hour view is always midnight to midnight.

## Roadmap (next, in order)
1. ~~Repeating tasks~~ (done: repeat.js)
2. Reminders: ~~in-app~~ (done: remind.js). Next: Telegram bot + web push from a Cloudflare Worker (needs Utkarsh to create the bot in @BotFather and a Cloudflare account). WhatsApp only later (paid per message).
3. ~~Google Drive sync~~ (done: sync.js, file `TaskStack/taskstack-data.json` in the user's Drive)
4. Plan vs actual: time-block tasks on a day timeline and compare with ColorTracker
5. ~~Lists~~ (done: lists.js)
6. ~~Weekly review, countdowns, morning plan~~ (done: plan.js). Still: snooze swipe, Google Calendar events (read-only)
7. Journal (Day One style), building on `state.days`
8. Teams / shared lists (a list file shared through Drive)
9. Native Android / iPad apps via Capacitor (widgets, reliable notifications)
