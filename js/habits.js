/* =========================================================
   Habits: a colour per habit, 7-day grid, streaks, a strength
   score that forgives a missed day, milestones, and a details
   sheet with a tickable month calendar and a 12-month chart.
   ========================================================= */

const MILESTONES = [3, 7, 14, 21, 30, 50, 75, 100, 150, 200, 365];

function isOn(h, key) { const e = h.done[key]; return !!(e && e.on); }
function streak(h) {
  const d = new Date();
  let n = 0;
  if (!isOn(h, dayKey(d))) d.setDate(d.getDate() - 1);   // today not ticked yet doesn't break the streak
  while (isOn(h, dayKey(d))) { n++; d.setDate(d.getDate() - 1); }
  return n;
}
function bestStreak(h) {
  const keys = Object.keys(h.done).filter(function (k) { return h.done[k].on; }).sort();
  let best = 0, run = 0, prev = null;
  keys.forEach(function (k) {
    const t = new Date(k + 'T00:00').getTime();
    run = (prev !== null && Math.round((t - prev) / DAY) === 1) ? run + 1 : 1;
    best = Math.max(best, run);
    prev = t;
  });
  return best;
}
// Strength (like Loop Habit Tracker): every tick pushes it up, every miss pulls it down a little.
function strength(h) {
  const today = midnight(now());
  const first = Object.keys(h.done).filter(function (k) { return h.done[k].on; }).sort()[0];
  let start = Math.min(midnight(h.createdAt || now()), first ? new Date(first + 'T00:00').getTime() : today);
  start = Math.max(start, addDays(today, -180));
  let s = 0;
  for (let d = start; d <= today; d = addDays(d, 1)) {
    const on = isOn(h, dayKey(d));
    if (d === today && !on) break;
    s += 0.08 * ((on ? 1 : 0) - s);
  }
  return Math.round(s * 100);
}
function nextHabitColor() {
  const used = liveHabits().map(function (h) { return h.color; });
  return HABIT_COLORS.find(function (c) { return used.indexOf(c) === -1; }) || HABIT_COLORS[liveHabits().length % HABIT_COLORS.length];
}

// One tile per habit: the last 21 days (3 rows of 7, oldest first, today last), each day showing its
// weekday and date, so it's clear which square is which. 21 days because that's how long a habit
// is said to take to stick. Tiles sit side by side on a laptop and stack on a phone.
const HABIT_DAYS = 21;
// Two layouts: tiles (21 days, roomy) or compact rows (7 days, 8-10 habits on one phone screen).
// Unless you pick one, a laptop gets tiles and a phone gets compact.
function habitLayout() {
  const l = state.ui.habitLayout;
  if (l === 'tiles' || l === 'compact') return l;
  return window.innerWidth >= 900 ? 'tiles' : 'compact';
}
actions.hlayout = function (el) { state.ui.habitLayout = el.dataset.l; save(); haptic(5); renderHabits(); };
function renderHabits() {
  const layout = habitLayout();
  $('habitLayout').querySelectorAll('button').forEach(function (b) { b.classList.toggle('on', b.dataset.l === layout); b.setAttribute('aria-pressed', b.dataset.l === layout); });
  $('habitGrid').classList.toggle('tiles', layout === 'tiles');
  $('habitHelp').textContent = layout === 'tiles' ? 'Each habit shows its last 21 days, today last.' : 'Each row is a habit, the columns are the last 7 days.';
  if (layout === 'compact') { renderHabitRows(); return; }
  const days = [];
  for (let i = HABIT_DAYS - 1; i >= 0; i--) days.push(daysAgo(i));
  const todayKey = dayKey();
  const habits = liveHabits();
  if (!habits.length) { $('habitGrid').innerHTML = '<p class="small h21empty">No habits yet. Add one above.</p>'; return; }
  $('habitGrid').innerHTML = habits.map(function (h) {
    const s = streak(h);
    const done = days.filter(function (d) { return isOn(h, dayKey(d)); }).length;
    let lastMonth = -1;
    const cells = days.map(function (d) {
      const k = dayKey(d);
      const on = isOn(h, k);
      const showMonth = d.getMonth() !== lastMonth;              // month name on the first square and where the month changes
      lastMonth = d.getMonth();
      return '<button class="h21cell' + (on ? ' on' : '') + (k === todayKey ? ' today' : '') + (d.getDay() === 0 || d.getDay() === 6 ? ' h21we' : '') +
        '" data-action="tick" data-id="' + h.id + '" data-day="' + k + '" aria-pressed="' + on + '" aria-label="' + esc(h.name) + ', ' + d.toDateString() + '">' +
        '<span class="h21wd">' + (k === todayKey ? 'Today' : d.toLocaleDateString([], { weekday: 'short' })) + '</span><b>' + d.getDate() + '</b>' +
        '<span class="h21mo">' + (showMonth ? d.toLocaleDateString([], { month: 'short' }) : '') + '</span></button>';
    }).join('');
    return '<article class="htile" style="--hc:' + h.color + '">' +
      '<button class="hname" data-action="openhabit" data-id="' + h.id + '"><span class="avatar">' + esc(h.name.trim().charAt(0).toUpperCase() || '?') + '</span>' +
        '<span><strong>' + esc(h.name) + (h.example ? '<span class="eg">example</span>' : '') + '</strong>' +
        '<small>' + (s ? s + '-day streak' : 'No streak yet') + ' · strength ' + strength(h) + '%</small></span>' +
        (s ? '<span class="h21fire" title="Current streak">' + FLAME_SVG + s + '</span>' : '') + '</button>' +
      '<div class="h21days">' + cells + '</div>' +
      '<div class="h21foot"><div class="h21bar"><i style="width:' + (done / HABIT_DAYS * 100).toFixed(1) + '%"></i></div>' +
        '<span><b>' + done + '</b> of the last ' + HABIT_DAYS + ' days</span></div>' +
      '</article>';
  }).join('');
}

// The compact layout: one row per habit, last 7 days.
function renderHabitRows() {
  const days = [];
  for (let i = 6; i >= 0; i--) days.push(daysAgo(i));
  const todayKey = dayKey();
  let html = '<div class="hrow hdays"><span class="hlabel">Last 7 days</span>' +
    days.map(function (d) {
      return '<span class="hhead' + (dayKey(d) === todayKey ? ' today' : '') + '">' +
        d.toLocaleDateString([], { weekday: 'narrow' }) + '<span class="d">' + d.getDate() + '</span></span>';
    }).join('') + '</div>';
  const habits = liveHabits();
  if (!habits.length) html += '<div class="hrow"><span class="small">No habits yet. Add one above.</span></div>';
  habits.forEach(function (h) {
    const s = streak(h);
    html += '<div class="hrow" style="--hc:' + h.color + '">' +
      '<button class="hname" data-action="openhabit" data-id="' + h.id + '"><span class="avatar">' + esc(h.name.trim().charAt(0).toUpperCase() || '?') + '</span>' +
      '<span><strong>' + esc(h.name) + (h.example ? '<span class="eg">example</span>' : '') + '</strong>' +
      '<small>' + (s ? s + '-day streak' : 'No streak yet') + ' · ' + strength(h) + '%</small></span></button>' +
      days.map(function (d) {
        const k = dayKey(d);
        const on = isOn(h, k);
        return '<button class="cell' + (on ? ' on' : '') + (k === todayKey ? ' today' : '') + '" data-action="tick" data-id="' + h.id + '" data-day="' + k +
          '" aria-pressed="' + on + '" aria-label="' + esc(h.name) + ', ' + d.toDateString() + '"></button>';
      }).join('') + '</div>';
  });
  $('habitGrid').innerHTML = html;
}

function tickHabit(id, key) {
  const h = findHabit(id);
  if (!h) return;
  const was = isOn(h, key);
  const before = streak(h);
  snapshot(was ? 'Unticked habit' : 'Ticked habit');
  h.done[key] = { on: !was, at: now() };
  h.updatedAt = now();
  save();
  renderHabits();
  if (!was) {
    const cell = document.querySelector('.h21cell[data-id="' + id + '"][data-day="' + key + '"], .cell[data-id="' + id + '"][data-day="' + key + '"]');
    if (cell) cell.classList.add('pop');
    const after = streak(h);
    if (after > before && MILESTONES.indexOf(after) !== -1) {
      sound('milestone');
      haptic([30, 50, 30]);
      toast(after + '-day streak on ' + h.name + '!');
    } else {
      sound('pop');
      haptic(10);
    }
  } else {
    haptic(6);
  }
}

// ---------- habit details sheet ----------
// Stat cards, a month calendar you can tick in (ticks on back-to-back days join into one band),
// and a 12-month bar chart of how often you did it.
let habitMonth = null;   // first day of the month shown in the sheet

const FLAME_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22c4 0 7-2.7 7-7 0-3.5-2.2-5.6-3.6-7.3-.5 2-1.6 3.1-2.9 3.6C12.8 8 12 5 9.5 2.5 9.8 6 5 8.5 5 15c0 4.3 3 7 7 7z"/></svg>';
const TROPHY_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4"/></svg>';
const BOLT_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z"/></svg>';
const TICKS_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12l5 5L20 6"/></svg>';

// Ticked days / days so far in the month that starts at ms (future days don't count).
function monthScore(h, ms) {
  const today = midnight(now());
  const d0 = new Date(ms);
  const inMonth = new Date(d0.getFullYear(), d0.getMonth() + 1, 0).getDate();
  let on = 0, n = 0;
  for (let day = 1; day <= inMonth; day++) {
    const d = new Date(d0.getFullYear(), d0.getMonth(), day).getTime();
    if (d > today) break;
    n++;
    if (isOn(h, dayKey(d))) on++;
  }
  return { on: on, n: n };
}
function habitCalendarHTML(h) {
  const today = midnight(now());
  const ms = habitMonth;
  const d0 = new Date(ms);
  const y = d0.getFullYear(), m = d0.getMonth();
  const inMonth = new Date(y, m + 1, 0).getDate();
  const lead = (d0.getDay() + 6) % 7;                       // weeks start on Monday
  const ink = textOn(h.color);
  let cells = '';
  const mon = weekStart(today);
  for (let i = 0; i < 7; i++) {
    const wd = addDays(mon, i);
    cells += '<span class="hwd' + (isOffDay(wd) ? ' off' : '') + '">' + dayName(wd, 'short') + '</span>';
  }
  for (let i = 0; i < lead; i++) cells += '<span></span>';
  for (let day = 1; day <= inMonth; day++) {
    const d = new Date(y, m, day).getTime();
    const k = dayKey(d);
    const on = isOn(h, k);
    const col = (lead + day - 1) % 7;
    const joinL = on && col > 0 && day > 1 && isOn(h, dayKey(addDays(d, -1)));
    const joinR = on && col < 6 && day < inMonth && isOn(h, dayKey(addDays(d, 1)));
    const future = d > today;
    cells += '<button class="hday' + (on ? ' on' : '') + (joinL ? ' jl' : '') + (joinR ? ' jr' : '') + (d === today ? ' today' : '') + (future ? ' future' : '') +
      '" data-action="htick" data-day="' + k + '"' + (future ? ' disabled' : '') + ' aria-pressed="' + on + '" aria-label="' + new Date(d).toDateString() + (on ? ', done' : '') + '">' +
      '<span' + (on ? ' style="color:' + ink + '"' : '') + '>' + day + '</span></button>';
  }
  const sc = monthScore(h, ms);
  const pct = sc.n ? Math.round(sc.on / sc.n * 100) : 0;
  return '<div class="hcal-head">' +
      '<button class="icon-btn" data-action="hmonthstep" data-dir="-1" aria-label="Previous month"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg></button>' +
      '<div><b>' + d0.toLocaleDateString([], { month: 'long', year: 'numeric' }) + '</b><span>' + (sc.n ? sc.on + ' of ' + sc.n + ' days · ' + pct + '%' : 'Not started yet') + '</span></div>' +
      '<button class="icon-btn" data-action="hmonthstep" data-dir="1" aria-label="Next month"' + (ms >= monthStart(today) ? ' disabled' : '') + '><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg></button>' +
    '</div><div class="hcal">' + cells + '</div>' +
    '<p class="small hcal-tip">Tap a day to tick or untick it.</p>';
}
function habitYearHTML(h) {
  const thisMonth = monthStart(now());
  let bars = '';
  for (let i = 11; i >= 0; i--) {
    const ms = addMonths(thisMonth, -i);
    const sc = monthScore(h, ms);
    const pct = sc.n ? sc.on / sc.n : 0;
    const name = new Date(ms).toLocaleDateString([], { month: 'short' });
    bars += '<button class="hbar' + (ms === habitMonth ? ' sel' : '') + '" data-action="hmonthpick" data-d="' + ms + '" title="' + name + ': ' + sc.on + ' days (' + Math.round(pct * 100) + '%)">' +
      '<small>' + (sc.on ? Math.round(pct * 100) + '%' : '') + '</small><span class="track"><i style="height:' + (pct * 100).toFixed(1) + '%"></i></span><b>' + name + '</b></button>';
  }
  return '<div class="hbars">' + bars + '</div>';
}
function habitSheetHTML(h) {
  const total = Object.keys(h.done).filter(function (k) { return h.done[k].on; }).length;
  const s = streak(h), str = strength(h);
  function stat(icon, value, label, extra) {
    return '<div class="hstat">' + icon + '<b>' + value + '</b><span>' + label + '</span>' + (extra || '') + '</div>';
  }
  return '<div class="hsheet" style="--hc:' + h.color + '">' +
    '<div class="hsheet-head"><span class="avatar">' + esc(h.name.trim().charAt(0).toUpperCase() || '?') + '</span>' +
      '<input class="text-input" id="hName" value="' + esc(h.name) + '" aria-label="Habit name"></div>' +
    '<div class="swatches">' + HABIT_COLORS.map(function (c) {
      return '<button class="swatch-btn" style="--sc:' + c + '" data-action="hcolor" data-c="' + c + '" aria-pressed="' + (h.color === c) + '" aria-label="Colour ' + c + '"></button>';
    }).join('') + '</div>' +
    '<div class="hstats">' +
      stat(FLAME_SVG, s, 'day streak') +
      stat(TROPHY_SVG, bestStreak(h), 'best streak') +
      stat(BOLT_SVG, str + '%', 'strength', '<i class="hstr"><i style="width:' + str + '%"></i></i>') +
      stat(TICKS_SVG, total, 'days done') +
    '</div>' +
    '<div class="hcard">' + habitCalendarHTML(h) + '</div>' +
    '<div class="hcard"><p class="label">Last 12 months</p>' + habitYearHTML(h) + '</div>' +
    '<div class="row"><button class="btn danger" data-action="delhabit">Delete habit</button><button class="btn" data-action="close">Done</button></div>' +
  '</div>';
}
function sheetHabit() { return sheetCtx && sheetCtx.type === 'habit' ? findHabit(sheetCtx.id) : null; }

actions.tick = function (el) { tickHabit(el.dataset.id, el.dataset.day); };
actions.openhabit = function (el) {
  const h = findHabit(el.dataset.id);
  if (!h) return;
  habitMonth = monthStart(now());
  openSheet({ type: 'habit', id: h.id }, habitSheetHTML(h));
};
actions.htick = function (el) {
  const h = sheetHabit();
  if (!h) return;
  const key = el.dataset.day;
  tickHabit(h.id, key);
  refreshSheet(habitSheetHTML(h));
  if (isOn(h, key)) { const c = $('sheet').querySelector('.hday[data-day="' + key + '"]'); if (c) c.classList.add('pop'); }
};
actions.hmonthstep = function (el) {
  const h = sheetHabit();
  if (!h) return;
  habitMonth = addMonths(habitMonth, Number(el.dataset.dir));
  refreshSheet(habitSheetHTML(h));
};
actions.hmonthpick = function (el) {
  const h = sheetHabit();
  if (!h) return;
  habitMonth = Number(el.dataset.d);
  refreshSheet(habitSheetHTML(h));
};
actions.hcolor = function (el) {
  const h = sheetHabit();
  if (!h) return;
  h.color = el.dataset.c;
  h.updatedAt = now();
  save();
  renderHabits();
  refreshSheet(habitSheetHTML(h));
};
actions.delhabit = function () {
  const h = sheetHabit();
  if (!h) return;
  snapshot('Deleted habit');
  h.deleted = true;
  h.updatedAt = now();
  save();
  closeSheet();
  renderHabits();
  sound('delete');
  toast('Deleted "' + shortTitle(h.name) + '"', { undo: true });
};
$('sheet').addEventListener('change', function (e) {
  if (e.target.id !== 'hName') return;
  const h = sheetHabit();
  const v = e.target.value.trim();
  if (h && v) { h.name = v; h.updatedAt = now(); save(); renderHabits(); }
});
$('habitForm').addEventListener('submit', function (e) {
  e.preventDefault();
  const name = $('habitInput').value.trim();
  if (!name) return;
  const t = now();
  snapshot('Added habit');
  state.habits.push({ id: uid(), name: name, color: nextHabitColor(), done: {}, createdAt: t, updatedAt: t, deleted: false });
  $('habitInput').value = '';
  save();
  renderHabits();
  sound('soft');
});
