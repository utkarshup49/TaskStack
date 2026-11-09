/* =========================================================
   TaskStack core: helpers, saved data, undo, toasts, sounds,
   bottom sheets and the quick-add sentence parser.
   Every other file uses the functions defined here.
   ========================================================= */

const STORE_KEY = 'taskstack.v1';
const MIN = 60000;
const HOUR = 3600000;
const DAY = 86400000;
const QUADS = [
  { q: 1, name: 'Do now',   sub: 'Urgent · Important' },
  { q: 2, name: 'Schedule', sub: 'Not urgent · Important' },
  { q: 3, name: 'Delegate', sub: 'Urgent · Not important' },
  { q: 4, name: 'Drop',     sub: 'Not urgent · Not important' }
];
// Habit colours: picked so no two look alike, in light or dark mode.
const HABIT_COLORS = ['#16a34a', '#2563eb', '#db2777', '#ea580c', '#7c3aed', '#0891b2', '#ca8a04', '#475569'];

// Click handlers, by data-action name. Each file adds its own; main.js routes clicks here.
const actions = {};

// ---------- small helpers ----------
function $(id) { return document.getElementById(id); }
function now() { return Date.now(); }
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function esc(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function midnight(t) { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); }
function addDays(t, n) { const d = new Date(t); d.setDate(d.getDate() + n); return d.getTime(); }
function dayKey(date) {
  const d = date ? new Date(date) : new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function daysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return d; }
function fmtClock(ms) {
  const total = Math.ceil(ms / 1000);
  return String(Math.floor(total / 60)).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0');
}
function fmtTime(t) { return new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
function fmtDur(ms) {
  const m = Math.round(ms / MIN);
  const h = Math.floor(m / 60);
  return h ? h + 'h ' + String(m % 60).padStart(2, '0') + 'm' : m + 'm';
}
// "Today", "Tomorrow", "Fri", "6 Nov" (+ time when set)
function fmtDue(due, hasTime) {
  const diff = Math.round((midnight(due) - midnight(now())) / DAY);
  let label;
  if (diff === 0) label = 'Today';
  else if (diff === 1) label = 'Tomorrow';
  else if (diff === -1) label = 'Yesterday';
  else if (diff > 1 && diff < 7) label = new Date(due).toLocaleDateString([], { weekday: 'short' });
  else label = new Date(due).toLocaleDateString([], { day: 'numeric', month: 'short' });
  return hasTime ? label + ' ' + fmtTime(due) : label;
}
// The date a task shows up on: its planned date, or its deadline when it has no planned date.
function taskDate(t) { return t.due !== null && t.due !== undefined ? t.due : (t.deadline || null); }
// Tasks planned more than a week ahead are "scheduled": the Calendar shows them, but the Matrix hides
// them and the Tasks list folds them away until their week comes, so they can't be ticked by accident.
// (Only the planned date counts: a task with just a far deadline stays visible, since you work towards it.)
const SOON_DAYS = 6;
function isFarOff(t) { return !t.done && t.due !== null && t.due !== undefined && midnight(t.due) > addDays(midnight(now()), SOON_DAYS); }
function isOverdue(task) {
  const d = taskDate(task);
  if (d === null || task.done) return false;
  return (task.due !== null && task.hasTime) ? d < now() : midnight(d) < midnight(now());
}
// "Deadline today", "3 days left", "2 days late"
function fmtDeadline(dl) {
  const diff = Math.round((midnight(dl) - midnight(now())) / DAY);
  if (diff === 0) return 'Deadline today';
  if (diff === 1) return 'Deadline tomorrow';
  if (diff > 1) return diff + ' days left';
  return (-diff) + (diff === -1 ? ' day late' : ' days late');
}
// Dark or white text, whichever reads better on this colour (filled activity chips, ticked habit days).
function textOn(hex) {
  const h = hex.replace('#', '');
  const lin = [0, 2, 4].map(function (i) {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  const lum = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  return lum > 0.4 ? 'var(--text-on-light)' : 'var(--text-on-dark)';
}

// Box names can be renamed in the Matrix (saved in settings.quadNames, so they sync).
function quadName(q) { const c = state.settings.quadNames && state.settings.quadNames[q]; return (c && c.name) || QUADS[q - 1].name; }
function quadSub(q) { const c = state.settings.quadNames && state.settings.quadNames[q]; return c && typeof c.sub === 'string' ? c.sub : QUADS[q - 1].sub; }
function boxName(q) { return q ? quadName(q) : 'Not sorted'; }

// ---------- saved data ----------
// The 10 activities a new user starts with: things almost everyone does. Specific ones
// (College, Office, a project) are added by the user. Each already has its kind for Stats.
// bornAt = when it was made: while updatedAt still equals it, it's an untouched default
// (first sync drops those if the account already has its own activities).
function defaultCategories() {
  const t = now();
  return [
    { id: 'sleep', name: 'Sleep', color: '#6b6b6b', sleep: true, kind: 'sleep' },
    { id: 'work', name: 'Work / Study', color: '#16a34a', kind: 'productive', sub: 'study' },
    { id: 'essentials', name: 'Essentials', color: '#facc15', kind: 'selfcare' },
    { id: 'meals', name: 'Meals', color: '#92400e', kind: 'selfcare' },
    { id: 'workout', name: 'Workout', color: '#f97316', kind: 'workout' },
    { id: 'social', name: 'Social', color: '#ec4899', kind: 'social' },
    { id: 'leisure', name: 'Leisure', color: '#8b5cf6', kind: 'leisure' },
    { id: 'rest', name: 'Rest / Break', color: '#2563eb', kind: 'leisure' },
    { id: 'waste', name: 'Time waste', color: '#dc2626', kind: 'waste' },
    ONEOFF_CAT
  ].map(function (c) {
    c = Object.assign({}, c);
    c.updatedAt = t; c.bornAt = t; c.deleted = false;
    c.kind = c.kind || (c.oneoff ? 'other' : undefined);
    c.kindSure = true;
    return c;
  });
}
// ColorTracker's "One-off": one striped colour for things that don't happen often (an exam, a trip).
// Each block of it gets its own name, asked for when you paint it.
const ONEOFF_CAT = { id: 'oneoff', name: 'One-off', color: '#22d3ee', oneoff: true };

// Lists (life areas). Fixed ids + updatedAt 1, so two devices that both start with them don't
// make doubles, and any real edit (rename, recolour, delete) synced from another device wins.
const DEFAULT_LISTS = [
  { id: 'personal', name: 'Personal', color: '#ea580c' },
  { id: 'college', name: 'College', color: '#7c3aed' },
  { id: 'extra', name: 'Extracurricular', color: '#db2777' },
  { id: 'projects', name: 'Projects', color: '#0891b2' },
  { id: 'growth', name: 'Self-growth', color: '#16a34a' }
];
function defaultLists() {
  return DEFAULT_LISTS.map(function (l, i) { return Object.assign({}, l, { order: i, updatedAt: 1, deleted: false }); });
}
// Settings added after the first version. normalize() fills in any that an older copy doesn't have.
const SETTING_DEFAULTS = {
  dailyGoal: 5,          // tasks a day (profile ring + streak)
  workHours: 6,          // hours you can really plan into a day (Plan my day warns past this)
  remindDefault: 0,      // new tasks with a time get a reminder this many minutes before (-1 = none)
  remindHour: 9,         // reminders for tasks with a date but no time fire at this hour
  defaultList: 'personal',
  profileName: '',
  hiddenTabs: [],        // sections switched off in the profile
  nudges: false,         // morning "plan your day" / evening "wrap up" notifications
  // ColorTracker stats (v0.10)
  sleepNeed: 7.5,        // hours a night (sleep debt, scores)
  ctNudge: 0,            // remind to log after this many hours with nothing logged (0 = off)
  ctGoals: [],           // { id, target (kind), op 'min'|'max', mins, per 'day'|'week' }
  ctBedBy: 0,            // "in bed by" goal, minutes after midnight of the evening before (1500 = 1 am); 0 = none
  ctIdeal: null,         // { blocks: [{ s, e, cat }] (minutes from midnight), from: dayKey }
  ctChallenges: [],      // { id, type, start: dayKey }
  ctBadges: [],          // { type, won: dayKey }
  dayTemplates: [],      // { id, name, blocks: [{ s, e, cat }] }
  ctKindsReviewed: false,
  // Calendar (v0.11)
  calWeekStart: 1,       // first day of the week in the Calendar: 1 = Monday, 0 = Sunday
  calWeekNums: false,    // week numbers down the side
  calFrom: 0,            // hours shown in Day / 3 days / Week: from ... to
  calTo: 24,
  calShowDone: true,     // completed tasks, greyed out
  calRepeats: true,      // faded future dates of repeating tasks
  calCt: true,           // ColorTracker strip on past days
  calHabits: true        // habit ticks on each day
};

function newTask(title, q, extra) {
  const t = now();
  return Object.assign({
    id: uid(), title: title, q: q || null, done: false, doneAt: null, due: null, hasTime: false, deadline: null,
    notes: '', subtasks: [], tags: [], createdAt: t, updatedAt: t, deleted: false,
    listId: typeof defaultListId === 'function' ? defaultListId() : 'personal',
    reminders: [], someday: false, evening: false, est: null, top: null
  }, extra || {});
}

function exampleState() {
  const t = now();
  function task(title, q, extra) { return newTask(title, q, Object.assign({ example: true }, extra || {})); }
  function habit(name, color, doneDaysAgo) {
    const h = { id: uid(), name: name, color: color, done: {}, createdAt: addDays(t, -20), updatedAt: t, deleted: false, example: true };
    doneDaysAgo.forEach(function (n) { h.done[dayKey(daysAgo(n))] = { on: true, at: t }; });
    return h;
  }
  return {
    version: 2,
    tasks: [
      task('Submit lab record', 1, { due: midnight(t), listId: 'college' }),
      task('Revise for tomorrow\'s quiz', 1, { listId: 'college', est: 60, subtasks: [{ id: uid(), title: 'Unit 3 notes', done: true }, { id: uid(), title: 'Past paper', done: false }] }),
      task('Build habit tracker screen', 2, { listId: 'projects', est: 90 }),
      task('Plan next week', 2, { due: addDays(midnight(t), 3), listId: 'growth' }),
      task('Mini project report', 2, { deadline: addDays(midnight(t), 6), listId: 'college' }),
      task('Buy notebook', null, { due: addDays(midnight(t), 1) }),
      task('Read one research paper', 2, { done: true, doneAt: t, listId: 'growth' }),
      task('Reply to group chat', 3, { listId: 'extra' }),
      task('Book train tickets', 3),
      task('Reorganise desktop icons', 4),
      task('Learn to play the guitar', null, { someday: true, listId: 'growth' })
    ],
    habits: [
      habit('Workout 30 min', HABIT_COLORS[3], [1, 2, 3, 5, 6, 8, 9, 10, 12]),
      habit('Read 10 pages', HABIT_COLORS[1], [0, 1, 2, 3, 4, 6, 7, 8, 9, 11, 13]),
      habit('No phone after 11 pm', HABIT_COLORS[4], [2, 3, 7])
    ],
    sessions: [],
    settings: Object.assign({ focus: 25, short: 5, long: 15, quadNames: {}, offDays: [0, 6], napHours: 3.5, updatedAt: t }, JSON.parse(JSON.stringify(SETTING_DEFAULTS))),
    timer: { mode: 'focus', running: false, endsAt: 0, remaining: 25 * MIN, taskId: null, count: 0, intent: '', distractions: 0 },
    categories: defaultCategories(),
    ranges: [],
    lists: defaultLists(),
    days: [],          // one entry per day (id "2026-11-06") or week (id "w2026-11-02"): plan / wrap-up notes
    countdowns: [],    // { id, title, date }
    templates: [],     // { id, name, task: { title, q, listId, est, tags, notes, subtasks } }
    periods: [],       // ColorTracker periods to compare: { id, name, start: "YYYY-MM-DD", end }
    ui: { ctView: 'sleep', sound: true, haptics: true, ambient: 'off', showDone: {}, listQ: null, listFilter: [], dismissed: {} }
  };
}

// Fill in anything an older saved copy doesn't have yet.
function normalize(s) {
  const base = exampleState();
  s.tasks = Array.isArray(s.tasks) ? s.tasks : [];
  s.habits = Array.isArray(s.habits) ? s.habits : [];
  s.sessions = Array.isArray(s.sessions) ? s.sessions : [];
  s.settings = s.settings || base.settings;
  if (!s.settings.quadNames || typeof s.settings.quadNames !== 'object') s.settings.quadNames = {};
  if (!Array.isArray(s.settings.offDays)) s.settings.offDays = [0, 6];
  if (!(s.settings.napHours >= 0.5 && s.settings.napHours <= 6)) s.settings.napHours = 3.5;   // ColorTracker: shorter sleeps are naps
  for (const k in SETTING_DEFAULTS) {
    if (s.settings[k] === undefined || s.settings[k] === null) s.settings[k] = JSON.parse(JSON.stringify(SETTING_DEFAULTS[k]));
  }
  if (!Array.isArray(s.settings.hiddenTabs)) s.settings.hiddenTabs = [];
  s.timer = Object.assign({}, base.timer, s.timer || {});
  // Lists: older data has none, so it gets the defaults. Keep at least one list alive.
  s.lists = Array.isArray(s.lists) ? s.lists : defaultLists();
  if (!s.lists.some(function (l) { return !l.deleted; })) {
    const p = s.lists.find(function (l) { return l.id === 'personal'; });
    if (p) { p.deleted = false; p.updatedAt = now(); } else s.lists.push(Object.assign(defaultLists()[0], { updatedAt: now() }));
  }
  s.days = Array.isArray(s.days) ? s.days : [];
  s.countdowns = Array.isArray(s.countdowns) ? s.countdowns : [];
  s.templates = Array.isArray(s.templates) ? s.templates : [];
  s.periods = Array.isArray(s.periods) ? s.periods : [];
  ['ctGoals', 'ctChallenges', 'ctBadges', 'dayTemplates'].forEach(function (k) { if (!Array.isArray(s.settings[k])) s.settings[k] = []; });
  s.categories = (Array.isArray(s.categories) && s.categories.length) ? s.categories : base.categories;
  // Older data has no One-off activity: add it. updatedAt 1 so any real edit synced from another device wins.
  if (!s.categories.some(function (c) { return c.id === ONEOFF_CAT.id; })) s.categories.push(Object.assign({}, ONEOFF_CAT, { updatedAt: 1, deleted: false }));
  s.ranges = Array.isArray(s.ranges) ? s.ranges : [];
  s.ui = Object.assign({}, base.ui, s.ui || {});
  s.tasks.forEach(function (x) {
    if (!Array.isArray(x.subtasks)) x.subtasks = [];
    if (!Array.isArray(x.tags)) x.tags = [];
    if (typeof x.notes !== 'string') x.notes = '';
    if (x.due === undefined) x.due = null;
    if (x.deadline === undefined) x.deadline = null;
    if (!x.q) x.q = null;
    if (x.repeat === undefined) x.repeat = null;
    if (!x.listId) x.listId = 'personal';
    if (!Array.isArray(x.reminders)) x.reminders = [];
    if (typeof x.someday !== 'boolean') x.someday = false;
    if (typeof x.evening !== 'boolean') x.evening = false;
    if (x.est === undefined) x.est = null;
    if (x.top === undefined) x.top = null;
    if (x.endDate === undefined) x.endDate = null;   // last day of a multi-day task (midnight), or null
  });
  if (!s.ui.listFilter || !Array.isArray(s.ui.listFilter)) s.ui.listFilter = [];
  if (!s.ui.dismissed || typeof s.ui.dismissed !== 'object') s.ui.dismissed = {};
  s.habits.forEach(function (h, i) { if (!h.color) h.color = HABIT_COLORS[i % HABIT_COLORS.length]; if (!h.done) h.done = {}; });
  s.version = 2;
  return s;
}

let storageOk = true;
function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return normalize(JSON.parse(raw));
  } catch (e) { storageOk = false; }
  return exampleState();
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
  catch (e) { storageOk = false; const n = $('storeNote'); if (n) n.hidden = false; }
  if (typeof syncSoon === 'function') syncSoon();   // sync.js: push the change to Google Drive shortly
}

let state = load();

function liveTasks() { return state.tasks.filter(function (t) { return !t.deleted; }); }
function liveHabits() { return state.habits.filter(function (h) { return !h.deleted; }); }
function liveSessions() { return state.sessions.filter(function (s) { return !s.deleted; }); }
function findTask(id) { return state.tasks.find(function (t) { return t.id === id; }); }
function findHabit(id) { return state.habits.find(function (h) { return h.id === id; }); }

// ---------- merging two copies (Import backup, and Google Drive sync in sync.js) ----------
// For every item the copy with the newer updatedAt wins. Deletes are kept as deleted:true.
function mergeById(local, incoming) {
  const map = {};
  local.forEach(function (x) { map[x.id] = x; });
  incoming.forEach(function (x) {
    const mine = map[x.id];
    if (!mine || (x.updatedAt || 0) > (mine.updatedAt || 0)) map[x.id] = x;
  });
  return Object.values(map);
}
function mergeHabits(local, incoming) {
  const result = mergeById(local, incoming);
  result.forEach(function (h) {
    const a = local.find(function (x) { return x.id === h.id; });
    const b = incoming.find(function (x) { return x.id === h.id; });
    if (a && b) {                       // merge ticks day by day so both devices' ticks survive
      const done = {};
      [a.done || {}, b.done || {}].forEach(function (m) {
        for (const k in m) { if (!done[k] || m[k].at > done[k].at) done[k] = m[k]; }
      });
      h.done = done;
    }
  });
  return result;
}
function mergeState(local, incoming) {
  return {
    version: 2,
    tasks: mergeById(local.tasks, incoming.tasks || []),
    habits: mergeHabits(local.habits, incoming.habits || []),
    sessions: mergeById(local.sessions, incoming.sessions || []),
    settings: (incoming.settings && incoming.settings.updatedAt > local.settings.updatedAt) ? incoming.settings : local.settings,
    timer: local.timer,               // the running timer belongs to this device
    categories: mergeById(local.categories, incoming.categories || []),
    ranges: mergeById(local.ranges, incoming.ranges || []),
    lists: mergeById(local.lists || [], incoming.lists || []),
    days: mergeById(local.days || [], incoming.days || []),
    countdowns: mergeById(local.countdowns || [], incoming.countdowns || []),
    templates: mergeById(local.templates || [], incoming.templates || []),
    periods: mergeById(local.periods || [], incoming.periods || []),
    ui: local.ui                      // view choices belong to this device
  };
}

// ---------- undo (one stack for the whole app) ----------
const UNDO_KEYS = ['tasks', 'habits', 'sessions', 'ranges', 'categories', 'lists', 'days', 'countdowns', 'templates', 'periods'];
const undoStack = [];
function snapshot(label) {
  const snap = { label: label };
  UNDO_KEYS.forEach(function (k) { snap[k] = JSON.stringify(state[k]); });
  undoStack.push(snap);
  if (undoStack.length > 40) undoStack.shift();
}
function undo() {
  const snap = undoStack.pop();
  hideToast();
  if (!snap) { toast('Nothing to undo'); return; }
  const t = now();
  UNDO_KEYS.forEach(function (k) {
    const current = JSON.stringify(state[k]);
    if (snap[k] === current) return;
    const old = JSON.parse(snap[k]);
    const curById = {};
    state[k].forEach(function (x) { curById[x.id] = x; });
    const ids = {};
    old.forEach(function (x) {
      ids[x.id] = true;
      const c = curById[x.id];
      if (!c || JSON.stringify(c) !== JSON.stringify(x)) x.updatedAt = t;   // so sync sees the undo as the newest edit
    });
    state[k].forEach(function (x) { if (!ids[x.id]) old.push(Object.assign({}, x, { deleted: true, updatedAt: t })); });
    state[k] = old;
  });
  save();
  renderAll();
  toast('Undone: ' + snap.label);
}

// ---------- toast ----------
let toastTimer = 0;
function toast(msg, opts) {
  opts = opts || {};
  const el = $('toast');
  el.innerHTML = '<span>' + esc(msg) + '</span>' + (opts.undo ? '<button data-action="undo">Undo</button>' : '');
  el.classList.toggle('no-action', !opts.undo);
  el.hidden = false;
  el.style.animation = 'none';
  void el.offsetHeight;                // restart the slide-in animation
  el.style.animation = '';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, opts.undo ? 5000 : 2600);
}
function hideToast() { clearTimeout(toastTimer); const el = $('toast'); if (el) el.hidden = true; }

// ---------- sound + vibration ----------
let audioCtx = null;
function audio() {
  try {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      audioCtx = new AC();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  } catch (e) { return null; }
}
function tone(freq, at, dur, vol, type) {
  const ac = audioCtx;
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = type || 'sine';
  o.frequency.setValueAtTime(freq, at);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(vol, at + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g);
  g.connect(ac.destination);
  o.start(at);
  o.stop(at + dur + 0.03);
}
function sound(kind) {
  if (!state.ui.sound) return;
  const ac = audio();
  if (!ac) return;
  try {
    const t0 = ac.currentTime + 0.01;
    if (kind === 'tick') { tone(1046.5, t0, 0.09, 0.12); tone(1568, t0 + 0.07, 0.16, 0.1); }
    else if (kind === 'pop') { tone(784, t0, 0.07, 0.11, 'triangle'); tone(1175, t0 + 0.05, 0.12, 0.09, 'triangle'); }
    else if (kind === 'chime') { [659, 880, 988, 1319].forEach(function (f, i) { tone(f, t0 + i * 0.18, 0.5, 0.16); }); }
    else if (kind === 'delete') { tone(392, t0, 0.08, 0.08, 'triangle'); tone(262, t0 + 0.06, 0.12, 0.07, 'triangle'); }
    else if (kind === 'soft') { tone(523, t0, 0.06, 0.06); }
    else if (kind === 'milestone') { [523, 659, 784, 1047].forEach(function (f, i) { tone(f, t0 + i * 0.09, 0.3, 0.12); }); }
  } catch (e) {}
}
function haptic(pattern) {
  if (!state.ui.haptics) return;
  try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) {}
}

// ---------- bottom sheet ----------
// Opening a sheet adds a history step, so the phone's back button / back swipe closes it.
// On touch screens you can also drag the sheet down to close it.
let sheetCtx = null;
let sheetTimer = 0;
let ignorePop = 0;
function openSheet(ctx, html) {
  const wasOpen = !!sheetCtx;
  sheetCtx = ctx;
  clearTimeout(sheetTimer);
  const sheetEl = $('sheet');
  sheetEl.innerHTML = html;
  sheetEl.scrollTop = 0;
  sheetEl.style.transform = '';
  sheetEl.style.transition = '';
  const w = $('sheetWrap');
  w.hidden = false;
  if (!wasOpen) { try { history.pushState({ overlay: 'sheet' }, ''); } catch (e) {} }
  requestAnimationFrame(function () { requestAnimationFrame(function () { w.classList.add('open'); }); });
}
function refreshSheet(html) {
  const y = $('sheet').scrollTop;
  $('sheet').innerHTML = html;
  $('sheet').scrollTop = y;
}
function closeSheet(fromHistory) {
  if (!sheetCtx) return;
  const ctx = sheetCtx;
  sheetCtx = null;
  const w = $('sheetWrap');
  const sheetEl = $('sheet');
  sheetEl.style.transition = '';
  sheetEl.style.transform = '';
  w.querySelector('.scrim').style.opacity = '';
  w.classList.remove('open');
  sheetTimer = setTimeout(function () { w.hidden = true; sheetEl.innerHTML = ''; }, 330);
  if (fromHistory !== true && history.state && history.state.overlay === 'sheet') { ignorePop++; history.back(); }
  if (ctx.onClose) ctx.onClose();
}
window.addEventListener('popstate', function () {
  if (ignorePop) { ignorePop--; return; }
  if (typeof closePalette === 'function' && !$('paletteWrap').hidden) { closePalette(true); return; }
  if (sheetCtx) closeSheet(true);
});
(function sheetSwipe() {
  const sheetEl = $('sheet');
  let sd = null;
  sheetEl.addEventListener('touchstart', function (e) {
    if (e.touches.length !== 1) return;
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    sd = { y0: e.touches[0].clientY, dy: 0, t0: Date.now(), active: false, top: sheetEl.scrollTop <= 0 };
  }, { passive: true });
  sheetEl.addEventListener('touchmove', function (e) {
    if (!sd) return;
    sd.dy = e.touches[0].clientY - sd.y0;
    if (!sd.active) {
      if (sd.top && sd.dy > 8) sd.active = true;
      else if (Math.abs(sd.dy) > 8) { sd = null; return; }
      else return;
    }
    if (e.cancelable) e.preventDefault();
    const dy = Math.max(0, sd.dy);
    sheetEl.style.transition = 'none';
    sheetEl.style.transform = 'translateY(' + dy + 'px)';
    $('sheetWrap').querySelector('.scrim').style.opacity = String(Math.max(0.2, 1 - dy / 500));
  }, { passive: false });
  sheetEl.addEventListener('touchend', function () {
    if (!sd) return;
    const d = sd;
    sd = null;
    if (!d.active) return;
    const speed = d.dy / Math.max(1, Date.now() - d.t0);
    if (d.dy > 110 || speed > 0.6) { closeSheet(); return; }
    sheetEl.style.transition = '';
    sheetEl.style.transform = '';
    $('sheetWrap').querySelector('.scrim').style.opacity = '';
  });
})();

// ---------- "which box?" menu ----------
let boxMenuTask = null;
function openBoxMenu(taskId, anchor) {
  const t = findTask(taskId);
  if (!t) return;
  boxMenuTask = taskId;
  const m = $('boxMenu');
  m.innerHTML = '<p class="small">Put in a box</p>' + QUADS.map(function (q) {
    return '<button class="q' + q.q + (t.q === q.q ? ' on' : '') + '" data-action="setbox" data-q="' + q.q + '"><span><b>' + esc(quadName(q.q)) + '</b><small>' + esc(quadSub(q.q)) + '</small></span></button>';
  }).join('') + '<button class="q0' + (!t.q ? ' on' : '') + '" data-action="setbox" data-q="0"><span><b>Not sorted</b></span></button>';
  m.hidden = false;
  const r = anchor.getBoundingClientRect();
  const mw = m.offsetWidth, mh = m.offsetHeight;
  let left = Math.min(window.innerWidth - mw - 12, Math.max(12, r.right - mw));
  let top = r.bottom + 6;
  if (top + mh > window.innerHeight - 12) top = Math.max(12, r.top - mh - 6);
  m.style.left = left + 'px';
  m.style.top = top + 'px';
  haptic(10);
}
function closeBoxMenu() { boxMenuTask = null; $('boxMenu').hidden = true; }
document.addEventListener('pointerdown', function (e) { if (boxMenuTask && !e.target.closest('#boxMenu') && !e.target.closest('[data-action="boxmenu"]')) closeBoxMenu(); });

// ---------- quick add: "Submit report fri 5pm !1 #college" ----------
const WEEKDAY_NAMES = { sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2, wednesday: 3, wed: 3, thursday: 4, thu: 4, thur: 4, thurs: 4, friday: 5, fri: 5, saturday: 6, sat: 6 };
const MONTH_NAMES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function parseQuickAdd(text) {
  let s = ' ' + text + ' ';
  const out = { title: '', q: null, tags: [], date: null, time: null, tonight: false, repeat: null, listId: null, est: null, someday: false };
  // repeat words first ("every mon", "every 4 days after completion"), so the date rules below don't read "mon" as a date
  const rp = typeof parseRepeat === 'function' ? parseRepeat(s) : null;
  if (rp) { s = rp.s; out.repeat = rp.rule; }
  const today = midnight(now());

  // !1 to !4 = quadrant
  s = s.replace(/\s!([1-4])(?=\s)/, function (m, n) { out.q = Number(n); return ' '; });
  // #tags
  s = s.replace(/\s#([A-Za-z0-9_\-]+)(?=\s)/g, function (m, tag) { out.tags.push(tag.toLowerCase()); return ' '; });
  // /college = which list (matched by the start of a list's name; an unknown word stays in the title)
  s = s.replace(/\s\/([A-Za-z][A-Za-z0-9_\-]*)(?=\s)/, function (m, word) {
    const l = typeof listByToken === 'function' ? listByToken(word) : null;
    if (!l) return m;
    out.listId = l.id;
    return ' ';
  });
  // ~30m, ~1h, ~1.5h, ~1h30m, ~45 = how long you think it takes
  s = s.replace(/\s~(\d+(?:\.\d+)?)\s?(h|hr|hrs|m|min|mins)?(?:(\d+)\s?m(?:in)?)?(?=\s)/i, function (m, n, unit, extra) {
    let mins = /^h/i.test(unit || '') ? Number(n) * 60 + Number(extra || 0) : Number(n);
    mins = Math.round(mins);
    if (!(mins >= 1 && mins <= 24 * 60)) return m;
    out.est = mins;
    return ' ';
  });
  // "someday": no date, kept out of Today and the Matrix until you pick it up
  s = s.replace(/\s(someday|some day)(?=\s)/i, function () { out.someday = true; return ' '; });
  // time: 5pm, 5:30 pm, 17:30
  s = s.replace(/\s(?:at\s)?(\d{1,2})(?::(\d{2}))?\s?(am|pm)(?=\s)/i, function (m, h, mm, ap) {
    let hour = Number(h) % 12;
    if (ap.toLowerCase() === 'pm') hour += 12;
    if (Number(h) > 12 || Number(mm || 0) > 59) return m;
    out.time = hour * 60 + Number(mm || 0);
    return ' ';
  });
  if (out.time === null) {
    s = s.replace(/\s(?:at\s)?([01]?\d|2[0-3]):([0-5]\d)(?=\s)/, function (m, h, mm) { out.time = Number(h) * 60 + Number(mm); return ' '; });
  }
  // dates
  function setDate(d) { if (out.date === null) out.date = d; }
  s = s.replace(/\s(day after tomorrow)(?=\s)/i, function () { setDate(addDays(today, 2)); return ' '; });
  s = s.replace(/\s(today|tod)(?=\s)/i, function () { setDate(today); return ' '; });
  s = s.replace(/\s(tonight)(?=\s)/i, function () { setDate(today); out.tonight = true; return ' '; });
  s = s.replace(/\s(tomorrow|tmrw|tmr)(?=\s)/i, function () { setDate(addDays(today, 1)); return ' '; });
  s = s.replace(/\s(next week)(?=\s)/i, function () {
    const d = new Date(today); const add = ((8 - d.getDay()) % 7) || 7;
    setDate(addDays(today, add)); return ' ';
  });
  s = s.replace(/\sin\s(\d{1,3})\s?(days?|d|weeks?|w)(?=\s)/i, function (m, n, unit) {
    setDate(addDays(today, Number(n) * (/^w/i.test(unit) ? 7 : 1))); return ' ';
  });
  // weekday names; a short one as the very first word is kept as text ("SAT prep")
  s = s.replace(/\s(?:(on|next|this|by)\s)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tues|tue|wed|thurs|thur|thu|fri|sat|sun)(?=\s)/i, function (m, pre, name, offset) {
    name = name.toLowerCase();
    if (!pre && offset === 0 && !/day$/.test(name)) return m;   // "SAT prep": a short name as the first word is part of the title
    const want = WEEKDAY_NAMES[name];
    let add = (want - new Date(today).getDay() + 7) % 7;
    if (pre && pre.toLowerCase() === 'next' && add === 0) add = 7;
    setDate(addDays(today, add));
    return ' ';
  });
  // 5/11, 5-11-2026 (day first)
  s = s.replace(/\s(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?(?=\s)/, function (m, d, mo, y) {
    const day = Number(d), month = Number(mo) - 1;
    if (month < 0 || month > 11 || day < 1 || day > 31) return m;
    let year = y ? Number(y.length === 2 ? '20' + y : y) : new Date(today).getFullYear();
    let dt = new Date(year, month, day).getTime();
    if (!y && dt < today) dt = new Date(year + 1, month, day).getTime();
    setDate(dt);
    return ' ';
  });
  // 5 nov, nov 5, 5th november
  const monthRe = '(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*';
  function monthDate(day, mon) {
    const month = MONTH_NAMES.indexOf(mon.slice(0, 3).toLowerCase());
    let dt = new Date(new Date(today).getFullYear(), month, day).getTime();
    if (dt < today) dt = new Date(new Date(today).getFullYear() + 1, month, day).getTime();
    return dt;
  }
  s = s.replace(new RegExp('\\s(\\d{1,2})(?:st|nd|rd|th)?\\s' + monthRe + '(?=\\s)', 'i'), function (m, d, mon) { setDate(monthDate(Number(d), mon)); return ' '; });
  s = s.replace(new RegExp('\\s' + monthRe + '\\s(\\d{1,2})(?:st|nd|rd|th)?(?=\\s)', 'i'), function (m, mon, d) { setDate(monthDate(Number(d), mon)); return ' '; });

  out.title = s.replace(/\s+/g, ' ').trim();
  if (out.date === null && out.time !== null) out.date = today;
  if (out.tonight && out.time === null) out.time = 20 * 60;
  out.due = out.date === null ? null : out.date + (out.time || 0) * MIN;
  out.hasTime = out.time !== null;
  return out;
}

function quickAddChips(p) {
  const chips = [];
  if (p.due !== null) chips.push(fmtDue(p.due, p.hasTime));
  if (p.repeat) chips.push('↻ ' + repeatLabel(rpNorm(p.repeat, p.due !== null ? p.due : midnight(now()))));
  if (p.q) chips.push(quadName(p.q));
  if (p.listId && typeof findList === 'function' && findList(p.listId)) chips.push('List: ' + findList(p.listId).name);
  if (p.est) chips.push('~' + fmtEst(p.est));
  if (p.someday) chips.push('Someday');
  p.tags.forEach(function (t) { chips.push('#' + t); });
  return chips;
}
// 45 -> "45m", 90 -> "1h 30m", 120 -> "2h"
function fmtEst(mins) {
  const h = Math.floor(mins / 60), m = mins % 60;
  return h ? h + 'h' + (m ? ' ' + m + 'm' : '') : m + 'm';
}

// Everything the quick-add sentence can set beyond title/date/box, applied to a brand-new task:
// its list, estimate, Someday, and the default reminder for tasks with a time.
function finishNewTask(task, p) {
  if (p && p.listId) task.listId = p.listId;
  if (p && p.est) task.est = p.est;
  if (p && p.someday) { task.someday = true; task.due = null; task.hasTime = false; }
  const def = state.settings.remindDefault;
  if (task.due !== null && task.hasTime && def >= 0 && !task.reminders.length) {
    task.reminders.push({ id: uid(), type: 'due', mins: def });
  }
  return task;
}
