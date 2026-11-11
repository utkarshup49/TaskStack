/* =========================================================
   Reminders screen + Telegram.
   - One "Reminders" sheet (profile → Reminders, or the Reminder row of a task):
     where reminders reach you (in the app, phone notifications, Telegram),
     the defaults for new tasks, and what is coming up.
   - Telegram: the app sends its coming reminders to your own small server
     (a Cloudflare Worker, see worker/README.md). The server messages you at the
     right minute, even when TaskStack is closed. "Done" pressed in Telegram comes
     back here on the next sync and ticks the task.
   Settings that sync: tgUrl (the server's address), tgKey (a random id for you).
   Device-only (localStorage "taskstack.tg"): what was last sent, and if Telegram is linked.
   ========================================================= */

const TG_STORE = 'taskstack.tg';
const TG_DAYS = 60;                 // how far ahead reminders are sent to the server
const TG_GUIDE = 'https://github.com/utkarshup49/TaskStack/blob/main/worker/README.md';
let tgInfo = tgLoad();              // { fp, at, linked, bot, name, error }
let tgBusy = false;

function tgLoad() {
  try { return JSON.parse(localStorage.getItem(TG_STORE)) || {}; } catch (e) { return {}; }
}
function tgSave() { try { localStorage.setItem(TG_STORE, JSON.stringify(tgInfo)); } catch (e) {} }
function tgOn() { return !!(state.settings.tgUrl && state.settings.tgKey); }
function tgNewKey() {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return Array.from(a).map(function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
}
// A date that still reads right days later ("Wed 11 Nov, 5:00 PM", never "Today").
function tgWhen(ms, withTime) {
  const d = new Date(ms).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
  return withTime ? d + ', ' + fmtTime(ms) : d;
}
// Every reminder that is still to come, soonest first: { id, t (task id), at, title, sub }.
function comingReminders(days) {
  const from = now(), to = from + (days || TG_DAYS) * DAY;
  const out = [];
  liveTasks().forEach(function (t) {
    if (t.done || t.draft) return;
    (t.reminders || []).forEach(function (r) {
      const at = reminderAt(t, r);
      if (at === null || at <= from || at > to) return;
      let sub;
      if (r.type === 'dl') sub = 'Deadline ' + tgWhen(t.deadline, false);
      else if (r.type === 'abs') sub = r.snooze ? 'Snoozed' : (t.due !== null ? 'Due ' + tgWhen(t.due, t.hasTime) : '');
      else sub = (r.mins ? fmtBefore(r.mins) + ' · ' : '') + 'Due ' + tgWhen(t.due, t.hasTime);
      sub += (sub ? ' · ' : '') + listOf(t).name;
      out.push({ id: t.id + '|' + r.id + '|' + at, t: t.id, at: at, title: t.title, sub: sub });
    });
  });
  return out.sort(function (a, b) { return a.at - b.at; });
}

// ---------- talking to the server ----------
function tgCall(path, body) {
  const url = state.settings.tgUrl.replace(/\/+$/, '');
  return fetch(url + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true,
    body: JSON.stringify(Object.assign({ key: state.settings.tgKey }, body || {}))
  }).then(function (r) { return r.json(); });
}
// "Done" pressed in Telegram → tick the task here.
function tgApply(actions) {
  let n = 0;
  (actions || []).forEach(function (a) {
    const t = a.type === 'done' ? findTask(a.t) : null;
    if (!t || t.done || t.deleted) return;
    toggleTask(t.id, true, true);
    n++;
  });
  if (n) toast(n === 1 ? 'Finished from Telegram: 1 task' : 'Finished from Telegram: ' + n + ' tasks', { undo: true });
}
// Send the coming reminders if they changed (or every 30 min, to collect "Done" presses).
function tgSync(force) {
  if (!tgOn() || tgBusy || !navigator.onLine) return Promise.resolve(false);
  const items = comingReminders().slice(0, 300);
  const open = liveTasks().filter(function (t) { return !t.done; }).map(function (t) { return t.id; });
  const fp = JSON.stringify(items.map(function (i) { return [i.id, i.title, i.sub]; })) + '|' + state.settings.tgUrl + '|' + state.settings.tgKey;
  if (!force && fp === tgInfo.fp && now() - (tgInfo.at || 0) < 30 * MIN) return Promise.resolve(false);
  tgBusy = true;
  return tgCall('/sync', { items: items, open: open }).then(function (res) {
    tgBusy = false;
    if (res.error) { tgInfo.error = res.error; tgSave(); refreshRemSheet(); return false; }
    tgInfo = { fp: fp, at: now(), linked: !!res.linked, bot: res.bot || tgInfo.bot || '', name: res.name || '', error: '' };
    tgSave();
    tgApply(res.actions);
    refreshRemSheet();
    return true;
  }).catch(function () {
    tgBusy = false;
    tgInfo.error = 'Could not reach the server. Check the address and your internet.';
    tgSave();
    refreshRemSheet();
    return false;
  });
}
function startTelegram() {
  setTimeout(function () { tgSync(); }, 4000);
  setInterval(function () { if (document.visibilityState === 'visible') tgSync(); }, MIN);
  document.addEventListener('visibilitychange', function () { tgSync(); });      // leaving the app: send the latest; coming back: collect "Done"
}

// ---------- the Reminders sheet ----------
function remRowHTML(icon, name, state2, ok, extra) {
  return '<div class="rch"><span class="rch-i">' + icon + '</span><div class="rch-t"><b>' + name + '</b><span class="' + (ok ? 'ok' : '') + '">' + state2 + '</span></div>' + (extra || '') + '</div>';
}
function remNotifyRow() {
  const PHONE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="3" width="10" height="18" rx="2.5"/><path d="M11 18h2"/></svg>';
  if (!('Notification' in window)) return remRowHTML(PHONE, 'Notifications on this device', 'Not available in this browser', false);
  if (Notification.permission === 'granted') return remRowHTML(PHONE, 'Notifications on this device', 'On · while TaskStack is open or was used recently', true, '<button class="btn small" data-action="ptestnote">Test</button>');
  if (Notification.permission === 'denied') return remRowHTML(PHONE, 'Notifications on this device', 'Blocked in your browser settings for this site', false);
  return remRowHTML(PHONE, 'Notifications on this device', 'Off', false, '<button class="btn small primary" data-action="allownotify">Allow</button>');
}
function tgBoxHTML() {
  const s = state.settings;
  if (!tgOn()) {
    return '<p class="small">Get reminders as Telegram messages, even when TaskStack is closed. It needs a small free server that you set up once on the PC (about 15 minutes).</p>' +
      '<a class="btn small" href="' + TG_GUIDE + '" target="_blank" rel="noopener">Open the setup steps</a>' +
      '<div class="daterow tgrow"><input class="text-input" id="tgUrl" inputmode="url" placeholder="https://taskstack-reminders.YOU.workers.dev" value="' + esc(s.tgUrl || '') + '" aria-label="Server address">' +
      '<button class="btn primary" data-action="tgsave">Save</button></div>' +
      (tgInfo.error ? '<p class="small tgerr">' + esc(tgInfo.error) + '</p>' : '');
  }
  if (tgInfo.error) {
    return '<p class="small tgerr">' + esc(tgInfo.error) + '</p><p class="small">Server: ' + esc(s.tgUrl) + '</p>' +
      '<div class="row"><button class="btn" data-action="tgcheck">Try again</button><button class="btn" data-action="tgoff">Remove</button></div>';
  }
  if (!tgInfo.linked) {
    const link = tgInfo.bot ? 'https://t.me/' + encodeURIComponent(tgInfo.bot) + '?start=' + s.tgKey : '';
    return '<p class="small"><b>One step left.</b> Open your bot in Telegram and press <b>Start</b>, then come back and press Check.</p>' +
      (link ? '<a class="btn primary" href="' + link + '" target="_blank" rel="noopener">Open Telegram</a>'
            : '<p class="small tgerr">The server has no bot yet. Open its /setup address once (step 3 of the setup steps), then press Check.</p>') +
      '<div class="row"><button class="btn" data-action="tgcheck">Check</button><button class="btn" data-action="tgoff">Remove</button></div>';
  }
  return '<div class="row"><button class="btn" data-action="tgtest">Send a test</button><button class="btn" data-action="tgoff">Disconnect</button></div>' +
    '<p class="small">Each message has Done and snooze buttons. Done ticks the task the next time TaskStack is open.</p>';
}
function remSheetHTML() {
  const st = state.settings;
  const APP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="4"/><path d="M9 12l2 2 4-4"/></svg>';
  const SEND = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 4L3 11l6 2 2 6 3-4 4 3z"/></svg>';
  const tgState = !tgOn() ? 'Not set up' : tgInfo.error ? 'Problem' : tgInfo.linked ? 'Connected' + (tgInfo.name ? ' as ' + esc(tgInfo.name) : '') + ' · works when TaskStack is closed' : 'Waiting for you to press Start';
  const coming = comingReminders(30).slice(0, 8);
  const choices = [[-1, 'None'], [0, 'At its time'], [5, '5 min before'], [10, '10 min before'], [30, '30 min before'], [60, '1 hour before']];
  return '<div class="tsh-bar"><h3>Reminders</h3><button class="btn small primary" data-action="close">Done</button></div>' +
    '<p class="label">Where they reach you</p><div class="rchs">' +
      remRowHTML(APP, 'Inside TaskStack', 'Always on · a pop-up with Done and Snooze', true) +
      remNotifyRow() +
      remRowHTML(SEND, 'Telegram', tgState, tgOn() && tgInfo.linked && !tgInfo.error) +
    '</div>' +
    '<p class="label">Telegram</p><div class="tgbox">' + tgBoxHTML() + '</div>' +
    '<p class="label">Coming up</p>' +
    (coming.length ? '<ul class="remcoming">' + coming.map(function (c) {
      return '<li><button data-action="remgo" data-id="' + c.t + '"><b>' + esc(c.title) + '</b><span>' + esc(fmtDue(c.at, true)) + '</span></button></li>';
    }).join('') + '</ul>' : '<p class="small">No reminders waiting. Open a task and tap Reminder to add one.</p>') +
    '<p class="label">For new tasks</p>' +
    '<p class="small">A new task with a time gets this reminder:</p>' +
    '<div class="pickrow wrap">' + choices.map(function (c) {
      return '<button class="pick' + (st.remindDefault === c[0] ? ' on' : '') + '" data-action="premdef" data-m="' + c[0] + '" aria-pressed="' + (st.remindDefault === c[0]) + '">' + c[1] + '</button>';
    }).join('') + '</div>' +
    '<div class="stepper"><span>Tasks with only a date remind at</span><button class="icon-btn sm" data-action="pstep" data-k="remindHour" data-d="-1" aria-label="Earlier"' + (st.remindHour <= 5 ? ' disabled' : '') + '>−</button>' +
      '<b>' + fmtTime(midnight(now()) + st.remindHour * HOUR) + '</b><button class="icon-btn sm" data-action="pstep" data-k="remindHour" data-d="1" aria-label="Later"' + (st.remindHour >= 22 ? ' disabled' : '') + '>+</button></div>' +
    '<div class="toggle"><span>Nudge me to plan (8 am) and wrap up (9 pm)</span><button class="switch" role="switch" aria-checked="' + !!st.nudges + '" data-action="pnudges" aria-label="Daily nudges"></button></div>';
}
function refreshRemSheet() { if (sheetCtx && sheetCtx.type === 'reminders') refreshSheet(remSheetHTML()); }

actions.reminders = function () { openSheet({ type: 'reminders' }, remSheetHTML()); if (tgOn()) tgSync(true); };
actions.remgo = function (el) { const id = el.dataset.id; closeSheet(); setTimeout(function () { openTask(id); tshOpen('remind'); }, 350); };
actions.tgsave = function () {
  let url = $('tgUrl').value.trim().replace(/\/+$/, '');
  if (url && !/^https?:\/\//.test(url)) url = 'https://' + url;
  if (!/^https:\/\/[^\s/]+\.[^\s/]+/.test(url)) { toast('Paste the server address. It starts with https://'); $('tgUrl').focus(); return; }
  state.settings.tgUrl = url;
  if (!state.settings.tgKey) state.settings.tgKey = tgNewKey();
  state.settings.updatedAt = now();
  save();
  tgInfo = {};
  tgSave();
  refreshRemSheet();
  tgSync(true);
};
actions.tgcheck = function () {
  tgInfo.error = '';
  tgSync(true).then(function (ok) { if (ok) toast(tgInfo.linked ? 'Telegram is connected' : 'Not connected yet. Press Start in the bot chat first.'); });
};
actions.tgtest = function () {
  tgCall('/test').then(function (r) { toast(r.sent ? 'Sent. Check Telegram.' : 'Could not send. Press Start in the bot chat again.'); if (!r.linked) { tgInfo.linked = false; tgSave(); refreshRemSheet(); } })
    .catch(function () { toast('Could not reach the server.'); });
};
actions.tgoff = function () {
  if (tgOn()) tgCall('/unlink').catch(function () {});
  state.settings.tgUrl = '';
  state.settings.updatedAt = now();
  save();
  tgInfo = {};
  tgSave();
  refreshRemSheet();
  toast('Telegram reminders are off');
};
