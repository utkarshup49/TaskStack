/* =========================================================
   Lists: your areas of life (College, Extracurricular, Projects,
   Self-growth, Personal, or your own). Every task is in one list.
   - A row of chips on Tasks, Matrix and Calendar picks what you see:
     tap a list to see only it (tap again for All);
     hold it (or Ctrl/Shift-click on a laptop) to add or remove it, to see several.
     The choice is shared by the three views.
   - Each list has a colour: a thin stripe on its tasks.
   - Type /college when adding a task to put it in College.
   - "Edit lists" adds, renames, recolours, reorders and deletes lists.
   ========================================================= */

const LIST_COLORS = ['#ea580c', '#7c3aed', '#db2777', '#0891b2', '#16a34a', '#ca8a04', '#2563eb', '#475569', '#dc2626', '#0f766e'];
let listColorOpen = null;      // the list whose colour row is open in the Edit lists sheet

function liveLists() {
  return (state.lists || []).filter(function (l) { return !l.deleted; })
    .sort(function (a, b) { return (a.order || 0) - (b.order || 0) || a.name.localeCompare(b.name); });
}
function findList(id) { return liveLists().find(function (l) { return l.id === id; }) || null; }
// The list a task shows under (a task whose list was deleted on another device falls back to the first one).
function listOf(t) { return findList(t.listId) || liveLists()[0]; }

// The lists being shown right now (empty = all of them).
function listFilter() {
  const ids = (state.ui.listFilter || []).filter(function (id) { return !!findList(id); });
  return ids.length === liveLists().length ? [] : ids;
}
function listVisible(t) {
  const f = listFilter();
  return !f.length || f.indexOf(listOf(t).id) !== -1;
}
// New tasks go to the list you're looking at, or the default one.
function defaultListId() {
  const f = listFilter();
  if (f.length === 1) return f[0];
  const d = findList(state.settings.defaultList);
  return d ? d.id : liveLists()[0].id;
}
// "/col" -> College. Matches the start of a list's name, ignoring case, spaces and dashes.
function listKey(s) { return String(s).toLowerCase().replace(/[^a-z0-9]/g, ''); }
function listByToken(word) {
  const w = listKey(word);
  if (w.length < 2) return null;
  const lists = liveLists();
  return lists.find(function (l) { return listKey(l.name) === w || l.id === w; }) ||
    lists.find(function (l) { return listKey(l.name).indexOf(w) === 0; }) || null;
}

// ---------- the chip row on Tasks, Matrix and Calendar ----------
const LISTBAR_IDS = ['listbarTasks', 'listbarMatrix', 'listbarCal'];
function listBarHTML() {
  const f = listFilter();
  const open = liveTasks().filter(function (t) { return !t.done && !t.someday; });
  let html = '<button class="lchip all' + (!f.length ? ' on' : '') + '" data-action="listall">All<span>' + open.length + '</span></button>';
  liveLists().forEach(function (l) {
    const n = open.filter(function (t) { return listOf(t).id === l.id; }).length;
    const on = f.indexOf(l.id) !== -1;
    html += '<button class="lchip' + (on ? ' on' : '') + '" style="--lc:' + l.color + '" data-action="listpick" data-id="' + l.id + '" aria-pressed="' + on + '">' +
      '<i></i>' + esc(l.name) + '<span>' + n + '</span></button>';
  });
  html += '<button class="lchip edit" data-action="listsedit" aria-label="Edit lists" title="Edit lists">' +
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg></button>';
  return html;
}
function renderListBars() {
  const html = listBarHTML();
  LISTBAR_IDS.forEach(function (id) {
    const el = $(id);
    if (!el) return;
    const x = el.scrollLeft;
    el.innerHTML = html;
    el.scrollLeft = x;
  });
}
function setListFilter(ids) {
  state.ui.listFilter = ids;
  save();
  renderListBars();
  renderTaskViews();
}
// Tap: only this list (tap it again to see all). add = true: add it to / remove it from what's shown.
function pickList(id, add) {
  let f = listFilter().slice();
  const i = f.indexOf(id);
  if (add) { if (i === -1) f.push(id); else f.splice(i, 1); }
  else f = (f.length === 1 && i === 0) ? [] : [id];
  haptic(6);
  setListFilter(f);
}
actions.listpick = function (el, e) {
  if (now() < listHoldUntil) return;               // the hold already handled it
  pickList(el.dataset.id, !!(e && (e.ctrlKey || e.metaKey || e.shiftKey)));
};
actions.listall = function () { haptic(6); setListFilter([]); };

// Hold a chip to add it to (or take it out of) what's shown.
let listHoldTimer = 0, listHoldUntil = 0;
document.addEventListener('pointerdown', function (e) {
  const chip = e.target.closest && e.target.closest('.lchip[data-action="listpick"]');
  if (!chip) return;
  clearTimeout(listHoldTimer);
  listHoldTimer = setTimeout(function () {
    listHoldUntil = now() + 700;
    haptic(15);
    pickList(chip.dataset.id, true);
    toast('Hold more lists to see them together. Tap one to see only it.');
  }, 480);
});
['pointerup', 'pointercancel', 'pointerleave'].forEach(function (n) {
  document.addEventListener(n, function () { clearTimeout(listHoldTimer); });
});
document.addEventListener('contextmenu', function (e) { if (e.target.closest && e.target.closest('.lchip')) e.preventDefault(); });

// ---------- a list picker for the task and add sheets ----------
function listPickHTML(current, action) {
  return '<div class="pickrow wrap">' + liveLists().map(function (l) {
    return '<button type="button" class="lchip' + (l.id === current ? ' on' : '') + '" style="--lc:' + l.color + '" data-action="' + action + '" data-id="' + l.id + '"><i></i>' + esc(l.name) + '</button>';
  }).join('') + '</div>';
}

// ---------- Edit lists sheet ----------
function listsSheetHTML() {
  const lists = liveLists();
  return '<h3>Lists</h3>' +
    '<p class="small">Split your tasks by area of life. When adding a task, type <b>/</b> and the start of a list\'s name (e.g. <b>/coll</b>) to put it there.</p>' +
    '<ul class="listedit">' + lists.map(function (l, i) {
      return '<li style="--lc:' + l.color + '">' +
        '<div class="le-row">' +
          '<button class="lswatch" data-action="lcolor" data-id="' + l.id + '" aria-label="Change colour of ' + esc(l.name) + '"></button>' +
          '<input class="text-input" data-lname="' + l.id + '" value="' + esc(l.name) + '" maxlength="30" aria-label="List name" enterkeyhint="done">' +
          '<button class="icon-btn sm" data-action="lmove" data-id="' + l.id + '" data-d="-1" aria-label="Move up"' + (i === 0 ? ' disabled' : '') + '>' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 15l6-6 6 6"/></svg></button>' +
          '<button class="icon-btn sm" data-action="lmove" data-id="' + l.id + '" data-d="1" aria-label="Move down"' + (i === lists.length - 1 ? ' disabled' : '') + '>' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></button>' +
          '<button class="icon-btn sm danger" data-action="ldelete" data-id="' + l.id + '" aria-label="Delete ' + esc(l.name) + '"' + (lists.length === 1 ? ' disabled' : '') + '>×</button>' +
        '</div>' +
        (listColorOpen === l.id ? '<div class="lswatches">' + LIST_COLORS.map(function (c) {
          return '<button class="lswatch' + (c === l.color ? ' on' : '') + '" style="--lc:' + c + '" data-action="lsetcolor" data-id="' + l.id + '" data-c="' + c + '" aria-label="Colour ' + c + '"></button>';
        }).join('') + '</div>' : '') +
      '</li>';
    }).join('') + '</ul>' +
    '<form id="listAddForm" class="add-row" autocomplete="off"><input id="listAddInput" placeholder="New list, e.g. Gym" maxlength="30" aria-label="New list name" enterkeyhint="done"><button class="btn primary" type="submit">Add</button></form>' +
    '<p class="label">New tasks go to</p>' + listPickHTML((findList(state.settings.defaultList) || lists[0]).id, 'ldefault') +
    '<p class="small">While you\'re looking at just one list, new tasks go to that list instead.</p>' +
    '<div class="row"><button class="btn" data-action="close">Done</button></div>';
}
function openListsSheet() { listColorOpen = null; openSheet({ type: 'lists' }, listsSheetHTML()); }
function refreshListsSheet() { if (sheetCtx && sheetCtx.type === 'lists') refreshSheet(listsSheetHTML()); }
function listsChanged() { save(); renderListBars(); renderTaskViews(); refreshListsSheet(); }
function nextListColor() {
  const used = liveLists().map(function (l) { return l.color; });
  return LIST_COLORS.find(function (c) { return used.indexOf(c) === -1; }) || LIST_COLORS[liveLists().length % LIST_COLORS.length];
}

actions.listsedit = function () { openListsSheet(); };
actions.lcolor = function (el) { listColorOpen = listColorOpen === el.dataset.id ? null : el.dataset.id; refreshListsSheet(); };
actions.lsetcolor = function (el) {
  const l = findList(el.dataset.id);
  if (!l) return;
  l.color = el.dataset.c; l.updatedAt = now();
  listColorOpen = null;
  listsChanged();
};
actions.lmove = function (el) {
  const lists = liveLists();
  const i = lists.findIndex(function (l) { return l.id === el.dataset.id; });
  const j = i + Number(el.dataset.d);
  if (i < 0 || j < 0 || j >= lists.length) return;
  const moved = lists.splice(i, 1)[0];
  lists.splice(j, 0, moved);
  const t = now();
  lists.forEach(function (l, k) { if (l.order !== k) { l.order = k; l.updatedAt = t; } });
  listsChanged();
};
actions.ldelete = function (el) {
  const l = findList(el.dataset.id);
  const lists = liveLists();
  if (!l || lists.length < 2) return;
  const t = now();
  let to = findList(state.settings.defaultList);
  if (!to || to.id === l.id) to = lists.find(function (x) { return x.id !== l.id; });
  snapshot('Deleted list');
  let moved = 0;
  state.tasks.forEach(function (x) { if (!x.deleted && x.listId === l.id) { x.listId = to.id; x.updatedAt = t; moved++; } });
  l.deleted = true; l.updatedAt = t;
  if (state.settings.defaultList === l.id) { state.settings.defaultList = to.id; state.settings.updatedAt = t; }
  state.ui.listFilter = (state.ui.listFilter || []).filter(function (id) { return id !== l.id; });
  listsChanged();
  toast('Deleted "' + l.name + '"' + (moved ? '. ' + moved + (moved === 1 ? ' task' : ' tasks') + ' moved to ' + to.name : ''), { undo: true });
};
actions.ldefault = function (el) {
  state.settings.defaultList = el.dataset.id;
  state.settings.updatedAt = now();
  save();
  refreshListsSheet();
};
$('sheet').addEventListener('change', function (e) {
  const id = e.target.dataset && e.target.dataset.lname;
  if (!id) return;
  const l = findList(id);
  const v = e.target.value.trim();
  if (!l || !v || v === l.name) { if (l) e.target.value = l.name; return; }
  l.name = v; l.updatedAt = now();
  save(); renderListBars(); renderTaskViews();
});
$('sheet').addEventListener('keydown', function (e) {
  if (e.key === 'Enter' && e.target.dataset && e.target.dataset.lname) { e.preventDefault(); e.target.blur(); }
});
$('sheet').addEventListener('submit', function (e) {
  if (e.target.id !== 'listAddForm') return;
  e.preventDefault();
  const v = $('listAddInput').value.trim();
  if (!v) return;
  if (liveLists().some(function (l) { return l.name.toLowerCase() === v.toLowerCase(); })) { toast('You already have a list called ' + v); return; }
  const t = now();
  snapshot('Added list');
  state.lists.push({ id: uid(), name: v, color: nextListColor(), order: liveLists().length, updatedAt: t, deleted: false });
  listsChanged();
  setTimeout(function () { if ($('listAddInput')) $('listAddInput').focus(); }, 30);
  toast('Added list "' + v + '". Type /' + listKey(v).slice(0, 4) + ' when adding a task.');
});
