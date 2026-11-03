/* =========================================================
   Focus: pomodoro timer with intent before, reflection after,
   a plant that grows while you focus, background sounds,
   a 7-day chart, and the screen kept awake while it runs.
   ========================================================= */

const RING = 565.49;          // circumference of the timer circle (2 * PI * 90)

function modeMinutes(mode) {
  if (mode === 'focus') return state.settings.focus;
  if (mode === 'short') return state.settings.short;
  return state.settings.long;
}
function timeLeft() {
  const tm = state.timer;
  return tm.running ? Math.max(0, tm.endsAt - now()) : tm.remaining;
}
function pomCount(taskId) { return liveSessions().filter(function (s) { return s.taskId === taskId; }).length; }

// ---------- drawing ----------
function renderTaskSelect() {
  const tm = state.timer;
  const open = liveTasks().filter(function (t) { return !t.done; });
  if (tm.taskId && !open.some(function (t) { return t.id === tm.taskId; })) tm.taskId = null;
  let html = '<option value="">No task</option>';
  QUADS.concat([{ q: null, name: 'Not sorted' }]).forEach(function (q) {
    const list = open.filter(function (t) { return (t.q || null) === q.q; });
    if (!list.length) return;
    html += '<optgroup label="' + esc(q.q ? quadName(q.q) : q.name) + '">' + list.map(function (t) {
      return '<option value="' + t.id + '"' + (t.id === tm.taskId ? ' selected' : '') + '>' + esc(t.title) + '</option>';
    }).join('') + '</optgroup>';
  });
  $('taskSelect').innerHTML = html;
}

function renderFocusChart() {
  const days = [];
  for (let i = 6; i >= 0; i--) days.push(daysAgo(i));
  const mins = days.map(function (d) {
    const k = dayKey(d);
    return liveSessions().filter(function (s) { return s.day === k; }).reduce(function (sum, s) { return sum + s.minutes; }, 0);
  });
  const week = mins.reduce(function (a, b) { return a + b; }, 0);
  if (!week) { $('focusChart').innerHTML = '<p class="small">Your focus minutes for the last 7 days will show here.</p>'; return; }
  const max = Math.max(60, Math.max.apply(null, mins));
  const W = 320, H = 140, base = 96, barW = 26, step = (W - 20) / 7;
  let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Focus minutes over the last 7 days">';
  svg += '<line x1="10" x2="' + (W - 10) + '" y1="' + base + '" y2="' + base + '" style="stroke:var(--line)"/>';
  mins.forEach(function (m, i) {
    const x = 10 + step * i + (step - barW) / 2;
    const h = m ? Math.max(4, (m / max) * 70) : 0;
    const today = i === 6;
    if (h) svg += '<rect x="' + x + '" y="' + (base - h) + '" width="' + barW + '" height="' + h + '" rx="5" style="fill:var(--c-focus);opacity:' + (today ? 1 : 0.55) + '"/>';
    if (m) svg += '<text x="' + (x + barW / 2) + '" y="' + (base - h - 5) + '" text-anchor="middle" style="font:500 10px var(--mono);fill:var(--muted)">' + m + '</text>';
    svg += '<text x="' + (x + barW / 2) + '" y="' + (base + 16) + '" text-anchor="middle" style="font:' + (today ? 600 : 400) + ' 11px var(--body);fill:' + (today ? 'var(--ink)' : 'var(--muted)') + '">' +
      days[i].toLocaleDateString([], { weekday: 'short' }) + '</text>';
  });
  svg += '<text x="10" y="' + (H - 4) + '" style="font:400 11px var(--body);fill:var(--muted)">Last 7 days: ' + fmtDur(week * MIN) + '</text>';
  $('focusChart').innerHTML = svg + '</svg>';
}

function renderFocus() {
  const tm = state.timer;
  const isFocus = tm.mode === 'focus';
  $('view-focus').classList.toggle('mode-break', !isFocus);
  document.querySelectorAll('#modes button').forEach(function (b) { b.classList.toggle('on', b.dataset.mode === tm.mode); });
  $('dialLabel').textContent = isFocus ? 'Focus' : (tm.mode === 'short' ? 'Short break' : 'Long break');
  $('startBtn').textContent = tm.running ? 'Pause' : (tm.remaining < modeMinutes(tm.mode) * MIN ? 'Resume' : 'Start');
  $('intentField').hidden = !isFocus;
  if (document.activeElement !== $('intentInput')) $('intentInput').value = tm.intent || '';
  $('soundSelect').value = state.ui.ambient || 'off';
  $('plant').style.display = isFocus ? '' : 'none';
  renderTaskSelect();

  const today = liveSessions().filter(function (s) { return s.day === dayKey(); });
  $('statCount').textContent = today.length;
  $('statMin').textContent = today.reduce(function (sum, s) { return sum + s.minutes; }, 0);
  let filled = (tm.count || 0) % 4;
  if (tm.mode === 'long') filled = 4;
  let dots = '';
  for (let i = 0; i < 4; i++) dots += '<i class="' + (i < filled ? 'on' : '') + '"></i>';
  $('dots').innerHTML = dots;
  renderFocusChart();

  $('sessionLog').innerHTML = today.length
    ? today.slice().reverse().map(function (s) {
        const t = s.taskId ? findTask(s.taskId) : null;
        const title = s.intent || (t ? t.title : 'Focus session');
        return '<li><div class="what"><span>' + esc(title) + ' · ' + s.minutes + ' min</span>' +
          (s.note ? '<em>' + esc(s.note) + '</em>' : '') + '</div><time>' + fmtTime(s.endedAt) + '</time></li>';
      }).join('')
    : '<li><span class="small">No sessions yet. Say what you\'ll get done, then press Start.</span></li>';
  tickDisplay();
}

function clamp01(x) { return Math.max(0, Math.min(1, x)); }
function growPlant(p) {
  const set = function (id, k, prop) { $(id).style.transform = prop + '(' + k + ')'; $(id).style.opacity = k > 0.02 ? 1 : 0; };
  set('pStem', clamp01((p - 0.04) / 0.3), 'scaleY');
  set('pLeafL', clamp01((p - 0.3) / 0.2), 'scale');
  set('pLeafR', clamp01((p - 0.5) / 0.2), 'scale');
  set('pBloom', clamp01((p - 0.8) / 0.2), 'scale');
  $('pSeed').style.opacity = p < 0.06 ? 1 : 0;
}

function tickDisplay() {
  const tm = state.timer;
  const left = timeLeft();
  const total = modeMinutes(tm.mode) * MIN;
  $('clock').textContent = fmtClock(left);
  $('prog').style.strokeDashoffset = String(RING * (1 - left / total));
  if (tm.mode === 'focus') growPlant(1 - left / total);
  $('focusTabLabel').innerHTML = tm.running ? '<span class="live">' + fmtClock(left) + '</span>' : 'Focus';
  document.title = tm.running ? fmtClock(left) + ' · TaskStack' : 'TaskStack';
}

// ---------- timer ----------
function setMode(mode) {
  const tm = state.timer;
  tm.mode = mode;
  tm.running = false;
  tm.remaining = modeMinutes(mode) * MIN;
  stopAmbient();
  keepAwake(false);
  save();
  renderFocus();
}
function startPause() {
  audio();
  const tm = state.timer;
  if (tm.running) {
    tm.remaining = Math.max(0, tm.endsAt - now());
    tm.running = false;
    stopAmbient();
    keepAwake(false);
    haptic(8);
  } else {
    if (tm.mode === 'focus') tm.intent = $('intentInput').value.trim();
    tm.endsAt = now() + tm.remaining;   // store the end time, so the timer stays right even if the phone sleeps the tab
    tm.running = true;
    if (tm.mode === 'focus') startAmbient();
    keepAwake(true);
    askNotifyOnce();
    haptic(12);
    sound('soft');
  }
  save();
  renderFocus();
}
function finishTimer(skipped) {
  const tm = state.timer;
  let next = 'focus';
  let sessionId = null;
  if (tm.mode === 'focus') {
    if (!skipped) {
      const t = now();
      const s = { id: uid(), taskId: tm.taskId, minutes: state.settings.focus, endedAt: t, day: dayKey(), intent: tm.intent || '', note: '', updatedAt: t, deleted: false };
      state.sessions.push(s);
      sessionId = s.id;
      tm.count = (tm.count || 0) + 1;
      tm.intent = '';
    }
    next = (!skipped && tm.count % 4 === 0) ? 'long' : 'short';
  }
  const endedMode = tm.mode;
  if (!skipped) { sound('chime'); haptic([180, 90, 180]); notifyDone(endedMode); }
  setMode(next);
  renderMatrix();
  if (sessionId) askReflection(sessionId);
  else if (!skipped) toast('Break over. Ready for the next one?');
}

setInterval(function () {
  if (!state.timer.running) return;
  if (timeLeft() <= 0) finishTimer(false);
  else if (view === 'focus') tickDisplay();
  else {
    $('focusTabLabel').innerHTML = '<span class="live">' + fmtClock(timeLeft()) + '</span>';
    document.title = fmtClock(timeLeft()) + ' · TaskStack';
  }
}, 250);

// ---------- reflection after a session ----------
function askReflection(sessionId) {
  if (sheetCtx) return;
  const s = state.sessions.find(function (x) { return x.id === sessionId; });
  const t = s.taskId ? findTask(s.taskId) : null;
  openSheet({ type: 'reflect', id: sessionId },
    '<h3>Session done · ' + s.minutes + ' min</h3>' +
    '<p class="small">' + esc(s.intent ? 'You planned: ' + s.intent : (t ? 'Task: ' + t.title : 'Nice work.')) + '</p>' +
    '<input class="text-input" id="reflectInput" placeholder="What did you get done? (optional)" enterkeyhint="done">' +
    '<div class="row"><button class="btn" data-action="close">Skip</button><button class="btn primary" data-action="reflectsave">Save note</button></div>' +
    '<button class="btn ink" data-action="startbreak">Start the ' + (state.timer.mode === 'long' ? 'long' : 'short') + ' break</button>');
}
function saveReflection() {
  if (!sheetCtx || sheetCtx.type !== 'reflect') return;
  const s = state.sessions.find(function (x) { return x.id === sheetCtx.id; });
  const v = $('reflectInput').value.trim();
  if (s && v) { s.note = v; s.updatedAt = now(); save(); renderFocus(); }
}
actions.reflectsave = function () { saveReflection(); closeSheet(); toast('Saved'); };
actions.startbreak = function () { saveReflection(); closeSheet(); if (!state.timer.running) startPause(); };
$('sheet').addEventListener('keydown', function (e) {
  if (e.key === 'Enter' && e.target.id === 'reflectInput') { e.preventDefault(); actions.reflectsave(); }
});

// ---------- background sounds (made in the browser, nothing to download) ----------
let amb = null;
function noiseBuffer(ac, brown) {
  const len = ac.sampleRate * 4;
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const white = Math.random() * 2 - 1;
    if (brown) { last = (last + 0.02 * white) / 1.02; d[i] = last * 3.5; }
    else d[i] = white;
  }
  return buf;
}
function startAmbient() {
  const kind = state.ui.ambient;
  if (!kind || kind === 'off' || amb) return;
  const ac = audio();
  if (!ac) return;
  try {
    const src = ac.createBufferSource();
    src.buffer = noiseBuffer(ac, kind === 'brown');
    src.loop = true;
    const gain = ac.createGain();
    gain.gain.value = 0;
    let node = src, lfo = null;
    if (kind === 'rain') {
      const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1000;
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 6500;
      src.connect(hp); hp.connect(lp); node = lp;
    } else if (kind === 'waves') {
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500;
      src.connect(lp); node = lp;
      lfo = ac.createOscillator(); lfo.frequency.value = 0.1;
      const depth = ac.createGain(); depth.gain.value = 0.07;
      lfo.connect(depth); depth.connect(gain.gain); lfo.start();
    }
    node.connect(gain);
    gain.connect(ac.destination);
    const vol = kind === 'rain' ? 0.06 : kind === 'waves' ? 0.1 : 0.13;
    gain.gain.setTargetAtTime(vol, ac.currentTime, 0.8);
    src.start();
    amb = { src: src, gain: gain, lfo: lfo };
  } catch (e) { amb = null; }
}
function stopAmbient() {
  if (!amb || !audioCtx) { amb = null; return; }
  const a = amb;
  amb = null;
  try {
    a.gain.gain.setTargetAtTime(0, audioCtx.currentTime, 0.2);
    setTimeout(function () { try { a.src.stop(); if (a.lfo) a.lfo.stop(); } catch (e) {} }, 900);
  } catch (e) {}
}

// ---------- keep the screen on, and tell you when time is up ----------
let wakeLock = null;
async function keepAwake(on) {
  try {
    if (on && 'wakeLock' in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', function () { wakeLock = null; });
    } else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch (e) { wakeLock = null; }
}
document.addEventListener('visibilitychange', function () {
  if (document.visibilityState === 'visible' && state.timer.running) keepAwake(true);
});
function askNotifyOnce() {
  try {
    if (!('Notification' in window) || Notification.permission !== 'default' || state.ui.askedNotify) return;
    state.ui.askedNotify = true;
    save();
    Notification.requestPermission();
  } catch (e) {}
}
function notifyDone(mode) {
  try {
    if (document.visibilityState === 'visible' || !('Notification' in window) || Notification.permission !== 'granted') return;
    const body = mode === 'focus' ? 'Focus session done. Time for a break.' : 'Break over. Ready to focus?';
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.ready.then(function (reg) { reg.showNotification('TaskStack', { body: body, icon: 'icons/icon-192.png', tag: 'timer' }); });
    } else {
      new Notification('TaskStack', { body: body, icon: 'icons/icon-192.png' });
    }
  } catch (e) {}
}

// ---------- actions ----------
actions.mode = function (el) { setMode(el.dataset.mode); };
actions.startpause = function () { startPause(); };
actions.reset = function () { setMode(state.timer.mode); };
actions.skip = function () { finishTimer(true); };
$('taskSelect').addEventListener('change', function () { state.timer.taskId = this.value || null; save(); });
$('soundSelect').addEventListener('change', function () {
  state.ui.ambient = this.value;
  save();
  stopAmbient();
  if (state.timer.running && state.timer.mode === 'focus') setTimeout(startAmbient, 50);
});
$('intentInput').addEventListener('input', function () { state.timer.intent = this.value; save(); });
