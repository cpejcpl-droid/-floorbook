# Floor Book — Machine Scheduler (standalone)

A shared booking scheduler for your shop floor machines:
Power Press 50T (1), Power Press 10T (×3), Orbital Riveting (1).

Everyone who opens this app sees the **same live schedule** — bookings are
stored on the server, not in each person's browser. When a booking is made,
it emails the operator (and CC's a supervisor address) with a calendar
invite (`.ics`) attached.

## 1. Run it locally

Requires [Node.js](https://nodejs.org) 18 or newer.

```bash
npm install
cp .env.example .env
# edit .env — see "Gmail setup" below
npm start
```

Open **http://localhost:3000** in your browser.

## 2. Gmail setup (for email + calendar invites)

Gmail blocks your normal password for apps like this — you need an
**App Password** instead:

1. Turn on 2-Step Verification on the Gmail account (cpe.jcpl@gmail.com):
   https://myaccount.google.com/security
2. Create an App Password: https://myaccount.google.com/apppasswords
3. Put that 16-character password into `.env` as `GMAIL_APP_PASSWORD`
   (spaces are fine, e.g. `abcd efgh ijkl mnop`)
4. Set `GMAIL_USER=cpe.jcpl@gmail.com` and `SUPERVISOR_EMAIL=cpe.jcpl@gmail.com`

If you skip this, the app still works fully — it just won't send emails
(you'll see a warning in the server log, and bookings save normally).

## 3. Telegram setup (free, no phone verification needed)

Telegram bots send free instant messages and don't require verifying a
business phone number — only a normal Telegram account is needed (which
you likely already have).

1. Open Telegram, search for **@BotFather**, and start a chat with it.
2. Send `/newbot`, give it a name and a username (must end in "bot",
   e.g. `floorbook_notify_bot`).
3. BotFather replies with a **token** like
   `123456789:ABCdefGhIJKlmNoPQRstuVWXyz` — copy this into `.env` as
   `TELEGRAM_BOT_TOKEN`.
4. Each person who should get notifications (operators, supervisor) needs
   their own **Telegram numeric ID**. The easiest way: have them message
   **@userinfobot** on Telegram — it instantly replies with their ID.
5. Put the supervisor's ID into `.env` as `SUPERVISOR_TELEGRAM_ID`.
6. In the app, each booking has fields for the operator's and the form
   filler's Telegram ID — fill those in per booking to notify them
   directly.
7. **Important:** a bot can't message someone until that person has sent
   the bot at least one message first (a Telegram anti-spam rule). Have
   everyone who should get notified open your bot (search its username in
   Telegram) and send it anything, e.g. "hi", once.

If you skip this, Telegram messages just won't send — email still works.


## 4. Put it on the internet (so anyone can use it from their phone/PC)

This app needs a server that keeps running and can write to a data file, so
it's a good fit for **Render** or **Railway** (both have free tiers).
Vercel/Netlify are built for static sites/serverless functions and don't
keep a writable file around between requests, so avoid those for this app
unless you swap the JSON file for a hosted database.

### Deploy on Render (recommended, free tier available)
1. Push this folder to a GitHub repo.
2. Go to https://render.com → **New +** → **Web Service** → connect the repo.
3. Build command: `npm install` — Start command: `npm start`
4. Add environment variables (from your `.env`): `GMAIL_USER`,
   `GMAIL_APP_PASSWORD`, `SUPERVISOR_EMAIL`, `TELEGRAM_BOT_TOKEN`,
   `SUPERVISOR_TELEGRAM_ID`.
5. Under **Disks**, add a small persistent disk mounted at `/data` so
   bookings survive restarts, and change `DATA_FILE` in `server.js`
   to `/data/bookings.json` (one line change) before deploying.
6. Deploy. Render gives you a public URL like
   `https://floorbook.onrender.com` — share that with your team.

### Deploy on Railway
Same idea: connect the repo at https://railway.app, set the same
environment variables, add a volume for `/app/data`, deploy.

### Your own server / VPS
```bash
git clone <your-repo>
cd floorbook
npm install
cp .env.example .env   # fill in real values
npm start               # or use pm2 / systemd to keep it running
```
Put Nginx or Caddy in front of it for HTTPS and a real domain name.

## What's inside

- `server.js` — Express API: create/edit/delete bookings, conflict
  checking, Gmail sending, `.ics` calendar file generation
- `public/index.html` — the Apple-styled scheduler UI (machine board,
  day timeline, booking list)
- `data/bookings.json` — where bookings are stored (back this up / put it
  on a persistent disk when you deploy)
