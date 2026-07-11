# Task Time Tracker — Mobile App (PWA + Android APK)

This is the **phone version** of the tracker. It's the same app as the Chrome
extension, packaged as a **PWA** (a website that installs like an app). From it
you can either:

- **A)** install it straight to your phone's home screen (no APK, 1 minute), or
- **B)** turn it into a real **`.apk`** file with a free online tool — **no
  Android Studio needed**.

> **Why not a ready-made `.apk` in this folder?** Building an `.apk` binary
> requires Google's Android build tools. The free service **PWABuilder** does
> that build for you in the browser (step B), so you never install anything on
> your PC.

---

## What works on mobile

Everything from the extension: add tasks, Start / Pause / Stop, live HH:MM:SS,
the English date banner (English + Bengali + Hijri, all in English letters),
Google Sheet sync, offline queueing, and `.xlsx` / `.txt` export.

Two small differences, both handled:
- Reorder tasks with the **▲ ▼ buttons** on each card (drag-and-drop doesn't
  work on touchscreens).
- No hourly background alarm. Instead it **syncs when you open the app**, when
  you tap **Sync**, and whenever the internet comes back. Open it once a day and
  everything reaches your sheet.

Your phone's data is stored on the phone (separate from your PC). Both the PC
extension and the phone app write to the **same Google Sheet**, so the sheet is
your one combined record.

---

## Step 1 — Put the app online (needed for both A and B)

A PWA must be served over **https**. The easiest free way, no accounts, no git:

1. Go to **https://app.netlify.com/drop**
2. Drag this whole **`mobile-app`** folder onto the page.
3. It gives you a public URL like `https://random-name.netlify.app` — that's
   your app. (Optional: make a free account to rename it / keep it.)

*(Alternatives: GitHub Pages, Cloudflare Pages, Vercel — any static host works.
Whatever you use, the folder's files must sit at the site root so
`manifest.webmanifest` and `service-worker.js` are reachable.)*

---

## Step 2A — Install as an app (no APK)

On your Android phone, open that URL in **Chrome**:
1. Tap the **⋮** menu → **Add to Home screen** (or **Install app**).
2. Confirm. A "Task Timer" icon appears on your home screen and opens
   full-screen like a normal app, and it works offline.

*(iPhone: open in Safari → Share → Add to Home Screen.)*

For many people this is enough and you can stop here.

---

## Step 2B — Make a real `.apk` with PWABuilder (no Android Studio)

1. Go to **https://www.pwabuilder.com**
2. Paste your Netlify URL and click **Start**. It checks the manifest / service
   worker (this app already includes both, so it should score well).
3. Click **Package for stores → Android**.
4. Choose the package options:
   - For a phone you'll **sideload** (install directly), you can turn **off**
     "Signing" or let PWABuilder generate a signing key — either works for
     personal use. Keep the generated `signing.keystore` + passwords if you ever
     want to update the app later or publish to Google Play.
5. Click **Download**. You get a `.zip` containing an **`.apk`** (for direct
   install) and an `.aab` (for the Play Store).

### Install the `.apk` on your phone
1. Copy the `.apk` to your phone (USB, Google Drive, email to yourself, etc.).
2. Tap it. Android will ask to allow installing from this source →
   **Settings → Install unknown apps → allow** for the app you're installing from
   (e.g. Files or Chrome).
3. Install. The app icon appears in your app drawer like any other app.

> **Note:** an APK made this way is a thin wrapper around your hosted PWA
> (a "Trusted Web Activity"). It still loads from your URL, so keep the site up.
> Offline still works because the service worker caches the app on the phone.

### Optional — publish to the Google Play Store
The downloaded package includes the `.aab` and instructions. You'd need a
one-time **$25** Google Play developer account, then upload the `.aab`. For
personal use, the sideloaded `.apk` from the step above is enough and free.

---

## Google Sheet setup (same as the extension)

First launch shows the setup screen. You need the **same two values** as the
PC extension:
1. Your Google Sheet link.
2. The Apps Script **Web App URL** (`…/exec`).

If you already set up the Apps Script bridge for the extension (see the main
[`../README.md`](../README.md)), just reuse that same URL here — no new setup.
Make sure the deployment's access is **"Anyone with the link"** so the phone can
reach it.

---

## Files in this folder

| File | Purpose |
|------|---------|
| `index.html` | The mobile page (same layout as the extension popup). |
| `styles.css` | Responsive, full-screen, finger-friendly styling. |
| `app.js` | The app logic (same as the extension, + ▲▼ reorder). |
| `sync.js` | Google Sheet sync engine (shared, unchanged). |
| `zip.js` | Excel/ZIP writer (shared, unchanged). |
| `chrome-shim.js` | Tiny bridge so the extension code runs in a plain browser. |
| `manifest.webmanifest` | PWA manifest — makes it installable. |
| `service-worker.js` | Offline caching + installability. |
| `icons/` | App icons incl. 192 / 512 / maskable for Android. |

## Troubleshooting

- **"Add to Home screen" / Install option is missing** → the site must be
  **https** and `manifest.webmanifest` + `service-worker.js` must load. Netlify
  Drop gives https automatically. Reload once after first visit.
- **Sync fails on mobile** → confirm the Apps Script deployment access is
  "Anyone with the link". Your data stays saved locally and re-sends next time.
- **Changed a file?** → bump `CACHE_VERSION` in `service-worker.js`, re-upload,
  and reopen the app so the phone fetches the new version.
