/* =========================================================
   Habits: a colour per habit, 7-day grid, streaks, a strength
   score that forgives a missed day, a heatmap and milestones.
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

function renderHabits() {
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
    const cell = document.querySelector('.cell[data-id="' + id + '"][data-day="' + key + '"]');
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
function heatmapHTML(h) {
  const today = midnight(now());
  const dow = (new Date(today).getDay() + 6) % 7;            // Monday = 0
  const start = addDays(today, -dow - 7 * 16);               // 17 weeks, starting on a Monday
  let cells = '';
  for (let d = start; d <= addDays(today, 6 - dow); d = addDays(d, 1)) {
    const k = dayKey(d);
    cells += '<i class="' + (isOn(h, k) ? 'on' : '') + (d > today ? ' future' : '') + '" title="' + k + '"></i>';
  }
  return '<div class="heat" style="--hc:' + h.color + '">' + cells + '</div>';
}
function habitSheetHTML(h) {
  const total = Object.keys(h.done).filter(function (k) { return h.done[k].on; }).length;
  return '<h3>Habit</h3>' +
    '<input class="text-input" id="hName" value="' + esc(h.name) + '" aria-label="Habit name">' +
    '<p class="label">Colour</p><div class="swatches">' + HABIT_COLORS.map(function (c) {
      return '<button class="swatch-btn" style="--sc:' + c + '" data-action="hcolor" data-c="' + c + '" aria-pressed="' + (h.color === c) + '" aria-label="Colour ' + c + '"></button>';
    }).join('') + '</div>' +
    '<div class="hstats">' +
      '<div><b>' + streak(h) + '</b><span>streak</span></div>' +
      '<div><b>' + bestStreak(h) + '</b><span>best</span></div>' +
      '<div><b>' + strength(h) + '%</b><span>strength</span></div>' +
      '<div><b>' + total + '</b><span>total</span></div>' +
    '</div>' +
    '<p class="label">Last 17 weeks</p>' + heatmapHTML(h) +
    '<div class="row"><button class="btn danger" data-action="delhabit">Delete habit</button><button class="btn" data-action="close">Done</button></div>';
}
function sheetHabit() { return sheetCtx && sheetCtx.type === 'habit' ? findHabit(sheetCtx.id) : null; }

actions.tick = function (el) { tickHabit(el.dataset.id, el.dataset.day); };
actions.openhabit = function (el) { const h = findHabit(el.dataset.id); if (h) openSheet({ type: 'habit', id: h.id }, habitSheetHTML(h)); };
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
