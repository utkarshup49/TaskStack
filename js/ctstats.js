/* =========================================================
   ColorTracker stats engine (numbers only, no drawing).
   ctStats(range) turns the painted timeline into everything the
   Stats page shows: per-day totals by kind, sleep (nights, naps,
   timing, regularity, debt, chronotype), productive vs waste
   (golden / danger hours, deep work, triggers), workout, meals,
   social, travel, routine, unlogged time, links between days,
   typical day, best-day recipe, transitions, records, trends,
   plan vs actual, predictions, scores and insight sentences.
   Days here are calendar days (midnight to midnight); a night
   belongs to the day you woke up on.
   ========================================================= */

const SLOTS = 96;                         // 15-minute slots in a day
const VALID_COVER = 0.5;                  // a day counts once half of it is painted
const KIND_IDS = ['sleep', 'productive', 'workout', 'selfcare', 'social', 'leisure', 'waste', 'travel', 'other'];

// ---------- small maths helpers ----------
function sum(a) { let s = 0; a.forEach(function (x) { s += x; }); return s; }
function mean(a) { return a.length ? sum(a) / a.length : null; }
function median(a) { if (!a.length) return null; const b = a.slice().sort(function (x, y) { return x - y; }); const m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; }
function sd(a) { if (a.length < 2) return null; const m = mean(a); return Math.sqrt(sum(a.map(function (x) { return (x - m) * (x - m); })) / (a.length - 1)); }
function pearson(xs, ys) {
  const n = xs.length;
  if (n < 3) return 0;
  const mx = mean(xs), my = mean(ys);
  let a = 0, b = 0, c = 0;
  for (let i = 0; i < n; i++) { a += (xs[i] - mx) * (ys[i] - my); b += (xs[i] - mx) * (xs[i] - mx); c += (ys[i] - my) * (ys[i] - my); }
  return b && c ? a / Math.sqrt(b * c) : 0;
}
function minsOfDay(t) { const d = new Date(t); return d.getHours() * 60 + d.getMinutes(); }
// Bedtimes and mid-sleep wrap around midnight: 1 am is stored as 25:00 so averages work (anything before 6 pm moves to the next day).
function lateMins(t) { const m = minsOfDay(t); return m < 18 * 60 ? m + 1440 : m; }
function fmtClockMins(m) {
  m = Math.round(((m % 1440) + 1440) % 1440);
  return fmtTime(midnight(now()) + m * MIN);
}
function fmtMins(m) { return fmtDur(Math.max(0, Math.round(m)) * MIN); }
function fmtSigned(m) { return (m >= 0 ? '+' : '−') + fmtMins(Math.abs(m)); }

// Painted time as non-overlapping pieces (fast; earlier block wins an overlap), with each piece's kind.
function ctSegs(from, to) {
  const rs = liveRanges().filter(function (r) { return r.start < to && r.end > from; })
    .sort(function (a, b) { return a.start - b.start || b.updatedAt - a.updatedAt; });
  const out = [];
  let cur = from;
  rs.forEach(function (r) {
    const s = Math.max(r.start, cur), e = Math.min(r.end, to);
    if (e - s < MIN / 2) return;
    out.push({ start: s, end: e, cat: r.cat, id: r.id, worth: r.worth || 0, label: r.label || '', kind: segKind(r) });
    cur = Math.max(cur, e);
  });
  return out;
}
function segKind(r) {
  if (isSleepCat(r.cat)) return 'sleep';
  const k = catKind(r.cat);
  if (k === 'waste' && r.worth > 0) return 'leisure';
  if (k === 'leisure' && r.worth < 0) return 'waste';
  return k;
}
function segValue(s) {
  const c = findCat(s.cat);
  const v = c ? catValue(c) : 0;
  return Math.max(-2, Math.min(2, v + (s.worth || 0)));
}

// ---------- days ----------
// One calendar day: totals per kind and activity, 24 hour buckets per kind, 96 slots of the main kind, etc.
function buildDay(dayStart, segs) {
  const end = addDays(dayStart, 1);
  const lim = Math.min(end, now());
  const d = { start: dayStart, key: dayKey(dayStart), dow: new Date(dayStart).getDay(), segs: [], mins: {}, cats: {}, hours: [], slots: [],
    logged: 0, span: Math.max(0, lim - dayStart) / MIN, value: 0, today: dayStart === midnight(now()) };
  KIND_IDS.forEach(function (k) { d.mins[k] = 0; });
  for (let h = 0; h < 24; h++) d.hours.push({});
  const slotKind = [];
  for (let i = 0; i < SLOTS; i++) slotKind.push({});
  segs.forEach(function (s) {
    const a = Math.max(s.start, dayStart), b = Math.min(s.end, lim);
    if (b <= a) return;
    const piece = Object.assign({}, s, { start: a, end: b });
    d.segs.push(piece);
    const m = (b - a) / MIN;
    d.mins[s.kind] = (d.mins[s.kind] || 0) + m;
    d.cats[s.cat] = (d.cats[s.cat] || 0) + m;
    d.logged += m;
    d.value += m * segValue(s) / 60;
    // spread into hour buckets and 15-min slots
    let t = a;
    while (t < b) {
      const slot = Math.floor((t - dayStart) / (15 * MIN));
      const next = Math.min(b, dayStart + (slot + 1) * 15 * MIN);
      const mm = (next - t) / MIN;
      const hb = d.hours[Math.floor(slot / 4)];
      hb[s.kind] = (hb[s.kind] || 0) + mm;
      slotKind[slot][s.kind] = (slotKind[slot][s.kind] || 0) + mm;
      t = next;
    }
  });
  d.slots = slotKind.map(function (o) {
    let best = null, bm = 0;
    for (const k in o) if (o[k] > bm) { best = k; bm = o[k]; }
    return bm >= 7 ? best : null;                  // a slot needs half of it painted
  });
  d.unlogged = Math.max(0, d.span - d.logged);
  d.coverage = d.span ? d.logged / d.span : 0;
  d.valid = d.coverage >= VALID_COVER && !d.today;
  const prod = d.segs.filter(function (s) { return s.kind === 'productive' && s.end - s.start >= 10 * MIN; });
  d.firstProd = prod.length ? minsOfDay(prod[0].start) : null;
  d.switches = d.segs.length;
  return d;
}
function buildDays(from, to) {
  const segs = ctSegs(from, to);
  const days = [];
  let i = 0;
  for (let ds = from; ds < to; ds = addDays(ds, 1)) {
    const de = addDays(ds, 1);
    while (i < segs.length && segs[i].end <= ds) i++;
    const mine = [];
    for (let j = i; j < segs.length && segs[j].start < de; j++) mine.push(segs[j]);
    days.push(buildDay(ds, mine));
  }
  return days;
}

// ---------- sleep ----------
// Main sleeps (from ColorTracker's own rules) with the real time asleep, the pieces and the time awake inside.
function buildNights() {
  const sleeps = liveRanges().filter(function (r) { return isSleepCat(r.cat); }).sort(function (a, b) { return a.start - b.start; });
  const off = state.settings.offDays || [0, 6];
  return mainSleeps().map(function (m) {
    const inside = sleeps.filter(function (r) { return r.start < m.end && r.end > m.start; });
    let asleep = 0, pieces = 0, lastEnd = null;
    inside.forEach(function (r) {
      const a = Math.max(r.start, m.start), b = Math.min(r.end, m.end);
      asleep += (b - a) / MIN;
      if (lastEnd === null || a - lastEnd >= 5 * MIN) pieces++;
      lastEnd = Math.max(lastEnd || 0, b);
    });
    const wakeDay = midnight(m.end);
    return { start: m.start, end: m.end, asleep: asleep, inBed: (m.end - m.start) / MIN, pieces: pieces, awake: Math.max(0, (m.end - m.start) / MIN - asleep),
      wakeDay: wakeDay, key: dayKey(wakeDay), free: off.indexOf(new Date(wakeDay).getDay()) !== -1,
      bed: lateMins(m.start), wake: minsOfDay(m.end), mid: lateMins(m.start + (m.end - m.start) / 2) };
  });
}
function buildNaps() {
  const mains = mainSleeps();
  return joinedSleeps().filter(function (s) {
    return !mains.some(function (m) { return s.start >= m.start && s.end <= m.end; });
  }).map(function (s) { return { start: s.start, end: s.end, mins: (s.end - s.start) / MIN, key: dayKey(s.start), at: minsOfDay(s.start) }; });
}
function sleepNeed() { return (state.settings.sleepNeed || 7.5) * 60; }
// Sleep Regularity: the chance you're in the same state (asleep / awake) at two moments 24 h apart.
// Sampled every 10 minutes; moments with nothing painted are skipped.
function sleepRegularity(from, to) {
  const rs = liveRanges().filter(function (r) { return r.end > from && r.start < to; }).sort(function (a, b) { return a.start - b.start; });
  function stateAt(t) {
    for (let i = 0; i < rs.length; i++) {
      if (rs[i].start > t) break;
      if (rs[i].end > t) return isSleepCat(rs[i].cat) ? 1 : 0;
    }
    return -1;
  }
  let same = 0, total = 0;
  for (let t = from; t + DAY < to; t += 10 * MIN) {
    const a = stateAt(t), b = stateAt(t + DAY);
    if (a < 0 || b < 0) continue;
    total++;
    if (a === b) same++;
  }
  return total >= 144 ? Math.round(same / total * 100) : null;      // needs about a day of pairs
}
function sleepStats(nightsAll, naps, from, to, days) {
  const nights = nightsAll.filter(function (n) { return n.wakeDay >= from && n.wakeDay < to; });
  const S = { nights: nights, count: nights.length };
  if (!nights.length) return S;
  const dur = nights.map(function (n) { return n.asleep; });
  S.avg = mean(dur); S.median = median(dur); S.total = sum(dur); S.sd = sd(dur);
  S.longest = nights.reduce(function (a, b) { return b.asleep > a.asleep ? b : a; });
  S.shortest = nights.reduce(function (a, b) { return b.asleep < a.asleep ? b : a; });
  S.under6 = nights.filter(function (n) { return n.asleep < 360; }).length;
  S.over9 = nights.filter(function (n) { return n.asleep > 540; }).length;
  S.pct7 = Math.round(nights.filter(function (n) { return n.asleep >= 420; }).length / nights.length * 100);
  const beds = nights.map(function (n) { return n.bed; }), wakes = nights.map(function (n) { return n.wake; }), mids = nights.map(function (n) { return n.mid; });
  S.bed = mean(beds); S.bedSd = sd(beds); S.bedEarliest = Math.min.apply(null, beds); S.bedLatest = Math.max.apply(null, beds);
  S.wake = mean(wakes); S.wakeSd = sd(wakes); S.wakeEarliest = Math.min.apply(null, wakes); S.wakeLatest = Math.max.apply(null, wakes);
  S.mid = mean(mids);
  const free = nights.filter(function (n) { return n.free; }), work = nights.filter(function (n) { return !n.free; });
  function part(list) { return list.length ? { n: list.length, avg: mean(list.map(function (x) { return x.asleep; })), bed: mean(list.map(function (x) { return x.bed; })), wake: mean(list.map(function (x) { return x.wake; })), mid: mean(list.map(function (x) { return x.mid; })) } : null; }
  S.work = part(work); S.free = part(free);
  S.jetlag = S.work && S.free && S.work.n >= 2 && S.free.n >= 1 ? Math.abs(S.free.mid - S.work.mid) : null;
  S.sri = sleepRegularity(from, Math.min(to, now()));
  // chronotype from free-day mid-sleep (or all nights if there are no free days yet)
  const ref = S.free && S.free.n >= 2 ? S.free.mid : S.mid;
  S.chronoMid = ref;
  S.chronotype = nights.length < 7 ? null : ref < 1440 + 210 ? 'Early bird' : ref <= 1440 + 330 ? 'In between' : 'Night owl';
  // naps
  const napsIn = naps.filter(function (n) { return n.start >= from && n.start < to; });
  S.naps = napsIn;
  if (napsIn.length) {
    S.napAvg = mean(napsIn.map(function (n) { return n.mins; }));
    S.napTotal = sum(napsIn.map(function (n) { return n.mins; }));
    S.napAt = mean(napsIn.map(function (n) { return n.at; }));
    const need = sleepNeed();
    S.napCatchUp = napsIn.filter(function (n) {
      const night = nightsAll.find(function (x) { return x.key === n.key; });
      return night && night.asleep < need - 60;
    }).length;
    // bedtime that night after a nap of 1 h+, vs other nights
    const after = [], other = [];
    nights.forEach(function (n) {
      const prevKey = dayKey(addDays(n.wakeDay, -1));
      const napped = napsIn.some(function (x) { return x.key === prevKey && x.mins >= 60; });
      (napped ? after : other).push(n.bed);
    });
    S.napBedEffect = after.length >= 2 && other.length >= 2 ? mean(after) - mean(other) : null;
  }
  // broken sleep
  const broken = nights.filter(function (n) { return n.pieces > 1; });
  S.broken = broken.length; S.brokenAwake = broken.length ? mean(broken.map(function (n) { return n.awake; })) : 0;
  // all-nighters: 24 h+ with no sleep at all (and most of it painted)
  const all = joinedSleeps();
  S.allNighters = [];
  for (let i = 1; i < all.length; i++) {
    const a = all[i - 1].end, b = all[i].start;
    if (b - a >= 24 * HOUR && b > from && a < to) {
      const painted = ctSegs(a, b).reduce(function (s, x) { return s + x.end - x.start; }, 0);
      if (painted / (b - a) >= 0.7) S.allNighters.push({ from: a, to: b });
    }
  }
  // sleep debt over the last 7 nights (naps count towards it)
  const need = sleepNeed();
  const last7 = nightsAll.filter(function (n) { return n.wakeDay > addDays(midnight(now()), -7); });
  let debt = 0;
  last7.forEach(function (n) {
    const napMins = sum(naps.filter(function (x) { return x.key === n.key; }).map(function (x) { return x.mins; }));
    debt += need - n.asleep - napMins;
  });
  S.debt = Math.max(0, debt); S.debtNights = last7.length;
  // how rested (optional morning tap, stored in state.days)
  const rated = nights.map(function (n) { const d = dayEntry(n.key); return d && d.rested ? { n: n, r: d.rested } : null; }).filter(Boolean);
  S.rated = rated.length;
  if (rated.length >= 5) {
    const good = rated.filter(function (x) { return x.r >= 3; });
    S.restedNeed = good.length >= 3 ? mean(good.map(function (x) { return x.n.asleep; })) : null;
    S.restedBed = good.length >= 3 ? mean(good.map(function (x) { return x.n.bed; })) : null;
  }
  // alerts
  const recent = nightsAll.slice(-3);
  S.alerts = [];
  if (recent.length === 3 && recent.every(function (n) { return n.asleep < 360; }) && recent[2].wakeDay >= addDays(midnight(now()), -1)) S.alerts.push('3 nights under 6 hours in a row. Try an early night.');
  const wk = nightsAll.filter(function (n) { return n.wakeDay > addDays(midnight(now()), -7); });
  const pw = nightsAll.filter(function (n) { return n.wakeDay <= addDays(midnight(now()), -7) && n.wakeDay > addDays(midnight(now()), -14); });
  if (wk.length >= 3 && pw.length >= 3) {
    const shift = mean(wk.map(function (n) { return n.bed; })) - mean(pw.map(function (n) { return n.bed; }));
    S.bedShift = shift;
    if (shift >= 60) S.alerts.push('Bedtime is ' + fmtMins(shift) + ' later than the week before.');
  }
  if (last7.length >= 5 && S.debt < 60) S.alerts.push('Barely any sleep debt this week. Nice.');
  return S;
}

// ---------- the whole report for a range of days ----------
function ctStats(from, to) {
  ensureKinds();
  const days = buildDays(from, to);
  const valid = days.filter(function (d) { return d.valid; });
  const nightsAll = buildNights();
  const naps = buildNaps();
  const R = { from: from, to: to, days: days, valid: valid, n: valid.length };
  R.sleep = sleepStats(nightsAll, naps, from, to, days);
  R.allDaysLogged = countLoggedDays();
  // averages per valid day, per kind
  R.avg = {};
  KIND_IDS.concat(['unlogged']).forEach(function (k) { R.avg[k] = valid.length ? mean(valid.map(function (d) { return k === 'unlogged' ? d.unlogged : d.mins[k]; })) : 0; });
  R.total = {};
  KIND_IDS.forEach(function (k) { R.total[k] = sum(days.map(function (d) { return d.mins[k]; })); });
  R.awakeAvg = valid.length ? mean(valid.map(function (d) { return d.logged - d.mins.sleep; })) : 0;
  R.coverage = valid.length ? mean(valid.map(function (d) { return d.coverage; })) : 0;
  // heatmaps: average minutes per hour, per weekday
  function heat(kind) {
    const grid = [], counts = [0, 0, 0, 0, 0, 0, 0];
    for (let w = 0; w < 7; w++) { grid.push([]); for (let h = 0; h < 24; h++) grid[w].push(0); }
    valid.forEach(function (d) { counts[d.dow]++; for (let h = 0; h < 24; h++) grid[d.dow][h] += d.hours[h][kind] || 0; });
    const byHour = [];
    for (let h = 0; h < 24; h++) { let s = 0; for (let w = 0; w < 7; w++) s += grid[w][h]; byHour.push(valid.length ? s / valid.length : 0); }
    for (let w = 0; w < 7; w++) for (let h = 0; h < 24; h++) grid[w][h] = counts[w] ? grid[w][h] / counts[w] : null;
    return { grid: grid, byHour: byHour, best: bestWindow(byHour) };
  }
  function bestWindow(byHour) {
    let best = -1, at = 0;
    for (let h = 0; h < 24; h++) { const s = byHour[h] + byHour[(h + 1) % 24]; if (s > best) { best = s; at = h; } }
    return best > 5 ? { from: at, to: (at + 2) % 24, mins: best } : null;
  }
  R.heatProd = heat('productive');
  R.heatWaste = heat('waste');
  // unlogged hours (awake-ish only: ignore the usual sleep hours)
  const blank = [];
  for (let h = 0; h < 24; h++) blank.push(valid.length ? mean(valid.map(function (d) { return 60 - sum(Object.keys(d.hours[h]).map(function (k) { return d.hours[h][k]; })); })) : 0);
  R.blankHours = blank.map(function (m, h) { return { h: h, m: m }; }).sort(function (a, b) { return b.m - a.m; }).slice(0, 3).filter(function (x) { return x.m >= 15; });
  // productive details
  const P = R.prod = {};
  const firsts = valid.filter(function (d) { return d.firstProd !== null; });
  P.firstStart = firsts.length ? mean(firsts.map(function (d) { return d.firstProd; })) : null;
  if (firsts.length >= 6) {
    const cut = median(firsts.map(function (d) { return d.firstProd; }));
    const early = firsts.filter(function (d) { return d.firstProd <= cut; }), late = firsts.filter(function (d) { return d.firstProd > cut; });
    if (early.length >= 3 && late.length >= 3) P.startEffect = { cut: cut, early: mean(early.map(function (d) { return d.mins.productive; })), late: mean(late.map(function (d) { return d.mins.productive; })) };
  }
  const w2w = [];
  valid.forEach(function (d) {
    const night = nightsAll.find(function (n) { return n.key === d.key; });
    if (night && d.firstProd !== null && d.firstProd > night.wake) w2w.push(d.firstProd - night.wake);
  });
  P.wakeToWork = w2w.length ? mean(w2w) : null;
  // deep-work blocks: productive time with no break longer than 5 minutes
  const blocks = [];
  let cur = null;
  ctSegs(from, Math.min(to, now())).forEach(function (s) {
    if (s.kind === 'productive' && cur && s.start - cur.end <= 5 * MIN) cur.end = s.end;
    else if (s.kind === 'productive') { cur = { start: s.start, end: s.end }; blocks.push(cur); }
    else if (s.end - s.start > 5 * MIN) cur = null;
  });
  const weeks = Math.max(1, days.length / 7);
  P.deep50 = blocks.filter(function (b) { return b.end - b.start >= 50 * MIN; }).length / weeks;
  P.deep90 = blocks.filter(function (b) { return b.end - b.start >= 90 * MIN; }).length / weeks;
  P.longest = blocks.reduce(function (a, b) { return !a || b.end - b.start > a.end - a.start ? b : a; }, null);
  P.deepPerDay = valid.length ? blocks.filter(function (b) { return b.end - b.start >= 50 * MIN; }).length / Math.max(1, valid.length) : 0;
  P.switches = valid.length ? mean(valid.map(function (d) { return d.switches; })) : null;
  // weekday ranking
  const byDow = [];
  for (let w = 0; w < 7; w++) {
    const list = valid.filter(function (d) { return d.dow === w; });
    byDow.push({ dow: w, n: list.length, prod: mean(list.map(function (d) { return d.mins.productive; })), waste: mean(list.map(function (d) { return d.mins.waste; })) });
  }
  const ranked = byDow.filter(function (x) { return x.n; });
  P.bestDow = ranked.length >= 3 ? ranked.reduce(function (a, b) { return b.prod > a.prod ? b : a; }) : null;
  P.worstDow = ranked.length >= 3 ? ranked.reduce(function (a, b) { return b.prod < a.prod ? b : a; }) : null;
  R.byDow = byDow;
  // Focus timer vs painted productive time
  const focus = sum(liveSessions().filter(function (s) { return s.endedAt >= from && s.endedAt < to; }).map(function (s) { return s.minutes; }));
  P.focusMins = focus;
  P.paintedProd = R.total.productive;
  // productive time per List (activities linked to a list)
  const perList = {};
  days.forEach(function (d) { for (const c in d.cats) { const cat = findCat(c); if (cat && cat.kind === 'productive' && cat.listId) perList[cat.listId] = (perList[cat.listId] || 0) + d.cats[c]; } });
  P.perList = perList;
  // productive sub-kinds
  const perSub = {};
  days.forEach(function (d) { for (const c in d.cats) { const cat = findCat(c); if (cat && cat.kind === 'productive') perSub[cat.sub || 'study'] = (perSub[cat.sub || 'study'] || 0) + d.cats[c]; } });
  P.perSub = perSub;
  // waste details
  const W = R.waste = {};
  const segsAll = ctSegs(from, Math.min(to, now()));
  const wasteRuns = [];
  let run = null;
  segsAll.forEach(function (s, i) {
    if (s.kind === 'waste') {
      if (run && s.start - run.end <= 5 * MIN) run.end = s.end;
      else {
        const prev = segsAll[i - 1];
        run = { start: s.start, end: s.end, before: prev && s.start - prev.end <= 5 * MIN && prev.kind !== 'waste' ? prev.cat : null };
        wasteRuns.push(run);
      }
    } else if (s.end - s.start > 5 * MIN) run = null;
  });
  W.runs = wasteRuns.length;
  W.avgRun = wasteRuns.length ? mean(wasteRuns.map(function (r) { return (r.end - r.start) / MIN; })) : null;
  const before = {};
  wasteRuns.forEach(function (r) { if (r.before) before[r.before] = (before[r.before] || 0) + 1; });
  W.triggers = Object.keys(before).map(function (c) { return { cat: c, n: before[c], pct: Math.round(before[c] / wasteRuns.length * 100) }; })
    .sort(function (a, b) { return b.n - a.n; }).slice(0, 3);
  // "after College, X% of the time waste follows within 20 min"
  const after = {};
  segsAll.forEach(function (s, i) {
    if (s.kind === 'waste' || s.kind === 'sleep') return;
    const k = s.cat;
    after[k] = after[k] || { n: 0, w: 0 };
    after[k].n++;
    for (let j = i + 1; j < segsAll.length && segsAll[j].start - s.end <= 20 * MIN; j++) if (segsAll[j].kind === 'waste') { after[k].w++; break; }
  });
  W.afterRisk = Object.keys(after).filter(function (c) { return after[c].n >= 5; }).map(function (c) { return { cat: c, pct: Math.round(after[c].w / after[c].n * 100), n: after[c].n }; })
    .sort(function (a, b) { return b.pct - a.pct; })[0] || null;
  // phone in bed: waste in the first and last hour of the day
  const inBed = [];
  R.sleep.nights.forEach(function (n, i, arr) {
    let m = sum(ctSegs(n.end, n.end + HOUR).filter(function (s) { return s.kind === 'waste'; }).map(function (s) { return (s.end - s.start) / MIN; }));
    const nextBed = arr[i + 1] ? arr[i + 1].start : null;
    if (nextBed) m += sum(ctSegs(nextBed - HOUR, nextBed).filter(function (s) { return s.kind === 'waste'; }).map(function (s) { return (s.end - s.start) / MIN; }));
    inBed.push(m);
  });
  W.inBed = inBed.length ? mean(inBed) : null;
  W.perWeek = R.avg.waste * 7;
  W.perYearDays = R.avg.waste * 365 / 60 / 24;
  W.worstDow = ranked.length >= 3 ? ranked.reduce(function (a, b) { return b.waste > a.waste ? b : a; }) : null;
  // other kinds
  const O = R.other = {};
  const wk = valid.filter(function (d) { return d.mins.workout >= 15; });
  O.workDaysPerWeek = valid.length ? wk.length / Math.max(1, valid.length / 7) : 0;
  O.workMinsWeek = R.avg.workout * 7;
  O.last7Workout = sum(days.filter(function (d) { return d.start > addDays(midnight(now()), -7); }).map(function (d) { return d.mins.workout; }));
  O.workAt = mean(segsAll.filter(function (s) { return s.kind === 'workout'; }).map(function (s) { return minsOfDay(s.start); }));
  O.workStreak = (function () { let n = 0; for (let d = midnight(now()); ; d = addDays(d, -1)) { const x = days.find(function (y) { return y.start === d; }); if (x && x.mins.workout >= 15) n++; else if (d !== midnight(now())) break; if (n > 400) break; } return n; })();
  const nightAfter = function (d) { return nightsAll.find(function (n) { return n.key === dayKey(addDays(d.start, 1)); }); };
  const sW = [], sN = [], pW = [], pN = [];
  valid.forEach(function (d) {
    const night = nightAfter(d);
    const nextDay = valid.find(function (x) { return x.start === addDays(d.start, 1); });
    const worked = d.mins.workout >= 20;
    if (night) (worked ? sW : sN).push(night.asleep);
    if (nextDay) (worked ? pW : pN).push(nextDay.mins.productive);
  });
  O.workSleep = sW.length >= 3 && sN.length >= 3 ? mean(sW) - mean(sN) : null;
  O.workNextProd = pW.length >= 3 && pN.length >= 3 ? mean(pW) - mean(pN) : null;
  // meals: only if the user has a meal-type activity
  const meals = mealCats().map(function (c) { return c.id; });
  if (meals.length) {
    const mealSegs = segsAll.filter(function (s) { return meals.indexOf(s.cat) !== -1; });
    const perDay = {};
    mealSegs.forEach(function (s) { const k = dayKey(s.start); (perDay[k] = perDay[k] || []).push(minsOfDay(s.start)); });
    const ks = Object.keys(perDay);
    O.meals = ks.length ? {
      perDay: mean(ks.map(function (k) { return perDay[k].length; })),
      first: mean(ks.map(function (k) { return Math.min.apply(null, perDay[k]); })),
      last: mean(ks.map(function (k) { return Math.max.apply(null, perDay[k]); })),
      late: mealSegs.filter(function (s) { const m = minsOfDay(s.start); return m >= 22 * 60 || m < 4 * 60; }).length,
      few: valid.filter(function (d) { return (perDay[d.key] || []).length < 2; }).length,
      regular: sd(ks.map(function (k) { return Math.min.apply(null, perDay[k]); }))
    } : null;
  }
  O.socialWeek = R.avg.social * 7;
  O.socialLast14 = sum(days.filter(function (d) { return d.start > addDays(midnight(now()), -14); }).map(function (d) { return d.mins.social; }));
  O.travelWeek = R.avg.travel * 7;
  O.leisureDay = R.avg.leisure;
  // typical day and routine score
  R.typical = typicalDay(valid);
  R.typicalWork = typicalDay(valid.filter(function (d) { return (state.settings.offDays || [0, 6]).indexOf(d.dow) === -1; }));
  R.typicalFree = typicalDay(valid.filter(function (d) { return (state.settings.offDays || [0, 6]).indexOf(d.dow) !== -1; }));
  R.routine = valid.length >= 5 ? Math.round(mean(valid.map(function (d) {
    let same = 0, n = 0;
    for (let i = 0; i < SLOTS; i++) { if (!d.slots[i] || !R.typical[i]) continue; n++; if (d.slots[i] === R.typical[i]) same++; }
    return n ? same / n : 0;
  })) * 100) : null;
  // scores
  valid.concat(days.filter(function (d) { return d.today; })).forEach(function (d) { d.score = dayScore(d, nightsAll); });
  R.sleepScore = sleepScore(R.sleep);
  R.focusScore = focusScore(P);
  R.dayScoreAvg = valid.length ? Math.round(mean(valid.map(function (d) { return d.score; }))) : null;
  R.valueAvg = valid.length ? mean(valid.map(function (d) { return d.value; })) : null;
  // patterns
  R.links = dayLinks(valid, nightsAll);
  R.recipe = bestDayRecipe(valid, nightsAll);
  R.flow = transitions(segsAll);
  R.unusual = unusualDay(days);
  R.trends = weeklyTrends(to);
  R.planVsActual = planVsActual(days);
  R.predict = predictions(R);
  return R;
}
function countLoggedDays() {
  const seen = {};
  liveRanges().forEach(function (r) { for (let d = midnight(r.start); d < r.end; d = addDays(d, 1)) seen[dayKey(d)] = (seen[dayKey(d)] || 0) + (Math.min(r.end, addDays(d, 1)) - Math.max(r.start, d)) / MIN; });
  return Object.keys(seen).filter(function (k) { return seen[k] >= 12 * 60; }).length;
}
function typicalDay(list) {
  const out = [];
  for (let i = 0; i < SLOTS; i++) {
    const c = {};
    list.forEach(function (d) { if (d.slots[i]) c[d.slots[i]] = (c[d.slots[i]] || 0) + 1; });
    let best = null, n = 0;
    for (const k in c) if (c[k] > n) { best = k; n = c[k]; }
    out.push(list.length && n / list.length >= 0.3 ? best : null);
  }
  return out;
}

// ---------- scores (each one explained on the page) ----------
function ctGoalMins(target, op, fallback) {
  const g = (state.settings.ctGoals || []).find(function (x) { return x.target === target && x.op === op && x.per === 'day'; });
  return g ? g.mins : fallback;
}
function dayScore(d, nightsAll) {
  const night = nightsAll.find(function (n) { return n.key === d.key; });
  const need = sleepNeed();
  const prodGoal = ctGoalMins('productive', 'min', 240);
  const budget = ctGoalMins('waste', 'max', 60);
  const sleepPts = night ? 30 * Math.min(1, night.asleep / need) : 0;
  const prodPts = 30 * Math.min(1, d.mins.productive / prodGoal);
  const wastePts = d.mins.waste <= budget ? 20 : 20 * Math.max(0, 1 - (d.mins.waste - budget) / budget);
  const workPts = d.mins.workout >= 20 ? 10 : 10 * d.mins.workout / 20;
  const logPts = 10 * Math.min(1, d.coverage / 0.9);
  return Math.round(sleepPts + prodPts + wastePts + workPts + logPts);
}
function sleepScore(S) {
  if (!S.count) return null;
  const need = sleepNeed();
  const dur = 50 * Math.min(1, S.avg / need);
  const reg = 25 * Math.max(0, 1 - (S.bedSd || 0) / 120);
  const debt = 25 * Math.max(0, 1 - S.debt / 600);
  return Math.round(dur + reg + debt);
}
function focusScore(P) {
  if (P.switches === null) return null;
  return Math.round(60 * Math.min(1, P.deepPerDay / 2) + 40 * Math.max(0, 1 - P.switches / 40));
}

// ---------- links between days (same day and next day) ----------
function dayLinks(valid, nightsAll) {
  if (valid.length < 14) return [];
  const byKey = {};
  valid.forEach(function (d) { byKey[d.key] = d; });
  function night(key) { return nightsAll.find(function (n) { return n.key === key; }); }
  function next(d) { return byKey[dayKey(addDays(d.start, 1))]; }
  function lateWaste(d) { return sum(d.hours.slice(22).map(function (h) { return h.waste || 0; })); }
  function morningWaste(d) { return sum(d.hours.slice(6, 12).map(function (h) { return h.waste || 0; })); }
  const pairs = [
    { id: 'sleep-prod', x: 'sleep', y: 'productive time', get: function (d) { const n = night(d.key); return n ? [n.asleep, d.mins.productive] : null; }, fx: fmtMins, fy: fmtMins, better: 1 },
    { id: 'sleep-waste', x: 'sleep', y: 'wasted time', get: function (d) { const n = night(d.key); return n ? [n.asleep, d.mins.waste] : null; }, fx: fmtMins, fy: fmtMins, better: -1 },
    { id: 'bed-morning', x: 'bedtime', y: 'morning waste', get: function (d) { const n = night(d.key); return n ? [n.bed, morningWaste(d)] : null; }, fx: fmtClockMins, fy: fmtMins, better: -1, lateIsHigh: true },
    { id: 'work-sleep', x: 'workout', y: 'sleep that night', get: function (d) { const n = night(dayKey(addDays(d.start, 1))); return n ? [d.mins.workout, n.asleep] : null; }, fx: fmtMins, fy: fmtMins, better: 1 },
    { id: 'work-prod', x: 'workout', y: 'next-day productive time', get: function (d) { const nx = next(d); return nx ? [d.mins.workout, nx.mins.productive] : null; }, fx: fmtMins, fy: fmtMins, better: 1 },
    { id: 'late-bed', x: 'waste after 10 pm', y: 'bedtime', get: function (d) { const n = night(dayKey(addDays(d.start, 1))); return n ? [lateWaste(d), n.bed] : null; }, fx: fmtMins, fy: fmtClockMins, better: -1 },
    { id: 'mood-prod', x: 'productive time', y: 'mood', get: function (d) { const e = dayEntry(d.key); return e && e.mood ? [d.mins.productive, e.mood] : null; }, fx: fmtMins, fy: function (m) { return m.toFixed(1) + '/5'; }, better: 1 },
    { id: 'mood-waste', x: 'wasted time', y: 'mood', get: function (d) { const e = dayEntry(d.key); return e && e.mood ? [d.mins.waste, e.mood] : null; }, fx: fmtMins, fy: function (m) { return m.toFixed(1) + '/5'; }, better: -1 },
    { id: 'mood-sleep', x: 'sleep', y: 'mood', get: function (d) { const n = night(d.key), e = dayEntry(d.key); return n && e && e.mood ? [n.asleep, e.mood] : null; }, fx: fmtMins, fy: function (m) { return m.toFixed(1) + '/5'; }, better: 1 },
    { id: 'social-mood', x: 'social time', y: 'mood', get: function (d) { const e = dayEntry(d.key); return e && e.mood ? [d.mins.social, e.mood] : null; }, fx: fmtMins, fy: function (m) { return m.toFixed(1) + '/5'; }, better: 1 }
  ];
  const out = [];
  pairs.forEach(function (p) {
    const xs = [], ys = [];
    valid.forEach(function (d) { const v = p.get(d); if (v) { xs.push(v[0]); ys.push(v[1]); } });
    if (xs.length < 12) return;
    const r = pearson(xs, ys);
    if (Math.abs(r) < 0.25) return;
    const cut = median(xs);
    const hi = [], lo = [];
    xs.forEach(function (x, i) { (x > cut ? hi : lo).push(ys[i]); });
    if (hi.length < 4 || lo.length < 4) return;
    out.push({ id: p.id, r: r, n: xs.length, x: p.x, y: p.y, cut: p.fx(cut), above: p.fx === fmtClockMins ? 'later than' : 'above', hi: p.fy(mean(hi)), lo: p.fy(mean(lo)), diff: mean(hi) - mean(lo), fy: p.fy });
  });
  return out.sort(function (a, b) { return Math.abs(b.r) - Math.abs(a.r); });
}
// What your best days (top 20% by Day score) have in common.
function bestDayRecipe(valid, nightsAll) {
  if (valid.length < 10) return null;
  const sorted = valid.slice().sort(function (a, b) { return b.score - a.score; });
  const top = sorted.slice(0, Math.max(2, Math.round(valid.length * 0.2)));
  const rest = sorted.slice(top.length);
  function f(list, fn) { const v = list.map(fn).filter(function (x) { return x !== null && x !== undefined; }); return v.length ? mean(v) : null; }
  function wake(d) { const n = nightsAll.find(function (x) { return x.key === d.key; }); return n ? n.wake : null; }
  function sleepB(d) { const n = nightsAll.find(function (x) { return x.key === d.key; }); return n ? n.asleep : null; }
  const lines = [];
  const wT = f(top, wake), wR = f(rest, wake);
  if (wT !== null && wR !== null && Math.abs(wT - wR) >= 30) lines.push((wT < wR ? 'Up ' + fmtMins(wR - wT) + ' earlier' : 'Up ' + fmtMins(wT - wR) + ' later') + ' (around ' + fmtClockMins(wT) + ')');
  const sT = f(top, sleepB), sR = f(rest, sleepB);
  if (sT !== null && sR !== null && Math.abs(sT - sR) >= 30) lines.push(fmtMins(Math.abs(sT - sR)) + (sT > sR ? ' more' : ' less') + ' sleep the night before');
  const woT = top.filter(function (d) { return d.mins.workout >= 20; }).length / top.length, woR = rest.filter(function (d) { return d.mins.workout >= 20; }).length / Math.max(1, rest.length);
  if (woT - woR >= 0.25) lines.push('A workout on ' + Math.round(woT * 100) + '% of them (vs ' + Math.round(woR * 100) + '% of other days)');
  const fT = f(top, function (d) { return d.firstProd; }), fR = f(rest, function (d) { return d.firstProd; });
  if (fT !== null && fR !== null && fR - fT >= 30) lines.push('Work starts by ' + fmtClockMins(fT) + ' (' + fmtMins(fR - fT) + ' earlier)');
  const lwT = f(top, function (d) { return sum(d.hours.slice(21).map(function (h) { return h.waste || 0; })); });
  const lwR = f(rest, function (d) { return sum(d.hours.slice(21).map(function (h) { return h.waste || 0; })); });
  if (lwT !== null && lwR !== null && lwR - lwT >= 20) lines.push(fmtMins(lwR - lwT) + ' less waste after 9 pm');
  const swT = f(top, function (d) { return d.switches; }), swR = f(rest, function (d) { return d.switches; });
  if (swR - swT >= 4) lines.push('Fewer switches between activities (' + Math.round(swT) + ' vs ' + Math.round(swR) + ')');
  return { n: top.length, score: Math.round(mean(top.map(function (d) { return d.score; }))), lines: lines };
}
// Which activity usually follows which.
function transitions(segs) {
  const from = {}, pairs = {};
  for (let i = 1; i < segs.length; i++) {
    const a = segs[i - 1], b = segs[i];
    if (a.cat === b.cat || b.start - a.end > 10 * MIN) continue;
    from[a.cat] = (from[a.cat] || 0) + 1;
    const k = a.cat + '>' + b.cat;
    pairs[k] = (pairs[k] || 0) + 1;
  }
  return Object.keys(pairs).map(function (k) {
    const p = k.split('>');
    return { a: p[0], b: p[1], n: pairs[k], pct: Math.round(pairs[k] / from[p[0]] * 100) };
  }).filter(function (x) { return x.n >= 3; }).sort(function (a, b) { return b.n - a.n; }).slice(0, 8);
}
// Yesterday compared with the 30 days before it.
function unusualDay(days) {
  const y = days.find(function (d) { return d.key === dayKey(addDays(midnight(now()), -1)); });
  if (!y || !y.valid) return null;
  const before = days.filter(function (d) { return d.valid && d.start < y.start && d.start >= addDays(y.start, -30); });
  if (before.length < 10) return null;
  let best = null;
  ['productive', 'waste', 'workout', 'leisure', 'social', 'sleep'].forEach(function (k) {
    const vals = before.map(function (d) { return d.mins[k]; });
    const m = mean(vals), s = sd(vals) || 1;
    const z = (y.mins[k] - m) / s;
    if (Math.abs(z) >= 2 && Math.abs(y.mins[k] - m) >= 60 && (!best || Math.abs(z) > Math.abs(best.z))) best = { kind: k, z: z, val: y.mins[k], usual: m };
  });
  return best;
}
// Hours per kind for each of the last 8 weeks (Monday to Sunday).
function weeklyTrends(to) {
  const ws = weekStart(Math.min(to - 1, now()));
  const start = addDays(ws, -49);
  const days = buildDays(start, addDays(ws, 7));
  const weeks = [];
  for (let i = 0; i < 8; i++) {
    const a = addDays(start, i * 7), b = addDays(a, 7);
    const list = days.filter(function (d) { return d.start >= a && d.start < b; });
    const w = { start: a, n: list.filter(function (d) { return d.valid || d.today; }).length };
    KIND_IDS.forEach(function (k) { w[k] = sum(list.map(function (d) { return d.mins[k]; })); });
    weeks.push(w);
  }
  const arrows = {};
  KIND_IDS.forEach(function (k) {
    const recent = mean(weeks.slice(4, 7).filter(function (w) { return w.n >= 3; }).map(function (w) { return w[k] / w.n; }));
    const older = mean(weeks.slice(0, 4).filter(function (w) { return w.n >= 3; }).map(function (w) { return w[k] / w.n; }));
    arrows[k] = recent !== null && older !== null ? recent - older : null;
  });
  return { weeks: weeks, arrows: arrows };
}
// 59. Plan vs actual: Plan-my-day hours (task estimates) and timed tasks vs what was painted.
function planVsActual(days) {
  const out = [];
  const recent = days.filter(function (d) { return d.start >= addDays(midnight(now()), -6); });
  let kept = 0, timed = 0;
  recent.forEach(function (d) {
    const tasks = liveTasks().filter(function (t) { const td = taskDate(t); return td !== null && midnight(td) === d.start; });
    const planned = sum(tasks.map(function (t) { return t.est || 0; }));
    tasks.forEach(function (t) {
      if (!t.hasTime || t.due === null || t.due > now()) return;
      const len = (t.est || 60) * MIN;
      const prod = sum(ctSegs(t.due, t.due + len).filter(function (s) { return s.kind === 'productive'; }).map(function (s) { return s.end - s.start; }));
      timed++;
      if (prod >= len / 2) kept++;
    });
    out.push({ key: d.key, start: d.start, planned: planned, actual: d.mins.productive });
  });
  return { days: out, timed: timed, kept: kept };
}
// 60. Predictions.
function predictions(R) {
  const P = {};
  const S = R.sleep;
  if (S.count) {
    P.sleepNow = { wakeAt: now() + S.avg * MIN, hours: S.avg };
    if (S.wake !== null) {
      let wakeAt = midnight(now()) + S.wake * MIN;
      if (wakeAt < now() + 2 * HOUR) wakeAt = addDays(wakeAt, 1);
      P.untilUsualWake = (wakeAt - now()) / MIN;
      P.usualWakeAt = wakeAt;
    }
  }
  const ws = weekStart(now());
  const thisWeek = R.days.filter(function (d) { return d.start >= ws; });
  const soFar = sum(thisWeek.map(function (d) { return d.mins.productive; }));
  const left = 7 - thisWeek.length + (thisWeek.some(function (d) { return d.today; }) ? 0.5 : 0);
  P.weekProd = { soFar: soFar, projected: soFar + Math.max(0, left) * R.avg.productive };
  return P;
}
