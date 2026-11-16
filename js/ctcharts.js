/* =========================================================
   Charts for ColorTracker stats (v0.19).

   1. Touch / hover read-outs. Anything with data-tip="Title|line|line" shows a small box
      with the exact numbers: on hover with a mouse, on tap with a finger.
      Inside a chart marked data-scrub="x" you can also slide a finger (or the mouse) across
      and the nearest bar is read out, like Apple Health. data-scrub="xy" = nearest in a grid.
      Use tipAttr() to build the attribute. No title="" on charts any more.
   2. chartHTML(): one builder for bar, stacked, range and line charts, with a y axis,
      reference lines (goal, average) and x labels.
   3. The charts added in v0.19: day rings, each-day stack, sleep length, sleep by weekday,
      bedtime line, productive and waste trends, month race, workout log.
   ========================================================= */

// ---------- 1. read-outs ----------
let tipCur = null;       // the element being read out
let tipDrag = false;     // a finger is sliding across a chart
function tipAttr() {
  const parts = Array.prototype.slice.call(arguments).filter(function (x) { return x !== null && x !== undefined && x !== ''; });
  return ' data-tip="' + esc(parts.join('|')) + '"';
}
function tipBox() {
  let el = $('chartTip');
  if (!el) {
    el = document.createElement('div');
    el.id = 'chartTip';
    el.className = 'chart-tip';
    el.hidden = true;
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  return el;
}
function tipHide() {
  if (!tipCur) return;
  tipCur.classList.remove('tip-on');
  const zone = tipCur.closest('[data-scrub]');
  if (zone) zone.classList.remove('scrubbing');
  tipCur = null;
  tipBox().hidden = true;
}
function tipShow(t) {
  if (t === tipCur) return;
  tipHide();
  tipCur = t;
  t.classList.add('tip-on');
  const zone = t.closest('[data-scrub]');
  if (zone) zone.classList.add('scrubbing');
  const parts = t.getAttribute('data-tip').split('|');
  const box = tipBox();
  box.innerHTML = '<b>' + esc(parts[0]) + '</b>' + parts.slice(1).map(function (p) { return '<span>' + esc(p) + '</span>'; }).join('');
  box.hidden = false;
  const r = t.getBoundingClientRect();
  const bw = box.offsetWidth, bh = box.offsetHeight;
  let top = r.top - bh - 8;
  if (top < 8) top = Math.min(window.innerHeight - bh - 8, r.bottom + 8);
  box.style.left = Math.max(8, Math.min(window.innerWidth - bw - 8, r.left + r.width / 2 - bw / 2)) + 'px';
  box.style.top = top + 'px';
}
// What the pointer is on: the element itself, or (inside a scrub chart) the nearest one.
function tipTarget(e) {
  if (!e.target.closest) return null;
  const direct = e.target.closest('[data-tip]');
  const zone = e.target.closest('[data-scrub]');
  if (!zone) return direct;
  const both = zone.getAttribute('data-scrub') === 'xy';
  let best = null, bd = Infinity;
  zone.querySelectorAll('[data-tip]').forEach(function (el) {
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) return;
    const dx = Math.abs(r.left + r.width / 2 - e.clientX);
    const dy = both ? Math.abs(r.top + r.height / 2 - e.clientY) : 0;
    const d = dx * dx + dy * dy;
    if (d < bd) { bd = d; best = el; }
  });
  return best || direct;
}
document.addEventListener('pointerdown', function (e) {
  const t = tipTarget(e);
  if (!t) { tipHide(); return; }
  const zone = t.closest('[data-scrub]');
  if (e.pointerType !== 'mouse' && t === tipCur && !zone) { tipHide(); return; }     // tap again = close
  tipShow(t);
  tipDrag = e.pointerType !== 'mouse' && !!zone;
});
document.addEventListener('pointermove', function (e) {
  if (e.pointerType !== 'mouse' && !tipDrag) return;
  const t = tipTarget(e);
  if (t) tipShow(t);
  else if (e.pointerType === 'mouse') tipHide();
});
document.addEventListener('pointerup', function () { tipDrag = false; });
document.addEventListener('pointercancel', function () { tipDrag = false; });
document.addEventListener('mouseleave', tipHide);
document.addEventListener('scroll', function () { if (!tipDrag) tipHide(); }, true);
window.addEventListener('resize', tipHide);

// ---------- 2. one chart builder ----------
function movingAvg(vals, win) {       // average of the last `win` values that exist (null where none do)
  return vals.map(function (v, i) {
    const part = vals.slice(Math.max(0, i - win + 1), i + 1).filter(function (x) { return x !== null && x !== undefined; });
    return part.length ? sum(part) / part.length : null;
  });
}
function minuteTicks(max) {           // a few round steps for a minutes axis
  const steps = [15, 30, 60, 120, 180, 240, 360, 480];
  let step = steps[steps.length - 1];
  for (let i = 0; i < steps.length; i++) { if (max / steps[i] <= 4) { step = steps[i]; break; } }
  const out = [];
  for (let v = step; v <= max + 0.001; v += step) out.push(v);
  return out;
}
function tickHours(m) { return m % 60 === 0 ? (m / 60) + 'h' : m < 60 ? m + 'm' : (Math.round(m / 6) / 10) + 'h'; }
// Which columns get a date under them: first, last and a few between.
function xLabels(n, textAt) {
  const every = n <= 8 ? 1 : Math.ceil(n / 4.5);
  const out = [];
  for (let i = 0; i < n; i++) out.push(i % every === 0 || i === n - 1 ? textAt(i) : '');
  if (every > 1) { for (let i = n - 2; i > n - 1 - Math.ceil(every * 0.75) && i > 0; i--) out[i] = ''; }     // nothing squeezed against the last label
  return out;
}
/* chartHTML(o)
   o.cols   [{ tip, cls, segs: [[value, color]], bars: [[from, to, color]], dots: [[value, color]] }]
            segs stack up from the bottom; bars float between two values; dots sit on a value.
   o.lo, o.hi   the y range (lo defaults to 0).   o.invert  true = bigger values lower down (clock times)
   o.ticks  [values]   o.fmt(v) text for a tick
   o.refs   [{ v, label, cls }]  dashed reference lines (goal, average)
   o.lines  [{ vals: [..null..], color, cls }]  lines through the column centres
   o.xl     [text per column, '' = none]   o.h  height in px   o.legend  [[color, name]]              */
function chartHTML(o) {
  const lo = o.lo || 0, hi = o.hi || 1, n = o.cols.length;
  function y(v) { const p = (v - lo) / (hi - lo) * 100; return Math.max(0, Math.min(100, o.invert ? 100 - p : p)); }
  let plot = '';
  (o.ticks || []).forEach(function (v) { plot += '<i class="cc-g" style="bottom:' + y(v).toFixed(1) + '%"></i>'; });
  o.cols.forEach(function (c) {
    let inner = '';
    let base = 0;
    (c.segs || []).forEach(function (s) {
      if (s[0] <= 0) return;
      const hgt = s[0] / (hi - lo) * 100;
      inner += '<span class="cc-s" style="bottom:' + base.toFixed(2) + '%;height:' + Math.min(100 - base, hgt).toFixed(2) + '%;background:' + s[1] + '"></span>';
      base += hgt;
    });
    (c.bars || []).forEach(function (b) {
      const a = y(b[0]), z = y(b[1]);
      inner += '<span class="cc-s cc-b" style="bottom:' + Math.min(a, z).toFixed(2) + '%;height:' + Math.max(1.2, Math.abs(a - z)).toFixed(2) + '%;background:' + b[2] + '"></span>';
    });
    (c.dots || []).forEach(function (d) {
      if (d[0] === null || d[0] === undefined) return;
      inner += '<i class="cc-dot" style="bottom:' + y(d[0]).toFixed(2) + '%;background:' + d[1] + '"></i>';
    });
    plot += '<div class="cc-col' + (c.cls ? ' ' + c.cls : '') + '"' + (c.tip || '') + '>' + inner + '</div>';
  });
  (o.lines || []).forEach(function (l) {
    let runs = [], cur = [];
    l.vals.forEach(function (v, i) {
      if (v === null || v === undefined) { if (cur.length) runs.push(cur); cur = []; return; }
      cur.push(((i + 0.5) / n * 100).toFixed(2) + ',' + (100 - y(v)).toFixed(2));
    });
    if (cur.length) runs.push(cur);
    plot += '<svg class="cc-line' + (l.cls ? ' ' + l.cls : '') + '" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">' +
      runs.map(function (r) { return '<polyline points="' + r.join(' ') + '" style="stroke:' + l.color + '"/>'; }).join('') + '</svg>';
  });
  (o.refs || []).forEach(function (r) {
    if (r.v === null || r.v === undefined) return;
    plot += '<i class="cc-ref' + (r.cls ? ' ' + r.cls : '') + '" style="bottom:' + y(r.v).toFixed(1) + '%"><em>' + esc(r.label) + '</em></i>';
  });
  return '<div class="cchart' + (n > 20 ? ' dense' : '') + (o.cls ? ' ' + o.cls : '') + '" style="--h:' + (o.h || 150) + 'px">' +
    '<div class="cc-y">' + (o.ticks || []).map(function (v) { return '<em style="bottom:' + y(v).toFixed(1) + '%">' + esc(o.fmt ? o.fmt(v) : v) + '</em>'; }).join('') + '</div>' +
    '<div class="cc-plot" data-scrub="x">' + plot + '</div>' +
    '<div class="cc-x">' + (o.xl || []).map(function (t) { return '<span>' + (t ? '<em>' + esc(t) + '</em>' : '') + '</span>'; }).join('') + '</div>' +
    (o.legend ? '<p class="cc-leg">' + o.legend.map(function (l) { return '<span><i style="background:' + l[0] + '"></i>' + esc(l[1]) + '</span>'; }).join('') + '</p>' : '') +
    '</div>';
}
function shortDate(ms) { return new Date(ms).toLocaleDateString([], { day: 'numeric', month: 'short' }); }
function clockOfLate(m) { return fmtClockMins(((m % 1440) + 1440) % 1440); }     // 1500 → "1:00 AM"

// Rings like a fitness watch: each ring fills towards its goal. rings: [{ pct, color, tip }] outermost first.
function ringsSVG(rings, size) {
  let out = '';
  rings.forEach(function (g, i) {
    const r = 43 - i * 11.5, c = 2 * Math.PI * r;
    const p = Math.max(0, Math.min(1, g.pct || 0));
    out += '<g' + (g.tip || '') + '><circle cx="50" cy="50" r="' + r + '" class="dr-t" style="stroke:' + g.color + '"/>' +
      (p > 0 ? '<circle cx="50" cy="50" r="' + r + '" class="dr-a" style="stroke:' + g.color + '" stroke-dasharray="' + (p * c).toFixed(2) + ' ' + c.toFixed(2) + '" transform="rotate(-90 50 50)"/>' : '') + '</g>';
  });
  return '<svg class="rings" viewBox="0 0 100 100" width="' + size + '" height="' + size + '">' + out + '</svg>';
}

// ---------- 3. the charts ----------
const SLEEP_COLOR = '#6366f1';
// Three rings a day (sleep, productive, workout) against your own goals: today big, the last 7 days small.
function ringsCardHTML() {
  const today = midnight(now());
  const days = buildDays(addDays(today, -6), addDays(today, 1));
  const nights = buildNights();
  const need = sleepNeed(), prodGoal = ctGoalMins('productive', 'min', 240), workGoal = ctGoalMins('workout', 'min', 20);
  const colors = [SLEEP_COLOR, kindInfo('productive').color, kindInfo('workout').color];
  function parts(d) {
    const night = nights.find(function (n) { return n.key === d.key; });
    const vals = [night ? night.asleep : 0, d.mins.productive, d.mins.workout];
    const goals = [need, prodGoal, workGoal];
    const names = ['Sleep', 'Productive', 'Workout'];
    return names.map(function (name, i) {
      return { name: name, v: vals[i], goal: goals[i], pct: vals[i] / goals[i], color: colors[i],
        line: name + ' ' + fmtMins(vals[i]) + ' of ' + fmtMins(goals[i]) + ' (' + Math.round(vals[i] / goals[i] * 100) + '%)' };
    });
  }
  const t = parts(days[6]);
  const big = ringsSVG(t.map(function (p) { return { pct: p.pct, color: p.color, tip: tipAttr('Today · ' + p.name, fmtMins(p.v) + ' of your ' + fmtMins(p.goal) + ' goal', Math.round(p.pct * 100) + '%' + (p.pct >= 1 ? ' · ring closed' : ' · ' + fmtMins(p.goal - p.v) + ' to go')) }; }), 132);
  const week = days.map(function (d) {
    const p = parts(d);
    const closed = p.filter(function (x) { return x.pct >= 1; }).length;
    return '<div class="dr-day' + (d.today ? ' today' : '') + '"' + tipAttr(ctDate(d.start), p[0].line, p[1].line, p[2].line, closed + ' of 3 rings closed') + '>' +
      ringsSVG(p.map(function (x) { return { pct: x.pct, color: x.color }; }), 38) + '<small>' + DOW_NAMES[d.dow][0] + '</small></div>';
  }).join('');
  return card('Day rings', '<div class="dr-wrap">' + big + '<ul class="dr-list">' + t.map(function (p) {
      return '<li><i style="background:' + p.color + '"></i><span>' + p.name + '</span><b>' + fmtMins(p.v) + '</b><small>/ ' + fmtMins(p.goal) + '</small></li>';
    }).join('') + '</ul></div><div class="dr-week" data-scrub="x">' + week + '</div>' +
    how('Each ring fills towards a goal: sleep towards your sleep need, productive time towards your daily goal (4h unless you set one in Goals), workout towards 20 minutes (or your workout goal). Today is the big one; tap a small one for that day.'));
}
// Every day in the range as one stacked column: how the 24 hours were split.
function dailyStackHTML(R) {
  const days = R.days.filter(function (d) { return d.start <= midnight(now()); }).slice(-31);
  if (days.length < 2) return '';
  const cols = days.map(function (d) {
    const top = KIND_IDS.filter(function (k) { return d.mins[k] >= 1; }).sort(function (a, b) { return d.mins[b] - d.mins[a]; }).slice(0, 5);
    return { cls: d.coverage < VALID_COVER ? 'faint' : '', segs: KIND_IDS.map(function (k) { return [d.mins[k], kindInfo(k).color]; }),
      tip: tipAttr.apply(null, [ctDate(d.start)].concat(top.map(function (k) { return kindInfo(k).name + ' ' + fmtMins(d.mins[k]); }), [Math.round(Math.min(1, d.coverage) * 100) + '% of the day painted'])) };
  });
  const used = KIND_IDS.filter(function (k) { return days.some(function (d) { return d.mins[k] >= 1; }); });
  return card('Each day <small>(' + (days.length < R.days.length ? 'last ' + days.length + ' days' : days.length + ' days') + ')</small>',
    chartHTML({ cols: cols, hi: 1440, ticks: [360, 720, 1080, 1440], fmt: tickHours, h: 170, xl: xLabels(days.length, function (i) { return shortDate(days[i].start); }),
      legend: used.map(function (k) { return [kindInfo(k).color, kindInfo(k).name]; }) }) +
    how('One column per day, split by type of activity, out of 24 hours. The blank top is time you didn\'t paint. Faded columns are less than half painted.'));
}
// How long each night was, against your need, with a 7-night average line.
function sleepBarsHTML(nights) {
  if (nights.length < 2) return '';
  const need = sleepNeed();
  const vals = nights.map(function (n) { return n.asleep; });
  const hi = Math.max(need + 60, Math.ceil(Math.max.apply(null, vals) / 60) * 60);
  const cols = nights.map(function (n) {
    const diff = n.asleep - need;
    return { segs: [[n.asleep, n.asleep < 360 ? 'color-mix(in srgb, ' + SLEEP_COLOR + ' 55%, var(--danger))' : SLEEP_COLOR]],
      tip: tipAttr(ctDate(n.end), 'Slept ' + fmtMins(n.asleep), 'Went to bed ' + fmtTime(n.start) + ' · woke up ' + fmtTime(n.end), Math.abs(diff) < 5 ? 'Right on your need' : fmtMins(Math.abs(diff)) + (diff > 0 ? ' over' : ' under') + ' your need') };
  });
  return chartHTML({ cols: cols, hi: hi, ticks: minuteTicks(hi), fmt: tickHours, h: 150,
    refs: [{ v: need, label: 'need ' + fmtMins(need), cls: 'goal' }],
    lines: nights.length >= 5 ? [{ vals: movingAvg(vals, 7), color: 'var(--ink)' }] : [],
    xl: xLabels(nights.length, function (i) { return shortDate(nights[i].end); }),
    legend: nights.length >= 5 ? [[SLEEP_COLOR, 'Time asleep'], ['var(--ink)', '7-night average']] : null });
}
// Bedtime → wake-up for every night (the bar is the time in bed). Earlier is higher.
function sleepScheduleChart(nights) {
  if (!nights.length) return '';
  const lo = 18 * 60, hi = 38 * 60;                      // 6 pm .. 2 pm next day
  function wakeOf(n) { return n.wake < 18 * 60 ? n.wake + 1440 : n.wake; }
  const cols = nights.map(function (n) {
    return { bars: [[n.bed, wakeOf(n), n.asleep < 360 ? 'color-mix(in srgb, ' + SLEEP_COLOR + ' 55%, var(--danger))' : SLEEP_COLOR]],
      tip: tipAttr(ctDate(n.end), 'Went to bed ' + fmtTime(n.start), 'Woke up ' + fmtTime(n.end), fmtMins(n.asleep) + ' asleep' + (n.awake >= 5 ? ' · awake ' + fmtMins(n.awake) + ' in between' : '')) };
  });
  const bed = mean(nights.map(function (n) { return n.bed; })), wake = mean(nights.map(wakeOf));
  return chartHTML({ cols: cols, lo: lo, hi: hi, invert: true, ticks: [21, 24, 27, 30, 33, 36].map(function (h) { return h * 60; }), fmt: function (v) { return hourName((v / 60) % 24); }, h: 200,
    refs: [{ v: bed, label: 'usual ' + clockOfLate(bed), cls: 'avg' }, { v: wake, label: 'usual ' + clockOfLate(wake), cls: 'avg under' }],
    xl: xLabels(nights.length, function (i) { return shortDate(nights[i].end); }) });
}
// The usual night for each weekday: average bedtime → average wake-up.
function sleepWeekdayHTML(nights) {
  if (nights.length < 7) return '';
  function wakeOf(n) { return n.wake < 18 * 60 ? n.wake + 1440 : n.wake; }
  const order = [1, 2, 3, 4, 5, 6, 0];
  const cols = order.map(function (w) {
    const list = nights.filter(function (n) { return new Date(n.wakeDay).getDay() === w; });
    if (!list.length) return { tip: tipAttr(DOW_NAMES[w] + ' mornings', 'No nights yet') };
    const bed = mean(list.map(function (n) { return n.bed; })), wake = mean(list.map(wakeOf)), len = mean(list.map(function (n) { return n.asleep; }));
    const beds = list.map(function (n) { return n.bed; });
    return { bars: [[bed, wake, SLEEP_COLOR]],
      tip: tipAttr(DOW_NAMES[w] + ' mornings · ' + list.length + (list.length === 1 ? ' night' : ' nights'), 'Usually bed ' + clockOfLate(bed) + ' · up ' + clockOfLate(wake), fmtMins(len) + ' asleep on average',
        'Bedtime from ' + clockOfLate(Math.min.apply(null, beds)) + ' to ' + clockOfLate(Math.max.apply(null, beds))) };
  });
  return '<p class="label">Your usual night, by the day you wake up</p>' +
    chartHTML({ cols: cols, lo: 18 * 60, hi: 38 * 60, invert: true, ticks: [21, 24, 27, 30, 33, 36].map(function (h) { return h * 60; }), fmt: function (v) { return hourName((v / 60) % 24); }, h: 170, cls: 'wide',
      xl: order.map(function (w) { return DOW_NAMES[w]; }) });
}
// Bedtime night by night, with a 7-night average (later is lower).
function bedDriftChart(nights) {
  if (nights.length < 5) return '';
  const vals = nights.map(function (n) { return n.bed; });
  const lo = Math.floor((Math.min.apply(null, vals) - 20) / 60) * 60, hi = Math.ceil((Math.max.apply(null, vals) + 20) / 60) * 60;
  const ticks = [];
  for (let v = lo; v <= hi; v += (hi - lo > 300 ? 120 : 60)) ticks.push(v);
  const avg = movingAvg(vals, 7);
  return '<p class="label">Bedtime, night by night (later is lower)</p>' +
    chartHTML({ lo: lo, hi: hi, invert: true, ticks: ticks, fmt: function (v) { return hourName((v / 60) % 24); }, h: 130, cls: 'pts',
      cols: nights.map(function (n, i) { return { dots: [[n.bed, SLEEP_COLOR]], tip: tipAttr(ctDate(n.end), 'Went to bed ' + fmtTime(n.start), '7-night average ' + clockOfLate(avg[i])) }; }),
      lines: [{ vals: vals, color: 'color-mix(in srgb, ' + SLEEP_COLOR + ' 45%, transparent)', cls: 'thin' }, { vals: avg, color: SLEEP_COLOR }],
      xl: xLabels(nights.length, function (i) { return shortDate(nights[i].end); }), legend: [[SLEEP_COLOR, '7-night average']] });
}
// One kind of time per day, with its goal / budget line and a 7-day average.
function kindTrendHTML(R, kind, opts) {
  const days = R.days.filter(function (d) { return d.start <= midnight(now()) && (d.valid || d.today); }).slice(-31);
  if (days.length < 3) return '';
  const color = kindInfo(kind).color;
  const vals = days.map(function (d) { return d.mins[kind]; });
  const goal = opts.goal;
  const hi = Math.max(60, Math.ceil(Math.max(goal || 0, Math.max.apply(null, vals)) * 1.08 / 30) * 30);
  const cols = days.map(function (d) {
    const v = d.mins[kind];
    const over = opts.max && goal && v > goal;
    let third = '';
    if (goal) third = opts.max ? (v <= goal ? fmtMins(goal - v) + ' inside your ' + fmtMins(goal) + ' budget' : fmtMins(v - goal) + ' over your ' + fmtMins(goal) + ' budget')
                               : (v >= goal ? 'Goal of ' + fmtMins(goal) + ' reached' : fmtMins(goal - v) + ' short of your ' + fmtMins(goal) + ' goal');
    return { cls: d.today ? 'faint' : '', segs: [[v, over ? 'var(--danger)' : color]],
      tip: tipAttr(ctDate(d.start) + (d.today ? ' (so far)' : ''), kindInfo(kind).name + ' ' + fmtMins(v), third) };
  });
  return card(opts.title, chartHTML({ cols: cols, hi: hi, ticks: minuteTicks(hi), fmt: tickHours, h: 150,
    refs: goal ? [{ v: goal, label: (opts.max ? 'budget ' : 'goal ') + fmtMins(goal), cls: 'goal' }] : [],
    lines: days.length >= 7 ? [{ vals: movingAvg(vals, 7), color: 'var(--ink)' }] : [],
    xl: xLabels(days.length, function (i) { return shortDate(days[i].start); }),
    legend: days.length >= 7 ? [[color, kindInfo(kind).name + ' that day'], ['var(--ink)', '7-day average']] : null }) +
    how('One bar per logged day' + (days.length >= 7 ? ', and a line for the average of the 7 days up to that day (it smooths out one-off days)' : '') + '. Slide a finger across the chart to read each day.'));
}
// Running total of productive hours this month against last month, day by day.
function monthRaceHTML() {
  const today = midnight(now());
  const m0 = monthStart(today), mPrev = monthStart(addMonths(m0, -1));
  const cur = buildDays(m0, addDays(today, 1)), prev = buildDays(mPrev, m0);
  if (!prev.some(function (d) { return d.mins.productive > 0; }) && cur.length < 3) return '';
  const len = Math.max(prev.length, new Date(new Date(m0).getFullYear(), new Date(m0).getMonth() + 1, 0).getDate());
  let a = 0, b = 0;
  const A = [], B = [];
  for (let i = 0; i < len; i++) {
    if (i < cur.length) { a += cur[i].mins.productive; A.push(a); } else A.push(null);
    if (i < prev.length) { b += prev[i].mins.productive; B.push(b); } else B.push(null);
  }
  const hi = Math.max(60, Math.ceil(Math.max(a, b) * 1.08 / 600) * 600);
  const ticks = [hi / 4, hi / 2, hi * 3 / 4, hi];
  const nameA = new Date(m0).toLocaleDateString([], { month: 'long' }), nameB = new Date(mPrev).toLocaleDateString([], { month: 'long' });
  const cA = kindInfo('productive').color, cB = 'var(--muted)';
  const cols = A.map(function (v, i) {
    const diff = v !== null && B[i] !== null ? v - B[i] : null;
    return { dots: [[i === cur.length - 1 ? v : null, cA]], cls: i === cur.length - 1 ? 'now' : '',
      tip: tipAttr('Day ' + (i + 1), v !== null ? nameA + ': ' + fmtMins(v) + ' so far' : nameA + ': not there yet', B[i] !== null ? nameB + ': ' + fmtMins(B[i]) + ' by this day' : '',
        diff === null ? '' : Math.abs(diff) < 10 ? 'Level with last month' : fmtMins(Math.abs(diff)) + (diff > 0 ? ' ahead of' : ' behind') + ' last month') };
  });
  const dNow = cur.length - 1;
  const lead = B[dNow] !== null && B[dNow] !== undefined ? a - B[dNow] : null;
  return card('This month vs last month', (lead === null ? '' : '<p>' + fmtMins(a) + ' productive so far in ' + nameA + ': <b class="' + (lead >= 0 ? 'up' : 'down') + '">' + fmtMins(Math.abs(lead)) + (lead >= 0 ? ' ahead of' : ' behind') + '</b> ' + nameB + ' on the same day.</p>') +
    chartHTML({ cols: cols, hi: hi, ticks: ticks, fmt: function (v) { return Math.round(v / 60) + 'h'; }, h: 150, cls: 'pts',
      lines: [{ vals: B, color: cB, cls: 'dash' }, { vals: A, color: cA }],
      xl: A.map(function (v, i) { return i === 0 || (i + 1) % 5 === 0 ? String(i + 1) : ''; }), legend: [[cA, nameA], [cB, nameB]] }) +
    how('The running total of productive time, day by day through the month. When this month\'s line is above last month\'s, you\'re ahead.'));
}
// A training log like Strava's: one bubble per day for the last 5 weeks, bigger = longer workout.
function workoutLogHTML() {
  const today = midnight(now());
  const start = addDays(weekStart(today), -28);
  const days = buildDays(start, addDays(today, 1));
  const max = Math.max.apply(null, days.map(function (d) { return d.mins.workout; }));
  if (!max) return '';
  let html = '<div class="wlog" data-scrub="xy"><div class="wl-h"><span></span>' + ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map(function (x) { return '<b>' + x + '</b>'; }).join('') + '<b class="wl-sum">Week</b></div>';
  for (let w = 0; w < 5; w++) {
    const ws = addDays(start, w * 7);
    let total = 0, cells = '';
    for (let i = 0; i < 7; i++) {
      const d = days[w * 7 + i];
      if (!d) { cells += '<span class="wl-c"></span>'; continue; }
      total += d.mins.workout;
      const what = Object.keys(d.cats).filter(function (c) { return catKind(c) === 'workout' && d.cats[c] >= 1; }).map(function (c) { return catName(c) + ' ' + fmtMins(d.cats[c]); });
      const size = d.mins.workout ? Math.round(30 + 70 * Math.sqrt(d.mins.workout / max)) : 0;
      cells += '<span class="wl-c' + (d.today ? ' today' : '') + '"' + tipAttr.apply(null, [ctDate(d.start), d.mins.workout ? 'Workout ' + fmtMins(d.mins.workout) : 'Rest day'].concat(what.length > 1 ? what : [])) + '>' +
        (size ? '<i style="--s:' + size + '"></i>' : '<i class="rest"></i>') + '</span>';
    }
    html += '<div class="wl-r"><span class="wl-w">' + shortDate(ws) + '</span>' + cells + '<b class="wl-sum">' + (total ? fmtMins(total) : '–') + '</b></div>';
  }
  return html + '</div>';
}
