/* =========================================================
   Calendar extras (v0.11): moving tasks around and finding things.
   - Drag: press (mouse) or hold (touch) a task, drop it on another day,
     an hour slot or the All day row. Drag the bottom edge of a block in the
     hour grid to change how long it takes. Press / hold an empty part of the
     hour grid and drag to pick a time range for a new task.
   - Move mode: tap a task in the drawer, or hold one in the phone day sheet,
     then tap a day (or an hour slot).
   - Drawer: tasks with no date, and late tasks (with "Move all to today").
     Drop a task on the drawer to take its date away.
   - View options: box / tag filter, and what's drawn (completed, repeats,
     ColorTracker strip, habits, week numbers, first weekday, hours shown).
   - Search, jump to a date (tap the title), pinch / Ctrl+scroll / + − to zoom
     between Day … Year, swipe to page.
   - "Runs until" in the task sheet makes a task span several days.
   ========================================================= */

const CAL_ZOOM = ['day', '3day', 'week', '2week', 'month', 'year'];
let cdrag = null;        // the drag in progress
let cdPending = null;    // mouse pressed, not moved far enough yet to count as a drag
let cdHold = null;       // finger down, waiting for the hold
let calMoveId = null;    // move mode: the task waiting for a tap on a day
let calJumpMonth = null; // month shown in the "jump to a date" sheet
let cdLastWheel = 0;

function calShortDay(d) { return new Date(d).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }); }
function calHHMM(mins) { return String(Math.floor(mins / 60)).padStart(2, '0') + ':' + String(mins % 60).padStart(2, '0'); }
function calMinsText(mins) { return fmtTime(midnight(now()) + mins * MIN); }

// ---------- putting a task on a day ----------
// mins: a time (hour grid) | null. allDay: dropped on the All day row (time goes).
// Dropped on a day cell, a task keeps its time. A multi-day task moves as a whole.
function calPlaceTask(t, day, mins, allDay) {
  const oldDay = taskDate(t) !== null ? midnight(taskDate(t)) : null;
  if (mins !== null && mins !== undefined) { t.due = day + mins * MIN; t.hasTime = true; }
  else if (allDay || t.due === null) { t.due = day; t.hasTime = false; }
  else t.due = day + (t.due - midnight(t.due));
  if (t.endDate && oldDay !== null) t.endDate = addDays(t.endDate, Math.round((day - oldDay) / DAY));
  t.someday = false;
  t.updatedAt = now();
}
function calDropTask(id, target) {
  const t = findTask(id);
  if (!t || !target) return;
  if (target.kind === 'nodate') {
    if (t.due === null && !t.deadline) return;
    snapshot('Removed date');
    t.due = null; t.hasTime = false; t.endDate = null;
    t.updatedAt = now();
    save(); renderTaskViews();
    toast('"' + shortTitle(t.title) + '" has no date now', { undo: true });
    return;
  }
  const before = t.due + '|' + t.hasTime;
  snapshot('Moved task');
  calPlaceTask(t, target.day, target.kind === 'time' ? target.mins : null, target.kind === 'allday');
  if (t.due + '|' + t.hasTime === before) { undoStack.pop(); renderCalendar(); return; }
  save();
  renderTaskViews();
  haptic(10);
  sound('soft');
  toast('Moved to ' + calShortDay(t.due) + (t.hasTime ? ', ' + fmtTime(t.due) : ''), { undo: true });
  if (!calShows(t)) toast('Moved. It\'s hidden by a filter, so you won\'t see it here.', { undo: true });
}

// ---------- where is the pointer? ----------
function calDropAt(x, y) {
  const el = document.elementFromPoint(x, y);
  if (!el) return null;
  if (el.closest('#calDrawer')) return { kind: 'nodate', el: $('calDrawer') };
  const col = el.closest('.tg-col');
  if (col) {
    const hrs = calHours();
    const yy = y - col.getBoundingClientRect().top - (cdrag && cdrag.grabY ? cdrag.grabY : 0);
    const mins = Math.max(hrs.from * 60, Math.min(hrs.to * 60 - 15, hrs.from * 60 + Math.round(yy / HOUR_PX * 4) * 15));
    return { kind: 'time', el: col, day: Number(col.dataset.day), mins: mins };
  }
  const ad = el.closest('.tg-ad');
  if (ad) return { kind: 'allday', el: ad, day: Number(ad.dataset.day) };
  const cell = el.closest('.cday, .yday');
  if (cell) return { kind: 'day', el: cell, day: Number(cell.dataset.d) };
  const ag = el.closest('.ag-day[data-d]');
  if (ag) return { kind: 'day', el: ag, day: Number(ag.dataset.d) };
  return null;
}
function calTargetText(g) {
  if (!g) return 'Drop on a day';
  if (g.kind === 'nodate') return 'No date';
  if (g.kind === 'time') return calShortDay(g.day) + ', ' + calMinsText(g.mins);
  return calShortDay(g.day) + (g.kind === 'allday' ? ', all day' : '');
}

// ---------- dragging ----------
// What a press / hold on this element would drag (null = nothing).
function cdPick(el) {
  if (calMoveId || el.closest('.tg-check')) return null;
  const rs = el.closest('[data-rs]');
  if (rs && rs.closest('#calBody')) return { kind: 'resize', id: rs.dataset.rs, el: rs.parentElement };
  const dr = el.closest('[data-drag]');
  if (dr && dr.closest('#calBody, #calDrawer')) return { kind: 'move', id: dr.dataset.drag, el: dr };
  const col = el.closest('.tg-col');
  if (col && !el.closest('.tg-task')) return { kind: 'create', el: col };
  return null;
}
function cdBegin(pre, x, y) {
  const t = pre.id ? findTask(pre.id) : null;
  if (pre.kind !== 'create' && !t) return;
  cdrag = Object.assign({ x: x, y: y, target: null }, pre);
  calDragOn = true;
  document.body.classList.add('cal-dragging');
  if (pre.kind === 'move') {
    const r = pre.el.getBoundingClientRect();
    cdrag.grabY = pre.el.classList.contains('tg-task') ? Math.max(0, Math.min(y - r.top, r.height - 6)) : 0;
    const f = document.createElement('div');
    f.className = 'cdfloat q' + (t.q || 0);
    f.style.setProperty('--lc', listOf(t).color);
    f.innerHTML = '<b>' + esc(t.title) + '</b><span></span>';
    document.body.appendChild(f);
    cdrag.float = f;
    pre.el.classList.add('cdsrc');
  } else if (pre.kind === 'resize') {
    cdrag.col = pre.el.parentElement;
    cdrag.startMins = Math.round((t.due - midnight(t.due)) / MIN);
    cdrag.est = t.est || 60;
    pre.el.classList.add('resizing');
  } else {
    const hrs = calHours();
    const yy = y - pre.el.getBoundingClientRect().top;
    cdrag.day = Number(pre.el.dataset.day);
    cdrag.a0 = Math.max(hrs.from * 60, Math.min(hrs.to * 60 - 15, hrs.from * 60 + Math.floor(yy / HOUR_PX * 4) * 15));
    const box = document.createElement('div');
    box.className = 'tg-sel';
    pre.el.appendChild(box);
    cdrag.box = box;
  }
  cdMove(x, y);
  requestAnimationFrame(cdAutoScroll);
}
function cdMove(x, y) {
  const g = cdrag;
  if (!g) return;
  g.x = x; g.y = y;
  const hrs = calHours();
  if (g.kind === 'move') {
    g.float.style.left = Math.min(window.innerWidth - 200, Math.max(4, x - 24)) + 'px';
    g.float.style.top = (y - 46) + 'px';
    g.float.style.visibility = 'hidden';               // so elementFromPoint sees what's under it
    const tg = calDropAt(x, y);
    g.float.style.visibility = '';
    const key = tg ? tg.kind + tg.day + (tg.mins || '') : '';
    if (key !== g.key) {
      if (g.target && g.target.el) g.target.el.classList.remove('cddrop');
      if (tg && tg.el && tg.kind !== 'time') tg.el.classList.add('cddrop');
      if (tg) haptic(4);
      g.key = key;
    }
    g.target = tg;
    g.float.querySelector('span').textContent = calTargetText(tg);
    // a preview of where the block will land in the hour grid
    let ind = $('cdInd');
    if (tg && tg.kind === 'time') {
      if (!ind) { ind = document.createElement('div'); ind.id = 'cdInd'; ind.className = 'tg-drop'; }
      if (ind.parentElement !== tg.el) tg.el.appendChild(ind);
      const t = findTask(g.id);
      ind.style.top = ((tg.mins - hrs.from * 60) / 60 * HOUR_PX) + 'px';
      ind.style.height = Math.max(20, (t && t.est ? t.est : 60) / 60 * HOUR_PX - 2) + 'px';
      ind.textContent = calMinsText(tg.mins);
    } else if (ind) ind.remove();
  } else {
    const col = g.kind === 'resize' ? g.col : g.el;
    const yy = y - col.getBoundingClientRect().top;
    const at = Math.max(hrs.from * 60, Math.min(hrs.to * 60, hrs.from * 60 + Math.round(yy / HOUR_PX * 4) * 15));
    if (g.kind === 'resize') {
      const est = Math.max(15, Math.min(12 * 60, at - g.startMins));
      if (est !== g.est) haptic(3);
      g.est = est;
      g.el.style.height = Math.max(22, Math.min(est, hrs.to * 60 - g.startMins) / 60 * HOUR_PX - 2) + 'px';
      const tm = g.el.querySelector('.tm');
      if (tm) tm.textContent = calMinsText(g.startMins) + ' – ' + calMinsText(g.startMins + est) + ' · ' + fmtEst(est);
    } else {
      let a = Math.min(g.a0, at), b = Math.max(g.a0 + 15, at);
      if (at <= g.a0) { a = Math.max(hrs.from * 60, at); b = g.a0 + 15; }
      g.a = a; g.b = b;
      g.box.style.top = ((a - hrs.from * 60) / 60 * HOUR_PX) + 'px';
      g.box.style.height = ((b - a) / 60 * HOUR_PX) + 'px';
      g.box.textContent = calMinsText(a) + ' – ' + calMinsText(b);
    }
  }
}
// Near the top / bottom edge of the hour grid, scroll it so you can drag to any hour.
function cdAutoScroll() {
  if (!cdrag) return;
  const tg = $('tgScroll');
  if (tg) {
    const r = tg.getBoundingClientRect();
    const head = tg.querySelector('.tg-top');
    const top = r.top + (head ? head.offsetHeight : 0);
    let dy = 0;
    if (cdrag.y < top + 36 && cdrag.y > r.top - 40) dy = -Math.ceil((top + 36 - cdrag.y) / 6);
    else if (cdrag.y > r.bottom - 36 && cdrag.y < r.bottom + 60) dy = Math.ceil((cdrag.y - r.bottom + 36) / 6);
    if (dy && cdrag.kind !== 'move' || dy && cdrag.target && cdrag.target.kind === 'time') {
      tg.scrollTop += Math.max(-14, Math.min(14, dy));
      cdMove(cdrag.x, cdrag.y);
    }
  }
  requestAnimationFrame(cdAutoScroll);
}
function cdCleanup(g) {
  calDragOn = false;
  document.body.classList.remove('cal-dragging');
  if (g.float) g.float.remove();
  if (g.box) g.box.remove();
  if ($('cdInd')) $('cdInd').remove();
  document.querySelectorAll('.cddrop, .cdsrc, .resizing').forEach(function (el) { el.classList.remove('cddrop', 'cdsrc', 'resizing'); });
  calNoTapUntil = now() + 300;          // eats only the click that ends this drag
  suppressClickUntil = now() + 300;
}
function cdEnd() {
  const g = cdrag;
  if (!g) return;
  cdrag = null;
  cdCleanup(g);
  if (g.kind === 'move') {
    if (g.target) calDropTask(g.id, g.target); else renderCalendar();
  } else if (g.kind === 'resize') {
    const t = findTask(g.id);
    if (t && g.est !== (t.est || 60)) {
      snapshot('Changed how long it takes');
      t.est = g.est;
      t.updatedAt = now();
      save(); renderTaskViews();
      toast('"' + shortTitle(t.title) + '" now takes ' + fmtEst(g.est), { undo: true });
    } else renderCalendar();
  } else if (g.a !== undefined) {
    openAddSheet(null, { date: g.day, time: calHHMM(g.a), est: g.b - g.a !== 60 ? g.b - g.a : null });
  }
}
function cdCancel() {
  if (cdHold) { clearTimeout(cdHold.timer); cdHold = null; }
  if (!cdrag) return;
  const g = cdrag;
  cdrag = null;
  cdCleanup(g);
  renderCalendar();
}

// mouse / pen: drag after moving a few pixels; a plain click still works as before
document.addEventListener('pointerdown', function (e) {
  if (e.pointerType === 'touch' || e.button !== 0 || view !== 'calendar' || sheetCtx) return;
  const pre = cdPick(e.target);
  if (pre) cdPending = { pre: pre, x0: e.clientX, y0: e.clientY };
});
document.addEventListener('pointermove', function (e) {
  if (e.pointerType === 'touch') return;
  if (cdPending && Math.abs(e.clientX - cdPending.x0) + Math.abs(e.clientY - cdPending.y0) > 6) {
    const p = cdPending;
    cdPending = null;
    cdBegin(p.pre, e.clientX, e.clientY);
  }
  if (cdrag) { e.preventDefault(); cdMove(e.clientX, e.clientY); }
});
document.addEventListener('pointerup', function (e) {
  if (e.pointerType === 'touch') return;
  cdPending = null;
  if (cdrag) cdEnd();
});
// touch: hold still, then drag (moving first just scrolls)
document.addEventListener('touchstart', function (e) {
  if (cdHold) { clearTimeout(cdHold.timer); cdHold = null; }
  if (view !== 'calendar' || e.touches.length !== 1 || cdrag || sheetCtx) return;
  const pre = cdPick(e.target);
  if (!pre) return;
  const tch = e.touches[0];
  cdHold = { pre: pre, x0: tch.clientX, y0: tch.clientY, x: tch.clientX, y: tch.clientY };
  cdHold.timer = setTimeout(function () {
    const h = cdHold;
    cdHold = null;
    if (!h) return;
    haptic(14);
    cdBegin(h.pre, h.x, h.y);
  }, pre.kind === 'resize' ? 150 : 380);
}, { passive: true });
document.addEventListener('touchmove', function (e) {
  const tch = e.touches[0];
  if (cdrag) { if (e.cancelable) e.preventDefault(); cdMove(tch.clientX, tch.clientY); return; }
  if (!cdHold) return;
  cdHold.x = tch.clientX; cdHold.y = tch.clientY;
  if (Math.abs(cdHold.x - cdHold.x0) > 9 || Math.abs(cdHold.y - cdHold.y0) > 9) { clearTimeout(cdHold.timer); cdHold = null; }
}, { passive: false });
document.addEventListener('touchend', function () {
  if (cdHold) { clearTimeout(cdHold.timer); cdHold = null; }
  if (cdrag) cdEnd();
});
document.addEventListener('touchcancel', cdCancel);
document.addEventListener('keydown', function (e) {
  if (e.key !== 'Escape') return;
  if (cdrag) cdCancel();
  else if (calMoveId) { calMoveId = null; renderCalChrome(); }
});
// the click that ends a drag shouldn't also open a day or add a task
document.addEventListener('click', function (e) {
  if (now() < calNoTapUntil && e.target.closest('#calBody, #calDrawer')) { e.stopPropagation(); e.preventDefault(); calNoTapUntil = 0; }
}, true);
// stop the browser's own drag / context menu getting in the way
document.addEventListener('contextmenu', function (e) { if (cdrag || (view === 'calendar' && e.target.closest('#calBody [data-drag], #calDrawer [data-drag]') && e.pointerType !== 'mouse')) e.preventDefault(); });

// ---------- move mode: pick a task, then tap a day ----------
function calStartMove(id) {
  calMoveId = id;
  haptic(8);
  renderCalChrome();
}
document.addEventListener('click', function (e) {
  if (!calMoveId || view !== 'calendar' || !e.target.closest('#calBody')) return;
  const tg = calDropAt(e.clientX, e.clientY);
  if (!tg || tg.kind === 'nodate') return;
  e.stopPropagation(); e.preventDefault();
  const id = calMoveId;
  calMoveId = null;
  calDropTask(id, tg);
  renderCalChrome();
}, true);
// phone day sheet: hold a task → the sheet closes and you tap the new day
(function () {
  let hold = null;
  $('sheet').addEventListener('pointerdown', function (e) {
    if (!sheetCtx || sheetCtx.type !== 'calpeek') return;
    const inner = e.target.closest('.peeklist .task-inner');
    if (!inner || e.target.closest('.check, .boxbtn')) return;
    const id = inner.parentElement.dataset.id;
    hold = { x: e.clientX, y: e.clientY, timer: setTimeout(function () {
      hold = null;
      suppressClickUntil = now() + 700;
      calNoTapUntil = now() + 500;
      closeSheet();
      calStartMove(id);
    }, 480) };
  });
  function stop() { if (hold) { clearTimeout(hold.timer); hold = null; } }
  $('sheet').addEventListener('pointermove', function (e) { if (hold && Math.abs(e.clientX - hold.x) + Math.abs(e.clientY - hold.y) > 10) stop(); });
  $('sheet').addEventListener('pointerup', stop);
  $('sheet').addEventListener('pointercancel', stop);
  $('sheet').addEventListener('contextmenu', function (e) { if (e.target.closest('.peeklist')) e.preventDefault(); });
})();

// ---------- the drawer: no date / overdue ----------
function calDrawerHTML() {
  const tab = state.ui.calDrawer === 'late' ? 'late' : 'nodate';
  const und = calUndated(), late = calOverdue();
  const list = tab === 'late' ? late : und;
  return '<div class="cdr-head"><div class="seg cdr-tabs">' +
      '<button class="' + (tab === 'nodate' ? 'on' : '') + '" data-action="cdrtab" data-t="nodate">No date <b>' + und.length + '</b></button>' +
      '<button class="' + (tab === 'late' ? 'on' : '') + '" data-action="cdrtab" data-t="late">Overdue <b' + (late.length ? ' class="late"' : '') + '>' + late.length + '</b></button></div>' +
      (tab === 'late' && late.length ? '<button class="btn small" data-action="callatetoday">All to today</button>' : '') +
      '<button class="icon-btn sm" data-action="cdrtoggle" aria-label="Close the drawer">×</button></div>' +
    '<p class="small cdr-tip">' + (calPhone() ? 'Tap a task, then tap a day. Or hold it and drag.' : 'Drag a task onto a day or an hour. Drop one here to take its date away.') + '</p>' +
    '<div class="cdr-list">' + (list.map(function (t) {
      const meta = [];
      if (tab === 'late') meta.push(taskDate(t) === t.due ? fmtDue(t.due, t.hasTime) : 'deadline ' + calShortDay(t.deadline));
      meta.push(listOf(t).name);
      if (t.someday) meta.push('Someday');
      if (t.est) meta.push('~' + fmtEst(t.est));
      return '<div class="drit q' + (t.q || 0) + (calMoveId === t.id ? ' picked' : '') + '" data-drag="' + t.id + '" style="--lc:' + listOf(t).color + '">' +
        '<button class="drit-b" data-action="cdrpick" data-id="' + t.id + '"><span class="ttl">' + esc(t.title) + '</span><span class="small">' + esc(meta.join(' · ')) + '</span></button>' +
        '<button class="icon-btn sm" data-action="open" data-id="' + t.id + '" aria-label="Details">⋯</button></div>';
    }).join('') || '<p class="small cdr-empty">' + (tab === 'late' ? 'Nothing overdue. Nice.' : 'Every task has a date.') + '</p>') + '</div>';
}
// Toolbar badges, the drawer and the move banner. Called at the end of every renderCalendar().
function renderCalChrome() {
  const und = calUndated().length, late = calOverdue().length;
  const b = $('calDrawerBtn');
  if (b) {
    b.classList.toggle('on', !!state.ui.calDrawer);
    b.querySelector('b').textContent = late || und || '';
    b.querySelector('b').className = late ? 'late' : '';
  }
  if ($('calOptsBtn')) $('calOptsBtn').classList.toggle('filt', calFilterOn());
  const dr = $('calDrawer');
  const open = !!state.ui.calDrawer;
  dr.hidden = !open;
  $('view-calendar').classList.toggle('cdr-open', open);
  $('calWrap').classList.toggle('drw', open);
  if (open && !calDragOn) {
    const keep = dr.querySelector('.cdr-list') ? dr.querySelector('.cdr-list').scrollTop : 0;
    dr.innerHTML = calDrawerHTML();
    dr.querySelector('.cdr-list').scrollTop = keep;
    const tabs = document.querySelector('.tabs');
    dr.style.bottom = calPhone() && tabs ? tabs.offsetHeight + 'px' : '';
  }
  const mv = $('calMove');
  const t = calMoveId ? findTask(calMoveId) : null;
  if (calMoveId && !t) calMoveId = null;
  mv.hidden = !t;
  document.body.classList.toggle('cal-moving', !!t);
  if (t) mv.innerHTML = '<span>Tap a day' + (TIMED_MODES[calMode()] ? ' or a time' : '') + ' to move <b>' + esc(shortTitle(t.title)) + '</b></span><button class="btn small" data-action="calmovecancel">Cancel</button>';
}
actions.cdrtoggle = function () { state.ui.calDrawer = state.ui.calDrawer ? null : (calOverdue().length ? 'late' : 'nodate'); save(); haptic(5); renderCalChrome(); };
actions.cdrtab = function (el) { state.ui.calDrawer = el.dataset.t; save(); renderCalChrome(); };
actions.cdrpick = function (el) { if (calMoveId === el.dataset.id) { calMoveId = null; renderCalChrome(); } else calStartMove(el.dataset.id); };
actions.calmovecancel = function () { calMoveId = null; renderCalChrome(); };
actions.callatetoday = function () {
  const late = calOverdue();
  if (!late.length) return;
  snapshot('Moved late tasks to today');
  const today = midnight(now());
  late.forEach(function (t) { calPlaceTask(t, today, null, false); });
  save();
  renderTaskViews();
  sound('soft');
  toast('Moved ' + late.length + (late.length === 1 ? ' task' : ' tasks') + ' to today', { undo: true });
};

// ---------- View options ----------
function calOptsHTML() {
  const s = state.settings, f = calFilter();
  const count = {};
  liveTasks().forEach(function (t) { if (!t.done) t.tags.forEach(function (g) { count[g] = (count[g] || 0) + 1; }); });
  const tags = Object.keys(count).sort(function (a, b) { return count[b] - count[a]; }).slice(0, 16);
  f.tags.forEach(function (g) { if (tags.indexOf(g) === -1) tags.push(g); });
  function tog(key, label) {
    const on = key === 'calWeekNums' || key === 'calNotesPhone' ? !!s[key] : s[key] !== false;
    return '<button class="pick' + (on ? ' on' : '') + '" data-action="calset" data-k="' + key + '" aria-pressed="' + on + '">' + label + '</button>';
  }
  function hourOpts(from, to, val) {
    let o = '';
    for (let h = from; h <= to; h++) o += '<option value="' + h + '"' + (h === val ? ' selected' : '') + '>' + (h === 24 ? 'Midnight' : calHourText(h)) + '</option>';
    return o;
  }
  const hrs = calHours();
  return '<h3>Calendar view</h3>' +
    '<p class="label">Show only these boxes</p><div class="daterow">' + [1, 2, 3, 4, 0].map(function (q) {
      const on = f.q.indexOf(q) !== -1;
      return '<button class="pick qpick q' + q + (on ? ' on' : '') + '" data-action="calfq" data-q="' + q + '" aria-pressed="' + on + '"><i></i>' + (q ? esc(quadName(q)) : 'Not sorted') + '</button>';
    }).join('') + '</div>' +
    (tags.length ? '<p class="label">Show only these tags</p><div class="daterow">' + tags.map(function (g) {
      const on = f.tags.indexOf(g) !== -1;
      return '<button class="pick' + (on ? ' on' : '') + '" data-action="calftag" data-g="' + esc(g) + '" aria-pressed="' + on + '">#' + esc(g) + '</button>';
    }).join('') + '</div>' : '') +
    (calFilterOn() ? '<div class="row"><button class="btn small" data-action="calfclear">Show everything again</button></div>' : '') +
    '<p class="small">Lists are picked in the bar at the top of the Calendar.</p>' +
    '<p class="label">On the calendar</p><div class="daterow">' + tog('calShowDone', 'Completed tasks') + tog('calRepeats', 'Future repeats') +
      tog('calCt', 'ColorTracker strip') + tog('calHabits', 'Habit ticks') + tog('calWeekNums', 'Week numbers') + '</div>' +
    '<p class="label">Notes from daily notebooks</p><div class="daterow">' + tog('calNotes', 'In the day card (laptop)') + tog('calNotesPhone', 'In the day sheet (phone)') + '</div>' +
    '<p class="label">Week starts on</p><div class="daterow">' +
      '<button class="pick' + (s.calWeekStart !== 0 ? ' on' : '') + '" data-action="calws" data-v="1">Monday</button>' +
      '<button class="pick' + (s.calWeekStart === 0 ? ' on' : '') + '" data-action="calws" data-v="0">Sunday</button></div>' +
    '<p class="label">Hours shown in Day, 3 days and Week</p><div class="daterow hrsrow">' +
      '<select id="calFromSel" aria-label="From">' + hourOpts(0, 20, hrs.from) + '</select><span class="small">to</span>' +
      '<select id="calToSel" aria-label="To">' + hourOpts(4, 24, hrs.to) + '</select></div>' +
    '<p class="small">Tasks outside these hours show in the All day row with their time.</p>' +
    '<div class="row"><button class="btn primary" data-action="close">Done</button></div>';
}
function calOptsChanged(settingsToo) {
  if (settingsToo) state.settings.updatedAt = now();
  save();
  renderCalendar();
  if (sheetCtx && sheetCtx.type === 'calopts') refreshSheet(calOptsHTML());
}
actions.calopts = function () { openSheet({ type: 'calopts' }, calOptsHTML()); };
actions.calset = function (el) {
  const k = el.dataset.k;
  state.settings[k] = k === 'calWeekNums' || k === 'calNotesPhone' ? !state.settings[k] : state.settings[k] === false;
  haptic(5);
  calOptsChanged(true);
};
actions.calws = function (el) { state.settings.calWeekStart = Number(el.dataset.v); calOptsChanged(true); };
actions.calfq = function (el) {
  const f = calFilter(), q = Number(el.dataset.q);
  const i = f.q.indexOf(q);
  if (i === -1) f.q.push(q); else f.q.splice(i, 1);
  state.ui.calFilter = f;
  calOptsChanged(false);
};
actions.calftag = function (el) {
  const f = calFilter(), g = el.dataset.g;
  const i = f.tags.indexOf(g);
  if (i === -1) f.tags.push(g); else f.tags.splice(i, 1);
  state.ui.calFilter = f;
  calOptsChanged(false);
};
actions.calfclear = function () { state.ui.calFilter = { q: [], tags: [] }; calOptsChanged(false); };
$('sheet').addEventListener('change', function (e) {
  if (e.target.id === 'calFromSel' || e.target.id === 'calToSel') {
    let a = Number($('calFromSel').value), b = Number($('calToSel').value);
    if (b - a < 4) { if (e.target.id === 'calFromSel') b = Math.min(24, a + 4); else a = Math.max(0, b - 4); }
    state.settings.calFrom = a;
    state.settings.calTo = b;
    calScrolled = '';
    calOptsChanged(true);
    return;
  }
  // task sheet: "Runs until" (multi-day tasks)
  const t = sheetTask();
  if (!t) return;
  if (e.target.id === 'tUntil') {
    const v = e.target.value ? new Date(e.target.value + 'T00:00').getTime() : null;
    snapshot('Changed last day');
    t.endDate = v !== null && t.due !== null && v > midnight(t.due) ? v : null;
    taskChanged(t); refreshTaskSheet();
  } else if (e.target.id === 'tDate' && t.due === null && t.endDate) { t.endDate = null; taskChanged(t); }
});
actions.tuntil = function () {
  const t = sheetTask();
  if (!t) return;
  snapshot('Made a one-day task');
  t.endDate = null;
  taskChanged(t); refreshTaskSheet();
};

// ---------- search ----------
function calSearchHTML() {
  return '<h3>Find a task</h3>' +
    '<input class="text-input" id="calSearchIn" placeholder="Name, note or #tag" aria-label="Search tasks" enterkeyhint="search" autocomplete="off">' +
    '<ul class="csr" id="calSearchRes"><li class="small">Finds tasks in every list, done ones too. Tap one to jump to its day.</li></ul>' +
    '<div class="row"><button class="btn" data-action="close">Done</button></div>';
}
function calSearchRun(text) {
  const q = text.trim().toLowerCase();
  const out = $('calSearchRes');
  if (!out) return;
  if (!q) { out.innerHTML = '<li class="small">Finds tasks in every list, done ones too. Tap one to jump to its day.</li>'; return; }
  const tag = q.charAt(0) === '#' ? q.slice(1) : null;
  const today = midnight(now());
  const res = liveTasks().filter(function (t) {
    if (tag !== null) return t.tags.some(function (g) { return g.indexOf(tag) === 0; });
    return t.title.toLowerCase().indexOf(q) !== -1 || t.notes.toLowerCase().indexOf(q) !== -1 || t.tags.some(function (g) { return g.indexOf(q) === 0; });
  });
  // open first, then by how close the date is (coming up before past)
  function rank(t) {
    const d = taskDate(t);
    if (d === null) return 1e15;
    return midnight(d) >= today ? midnight(d) - today : 5e14 + (today - midnight(d));
  }
  res.sort(function (a, b) { return (a.done - b.done) || rank(a) - rank(b); });
  out.innerHTML = res.slice(0, 40).map(function (t) {
    const d = taskDate(t);
    const title = esc(t.title).replace(new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\#]/g, '\\$&') + ')', 'ig'), '<mark>$1</mark>');
    return '<li><button class="csr-b q' + (t.q || 0) + (t.done ? ' done' : '') + '" data-action="calfind" data-id="' + t.id + '" style="--lc:' + listOf(t).color + '">' +
      '<span class="ttl">' + title + '</span><span class="small">' + (d !== null ? esc(t.due !== null ? fmtDue(t.due, t.hasTime) : 'deadline ' + calShortDay(d)) : 'No date') +
      ' · ' + esc(listOf(t).name) + (t.done ? ' · done' : '') + '</span></button></li>';
  }).join('') || '<li class="small">Nothing matches "' + esc(text.trim()) + '".</li>';
}
actions.calsearch = function () {
  openSheet({ type: 'calsearch' }, calSearchHTML());
  setTimeout(function () { if ($('calSearchIn')) $('calSearchIn').focus(); }, 60);
};
$('sheet').addEventListener('input', function (e) { if (e.target.id === 'calSearchIn') calSearchRun(e.target.value); });
// Jump to the task's day and make it blink so it's easy to spot.
actions.calfind = function (el) {
  const t = findTask(el.dataset.id);
  if (!t) return;
  closeSheet();
  const d = taskDate(t);
  if (d === null) { setTimeout(function () { openTask(t.id); }, 340); return; }
  calSel = midnight(d);
  calAnchor = calSel;
  if (calMode() === 'year' || calMode() === 'agenda') state.ui.calMode = 'month';
  calScrolled = '';
  if (!calShows(t)) toast('It\'s on ' + calShortDay(d) + ', but a filter hides it here.');
  renderCalendar();
  setTimeout(function () {
    if (calPhone() && (calMode() === 'month' || calMode() === '2week')) openCalPeek(calSel);
    setTimeout(function () {
      const sel = '[data-id="' + t.id + '"], [data-drag="' + t.id + '"]';
      const hit = (sheetCtx && document.querySelector('#sheet ' + sel)) || document.querySelector('#calBody ' + sel) || document.querySelector('#calList ' + sel);
      if (!hit) return;
      hit.scrollIntoView({ block: 'center', behavior: 'smooth' });
      hit.classList.add('cflash');
      setTimeout(function () { hit.classList.remove('cflash'); }, 1600);
    }, 120);
  }, 340);
};

// ---------- jump to a date (tap the title) ----------
function calJumpHTML() {
  const ms = calJumpMonth;
  const today = midnight(now());
  const map = tasksByDay();
  const firstWd = state.settings.calWeekStart === 0 ? 0 : 1;
  const lead = (new Date(ms).getDay() - firstWd + 7) % 7;
  const inMonth = new Date(new Date(ms).getFullYear(), new Date(ms).getMonth() + 1, 0).getDate();
  let cells = weekdayHeads('jwd');
  for (let i = 0; i < lead; i++) cells += '<span></span>';
  for (let day = 1; day <= inMonth; day++) {
    const d = new Date(new Date(ms).getFullYear(), new Date(ms).getMonth(), day).getTime();
    const has = (map[d] || []).some(function (t) { return !t.done; });
    cells += '<button class="jday' + (d === today ? ' today' : '') + (d === calSel ? ' sel' : '') + (has ? ' has' : '') + (isOffDay(d) ? ' off' : '') + '" data-action="caljumpto" data-d="' + d + '">' + day + '</button>';
  }
  return '<div class="peek-head"><button class="icon-btn sm" data-action="caljumpstep" data-d="-1" aria-label="Previous month">‹</button>' +
    '<div><h3>' + new Date(ms).toLocaleDateString([], { month: 'long', year: 'numeric' }) + '</h3><p class="small">Pick a day to jump to it</p></div>' +
    '<button class="icon-btn sm" data-action="caljumpstep" data-d="1" aria-label="Next month">›</button></div>' +
    '<div class="jgrid">' + cells + '</div>' +
    '<div class="row"><button class="btn" data-action="caljumpto" data-d="' + today + '">Today</button><button class="btn" data-action="close">Close</button></div>';
}
actions.caljump = function () {
  calJumpMonth = monthStart(calSel || now());
  openSheet({ type: 'caljump' }, calJumpHTML());
};
actions.caljumpstep = function (el) { calJumpMonth = addMonths(calJumpMonth, Number(el.dataset.d)); refreshSheet(calJumpHTML()); haptic(5); };
actions.caljumpto = function (el) {
  const d = Number(el.dataset.d);
  closeSheet();
  calSel = d;
  calAnchor = d;
  calAgendaExtra = 0;
  if (calMode() === 'year') state.ui.calMode = 'month';
  calScrolled = '';
  haptic(5);
  renderCalendar();
};

// ---------- zoom: Day ↔ 3 days ↔ Week ↔ 2 weeks ↔ Month ↔ Year ----------
function calZoom(dir) {
  const i = CAL_ZOOM.indexOf(calMode());
  const j = i === -1 ? CAL_ZOOM.indexOf('week') : Math.max(0, Math.min(CAL_ZOOM.length - 1, i + dir));
  if (j === i) return;
  state.ui.calMode = CAL_ZOOM[j];
  calAnchor = calSel;
  save();
  haptic(8);
  renderCalendar();
  const inner = $('calBody').firstElementChild;
  if (inner && inner.animate) inner.animate([{ transform: 'scale(' + (dir > 0 ? 1.06 : 0.94) + ')', opacity: 0.4 }, { transform: 'none', opacity: 1 }], { duration: 220, easing: 'ease-out' });
}
$('calBody').addEventListener('wheel', function (e) {
  if (!e.ctrlKey) return;
  e.preventDefault();
  if (now() - cdLastWheel < 450 || Math.abs(e.deltaY) < 4) return;
  cdLastWheel = now();
  calZoom(e.deltaY > 0 ? 1 : -1);
}, { passive: false });

// ---------- swipe to page (the view follows your finger) and pinch to zoom ----------
(function () {
  const body = $('calBody');
  let sw = null, pinch = null;
  function gap(e) { const a = e.touches[0], b = e.touches[1]; return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY); }
  function settle(inner) {
    if (!inner) return;
    inner.style.transition = 'transform 0.2s ease, opacity 0.2s ease';
    inner.style.transform = '';
    inner.style.opacity = '';
    setTimeout(function () { inner.style.transition = ''; }, 220);
  }
  body.addEventListener('touchstart', function (e) {
    if (e.touches.length === 2) { if (sw) settle(sw.inner); sw = null; pinch = { d0: gap(e), done: false }; return; }
    sw = null;
    if (e.touches.length !== 1 || calDragOn || calMoveId || e.target.closest('.task-inner')) return;
    sw = { x0: e.touches[0].clientX, y0: e.touches[0].clientY, dx: 0, dir: null, inner: body.firstElementChild };
  }, { passive: true });
  body.addEventListener('touchmove', function (e) {
    if (pinch && e.touches.length === 2) {
      if (e.cancelable) e.preventDefault();
      const r = gap(e) / pinch.d0;
      if (!pinch.done && (r > 1.35 || r < 0.75)) { pinch.done = true; calZoom(r > 1 ? -1 : 1); }
      return;
    }
    if (!sw) return;
    if (calDragOn || cdrag) { settle(sw.inner); sw = null; return; }
    const dx = e.touches[0].clientX - sw.x0, dy = e.touches[0].clientY - sw.y0;
    if (!sw.dir) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      sw.dir = Math.abs(dx) > Math.abs(dy) * 1.3 ? 'x' : 'y';
      if (sw.dir === 'y') { sw = null; return; }
      if (cdHold) { clearTimeout(cdHold.timer); cdHold = null; }
    }
    sw.dx = dx;
    if (sw.inner) { sw.inner.style.transform = 'translateX(' + (dx * 0.45) + 'px)'; sw.inner.style.opacity = String(1 - Math.min(0.5, Math.abs(dx) / 700)); }
  }, { passive: false });
  body.addEventListener('touchend', function (e) {
    if (pinch && e.touches.length < 2) pinch = null;
    if (!sw) return;
    const g = sw;
    sw = null;
    if (g.dir !== 'x') return;
    if (Math.abs(g.dx) > 70) {
      calStep(g.dx < 0 ? 1 : -1);
      const inner = body.firstElementChild;
      if (inner && inner.animate) inner.animate([{ transform: 'translateX(' + (g.dx < 0 ? 40 : -40) + 'px)', opacity: 0.3 }, { transform: 'none', opacity: 1 }], { duration: 220, easing: 'ease-out' });
    } else settle(g.inner);
  });
})();

// keep the drawer above the tab bar when the window changes size
window.addEventListener('resize', function () { if (view === 'calendar' && state.ui.calDrawer) renderCalChrome(); });
