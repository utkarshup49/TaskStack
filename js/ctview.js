/* =========================================================
   ColorTracker Stats page and the day card.
   - A "Paint | Stats" switch at the top of ColorTracker. Stats has
     tabs (Overview, Sleep, Productive, Waste, Workout & more,
     Patterns) and a range (7 / 30 / 90 days / all, or a Period).
     The phone's back button goes from Stats back to Paint; the
     address is #colortracker/stats/<tab>, so a refresh stays put.
   - The day card above the grid: today's ring, Sleep / Productive /
     Wasted, how it compares with your normal, how much is logged,
     your logging streak and the insight of the day. Tap it for Stats.
   - Insights unlock as you log more days (1 / 3 / 7 / 14 / 30 / 90).
   - Every number has a "how is this worked out" note.
   - Weekly report, monthly / yearly Wrapped (with an image to save)
     and Year in pixels open as sheets.
   ========================================================= */

let ctPage = 'paint';            // 'paint' | 'stats'
let ctTab = 'overview';
let ctStatsKey = '';             // what the stats page was last drawn from (skip needless redraws)
let ctStatsAt = 0;
const CT_TABS = [['overview', 'Overview'], ['sleep', 'Sleep'], ['productive', 'Productive'], ['waste', 'Waste'], ['more', 'Workout & more'], ['patterns', 'Patterns']];
const UNLOCKS = [[1, 'Day ring and totals'], [3, 'Averages and "vs your normal"'], [7, 'Weekly report, sleep regularity, golden and danger hours'],
  [14, 'Weekday patterns, typical day'], [30, 'Links between days, chronotype, records'], [90, 'Long-term trends and yearly projection']];
const DOW_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ---------- range ----------
function ctRange() {
  const r = state.ui.ctRange || '30';
  const today = midnight(now());
  const p = r.indexOf('p:') === 0 ? livePeriods().find(function (x) { return x.id === r.slice(2); }) : null;
  if (p) return { from: new Date(p.start + 'T00:00').getTime(), to: addDays(new Date(p.end + 'T00:00').getTime(), 1), label: p.name, period: p };
  if (r === 'all') {
    const first = liveRanges().reduce(function (m, x) { return Math.min(m, x.start); }, now());
    return { from: midnight(first), to: addDays(today, 1), label: 'All time' };
  }
  const n = Number(r) || 30;
  return { from: addDays(today, -(n - 1)), to: addDays(today, 1), label: 'Last ' + n + ' days' };
}
function livePeriods() { return (state.periods || []).filter(function (p) { return !p.deleted; }).sort(function (a, b) { return a.start < b.start ? 1 : -1; }); }

// ---------- small HTML builders ----------
function how(text) { return '<details class="how"><summary aria-label="How is this worked out?">i</summary><p>' + text + '</p></details>'; }
function tile(label, value, sub, explain, cls) {
  return '<div class="st-tile' + (cls ? ' ' + cls : '') + '"><span class="st-l">' + label + (explain ? how(explain) : '') + '</span><b>' + value + '</b>' + (sub ? '<small>' + sub + '</small>' : '') + '</div>';
}
function card(title, inner, extra) { return '<section class="st-card' + (extra ? ' ' + extra : '') + '"><h3>' + title + '</h3>' + inner + '</section>'; }
function locked(level, have, what) {
  return '<div class="st-lock"><b>🔒 ' + what + '</b><span>Unlocks after ' + level + ' logged days. You have ' + have + '. ' + (level - have) + ' to go.</span>' +
    '<i style="--p:' + Math.min(1, have / level).toFixed(2) + '"></i></div>';
}
function arrow(diff, goodIsUp) {
  if (diff === null || diff === undefined || Math.abs(diff) < 5) return '<span class="arr flat">→</span>';
  const up = diff > 0;
  return '<span class="arr ' + (up === goodIsUp ? 'good' : 'bad') + '">' + (up ? '↑' : '↓') + ' ' + fmtMins(Math.abs(diff)) + '</span>';
}
function kindDot(k) { return '<i class="kd" style="background:' + kindInfo(k).color + '"></i>'; }
function hourName(h) { return fmtTime(midnight(now()) + ((h % 24) + 24) % 24 * HOUR).replace(':00', ''); }

// 24 h ring for one calendar day, painted in each activity's own colour.
function ringSVG24(dayStart, size) {
  const segs = ctSegs(dayStart, Math.min(addDays(dayStart, 1), now()));
  const r = 42, c = 2 * Math.PI * r;
  let arcs = '';
  segs.forEach(function (s) {
    const a = (s.start - dayStart) / DAY, b = (s.end - dayStart) / DAY;
    arcs += '<circle r="' + r + '" cx="50" cy="50" stroke="' + catColor(s.cat) + '" stroke-dasharray="' + ((b - a) * c).toFixed(2) + ' ' + c.toFixed(2) + '" stroke-dashoffset="' + (-a * c).toFixed(2) + '"/>';
  });
  const nowA = (now() - dayStart) / DAY;
  const hand = nowA > 0 && nowA < 1 ? '<line x1="50" y1="50" x2="' + (50 + 46 * Math.sin(nowA * 2 * Math.PI)).toFixed(1) + '" y2="' + (50 - 46 * Math.cos(nowA * 2 * Math.PI)).toFixed(1) + '" class="ring-now"/>' : '';
  return '<svg class="ring24" viewBox="0 0 100 100" width="' + (size || 96) + '" height="' + (size || 96) + '"><circle r="' + r + '" cx="50" cy="50" class="ring-bg"/><g transform="rotate(-90 50 50)">' + arcs + '</g>' + hand +
    '<text x="50" y="13" class="ring-t">12a</text><text x="91" y="53" class="ring-t">6a</text><text x="50" y="94" class="ring-t">12p</text><text x="9" y="53" class="ring-t">6p</text></svg>';
}

// ---------- insights ----------
// Every insight: { id, area, text, why, tip, min (logged days needed) }.
function ctInsights(R) {
  const L = R.allDaysLogged;
  const S = R.sleep, P = R.prod, W = R.waste, O = R.other;
  const out = [];
  function add(id, area, min, text, why, tip) { if (L >= min && text) out.push({ id: id, area: area, text: text, why: why, tip: tip }); }
  if (S.count) {
    const need = sleepNeed();
    add('sleep-avg', 'sleep', 3, 'You sleep ' + fmtMins(S.avg) + ' a night on average' + (S.avg < need ? ', ' + fmtMins(need - S.avg) + ' under your ' + fmtMins(need) + ' need.' : '. That covers your need.'),
      S.count + ' nights in this range.', S.avg < need ? 'Try going to bed 20 minutes earlier for a week.' : 'Keep the same bedtime to hold on to it.');
    if (S.longest && S.shortest && S.count >= 3) add('sleep-range', 'sleep', 3, 'Your nights range from ' + fmtMins(S.shortest.asleep) + ' (' + ctDate(S.shortest.end) + ') to ' + fmtMins(S.longest.asleep) + ' (' + ctDate(S.longest.end) + ').',
      'Shortest and longest night in this range.', 'Steady nights beat a big catch-up sleep.');
    if (S.bedSd !== null && S.count >= 5) add('bed-sd', 'sleep', 7, 'Your bedtime moves by about ±' + fmtMins(S.bedSd) + ' from night to night.',
      'Standard deviation of your bedtimes.', S.bedSd > 60 ? 'Pick a "lights out" time and keep it within 30 minutes.' : 'That\'s a steady rhythm. Nice.');
    if (S.sri !== null) add('sri', 'sleep', 7, 'Sleep regularity: ' + S.sri + '/100. ' + (S.sri >= 85 ? 'Very regular.' : S.sri >= 75 ? 'Fairly regular.' : 'Quite irregular.'),
      'The chance you\'re in the same state (asleep or awake) at the same clock time 24 hours later.', 'Waking up at the same time every day helps most.');
    if (S.jetlag !== null && S.jetlag >= 60) add('jetlag', 'sleep', 7, 'Your free days shift your sleep by ' + fmtMins(S.jetlag) + ', like flying ' + Math.round(S.jetlag / 60) + ' time zones every weekend.',
      'Difference in mid-sleep time between free days and other days.', 'Keep weekend wake-ups within an hour of weekdays.');
    if (S.debt >= 120) add('debt', 'sleep', 3, 'Sleep debt this week: ' + fmtMins(S.debt) + '.', 'Your need × nights − what you slept (naps count).', 'Two nights of +45 minutes would clear most of it.');
    if (S.naps && S.naps.length >= 2) add('naps', 'sleep', 7, S.naps.length + ' naps, ' + fmtMins(S.napAvg) + ' on average, usually around ' + fmtClockMins(S.napAt) + '.',
      S.napCatchUp + ' of them came after a short night.', S.napBedEffect !== null && S.napBedEffect > 20 ? 'Long naps push your bedtime ' + fmtMins(S.napBedEffect) + ' later. Keep naps under 30 minutes.' : 'Short naps before 4 pm work best.');
    if (S.chronotype) add('chrono', 'sleep', 30, 'You look like ' + (S.chronotype === 'In between' ? 'an in-between type' : 'a ' + S.chronotype.toLowerCase()) + ' (mid-sleep around ' + fmtClockMins(S.chronoMid) + ').',
      'Based on the middle of your sleep, on free days when possible.', 'Put your hardest work in your golden hours, not against your clock.');
  }
  if (R.heatProd.best) add('golden', 'productive', 7, 'Your golden hours: ' + hourName(R.heatProd.best.from) + '–' + hourName(R.heatProd.best.to) + '. That\'s when you get the most done.',
    'The 2-hour window with the most productive time, averaged over the days in range.', 'Protect this window: phone in another room.');
  if (R.heatWaste.best && R.avg.waste >= 20) add('danger', 'waste', 7, 'Danger zone: ' + hourName(R.heatWaste.best.from) + '–' + hourName(R.heatWaste.best.to) + ' is when most time gets wasted.',
    'The 2-hour window with the most wasted time.', 'Plan something specific for that slot, even a walk.');
  if (W.triggers.length) add('trigger', 'waste', 7, W.triggers[0].pct + '% of wasted stretches start right after ' + catName(W.triggers[0].cat) + '.',
    'What was painted just before each waste block.', 'After ' + catName(W.triggers[0].cat) + ', start a 5-minute "next thing" before the phone.');
  if (W.afterRisk && W.afterRisk.pct >= 30) add('afterrisk', 'waste', 7, 'After ' + catName(W.afterRisk.cat) + ', you slip into wasted time ' + W.afterRisk.pct + '% of the time within 20 minutes.',
    W.afterRisk.n + ' times you did ' + catName(W.afterRisk.cat) + '.', 'Decide the next activity before ' + catName(W.afterRisk.cat) + ' ends.');
  if (W.avgRun) add('run', 'waste', 3, 'A "quick" wasted stretch lasts ' + fmtMins(W.avgRun) + ' on average.', W.runs + ' stretches in this range.', 'Set a 10-minute timer when you open a feed.');
  if (R.avg.waste >= 30) add('cost', 'waste', 90, 'At this pace, wasted time adds up to ' + Math.round(W.perYearDays) + ' full days a year.', fmtMins(R.avg.waste) + ' a day × 365.', 'Halving it gives back ' + Math.round(W.perYearDays / 2) + ' days.');
  if (P.startEffect) add('start', 'productive', 14, 'Days you start work by ' + fmtClockMins(P.startEffect.cut) + ' give ' + fmtMins(P.startEffect.early) + ' of productive time, vs ' + fmtMins(P.startEffect.late) + ' when you start later.',
    'Days split by when the first productive block began.', 'Do one small task within an hour of waking.');
  if (P.longest) add('deep', 'productive', 3, 'Your longest deep-work stretch: ' + fmtDur(P.longest.end - P.longest.start) + ' on ' + ctDate(P.longest.start) + '.', 'Productive time with no break over 5 minutes.', 'Aim for one 50-minute block a day.');
  if (P.bestDow && P.worstDow) add('dow', 'productive', 14, DOW_NAMES[P.bestDow.dow] + ' is your most productive day (' + fmtMins(P.bestDow.prod) + '), ' + DOW_NAMES[P.worstDow.dow] + ' the least (' + fmtMins(P.worstDow.prod) + ').',
    'Average productive time per weekday.', 'Plan lighter work for ' + DOW_NAMES[P.worstDow.dow] + 's, or protect a block there.');
  if (O.workSleep !== null && Math.abs(O.workSleep) >= 15) add('worksleep', 'workout', 30, 'On workout days you sleep ' + fmtMins(Math.abs(O.workSleep)) + (O.workSleep > 0 ? ' more' : ' less') + ' that night.', 'Nights after days with 20+ min of workout vs other nights.', 'Earlier workouts usually help sleep more.');
  if (O.socialLast14 < 60 && R.allDaysLogged >= 14) add('social', 'more', 14, 'Under an hour with people in the last 2 weeks.', 'Social time painted in the last 14 days.', 'Call a friend today, even for 10 minutes.');
  R.links.slice(0, 3).forEach(function (l) {
    add('link-' + l.id, 'patterns', 30, 'When ' + l.x + ' is ' + l.above + ' ' + l.cut + ', ' + l.y + ' averages ' + l.hi + ' (vs ' + l.lo + ').',
      'Based on ' + l.n + ' days (link strength ' + Math.abs(l.r).toFixed(2) + '). A link isn\'t proof of a cause.', '');
  });
  if (R.recipe && R.recipe.lines.length) add('recipe', 'patterns', 14, 'Your best days: ' + R.recipe.lines[0].toLowerCase() + '.', 'Your top ' + R.recipe.n + ' days by Day score vs the rest.', 'Copy that tomorrow.');
  if (R.unusual) add('unusual', 'patterns', 14, 'Yesterday was unusual: ' + fmtMins(R.unusual.val) + ' of ' + kindInfo(R.unusual.kind).name.toLowerCase() + ' (usually ' + fmtMins(R.unusual.usual) + ').', 'Compared with the 30 days before.', '');
  if (R.routine !== null) add('routine', 'more', 14, 'Routine score: ' + R.routine + '%. That\'s how much a day looks like your typical day.', 'Share of 15-minute slots that match your typical day.', R.routine < 50 ? 'A fixed wake-up time is the easiest anchor.' : 'A solid routine. Your habits have a home.');
  return out;
}
// 2 + 64: three insights a day, rotating, never the same one twice in a week.
function todaysInsights(R, count) {
  const all = ctInsights(R);
  if (!all.length) return [];
  const seen = state.ui.ctSeen || {};
  const today = dayKey();
  const week = dayKey(addDays(midnight(now()), -7));
  const fresh = all.filter(function (x) { return !seen[x.id] || seen[x.id] === today || seen[x.id] < week; });
  const pool = fresh.length >= count ? fresh : all;
  let seed = 0;
  for (let i = 0; i < today.length; i++) seed += today.charCodeAt(i) * (i + 1);
  const picked = [];
  // insights already shown today come first, so the list doesn't change on every redraw
  pool.filter(function (x) { return seen[x.id] === today; }).forEach(function (x) { if (picked.length < count) picked.push(x); });
  for (let i = 0; picked.length < Math.min(count, pool.length) && i < pool.length * 2; i++) {
    const x = pool[(seed + i * 7) % pool.length];
    if (picked.indexOf(x) === -1) picked.push(x);
  }
  picked.forEach(function (x) { seen[x.id] = today; });
  for (const k in seen) if (seen[k] < week) delete seen[k];
  state.ui.ctSeen = seen;
  return picked;
}
function insightHTML(x) {
  return '<li class="ins ins-' + x.area + '"><p>' + esc(x.text) + '</p><details><summary>Why · try this</summary><p class="small">' + esc(x.why) + '</p>' +
    (x.tip ? '<p class="small"><b>Try:</b> ' + esc(x.tip) + '</p>' : '') + '</details></li>';
}

// ---------- the day card above the grid ----------
function dayCardHTML() {
  const d = ctDay;
  const dayStart = midnight(d.label);
  const isToday = dayStart === midnight(now());
  const segs = ctSegs(dayStart, Math.min(addDays(dayStart, 1), now()));
  const mins = { sleep: 0, productive: 0, waste: 0 };
  let logged = 0;
  segs.forEach(function (s) { const m = (s.end - s.start) / MIN; logged += m; if (mins[s.kind] !== undefined) mins[s.kind] += m; });
  const span = Math.max(1, (Math.min(addDays(dayStart, 1), now()) - dayStart) / MIN);
  const cover = Math.round(Math.min(1, logged / span) * 100);
  const L = countLoggedDays();
  // "vs your normal": the same numbers on the last 30 days, per day so far
  let vs = '';
  if (L >= 3) {
    const past = buildDays(addDays(dayStart, -30), dayStart).filter(function (x) { return x.valid; });
    if (past.length >= 3) {
      const frac = isToday ? span / 1440 : 1;
      const p = mean(past.map(function (x) { return x.mins.productive; })) * frac;
      const w = mean(past.map(function (x) { return x.mins.waste; })) * frac;
      const bits = [];
      if (Math.abs(mins.productive - p) >= 20) bits.push(fmtMins(Math.abs(mins.productive - p)) + (mins.productive > p ? ' more' : ' less') + ' productive');
      if (Math.abs(mins.waste - w) >= 20) bits.push(fmtMins(Math.abs(mins.waste - w)) + (mins.waste > w ? ' more' : ' less') + ' wasted');
      vs = bits.length ? bits.join(', ') + ' than your usual ' + (isToday ? 'by this time' : 'day') + '.' : 'Right on your usual pace.';
    }
  }
  const streak = loggingStreak();
  const ins = L >= 3 ? todaysInsights(ctStatsCached(), 1)[0] : null;
  const gaps = gapsIn(d.start, Math.min(d.end || now(), now())).filter(function (g) { return g.end - g.start >= 10 * MIN; });
  const live = state.ui.ctLive;
  return '<button class="dc-main" data-action="ctpage" data-p="stats" aria-label="Open stats">' + ringSVG24(dayStart, 92) +
    '<div class="dc-nums">' +
      '<span>' + kindDot('sleep') + 'Sleep <b>' + fmtMins(mins.sleep) + '</b></span>' +
      '<span>' + kindDot('productive') + 'Productive <b>' + fmtMins(mins.productive) + '</b></span>' +
      '<span>' + kindDot('waste') + 'Wasted <b>' + fmtMins(mins.waste) + '</b></span>' +
      (vs ? '<em>' + esc(vs) + '</em>' : '<em>' + (L < 3 ? 'Log ' + (3 - L) + ' more day' + (3 - L === 1 ? '' : 's') + ' to compare with your normal.' : '') + '</em>') +
    '</div></button>' +
    '<div class="dc-meta"><span class="dc-cover"><i style="--p:' + (cover / 100).toFixed(2) + '"></i>' + cover + '% logged</span>' +
      (streak ? '<span>🔥 ' + streak + '-day logging streak</span>' : '') +
      (gaps.length ? '<button class="linkbtn" data-action="ctgaps">' + gaps.length + (gaps.length === 1 ? ' gap' : ' gaps') + ' · fill</button>' : '') + '</div>' +
    (ins ? '<p class="dc-ins">💡 ' + esc(ins.text) + '</p>' : '') +
    goalsMiniHTML(dayStart) +
    '<div class="dc-actions">' +
      (live ? '<span class="live-pill" style="--bc:' + catColor(live.cat) + '">● ' + esc(catName(live.cat)) + ' · ' + fmtDur(now() - live.start) + '</span>' +
        (isSleepCat(live.cat) ? '<button class="btn small primary" data-action="ctliveStop">I\'m up</button>' : '<button class="btn small" data-action="ctliveStart">Switch</button><button class="btn small primary" data-action="ctliveStop">Stop</button>')
        : '<button class="btn small" data-action="ctliveStart">▶ Now doing…</button><button class="btn small" data-action="ctsleepNow">🌙 Going to sleep</button>') +
      '<button class="btn small" data-action="ctdaymenu" aria-label="More">⋯</button>' +
    '</div>';
}
function loggingStreak() {
  let n = 0;
  for (let d = addDays(midnight(now()), -1); n < 1000; d = addDays(d, -1)) {
    const m = ctSegs(d, addDays(d, 1)).reduce(function (s, x) { return s + x.end - x.start; }, 0) / MIN;
    if (m >= 0.8 * 1440) n++; else break;
  }
  const today = ctSegs(midnight(now()), now()).reduce(function (s, x) { return s + x.end - x.start; }, 0);
  if (today >= 0.8 * (now() - midnight(now()))) n++;
  return n;
}
function renderDayCard() {
  const el = $('ctDayCard');
  if (!el || !ctDay) return;
  el.innerHTML = dayCardHTML();
  el.hidden = false;
  const side = $('ctSideStats');
  if (side) side.innerHTML = sideStatsHTML();
}
// Laptop: a small summary next to the grid while you paint.
function sideStatsHTML() {
  if (countLoggedDays() < 3) return '<h3>Stats</h3><p class="small">After 3 logged days you\'ll see your averages here.</p>';
  const R = ctStatsCached();
  return '<h3>Last 30 days</h3><ul class="side-stats">' +
    '<li>' + kindDot('sleep') + 'Sleep <b>' + (R.sleep.count ? fmtMins(R.sleep.avg) : '–') + '</b></li>' +
    '<li>' + kindDot('productive') + 'Productive <b>' + fmtMins(R.avg.productive) + '/day</b></li>' +
    '<li>' + kindDot('waste') + 'Wasted <b>' + fmtMins(R.avg.waste) + '/day</b></li>' +
    (R.heatProd.best ? '<li>⚡ Golden hours <b>' + hourName(R.heatProd.best.from) + '–' + hourName(R.heatProd.best.to) + '</b></li>' : '') +
    '</ul><button class="btn small" data-action="ctpage" data-p="stats">Open stats</button>';
}
// The 30-day report the day card and side panel use, kept for a minute.
let ctCache = null;
function ctStatsCached() {
  const key = ctDataKey() + '|30';
  if (ctCache && ctCache.key === key && now() - ctCache.at < 60000) return ctCache.R;
  const today = midnight(now());
  const R = ctStats(addDays(today, -29), addDays(today, 1));
  ctCache = { key: key, at: now(), R: R };
  return R;
}
function ctDataKey() {
  let k = state.ranges.length + ':' + state.categories.length;
  let m = 0;
  state.ranges.forEach(function (r) { if (r.updatedAt > m) m = r.updatedAt; });
  state.categories.forEach(function (c) { if (c.updatedAt > m) m = c.updatedAt; });
  return k + ':' + m + ':' + (state.settings.updatedAt || 0) + ':' + (state.days || []).length;
}

// ---------- page switch ----------
function applyCtPage() {
  const stats = ctPage === 'stats';
  $('ctPaintWrap').hidden = stats;
  $('ctStats').hidden = !stats;
  document.querySelectorAll('[data-action="ctpage"][data-seg]').forEach(function (b) {
    b.classList.toggle('on', b.dataset.p === ctPage);
    b.setAttribute('aria-pressed', b.dataset.p === ctPage);
  });
}
function setCtPage(p, tab) {
  if (tab) ctTab = tab;
  if (p === ctPage && !tab) return;
  const wasStats = ctPage === 'stats';
  ctPage = p;
  if (p === 'stats' && !wasStats) { try { history.pushState({ overlay: 'ctstats' }, '', '#colortracker/stats/' + ctTab); } catch (e) {} }
  else if (p === 'stats') { try { history.replaceState(history.state, '', '#colortracker/stats/' + ctTab); } catch (e) {} }
  if (p === 'paint' && wasStats && history.state && history.state.overlay === 'ctstats') { ignorePop++; history.back(); }
  renderColor();
  $('main').scrollTop = 0;
  // the first time, check how activities were sorted into kinds
  if (p === 'stats' && !state.settings.ctKindsReviewed && liveCats().length) setTimeout(function () { if (!sheetCtx) actions.kindreview(); }, 350);
}
window.addEventListener('popstate', function () {
  if (ctPage === 'stats' && !(history.state && history.state.overlay === 'ctstats') && !sheetCtx) {
    ctPage = 'paint';
    if (view === 'colortracker') renderColor();
  }
});
actions.ctpage = function (el) { setCtPage(el.dataset.p, el.dataset.tab); };
actions.cttab = function (el) { ctTab = el.dataset.t; try { history.replaceState(history.state, '', '#colortracker/stats/' + ctTab); } catch (e) {} renderCtStats(true); $('main').scrollTop = 0; };
actions.ctrange = function (el) { state.ui.ctRange = el.dataset.r; save(); renderCtStats(true); };
// Opened from the address (#colortracker/stats/sleep) on start-up.
function openCtStatsFromHash(tab) {
  ctPage = 'stats';
  if (CT_TABS.some(function (t) { return t[0] === tab; })) ctTab = tab;
}
// Paint view draws as before, plus the day card; the Stats view draws the stats.
const ctBaseRender = renderColor;
renderColor = function () {
  applyCtPage();
  if (ctPage === 'stats') { renderCtStats(false); return; }
  ctBaseRender();
  renderLiveOverlay();
  renderDayCard();
};

// ---------- the Stats page ----------
function renderCtStats(force) {
  const range = ctRange();
  const key = ctDataKey() + '|' + (state.ui.ctRange || '30') + '|' + ctTab;
  if (!force && key === ctStatsKey && now() - ctStatsAt < 5 * 60000) return;
  ctStatsKey = key;
  ctStatsAt = now();
  const R = ctStats(range.from, range.to);
  const L = R.allDaysLogged;
  const ranges = [['7', '7 days'], ['30', '30 days'], ['90', '90 days'], ['all', 'All']].concat(livePeriods().map(function (p) { return ['p:' + p.id, p.name]; }));
  const cur = state.ui.ctRange || '30';
  let html = '<div class="st-ranges">' + ranges.map(function (r) {
    return '<button class="pick' + (cur === r[0] ? ' on' : '') + '" data-action="ctrange" data-r="' + r[0] + '">' + esc(r[1]) + '</button>';
  }).join('') + '<button class="pick" data-action="ctperiods">+ Period</button></div>' +
    '<nav class="st-tabs" role="tablist">' + CT_TABS.map(function (t) {
      return '<button role="tab" aria-selected="' + (ctTab === t[0]) + '" class="' + (ctTab === t[0] ? 'on' : '') + '" data-action="cttab" data-t="' + t[0] + '">' + t[1] + '</button>';
    }).join('') + '</nav>';
  const ask = needsKind();
  if (ask.length) html += '<p class="note">' + ask.length + ' activit' + (ask.length === 1 ? 'y needs' : 'ies need') + ' a kind (Productive, Leisure…) for the stats to be right. <button class="linkbtn" data-action="kindreview">Sort them</button></p>';
  if (!liveRanges().length) html += '<p class="note">Nothing painted yet. Paint a day on the Paint page and your stats start here.</p>';
  const tabs = { overview: statsOverview, sleep: statsSleep, productive: statsProductive, waste: statsWaste, more: statsMore, patterns: statsPatterns };
  html += '<div class="st-body">' + tabs[ctTab](R, L, range) + '</div>' +
    '<p class="small st-private">🔒 All of this is worked out on your device. Your time log stays on your devices and in your own Google Drive.</p>';
  $('ctStats').innerHTML = html;
  checkNewRecords(R);
  save();
}

function statsOverview(R, L, range) {
  let h = '';
  if (L < 3) h += card('Getting started', '<p>Paint a few full days and your stats grow. What unlocks:</p><ul class="unlocks">' + UNLOCKS.map(function (u) {
    return '<li class="' + (L >= u[0] ? 'on' : '') + '"><b>' + u[0] + (u[0] === 1 ? ' day' : ' days') + '</b>' + u[1] + '</li>';
  }).join('') + '</ul>');
  // scores
  const yd = R.days.find(function (d) { return d.key === dayKey(addDays(midnight(now()), -1)); });
  h += '<div class="st-tiles">' +
    tile('Day score', yd && yd.score !== undefined && yd.valid ? yd.score : '–', 'yesterday · avg ' + (R.dayScoreAvg === null ? '–' : R.dayScoreAvg),
      'Out of 100: sleep vs your need (30), productive time vs your goal (30, default 4h), wasted time within budget (20, default 1h), 20+ min workout (10), how much of the day is logged (10).') +
    tile('Sleep score', R.sleepScore === null ? '–' : R.sleepScore, R.sleep.count ? fmtMins(R.sleep.avg) + ' a night' : 'no nights yet',
      'Out of 100: average sleep vs your need (50), steady bedtimes (25: full marks when they vary less than a few minutes, none at ±2h), and low sleep debt this week (25).') +
    tile('Focus score', R.focusScore === null ? '–' : R.focusScore, R.prod.deepPerDay.toFixed(1) + ' deep blocks a day',
      'Out of 100: deep-work blocks of 50+ minutes (60, full marks at 2 a day) and few switches between activities (40).') +
    tile('Day value', R.valueAvg === null ? '–' : (R.valueAvg >= 0 ? '+' : '') + R.valueAvg.toFixed(1), 'points a day',
      'Each hour counts as its activity\'s value (−2 to +2, set per activity; 👍/👎 on a block nudges it by 1). Productive and Workout are +2, Time waste −2 by default.') +
  '</div>';
  // insights
  if (L >= 3) {
    const ins = todaysInsights(R, 3);
    if (ins.length) h += card('Today\'s insights', '<ul class="ins-list">' + ins.map(insightHTML).join('') + '</ul>');
  }
  // where the time goes
  if (L >= 1) {
    const prev = ctStats(addDays(range.from, -(Math.round((range.to - range.from) / DAY))), range.from);
    const awake = R.awakeAvg || 1;
    const kinds = KIND_IDS.concat(['unlogged']).filter(function (k) { return R.avg[k] >= 1; }).sort(function (a, b) { return R.avg[b] - R.avg[a]; });
    h += card('Where your time goes <small>(' + range.label + ', per day)</small>',
      '<div class="kbar">' + kinds.map(function (k) { return '<span style="flex:' + R.avg[k].toFixed(1) + ';background:' + kindInfo(k).color + '" title="' + kindInfo(k).name + '"></span>'; }).join('') + '</div>' +
      '<ul class="klist">' + kinds.map(function (k) {
        const diff = prev.n >= 3 && L >= 3 ? R.avg[k] - prev.avg[k] : null;
        return '<li>' + kindDot(k) + '<span>' + kindInfo(k).name + '</span><b>' + fmtMins(R.avg[k]) + '</b>' +
          '<small>' + (k !== 'sleep' && k !== 'unlogged' ? Math.round(R.avg[k] / awake * 100) + '% awake' : '') + '</small>' +
          (diff !== null && k !== 'unlogged' ? arrow(diff, k !== 'waste') : '') + '</li>';
      }).join('') + '</ul>' + how('Averages over ' + R.n + ' logged days (days at least half painted; today is left out until it\'s over). Arrows compare with the ' + range.label.toLowerCase() + ' before.'));
  }
  // 68: comparisons
  if (L >= 7) h += comparisonsHTML();
  else h += locked(7, L, 'This week vs last week vs your best');
  h += goalsCardHTML(R);
  h += idealCardHTML(R, L);
  h += challengesCardHTML();
  if (R.unusual) h += card('Unusual day', '<p>Yesterday: <b>' + fmtMins(R.unusual.val) + '</b> of ' + kindInfo(R.unusual.kind).name.toLowerCase() + '. You usually do ' + fmtMins(R.unusual.usual) + '.</p>');
  h += card('Reports', '<div class="st-btns">' +
    (L >= 7 ? '<button class="btn small" data-action="ctweekreport">📊 Weekly report</button>' : '') +
    '<button class="btn small" data-action="ctwrapped">🎁 Monthly Wrapped</button>' +
    '<button class="btn small" data-action="ctpixels">🟩 Year in pixels</button>' +
    '<button class="btn small" data-action="kindreview">🏷 How activities count</button>' +
    '<button class="btn small" data-action="ctexport">⬇ Export CSV</button>' +
    '<button class="btn small" data-action="ctposter">🖨 Print month</button></div>');
  return h;
}
function comparisonsHTML() {
  const ws = weekStart(now());
  const thisW = ctStats(ws, addDays(midnight(now()), 1));
  const lastW = ctStats(addDays(ws, -7), ws);
  const T = ctStatsCached().trends.weeks.filter(function (w) { return w.n >= 3 && w.start < ws; });
  const best = T.length ? T.reduce(function (a, b) { return b.productive / b.n > a.productive / a.n ? b : a; }) : null;
  function col(R, k) { return k === 'sleep' ? (R.sleep.count ? fmtMins(R.sleep.avg) : '–') : R.n ? fmtMins(R.avg[k]) : '–'; }
  const rows = [['sleep', 'Sleep / night', fmtMins(sleepNeed())], ['productive', 'Productive / day', fmtMins(ctGoalMins('productive', 'min', 240))],
    ['waste', 'Wasted / day', '≤ ' + fmtMins(ctGoalMins('waste', 'max', 60))], ['workout', 'Workout / day', '≈ 21–43m (150–300m a week)']];
  return card('This week vs …', '<table class="st-table"><thead><tr><th></th><th>This week</th><th>Last week</th><th>Best week</th><th>Aim</th></tr></thead><tbody>' +
    rows.map(function (r) {
      return '<tr><th>' + kindDot(r[0]) + r[1] + '</th><td>' + col(thisW, r[0]) + '</td><td>' + col(lastW, r[0]) + '</td><td>' +
        (best ? (r[0] === 'sleep' ? '–' : fmtMins(best[r[0]] / best.n)) : '–') + '</td><td>' + r[2] + '</td></tr>';
    }).join('') + '</tbody></table>' + how('Best week = the week with the most productive time per logged day, over the last 8 weeks. Aims: 7h+ sleep for adults (AASM), your own goals, and WHO\'s 150–300 minutes of activity a week.'));
}

function statsSleep(R, L) {
  const S = R.sleep;
  if (!S.count) return card('Sleep', '<p>No nights yet. Paint your sleep (from when you fell asleep to when you woke up) and it shows here.</p>');
  const need = sleepNeed();
  let h = '<div class="st-hero"><b>' + fmtMins(S.avg) + '</b><span>average sleep a night · ' + S.count + ' nights</span>' +
    '<p>' + (S.avg >= need ? 'Covers your ' + fmtMins(need) + ' need.' : fmtMins(need - S.avg) + ' under your ' + fmtMins(need) + ' need.') + '</p></div>';
  h += card('Each night', sleepScheduleChart(S.nights.slice(-30)) + how('Each bar runs from when you fell asleep to when you woke up. Dashed lines: your average bedtime and wake-up. Nights belong to the day you woke up.'));
  h += '<details class="st-more" open><summary>How long</summary><div class="st-tiles">' +
    tile('Longest', fmtMins(S.longest.asleep), ctDate(S.longest.end)) +
    tile('Shortest', fmtMins(S.shortest.asleep), ctDate(S.shortest.end)) +
    tile('Median', fmtMins(S.median), 'half the nights are longer', 'The middle value: less thrown by one very long or short night than the average.') +
    tile('7h or more', S.pct7 + '%', 'of nights') +
    tile('Under 6h', S.under6, S.under6 === 1 ? 'night' : 'nights') +
    tile('Over 9h', S.over9, S.over9 === 1 ? 'night' : 'nights') +
    tile('Swing', S.sd === null ? '–' : '±' + fmtMins(S.sd), 'night to night', 'How much your sleep length varies (standard deviation). Steady nights are better than 4h one night and 10h the next.') +
    tile('All-nighters', S.allNighters.length, S.allNighters.length ? ctDate(S.allNighters[S.allNighters.length - 1].from) : 'none', 'A stretch of 24 hours or more with no sleep at all, with most of it painted.') +
  '</div>' + durationHistogram(S.nights) + '</details>';
  h += '<details class="st-more" open><summary>When</summary><div class="st-tiles">' +
    tile('Bedtime', fmtClockMins(S.bed), 'earliest ' + fmtClockMins(S.bedEarliest) + ' · latest ' + fmtClockMins(S.bedLatest)) +
    tile('Wake-up', fmtClockMins(S.wake), 'earliest ' + fmtClockMins(S.wakeEarliest) + ' · latest ' + fmtClockMins(S.wakeLatest)) +
    tile('Bedtime steadiness', S.bedSd === null ? '–' : '±' + fmtMins(S.bedSd), S.bedSd !== null && S.bedSd <= 45 ? 'steady' : 'varies a lot', 'Standard deviation of bedtimes. Under 30–45 minutes is a steady rhythm.') +
    tile('Mid-sleep', fmtClockMins(S.mid), 'the middle of your sleep', 'Halfway between falling asleep and waking. It\'s the best single marker of your body clock.') +
    (L >= 7 ? tile('Regularity', S.sri === null ? '–' : S.sri + '/100', S.sri === null ? 'needs a few more days' : S.sri >= 85 ? 'very regular' : S.sri >= 75 ? 'fairly regular' : 'irregular',
      'Sleep Regularity: the chance that you\'re in the same state (asleep or awake) at two times exactly 24 hours apart, checked every 10 minutes. 90+ is very good. Research links regular sleep timing to better health, sometimes more than sleep length.') : '') +
    (L >= 7 ? tile('Social jetlag', S.jetlag === null ? '–' : fmtMins(S.jetlag), S.jetlag === null ? 'needs free days and other days' : S.jetlag >= 120 ? 'high' : S.jetlag >= 60 ? 'some' : 'low',
      'How far the middle of your sleep moves between free days (your days off in Settings) and other days. 2 hours or more is often flagged in research.') : '') +
    (L >= 30 ? tile('Chronotype', S.chronotype || '–', S.chronoMid ? 'mid-sleep ' + fmtClockMins(S.chronoMid) : '', 'From the middle of your sleep on free days: before 3:30 am early bird, 3:30–5:30 am in between, later night owl. A rough guide, not a test.') : '') +
  '</div>' + (L < 7 ? locked(7, L, 'Regularity score and social jetlag') : '') + (L >= 7 && L < 30 ? locked(30, L, 'Chronotype') : '') +
    weekdayWeekendHTML(S) + bedDriftChart(S.nights.slice(-30)) + '</details>';
  h += '<details class="st-more" open><summary>Sleep debt</summary>' +
    '<div class="stepper"><span>Your sleep need</span><button class="icon-btn sm" data-action="ctneed" data-d="-0.25" aria-label="Less">−</button><b>' + fmtMins(need) + '</b><button class="icon-btn sm" data-action="ctneed" data-d="0.25" aria-label="More">+</button></div>' +
    (S.restedNeed ? '<p class="small">From your "how rested" taps, you feel good after about <b>' + fmtMins(S.restedNeed) + '</b>' + (S.restedBed ? ' and a bedtime around ' + fmtClockMins(S.restedBed) : '') + '. <button class="linkbtn" data-action="ctneedset" data-m="' + Math.round(S.restedNeed) + '">Use it</button></p>' : '') +
    '<div class="debt"><div class="lb-track"><i style="width:' + Math.min(100, S.debt / 600 * 100).toFixed(1) + '%"></i></div><span>Sleep debt this week: <b>' + fmtMins(S.debt) + '</b> over ' + S.debtNights + ' nights</span></div>' +
    how('Your need × each of the last 7 nights, minus what you slept (naps count). Debt over 10 hours fills the bar.') + '</details>';
  h += '<details class="st-more"><summary>Naps and broken sleep</summary><div class="st-tiles">' +
    tile('Naps', S.naps.length, S.naps.length ? fmtMins(S.napTotal) + ' in total' : 'none in this range') +
    (S.naps.length ? tile('Usual nap', fmtMins(S.napAvg), 'around ' + fmtClockMins(S.napAt)) + tile('Catch-up naps', S.napCatchUp, 'after a short night', 'Naps on days after a night more than an hour under your need.') : '') +
    (S.napBedEffect !== null && S.napBedEffect !== undefined ? tile('Nap effect', fmtSigned(S.napBedEffect), 'on that night\'s bedtime', 'Bedtime on days with a 1h+ nap vs days without.') : '') +
    tile('Broken nights', S.broken, S.broken ? 'awake ' + fmtMins(S.brokenAwake) + ' in the middle' : 'none', 'Nights where you woke up and slept again (sleep blocks under an hour apart are one night).') +
  '</div><p class="small">Naps are sleeps shorter than ' + fmtHours(state.settings.napHours || 3.5) + ' (change it in ColorTracker Settings).</p></details>';
  h += '<details class="st-more"><summary>How rested do you feel?</summary>' + restedHTML() + '</details>';
  if (S.alerts.length) h += card('Heads-up', '<ul class="alerts">' + S.alerts.map(function (a) { return '<li>' + esc(a) + '</li>'; }).join('') + '</ul>');
  h += '<p class="small">Not medical advice. If sleep problems last for weeks, talk to a doctor.</p>';
  return h;
}
function restedHTML() {
  const k = dayKey();
  const d = dayEntry(k) || {};
  return '<p class="small">One tap each morning. After 5 taps TaskStack learns how much sleep you really need.</p><div class="moods">' +
    ['😫', '😐', '🙂', '😄'].map(function (m, i) {
      return '<button class="' + (d.rested === i + 1 ? 'on' : '') + '" data-action="ctrested" data-v="' + (i + 1) + '" aria-label="Rested ' + (i + 1) + ' of 4">' + m + '</button>';
    }).join('') + '</div>';
}
function weekdayWeekendHTML(S) {
  if (!S.work || !S.free) return '';
  return '<table class="st-table"><thead><tr><th></th><th>Sleep</th><th>Bedtime</th><th>Wake-up</th></tr></thead><tbody>' +
    '<tr><th>Other days (' + S.work.n + ')</th><td>' + fmtMins(S.work.avg) + '</td><td>' + fmtClockMins(S.work.bed) + '</td><td>' + fmtClockMins(S.work.wake) + '</td></tr>' +
    '<tr><th>Free days (' + S.free.n + ')</th><td>' + fmtMins(S.free.avg) + '</td><td>' + fmtClockMins(S.free.bed) + '</td><td>' + fmtClockMins(S.free.wake) + '</td></tr></tbody></table>';
}
// 28: sleep schedule chart: one bar per night, from bedtime (top) to wake-up (bottom), 6 pm to 2 pm.
function sleepScheduleChart(nights) {
  if (!nights.length) return '';
  const top = 18 * 60, bottom = 38 * 60;           // 6 pm .. 2 pm next day
  const S = { bed: mean(nights.map(function (n) { return n.bed; })), wake: mean(nights.map(function (n) { return n.wake < 18 * 60 ? n.wake + 1440 : n.wake; })) };
  function y(m) { return Math.max(0, Math.min(100, (m - top) / (bottom - top) * 100)); }
  const bars = nights.map(function (n) {
    const w = n.wake < 18 * 60 ? n.wake + 1440 : n.wake;
    const short = n.asleep < 360;
    return '<span class="sb' + (short ? ' short' : '') + '" style="top:' + y(n.bed).toFixed(1) + '%;height:' + Math.max(1, y(w) - y(n.bed)).toFixed(1) + '%" title="' + ctDate(n.end) + ': ' + fmtTime(n.start) + ' – ' + fmtTime(n.end) + ' (' + fmtMins(n.asleep) + ')"></span>';
  }).join('');
  const marks = [21, 24, 27, 30, 33, 36].map(function (hh) { return '<em style="top:' + y(hh * 60) + '%">' + hourName(hh % 24) + '</em>'; }).join('');
  return '<div class="sched"><div class="sched-ax">' + marks + '</div><div class="sched-bars" style="--n:' + nights.length + '">' +
    '<i class="avg" style="top:' + y(S.bed).toFixed(1) + '%"></i><i class="avg" style="top:' + y(S.wake).toFixed(1) + '%"></i>' + bars + '</div></div>' +
    '<div class="sched-x"><span>' + ctDate(nights[0].end) + '</span><span>' + ctDate(nights[nights.length - 1].end) + '</span></div>';
}
function bedDriftChart(nights) {
  if (nights.length < 5) return '';
  const vals = nights.map(function (n) { return n.bed; });
  const lo = Math.min.apply(null, vals) - 30, hi = Math.max.apply(null, vals) + 30;
  const pts = vals.map(function (v, i) { return (i / (vals.length - 1) * 100).toFixed(1) + ',' + ((v - lo) / (hi - lo) * 100).toFixed(1); }).join(' ');
  return '<p class="label">Bedtime drift (later is lower)</p><svg class="drift" viewBox="0 0 100 100" preserveAspectRatio="none"><polyline points="' + pts + '"/></svg>' +
    '<div class="sched-x"><span>' + fmtClockMins(lo + 30) + ' earliest</span><span>' + fmtClockMins(hi - 30) + ' latest</span></div>';
}
function durationHistogram(nights) {
  const b = [['<5h', 0, 300], ['5–6h', 300, 360], ['6–7h', 360, 420], ['7–8h', 420, 480], ['8–9h', 480, 540], ['9h+', 540, 99999]];
  const counts = b.map(function (x) { return nights.filter(function (n) { return n.asleep >= x[1] && n.asleep < x[2]; }).length; });
  const max = Math.max.apply(null, counts) || 1;
  return '<div class="hist">' + b.map(function (x, i) {
    return '<div><span style="height:' + (counts[i] / max * 100).toFixed(0) + '%" class="' + (x[1] >= 420 && x[1] < 540 ? 'ok' : '') + '"></span><b>' + counts[i] + '</b><small>' + x[0] + '</small></div>';
  }).join('') + '</div>';
}
function heatmapHTML(heat, kind) {
  let max = 1;
  heat.grid.forEach(function (row) { row.forEach(function (v) { if (v > max) max = v; }); });
  const color = kindInfo(kind).color;
  let html = '<div class="heat" style="--hc:' + color + '"><div class="heat-h"><span></span>' + [0, 3, 6, 9, 12, 15, 18, 21].map(function (h) { return '<em style="grid-column:' + (h + 2) + '">' + hourName(h) + '</em>'; }).join('') + '</div>';
  [1, 2, 3, 4, 5, 6, 0].forEach(function (w) {
    html += '<div class="heat-r"><b>' + DOW_NAMES[w][0] + '</b>' + heat.grid[w].map(function (v, h) {
      return '<i style="--a:' + (v === null ? 0 : (v / max).toFixed(2)) + '" class="' + (v === null ? 'none' : '') + '" title="' + DOW_NAMES[w] + ' ' + hourName(h) + ': ' + (v === null ? 'no data' : fmtMins(v)) + '"></i>';
    }).join('') + '</div>';
  });
  return html + '</div>';
}
function hourBars(byHour, kind) {
  const max = Math.max.apply(null, byHour) || 1;
  return '<div class="hbars" style="--hc:' + kindInfo(kind).color + '">' + byHour.map(function (v, h) {
    return '<span style="height:' + (v / max * 100).toFixed(0) + '%" title="' + hourName(h) + ': ' + fmtMins(v) + '"></span>';
  }).join('') + '</div><div class="sched-x"><span>12 am</span><span>6 am</span><span>12 pm</span><span>6 pm</span><span>11 pm</span></div>';
}
function dowBars(R, key, kind) {
  const vals = [1, 2, 3, 4, 5, 6, 0].map(function (w) { return R.byDow[w]; });
  const max = Math.max.apply(null, vals.map(function (x) { return x[key] || 0; })) || 1;
  return '<div class="dbars" style="--hc:' + kindInfo(kind).color + '">' + vals.map(function (x) {
    return '<div><span style="height:' + ((x[key] || 0) / max * 100).toFixed(0) + '%"></span><b>' + (x.n ? fmtMins(x[key]) : '–') + '</b><small>' + DOW_NAMES[x.dow] + '</small></div>';
  }).join('') + '</div>';
}

function statsProductive(R, L) {
  const P = R.prod;
  let h = '<div class="st-hero"><b>' + fmtMins(R.avg.productive) + '</b><span>productive a day · ' + Math.round(R.avg.productive / (R.awakeAvg || 1) * 100) + '% of your waking time</span></div>';
  if (L >= 7) {
    h += card('Golden hours', (R.heatProd.best ? '<p>You get the most done <b>' + hourName(R.heatProd.best.from) + '–' + hourName(R.heatProd.best.to) + '</b>.</p>' : '') +
      hourBars(R.heatProd.byHour, 'productive') + (L >= 14 ? heatmapHTML(R.heatProd, 'productive') : locked(14, L, 'Hour × weekday heatmap')) +
      how('Average productive minutes in each hour of the day, over the logged days in range. The heatmap splits it by weekday (darker = more).'));
  } else h += locked(7, L, 'Golden hours');
  h += '<div class="st-tiles">' +
    tile('Work starts', P.firstStart === null ? '–' : fmtClockMins(P.firstStart), 'first productive block, on average') +
    tile('Wake to work', P.wakeToWork === null ? '–' : fmtMins(P.wakeToWork), 'from waking up', 'Minutes from your wake-up to the first productive block of 10+ minutes.') +
    tile('Deep blocks (50m+)', P.deep50.toFixed(1), 'a week · ' + P.deep90.toFixed(1) + ' of 90m+', 'Productive stretches with no break longer than 5 minutes.') +
    tile('Longest block', P.longest ? fmtDur(P.longest.end - P.longest.start) : '–', P.longest ? ctDate(P.longest.start) : '') +
    tile('Switches', P.switches === null ? '–' : Math.round(P.switches), 'activity changes a day', 'How many separate blocks a day has. Fewer switches usually means deeper focus.') +
    tile('Focus timer', fmtMins(P.focusMins), 'vs ' + fmtMins(P.paintedProd) + ' painted productive', 'Minutes from finished Focus sessions vs productive time you painted, in this range.') +
  '</div>';
  if (P.startEffect) h += card('Early start effect', '<p>Days you start by <b>' + fmtClockMins(P.startEffect.cut) + '</b>: <b>' + fmtMins(P.startEffect.early) + '</b> productive. Later starts: <b>' + fmtMins(P.startEffect.late) + '</b>.</p>');
  if (L >= 14) h += card('By weekday', dowBars(R, 'prod', 'productive') + (P.bestDow ? '<p class="small">Best: <b>' + DOW_NAMES[P.bestDow.dow] + '</b> · weakest: <b>' + DOW_NAMES[P.worstDow.dow] + '</b></p>' : ''));
  else h += locked(14, L, 'Weekday patterns');
  const subs = Object.keys(P.perSub).filter(function (k) { return P.perSub[k] >= 1; });
  if (subs.length) h += card('What kind of productive', '<ul class="klist">' + subs.sort(function (a, b) { return P.perSub[b] - P.perSub[a]; }).map(function (s) {
    return '<li>' + kindDot('productive') + '<span>' + SUBKINDS.find(function (x) { return x[0] === s; })[1] + '</span><b>' + fmtMins(P.perSub[s]) + '</b><small>in range</small></li>';
  }).join('') + '</ul>' + how('Set in "How activities count": each productive activity can be Study, Work, Project, Learning or Admin.'));
  const lists = Object.keys(P.perList);
  h += card('Productive time per list', lists.length ? '<ul class="klist">' + lists.map(function (id) {
    const l = findList(id);
    return l ? '<li><i class="kd" style="background:' + l.color + '"></i><span>' + esc(l.name) + '</span><b>' + fmtMins(P.perList[id]) + '</b><small>in range</small></li>' : '';
  }).join('') + '</ul>' : '<p class="small">Link productive activities to a List (College, Projects…) in <button class="linkbtn" data-action="kindreview">How activities count</button> to see this.</p>');
  h += planVsActualHTML(R.planVsActual);
  if (R.predict.weekProd) h += card('This week\'s pace', '<p>So far <b>' + fmtMins(R.predict.weekProd.soFar) + '</b> productive. At your usual pace you\'ll end the week around <b>' + fmtMins(R.predict.weekProd.projected) + '</b>.</p>');
  return h;
}
function planVsActualHTML(pv) {
  if (!pv.days.length) return '';
  const max = Math.max.apply(null, pv.days.map(function (d) { return Math.max(d.planned, d.actual); })) || 1;
  return card('Plan vs actual (last 7 days)', '<div class="pva">' + pv.days.map(function (d) {
    return '<div><span class="pl" style="height:' + (d.planned / max * 100).toFixed(0) + '%"></span><span class="ac" style="height:' + (d.actual / max * 100).toFixed(0) + '%"></span><small>' + DOW_NAMES[new Date(d.start).getDay()] + '</small></div>';
  }).join('') + '</div><p class="small"><i class="kd" style="background:var(--muted)"></i>Planned (task estimates) <i class="kd" style="background:' + kindInfo('productive').color + '"></i>Painted productive</p>' +
    (pv.timed ? '<p>Timed tasks kept: <b>' + pv.kept + ' of ' + pv.timed + '</b></p>' : '') +
    how('Planned = the time estimates (~45m) of tasks dated that day. Actual = productive time you painted. A timed task counts as kept when at least half of its slot (its estimate, or 1 hour) is painted productive.'));
}

function statsWaste(R, L) {
  const W = R.waste;
  let h = '<div class="st-hero waste"><b>' + fmtMins(R.avg.waste) + '</b><span>wasted a day · ' + fmtMins(W.perWeek) + ' a week</span>' +
    (L >= 90 ? '<p>At this pace: <b>' + Math.round(W.perYearDays) + ' full days a year</b>.</p>' : '') + '</div>';
  if (L >= 7) h += card('Danger hours', (R.heatWaste.best ? '<p>Most time slips away <b>' + hourName(R.heatWaste.best.from) + '–' + hourName(R.heatWaste.best.to) + '</b>.</p>' : '<p>Not enough wasted time to find a pattern. 👏</p>') +
    hourBars(R.heatWaste.byHour, 'waste') + (L >= 14 ? heatmapHTML(R.heatWaste, 'waste') : locked(14, L, 'Hour × weekday heatmap')));
  else h += locked(7, L, 'Danger hours');
  h += '<div class="st-tiles">' +
    tile('A "quick" scroll', W.avgRun ? fmtMins(W.avgRun) : '–', W.runs + ' stretches', 'Average length of a wasted stretch (breaks under 5 minutes don\'t end it).') +
    tile('Phone in bed', W.inBed === null ? '–' : fmtMins(W.inBed), 'wasted in the first and last hour of the day', 'Wasted time in the hour after waking plus the hour before falling asleep, per night.') +
    tile('= pomodoros', Math.round(W.perWeek / 25), 'a week', 'Weekly wasted time ÷ 25 minutes.') +
    tile('= movies', (W.perWeek / 120).toFixed(1), 'a week', 'Weekly wasted time ÷ 2 hours.') +
    (W.worstDow ? tile('Worst day', DOW_NAMES[W.worstDow.dow], fmtMins(W.worstDow.waste) + ' wasted on average') : '') +
  '</div>';
  if (W.triggers.length && L >= 7) h += card('What comes right before', '<ul class="klist">' + W.triggers.map(function (t) {
    return '<li><i class="kd" style="background:' + catColor(t.cat) + '"></i><span>After ' + esc(catName(t.cat)) + '</span><b>' + t.pct + '%</b><small>' + t.n + ' times</small></li>';
  }).join('') + '</ul>' + (W.afterRisk ? '<p class="small">After <b>' + esc(catName(W.afterRisk.cat)) + '</b>, wasted time follows within 20 minutes <b>' + W.afterRisk.pct + '%</b> of the time.</p>' : '') +
    how('For every wasted stretch, the activity painted just before it (within 5 minutes).'));
  h += card('Leisure is not waste', '<p>Chosen fun: <b>' + fmtMins(R.avg.leisure) + '</b> a day. That\'s counted separately. Mark a block 👍 (tap it → Note) if that scroll was worth it, or 👎 if the "movie" was really waste.</p>');
  return h;
}

function statsMore(R, L) {
  const O = R.other;
  let h = card('Workout', '<div class="st-tiles">' +
    tile('Active days', O.workDaysPerWeek.toFixed(1), 'a week (15+ min)') +
    tile('Minutes', fmtMins(O.workMinsWeek), 'a week on average') +
    tile('Streak', O.workStreak, O.workStreak === 1 ? 'day' : 'days in a row') +
    tile('Usual time', O.workAt === null ? '–' : fmtClockMins(O.workAt), 'when workouts start') +
    (O.workSleep !== null && L >= 30 ? tile('Sleep after', fmtSigned(O.workSleep), 'on workout nights', 'Sleep on nights after 20+ min of workout vs other nights.') : '') +
    (O.workNextProd !== null && L >= 30 ? tile('Next day', fmtSigned(O.workNextProd), 'productive time', 'Productive time on the day after a workout vs other days.') : '') +
  '</div><p class="label">Last 7 days: ' + fmtMins(O.last7Workout) + ' of the WHO aim of 150–300 min</p><div class="lb-track who"><i style="width:' + Math.min(100, O.last7Workout / 150 * 100).toFixed(0) + '%"></i></div>' +
    how('WHO 2020 guidelines: adults should get 150–300 minutes of moderate activity a week (or 75–150 vigorous). Every Workout-kind activity counts.'));
  if (O.meals) h += card('Meals', '<div class="st-tiles">' +
    tile('Meals a day', O.meals.perDay.toFixed(1), '') + tile('First meal', fmtClockMins(O.meals.first), O.meals.regular !== null ? '±' + fmtMins(O.meals.regular) : '') +
    tile('Last meal', fmtClockMins(O.meals.last), '') + tile('Late meals', O.meals.late, 'after 10 pm') + tile('Light days', O.meals.few, 'fewer than 2 meals logged') + '</div>' +
    how('Only shown because you have a meal-type activity (Meal, Lunch, Dinner, Khana…).'));
  h += '<div class="st-tiles">' +
    tile('Social', fmtMins(O.socialWeek), 'a week with people', '') +
    tile('Travel', fmtMins(O.travelWeek), 'a week · ' + fmtMins(O.travelWeek * 4.3) + ' a month') +
    tile('Leisure', fmtMins(O.leisureDay), 'a day of chosen fun') +
    tile('Self-care', fmtMins(R.avg.selfcare), 'a day') +
    (L >= 14 ? tile('Routine', R.routine === null ? '–' : R.routine + '%', 'like your typical day', 'Share of 15-minute slots that match your typical day (the most common activity type in that slot).') : '') +
  '</div>';
  if (O.socialLast14 < 60 && L >= 14) h += '<p class="note">Under an hour with people in the last 2 weeks. A short call counts.</p>';
  h += card('Unlogged time', '<p><b>' + Math.round((1 - R.coverage) * 100) + '%</b> of an average logged day is blank (' + fmtMins(R.avg.unlogged) + ').</p>' +
    (R.blankHours.length ? '<p class="small">Most often blank: ' + R.blankHours.map(function (x) { return hourName(x.h) + '–' + hourName(x.h + 1); }).join(', ') + '.</p>' : '') +
    how('Stats only use days that are at least half painted. The more you paint, the sharper the numbers.'));
  return h;
}

function statsPatterns(R, L) {
  let h = '';
  if (L >= 30) {
    h += card('Links between your days', (R.links.length ? '<ul class="links">' + R.links.slice(0, 6).map(function (l) {
      return '<li><p>When <b>' + l.x + '</b> is ' + l.above + ' ' + l.cut + ', <b>' + l.y + '</b> averages <b>' + l.hi + '</b> (vs ' + l.lo + ').</p><small>' + l.n + ' days · strength ' + Math.abs(l.r).toFixed(2) + '</small></li>';
    }).join('') + '</ul>' : '<p class="small">No strong links yet. They show once a pattern holds over 12+ days.</p>') +
      how('Compares each day with the same day or the next one (e.g. last night\'s sleep vs today\'s productive time). Shown when the link is at least moderate (correlation 0.25+). A link isn\'t proof that one thing causes the other. Mood comes from Wrap up the day.'));
  } else h += locked(30, L, 'Links between your days (sleep → next-day focus, workout → sleep, mood)');
  if (L >= 14) {
    h += card('Your typical day', typicalStrip(R.typicalWork, 'Other days') + typicalStrip(R.typicalFree, 'Free days') +
      '<p class="small">' + KIND_IDS.filter(function (k) { return R.typical.concat(R.typicalWork, R.typicalFree).indexOf(k) !== -1; }).map(function (k) { return kindDot(k) + kindInfo(k).name; }).join(' · ') + '</p>' +
      how('For every 15 minutes of the day, the type of activity you do most often then (shown when it happens on at least 30% of days).'));
    h += card('Your best days', R.recipe && R.recipe.lines.length ? '<p class="small">Your top ' + R.recipe.n + ' days (Day score ' + R.recipe.score + ') had:</p><ul class="alerts">' + R.recipe.lines.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : '<p class="small">Needs 10+ logged days with some variety.</p>');
    h += card('What leads to what', (R.flow.length ? '<ul class="flow">' + R.flow.map(function (f) {
      return '<li><span style="--c:' + catColor(f.a) + '">' + esc(catName(f.a)) + '</span>→<span style="--c:' + catColor(f.b) + '" class="' + (catKind(f.b) === 'waste' ? 'bad' : '') + '">' + esc(catName(f.b)) + '</span><b>' + f.pct + '%</b><small>' + f.n + '×</small></li>';
    }).join('') + '</ul>' : '<p class="small">Not enough switches yet.</p>') + how('How often one activity is followed by another (within 10 minutes), as a share of everything that follows the first one.'));
  } else h += locked(14, L, 'Typical day, best-day recipe, what leads to what');
  if (L >= 30) h += recordsHTML();
  else h += locked(30, L, 'Personal records');
  if (L >= 90) h += trendsHTML(R.trends);
  else h += locked(90, L, 'Long-term trends');
  h += card('Periods', '<p class="small">Tag stretches like Exams, Holidays or an Internship, then pick them as a range at the top to compare.</p>' +
    (livePeriods().length ? '<ul class="klist">' + livePeriods().map(function (p) { return '<li><span>' + esc(p.name) + '</span><small>' + p.start + ' → ' + p.end + '</small></li>'; }).join('') + '</ul>' : '') +
    '<button class="btn small" data-action="ctperiods">Manage periods</button>');
  if (R.predict.sleepNow) h += card('If you go to sleep now', '<p>Sleeping your usual <b>' + fmtMins(R.predict.sleepNow.hours) + '</b>, you\'d wake at <b>' + fmtTime(R.predict.sleepNow.wakeAt) + '</b>.' +
    (R.predict.untilUsualWake ? ' Your usual wake-up (' + fmtTime(R.predict.usualWakeAt) + ') would give you <b>' + fmtMins(R.predict.untilUsualWake) + '</b>.' : '') + '</p>');
  return h;
}
function typicalStrip(slots, label) {
  if (!slots.some(Boolean)) return '';
  return '<p class="label">' + label + '</p><div class="tstrip">' + slots.map(function (k, i) {
    return '<i style="background:' + (k ? kindInfo(k).color : 'var(--surface-2)') + '" title="' + fmtClockMins(i * 15) + ': ' + (k ? kindInfo(k).name : 'varies') + '"></i>';
  }).join('') + '</div><div class="sched-x"><span>12 am</span><span>6 am</span><span>12 pm</span><span>6 pm</span><span>12 am</span></div>';
}
function trendsHTML(T) {
  const kinds = ['productive', 'waste', 'workout', 'sleep'];
  return card('Trends (last 8 weeks, per logged day)', kinds.map(function (k) {
    const vals = T.weeks.map(function (w) { return w.n ? w[k] / w.n : 0; });
    const max = Math.max.apply(null, vals) || 1;
    return '<div class="trend"><span>' + kindDot(k) + kindInfo(k).name + ' ' + (T.arrows[k] === null ? '' : arrow(T.arrows[k], k !== 'waste')) + '</span><div class="tbars" style="--hc:' + kindInfo(k).color + '">' +
      vals.map(function (v) { return '<i style="height:' + (v / max * 100).toFixed(0) + '%" title="' + fmtMins(v) + '"></i>'; }).join('') + '</div></div>';
  }).join('') + how('Each bar is one week (Monday to Sunday): minutes per logged day. Arrows compare the last 3 weeks with the 4 before.'));
}

// ---------- 56: records (all time) ----------
function allTimeRecords() {
  const first = liveRanges().reduce(function (m, x) { return Math.min(m, x.start); }, now());
  const days = buildDays(midnight(first), addDays(midnight(now()), 1)).filter(function (d) { return d.valid; });
  const nights = buildNights();
  const rec = [];
  if (nights.length) {
    const ln = nights.reduce(function (a, b) { return b.asleep > a.asleep ? b : a; });
    rec.push({ id: 'longsleep', label: 'Longest sleep', value: ln.asleep, show: fmtMins(ln.asleep), when: ln.end });
    const early = nights.filter(function (n) { return n.wake >= 4 * 60; });
    if (early.length) { const e = early.reduce(function (a, b) { return b.wake < a.wake ? b : a; }); rec.push({ id: 'earlywake', label: 'Earliest wake-up', value: -e.wake, show: fmtClockMins(e.wake), when: e.end }); }
  }
  if (days.length) {
    const p = days.reduce(function (a, b) { return b.mins.productive > a.mins.productive ? b : a; });
    rec.push({ id: 'prodday', label: 'Most productive day', value: p.mins.productive, show: fmtMins(p.mins.productive), when: p.start });
    let run = 0, best = 0, bestEnd = null;
    days.forEach(function (d, i) {
      if (i && d.start !== addDays(days[i - 1].start, 1)) run = 0;
      if (d.mins.waste < 15) { run++; if (run > best) { best = run; bestEnd = d.start; } } else run = 0;
    });
    if (best) rec.push({ id: 'nowaste', label: 'Longest no-waste streak', value: best, show: best + (best === 1 ? ' day' : ' days'), when: bestEnd });
    const s = ctStats(midnight(first), addDays(midnight(now()), 1));
    if (s.prod.longest) rec.push({ id: 'deep', label: 'Longest deep-work block', value: (s.prod.longest.end - s.prod.longest.start) / MIN, show: fmtDur(s.prod.longest.end - s.prod.longest.start), when: s.prod.longest.start });
    const weeks = s.trends.weeks.filter(function (w) { return w.n >= 3; });
    if (weeks.length) { const bw = weeks.reduce(function (a, b) { return b.productive > a.productive ? b : a; }); rec.push({ id: 'bestweek', label: 'Best week (productive)', value: bw.productive, show: fmtMins(bw.productive), when: bw.start }); }
  }
  return rec;
}
function recordsHTML() {
  const rec = allTimeRecords();
  return card('Personal records 🏆', rec.length ? '<ul class="klist">' + rec.map(function (r) {
    return '<li><span>' + r.label + '</span><b>' + r.show + '</b><small>' + (r.when ? ctDate(r.when) : '') + '</small></li>';
  }).join('') + '</ul>' : '<p class="small">Records appear as you log.</p>');
}
// A "new record" moment: compared with the records this device saw last time.
function checkNewRecords(R) {
  if (R.allDaysLogged < 30) return;
  const seen = state.ui.ctRecords || {};
  const rec = allTimeRecords();
  const beaten = rec.filter(function (r) { return seen[r.id] !== undefined && r.value > seen[r.id] && r.when >= addDays(midnight(now()), -2); });
  rec.forEach(function (r) { seen[r.id] = r.value; });
  state.ui.ctRecords = seen;
  if (beaten.length) { sound('milestone'); toast('🏆 New record: ' + beaten[0].label.toLowerCase() + ', ' + beaten[0].show + '!'); }
}

// ---------- sheets: weekly report, Wrapped, year in pixels, periods ----------
actions.ctweekreport = function () {
  const ws = addDays(weekStart(now()), -7);
  const R = ctStats(ws, addDays(ws, 7));
  const prev = ctStats(addDays(ws, -7), ws);
  const S = R.sleep;
  function delta(a, b, good) { return b && R.n && prev.n ? ' ' + arrow(a - b, good) : ''; }
  const tip = ctInsights(R).find(function (x) { return x.tip; });
  openSheet({ type: 'ctreport' }, '<h3>Weekly report</h3><p class="small">' + ctDate(ws) + ' – ' + ctDate(addDays(ws, 6)) + ' · ' + R.n + ' logged days</p><div class="wr">' +
    '<div class="wr-c">' + kindDot('sleep') + '<b>' + (S.count ? fmtMins(S.avg) : '–') + '</b><span>sleep a night' + (S.count && prev.sleep.count ? ' ' + arrow(S.avg - prev.sleep.avg, true) : '') + '</span>' + (S.bed ? '<small>bed ' + fmtClockMins(S.bed) + ' · up ' + fmtClockMins(S.wake) + '</small>' : '') + '</div>' +
    '<div class="wr-c">' + kindDot('productive') + '<b>' + fmtMins(R.total.productive) + '</b><span>productive' + delta(R.total.productive, prev.total.productive, true) + '</span><small>' + fmtMins(R.avg.productive) + ' a day</small></div>' +
    '<div class="wr-c">' + kindDot('waste') + '<b>' + fmtMins(R.total.waste) + '</b><span>wasted' + delta(R.total.waste, prev.total.waste, false) + '</span><small>' + (R.heatWaste.best ? 'mostly ' + hourName(R.heatWaste.best.from) + '–' + hourName(R.heatWaste.best.to) : '') + '</small></div>' +
    '<div class="wr-c">' + kindDot('workout') + '<b>' + fmtMins(R.total.workout) + '</b><span>workout</span><small>' + (R.total.workout >= 150 ? 'WHO aim reached ✓' : fmtMins(150 - R.total.workout) + ' short of 150') + '</small></div>' +
    (function () { const b = R.valid.slice().sort(function (a, c) { return c.score - a.score; })[0]; return '<div class="wr-c">⭐<b>' + (b ? DOW_NAMES[b.dow] : '–') + '</b><span>best day</span><small>' + (b ? 'score ' + b.score : '') + '</small></div>'; })() +
    '<div class="wr-c">🎯<b>Try</b><span>' + esc(tip ? tip.tip : 'Paint every day this week for sharper stats.') + '</span></div>' +
    '</div><div class="row"><button class="btn" data-action="close">Close</button></div>');
};
let wrappedYear = false;
function wrappedHTML() {
  const t = new Date(now());
  const from = wrappedYear ? new Date(t.getFullYear(), 0, 1).getTime() : new Date(t.getFullYear(), t.getMonth(), 1).getTime();
  const R = ctStats(from, addDays(midnight(now()), 1));
  const title = wrappedYear ? String(t.getFullYear()) : t.toLocaleDateString([], { month: 'long', year: 'numeric' });
  const best = R.valid.slice().sort(function (a, b) { return b.score - a.score; })[0];
  const topCat = (function () { const c = {}; R.days.forEach(function (d) { for (const k in d.cats) if (!isSleepCat(k)) c[k] = (c[k] || 0) + d.cats[k]; }); return Object.keys(c).sort(function (a, b) { return c[b] - c[a]; })[0]; })();
  const cards = [
    ['Your ' + title, R.n + ' days logged', 'that\'s ' + Math.round(R.n * R.coverage * 24) + ' hours of your life on record'],
    ['Productive', fmtMins(R.total.productive), R.heatProd.best ? 'best between ' + hourName(R.heatProd.best.from) + ' and ' + hourName(R.heatProd.best.to) : ''],
    ['Sleep', R.sleep.count ? fmtMins(R.sleep.avg) + ' a night' : '–', R.sleep.longest ? 'longest: ' + fmtMins(R.sleep.longest.asleep) : ''],
    ['Most time went to', topCat ? catName(topCat) : '–', topCat ? fmtMins(sum(R.days.map(function (d) { return d.cats[topCat] || 0; }))) : ''],
    ['Wasted', fmtMins(R.total.waste), R.waste.triggers[0] ? 'usually after ' + catName(R.waste.triggers[0].cat) : ''],
    ['Best day', best ? ctDate(best.start) : '–', best ? 'Day score ' + best.score : '']
  ];
  return '<h3>' + title + ' Wrapped</h3><div class="seg"><button class="' + (!wrappedYear ? 'on' : '') + '" data-action="ctwrapmode" data-y="0">This month</button><button class="' + (wrappedYear ? 'on' : '') + '" data-action="ctwrapmode" data-y="1">This year</button></div>' +
    '<div class="wrapped">' + cards.map(function (c, i) { return '<div class="wc wc' + i + '"><span>' + esc(c[0]) + '</span><b>' + esc(c[1]) + '</b><small>' + esc(c[2]) + '</small></div>'; }).join('') + '</div>' +
    '<div class="row"><button class="btn" data-action="close">Close</button><button class="btn primary" data-action="ctwrapimg">Save as image</button></div>';
}
actions.ctwrapped = function () { wrappedYear = false; openSheet({ type: 'wrapped' }, wrappedHTML()); };
actions.ctwrapmode = function (el) { wrappedYear = el.dataset.y === '1'; refreshSheet(wrappedHTML()); };
// Draws the Wrapped cards on a canvas and downloads a PNG to share.
actions.ctwrapimg = function () {
  const cards = Array.prototype.map.call(document.querySelectorAll('#sheet .wc'), function (el) {
    return [el.querySelector('span').textContent, el.querySelector('b').textContent, el.querySelector('small').textContent];
  });
  const c = document.createElement('canvas');
  c.width = 1080; c.height = 1350;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 1080, 1350);
  grad.addColorStop(0, '#4c1d95'); grad.addColorStop(1, '#0f766e');
  g.fillStyle = grad; g.fillRect(0, 0, 1080, 1350);
  g.fillStyle = '#fff';
  g.font = 'bold 64px system-ui, sans-serif';
  g.fillText($('sheet').querySelector('h3').textContent, 70, 130);
  cards.forEach(function (x, i) {
    const y = 230 + i * 180;
    g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(60, y - 70, 960, 160);
    g.fillStyle = 'rgba(255,255,255,0.8)'; g.font = '32px system-ui, sans-serif'; g.fillText(x[0], 90, y - 20);
    g.fillStyle = '#fff'; g.font = 'bold 56px system-ui, sans-serif'; g.fillText(x[1], 90, y + 40);
    g.fillStyle = 'rgba(255,255,255,0.75)'; g.font = '28px system-ui, sans-serif'; g.fillText(x[2], 90, y + 78);
  });
  g.fillStyle = 'rgba(255,255,255,0.7)'; g.font = '30px system-ui, sans-serif'; g.fillText('TaskStack · ColorTracker', 70, 1300);
  c.toBlob(function (blob) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'taskstack-wrapped-' + dayKey() + '.png';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    toast('Image saved. Share it from your downloads.');
  });
};
let pixelsMode = 'score';
function pixelsHTML() {
  const end = midnight(now());
  const start = addDays(weekStart(addDays(end, -364)), 0);
  const days = buildDays(start, addDays(end, 1));
  const nightsAll = buildNights();
  days.forEach(function (d) { if (d.valid || d.today) d.score = dayScore(d, nightsAll); });
  let html = '<div class="pixels">';
  days.forEach(function (d) {
    let color = 'var(--surface-2)', title = ctDate(d.start) + ': not logged';
    if (d.coverage >= VALID_COVER) {
      if (pixelsMode === 'score') {
        const s = d.score || 0;
        color = 'color-mix(in srgb, var(--c-ct) ' + Math.round(15 + s * 0.85) + '%, var(--surface))';
        title = ctDate(d.start) + ': Day score ' + s;
      } else {
        let best = null, bm = 0;
        KIND_IDS.forEach(function (k) { if (k !== 'sleep' && d.mins[k] > bm) { best = k; bm = d.mins[k]; } });
        color = best ? kindInfo(best).color : color;
        title = ctDate(d.start) + ': mostly ' + (best ? kindInfo(best).name : '–');
      }
    }
    html += '<i style="background:' + color + '" title="' + title + '"></i>';
  });
  return '<h3>Year in pixels</h3><p class="small">Every square is a day (columns are weeks). Days less than half painted stay grey.</p>' +
    '<div class="seg"><button class="' + (pixelsMode === 'score' ? 'on' : '') + '" data-action="ctpixmode" data-m="score">Day score</button><button class="' + (pixelsMode === 'kind' ? 'on' : '') + '" data-action="ctpixmode" data-m="kind">Main activity</button></div>' +
    html + '</div><div class="row"><button class="btn" data-action="close">Close</button></div>';
}
actions.ctpixels = function () { openSheet({ type: 'pixels' }, pixelsHTML()); };
actions.ctpixmode = function (el) { pixelsMode = el.dataset.m; refreshSheet(pixelsHTML()); };
function periodsHTML() {
  return '<h3>Periods</h3><p class="small">Tag a stretch of days (Exams, Holidays, Internship) to compare it. Each one shows up as a range at the top of Stats.</p>' +
    (livePeriods().length ? '<ul class="cdlist">' + livePeriods().map(function (p) {
      return '<li><span>' + esc(p.name) + '<small>' + p.start + ' → ' + p.end + '</small></span><button class="icon-btn sm danger" data-action="ctperioddel" data-id="' + p.id + '" aria-label="Delete">×</button></li>';
    }).join('') + '</ul>' : '') +
    '<form id="periodForm" class="cdform" autocomplete="off"><input class="text-input" id="pName" placeholder="e.g. End-sem exams" maxlength="40"><input type="date" id="pStart" aria-label="From"><input type="date" id="pEnd" aria-label="To"><button class="btn primary" type="submit">Add</button></form>' +
    '<div class="row"><button class="btn" data-action="close">Done</button></div>';
}
actions.ctperiods = function () { openSheet({ type: 'periods' }, periodsHTML()); };
actions.ctperioddel = function (el) {
  const p = state.periods.find(function (x) { return x.id === el.dataset.id; });
  if (!p) return;
  snapshot('Deleted period');
  p.deleted = true; p.updatedAt = now();
  if (state.ui.ctRange === 'p:' + p.id) state.ui.ctRange = '30';
  save(); refreshSheet(periodsHTML()); ctStatsKey = '';
  toast('Deleted ' + p.name, { undo: true });
};
$('sheet').addEventListener('submit', function (e) {
  if (e.target.id !== 'periodForm') return;
  e.preventDefault();
  const name = $('pName').value.trim(), a = $('pStart').value, b = $('pEnd').value;
  if (!name || !a || !b) { toast('Give it a name and both dates.'); return; }
  state.periods.push({ id: uid(), name: name, start: a < b ? a : b, end: a < b ? b : a, updatedAt: now(), deleted: false });
  save(); refreshSheet(periodsHTML()); ctStatsKey = '';
  toast('Added. Pick "' + name + '" at the top of Stats to see it.');
});
actions.ctneed = function (el) {
  state.settings.sleepNeed = Math.max(5, Math.min(11, (state.settings.sleepNeed || 7.5) + Number(el.dataset.d)));
  state.settings.updatedAt = now(); save(); renderCtStats(true);
};
actions.ctneedset = function (el) {
  state.settings.sleepNeed = Math.round(Number(el.dataset.m) / 15) / 4;
  state.settings.updatedAt = now(); save(); renderCtStats(true);
  toast('Sleep need set to ' + fmtMins(sleepNeed()));
};
actions.ctrested = function (el) { setDay(dayKey(), { rested: Number(el.dataset.v) }); renderCtStats(true); toast('Noted. Thanks!'); };
