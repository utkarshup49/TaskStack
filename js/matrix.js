/* =========================================================
   Matrix: the four Eisenhower boxes.
   - tick animation + sound + vibration
   - swipe right = done, swipe left = delete (with Undo)
   - hold a task, then drag it into another box
   - quick add that understands "tomorrow 5pm !1 #college"
   ========================================================= */

let addQ = 1;
const CHECK_SVG = '<svg viewBox="0 0 22 22" aria-hidden="true"><path d="M6.5 11.5l3 3 6-6.5"/></svg>';
const CAL_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>';
const LIST_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7l2 2 3-3M4 15l2 2 3-3M12 8h8M12 16h8"/></svg>';
const CHEVRON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>';
const EMPTY_TEXT = { 1: 'Nothing urgent. Nice.', 2: 'Plan something that matters.', 3: 'Nothing to hand off.', 4: 'Nothing to drop.' };

function shortTitle(s) { return s.length > 28 ? s.slice(0, 27) + '…' : s; }

// ---------- quick add ----------
function renderQpick() {
  $('qpick').innerHTML = QUADS.map(function (q) {
    const on = q.q === addQ;
    return '<button type="button" class="qchip q' + q.q + (on ? ' on' : '') + '" data-action="pickq" data-q="' + q.q + '" aria-pressed="' + on + '">' + q.name + '</button>';
  }).join('');
  $('addInput').placeholder = 'Add to ' + QUADS[addQ - 1].name + ' (try "tomorrow 5pm #college")';
}
function renderParse() {
  const text = $('addInput').value;
  const chips = text.trim() ? quickAddChips(parseQuickAdd(text)) : [];
  $('parsePreview').innerHTML = chips.map(function (c) { return '<span class="chip">' + esc(c) + '</span>'; }).join('');
}
function addTaskFromInput() {
  const input = $('addInput');
  const raw = input.value.trim();
  if (!raw) return;
  const p = parseQuickAdd(raw);
  const task = newTask(p.title || raw, p.q || addQ, { due: p.due, hasTime: p.hasTime, tags: p.tags });
  snapshot('Added task');
  state.tasks.push(task);
  save();
  input.value = '';
  renderParse();
  renderMatrix();
  afterTaskChange();
  sound('soft');
  const li = document.querySelector('.task[data-id="' + task.id + '"]');
  if (li && li.animate) li.animate([{ transform: 'scale(0.92)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 260, easing: 'cubic-bezier(0.34,1.56,0.64,1)' });
  input.focus();
}

// ---------- drawing the boxes ----------
function sortOpen(list) {
  return list.slice().sort(function (a, b) {
    const da = a.due || Infinity, db = b.due || Infinity;
    return (da - db) || (a.createdAt - b.createdAt);
  });
}
function taskHTML(t) {
  const meta = [];
  if (t.due) {
    const cls = isOverdue(t) ? ' late' : (midnight(t.due) === midnight(now()) ? ' today' : '');
    meta.push('<span class="chip' + cls + '">' + CAL_SVG + esc(fmtDue(t.due, t.hasTime)) + '</span>');
  }
  if (t.subtasks.length) {
    const d = t.subtasks.filter(function (s) { return s.done; }).length;
    meta.push('<span class="chip">' + LIST_SVG + d + '/' + t.subtasks.length + '</span>');
  }
  t.tags.forEach(function (tag) { meta.push('<span class="chip">#' + esc(tag) + '</span>'); });
  const poms = pomCount(t.id);
  if (poms) meta.push('<span class="chip">' + poms + ' pom</span>');
  return '<li class="task q' + t.q + (t.done ? ' done' : '') + '" data-id="' + t.id + '">' +
    '<div class="task-bg" aria-hidden="true"><span class="bg-done">' + (t.done ? 'Not done' : 'Done') + '</span><span class="bg-del">Delete</span></div>' +
    '<div class="task-inner">' +
      '<button class="check" data-action="toggle" data-id="' + t.id + '" aria-label="' + (t.done ? 'Mark not done' : 'Mark done') + '">' + CHECK_SVG + '</button>' +
      '<button class="tbody" data-action="open" data-id="' + t.id + '"><span class="ttl">' + esc(t.title) + (t.example ? '<span class="eg">example</span>' : '') + '</span>' +
      (meta.length ? '<span class="meta">' + meta.join('') + '</span>' : '') + '</button>' +
    '</div></li>';
}
function renderMatrix() {
  const tasks = liveTasks();
  const scrolls = {};
  document.querySelectorAll('.quad .tasks').forEach(function (ul) { scrolls[ul.parentElement.dataset.q] = ul.scrollTop; });
  $('matrixGrid').innerHTML = QUADS.map(function (q) {
    const mine = tasks.filter(function (t) { return t.q === q.q; });
    const open = sortOpen(mine.filter(function (t) { return !t.done; }));
    const done = mine.filter(function (t) { return t.done; }).sort(function (a, b) { return (b.doneAt || 0) - (a.doneAt || 0); });
    const showDone = !!state.ui.showDone[q.q];
    let list = open.length ? open.map(taskHTML).join('') : '<li class="empty">' + EMPTY_TEXT[q.q] + '</li>';
    if (done.length) {
      list += '<li><button class="done-toggle" data-action="showdone" data-q="' + q.q + '" aria-expanded="' + showDone + '">' + CHEVRON_SVG + 'Done · ' + done.length + '</button></li>';
      if (showDone) list += done.map(taskHTML).join('');
    }
    return '<div class="quad q' + q.q + '" data-q="' + q.q + '">' +
      '<div class="quad-head"><div><h2>' + q.name + '</h2><span class="sub">' + q.sub + '</span></div>' +
      '<div class="quad-tools"><span class="count">' + open.length + '</span>' +
      '<button class="quad-add" data-action="addhere" data-q="' + q.q + '" aria-label="Add a task to ' + q.name + '">+</button></div></div>' +
      '<ul class="tasks">' + list + '</ul></div>';
  }).join('');
  document.querySelectorAll('.quad .tasks').forEach(function (ul) { const y = scrolls[ul.parentElement.dataset.q]; if (y) ul.scrollTop = y; });
}
function afterTaskChange() { if (typeof renderTaskSelect === 'function') renderTaskSelect(); }

// ---------- actions on a task ----------
function toggleTask(id, fromSwipe) {
  const t = findTask(id);
  if (!t) return;
  if (t.done) {
    snapshot('Marked not done');
    t.done = false; t.doneAt = null; t.updatedAt = now();
    save(); renderMatrix(); afterTaskChange();
    return;
  }
  snapshot('Completed task');
  t.done = true; t.doneAt = now(); t.updatedAt = now();
  save();
  sound('tick');
  haptic(14);
  const li = document.querySelector('.task[data-id="' + id + '"]');
  if (li && !fromSwipe) {
    li.classList.add('completing', 'done', 'leaving');
    setTimeout(function () { renderMatrix(); afterTaskChange(); }, 720);
  } else {
    renderMatrix(); afterTaskChange();
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
  renderMatrix(); afterTaskChange();
  toast('Deleted "' + shortTitle(t.title) + '"', { undo: true });
}
function moveTask(id, q) {
  const t = findTask(id);
  if (!t || t.q === q) return;
  snapshot('Moved task');
  t.q = q; t.updatedAt = now();
  save();
  haptic(12);
  renderMatrix();
  const li = document.querySelector('.task[data-id="' + id + '"]');
  if (li && li.animate) li.animate([{ transform: 'scale(1.06)' }, { transform: 'none' }], { duration: 300, easing: 'cubic-bezier(0.34,1.56,0.64,1)' });
  toast('Moved to ' + QUADS[q - 1].name, { undo: true });
}

// ---------- gestures: swipe and hold-to-drag ----------
let gest = null;
let suppressClickUntil = 0;

function startDrag(x, y) {
  gest.mode = 'drag';
  haptic(18);
  const t = findTask(gest.id);
  const r = gest.inner.getBoundingClientRect();
  const ghost = gest.inner.cloneNode(true);
  ghost.classList.add('ghost', 'q' + t.q);
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

const matrixEl = $('matrixGrid');
// Touch: hold still ~0.4 s to pick a task up; slide sideways to swipe; slide up/down to scroll.
matrixEl.addEventListener('touchstart', function (e) {
  if (e.touches.length !== 1) { cancelGesture(); return; }
  const inner = e.target.closest('.task-inner');
  if (!inner || e.target.closest('.check')) return;
  const tch = e.touches[0];
  gest = { li: inner.parentElement, inner: inner, id: inner.parentElement.dataset.id, x0: tch.clientX, y0: tch.clientY, x: tch.clientX, y: tch.clientY, mode: null, past: false };
  gest.timer = setTimeout(function () { if (gest && !gest.mode) startDrag(gest.x, gest.y); }, 400);
}, { passive: true });
matrixEl.addEventListener('touchmove', function (e) {
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
matrixEl.addEventListener('touchend', function () {
  if (!gest) return;
  clearTimeout(gest.timer);
  if (gest.mode === 'swipe') finishSwipe();
  else if (gest.mode === 'drag') finishDrag();
  gest = null;
});
matrixEl.addEventListener('touchcancel', cancelGesture);
matrixEl.addEventListener('contextmenu', function (e) { if (e.target.closest('.task')) e.preventDefault(); });

// Mouse (laptop): press and drag a task to another box.
matrixEl.addEventListener('mousedown', function (e) {
  if (e.button !== 0) return;
  const inner = e.target.closest('.task-inner');
  if (!inner || e.target.closest('.check')) return;
  gest = { li: inner.parentElement, inner: inner, id: inner.parentElement.dataset.id, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, mode: null, mouse: true };
});
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

// ---------- task details sheet ----------
function taskSheetHTML(t) {
  const dateVal = t.due ? dayKey(t.due) : '';
  const timeVal = t.due && t.hasTime ? String(new Date(t.due).getHours()).padStart(2, '0') + ':' + String(new Date(t.due).getMinutes()).padStart(2, '0') : '';
  return '<h3>Task</h3>' +
    '<input class="text-input" id="tTitle" value="' + esc(t.title) + '" aria-label="Task name">' +
    '<p class="label">Box</p><div class="qmove">' + QUADS.map(function (q) {
      return '<button class="q' + q.q + (t.q === q.q ? ' on' : '') + '" data-action="tmove" data-q="' + q.q + '">' + q.name + '</button>';
    }).join('') + '</div>' +
    '<p class="label">Due' + (t.due ? ' · ' + esc(fmtDue(t.due, t.hasTime)) : '') + '</p>' +
    '<div class="daterow">' +
      '<button class="btn small" data-action="tdue" data-d="0">Today</button>' +
      '<button class="btn small" data-action="tdue" data-d="1">Tomorrow</button>' +
      '<button class="btn small" data-action="tdue" data-d="7">Next week</button>' +
      (t.due ? '<button class="btn small" data-action="tdue" data-d="clear">No date</button>' : '') +
    '</div>' +
    '<div class="daterow"><input type="date" id="tDate" value="' + dateVal + '" aria-label="Due date"><input type="time" id="tTime" value="' + timeVal + '" aria-label="Due time"></div>' +
    '<p class="label">Checklist</p>' +
    '<ul class="subtasks">' + t.subtasks.map(function (s) {
      return '<li><input type="checkbox" data-sub="' + s.id + '"' + (s.done ? ' checked' : '') + ' aria-label="Done"><input class="text-input" data-subtext="' + s.id + '" value="' + esc(s.title) + '" aria-label="Step"><button class="x" data-action="tsubdel" data-sub="' + s.id + '" aria-label="Remove step">×</button></li>';
    }).join('') + '</ul>' +
    '<input class="text-input" id="tSubAdd" placeholder="Add a step, then press Enter" enterkeyhint="done">' +
    '<p class="label">Notes</p>' +
    '<textarea class="text-input" id="tNotes" placeholder="Anything to remember">' + esc(t.notes) + '</textarea>' +
    '<p class="label">Tags</p>' +
    '<input class="text-input" id="tTags" value="' + esc(t.tags.join(', ')) + '" placeholder="college, exam">' +
    '<div class="row"><button class="btn primary" data-action="tfocus">Focus on this</button></div>' +
    '<div class="row"><button class="btn danger" data-action="tdelete">Delete</button><button class="btn" data-action="close">Done</button></div>';
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
function taskChanged(t) { t.updatedAt = now(); save(); renderMatrix(); afterTaskChange(); }

$('sheet').addEventListener('change', function (e) {
  const t = sheetTask();
  if (!t) return;
  const el = e.target;
  if (el.id === 'tTitle') { const v = el.value.trim(); if (v) { t.title = v; taskChanged(t); } }
  else if (el.id === 'tNotes') { t.notes = el.value; taskChanged(t); }
  else if (el.id === 'tTags') { t.tags = el.value.split(',').map(function (s) { return s.trim().replace(/^#/, '').toLowerCase(); }).filter(Boolean); taskChanged(t); }
  else if (el.id === 'tDate' || el.id === 'tTime') {
    const d = $('tDate').value, tm = $('tTime').value;
    snapshot('Changed due date');
    if (!d && !tm) { t.due = null; t.hasTime = false; }
    else {
      const base = d ? new Date(d + 'T00:00').getTime() : midnight(now());
      const mins = tm ? Number(tm.slice(0, 2)) * 60 + Number(tm.slice(3, 5)) : 0;
      t.due = base + mins * MIN;
      t.hasTime = !!tm;
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
actions.pickq = function (el) { addQ = Number(el.dataset.q); renderQpick(); renderParse(); };
actions.addhere = function (el) { addQ = Number(el.dataset.q); renderQpick(); $('addInput').focus(); };
actions.toggle = function (el) { toggleTask(el.dataset.id); };
actions.open = function (el) { if (now() < suppressClickUntil) return; openTask(el.dataset.id); };
actions.showdone = function (el) { const q = el.dataset.q; state.ui.showDone[q] = !state.ui.showDone[q]; save(); renderMatrix(); };
actions.tmove = function (el) { const t = sheetTask(); if (!t) return; moveTask(t.id, Number(el.dataset.q)); refreshTaskSheet(); };
actions.tdue = function (el) {
  const t = sheetTask();
  if (!t) return;
  snapshot('Changed due date');
  if (el.dataset.d === 'clear') { t.due = null; t.hasTime = false; }
  else { t.due = addDays(midnight(now()), Number(el.dataset.d)); t.hasTime = false; }
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

$('addForm').addEventListener('submit', function (e) { e.preventDefault(); addTaskFromInput(); });
$('addInput').addEventListener('input', renderParse);
