/* =========================================================
   Calendar: a month of dots. Tap a date to see its tasks and
   add new ones straight onto that date. Swipe to change month.
   ========================================================= */

let calMonth = null;                         // first day of the month on screen
let calSel = null;                           // selected day (midnight)

function monthStart(t) { const d = new Date(t); d.setDate(1); d.setHours(0, 0, 0, 0); return d.getTime(); }
function addMonths(t, n) { const d = new Date(t); d.setMonth(d.getMonth() + n); return d.getTime(); }

function tasksByDay() {
  const map = {};
  liveTasks().forEach(function (t) {
    const d = taskDate(t);
    if (d === null) return;
    const k = midnight(d);
    (map[k] = map[k] || []).push(t);
  });
  return map;
}

function renderCalendar() {
  const today = midnight(now());
  if (calSel === null) calSel = today;
  if (calMonth === null) calMonth = monthStart(calSel);
  const map = tasksByDay();
  $('calTitle').textContent = new Date(calMonth).toLocaleDateString([], { month: 'long', year: 'numeric' });
  $('calToday').disabled = calSel === today && calMonth === monthStart(today);

  const first = new Date(calMonth);
  const lead = (first.getDay() + 6) % 7;                    // weeks start on Monday
  const start = addDays(calMonth, -lead);
  let html = ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map(function (d) { return '<span class="cwd">' + d + '</span>'; }).join('');
  for (let i = 0; i < 42; i++) {
    const d = addDays(start, i);
    const list = map[d] || [];
    const open = list.filter(function (t) { return !t.done; });
    const hasDeadline = list.some(function (t) { return t.deadline && midnight(t.deadline) === d && !t.done; });
    let dots = open.slice(0, 4).map(function (t) { return '<i class="q' + (t.q || 0) + '"></i>'; }).join('');
    if (open.length > 4) dots += '<b>+' + (open.length - 4) + '</b>';
    if (!open.length && list.length) dots = '<i class="donedot"></i>';
    const inMonth = new Date(d).getMonth() === first.getMonth();
    html += '<button class="cday' + (inMonth ? '' : ' out') + (d === today ? ' today' : '') + (d === calSel ? ' sel' : '') + (d < today && open.length ? ' late' : '') +
      '" data-action="calpick" data-d="' + d + '" aria-label="' + new Date(d).toDateString() + ', ' + open.length + ' open tasks">' +
      '<span class="num">' + new Date(d).getDate() + (hasDeadline ? '<em class="dlflag">' + FLAG_SVG + '</em>' : '') + '</span><span class="cdots">' + dots + '</span></button>';
  }
  $('calGrid').innerHTML = html;

  // the selected day
  const list = (map[calSel] || []).slice();
  if (calSel === today) liveTasks().forEach(function (t) { if (taskDate(t) === null && !t.done) list.push(t); });
  const open = sortByDay(list.filter(function (t) { return !t.done; }));
  const done = list.filter(function (t) { return t.done; });
  const label = calSel === today ? 'Today' : (calSel === addDays(today, 1) ? 'Tomorrow' : new Date(calSel).toLocaleDateString([], { weekday: 'long' }));
  $('calDayTitle').textContent = label + ', ' + new Date(calSel).toLocaleDateString([], { day: 'numeric', month: 'long' });
  $('calDaySub').textContent = open.length + ' to do' + (done.length ? ' · ' + done.length + ' done' : '') + (calSel === today ? ' · includes tasks with no date' : '');
  $('calInput').placeholder = 'Add to ' + (calSel === today ? 'today' : new Date(calSel).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })) + ' (try "5pm !1")';
  $('calList').innerHTML = open.concat(done).map(function (t) { return taskHTML(t, { box: true, day: calSel }); }).join('') ||
    '<li class="empty">' + (calSel < today ? 'Nothing was planned for this day.' : 'Free day. Add a task above.') + '</li>';
}

function selectDay(d) {
  calSel = d;
  if (monthStart(d) !== calMonth) calMonth = monthStart(d);
  haptic(5);
  renderCalendar();
}

// A typed date wins; otherwise the task goes on the selected day (keeping a typed time).
function calDue(p, raw) {
  if (p.date !== null && p.date !== midnight(now())) return p.due;
  if (p.date !== null && /\b(today|tod|tonight)\b/i.test(raw)) return p.due;
  return calSel + (p.time !== null ? p.time * MIN : 0);
}
function addFromCalendar() {
  const input = $('calInput');
  const raw = input.value.trim();
  if (!raw) return;
  const p = parseQuickAdd(raw);
  const due = calDue(p, raw);
  const task = newTask(p.title || raw, p.q, { due: due, hasTime: p.hasTime, tags: p.tags });
  snapshot('Added task');
  state.tasks.push(task);
  save();
  input.value = '';
  $('calParse').innerHTML = '';
  if (midnight(due) !== calSel) selectDay(midnight(due));
  renderTaskViews();
  sound('soft');
  const li = document.querySelector('#calList .task[data-id="' + task.id + '"]');
  if (li && li.animate) li.animate([{ transform: 'scale(0.94)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 280, easing: 'cubic-bezier(0.34,1.56,0.64,1)' });
  input.focus();
}

// ---------- actions ----------
actions.calpick = function (el) { selectDay(Number(el.dataset.d)); };
actions.calprev = function () { calMonth = addMonths(calMonth, -1); renderCalendar(); };
actions.calnext = function () { calMonth = addMonths(calMonth, 1); renderCalendar(); };
actions.caltoday = function () { selectDay(midnight(now())); };
$('calForm').addEventListener('submit', function (e) { e.preventDefault(); addFromCalendar(); });
$('calInput').addEventListener('input', function () {
  const text = $('calInput').value;
  const p = text.trim() ? parseQuickAdd(text) : null;
  let chips = [];
  if (p) { chips = quickAddChips(Object.assign({}, p, { due: calDue(p, text) })); }
  $('calParse').innerHTML = chips.map(function (c) { return '<span class="chip">' + esc(c) + '</span>'; }).join('');
});
attachTaskGestures($('calList'), 'menu');

// swipe the month left / right
(function () {
  const grid = $('calGrid');
  let sx = null, sy = null;
  grid.addEventListener('touchstart', function (e) { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
  grid.addEventListener('touchend', function (e) {
    if (sx === null) return;
    const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
    sx = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      calMonth = addMonths(calMonth, dx < 0 ? 1 : -1);
      haptic(6);
      renderCalendar();
      grid.animate && grid.animate([{ transform: 'translateX(' + (dx < 0 ? 24 : -24) + 'px)', opacity: 0.4 }, { transform: 'none', opacity: 1 }], { duration: 220, easing: 'ease-out' });
    }
  });
})();
