/* =========================================================
   Planning (ideas from Sunsama, Things and Todoist):
   - a banner on Tasks: "Plan your day" in the morning, "Wrap up the
     day" in the evening, "Weekly review" on Sunday (each can be hidden)
   - Plan your day: sort what's left over, pick today's top 3, add
     time estimates; warns when the day holds more than your hours
   - Wrap up: move what's left, note how the day went (kept per day in
     state.days, the start of a journal)
   - Weekly review: the week in numbers, overdue and Someday to sort,
     a note for next week
   - Logbook: everything you've finished, searchable
   - Countdowns: days until exams and events (a strip on Tasks)
   - Templates: save a task (with its checklist) and reuse it
   ========================================================= */

const MOODS = ['😞', '🙁', '😐', '🙂', '😄'];
const EST_CYCLE = [null, 15, 30, 45, 60, 90, 120, 180];

// ---------- day / week notes (state.days, synced) ----------
function dayEntry(id) { return (state.days || []).find(function (d) { return d.id === id && !d.deleted; }) || null; }
function setDay(id, patch) {
  let d = state.days.find(function (x) { return x.id === id; });
  if (!d) { d = { id: id, deleted: false }; state.days.push(d); }
  Object.assign(d, patch, { deleted: false, updatedAt: now() });
  save();
  return d;
}
function weekId(t) { return 'w' + dayKey(weekStart(t === undefined ? now() : t)); }

// Every finished task by day, counting each tick of a repeating task.
function completionsByDay() {
  const map = {};
  liveTasks().forEach(function (t) {
    if (t.done && t.doneAt) { const k = dayKey(t.doneAt); map[k] = (map[k] || 0) + 1; }
    (t.history || []).forEach(function (h) { const k = dayKey(h.at); map[k] = (map[k] || 0) + 1; });
  });
  return map;
}
// The same, as a list of { t, at, repeat } for the Logbook and the reviews.
function completedItems() {
  const out = [];
  liveTasks().forEach(function (t) {
    if (t.done && t.doneAt) out.push({ t: t, at: t.doneAt, repeat: false });
    (t.history || []).forEach(function (h) { out.push({ t: t, at: h.at, repeat: true }); });
  });
  return out.sort(function (a, b) { return b.at - a.at; });
}

// ---------- banner + countdown strip on Tasks ----------
function currentBanner() {
  const d = new Date();
  const h = d.getHours();
  const k = dayKey();
  const off = state.ui.dismissed || {};
  const day = dayEntry(k) || {};
  const wk = weekId();
  if (d.getDay() === 0 && h >= 10 && !(dayEntry(wk) || {}).reviewed && !off['review-' + wk]) {
    return { key: 'review-' + wk, title: 'Weekly review', sub: 'See your week, sort what slipped, pick next week\'s top 3 · 5 min', action: 'weekreview', btn: 'Start' };
  }
  if (h >= 5 && h < 13 && !day.planned && !off['plan-' + k]) {
    return { key: 'plan-' + k, title: 'Plan your day', sub: 'Pick today\'s tasks and your top 3 · 2 min', action: 'planday', btn: 'Plan' };
  }
  if (h >= 18 && !day.wrapped && !off['wrap-' + k]) {
    return { key: 'wrap-' + k, title: 'Wrap up the day', sub: 'Move what\'s left and note how today went · 1 min', action: 'wrapday', btn: 'Wrap up' };
  }
  return null;
}
function renderPlanBits() {
  const b = currentBanner();
  $('planBanner').innerHTML = b ? '<div class="banner"><div><b>' + esc(b.title) + '</b><span>' + esc(b.sub) + '</span></div>' +
    '<button class="btn small primary" data-action="' + b.action + '">' + b.btn + '</button>' +
    '<button class="banner-x" data-action="bannerx" data-k="' + b.key + '" aria-label="Hide for now">×</button></div>' : '';
  const today = midnight(now());
  const cds = liveCountdowns().filter(function (c) { return c.date >= today; });
  $('countdownStrip').hidden = !cds.length;
  $('countdownStrip').innerHTML = cds.map(function (c) {
    const n = Math.round((c.date - today) / DAY);
    return '<button class="cdchip' + (n <= 3 ? ' soon' : '') + '" data-action="countdowns"><b>' + (n === 0 ? 'Today' : n === 1 ? '1 day' : n + ' days') + '</b>' + esc(c.title) + '</button>';
  }).join('');
}
actions.bannerx = function (el) {
  state.ui.dismissed[el.dataset.k] = now();
  for (const k in state.ui.dismissed) if (state.ui.dismissed[k] < now() - 14 * DAY) delete state.ui.dismissed[k];
  save();
  renderPlanBits();
  toast('Hidden. You can still open it from search (Ctrl K).');
};

// ---------- small helpers for the planning sheets ----------
function planRow(t, buttons) {
  const l = listOf(t);
  return '<li style="--lc:' + l.color + '"><div class="pl-t"><b>' + esc(t.title) + '</b><span class="small">' + esc(l.name) +
    (t.due !== null ? ' · ' + esc(fmtDue(t.due, t.hasTime)) : '') + '</span></div><div class="pl-b">' + buttons + '</div></li>';
}
function moveBtns(t, which) {
  const b = { today: 'Today', tomorrow: 'Tomorrow', nextweek: 'Next week', someday: 'Someday' };
  return which.map(function (w) {
    return '<button class="btn small" data-action="plmove" data-id="' + t.id + '" data-to="' + w + '">' + b[w] + '</button>';
  }).join('');
}
function moveTaskTo(t, to) {
  const today = midnight(now());
  const mins = t.due !== null && t.hasTime ? Math.round((t.due - midnight(t.due)) / MIN) : 0;
  if (to === 'someday') { t.someday = true; t.due = null; t.hasTime = false; t.top = null; t.evening = false; }
  else {
    const day = to === 'today' ? today : to === 'tomorrow' ? addDays(today, 1) : addDays(weekStart(today), 7);
    t.someday = false;
    t.due = day + mins * MIN;
  }
  t.updatedAt = now();
}
function todaysOpen() {
  const today = midnight(now());
  return liveTasks().filter(function (t) {
    const d = taskDate(t);
    return !t.done && !t.someday && (d === null || midnight(d) === today);
  });
}
function overdueOpen() {
  const today = midnight(now());
  return liveTasks().filter(function (t) { const d = taskDate(t); return !t.done && !t.someday && d !== null && midnight(d) < today; });
}
function refreshPlanSheet() {
  if (!sheetCtx) return;
  if (sheetCtx.type === 'plan') refreshSheet(planSheetHTML());
  else if (sheetCtx.type === 'wrap') refreshSheet(wrapSheetHTML());
  else if (sheetCtx.type === 'review') refreshSheet(reviewSheetHTML());
}
actions.plmove = function (el) {
  const t = findTask(el.dataset.id);
  if (!t) return;
  snapshot('Moved task');
  moveTaskTo(t, el.dataset.to);
  save(); renderTaskViews(); refreshPlanSheet();
  haptic(8);
};
actions.pldelete = function (el) { const t = findTask(el.dataset.id); if (!t) return; deleteTask(t.id); refreshPlanSheet(); };
actions.pltop = function (el) {
  const t = findTask(el.dataset.id);
  if (!t) return;
  if (isTop(t)) t.top = null;
  else {
    if (todaysOpen().filter(isTop).length >= 3) { toast('Three is the limit. Unstar one first.'); return; }
    t.top = dayKey();
  }
  t.updatedAt = now();
  save(); renderTaskViews(); refreshPlanSheet();
  haptic(8);
};
actions.plest = function (el) {
  const t = findTask(el.dataset.id);
  if (!t) return;
  const i = EST_CYCLE.indexOf(t.est);
  t.est = EST_CYCLE[(i + 1) % EST_CYCLE.length];
  t.updatedAt = now();
  save(); renderTaskViews(); refreshPlanSheet();
};

// ---------- Plan your day ----------
function planSheetHTML() {
  const late = overdueOpen();
  const today = todaysOpen().sort(function (a, b) { return (isTop(b) - isTop(a)) || ((a.q || 9) - (b.q || 9)); });
  const someday = liveTasks().filter(function (t) { return !t.done && t.someday; }).slice(0, 6);
  const est = today.reduce(function (s, t) { return s + (t.est || 0); }, 0);
  const noEst = today.filter(function (t) { return !t.est; }).length;
  const cap = state.settings.workHours * 60;
  const over = est > cap;
  let html = '<h3>Plan your day</h3><p class="small">' + new Date().toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' }) + '</p>';
  if (late.length) {
    html += '<p class="label">Left over · ' + late.length + '</p><ul class="planlist">' + late.map(function (t) {
      return planRow(t, moveBtns(t, ['today', 'tomorrow', 'someday']) + '<button class="btn small danger" data-action="pldelete" data-id="' + t.id + '" aria-label="Delete">×</button>');
    }).join('') + '</ul>';
  }
  html += '<p class="label">Today · ' + today.length + (today.length ? ' · tap ★ for your top 3, the clock for how long' : '') + '</p>';
  html += today.length ? '<ul class="planlist">' + today.map(function (t) {
    return planRow(t, '<button class="plstar' + (isTop(t) ? ' on' : '') + '" data-action="pltop" data-id="' + t.id + '" aria-label="Top 3" aria-pressed="' + isTop(t) + '">' + STAR_SVG + '</button>' +
      '<button class="btn small plest" data-action="plest" data-id="' + t.id + '">' + CLOCK_SVG + (t.est ? fmtEst(t.est) : '–') + '</button>' +
      moveBtns(t, ['tomorrow']));
  }).join('') + '</ul>' : '<p class="small">Nothing planned yet. Add tasks on the Tasks page, or pull some in from Someday below.</p>';
  html += '<div class="loadbar' + (over ? ' over' : '') + '"><div class="lb-track"><i style="width:' + Math.min(100, est / cap * 100).toFixed(1) + '%"></i></div>' +
    '<span><b>' + fmtEst(est || 0) + '</b> planned of your ' + state.settings.workHours + 'h' + (noEst ? ' · ' + noEst + ' without a time' : '') + '</span></div>';
  if (over) html += '<p class="note warn">That\'s more than you have. Move something to tomorrow or Someday, so the day stays doable.</p>';
  if (someday.length) {
    html += '<p class="label">Pick up from Someday</p><ul class="planlist">' + someday.map(function (t) { return planRow(t, moveBtns(t, ['today'])); }).join('') + '</ul>';
  }
  html += '<p class="small">Hours you can really plan in a day: ' + state.settings.workHours + 'h (change it in your profile).</p>';
  html += '<div class="row"><button class="btn" data-action="close">Later</button><button class="btn primary" data-action="planfinish">Start my day</button></div>';
  return html;
}
actions.planday = function () { openSheet({ type: 'plan' }, planSheetHTML()); };
actions.planfinish = function () {
  setDay(dayKey(), { planned: true });
  closeSheet();
  renderTaskViews();
  const tops = todaysOpen().filter(isTop);
  toast(tops.length ? 'Planned. Start with "' + shortTitle(tops[0].title) + '".' : 'Planned. Have a good day.');
  sound('pop');
};

// ---------- Wrap up the day ----------
function wrapSheetHTML() {
  const k = dayKey();
  const d = dayEntry(k) || {};
  const done = completionsByDay()[k] || 0;
  const goal = state.settings.dailyGoal;
  const focus = liveSessions().filter(function (s) { return s.day === k; }).reduce(function (a, s) { return a + s.minutes; }, 0);
  const habits = liveHabits();
  const ticked = habits.filter(function (h) { return isOn(h, k); }).length;
  const left = todaysOpen().concat(overdueOpen());
  return '<h3>Wrap up the day</h3>' +
    '<div class="statgrid">' +
      '<div><b>' + done + '<small>/' + goal + '</small></b><span>tasks done</span></div>' +
      '<div><b>' + fmtEst(focus) + '</b><span>focused</span></div>' +
      '<div><b>' + ticked + '<small>/' + habits.length + '</small></b><span>habits</span></div>' +
    '</div>' +
    (done >= goal ? '<p class="note good">Daily goal reached. Nice.</p>' : '') +
    (typeof ctWrapHTML === 'function' ? ctWrapHTML() : '') +
    (left.length ? '<p class="label">Still open · ' + left.length + '</p><ul class="planlist">' + left.map(function (t) {
      return planRow(t, moveBtns(t, ['tomorrow', 'someday']));
    }).join('') + '</ul><button class="btn small" data-action="wrapallmove">Move all to tomorrow</button>' : '<p class="small">Nothing left open for today.</p>') +
    '<p class="label">How did today go?</p>' +
    '<div class="moods">' + MOODS.map(function (m, i) {
      return '<button class="' + (d.mood === i + 1 ? 'on' : '') + '" data-action="wrapmood" data-m="' + (i + 1) + '" aria-label="Mood ' + (i + 1) + ' of 5">' + m + '</button>';
    }).join('') + '</div>' +
    '<textarea class="text-input" id="wrapNote" placeholder="One line about today (optional)">' + esc(d.note || '') + '</textarea>' +
    '<div class="row"><button class="btn" data-action="close">Later</button><button class="btn primary" data-action="wrapfinish">Done for today</button></div>';
}
function saveWrapNote() { if ($('wrapNote')) setDay(dayKey(), { note: $('wrapNote').value.trim() }); }
actions.wrapday = function () { openSheet({ type: 'wrap', onClose: saveWrapNote }, wrapSheetHTML()); };
actions.wrapmood = function (el) { saveWrapNote(); setDay(dayKey(), { mood: Number(el.dataset.m) }); refreshPlanSheet(); haptic(6); };
actions.wrapallmove = function () {
  const left = todaysOpen().concat(overdueOpen());
  if (!left.length) return;
  saveWrapNote();
  snapshot('Moved to tomorrow');
  left.forEach(function (t) { moveTaskTo(t, 'tomorrow'); });
  save(); renderTaskViews(); refreshPlanSheet();
  toast(left.length + (left.length === 1 ? ' task' : ' tasks') + ' moved to tomorrow', { undo: true });
};
actions.wrapfinish = function () {
  saveWrapNote();
  setDay(dayKey(), { wrapped: true });
  closeSheet();
  renderTaskViews();
  sound('chime');
  toast('Day wrapped up. Rest well.');
};

// ---------- Weekly review ----------
function reviewSheetHTML() {
  const ws = weekStart(now());
  const prev = addDays(ws, -7);
  const wk = weekId();
  const entry = dayEntry(wk) || {};
  const items = completedItems();
  const thisWeek = items.filter(function (x) { return x.at >= ws; });
  const lastWeek = items.filter(function (x) { return x.at >= prev && x.at < ws; }).length;
  const sessions = liveSessions().filter(function (s) { return s.day >= dayKey(ws); });
  const focus = sessions.reduce(function (a, s) { return a + s.minutes; }, 0);
  const daysSoFar = Math.round((midnight(now()) - ws) / DAY) + 1;
  let ticks = 0, possible = 0;
  liveHabits().forEach(function (h) {
    for (let i = 0; i < daysSoFar; i++) { possible++; if (isOn(h, dayKey(addDays(ws, i)))) ticks++; }
  });
  const byList = {};
  thisWeek.forEach(function (x) { const id = listOf(x.t).id; byList[id] = (byList[id] || 0) + 1; });
  const rows = Object.keys(byList).map(function (id) { return { l: findList(id), n: byList[id] }; }).filter(function (r) { return r.l; }).sort(function (a, b) { return b.n - a.n; });
  const max = rows.length ? rows[0].n : 1;
  // estimate vs focused time, for finished tasks that had both
  let estSum = 0, actSum = 0;
  thisWeek.forEach(function (x) { if (!x.repeat && x.t.est) { const m = focusMinutes(x.t.id); if (m) { estSum += x.t.est; actSum += m; } } });
  const late = overdueOpen();
  const someday = liveTasks().filter(function (t) { return !t.done && t.someday; });
  let html = '<h3>Weekly review</h3><p class="small">' + new Date(ws).toLocaleDateString([], { day: 'numeric', month: 'short' }) + ' – ' +
    new Date(addDays(ws, 6)).toLocaleDateString([], { day: 'numeric', month: 'short' }) + '</p>' +
    '<div class="statgrid">' +
      '<div><b>' + thisWeek.length + '</b><span>done' + (lastWeek ? ' (' + (thisWeek.length >= lastWeek ? '+' : '') + (thisWeek.length - lastWeek) + ' vs last week)' : '') + '</span></div>' +
      '<div><b>' + fmtEst(focus) + '</b><span>focused</span></div>' +
      '<div><b>' + (possible ? Math.round(ticks / possible * 100) : 0) + '%</b><span>habit days</span></div>' +
    '</div>';
  if (rows.length) {
    html += '<p class="label">Done by list</p><ul class="bylist">' + rows.map(function (r) {
      return '<li style="--lc:' + r.l.color + ';--w:' + (r.n / max).toFixed(3) + '"><span>' + esc(r.l.name) + '</span><b>' + r.n + '</b><i></i></li>';
    }).join('') + '</ul>';
  }
  if (estSum) {
    const pct = Math.round(actSum / estSum * 100);
    html += '<p class="small">Time check: tasks you estimated at ' + fmtEst(estSum) + ' took ' + fmtEst(actSum) + ' of focus (' + pct + '%). ' +
      (pct > 120 ? 'Things take longer than you think: plan a bit less.' : pct < 80 ? 'You\'re faster than you guess.' : 'Your guesses are about right.') + '</p>';
  }
  if (late.length) {
    html += '<p class="label">Slipped · ' + late.length + '</p><ul class="planlist">' + late.map(function (t) {
      return planRow(t, moveBtns(t, ['today', 'nextweek', 'someday']) + '<button class="btn small danger" data-action="pldelete" data-id="' + t.id + '" aria-label="Delete">×</button>');
    }).join('') + '</ul>';
  }
  if (someday.length) {
    html += '<p class="label">Someday · ' + someday.length + '</p><ul class="planlist">' + someday.slice(0, 10).map(function (t) {
      return planRow(t, moveBtns(t, ['nextweek']) + '<button class="btn small danger" data-action="pldelete" data-id="' + t.id + '" aria-label="Delete">×</button>');
    }).join('') + '</ul>';
  }
  if (liveRanges().length) html += '<button class="btn small" data-action="ctweekreport">📊 ColorTracker report for last week</button>';
  html += '<p class="label">Top 3 for next week</p>' +
    '<textarea class="text-input" id="reviewNote" placeholder="1. \n2. \n3. ">' + esc(entry.note || '') + '</textarea>' +
    '<div class="row"><button class="btn" data-action="close">Later</button><button class="btn primary" data-action="reviewfinish">Finish review</button></div>';
  return html;
}
function saveReviewNote() { if ($('reviewNote')) setDay(weekId(), { note: $('reviewNote').value.trim() }); }
actions.weekreview = function () { openSheet({ type: 'review', onClose: saveReviewNote }, reviewSheetHTML()); };
actions.reviewfinish = function () {
  saveReviewNote();
  setDay(weekId(), { reviewed: true });
  closeSheet();
  renderTaskViews();
  sound('milestone');
  toast('Week reviewed. Have a good one.');
};
// The planning sheets' notes are saved as you go, so a sheet refresh never loses them.
let planNoteTimer = 0;
$('sheet').addEventListener('input', function (e) {
  if (e.target.id === 'reviewNote' || e.target.id === 'wrapNote') { clearTimeout(planNoteTimer); planNoteTimer = setTimeout(function () { if (e.target.id === 'reviewNote') saveReviewNote(); else saveWrapNote(); }, 600); }
});

// ---------- Logbook ----------
let logQuery = '';
function logbookBodyHTML() {
  const q = logQuery.trim().toLowerCase();
  const from = addDays(midnight(now()), -120);
  const items = completedItems().filter(function (x) {
    return x.at >= from && (!q || x.t.title.toLowerCase().indexOf(q) !== -1 || listOf(x.t).name.toLowerCase().indexOf(q) !== -1);
  });
  if (!items.length) return '<p class="small">' + (q ? 'Nothing finished matches "' + esc(logQuery) + '".' : 'Finished tasks will collect here.') + '</p>';
  let html = '', lastDay = null;
  items.slice(0, 300).forEach(function (x) {
    const d = midnight(x.at);
    if (d !== lastDay) {
      if (lastDay !== null) html += '</ul>';
      const n = Math.round((midnight(now()) - d) / DAY);
      html += '<p class="label">' + (n === 0 ? 'Today' : n === 1 ? 'Yesterday' : new Date(d).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })) + '</p><ul class="loglist">';
      lastDay = d;
    }
    const l = listOf(x.t);
    html += '<li style="--lc:' + l.color + '"><i></i><span class="lg-t">' + esc(x.t.title) + (x.repeat ? ' <em>repeat</em>' : '') + '</span><time>' + fmtTime(x.at) + '</time>' +
      (!x.repeat && x.t.done ? '<button class="linkbtn" data-action="logundo" data-id="' + x.t.id + '">Undo</button>' : '') + '</li>';
  });
  return html + '</ul>';
}
function logbookHTML() {
  return '<h3>Logbook</h3><input class="text-input" id="logSearch" placeholder="Search what you\'ve finished" value="' + esc(logQuery) + '" aria-label="Search the logbook">' +
    '<div id="logBody">' + logbookBodyHTML() + '</div><div class="row"><button class="btn" data-action="close">Close</button></div>';
}
actions.logbook = function () { logQuery = ''; openSheet({ type: 'logbook' }, logbookHTML()); };
actions.logundo = function (el) {
  const t = findTask(el.dataset.id);
  if (!t || !t.done) return;
  toggleTask(t.id);
  if (sheetCtx && sheetCtx.type === 'logbook') $('logBody').innerHTML = logbookBodyHTML();
};
$('sheet').addEventListener('input', function (e) {
  if (e.target.id !== 'logSearch') return;
  logQuery = e.target.value;
  $('logBody').innerHTML = logbookBodyHTML();
});

// ---------- Countdowns ----------
function liveCountdowns() {
  return (state.countdowns || []).filter(function (c) { return !c.deleted; }).sort(function (a, b) { return a.date - b.date; });
}
function countdownsHTML() {
  const today = midnight(now());
  const list = liveCountdowns();
  return '<h3>Countdowns</h3><p class="small">Days until exams, trips and events. Upcoming ones show at the top of Tasks.</p>' +
    (list.length ? '<ul class="cdlist">' + list.map(function (c) {
      const n = Math.round((c.date - today) / DAY);
      return '<li class="' + (n < 0 ? 'past' : '') + '"><b>' + (n === 0 ? 'Today' : n > 0 ? n + (n === 1 ? ' day' : ' days') : (-n) + (n === -1 ? ' day ago' : ' days ago')) + '</b>' +
        '<span>' + esc(c.title) + '<small>' + new Date(c.date).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) + '</small></span>' +
        '<button class="icon-btn sm danger" data-action="cddelete" data-id="' + c.id + '" aria-label="Delete countdown">×</button></li>';
    }).join('') + '</ul>' : '') +
    '<form id="cdForm" class="cdform" autocomplete="off"><input class="text-input" id="cdTitle" placeholder="e.g. DBMS end-sem" maxlength="60" aria-label="What"><input type="date" id="cdDate" aria-label="Date"><button class="btn primary" type="submit">Add</button></form>' +
    '<div class="row"><button class="btn" data-action="close">Done</button></div>';
}
actions.countdowns = function () { openSheet({ type: 'countdowns' }, countdownsHTML()); };
actions.cddelete = function (el) {
  const c = state.countdowns.find(function (x) { return x.id === el.dataset.id; });
  if (!c) return;
  snapshot('Deleted countdown');
  c.deleted = true; c.updatedAt = now();
  save(); renderPlanBits(); refreshSheet(countdownsHTML());
  toast('Deleted "' + c.title + '"', { undo: true });
};
$('sheet').addEventListener('submit', function (e) {
  if (e.target.id !== 'cdForm') return;
  e.preventDefault();
  const title = $('cdTitle').value.trim(), date = $('cdDate').value;
  if (!title) { $('cdTitle').focus(); return; }
  if (!date) { toast('Pick the date too.'); return; }
  snapshot('Added countdown');
  state.countdowns.push({ id: uid(), title: title, date: new Date(date + 'T00:00').getTime(), updatedAt: now(), deleted: false });
  save(); renderPlanBits(); refreshSheet(countdownsHTML());
  sound('pop');
});

// ---------- Templates ----------
function liveTemplates() { return (state.templates || []).filter(function (x) { return !x.deleted; }).sort(function (a, b) { return a.name.localeCompare(b.name); }); }
function templateRowHTML() {
  const list = liveTemplates();
  if (!list.length) return '';
  return '<p class="label">From a template</p><div class="pickrow">' + list.map(function (x) {
    return '<button type="button" class="pick" data-action="usetemplate" data-id="' + x.id + '">' + esc(x.name) + (x.task.subtasks.length ? ' · ' + x.task.subtasks.length + ' steps' : '') + '</button>';
  }).join('') + '</div>';
}
// Make a task from a template. In the add pop-up it takes the date picked there.
function taskFromTemplate(x, extra) {
  const src = x.task;
  const t = newTask(src.title, src.q, Object.assign({
    listId: findList(src.listId) ? src.listId : defaultListId(), est: src.est || null, tags: (src.tags || []).slice(), notes: src.notes || '',
    subtasks: (src.subtasks || []).map(function (s) { return { id: uid(), title: s.title, done: false }; })
  }, extra || {}));
  snapshot('Added from template');
  state.tasks.push(t);
  save();
  renderTaskViews();
  sound('soft');
  return t;
}
actions.usetemplate = function (el) {
  const x = liveTemplates().find(function (y) { return y.id === el.dataset.id; });
  if (!x) return;
  const extra = {};
  if (sheetCtx && sheetCtx.type === 'add' && addDraft) {
    if (addDraft.date !== null || addDraft.time) {
      const mins = addDraft.time ? Number(addDraft.time.slice(0, 2)) * 60 + Number(addDraft.time.slice(3, 5)) : 0;
      extra.due = (addDraft.date !== null ? addDraft.date : midnight(now())) + mins * MIN;
      extra.hasTime = !!addDraft.time;
    }
    if (addDraft.deadline) extra.deadline = addDraft.deadline;
    if (addDraft.q) extra.q = addDraft.q;
  }
  const t = taskFromTemplate(x, extra);
  if (sheetCtx && sheetCtx.type === 'add' && $('addStatus')) $('addStatus').textContent = 'Added "' + shortTitle(t.title) + '" from the template, with ' + t.subtasks.length + ' steps.';
  else toast('Added "' + shortTitle(t.title) + '" from a template');
};
actions.tsavetemplate = function () {
  const t = sheetTask();
  if (!t) return;
  const old = liveTemplates().find(function (x) { return x.name.toLowerCase() === t.title.toLowerCase(); });
  const data = { title: t.title, q: t.q, listId: t.listId, est: t.est, tags: t.tags.slice(), notes: t.notes,
    subtasks: t.subtasks.map(function (s) { return { title: s.title }; }) };
  if (old) { old.task = data; old.updatedAt = now(); }
  else state.templates.push({ id: uid(), name: t.title, task: data, updatedAt: now(), deleted: false });
  save();
  toast(old ? 'Template "' + shortTitle(t.title) + '" updated' : 'Saved as a template. Use it from the + pop-up or search.');
};
actions.tpldelete = function (el) {
  const x = state.templates.find(function (y) { return y.id === el.dataset.id; });
  if (!x) return;
  snapshot('Deleted template');
  x.deleted = true; x.updatedAt = now();
  save();
  if (typeof refreshProfile === 'function') refreshProfile();
  toast('Deleted template "' + x.name + '"', { undo: true });
};
