/* =========================================================
   Reminders (in the app, no server).
   - A task can have several reminders:
       { type: 'due', mins }  N minutes before its time (or before
                              remindHour on its day, when it has no time)
       { type: 'dl',  mins }  N minutes before remindHour on its deadline day
       { type: 'abs', at }    an exact moment (also used by Snooze)
     'due' and 'dl' follow the task when its date moves (repeats too).
   - While TaskStack is open (or was just used and is still in the
     background) a check every 15 s fires what's due: a sheet with
     Done / Snooze / Tomorrow if you're looking at the app, a phone or
     PC notification (with Done and Snooze buttons) if you're not.
   - When the app opens, reminders missed in the last 12 hours show up
     in the same sheet, marked "missed".
   - What already fired is remembered on this device only
     (localStorage "taskstack.fired"), so each device reminds you once.
   Limits: a closed app can't remind you. That needs a small server
   (Telegram bot / web push), which is the next step.
   ========================================================= */

const BELL_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/></svg>';
const FIRED_KEY = 'taskstack.fired';
const REMIND_CATCHUP = 12 * HOUR;     // on opening, show reminders missed in this window
const REMIND_EVERY = 15000;

let fired = loadFired();
let remQueue = [];                    // reminders waiting in the sheet: { taskId, at, missed }

function loadFired() {
  try { const f = JSON.parse(localStorage.getItem(FIRED_KEY)); if (f && f.keys) return f; } catch (e) {}
  return { last: 0, keys: {} };
}
function saveFired() {
  const old = now() - 3 * DAY;
  for (const k in fired.keys) if (fired.keys[k] < old) delete fired.keys[k];
  try { localStorage.setItem(FIRED_KEY, JSON.stringify(fired)); } catch (e) {}
}

// ---------- when does a reminder go off ----------
function reminderAt(t, r) {
  if (r.type === 'abs') return r.at || null;
  const hour = state.settings.remindHour * HOUR;
  if (r.type === 'due') {
    if (t.due === null || t.someday) return null;
    return (t.hasTime ? t.due : midnight(t.due) + hour) - (r.mins || 0) * MIN;
  }
  if (r.type === 'dl') return t.deadline ? midnight(t.deadline) + hour - (r.mins || 0) * MIN : null;
  return null;
}
function fmtBefore(m) {
  if (m < 60) return m + ' min before';
  if (m < 1440) return (m / 60) + (m === 60 ? ' hour' : ' hours') + ' before';
  return (m / 1440) + (m === 1440 ? ' day' : ' days') + ' before';
}
function reminderLabel(t, r) {
  const at = reminderAt(t, r);
  let what;
  if (r.type === 'abs') what = r.snooze ? 'Snoozed' : 'On';
  else if (r.type === 'dl') what = r.mins ? fmtBefore(r.mins) + ' the deadline' : 'Deadline day';
  else what = r.mins ? fmtBefore(r.mins) : (t.hasTime ? 'At its time' : 'On the day');
  return what + (at ? ' · ' + fmtDue(at, true) : ' · needs a date');
}
function nextReminder(t) {
  let best = null;
  const n = now();
  (t.reminders || []).forEach(function (r) {
    const at = reminderAt(t, r);
    if (at !== null && at > n && (best === null || at < best)) best = at;
  });
  return best;
}

// ---------- checking and firing ----------
function checkReminders() {
  const to = now();
  const from = Math.max(fired.last || 0, to - REMIND_CATCHUP);
  const due = [];
  liveTasks().forEach(function (t) {
    if (t.done) return;
    (t.reminders || []).forEach(function (r) {
      const at = reminderAt(t, r);
      if (at === null || at <= from || at > to) return;
      const key = t.id + '|' + r.id + '|' + at;
      if (fired.keys[key]) return;
      fired.keys[key] = at;
      due.push({ taskId: t.id, at: at, missed: to - at > 3 * MIN });
    });
  });
  checkNudges(from, to);
  fired.last = to;
  saveFired();
  if (due.length) announceReminders(due);
}
// Optional daily nudges (Profile → Reminders): plan your day at 8 am, wrap up at 9 pm.
function checkNudges(from, to) {
  if (!state.settings.nudges) return;
  const today = midnight(to);
  [['plan', 8, 'Plan your day', 'Two minutes: pick today\'s tasks and your top 3.'],
   ['wrap', 21, 'Wrap up the day', 'Move what\'s left, and note how today went.']].forEach(function (n) {
    const at = today + n[1] * HOUR;
    const key = 'nudge-' + n[0] + '-' + dayKey(today);
    if (at <= from || at > to || fired.keys[key]) return;
    fired.keys[key] = at;
    const day = typeof dayEntry === 'function' ? dayEntry(dayKey(today)) : null;
    if (day && (n[0] === 'plan' ? day.planned : day.wrapped)) return;
    if (document.visibilityState !== 'visible') showNote(n[2], n[3], 'nudge-' + n[0], { view: 'tasks', open: n[0] });
  });
}
function announceReminders(list) {
  sound('chime');
  haptic([120, 60, 120]);
  const away = document.visibilityState !== 'visible' || (document.hasFocus && !document.hasFocus());
  if (away) {
    list.slice(0, 3).forEach(function (x) {
      const t = findTask(x.taskId);
      if (!t) return;
      showNote(t.title, (x.missed ? 'Missed · ' : '') + (t.due !== null ? fmtDue(t.due, t.hasTime) : 'Reminder') + ' · tap Done or Snooze',
        'rem-' + t.id, { taskId: t.id }, true);
    });
    if (list.length > 3) showNote('TaskStack', (list.length - 3) + ' more reminders', 'rem-more', { view: 'tasks' });
  }
  list.forEach(function (x) {
    if (!remQueue.some(function (q) { return q.taskId === x.taskId; })) remQueue.push(x);
  });
  showReminderSheet();
}
// A phone / PC notification. With a service worker it can carry Done / Snooze buttons (Android, Windows).
function showNote(title, body, tag, data, buttons) {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const opts = { body: body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: tag, data: data || {}, renotify: true };
    if (buttons) opts.actions = [{ action: 'done', title: 'Done' }, { action: 'snooze', title: 'Snooze 10 min' }];
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.ready.then(function (reg) { reg.showNotification(title, opts); }).catch(function () {});
    } else {
      delete opts.actions;
      const n = new Notification(title, opts);
      n.onclick = function () { window.focus(); if (data && data.taskId) openTask(data.taskId); n.close(); };
    }
  } catch (e) {}
}

// ---------- the reminder sheet ----------
function reminderSheetHTML() {
  return '<h3 class="rem-title">' + BELL_SVG + (remQueue.length > 1 ? remQueue.length + ' reminders' : 'Reminder') + '</h3>' +
    '<ul class="remlist">' + remQueue.map(function (x) {
      const t = findTask(x.taskId);
      if (!t) return '';
      const l = listOf(t);
      return '<li style="--lc:' + l.color + '"><button class="rem-open" data-action="remopen" data-id="' + t.id + '"><b>' + esc(t.title) + '</b>' +
        '<span class="small">' + (x.missed ? '<em class="missed">Missed</em> ' : '') + esc(t.due !== null ? fmtDue(t.due, t.hasTime) : 'No date') + ' · ' + esc(l.name) + '</span></button>' +
        '<div class="rem-btns"><button class="btn small primary" data-action="remdone" data-id="' + t.id + '">Done</button>' +
        '<button class="btn small" data-action="remsnooze" data-id="' + t.id + '" data-m="10">10 min</button>' +
        '<button class="btn small" data-action="remsnooze" data-id="' + t.id + '" data-m="60">1 hour</button>' +
        '<button class="btn small" data-action="remtomorrow" data-id="' + t.id + '">Tomorrow</button></div></li>';
    }).join('') + '</ul>' +
    '<div class="row"><button class="btn" data-action="remok">OK</button></div>';
}
function showReminderSheet() {
  remQueue = remQueue.filter(function (x) { const t = findTask(x.taskId); return t && !t.deleted && !t.done; });
  if (!remQueue.length) { if (sheetCtx && sheetCtx.type === 'remind') closeSheet(); return; }
  if (sheetCtx && sheetCtx.type === 'remind') { refreshSheet(reminderSheetHTML()); return; }
  if (sheetCtx) {                      // another sheet is open: don't throw away what's being typed
    const t = findTask(remQueue[remQueue.length - 1].taskId);
    toast('Reminder: ' + shortTitle(t.title) + '. It will show when you close this.');
    return;
  }
  openSheet({ type: 'remind', onClose: function () { remQueue = []; } }, reminderSheetHTML());
}
// When any sheet closes and reminders are still waiting, show them.
const remCloseSheet = closeSheet;
closeSheet = function (fromHistory) {
  const wasRemind = sheetCtx && sheetCtx.type === 'remind';
  remCloseSheet(fromHistory);
  if (!wasRemind && remQueue.length) setTimeout(function () { if (!sheetCtx) showReminderSheet(); }, 380);
};
function remDoneWith(id) {
  remQueue = remQueue.filter(function (x) { return x.taskId !== id; });
  if (sheetCtx && sheetCtx.type === 'remind') {
    if (remQueue.length) refreshSheet(reminderSheetHTML()); else closeSheet();
  }
}
function snoozeTask(id, mins) {
  const t = findTask(id);
  if (!t) return;
  const n = now();
  t.reminders = t.reminders.filter(function (r) { return !(r.type === 'abs' && r.snooze && r.at < n); });
  t.reminders.push({ id: uid(), type: 'abs', at: n + mins * MIN, snooze: true });
  t.updatedAt = n;
  save();
  renderTaskViews();
  toast('Snoozed "' + shortTitle(t.title) + '" until ' + fmtTime(n + mins * MIN));
}
function moveTaskTomorrow(id) {
  const t = findTask(id);
  if (!t) return;
  snapshot('Moved to tomorrow');
  const tomorrow = addDays(midnight(now()), 1);
  const mins = t.due !== null && t.hasTime ? Math.round((t.due - midnight(t.due)) / MIN) : 0;
  t.due = tomorrow + mins * MIN;
  t.someday = false;
  t.updatedAt = now();
  save();
  renderTaskViews();
  toast('Moved "' + shortTitle(t.title) + '" to tomorrow', { undo: true });
}
actions.remdone = function (el) { const id = el.dataset.id; remDoneWith(id); toggleTask(id, false, true); };
actions.remsnooze = function (el) { remDoneWith(el.dataset.id); snoozeTask(el.dataset.id, Number(el.dataset.m)); };
actions.remtomorrow = function (el) { remDoneWith(el.dataset.id); moveTaskTomorrow(el.dataset.id); };
actions.remopen = function (el) { remQueue = []; closeSheet(); setTimeout(function () { openTask(el.dataset.id); }, 350); };
actions.remok = function () { remQueue = []; closeSheet(); };

// Done / Snooze pressed on a notification (sw.js passes it on), or the app opened from one.
function handleNoteAction(action, taskId, view) {
  if (taskId && !findTask(taskId)) return;
  if (action === 'done' && taskId) { remDoneWith(taskId); toggleTask(taskId, false, true); }
  else if (action === 'snooze' && taskId) { remDoneWith(taskId); snoozeTask(taskId, 10); }
  else if (taskId) { showView('tasks'); openTask(taskId); }
  else if (view) showView(view);
}
if (navigator.serviceWorker) {
  navigator.serviceWorker.addEventListener('message', function (e) {
    const d = e.data || {};
    if (d.type === 'note') handleNoteAction(d.action, d.taskId, d.view);
  });
}

// ---------- the Reminders part of the task sheet ----------
function notifyStateHTML() {
  if (!('Notification' in window)) {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
      ? '<p class="small">On iPad: add TaskStack to your Home Screen (Share → Add to Home Screen) and open it from there to get notifications. Until then reminders pop up inside the app.</p>'
      : '<p class="small">This browser can\'t show notifications, so reminders pop up inside the app.</p>';
  }
  if (Notification.permission === 'granted') return '';
  if (Notification.permission === 'denied') return '<p class="small">Notifications are blocked for this site in your browser settings, so reminders only pop up inside the app.</p>';
  return '<button class="btn small" data-action="allownotify">' + BELL_SVG + ' Allow notifications</button>';
}
function remindersHTML(t) {
  const list = (t.reminders || []).filter(function (r) { return !(r.type === 'abs' && r.snooze && r.at < now()); });
  let html = '<p class="label">Reminders</p>';
  html += list.length ? '<div class="remchips">' + list.map(function (r) {
    const at = reminderAt(t, r);
    const past = at !== null && at <= now();
    return '<span class="chip remchip' + (past ? ' past' : '') + '">' + BELL_SVG + esc(reminderLabel(t, r)) +
      '<button data-action="rdel" data-rid="' + r.id + '" aria-label="Remove reminder">×</button></span>';
  }).join('') + '</div>' : '';
  const picks = [];
  if (t.due !== null && !t.someday) {
    if (t.hasTime) picks.push(['due', 0, 'At its time'], ['due', 10, '10 min before'], ['due', 30, '30 min before'], ['due', 60, '1 hour before']);
    else picks.push(['due', 0, 'On the day, ' + fmtTime(midnight(now()) + state.settings.remindHour * HOUR)]);
    picks.push(['due', 1440, '1 day before']);
  }
  if (t.deadline) picks.push(['dl', 1440, 'Day before deadline'], ['dl', 0, 'Deadline morning']);
  const has = function (type, m) { return list.some(function (r) { return r.type === type && (r.mins || 0) === m; }); };
  html += '<div class="daterow">' + picks.filter(function (p) { return !has(p[0], p[1]); }).map(function (p) {
    return '<button class="btn small" data-action="radd" data-type="' + p[0] + '" data-m="' + p[1] + '">+ ' + esc(p[2]) + '</button>';
  }).join('') + '<label class="btn small datetimebtn">+ Pick a time<input type="datetime-local" id="rCustom" aria-label="Remind me at"></label></div>';
  if (t.due === null && !t.deadline) html += '<p class="small">Give the task a date to get "before" reminders that move with it.</p>';
  html += notifyStateHTML();
  return html;
}
function askNotify() {
  try {
    if (!('Notification' in window) || Notification.permission !== 'default') return;
    state.ui.askedNotify = true;
    save();
    Notification.requestPermission().then(function () { if (sheetCtx && sheetCtx.type === 'task') refreshTaskSheet(); });
  } catch (e) {}
}
actions.allownotify = function () { askNotify(); };
actions.radd = function (el) {
  const t = sheetTask();
  if (!t) return;
  t.reminders.push({ id: uid(), type: el.dataset.type, mins: Number(el.dataset.m) });
  taskChanged(t);
  refreshTaskSheet();
  askNotify();
  const at = reminderAt(t, t.reminders[t.reminders.length - 1]);
  if (at !== null && at < now()) toast('That time has already passed, so this one won\'t go off.');
};
actions.rdel = function (el) {
  const t = sheetTask();
  if (!t) return;
  t.reminders = t.reminders.filter(function (r) { return r.id !== el.dataset.rid; });
  taskChanged(t);
  refreshTaskSheet();
};
$('sheet').addEventListener('change', function (e) {
  if (e.target.id !== 'rCustom' || !e.target.value) return;
  const t = sheetTask();
  if (!t) return;
  const at = new Date(e.target.value).getTime();
  if (!(at > now())) { toast('Pick a time in the future.'); return; }
  t.reminders.push({ id: uid(), type: 'abs', at: at });
  taskChanged(t);
  refreshTaskSheet();
  askNotify();
});

function startReminders() {
  checkReminders();
  setInterval(checkReminders, REMIND_EVERY);
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') checkReminders(); });
  // Opened by tapping a notification while the app was closed: ?note=done&task=...
  const p = new URLSearchParams(location.search);
  if (p.get('note')) {
    const action = p.get('note'), id = p.get('task'), v = p.get('view');
    try { history.replaceState(null, '', location.pathname + location.hash); } catch (e) {}
    setTimeout(function () { handleNoteAction(action, id, v); }, 300);
  }
}
