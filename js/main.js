/* =========================================================
   main: switching sections, settings, the Ctrl+K command bar,
   keyboard shortcuts, voice add, home-screen shortcuts, and
   starting the app.
   ========================================================= */

const VIEWS = ['tasks', 'calendar', 'matrix', 'focus', 'habits', 'colortracker'];
let view = 'tasks';

function renderAll() {
  renderListBars();
  renderPlanBits();
  renderAvatar();
  applySections();
  renderListPick();
  renderListParse();
  renderTaskList();
  renderCalendar();
  renderMatrix();
  renderFocus();
  renderHabits();
  renderColor();
}

function applyTheme() {
  const t = state.ui.theme || 'system';
  if (t === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  setTimeout(function () {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = getComputedStyle(document.body).backgroundColor;
  }, 320);
}

function showView(v) {
  // "colortracker/stats/sleep" = ColorTracker opened on its Stats page
  if (v && v.indexOf('/') !== -1) {
    const parts = v.split('/');
    v = parts[0];
    if (v === 'colortracker' && parts[1] === 'stats') openCtStatsFromHash(parts[2]);
  }
  if (VIEWS.indexOf(v) === -1 || (state.settings.hiddenTabs || []).indexOf(v) !== -1) v = 'tasks';
  const changed = v !== view;
  view = v;
  VIEWS.forEach(function (name) { $('view-' + name).hidden = name !== v; });
  document.body.dataset.section = v;
  document.querySelectorAll('.tab').forEach(function (b) {
    const on = b.dataset.view === v;
    b.classList.toggle('on', on);
    b.setAttribute('aria-current', on ? 'page' : 'false');
  });
  if (changed) {
    const el = $('view-' + v);
    el.classList.remove('enter');
    void el.offsetWidth;
    el.classList.add('enter');
    $('main').scrollTop = 0;
  }
  closeBoxMenu();
  if (!sheetCtx && !(history.state && history.state.overlay)) { try { history.replaceState(null, '', '#' + v + (v === 'colortracker' && ctPage === 'stats' ? '/stats/' + ctTab : '')); } catch (e) {} }
  if (v === 'tasks') renderTaskList();
  if (v === 'calendar') renderCalendar();
  if (v === 'focus') renderFocus();
  if (v === 'colortracker') renderColor();
  applyTheme();
}

// ---------- click routing ----------
document.addEventListener('click', function (e) {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const fn = actions[el.dataset.action];
  if (fn) fn(el, e);
});
actions.tab = function (el) { haptic(5); showView(el.dataset.view); };
actions.close = function () { closeSheet(); };
actions.undo = function () { undo(); };
actions.palette = function () { openPalette(); };
actions.closepalette = function () { closePalette(); };

// ---------- settings ----------
function settingsHTML() {
  const st = state.settings;
  const theme = state.ui.theme || 'system';
  function sw(key, label) {
    return '<div class="toggle"><span>' + label + '</span><button class="switch" role="switch" aria-checked="' + !!state.ui[key] + '" data-action="pref" data-k="' + key + '" aria-label="' + label + '"></button></div>';
  }
  return '<h3>Settings</h3>' +
    '<p class="label">Sync with Google Drive</p>' +
    '<div class="sync-box" id="syncBox">' + syncSettingsHTML() + '</div>' +
    sw('sound', 'Sounds') + sw('haptics', 'Vibration') +
    '<p class="label">Appearance</p>' +
    '<div class="seg">' + ['system', 'light', 'dark'].map(function (t) {
      return '<button class="' + (theme === t ? 'on' : '') + '" data-action="theme" data-t="' + t + '">' + t.charAt(0).toUpperCase() + t.slice(1) + '</button>';
    }).join('') + '</div>' +
    '<p class="label">Calendar: days off</p>' +
    '<p class="small">These days are shaded in the Calendar. Tap to switch a day on or off.</p>' +
    '<div class="daterow">' + [1, 2, 3, 4, 5, 6, 0].map(function (wd) {
      const on = state.settings.offDays.indexOf(wd) !== -1;
      return '<button class="pick' + (on ? ' on' : '') + '" data-action="offday" data-wd="' + wd + '" aria-pressed="' + on + '">' + dayName(addDays(weekStart(now()), (wd + 6) % 7), 'short') + '</button>';
    }).join('') + '</div>' +
    '<p class="label">Timer lengths (minutes)</p><div class="dur">' +
      '<div><label for="setFocus">Focus</label><input id="setFocus" type="number" min="1" max="120" value="' + st.focus + '"></div>' +
      '<div><label for="setShort">Short break</label><input id="setShort" type="number" min="1" max="60" value="' + st.short + '"></div>' +
      '<div><label for="setLong">Long break</label><input id="setLong" type="number" min="1" max="90" value="' + st.long + '"></div></div>' +
    '<p class="label">Backup</p>' +
    '<p class="small">Keep a copy of your data, or move it without signing in: copy a backup, paste it on another device and press Merge.</p>' +
    '<div class="row"><button class="btn" data-action="copybackup">Copy backup</button><button class="btn" data-action="clearexamples">Remove examples</button></div>' +
    '<textarea class="mono" id="backupBox" aria-label="Backup data" placeholder="Paste a backup here, then press Merge"></textarea>' +
    '<div class="row"><button class="btn primary" data-action="importbackup">Merge pasted backup</button></div>' +
    '<p class="status" id="settingsStatus" role="status"></p>' +
    '<p class="small kbd-help"><span class="kbd">N</span> new task · <span class="kbd">Ctrl K</span> search · <span class="kbd">Ctrl Z</span> undo · ColorTracker: <span class="kbd">P</span> pen, <span class="kbd">1–9</span> colours, <span class="kbd">L</span> lock</p>' +
    '<div class="row"><button class="btn" data-action="close">Close</button></div>';
}
function setStatus(msg, bad) {
  const el = $('settingsStatus');
  if (!el) return;
  el.textContent = msg;
  el.style.color = bad ? 'var(--danger)' : 'var(--good)';
}
actions.settings = function () { openSheet({ type: 'settings' }, settingsHTML()); };
actions.pref = function (el) {
  const k = el.dataset.k;
  state.ui[k] = !state.ui[k];
  save();
  el.setAttribute('aria-checked', state.ui[k]);
  if (k === 'sound' && state.ui.sound) sound('tick');
  if (k === 'haptics' && state.ui.haptics) haptic(15);
};
actions.offday = function (el) {
  const wd = Number(el.dataset.wd);
  const list = state.settings.offDays;
  const i = list.indexOf(wd);
  if (i === -1) list.push(wd); else list.splice(i, 1);
  state.settings.updatedAt = now();
  save();
  renderCalendar();
  refreshSheet(settingsHTML());
};
actions.theme = function (el) {
  state.ui.theme = el.dataset.t;
  save();
  applyTheme();
  refreshSheet(settingsHTML());
};
actions.copybackup = function () {
  const data = JSON.stringify(state);
  $('backupBox').value = data;
  $('backupBox').select();
  try {
    navigator.clipboard.writeText(data)
      .then(function () { setStatus('Backup copied. Paste it into Settings on your other device.'); })
      .catch(function () { setStatus('Copy the selected text in the box above.'); });
  } catch (err) { setStatus('Copy the selected text in the box above.'); }
};
actions.importbackup = function () {
  try {
    const incoming = JSON.parse($('backupBox').value);
    if (!incoming || !Array.isArray(incoming.tasks)) throw new Error('bad');
    snapshot('Merged backup');
    state = normalize(mergeState(state, normalize(incoming)));
    save();
    renderAll();
    setStatus('Merged. The newer edit of every item was kept.');
  } catch (err) {
    setStatus('That text isn\'t a TaskStack backup. Paste the whole backup and try again.', true);
  }
};
actions.clearexamples = function () {
  const t = now();
  snapshot('Removed examples');
  state.tasks.concat(state.habits).forEach(function (x) { if (x.example && !x.deleted) { x.deleted = true; x.updatedAt = t; } });
  save();
  renderAll();
  setStatus('Example tasks and habits removed.');
};
$('sheet').addEventListener('change', function (e) {
  if (['setFocus', 'setShort', 'setLong'].indexOf(e.target.id) === -1) return;
  const n = Math.round(Number(e.target.value));
  if (!(n >= 1 && n <= 120)) { setStatus('Use a whole number of minutes from 1 to 120.', true); return; }
  const key = { setFocus: 'focus', setShort: 'short', setLong: 'long' }[e.target.id];
  state.settings[key] = n;
  state.settings.updatedAt = now();
  if (!state.timer.running) state.timer.remaining = modeMinutes(state.timer.mode) * MIN;
  save();
  renderFocus();
  setStatus('Saved.');
});

// ---------- command bar (Ctrl+K) ----------
let palItems = [];
let palIndex = 0;
function paletteItems(q) {
  const ql = q.trim().toLowerCase();
  const items = [];
  function match(s) { return !ql || s.toLowerCase().indexOf(ql) !== -1; }
  if (ql) {
    const p = parseQuickAdd(q.trim());
    items.push({ label: 'Add task: ' + (p.title || q.trim()), hint: quickAddChips(p).join(' · ') || 'Today', run: function () { showView('tasks'); $('taskInput').value = q.trim(); addFromList(); } });
  }
  [['Tasks', 'tasks'], ['Calendar', 'calendar'], ['Matrix', 'matrix'], ['Focus', 'focus'], ['Habits', 'habits'], ['ColorTracker', 'colortracker']].forEach(function (n) {
    if (match('go to ' + n[0])) items.push({ label: 'Go to ' + n[0], hint: 'Section', run: function () { showView(n[1]); } });
  });
  const cmds = [
    { label: state.timer.running ? 'Pause timer' : 'Start a focus session', hint: 'Focus', run: function () { showView('focus'); if (!state.timer.running && state.timer.mode !== 'focus') setMode('focus'); startPause(); } },
    { label: 'Paint in ColorTracker', hint: 'Pen on', run: function () { showView('colortracker'); ctSel = null; ctMode = 'paint'; renderColor(); } },
    { label: 'Plan my day', hint: 'Top 3, estimates', run: function () { showView('tasks'); actions.planday(); } },
    { label: 'Wrap up the day', hint: 'Evening', run: function () { showView('tasks'); actions.wrapday(); } },
    { label: 'Weekly review', hint: 'Sunday', run: function () { showView('tasks'); actions.weekreview(); } },
    { label: 'Logbook', hint: 'Finished tasks', run: function () { actions.logbook(); } },
    { label: 'Countdowns', hint: 'Exams, events', run: function () { actions.countdowns(); } },
    { label: 'Edit lists', hint: 'College, Projects…', run: function () { openListsSheet(); } },
    { label: 'Show all lists', hint: 'List filter', run: function () { setListFilter([]); } },
    { label: 'Profile', hint: 'Stats, goals, data', run: function () { openProfile(); } },
    { label: 'ColorTracker stats', hint: 'Where your time goes', run: function () { showView('colortracker'); setCtPage('stats', 'overview'); } },
    { label: 'Sleep stats', hint: 'ColorTracker', run: function () { showView('colortracker'); setCtPage('stats', 'sleep'); } },
    { label: 'Fill the gaps in today', hint: 'ColorTracker', run: function () { showView('colortracker'); setTimeout(function () { actions.ctgaps(); }, 250); } },
    { label: 'Going to sleep', hint: 'ColorTracker live', run: function () { showView('colortracker'); actions.ctsleepNow(); } },
    { label: 'Keyboard shortcuts', hint: '?', run: function () { actions.shortcuts(); } },
    { label: 'Undo last change', hint: 'Ctrl Z', run: undo },
    { label: 'Sync now', hint: 'Google Drive', run: function () { if (sync.signedIn) syncNow(false); else actions.settings(); } },
    { label: 'Settings', hint: 'Sync, sounds, theme, backup', run: function () { actions.settings(); } }
  ];
  cmds.forEach(function (c) { if (match(c.label)) items.push(c); });
  liveLists().forEach(function (l) {
    if (ql && match('list ' + l.name)) items.push({ label: 'Show only ' + l.name, hint: 'List', run: function () { setListFilter([l.id]); } });
  });
  liveTemplates().forEach(function (x) {
    if (ql && match('template ' + x.name)) items.push({ label: 'New from template: ' + x.name, hint: 'Template', run: function () { showView('tasks'); taskFromTemplate(x); toast('Added "' + shortTitle(x.task.title) + '" from a template'); } });
  });
  if (ql) {
    liveTasks().filter(function (t) {
      return t.title.toLowerCase().indexOf(ql) !== -1 || t.tags.join(' ').indexOf(ql) !== -1 || t.notes.toLowerCase().indexOf(ql) !== -1 ||
        t.subtasks.some(function (st) { return st.title.toLowerCase().indexOf(ql) !== -1; });
    }).slice(0, 6).forEach(function (t) {
      items.push({ label: t.title, hint: (t.done ? 'Done · ' : t.someday ? 'Someday · ' : '') + listOf(t).name + ' · ' + boxName(t.q), run: function () { openTask(t.id); } });
    });
    liveHabits().filter(function (h) { return h.name.toLowerCase().indexOf(ql) !== -1; }).slice(0, 4).forEach(function (h) {
      const done = isOn(h, dayKey());
      items.push({ label: (done ? 'Untick today: ' : 'Tick today: ') + h.name, hint: 'Habit', run: function () { showView('habits'); tickHabit(h.id, dayKey()); } });
    });
  }
  return items.slice(0, 12);
}
function renderPalette() {
  palItems = paletteItems($('paletteInput').value);
  if (palIndex >= palItems.length) palIndex = 0;
  $('paletteList').innerHTML = palItems.map(function (it, i) {
    return '<li class="' + (i === palIndex ? 'on' : '') + '"><button data-action="palrun" data-i="' + i + '"><span>' + esc(it.label) + '</span><span class="hint">' + esc(it.hint || '') + '</span></button></li>';
  }).join('') || '<li class="small" style="padding:12px">Nothing found.</li>';
}
function openPalette() {
  if ($('paletteWrap').hidden) { try { history.pushState({ overlay: 'palette' }, ''); } catch (e) {} }
  $('paletteWrap').hidden = false;
  $('paletteInput').value = '';
  palIndex = 0;
  renderPalette();
  setTimeout(function () { $('paletteInput').focus(); }, 30);
}
function closePalette(fromHistory) {
  if ($('paletteWrap').hidden) return;
  $('paletteWrap').hidden = true;
  if (fromHistory !== true && history.state && history.state.overlay === 'palette') { ignorePop++; history.back(); }
}
function runPalette(i) { const it = palItems[i]; closePalette(); if (it) it.run(); }
actions.palrun = function (el) { runPalette(Number(el.dataset.i)); };
$('paletteInput').addEventListener('input', function () { palIndex = 0; renderPalette(); });
$('paletteInput').addEventListener('keydown', function (e) {
  if (e.key === 'ArrowDown') { e.preventDefault(); palIndex = Math.min(palItems.length - 1, palIndex + 1); renderPalette(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); palIndex = Math.max(0, palIndex - 1); renderPalette(); }
  else if (e.key === 'Enter') { e.preventDefault(); runPalette(palIndex); }
  else if (e.key === 'Escape') { e.preventDefault(); closePalette(); }
});

// ---------- keyboard ----------
document.addEventListener('keydown', function (e) {
  const tag = (e.target.tagName || '').toLowerCase();
  const typing = tag === 'input' || tag === 'textarea' || tag === 'select';
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); if ($('paletteWrap').hidden) openPalette(); else closePalette(); return; }
  if (e.key === 'Escape') {
    if (boxMenuTask) { closeBoxMenu(); return; }
    if (!$('paletteWrap').hidden) { closePalette(); return; }
    if (sheetCtx) { closeSheet(); return; }
    if (view === 'colortracker' && (ctSel || ctMode)) { ctSel = null; ctMode = null; renderColor(); return; }
  }
  if (typing || sheetCtx || !$('paletteWrap').hidden) return;
  if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
  if (mod || (e.altKey && !/^Digit[1-6]$/.test(e.code || ''))) return;
  const k = e.key.toLowerCase();
  if (k === '/') { e.preventDefault(); openPalette(); return; }
  if (e.key === '?') { e.preventDefault(); actions.shortcuts(); return; }
  // 1-6 switch sections (in ColorTracker the digits pick colours, so use Alt + digit there)
  const digit = /^Digit[1-6]$/.test(e.code || '') ? Number(e.code.slice(5)) : 0;
  if (digit && (view !== 'colortracker' || e.altKey)) {
    const visible = VIEWS.filter(function (v) { return (state.settings.hiddenTabs || []).indexOf(v) === -1; });
    if (visible[digit - 1]) { e.preventDefault(); showView(visible[digit - 1]); }
    return;
  }
  if (k === 'n') { e.preventDefault(); if (view === 'matrix') openAddSheet(addQ); else if (view === 'calendar') { if (TIMED_MODES[calMode()]) actions.caladd(); else $('calInput').focus(); } else { showView('tasks'); $('taskInput').focus(); } return; }
  if (view === 'calendar' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { calStep(e.key === 'ArrowLeft' ? -1 : 1); return; }
  if (view === 'colortracker') {
    const n = Number(e.key);
    if (n >= 1 && n <= 9 && liveCats()[n - 1]) actions.brush({ dataset: { id: liveCats()[n - 1].id } });
    else if (k === 'p') actions.ctpen();
    else if (k === 'l') ctToggleLock();
    else if ((e.key === 'Delete' || e.key === 'Backspace') && ctSel) ctDelete(ctSel);
    else if (e.key === 'ArrowLeft') ctStep(-1);
    else if (e.key === 'ArrowRight') ctStep(1);
  }
});

// ---------- voice: say a task (Chrome / Edge / Android; hidden where the browser can't) ----------
let voiceRec = null;
function setupVoiceAdd() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return;
  $('micBtn').hidden = false;
}
actions.voiceadd = function () {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return;
  if (voiceRec) { voiceRec.stop(); return; }
  try {
    voiceRec = new SR();
    voiceRec.lang = navigator.language || 'en-IN';
    voiceRec.interimResults = true;
    voiceRec.maxAlternatives = 1;
    $('micBtn').classList.add('on');
    voiceRec.onresult = function (ev) {
      let text = '';
      for (let i = 0; i < ev.results.length; i++) text += ev.results[i][0].transcript;
      $('taskInput').value = text.trim();
      renderListParse();
    };
    voiceRec.onerror = function (ev) { if (ev.error === 'not-allowed') toast('Allow the microphone for this site to add tasks by voice.'); };
    voiceRec.onend = function () { voiceRec = null; $('micBtn').classList.remove('on'); if ($('taskInput').value.trim()) $('taskInput').focus(); };
    voiceRec.start();
    haptic(10);
  } catch (e) { voiceRec = null; $('micBtn').classList.remove('on'); }
};

// unlock audio on the first touch (browsers need a tap before they play sound)
document.addEventListener('pointerdown', function unlock() { audio(); document.removeEventListener('pointerdown', unlock); });

// ---------- start ----------
$('today').textContent = new Date().toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
if (!storageOk) $('storeNote').hidden = false;
if (state.timer.running && timeLeft() <= 0) finishTimer(false);   // a session ended while the app was closed
runStacks();                                                         // stacking repeats: add copies whose day has come
renderAll();
view = '';
showView(location.hash.slice(1) || 'tasks');
save();
startSync();
startReminders();
setupVoiceAdd();
// Home-screen shortcuts (long-press the app icon): ?do=add opens the add box, ?do=focus starts a session.
(function homeShortcut() {
  const p = new URLSearchParams(location.search);
  const what = p.get('do');
  if (!what) return;
  try { history.replaceState(null, '', location.pathname + location.hash); } catch (e) {}
  if (what === 'add') { showView('tasks'); setTimeout(function () { $('taskInput').focus(); }, 200); }
  else if (what === 'log') { showView('colortracker'); setTimeout(function () { actions.ctgaps(); }, 300); }
  else if (what === 'focus') { showView('focus'); if (!state.timer.running) { if (state.timer.mode !== 'focus') setMode('focus'); startPause(); } }
})();
// Quietly re-check the date-based bits (banner, Today) when the day changes or the app comes back.
document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') { renderPlanBits(); if (view === 'tasks') renderTaskList(); } });
setInterval(function () { if (!sheetCtx) renderPlanBits(); }, 5 * 60000);

// offline support + "Install app"
if ('serviceWorker' in navigator) {
  try { navigator.serviceWorker.register('sw.js').catch(function () {}); } catch (e) {}
}
