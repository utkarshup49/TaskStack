/* =========================================================
   Profile: the round avatar at the top right opens one sheet with
   - you: photo (from Google) or initials, your name, your email
   - level + XP, today's goal ring, goal streak, this week in numbers
   - shortcuts: Plan my day, Wrap up, Weekly review, Logbook,
     Lists, Countdowns, Settings
   - Sync (Google Drive), daily goal and planning hours, reminders,
     which sections show, templates, your data (export / import /
     delete), install tips, keyboard shortcuts, what's new
   ========================================================= */

const APP_VERSION = '0.14';
const WHATS_NEW = [
  'ColorTracker: export your time log for an AI. Pick 7, 15, 30… up to 365 days, as easy text (with your question on top), JSON or CSV. Copy or download.',
  'Removed "Delete all my data" for now, so nobody can wipe their data by accident.',
  'Laptop Tasks: the list on the left, and on the right Today (progress, Top 3, habits, timeline) or a small calendar. Tasks open beside the list.',
  'Drag a task onto an hour of today\'s timeline, or onto a day. New Board view: Today, Tomorrow, each day, Later and Someday as columns.',
  'Habits: a tile per habit with its last 21 days, each day labelled.',
  'ColorTracker Stats on a laptop: tabs and key numbers on the left, today so far and insights on the right, cards in columns. New Compare tab.',
  'Add a task with every option at once: the + next to Add opens the full task screen (repeat, reminders, steps, notes…).',
  'Task screen: Mark done, Delete and Close sit at the top and stay there while you scroll.',
  'Light / dark switch at the top of the app. Settings now open from the gear in your profile.',
  'Calendar: drag tasks to another day or time, drag a block\'s bottom edge to change how long it takes, drag on empty hours to add a task for that range.',
  'Calendar drawer: tasks with no date and overdue ones, ready to drag in. "All to today" in one tap.',
  'Calendar Agenda view, future dates of repeating tasks (faded), tasks that run over several days ("Runs until").',
  'Calendar shows what you painted in ColorTracker on past days and your habit ticks; tick habits from the day sheet.',
  'Calendar: search (F), jump to any date (tap the title), pinch or + / − to zoom, week numbers, Sunday start, hours shown, filter by box or tag.',
  'Phone: hold a task in the day sheet, then tap another day to move it.'
];
const SECTION_NAMES = [['calendar', 'Calendar'], ['matrix', 'Matrix'], ['focus', 'Focus'], ['habits', 'Habits'], ['colortracker', 'ColorTracker']];

// ---------- who you are ----------
function profileName() {
  const n = (state.settings.profileName || '').trim();
  if (n) return n;
  if (sync.name) return sync.name;
  if (sync.email) return sync.email.split('@')[0];
  return '';
}
function initials(name) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}
function avatarHTML(size) {
  const name = profileName();
  const ini = initials(name);
  const face = sync.picture
    ? '<img src="' + esc(sync.picture) + '" alt="" referrerpolicy="no-referrer" onerror="this.remove()">'
    : '';
  const fallback = ini ? '<span>' + esc(ini) + '</span>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>';
  return '<span class="pavatar ' + (size || '') + '">' + fallback + face + '</span>';
}
function renderAvatar() {
  const b = $('avatarBtn');
  if (b) b.innerHTML = avatarHTML();
}

// ---------- numbers ----------
function goalStreak(byDay) {
  const goal = state.settings.dailyGoal;
  let n = 0;
  let d = midnight(now());
  if ((byDay[dayKey(d)] || 0) < goal) d = addDays(d, -1);      // today still counts as "in progress"
  while ((byDay[dayKey(d)] || 0) >= goal && n < 3650) { n++; d = addDays(d, -1); }
  return n;
}
function xpInfo(byDay) {
  let done = 0;
  for (const k in byDay) done += byDay[k];
  const focus = liveSessions().reduce(function (a, s) { return a + s.minutes; }, 0);
  let ticks = 0;
  liveHabits().forEach(function (h) { for (const k in h.done) if (h.done[k].on) ticks++; });
  const xp = done * 10 + focus + ticks * 5;
  const level = Math.floor(Math.sqrt(xp / 50)) + 1;
  const from = 50 * (level - 1) * (level - 1), to = 50 * level * level;
  return { xp: xp, level: level, pct: (xp - from) / (to - from), toNext: to - xp };
}
function ringSVG(pct) {
  const r = 26, c = 2 * Math.PI * r;
  return '<svg viewBox="0 0 64 64" class="ring"><circle cx="32" cy="32" r="' + r + '" class="rt"/><circle cx="32" cy="32" r="' + r + '" class="rp" stroke-dasharray="' + c.toFixed(2) +
    '" stroke-dashoffset="' + (c * (1 - Math.min(1, pct))).toFixed(2) + '"/></svg>';
}

// ---------- the sheet ----------
function profileHTML() {
  const byDay = completionsByDay();
  const today = byDay[dayKey()] || 0;
  const goal = state.settings.dailyGoal;
  const xp = xpInfo(byDay);
  const ws = weekStart(now());
  let weekDone = 0;
  for (let i = 0; i < 7; i++) weekDone += byDay[dayKey(addDays(ws, i))] || 0;
  const weekFocus = liveSessions().filter(function (s) { return s.day >= dayKey(ws); }).reduce(function (a, s) { return a + s.minutes; }, 0);
  const bestHabit = liveHabits().reduce(function (m, h) { return Math.max(m, streak(h)); }, 0);
  const name = profileName();
  const st = state.settings;
  function tile(action, label, svg) { return '<button class="ptile" data-action="' + action + '">' + svg + '<span>' + label + '</span></button>'; }
  function stepper(key, label, unit, min, max) {
    return '<div class="stepper"><span>' + label + '</span><button class="icon-btn sm" data-action="pstep" data-k="' + key + '" data-d="-1" aria-label="Less"' + (st[key] <= min ? ' disabled' : '') + '>−</button>' +
      '<b>' + st[key] + unit + '</b><button class="icon-btn sm" data-action="pstep" data-k="' + key + '" data-d="1" aria-label="More"' + (st[key] >= max ? ' disabled' : '') + '>+</button></div>';
  }
  const remChoices = [[-1, 'None'], [0, 'At time'], [5, '5 min'], [10, '10 min'], [30, '30 min'], [60, '1 hour']];
  const tpls = liveTemplates();
  return '<div class="phead">' + avatarHTML('lg') +
      '<div class="pwho"><input class="pname" id="profileName" value="' + esc(name) + '" placeholder="Your name" maxlength="40" aria-label="Your name" enterkeyhint="done">' +
      '<span class="small">' + (sync.email ? esc(sync.email) : 'Not signed in · your data is on this device') + '</span></div>' +
      '<button class="icon-btn psettings" data-action="settings" aria-label="Settings" title="Settings"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg></button></div>' +
    '<div class="plevel"><div><b>Level ' + xp.level + '</b><span class="small">' + xp.xp + ' XP · ' + xp.toNext + ' to level ' + (xp.level + 1) + '</span></div>' +
      '<div class="lb-track"><i style="width:' + (xp.pct * 100).toFixed(1) + '%"></i></div>' +
      '<p class="small">10 XP a task, 1 a focus minute, 5 a habit tick.</p></div>' +
    '<div class="pgoal">' + ringSVG(today / goal) + '<div><b>' + today + ' of ' + goal + '</b><span class="small">tasks done today' + (today >= goal ? ' · goal reached' : '') + '</span>' +
      '<span class="small">Goal streak: <b>' + goalStreak(byDay) + (goalStreak(byDay) === 1 ? ' day' : ' days') + '</b></span></div></div>' +
    '<div class="statgrid">' +
      '<div><b>' + weekDone + '</b><span>done this week</span></div>' +
      '<div><b>' + fmtEst(weekFocus) + '</b><span>focus this week</span></div>' +
      '<div><b>' + bestHabit + '</b><span>best habit streak</span></div>' +
    '</div>' +
    '<div class="ptiles">' +
      tile('planday', 'Plan my day', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>') +
      tile('wrapday', 'Wrap up', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>') +
      tile('weekreview', 'Weekly review', CAL_SVG) +
      tile('logbook', 'Logbook', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h12a4 4 0 0 1 4 4v12H8a4 4 0 0 1-4-4z"/><path d="M8 9l2 2 4-4"/></svg>') +
      tile('listsedit', 'Lists', LIST_SVG) +
      tile('countdowns', 'Countdowns', CLOCK_SVG) +
      tile('timestats', 'Time stats', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>') +
      tile('shortcuts', 'Shortcuts', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/></svg>') +
    '</div>' +
    '<p class="label">Sync with Google Drive</p><div class="sync-box" id="syncBox">' + syncSettingsHTML() + '</div>' +
    '<p class="label">Goals</p>' +
    stepper('dailyGoal', 'Tasks a day', '', 1, 30) +
    stepper('workHours', 'Hours you can plan into a day', 'h', 1, 16) +
    '<p class="label">Reminders</p>' +
    '<p class="small">New tasks with a time get this reminder:</p>' +
    '<div class="pickrow wrap">' + remChoices.map(function (c) {
      return '<button class="pick' + (st.remindDefault === c[0] ? ' on' : '') + '" data-action="premdef" data-m="' + c[0] + '">' + (c[0] > 0 ? c[1] + ' before' : c[1]) + '</button>';
    }).join('') + '</div>' +
    '<div class="stepper"><span>Tasks with only a date remind at</span><button class="icon-btn sm" data-action="pstep" data-k="remindHour" data-d="-1" aria-label="Earlier"' + (st.remindHour <= 5 ? ' disabled' : '') + '>−</button>' +
      '<b>' + fmtTime(midnight(now()) + st.remindHour * HOUR) + '</b><button class="icon-btn sm" data-action="pstep" data-k="remindHour" data-d="1" aria-label="Later"' + (st.remindHour >= 22 ? ' disabled' : '') + '>+</button></div>' +
    '<div class="toggle"><span>Nudge me to plan (8 am) and wrap up (9 pm)</span><button class="switch" role="switch" aria-checked="' + !!st.nudges + '" data-action="pnudges" aria-label="Daily nudges"></button></div>' +
    notifyStateHTML() +
    ('Notification' in window && Notification.permission === 'granted' ? '<button class="btn small" data-action="ptestnote">Send a test notification</button>' : '') +
    '<p class="small">Reminders work while TaskStack is open or was used recently. Telegram reminders, which also reach you when it\'s closed, come next.</p>' +
    '<p class="label">Sections</p><p class="small">Hide the ones you don\'t use. Tasks always stays.</p>' +
    SECTION_NAMES.map(function (s) {
      const on = (st.hiddenTabs || []).indexOf(s[0]) === -1;
      return '<div class="toggle"><span>' + s[1] + '</span><button class="switch" role="switch" aria-checked="' + on + '" data-action="psection" data-v="' + s[0] + '" aria-label="Show ' + s[1] + '"></button></div>';
    }).join('') +
    (tpls.length ? '<p class="label">Templates</p><ul class="tpllist">' + tpls.map(function (x) {
      return '<li><span>' + esc(x.name) + '<small>' + (x.task.subtasks.length ? x.task.subtasks.length + ' steps' : 'no steps') + '</small></span><button class="icon-btn sm danger" data-action="tpldelete" data-id="' + x.id + '" aria-label="Delete template">×</button></li>';
    }).join('') + '</ul>' : '') +
    '<p class="label">Your data</p>' +
    '<div class="row"><button class="btn small" data-action="pexport">Download backup</button><button class="btn small" data-action="pcsv">Tasks as CSV</button><button class="btn small" data-action="ctexport">ColorTracker log (for AI)</button><button class="btn small" data-action="pimport">Restore a backup</button></div>' +
    '<input type="file" id="importFile" accept=".json,application/json" hidden>' +
    installTipHTML() +
    '<p class="label">What\'s new in ' + APP_VERSION + '</p><ul class="whatsnew">' + WHATS_NEW.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul>' +
    '<p class="small">TaskStack ' + APP_VERSION + ' · your data stays on your devices and in your own Google Drive.</p>' +
    '<div class="row"><button class="btn" data-action="close">Close</button></div>';
}
function installTipHTML() {
  const standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone;
  if (standalone) return '';
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return '<p class="label">Install</p><p class="small">' + (ios
    ? 'On iPad: open this page in Safari, tap Share, then <b>Add to Home Screen</b>. Opened from there, it runs full screen and can show notifications.'
    : 'In Chrome or Edge: menu → <b>Install TaskStack</b> (or "Add to Home screen" on Android). It opens like an app, works offline, and long-pressing its icon gives Quick add and Start focus.') + '</p>';
}
function openProfile() { openSheet({ type: 'profile', onClose: saveProfileName }, profileHTML()); }
function refreshProfile() { if (sheetCtx && sheetCtx.type === 'profile') refreshSheet(profileHTML()); }
function saveProfileName() {
  const el = $('profileName');
  if (!el) return;
  const v = el.value.trim();
  if (v === profileName() || (!v && !state.settings.profileName)) return;
  state.settings.profileName = v;
  state.settings.updatedAt = now();
  save();
  renderAvatar();
}

// ---------- buttons ----------
actions.profile = function () { openProfile(); };
actions.timestats = function () { closeSheet(); showView('colortracker'); setCtPage('stats', 'overview'); };
actions.pstep = function (el) {
  const k = el.dataset.k;
  const lim = { dailyGoal: [1, 30], workHours: [1, 16], remindHour: [5, 22] }[k];
  const v = Math.max(lim[0], Math.min(lim[1], state.settings[k] + Number(el.dataset.d)));
  if (v === state.settings[k]) return;
  saveProfileName();
  state.settings[k] = v;
  state.settings.updatedAt = now();
  save();
  refreshProfile();
  renderTaskViews();
};
actions.premdef = function (el) {
  saveProfileName();
  state.settings.remindDefault = Number(el.dataset.m);
  state.settings.updatedAt = now();
  save();
  refreshProfile();
  if (state.settings.remindDefault >= 0) askNotify();
};
actions.pnudges = function () {
  saveProfileName();
  state.settings.nudges = !state.settings.nudges;
  state.settings.updatedAt = now();
  save();
  refreshProfile();
  if (state.settings.nudges) askNotify();
};
actions.ptestnote = function () { showNote('TaskStack', 'Notifications work. Reminders will look like this.', 'test', { view: 'tasks' }); toast('Sent. Check your notifications.'); };
actions.psection = function (el) {
  saveProfileName();
  const v = el.dataset.v;
  const list = state.settings.hiddenTabs;
  const i = list.indexOf(v);
  if (i === -1) list.push(v); else list.splice(i, 1);
  state.settings.updatedAt = now();
  save();
  applySections();
  refreshProfile();
};
actions.shortcuts = function () {
  openSheet({ type: 'shortcuts' }, '<h3>Keyboard shortcuts</h3><ul class="keys">' + [
    ['N', 'New task'], ['Ctrl K or /', 'Search, commands, add'], ['Ctrl Z', 'Undo'], ['1 – 6', 'Switch section (Alt + 1 – 6 in ColorTracker)'],
    ['?', 'This list'], ['Esc', 'Close'], ['← →', 'Calendar: previous / next'], ['F / G / U / T', 'Calendar: find, go to date, drawer, today'], ['+ −', 'Calendar: zoom in / out'], ['P', 'ColorTracker: pen'], ['1 – 9', 'ColorTracker: pick a colour'], ['L', 'ColorTracker: lock a block']
  ].map(function (k) { return '<li><span class="kbd">' + k[0] + '</span><span>' + k[1] + '</span></li>'; }).join('') + '</ul>' +
  '<p class="label">Typing a task</p><ul class="keys">' + [
    ['fri 5pm', 'date and time'], ['!1 … !4', 'Matrix box'], ['/college', 'list'], ['#exam', 'tag'], ['~45m', 'how long it takes'],
    ['someday', 'park it in Someday'], ['every mon', 'repeat']
  ].map(function (k) { return '<li><span class="kbd">' + k[0] + '</span><span>' + k[1] + '</span></li>'; }).join('') + '</ul>' +
  '<div class="row"><button class="btn" data-action="close">Close</button></div>');
};

// Which sections show (tabs), from the profile.
function applySections() {
  const hidden = state.settings.hiddenTabs || [];
  document.querySelectorAll('.tab').forEach(function (b) { b.hidden = hidden.indexOf(b.dataset.view) !== -1; });
  if (hidden.indexOf(view) !== -1) showView('tasks');
}

// ---------- data ----------
function downloadFile(name, text, type) {
  const blob = new Blob([text], { type: type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
actions.pexport = function () {
  downloadFile('taskstack-backup-' + dayKey() + '.json', JSON.stringify(state), 'application/json');
  toast('Backup downloaded. Restore it from here on any device.');
};
actions.pcsv = function () {
  function cell(v) { v = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
  function date(t) { return t ? dayKey(t) : ''; }
  const rows = [['Title', 'List', 'Box', 'Date', 'Time', 'Deadline', 'Done', 'Done at', 'Estimate (min)', 'Focused (min)', 'Someday', 'Tags', 'Notes']];
  liveTasks().forEach(function (t) {
    rows.push([t.title, listOf(t).name, boxName(t.q), date(t.due), t.due !== null && t.hasTime ? fmtTime(t.due) : '', date(t.deadline),
      t.done ? 'yes' : 'no', t.doneAt ? new Date(t.doneAt).toISOString() : '', t.est || '', focusMinutes(t.id) || '', t.someday ? 'yes' : '', t.tags.join(' '), t.notes]);
  });
  downloadFile('taskstack-tasks-' + dayKey() + '.csv', rows.map(function (r) { return r.map(cell).join(','); }).join('\n'), 'text/csv');
  toast('Tasks downloaded as a CSV (opens in Excel or Google Sheets).');
};
actions.pimport = function () { $('importFile').click(); };
$('sheet').addEventListener('change', function (e) {
  if (e.target.id !== 'importFile' || !e.target.files.length) return;
  const reader = new FileReader();
  reader.onload = function () {
    try {
      const incoming = JSON.parse(reader.result);
      if (!incoming || !Array.isArray(incoming.tasks)) throw new Error('bad');
      snapshot('Restored backup');
      state = normalize(mergeState(state, normalize(incoming)));
      save();
      renderAll();
      refreshProfile();
      toast('Backup merged in. The newer edit of every item was kept.', { undo: true });
    } catch (err) { toast('That file isn\'t a TaskStack backup.'); }
  };
  reader.readAsText(e.target.files[0]);
});
$('sheet').addEventListener('keydown', function (e) {
  if (e.key === 'Enter' && e.target.id === 'profileName') { e.preventDefault(); saveProfileName(); e.target.blur(); toast('Name saved'); }
});
$('sheet').addEventListener('change', function (e) { if (e.target.id === 'profileName') saveProfileName(); });
