/* =========================================================
   Tasks on a big screen (v0.13).
   - Laptop (1100px+), List layout: the list on the left, a side panel on the right with
       · Today: progress ring, Top 3, today's habits, and today's timeline (timed tasks,
         what you painted in ColorTracker, a "now" line). Drag a task from the list onto
         an hour to give it that time.
       · Calendar: a small month + the next 7 days; pick a day to see its tasks. Drop a
         task on a day to move it there.
       · Task details: opening a task shows its full edit screen in the panel instead of a
         pop-up. It's the same #sheet element moved into the panel ("docked"), so every
         button and field works exactly as in the pop-up.
   - Board layout (900px+): Overdue · Today (+ No date) · Tomorrow · the next days · Later ·
     Someday as columns. Drag cards between columns to change their date.
   Dragging here uses the browser's own drag and drop (mouse / trackpad).
   ========================================================= */

const TP_WIDE = 1100;
let tpDay = null;       // day picked in the panel's Calendar tab
let tpMonth = null;     // month shown there
let tpDragId = null;    // task being dragged
let tpScrollY = null;   // keep the timeline where it was between redraws
let tpSheetUsedAt = 0;  // last press / key inside the docked task

function taskLayout() { return state.ui.taskLayout === 'board' && window.innerWidth >= 900 ? 'board' : 'list'; }
function paneOn() { return view === 'tasks' && window.innerWidth >= TP_WIDE && taskLayout() === 'list'; }
function fineMouse() { return !!(window.matchMedia && window.matchMedia('(pointer: fine)').matches); }
function tpShort(d) { return new Date(d).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }); }

// ---------- task details docked in the panel ----------
function dockSheet(ctx, html) {
  const sh = $('sheet');
  clearTimeout(sheetTimer);                       // a sheet that just closed mustn't wipe this one
  if (sh.parentElement !== $('taskPaneDock')) $('taskPaneDock').appendChild(sh);
  sh.classList.add('docked');
  sh.style.transform = ''; sh.style.transition = '';
  sh.innerHTML = html;
  sh.scrollTop = 0;
  ctx.docked = true;
  sheetCtx = ctx;
  $('taskPane').classList.add('detail');
}
function undockSheet() {
  const sh = $('sheet');
  sh.classList.remove('docked');
  sh.innerHTML = '';
  if (sh.parentElement !== $('sheetWrap')) $('sheetWrap').appendChild(sh);
  $('taskPane').classList.remove('detail');
}
const tpOpenSheet = openSheet;
openSheet = function (ctx, html) {
  if (sheetCtx && sheetCtx.docked) {
    const old = sheetCtx;
    sheetCtx = null;
    if (old.onClose) old.onClose();               // e.g. a new task being filled in gets added
    if (ctx.type === 'task' && paneOn()) { dockSheet(ctx, html); renderTaskPaneBody(); return; }
    undockSheet();
  }
  if (ctx.type === 'task' && paneOn() && !sheetCtx) { dockSheet(ctx, html); return; }
  tpOpenSheet(ctx, html);
};
const tpCloseSheet = closeSheet;
closeSheet = function (fromHistory) {
  if (sheetCtx && sheetCtx.docked) {
    const ctx = sheetCtx;
    sheetCtx = null;
    if (ctx.onClose) ctx.onClose();               // runs while the fields are still there
    undockSheet();
    renderTaskPane();
    return;
  }
  tpCloseSheet(fromHistory);
};
// leaving Tasks closes the docked task; coming back draws the panel
new MutationObserver(function () {
  if ($('view-tasks').hidden) { if (sheetCtx && sheetCtx.docked) closeSheet(); }
  else renderTaskPane();
}).observe($('view-tasks'), { attributes: true, attributeFilter: ['hidden'] });
// the window got narrow: the docked task becomes a normal pop-up
let tpResizeT = 0;
window.addEventListener('resize', function () {
  clearTimeout(tpResizeT);
  tpResizeT = setTimeout(function () {
    if (sheetCtx && sheetCtx.docked && !paneOn()) {
      const id = sheetCtx.id, draft = findTask(id) && findTask(id).draft;
      const old = sheetCtx; sheetCtx = null; undockSheet();
      if (draft) tpOpenSheet(old, taskSheetHTML(findTask(id))); else { if (old.onClose) old.onClose(); openTask(id); }
    }
    if (view === 'tasks') renderTaskList();
  }, 150);
});

// ---------- the list / board switch ----------
const tpBaseList = renderTaskList;
renderTaskList = function () {
  const board = taskLayout() === 'board';
  const v = $('view-tasks');
  v.classList.toggle('board', board);
  v.classList.toggle('split', !board && window.innerWidth >= TP_WIDE);
  $('taskList').hidden = board;
  $('taskBoard').hidden = !board;
  $('taskLayout').querySelectorAll('button').forEach(function (b) { b.classList.toggle('on', b.dataset.l === taskLayout()); });
  if (board) renderTaskBoard(); else { tpBaseList(); tpDraggable($('taskList')); }
  renderTaskPane();
};
function tpDraggable(box) {
  if (!fineMouse()) return;
  box.querySelectorAll('.task[data-id]').forEach(function (li) { li.draggable = true; });
}
actions.tlayout = function (el) { state.ui.taskLayout = el.dataset.l; save(); haptic(5); renderTaskList(); };

// ---------- Board ----------
function renderTaskBoard() {
  const today = midnight(now());
  const heads = stackHeads();
  const open = liveTasks().filter(function (t) { return listVisible(t) && !t.done && !stackHidden(t, heads); });
  const dayOf = function (t) { const d = taskDate(t); return d === null ? null : midnight(d); };
  const cols = [];
  const late = open.filter(function (t) { return !t.someday && dayOf(t) !== null && dayOf(t) < today; }).sort(function (a, b) { return taskDate(a) - taskDate(b); });
  if (late.length) cols.push({ title: 'Overdue', sub: late.length + ' late', tasks: late, cls: 'late', btn: '<button class="btn small" data-action="movetoday">All to today</button>' });
  cols.push({ title: 'Today', sub: new Date(today).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' }), drop: 'day:' + today, add: today, cls: 'today',
    tasks: sortByDay(open.filter(function (t) { return dayOf(t) === today; })),
    extra: { title: 'No date', drop: 'nodate', tasks: open.filter(function (t) { return dayOf(t) === null && !t.someday; }) } });
  for (let i = 1; i <= 6; i++) {
    const d = addDays(today, i);
    cols.push({ title: i === 1 ? 'Tomorrow' : dayName(d, 'long'), sub: new Date(d).toLocaleDateString([], { day: 'numeric', month: 'short' }), drop: 'day:' + d, add: d,
      cls: isOffDay(d) ? 'off' : '', tasks: sortByDay(open.filter(function (t) { return dayOf(t) === d; })) });
  }
  cols.push({ title: 'Later', sub: 'more than a week away', drop: 'later', tasks: open.filter(function (t) { return !t.someday && dayOf(t) !== null && dayOf(t) > addDays(today, 6); }).sort(function (a, b) { return taskDate(a) - taskDate(b); }) });
  cols.push({ title: 'Someday', sub: 'ideas, no date', drop: 'someday', tasks: open.filter(function (t) { return t.someday; }) });
  function rows(list, day) { return list.map(function (t) { return taskHTML(t, { box: true, day: day }); }).join(''); }
  $('taskBoard').innerHTML = '<div class="tbcols">' + cols.map(function (c) {
    const day = c.drop && c.drop.indexOf('day:') === 0 ? Number(c.drop.slice(4)) : undefined;
    return '<section class="tbcol' + (c.cls ? ' ' + c.cls : '') + '"' + (c.drop ? ' data-tpdrop="' + c.drop + '"' : '') + '>' +
      '<header><div><h3>' + c.title + '</h3><span class="small">' + esc(c.sub) + '</span></div><span class="count">' + c.tasks.length + '</span>' +
      (c.add !== undefined ? '<button class="icon-btn sm" data-action="tbadd" data-d="' + c.add + '" aria-label="Add a task on ' + esc(c.title) + '">+</button>' : '') + '</header>' +
      (c.btn || '') +
      '<ul class="tasks list">' + (rows(c.tasks, day) || '<li class="empty">' + (c.drop ? 'Drop tasks here' : 'Nothing') + '</li>') + '</ul>' +
      (c.extra ? '<div class="tbsub" data-tpdrop="' + c.extra.drop + '"><h4>' + c.extra.title + ' <span class="count">' + c.extra.tasks.length + '</span></h4><ul class="tasks list">' +
        (rows(c.extra.tasks) || '<li class="empty">Drop here to take the date away</li>') + '</ul></div>' : '') +
      '</section>';
  }).join('') + '</div>';
  tpDraggable($('taskBoard'));
}
actions.tbadd = function (el) { openAddSheet(null, { date: Number(el.dataset.d) }); };
attachTaskGestures($('taskBoard'), 'menu');

// ---------- the side panel ----------
function renderTaskPane() {
  const pane = $('taskPane');
  const on = paneOn();
  pane.hidden = !on;
  if (!on) return;
  if (sheetCtx && sheetCtx.docked) {
    const t = findTask(sheetCtx.id);
    if (!t || t.deleted) { closeSheet(); return; }
    // something changed it elsewhere (ticked in the list, synced): redraw it. Not while you're using it:
    // its own buttons redraw it, and redrawing mid-click would swallow the click.
    if (!$('sheet').contains(document.activeElement) && now() - tpSheetUsedAt > 1500) refreshSheet(taskSheetHTML(t));
    return;
  }
  renderTaskPaneBody();
}
function renderTaskPaneBody() {
  if (sheetCtx && sheetCtx.docked) return;
  const tab = state.ui.taskPane === 'cal' ? 'cal' : 'today';
  const old = $('tptScroll');
  if (old) tpScrollY = old.scrollTop;
  $('taskPaneBody').innerHTML = '<div class="seg tptabs"><button class="' + (tab === 'today' ? 'on' : '') + '" data-action="tptab" data-t="today">Today</button>' +
    '<button class="' + (tab === 'cal' ? 'on' : '') + '" data-action="tptab" data-t="cal">Calendar</button></div>' +
    (tab === 'today' ? tpTodayHTML() : tpCalHTML());
  const box = $('tptScroll');
  if (box) {
    if (tpScrollY !== null) box.scrollTop = tpScrollY;
    else { const hrs = calHours(); box.scrollTop = Math.max(0, (now() - midnight(now())) / HOUR - 1.5 - hrs.from) * HOUR_PX; tpScrollY = box.scrollTop; }
  }
  tpDraggable($('taskPaneBody'));
}
actions.tptab = function (el) { state.ui.taskPane = el.dataset.t; save(); tpScrollY = null; renderTaskPaneBody(); };

// Today: progress, Top 3, habits, and the timeline
function tpTodayHTML() {
  const today = midnight(now());
  const doneN = completionsByDay()[dayKey()] || 0;
  const goal = state.settings.dailyGoal || 5;
  const focus = liveSessions().filter(function (s) { return s.day === dayKey(); }).reduce(function (a, s) { return a + (s.minutes || 0); }, 0);
  const left = liveTasks().filter(function (t) { const d = taskDate(t); return !t.done && !t.someday && listVisible(t) && (d === null || midnight(d) <= today); }).length;
  const top = liveTasks().filter(function (t) { return isTop(t); });
  let h = '<section class="tpcard tpdash"><div class="tpring">' + ringSVG(doneN / goal) + '<b>' + doneN + '</b></div>' +
    '<div class="tpdash-t"><b>' + doneN + ' of ' + goal + ' done today</b><span class="small">' + left + ' still to do · ' + fmtEst(focus) + ' focused</span>' +
    '<span class="small">' + (doneN >= goal ? 'Daily goal reached. 🎉' : (goal - doneN) + ' more for your daily goal') + '</span></div></section>';
  h += '<section class="tpcard"><h3>Top 3 today</h3>' + (top.length
    ? '<ul class="tptop">' + top.map(function (t) {
        return '<li class="' + (t.done ? 'done' : '') + '"><button class="tg-check q' + (t.q || 0) + '" data-action="toggle" data-id="' + t.id + '" aria-label="' + (t.done ? 'Mark not done' : 'Mark done') + '"></button>' +
          '<button class="linkish" data-action="open" data-id="' + t.id + '">' + esc(t.title) + '</button></li>';
      }).join('') + '</ul>'
    : '<p class="small">Star up to 3 tasks as today\'s most important (open a task → Top 3 today, or use Plan my day).</p>') + '</section>';
  const c = habitCount(today);
  if (c.total) h += '<section class="tpcard"><h3>Habits <span class="small">' + c.done + '/' + c.total + '</span></h3><div class="cal-habs">' + c.habits.map(function (hb) {
    const on = isOn(hb, c.key);
    return '<button class="calhab' + (on ? ' on' : '') + '" style="--hc:' + hb.color + '" data-action="tphab" data-id="' + hb.id + '" data-day="' + c.key + '" aria-pressed="' + on + '">' + (on ? '✓ ' : '') + esc(hb.name) + '</button>';
  }).join('') + '</div></section>';
  h += '<section class="tpcard tptl"><h3>Today\'s timeline</h3><p class="small">Drag a task from the list onto an hour to plan it. Click an empty hour to add one.' +
    (state.settings.calCt !== false ? ' The thin coloured bar is what you painted in ColorTracker.' : '') + '</p>' + tpTimelineHTML() + '</section>';
  return h;
}
function tpTimelineHTML() {
  const today = midnight(now());
  const hrs = calHours();
  const top0 = hrs.from * 60, bottom = hrs.to * 60;
  const items = liveTasks().filter(function (t) { return listVisible(t) && isTimedOn(t, today); }).map(function (t) {
    const s = Math.round((t.due - today) / MIN) - top0;
    return { t: t, s: s, e: Math.min(s + (t.est || 60), bottom - top0) };
  }).filter(function (it) { return it.s >= 0 && it.s < bottom - top0; }).sort(function (a, b) { return a.s - b.s; });
  layoutLanes(items);
  let hours = '';
  for (let hh = hrs.from + 1; hh < hrs.to; hh++) hours += '<span class="tg-h" style="top:' + (hh - hrs.from) * HOUR_PX + 'px">' + calHourText(hh) + '</span>';
  const ct = ctColHTML(today, today, hrs);
  const blocks = items.map(function (it) {
    const t = it.t;
    return '<div class="tg-task tpt-block q' + (t.q || 0) + (t.done ? ' done' : '') + '" data-id="' + t.id + '" style="--lc:' + listOf(t).color + ';top:' + (it.s / 60 * HOUR_PX) + 'px;height:' + Math.max(22, (it.e - it.s) / 60 * HOUR_PX - 2) + 'px;' +
      'left:calc(var(--tl) + ' + it.lane + ' * (100% - var(--tl)) / ' + it.n + ');width:calc((100% - var(--tl)) / ' + it.n + ' - 3px)">' +
      '<button class="tg-check" data-action="toggle" data-id="' + t.id + '" aria-label="' + (t.done ? 'Mark not done' : 'Mark done') + '"></button>' +
      '<button class="tg-open" data-action="open" data-id="' + t.id + '"><span class="tt">' + esc(t.title) + '</span><span class="tm">' + fmtTime(t.due) + ' – ' + fmtTime(t.due + (t.est || 60) * MIN) + '</span></button></div>';
  }).join('');
  const nowMin = (now() - today) / MIN;
  const line = nowMin >= top0 && nowMin < bottom ? '<span class="tg-now" style="top:' + ((nowMin - top0) / 60 * HOUR_PX) + 'px"></span>' : '';
  return '<div class="tpt-scroll" id="tptScroll"><div class="tpt-body" style="height:' + (hrs.to - hrs.from) * HOUR_PX + 'px">' +
    '<div class="tg-hours">' + hours + '</div><div class="tg-col tpt-grid' + (ct ? ' ctcol' : '') + '" data-day="' + today + '">' + ct + blocks + line + '</div></div></div>';
}
actions.tphab = function (el) { tickHabit(el.dataset.id, el.dataset.day); renderTaskPaneBody(); };
// click an empty hour on the timeline: add a task at that time
$('taskPane').addEventListener('click', function (e) {
  const grid = e.target.closest('.tpt-grid');
  if (!grid || e.target.closest('.tpt-block')) return;
  const hrs = calHours();
  const y = e.clientY - grid.getBoundingClientRect().top;
  const mins = Math.max(hrs.from * 60, Math.min(hrs.to * 60 - 30, hrs.from * 60 + Math.floor(y / HOUR_PX * 2) * 30));
  openAddSheet(null, { date: midnight(now()), time: String(Math.floor(mins / 60)).padStart(2, '0') + ':' + String(mins % 60).padStart(2, '0') });
});

// Calendar: a small month, the next 7 days and the picked day's tasks
function tpCalHTML() {
  const today = midnight(now());
  if (tpDay === null) tpDay = today;
  if (tpMonth === null) tpMonth = monthStart(tpDay);
  const per = {};
  liveTasks().forEach(function (t) {
    const d = taskDate(t);
    if (d === null || t.done || !listVisible(t)) return;
    (per[midnight(d)] = per[midnight(d)] || []).push(t);
  });
  const firstWd = state.settings.calWeekStart === 0 ? 0 : 1;
  const lead = (new Date(tpMonth).getDay() - firstWd + 7) % 7;
  const inMonth = new Date(new Date(tpMonth).getFullYear(), new Date(tpMonth).getMonth() + 1, 0).getDate();
  let cells = weekdayHeads('jwd');
  for (let i = 0; i < lead; i++) cells += '<span></span>';
  for (let day = 1; day <= inMonth; day++) {
    const d = new Date(new Date(tpMonth).getFullYear(), new Date(tpMonth).getMonth(), day).getTime();
    const n = (per[d] || []).length;
    cells += '<button class="jday' + (d === today ? ' today' : '') + (d === tpDay ? ' sel' : '') + (n ? ' has' : '') + (isOffDay(d) ? ' off' : '') + (d < today && n ? ' late' : '') +
      '" data-action="tpday" data-d="' + d + '" data-tpdrop="day:' + d + '" title="' + n + (n === 1 ? ' task' : ' tasks') + '">' + day + '</button>';
  }
  let h = '<section class="tpcard"><div class="peek-head"><button class="icon-btn sm" data-action="tpmstep" data-d="-1" aria-label="Previous month">‹</button>' +
    '<div><h3>' + new Date(tpMonth).toLocaleDateString([], { month: 'long', year: 'numeric' }) + '</h3></div>' +
    '<button class="icon-btn sm" data-action="tpmstep" data-d="1" aria-label="Next month">›</button></div><div class="jgrid">' + cells + '</div>' +
    '<p class="small">Drop a task on a day to move it there.</p></section>';
  h += '<section class="tpcard"><h3>Next 7 days</h3><div class="tp7">' + [0, 1, 2, 3, 4, 5, 6].map(function (i) {
    const d = addDays(today, i);
    const list = per[d] || [];
    return '<button class="tp7d' + (d === tpDay ? ' sel' : '') + (isOffDay(d) ? ' off' : '') + '" data-action="tpday" data-d="' + d + '" data-tpdrop="day:' + d + '">' +
      '<b>' + (i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : dayName(d, 'short')) + '</b><span class="small">' + new Date(d).getDate() + '</span>' +
      '<span class="tp7n">' + (list.length ? list.length : '–') + '</span>' +
      '<span class="tp7t">' + esc(list.slice(0, 2).map(function (t) { return t.title; }).join(' · ')) + '</span></button>';
  }).join('') + '</div></section>';
  const dayList = sortByDay(liveTasks().filter(function (t) { const d = taskDate(t); return d !== null && midnight(d) === tpDay && listVisible(t); }));
  h += '<section class="tpcard" data-tpdrop="day:' + tpDay + '"><div class="tpday-h"><h3>' + calDayLabel(tpDay) + ', ' + new Date(tpDay).toLocaleDateString([], { day: 'numeric', month: 'long' }) + '</h3>' +
    '<button class="icon-btn sm" data-action="tbadd" data-d="' + tpDay + '" aria-label="Add a task on this day">+</button></div>' +
    '<ul class="tasks list">' + (dayList.filter(function (t) { return !t.done; }).concat(dayList.filter(function (t) { return t.done; })).map(function (t) { return taskHTML(t, { box: true, day: tpDay }); }).join('') ||
      '<li class="empty">Nothing on this day.</li>') + '</ul>' +
    '<button class="linkbtn" data-action="tpopencal" data-d="' + tpDay + '">Open this day in the Calendar</button></section>';
  return h;
}
actions.tpday = function (el) { tpDay = Number(el.dataset.d); if (monthStart(tpDay) !== tpMonth) tpMonth = monthStart(tpDay); haptic(4); renderTaskPaneBody(); };
actions.tpmstep = function (el) { tpMonth = addMonths(tpMonth, Number(el.dataset.d)); renderTaskPaneBody(); };
actions.tpopencal = function (el) { const d = Number(el.dataset.d); calSel = d; calAnchor = d; showView('calendar'); };

// ---------- drag and drop (list ↔ timeline ↔ days ↔ board) ----------
// Where would a drop land? A time on the timeline, or a day / "no date" / "later" / "someday" target.
function tpZone(el, y) {
  if (!el || !el.closest) return null;
  const grid = el.closest('.tpt-grid');
  if (grid) {
    const hrs = calHours();
    const yy = y - grid.getBoundingClientRect().top;
    const mins = Math.max(hrs.from * 60, Math.min(hrs.to * 60 - 15, hrs.from * 60 + Math.floor(yy / HOUR_PX * 4) * 15));
    return { kind: 'time', el: grid, day: Number(grid.dataset.day), mins: mins };
  }
  const z = el.closest('[data-tpdrop]');
  if (!z) return null;
  const v = z.dataset.tpdrop;
  if (v.indexOf('day:') === 0) return { kind: 'day', el: z, day: Number(v.slice(4)) };
  return { kind: v, el: z };
}
function tpDropTask(id, z) {
  const t = findTask(id);
  if (!t || !z) return;
  const today = midnight(now());
  const before = JSON.stringify([t.due, t.hasTime, t.someday]);
  snapshot('Moved task');
  if (z.kind === 'time') calPlaceTask(t, z.day, z.mins, false);
  else if (z.kind === 'day') calPlaceTask(t, z.day, null, false);
  else if (z.kind === 'later') calPlaceTask(t, addDays(today, 7), null, false);
  else { t.due = null; t.hasTime = false; t.endDate = null; t.someday = z.kind === 'someday'; t.updatedAt = now(); }
  if (JSON.stringify([t.due, t.hasTime, t.someday]) === before) { undoStack.pop(); return; }
  save();
  renderTaskViews();
  sound('soft');
  toast(z.kind === 'someday' ? 'Moved to Someday' : z.kind === 'nodate' ? 'No date now: it shows in Today' :
    'Moved to ' + tpShort(t.due) + (t.hasTime ? ', ' + fmtTime(t.due) : '') + (z.kind === 'later' ? '. Change the date in the task if you like.' : ''), { undo: true });
}
function tpClearDrop() {
  document.querySelectorAll('.tpdrop-on').forEach(function (x) { x.classList.remove('tpdrop-on'); });
  if ($('tpInd')) $('tpInd').remove();
}
document.addEventListener('dragstart', function (e) {
  const el = e.target.closest && e.target.closest('#view-tasks .task[data-id], #view-tasks .tpt-block[data-id]');
  if (!el) return;
  tpDragId = el.dataset.id;
  const t = findTask(tpDragId);
  e.dataTransfer.effectAllowed = 'move';
  try { e.dataTransfer.setData('text/plain', t ? t.title : ''); } catch (err) {}
  setTimeout(function () { el.classList.add('tpdrag-src'); }, 0);
  document.body.classList.add('tp-dragging');
});
document.addEventListener('dragend', function () {
  tpDragId = null;
  tpClearDrop();
  document.querySelectorAll('.tpdrag-src').forEach(function (x) { x.classList.remove('tpdrag-src'); });
  document.body.classList.remove('tp-dragging');
});
document.addEventListener('dragover', function (e) {
  if (!tpDragId) return;
  const z = tpZone(e.target, e.clientY);
  if (!z) { tpClearDrop(); return; }
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  if (!z.el.classList.contains('tpdrop-on')) { tpClearDrop(); z.el.classList.add('tpdrop-on'); }
  if (z.kind === 'time') {
    let ind = $('tpInd');
    if (!ind) { ind = document.createElement('div'); ind.id = 'tpInd'; ind.className = 'tg-drop'; }
    if (ind.parentElement !== z.el) z.el.appendChild(ind);
    const t = findTask(tpDragId);
    ind.style.top = ((z.mins - calHours().from * 60) / 60 * HOUR_PX) + 'px';
    ind.style.height = Math.max(20, (t && t.est ? t.est : 60) / 60 * HOUR_PX - 2) + 'px';
    ind.textContent = fmtTime(midnight(now()) + z.mins * MIN);
  } else if ($('tpInd')) $('tpInd').remove();
});
document.addEventListener('drop', function (e) {
  if (!tpDragId) return;
  const z = tpZone(e.target, e.clientY);
  const id = tpDragId;
  tpClearDrop();
  if (!z) return;
  e.preventDefault();
  tpDropTask(id, z);
});

['pointerdown', 'keydown', 'focusin'].forEach(function (type) {
  $('sheet').addEventListener(type, function () { if (sheetCtx && sheetCtx.docked) tpSheetUsedAt = now(); }, true);
});
