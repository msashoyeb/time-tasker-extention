# Task Time Tracker — Chrome Extension (Manifest V3)

Track time on named tasks with independent Start / Pause / Stop timers, sync
daily study totals to **your own Google Sheet**, queue data while offline, and
export the yearly sheet as **Excel (.xlsx)** or **plain text (.txt)**.

Raw timer data lives locally in `chrome.storage.local`. The only network calls
are to *your* Apps Script (Sheets sync) and AlAdhan (Hijri date refinement).

---

## 1 · Install the extension

1. Open `chrome://extensions` in Chrome.
2. Toggle **Developer mode** on (top-right).
3. Click **Load unpacked** and select this `task-timer-extension` folder.
4. Pin the stopwatch icon and click it.

## 2 · Connect your Google Sheet (one time, ~3 minutes)

The extension writes to your sheet through a tiny Apps Script "bridge" that runs
under your own Google account — no Google Cloud project or OAuth setup needed.

1. Open your Google Sheet (e.g. `https://docs.google.com/spreadsheets/d/…/edit`).
2. Menu: **Extensions → Apps Script**. Delete any starter code.
3. Paste the entire contents of [`apps-script/Code.gs`](apps-script/Code.gs) and save.
4. Click **Deploy → New deployment**, choose type **Web app**:
   - *Execute as*: **Me**
   - *Who has access*: **Anyone with the link**
5. Click **Deploy**, authorize when Google asks, and **copy the Web app URL**
   (it ends in `/exec`).
6. On the extension's first launch it asks for two inputs: paste your **sheet
   link** and that **Web app URL**, then click **Save & Connect**.
   (Reopen this screen anytime with the ⚙ button.)

## 3 · How syncing works

- Every time you **Stop** a timer, its duration is added to that day's total.
- **Online**: daily totals upload to the sheet (manual **Sync** button, on
  popup open if >1 hour has passed, and hourly in the background via
  `chrome.alarms` even with the popup closed).
- **Offline**: totals just accumulate locally — for however many days. Once
  you're back online they all sync, then fully-synced *past* days are cleared
  locally so each new day starts fresh.
- **No duplicates**: a day is only sent when its total changed, and the script
  *updates* an existing day's row instead of appending a second one.
- Sheet layout (per year, sheet named `2026`, `2027`, … created automatically
  with a bold header in A1):

  | Date | Day | Today (HH:MM:SS) | Net Total (cumulative) | Comment |
  |------|-----|------------------|------------------------|---------|
  | 03-Jul-2026 09:45 PM | Friday | 01:30:15 | 05:12:40 | |

  - **Net Total** = previous day's net + today, **reset at each new month**.
  - After a month ends: one blank row, then the month name in bold, then the
    next month's rows.
  - If you **delete a row** in the sheet it is *not* recreated — new days keep
    appending normally (the script remembers synced dates).
  - The **Comment** column is never touched by sync — your notes survive.
  - On Jan 1 the next year's sheet is created automatically with its header.

## 4 · Popup features

- **Date banner** — live English date/time (AM/PM) and day, plus the Bengali
  calendar and Hijri dates **written in English** (e.g. `19 Asharh 1433 BS` and
  `18 Muharram 1448 AH`; computed locally, refined from the AlAdhan API online).
- **+** — add a task; each card has **Start / Pause / Stop** (Stop asks for
  confirmation and permanently logs the session).
- **One task at a time** — starting a task automatically pauses whichever task
  was running, so time is never counted twice.
- **Recurring (↻)** — click the circular arrow on a card to make it recurring.
  Recurring tasks carry over to the next day; non-recurring tasks are removed
  when the day changes (see *Business logic* below).
- Cards are color-coded: green = running, amber = paused, grey = idle/stopped.
- **Drag a card** to reorder tasks.
- **Sync** — sync to the sheet immediately; the footer shows pending days /
  last sync time.
- **Export** — downloads *this year's Google Sheet data* (not raw local data)
  as `.xlsx` or `.txt`, in AM/PM time format. Requires internet.
- **Clear All** — removes all tasks and local session history (with
  confirmation). Unsynced daily totals are kept so no sheet data is lost.

## 5 · Business logic (the rules, in plain words)

These are the rules the app follows. Nothing here is hidden — it all lives in
`popup.js` (extension) and `netlify-web-app/app.js` (web app), which share the
same logic.

**A task and its timer**

- A task is just a name with a clock. Each clock has one of four states:
  **idle** (never started), **running**, **paused**, **stopped**.
- **Start** runs the clock. **Pause** freezes it (you can resume). **Stop**
  ends the session for good and writes it to the local history log.
- Time is measured from real timestamps (`accumulated + (now − start)`), not a
  ticking counter — so closing the popup or restarting the browser never loses
  or skews time.
- **Only one task runs at a time.** Starting a task auto-pauses any other
  running task, so the same minute is never counted twice.

**Daily total (what actually syncs to your sheet)**

- Every day has one total. A task's time is added to that total the moment the
  time is "banked".
- Time is banked when you press **Stop**, and also automatically **before a task
  is removed** — whether it is running or paused, recurring or not — so time on
  the clock is never thrown away.
- Banked time counts toward the day the session **started** (`sessionStart`). A
  timer running across midnight is credited to the day it began.

**Recurring tasks (↻) and the day change**

When the calendar day changes (checked when you open the app, and every second
while it stays open):

- **Recurring task (↻ on):** it stays for the new day. Any time on its clock is
  first counted toward the *previous* day's total, then the clock is **reset to
  00:00:00** for the new day.
- **Non-recurring task (↻ off):** it is **removed completely**. Any time on its
  clock is still counted toward the previous day's total first, then it's gone.
- In short: **recurring = keep and reset to zero each day; non-recurring = one
  day only.** Either way, time already spent is never lost.

**Syncing to Google Sheets**

- **When:** on demand (the **Sync** button), when you open the popup if it's been
  over 1 hour since the last sync, once an hour in the background (extension
  only, via `chrome.alarms`), and the moment the internet reconnects.
- **Offline:** totals pile up locally for as many days as needed; they all sync
  once you're back online, then fully-synced *past* days are cleared locally.
- **No duplicates:** a day is only sent if its total changed, and the Apps
  Script *updates* that day's existing row instead of adding a second one.
- Your **Comment** column and any row you delete in the sheet are left alone.

## Files

| File | Purpose |
|------|---------|
| `manifest.json` | MV3 manifest (`storage`, `downloads`, `alarms`; host access to script.google.com + api.aladhan.com). |
| `popup.html` / `popup.css` / `popup.js` | Popup UI: timers, date banner, setup, drag & drop, export. |
| `sync.js` | Shared sync engine (offline queue, dedupe) used by popup **and** background worker. |
| `background.js` | Service worker: storage init + hourly auto-sync alarm. |
| `zip.js` | Dependency-free ZIP/XLSX writer (real Excel files, CSP-safe). |
| `apps-script/Code.gs` | The Sheets bridge you paste into Apps Script. |
| `icons/` | 16 / 48 / 128 px stopwatch icons. |

## Accuracy across restarts

Timing is **timestamp-based**: elapsed time is always computed as
`accumulated + (now − segmentStart)` from `chrome.storage.local`, so closing
the popup or restarting Chrome never loses or skews time. `setInterval` only
repaints the on-screen digits.

## Publishing to the Chrome Web Store

A ready-to-upload package is in `store-package/task-time-tracker-v2.0.0.zip`
(it contains only the extension files — no docs or the Apps Script source).

1. **Developer account** — go to
   [chrome.google.com/webstore/devconsole](https://chrome.google.com/webstore/devconsole),
   sign in with your Google account, and pay the **one-time $5** registration fee.
2. **New item** — click **+ New item** and upload the ZIP.
3. **Store listing tab** — fill in:
   - Description (what it does, in plain words).
   - Category: *Productivity → Tools*.
   - At least **one screenshot, 1280×800 or 640×400 px** (open the popup, zoom
     if needed, and screenshot it on a neutral background).
   - The 128×128 icon is taken from the ZIP automatically.
4. **Privacy tab** — this is what reviewers check hardest:
   - *Single purpose*: "Tracks time spent on user-named tasks and logs daily
     totals to the user's own Google Sheet."
   - *Permission justifications*:
     - `storage` — save timers and history locally.
     - `downloads` — let the user download their export file.
     - `alarms` — hourly background sync to the user's sheet.
     - `script.google.com` / `script.googleusercontent.com` — send data to the
       user's own Apps Script bridge.
     - `api.aladhan.com` — fetch the Hijri (Islamic) date for the header.
   - *Data usage*: tick that data is **not** sold / not used for unrelated
     purposes. All user data goes only to the user's own Google Sheet.
   - You need a **privacy policy URL** because the extension has host
     permissions. A one-page Google Doc (set to "anyone with link") saying the
     extension stores data locally and only sends it to the user's own sheet
     is acceptable.
5. **Distribution tab** — Public (or Unlisted, if it's just for you — unlisted
   skips no review but hides it from search).
6. **Submit for review** — first review typically takes a few days. Extensions
   with host permissions get a closer look; the justifications above cover it.

**Updating later**: bump `"version"` in `manifest.json` (e.g. `2.0.1`), rebuild
the ZIP, upload it on the same item, submit again.

**Tip**: if the extension is only for yourself, you can skip the store entirely
and keep using **Load unpacked** — it works permanently in Developer mode.

## Troubleshooting

- **"Couldn't reach the script"** during setup → re-check the URL ends in
  `/exec` and the deployment's access is *Anyone with the link*. After editing
  Code.gs you must create a **new deployment version** (Deploy → Manage
  deployments → ✏ → New version).
- **Rows not appearing** → click **Sync** and watch the footer status; days
  already synced only re-send when their total grows.
- **Wrong sheet** → the sheet ID comes from the link you pasted; update it via ⚙.
