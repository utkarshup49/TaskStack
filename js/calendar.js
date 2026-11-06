/* =========================================================
   Calendar: six ways to look at your tasks (switch at the top).
   - Day, 3 days, Week: an hour-by-hour grid. A task with a time sits
     at that time (drawn 1 hour tall); tasks with only a date or a
     deadline go in the "All day" row. Tap an empty slot to add a
     task at that time. Tap a day's heading to open that day.
   - 2 weeks, Month: a grid of days. Task names on a laptop, dots on
     a phone. Tap a day to see its tasks in the side card.
   - Year: all 12 months, just the calendar. Tap a day to see it.
   Days off (Sat + Sun unless changed in Settings) are shaded.
   Only the lists picked in the list bar are shown; each task carries its list's colour.
   Weeks start on Monday.
   ========================================================= */

const CAL_MODES = [
  { id: 'day', label: 'Day' }, { id: '3day', label: '3 days' }, { id: 'week', label: 'Week' },
  { id: '2week', label: '2 weeks' }, { id: 'month', label: 'Month' }, { id: 'year', label: 'Year' }
];
const TIMED_MODES = { day: 1, '3day': 3, week: 7 };   // modes with an hour grid, and how many days they show
const HOUR_PX = 52;                                     // height of one hour in the hour grid

let calAnchor = null;      // a day inside the period on screen
let calSel = null;         // the selected day (its tasks show in the side card)
let calScrolled = '';      // the hour-grid mode we've already scrolled to a sensible hour

function calMode() { return state.ui.calMode || 'month'; }
function monthStart(t) { const d = new Date(t); d.setDate(1); d.setHours(0, 0, 0, 0); return d.getTime(); }
function addMonths(t, n) { const d = new Date(t); d.setMonth(d.getMonth() + n); return d.getTime(); }
function weekStart(t) { const d = midnight(t); return addDays(d, -((new Date(d).getDay() + 6) % 7)); }
function isOffDay(t) { return (state.settings.offDays || []).indexOf(new Date(t).getDay()) !== -1; }
function dayName(t, len) { return new Date(t).toLocaleDateString([], { weekday: len }); }
function calHourText(h) { return new Date(2000, 0, 1, h).toLocaleTimeString([], { hour: 'numeric' }); }
function isTimedOn(t, d) { return t.due !== null && t.hasTime && midnight(t.due) === d; }

function tasksByDay() {
  const map = {};
  liveTasks().forEach(function (t) {
    const d = taskDate(t);
    if (d === null || !listVisible(t)) return;
    const k = midnight(d);
    (map[k] = map[k] || []).push(t);
  });
  return map;
}

// ---------- which days are on screen ----------
function calPeriod() {
  const m = calMode(), a = calAnchor;
  if (m === 'day') return { start: a, days: 1 };
  if (m === '3day') return { start: a, days: 3 };
  if (m === 'week') return { start: weekStart(a), days: 7 };
  if (m === '2week') return { start: weekStart(a), days: 14 };
  if (m === 'month') {
    const ms = monthStart(a);
    const start = weekStart(ms);
    const inMonth = new Date(new Date(ms).getFullYear(), new Date(ms).getMonth() + 1, 0).getDate();
    const lead = Math.round((ms - start) / DAY);
    return { start: start, days: Math.ceil((lead + inMonth) / 7) * 7, month: ms };
  }
  return { year: new Date(a).getFullYear() };
}
function periodHas(p, d) {
  if (p.year !== undefined) return new Date(d).getFullYear() === p.year;
  if (p.month !== undefined) return monthStart(d) === p.month;
  return d >= p.start && d < addDays(p.start, p.days);
}
// The heading above the calendar: a long form for laptops, a short one that fits a phone.
function calTitleHTML(p) {
  const m = calMode();
  function both(long, short) { return '<span class="wd-l">' + esc(long) + '</span><span class="wd-s">' + esc(short) + '</span>'; }
  if (m === 'year') return String(p.year);
  if (m === 'month') return both(new Date(p.month).toLocaleDateString([], { month: 'long', year: 'numeric' }), new Date(p.month).toLocaleDateString([], { month: 'short', year: 'numeric' }));
  if (m === 'day') return both(new Date(p.start).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' }), new Date(p.start).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }));
  const s = new Date(p.start), e = new Date(addDays(p.start, p.days - 1));
  const first = s.getMonth() === e.getMonth() ? s.getDate() : s.toLocaleDateString([], { day: 'numeric', month: 'short' });
  return both(first + ' – ' + e.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }), first + ' – ' + e.toLocaleDateString([], { day: 'numeric', month: 'short' }));
}
function calStep(dir) {
  const m = calMode();
  if (m === 'month') calAnchor = addMonths(monthStart(calAnchor), dir);
  else if (m === 'year') calAnchor = new Date(new Date(calAnchor).getFullYear() + dir, 0, 1).getTime();
  else calAnchor = addDays(calAnchor, dir * { day: 1, '3day': 3, week: 7, '2week': 14 }[m]);
  haptic(5);
  renderCalendar();
}

function renderCalendar() {
  const today = midnight(now());
  if (calSel === null) calSel = today;
  if (calAnchor === null) calAnchor = calSel;
  const m = calMode();
  const p = calPeriod();
  $('calTitle').innerHTML = calTitleHTML(p);
  $('calToday').disabled = calSel === today && periodHas(p, today);
  $('calModes').innerHTML = CAL_MODES.map(function (x) {
    return '<button class="' + (x.id === m ? 'on' : '') + '" data-action="calmode" data-m="' + x.id + '" aria-pressed="' + (x.id === m) + '">' + x.label + '</button>';
  }).join('');
  const timed = !!TIMED_MODES[m];
  $('calWrap').classList.toggle('timed', timed);
  if (timed) renderTimeGrid(p);
  else {
    calScrolled = '';
    if (m === 'year') renderYear(p.year); else renderDayGrid(p);
    renderDayCard();
  }
}

// ---------- weekday headings: a coloured band, "Mon" on a phone, "Monday" on a laptop ----------
function weekdayHeads(cls) {
  let html = '';
  const mon = weekStart(now());
  for (let i = 0; i < 7; i++) {
    const d = addDays(mon, i);
    html += '<span class="' + cls + (isOffDay(d) ? ' off' : '') + '"><span class="wd-s">' + dayName(d, 'short') + '</span><span class="wd-l">' + dayName(d, 'long') + '</span></span>';
  }
  return html;
}
function chipHTML(t, d, tag) {
  const time = isTimedOn(t, d) ? '<em>' + fmtTime(t.due) + '</em>' : '';
  const flag = t.deadline && midnight(t.deadline) === d && t.due === null ? '<i class="dlflag">' + FLAG_SVG + '</i>' : '';
  const attrs = tag === 'button' ? ' data-action="open" data-id="' + t.id + '"' : '';
  return '<' + tag + ' class="cchip q' + (t.q || 0) + (t.done ? ' done' : '') + '" style="--lc:' + listOf(t).color + '"' + attrs + '>' + flag + time + esc(t.title) + '</' + tag + '>';
}

// ---------- 2 weeks and Month ----------
function renderDayGrid(p) {
  const today = midnight(now());
  const map = tasksByDay();
  const m = calMode();
  const maxChips = m === 'month' ? 3 : 7;
  let html = weekdayHeads('cwd');
  for (let i = 0; i < p.days; i++) {
    const d = addDays(p.start, i);
    const list = map[d] || [];
    const open = sortByDay(list.filter(function (t) { return !t.done; }));
    const shown = open.concat(list.filter(function (t) { return t.done; }));
    const hasDeadline = list.some(function (t) { return t.deadline && midnight(t.deadline) === d && !t.done; });
    let dots = open.slice(0, 4).map(function (t) { return '<i class="q' + (t.q || 0) + '"></i>'; }).join('');
    if (open.length > 4) dots += '<b>+' + (open.length - 4) + '</b>';
    if (!open.length && list.length) dots = '<i class="donedot"></i>';
    let chips = shown.slice(0, maxChips).map(function (t) { return chipHTML(t, d, 'span'); }).join('');
    if (shown.length > maxChips) chips += '<span class="cmore">+' + (shown.length - maxChips) + ' more</span>';
    const out = p.month !== undefined && monthStart(d) !== p.month;
    const date = new Date(d);
    const num = date.getDate() === 1 || (m === '2week' && i === 0) ? date.toLocaleDateString([], { day: 'numeric', month: 'short' }) : date.getDate();
    html += '<button class="cday' + (out ? ' out' : '') + (d === today ? ' today' : '') + (d === calSel ? ' sel' : '') + (d < today && open.length ? ' late' : '') + (isOffDay(d) ? ' off' : '') +
      '" data-action="calpick" data-d="' + d + '" aria-label="' + date.toDateString() + ', ' + open.length + ' open tasks">' +
      '<span class="num">' + num + (hasDeadline ? '<em class="dlflag">' + FLAG_SVG + '</em>' : '') + '</span>' +
      '<span class="cdots">' + dots + '</span><span class="cchips">' + chips + '</span></button>';
  }
  $('calBody').innerHTML = '<div class="cal-grid" data-m="' + m + '">' + html + '</div>';
}

// ---------- Year: 12 small months ----------
function renderYear(year) {
  const today = midnight(now());
  const map = tasksByDay();
  let html = '';
  for (let mo = 0; mo < 12; mo++) {
    const ms = new Date(year, mo, 1).getTime();
    const lead = (new Date(ms).getDay() + 6) % 7;
    const inMonth = new Date(year, mo + 1, 0).getDate();
    let cells = '';
    const mon = weekStart(now());
    for (let i = 0; i < 7; i++) {
      const wd = addDays(mon, i);
      cells += '<span class="yh' + (isOffDay(wd) ? ' off' : '') + '">' + dayName(wd, 'narrow') + '</span>';
    }
    for (let i = 0; i < lead; i++) cells += '<span></span>';
    for (let day = 1; day <= inMonth; day++) {
      const d = new Date(year, mo, day).getTime();
      const has = (map[d] || []).some(function (t) { return !t.done; });
      cells += '<button class="yday' + (isOffDay(d) ? ' off' : '') + (d === today ? ' today' : '') + (d === calSel ? ' sel' : '') + (has ? ' has' : '') +
        '" data-action="calpick" data-d="' + d + '" aria-label="' + new Date(d).toDateString() + '">' + day + '</button>';
    }
    const isNow = monthStart(today) === ms;
    html += '<div class="ymonth' + (isNow ? ' now' : '') + '"><button class="ytitle" data-action="calopenmonth" data-d="' + ms + '">' +
      new Date(ms).toLocaleDateString([], { month: 'long' }) + '</button><div class="ygrid">' + cells + '</div></div>';
  }
  $('calBody').innerHTML = '<div class="cal-year">' + html + '</div>';
}

// ---------- Day, 3 days, Week: the hour grid ----------
// Tasks at overlapping times sit side by side: each gets a lane and knows how many lanes its group has.
function layoutLanes(items) {
  let group = [], groupEnd = -1, lanes = [];
  function closeGroup() { group.forEach(function (it) { it.n = lanes.length; }); group = []; lanes = []; }
  items.forEach(function (it) {
    if (it.s >= groupEnd) closeGroup();
    let lane = lanes.findIndex(function (end) { return end <= it.s; });
    if (lane === -1) { lane = lanes.length; lanes.push(it.e); } else lanes[lane] = it.e;
    it.lane = lane;
    group.push(it);
    groupEnd = Math.max(groupEnd, it.e);
  });
  closeGroup();
}
function renderTimeGrid(p) {
  const today = midnight(now());
  const map = tasksByDay();
  const days = [];
  for (let i = 0; i < p.days; i++) days.push(addDays(p.start, i));
  const old = $('tgScroll');
  const keepY = old && calScrolled === calMode() ? old.scrollTop : null;

  const head = '<div class="tg-row tg-head"><span class="tg-gut"></span>' + days.map(function (d) {
    return '<button class="tg-dh' + (d === today ? ' today' : '') + (isOffDay(d) ? ' off' : '') + '" data-action="calgoday" data-d="' + d + '" title="Open this day">' +
      '<span><span class="wd-s">' + dayName(d, 'short') + '</span><span class="wd-l">' + dayName(d, 'long') + '</span></span><b>' + new Date(d).getDate() + '</b></button>';
  }).join('') + '</div>';
  const allday = '<div class="tg-row tg-allday"><span class="tg-gut">All day</span>' + days.map(function (d) {
    const list = sortByDay((map[d] || []).filter(function (t) { return !isTimedOn(t, d); }));
    const max = p.days === 1 ? 6 : 3;
    return '<div class="tg-ad' + (isOffDay(d) ? ' off' : '') + '">' + list.slice(0, max).map(function (t) { return chipHTML(t, d, 'button'); }).join('') +
      (list.length > max ? '<button class="cmore" data-action="calgoday" data-d="' + d + '">+' + (list.length - max) + ' more</button>' : '') + '</div>';
  }).join('') + '</div>';

  let hours = '';
  for (let h = 1; h < 24; h++) hours += '<span class="tg-h" style="top:' + h * HOUR_PX + 'px">' + calHourText(h) + '</span>';
  const cols = days.map(function (d) {
    const items = (map[d] || []).filter(function (t) { return isTimedOn(t, d); }).map(function (t) {
      const s = Math.round((t.due - d) / MIN);
      return { t: t, s: s, e: Math.min(s + 60, 24 * 60) };
    }).sort(function (a, b) { return a.s - b.s || (a.t.q || 9) - (b.t.q || 9); });
    layoutLanes(items);
    let blocks = items.map(function (it) {
      const t = it.t;
      return '<div class="tg-task q' + (t.q || 0) + (t.done ? ' done' : '') + '" style="--lc:' + listOf(t).color + ';top:' + (it.s / 60 * HOUR_PX) + 'px;height:' + Math.max(24, (it.e - it.s) / 60 * HOUR_PX - 2) + 'px;' +
        'left:calc(' + it.lane + ' * 100% / ' + it.n + ');width:calc(100% / ' + it.n + ' - 4px)">' +
        '<button class="tg-check" data-action="toggle" data-id="' + t.id + '" aria-label="' + (t.done ? 'Mark not done' : 'Mark done') + '"></button>' +
        '<button class="tg-open" data-action="open" data-id="' + t.id + '"><span class="tt">' + esc(t.title) + '</span><span class="tm">' + fmtTime(t.due) + '</span></button></div>';
    }).join('');
    if (d === today) blocks += '<span class="tg-now" style="top:' + ((now() - today) / HOUR * HOUR_PX) + 'px"></span>';
    return '<div class="tg-col' + (isOffDay(d) ? ' off' : '') + (d === today ? ' today' : '') + '" data-day="' + d + '" title="Tap an empty spot to add a task at that time">' + blocks + '</div>';
  }).join('');

  $('calBody').innerHTML = '<div class="tg' + (p.days === 7 ? ' tg-week' : '') + '" id="tgScroll" style="--n:' + p.days + ';--hpx:' + HOUR_PX + 'px">' +
    '<div class="tg-top">' + head + allday + '</div>' +
    '<div class="tg-row tg-body" style="height:' + 24 * HOUR_PX + 'px"><div class="tg-gut tg-hours">' + hours + '</div>' + cols + '</div></div>';

  const box = $('tgScroll');
  if (keepY !== null) box.scrollTop = keepY;
  else if (box.clientHeight) {            // first time this mode is on screen: start near now (today) or 7 am
    const h = periodHas(p, today) ? Math.max(0, (now() - today) / HOUR - 1.5) : 7;
    box.scrollTop = h * HOUR_PX;
    calScrolled = calMode();
  }
}

// ---------- the selected day's list (side card) ----------
function renderDayCard() {
  const today = midnight(now());
  const map = tasksByDay();
  const list = (map[calSel] || []).slice();
  if (calSel === today) liveTasks().forEach(function (t) { if (taskDate(t) === null && !t.done && !t.someday && listVisible(t)) list.push(t); });
  const open = sortByDay(list.filter(function (t) { return !t.done; }));
  const done = list.filter(function (t) { return t.done; });
  const label = calSel === today ? 'Today' : (calSel === addDays(today, 1) ? 'Tomorrow' : dayName(calSel, 'long'));
  $('calDayTitle').textContent = label + ', ' + new Date(calSel).toLocaleDateString([], { day: 'numeric', month: 'long' });
  $('calDaySub').textContent = open.length + ' to do' + (done.length ? ' · ' + done.length + ' done' : '') + (calSel === today ? ' · includes tasks with no date' : '');
  $('calInput').placeholder = 'Add to ' + (calSel === today ? 'today' : new Date(calSel).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })) + ' (try "5pm !1")';
  $('calList').innerHTML = open.concat(done).map(function (t) { return taskHTML(t, { box: true, day: calSel }); }).join('') ||
    '<li class="empty">' + (calSel < today ? 'Nothing was planned for this day.' : 'Free day. Add a task above.') + '</li>';
}

function selectDay(d) {
  calSel = d;
  if (!periodHas(calPeriod(), d)) calAnchor = d;
  haptic(5);
  renderCalendar();
}
function openCalDay(d, mode) {
  calSel = d;
  calAnchor = d;
  state.ui.calMode = mode;
  save();
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
  if (p.repeat) setupRepeat(task, p.repeat);
  finishNewTask(task, Object.assign({}, p, { someday: false }));
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
  if (task.repeat) explainNewRepeat(task); else input.focus();
}

// ---------- actions ----------
actions.calpick = function (el) { selectDay(Number(el.dataset.d)); };
actions.calprev = function () { calStep(-1); };
actions.calnext = function () { calStep(1); };
actions.caltoday = function () { calSel = midnight(now()); calAnchor = calSel; calScrolled = ''; haptic(5); renderCalendar(); };
actions.calmode = function (el) { state.ui.calMode = el.dataset.m; calAnchor = calSel; save(); haptic(5); renderCalendar(); };
actions.calgoday = function (el) { openCalDay(Number(el.dataset.d), 'day'); };
actions.calopenmonth = function (el) { openCalDay(Number(el.dataset.d), 'month'); };
actions.caladd = function () { openAddSheet(null, { date: calSel === null ? midnight(now()) : calSel }); };

// Tap an empty spot in the hour grid: add a task at that time (to the half hour).
$('calBody').addEventListener('click', function (e) {
  const col = e.target.closest('.tg-col');
  if (!col || e.target.closest('.tg-task')) return;
  const y = e.clientY - col.getBoundingClientRect().top;
  const mins = Math.max(0, Math.min(23 * 60 + 30, Math.floor(y / HOUR_PX * 2) * 30));
  openAddSheet(null, { date: Number(col.dataset.day), time: String(Math.floor(mins / 60)).padStart(2, '0') + ':' + String(mins % 60).padStart(2, '0') });
});
// Double-click a day in Month / 2 weeks to open it in Day view.
$('calBody').addEventListener('dblclick', function (e) {
  const cell = e.target.closest('.cday');
  if (cell) openCalDay(Number(cell.dataset.d), 'day');
});
$('calForm').addEventListener('submit', function (e) { e.preventDefault(); addFromCalendar(); });
$('calInput').addEventListener('input', function () {
  const text = $('calInput').value;
  const p = text.trim() ? parseQuickAdd(text) : null;
  let chips = [];
  if (p) { chips = quickAddChips(Object.assign({}, p, { due: calDue(p, text) })); }
  $('calParse').innerHTML = chips.map(function (c) { return '<span class="chip">' + esc(c) + '</span>'; }).join('');
});
attachTaskGestures($('calList'), 'menu');

// swipe left / right to move to the next / previous period
(function () {
  const body = $('calBody');
  let sx = null, sy = null;
  body.addEventListener('touchstart', function (e) { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
  body.addEventListener('touchend', function (e) {
    if (sx === null) return;
    const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
    sx = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      calStep(dx < 0 ? 1 : -1);
      const inner = body.firstElementChild;
      if (inner && inner.animate) inner.animate([{ transform: 'translateX(' + (dx < 0 ? 24 : -24) + 'px)', opacity: 0.4 }, { transform: 'none', opacity: 1 }], { duration: 220, easing: 'ease-out' });
    }
  });
})();

// keep the red "now" line moving
setInterval(function () { if (view === 'calendar' && TIMED_MODES[calMode()] && !sheetCtx) renderCalendar(); }, 60000);
