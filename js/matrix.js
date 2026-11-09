/* =========================================================
   Matrix: the four Eisenhower boxes, plus the task pieces every
   view shares (row design, tick, swipe, hold-to-drag, details sheet).
   - tick animation + sound + vibration
   - swipe right = done, swipe left = delete (with Undo)
   - hold a task, then drag it into another box
   - a + on each box opens an add pop-up (title, box, date, time, deadline)
   - each box can be renamed from its ... button
   ========================================================= */

const TRASH_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/></svg>';
const TICK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const CHECK_SVG = '<svg viewBox="0 0 22 22" aria-hidden="true"><path d="M6.5 11.5l3 3 6-6.5"/></svg>';
const CAL_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>';
const LIST_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7l2 2 3-3M4 15l2 2 3-3M12 8h8M12 16h8"/></svg>';
const CHEVRON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>';
const FLAG_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 21V4M5 4h11l-2 4 2 4H5"/></svg>';
const PLUS_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
const DOTS_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>';
const CLOCK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
const STAR_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.8l2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.2l-5.6 3 1.1-6.3L2.9 9.5l6.3-.9z"/></svg>';
const EST_CHOICES = [15, 30, 45, 60, 90, 120, 180];

// Minutes of Focus sessions spent on a task (its "actual" next to the estimate).
function focusMinutes(taskId) {
  let m = 0;
  liveSessions().forEach(function (s) { if (s.taskId === taskId) m += s.minutes; });
  return m;
}
// One of today's top 3 (picked in Plan my day or the task sheet).
function isTop(t) { return t.top === dayKey(); }
const ROMAN = ['I', 'II', 'III', 'IV'];
const EMPTY_TEXT = { 1: 'Nothing urgent. Nice.', 2: 'Plan something that matters.', 3: 'Nothing to hand off.', 4: 'Nothing to drop.' };

function shortTitle(s) { return s.length > 28 ? s.slice(0, 27) + '…' : s; }

// ---------- adding a task: the + on each box (and the Calendar) opens this pop-up ----------
let addQ = 1;          // the box the last task was added to (the N key reuses it)
let addDraft = null;   // what's picked in the pop-up: { q (null = not sorted), date (midnight ms or null), time ('HH:MM' or ''), deadline (ms or null) }

function addSheetHTML() {
  const d = addDraft;
  const today = midnight(now());
  function pick(action, n, label, current) {
    const val = n === 'none' ? null : addDays(today, n);
    return '<button type="button" class="pick' + (current === val ? ' on' : '') + '" data-action="' + action + '" data-d="' + n + '">' + label + '</button>';
  }
  return '<h3 class="add-title q' + (d.q || 0) + '"><i></i>' + (d.q ? 'Add to ' + esc(quadName(d.q)) : 'Add a task') + '</h3>' +
    '<form id="addSheetForm" class="add" autocomplete="off"><div class="add-row">' +
      '<input id="addTitle" placeholder="What needs doing?" aria-label="Task name" enterkeyhint="done">' +
      '<button class="btn primary" type="submit">Add</button></div>' +
      '<div class="parse" id="addParse" aria-live="polite"></div></form>' +
    (typeof templateRowHTML === 'function' ? templateRowHTML() : '') +
    '<p class="label">List</p>' + listPickHTML(d.listId, 'alist') +
    '<p class="label">Box</p><div class="qmove">' + QUADS.map(function (q) {
      return '<button type="button" class="q' + q.q + (d.q === q.q ? ' on' : '') + '" data-action="aq" data-q="' + q.q + '">' + esc(quadName(q.q)) + '</button>';
    }).join('') + '<button type="button" class="q0 wide' + (!d.q ? ' on' : '') + '" data-action="aq" data-q="0">Not sorted</button></div>' +
    '<p class="label">Date' + (d.date === null && !d.time ? ' · none, so it shows in Today' : '') + '</p>' +
    '<div class="daterow">' + pick('adate', 'none', 'No date', d.date) + pick('adate', 0, 'Today', d.date) + pick('adate', 1, 'Tomorrow', d.date) + pick('adate', 7, 'Next week', d.date) + '</div>' +
    '<div class="daterow"><input type="date" id="addDate" value="' + (d.date !== null ? dayKey(d.date) : '') + '" aria-label="Date"><input type="time" id="addTime" value="' + d.time + '" aria-label="Time"></div>' +
    (d.est ? '<p class="small">Blocked for ' + fmtEst(d.est) + ' (picked in the Calendar).</p>' : '') +
    '<p class="label">Deadline</p>' +
    '<div class="daterow">' + pick('adl', 'none', 'None', d.deadline) + pick('adl', 3, 'In 3 days', d.deadline) + pick('adl', 7, 'In a week', d.deadline) +
      '<input type="date" id="addDeadline" value="' + (d.deadline ? dayKey(d.deadline) : '') + '" aria-label="Deadline"></div>' +
    '<p class="label">Repeat</p>' + repeatEditorHTML(d.repeat ? rpNorm(d.repeat, d.date !== null ? d.date : midnight(now())) : null) +
    '<p class="small">Tip: you can also type it, e.g. <b>tomorrow 5pm /college ~45m</b> or <b>every 4 days after completion</b>.</p>' +
    '<p class="status" id="addStatus" role="status"></p>' +
    '<div class="row"><button class="btn" data-action="addmore">All options (reminders, steps, notes…)</button><button class="btn" data-action="close">Done</button></div>';
}
// q: the box (null = not sorted). preset: { date, time } when opened from the Calendar.
function openAddSheet(q, preset) {
  preset = preset || {};
  if (q) addQ = q;
  addDraft = { q: q || null, date: preset.date !== undefined ? preset.date : null, time: preset.time || '', deadline: null, repeat: null, listId: defaultListId(), est: preset.est || null };
  openSheet({ type: 'add' }, addSheetHTML());
  setTimeout(function () { if ($('addTitle')) $('addTitle').focus(); }, 60);
}
// Redraw the pop-up after a pick, keeping what's typed.
function refreshAddSheet() {
  const typed = $('addTitle') ? $('addTitle').value : '';
  const status = $('addStatus') ? $('addStatus').textContent : '';
  refreshSheet(addSheetHTML());
  $('addTitle').value = typed;
  $('addStatus').textContent = status;
  renderAddParse();
}
function renderAddParse() {
  const text = $('addTitle').value;
  const chips = text.trim() ? quickAddChips(parseQuickAdd(text)) : [];
  $('addParse').innerHTML = chips.map(function (c) { return '<span class="chip">' + esc(c) + '</span>'; }).join('');
}
// Add it, then keep the pop-up open for the next one (dates stay picked).
function addFromSheet() {
  const input = $('addTitle');
  const raw = input.value.trim();
  if (!raw) { input.focus(); return; }
  const d = addDraft;
  const p = parseQuickAdd(raw);
  let due = null, hasTime = false;
  if (p.due !== null) { due = p.due; hasTime = p.hasTime; }                 // typed words win over the pickers
  else if (d.date !== null || d.time) {
    const mins = d.time ? Number(d.time.slice(0, 2)) * 60 + Number(d.time.slice(3, 5)) : 0;
    due = (d.date !== null ? d.date : midnight(now())) + mins * MIN;
    hasTime = !!d.time;
  }
  const task = newTask(p.title || raw, p.q || d.q, { due: due, hasTime: hasTime, deadline: d.deadline, tags: p.tags, listId: d.listId || defaultListId() });
  const rule = p.repeat || d.repeat;
  if (rule) setupRepeat(task, rule);
  finishNewTask(task, p);
  if (!task.est && d.est) task.est = d.est;          // a time range picked in the Calendar
  snapshot('Added task');
  state.tasks.push(task);
  save();
  renderTaskViews();
  sound('soft');
  input.value = '';
  renderAddParse();
  $('addStatus').textContent = 'Added "' + shortTitle(task.title) + '" to ' + listOf(task).name + ' · ' + boxName(task.q) + (task.due !== null ? ', ' + fmtDue(task.due, task.hasTime) : '') + '. Add another, or press Done.';
  if (task.repeat) $('addStatus').innerHTML = esc($('addStatus').textContent) + '<span class="rp-explain">' + describeRepeat(task.repeat, task.due) + '</span>';
  const li = document.querySelector('#matrixGrid .task[data-id="' + task.id + '"]');
  if (li) {
    li.scrollIntoView({ block: 'nearest' });
    if (li.animate) li.animate([{ transform: 'scale(0.92)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 260, easing: 'cubic-bezier(0.34,1.56,0.64,1)' });
  }
  input.focus();
}
$('sheet').addEventListener('submit', function (e) {
  if (e.target.id !== 'addSheetForm') return;
  e.preventDefault();
  addFromSheet();
});
$('sheet').addEventListener('input', function (e) { if (e.target.id === 'addTitle') renderAddParse(); });
$('sheet').addEventListener('change', function (e) {
  if (!sheetCtx || sheetCtx.type !== 'add') return;
  const el = e.target;
  if (el.id === 'addDate') addDraft.date = el.value ? new Date(el.value + 'T00:00').getTime() : null;
  else if (el.id === 'addTime') addDraft.time = el.value;
  else if (el.id === 'addDeadline') addDraft.deadline = el.value ? new Date(el.value + 'T00:00').getTime() : null;
  else return;
  refreshAddSheet();
});

// ---------- renaming a box (the ... on each box) ----------
function quadSheetHTML(q) {
  return '<h3 class="add-title q' + q + '"><i></i>Rename box</h3>' +
    '<p class="label">Name</p><input class="text-input" id="qName" value="' + esc(quadName(q)) + '" maxlength="40" aria-label="Box name" enterkeyhint="done">' +
    '<p class="label">Description</p><input class="text-input" id="qSub" value="' + esc(quadSub(q)) + '" maxlength="60" placeholder="Optional" aria-label="Box description" enterkeyhint="done">' +
    '<p class="small">Original: ' + QUADS[q - 1].name + ' · ' + QUADS[q - 1].sub + '</p>' +
    '<div class="row"><button class="btn" data-action="quadreset" data-q="' + q + '">Reset to original</button><button class="btn primary" data-action="quadsave" data-q="' + q + '">Save</button></div>';
}
function saveQuadName(q, name, sub) {
  if (name === null) delete state.settings.quadNames[q];
  else state.settings.quadNames[q] = { name: name, sub: sub };
  state.settings.updatedAt = now();
  save();
  closeSheet();
  renderAll();
  toast(name === null ? 'Box name reset' : 'Renamed to ' + name);
}
$('sheet').addEventListener('keydown', function (e) {
  if (e.key !== 'Enter' || (e.target.id !== 'qName' && e.target.id !== 'qSub')) return;
  e.preventDefault();
  actions.quadsave($('sheet').querySelector('[data-action="quadsave"]'));
});

// ---------- drawing the boxes ----------
function sortOpen(list) {
  return list.slice().sort(function (a, b) {
    const da = a.due || Infinity, db = b.due || Infinity;
    return (da - db) || (a.createdAt - b.createdAt);
  });
}
// One task row, used by Tasks, Calendar and Matrix.
// opts.box: show the box button on the right; opts.day: the date this list is grouped under (hide that date)
function taskHTML(t, opts) {
  opts = opts || {};
  const meta = [];
  if (t.due !== null) {
    const sameDay = opts.day !== undefined && midnight(t.due) === opts.day;
    const cls = isOverdue(t) ? ' late' : (midnight(t.due) === midnight(now()) ? ' today' : '');
    if (!sameDay) meta.push('<span class="chip' + cls + '">' + CAL_SVG + esc(fmtDue(t.due, t.hasTime)) + '</span>');
    else if (t.hasTime) meta.push('<span class="chip' + cls + '">' + esc(fmtTime(t.due)) + '</span>');
  }
  if (t.endDate && t.due !== null && t.endDate > midnight(t.due)) meta.push('<span class="chip" title="Runs until">→ ' + esc(new Date(t.endDate).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })) + '</span>');
  if (t.deadline && !t.done) {
    const left = Math.round((midnight(t.deadline) - midnight(now())) / DAY);
    meta.push('<span class="chip' + (left <= 1 ? ' late' : '') + '">' + FLAG_SVG + esc(fmtDeadline(t.deadline)) + '</span>');
  }
  // Steps show right under the task (tick each one there). A finished task just shows the count.
  const showSubs = t.subtasks.length && !t.done && !opts.nosubs;
  if (t.subtasks.length) {
    const d = t.subtasks.filter(function (s) { return s.done; }).length;
    meta.push('<span class="chip' + (d === t.subtasks.length ? ' alldone' : '') + '">' + LIST_SVG + d + '/' + t.subtasks.length + '</span>');
  }
  if (t.repeat) meta.push('<span class="chip rep">' + REPEAT_SVG + esc(repeatLabel(t.repeat)) + '</span>');
  const nextRem = t.done ? null : nextReminder(t);
  if (nextRem !== null) meta.push('<span class="chip rem" title="Reminder">' + BELL_SVG + esc(midnight(nextRem) === midnight(now()) ? fmtTime(nextRem) : fmtDue(nextRem, true)) + '</span>');
  const spent = focusMinutes(t.id);
  if (t.est) meta.push('<span class="chip' + (spent > t.est ? ' late' : '') + '" title="Focused / estimated">' + CLOCK_SVG + (spent ? fmtEst(spent) + ' / ' : '~') + esc(fmtEst(t.est)) + '</span>');
  else if (spent) meta.push('<span class="chip" title="Time focused">' + CLOCK_SVG + fmtEst(spent) + '</span>');
  if (t.someday && !t.done) meta.push('<span class="chip">Someday</span>');
  if (listFilter().length !== 1 && !opts.nolist) { const l = listOf(t); meta.push('<span class="chip lst" style="--lc:' + l.color + '"><i></i>' + esc(l.name) + '</span>'); }
  t.tags.forEach(function (tag) { meta.push('<span class="chip">#' + esc(tag) + '</span>'); });
  const stacked = !opts.nostack && t.seriesId && !t.done ? openStackCopies(t.seriesId).length : 0;
  const q = t.q || 0;
  const top = isTop(t) && !t.done;
  return '<li class="task q' + q + (t.done ? ' done' : '') + (top ? ' top' : '') + '" data-id="' + t.id + '" style="--lc:' + listOf(t).color + '">' +
    '<div class="task-bg" aria-hidden="true"><span class="bg-done">' + (t.done ? 'Not done' : 'Done') + '</span><span class="bg-del">Delete</span></div>' +
    '<div class="task-inner">' +
      '<button class="check" data-action="toggle" data-id="' + t.id + '" aria-label="' + (t.done ? 'Mark not done' : 'Mark done') + '">' + CHECK_SVG + '</button>' +
      '<button class="tbody" data-action="open" data-id="' + t.id + '"><span class="ttl">' + (top ? '<span class="star" title="Top 3 today">' + STAR_SVG + '</span>' : '') + esc(t.title) + (t.example ? '<span class="eg">example</span>' : '') + '</span>' +
      (meta.length ? '<span class="meta">' + meta.join('') + '</span>' : '') + '</button>' +
      (stacked > 1 ? '<button class="stackbtn' + (stacked >= STACK_MAX ? ' full' : '') + '" data-action="stackopen" data-id="' + t.seriesId + '" aria-label="' + stacked + ' copies stacked">' + STACK_SVG + stacked + '</button>' : '') +
      (opts.box ? '<button class="boxbtn q' + q + '" data-action="boxmenu" data-id="' + t.id + '" aria-label="Box: ' + boxName(t.q) + '"><i></i><span>' + (t.q ? esc(quadName(t.q)) : 'Sort') + '</span></button>' : '') +
      (showSubs ? subtasksHTML(t) : '') +
    '</div></li>';
}
// A task's steps, inside its row: each with its own tick. Long lists show the first 6.
const SUBS_SHOWN = 6;
function subtasksHTML(t) {
  const list = t.subtasks.slice(0, SUBS_SHOWN);
  return '<ul class="tsubs">' + list.map(function (s) {
    return '<li class="' + (s.done ? 'done' : '') + '"><button class="tsubchk" data-action="subtick" data-id="' + t.id + '" data-sid="' + s.id + '" aria-pressed="' + !!s.done + '" aria-label="' + (s.done ? 'Mark step not done: ' : 'Mark step done: ') + esc(s.title) + '">' + TICK_SVG + '</button>' +
      '<button class="tsubt" data-action="open" data-id="' + t.id + '">' + esc(s.title || 'Untitled step') + '</button></li>';
  }).join('') + (t.subtasks.length > SUBS_SHOWN ? '<li class="more"><button class="tsubt" data-action="open" data-id="' + t.id + '">+' + (t.subtasks.length - SUBS_SHOWN) + ' more steps</button></li>' : '') + '</ul>';
}
// Tick a step straight from the list.
actions.subtick = function (el) {
  const t = findTask(el.dataset.id);
  if (!t) return;
  const s = t.subtasks.find(function (x) { return x.id === el.dataset.sid; });
  if (!s) return;
  s.done = !s.done;
  t.updatedAt = now();
  save();
  haptic(s.done ? 8 : 4);
  if (s.done) sound('soft');
  renderTaskViews();
  if (s.done && t.subtasks.every(function (x) { return x.done; })) toast('All steps of "' + shortTitle(t.title) + '" done. Tick the task when you\'re ready.');
};

// Redraw every view that shows tasks.
function renderTaskViews() {
  refreshStackSheet();
  renderListBars();
  if (typeof renderPlanBits === 'function') renderPlanBits();
  renderMatrix();
  if (typeof renderTaskList === 'function') renderTaskList();
  if (typeof renderCalendar === 'function') renderCalendar();
  afterTaskChange();
}
function renderMatrix() {
  const heads = stackHeads();
  const shown = liveTasks().filter(function (t) { return !stackHidden(t, heads) && listVisible(t) && !(t.someday && !t.done); });
  const tasks = shown.filter(function (t) { return !isFarOff(t); });
  const later = shown.filter(function (t) { return isFarOff(t); });
  let note = $('matrixLater');
  if (!note) { note = document.createElement('p'); note.id = 'matrixLater'; note.className = 'small matrix-later'; $('matrixGrid').after(note); }
  note.hidden = !later.length;
  note.innerHTML = later.length ? later.length + (later.length === 1 ? ' task is' : ' tasks are') + ' planned more than a week ahead. ' +
    (later.length === 1 ? 'It shows' : 'They show') + ' up here a week before. <button class="linkbtn" data-action="tab" data-view="calendar">See the Calendar</button>' : '';
  const unsorted = sortOpen(tasks.filter(function (t) { return !t.q && !t.done; }));
  $('tray').hidden = !unsorted.length;
  $('tray').innerHTML = '<p class="tray-head"><b>Not sorted · ' + unsorted.length + '</b> Hold one and drag it into a box, or tap its button.</p>' +
    '<ul class="tasks tray-list">' + unsorted.map(function (t) { return taskHTML(t, { box: true }); }).join('') + '</ul>';
  const scrolls = {};
  document.querySelectorAll('.quad .tasks').forEach(function (ul) { scrolls[ul.parentElement.dataset.q] = ul.scrollTop; });
  $('matrixGrid').innerHTML = QUADS.map(function (q) {
    const mine = tasks.filter(function (t) { return t.q === q.q; });
    const open = sortOpen(mine.filter(function (t) { return !t.done; }));
    const done = mine.filter(function (t) { return t.done; }).sort(function (a, b) { return (b.doneAt || 0) - (a.doneAt || 0); });
    const showDone = !!state.ui.showDone[q.q];
    const name = esc(quadName(q.q));
    let list = open.length ? open.map(taskHTML).join('') :
      '<li class="empty"><button class="empty-add" data-action="addhere" data-q="' + q.q + '">' + EMPTY_TEXT[q.q] + ' <b>+ Add a task</b></button></li>';
    if (done.length) {
      list += '<li><button class="done-toggle" data-action="showdone" data-q="' + q.q + '" aria-expanded="' + showDone + '">' + CHEVRON_SVG + 'Completed · ' + done.length + '</button></li>';
      if (showDone) list += done.map(taskHTML).join('');
    }
    return '<div class="quad q' + q.q + '" data-q="' + q.q + '">' +
      '<div class="quad-head"><span class="qnum" aria-hidden="true">' + ROMAN[q.q - 1] + '</span>' +
      '<button class="qtitle" data-action="quadedit" data-q="' + q.q + '" title="Rename"><h2>' + name + '</h2>' + (quadSub(q.q) ? '<span class="sub">' + esc(quadSub(q.q)) + '</span>' : '') + '</button>' +
      '<span class="count" title="Open tasks">' + open.length + '</span>' +
      '<div class="quad-tools">' +
        '<button class="quad-btn" data-action="addhere" data-q="' + q.q + '" aria-label="Add a task to ' + name + '" title="Add a task">' + PLUS_SVG + '</button>' +
        '<button class="quad-btn" data-action="quadedit" data-q="' + q.q + '" aria-label="Rename ' + name + '" title="Rename">' + DOTS_SVG + '</button>' +
      '</div></div>' +
      '<ul class="tasks">' + list + '</ul></div>';
  }).join('');
  document.querySelectorAll('.quad .tasks').forEach(function (ul) { const y = scrolls[ul.parentElement.dataset.q]; if (y) ul.scrollTop = y; });
}
function afterTaskChange() { if (typeof renderTaskSelect === 'function') renderTaskSelect(); }

// ---------- actions on a task ----------
function toggleTask(id, fromSwipe, early) {
  const t = findTask(id);
  if (!t) return;
  if (!t.done && isFarOff(t) && !early) { askDoneEarly(t, fromSwipe); return; }   // stop accidental ticks on far-off tasks
  if (!t.done && repeatsInPlace(t)) { completeRepeating(t, fromSwipe); return; }
  if (t.done) {
    snapshot('Marked not done');
    t.done = false; t.doneAt = null; t.updatedAt = now();
    save(); renderTaskViews();
    return;
  }
  snapshot('Completed task');
  t.done = true; t.doneAt = now(); t.updatedAt = now();
  save();
  sound('tick');
  haptic(14);
  const rows = document.querySelectorAll('.task[data-id="' + id + '"]');
  if (rows.length && !fromSwipe) {
    rows.forEach(function (li) { li.classList.add('completing', 'done', 'leaving'); });
    setTimeout(renderTaskViews, 720);
  } else {
    renderTaskViews();
  }
  toast('Completed "' + shortTitle(t.title) + '"', { undo: true });
}
function deleteTask(id) {
  const t = findTask(id);
  if (!t) return;
  snapshot('Deleted task');
  t.deleted = true; t.updatedAt = now();
  save();
  sound('delete');
  haptic(10);
  renderTaskViews();
  toast('Deleted "' + shortTitle(t.title) + '"', { undo: true });
}
function moveTask(id, q) {
  const t = findTask(id);
  q = q || null;
  if (!t || t.q === q) return;
  snapshot('Moved task');
  t.q = q; t.updatedAt = now();
  save();
  haptic(12);
  renderTaskViews();
  document.querySelectorAll('.task[data-id="' + id + '"]').forEach(function (li) {
    if (li.animate) li.animate([{ transform: 'scale(1.06)' }, { transform: 'none' }], { duration: 300, easing: 'cubic-bezier(0.34,1.56,0.64,1)' });
  });
  toast(q ? 'Moved to ' + quadName(q) : 'Moved out of the matrix', { undo: true });
}

// Ticking a task that's more than a week away asks first. For a repeating task this matters most:
// one stray tick silently moves it a whole month (or year) on.
function askDoneEarly(t, fromSwipe) {
  if (fromSwipe) renderTaskViews();                 // put the swiped row back
  const days = Math.round((midnight(t.due) - midnight(now())) / DAY);
  const when = new Date(t.due).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
  let after = '';
  if (repeatsInPlace(t)) {
    const next = rpNextDue(t);
    after = next === null ? 'This is the last one, so it will stop repeating.'
      : 'The next one would be ' + new Date(next).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }) + ', and ' + when + ' counts as done.';
  }
  haptic([20, 40, 20]);
  openSheet({ type: 'early', id: t.id },
    '<h3>Done already?</h3>' +
    '<p>"' + esc(t.title) + '" is planned for <b>' + when + '</b>, ' + days + ' days from now.</p>' +
    (after ? '<p class="small">' + esc(after) + '</p>' : '') +
    '<div class="row"><button class="btn" data-action="close">Not yet</button><button class="btn primary" data-action="earlydone">Yes, done early</button></div>');
}
actions.earlydone = function () {
  const id = sheetCtx && sheetCtx.id;
  closeSheet();
  if (id) toggleTask(id, false, true);
};

// ---------- gestures: swipe and hold-to-drag ----------
let gest = null;
let suppressClickUntil = 0;

function startDrag(x, y) {
  gest.mode = 'drag';
  haptic(18);
  const t = findTask(gest.id);
  const r = gest.inner.getBoundingClientRect();
  const ghost = gest.inner.cloneNode(true);
  ghost.classList.add('ghost', 'q' + (t.q || 0));
  ghost.style.width = r.width + 'px';
  ghost.style.left = r.left + 'px';
  ghost.style.top = r.top + 'px';
  document.body.appendChild(ghost);
  gest.ghost = ghost;
  gest.offX = x - r.left;
  gest.offY = y - r.top;
  gest.fromQ = t.q;
  gest.target = null;
  gest.li.classList.add('lifted');
}
function moveDrag(x, y) {
  gest.ghost.style.left = (x - gest.offX) + 'px';
  gest.ghost.style.top = (y - gest.offY) + 'px';
  const el = document.elementFromPoint(x, y);
  const quad = el && el.closest('.quad');
  const q = quad ? Number(quad.dataset.q) : null;
  if (q !== gest.target) {
    document.querySelectorAll('.quad.drop').forEach(function (n) { n.classList.remove('drop'); });
    if (quad && q !== gest.fromQ) { quad.classList.add('drop'); haptic(6); }
    gest.target = q;
  }
}
function finishDrag() {
  const g = gest;
  if (g.ghost) g.ghost.remove();
  g.li.classList.remove('lifted');
  document.querySelectorAll('.quad.drop').forEach(function (n) { n.classList.remove('drop'); });
  suppressClickUntil = now() + 450;
  if (g.target && g.target !== g.fromQ) moveTask(g.id, g.target);
}
function moveSwipe(dx) {
  const w = gest.li.offsetWidth;
  gest.inner.style.transform = 'translateX(' + dx + 'px)';
  gest.li.classList.toggle('swipe-right', dx > 0);
  gest.li.classList.toggle('swipe-left', dx < 0);
  const past = Math.abs(dx) > w * 0.38;
  if (past !== gest.past) { gest.past = past; if (past) haptic(8); }
  gest.li.querySelector('.task-bg').style.opacity = past ? 1 : 0.5;
}
function finishSwipe() {
  const g = gest;
  const dx = g.x - g.x0;
  suppressClickUntil = now() + 450;
  if (g.past) {
    const w = g.li.offsetWidth;
    g.inner.style.transition = 'transform 0.18s ease-in';
    g.inner.style.transform = 'translateX(' + (dx > 0 ? w : -w) + 'px)';
    setTimeout(function () { if (dx > 0) toggleTask(g.id, true); else deleteTask(g.id); }, 170);
  } else {
    g.inner.style.transform = '';
    setTimeout(function () { g.li.classList.remove('swiping', 'swipe-left', 'swipe-right'); }, 280);
  }
}
function cancelGesture() {
  if (!gest) return;
  clearTimeout(gest.timer);
  if (gest.mode === 'drag') { gest.target = null; finishDrag(); }
  if (gest.mode === 'swipe') { gest.past = false; finishSwipe(); }
  gest = null;
}

// Attach swipe + hold gestures to a container of task rows.
// mode 'drag': hold then drag into a box (Matrix). mode 'menu': hold opens the box menu (Tasks, Calendar).
function attachTaskGestures(container, mode) {
  container.addEventListener('touchstart', function (e) {
    if (e.touches.length !== 1) { cancelGesture(); return; }
    const inner = e.target.closest('.task-inner');
    if (!inner || e.target.closest('.check') || e.target.closest('.boxbtn')) return;
    const tch = e.touches[0];
    gest = { li: inner.parentElement, inner: inner, id: inner.parentElement.dataset.id, x0: tch.clientX, y0: tch.clientY, x: tch.clientX, y: tch.clientY, mode: null, past: false };
    gest.timer = setTimeout(function () {
      if (!gest || gest.mode) return;
      if (mode === 'drag') startDrag(gest.x, gest.y);
      else { const g = gest; gest = null; suppressClickUntil = now() + 600; openBoxMenu(g.id, g.inner); }
    }, 420);
  }, { passive: true });
  container.addEventListener('touchmove', function (e) {
    if (!gest) return;
    const tch = e.touches[0];
    gest.x = tch.clientX;
    gest.y = tch.clientY;
    const dx = gest.x - gest.x0, dy = gest.y - gest.y0;
    if (!gest.mode) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      clearTimeout(gest.timer);
      if (Math.abs(dx) > Math.abs(dy) * 1.3) { gest.mode = 'swipe'; gest.li.classList.add('swiping'); }
      else { gest = null; return; }            // mostly vertical: let the list scroll
    }
    if (e.cancelable) e.preventDefault();
    if (gest.mode === 'swipe') moveSwipe(dx);
    else if (gest.mode === 'drag') moveDrag(gest.x, gest.y);
  }, { passive: false });
  container.addEventListener('touchend', function () {
    if (!gest) return;
    clearTimeout(gest.timer);
    if (gest.mode === 'swipe') finishSwipe();
    else if (gest.mode === 'drag') finishDrag();
    gest = null;
  });
  container.addEventListener('touchcancel', cancelGesture);
  container.addEventListener('contextmenu', function (e) { if (e.target.closest('.task')) e.preventDefault(); });
  if (mode !== 'drag') return;
  // Mouse (laptop): press and drag a task into a box.
  container.addEventListener('mousedown', function (e) {
    if (e.button !== 0) return;
    const inner = e.target.closest('.task-inner');
    if (!inner || e.target.closest('.check') || e.target.closest('.boxbtn')) return;
    gest = { li: inner.parentElement, inner: inner, id: inner.parentElement.dataset.id, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, mode: null, mouse: true };
  });
}
document.addEventListener('mousemove', function (e) {
  if (!gest || !gest.mouse) return;
  gest.x = e.clientX; gest.y = e.clientY;
  if (!gest.mode) {
    if (Math.abs(gest.x - gest.x0) + Math.abs(gest.y - gest.y0) < 6) return;
    startDrag(gest.x0, gest.y0);
  }
  e.preventDefault();
  moveDrag(gest.x, gest.y);
});
document.addEventListener('mouseup', function () {
  if (!gest || !gest.mouse) return;
  if (gest.mode === 'drag') finishDrag();
  gest = null;
});
attachTaskGestures($('view-matrix'), 'drag');

// ---------- task details sheet ----------
function taskSheetHTML(t) {
  const dateVal = t.due ? dayKey(t.due) : '';
  const timeVal = t.due && t.hasTime ? String(new Date(t.due).getHours()).padStart(2, '0') + ':' + String(new Date(t.due).getMinutes()).padStart(2, '0') : '';
  const top = t.draft
    ? '<div class="tsh-bar"><h3>New task</h3><button class="btn" data-action="tnewcancel">Cancel</button><button class="btn primary" data-action="tnewadd">Add task</button></div>'
    : '<div class="tsh-bar"><h3>Task</h3>' +
        '<button class="btn small tsh-done' + (t.done ? ' on' : '') + '" data-action="tdonebtn">' + TICK_SVG + (t.done ? 'Not done' : 'Mark done') + '</button>' +
        '<button class="icon-btn sm danger" data-action="tdelete" aria-label="Delete task" title="Delete">' + TRASH_SVG + '</button>' +
        '<button class="btn small primary" data-action="close">Close</button></div>';
  return top +
    '<input class="text-input" id="tTitle" value="' + esc(t.title) + '" placeholder="What needs doing?" aria-label="Task name"' + (t.draft ? ' enterkeyhint="done"' : '') + '>' +
    '<p class="label">List</p>' + listPickHTML(listOf(t).id, 'tlist') +
    '<p class="label">Eisenhower box</p><div class="qmove">' + QUADS.map(function (q) {
      return '<button class="q' + q.q + (t.q === q.q ? ' on' : '') + '" data-action="tmove" data-q="' + q.q + '">' + esc(quadName(q.q)) + '</button>';
    }).join('') + '<button class="q0 wide' + (!t.q ? ' on' : '') + '" data-action="tmove" data-q="0">Not sorted</button></div>' +
    '<p class="label">Date' + (t.due ? ' · ' + esc(fmtDue(t.due, t.hasTime)) : ' · none, so it shows in Today') + '</p>' +
    '<div class="daterow">' +
      '<button class="btn small" data-action="tdue" data-d="0">Today</button>' +
      '<button class="btn small" data-action="tdue" data-d="1">Tomorrow</button>' +
      '<button class="btn small" data-action="tdue" data-d="7">Next week</button>' +
      (t.due ? '<button class="btn small" data-action="tdue" data-d="clear">No date</button>' : '') +
    '</div>' +
    '<div class="daterow"><input type="date" id="tDate" value="' + dateVal + '" aria-label="Date"><input type="time" id="tTime" value="' + timeVal + '" aria-label="Time"></div>' +
    (t.due !== null ? '<div class="daterow until"><span class="small">Runs until</span><input type="date" id="tUntil" min="' + dateVal + '" value="' + (isMulti(t) ? dayKey(t.endDate) : '') + '" aria-label="Last day, for a task that runs over several days">' +
      (isMulti(t) ? '<button class="btn small" data-action="tuntil">One day only</button>' : '') + '</div>' : '') +
    '<div class="daterow">' +
      '<button class="pick' + (isTop(t) ? ' on' : '') + '" data-action="ttop" aria-pressed="' + isTop(t) + '">' + STAR_SVG + 'Top 3 today</button>' +
      '<button class="pick' + (t.evening ? ' on' : '') + '" data-action="tevening" aria-pressed="' + t.evening + '">This evening</button>' +
      '<button class="pick' + (t.someday ? ' on' : '') + '" data-action="tsomeday" aria-pressed="' + t.someday + '">Someday</button>' +
    '</div>' +
    (t.someday ? '<p class="small">Someday: no date, kept out of Today and the Matrix. Find it at the bottom of Tasks.</p>' : '') +
    '<p class="label">Deadline' + (t.deadline ? ' · ' + esc(new Date(t.deadline).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })) + ' (' + esc(fmtDeadline(t.deadline)) + ')' : '') + '</p>' +
    '<div class="daterow">' +
      '<button class="btn small" data-action="tdl" data-d="3">In 3 days</button>' +
      '<button class="btn small" data-action="tdl" data-d="7">In a week</button>' +
      '<input type="date" id="tDeadline" value="' + (t.deadline ? dayKey(t.deadline) : '') + '" aria-label="Deadline">' +
      (t.deadline ? '<button class="btn small" data-action="tdl" data-d="clear">Remove</button>' : '') +
    '</div>' +
    remindersHTML(t) +
    '<p class="label">Time it needs' + (focusMinutes(t.id) ? ' · focused ' + fmtEst(focusMinutes(t.id)) + ' so far' : '') + '</p>' +
    '<div class="daterow">' + EST_CHOICES.map(function (m) {
      return '<button class="pick' + (t.est === m ? ' on' : '') + '" data-action="test" data-m="' + m + '">' + fmtEst(m) + '</button>';
    }).join('') + (t.est ? '<button class="pick" data-action="test" data-m="0">None</button>' : '') + '</div>' +
    '<p class="label">Repeat' + (t.repeat ? ' · ' + esc(repeatLabel(t.repeat)) : '') + '</p>' +
    repeatEditorHTML(t.repeat, t.due) +
    (repeatsInPlace(t) ? '<div class="row"><button class="btn small" data-action="rpskip">Skip this one</button></div>' : '') +
    '<p class="label">Checklist</p>' +
    '<ul class="subtasks">' + t.subtasks.map(function (s) {
      return '<li><input type="checkbox" data-sub="' + s.id + '"' + (s.done ? ' checked' : '') + ' aria-label="Done"><input class="text-input" data-subtext="' + s.id + '" value="' + esc(s.title) + '" aria-label="Step"><button class="x" data-action="tsubdel" data-sub="' + s.id + '" aria-label="Remove step">×</button></li>';
    }).join('') + '</ul>' +
    '<input class="text-input" id="tSubAdd" placeholder="Add a step, then press Enter" enterkeyhint="done">' +
    '<p class="label">Notes</p>' +
    '<textarea class="text-input" id="tNotes" placeholder="Anything to remember">' + esc(t.notes) + '</textarea>' +
    '<p class="label">Tags</p>' +
    '<input class="text-input" id="tTags" value="' + esc(t.tags.join(', ')) + '" placeholder="college, exam">' +
    (t.draft
      ? '<div class="row"><button class="btn" data-action="tnewcancel">Cancel</button><button class="btn primary" data-action="tnewadd">Add task</button></div>'
      : '<div class="row"><button class="btn" data-action="tsavetemplate">Save as template</button><button class="btn" data-action="tfocus">Focus on this</button></div>');
}
function openTask(id) {
  const t = findTask(id);
  if (!t) return;
  openSheet({ type: 'task', id: id }, taskSheetHTML(t));
}
function sheetTask() { return sheetCtx && sheetCtx.type === 'task' ? findTask(sheetCtx.id) : null; }
function refreshTaskSheet(focusId) {
  const t = sheetTask();
  if (!t) return;
  refreshSheet(taskSheetHTML(t));
  if (focusId && $(focusId)) $(focusId).focus();
}
function taskChanged(t) { t.updatedAt = now(); save(); renderTaskViews(); }

$('sheet').addEventListener('change', function (e) {
  const t = sheetTask();
  if (!t) return;
  const el = e.target;
  if (el.id === 'tTitle') { const v = el.value.trim(); if (v) { t.title = v; taskChanged(t); } }
  else if (el.id === 'tNotes') { t.notes = el.value; taskChanged(t); }
  else if (el.id === 'tTags') { t.tags = el.value.split(',').map(function (s) { return s.trim().replace(/^#/, '').toLowerCase(); }).filter(Boolean); taskChanged(t); }
  else if (el.id === 'tDeadline') {
    snapshot('Changed deadline');
    t.deadline = el.value ? new Date(el.value + 'T00:00').getTime() : null;
    taskChanged(t); refreshTaskSheet();
  }
  else if (el.id === 'tDate' || el.id === 'tTime') {
    const d = $('tDate').value, tm = $('tTime').value;
    snapshot('Changed due date');
    if (!d && !tm) { t.due = null; t.hasTime = false; }
    else {
      const base = d ? new Date(d + 'T00:00').getTime() : midnight(now());
      const mins = tm ? Number(tm.slice(0, 2)) * 60 + Number(tm.slice(3, 5)) : 0;
      t.due = base + mins * MIN;
      t.hasTime = !!tm;
      t.someday = false;
    }
    taskChanged(t); refreshTaskSheet();
  }
  else if (el.dataset.sub) {
    const s = t.subtasks.find(function (x) { return x.id === el.dataset.sub; });
    if (s) { s.done = el.checked; if (el.checked) { sound('pop'); haptic(8); } taskChanged(t); }
  }
  else if (el.dataset.subtext) {
    const s = t.subtasks.find(function (x) { return x.id === el.dataset.subtext; });
    if (s && el.value.trim()) { s.title = el.value.trim(); taskChanged(t); }
  }
});
$('sheet').addEventListener('keydown', function (e) {
  if (e.key !== 'Enter' || e.target.id !== 'tSubAdd') return;
  e.preventDefault();
  const t = sheetTask();
  const v = e.target.value.trim();
  if (!t || !v) return;
  snapshot('Added step');
  t.subtasks.push({ id: uid(), title: v, done: false });
  taskChanged(t);
  refreshTaskSheet('tSubAdd');
});

// ---------- click actions ----------
actions.addhere = function (el) { openAddSheet(Number(el.dataset.q)); };
actions.alist = function (el) { addDraft.listId = el.dataset.id; refreshAddSheet(); };
actions.aq = function (el) { addDraft.q = Number(el.dataset.q) || null; if (addDraft.q) addQ = addDraft.q; refreshAddSheet(); };
actions.adate = function (el) { addDraft.date = el.dataset.d === 'none' ? null : addDays(midnight(now()), Number(el.dataset.d)); if (addDraft.date === null) addDraft.time = ''; refreshAddSheet(); };
actions.adl = function (el) { addDraft.deadline = el.dataset.d === 'none' ? null : addDays(midnight(now()), Number(el.dataset.d)); refreshAddSheet(); };
actions.quadedit = function (el) { const q = Number(el.dataset.q); openSheet({ type: 'quad', q: q }, quadSheetHTML(q)); setTimeout(function () { if ($('qName')) $('qName').select(); }, 60); };
actions.quadsave = function (el) {
  const q = Number(el.dataset.q);
  const name = $('qName').value.trim();
  const sub = $('qSub').value.trim();
  if (!name) { $('qName').focus(); return; }
  if (name === QUADS[q - 1].name && sub === QUADS[q - 1].sub) saveQuadName(q, null);
  else saveQuadName(q, name, sub);
};
actions.quadreset = function (el) { saveQuadName(Number(el.dataset.q), null); };
actions.toggle = function (el) { toggleTask(el.dataset.id); };
actions.open = function (el) { if (now() < suppressClickUntil) return; openTask(el.dataset.id); };
actions.showdone = function (el) { const q = el.dataset.q; state.ui.showDone[q] = !state.ui.showDone[q]; save(); renderMatrix(); };
actions.tlist = function (el) {
  const t = sheetTask();
  if (!t || t.listId === el.dataset.id) return;
  snapshot('Moved to another list');
  t.listId = el.dataset.id;
  taskChanged(t); refreshTaskSheet();
  if (!listVisible(t)) toast('Moved to ' + listOf(t).name + '. It\'s hidden by the list filter.', { undo: true });
};
actions.ttop = function () {
  const t = sheetTask();
  if (!t) return;
  if (isTop(t)) t.top = null;
  else {
    const tops = liveTasks().filter(function (x) { return isTop(x) && !x.done; });
    if (tops.length >= 3) { toast('You already have 3 top tasks today. Unstar one first.'); return; }
    t.top = dayKey();
    if (t.someday) t.someday = false;
    if (t.due !== null && midnight(t.due) > midnight(now())) t.due = midnight(now()) + (t.due - midnight(t.due));   // a future task moves to today
  }
  taskChanged(t); refreshTaskSheet();
};
actions.tevening = function () {
  const t = sheetTask();
  if (!t) return;
  t.evening = !t.evening;
  if (t.evening && t.someday) { t.someday = false; t.due = midnight(now()); t.hasTime = false; }
  taskChanged(t); refreshTaskSheet();
};
actions.tsomeday = function () {
  const t = sheetTask();
  if (!t) return;
  snapshot(t.someday ? 'Picked up from Someday' : 'Moved to Someday');
  t.someday = !t.someday;
  if (t.someday) { t.due = null; t.hasTime = false; t.top = null; t.evening = false; }
  taskChanged(t); refreshTaskSheet();
};
actions.test = function (el) {
  const t = sheetTask();
  if (!t) return;
  const m = Number(el.dataset.m);
  t.est = m && t.est !== m ? m : null;
  taskChanged(t); refreshTaskSheet();
};
actions.tmove = function (el) { const t = sheetTask(); if (!t) return; moveTask(t.id, Number(el.dataset.q)); refreshTaskSheet(); };
actions.tdl = function (el) {
  const t = sheetTask();
  if (!t) return;
  snapshot('Changed deadline');
  t.deadline = el.dataset.d === 'clear' ? null : addDays(midnight(now()), Number(el.dataset.d));
  taskChanged(t); refreshTaskSheet();
};
actions.boxmenu = function (el) { if (boxMenuTask === el.dataset.id) { closeBoxMenu(); return; } openBoxMenu(el.dataset.id, el); };
actions.setbox = function (el) { const id = boxMenuTask; closeBoxMenu(); if (id) moveTask(id, Number(el.dataset.q)); };
actions.tdue = function (el) {
  const t = sheetTask();
  if (!t) return;
  snapshot('Changed due date');
  if (el.dataset.d === 'clear') { t.due = null; t.hasTime = false; }
  else { t.due = addDays(midnight(now()), Number(el.dataset.d)); t.hasTime = false; t.someday = false; }
  taskChanged(t); refreshTaskSheet();
};
actions.tsubdel = function (el) {
  const t = sheetTask();
  if (!t) return;
  snapshot('Removed step');
  t.subtasks = t.subtasks.filter(function (s) { return s.id !== el.dataset.sub; });
  taskChanged(t); refreshTaskSheet();
};
actions.tfocus = function () {
  const t = sheetTask();
  if (!t) return;
  state.timer.taskId = t.id;
  save();
  closeSheet();
  showView('focus');
};
actions.tdelete = function () { const t = sheetTask(); if (!t) return; closeSheet(); deleteTask(t.id); };
actions.tdonebtn = function () { const t = sheetTask(); if (!t) return; closeSheet(); toggleTask(t.id); };

// ---------- adding with every option: the full task sheet, before the task exists ----------
// The task is created as a hidden draft so every picker in the sheet works on it as usual.
// "Add task" makes it real; Cancel throws it away; closing another way keeps it only if it has a name.
function openNewTaskSheet(p, extra) {
  p = p || {};
  extra = extra || {};
  const t = newTask(p.title || '', p.q || extra.q || null, {
    due: extra.due !== undefined ? extra.due : null, hasTime: !!extra.hasTime, deadline: extra.deadline || null,
    tags: p.tags || [], listId: extra.listId || defaultListId()
  });
  if (extra.repeat) setupRepeat(t, extra.repeat);
  finishNewTask(t, p);
  if (!t.est && extra.est) t.est = extra.est;
  t.draft = true;
  state.tasks.push(t);
  openSheet({ type: 'task', id: t.id, onClose: function () { finishDraft(t.id); } }, taskSheetHTML(t));
  setTimeout(function () { const el = $('tTitle'); if (el && !el.value) el.focus(); }, 80);
}
function finishDraft(id) {
  const t = findTask(id);
  if (!t || !t.draft) return;
  const el = $('tTitle');
  if (el && el.value.trim()) t.title = el.value.trim();
  if (!t.title.trim() || t.discard) {               // nothing to keep
    const i = state.tasks.indexOf(t);
    if (i !== -1) state.tasks.splice(i, 1);
    save();
    return;
  }
  snapshot('Added task');
  delete t.draft;
  t.updatedAt = now();
  save();
  renderTaskViews();
  sound('soft');
  toast('Added "' + shortTitle(t.title) + '"' + (t.due !== null ? ' for ' + fmtDue(t.due, t.hasTime) : ''), { undo: true });
}
actions.tnewadd = function () {
  const t = sheetTask();
  if (!t) return;
  const el = $('tTitle');
  if (!el.value.trim()) { el.focus(); if (el.animate) el.animate([{ transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'none' }], { duration: 220 }); return; }
  closeSheet();                                     // finishDraft (onClose) adds it
};
actions.tnewcancel = function () { const t = sheetTask(); if (t) t.discard = true; closeSheet(); };
// "+" next to Add on the Tasks page: whatever is typed so far comes along.
actions.newfull = function () {
  const input = $('taskInput');
  const raw = input.value.trim();
  const p = raw ? parseQuickAdd(raw) : { title: '', tags: [] };
  const extra = { due: p.due !== null && p.due !== undefined ? p.due : (typeof listDate !== 'undefined' ? listDate : null), hasTime: !!(p.due && p.hasTime), q: typeof listQ !== 'undefined' ? listQ : null, repeat: p.repeat };
  if (!raw) { p.title = ''; }
  input.value = '';
  if (typeof renderListParse === 'function') renderListParse();
  openNewTaskSheet(p, extra);
};
// From the quick add pop-up: carry over what's typed and picked.
actions.addmore = function () {
  const d = addDraft;
  const raw = $('addTitle') ? $('addTitle').value.trim() : '';
  const p = raw ? parseQuickAdd(raw) : { title: '', tags: [] };
  let due = null, hasTime = false;
  if (p.due !== null && p.due !== undefined) { due = p.due; hasTime = p.hasTime; }
  else if (d.date !== null || d.time) {
    const mins = d.time ? Number(d.time.slice(0, 2)) * 60 + Number(d.time.slice(3, 5)) : 0;
    due = (d.date !== null ? d.date : midnight(now())) + mins * MIN;
    hasTime = !!d.time;
  }
  openNewTaskSheet(p, { due: due, hasTime: hasTime, deadline: d.deadline, q: d.q, listId: d.listId, repeat: p.repeat || d.repeat, est: d.est });
};
// Enter in the title of a new task adds it.
$('sheet').addEventListener('keydown', function (e) {
  if (e.key === 'Enter' && e.target.id === 'tTitle' && sheetTask() && sheetTask().draft) { e.preventDefault(); actions.tnewadd(); }
});

