/* =========================================================
   Calendar: seven ways to look at your tasks (switch at the top).
   - Agenda: a scrolling list of the next days (overdue on top), tick tasks right there.
   - Day, 3 days, Week: an hour-by-hour grid. A task with a time sits at that time,
     as tall as its "time it needs" (1 hour if not set); tasks with only a date,
     deadline or several days go in the "All day" row. Tap an empty slot to add.
   - 2 weeks, Month: a grid of days. Task names on a laptop, dots on a phone.
     Tap a day: side card on a laptop, a day sheet on a phone.
   - Year: all 12 months. Tap a day to see it.
   Extras drawn here (each can be switched off in View options, calplus.js):
   faded future dates of repeating tasks, completed tasks, a ColorTracker strip
   on past days, habit ticks, week numbers. Moving things around (drag, drawers,
   search, jump to date, pinch, swipe) lives in calplus.js.
   Days off are shaded. Only the lists picked in the list bar are shown.
   ========================================================= */

const CAL_MODES = [
  { id: 'agenda', label: 'Agenda', short: 'Agenda' },
  { id: 'day', label: 'Day', short: 'Day' }, { id: '3day', label: '3 days', short: '3 day' }, { id: 'week', label: 'Week', short: 'Week' },
  { id: '2week', label: '2 weeks', short: '2 wk' }, { id: 'month', label: 'Month', short: 'Month' }, { id: 'year', label: 'Year', short: 'Year' }
];
const TIMED_MODES = { day: 1, '3day': 3, week: 7 };   // modes with an hour grid, and how many days they show
const HOUR_PX = 52;                                     // height of one hour in the hour grid
const AGENDA_DAYS = 14;                                 // days the Agenda shows before "Show more"

let calAnchor = null;      // a day inside the period on screen
let calSel = null;         // the selected day (its tasks show in the side card)
let calScrolled = '';      // the hour-grid mode we've already scrolled to a sensible hour
let calAgendaExtra = 0;    // extra days added to the Agenda with "Show more"
let calNoTapUntil = 0;     // calplus.js sets this after a drag so the tap that ends it adds nothing
let calDragOn = false;     // true while calplus.js is dragging something (stops swipes and redraws)

function calMode() { return state.ui.calMode || 'month'; }
function monthStart(t) { const d = new Date(t); d.setDate(1); d.setHours(0, 0, 0, 0); return d.getTime(); }
function addMonths(t, n) { const d = new Date(t); d.setMonth(d.getMonth() + n); return d.getTime(); }
// Monday of the week (used all over the app, e.g. weekly reviews). Don't change.
function weekStart(t) { const d = midnight(t); return addDays(d, -((new Date(d).getDay() + 6) % 7)); }
// First day of the week as the Calendar shows it (Monday or Sunday, View options).
function calWeekStart(t) {
  const first = state.settings.calWeekStart === 0 ? 0 : 1;
  const d = midnight(t);
  return addDays(d, -((new Date(d).getDay() - first + 7) % 7));
}
// ISO week number (weeks start Monday; week 1 holds the first Thursday of the year).
function isoWeek(t) {
  const d = new Date(midnight(t));
  d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);           // the Thursday of that week
  const jan4 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d - jan4) / DAY - 3 + (jan4.getDay() + 6) % 7) / 7);
}
function isOffDay(t) { return (state.settings.offDays || []).indexOf(new Date(t).getDay()) !== -1; }
function dayName(t, len) { return new Date(t).toLocaleDateString([], { weekday: len }); }
function calHourText(h) { return new Date(2000, 0, 1, h).toLocaleTimeString([], { hour: 'numeric' }); }
function calDayLabel(d) {
  const today = midnight(now());
  return d === today ? 'Today' : d === addDays(today, 1) ? 'Tomorrow' : d === addDays(today, -1) ? 'Yesterday' : dayName(d, 'long');
}
// Hours shown in the hour grid (at least 4).
function calHours() {
  let a = Number(state.settings.calFrom) || 0, b = Number(state.settings.calTo) || 24;
  if (b - a < 4) { a = 0; b = 24; }
  return { from: a, to: b };
}

// ---------- which tasks show ----------
function calFilter() {
  const f = state.ui.calFilter;
  return f && Array.isArray(f.q) && Array.isArray(f.tags) ? f : { q: [], tags: [] };
}
function calFilterOn() { const f = calFilter(); return f.q.length > 0 || f.tags.length > 0; }
// The list bar plus the box / tag filter (View options).
function calMatches(t) {
  if (!listVisible(t)) return false;
  const f = calFilter();
  if (f.q.length && f.q.indexOf(t.q || 0) === -1) return false;
  if (f.tags.length && !t.tags.some(function (g) { return f.tags.indexOf(g) !== -1; })) return false;
  return true;
}
function calShows(t) { return calMatches(t) && (state.settings.calShowDone !== false || !t.done); }
// A task that runs over several days (task.endDate = its last day).
function isMulti(t) { return !!(t.endDate && t.due !== null && t.endDate > midnight(t.due)); }
function isTimedOn(t, d) { return t.due !== null && t.hasTime && !isMulti(t) && midnight(t.due) === d; }
// Day order, with tasks that run over several days first (so their bars line up better).
function calSort(list) {
  const s = sortByDay(list);
  return s.filter(isMulti).concat(s.filter(function (t) { return !isMulti(t); }));
}

// Tasks per day (key = midnight). Multi-day tasks sit on each of their days.
// With from/to it also adds faded future dates of repeating tasks ("ghosts") in that range.
function tasksByDay(from, to) {
  const map = {};
  function put(k, t) { (map[k] = map[k] || []).push(t); }
  liveTasks().forEach(function (t) {
    const d = taskDate(t);
    if (d === null || !calShows(t)) return;
    const k = midnight(d);
    put(k, t);
    if (isMulti(t)) for (let x = addDays(k, 1), i = 0; x <= t.endDate && i < 90; x = addDays(x, 1), i++) put(x, t);
  });
  if (from !== undefined && state.settings.calRepeats !== false) {
    repeatGhosts(from, to).forEach(function (g) { put(midnight(g.due), g); });
  }
  return map;
}

// ---------- future dates of repeating tasks ----------
// Only previews: a copy of the task with ghost: true. Tapping one opens the real task.
// Daily tasks show up to ~2 months ahead, others up to a year, so big ranges stay fast.
function repeatGhosts(from, to) {
  const out = [];
  const today = midnight(now());
  const start = Math.max(from, today);
  if (to <= start) return out;
  function add(t, d) {
    const mins = t.hasTime && t.due !== null ? Math.round((t.due - midnight(t.due)) / MIN) : 0;
    out.push(Object.assign({}, t, { due: d + mins * MIN, ghost: true, done: false, endDate: null, deadline: null }));
  }
  function walk(t, r, after) {               // dates after `after`, inside [start, end)
    const end = Math.min(to, addDays(today, r.unit === 'day' ? 62 : 400));
    let d = rpNextAfter(r, Math.max(after, addDays(start, -1)));
    for (let n = 0; d !== null && d < end && n < 400; n++) { add(t, d); d = rpNextAfter(r, d); }
  }
  liveTasks().forEach(function (t) {
    if (!t.repeat || t.done || t.due === null || t.seriesId || !calMatches(t)) return;
    const r = t.repeat;
    if (r.mode === 'after') {                 // guess: as if you finish it on its day (or today if it's late)
      const end = Math.min(to, addDays(today, r.unit === 'day' ? 62 : 400));
      let d = rpAfterNext(r, Math.max(midnight(t.due), today));
      for (let n = 0; d !== null && d < end && n < 400; n++) { if (d >= start) add(t, d); d = rpAfterNext(r, d); }
    } else walk(t, r, midnight(t.due));
  });
  // stacking tasks: the dates after the newest copy that already exists
  const series = {};
  state.tasks.forEach(function (t) { if (t.seriesId) (series[t.seriesId] = series[t.seriesId] || []).push(t); });
  Object.keys(series).forEach(function (sid) {
    const all = series[sid];
    const ruled = all.filter(function (t) { return !t.deleted && t.repeat && t.repeat.mode === 'stack'; })
      .sort(function (a, b) { return b.updatedAt - a.updatedAt; });
    if (!ruled.length || !calMatches(ruled[0]) || ruled[0].due === null) return;
    const last = Math.max.apply(null, all.map(function (t) { return t.due === null ? 0 : midnight(t.due); }));
    walk(ruled[0], ruled[0].repeat, last);
  });
  return out;
}

// ---------- ColorTracker and habits on the calendar ----------
// A thin bar of what you painted that day, in proportion to the 24 hours.
function ctStripHTML(d, today, cls) {
  if (state.settings.calCt === false || d > today || typeof segmentsIn !== 'function') return '';
  const segs = segmentsIn(d, Math.min(addDays(d, 1), now()));
  if (!segs.length) return '';
  return '<span class="' + (cls || 'cstrip') + '" aria-hidden="true">' + segs.map(function (s) {
    return '<i style="left:' + ((s.start - d) / DAY * 100).toFixed(2) + '%;width:' + ((s.end - s.start) / DAY * 100).toFixed(2) + '%;background:' + catColor(s.cat) + '"></i>';
  }).join('') + '</span>';
}
// Habits that existed on day d (or were ticked on it), and how many were done.
function habitCount(d) {
  const k = dayKey(d);
  const hs = liveHabits().filter(function (h) { return midnight(h.createdAt || 0) <= d || isOn(h, k); });
  return { key: k, habits: hs, total: hs.length, done: hs.filter(function (h) { return isOn(h, k); }).length };
}
function habitBadge(d, today) {
  if (state.settings.calHabits === false || d > today) return '';
  const c = habitCount(d);
  if (!c.done) return '';
  return '<em class="chab' + (c.done === c.total ? ' all' : '') + '" title="Habits: ' + c.done + ' of ' + c.total + ' done">✓<span class="chn">' + c.done + '</span></em>';
}
// "What you did" + habit buttons for the day card and the phone day sheet (past days and today only).
function calDayExtrasHTML(d) {
  const today = midnight(now());
  if (d > today) return '';
  let html = '';
  if (state.settings.calCt !== false && typeof segmentsIn === 'function') {
    const segs = segmentsIn(d, Math.min(addDays(d, 1), now()));
    if (segs.length) {
      const tot = {};
      segs.forEach(function (s) {
        const name = rangeName(s);
        if (!tot[name]) tot[name] = { ms: 0, color: catColor(s.cat) };
        tot[name].ms += s.end - s.start;
      });
      const top = Object.keys(tot).sort(function (a, b) { return tot[b].ms - tot[a].ms; }).slice(0, 4);
      html += '<div class="cal-did">' + ctStripHTML(d, today, 'cstrip big') +
        '<p class="small"><b>What you did:</b> ' + top.map(function (n) {
          return '<span class="did"><i style="background:' + tot[n].color + '"></i>' + esc(n) + ' ' + fmtEst(Math.round(tot[n].ms / MIN)) + '</span>';
        }).join(' · ') + ' <button class="linkbtn" data-action="calct" data-d="' + d + '">Open in ColorTracker</button></p></div>';
    }
  }
  if (state.settings.calHabits !== false) {
    const c = habitCount(d);
    if (c.total) html += '<div class="cal-habs"><span class="small">Habits ' + c.done + '/' + c.total + '</span>' + c.habits.map(function (h) {
      const on = isOn(h, c.key);
      return '<button class="calhab' + (on ? ' on' : '') + '" style="--hc:' + h.color + '" data-action="calhab" data-id="' + h.id + '" data-day="' + c.key + '" aria-pressed="' + on + '">' + (on ? '✓ ' : '') + esc(h.name) + '</button>';
    }).join('') + '</div>';
  }
  return html;
}

// ---------- which days are on screen ----------
function calPeriod() {
  const m = calMode(), a = calAnchor;
  if (m === 'agenda') return { start: midnight(a), days: AGENDA_DAYS + calAgendaExtra };
  if (m === 'day') return { start: a, days: 1 };
  if (m === '3day') return { start: a, days: 3 };
  if (m === 'week') return { start: calWeekStart(a), days: 7 };
  if (m === '2week') return { start: calWeekStart(a), days: 14 };
  if (m === 'month') {
    const ms = monthStart(a);
    const start = calWeekStart(ms);
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
  else calAnchor = addDays(calAnchor, dir * { agenda: AGENDA_DAYS, day: 1, '3day': 3, week: 7, '2week': 14 }[m]);
  calAgendaExtra = 0;
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
  $('calToday').disabled = calSel === today && periodHas(p, today) && (m !== 'agenda' || p.start === today);
  $('calModes').innerHTML = CAL_MODES.map(function (x) {
    return '<button class="' + (x.id === m ? 'on' : '') + '" data-action="calmode" data-m="' + x.id + '" aria-pressed="' + (x.id === m) + '"><span class="wd-l">' + x.label + '</span><span class="wd-s">' + x.short + '</span></button>';
  }).join('');
  const timed = !!TIMED_MODES[m];
  $('calWrap').classList.toggle('timed', timed || m === 'agenda');   // no side card: use the full width
  if (timed) renderTimeGrid(p);
  else if (m === 'agenda') { calScrolled = ''; renderAgenda(p); }
  else {
    calScrolled = '';
    if (m === 'year') renderYear(p.year); else renderDayGrid(p);
    renderDayCard();
  }
  if (typeof renderCalChrome === 'function') renderCalChrome();       // calplus.js: drawer, badges, move banner
  if (sheetCtx && sheetCtx.type === 'calpeek' && sheetCtx.d === calSel) refreshSheet(calPeekHTML());
}

// ---------- weekday headings: a coloured band, "Mon" on a phone, "Monday" on a laptop ----------
function weekdayHeads(cls) {
  let html = '';
  const first = calWeekStart(now());
  for (let i = 0; i < 7; i++) {
    const d = addDays(first, i);
    html += '<span class="' + cls + (isOffDay(d) ? ' off' : '') + '"><span class="wd-s">' + dayName(d, 'short') + '</span><span class="wd-l">' + dayName(d, 'long') + '</span></span>';
  }
  return html;
}
// One task as a small bar. Ghosts (future repeats) are faded and can't be dragged.
function chipHTML(t, d, tag) {
  const time = isTimedOn(t, d) ? '<em>' + fmtTime(t.due) + '</em>' : '';
  const flag = t.deadline && midnight(t.deadline) === d && t.due === null ? '<i class="dlflag">' + FLAG_SVG + '</i>' : '';
  let cls = 'cchip q' + (t.q || 0) + (t.done ? ' done' : '') + (t.ghost ? ' rgh' : '');
  if (isMulti(t)) cls += ' cspan' + (d === midnight(t.due) ? ' sp-s' : '') + (d === t.endDate ? ' sp-e' : '');
  const attrs = (tag === 'button' ? ' data-action="open" data-id="' + t.id + '"' : '') + (t.ghost ? '' : ' data-drag="' + t.id + '"');
  return '<' + tag + ' class="' + cls + '" style="--lc:' + listOf(t).color + '"' + attrs + (t.ghost ? ' title="Repeats on this day"' : '') + '>' +
    (t.ghost ? '<i class="rgi">' + REPEAT_SVG + '</i>' : '') + flag + time + esc(t.title) + '</' + tag + '>';
}
// A future repeat in a list: no tick (it isn't due yet), tap to open the real task.
function ghostRowHTML(t) {
  return '<li class="task rgh q' + (t.q || 0) + '" style="--lc:' + listOf(t).color + '"><div class="rg-inner">' +
    '<span class="rgcheck">' + REPEAT_SVG + '</span>' +
    '<button class="tbody" data-action="open" data-id="' + t.id + '"><span class="ttl">' + esc(t.title) + '</span>' +
    '<span class="meta"><span class="chip rep">' + (t.hasTime ? esc(fmtTime(t.due)) + ' · ' : '') + 'repeats on this day</span></span></button></div></li>';
}
function calRowHTML(t, d) { return t.ghost ? ghostRowHTML(t) : taskHTML(t, { box: true, day: d }); }

// ---------- 2 weeks and Month ----------
function renderDayGrid(p) {
  const today = midnight(now());
  const map = tasksByDay(p.start, addDays(p.start, p.days));
  const m = calMode();
  const maxChips = m === 'month' ? 3 : 7;
  const wn = !!state.settings.calWeekNums;
  let html = (wn ? '<span class="cwn-h" aria-hidden="true"></span>' : '') + weekdayHeads('cwd');
  for (let i = 0; i < p.days; i++) {
    const d = addDays(p.start, i);
    if (wn && i % 7 === 0) html += '<span class="cwn" title="Week ' + isoWeek(addDays(d, 1)) + '">' + isoWeek(addDays(d, 1)) + '</span>';
    const list = map[d] || [];
    const open = calSort(list.filter(function (t) { return !t.done; }));
    const shown = open.concat(list.filter(function (t) { return t.done; }));
    const realOpen = open.filter(function (t) { return !t.ghost; });
    const late = d < today && realOpen.some(function (t) { return !isMulti(t) || t.endDate < today; });
    const hasDeadline = list.some(function (t) { return t.deadline && midnight(t.deadline) === d && !t.done; });
    let dots = open.slice(0, 4).map(function (t) { return '<i class="q' + (t.q || 0) + (t.ghost ? ' gh' : '') + (isMulti(t) ? ' md' : '') + '"></i>'; }).join('');
    if (open.length > 4) dots += '<b>+' + (open.length - 4) + '</b>';
    if (!open.length && list.length) dots = '<i class="donedot"></i>';
    let chips = shown.slice(0, maxChips).map(function (t) { return chipHTML(t, d, 'span'); }).join('');
    if (shown.length > maxChips) chips += '<span class="cmore">+' + (shown.length - maxChips) + ' more</span>';
    const out = p.month !== undefined && monthStart(d) !== p.month;
    const date = new Date(d);
    const num = date.getDate() === 1 || (m === '2week' && i === 0) ? date.toLocaleDateString([], { day: 'numeric', month: 'short' }) : date.getDate();
    html += '<button class="cday' + (out ? ' out' : '') + (d === today ? ' today' : '') + (d === calSel ? ' sel' : '') + (late ? ' late' : '') + (isOffDay(d) ? ' off' : '') +
      '" data-action="calpick" data-d="' + d + '" aria-label="' + date.toDateString() + ', ' + realOpen.length + ' open tasks">' +
      '<span class="num">' + num + (hasDeadline ? '<em class="dlflag">' + FLAG_SVG + '</em>' : '') + habitBadge(d, today) + '</span>' +
      '<span class="cdots">' + dots + '</span><span class="cchips">' + chips + '</span>' + ctStripHTML(d, today) + '</button>';
  }
  $('calBody').innerHTML = '<div class="cal-grid' + (wn ? ' wn' : '') + '" data-m="' + m + '">' + html + '</div>';
}

// ---------- Year: 12 small months ----------
function renderYear(year) {
  const today = midnight(now());
  const map = tasksByDay();
  const firstWd = state.settings.calWeekStart === 0 ? 0 : 1;
  const heads = calWeekStart(now());
  let html = '';
  for (let mo = 0; mo < 12; mo++) {
    const ms = new Date(year, mo, 1).getTime();
    const lead = (new Date(ms).getDay() - firstWd + 7) % 7;
    const inMonth = new Date(year, mo + 1, 0).getDate();
    let cells = '';
    for (let i = 0; i < 7; i++) {
      const wd = addDays(heads, i);
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
// ColorTracker blocks down the left edge of a day column (what you really did, hour by hour).
function ctColHTML(d, today, hrs) {
  if (state.settings.calCt === false || d > today || typeof segmentsIn !== 'function') return '';
  const a = d + hrs.from * HOUR, b = Math.min(d + hrs.to * HOUR, now());
  if (b <= a) return '';
  return segmentsIn(a, b).map(function (s) {
    return '<i class="tg-ct" style="top:' + ((s.start - a) / HOUR * HOUR_PX).toFixed(1) + 'px;height:' + ((s.end - s.start) / HOUR * HOUR_PX).toFixed(1) + 'px;background:' + catColor(s.cat) + '" title="' +
      esc(rangeName(s)) + ', ' + fmtTime(s.start) + ' – ' + fmtTime(s.end) + '"></i>';
  }).join('');
}
function renderTimeGrid(p) {
  const today = midnight(now());
  const hrs = calHours();
  const top0 = hrs.from * 60, bottom = hrs.to * 60;
  const map = tasksByDay(p.start, addDays(p.start, p.days));
  const days = [];
  for (let i = 0; i < p.days; i++) days.push(addDays(p.start, i));
  const old = $('tgScroll');
  const keepY = old && calScrolled === calMode() ? old.scrollTop : null;
  // a timed task outside the hours shown goes in the All day row (with its time)
  function inGrid(t, d) {
    if (!isTimedOn(t, d)) return false;
    const mm = Math.round((t.due - d) / MIN);
    return mm >= top0 && mm < bottom;
  }

  const wn = state.settings.calWeekNums ? '<small class="tg-wn">W' + isoWeek(days[0]) + '</small>' : '';
  const head = '<div class="tg-row tg-head"><span class="tg-gut">' + wn + '</span>' + days.map(function (d) {
    let hab = '';
    if (state.settings.calHabits !== false && d <= today) {
      const c = habitCount(d);
      if (c.total) hab = '<small class="tg-hab' + (c.done === c.total ? ' all' : '') + '" title="Habits done">✓' + c.done + '/' + c.total + '</small>';
    }
    return '<button class="tg-dh' + (d === today ? ' today' : '') + (isOffDay(d) ? ' off' : '') + '" data-action="calgoday" data-d="' + d + '" title="Open this day">' +
      '<span><span class="wd-s">' + dayName(d, 'short') + '</span><span class="wd-l">' + dayName(d, 'long') + '</span></span><b>' + new Date(d).getDate() + '</b>' + hab + '</button>';
  }).join('') + '</div>';
  const allday = '<div class="tg-row tg-allday"><span class="tg-gut">All day</span>' + days.map(function (d) {
    const list = calSort((map[d] || []).filter(function (t) { return !inGrid(t, d); }));
    const max = p.days === 1 ? 6 : 3;
    return '<div class="tg-ad' + (isOffDay(d) ? ' off' : '') + '" data-day="' + d + '">' + list.slice(0, max).map(function (t) { return chipHTML(t, d, 'button'); }).join('') +
      (list.length > max ? '<button class="cmore" data-action="calgoday" data-d="' + d + '">+' + (list.length - max) + ' more</button>' : '') + '</div>';
  }).join('') + '</div>';

  let hours = '';
  for (let h = hrs.from + 1; h < hrs.to; h++) hours += '<span class="tg-h" style="top:' + (h - hrs.from) * HOUR_PX + 'px">' + calHourText(h) + '</span>';
  const cols = days.map(function (d) {
    const items = (map[d] || []).filter(function (t) { return inGrid(t, d); }).map(function (t) {
      const s = Math.round((t.due - d) / MIN) - top0;
      return { t: t, s: s, e: Math.min(s + (t.est || 60), bottom - top0) };
    }).sort(function (a, b) { return a.s - b.s || (a.t.q || 9) - (b.t.q || 9); });
    layoutLanes(items);
    const ct = ctColHTML(d, today, hrs);
    let blocks = items.map(function (it) {
      const t = it.t;
      const end = t.due + (t.est || 60) * MIN;
      return '<div class="tg-task q' + (t.q || 0) + (t.done ? ' done' : '') + (t.ghost ? ' rgh' : '') + '"' + (t.ghost ? '' : ' data-drag="' + t.id + '"') +
        ' style="--lc:' + listOf(t).color + ';top:' + (it.s / 60 * HOUR_PX) + 'px;height:' + Math.max(22, (it.e - it.s) / 60 * HOUR_PX - 2) + 'px;' +
        'left:calc(var(--tl) + ' + it.lane + ' * (100% - var(--tl)) / ' + it.n + ');width:calc((100% - var(--tl)) / ' + it.n + ' - 3px)">' +
        (t.ghost ? '<i class="rgi">' + REPEAT_SVG + '</i>' : '<button class="tg-check" data-action="toggle" data-id="' + t.id + '" aria-label="' + (t.done ? 'Mark not done' : 'Mark done') + '"></button>') +
        '<button class="tg-open" data-action="open" data-id="' + t.id + '"><span class="tt">' + esc(t.title) + '</span><span class="tm">' + fmtTime(t.due) + ' – ' + fmtTime(end) + '</span></button>' +
        (t.ghost || t.done ? '' : '<span class="tg-rs" data-rs="' + t.id + '" title="Drag to change how long it takes"></span>') + '</div>';
    }).join('');
    const nowMin = (now() - today) / MIN;
    if (d === today && nowMin >= top0 && nowMin < bottom) blocks += '<span class="tg-now" style="top:' + ((nowMin - top0) / 60 * HOUR_PX) + 'px"></span>';
    return '<div class="tg-col' + (isOffDay(d) ? ' off' : '') + (d === today ? ' today' : '') + (ct ? ' ctcol' : '') + '" data-day="' + d + '" title="Tap an empty spot to add a task at that time">' + ct + blocks + '</div>';
  }).join('');

  $('calBody').innerHTML = '<div class="tg' + (p.days === 7 ? ' tg-week' : '') + '" id="tgScroll" data-from="' + hrs.from + '" data-to="' + hrs.to + '" style="--n:' + p.days + ';--hpx:' + HOUR_PX + 'px">' +
    '<div class="tg-top">' + head + allday + '</div>' +
    '<div class="tg-row tg-body" style="height:' + (hrs.to - hrs.from) * HOUR_PX + 'px"><div class="tg-gut tg-hours">' + hours + '</div>' + cols + '</div></div>';

  const box = $('tgScroll');
  if (keepY !== null) box.scrollTop = keepY;
  else if (box.clientHeight) {            // first time this mode is on screen: start near now (today) or 7 am
    const h = periodHas(p, today) ? (now() - today) / HOUR - 1.5 : 7;
    box.scrollTop = Math.max(0, h - hrs.from) * HOUR_PX;
    calScrolled = calMode();
  }
}

// ---------- Agenda: the next days as one list ----------
// Late tasks first (with "Move all to today"), then each day that has something. Empty days fold into one line.
function calOverdue() {
  const today = midnight(now());
  const heads = stackHeads();
  return calSort(liveTasks().filter(function (t) {
    const d = taskDate(t);
    return !t.done && d !== null && midnight(d) < today && !(isMulti(t) && t.endDate >= today) && !stackHidden(t, heads) && calMatches(t);
  }));
}
function calUndated() {
  const heads = stackHeads();
  return liveTasks().filter(function (t) { return !t.done && taskDate(t) === null && !stackHidden(t, heads) && calMatches(t); });
}
function renderAgenda(p) {
  const today = midnight(now());
  const map = tasksByDay(p.start, addDays(p.start, p.days));
  function short(d) { return new Date(d).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }); }
  let html = '';
  if (periodHas(p, today)) {
    const late = calOverdue();
    if (late.length) html += '<div class="ag-day ag-late"><div class="ag-h"><b>Overdue</b><span>' + late.length + (late.length === 1 ? ' task' : ' tasks') + '</span>' +
      '<button class="btn small" data-action="callatetoday">Move all to today</button></div><ul class="tasks list">' +
      late.map(function (t) { return taskHTML(t, { box: true }); }).join('') + '</ul></div>';
  }
  let empty = [];
  function flushEmpty() {
    if (!empty.length) return;
    html += '<p class="ag-empty">' + (empty.length === 1 ? 'Nothing on ' + short(empty[0]) : 'Nothing from ' + short(empty[0]) + ' to ' + short(empty[empty.length - 1])) + '</p>';
    empty = [];
  }
  for (let i = 0; i < p.days; i++) {
    const d = addDays(p.start, i);
    const list = (map[d] || []).slice();
    if (d === today) liveTasks().forEach(function (t) { if (taskDate(t) === null && !t.done && !t.someday && calShows(t)) list.push(t); });
    if (!list.length && d !== today) { empty.push(d); continue; }
    flushEmpty();
    const open = calSort(list.filter(function (t) { return !t.done; }));
    const done = list.filter(function (t) { return t.done; });
    html += '<div class="ag-day' + (d === today ? ' today' : '') + (isOffDay(d) ? ' off' : '') + '" data-d="' + d + '"><div class="ag-h"><b>' + calDayLabel(d) + '</b><span>' +
      new Date(d).toLocaleDateString([], { day: 'numeric', month: 'long' }) + '</span>' +
      '<button class="icon-btn sm" data-action="calagadd" data-d="' + d + '" aria-label="Add a task on this day">+</button></div>' +
      '<ul class="tasks list">' + (open.concat(done).map(function (t) { return calRowHTML(t, d); }).join('') || '<li class="empty">Nothing planned. Tap + to add.</li>') + '</ul></div>';
  }
  flushEmpty();
  html += '<div class="row ag-more"><button class="btn" data-action="calagmore">Show 2 more weeks</button></div>';
  $('calBody').innerHTML = '<div class="agenda">' + html + '</div>';
}

// ---------- the selected day's list (side card) ----------
function calDayList(d) {
  const today = midnight(now());
  const list = (tasksByDay(d, addDays(d, 1))[d] || []).slice();
  if (d === today) liveTasks().forEach(function (t) { if (taskDate(t) === null && !t.done && !t.someday && calShows(t)) list.push(t); });
  return { open: calSort(list.filter(function (t) { return !t.done; })), done: list.filter(function (t) { return t.done; }) };
}
function renderDayCard() {
  const today = midnight(now());
  const l = calDayList(calSel);
  const open = l.open.filter(function (t) { return !t.ghost; });
  $('calDayTitle').textContent = (calSel === addDays(today, -1) ? 'Yesterday' : calDayLabel(calSel)) + ', ' + new Date(calSel).toLocaleDateString([], { day: 'numeric', month: 'long' });
  $('calDaySub').textContent = open.length + ' to do' + (l.done.length ? ' · ' + l.done.length + ' done' : '') + (calSel === today ? ' · includes tasks with no date' : '');
  $('calDayExtra').innerHTML = calDayExtrasHTML(calSel);
  $('calInput').placeholder = 'Add to ' + (calSel === today ? 'today' : new Date(calSel).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })) + ' (try "5pm !1")';
  $('calList').innerHTML = l.open.concat(l.done).map(function (t) { return calRowHTML(t, calSel); }).join('') ||
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
function addFromCalendar(inputId, parseId) {
  const input = $(inputId || 'calInput');
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
  $(parseId || 'calParse').innerHTML = '';
  if (midnight(due) !== calSel) selectDay(midnight(due));
  if (sheetCtx && sheetCtx.type === 'calpeek') { refreshCalPeek(); if ($('peekInput')) $('peekInput').focus(); }
  renderTaskViews();
  sound('soft');
  const li = document.querySelector('#calList .task[data-id="' + task.id + '"]');
  if (li && li.animate) li.animate([{ transform: 'scale(0.94)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 280, easing: 'cubic-bezier(0.34,1.56,0.64,1)' });
  if (task.repeat) explainNewRepeat(task); else input.focus();
}

// ---------- phone: tap a date in Month / 2 weeks → its tasks in a sheet ----------
// On a laptop the selected day's card sits next to the grid. On a phone it's far below it, so a tap
// opens the day in a sheet instead: tick, open and edit tasks, add new ones, or jump to the Day view.
// Hold a task in the sheet to move it to another day (calplus.js).
function calPeekHTML() {
  const d = calSel;
  const today = midnight(now());
  const l = calDayList(d);
  const open = l.open.filter(function (t) { return !t.ghost; });
  const cds = typeof liveCountdowns === 'function' ? liveCountdowns().filter(function (c) { return midnight(c.date) === d; }) : [];
  return '<div class="peek-head"><button class="icon-btn sm" data-action="peekstep" data-d="-1" aria-label="Previous day">‹</button>' +
    '<div><h3>' + calDayLabel(d) + ', ' + new Date(d).toLocaleDateString([], { day: 'numeric', month: 'long' }) + '</h3>' +
    '<p class="small">' + (open.length ? open.length + ' to do' : 'Nothing to do') + (l.done.length ? ' · ' + l.done.length + ' done' : '') + (isOffDay(d) ? ' · day off' : '') + '</p></div>' +
    '<button class="icon-btn sm" data-action="peekstep" data-d="1" aria-label="Next day">›</button></div>' +
    (cds.length ? '<p class="note">' + cds.map(function (c) { return '📅 ' + esc(c.title); }).join(' · ') + '</p>' : '') +
    calDayExtrasHTML(d) +
    '<form id="peekForm" class="add-row" autocomplete="off"><input id="peekInput" placeholder="Add to this day (try &quot;5pm !1&quot;)" aria-label="Add a task on this day" enterkeyhint="done"><button class="btn primary" type="submit">Add</button></form>' +
    '<div class="parse" id="peekParse"></div>' +
    '<ul class="tasks list peeklist">' + (l.open.concat(l.done).map(function (t) { return calRowHTML(t, d); }).join('') ||
      '<li class="empty">' + (d < today ? 'Nothing was planned for this day.' : 'Free day. Add a task above.') + '</li>') + '</ul>' +
    (open.length ? '<p class="small peek-tip">Tip: hold a task to move it to another day.</p>' : '') +
    '<div class="row"><button class="btn" data-action="calgoday" data-d="' + d + '">Open day view</button><button class="btn primary" data-action="close">Done</button></div>';
}
function refreshCalPeek() { if (sheetCtx && sheetCtx.type === 'calpeek') refreshSheet(calPeekHTML()); }
function openCalPeek(d) {
  calSel = d;
  renderCalendar();
  openSheet({ type: 'calpeek', d: d }, calPeekHTML());
}
const calPhone = function () { return window.innerWidth < 900; };
// After editing a task opened from the sheet, come back to the same day.
let peekReturn = null;
const calCloseSheet = closeSheet;
closeSheet = function (fromHistory) {
  const ctx = sheetCtx;
  calCloseSheet(fromHistory);
  if (ctx && ctx.type === 'task' && peekReturn !== null && view === 'calendar') {
    const d = peekReturn;
    peekReturn = null;
    setTimeout(function () { if (!sheetCtx) openCalPeek(d); }, 360);
  } else if (!ctx || ctx.type !== 'task') peekReturn = null;
};
document.addEventListener('click', function (e) {
  if (sheetCtx && sheetCtx.type === 'calpeek' && e.target.closest('#sheet [data-action="open"]')) peekReturn = sheetCtx.d;
}, true);
actions.peekstep = function (el) { calSel = addDays(calSel, Number(el.dataset.d)); sheetCtx.d = calSel; if (!periodHas(calPeriod(), calSel)) calAnchor = calSel; renderCalendar(); refreshCalPeek(); haptic(5); };
$('sheet').addEventListener('submit', function (e) { if (e.target.id !== 'peekForm') return; e.preventDefault(); addFromCalendar('peekInput', 'peekParse'); });
$('sheet').addEventListener('input', function (e) {
  if (e.target.id !== 'peekInput') return;
  const p = parseQuickAdd(e.target.value);
  $('peekParse').innerHTML = e.target.value.trim() ? quickAddChips(Object.assign({}, p, { due: calDue(p, e.target.value) })).map(function (c) { return '<span class="chip">' + esc(c) + '</span>'; }).join('') : '';
});

// ---------- actions ----------
actions.calpick = function (el) {
  const d = Number(el.dataset.d);
  if (calPhone() && (calMode() === 'month' || calMode() === '2week')) { openCalPeek(d); return; }
  selectDay(d);
};
actions.calprev = function () { calStep(-1); };
actions.calnext = function () { calStep(1); };
actions.caltoday = function () { calSel = midnight(now()); calAnchor = calSel; calScrolled = ''; calAgendaExtra = 0; haptic(5); renderCalendar(); };
actions.calmode = function (el) { state.ui.calMode = el.dataset.m; calAnchor = calSel; calAgendaExtra = 0; save(); haptic(5); renderCalendar(); };
actions.calgoday = function (el) { openCalDay(Number(el.dataset.d), 'day'); };
actions.calopenmonth = function (el) { openCalDay(Number(el.dataset.d), 'month'); };
actions.caladd = function () { openAddSheet(null, { date: calSel === null ? midnight(now()) : calSel }); };
actions.calagadd = function (el) { calSel = Number(el.dataset.d); openAddSheet(null, { date: calSel }); };
actions.calagmore = function () { calAgendaExtra += AGENDA_DAYS; renderCalendar(); };
actions.calhab = function (el) {
  tickHabit(el.dataset.id, el.dataset.day);
  renderCalendar();
  refreshCalPeek();
};
// Open ColorTracker on that day.
actions.calct = function (el) {
  const d = Number(el.dataset.d);
  if (sheetCtx) closeSheet();
  ctPage = 'paint';
  ctSel = null;
  ctAnchor = d === midnight(now()) ? null : (state.ui.ctView === 'clock' ? d : d + 12 * HOUR);
  showView('colortracker');
};

// Tap an empty spot in the hour grid: add a task at that time (to the half hour).
$('calBody').addEventListener('click', function (e) {
  const col = e.target.closest('.tg-col');
  if (!col || e.target.closest('.tg-task') || now() < calNoTapUntil) return;
  const hrs = calHours();
  const y = e.clientY - col.getBoundingClientRect().top;
  const mins = Math.max(hrs.from * 60, Math.min(hrs.to * 60 - 30, hrs.from * 60 + Math.floor(y / HOUR_PX * 2) * 30));
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
attachTaskGestures($('calBody'), 'menu');   // the Agenda's rows: swipe to tick / delete, hold for the box menu

// keep the red "now" line moving
setInterval(function () { if (view === 'calendar' && TIMED_MODES[calMode()] && !sheetCtx && !calDragOn) renderCalendar(); }, 60000);
