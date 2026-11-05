/* =========================================================
   Repeating tasks.

   A task's rule lives in task.repeat:
     { unit: 'day'|'week'|'month'|'year', every: N,
       days: [1, 5]            week: which weekdays (0 = Sun)
       monthBy: 'date'         month: on day monthDay (-1 = last day)
              | 'nth'          month: the nth (1-4, -1 = last) weekday wd
              | 'workday'      month: first (nth 1) or last (nth -1) working day
       mode: 'fixed'           comes back on fixed dates (one task, its date moves on)
           | 'after'           comes back N units after the day you complete it
           | 'stack'           a new copy on every date even if the last isn't done (max 5)
       start, until }          first date the rule counts from; optional last date

   fixed / after: ticking the task logs it in task.history and moves its date on.
   stack: each date gets its own copy (same seriesId, id = seriesId + '_' + day so two
   devices never make the same copy twice). Unfinished copies stack in one panel.
   ========================================================= */

const STACK_MAX = 5;
const RP_WD_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const RP_WD_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const REPEAT_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 2l3 3-3 3"/><path d="M4 11V9a4 4 0 0 1 4-4h12"/><path d="M7 22l-3-3 3-3"/><path d="M20 13v2a4 4 0 0 1-4 4H4"/></svg>';
const STACK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/></svg>';

// ---------- date maths ----------
function rpDayDiff(a, b) { return Math.round((midnight(b) - midnight(a)) / DAY); }
function rpMonday(t) { const d = midnight(t); return addDays(d, -((new Date(d).getDay() + 6) % 7)); }
function rpLastDay(y, m) { return new Date(y, m + 1, 0).getDate(); }
function rpIsWorkday(t) { const w = new Date(t).getDay(); return w !== 0 && w !== 6; }
function rpAddMonths(t, n) {         // same day number n months later, clamped (31 Jan + 1 month = 28/29 Feb)
  const d = new Date(t);
  const y = d.getFullYear(), m = d.getMonth() + n;
  return new Date(y, m, Math.min(d.getDate(), rpLastDay(y, m))).getTime();
}
function rpOrdinal(n) {
  if (n === -1) return 'last';
  const s = (n % 100 >= 11 && n % 100 <= 13) ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] || 'th');
  return n + s;
}

// Does day d (midnight) fall on the rule?
function rpMatches(r, d) {
  if (d < r.start) return false;
  if (r.until && d > r.until) return false;
  const n = r.every || 1;
  const dt = new Date(d), st = new Date(r.start);
  if (r.unit === 'day') return rpDayDiff(r.start, d) % n === 0;
  if (r.unit === 'week') return Math.round(rpDayDiff(rpMonday(r.start), rpMonday(d)) / 7) % n === 0 && r.days.indexOf(dt.getDay()) !== -1;
  const months = (dt.getFullYear() - st.getFullYear()) * 12 + dt.getMonth() - st.getMonth();
  const last = rpLastDay(dt.getFullYear(), dt.getMonth());
  const day = dt.getDate();
  if (r.unit === 'year') return months % (12 * n) === 0 && day === Math.min(st.getDate(), last);
  if (months % n !== 0) return false;
  if (r.monthBy === 'nth') return dt.getDay() === r.wd && (r.nth === -1 ? day + 7 > last : Math.ceil(day / 7) === r.nth);
  if (r.monthBy === 'workday') {
    if (!rpIsWorkday(d)) return false;
    const from = r.nth === -1 ? day + 1 : 1, to = r.nth === -1 ? last : day - 1;
    for (let x = from; x <= to; x++) if (rpIsWorkday(new Date(dt.getFullYear(), dt.getMonth(), x))) return false;
    return true;
  }
  return day === (r.monthDay === -1 ? last : Math.min(r.monthDay, last));
}
// First day after `day` that falls on the rule (null when the rule has ended).
function rpNextAfter(r, day) {
  let d = addDays(midnight(day), 1);
  for (let i = 0; i < 4000; i++) {
    if (r.until && d > r.until) return null;
    if (rpMatches(r, d)) return d;
    d = addDays(d, 1);
  }
  return null;
}
function rpFirstOnOrAfter(r, day) { return rpNextAfter(r, addDays(midnight(day), -1)); }
// "After I finish": N units after the day you completed it.
function rpAfterNext(r, doneDay) {
  const n = r.every || 1;
  let d;
  if (r.unit === 'day') d = addDays(doneDay, n);
  else if (r.unit === 'week') d = addDays(doneDay, 7 * n);
  else d = rpAddMonths(doneDay, r.unit === 'year' ? 12 * n : n);
  return r.until && d > r.until ? null : d;
}

// Fill in a rule's blanks from its first day (weekly = that weekday, monthly = that date) and line it up.
function rpNorm(rule, startDay) {
  const r = Object.assign({ unit: 'day', every: 1, mode: 'fixed', days: [], monthBy: 'date', monthDay: null, nth: 1, wd: 1, until: null }, rule);
  r.every = Math.max(1, Math.min(99, Math.round(r.every) || 1));
  r.days = (r.days || []).slice();
  r.start = midnight(startDay);
  const s = new Date(r.start);
  if (r.unit === 'week' && !r.days.length) r.days = [s.getDay()];
  if (r.unit === 'month' && r.monthBy === 'date' && !r.monthDay) r.monthDay = s.getDate();
  if (r.mode !== 'after') {                      // start on the first day that actually fits ("every mon" added on a Thursday)
    const first = rpFirstOnOrAfter(r, r.start);
    if (first !== null) r.start = first;
  }
  return r;
}

// ---------- words ----------
function rpDaysText(days, long) {
  const order = days.slice().sort(function (a, b) { return ((a + 6) % 7) - ((b + 6) % 7); });
  if (order.join() === '1,2,3,4,5') return long ? 'weekday (Mon–Fri)' : 'weekday';
  if (order.join() === '6,0') return 'weekend';
  return order.map(function (d) { return (long ? RP_WD_LONG : RP_WD_NAMES)[d]; }).join(', ');
}
function rpUnitText(r) {
  const n = r.every || 1;
  return n === 1 ? r.unit : n + ' ' + r.unit + 's';
}
// Short label for chips: "Every Mon, Fri", "Every 4 days after done", "2nd Mon monthly".
function repeatLabel(r) {
  const n = r.every || 1;
  let s;
  if (r.mode === 'after') return 'Every ' + rpUnitText(r) + ' after done';
  if (r.unit === 'day') s = n === 1 ? 'Daily' : 'Every ' + n + ' days';
  else if (r.unit === 'week') s = !r.days.length ? (n === 1 ? 'Weekly' : 'Every ' + n + ' weeks') : (n === 1 ? 'Every ' : 'Every ' + n + ' weeks on ') + rpDaysText(r.days);
  else if (r.unit === 'month') {
    const every = n === 1 ? 'monthly' : 'every ' + n + ' months';
    if (r.monthBy === 'nth') s = rpOrdinal(r.nth) + ' ' + RP_WD_NAMES[r.wd] + ' ' + every;
    else if (r.monthBy === 'workday') s = (r.nth === -1 ? 'Last' : 'First') + ' working day ' + every;
    else if (r.monthDay === -1) s = 'Last day ' + every;
    else s = r.monthDay ? rpOrdinal(r.monthDay) + ' ' + every : (n === 1 ? 'Monthly' : 'Every ' + n + ' months');
    s = s.charAt(0).toUpperCase() + s.slice(1);
  } else s = n === 1 ? 'Yearly' : 'Every ' + n + ' years';
  return r.mode === 'stack' ? s + ' · stacks' : s;
}
// The schedule as part of a sentence: "every Monday", "on the 2nd Monday of every month".
function rpScheduleText(r) {
  const n = r.every || 1;
  if (r.unit === 'day') return n === 1 ? 'every day' : 'every ' + n + ' days';
  if (r.unit === 'week') return (n === 1 ? 'every ' : 'every ' + n + ' weeks on ') + rpDaysText(r.days, true);
  if (r.unit === 'year') return (n === 1 ? 'every year' : 'every ' + n + ' years') + ' on ' + new Date(r.start).toLocaleDateString([], { day: 'numeric', month: 'long' });
  const months = n === 1 ? 'every month' : 'every ' + n + ' months';
  if (r.monthBy === 'nth') return 'on the ' + rpOrdinal(r.nth) + ' ' + RP_WD_LONG[r.wd] + ' of ' + months;
  if (r.monthBy === 'workday') return 'on the ' + (r.nth === -1 ? 'last' : 'first') + ' working day of ' + months;
  return 'on the ' + (r.monthDay === -1 ? 'last day' : rpOrdinal(r.monthDay)) + ' of ' + months;
}
function rpDateText(d) { return new Date(d).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }); }
// A few words + an example, so it's obvious when the task comes back. from = the day it's due now.
function describeRepeat(r, from) {
  const today = midnight(now());
  let html;
  if (r.mode === 'after') {
    const n = r.every || 1;
    const span = n === 1 ? 'a ' + r.unit : n + ' ' + r.unit + 's';
    const next = rpAfterNext(r, today);
    html = 'Once you complete it, it comes back <b>' + span + ' after the day you complete it</b>. ' +
      (next ? 'For example, complete it on ' + rpDateText(today) + ' and the next one is on <b>' + rpDateText(next) + '</b>.' : '');
  } else {
    const dates = [];
    let d = from !== undefined && from !== null ? midnight(from) : rpFirstOnOrAfter(r, Math.max(r.start, today));
    while (d !== null && dates.length < 3) { dates.push(d); d = rpNextAfter(r, d); }
    const coming = dates.length ? ' Coming up: <b>' + dates.map(rpDateText).join(' · ') + '</b>.' : '';
    if (r.mode === 'stack') {
      html = 'A new copy is added <b>' + rpScheduleText(r) + '</b>, even if you haven\'t finished the last one. Unfinished copies stack up in one panel, ' +
        'at most ' + STACK_MAX + '. After that, no new copies until you finish some.' + coming;
    } else {
      html = 'It repeats <b>' + rpScheduleText(r) + '</b>, on a fixed schedule. Finish it early or late, the next one still lands on the next scheduled date.' + coming;
    }
  }
  if (r.until) html += ' Stops after ' + rpDateText(r.until) + '.';
  return html;
}

// ---------- typing it: "every mon", "every 2 weeks", "every 4 days after completion", "every 2nd sat" ----------
const RP_WD = { sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tues: 2, tue: 2, wednesday: 3, wed: 3, thursday: 4, thurs: 4, thur: 4, thu: 4, friday: 5, fri: 5, saturday: 6, sat: 6 };
const RP_WD_RE = '(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|tues|thurs|thur|mon|tue|wed|thu|fri|sat|sun)';
const RP_NTH = { '1st': 1, first: 1, '2nd': 2, second: 2, '3rd': 3, third: 3, '4th': 4, fourth: 4, last: -1 };
const RP_UNIT_RE = '(days?|d|weeks?|wks?|w|months?|mo|years?|yrs?|y)';
function rpUnit(u) { u = u.toLowerCase(); return u.charAt(0) === 'd' ? 'day' : u.charAt(0) === 'w' ? 'week' : u.charAt(0) === 'm' ? 'month' : 'year'; }

// s has a space at each end. Returns { rule, s: s without the repeat words } or null.
function parseRepeat(text) {
  let s = text, mode = 'fixed', rule = null;
  function take(re, make) {
    if (rule) return;
    s = s.replace(re, function () { rule = make.apply(null, arguments); return ' '; });
  }
  s = s.replace(/\severy!\s/i, function () { mode = 'after'; return ' every '; });
  s = s.replace(/\s(?:after\s(?:completion|completing|done|finishing|i\sfinish(?:\sit)?|i\scomplete(?:\sit)?|completed)|from\scompletion)(?=\s)/i, function () { mode = 'after'; return ' '; });
  s = s.replace(/\s(?:stack(?:ing|ed)?|stack\sup|even\sif\s(?:not\sdone|missed|incomplete|unfinished)|pile\sup)(?=\s)/i, function () { mode = 'stack'; return ' '; });

  take(/\severy\s(last|first)\s(?:working|work|business)\s?day(?:\sof\s(?:the|every)\smonth)?(?=\s)/i, function (m, w) {
    return { unit: 'month', monthBy: 'workday', nth: w.toLowerCase() === 'last' ? -1 : 1 };
  });
  take(/\severy\s(last|first)\sday(?:\sof\s(?:the|every)\smonth)?(?=\s)/i, function (m, w) {
    return { unit: 'month', monthBy: 'date', monthDay: w.toLowerCase() === 'last' ? -1 : 1 };
  });
  take(new RegExp('\\severy\\s(1st|2nd|3rd|4th|first|second|third|fourth|last)\\s(' + RP_WD_RE + ')(?:\\sof\\s(?:the|every)\\smonth)?(?=\\s)', 'i'), function (m, n, w) {
    return { unit: 'month', monthBy: 'nth', nth: RP_NTH[n.toLowerCase()], wd: RP_WD[w.toLowerCase()] };
  });
  // "every month on the last monday", "monthly on the 2nd friday", "the last monday of every month"
  take(new RegExp('\\s(?:every\\smonth|each\\smonth|monthly)\\s(?:on\\s)?(?:the\\s)?(1st|2nd|3rd|4th|first|second|third|fourth|last)\\s(' + RP_WD_RE + ')(?=\\s)', 'i'), function (m, n, w) {
    return { unit: 'month', monthBy: 'nth', nth: RP_NTH[n.toLowerCase()], wd: RP_WD[w.toLowerCase()] };
  });
  take(new RegExp('\\s(?:on\\s)?(?:the\\s)?(1st|2nd|3rd|4th|first|second|third|fourth|last)\\s(' + RP_WD_RE + ')\\s(?:of|in)\\s(?:every|each|the)\\smonth(?=\\s)', 'i'), function (m, n, w) {
    return { unit: 'month', monthBy: 'nth', nth: RP_NTH[n.toLowerCase()], wd: RP_WD[w.toLowerCase()] };
  });
  // "every month on the last day", "monthly on the 15th", "on the 15th of every month"
  take(/\s(?:every\smonth|each\smonth|monthly)\s(?:on\s)?(?:the\s)?last\sday(?=\s)/i, function () { return { unit: 'month', monthBy: 'date', monthDay: -1 }; });
  take(/\s(?:every\smonth|each\smonth|monthly)\s(?:on\s)?(?:the\s)?(\d{1,2})(?:st|nd|rd|th)?(?=\s)/i, function (m, d) {
    return { unit: 'month', monthBy: 'date', monthDay: Math.min(31, Math.max(1, Number(d))) };
  });
  take(/\s(?:on\s)?(?:the\s)?(\d{1,2})(?:st|nd|rd|th)\s(?:day\s)?of\s(?:every|each)\smonth(?=\s)/i, function (m, d) {
    return { unit: 'month', monthBy: 'date', monthDay: Math.min(31, Math.max(1, Number(d))) };
  });
  take(/\severy\s(\d{1,2})(?:st|nd|rd|th)(?:\s(?:day\s)?of\s(?:the|every)\smonth)?(?=\s)/i, function (m, d) {
    return { unit: 'month', monthBy: 'date', monthDay: Math.min(31, Math.max(1, Number(d))) };
  });
  take(/\severy\s(\d{1,2})\s(?:day\s)?of\s(?:the|every)\smonth(?=\s)/i, function (m, d) {
    return { unit: 'month', monthBy: 'date', monthDay: Math.min(31, Math.max(1, Number(d))) };
  });
  take(new RegExp('\\severy\\s(other|\\d{1,2})\\s?' + RP_UNIT_RE + '(?=\\s)', 'i'), function (m, n, u) {
    return { unit: rpUnit(u), every: n.toLowerCase() === 'other' ? 2 : Math.max(1, Number(n)) };
  });
  take(/\s(?:every\s(?:week\s?day|work\s?day|working\sday|business\sday)s?|(?:on\s)?weekdays)(?=\s)/i, function () {
    return { unit: 'week', days: [1, 2, 3, 4, 5] };
  });
  take(/\s(?:every\sweekend|(?:on\s)?weekends)(?=\s)/i, function () { return { unit: 'week', days: [6, 0] }; });
  take(new RegExp('\\severy\\s(other\\s)?(' + RP_WD_RE + '(?:\\s*(?:,|and|&)\\s*' + RP_WD_RE + ')*)(?=\\s)', 'i'), function (m, other, list) {
    const days = [];
    list.toLowerCase().split(/\s*(?:,|and|&)\s*/).forEach(function (w) { const d = RP_WD[w]; if (d !== undefined && days.indexOf(d) === -1) days.push(d); });
    return { unit: 'week', every: other ? 2 : 1, days: days };
  });
  take(/\severy\s?(day|week|month|year)(?=\s)/i, function (m, u) { return { unit: rpUnit(u) }; });
  take(/\s(daily|weekly|monthly|yearly|annually|fortnightly|biweekly|quarterly)(?=\s)/i, function (m, w) {
    return { daily: { unit: 'day' }, weekly: { unit: 'week' }, monthly: { unit: 'month' }, yearly: { unit: 'year' }, annually: { unit: 'year' },
      fortnightly: { unit: 'week', every: 2 }, biweekly: { unit: 'week', every: 2 }, quarterly: { unit: 'month', every: 3 } }[w.toLowerCase()];
  });
  if (mode === 'after') {        // "4 days after completion" (no "every")
    take(new RegExp('\\s(\\d{1,2})\\s?' + RP_UNIT_RE + '(?=\\s)', 'i'), function (m, n, u) { return { unit: rpUnit(u), every: Number(n) }; });
  }
  if (!rule) return null;        // no schedule found: leave the words alone ("stack of books")
  s = s.replace(/\s(?:starting|beginning)(?=\s)/i, ' ');
  rule.mode = mode;
  if (mode === 'after') { delete rule.days; delete rule.monthBy; }   // "after I finish" counts plain days / weeks / months
  return { rule: rule, s: s };
}

// ---------- making a task repeat ----------
// Sets task.repeat from a (maybe partial) rule, counting from the task's date (or today), and moves
// the date onto the first day that fits. Stacking tasks become a series.
function setupRepeat(t, rule) {
  const base = t.due !== null && t.due !== undefined ? midnight(t.due) : midnight(now());
  const mins = t.due !== null && t.due !== undefined && t.hasTime ? Math.round((t.due - midnight(t.due)) / MIN) : 0;
  const r = rpNorm(rule, base);
  t.repeat = r;
  t.due = r.start + mins * MIN;
  if (r.mode === 'stack') t.seriesId = t.seriesId || t.id;
  else t.seriesId = null;
}
// Change (or remove) the rule from a task's details. For a stack, every copy follows.
function applyTaskRepeat(t, rule) {
  const sid = t.repeat && t.repeat.mode === 'stack' ? t.seriesId : null;
  const others = sid ? liveTasks().filter(function (x) { return x !== t && x.seriesId === sid; }) : [];
  if (!rule) { t.repeat = null; t.seriesId = null; }
  else setupRepeat(t, rule);
  if (sid && t.repeat && t.repeat.mode === 'stack') t.seriesId = sid;
  others.forEach(function (x) {
    if (t.repeat && t.repeat.mode === 'stack') x.repeat = t.repeat;
    else { x.repeat = null; x.seriesId = null; }      // the other copies stay as plain tasks
    x.updatedAt = now();
  });
}
function repeatsInPlace(t) { return !!(t.repeat && t.repeat.mode !== 'stack'); }

// Ticking a fixed / after task: log it, then move it to its next date (Todoist's rules: never onto a
// day that's already gone, so an overdue daily task goes to tomorrow).
function rpNextDue(t, skip) {
  const r = t.repeat;
  const today = midnight(now());
  if (r.mode === 'after') return rpAfterNext(r, today);
  const due = t.due !== null ? midnight(t.due) : today;
  let next = rpNextAfter(r, due);
  if (next !== null && next <= today && !(skip && next === today)) next = rpNextAfter(r, today);
  return next;
}
function completeRepeating(t, fromSwipe, skip) {
  const next = rpNextDue(t, skip);
  const mins = t.hasTime && t.due !== null ? Math.round((t.due - midnight(t.due)) / MIN) : 0;
  snapshot(skip ? 'Skipped' : 'Completed task');
  if (!skip) {
    if (!Array.isArray(t.history)) t.history = [];
    t.history.push({ due: t.due, at: now() });
    if (t.history.length > 200) t.history = t.history.slice(-200);
  }
  if (next === null) {                              // the rule has ended: this was the last one
    if (skip) { t.repeat = null; } else { t.done = true; t.doneAt = now(); }
    t.updatedAt = now();
    save();
    renderTaskViews();
    toast(skip ? 'That was the last one, so it no longer repeats' : 'Done. That was the last one.', { undo: true });
    return;
  }
  t.due = next + mins * MIN;
  t.subtasks.forEach(function (s) { s.done = false; });   // the checklist comes back fresh each time
  t.updatedAt = now();
  save();
  if (!skip) { sound('tick'); haptic(14); }
  const rows = document.querySelectorAll('.task[data-id="' + t.id + '"]');
  if (rows.length && !fromSwipe && !skip) {
    rows.forEach(function (li) { li.classList.add('completing', 'done'); });
    setTimeout(renderTaskViews, 650);
  } else {
    renderTaskViews();
  }
  toast((skip ? 'Skipped. ' : 'Done. ') + 'Next: ' + fmtDue(t.due, t.hasTime), { undo: true });
}

// ---------- stacking: make the copies whose day has come ----------
function openStackCopies(sid) {
  return liveTasks().filter(function (t) { return t.seriesId === sid && !t.done; })
    .sort(function (a, b) { return (a.due || 0) - (b.due || 0); });
}
// In lists only the oldest unfinished copy shows (with "3 stacked"); the rest live in its panel.
function stackHeads() {
  const heads = {};
  liveTasks().forEach(function (t) {
    if (!t.seriesId || t.done) return;
    const h = heads[t.seriesId];
    if (!h || (t.due || 0) < (h.due || 0)) heads[t.seriesId] = t;
  });
  return heads;
}
function stackHidden(t, heads) { return !!(t.seriesId && !t.done && heads[t.seriesId] && heads[t.seriesId].id !== t.id); }

function runStacks() {
  const today = midnight(now());
  const series = {};
  state.tasks.forEach(function (t) { if (t.seriesId) (series[t.seriesId] = series[t.seriesId] || []).push(t); });
  let made = 0;
  Object.keys(series).forEach(function (sid) {
    const all = series[sid];                         // deleted copies count too, so a deleted day isn't remade
    const live = all.filter(function (t) { return !t.deleted; });
    const ruled = live.filter(function (t) { return t.repeat && t.repeat.mode === 'stack'; })
      .sort(function (a, b) { return b.updatedAt - a.updatedAt; });
    if (!ruled.length) return;                       // stopped, or every copy deleted
    const tpl = ruled[0];
    const r = tpl.repeat;
    const last = Math.max.apply(null, all.map(function (t) { return t.due === null ? 0 : midnight(t.due); }));
    const due = [];
    for (let d = rpNextAfter(r, last); d !== null && d <= today && due.length < 500; d = rpNextAfter(r, d)) due.push(d);
    const free = STACK_MAX - live.filter(function (t) { return !t.done; }).length;
    if (!due.length || free <= 0) return;            // full: paused until some are finished
    const mins = tpl.hasTime && tpl.due !== null ? Math.round((tpl.due - midnight(tpl.due)) / MIN) : 0;
    due.slice(-free).forEach(function (d) {          // only the latest days if many were missed
      const id = sid + '_' + dayKey(d);
      if (findTask(id)) return;
      state.tasks.push(newTask(tpl.title, tpl.q, {
        id: id, due: d + mins * MIN, hasTime: tpl.hasTime, tags: tpl.tags.slice(), notes: tpl.notes, repeat: r, seriesId: sid,
        subtasks: tpl.subtasks.map(function (s) { return { id: uid(), title: s.title, done: false }; })
      }));
      made++;
    });
  });
  if (made) save();
  return made;
}

// ---------- the stack panel ----------
function stackSheetHTML(sid) {
  const list = openStackCopies(sid);
  const head = list[0] || findTask(sid);
  if (!head) return '<h3>Stack</h3><p class="small">Nothing left here.</p><div class="row"><button class="btn" data-action="close">Done</button></div>';
  // "Coming up" starts after the newest copy that already exists
  const last = Math.max.apply(null, state.tasks.filter(function (t) { return t.seriesId === sid && t.due !== null; }).map(function (t) { return midnight(t.due); }));
  const upcoming = head.repeat ? rpNextAfter(head.repeat, last) : null;
  return '<h3 class="stack-title">' + STACK_SVG + esc(head.title) + ' <span class="count">' + list.length + ' stacked</span></h3>' +
    (head.repeat ? '<div class="rp-explain">' + describeRepeat(head.repeat, upcoming) + '</div>' : '') +
    (list.length >= STACK_MAX ? '<p class="note stack-full">Max ' + STACK_MAX + ' copies of the same task can stack up. No new copies until you finish some of these.</p>' : '') +
    '<ul class="tasks list">' + (list.map(function (t) { return taskHTML(t, { nostack: true }); }).join('') || '<li class="empty">All done. Nice.</li>') + '</ul>' +
    '<div class="row"><button class="btn" data-action="close">Done</button></div>';
}
function refreshStackSheet() { if (sheetCtx && sheetCtx.type === 'stack') refreshSheet(stackSheetHTML(sheetCtx.id)); }

// ---------- the Repeat picker (task details and the add pop-up) ----------
const RP_PRESETS = [['none', 'None'], ['daily', 'Daily'], ['weekdays', 'Weekdays'], ['weekly', 'Weekly'], ['monthly', 'Monthly'], ['custom', 'Custom']];
function rpPresetOf(r) {
  if (!r) return 'none';
  if (r.mode !== 'after' && !r.until && (r.every || 1) === 1) {
    if (r.unit === 'day') return 'daily';
    if (r.unit === 'week' && r.days.slice().sort().join() === '1,2,3,4,5') return 'weekdays';
    if (r.unit === 'week' && r.days.length === 1 && r.days[0] === new Date(r.start).getDay()) return 'weekly';
    if (r.unit === 'month' && r.monthBy === 'date' && r.monthDay === new Date(r.start).getDate()) return 'monthly';
  }
  return 'custom';
}
// The rule being edited right now, filled in: the add pop-up's draft, or the open task's rule.
function rpContext() {
  if (!sheetCtx) return null;
  if (sheetCtx.type === 'add') return { kind: 'add', rule: addDraft.repeat ? rpNorm(addDraft.repeat, addDraft.date !== null ? addDraft.date : midnight(now())) : null };
  if (sheetCtx.type === 'task') { const t = sheetTask(); return t ? { kind: 'task', task: t, rule: t.repeat } : null; }
  return null;
}
function rpSet(rule) {
  const c = rpContext();
  if (!c) return;
  if (c.kind === 'add') { addDraft.repeat = rule; refreshAddSheet(); return; }
  snapshot('Changed repeat');
  applyTaskRepeat(c.task, rule);
  taskChanged(c.task);
  refreshTaskSheet();
}
function rpChange(edit) {             // edit a copy of the current rule
  const c = rpContext();
  if (!c || !c.rule) return;
  const r = JSON.parse(JSON.stringify(c.rule));
  edit(r);
  rpSet(r);
}
function repeatEditorHTML(r, from) {
  const preset = rpPresetOf(r);
  let h = '<div class="daterow">' + RP_PRESETS.map(function (p) {
    return '<button type="button" class="pick' + (preset === p[0] ? ' on' : '') + '" data-action="rppreset" data-p="' + p[0] + '">' + p[1] + '</button>';
  }).join('') + '</div>';
  if (!r) return h;
  const modes = [['fixed', 'On a schedule', 'Fixed dates, done or not'], ['after', 'After I finish', 'Counts from the day you complete it'], ['stack', 'Stack up', 'A new copy each time, even if unfinished (max ' + STACK_MAX + ')']];
  h += '<div class="rp-modes">' + modes.map(function (m) {
    return '<button type="button" class="rp-mode' + (r.mode === m[0] ? ' on' : '') + '" data-action="rpmode" data-m="' + m[0] + '"><b>' + m[1] + '</b><span>' + m[2] + '</span></button>';
  }).join('') + '</div>';
  h += '<div class="rp-every"><span>Every</span><input type="number" id="rpEvery" min="1" max="99" value="' + r.every + '" aria-label="How many"><div class="seg">' +
    ['day', 'week', 'month', 'year'].map(function (u) {
      return '<button type="button" class="' + (r.unit === u ? 'on' : '') + '" data-action="rpunit" data-u="' + u + '">' + u + (r.every > 1 ? 's' : '') + '</button>';
    }).join('') + '</div></div>';
  if (r.mode !== 'after' && r.unit === 'week') {
    h += '<div class="daterow rp-days">' + [1, 2, 3, 4, 5, 6, 0].map(function (d) {
      return '<button type="button" class="pick' + (r.days.indexOf(d) !== -1 ? ' on' : '') + '" data-action="rpday" data-d="' + d + '">' + RP_WD_NAMES[d] + '</button>';
    }).join('') + '</div>';
  }
  if (r.mode !== 'after' && r.unit === 'month') {
    h += '<div class="seg rp-by">' + [['date', 'On a date'], ['nth', 'On a weekday'], ['workday', 'Working day']].map(function (b) {
      return '<button type="button" class="' + (r.monthBy === b[0] ? 'on' : '') + '" data-action="rpby" data-b="' + b[0] + '">' + b[1] + '</button>';
    }).join('') + '</div>';
    if (r.monthBy === 'nth') {
      h += '<div class="daterow">' + [1, 2, 3, 4, -1].map(function (n) {
        return '<button type="button" class="pick' + (r.nth === n ? ' on' : '') + '" data-action="rpnth" data-n="' + n + '">' + (n === -1 ? 'Last' : rpOrdinal(n)) + '</button>';
      }).join('') + '</div><div class="daterow rp-days">' + [1, 2, 3, 4, 5, 6, 0].map(function (d) {
        return '<button type="button" class="pick' + (r.wd === d ? ' on' : '') + '" data-action="rpwd" data-d="' + d + '">' + RP_WD_NAMES[d] + '</button>';
      }).join('') + '</div>';
    } else if (r.monthBy === 'workday') {
      h += '<div class="daterow">' + [[1, 'First working day'], [-1, 'Last working day']].map(function (w) {
        return '<button type="button" class="pick' + (r.nth === w[0] ? ' on' : '') + '" data-action="rpnth" data-n="' + w[0] + '">' + w[1] + '</button>';
      }).join('') + '</div>';
    } else {
      h += '<div class="daterow rp-every"><span>Day</span><input type="number" id="rpMonthDay" min="1" max="31" value="' + (r.monthDay > 0 ? r.monthDay : '') + '" aria-label="Day of the month">' +
        '<button type="button" class="pick' + (r.monthDay === -1 ? ' on' : '') + '" data-action="rplastday">Last day</button></div>';
    }
  }
  h += '<div class="daterow rp-every"><span>Ends</span><button type="button" class="pick' + (!r.until ? ' on' : '') + '" data-action="rpnoend">Never</button>' +
    '<input type="date" id="rpUntil" value="' + (r.until ? dayKey(r.until) : '') + '" aria-label="Last date"></div>';
  h += '<div class="rp-explain">' + describeRepeat(r, from) + '</div>';
  return h;
}

actions.rppreset = function (el) {
  const c = rpContext();
  if (!c) return;
  const p = el.dataset.p;
  const mode = c.rule ? c.rule.mode : 'fixed';
  const startDay = c.kind === 'add' ? (addDraft.date !== null ? addDraft.date : midnight(now())) : (c.task.due !== null ? midnight(c.task.due) : midnight(now()));
  const sd = new Date(startDay);
  if (p === 'none') { rpSet(null); return; }
  if (p === 'daily') rpSet({ unit: 'day', every: 1, mode: mode });
  else if (p === 'weekdays') rpSet({ unit: 'week', every: 1, days: [1, 2, 3, 4, 5], mode: mode === 'after' ? 'fixed' : mode });
  else if (p === 'weekly') rpSet({ unit: 'week', every: 1, days: [sd.getDay()], mode: mode });
  else if (p === 'monthly') rpSet({ unit: 'month', every: 1, monthBy: 'date', monthDay: sd.getDate(), mode: mode });
  else rpSet(c.rule ? Object.assign({}, c.rule, { every: Math.max(2, c.rule.every) }) : { unit: 'day', every: 2, mode: mode });
};
actions.rpmode = function (el) { rpChange(function (r) { r.mode = el.dataset.m; }); };
actions.rpunit = function (el) {
  rpChange(function (r) {
    r.unit = el.dataset.u;
    const sd = new Date(r.start);
    if (r.unit === 'week' && !r.days.length) r.days = [sd.getDay()];
    if (r.unit === 'month' && !r.monthDay) { r.monthBy = 'date'; r.monthDay = sd.getDate(); }
  });
};
actions.rpday = function (el) {
  rpChange(function (r) {
    const d = Number(el.dataset.d), i = r.days.indexOf(d);
    if (i === -1) r.days.push(d); else if (r.days.length > 1) r.days.splice(i, 1);   // keep at least one day
  });
};
actions.rpby = function (el) {
  rpChange(function (r) {
    r.monthBy = el.dataset.b;
    const sd = new Date(r.start);
    if (r.monthBy === 'nth') { r.nth = Math.min(4, Math.ceil(sd.getDate() / 7)); r.wd = sd.getDay(); }
    if (r.monthBy === 'workday') r.nth = 1;
    if (r.monthBy === 'date' && !r.monthDay) r.monthDay = sd.getDate();
  });
};
actions.rpnth = function (el) { rpChange(function (r) { r.nth = Number(el.dataset.n); }); };
actions.rpwd = function (el) { rpChange(function (r) { r.wd = Number(el.dataset.d); }); };
actions.rplastday = function () { rpChange(function (r) { r.monthDay = -1; }); };
actions.rpnoend = function () { rpChange(function (r) { r.until = null; }); };
actions.rpskip = function () { const t = sheetTask(); if (t && repeatsInPlace(t)) { completeRepeating(t, false, true); refreshTaskSheet(); } };
actions.stackopen = function (el) { openSheet({ type: 'stack', id: el.dataset.id }, stackSheetHTML(el.dataset.id)); };
$('sheet').addEventListener('change', function (e) {
  const id = e.target.id;
  if (id !== 'rpEvery' && id !== 'rpMonthDay' && id !== 'rpUntil') return;
  const v = e.target.value;
  rpChange(function (r) {
    if (id === 'rpEvery') r.every = Math.max(1, Math.min(99, Math.round(Number(v)) || 1));
    if (id === 'rpMonthDay') r.monthDay = Math.max(1, Math.min(31, Math.round(Number(v)) || 1));
    if (id === 'rpUntil') r.until = v ? new Date(v + 'T00:00').getTime() : null;
  });
});

// ---------- after adding: say plainly when it comes back ----------
function explainNewRepeat(t) {
  if (!t.repeat || state.ui.repeatExplainOff) return;
  openSheet({ type: 'rpexplain' }, '<h3 class="stack-title">' + REPEAT_SVG + esc(shortTitle(t.title)) + ' added</h3>' +
    '<div class="rp-explain">' + describeRepeat(t.repeat, t.due) + '</div>' +
    '<label class="rp-dont"><input type="checkbox" id="rpDont"> Don\'t explain repeating tasks again</label>' +
    '<div class="row"><button class="btn primary" data-action="rpgotit">Got it</button></div>');
}
actions.rpgotit = function () {
  if ($('rpDont') && $('rpDont').checked) { state.ui.repeatExplainOff = true; save(); }
  closeSheet();
};

// make new stack copies when a day turns over or the app comes back on screen
setInterval(function () { if (runStacks()) renderTaskViews(); }, 60000);
document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible' && runStacks()) renderTaskViews(); });
