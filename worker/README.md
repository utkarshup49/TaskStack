# TaskStack reminders on Telegram (Cloudflare Worker)

This small server sends your task reminders to Telegram, even when TaskStack is closed.
It is free: Cloudflare's free plan and a free Telegram bot are enough.

You do this once, on the PC. It takes about 15 minutes.

## Part 1: make the Telegram bot (2 min)
1. Open Telegram, search for **@BotFather**, press **Start**.
2. Send `/newbot`.
3. Give it a name (e.g. `TaskStack Reminders`) and a username that ends in `bot` (e.g. `utkarsh_taskstack_bot`).
4. BotFather replies with a **token** like `1234567890:AAH...`. Copy it. Keep it private.

## Part 2: make the Cloudflare Worker (10 min)
1. Go to https://dash.cloudflare.com and sign up / log in (free).
2. Left menu: **Storage & Databases → KV → Create a namespace**. Name it `taskstack` and add it.
3. Left menu: **Workers & Pages → Create → Start with Hello World**. Name it `taskstack-reminders`, press **Deploy**.
4. Press **Edit code**. Delete everything in the editor, paste the whole of `worker/worker.js` from this repo, press **Deploy**.
5. Open the Worker's **Settings**:
   - **Variables and Secrets → Add**: type **Secret**, name `BOT_TOKEN`, value = the token from BotFather.
   - **Variables and Secrets → Add**: type **Secret**, name `SETUP_KEY`, value = any long random word you make up
     (letters and numbers only, e.g. `ts9fK2mQ7xLp4Zr8`). Save it somewhere; you need it once in Part 3.
   - **Bindings → Add → KV namespace**: variable name `DATA`, namespace `taskstack`.
   - **Trigger Events → Add → Cron Triggers**: cron expression `* * * * *` (every minute).
6. Copy the Worker's address from the top of its page. It looks like
   `https://taskstack-reminders.YOURNAME.workers.dev`.

(Dashboard labels move around now and then. If one is named a little differently, look for the same word nearby.)

## Part 3: connect the two (1 min)
1. In the browser open: `https://taskstack-reminders.YOURNAME.workers.dev/setup?key=YOUR_SETUP_KEY`
2. You should see `{"ok":true,"bot":"your_bot_username", ...}`. That told Telegram to send the bot's messages to the Worker.

## Part 4: in TaskStack (1 min)
1. Open TaskStack → profile (top right) → **Reminders**.
2. Paste the Worker address under **Telegram** and press **Save**.
3. Press **Open Telegram**, then **Start** in the bot chat. The bot says "Connected".
4. Back in TaskStack press **Send a test**. A message should arrive in Telegram.

Do Part 4 on one device only if you use Google Drive sync: the setting travels to your other devices.

## Using it
- Add a reminder to any task as usual. It arrives in Telegram at that time.
- Buttons under the message: **Done** (TaskStack ticks the task the next time you open it), or snooze 10 min / 1 hour / 3 hours.
- In the bot chat: `/list` shows what is coming, `/stop` turns reminders off.
- TaskStack sends the Worker your next 60 days of reminders whenever they change, so open the app now and then
  (for a repeating task, the next reminder is sent after you finish the current one).

## If something does not work
- `/setup` says `wrong key`: the key in the address must match the `SETUP_KEY` secret exactly.
- `/setup` says the Worker is not set up: one of `BOT_TOKEN`, `SETUP_KEY` or the `DATA` binding is missing (Part 2, step 5).
- The bot does not answer **Start**: open the `/setup?key=...` address again.
- Test arrives but real reminders do not: check the Cron Trigger exists (`* * * * *`).
- Changed the Worker code later? Paste the new `worker.js` and press **Deploy** again. Secrets and the KV stay.

## What is stored on Cloudflare
Only what the reminders need: each reminder's task title, its time, a short line like "Today 5:00 PM · College",
and your Telegram chat id. No notes, no steps, no other data. **Disconnect** in TaskStack deletes it.

## Deploying from the PC instead (optional)
`cd worker`, put your KV namespace id in `wrangler.toml`, then:
`npx wrangler deploy`, `npx wrangler secret put BOT_TOKEN`, `npx wrangler secret put SETUP_KEY`.
