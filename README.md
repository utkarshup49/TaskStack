# TaskStack

An Eisenhower matrix, pomodoro timer and habit tracker in one app. It runs on Windows, Android and iPad from one codebase.

**Live app:** https://utkarshup49.github.io/TaskStack/

## Features (v0.1)

- **Matrix**: four quadrants (Do now, Schedule, Delegate, Drop). Tap a task to move, rename, delete or focus on it.
- **Focus**: pomodoro timer (25 / 5 / 15 min, editable) linked to a task, with a session log and pomodoro count per task.
- **Habits**: 7-day grid with streaks.
- **Backup**: Settings → Copy backup, then paste on another device to merge.

## Install it like an app

- **Android (Chrome)**: open the live link → ⋮ menu → *Add to Home screen* / *Install app*.
- **iPad (Safari)**: open the live link → Share → *Add to Home Screen*.
- **Windows (Chrome / Edge)**: open the live link → install icon in the address bar.

## Where the data lives

| Stage | Storage | How to inspect it |
|---|---|---|
| Now (v0.1) | Browser `localStorage`, key `taskstack.v1` | DevTools → Application → Local Storage, or Settings → Copy backup |
| Next (v0.2) | One JSON file per user in **their own Google Drive** (`TaskStack/taskstack-data.json`) | Open the file in Google Drive on any PC |

There is no server and no central database, so hosting costs nothing however many people use it.

### Data shape

```json
{
  "version": 1,
  "tasks":    [{ "id": "…", "title": "…", "q": 1, "done": false, "createdAt": 0, "updatedAt": 0, "deleted": false }],
  "habits":   [{ "id": "…", "name": "…", "done": { "2026-11-02": { "on": true, "at": 0 } }, "updatedAt": 0, "deleted": false }],
  "sessions": [{ "id": "…", "taskId": "…", "minutes": 25, "endedAt": 0, "day": "2026-11-02", "updatedAt": 0 }],
  "settings": { "focus": 25, "short": 5, "long": 15, "updatedAt": 0 },
  "timer":    { "…": "device-only, never synced" }
}
```

Sync rule (`mergeState` in `index.html`): for each item, the copy with the newer `updatedAt` wins. Deletes are kept as `deleted: true` so other devices learn about them. Habit ticks merge day by day.

## Project files

```
index.html             the whole app (HTML + CSS + JS, no build step)
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

1. Google sign-in + Drive sync
2. Due dates and reminders
3. Habit stats (monthly heatmap)
4. Android / iPad store apps via Capacitor
