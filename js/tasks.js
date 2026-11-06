/* =========================================================
   Tasks: the main to-do list, grouped by date.
   Overdue · Today (plus everything with no date; top 3 first,
   "This evening" at the bottom) · Tomorrow · the next 5 days ·
   Scheduled (folded, more than a week away) · Someday (folded) ·
   Completed today · a link to the Logbook.
   Only the lists picked in the list bar are shown.
   Every row has a box button to sort it into the matrix.
   ========================================================= */

let listDate = null;                 // date chosen in the quick-add row (null = no date)
let listQ = null;                    // box chosen in the quick-add row (null = not sorted)

function sortByDay(list) {
  return list.slice().sort(function (a, b) {
    const ta = a.due !== null && a.hasTime ? a.due : Infinity;
    const tb = b.due !== null && b.hasTime ? b.due : Infinity;
    return (ta - tb) || ((a.q || 9) - (b.q || 9)) || (a.createdAt - b.createdAt);
  });
}

function renderListPick() {
  const today = midnight(now());
  const custom = listDate !== null && listDate !== today && listDate !== addDays(today, 1);
  let html = '<div class="pickrow">' +
    '<button type="button" class="pick' + (listDate === null ? ' on' : '') + '" data-action="ldate" data-d="none">No date</button>' +
    '<button type="button" class="pick' + (listDate === today ? ' on' : '') + '" data-action="ldate" data-d="0">Today</button>' +
    '<button type="button" class="pick' + (listDate === addDays(today, 1) ? ' on' : '') + '" data-action="ldate" data-d="1">Tomorrow</button>' +
    '<label class="pick datepick' + (custom ? ' on' : '') + '">' + CAL_SVG + '<span>' + (custom ? esc(fmtDue(listDate, false)) : 'Pick date') + '</span>' +
    '<input type="date" id="listDateInput" aria-label="Pick a date" value="' + (custom ? dayKey(listDate) : '') + '"></label>' +
    '</div><div class="pickrow">' +
    [0, 1, 2, 3, 4].map(function (q) {
      return '<button type="button" class="qchip q' + q + ((listQ || 0) === q ? ' on' : '') + '" data-action="lbox" data-q="' + q + '">' + esc(boxName(q)) + '</button>';
    }).join('') + '</div>';
  $('taskPick').innerHTML = html;
}

function renderListParse() {
  const text = $('taskInput').value;
  const chips = text.trim() ? quickAddChips(parseQuickAdd(text)) : [];
  $('taskParse').innerHTML = chips.map(function (c) { return '<span class="chip">' + esc(c) + '</span>'; }).join('');
}

function addFromList() {
  const input = $('taskInput');
  const raw = input.value.trim();
  if (!raw) return;
  const p = parseQuickAdd(raw);
  const due = p.due !== null ? p.due : listDate;
  const task = newTask(p.title || raw, p.q || listQ, { due: due, hasTime: p.due !== null && p.hasTime, tags: p.tags });
  if (p.repeat) setupRepeat(task, p.repeat);
  finishNewTask(task, p);
  snapshot('Added task');
  state.tasks.push(task);
  save();
  input.value = '';
  renderListParse();
  renderTaskViews();
  sound('soft');
  const li = document.querySelector('#taskList .task[data-id="' + task.id + '"]');
  if (li) {
    li.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    if (li.animate) li.animate([{ transform: 'scale(0.94)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 280, easing: 'cubic-bezier(0.34,1.56,0.64,1)' });
  }
  if (task.repeat) explainNewRepeat(task);
  else if (!listVisible(task)) toast('Added to ' + listOf(task).name + ' (hidden by the list filter)');
  else if (task.someday) toast('Added to Someday, at the bottom of the list');
  else if (due !== null && midnight(due) > addDays(midnight(now()), 1)) toast('Added for ' + fmtDue(due, task.hasTime));
  if (!task.repeat || state.ui.repeatExplainOff) input.focus();
}

function groupHTML(title, sub, tasks, opts) {
  opts = opts || {};
  let rows = tasks.length
    ? tasks.map(function (t) { return taskHTML(t, { box: true, day: opts.day }); }).join('')
    : '<li class="empty">' + (opts.empty || 'Nothing here.') + '</li>';
  if (opts.evening && opts.evening.length) {         // Today: "This evening" sits at the bottom of the day
    rows = (tasks.length ? rows : '') + '<li class="subhead">This evening</li>' + opts.evening.map(function (t) { return taskHTML(t, { box: true, day: opts.day }); }).join('');
  }
  return '<section class="lgroup' + (opts.cls ? ' ' + opts.cls : '') + '">' +
    '<header><div><h3>' + title + '</h3>' + (sub ? '<span class="small">' + sub + '</span>' : '') + '</div>' +
    (opts.action || '') + '<span class="count">' + (tasks.length + (opts.evening ? opts.evening.length : 0)) + '</span></header>' +
    '<ul class="tasks list">' + rows + '</ul></section>';
}

function renderTaskList() {
  const today = midnight(now());
  const all = liveTasks();
  const heads = stackHeads();
  const shown = all.filter(function (t) { return listVisible(t); });
  const notDone = shown.filter(function (t) { return !t.done && !stackHidden(t, heads); });   // stacked copies show once, as "3 stacked"
  const open = notDone.filter(function (t) { return !t.someday; });
  const someday = notDone.filter(function (t) { return t.someday; });
  const dayOf = function (t) { const d = taskDate(t); return d === null ? null : midnight(d); };
  let html = '';

  const overdue = open.filter(function (t) { return dayOf(t) !== null && dayOf(t) < today; });
  if (overdue.length) {
    html += groupHTML('Overdue', '', sortByDay(overdue).sort(function (a, b) { return taskDate(a) - taskDate(b); }),
      { cls: 'late', action: '<button class="btn small" data-action="movetoday">Move to today</button>' });
  }
  const todays = open.filter(function (t) { return dayOf(t) === null || dayOf(t) === today; });
  const isEvening = function (t) { return t.evening || (t.due !== null && t.hasTime && new Date(t.due).getHours() >= 18); };
  const topFirst = function (list) { return list.filter(isTop).concat(list.filter(function (t) { return !isTop(t); })); };
  const dayPart = sortByDay(todays.filter(function (t) { return !isEvening(t); }));
  const evePart = sortByDay(todays.filter(isEvening));
  html += groupHTML('Today', new Date(today).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' }), topFirst(dayPart),
    { day: today, evening: topFirst(evePart), empty: evePart.length ? 'Nothing before the evening.' : 'Nothing for today. Add something above, or enjoy it.' });
  for (let i = 1; i <= 6; i++) {
    const d = addDays(today, i);
    const list = open.filter(function (t) { return dayOf(t) === d; });
    if (!list.length) continue;
    const title = i === 1 ? 'Tomorrow' : new Date(d).toLocaleDateString([], { weekday: 'long' });
    html += groupHTML(title, new Date(d).toLocaleDateString([], { day: 'numeric', month: 'short' }), sortByDay(list), { day: d });
  }
  const later = open.filter(function (t) { return dayOf(t) !== null && dayOf(t) > addDays(today, 6); })
    .sort(function (a, b) { return taskDate(a) - taskDate(b); });
  if (later.length) {                               // folded away so they can't be ticked by accident
    const show = !!state.ui.showScheduled;
    const first = new Date(taskDate(later[0])).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
    html += '<section class="lgroup scheduled"><button class="done-toggle" data-action="showscheduled" aria-expanded="' + show + '">' + CHEVRON_SVG +
      'Scheduled · ' + later.length + '<span class="small"> next: ' + first + ' · each moves up a week before</span></button>' +
      (show ? '<ul class="tasks list">' + later.map(function (t) { return taskHTML(t, { box: true }); }).join('') + '</ul>' : '') + '</section>';
  }

  if (someday.length) {                             // Things-style: ideas with no date, out of the way
    const show = !!state.ui.showSomeday;
    html += '<section class="lgroup someday"><button class="done-toggle" data-action="showsomeday" aria-expanded="' + show + '">' + CHEVRON_SVG +
      'Someday · ' + someday.length + '<span class="small"> no date, not in Today or the Matrix</span></button>' +
      (show ? '<ul class="tasks list">' + someday.map(function (t) { return taskHTML(t, { box: true }); }).join('') + '</ul>' : '') + '</section>';
  }

  const doneToday = shown.filter(function (t) { return t.done && t.doneAt && midnight(t.doneAt) === today; })
    .sort(function (a, b) { return b.doneAt - a.doneAt; });
  if (doneToday.length) {
    const show = !!state.ui.showDoneList;
    html += '<section class="lgroup"><button class="done-toggle" data-action="showdonelist" aria-expanded="' + show + '">' + CHEVRON_SVG + 'Completed today · ' + doneToday.length + '</button>' +
      (show ? '<ul class="tasks list">' + doneToday.map(function (t) { return taskHTML(t, { box: true }); }).join('') + '</ul>' : '') + '</section>';
  }
  html += '<div class="list-foot"><button class="linkbtn" data-action="logbook">Logbook</button><span class="small">every task you\'ve finished</span></div>';
  $('taskList').innerHTML = html;
}

// ---------- actions ----------
actions.ldate = function (el) {
  const d = el.dataset.d;
  listDate = d === 'none' ? null : addDays(midnight(now()), Number(d));
  renderListPick();
};
actions.lbox = function (el) { const q = Number(el.dataset.q); listQ = q || null; renderListPick(); };
actions.showscheduled = function () { state.ui.showScheduled = !state.ui.showScheduled; save(); renderTaskList(); };
actions.showsomeday = function () { state.ui.showSomeday = !state.ui.showSomeday; save(); renderTaskList(); };
actions.showdonelist = function () { state.ui.showDoneList = !state.ui.showDoneList; save(); renderTaskList(); };
actions.movetoday = function () {
  const today = midnight(now());
  const late = liveTasks().filter(function (t) { const d = taskDate(t); return !t.done && !t.someday && listVisible(t) && d !== null && midnight(d) < today; });
  if (!late.length) return;
  snapshot('Moved overdue tasks to today');
  late.forEach(function (t) {
    if (t.due !== null) {
      const mins = t.hasTime ? (new Date(t.due).getHours() * 60 + new Date(t.due).getMinutes()) : 0;
      t.due = today + mins * MIN;
    } else t.due = today;
    t.updatedAt = now();
  });
  save();
  renderTaskViews();
  haptic(12);
  toast(late.length + (late.length === 1 ? ' task' : ' tasks') + ' moved to today', { undo: true });
};
$('taskPick').addEventListener('change', function (e) {
  if (e.target.id !== 'listDateInput' || !e.target.value) return;
  listDate = new Date(e.target.value + 'T00:00').getTime();
  renderListPick();
});
$('taskForm').addEventListener('submit', function (e) { e.preventDefault(); addFromList(); });
$('taskInput').addEventListener('input', renderListParse);
attachTaskGestures($('taskList'), 'menu');
