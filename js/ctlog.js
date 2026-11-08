/* =========================================================
   ColorTracker: faster logging, goals and extras.
   - Live mode ("Now doing…"): a block that grows until you stop or
     switch; "Going to sleep" / "I'm up" is live mode with Sleep.
     Device-only (state.ui.ctLive); painted for real when stopped.
   - Gaps: list the empty stretches of the day with a guess of what
     you usually do then (smart fill), one tap to fill.
   - Copy yesterday, and day templates (settings.dayTemplates).
   - Notes and 👍/👎 on a block (range.note, range.worth).
   - Gap reminders every 2 or 3 hours (settings.ctNudge), checked by
     remind.js; quiet during your usual sleep.
   - Goals and budgets per kind (settings.ctGoals) + "in bed by"
     (settings.ctBedBy), the ideal day (settings.ctIdeal),
     7-day challenges with badges (settings.ctChallenges / ctBadges).
   - Export blocks as CSV, print a month poster, today's ring in
     Wrap up the day.
   ========================================================= */

const EST_AMOUNTS = [15, 30, 45, 60, 90, 120, 180, 240, 300, 360, 420, 480];

// Paint several pieces at once (one Undo), only into empty time, never into the future.
function bulkPaint(pieces, label) {
  const t = now();
  const made = [];
  pieces.forEach(function (p) {
    const end = Math.min(p.end, Math.floor(t / MIN) * MIN);
    if (end - p.start < MIN) return;
    gapsIn(p.start, end).forEach(function (g) { made.push({ start: g.start, end: g.end, cat: p.cat }); });
  });
  if (!made.length) return 0;
  snapshot(label || 'Filled time');
  let total = 0;
  made.forEach(function (g) {
    const piece = { id: uid(), start: g.start, end: g.end, cat: g.cat, updatedAt: t, deleted: false, locked: false };
    if (isOneOff(g.cat)) piece.label = '';
    else state.ranges.forEach(function (r) {
      if (r.deleted || r.locked || r.cat !== g.cat || isOneOff(r.cat)) return;
      if (r.end === piece.start) { piece.start = r.start; r.deleted = true; r.updatedAt = t; }
      else if (r.start === piece.end) { piece.end = r.end; r.deleted = true; r.updatedAt = t; }
    });
    state.ranges.push(piece);
    total += g.end - g.start;
  });
  save();
  return total;
}

// ---------- live mode ----------
function sleepCatId() { const c = liveCats().find(function (x) { return x.sleep; }); return c ? c.id : 'sleep'; }
function renderLiveOverlay() {
  const live = state.ui.ctLive;
  if (!live || ctDrag || ctPage !== 'paint') return;
  renderCtGrid({ cat: live.cat, pieces: gapsIn(live.start, now()) });
}
function startLive(cat, start) {
  if (state.ui.ctLive) stopLive(true);
  state.ui.ctLive = { cat: cat, start: start || now() };
  save();
  haptic(10);
  renderColor();
  toast(isSleepCat(cat) ? 'Good night. Tap "I\'m up" in the morning.' : 'Logging ' + catName(cat) + ' live. Stop or switch when it changes.');
}
function stopLive(quiet) {
  const live = state.ui.ctLive;
  if (!live) return;
  state.ui.ctLive = null;
  const ms = bulkPaint([{ start: live.start, end: now(), cat: live.cat }], 'Logged ' + catName(live.cat));
  save();
  renderColor();
  if (!quiet) toast(ms ? catName(live.cat) + ' · ' + fmtDur(ms) + ' logged' : 'Nothing to log (that time was already filled)', ms ? { undo: true } : undefined);
}
function liveSheetHTML() {
  return '<h3>What are you doing now?</h3><p class="small">It fills in by itself until you stop or switch.</p>' +
    '<p class="label">Started</p><div class="pickrow wrap">' + [[0, 'Just now'], [5, '5 min ago'], [15, '15 min ago'], [30, '30 min ago'], [60, '1 hour ago']].map(function (x) {
      return '<button class="pick' + ((state.ui.ctLiveAgo || 0) === x[0] ? ' on' : '') + '" data-action="ctliveago" data-m="' + x[0] + '">' + x[1] + '</button>';
    }).join('') + '</div>' +
    '<div class="brushgrid">' + liveCats().filter(function (c) { return !c.oneoff; }).map(function (c) {
      return '<button class="brush" style="--bc:' + c.color + ';--bt:' + textOn(c.color) + '" data-action="ctlivego" data-id="' + c.id + '"><i></i>' + esc(c.name) + '</button>';
    }).join('') + '</div><div class="row"><button class="btn" data-action="close">Cancel</button></div>';
}
actions.ctliveStart = function () { state.ui.ctLiveAgo = 0; openSheet({ type: 'ctlive' }, liveSheetHTML()); };
actions.ctliveago = function (el) { state.ui.ctLiveAgo = Number(el.dataset.m); refreshSheet(liveSheetHTML()); };
actions.ctlivego = function (el) { const ago = state.ui.ctLiveAgo || 0; closeSheet(); startLive(el.dataset.id, now() - ago * MIN); };
actions.ctliveStop = function () { stopLive(false); };
actions.ctsleepNow = function () { startLive(sleepCatId(), now()); };
// While a live Time-waste block runs, warn once when today's budget runs out.
setInterval(function () {
  const live = state.ui.ctLive;
  if (!live || catKind(live.cat) !== 'waste' || state.ui.ctBudgetWarned === dayKey()) return;
  const budget = ctGoalMins('waste', 'max', null);
  if (!budget) return;
  const today = buildDays(midnight(now()), addDays(midnight(now()), 1))[0];
  if (today.mins.waste + (now() - Math.max(live.start, midnight(now()))) / MIN >= budget) {
    state.ui.ctBudgetWarned = dayKey(); save();
    toast('That\'s your ' + fmtMins(budget) + ' of wasted time for today.');
    showNote('Time-waste budget used', 'You\'ve hit today\'s ' + fmtMins(budget) + '.', 'ctbudget', { view: 'colortracker' });
  }
}, 60000);

// ---------- gaps and smart fill ----------
// What you usually do at this time of day (last 30 days), by activity.
function suggestCat(g) {
  const mid = minsOfDay(g.start + (g.end - g.start) / 2);
  const counts = {};
  for (let i = 1; i <= 30; i++) {
    const t = addDays(midnight(g.start), -i) + mid * MIN;
    const r = liveRanges().find(function (x) { return x.start <= t && x.end > t; });
    if (r && !isOneOff(r.cat)) counts[r.cat] = (counts[r.cat] || 0) + 1;
  }
  let best = null, n = 0;
  for (const c in counts) if (counts[c] > n && findCat(c) && !findCat(c).deleted) { best = c; n = counts[c]; }
  return n >= 2 ? best : null;
}
let gapPick = null;      // the gap whose "Other…" colours are open
function gapsSheetHTML() {
  const d = ctDay || ctCurrentDay();
  const gaps = gapsIn(d.start, Math.min(d.end || now(), now())).filter(function (g) { return g.end - g.start >= 10 * MIN; });
  return '<h3>Fill the gaps</h3><p class="small">' + ctDate(d.label) + ' · ' + (gaps.length ? gaps.length + ' empty ' + (gaps.length === 1 ? 'stretch' : 'stretches') : 'nothing empty') + '</p>' +
    (gaps.length ? '<ul class="gaplist">' + gaps.map(function (g, i) {
      const s = suggestCat(g);
      return '<li><div class="gl-t"><b>' + fmtTime(g.start) + ' – ' + fmtTime(g.end) + '</b><small>' + fmtDur(g.end - g.start) + (s ? ' · usually ' + esc(catName(s)) : '') + '</small></div><div class="gl-b">' +
        (s ? '<button class="brush on" style="--bc:' + catColor(s) + ';--bt:' + textOn(catColor(s)) + '" data-action="ctfill" data-i="' + i + '" data-c="' + s + '"><i></i>' + esc(catName(s)) + '</button>' : '') +
        '<button class="btn small" data-action="ctfillother" data-i="' + i + '">' + (s ? 'Other…' : 'Pick…') + '</button></div>' +
        (gapPick === i ? '<div class="brushgrid">' + liveCats().map(function (c) {
          return '<button class="brush" style="--bc:' + c.color + ';--bt:' + textOn(c.color) + '" data-action="ctfill" data-i="' + i + '" data-c="' + c.id + '"><i></i>' + esc(c.name) + '</button>';
        }).join('') + '</div>' : '') + '</li>';
    }).join('') + '</ul>' : '<p>All logged. 🎉</p>') +
    '<div class="row"><button class="btn" data-action="close">Done</button></div>';
}
actions.ctgaps = function () { gapPick = null; openSheet({ type: 'ctgaps' }, gapsSheetHTML()); };
actions.ctfillother = function (el) { gapPick = gapPick === Number(el.dataset.i) ? null : Number(el.dataset.i); refreshSheet(gapsSheetHTML()); };
actions.ctfill = function (el) {
  const d = ctDay || ctCurrentDay();
  const gaps = gapsIn(d.start, Math.min(d.end || now(), now())).filter(function (g) { return g.end - g.start >= 10 * MIN; });
  const g = gaps[Number(el.dataset.i)];
  if (!g) return;
  const ms = bulkPaint([{ start: g.start, end: g.end, cat: el.dataset.c }], 'Filled a gap');
  gapPick = null;
  renderColor();
  refreshSheet(gapsSheetHTML());
  if (ms) toast(catName(el.dataset.c) + ' · ' + fmtDur(ms) + ' logged', { undo: true });
  if (isOneOff(el.dataset.c)) { const r = state.ranges[state.ranges.length - 1]; setTimeout(function () { openLabelSheet([r.id]); }, 350); }
};

// ---------- copy yesterday, day templates, ideal day (the ⋯ menu on the day card) ----------
function dayMenuHTML() {
  const tpls = state.settings.dayTemplates || [];
  const n = state.settings.ctNudge || 0;
  return '<h3>Logging tools</h3>' +
    '<div class="st-btns"><button class="btn small" data-action="ctcopyyday">📋 Copy yesterday into the gaps</button>' +
    '<button class="btn small" data-action="ctgaps">🧩 Fill the gaps</button>' +
    '<button class="btn small" data-action="ctsavetpl">💾 Save this day as a template</button>' +
    '<button class="btn small" data-action="ctsaveideal">⭐ Save this day as my ideal day</button>' +
    '<button class="btn small" data-action="ctgoals">🎯 Goals and budgets</button></div>' +
    (tpls.length ? '<p class="label">Paste a template into this day</p><ul class="tpllist">' + tpls.map(function (x) {
      return '<li><span>' + esc(x.name) + '<small>' + x.blocks.length + ' blocks</small></span><button class="btn small" data-action="ctusetpl" data-id="' + x.id + '">Use</button>' +
        '<button class="icon-btn sm danger" data-action="ctdeltpl" data-id="' + x.id + '" aria-label="Delete">×</button></li>';
    }).join('') + '</ul>' : '') +
    '<p class="label">Remind me to log</p><div class="pickrow wrap">' + [[0, 'Off'], [2, 'Every 2 hours'], [3, 'Every 3 hours']].map(function (x) {
      return '<button class="pick' + (n === x[0] ? ' on' : '') + '" data-action="ctnudge" data-h="' + x[0] + '">' + x[1] + '</button>';
    }).join('') + '</div><p class="small">Only when nothing has been logged for that long, never during your usual sleep. Works while TaskStack is open or recently used.</p>' +
    '<div class="row"><button class="btn" data-action="close">Close</button></div>';
}
actions.ctdaymenu = function () { openSheet({ type: 'ctmenu' }, dayMenuHTML()); };
actions.ctnudge = function (el) {
  state.settings.ctNudge = Number(el.dataset.h);
  state.settings.updatedAt = now();
  save();
  refreshSheet(dayMenuHTML());
  if (state.settings.ctNudge) askNotify();
};
function shownDayStart() { return midnight((ctDay || ctCurrentDay()).label); }
actions.ctcopyyday = function () {
  const ds = shownDayStart();
  const pieces = ctSegs(addDays(ds, -1), ds).filter(function (s) { return !isOneOff(s.cat); })
    .map(function (s) { return { start: s.start + DAY, end: s.end + DAY, cat: s.cat }; });
  const ms = bulkPaint(pieces, 'Copied yesterday');
  closeSheet(); renderColor();
  toast(ms ? 'Copied ' + fmtDur(ms) + ' from yesterday into the empty time' : 'Nothing to copy into (no gaps, or yesterday is empty)', ms ? { undo: true } : undefined);
};
function dayBlocks(ds) {
  return ctSegs(ds, addDays(ds, 1)).filter(function (s) { return !isOneOff(s.cat); })
    .map(function (s) { return { s: Math.round((s.start - ds) / MIN), e: Math.round((s.end - ds) / MIN), cat: s.cat }; });
}
actions.ctsavetpl = function () {
  openSheet({ type: 'cttpl' }, '<h3>Save as a day template</h3><p class="small">Saves ' + ctDate(shownDayStart()) + ' (midnight to midnight), to paste into another day\'s gaps.</p>' +
    '<input class="text-input" id="tplName" placeholder="e.g. College day" maxlength="30"><div class="row"><button class="btn" data-action="close">Cancel</button><button class="btn primary" data-action="ctsavetplgo">Save</button></div>');
  setTimeout(function () { if ($('tplName')) $('tplName').focus(); }, 60);
};
actions.ctsavetplgo = function () {
  const name = ($('tplName').value || '').trim() || 'My day';
  const blocks = dayBlocks(shownDayStart());
  if (!blocks.length) { toast('This day is empty.'); return; }
  state.settings.dayTemplates = (state.settings.dayTemplates || []).concat([{ id: uid(), name: name, blocks: blocks }]);
  state.settings.updatedAt = now();
  save(); closeSheet();
  toast('Saved "' + name + '". Use it from ⋯ on the day card.');
};
actions.ctusetpl = function (el) {
  const x = (state.settings.dayTemplates || []).find(function (y) { return y.id === el.dataset.id; });
  if (!x) return;
  const ds = shownDayStart();
  const ms = bulkPaint(x.blocks.filter(function (b) { return findCat(b.cat) && !findCat(b.cat).deleted; }).map(function (b) { return { start: ds + b.s * MIN, end: ds + b.e * MIN, cat: b.cat }; }), 'Used template');
  closeSheet(); renderColor();
  toast(ms ? '"' + x.name + '" filled ' + fmtDur(ms) + ' (up to now, gaps only)' : 'No empty time to fill', ms ? { undo: true } : undefined);
};
actions.ctdeltpl = function (el) {
  state.settings.dayTemplates = (state.settings.dayTemplates || []).filter(function (y) { return y.id !== el.dataset.id; });
  state.settings.updatedAt = now(); save(); refreshSheet(dayMenuHTML());
};
actions.ctsaveideal = function () {
  const ds = shownDayStart();
  const blocks = dayBlocks(ds);
  const cover = sum(blocks.map(function (b) { return b.e - b.s; }));
  if (cover < 12 * 60) { toast('Paint at least 12 hours of this day first.'); return; }
  state.settings.ctIdeal = { blocks: blocks, from: dayKey(ds) };
  state.settings.updatedAt = now();
  save(); closeSheet(); ctStatsKey = '';
  toast('Saved ' + ctDate(ds) + ' as your ideal day. Stats now show how close each day gets.');
};

// ---------- notes and 👍 / 👎 on a block ----------
function noteSheetHTML(r) {
  return '<h3>' + esc(rangeName(r)) + ' · ' + fmtTime(r.start) + ' – ' + fmtTime(r.end) + '</h3>' +
    '<textarea class="text-input" id="ctNote" placeholder="What exactly? e.g. DBMS chapter 4" maxlength="200">' + esc(r.note || '') + '</textarea>' +
    '<p class="label">Was it worth it?</p><div class="moods"><button class="' + (r.worth > 0 ? 'on' : '') + '" data-action="ctworth" data-v="1" aria-label="Worth it">👍</button>' +
    '<button class="' + (r.worth < 0 ? 'on' : '') + '" data-action="ctworth" data-v="-1" aria-label="Not worth it">👎</button></div>' +
    '<p class="small">👍 on Time waste counts it as Leisure; 👎 on Leisure counts it as waste. It also nudges the Day value by 1.</p>' +
    '<div class="row"><button class="btn" data-action="close">Cancel</button><button class="btn primary" data-action="ctnotesave">Save</button></div>';
}
actions.ctnote = function () { const r = selRange(); if (r) openSheet({ type: 'ctnote', id: r.id }, noteSheetHTML(r)); };
actions.ctworth = function (el) {
  const r = findRange(sheetCtx.id);
  if (!r) return;
  const v = Number(el.dataset.v);
  r.worth = r.worth === v ? 0 : v;
  r.updatedAt = now();
  save();
  const note = $('ctNote').value;
  refreshSheet(noteSheetHTML(r));
  $('ctNote').value = note;
};
actions.ctnotesave = function () {
  const r = findRange(sheetCtx.id);
  if (!r) return;
  r.note = $('ctNote').value.trim();
  r.updatedAt = now();
  save(); closeSheet(); renderColor();
  toast('Saved');
};

// ---------- gap reminders (called by remind.js every 15 s) ----------
function ctGapNudge() {
  const hrs = state.settings.ctNudge || 0;
  if (!hrs || state.ui.ctLive || !liveRanges().length) return;
  const t = now();
  const last = liveRanges().reduce(function (m, r) { return Math.max(m, Math.min(r.end, t)); }, 0);
  const gap = t - last;
  if (gap < hrs * HOUR) return;
  // quiet during your usual sleep (from the last 14 nights; 11:30 pm – 7:30 am if there aren't any)
  const nights = buildNights().slice(-14);
  const bed = nights.length ? mean(nights.map(function (n) { return n.bed; })) : 23.5 * 60;
  const wake = nights.length ? mean(nights.map(function (n) { return n.wake; })) : 7.5 * 60;
  const m = lateMins(t);
  if (m >= bed - 30 && m <= wake + 1440 + 30) return;
  const key = 'ctgap-' + last + '-' + Math.floor(gap / (hrs * HOUR));
  if (fired.keys[key]) return;
  fired.keys[key] = t;
  saveFired();
  if (document.visibilityState !== 'visible') showNote('Fill in your day', 'Nothing logged since ' + fmtTime(last) + '. It takes 20 seconds.', 'ctgap', { view: 'colortracker' });
  else if (view !== 'colortracker') toast('ColorTracker: nothing logged since ' + fmtTime(last) + '.');
}

// ---------- goals and budgets ----------
function liveGoals() { return state.settings.ctGoals || []; }
function goalProgress(g, ds) {
  let from = ds, to = addDays(ds, 1);
  if (g.per === 'week') { from = weekStart(ds); to = addDays(from, 7); }
  if (g.target === 'sleep') {
    const nights = buildNights().filter(function (n) { return n.wakeDay >= from && n.wakeDay < to; });
    return g.per === 'week' ? sum(nights.map(function (n) { return n.asleep; })) : (nights.length ? nights[nights.length - 1].asleep : 0);
  }
  return sum(buildDays(from, to).map(function (d) { return d.mins[g.target] || 0; }));
}
function goalLabel(g) { return kindInfo(g.target).name + ' ' + (g.op === 'min' ? '≥ ' : '≤ ') + fmtMins(g.mins) + (g.per === 'week' ? ' a week' : ' a day'); }
function goalMet(g, v) { return g.op === 'min' ? v >= g.mins : v <= g.mins; }
function goalsMiniHTML(ds) {
  const goals = liveGoals();
  if (!goals.length && !state.settings.ctBedBy) return '';
  return '<div class="gmini">' + goals.map(function (g) {
    const v = goalProgress(g, ds);
    const p = g.op === 'min' ? Math.min(1, v / g.mins) : Math.min(1, v / g.mins);
    const cls = g.op === 'max' ? (v > g.mins ? 'over' : '') : (v >= g.mins ? 'met' : '');
    return '<span class="gm ' + cls + '" style="--kc:' + kindInfo(g.target).color + ';--p:' + p.toFixed(2) + '"><i></i>' + kindInfo(g.target).name + ' ' + fmtMins(v) + '/' + fmtMins(g.mins) + '</span>';
  }).join('') + (state.settings.ctBedBy ? '<span class="gm">🌙 bed by ' + fmtClockMins(state.settings.ctBedBy) + '</span>' : '') + '</div>';
}
function goalsCardHTML(R) {
  const goals = liveGoals();
  const ds = midnight(now());
  let rows = goals.map(function (g) {
    const v = goalProgress(g, ds);
    let streak = 0;
    if (g.per === 'day') for (let d = addDays(ds, -1); streak < 365; d = addDays(d, -1)) { if (goalMet(g, goalProgress(g, d))) streak++; else break; }
    const p = Math.min(1, v / g.mins);
    return '<li><span>' + goalLabel(g) + '</span><div class="lb-track ' + (g.op === 'max' && v > g.mins ? 'over' : goalMet(g, v) ? 'met' : '') + '"><i style="width:' + (p * 100).toFixed(0) + '%;background:' + kindInfo(g.target).color + '"></i></div>' +
      '<small>' + (g.per === 'week' ? 'this week ' : 'today ') + fmtMins(v) + (streak ? ' · 🔥 ' + streak + '-day streak' : '') + '</small></li>';
  }).join('');
  if (state.settings.ctBedBy) {
    const nights = buildNights().slice(-7);
    const kept = nights.filter(function (n) { return n.bed <= state.settings.ctBedBy; }).length;
    rows += '<li><span>In bed by ' + fmtClockMins(state.settings.ctBedBy) + '</span><small>' + kept + ' of the last ' + nights.length + ' nights</small></li>';
  }
  return card('Goals and budgets', (rows ? '<ul class="goals">' + rows + '</ul>' : '<p class="small">Set a goal like "Productive ≥ 4h a day" or a budget like "Time waste ≤ 45m a day".</p>') +
    '<button class="btn small" data-action="ctgoals">' + (goals.length ? 'Edit goals' : 'Add a goal') + '</button>');
}
let goalDraft = { target: 'productive', op: 'min', mins: 240, per: 'day' };
function goalsSheetHTML() {
  const goals = liveGoals();
  const d = goalDraft;
  return '<h3>Goals and budgets</h3>' +
    (goals.length ? '<ul class="tpllist">' + goals.map(function (g) {
      return '<li><span>' + goalLabel(g) + '</span><button class="icon-btn sm danger" data-action="ctgoaldel" data-id="' + g.id + '" aria-label="Delete">×</button></li>';
    }).join('') + '</ul>' : '') +
    '<p class="label">New goal</p><div class="pickrow wrap">' + KINDS.filter(function (k) { return k.id !== 'other'; }).map(function (k) {
      return '<button class="pick kindpick' + (d.target === k.id ? ' on' : '') + '" style="--kc:' + k.color + '" data-action="ctgd" data-f="target" data-v="' + k.id + '">' + k.name + '</button>';
    }).join('') + '</div>' +
    '<div class="pickrow wrap"><button class="pick' + (d.op === 'min' ? ' on' : '') + '" data-action="ctgd" data-f="op" data-v="min">At least</button><button class="pick' + (d.op === 'max' ? ' on' : '') + '" data-action="ctgd" data-f="op" data-v="max">At most (budget)</button>' +
    '<button class="pick' + (d.per === 'day' ? ' on' : '') + '" data-action="ctgd" data-f="per" data-v="day">a day</button><button class="pick' + (d.per === 'week' ? ' on' : '') + '" data-action="ctgd" data-f="per" data-v="week">a week</button></div>' +
    '<div class="pickrow wrap">' + EST_AMOUNTS.concat(d.per === 'week' ? [600, 900, 1200, 1800] : []).map(function (m) {
      return '<button class="pick' + (d.mins === m ? ' on' : '') + '" data-action="ctgd" data-f="mins" data-v="' + m + '">' + fmtMins(m) + '</button>';
    }).join('') + '</div>' +
    '<button class="btn primary" data-action="ctgoaladd">Add: ' + goalLabel(d) + '</button>' +
    '<p class="label">In bed by</p><div class="pickrow wrap">' + [0, 22 * 60, 22.5 * 60, 23 * 60, 23.5 * 60, 24 * 60, 24.5 * 60, 25 * 60, 25.5 * 60, 26 * 60].map(function (m) {
      return '<button class="pick' + ((state.settings.ctBedBy || 0) === m ? ' on' : '') + '" data-action="ctbedby" data-m="' + m + '">' + (m ? fmtClockMins(m) : 'No goal') + '</button>';
    }).join('') + '</div>' +
    '<div class="row"><button class="btn" data-action="close">Done</button></div>';
}
actions.ctgoals = function () { openSheet({ type: 'ctgoals' }, goalsSheetHTML()); };
actions.ctgd = function (el) { goalDraft[el.dataset.f] = el.dataset.f === 'mins' ? Number(el.dataset.v) : el.dataset.v; refreshSheet(goalsSheetHTML()); };
actions.ctgoaladd = function () {
  state.settings.ctGoals = liveGoals().filter(function (g) { return !(g.target === goalDraft.target && g.op === goalDraft.op && g.per === goalDraft.per); })
    .concat([Object.assign({ id: uid() }, goalDraft)]);
  state.settings.updatedAt = now(); save(); ctStatsKey = ''; refreshSheet(goalsSheetHTML());
  toast('Goal added');
};
actions.ctgoaldel = function (el) {
  state.settings.ctGoals = liveGoals().filter(function (g) { return g.id !== el.dataset.id; });
  state.settings.updatedAt = now(); save(); ctStatsKey = ''; refreshSheet(goalsSheetHTML());
};
actions.ctbedby = function (el) { state.settings.ctBedBy = Number(el.dataset.m) || 0; state.settings.updatedAt = now(); save(); ctStatsKey = ''; refreshSheet(goalsSheetHTML()); };

// ---------- ideal day ----------
function idealSlots() {
  const I = state.settings.ctIdeal;
  if (!I || !I.blocks) return null;
  const slots = [];
  for (let i = 0; i < SLOTS; i++) slots.push(null);
  I.blocks.forEach(function (b) {
    const k = isSleepCat(b.cat) ? 'sleep' : catKind(b.cat);
    for (let i = Math.floor(b.s / 15); i < Math.min(SLOTS, Math.ceil(b.e / 15)); i++) slots[i] = k;
  });
  return slots;
}
function idealMatch(d, ideal) {
  let same = 0, n = 0;
  for (let i = 0; i < SLOTS; i++) { if (!d.slots[i] || !ideal[i]) continue; n++; if (d.slots[i] === ideal[i]) same++; }
  return n >= 24 ? same / n : null;
}
function idealCardHTML(R) {
  const ideal = idealSlots();
  if (!ideal) return card('Your ideal day', '<p class="small">Paint a day the way you\'d like every day to go, then tap ⋯ on the day card → "Save this day as my ideal day". Each day then shows how close it got.</p>');
  const scores = R.valid.map(function (d) { return { d: d, m: idealMatch(d, ideal) }; }).filter(function (x) { return x.m !== null; });
  if (!scores.length) return card('Your ideal day', typicalStrip(ideal, 'Ideal') + '<p class="small">Log a few full days to compare.</p>');
  // where reality differs most, in 2-hour windows
  let worst = null;
  for (let w = 0; w < 12; w++) {
    let miss = 0, n = 0;
    const counts = {};
    scores.forEach(function (x) {
      for (let i = w * 8; i < w * 8 + 8; i++) {
        if (!x.d.slots[i] || !ideal[i]) continue;
        n++;
        if (x.d.slots[i] !== ideal[i]) { miss++; counts[x.d.slots[i]] = (counts[x.d.slots[i]] || 0) + 1; }
      }
    });
    if (n && (!worst || miss / n > worst.rate)) {
      const instead = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; })[0];
      worst = { w: w, rate: miss / n, want: ideal[w * 8 + 4] || ideal[w * 8], instead: instead };
    }
  }
  const y = scores.find(function (x) { return x.d.key === dayKey(addDays(midnight(now()), -1)); });
  return card('Your ideal day', '<div class="st-tiles">' + tile('Match', Math.round(mean(scores.map(function (x) { return x.m; })) * 100) + '%', 'on average', 'Share of painted 15-minute slots where the type of activity matches your ideal day.') +
    (y ? tile('Yesterday', Math.round(y.m * 100) + '%', '') : '') + '</div>' + typicalStrip(ideal, 'Ideal') +
    (worst && worst.rate > 0.4 && worst.want && worst.instead ? '<p class="small">Biggest difference: <b>' + hourName(worst.w * 2) + '–' + hourName(worst.w * 2 + 2) + '</b>. Ideal is ' + kindInfo(worst.want).name + ', usually it\'s ' + kindInfo(worst.instead).name + '.</p>' : ''));
}

// ---------- 7-day challenges ----------
const CHALLENGES = [
  { id: 'bed1', name: 'In bed by 1 am', test: function (d, nightAfter) { return nightAfter ? nightAfter.bed <= 25 * 60 : null; } },
  { id: 'sleep7', name: '7 hours of sleep', test: function (d, nightAfter, nightBefore) { return nightBefore ? nightBefore.asleep >= 420 : null; } },
  { id: 'morning', name: 'No waste before noon', test: function (d) { return sum(d.hours.slice(0, 12).map(function (h) { return h.waste || 0; })) < 5; } },
  { id: 'waste1h', name: 'Under 1 hour wasted', test: function (d) { return d.mins.waste < 60; } },
  { id: 'deep90', name: 'A 90-minute deep-work block', test: function (d) {
    let best = 0, cur = 0, end = 0;
    d.segs.forEach(function (s) { if (s.kind === 'productive') { cur = s.start - end <= 5 * MIN && cur ? cur + (s.end - s.start) : s.end - s.start; end = s.end; best = Math.max(best, cur); } else if (s.end - s.start > 5 * MIN) cur = 0; });
    return best >= 90 * MIN;
  } },
  { id: 'move20', name: 'Move 20 minutes', test: function (d) { return d.mins.workout >= 20; } }
];
// Each active challenge: one result per day since it started (true / false / null = not known yet).
function challengeDays(ch) {
  const start = new Date(ch.start + 'T00:00').getTime();
  const days = buildDays(start, addDays(start, 7));
  const nights = buildNights();
  const def = CHALLENGES.find(function (c) { return c.id === ch.type; });
  return days.map(function (d) {
    if (d.start > midnight(now())) return null;
    const nightAfter = nights.find(function (n) { return n.key === dayKey(addDays(d.start, 1)); });
    const nightBefore = nights.find(function (n) { return n.key === d.key; });
    const r = def.test(d, nightAfter, nightBefore);
    if (d.today) return r === true ? true : null;     // today can still go either way
    if (d.coverage < VALID_COVER) return false;        // not logged counts as missed
    return r === null ? (d.start < addDays(midnight(now()), -1) ? false : null) : r;
  });
}
function updateChallenges() {
  const active = state.settings.ctChallenges || [];
  let changed = false;
  active.slice().forEach(function (ch) {
    const res = challengeDays(ch);
    if (res.filter(function (x) { return x === true; }).length === 7) {
      state.settings.ctBadges = (state.settings.ctBadges || []).concat([{ type: ch.type, won: dayKey() }]);
      state.settings.ctChallenges = state.settings.ctChallenges.filter(function (x) { return x !== ch; });
      changed = true;
      sound('milestone');
      toast('🏅 Challenge complete: ' + CHALLENGES.find(function (c) { return c.id === ch.type; }).name + '!');
    }
  });
  if (changed) { state.settings.updatedAt = now(); save(); }
}
function challengesCardHTML() {
  updateChallenges();
  const active = state.settings.ctChallenges || [];
  const badges = state.settings.ctBadges || [];
  const free = CHALLENGES.filter(function (c) { return !active.some(function (a) { return a.type === c.id; }); });
  return card('7-day challenges', (active.length ? '<ul class="chal">' + active.map(function (ch) {
    const def = CHALLENGES.find(function (c) { return c.id === ch.type; });
    const res = challengeDays(ch);
    const failed = res.indexOf(false) !== -1;
    return '<li><span>' + def.name + (failed ? ' <small class="bad">missed a day</small>' : '') + '</span><div class="cdots">' + res.map(function (r) {
      return '<i class="' + (r === true ? 'ok' : r === false ? 'no' : '') + '">' + (r === true ? '✓' : r === false ? '✗' : '') + '</i>';
    }).join('') + '</div>' + (failed ? '<button class="btn small" data-action="ctchalgo" data-t="' + def.id + '">Restart</button>' : '') +
      '<button class="icon-btn sm" data-action="ctchalstop" data-t="' + def.id + '" aria-label="Stop">×</button></li>';
  }).join('') + '</ul>' : '') +
    (free.length ? '<p class="small">Start one: 7 days in a row wins a badge.</p><div class="pickrow wrap">' + free.map(function (c) {
      return '<button class="pick" data-action="ctchalgo" data-t="' + c.id + '">' + c.name + '</button>';
    }).join('') + '</div>' : '') +
    (badges.length ? '<p class="small">Badges: ' + badges.map(function (b) { const c = CHALLENGES.find(function (x) { return x.id === b.type; }); return '🏅 ' + (c ? c.name : b.type); }).join(' · ') + '</p>' : ''));
}
actions.ctchalgo = function (el) {
  const list = (state.settings.ctChallenges || []).filter(function (c) { return c.type !== el.dataset.t; });
  list.push({ id: uid(), type: el.dataset.t, start: dayKey() });
  state.settings.ctChallenges = list;
  state.settings.updatedAt = now(); save(); renderCtStats(true);
  toast('Challenge started. Day 1 is today.');
};
actions.ctchalstop = function (el) {
  state.settings.ctChallenges = (state.settings.ctChallenges || []).filter(function (c) { return c.type !== el.dataset.t; });
  state.settings.updatedAt = now(); save(); renderCtStats(true);
};

// ---------- export and print ----------
actions.ctexport = function () {
  function cell(v) { v = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
  const rows = [['Start', 'End', 'Minutes', 'Activity', 'Kind', 'Name (one-off)', 'Note', 'Worth it']];
  liveRanges().slice().sort(function (a, b) { return a.start - b.start; }).forEach(function (r) {
    rows.push([new Date(r.start).toISOString(), new Date(r.end).toISOString(), Math.round((r.end - r.start) / MIN), catName(r.cat), kindInfo(segKind(r)).name, r.label || '', r.note || '', r.worth > 0 ? 'yes' : r.worth < 0 ? 'no' : '']);
  });
  downloadFile('taskstack-colortracker-' + dayKey() + '.csv', rows.map(function (r) { return r.map(cell).join(','); }).join('\n'), 'text/csv');
  toast('Every block downloaded as a CSV.');
};
// A printable month: one 24 h strip per day, in each activity's colour.
actions.ctposter = function () {
  const t = new Date(now());
  const from = new Date(t.getFullYear(), t.getMonth(), 1).getTime();
  const to = new Date(t.getFullYear(), t.getMonth() + 1, 1).getTime();
  let html = '<h1>' + t.toLocaleDateString([], { month: 'long', year: 'numeric' }) + ' · ColorTracker</h1><div class="pp-axis"><span></span><em>12 am</em><em>6 am</em><em>12 pm</em><em>6 pm</em><em>12 am</em></div>';
  for (let d = from; d < to; d = addDays(d, 1)) {
    html += '<div class="pp-row"><span>' + new Date(d).toLocaleDateString([], { weekday: 'short', day: 'numeric' }) + '</span><div class="pp-strip">' +
      ctSegs(d, addDays(d, 1)).map(function (s) {
        return '<i style="left:' + ((s.start - d) / DAY * 100).toFixed(2) + '%;width:' + ((s.end - s.start) / DAY * 100).toFixed(2) + '%;background:' + catColor(s.cat) + '"></i>';
      }).join('') + '</div></div>';
  }
  html += '<div class="pp-key">' + liveCats().map(function (c) { return '<span><i style="background:' + c.color + '"></i>' + esc(c.name) + '</span>'; }).join('') + '</div>';
  let el = $('printArea');
  if (!el) { el = document.createElement('div'); el.id = 'printArea'; document.body.appendChild(el); }
  el.innerHTML = html;
  document.body.classList.add('printing');
  setTimeout(function () { window.print(); }, 100);
};
window.addEventListener('afterprint', function () { document.body.classList.remove('printing'); });

// ---------- today's ring in Wrap up the day ----------
function ctWrapHTML() {
  if (!liveRanges().length) return '';
  const ds = midnight(now());
  const d = buildDays(ds, addDays(ds, 1))[0];
  const kinds = KIND_IDS.filter(function (k) { return d.mins[k] >= 5; }).sort(function (a, b) { return d.mins[b] - d.mins[a]; });
  return '<div class="wrapring">' + ringSVG24(ds, 84) + '<ul class="klist">' + kinds.slice(0, 5).map(function (k) {
    return '<li>' + kindDot(k) + '<span>' + kindInfo(k).name + '</span><b>' + fmtMins(d.mins[k]) + '</b></li>';
  }).join('') + '</ul></div>';
}
