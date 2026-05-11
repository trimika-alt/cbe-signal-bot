# CBE Signal Bot

Slack bot that exposes a `/cbe-signal` slash command. The command opens a short
modal; on submit, the bot appends one row to a Google Sheet so the CBE
(Culture, Belonging, Engagement) team can hear what's really happening across
Duolingo.

## What gets logged

Each submission appends a row with these columns:

| Timestamp | Office | Area | Function | Pillar | Signal (verbatim) | Anonymous | Submitted by | Source |
| --------- | ------ | ---- | -------- | ------ | ----------------- | --------- | ------------ | ------ |

`Source` is always `slash-command`. `Submitted by` is blank when the user
chooses to remain anonymous; in that case the bot does not look up or store
their Slack identity at all.

---

## 1. Create a Google Service Account and share the sheet with it

1. Open the [Google Cloud Console](https://console.cloud.google.com/) and pick
   (or create) a project.
2. **APIs & Services → Library** → enable **Google Sheets API**.
3. **APIs & Services → Credentials → Create credentials → Service account**.
   - Name it something like `cbe-signal-bot`. Skip the optional role steps.
4. Open the new service account → **Keys → Add key → Create new key → JSON**.
   Save the downloaded file somewhere safe — it contains a private key.
5. Create the destination Google Sheet. Note its ID (the long string between
   `/d/` and `/edit` in the URL) — this is `GOOGLE_SHEET_ID`.
6. Add a header row in row 1 matching the columns above (optional but
   recommended).
7. Click **Share** on the sheet and share it with the service account's
   `client_email` (looks like `cbe-signal-bot@your-project.iam.gserviceaccount.com`)
   as an **Editor**.

`GOOGLE_SERVICE_ACCOUNT_JSON` must be the **entire JSON file contents** as a
single string. On Railway / most hosts, paste it as-is into the variable; the
app calls `JSON.parse` on it.

When putting it in a local `.env`, wrap it in single quotes so newlines in the
private key survive:

```
GOOGLE_SERVICE_ACCOUNT_JSON='{"type":"service_account","project_id":"...","private_key":"-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n","client_email":"...","..."}'
```

---

## 2. Create the Slack app

1. Go to <https://api.slack.com/apps> → **Create New App → From scratch**.
2. **OAuth & Permissions → Bot Token Scopes**, add:
   - `commands`
   - `chat:write`
   - `im:history`
   - `users:read`
3. **Slash Commands → Create New Command**:
   - Command: `/cbe-signal`
   - Request URL: `https://<your-host>/slack/events` (placeholder — you'll
     update this after deploy)
   - Short description: `Share a culture/belonging signal with the CBE team`
4. **Interactivity & Shortcuts → Interactivity: On**, Request URL:
   `https://<your-host>/slack/events` (same URL)
5. **Install App** → install to the workspace. Copy the **Bot User OAuth Token**
   (`xoxb-…`) → `SLACK_BOT_TOKEN`.
6. **Basic Information → Signing Secret** → `SLACK_SIGNING_SECRET`.

---

## 3. Run locally

```bash
npm install
cp .env.example .env
# fill in .env
node app.js
```

The app listens on `PORT` (default `3000`) and exposes Slack's endpoints at
`/slack/events`. To let Slack reach it during local testing, run a tunnel:

```bash
ngrok http 3000
```

Use the `https://…ngrok.io/slack/events` URL as the Slash Command Request URL
and the Interactivity Request URL while developing.

---

## 4. Deploy to Railway (free tier)

1. Push this repo to GitHub.
2. <https://railway.app> → **New Project → Deploy from GitHub repo** → pick the
   repo.
3. Railway auto-detects Node and runs `npm install` then `npm start`.
4. **Variables** tab — add every variable from `.env.example`:
   - `SLACK_BOT_TOKEN`
   - `SLACK_SIGNING_SECRET`
   - `GOOGLE_SHEET_ID`
   - `GOOGLE_SERVICE_ACCOUNT_JSON` (paste the full JSON; Railway handles
     newlines for you)
   - `PORT` — leave unset; Railway injects its own `PORT`.
5. **Settings → Networking → Generate Domain**. You'll get something like
   `cbe-signal-bot-production.up.railway.app`.

---

## 5. Point Slack at the deployed URL

Back in <https://api.slack.com/apps> → your app:

1. **Slash Commands** → edit `/cbe-signal` → Request URL:
   `https://<your-railway-domain>/slack/events` → Save.
2. **Interactivity & Shortcuts** → Request URL:
   `https://<your-railway-domain>/slack/events` → Save.

Both endpoints are the same; Bolt routes by payload type.

Test from any Slack channel:

```
/cbe-signal
```

A modal should open. Submitting it appends a row to the sheet and replies with
an ephemeral confirmation.

---

## Anonymity guarantee

When a user picks **"Yes — keep me anonymous"**, the code path skips
`users.info` entirely and writes an empty string to the `Submitted by` column.
The Slack user ID is never written to the sheet. The slash command's
`response_url` is used only to send the ephemeral confirmation back — that
exchange happens between Slack and the bot, never touching the sheet.
