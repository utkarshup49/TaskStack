/* =========================================================
   Notes (v0.16): notebooks of two kinds.
   - Daily: a page for every date (e.g. "Eating", "Journal"). Opens on today; the strip
     shows only the days you wrote on (plus today); the calendar button opens any date.
     Copy yesterday, the previous day faded underneath, Day | Week view, writing streak.
   - Page: one long note with no dates (ideas, lists).
   Writing is plain text with simple formatting you can also type yourself:
     # Heading   ## Small heading   **bold**   *italic*   ~~strike~~
     - bullet    1. numbered        - [ ] checkbox (tick it in the note)   ---  line
   Lists carry on when you press Enter (Enter on an empty item ends the list).
   Links become clickable. Voice typing, "Make task" from a line, search across all notes.
   The built-in Journal notebook *is* the day note from Wrap up (state.days[...].note):
   write in either place and it shows in both.
   Data: state.notebooks { id, name, type 'daily'|'page', icon, color, pinned, order },
         state.notes { id, nb, day 'YYYY-MM-DD' | null, text } (daily id = nb + '_' + day,
         page id = nb + '_page', so two devices never make two copies of the same page).
   ========================================================= */

const NB_ICONS = ['📔', '🍽️', '💪', '💡', '📚', '🧠', '💼', '🎯', '✈️', '💰', '🎵', '🌱', '❤️', '🧾', '📝', '⭐'];
const NB_COLORS = ['#7c3aed', '#0369a1', '#16a34a', '#ca8a04', '#ea580c', '#dc2626', '#db2777', '#0d9488', '#4f46e5', '#64748b'];

let noteNb = null;        // the open notebook (id) or null = the list of notebooks
let noteDay = null;       // the open day of a daily notebook ("YYYY-MM-DD")
let noteEditing = false;  // typing (true) or reading with tickable boxes (false)
let noteWeek = false;     // daily notebook: Day or Week view
let noteSaveT = 0;        // typing pauses before saving
let noteVoice = null;     // speech recognition while voice typing
let noteFind = '';        // text in the search box

// ---------- data ----------
function liveNotebooks() {
  return (state.notebooks || []).filter(function (n) { return !n.deleted; }).sort(function (a, b) {
    return (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (a.order || 0) - (b.order || 0) || a.name.localeCompare(b.name);
  });
}
function findNotebook(id) { return (state.notebooks || []).find(function (n) { return n.id === id && !n.deleted; }) || null; }
function noteId(nb, day) { return nb + (day ? '_' + day : '_page'); }
function noteRec(nb, day) {
  if (nb === 'journal') {
    const d = dayEntry(day);
    return d && d.note ? { text: d.note, updatedAt: d.updatedAt || 0 } : null;
  }
  const id = noteId(nb, day);
  return (state.notes || []).find(function (n) { return n.id === id && !n.deleted; }) || null;
}
function noteText(nb, day) { const r = noteRec(nb, day); return r ? r.text : ''; }
function setNoteText(nb, day, text) {
  if (nb === 'journal') { setDay(day, { note: text }); return; }
  const id = noteId(nb, day);
  let n = state.notes.find(function (x) { return x.id === id; });
  if (!n) { n = { id: id, nb: nb, day: day || null, text: '' }; state.notes.push(n); }
  n.text = text;
  n.deleted = false;
  n.updatedAt = now();
  save();
}
// Days with something written, oldest first.
function writtenDays(nb) {
  if (nb === 'journal') return state.days.filter(function (d) { return !d.deleted && /^\d{4}-\d{2}-\d{2}$/.test(d.id) && d.note && d.note.trim(); }).map(function (d) { return d.id; }).sort();
  return state.notes.filter(function (n) { return n.nb === nb && !n.deleted && n.day && n.text.trim(); }).map(function (n) { return n.day; }).sort();
}
function keyToMs(k) { const p = k.split('-'); return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])).getTime(); }
// Days in a row with writing, ending today (or yesterday, so the streak isn't "lost" before you write today).
function noteStreak(nb) {
  const set = {};
  writtenDays(nb).forEach(function (k) { set[k] = true; });
  let d = midnight(now());
  if (!set[dayKey(d)]) d = addDays(d, -1);
  let n = 0;
  while (set[dayKey(d)]) { n++; d = addDays(d, -1); }
  return n;
}
function nbMeta(nb) {
  if (nb.type === 'page') {
    const r = noteRec(nb.id, null);
    const words = r ? (r.text.match(/\S+/g) || []).length : 0;
    return r && r.text.trim() ? 'Edited ' + timeAgo(r.updatedAt) + ' · ' + words + (words === 1 ? ' word' : ' words') : 'Empty page';
  }
  const days = writtenDays(nb.id);
  const today = days.indexOf(dayKey()) !== -1;
  const st = noteStreak(nb.id);
  return (today ? 'Today written' : 'Today: not written yet') + (st > 1 ? ' · 🔥 ' + st + ' days' : '') + ' · ' + days.length + (days.length === 1 ? ' day' : ' days');
}
function timeAgo(t) {
  const m = Math.round((now() - t) / MIN);
  if (m < 1) return 'just now';
  if (m < 60) return m + ' min ago';
  if (m < 60 * 24) return Math.round(m / 60) + ' h ago';
  if (m < 60 * 24 * 7) return Math.round(m / 60 / 24) + ' days ago';
  return new Date(t).toLocaleDateString([], { day: 'numeric', month: 'short' });
}

// ---------- formatting: plain text → what you see ----------
function mdInline(s) {
  s = esc(s);
  s = s.replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  s = s.replace(/(^|[^*])\*([^*\s][^*]*?)\*(?!\*)/g, '$1<i>$2</i>');
  s = s.replace(/~~([^~]+)~~/g, '<s>$1</s>');
  return s;
}
// Line by line. Each line keeps its number (data-line) so a tap can tick the right box.
function mdRender(text) {
  const lines = text.split('\n');
  let html = '', list = '';
  function close() { if (list) { html += '</' + list + '>'; list = ''; } }
  function open(kind) { if (list !== kind) { close(); html += '<' + kind + ' class="nl">'; list = kind; } }
  lines.forEach(function (raw, i) {
    const ind = (raw.match(/^\s*/)[0].replace(/\t/g, '  ').length / 2) | 0;
    const line = raw.trim();
    const pad = ind ? ' style="margin-left:' + Math.min(ind, 6) * 18 + 'px"' : '';
    let m;
    if (!line) { close(); html += '<div class="nsp"></div>'; return; }
    if ((m = line.match(/^[-*]\s+\[( |x|X)\]\s?(.*)$/))) {
      open('ul');
      const on = m[1] !== ' ';
      html += '<li class="nchk' + (on ? ' on' : '') + '"' + pad + '><button class="nbox" data-action="ntick" data-line="' + i + '" aria-pressed="' + on + '" aria-label="' + (on ? 'Untick' : 'Tick') + '">' + TICK_SVG + '</button><span>' + mdInline(m[2]) + '</span></li>';
      return;
    }
    if ((m = line.match(/^[-*•]\s+(.*)$/))) { open('ul'); html += '<li class="nbul"' + pad + '><span>' + mdInline(m[1]) + '</span></li>'; return; }
    if ((m = line.match(/^(\d+)[.)]\s+(.*)$/))) { open('ol'); html += '<li class="nnum"' + pad + '><em>' + m[1] + '.</em><span>' + mdInline(m[2]) + '</span></li>'; return; }
    close();
    if ((m = line.match(/^##\s+(.*)$/))) { html += '<h5 class="nh2">' + mdInline(m[1]) + '</h5>'; return; }
    if ((m = line.match(/^#\s+(.*)$/))) { html += '<h4 class="nh1">' + mdInline(m[1]) + '</h4>'; return; }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) { html += '<hr class="nhr">'; return; }
    if ((m = line.match(/^>\s?(.*)$/))) { html += '<p class="nq">' + mdInline(m[1]) + '</p>'; return; }
    html += '<p class="np"' + pad + '>' + mdInline(raw.replace(/^\s+/, '')) + '</p>';
  });
  close();
  return html;
}
// First real line, as plain text (for previews).
function notePreview(text, len) {
  const l = text.split('\n').map(function (x) { return x.replace(/^[-*#>\d.)\s[\]xX]+/, '').replace(/[*~]/g, '').trim(); }).filter(Boolean)[0] || '';
  return l.length > (len || 70) ? l.slice(0, (len || 70) - 1) + '…' : l;
}

// ---------- screens ----------
let noteRestored = false;
function renderNotes() {
  const wrap = $('notesWrap');
  if (!wrap) return;
  if (!noteRestored) {               // reopen the notebook you had open last time
    noteRestored = true;
    if (state.ui.noteLast && findNotebook(state.ui.noteLast)) { noteNb = state.ui.noteLast; noteDay = findNotebook(noteNb).type === 'daily' ? dayKey() : null; }
  }
  if (noteNb && !findNotebook(noteNb)) noteNb = null;
  const wide = window.innerWidth >= 1100;
  wrap.classList.toggle('wide', wide);
  wrap.classList.toggle('open', !!noteNb);
  // laptop: notebooks on the left, the open one on the right. Phone: one or the other.
  const list = '<div class="nlist">' + notesHomeHTML() + '</div>';
  const page = noteNb ? '<div class="npage">' + notebookHTML() + '</div>' : (wide ? '<div class="npage nempty"><p class="small">Pick a notebook on the left, or make a new one.</p></div>' : '');
  const keepFocus = document.activeElement && document.activeElement.id === 'noteFindIn';
  const caret = keepFocus ? document.activeElement.selectionStart : 0;
  wrap.innerHTML = wide || !noteNb ? list + page : page;
  if (keepFocus && $('noteFindIn')) { $('noteFindIn').focus(); $('noteFindIn').setSelectionRange(caret, caret); }
  const ta = $('noteText');
  if (ta) { noteGrow(ta); }
  const strip = document.querySelector('.ndays');
  if (strip) { const on = strip.querySelector('.on'); if (on) strip.scrollLeft = on.offsetLeft - strip.clientWidth / 2 + on.offsetWidth / 2; }
}
function notesHomeHTML() {
  const nbs = liveNotebooks();
  let h = '<div class="nhome-top"><input class="text-input" id="noteFindIn" placeholder="Search all notes" value="' + esc(noteFind) + '" aria-label="Search all notes" autocomplete="off">' +
    '<button class="btn primary" data-action="nbnew">+ New</button></div>';
  if (noteFind.trim()) return h + noteSearchHTML(noteFind.trim());
  function row(nb) {
    return '<button class="nbrow' + (nb.id === noteNb ? ' on' : '') + '" data-action="nbopen" data-id="' + nb.id + '" style="--nc:' + nb.color + '">' +
      '<span class="nbicon">' + esc(nb.icon || '📝') + '</span><span class="nbtxt"><b>' + esc(nb.name) + (nb.pinned ? ' <i class="nbpin" title="Pinned">📌</i>' : '') + '</b>' +
      '<span class="small">' + esc(nbMeta(nb)) + '</span></span>' +
      (nb.type === 'daily' && writtenDays(nb.id).indexOf(dayKey()) === -1 ? '<span class="nbdue">Write today</span>' : '') + '</button>';
  }
  const pinned = nbs.filter(function (n) { return n.pinned; });
  const daily = nbs.filter(function (n) { return !n.pinned && n.type === 'daily'; });
  const pages = nbs.filter(function (n) { return !n.pinned && n.type === 'page'; });
  if (pinned.length) h += '<p class="label">Pinned</p><div class="nbgroup">' + pinned.map(row).join('') + '</div>';
  if (daily.length) h += '<p class="label">Daily notebooks</p><div class="nbgroup">' + daily.map(row).join('') + '</div>';
  if (pages.length) h += '<p class="label">Pages</p><div class="nbgroup">' + pages.map(row).join('') + '</div>';
  if (!nbs.length) h += '<p class="small">No notebooks yet. Tap + New.</p>';
  h += '<p class="small nhint">Daily notebooks have a page for every date (food, journal, gym). Pages are one long note.</p>';
  return h;
}
function noteSearchHTML(q) {
  const ql = q.toLowerCase();
  const hits = [];
  liveNotebooks().forEach(function (nb) {
    if (nb.name.toLowerCase().indexOf(ql) !== -1) hits.push({ nb: nb, day: null, text: '', name: true, at: 1e15 });
    const recs = nb.type === 'page' ? [{ day: null, r: noteRec(nb.id, null) }] : writtenDays(nb.id).map(function (d) { return { day: d, r: noteRec(nb.id, d) }; });
    recs.forEach(function (x) {
      if (!x.r) return;
      const i = x.r.text.toLowerCase().indexOf(ql);
      if (i === -1) return;
      const start = Math.max(0, i - 30);
      hits.push({ nb: nb, day: x.day, at: x.day ? keyToMs(x.day) : x.r.updatedAt, snip: (start ? '…' : '') + x.r.text.slice(start, i + q.length + 50).replace(/\n/g, ' ') });
    });
  });
  hits.sort(function (a, b) { return b.at - a.at; });
  const re = new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig');
  return '<p class="label">' + hits.length + (hits.length === 1 ? ' match' : ' matches') + '</p><div class="nbgroup">' + hits.slice(0, 60).map(function (h) {
    return '<button class="nbrow nhit" data-action="nbopen" data-id="' + h.nb.id + '"' + (h.day ? ' data-day="' + h.day + '"' : '') + ' style="--nc:' + h.nb.color + '">' +
      '<span class="nbicon">' + esc(h.nb.icon || '📝') + '</span><span class="nbtxt"><b>' + esc(h.nb.name) + (h.day ? ' · ' + new Date(keyToMs(h.day)).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : '') + '</b>' +
      (h.snip ? '<span class="small">' + esc(h.snip).replace(re, '<mark>$1</mark>') + '</span>' : '') + '</span></button>';
  }).join('') + '</div>' + (hits.length ? '' : '<p class="small">Nothing found.</p>');
}

function notebookHTML() {
  const nb = findNotebook(noteNb);
  const back = '<button class="icon-btn sm nback" data-action="nbback" aria-label="All notebooks">‹</button>';
  let h = '<div class="nhead" style="--nc:' + nb.color + '">' + back + '<span class="nbicon">' + esc(nb.icon || '📝') + '</span>' +
    '<div class="nhead-t"><h2>' + esc(nb.name) + '</h2><span class="small">' + esc(nbMeta(nb)) + '</span></div>' +
    '<button class="icon-btn sm" data-action="nbsettings" aria-label="Notebook settings" title="Rename, icon, colour, pin, delete">⋯</button></div>';
  if (nb.type === 'page') return h + noteEditorHTML(nb, null);
  if (!noteDay) noteDay = dayKey();
  const days = writtenDays(nb.id);
  const today = dayKey();
  const shown = days.slice();
  if (shown.indexOf(today) === -1) shown.push(today);
  if (shown.indexOf(noteDay) === -1) shown.push(noteDay);
  shown.sort();
  h += '<div class="nbar"><div class="ndays" role="tablist" aria-label="Days with notes">' + shown.map(function (k) {
      const d = new Date(keyToMs(k));
      const empty = days.indexOf(k) === -1;
      return '<button class="nday' + (k === noteDay ? ' on' : '') + (empty ? ' empty' : '') + '" data-action="nday" data-day="' + k + '">' +
        '<span>' + (k === today ? 'Today' : d.toLocaleDateString([], { weekday: 'short' })) + '</span><b>' + d.getDate() + '</b><span>' + d.toLocaleDateString([], { month: 'short' }) + '</span></button>';
    }).join('') + '</div>' +
    '<button class="icon-btn sm" data-action="ndaypick" aria-label="Open any date" title="Open any date">' + CAL_SVG + '</button></div>' +
    '<div class="nmode"><div class="seg"><button class="' + (!noteWeek ? 'on' : '') + '" data-action="nweek" data-w="0">Day</button><button class="' + (noteWeek ? 'on' : '') + '" data-action="nweek" data-w="1">Week</button></div>' +
    (noteWeek ? '' : '<div class="nstep"><button class="icon-btn sm" data-action="nstep" data-d="-1" aria-label="Previous written day">‹</button><button class="icon-btn sm" data-action="nstep" data-d="1" aria-label="Next written day">›</button></div>') + '</div>';
  if (noteWeek) return h + noteWeekHTML(nb);
  const d = new Date(keyToMs(noteDay));
  h += '<h3 class="ndate">' + d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' }) + (noteDay === today ? ' <span class="small">today</span>' : '') + '</h3>';
  h += noteEditorHTML(nb, noteDay);
  // the last written day before this one, faded, for reference (and to copy from)
  const prev = days.filter(function (k) { return k < noteDay; }).pop();
  if (prev) {
    const pd = new Date(keyToMs(prev));
    const label = prev === dayKey(addDays(keyToMs(noteDay), -1)) ? 'Yesterday' : pd.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' });
    if (!noteText(nb.id, noteDay).trim()) h += '<button class="btn small ncopy" data-action="ncopy" data-from="' + prev + '">Copy ' + (label === 'Yesterday' ? 'yesterday' : label) + '</button>';
    h += '<div class="nprev"><button class="nprev-h" data-action="nday" data-day="' + prev + '">' + esc(label) + ' · open</button><div class="nview faded">' + mdRender(noteText(nb.id, prev)) + '</div></div>';
  }
  return h;
}
function noteWeekHTML(nb) {
  const start = weekStart(keyToMs(noteDay));
  let h = '<div class="nweek">';
  for (let i = 0; i < 7; i++) {
    const d = addDays(start, i);
    const k = dayKey(d);
    const t = noteText(nb.id, k);
    h += '<button class="nwday' + (t.trim() ? '' : ' empty') + (k === dayKey() ? ' today' : '') + '" data-action="nopenday" data-day="' + k + '">' +
      '<span class="nwd">' + new Date(d).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' }) + '</span>' +
      (t.trim() ? '<div class="nview">' + mdRender(t) + '</div>' : '<span class="small">Nothing written. Tap to write.</span>') + '</button>';
  }
  return h + '</div><div class="row"><button class="btn small" data-action="nweekstep" data-d="-1">‹ Previous week</button><button class="btn small" data-action="nweekstep" data-d="1">Next week ›</button></div>';
}
function noteEditorHTML(nb, day) {
  const r = noteRec(nb.id, day);
  const text = r ? r.text : '';
  if (!text.trim()) noteEditing = true;
  const foot = '<p class="small nfoot">' + (r && text.trim() ? 'Saved · edited ' + timeAgo(r.updatedAt) + ' · ' + (text.match(/\S+/g) || []).length + ' words' : 'Saves as you type') + '</p>';
  if (!noteEditing) {
    return '<div class="nview nmain" data-action="nedit" title="Tap to edit">' + mdRender(text) + '</div>' +
      '<div class="row nrow"><button class="btn" data-action="nedit">✏️ Edit</button></div>' + foot;
  }
  const voice = (window.SpeechRecognition || window.webkitSpeechRecognition) ? '<button class="ntool" data-action="nvoice" id="nVoiceBtn" aria-label="Voice typing" title="Voice typing">🎤</button>' : '';
  return '<div class="ntools" role="toolbar" aria-label="Formatting">' +
      '<button class="ntool" data-action="nfmt" data-f="b" aria-label="Bold" title="Bold (Ctrl+B)"><b>B</b></button>' +
      '<button class="ntool" data-action="nfmt" data-f="i" aria-label="Italic" title="Italic (Ctrl+I)"><i>I</i></button>' +
      '<button class="ntool" data-action="nfmt" data-f="s" aria-label="Strikethrough" title="Strikethrough"><s>S</s></button>' +
      '<button class="ntool" data-action="nfmt" data-f="h" aria-label="Heading" title="Heading">H</button>' +
      '<button class="ntool" data-action="nfmt" data-f="ul" aria-label="Bullet list" title="Bullet list">•</button>' +
      '<button class="ntool" data-action="nfmt" data-f="ol" aria-label="Numbered list" title="Numbered list">1.</button>' +
      '<button class="ntool" data-action="nfmt" data-f="cb" aria-label="Checkbox" title="Checkbox">☐</button>' +
      '<button class="ntool" data-action="nfmt" data-f="hr" aria-label="Divider line" title="Divider line">—</button>' +
      voice +
      '<button class="ntool wide" data-action="ntask" title="Make a task from the line the cursor is on">→ Task</button>' +
      '<button class="ntool done" data-action="ndone">Done</button></div>' +
    '<textarea class="ntext" id="noteText" placeholder="' + (day ? 'Write about this day…' : 'Start writing…') + '" aria-label="Note" spellcheck="true">' + esc(text) + '</textarea>' + foot;
}

// ---------- typing ----------
function noteGrow(ta) { ta.style.height = 'auto'; ta.style.height = Math.max(220, ta.scrollHeight + 4) + 'px'; }
function noteSaveNow() {
  clearTimeout(noteSaveT);
  const ta = $('noteText');
  if (!ta || !noteNb) return;
  const nb = findNotebook(noteNb);
  if (!nb) return;
  const day = nb.type === 'daily' ? noteDay : null;
  if (ta.value === noteText(noteNb, day)) return;
  setNoteText(noteNb, day, ta.value);
  const foot = document.querySelector('.nfoot');
  if (foot) foot.textContent = 'Saved · ' + (ta.value.match(/\S+/g) || []).length + ' words';
  if (typeof renderPlanBits === 'function' && noteNb === 'journal') renderPlanBits();
}
document.addEventListener('input', function (e) {
  if (e.target.id === 'noteText') {
    noteGrow(e.target);
    clearTimeout(noteSaveT);
    noteSaveT = setTimeout(noteSaveNow, 500);
  } else if (e.target.id === 'noteFindIn') {
    noteFind = e.target.value;
    renderNotes();
  }
});
document.addEventListener('focusout', function (e) { if (e.target.id === 'noteText') noteSaveNow(); });
window.addEventListener('pagehide', noteSaveNow);
document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') noteSaveNow(); });

// Put text in at the cursor the way typing would, so the phone's / browser's own Undo still works.
function noteInsert(ta, text, selectFrom, selectTo) {
  ta.focus();
  let ok = false;
  try { ok = document.execCommand('insertText', false, text); } catch (e) { ok = false; }
  if (!ok) {
    const a = ta.selectionStart, b = ta.selectionEnd;
    ta.value = ta.value.slice(0, a) + text + ta.value.slice(b);
    ta.selectionStart = ta.selectionEnd = a + text.length;
  }
  if (selectFrom !== undefined) { ta.selectionStart = selectFrom; ta.selectionEnd = selectTo; }
  ta.dispatchEvent(new Event('input', { bubbles: true }));
}
function lineBounds(v, pos) {
  const s = v.lastIndexOf('\n', pos - 1) + 1;
  let e = v.indexOf('\n', pos);
  if (e === -1) e = v.length;
  return { s: s, e: e, text: v.slice(s, e) };
}
// Lists carry on with Enter; an empty item ends the list. Tab / Shift+Tab indent list lines.
document.addEventListener('keydown', function (e) {
  if (e.target.id !== 'noteText') return;
  const ta = e.target;
  if ((e.ctrlKey || e.metaKey) && (e.key === 'b' || e.key === 'i')) { e.preventDefault(); noteFormat(e.key === 'b' ? 'b' : 'i'); return; }
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); actions.ndone(); return; }
  if (e.key === 'Escape') { e.preventDefault(); actions.ndone(); return; }
  const L = lineBounds(ta.value, ta.selectionStart);
  if (e.key === 'Tab' && ta.selectionStart === ta.selectionEnd && /^\s*([-*•]|\d+[.)])\s/.test(L.text)) {
    e.preventDefault();
    if (e.shiftKey) {
      const cut = L.text.match(/^ {1,2}/);
      if (cut) { ta.setSelectionRange(L.s, L.s + cut[0].length); noteInsert(ta, ''); }
    } else { const pos = ta.selectionStart; ta.setSelectionRange(L.s, L.s); noteInsert(ta, '  '); ta.setSelectionRange(pos + 2, pos + 2); }
    return;
  }
  if (e.key !== 'Enter' || e.shiftKey || ta.selectionStart !== ta.selectionEnd || e.isComposing) return;
  const m = L.text.match(/^(\s*)([-*•]\s+\[[ xX]\]\s|[-*•]\s+|(\d+)([.)])\s+)(.*)$/);
  if (!m) return;
  e.preventDefault();
  if (!m[5].trim()) {                          // empty item: end the list
    ta.setSelectionRange(L.s, L.e);
    noteInsert(ta, '', L.s, L.s);
    return;
  }
  let mark = m[2];
  if (/\[[ xX]\]/.test(mark)) mark = mark.replace(/\[[xX]\]/, '[ ]');
  if (m[3]) mark = (Number(m[3]) + 1) + m[4] + ' ';
  noteInsert(ta, '\n' + m[1] + mark);
});
function noteFormat(f) {
  const ta = $('noteText');
  if (!ta) return;
  const a = ta.selectionStart, b = ta.selectionEnd, v = ta.value;
  const wrap = { b: '**', i: '*', s: '~~' }[f];
  if (wrap) {
    const sel = v.slice(a, b);
    if (sel) noteInsert(ta, wrap + sel + wrap, a, a + sel.length + wrap.length * 2);
    else noteInsert(ta, wrap + wrap, a + wrap.length, a + wrap.length);
    return;
  }
  if (f === 'hr') { noteInsert(ta, (a && v[a - 1] !== '\n' ? '\n' : '') + '---\n'); return; }
  // line formats: switch the prefix of every selected line
  const s = v.lastIndexOf('\n', a - 1) + 1;
  let e = v.indexOf('\n', Math.max(a, b - 1));
  if (e === -1) e = v.length;
  const lines = v.slice(s, e).split('\n');
  const pre = { h: '# ', ul: '- ', ol: '1. ', cb: '- [ ] ' }[f];
  const strip = function (l) { return l.replace(/^(\s*)(#{1,2}\s+|[-*•]\s+\[[ xX]\]\s?|[-*•]\s+|\d+[.)]\s+)/, '$1'); };
  const has = lines.every(function (l) {
    const t = l.trim();
    return f === 'h' ? /^#{1,2}\s/.test(t) : f === 'cb' ? /^[-*]\s+\[[ xX]\]/.test(t) : f === 'ul' ? /^[-*•]\s/.test(t) && !/^[-*]\s+\[/.test(t) : /^\d+[.)]\s/.test(t);
  });
  const out = lines.map(function (l, i) {
    const base = strip(l);
    if (has) return base;
    const lead = base.match(/^\s*/)[0];
    return lead + (f === 'ol' ? (i + 1) + '. ' : pre) + base.slice(lead.length);
  }).join('\n');
  ta.setSelectionRange(s, e);
  noteInsert(ta, out, s + out.length, s + out.length);
}
actions.nfmt = function (el) { noteFormat(el.dataset.f); };

// ---------- actions ----------
actions.nbopen = function (el) {
  noteSaveNow();
  noteNb = el.dataset.id;
  const nb = findNotebook(noteNb);
  noteDay = el.dataset.day || (nb && nb.type === 'daily' ? dayKey() : null);
  noteEditing = false;
  noteWeek = false;
  if (el.dataset.day) noteFind = '';
  state.ui.noteLast = noteNb;
  save();
  renderNotes();
  $('main').scrollTop = 0;
};
actions.nbback = function () { noteSaveNow(); noteNb = null; noteEditing = false; state.ui.noteLast = null; save(); renderNotes(); };
actions.nday = function (el) { noteSaveNow(); noteDay = el.dataset.day; noteEditing = false; noteWeek = false; renderNotes(); };
actions.nopenday = function (el) { noteDay = el.dataset.day; noteWeek = false; noteEditing = !noteText(noteNb, noteDay).trim(); renderNotes(); };
actions.nstep = function (el) {
  noteSaveNow();
  const dir = Number(el.dataset.d);
  const days = writtenDays(noteNb);
  if (days.indexOf(dayKey()) === -1) days.push(dayKey());
  days.sort();
  const next = dir < 0 ? days.filter(function (k) { return k < noteDay; }).pop() : days.filter(function (k) { return k > noteDay; })[0];
  if (!next) { toast(dir < 0 ? 'No earlier day written.' : 'This is the newest day.'); return; }
  noteDay = next;
  noteEditing = false;
  renderNotes();
};
actions.nweek = function (el) { noteSaveNow(); noteWeek = el.dataset.w === '1'; renderNotes(); };
actions.nweekstep = function (el) { noteDay = dayKey(addDays(keyToMs(noteDay), 7 * Number(el.dataset.d))); renderNotes(); };
actions.nedit = function (el, e) {
  if (e && e.target.closest && e.target.closest('a, .nbox')) return;
  noteEditing = true;
  renderNotes();
  const ta = $('noteText');
  if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
};
actions.ndone = function () {
  noteSaveNow();
  const nb = findNotebook(noteNb);
  if (!nb) return;
  noteEditing = !noteText(noteNb, nb.type === 'daily' ? noteDay : null).trim();
  renderNotes();
};
// Tick a checkbox while reading.
actions.ntick = function (el) {
  const nb = findNotebook(noteNb);
  if (!nb) return;
  const day = nb.type === 'daily' ? noteDay : null;
  const lines = noteText(noteNb, day).split('\n');
  const i = Number(el.dataset.line);
  if (!lines[i]) return;
  lines[i] = /\[ \]/.test(lines[i]) ? lines[i].replace('[ ]', '[x]') : lines[i].replace(/\[[xX]\]/, '[ ]');
  setNoteText(noteNb, day, lines.join('\n'));
  haptic(6);
  renderNotes();
};
actions.ncopy = function (el) {
  const text = noteText(noteNb, el.dataset.from);
  setNoteText(noteNb, noteDay, text);
  noteEditing = true;
  renderNotes();
  toast('Copied. Change what was different today.');
};
// Make a task from the line the cursor is on (or the selected text).
actions.ntask = function () {
  const ta = $('noteText');
  if (!ta) return;
  const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd).trim();
  const raw = sel || lineBounds(ta.value, ta.selectionStart).text;
  const title = raw.replace(/^\s*(#{1,2}\s+|[-*•]\s+\[[ xX]\]\s?|[-*•]\s+|\d+[.)]\s+)/, '').replace(/\*\*|~~|\*/g, '').trim();
  if (!title) { toast('Put the cursor on a line first.'); return; }
  const nb = findNotebook(noteNb);
  const due = nb && nb.type === 'daily' && keyToMs(noteDay) >= midnight(now()) ? keyToMs(noteDay) : null;
  const t = newTask(title.slice(0, 200), null, { due: due, hasTime: false });
  finishNewTask(t, {});
  snapshot('Added task');
  state.tasks.push(t);
  save();
  renderTaskViews();
  sound('soft');
  toast('Task added: "' + shortTitle(t.title) + '"' + (due ? ' for ' + fmtDue(due, false) : ''), { undo: true });
  ta.focus();
};
actions.nvoice = function () {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const ta = $('noteText');
  if (!SR || !ta) return;
  if (noteVoice) { noteVoice.stop(); return; }
  try {
    noteVoice = new SR();
    noteVoice.lang = navigator.language || 'en-IN';
    noteVoice.interimResults = false;
    noteVoice.continuous = true;
    $('nVoiceBtn').classList.add('on');
    noteVoice.onresult = function (ev) {
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        if (!ev.results[i].isFinal) continue;
        const said = ev.results[i][0].transcript.trim();
        const box = $('noteText');
        if (!said || !box) continue;
        const before = box.value.slice(0, box.selectionStart);
        noteInsert(box, (before && !/\s$/.test(before) ? ' ' : '') + said);
      }
    };
    noteVoice.onerror = function (ev) { if (ev.error === 'not-allowed') toast('Allow the microphone for this site to type by voice.'); };
    noteVoice.onend = function () { noteVoice = null; if ($('nVoiceBtn')) $('nVoiceBtn').classList.remove('on'); };
    noteVoice.start();
    haptic(10);
  } catch (e) { noteVoice = null; }
};

// Any date (empty ones too): a small month with dots on written days.
let noteMonth = null;
function noteDayPickHTML() {
  const ms = noteMonth;
  const written = {};
  writtenDays(noteNb).forEach(function (k) { written[k] = true; });
  const firstWd = 1;
  const lead = (new Date(ms).getDay() - firstWd + 7) % 7;
  const inMonth = new Date(new Date(ms).getFullYear(), new Date(ms).getMonth() + 1, 0).getDate();
  let cells = '';
  ['M', 'T', 'W', 'T', 'F', 'S', 'S'].forEach(function (x) { cells += '<span class="jwd">' + x + '</span>'; });
  for (let i = 0; i < lead; i++) cells += '<span></span>';
  for (let day = 1; day <= inMonth; day++) {
    const d = new Date(new Date(ms).getFullYear(), new Date(ms).getMonth(), day).getTime();
    const k = dayKey(d);
    cells += '<button class="jday' + (written[k] ? ' has' : '') + (k === dayKey() ? ' today' : '') + (k === noteDay ? ' sel' : '') + '" data-action="ndaygo" data-day="' + k + '">' + day + '</button>';
  }
  return '<div class="peek-head"><button class="icon-btn sm" data-action="nmonth" data-d="-1" aria-label="Previous month">‹</button><div><h3>' +
    new Date(ms).toLocaleDateString([], { month: 'long', year: 'numeric' }) + '</h3><p class="small">Dots = days you wrote. Any day can be opened.</p></div>' +
    '<button class="icon-btn sm" data-action="nmonth" data-d="1" aria-label="Next month">›</button></div><div class="jgrid">' + cells + '</div>' +
    '<div class="row"><button class="btn" data-action="ndaygo" data-day="' + dayKey() + '">Today</button><button class="btn" data-action="close">Close</button></div>';
}
actions.ndaypick = function () { noteSaveNow(); noteMonth = monthStart(keyToMs(noteDay)); openSheet({ type: 'ndaypick' }, noteDayPickHTML()); };
actions.nmonth = function (el) { noteMonth = addMonths(noteMonth, Number(el.dataset.d)); refreshSheet(noteDayPickHTML()); };
actions.ndaygo = function (el) { closeSheet(); noteDay = el.dataset.day; noteWeek = false; noteEditing = !noteText(noteNb, noteDay).trim(); renderNotes(); };

// ---------- new notebook / settings ----------
let nbDraft = null;
function nbSheetHTML() {
  const d = nbDraft;
  const isNew = !d.id;
  return '<div class="tsh-bar"><h3>' + (isNew ? 'New notebook' : 'Notebook settings') + '</h3><button class="btn small primary" data-action="nbsave">' + (isNew ? 'Create' : 'Save') + '</button></div>' +
    '<input class="text-input" id="nbName" placeholder="Name, e.g. Eating" value="' + esc(d.name) + '" aria-label="Notebook name" maxlength="40">' +
    (isNew ? '<p class="label">Type</p><div class="nbtypes">' +
      '<button class="nbtype' + (d.type === 'daily' ? ' on' : '') + '" data-action="nbtype" data-t="daily"><b>📅 Daily</b><span class="small">A page for every date. For food, journal, gym, mood.</span></button>' +
      '<button class="nbtype' + (d.type === 'page' ? ' on' : '') + '" data-action="nbtype" data-t="page"><b>📄 Page</b><span class="small">One long note, no dates. For ideas and lists.</span></button></div>'
      : '<p class="small">Type: ' + (d.type === 'daily' ? '📅 Daily (a page for every date)' : '📄 Page (one long note)') + '. The type can\'t change once it has notes.</p>') +
    '<p class="label">Icon</p><div class="nbicons">' + NB_ICONS.map(function (ic) {
      return '<button class="nbic' + (d.icon === ic ? ' on' : '') + '" data-action="nbicon" data-i="' + ic + '">' + ic + '</button>';
    }).join('') + '</div>' +
    '<p class="label">Colour</p><div class="lswatches">' + NB_COLORS.map(function (c) {
      return '<button class="sw' + (d.color === c ? ' on' : '') + '" style="background:' + c + '" data-action="nbcolor" data-c="' + c + '" aria-label="Colour ' + c + '"></button>';
    }).join('') + '</div>' +
    '<div class="pickrow wrap"><button class="pick' + (d.pinned ? ' on' : '') + '" data-action="nbpin">📌 Pinned to the top</button></div>' +
    (!isNew && !d.builtin ? '<div class="row"><button class="btn danger" data-action="nbdelete">Delete notebook…</button></div>' : '') +
    (d.builtin ? '<p class="small">Journal is built in: it holds the day notes you write in Wrap up on the Tasks page, and they show here too.</p>' : '');
}
actions.nbnew = function () { nbDraft = { name: '', type: 'daily', icon: '📝', color: NB_COLORS[1], pinned: false }; openSheet({ type: 'nbsheet' }, nbSheetHTML()); setTimeout(function () { if ($('nbName')) $('nbName').focus(); }, 60); };
actions.nbsettings = function () { nbDraft = Object.assign({}, findNotebook(noteNb)); openSheet({ type: 'nbsheet' }, nbSheetHTML()); };
function nbKeepName() { if ($('nbName')) nbDraft.name = $('nbName').value; }
actions.nbtype = function (el) { nbKeepName(); nbDraft.type = el.dataset.t; refreshSheet(nbSheetHTML()); };
actions.nbicon = function (el) { nbKeepName(); nbDraft.icon = el.dataset.i; refreshSheet(nbSheetHTML()); };
actions.nbcolor = function (el) { nbKeepName(); nbDraft.color = el.dataset.c; refreshSheet(nbSheetHTML()); };
actions.nbpin = function () { nbKeepName(); nbDraft.pinned = !nbDraft.pinned; refreshSheet(nbSheetHTML()); };
actions.nbsave = function () {
  nbKeepName();
  const name = nbDraft.name.trim();
  if (!name) { $('nbName').focus(); toast('Give it a name.'); return; }
  if (!nbDraft.id) {
    const nb = { id: uid(), name: name, type: nbDraft.type, icon: nbDraft.icon, color: nbDraft.color, pinned: nbDraft.pinned, order: liveNotebooks().length, updatedAt: now(), deleted: false };
    state.notebooks.push(nb);
    noteNb = nb.id;
    noteDay = nb.type === 'daily' ? dayKey() : null;
    noteEditing = true;
    noteWeek = false;
  } else {
    const nb = state.notebooks.find(function (n) { return n.id === nbDraft.id; });
    Object.assign(nb, { name: name, icon: nbDraft.icon, color: nbDraft.color, pinned: nbDraft.pinned, updatedAt: now() });
  }
  save();
  closeSheet();
  if (view !== 'notes') showView('notes');
  renderNotes();
  setTimeout(function () { if ($('noteText')) $('noteText').focus(); }, 380);
};
actions.nbdelete = function () {
  const nb = state.notebooks.find(function (n) { return n.id === nbDraft.id; });
  if (!nb) return;
  snapshot('Deleted notebook');
  nb.deleted = true;
  nb.updatedAt = now();
  state.notes.forEach(function (n) { if (n.nb === nb.id && !n.deleted) { n.deleted = true; n.updatedAt = now(); } });
  save();
  closeSheet();
  noteNb = null;
  renderNotes();
  toast('Deleted "' + nb.name + '"', { undo: true });
};
$('sheet').addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.id === 'nbName') { e.preventDefault(); actions.nbsave(); } });

// ---------- open a notebook from elsewhere (Calendar, Ctrl+K) ----------
actions.noteopen = function (el) {
  if (sheetCtx) closeSheet();
  noteNb = el.dataset.nb;
  noteDay = el.dataset.day || null;
  noteEditing = false;
  noteWeek = false;
  showView('notes');
};
// Daily notebooks written on day d (for the Calendar's day card / day sheet).
function notesOnDay(d) {
  const k = dayKey(d);
  return liveNotebooks().filter(function (nb) { return nb.type === 'daily'; }).map(function (nb) {
    const t = noteText(nb.id, k);
    return t.trim() ? { nb: nb, text: t } : null;
  }).filter(Boolean);
}
function calNotesHTML(d) {
  const list = notesOnDay(d);
  if (!list.length) return '';
  return '<div class="cal-notes">' + list.map(function (x) {
    const lines = x.text.split('\n').filter(function (l) { return l.trim(); }).length;
    return '<button class="cnote" data-action="noteopen" data-nb="' + x.nb.id + '" data-day="' + dayKey(d) + '" style="--nc:' + x.nb.color + '">' +
      '<span>' + esc(x.nb.icon || '📝') + '</span><b>' + esc(x.nb.name) + '</b><span class="small">' + esc(notePreview(x.text, 60)) + (lines > 1 ? ' · ' + lines + ' lines' : '') + '</span></button>';
  }).join('') + '</div>';
}

window.addEventListener('resize', function () { if (view === 'notes' && document.activeElement && document.activeElement.id !== 'noteText') renderNotes(); });
