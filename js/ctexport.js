/* =========================================================
   ColorTracker export: your time log for an AI (or any other app).
   Pick how many days (7, 15, 30 … up to 365) and a format:
   - "For an AI": plain text, one line per block ("07:30–08:30  Essentials (1h)"),
     day by day, with notes, 👍/👎, gaps and daily totals, plus your question on top.
     Paste it into ChatGPT / Claude / Gemini and ask about your patterns.
   - JSON: the same data, structured, for scripts or AI tools that read files.
   - CSV: every block as a spreadsheet row.
   Copy to the clipboard or download a file. Nothing is sent anywhere by the app.
   ========================================================= */

const CTX_DAY_CHOICES = [7, 15, 30, 90, 365];
const CTX_DEFAULT_PROMPT = 'Below is my time log from my ColorTracker app: what I did, hour by hour, for each day. ' +
  'Please study it and tell me: my real daily patterns (sleep, when I focus best, when I waste time), what pulls my good days ' +
  'up and my bad days down, and 3 to 5 specific, realistic changes that would make my days more productive. ' +
  'Ask me questions if something is unclear.';

function ctxOpts() {
  const o = state.ui.ctExport || {};
  return {
    days: Math.max(1, Math.min(365, Number(o.days) || 7)),
    format: o.format === 'json' || o.format === 'csv' ? o.format : 'text',
    notes: o.notes !== false,
    totals: o.totals !== false,
    prompt: typeof o.prompt === 'string' ? o.prompt : CTX_DEFAULT_PROMPT
  };
}
function ctxSet(key, val) {
  const o = ctxOpts();
  o[key] = val;
  state.ui.ctExport = o;
  save();
}
// "2026-11-10T01:25:00+05:30": the local time with its offset, so an AI reads the right hour.
function localISO(t) {
  const d = new Date(t);
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const p = function (n) { return String(Math.floor(Math.abs(n))).padStart(2, '0'); };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':00' +
    sign + p(off / 60) + ':' + p(off % 60);
}
function hhmm(t, dayStart) {
  if (t - dayStart >= DAY) return '24:00';
  const d = new Date(t);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}
function ctxTimezone() {
  let tz = '';
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) {}
  const iso = localISO(now());
  return (tz ? tz + ', ' : '') + 'UTC' + iso.slice(-6);
}

// The log as plain data: one entry per block, cut at midnight so every entry belongs to one day.
function ctxCollect(days) {
  const today = midnight(now());
  const first = addDays(today, -(days - 1));
  const byId = {};
  state.ranges.forEach(function (r) { byId[r.id] = r; });
  const out = [];
  for (let d = first; d <= today; d = addDays(d, 1)) {
    const end = Math.min(addDays(d, 1), now());
    const segs = segmentsIn(d, end);
    const entries = segs.map(function (s) {
      const r = byId[s.id] || {};
      return {
        start: s.start, end: s.end, minutes: Math.round((s.end - s.start) / MIN),
        activity: rangeName(s), kind: catKind(s.cat), sub: (findCat(s.cat) || {}).sub || null,
        note: r.note || '', worth: r.worth > 0 ? true : r.worth < 0 ? false : null,
        fromYesterday: s.start === d && r.start < d,
        intoTomorrow: s.end === addDays(d, 1) && r.end > s.end
      };
    });
    const totals = {};
    entries.forEach(function (e) { totals[e.activity] = (totals[e.activity] || 0) + e.minutes; });
    const logged = entries.reduce(function (a, e) { return a + e.minutes; }, 0);
    out.push({ day: d, isToday: d === today, upTo: end, entries: entries, totals: totals, unlogged: Math.max(0, Math.round((end - d) / MIN) - logged) });
  }
  return out;
}
function ctxActivities() {
  return state.categories.filter(function (c) { return !c.deleted; }).map(function (c) {
    return { name: c.name, kind: catKind(c.id), sub: c.sub || null, value: c.value === undefined ? null : c.value };
  });
}

function ctxText(o) {
  const log = ctxCollect(o.days);
  const withData = log.filter(function (x) { return x.entries.length; }).length;
  const lines = [];
  if (o.prompt.trim()) lines.push(o.prompt.trim(), '');
  lines.push('# My time log (TaskStack ColorTracker)');
  lines.push('Exported: ' + new Date().toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' · time zone ' + ctxTimezone());
  lines.push('Range: ' + new Date(log[0].day).toDateString() + ' to ' + new Date(log[log.length - 1].day).toDateString() + ' (' + o.days + (o.days === 1 ? ' day' : ' days') + ', ' + withData + ' with entries). Times are 24-hour local time. Today is only up to now.');
  lines.push('');
  lines.push('## My activities (name: kind)');
  ctxActivities().forEach(function (a) {
    lines.push('- ' + a.name + ': ' + kindInfo(a.kind).name.toLowerCase() + (a.sub ? ' (' + a.sub + ')' : '') + (a.value ? ', I rate it ' + (a.value > 0 ? '+' : '') + a.value : ''));
  });
  lines.push('');
  lines.push('## Day by day');
  log.forEach(function (x) {
    lines.push('', '### ' + new Date(x.day).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) + (x.isToday ? ' (today, so far)' : ''));
    if (!x.entries.length) { lines.push('(nothing logged)'); return; }
    x.entries.forEach(function (e) {
      let l = hhmm(e.start, x.day) + '–' + hhmm(e.end, x.day) + '  ' + e.activity + ' (' + fmtEst(e.minutes) + ')';
      if (e.fromYesterday) l += ' [started the day before]';
      if (e.intoTomorrow) l += ' [goes on into the next day]';
      if (o.notes && e.note) l += ' | note: ' + e.note.replace(/\s+/g, ' ');
      if (o.notes && e.worth !== null) l += ' | worth it: ' + (e.worth ? 'yes' : 'no');
      lines.push(l);
    });
    if (o.totals) {
      lines.push('Totals: ' + Object.keys(x.totals).sort(function (a, b) { return x.totals[b] - x.totals[a]; }).map(function (k) { return k + ' ' + fmtEst(x.totals[k]); }).join(', ') +
        (x.unlogged >= 15 ? '. Not logged: ' + fmtEst(x.unlogged) : ''));
    }
  });
  return lines.join('\n') + '\n';
}
function ctxJSON(o) {
  const log = ctxCollect(o.days);
  return JSON.stringify({
    app: 'TaskStack ColorTracker',
    exported: localISO(now()),
    timeZone: ctxTimezone(),
    note: 'Times are local. Each entry belongs to one calendar day; a block that crosses midnight is split and flagged. "kind" is how the app counts the activity.',
    range: { from: dayKey(log[0].day), to: dayKey(log[log.length - 1].day), days: o.days },
    activities: ctxActivities(),
    days: log.map(function (x) {
      const day = {
        date: dayKey(x.day), weekday: new Date(x.day).toLocaleDateString('en', { weekday: 'long' }), partial: x.isToday,
        entries: x.entries.map(function (e) {
          const out = { start: localISO(e.start).slice(11, 16), end: hhmm(e.end, x.day), minutes: e.minutes, activity: e.activity, kind: e.kind };
          if (e.sub) out.subKind = e.sub;
          if (o.notes && e.note) out.note = e.note;
          if (o.notes && e.worth !== null) out.worthIt = e.worth;
          if (e.fromYesterday) out.startedDayBefore = true;
          if (e.intoTomorrow) out.goesIntoNextDay = true;
          return out;
        })
      };
      if (o.totals) { day.totalsMinutes = x.totals; day.notLoggedMinutes = x.unlogged; }
      return day;
    })
  }, null, 1);
}
function ctxCSV(o) {
  function cell(v) { v = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
  const rows = [['Date', 'Weekday', 'Start', 'End', 'Minutes', 'Activity', 'Kind', 'Note', 'Worth it']];
  ctxCollect(o.days).forEach(function (x) {
    x.entries.forEach(function (e) {
      rows.push([dayKey(x.day), new Date(x.day).toLocaleDateString('en', { weekday: 'short' }), hhmm(e.start, x.day), hhmm(e.end, x.day), e.minutes, e.activity, kindInfo(e.kind).name,
        o.notes ? e.note : '', o.notes && e.worth !== null ? (e.worth ? 'yes' : 'no') : '']);
    });
  });
  return rows.map(function (r) { return r.map(cell).join(','); }).join('\n') + '\n';
}
function ctxBuild(o) { return o.format === 'json' ? ctxJSON(o) : o.format === 'csv' ? ctxCSV(o) : ctxText(o); }

function ctExportHTML() {
  const o = ctxOpts();
  const text = ctxBuild(o);
  const custom = CTX_DAY_CHOICES.indexOf(o.days) === -1;
  const preview = text.split('\n').slice(0, 14).join('\n');
  const kb = Math.max(1, Math.round(text.length / 1024));
  return '<div class="tsh-bar"><h3>Export my time log</h3><button class="btn small primary" data-action="close">Close</button></div>' +
    '<p class="small">Every block you painted, with its date and time, ready to paste into an AI (ChatGPT, Claude, Gemini…) so it can look at your patterns in depth.</p>' +
    '<p class="label">How many days</p><div class="pickrow wrap">' + CTX_DAY_CHOICES.map(function (n) {
      return '<button class="pick' + (o.days === n ? ' on' : '') + '" data-action="ctxdays" data-n="' + n + '">' + (n === 365 ? '1 year' : n + ' days') + '</button>';
    }).join('') + '</div>' +
    '<div class="daterow ctx-custom"><span class="small">Or exactly</span><input type="number" id="ctxDays" min="1" max="365" value="' + o.days + '" aria-label="Number of days (1 to 365)"' + (custom ? ' class="on"' : '') + '><span class="small">days (max 365), ending today</span></div>' +
    '<p class="label">Format</p><div class="seg ctx-fmt">' +
      [['text', 'For an AI'], ['json', 'JSON'], ['csv', 'CSV']].map(function (f) { return '<button class="' + (o.format === f[0] ? 'on' : '') + '" data-action="ctxfmt" data-f="' + f[0] + '">' + f[1] + '</button>'; }).join('') + '</div>' +
    '<p class="small">' + (o.format === 'text' ? 'Easy to read for you and for any AI. Best for pasting into a chat.' : o.format === 'json' ? 'Structured data, for AI tools that take files or your own scripts.' : 'Opens in Excel or Google Sheets.') + '</p>' +
    '<div class="pickrow wrap"><button class="pick' + (o.notes ? ' on' : '') + '" data-action="ctxtog" data-k="notes">Notes and 👍/👎</button>' +
      '<button class="pick' + (o.totals ? ' on' : '') + '" data-action="ctxtog" data-k="totals">Daily totals</button></div>' +
    (o.format === 'text' ? '<p class="label">Question for the AI (goes on top, edit it as you like)</p>' +
      '<textarea class="text-input ctx-prompt" id="ctxPrompt" rows="4" aria-label="Question for the AI">' + esc(o.prompt) + '</textarea>' +
      '<button class="linkbtn" data-action="ctxprompt">Use the default question</button>' : '') +
    '<p class="label">Preview <span class="small">· ' + text.split('\n').length + ' lines · ' + kb + ' KB</span></p>' +
    '<pre class="ctx-pre">' + esc(preview) + (text.split('\n').length > 14 ? '\n…' : '') + '</pre>' +
    '<div class="row"><button class="btn" data-action="ctxdownload">⬇ Download file</button><button class="btn primary" data-action="ctxcopy">📋 Copy</button></div>' +
    '<p class="small">Nothing leaves your device until you paste or share it yourself.</p>';
}
function ctxRefresh() { if (sheetCtx && sheetCtx.type === 'ctexport') refreshSheet(ctExportHTML()); }
actions.ctexport = function () { openSheet({ type: 'ctexport' }, ctExportHTML()); };
actions.ctxdays = function (el) { ctxSet('days', Number(el.dataset.n)); ctxRefresh(); };
actions.ctxfmt = function (el) { ctxSet('format', el.dataset.f); ctxRefresh(); };
actions.ctxtog = function (el) { const o = ctxOpts(); ctxSet(el.dataset.k, !o[el.dataset.k]); ctxRefresh(); };
actions.ctxprompt = function () { ctxSet('prompt', CTX_DEFAULT_PROMPT); ctxRefresh(); };
actions.ctxcopy = function () {
  const text = ctxBuild(ctxOpts());
  function done() { haptic(10); toast('Copied ' + ctxOpts().days + ' days. Paste it into your AI chat.'); }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done, function () { ctxCopyFallback(text); done(); });
  } else { ctxCopyFallback(text); done(); }
};
function ctxCopyFallback(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); } catch (e) {}
  ta.remove();
}
actions.ctxdownload = function () {
  const o = ctxOpts();
  const ext = o.format === 'json' ? 'json' : o.format === 'csv' ? 'csv' : 'txt';
  downloadFile('colortracker-' + o.days + 'days-' + dayKey() + '.' + ext, ctxBuild(o), o.format === 'json' ? 'application/json' : o.format === 'csv' ? 'text/csv' : 'text/plain');
  toast('Downloaded ' + o.days + ' days of your time log.');
};
$('sheet').addEventListener('change', function (e) {
  if (e.target.id === 'ctxDays') {
    let n = Math.round(Number(e.target.value));
    if (!n || n < 1) n = 1;
    if (n > 365) { n = 365; toast('365 days is the most.'); }
    ctxSet('days', n);
    ctxRefresh();
  } else if (e.target.id === 'ctxPrompt') { ctxSet('prompt', e.target.value); ctxRefresh(); }
});
$('sheet').addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.id === 'ctxDays') { e.preventDefault(); e.target.blur(); } });
