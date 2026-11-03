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
js/matrix.js           shared task rows (taskHTML), tick/swipe/hold-drag gestures,
                       task details sheet, Eisenhower matrix + "Not sorted" tray
js/tasks.js            Tasks list, the main view (grouped by date)
js/calendar.js         Calendar month view, add a task onto a date
js/focus.js            pomodoro, intent/reflection, growing plant, ambient sound, 7-day chart
js/habits.js           habits, strength score, heatmap, milestones
js/colortracker.js     ColorTracker (paint the day hour by hour)
js/main.js             section switching, settings sheet, Ctrl+K command bar, keyboard, start-up
sw.js                  service worker (offline)
manifest.webmanifest   install-as-app info
```
Scripts are plain `<script>` tags sharing globals, loaded in this order:
core, matrix, tasks, calendar, focus, habits, colortracker, main. Top-level names must be unique across files.
Click handlers are registered as `actions.<name> = function (el, e) {...}` and triggered by `data-action="<name>"`.

## Must-do on every change
- **Bump `CACHE_NAME` in `sw.js`** (taskstack-v6 → v7 ...) or installed phones keep the old version.
- If you add a file, add it to the `FILES` list in `sw.js` and a `<script>`/`<link>` in `index.html`.
- Test at phone width (390px) and laptop width, light and dark mode, with no console errors.
- Never break saved data: add new fields in `normalize()` in core.js with safe defaults.

## Data (localStorage key `taskstack.v1`)
- One object: `tasks`, `habits`, `sessions`, `ranges` (ColorTracker), `categories` (ColorTracker activities), `settings`, `timer`, `ui`.
- Every item has `id` and `updatedAt`. Deletes set `deleted: true` (kept so sync can spread deletes).
- `mergeState()` merges two copies: newer `updatedAt` wins per item; habit ticks merge per day. This is the planned basis for Google Drive sync.
- Task: `title, q (1-4 or null = not sorted), due (ms or null), hasTime, deadline (ms or null), done, doneAt, subtasks[], tags[], notes`.
- Tasks with no date show in Today. `taskDate(t)` = due, or deadline if there's no due.
- Snapshot before a change (`snapshot('label')`) so Undo works; show `toast(msg, { undo: true })` for anything destructive.

## Design rules
- One signature colour per section (`--c-tasks`, `--c-cal`, `--c-matrix`, `--c-focus`, `--c-break`, `--c-habits`, `--c-ct`); the active section sets `--accent`.
- Quadrants: `--q1` red, `--q2` blue, `--q3` mustard, `--q4` slate. Keep every colour clearly different from the others, in light and dark mode (he dislikes colours that look alike).
- Use colour tokens, never hard-coded hex in components.
- Motion: 150–300 ms, springy, never blocks the next tap; respect reduced motion.
- Nothing destructive happens by accident: confirm via Undo, require a deliberate gesture (hold, swipe past a threshold, pen button that turns itself off after one stroke).

## ColorTracker rules (his own feature, keep these)
- Pick a colour, tap **Pen**, drag; the pen turns off after one stroke. With the pen off, the grid scrolls and a tap selects a block.
- New paint never covers logged time (it fills only the gaps). Selected blocks can be stretched, recoloured, locked, deleted.
- Times are stored exactly (to the minute), no 5/10-minute snapping.
- One continuous timeline; "Sleep to sleep" and "24-hour" are two views of it. A sleep of 3 h+ starts a new day; sleeps < 1 h apart merge; a day longer than 36 h is split at midnight and marked estimated.

## Roadmap (next, in order)
1. Repeating tasks
2. Reminders / notifications
3. Google Drive sync (data in the user's own Drive, file `TaskStack/taskstack-data.json`)
4. Plan vs actual: time-block tasks on a day timeline and compare with ColorTracker
5. Lists (College, Personal, ...)
6. Snooze swipe, Google Calendar events (read-only), weekly review, exam countdowns, morning plan
7. Journal (Day One style)
8. Native Android / iPad apps via Capacitor (widgets, reliable notifications)
