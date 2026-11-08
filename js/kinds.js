/* =========================================================
   Smart categories for ColorTracker.
   Every activity (state.categories) gets a hidden "kind", so the
   stats work whatever people call things: Gym, Exercise and Cricket
   are all Workout; Reels, Insta and Timepass are all Time waste.
   - guessKind(name): a word list (English + Hinglish) and emojis.
     Sure matches are set quietly; unclear names (YouTube, Phone,
     Gaming...) are asked once, in the Settings sheet and the Stats page.
   - Each activity can also have: a sub-kind for Productive
     (Study / Work / Project / Learning / Admin), a value from -2 to +2,
     and a List (College, Projects...) for "productive time per list".
   - A block can be marked 👍 / 👎 ("was it worth it?"): a 👍 waste
     block counts as Leisure, a 👎 leisure block counts as waste.
   Stored on the category: kind, sub, value, listId, kindSure.
   ========================================================= */

const KINDS = [
  { id: 'sleep', name: 'Sleep', color: '#6366f1', value: 0 },
  { id: 'productive', name: 'Productive', color: '#16a34a', value: 2 },
  { id: 'workout', name: 'Workout', color: '#ea580c', value: 2 },
  { id: 'selfcare', name: 'Self-care', color: '#ca8a04', value: 1 },
  { id: 'social', name: 'Social', color: '#db2777', value: 1 },
  { id: 'leisure', name: 'Leisure', color: '#0891b2', value: 0 },
  { id: 'waste', name: 'Time waste', color: '#dc2626', value: -2 },
  { id: 'travel', name: 'Travel', color: '#64748b', value: 0 },
  { id: 'other', name: 'Other', color: '#94a3b8', value: 0 }
];
const UNLOGGED = { id: 'unlogged', name: 'Unlogged', color: '#d4d4d8' };
const SUBKINDS = [['study', 'Study'], ['work', 'Work'], ['project', 'Project'], ['learning', 'Learning'], ['admin', 'Admin']];

// Words that point to a kind. Matched against whole words and word starts ("stud" finds "study").
const KIND_WORDS = {
  sleep: ['sleep', 'sleeping', 'slept', 'so gaya', 'sona', 'neend', 'bed', 'nap', 'snooze', 'rest night'],
  productive: ['study', 'studies', 'studying', 'padhai', 'padhna', 'college', 'class', 'classes', 'lecture', 'lab', 'assignment', 'homework', 'hw',
    'coding', 'code', 'programming', 'dsa', 'leetcode', 'project', 'projects', 'work', 'working', 'office', 'job', 'internship', 'intern', 'meeting',
    'revision', 'revise', 'exam', 'exams', 'test', 'practice', 'research', 'thesis', 'paper', 'notes', 'tuition', 'coaching', 'course', 'learning',
    'learn', 'reading notes', 'deep work', 'focus', 'planned', 'planning', 'admin', 'emails', 'email', 'tasks', 'productive', 'kaam'],
  workout: ['gym', 'workout', 'exercise', 'excercise', 'run', 'running', 'jog', 'jogging', 'walk', 'walking', 'yoga', 'sport', 'sports', 'cricket',
    'football', 'badminton', 'tennis', 'basketball', 'volleyball', 'swim', 'swimming', 'cycling', 'cycle', 'bike ride', 'stretching', 'cardio',
    'pushups', 'training', 'kabaddi', 'table tennis', 'tt', 'dance', 'dancing', 'hiit', 'lifting'],
  selfcare: ['essentials', 'essential', 'eat', 'eating', 'food', 'meal', 'meals', 'breakfast', 'lunch', 'dinner', 'snack', 'khana', 'nashta', 'cook',
    'cooking', 'bath', 'shower', 'naha', 'nahana', 'get ready', 'ready', 'freshen', 'chores', 'laundry', 'cleaning', 'clean', 'groceries',
    'shopping', 'doctor', 'medicine', 'hygiene', 'skincare', 'meditate', 'meditation', 'journal', 'journaling', 'prayer', 'pooja', 'puja'],
  social: ['friends', 'friend', 'family', 'call', 'calls', 'phone call', 'date', 'party', 'hangout', 'hang out', 'chill with', 'dost', 'ghar',
    'mom', 'dad', 'relatives', 'gf', 'bf', 'girlfriend', 'boyfriend', 'social', 'club', 'fest', 'event', 'events', 'gathering', 'wedding'],
  leisure: ['movie', 'movies', 'film', 'series', 'show', 'anime', 'netflix', 'music', 'guitar', 'piano', 'hobby', 'hobbies', 'chess', 'novel',
    'book', 'books', 'reading', 'read', 'art', 'drawing', 'painting', 'leisure', 'fun', 'relax', 'relaxing', 'chill', 'free time', 'outing'],
  waste: ['waste', 'wasted', 'wasting', 'reels', 'reel', 'insta', 'instagram', 'shorts', 'scroll', 'scrolling', 'doomscroll', 'doomscrolling',
    'timepass', 'time pass', 'tiktok', 'snapchat', 'snap', 'twitter', 'x.com', 'facebook', 'procrastination', 'procrastinate', 'idle', 'bekar',
    'faltu', 'useless', 'random'],
  travel: ['travel', 'travelling', 'traveling', 'commute', 'commuting', 'bus', 'metro', 'train', 'auto', 'cab', 'uber', 'ola', 'drive', 'driving',
    'flight', 'trip', 'journey']
};
// Names that could be good or bad: we ask once instead of guessing.
const UNCLEAR_WORDS = ['youtube', 'yt', 'phone', 'mobile', 'gaming', 'game', 'games', 'valorant', 'bgmi', 'pubg', 'internet', 'laptop', 'browsing',
  'extra', 'extracurricular', 'extra-curricular', 'misc', 'other', 'others', 'free', 'break', 'tv', 'discord', 'reddit', 'whatsapp'];
const KIND_EMOJI = { '😴': 'sleep', '🛌': 'sleep', '📚': 'productive', '💻': 'productive', '🏋': 'workout', '🏃': 'workout', '⚽': 'workout',
  '🏏': 'workout', '🍽': 'selfcare', '🍔': 'selfcare', '🚿': 'selfcare', '🎮': 'leisure', '🎬': 'leisure', '📱': 'waste', '🚌': 'travel', '👫': 'social' };
const SUB_WORDS = {
  study: ['study', 'padhai', 'college', 'class', 'lecture', 'lab', 'assignment', 'homework', 'revision', 'revise', 'exam', 'test', 'notes', 'tuition', 'coaching'],
  work: ['work', 'office', 'job', 'internship', 'intern', 'meeting', 'kaam'],
  project: ['project', 'projects', 'coding', 'code', 'programming', 'thesis', 'research', 'paper'],
  learning: ['learning', 'learn', 'course', 'dsa', 'leetcode', 'practice', 'reading notes'],
  admin: ['admin', 'emails', 'email', 'planning', 'planned', 'tasks']
};

function kindInfo(id) { return KINDS.find(function (k) { return k.id === id; }) || (id === 'unlogged' ? UNLOGGED : KINDS[KINDS.length - 1]); }
function kindKey(s) { return ' ' + String(s).toLowerCase().replace(/[^a-z0-9.\- ]+/g, ' ').replace(/[\s\-]+/g, ' ').trim() + ' '; }
function wordHit(text, word) {
  const w = kindKey(word).trim();
  if (text.indexOf(' ' + w + ' ') !== -1) return 2;                       // whole word
  return w.length >= 4 && text.indexOf(' ' + w.slice(0, Math.max(4, w.length - 2))) !== -1 ? 1 : 0;   // word start
}
// Best guess for an activity name: { kind, sub, sure }.
function guessKind(name, isSleep) {
  if (isSleep) return { kind: 'sleep', sub: null, sure: true };
  const raw = String(name || '');
  for (const e in KIND_EMOJI) if (raw.indexOf(e) !== -1) return { kind: KIND_EMOJI[e], sub: null, sure: true };
  const text = kindKey(raw);
  const unclear = UNCLEAR_WORDS.some(function (w) { return wordHit(text, w) === 2; });
  let best = null, bestScore = 0;
  for (const k in KIND_WORDS) {
    let score = 0;
    KIND_WORDS[k].forEach(function (w) { score = Math.max(score, wordHit(text, w)); });
    if (score > bestScore) { best = k; bestScore = score; }
  }
  let sub = null;
  if (best === 'productive') {
    for (const s in SUB_WORDS) if (SUB_WORDS[s].some(function (w) { return wordHit(text, w); })) { sub = s; break; }
  }
  if (!best) return { kind: unclear ? 'leisure' : 'other', sub: null, sure: false };
  return { kind: best, sub: sub, sure: bestScore === 2 && !unclear };
}
// Give every activity a kind (older data has none). Same guess on every device, so no updatedAt bump.
function ensureKinds() {
  (state.categories || []).forEach(function (c) {
    if (c.kind && kindInfo(c.kind).id === c.kind) return;
    const g = c.oneoff ? { kind: 'other', sub: null, sure: true } : guessKind(c.name, c.sleep);
    c.kind = g.kind;
    c.sub = g.sub;
    c.kindSure = g.sure;
  });
}
function catKind(id) { const c = findCat(id); return c && c.kind ? c.kind : 'other'; }
function catValue(c) { return c.value !== undefined && c.value !== null ? c.value : kindInfo(c.kind).value; }
function needsKind() { ensureKinds(); return liveCats().filter(function (c) { return !c.kindSure; }); }
// A meal-type activity exists? (Meal stats only show then.)
function mealCats() {
  return liveCats().filter(function (c) { return /\b(meal|meals|eat|eating|food|breakfast|lunch|dinner|snack|khana|nashta)\b/i.test(c.name); });
}

// ---------- the kind editor (used by the Settings sheet and the Stats page) ----------
let kindEditId = null;
function kindChipHTML(c) {
  const k = kindInfo(c.kind);
  return '<button class="kindchip' + (c.kindSure ? '' : ' ask') + '" style="--kc:' + k.color + '" data-action="kindedit" data-id="' + c.id + '">' +
    (c.kindSure ? '' : '? ') + esc(k.name) + (c.sub ? ' · ' + esc(SUBKINDS.find(function (s) { return s[0] === c.sub; })[1]) : '') + '</button>';
}
function kindEditorHTML(c) {
  const val = catValue(c);
  return '<div class="kindedit">' +
    '<p class="small"><b>' + esc(c.name) + '</b> counts as:</p>' +
    '<div class="pickrow wrap">' + KINDS.filter(function (k) { return k.id !== 'sleep' || c.sleep; }).map(function (k) {
      return '<button class="pick kindpick' + (c.kind === k.id ? ' on' : '') + '" style="--kc:' + k.color + '" data-action="kindset" data-id="' + c.id + '" data-k="' + k.id + '"' + (c.sleep ? ' disabled' : '') + '>' + k.name + '</button>';
    }).join('') + '</div>' +
    (c.kind === 'productive' ? '<p class="small">What sort of productive?</p><div class="pickrow wrap">' + SUBKINDS.map(function (s) {
      return '<button class="pick' + (c.sub === s[0] ? ' on' : '') + '" data-action="kindsub" data-id="' + c.id + '" data-s="' + s[0] + '">' + s[1] + '</button>';
    }).join('') + '</div>' : '') +
    '<p class="small">How good is an hour of it for you? (used in the Day value)</p><div class="pickrow wrap">' + [-2, -1, 0, 1, 2].map(function (v) {
      return '<button class="pick' + (val === v ? ' on' : '') + '" data-action="kindval" data-id="' + c.id + '" data-v="' + v + '">' + (v > 0 ? '+' + v : v) + '</button>';
    }).join('') + '</div>' +
    (c.kind === 'productive' ? '<p class="small">Counts towards which list? (optional)</p><div class="pickrow wrap"><button class="pick' + (!c.listId ? ' on' : '') + '" data-action="kindlist" data-id="' + c.id + '" data-l="">None</button>' +
      liveLists().map(function (l) {
        return '<button class="pick' + (c.listId === l.id ? ' on' : '') + '" data-action="kindlist" data-id="' + c.id + '" data-l="' + l.id + '">' + esc(l.name) + '</button>';
      }).join('') + '</div>' : '') +
  '</div>';
}
// The review screen: every activity with its kind. Opened once from Stats, and any time from Settings.
function kindReviewHTML() {
  ensureKinds();
  const cats = liveCats();
  const ask = cats.filter(function (c) { return !c.kindSure; });
  return '<h3>How your activities count</h3>' +
    '<p class="small">Stats group activities by kind, so "Gym" and "Cricket" both count as Workout. ' +
    (ask.length ? ask.length + (ask.length === 1 ? ' needs' : ' need') + ' your answer (marked ?).' : 'Tap any to change it.') + '</p>' +
    '<ul class="kindlist">' + cats.map(function (c) {
      return '<li style="--cc:' + c.color + '"><div class="kl-row"><i></i><span>' + esc(c.name) + '</span>' + kindChipHTML(c) + '</div>' +
        (kindEditId === c.id ? kindEditorHTML(c) : '') + '</li>';
    }).join('') + '</ul>' +
    '<div class="row"><button class="btn primary" data-action="kindsdone">' + (ask.length ? 'Looks right' : 'Done') + '</button></div>';
}
function refreshKindViews() {
  if (sheetCtx && sheetCtx.type === 'kinds') refreshSheet(kindReviewHTML());
  else if (sheetCtx && sheetCtx.type === 'activities') refreshSheet(activitiesSheetHTML());
  if (typeof renderCtStats === 'function' && view === 'colortracker' && ctPage === 'stats') renderCtStats();
}
function kindChanged(c) { c.kindSure = true; c.kindSet = true; c.updatedAt = now(); save(); refreshKindViews(); }
actions.kindreview = function () { kindEditId = null; openSheet({ type: 'kinds' }, kindReviewHTML()); };
actions.kindedit = function (el) {
  kindEditId = kindEditId === el.dataset.id ? null : el.dataset.id;
  if (sheetCtx && (sheetCtx.type === 'kinds' || sheetCtx.type === 'activities')) refreshKindViews();
  else openSheet({ type: 'kinds' }, kindReviewHTML());
};
actions.kindset = function (el) {
  const c = findCat(el.dataset.id);
  if (!c || c.sleep) return;
  c.kind = el.dataset.k;
  if (c.kind !== 'productive') { c.sub = null; c.listId = null; }
  else if (!c.sub) c.sub = guessKind(c.name).sub || 'study';
  c.value = null;                                  // back to the kind's default value
  kindChanged(c);
};
actions.kindsub = function (el) { const c = findCat(el.dataset.id); if (c) { c.sub = el.dataset.s; kindChanged(c); } };
actions.kindval = function (el) { const c = findCat(el.dataset.id); if (c) { c.value = Number(el.dataset.v); kindChanged(c); } };
actions.kindlist = function (el) { const c = findCat(el.dataset.id); if (c) { c.listId = el.dataset.l || null; kindChanged(c); } };
actions.kindsdone = function () {
  const t = now();
  liveCats().forEach(function (c) { if (!c.kindSure) { c.kindSure = true; c.updatedAt = t; } });
  state.settings.ctKindsReviewed = true;
  state.settings.updatedAt = t;
  save();
  closeSheet();
  if (typeof renderCtStats === 'function' && ctPage === 'stats') renderCtStats();
};
// Renaming an activity re-guesses its kind (unless you set it yourself).
function rekindAfterRename(c) {
  if (c.kindSure && c.kindSet) return;
  const g = guessKind(c.name, c.sleep);
  c.kind = g.kind; c.sub = g.sub; c.kindSure = g.sure; c.value = null;
}
