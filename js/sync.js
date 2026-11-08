/* =========================================================
   sync: Google Drive sync.

   - "Sign in with Google" uses Google's redirect sign-in, so no server is needed.
     The app asks for the drive.file permission: it can only see files it made
     itself, never the rest of your Drive.
   - Data lives in your own Drive: TaskStack/taskstack-data.json
   - A change is pushed about a second after you make it. Other devices' changes
     are pulled when the app opens, when it comes back on screen, and every 15 s.
   - Both copies are merged with mergeState() (newest edit of each item wins), so
     nothing is lost when two devices edit at the same time.
   - Google sign-ins last 1 hour. When one runs out the app quietly renews it
     the next time it opens (a quick hop to Google and back). If it runs out
     while you're using the app, the cloud button turns red: tap it to renew.
   ========================================================= */

// From Google Cloud Console → APIs & Services → Credentials → OAuth client ID (Web application).
const GOOGLE_CLIENT_ID = '118777867394-pohkdctau9jl6mg07ch3hblgh1dds4tq.apps.googleusercontent.com';
const SYNC_KEY = 'taskstack.sync';      // device-only: sign-in, file id, last sync. Never uploaded.
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const DRIVE_API = 'https://www.googleapis.com/drive/v3/';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3/';
const SYNC_FOLDER = 'TaskStack';
const SYNC_FILE = 'taskstack-data.json';
const SYNC_POLL = 15000;        // check for other devices' changes this often while the app is on screen
const SYNC_DELAY = 800;         // wait this long after a change, so a burst of edits is one upload
const AUTO_RENEW_GAP = 10 * MIN; // never hop to Google on our own more often than this

let sync = loadSync();
let syncStatus = sync.signedIn ? 'idle' : 'off';   // off | idle | busy | offline | reconnect | error
let syncError = '';
let syncBusy = false;
let syncAgain = false;
let syncTimer = 0;
let syncNotice = '';            // message to show once the app has started (sign-in result)

function loadSync() { try { return JSON.parse(localStorage.getItem(SYNC_KEY)) || {}; } catch (e) { return {}; } }
function saveSync() { try { localStorage.setItem(SYNC_KEY, JSON.stringify(sync)); } catch (e) {} }
function tokenOk() { return !!sync.token && sync.expiresAt - now() > MIN; }

// ---------- what gets uploaded, and a short fingerprint of it ----------
// timer and ui stay on this device (a running timer or the open tab shouldn't jump between devices).
function syncPayload() {
  return {
    version: 2, savedAt: now(),
    tasks: state.tasks, habits: state.habits, sessions: state.sessions,
    settings: state.settings, categories: state.categories, ranges: state.ranges,
    lists: state.lists, days: state.days, countdowns: state.countdowns, templates: state.templates, periods: state.periods
  };
}
// Same items with the same edit times = same fingerprint, whatever order they're in.
// Used to skip uploads when nothing changed, and to spot when a merge added something.
function syncFingerprint(s) {
  const parts = [];
  ['tasks', 'sessions', 'categories', 'ranges', 'lists', 'days', 'countdowns', 'templates', 'periods'].forEach(function (k) {
    (s[k] || []).forEach(function (x) { parts.push(k + ':' + x.id + '@' + (x.updatedAt || 0)); });
  });
  (s.habits || []).forEach(function (h) {
    parts.push('h' + h.id + '@' + (h.updatedAt || 0));
    const done = h.done || {};
    for (const day in done) parts.push('d' + h.id + day + '@' + done[day].at + (done[day].on ? '+' : '-'));
  });
  parts.push('s@' + ((s.settings && s.settings.updatedAt) || 0));
  return hashText(parts.sort().join('|'));
}
function hashText(str) {          // cyrb53: a fast 53-bit string hash
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(36) + (h1 >>> 0).toString(36);
}

// ---------- signing in (redirect to Google and back) ----------
function redirectUri() { return location.origin + location.pathname.replace(/index\.html$/, ''); }

// mode: 'new' = choose an account | 'tap' = renew after a tap | 'silent' = renew with no screens at all
function googleSignIn(mode) {
  if (!GOOGLE_CLIENT_ID) { toast('Sync isn\'t set up yet: the app is missing its Google client ID.'); return; }
  if (!navigator.onLine) { toast('You\'re offline. Connect to the internet to sign in.'); return; }
  sync.nonce = uid() + uid();                 // checked on the way back, so only our own request is accepted
  sync.returnView = location.hash.slice(1) || 'tasks';
  if (mode === 'silent') sync.lastAutoAuth = now();
  saveSync();
  const p = {
    client_id: GOOGLE_CLIENT_ID, redirect_uri: redirectUri(), response_type: 'token',
    scope: DRIVE_SCOPE + ' email', include_granted_scopes: 'true', state: sync.nonce
  };
  if (mode === 'new') p.prompt = 'select_account';
  if (mode === 'silent') p.prompt = 'none';
  if (mode !== 'new' && sync.email) p.login_hint = sync.email;
  location.href = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams(p).toString();
}

// Google sends us back with #access_token=... (or #error=...). Read it before main.js reads the #view.
(function readGoogleReply() {
  const h = location.hash;
  if (h.indexOf('access_token=') === -1 && h.indexOf('error=') === -1) return;
  const p = new URLSearchParams(h.slice(1));
  const ours = !!sync.nonce && p.get('state') === sync.nonce;
  try { history.replaceState(null, '', location.pathname + location.search + '#' + (ours && sync.returnView || 'tasks')); } catch (e) {}
  if (!ours) return;
  sync.nonce = null;
  const silent = now() - (sync.lastAutoAuth || 0) < MIN;
  if (p.get('access_token')) {
    if ((p.get('scope') || '').indexOf(DRIVE_SCOPE) === -1) {
      syncNotice = 'TaskStack needs the Google Drive box ticked to sync. Sign in again and tick it.';
    } else {
      sync.token = p.get('access_token');
      sync.expiresAt = now() + Number(p.get('expires_in') || 3600) * 1000;
      if (!sync.signedIn) syncNotice = 'welcome';
      sync.signedIn = true;
      sync.needsTap = false;
    }
  } else if (sync.signedIn) {
    sync.needsTap = true;                       // a silent renew needs a screen (signed out of Google, etc.)
    if (!silent) syncNotice = 'Couldn\'t renew the Google sign-in. Tap the red cloud to try again.';
  } else if (p.get('error') === 'access_denied') {
    syncNotice = 'Sign-in cancelled.';
  } else {
    syncNotice = 'Google sign-in didn\'t work (' + p.get('error') + ').';
  }
  saveSync();
})();

// Only hop to Google on our own when nothing on screen would be lost by reloading the page.
function canLeavePage() {
  const a = document.activeElement;
  const typing = a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName);
  return document.visibilityState === 'visible' && !sheetCtx && $('paletteWrap').hidden && !ctDrag && !amb && !typing;
}
// The 1-hour sign-in ran out. auto = the app just opened or came back on screen (user isn't mid-tap).
function renewToken(auto) {
  const allowed = sync.signedIn && !sync.needsTap && navigator.onLine && now() - (sync.lastAutoAuth || 0) > AUTO_RENEW_GAP;
  if (auto && allowed && canLeavePage()) { googleSignIn('silent'); return; }
  setSyncStatus('reconnect');
}

// ---------- talking to Google Drive ----------
async function driveFetch(url, opts) {
  opts = opts || {};
  opts.headers = Object.assign({ Authorization: 'Bearer ' + sync.token }, opts.headers || {});
  opts.cache = 'no-store';
  const res = await fetch(url, opts);
  if (res.status === 401) { sync.token = null; saveSync(); throw Object.assign(new Error('auth'), { status: 401 }); }
  if (!res.ok) throw Object.assign(new Error('Drive error ' + res.status), { status: res.status });
  return res;
}
async function driveJSON(url, opts) { return (await driveFetch(url, opts)).json(); }
function query(params) { return new URLSearchParams(params).toString(); }

// drive.file only shows files this app created, so a search by name finds just ours.
async function findSyncFile() {
  const res = await driveJSON(DRIVE_API + 'files?' + query({
    q: "name = '" + SYNC_FILE + "' and trashed = false", orderBy: 'createdTime', fields: 'files(id,version)', spaces: 'drive'
  }));
  return res.files && res.files.length ? res.files[0] : null;
}
async function findOrMakeFolder() {
  const res = await driveJSON(DRIVE_API + 'files?' + query({
    q: "name = '" + SYNC_FOLDER + "' and mimeType = 'application/vnd.google-apps.folder' and trashed = false", fields: 'files(id)', spaces: 'drive'
  }));
  if (res.files && res.files.length) return res.files[0].id;
  const made = await driveJSON(DRIVE_API + 'files?fields=id', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: SYNC_FOLDER, mimeType: 'application/vnd.google-apps.folder' })
  });
  return made.id;
}
async function createSyncFile(text) {
  const folder = await findOrMakeFolder();
  const b = 'taskstack' + uid();
  const body = '--' + b + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify({ name: SYNC_FILE, parents: [folder], mimeType: 'application/json' }) +
    '\r\n--' + b + '\r\nContent-Type: application/json\r\n\r\n' + text + '\r\n--' + b + '--';
  return driveJSON(DRIVE_UPLOAD + 'files?uploadType=multipart&fields=id,version', {
    method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + b }, body: body
  });
}

// ---------- one sync round: pull if Drive changed, merge, push if we have something new ----------
async function syncOnce() {
  let fileId = sync.fileId;
  let remoteVersion = null;
  if (fileId) {
    try {
      const meta = await driveJSON(DRIVE_API + 'files/' + fileId + '?fields=version,trashed');
      if (meta.trashed) fileId = null; else remoteVersion = meta.version;
    } catch (e) { if (e.status === 404) fileId = null; else throw e; }
  }
  if (!fileId) {                                 // first sync on this device, or the file was deleted
    const found = await findSyncFile();
    if (found) { fileId = found.id; remoteVersion = found.version; sync.version = null; }
  }
  if (!fileId) {                                 // nobody has synced yet: this device starts the file
    setSyncStatus('busy');
    const payload = syncPayload();
    const made = await createSyncFile(JSON.stringify(payload));
    Object.assign(sync, { fileId: made.id, version: made.version, lastFp: syncFingerprint(payload), joined: true });
    saveSync();
    return;
  }
  sync.fileId = fileId;
  if (remoteVersion !== sync.version) {          // another device saved since we last looked
    setSyncStatus('busy');
    const remote = await (await driveFetch(DRIVE_API + 'files/' + fileId + '?alt=media')).json();
    const remoteFp = syncFingerprint(remote);
    applyRemote(remote, !sync.joined);
    Object.assign(sync, { version: remoteVersion, lastFp: remoteFp, joined: true });
    saveSync();
  }
  const payload = syncPayload();
  const fp = syncFingerprint(payload);
  if (fp !== sync.lastFp) {                      // we have edits Drive doesn't
    setSyncStatus('busy');
    const res = await driveJSON(DRIVE_UPLOAD + 'files/' + fileId + '?uploadType=media&fields=version', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    });
    Object.assign(sync, { version: res.version, lastFp: fp });
    saveSync();
  }
}

// Merge Drive's copy into ours and redraw.
function applyRemote(remote, firstTime) {
  remote = normalize(remote);
  if (firstTime) {
    // A new device starts with example tasks and default activity colours. Don't let those
    // spread to (or overwrite) the data you already have on your other devices.
    const ids = {};
    remote.tasks.concat(remote.habits).forEach(function (x) { ids[x.id] = true; });
    state.tasks = state.tasks.filter(function (x) { return !x.example || ids[x.id]; });
    state.habits = state.habits.filter(function (x) { return !x.example || ids[x.id]; });
    state.categories = state.categories.filter(function (c) {
      return !remote.categories.some(function (r) { return r.id === c.id; });
    });
    state.settings = remote.settings;
  }
  const before = syncFingerprint(state);
  const merged = normalize(mergeState(state, remote));
  if (!firstTime && syncFingerprint(merged) === before) return;   // Drive had nothing new for us
  state = merged;
  // Undo snapshots were taken before the other device's edits; replaying one could wipe those out.
  undoStack.length = 0;
  save();
  renderAll();
  if (sheetCtx && sheetCtx.type === 'settings') updateSyncUI();
}

async function syncNow(onlyIfChanged) {
  if (!sync.signedIn) return;
  clearTimeout(syncTimer);
  if (syncBusy) { syncAgain = true; return; }
  if (!navigator.onLine) { setSyncStatus('offline'); return; }
  if (!tokenOk()) { renewToken(false); return; }
  if (onlyIfChanged && sync.fileId && syncFingerprint(state) === sync.lastFp) return;
  if (ctDrag) { syncSoon(1500); return; }        // don't swap data under a finger that's painting
  syncBusy = true;
  try {
    await syncOnce();
    sync.lastSync = now();
    saveSync();
    setSyncStatus('idle');
  } catch (e) {
    if (e.status === 401) renewToken(false);
    else { syncError = e.message || 'network error'; setSyncStatus(navigator.onLine ? 'error' : 'offline'); syncSoon(SYNC_POLL); }
  }
  syncBusy = false;
  if (syncAgain) { syncAgain = false; syncSoon(200); }
}
// Called by save(): push this change soon (one upload per burst of edits).
function syncSoon(delay) {
  if (!sync.signedIn) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(function () { syncNow(true); }, delay === undefined ? SYNC_DELAY : delay);
}

// ---------- status: the cloud button in the header + the Sync box in Settings ----------
function setSyncStatus(s) {
  if (s !== 'error') syncError = '';
  syncStatus = s;
  updateSyncUI();
}
function syncAgo(t) {
  const s = Math.round((now() - t) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return Math.round(s / 60) + ' min ago';
  return 'at ' + fmtTime(t);
}
function syncText() {
  if (!sync.signedIn) return 'Not signed in';
  if (syncStatus === 'busy') return 'Syncing…';
  if (syncStatus === 'offline') return 'Offline. Your changes will sync when you\'re back online.';
  if (syncStatus === 'reconnect') return 'Google sign-in ran out. Tap Reconnect to keep syncing.';
  if (syncStatus === 'error') return 'Couldn\'t reach Google Drive (' + syncError + '). Trying again soon.';
  return sync.lastSync ? 'Synced ' + syncAgo(sync.lastSync) : 'Waiting to sync…';
}
const GOOGLE_G = '<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.8c4.3-4 6.9-9.9 6.9-17.2z"/><path fill="#FBBC05" d="M10.5 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.5 0 20.1 0 24s1 7.5 2.7 10.7l7.8-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.8c-2.1 1.4-4.8 2.3-8.5 2.3-6.2 0-11.5-4.2-13.4-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z"/></svg>';
function syncSettingsHTML() {
  if (!sync.signedIn) {
    return '<p class="small">Keep your tasks, habits, focus log and ColorTracker the same on your phone, iPad and PC. ' +
      'Everything is saved in your own Google Drive (<b>TaskStack/taskstack-data.json</b>). TaskStack can only see the files it made.</p>' +
      '<button class="btn gbtn" data-action="syncsignin">' + GOOGLE_G + '<span>Sign in with Google</span></button>';
  }
  const stuck = syncStatus === 'reconnect';
  return '<div class="sync-state ' + syncStatus + '"><i></i><div><b>' + esc(sync.email || 'Google account') + '</b><span>' + esc(syncText()) + '</span></div></div>' +
    '<div class="row">' + (stuck
      ? '<button class="btn primary" data-action="syncreconnect">Reconnect</button>'
      : '<button class="btn" data-action="syncnow"' + (syncStatus === 'busy' ? ' disabled' : '') + '>Sync now</button>') +
    '<button class="btn danger" data-action="syncsignout">Sign out</button></div>';
}
function updateSyncUI() {
  const btn = $('syncBtn');
  if (btn) {
    btn.dataset.s = sync.signedIn ? syncStatus : 'off';
    btn.setAttribute('aria-label', sync.signedIn ? 'Sync: ' + syncText() : 'Sync with Google Drive');
    btn.title = sync.signedIn ? syncText() : 'Sync with Google Drive';
  }
  const box = $('syncBox');
  if (box) box.innerHTML = syncSettingsHTML();
  const prompt = $('syncPrompt');
  if (prompt) prompt.hidden = !GOOGLE_CLIENT_ID || !!sync.signedIn || !!state.ui.syncPromptDone;
}

// ---------- buttons ----------
actions.syncbtn = function () {
  if (sync.signedIn && syncStatus === 'reconnect') googleSignIn('tap');
  else actions.settings();
};
actions.syncsignin = function () { googleSignIn('new'); };
actions.syncreconnect = function () { googleSignIn('tap'); };
actions.syncnow = function () { syncNow(false); };
actions.syncsignout = function () {
  if (sync.token) {     // revoke, so this browser no longer holds a working Drive key
    fetch('https://oauth2.googleapis.com/revoke?' + query({ token: sync.token }), { method: 'POST' }).catch(function () {});
  }
  clearTimeout(syncTimer);
  sync = {};
  saveSync();
  setSyncStatus('off');
  if (typeof renderAvatar === 'function') renderAvatar();
  if (typeof refreshProfile === 'function') refreshProfile();
  toast('Signed out. Your data stays on this device.');
};
actions.syncpromptno = function () { state.ui.syncPromptDone = true; save(); updateSyncUI(); };

// ---------- start (called from main.js once the page is drawn) ----------
async function fetchEmail() {
  try {
    const info = await driveJSON('https://www.googleapis.com/oauth2/v3/userinfo');
    if (info.email) sync.email = info.email;
    if (info.name) sync.name = info.name;          // only sent if Google shares it; the profile falls back to initials
    if (info.picture) sync.picture = info.picture;
    sync.infoAt = now();
    saveSync();
    updateSyncUI();
    if (typeof renderAvatar === 'function') renderAvatar();
  } catch (e) {}
}
function startSync() {
  updateSyncUI();
  if (syncNotice === 'welcome') {
    toast('Signed in. Syncing with Google Drive…');
    fetchEmail();
  } else if (syncNotice) {
    toast(syncNotice);
  }
  if (!sync.signedIn) return;
  if (!tokenOk()) renewToken(true);
  else { syncNow(false); if (!sync.infoAt) fetchEmail(); }    // older sign-ins: fetch the name / photo for the profile once
  setInterval(function () { if (document.visibilityState === 'visible') syncNow(false); }, SYNC_POLL);
  document.addEventListener('visibilitychange', function () {
    if (!sync.signedIn) return;
    if (document.visibilityState === 'visible') {
      if (!tokenOk()) renewToken(true); else syncNow(false);
    } else if (syncTimer) {
      syncNow(true);                            // leaving the app: push a pending change right away
    }
  });
  window.addEventListener('online', function () { syncNow(false); });
  window.addEventListener('offline', function () { if (sync.signedIn) setSyncStatus('offline'); });
}
