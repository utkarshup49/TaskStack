/* =========================================================
   TaskStack reminders: a tiny Cloudflare Worker.
   It sends your task reminders to you on Telegram, even when the
   TaskStack app is closed.

   How it works
   - The app sends its list of coming reminders here ( POST /sync ).
   - Every minute Cloudflare runs scheduled() below. Reminders whose time
     has come are sent to your Telegram chat by your bot.
   - Buttons under each message: Done, or snooze 10 min / 1 hour / 3 hours.
     "Done" is kept here until the app next syncs, then the app ticks the task.

   What it needs (see worker/README.md for the steps)
   - KV namespace bound as DATA      (where the reminders are kept)
   - secret BOT_TOKEN                (from @BotFather)
   - secret SETUP_KEY                (any long random word you make up)
   - a Cron Trigger: every minute    (* * * * *)

   Everything is stored under ONE key ("store") so the every-minute check
   costs one read. Fine for you and a few friends; not built for thousands.
   ========================================================= */

const MAX_USERS = 200;        // people (app installs) this worker will hold
const MAX_ITEMS = 300;        // reminders kept per person
const LATE_LIMIT = 12 * 60 * 60 * 1000;   // a reminder more than 12 h late is dropped, not sent
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

function json(data, status) {
  return new Response(JSON.stringify(data), { status: status || 200, headers: Object.assign({ 'Content-Type': 'application/json' }, CORS) });
}
function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function goodKey(k) { return typeof k === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(k); }

// ---------- storage ----------
async function loadStore(env) {
  const s = await env.DATA.get('store', 'json');
  return s && s.users ? s : { users: {} };
}
async function saveStore(env, store) { await env.DATA.put('store', JSON.stringify(store)); }
function userOf(store, key, make) {
  if (!store.users[key] && make) {
    if (Object.keys(store.users).length >= MAX_USERS) return null;
    store.users[key] = { chat: null, name: '', items: [], snoozed: [], actions: [], seen: Date.now() };
  }
  return store.users[key] || null;
}
function userByChat(store, chat) {
  const key = Object.keys(store.users).find(function (k) { return store.users[k].chat === chat; });
  return key ? store.users[key] : null;
}

// ---------- Telegram ----------
async function tg(env, method, body) {
  const res = await fetch('https://api.telegram.org/bot' + env.BOT_TOKEN + '/' + method, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {})
  });
  return res.json();
}
function send(env, chat, text, buttons) {
  const body = { chat_id: chat, text: text, parse_mode: 'HTML', disable_web_page_preview: true };
  if (buttons) body.reply_markup = { inline_keyboard: buttons };
  return tg(env, 'sendMessage', body);
}
// The buttons under a reminder. n = its number in this person's "sent" list (short, fits Telegram's 64-byte limit).
function reminderButtons(n) {
  return [
    [{ text: '✅ Done', callback_data: 'd:' + n }],
    [{ text: '⏰ 10 min', callback_data: 's:10:' + n }, { text: '⏰ 1 hour', callback_data: 's:60:' + n }, { text: '⏰ 3 hours', callback_data: 's:180:' + n }]
  ];
}
function reminderText(it) {
  return '⏰ <b>' + esc(it.title) + '</b>' + (it.sub ? '\n' + esc(it.sub) : '');
}

// ---------- every minute: send what is due ----------
async function sendDue(env) {
  const store = await loadStore(env);
  const now = Date.now();
  let changed = false;
  for (const key of Object.keys(store.users)) {
    const u = store.users[key];
    for (const listName of ['items', 'snoozed']) {
      const due = u[listName].filter(function (it) { return it.at <= now; });
      if (!due.length) continue;
      u[listName] = u[listName].filter(function (it) { return it.at > now; });
      changed = true;
      if (!u.chat) continue;                          // not linked to Telegram yet: nothing to send to
      for (const it of due) {
        if (now - it.at > LATE_LIMIT) continue;
        u.sent = (u.sent || []).slice(-40);           // remember the last few, so the buttons know which task they belong to
        u.n = (u.n || 0) + 1;
        u.sent.push({ n: u.n, t: it.t, title: it.title, sub: it.sub });
        const r = await send(env, u.chat, reminderText(it), reminderButtons(u.n));
        if (r && r.ok === false && r.error_code === 403) u.chat = null;      // the person blocked the bot: stop trying
      }
    }
  }
  if (changed) await saveStore(env, store);
}

// ---------- messages and button presses from Telegram ----------
async function onTelegram(env, update) {
  const store = await loadStore(env);
  if (update.callback_query) {
    const q = update.callback_query;
    const chat = q.message && q.message.chat.id;
    const u = userByChat(store, chat);
    const parts = String(q.data || '').split(':');
    const n = Number(parts[parts.length - 1]);
    const it = u && (u.sent || []).find(function (x) { return x.n === n; });
    let note = 'This reminder is too old.';
    if (it && parts[0] === 'd') {
      u.actions.push({ type: 'done', t: it.t, at: Date.now() });
      u.actions = u.actions.slice(-100);
      note = 'Done. TaskStack ticks it the next time you open the app.';
      await tg(env, 'editMessageText', { chat_id: chat, message_id: q.message.message_id, parse_mode: 'HTML', text: '✅ <s>' + esc(it.title) + '</s>' });
      await saveStore(env, store);
    } else if (it && parts[0] === 's') {
      const mins = Math.max(1, Math.min(1440, Number(parts[1]) || 10));
      u.snoozed.push({ id: 'z' + n + '-' + Date.now(), t: it.t, at: Date.now() + mins * 60000, title: it.title, sub: 'Snoozed reminder' });
      note = 'Snoozed for ' + (mins < 60 ? mins + ' min' : (mins / 60) + (mins === 60 ? ' hour' : ' hours')) + '.';
      await tg(env, 'editMessageText', { chat_id: chat, message_id: q.message.message_id, parse_mode: 'HTML', text: '💤 <b>' + esc(it.title) + '</b>\n' + note });
      await saveStore(env, store);
    }
    await tg(env, 'answerCallbackQuery', { callback_query_id: q.id, text: note });
    return;
  }
  const msg = update.message;
  if (!msg || !msg.text) return;
  const chat = msg.chat.id;
  const text = msg.text.trim();
  if (text.indexOf('/start') === 0) {
    const key = text.split(/\s+/)[1];
    if (!goodKey(key)) {
      await send(env, chat, 'Hi! To connect me, open <b>TaskStack → Profile → Reminders → Telegram</b> and tap <b>Open Telegram</b>. That link tells me which TaskStack is yours.');
      return;
    }
    const old = userByChat(store, chat);
    if (old) old.chat = null;                         // one chat follows one TaskStack
    const u = userOf(store, key, true);
    if (!u) { await send(env, chat, 'Sorry, this reminder server is full.'); return; }
    u.chat = chat;
    u.name = msg.from && msg.from.first_name ? msg.from.first_name : '';
    await saveStore(env, store);
    await send(env, chat, '✅ Connected' + (u.name ? ', ' + esc(u.name) : '') + '. Your TaskStack reminders will arrive here.\n\n/list shows what is coming up.\n/stop turns them off.');
    return;
  }
  const u = userByChat(store, chat);
  if (text === '/stop') {
    if (u) { u.chat = null; await saveStore(env, store); }
    await send(env, chat, 'Reminders are off. Connect again from TaskStack any time.');
  } else if (text === '/list') {
    if (!u) { await send(env, chat, 'Not connected yet. Open TaskStack → Profile → Reminders → Telegram.'); return; }
    const all = u.items.concat(u.snoozed).sort(function (a, b) { return a.at - b.at; }).slice(0, 15);
    await send(env, chat, all.length ? '<b>Coming up</b>\n' + all.map(function (it) { return '• ' + esc(it.title) + (it.sub ? ' <i>(' + esc(it.sub) + ')</i>' : ''); }).join('\n') : 'No reminders waiting. Add one to a task in TaskStack.');
  } else {
    await send(env, chat, 'I only send reminders. Try /list or /stop.');
  }
}

// ---------- requests from the TaskStack app ----------
async function onApp(env, path, body) {
  if (!goodKey(body.key)) return json({ error: 'bad key' }, 400);
  const store = await loadStore(env);
  if (path === '/status') {
    const u = userOf(store, body.key, false);
    return json({ linked: !!(u && u.chat), name: u ? u.name : '', waiting: u ? u.items.length + u.snoozed.length : 0, bot: store.bot || null });
  }
  const u = userOf(store, body.key, true);
  if (!u) return json({ error: 'server full' }, 507);
  if (path === '/sync') {
    const now = Date.now();
    const items = (Array.isArray(body.items) ? body.items : []).filter(function (it) {
      return it && typeof it.at === 'number' && it.at > now - 60000 && typeof it.title === 'string';
    }).slice(0, MAX_ITEMS).map(function (it) {
      return { id: String(it.id || '').slice(0, 120), t: String(it.t || '').slice(0, 60), at: it.at, title: it.title.slice(0, 200), sub: String(it.sub || '').slice(0, 200) };
    });
    const live = {};
    items.forEach(function (it) { live[it.t] = true; });
    if (Array.isArray(body.open)) body.open.forEach(function (t) { live[String(t)] = true; });
    const before = JSON.stringify([u.items, u.snoozed, u.actions]);
    u.snoozed = u.snoozed.filter(function (it) { return !body.open || live[it.t]; });    // a snooze for a finished / deleted task is dropped
    u.items = items;
    const actions = u.actions;
    u.actions = [];
    if (JSON.stringify([u.items, u.snoozed, u.actions]) !== before) { u.seen = now; await saveStore(env, store); }   // free plan: 1,000 writes a day, so only write real changes
    return json({ linked: !!u.chat, name: u.name, actions: actions, kept: items.length, bot: store.bot || null });
  }
  if (path === '/test') {
    if (!u.chat) return json({ linked: false });
    const r = await send(env, u.chat, '🔔 <b>Test from TaskStack</b>\nReminders will look like this, with buttons to finish or snooze.');
    return json({ linked: true, sent: !!(r && r.ok) });
  }
  if (path === '/unlink') {
    if (u.chat) await send(env, u.chat, 'Disconnected from TaskStack. No more reminders here.');
    delete store.users[body.key];
    await saveStore(env, store);
    return json({ linked: false });
  }
  return json({ error: 'not found' }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    try {
      if (!env.BOT_TOKEN || !env.SETUP_KEY || !env.DATA) return json({ error: 'Worker is not set up: it needs BOT_TOKEN, SETUP_KEY and the DATA KV binding.' }, 500);
      if (url.pathname === '/') {
        return json({ ok: true, what: 'TaskStack reminders', bot: (await loadStore(env)).bot || null });
      }
      // One-time: tell Telegram to send this worker the bot's messages. Open /setup?key=YOUR_SETUP_KEY once.
      if (url.pathname === '/setup') {
        if (url.searchParams.get('key') !== env.SETUP_KEY) return json({ error: 'wrong key' }, 403);
        const hook = await tg(env, 'setWebhook', { url: url.origin + '/tg', secret_token: env.SETUP_KEY, allowed_updates: ['message', 'callback_query'] });
        const me = await tg(env, 'getMe');
        await tg(env, 'setMyCommands', { commands: [{ command: 'list', description: 'What is coming up' }, { command: 'stop', description: 'Turn reminders off' }] });
        const store = await loadStore(env);
        store.bot = me && me.result ? me.result.username : null;
        await saveStore(env, store);
        return json({ ok: !!(hook && hook.ok), bot: store.bot, telegramSaid: hook && hook.description });
      }
      if (url.pathname === '/tg' && request.method === 'POST') {
        if (request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.SETUP_KEY) return json({ error: 'not Telegram' }, 403);
        await onTelegram(env, await request.json());
        return json({ ok: true });
      }
      if (request.method === 'POST') {
        let body = {};
        try { body = await request.json(); } catch (e) {}
        const res = await onApp(env, url.pathname, body || {});
        return res;
      }
      return json({ error: 'not found' }, 404);
    } catch (e) {
      return json({ error: String(e && e.message || e) }, 500);
    }
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(sendDue(env));
  }
};
