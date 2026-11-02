/* =========================================================
   ColorTracker: paint your day hour by hour.

   HOW IT IS STORED
   - Each painted block is a range { start, end, cat, locked } with exact
     times (rounded to the minute). No 5/10-minute snapping.
   - There is ONE continuous timeline. "Days" are never stored:
       24-hour view    -> cut the timeline at midnight
       Sleep to sleep  -> cut it where each main sleep starts
     so the same data always converts to both views.
   ========================================================= */

const MAIN_SLEEP = 3 * HOUR;       // a sleep this long or longer starts a new day; shorter = nap
const SLEEP_MERGE_GAP = HOUR;      // two sleeps closer than this count as one
const LONG_DAY = 36 * HOUR;        // a day longer than this probably means a sleep wasn't logged
const CT_SPARE_COLORS = ['#7c3aed', '#0ea5e9', '#f97316', '#14b8a6', '#a16207', '#be185d', '#4f46e5', '#65a30d'];
const LOCK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
const UNLOCK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.8-1.2"/></svg>';

let ctBrush = 'study';   // selected colour (activity id)
let ctMode = null;       // null = pen off (page scrolls, taps select) | 'paint'. Turns off after one stroke.
let ctSel = null;        // id of the selected block
let ctAnchor = null;     // a moment inside the day on screen; null = today
let ctDay = null;        // the day on screen
let ctDrag = null;
let ctTap = null;
let ctRects = [];
let ctRaf = 0;

function liveCats() { return state.categories.filter(function (c) { return !c.deleted; }); }
function findCat(id) { return state.categories.find(function (c) { return c.id === id; }); }
function catColor(id) { const c = findCat(id); return c && !c.deleted ? c.color : '#9ca3af'; }
function catName(id) { const c = findCat(id); return c && !c.deleted ? c.name : 'Deleted activity'; }
function isSleepCat(id) { const c = findCat(id); return !!(c && c.sleep); }
function liveRanges() { return state.ranges.filter(function (r) { return !r.deleted; }); }
function findRange(id) { return state.ranges.find(function (r) { return r.id === id; }); }
function selRange() { const r = ctSel ? findRange(ctSel) : null; return r && !r.deleted ? r : null; }

function floorHour(t) { const d = new Date(t); d.setMinutes(0, 0, 0); return d.getTime(); }
function ceilHour(t) { const f = floorHour(t); return f === t ? t : f + HOUR; }
function firstMidnightFrom(t) { const m = midnight(t); return m >= t ? m : addDays(m, 1); }
function roundMin(t) { return Math.round(t / MIN) * MIN; }
function pct(ms) { return (ms / HOUR * 100).toFixed(3); }
function ctDayTime(t) { return new Date(t).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }); }
function ctDate(t) { return new Date(t).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }); }
function hourLabel(t) { const h = new Date(t).getHours(); return (h % 12 || 12) + (h < 12 ? 'a' : 'p'); }

// How different two colours look (0 = identical). Below ~50 they're easy to confuse.
function colorDistance(a, b) {
  function rgb(h) { h = h.replace('#', ''); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; }
  const x = rgb(a), y = rgb(b);
  const rm = (x[0] + y[0]) / 2;
  const dr = x[0] - y[0], dg = x[1] - y[1], db = x[2] - y[2];
  return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db) / 3;
}

// ---------- the timeline ----------
// Non-overlapping pieces inside [from, to). If two devices painted the same minutes, the newer edit wins.
function segmentsIn(from, to) {
  const list = liveRanges().filter(function (r) { return r.start < to && r.end > from; });
  const points = [from, to];
  list.forEach(function (r) {
    if (r.start > from && r.start < to) points.push(r.start);
    if (r.end > from && r.end < to) points.push(r.end);
  });
  points.sort(function (a, b) { return a - b; });
  const out = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    if (b <= a) continue;
    let best = null;
    list.forEach(function (r) { if (r.start <= a && r.end >= b && (!best || r.updatedAt > best.updatedAt)) best = r; });
    if (!best) continue;
    const last = out[out.length - 1];
    if (last && last.id === best.id && last.end === a) last.end = b;
    else out.push({ start: a, end: b, cat: best.cat, id: best.id });
  }
  return out;
}
// Free (not yet logged) stretches inside [a, b).
function gapsIn(a, b) {
  const gaps = [];
  let cur = a;
  segmentsIn(a, b).forEach(function (s) {
    if (s.start > cur) gaps.push({ start: cur, end: s.start });
    cur = Math.max(cur, s.end);
  });
  if (cur < b) gaps.push({ start: cur, end: b });
  return gaps.filter(function (g) { return g.end - g.start >= MIN; });
}

// Main sleeps = sleep blocks (joined when close together) that last 3 hours or more.
function mainSleeps() {
  const sleeps = liveRanges().filter(function (r) { return isSleepCat(r.cat); }).sort(function (a, b) { return a.start - b.start; });
  const merged = [];
  sleeps.forEach(function (r) {
    const last = merged[merged.length - 1];
    if (last && r.start - last.end < SLEEP_MERGE_GAP) last.end = Math.max(last.end, r.end);
    else merged.push({ start: r.start, end: r.end });
  });
  return merged.filter(function (s) { return s.end - s.start >= MAIN_SLEEP; });
}

// Sleep-to-sleep days: each starts when a main sleep starts and ends when the next one starts.
function sleepDays() {
  const t = now();
  const ranges = liveRanges();
  const sleeps = mainSleeps();
  const firstStart = ranges.length ? Math.min.apply(null, ranges.map(function (r) { return r.start; })) : t;
  const days = [];
  if (!sleeps.length) {
    days.push({ start: midnight(Math.min(firstStart, t)), end: null, wake: null, estimated: true });
  } else {
    if (firstStart < sleeps[0].start) days.push({ start: midnight(firstStart), end: sleeps[0].start, wake: null, estimated: true });
    sleeps.forEach(function (s, i) {
      days.push({ start: s.start, end: i + 1 < sleeps.length ? sleeps[i + 1].start : null, wake: s.end, estimated: false });
    });
  }
  // A very long day usually means a sleep wasn't logged: split it at midnight and mark it estimated.
  const result = [];
  days.forEach(function (d) {
    const end = d.end || Math.max(t, d.start);
    if (end - d.start <= LONG_DAY) { result.push(d); return; }
    let pieceStart = d.start, first = true;
    let cut = firstMidnightFrom(d.start + 18 * HOUR);
    while (cut < end - 6 * HOUR) {
      result.push({ start: pieceStart, end: cut, wake: first ? d.wake : null, estimated: !first || d.estimated });
      pieceStart = cut; first = false;
      cut = addDays(cut, 1);
    }
    result.push({ start: pieceStart, end: d.end, wake: first ? d.wake : null, estimated: !first || d.estimated });
  });
  return result;
}

function ctCurrentDay() {
  const t = now();
  if (state.ui.ctView === 'clock') {
    const s = midnight(ctAnchor || t);
    return { start: s, end: addDays(s, 1), label: s, clock: true, hasPrev: true, hasNext: s < midnight(t) };
  }
  const days = sleepDays();
  let idx = days.length - 1;
  if (ctAnchor !== null) {
    const found = days.findIndex(function (d) { return ctAnchor >= d.start && ctAnchor < (d.end || Infinity); });
    if (found !== -1) idx = found;
    else if (ctAnchor < days[0].start) idx = 0;
  }
  const d = days[idx];
  return { start: d.start, end: d.end, wake: d.wake, estimated: d.estimated, label: d.wake || d.start, clock: false, index: idx, days: days, hasPrev: idx > 0, hasNext: idx < days.length - 1 };
}
function ctStep(dir) {
  ctSel = null;
  const d = ctCurrentDay();
  if ((dir < 0 && !d.hasPrev) || (dir > 0 && !d.hasNext)) return;
  if (d.clock) {
    const s = addDays(d.start, dir);
    ctAnchor = s === midnight(now()) ? null : s;
  } else {
    ctAnchor = d.index + dir === d.days.length - 1 ? null : d.days[d.index + dir].start;
  }
  renderColor();
}
// Switch views and keep showing the same day.
function ctSwitchView(v) {
  if (v === state.ui.ctView) return;
  ctSel = null;
  const d = ctCurrentDay();
  const anchor = v === 'clock' ? (d.wake || d.start) : d.start + 12 * HOUR;
  state.ui.ctView = v;
  ctAnchor = (ctAnchor === null || midnight(anchor) === midnight(now())) ? null : anchor;
  save();
  renderColor();
}

// ---------- changing blocks ----------
// Paint [a, b). Never paints over what's logged: only the empty parts are filled,
// so a stroke snaps to the edges of existing blocks.
function ctPaint(a, b, cat) {
  const t = now();
  b = Math.min(b, Math.floor(t / MIN) * MIN);
  if (b - a < MIN) {
    renderColor();
    if (a >= t - MIN) toast('That time hasn\'t happened yet.');
    return;
  }
  const gaps = gapsIn(a, b);
  if (!gaps.length) { renderColor(); toast('Already logged. Tap the block to edit it.'); return; }
  snapshot('Painted ' + catName(cat));
  const daysBefore = sleepDays().length;
  gaps.forEach(function (g) {
    const piece = { id: uid(), start: g.start, end: g.end, cat: cat, updatedAt: t, deleted: false, locked: false };
    state.ranges.forEach(function (r) {             // join a touching block of the same activity (not a locked one)
      if (r.deleted || r.locked || r.cat !== cat) return;
      if (r.end === piece.start) { piece.start = r.start; r.deleted = true; r.updatedAt = t; }
      else if (r.start === piece.end) { piece.end = r.end; r.deleted = true; r.updatedAt = t; }
    });
    state.ranges.push(piece);
  });
  save();
  haptic(10);
  if (state.ui.ctView === 'sleep' && isSleepCat(cat) && sleepDays().length > daysBefore) {
    const latest = mainSleeps().pop();
    toast('New day starts at ' + ctDayTime(latest.start), { undo: true });
  } else {
    const total = gaps.reduce(function (s, g) { return s + g.end - g.start; }, 0);
    toast(catName(cat) + ' · ' + fmtDur(total) + ' logged', { undo: true });
  }
  renderColor();
}
function ctDelete(id) {
  const r = findRange(id);
  if (!r || r.deleted) return;
  if (r.locked) { toast('This block is locked. Unlock it first.'); return; }
  snapshot('Deleted block');
  r.deleted = true;
  r.updatedAt = now();
  if (ctSel === id) ctSel = null;
  save();
  sound('delete');
  haptic(10);
  renderColor();
  toast(catName(r.cat) + ' block deleted', { undo: true });
}
function ctToggleLock() {
  const r = selRange();
  if (!r) return;
  snapshot(r.locked ? 'Unlocked block' : 'Locked block');
  r.locked = !r.locked;
  r.updatedAt = now();
  save();
  haptic(12);
  renderColor();
  toast(r.locked ? 'Locked. It can\'t be stretched, recoloured or deleted.' : 'Unlocked');
}
function ctChangeCat(cat) {
  const r = selRange();
  if (!r || r.cat === cat) return;
  if (r.locked) { toast('This block is locked. Unlock it first.'); return; }
  snapshot('Changed activity');
  r.cat = cat;
  r.updatedAt = now();
  save();
  renderColor();
}

// ---------- drawing ----------
function renderTools() {
  if (!liveCats().some(function (c) { return c.id === ctBrush; })) ctBrush = liveCats()[0].id;
  const sel = selRange();
  const active = sel ? sel.cat : ctBrush;
  const color = catColor(ctBrush);
  const box = $('ctBrushes');
  box.innerHTML = liveCats().map(function (c, i) {
    return '<button class="brush' + (active === c.id ? ' on' : '') + '" style="--bc:' + c.color + '" data-action="brush" data-id="' + c.id + '" aria-pressed="' + (active === c.id) + '"><i></i>' +
      esc(c.name) + (i < 9 ? '<span class="key">' + (i + 1) + '</span>' : '') + '</button>';
  }).join('');
  const chip = box.querySelector('.brush.on');
  if (chip && (chip.offsetLeft < box.scrollLeft || chip.offsetLeft + chip.offsetWidth > box.scrollLeft + box.clientWidth)) box.scrollLeft = chip.offsetLeft - 16;
  $('ctToolsPaint').hidden = !!sel;
  $('ctToolsSel').hidden = !sel;
  const pen = $('ctPen');
  pen.style.setProperty('--bc', color);
  pen.classList.toggle('on', ctMode === 'paint');
  pen.setAttribute('aria-pressed', ctMode === 'paint');
  $('ctPenLabel').innerHTML = '<span class="swatch"></span>' + (ctMode === 'paint' ? 'Pen on' : 'Pen');
  $('ctUndo').disabled = !undoStack.length;
  if (sel) {
    $('ctLock').innerHTML = sel.locked ? UNLOCK_SVG + '<span>Unlock</span>' : LOCK_SVG + '<span>Lock</span>';
    $('ctLock').classList.toggle('on', !!sel.locked);
    $('ctDelete').disabled = !!sel.locked;
  }
  const grid = $('ctGrid');
  grid.classList.toggle('armed', ctMode === 'paint');
  grid.style.setProperty('--arm', color);
  if (!ctDrag) {
    if (sel) {
      $('ctLive').innerHTML = '<span class="dot" style="background:' + catColor(sel.cat) + ';margin-right:6px"></span>' + esc(catName(sel.cat)) +
        ' <b>' + fmtTime(sel.start) + ' – ' + fmtTime(sel.end) + '</b> · ' + fmtDur(sel.end - sel.start) +
        (sel.locked ? ' · locked' : '<br>Drag the black handles to stretch it. Tap a colour to change it.');
    } else {
      $('ctLive').textContent = ctMode === 'paint' ? 'Drag across the blocks. Lift your finger to finish.' : 'Pick a colour, tap Pen, then drag. Tap a coloured block to edit it.';
    }
  }
}
function fillSpan(a, b, blockStart, color, cls) {
  return '<span class="fill ' + cls + '" style="left:' + pct(a - blockStart) + '%;width:' + pct(b - a) + '%;' + (color ? 'background:' + color : '') + '"></span>';
}
function shadeSpan(a, b, blockStart) {
  return '<span class="shade" style="left:' + pct(a - blockStart) + '%;width:' + pct(b - a) + '%"></span>';
}
function renderCtGrid(preview) {
  const d = ctDay;
  const t = now();
  const sel = selRange();
  const gridStart = floorHour(d.start);
  const shownEnd = d.end || Math.max(t, d.start + MIN);
  const gridEnd = Math.max(ceilHour(shownEnd), gridStart + HOUR);
  const segs = segmentsIn(gridStart, gridEnd);
  const dayEnd = d.end || Infinity;
  let html = '';
  for (let b = gridStart; b < gridEnd; b += HOUR) {
    const be = b + HOUR;
    let inner = '';
    segs.forEach(function (s) {
      if (s.end <= b || s.start >= be) return;
      inner += fillSpan(Math.max(s.start, b), Math.min(s.end, be), b, catColor(s.cat), sel ? (s.id === sel.id ? 'sel' : 'dim') : '');
      const r = findRange(s.id);
      if (r && r.locked && s.start >= b) inner += '<span class="lockmark" style="left:' + pct(s.start - b) + '%">' + LOCK_SVG + '</span>';
    });
    if (preview) {
      preview.pieces.forEach(function (p) {
        if (p.end > b && p.start < be) inner += fillSpan(Math.max(p.start, b), Math.min(p.end, be), b, catColor(preview.cat), 'preview');
      });
    }
    if (d.start > b) inner += shadeSpan(b, Math.min(d.start, be), b);       // belongs to the previous day
    if (dayEnd < be) inner += shadeSpan(Math.max(dayEnd, b), be, b);        // belongs to the next day
    if (t < be) {
      inner += shadeSpan(Math.max(t, b), be, b);                             // future
      if (t >= b) inner += '<span class="nowline" style="left:' + pct(t - b) + '%"></span>';
    }
    if (sel && !sel.locked) {
      if (sel.start >= b && sel.start < be) inner += '<span class="handle hs" data-handle="start" style="left:' + pct(sel.start - b) + '%"><i></i></span>';
      if (sel.end > b && sel.end <= be) inner += '<span class="handle he" data-handle="end" style="left:' + pct(sel.end - b) + '%"><i></i></span>';
    }
    html += '<div class="blk" data-start="' + b + '">' + inner + '<span class="hr">' + hourLabel(b) + '</span></div>';
  }
  $('ctGrid').innerHTML = html;
}
function renderCtSummary() {
  const d = ctDay;
  const t = now();
  const from = d.start;
  const to = Math.min(d.end || t, t);
  const segs = to > from ? segmentsIn(from, to) : [];
  const span = Math.max(0, to - from);
  const totals = {};
  let tracked = 0;
  segs.forEach(function (s) { totals[s.cat] = (totals[s.cat] || 0) + (s.end - s.start); tracked += s.end - s.start; });
  const ids = Object.keys(totals).sort(function (a, b) { return totals[b] - totals[a]; });
  $('ctBar').innerHTML = span ? ids.map(function (id) {
    return '<span style="width:' + (totals[id] / span * 100).toFixed(2) + '%;background:' + catColor(id) + '"></span>';
  }).join('') : '';
  let list = ids.map(function (id) {
    return '<li><span class="dot" style="background:' + catColor(id) + '"></span>' + esc(catName(id)) + '<b>' + fmtDur(totals[id]) + '</b></li>';
  }).join('');
  if (span - tracked >= MIN) list += '<li><span class="dot" style="background:var(--line)"></span>Not tracked<b>' + fmtDur(span - tracked) + '</b></li>';
  $('ctTotals').innerHTML = list || '<li class="small">Nothing yet.</li>';
  $('ctEntries').innerHTML = segs.length ? segs.map(function (s) {
    const r = findRange(s.id);
    const locked = r && r.locked;
    return '<li><span class="dot" style="background:' + catColor(s.cat) + '"></span>' +
      '<button class="what" data-action="ctselect" data-id="' + s.id + '"><span>' + esc(catName(s.cat)) + '</span><time>' + fmtTime(s.start) + ' – ' + fmtTime(s.end) + ' · ' + fmtDur(s.end - s.start) + (locked ? ' · locked' : '') + '</time></button>' +
      (locked ? '<span class="x" aria-label="Locked">' + LOCK_SVG + '</span>' : '<button class="x" data-action="ctdel" data-id="' + s.id + '" aria-label="Delete this block">×</button>') + '</li>';
  }).join('') : '<li class="small">Painted blocks show up here with exact times.</li>';
}
function renderColor() {
  ctDay = ctCurrentDay();
  const d = ctDay;
  const t = now();
  document.querySelectorAll('[data-action="ctview"]').forEach(function (b) {
    b.classList.toggle('on', b.dataset.v === state.ui.ctView);
    b.setAttribute('aria-pressed', b.dataset.v === state.ui.ctView);
  });
  $('ctTitle').textContent = ctDate(d.label);
  if (d.clock) $('ctSub').textContent = 'Midnight to midnight';
  else {
    const end = d.end || t;
    $('ctSub').textContent = ctDayTime(d.start) + ' → ' + (d.end ? ctDayTime(d.end) : 'now') + ' · ' + fmtDur(end - d.start) + (d.estimated && liveRanges().length ? ' · estimated' : '');
  }
  $('ctPrev').disabled = !d.hasPrev;
  $('ctNext').disabled = !d.hasNext;
  $('ctToday').disabled = ctAnchor === null;
  let warn = '';
  if (!liveRanges().length) warn = 'Start with last night: pick Sleep, tap Pen, then drag from when you fell asleep to when you woke up.';
  else if (!d.clock && !d.end && t - d.start > 30 * HOUR) warn = 'No sleep logged since ' + ctDayTime(d.start) + '. Paint your sleep and a new day will start there.';
  else if (!d.clock && d.estimated) warn = 'No sleep is logged around here, so this day is cut at midnight. Paint the sleep to fix it.';
  $('ctWarn').textContent = warn;
  $('ctWarn').hidden = !warn;
  renderTools();
  renderCtGrid();
  renderCtSummary();
}

// ---------- painting with finger / mouse / pencil ----------
function cacheRects() {
  ctRects = Array.prototype.map.call(document.querySelectorAll('#ctGrid .blk'), function (el) {
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, start: Number(el.dataset.start) };
  });
}
// Turn a screen point into an exact time (to the minute).
function timeAt(x, y) {
  if (!ctRects.length) return null;
  const tops = [];
  ctRects.forEach(function (r) { if (!tops.some(function (tp) { return Math.abs(tp - r.top) < 2; })) tops.push(r.top); });
  let rowTop = tops[0], best = Infinity;
  tops.forEach(function (tp) {
    const r0 = ctRects.find(function (r) { return Math.abs(r.top - tp) < 2; });
    const dist = Math.abs((r0.top + r0.bottom) / 2 - y);
    if (dist < best) { best = dist; rowTop = tp; }
  });
  const row = ctRects.filter(function (r) { return Math.abs(r.top - rowTop) < 2; });
  const last = row[row.length - 1];
  if (x <= row[0].left) return row[0].start;
  if (x >= last.right) return last.start + HOUR;
  for (let i = 0; i < row.length; i++) {
    const r = row[i];
    if (x >= r.left && x <= r.right) return roundMin(r.start + (x - r.left) / (r.right - r.left) * HOUR);
    if (x < r.left) return r.start;   // in the small gap before this block
  }
  return last.start + HOUR;
}
function blockAt(x, y) {
  const r = ctRects.find(function (b) { return x >= b.left && x <= b.right && y >= b.top && y <= b.bottom; });
  return r ? r.start : null;
}
function schedulePreview() {
  if (ctRaf) return;
  ctRaf = requestAnimationFrame(function () {
    ctRaf = 0;
    if (!ctDrag) return;
    if (ctDrag.type === 'handle') {
      const sel = selRange();
      renderCtGrid();
      if (sel) $('ctLive').innerHTML = esc(catName(sel.cat)) + ' <b>' + fmtTime(sel.start) + ' – ' + fmtTime(sel.end) + '</b> · ' + fmtDur(sel.end - sel.start);
      return;
    }
    const a = Math.min(ctDrag.t0, ctDrag.t1);
    const b = Math.min(Math.max(ctDrag.t0, ctDrag.t1), now());
    const pieces = b > a ? gapsIn(a, b) : [];
    renderCtGrid({ pieces: pieces, cat: ctBrush });
    if (pieces.length) {
      const total = pieces.reduce(function (sum, p) { return sum + p.end - p.start; }, 0);
      const skipped = (b - a) - total >= MIN;
      $('ctLive').innerHTML = esc(catName(ctBrush)) + ' <b>' + fmtTime(pieces[0].start) + ' – ' + fmtTime(pieces[pieces.length - 1].end) + '</b> · ' + fmtDur(total) + (skipped ? ' · skipping what\'s logged' : '');
    } else {
      $('ctLive').textContent = 'Already logged here. Keep dragging into empty time.';
    }
  });
}

const ctGridEl = $('ctGrid');
ctGridEl.addEventListener('pointerdown', function (e) {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  const handle = e.target.closest('[data-handle]');
  const sel = selRange();
  if (handle && sel && !sel.locked) {              // stretch the selected block
    e.preventDefault();
    cacheRects();
    let lo = -Infinity, hi = Math.floor(now() / MIN) * MIN;
    liveRanges().forEach(function (r) {
      if (r.id === sel.id) return;
      if (r.end <= sel.start) lo = Math.max(lo, r.end);
      if (r.start >= sel.end) hi = Math.min(hi, r.start);
    });
    ctDrag = { type: 'handle', which: handle.dataset.handle, id: e.pointerId, lo: lo, hi: hi, start: sel.start, end: sel.end };
    haptic(8);
    try { ctGridEl.setPointerCapture(e.pointerId); } catch (err) {}
    return;
  }
  if (!ctMode) {                                    // pen off: the page scrolls; a tap selects a block
    cacheRects();
    ctTap = { id: e.pointerId, x: e.clientX, y: e.clientY };
    return;
  }
  e.preventDefault();
  cacheRects();
  const t0 = timeAt(e.clientX, e.clientY);
  if (t0 === null) return;
  ctDrag = { type: 'paint', id: e.pointerId, t0: t0, t1: t0, x: e.clientX, y: e.clientY, moved: false, block: blockAt(e.clientX, e.clientY) };
  try { ctGridEl.setPointerCapture(e.pointerId); } catch (err) {}
});
ctGridEl.addEventListener('pointermove', function (e) {
  if (ctTap && e.pointerId === ctTap.id && Math.abs(e.clientX - ctTap.x) + Math.abs(e.clientY - ctTap.y) > 8) ctTap = null;
  if (!ctDrag || e.pointerId !== ctDrag.id) return;
  if (ctDrag.type === 'handle') {
    const sel = selRange();
    const tm = timeAt(e.clientX, e.clientY);
    if (!sel || tm === null) return;
    if (ctDrag.which === 'start') sel.start = Math.max(ctDrag.lo, Math.min(tm, sel.end - MIN));
    else sel.end = Math.min(ctDrag.hi, Math.max(tm, sel.start + MIN));
    schedulePreview();
    return;
  }
  if (Math.abs(e.clientX - ctDrag.x) + Math.abs(e.clientY - ctDrag.y) > 6) ctDrag.moved = true;
  if (!ctDrag.moved) return;
  ctDrag.t1 = timeAt(e.clientX, e.clientY);
  schedulePreview();
});
function ctEndPointer(e, cancelled) {
  if (ctTap && e.pointerId === ctTap.id) {
    const tap = ctTap;
    ctTap = null;
    if (cancelled) return;
    const tm = timeAt(tap.x, tap.y);
    const hit = tm === null ? null : liveRanges().find(function (r) { return r.start <= tm && tm < r.end; });
    ctSel = hit ? hit.id : null;
    if (hit) haptic(6);
    renderColor();
    return;
  }
  if (!ctDrag || e.pointerId !== ctDrag.id) return;
  const d = ctDrag;
  ctDrag = null;
  if (d.type === 'handle') {
    const sel = selRange();
    if (!sel) { renderColor(); return; }
    const moved = sel.start !== d.start || sel.end !== d.end;
    const ns = sel.start, ne = sel.end;
    sel.start = d.start; sel.end = d.end;          // put it back so the snapshot holds the old size
    if (!cancelled && moved) {
      snapshot('Stretched block');
      sel.start = ns; sel.end = ne;
      sel.updatedAt = now();
      save();
      haptic(8);
    }
    renderColor();
    return;
  }
  if (cancelled) { renderColor(); return; }
  ctMode = null;                                     // one stroke, then the pen turns itself off
  if (d.moved) ctPaint(Math.min(d.t0, d.t1), Math.max(d.t0, d.t1), ctBrush);
  else if (d.block !== null) ctPaint(d.block, d.block + HOUR, ctBrush);   // a tap fills the empty part of that hour
  else renderColor();
}
ctGridEl.addEventListener('pointerup', function (e) { ctEndPointer(e, false); });
ctGridEl.addEventListener('pointercancel', function (e) { ctEndPointer(e, true); });

// ---------- activities sheet (with a warning when two colours look alike) ----------
function activitiesSheetHTML() {
  const cats = liveCats();
  return '<h3>Activities</h3>' +
    '<p class="small">Each activity is a paint colour. Sleep is special: a sleep of 3 hours or more starts a new day in the sleep-to-sleep view.</p>' +
    cats.map(function (c) {
      const twin = cats.find(function (o) { return o.id !== c.id && colorDistance(o.color, c.color) < 50; });
      return '<div class="act-row">' +
        '<input type="color" value="' + c.color + '" data-cat="' + c.id + '" data-field="color" aria-label="Colour for ' + esc(c.name) + '">' +
        '<input class="text-input" value="' + esc(c.name) + '" data-cat="' + c.id + '" data-field="name" aria-label="Activity name">' +
        (c.sleep ? '<span class="small">Sleep</span>' : '<button class="btn danger" data-action="delcat" data-id="' + c.id + '">Delete</button>') +
        '</div>' + (twin ? '<p class="clash">Looks a lot like ' + esc(twin.name) + '. Pick a more different colour.</p>' : '');
    }).join('') +
    '<div class="row"><button class="btn" data-action="addcat">Add activity</button><button class="btn primary" data-action="close">Done</button></div>';
}
$('sheet').addEventListener('change', function (e) {
  if (!sheetCtx || sheetCtx.type !== 'activities' || !e.target.dataset.cat) return;
  const c = findCat(e.target.dataset.cat);
  const v = e.target.value.trim();
  if (c && v) { c[e.target.dataset.field] = v; c.updatedAt = now(); save(); renderColor(); refreshSheet(activitiesSheetHTML()); }
});

// ---------- actions ----------
actions.ctview = function (el) { ctSwitchView(el.dataset.v); };
actions.ctprev = function () { ctStep(-1); };
actions.ctnext = function () { ctStep(1); };
actions.cttoday = function () { ctAnchor = null; ctSel = null; renderColor(); };
actions.brush = function (el) { if (selRange()) ctChangeCat(el.dataset.id); else { ctBrush = el.dataset.id; renderTools(); } };
actions.ctpen = function () { ctSel = null; ctMode = ctMode === 'paint' ? null : 'paint'; haptic(8); renderColor(); };
actions.ctdel = function (el) { ctDelete(el.dataset.id); };
actions.ctdelsel = function () { ctDelete(ctSel); };
actions.ctlock = function () { ctToggleLock(); };
actions.ctdone = function () { ctSel = null; renderColor(); };
actions.ctselect = function (el) { ctSel = el.dataset.id; ctMode = null; renderColor(); $('ctTools').scrollIntoView({ block: 'nearest', behavior: 'smooth' }); };
actions.ctacts = function () { openSheet({ type: 'activities' }, activitiesSheetHTML()); };
actions.addcat = function () {
  const used = liveCats().map(function (c) { return c.color; });
  const color = CT_SPARE_COLORS.find(function (c) { return used.every(function (u) { return colorDistance(u, c) >= 50; }); }) || CT_SPARE_COLORS[0];
  state.categories.push({ id: uid(), name: 'New activity', color: color, updatedAt: now(), deleted: false });
  save(); renderColor(); refreshSheet(activitiesSheetHTML());
};
actions.delcat = function (el) {
  const c = findCat(el.dataset.id);
  if (!c) return;
  snapshot('Deleted activity');
  c.deleted = true; c.updatedAt = now();
  save(); renderColor(); refreshSheet(activitiesSheetHTML());
  toast('Deleted ' + c.name, { undo: true });
};

// keep "now" moving while the tracker is open
setInterval(function () { if (view === 'colortracker' && !ctDrag && !sheetCtx) renderColor(); }, 60000);
