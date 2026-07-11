/* ============================================================================
   Task Time Tracker — popup.js
   ----------------------------------------------------------------------------
   This file controls everything you see in the popup window.

   HOW THE FILE IS ORGANIZED (search for the section number to jump there):

     [1] SMALL HELPERS      - shortcuts used everywhere
     [2] STATE + STORAGE    - the data and how it is saved/loaded
     [3] DATE BANNER        - English / Bengali / Hijri dates at the top
     [4] TIMER ACTIONS      - add / start / pause / stop / delete a task
     [5] DRAWING THE SCREEN - building the task cards + live ticking
     [6] DRAG & DROP        - reorder task cards with the mouse
     [7] POPUP DIALOGS      - confirmation box + toast messages
     [8] GOOGLE SHEET SETUP - the first-launch "connect your sheet" screen
     [9] SYNC               - sending daily totals to the Google Sheet
    [10] EXPORT             - downloading the yearly sheet as .xlsx / .txt
    [11] CLEAR ALL          - wipe tasks + history
    [12] STARTUP            - wiring buttons and kicking everything off

   RULE TO REMEMBER: only ONE task can run at a time. Starting a task
   automatically pauses whichever task was running before (see startTask).
   ========================================================================== */

(function () {
  "use strict";

  // ==========================================================================
  // [1] SMALL HELPERS
  // ==========================================================================

  const S = window.TTSync;                              // shared code from sync.js
  const $ = (sel) => document.querySelector(sel);       // shortcut: $("#id")
  const pad = (n) => String(n).padStart(2, "0");        // 7 -> "07"
  const fmtHMS = S.fmtHMS;                              // ms -> "01:30:15"

  /** Random unique id for tasks and sessions. */
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  // ==========================================================================
  // [2] STATE + STORAGE
  // ==========================================================================
  // Everything is kept in chrome.storage.local so nothing is lost when the
  // popup closes or Chrome restarts.

  let tasks = [];     // [{ id, name, status, accumulatedMs, segmentStart, sessionStart }]
                      //   status is one of: "idle" | "running" | "paused" | "stopped"
  let sessions = [];  // finished sessions: [{ id, taskName, start, end, durationMs }]
  let config = null;  // Google Sheet connection: { sheetUrl, spreadsheetId, webAppUrl }

  function loadState() {
    return new Promise((resolve) => {
      chrome.storage.local.get(["tasks", "sessions", "config"], (data) => {
        tasks = Array.isArray(data.tasks) ? data.tasks : [];
        sessions = Array.isArray(data.sessions) ? data.sessions : [];
        config = data.config || null;
        resolve();
      });
    });
  }

  const saveTasks = () => chrome.storage.local.set({ tasks });
  const saveSessions = () => chrome.storage.local.set({ sessions });

  /**
   * How much time a task currently shows on its clock.
   * IMPORTANT: this is computed from TIMESTAMPS, not from a ticking counter,
   * so it stays correct even if the popup was closed for hours.
   */
  function elapsedMs(task) {
    let ms = task.accumulatedMs || 0;
    if (task.status === "running" && task.segmentStart) {
      ms += Date.now() - task.segmentStart;
    }
    return ms;
  }

  // ==========================================================================
  // [3] DATE BANNER  (all in ENGLISH letters/digits)
  // ==========================================================================

  const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const MONTH_NAMES = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];

  // Bengali (Bangladesh revised) calendar. Each Bengali month always starts on
  // the same English date, so we just list those start dates:
  //   [English month (1-12), start day, Bengali month name in English letters]
  const BENGALI_MONTHS = [
    [4, 14, "Boishakh"], [5, 15, "Joishtho"], [6, 15, "Asharh"], [7, 16, "Srabon"],
    [8, 16, "Bhadro"], [9, 16, "Ashshin"], [10, 17, "Kartik"], [11, 16, "Ogrohayon"],
    [12, 16, "Poush"], [1, 15, "Magh"], [2, 13, "Falgun"], [3, 15, "Choitro"],
  ];

  /** e.g. new Date(2026,6,3) -> "19 Asharh 1433 BS" */
  function bengaliDate(d) {
    const y = d.getFullYear();
    // Find the most recent Bengali month start on or before today.
    let best = null;
    for (const [gm, gd, name] of BENGALI_MONTHS) {
      for (const start of [new Date(y, gm - 1, gd), new Date(y - 1, gm - 1, gd)]) {
        if (start <= d && (!best || start > best.start)) best = { start, name };
      }
    }
    const dayNum = Math.floor((d - best.start) / 86400000) + 1;
    // Bengali year changes on 14 April (Pohela Boishakh).
    const bnYear = d >= new Date(y, 3, 14) ? y - 593 : y - 594;
    return dayNum + " " + best.name + " " + bnYear + " BS";
  }

  /** Hijri date in English, e.g. "18 Muharram 1448 AH". Works offline. */
  function hijriLocal(d) {
    try {
      return new Intl.DateTimeFormat("en-GB-u-ca-islamic-umalqura", {
        day: "numeric", month: "long", year: "numeric",
      }).format(d);
    } catch (e) {
      return "";
    }
  }

  // When online we double-check the Hijri date with the AlAdhan API
  // (moon-sighting based dates can differ by a day from the calculation).
  let hijriOnlineText = null;
  function refreshHijriOnline() {
    if (!navigator.onLine) return;
    const d = new Date();
    const key = S.dateKey(d);
    chrome.storage.local.get(["hijriCacheEn"], (data) => {
      const cache = data.hijriCacheEn || {};
      if (cache.date === key && cache.text) { hijriOnlineText = cache.text; return; }
      const q = pad(d.getDate()) + "-" + pad(d.getMonth() + 1) + "-" + d.getFullYear();
      fetch("https://api.aladhan.com/v1/gToH/" + q)
        .then((r) => r.json())
        .then((j) => {
          const h = j && j.data && j.data.hijri;
          if (!h) return;
          hijriOnlineText = h.day + " " + h.month.en + " " + h.year + " AH";
          chrome.storage.local.set({ hijriCacheEn: { date: key, text: hijriOnlineText } });
          renderClock();
        })
        .catch(() => { /* offline or API down — the Intl fallback stays */ });
    });
  }

  /** Redraws the banner. Runs once per second. */
  function renderClock() {
    const now = new Date();
    $("#enDate").textContent =
      DAY_NAMES[now.getDay()] + ", " + MONTH_NAMES[now.getMonth()] + " " +
      now.getDate() + ", " + now.getFullYear() + " — " + S.fmtTime12(now.getTime(), true);
    $("#bnDate").textContent = bengaliDate(now);
    $("#hijriDate").textContent = hijriOnlineText || hijriLocal(now);
  }

  // ==========================================================================
  // [4] TIMER ACTIONS
  // ==========================================================================

  function addTask(name) {
    const trimmed = (name || "").trim();
    if (!trimmed) return;
    tasks.push({
      id: uid(),
      name: trimmed,
      status: "idle",
      accumulatedMs: 0,     // time collected in finished "segments"
      segmentStart: null,   // when the current running segment began
      sessionStart: null,   // when this whole session began (for the history log)
      recurring: false,     // recurring tasks survive the day change (reset, not deleted)
    });
    saveTasks();
    render();
  }

  const findTask = (id) => tasks.find((t) => t.id === id);

  /** Freeze a running task's clock (used by pause and by the one-at-a-time rule). */
  function freeze(task) {
    task.accumulatedMs = elapsedMs(task);
    task.segmentStart = null;
    task.status = "paused";
  }

  function startTask(id) {
    const t = findTask(id);
    if (!t || t.status === "running") return;

    // >>> ONE TASK AT A TIME <<<
    // Starting this task automatically pauses any other running task, so your
    // study time is never counted twice.
    tasks.forEach((other) => {
      if (other.id !== id && other.status === "running") freeze(other);
    });

    // A fresh session begins from idle/stopped; resuming keeps collected time.
    if (t.status === "idle" || t.status === "stopped") {
      t.accumulatedMs = 0;
      t.sessionStart = Date.now();
    }
    t.segmentStart = Date.now();
    t.status = "running";
    saveTasks();
    render();
  }

  function pauseTask(id) {
    const t = findTask(id);
    if (!t || t.status !== "running") return;
    freeze(t);
    saveTasks();
    render();
  }

  /** Stop = finish the session permanently and write it into the history log. */
  function stopTask(id) {
    const t = findTask(id);
    if (!t || (t.status !== "running" && t.status !== "paused")) return;

    const finalMs = elapsedMs(t);
    const end = Date.now();
    const start = t.sessionStart || end - finalMs;

    // 1) Save to local session history.
    sessions.unshift({ id: uid(), taskName: t.name, start, end, durationMs: finalMs });

    // 2) Mark the task card as stopped.
    t.accumulatedMs = finalMs;
    t.segmentStart = null;
    t.status = "stopped";
    saveTasks();
    saveSessions();

    // 3) Add the duration to TODAY's study total (this is what syncs to the sheet).
    const dk = S.dateKey(start);
    chrome.storage.local.get(["dailyTotals"], (data) => {
      const totals = data.dailyTotals || {};
      const cur = totals[dk] || { ms: 0, last: 0 };
      totals[dk] = { ms: cur.ms + finalMs, last: end };
      chrome.storage.local.set({ dailyTotals: totals }, updateSyncStatus);
    });

    render();
    showToast("Session saved");
  }

  function deleteTask(id) {
    const t = findTask(id);
    if (!t) return;
    // Count any time still on this task's clock (running OR paused, and whether
    // or not it is recurring) toward its day's total before it disappears.
    bankActiveTime([t], () => {
      tasks = tasks.filter((x) => x.id !== id);
      saveTasks();
      render();
      updateSyncStatus();
    });
  }

  /**
   * Turn "recurring" on/off for a task.
   * Recurring tasks are carried over to the next day (their clock is reset to
   * 00:00:00) instead of being deleted when the date changes. See the day
   * rollover logic below.
   */
  function toggleRecurring(id) {
    const t = findTask(id);
    if (!t) return;
    t.recurring = !t.recurring;
    saveTasks();
    render();
    showToast(t.recurring ? "Recurring on — carries to next day" : "Recurring off — will clear at day end");
  }

  /** Runs when any button on a task card is clicked. */
  function onTaskAction(id, act, name) {
    if (act === "start") startTask(id);
    else if (act === "pause") pauseTask(id);
    else if (act === "recur") toggleRecurring(id);
    else if (act === "stop") {
      confirmModal(
        "Are you sure you want to stop this timer?\n\nStopping ends the session permanently. Use Pause if you want to resume later.",
        () => stopTask(id)
      );
    } else if (act === "delete") {
      const t = findTask(id);
      const hasTime = t && (t.status === "running" || t.status === "paused") && elapsedMs(t) > 0;
      confirmModal(
        'Delete task "' + name + '"? ' +
          (hasTime ? "Its time is counted toward today first. " : "") +
          "Saved history stays in the log.",
        () => deleteTask(id)
      );
    } else if (act === "up") moveTask(id, -1);
    else if (act === "down") moveTask(id, 1);
  }

  // ==========================================================================
  // [4b] DAY ROLLOVER  (recurring tasks survive midnight; the rest are cleared)
  // ==========================================================================
  // When the calendar day changes we tidy the task list:
  //   • recurring tasks stay, but their clock is reset to 00:00:00 for the new day
  //   • every other task is removed (it only lived for that one day)
  // Any time still on a running/paused clock is first banked into that day's
  // total so it is never lost from your Google Sheet.

  let lastKnownDay = null;   // the day key ("YYYY-MM-DD") we last tidied for
  let rolloverBusy = false;  // guards against the 1-second clock re-triggering it

  function bankActiveTime(list, done) {
    const additions = {}; // dateKey -> ms to add
    list.forEach((t) => {
      if (t.status === "running" || t.status === "paused") {
        const ms = elapsedMs(t);
        if (ms > 0) {
          const dk = S.dateKey(t.sessionStart || Date.now());
          additions[dk] = (additions[dk] || 0) + ms;
        }
      }
    });
    const keys = Object.keys(additions);
    if (!keys.length) { done(); return; }
    chrome.storage.local.get(["dailyTotals"], (data) => {
      const totals = data.dailyTotals || {};
      const now = Date.now();
      keys.forEach((dk) => {
        const cur = totals[dk] || { ms: 0, last: 0 };
        totals[dk] = { ms: cur.ms + additions[dk], last: now };
      });
      chrome.storage.local.set({ dailyTotals: totals }, done);
    });
  }

  /** Resolves to true when a rollover actually happened (tasks changed). */
  function applyDayRollover() {
    return new Promise((resolve) => {
      const today = S.dateKey(new Date());
      lastKnownDay = today;
      chrome.storage.local.get(["lastActiveDay"], (data) => {
        const last = data.lastActiveDay || null;
        // First run, or same day → nothing to roll over, just remember today.
        if (!last || last === today) {
          chrome.storage.local.set({ lastActiveDay: today }, () => resolve(false));
          return;
        }
        // The day changed since the app was last used: bank active time, then
        // keep recurring tasks (reset) and drop everything else.
        bankActiveTime(tasks, () => {
          tasks = tasks.filter((t) => t.recurring);
          tasks.forEach((t) => {
            t.accumulatedMs = 0;
            t.segmentStart = null;
            t.sessionStart = null;
            t.status = "idle";
          });
          saveTasks();
          chrome.storage.local.set({ lastActiveDay: today }, () => resolve(true));
        });
      });
    });
  }

  /** Called every second from the clock: catches midnight while the app is open. */
  function watchForDayChange() {
    if (rolloverBusy || !lastKnownDay) return;
    if (S.dateKey(new Date()) === lastKnownDay) return;
    rolloverBusy = true;
    applyDayRollover().then((changed) => {
      rolloverBusy = false;
      if (changed) {
        render();
        showToast("New day — recurring tasks reset, others cleared");
      }
    });
  }

  /** Moves a task one place up (dir=-1) or down (dir=+1) in the list. */
  function moveTask(id, dir) {
    const i = tasks.findIndex((t) => t.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= tasks.length) return; // already at the edge
    [tasks[i], tasks[j]] = [tasks[j], tasks[i]];
    saveTasks();
    render();
  }

  // ==========================================================================
  // [5] DRAWING THE SCREEN
  // ==========================================================================

  let tickHandle = null; // interval that updates running clocks twice a second

  function statusLabel(status) {
    return { idle: "Idle", running: "Running", paused: "Paused", stopped: "Stopped" }[status] || status;
  }

  /** Rebuilds the whole task list. Called after every change. */
  function render() {
    const list = $("#taskList");
    list.innerHTML = "";
    $("#emptyState").classList.toggle("hidden", tasks.length > 0);

    tasks.forEach((t) => {
      const card = document.createElement("div");
      card.className = "task-card " + t.status;   // CSS colors the left edge by status
      card.draggable = true;
      card.dataset.id = t.id;

      const canStart = t.status !== "running";
      const canPause = t.status === "running";
      const canStop = t.status === "running" || t.status === "paused";

      card.innerHTML =
        '<div class="task-top">' +
          '<span class="task-name"></span>' +
          '<button class="recur-btn' + (t.recurring ? " on" : "") + '" data-act="recur" title="' +
            (t.recurring ? "Recurring: carries to the next day. Click to turn off." :
                           "Make recurring: carry this task to the next day.") + '">&#8635;</button>' +
          '<span class="status-pill ' + t.status + '">' + statusLabel(t.status) + "</span>" +
          // ▲▼ reorder buttons — drag & drop does not work on touchscreens,
          // so phones use these instead.
          '<span class="move-btns">' +
            '<button class="move-btn" data-act="up" title="Move up">&#9650;</button>' +
            '<button class="move-btn" data-act="down" title="Move down">&#9660;</button>' +
          "</span>" +
        "</div>" +
        '<div class="task-time" data-time="' + t.id + '">' + fmtHMS(elapsedMs(t)) + "</div>" +
        '<div class="task-controls">' +
          '<button class="ctrl ctrl-start" data-act="start" ' + (canStart ? "" : "disabled") + ">" +
            (t.status === "paused" ? "Resume" : "Start") + "</button>" +
          '<button class="ctrl ctrl-pause" data-act="pause" ' + (canPause ? "" : "disabled") + ">Pause</button>" +
          '<button class="ctrl ctrl-stop" data-act="stop" ' + (canStop ? "" : "disabled") + ">Stop</button>" +
          '<button class="ctrl-delete" data-act="delete" title="Delete task">&times;</button>' +
        "</div>";

      // The task name is inserted as TEXT (not HTML) so special characters are safe.
      card.querySelector(".task-name").textContent = t.name;

      card.querySelectorAll("[data-act]").forEach((btn) => {
        btn.addEventListener("click", () => onTaskAction(t.id, btn.getAttribute("data-act"), t.name));
      });

      wireDrag(card);
      list.appendChild(card);
    });

    updateFooter();
    ensureTicking();
  }

  /** Updates only the digits of running clocks (cheap, runs every 500 ms). */
  function tick() {
    tasks.forEach((t) => {
      if (t.status !== "running") return;
      const el = document.querySelector('[data-time="' + t.id + '"]');
      if (el) el.textContent = fmtHMS(elapsedMs(t));
    });
    updateFooter();
  }

  /** Starts/stops the tick interval depending on whether anything is running. */
  function ensureTicking() {
    const anyRunning = tasks.some((t) => t.status === "running");
    if (anyRunning && !tickHandle) tickHandle = setInterval(tick, 500);
    else if (!anyRunning && tickHandle) { clearInterval(tickHandle); tickHandle = null; }
  }

  function updateFooter() {
    let total = 0;
    tasks.forEach((t) => { total += elapsedMs(t); });
    $("#totalTracked").textContent = "Total: " + fmtHMS(total);
  }

  // ==========================================================================
  // [6] DRAG & DROP  (move task cards up/down)
  // ==========================================================================

  let dragId = null; // id of the card currently being dragged

  function wireDrag(card) {
    card.addEventListener("dragstart", (e) => {
      dragId = card.dataset.id;
      card.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
    });
    card.addEventListener("dragend", () => {
      card.classList.remove("dragging");
      dragId = null;
      document.querySelectorAll(".drag-over").forEach((el) => el.classList.remove("drag-over"));
    });
    card.addEventListener("dragover", (e) => {
      e.preventDefault(); // required, otherwise "drop" never fires
      if (card.dataset.id !== dragId) card.classList.add("drag-over");
    });
    card.addEventListener("dragleave", () => card.classList.remove("drag-over"));
    card.addEventListener("drop", (e) => {
      e.preventDefault();
      card.classList.remove("drag-over");
      const targetId = card.dataset.id;
      if (!dragId || dragId === targetId) return;
      // Move the dragged task to the position of the card it was dropped on.
      const from = tasks.findIndex((t) => t.id === dragId);
      const to = tasks.findIndex((t) => t.id === targetId);
      if (from < 0 || to < 0) return;
      tasks.splice(to, 0, tasks.splice(from, 1)[0]);
      saveTasks();
      render();
    });
  }

  // ==========================================================================
  // [7] POPUP DIALOGS  (confirm box, choice box, toast)
  // ==========================================================================

  /** Shows "message" with Cancel / Confirm buttons. Runs onConfirm if confirmed. */
  function confirmModal(message, onConfirm, confirmLabel) {
    $("#modalMessage").textContent = message;
    const actions = $("#modalActions");
    actions.innerHTML = "";

    const cancel = document.createElement("button");
    cancel.className = "btn btn-ghost";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", closeModal);

    const ok = document.createElement("button");
    ok.className = "btn btn-primary";
    ok.textContent = confirmLabel || "Confirm";
    ok.addEventListener("click", () => { closeModal(); onConfirm(); });

    actions.append(cancel, ok);
    $("#modalOverlay").classList.remove("hidden");
  }

  /** Shows "message" with one button per choice (used for the export format). */
  function choiceModal(message, choices) {
    $("#modalMessage").textContent = message;
    const actions = $("#modalActions");
    actions.innerHTML = "";

    choices.forEach((c) => {
      const b = document.createElement("button");
      b.className = "btn " + (c.primary ? "btn-primary" : "btn-ghost");
      b.textContent = c.label;
      b.addEventListener("click", () => { closeModal(); c.onPick(); });
      actions.appendChild(b);
    });

    const cancel = document.createElement("button");
    cancel.className = "btn btn-ghost";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", closeModal);
    actions.appendChild(cancel);

    $("#modalOverlay").classList.remove("hidden");
  }

  const closeModal = () => $("#modalOverlay").classList.add("hidden");

  /** Small black bubble at the bottom that disappears by itself. */
  let toastTimer = null;
  function showToast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.remove("hidden");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add("hidden"), 2200);
  }

  // ==========================================================================
  // [8] GOOGLE SHEET SETUP  (first-launch screen, reopened with the gear button)
  // ==========================================================================

  /** Pulls the long id out of a Google Sheet link. */
  function parseSpreadsheetId(url) {
    const m = String(url || "").match(/\/d\/([a-zA-Z0-9_-]+)/);
    return m ? m[1] : "";
  }

  function showSetup(allowCancel) {
    $("#setupPanel").classList.remove("hidden");
    $("#cancelConfig").classList.toggle("hidden", !allowCancel);
    if (config) {
      $("#sheetUrl").value = config.sheetUrl || "";
      $("#webAppUrl").value = config.webAppUrl || "";
    }
    $("#sheetUrl").focus();
  }
  const hideSetup = () => $("#setupPanel").classList.add("hidden");

  function setSetupStatus(msg, cls) {
    const el = $("#setupStatus");
    el.textContent = msg;
    el.className = "setup-status" + (cls ? " " + cls : "");
  }

  /** Validates the two inputs, saves them, then pings the Apps Script. */
  function saveConfig() {
    const sheetUrl = $("#sheetUrl").value.trim();
    const webAppUrl = $("#webAppUrl").value.trim();
    const id = parseSpreadsheetId(sheetUrl);

    if (!id) { setSetupStatus("That doesn't look like a Google Sheet link.", "err"); return; }
    if (!/^https:\/\/script\.google\.com\/.+\/exec/.test(webAppUrl)) {
      setSetupStatus("The Web App URL should be a script.google.com link ending in /exec.", "err");
      return;
    }

    config = { sheetUrl, spreadsheetId: id, webAppUrl };
    chrome.storage.local.set({ config }, () => {
      updateSyncStatus();
      if (!navigator.onLine) {
        setSetupStatus("Saved. You're offline — will verify on first sync.", "ok");
        setTimeout(hideSetup, 1200);
        return;
      }
      setSetupStatus("Checking connection…");
      fetch(webAppUrl + "?action=ping")
        .then((r) => r.json())
        .then((j) => {
          if (j && j.ok) {
            setSetupStatus("Connected!", "ok");
            showToast("Google Sheet connected");
            setTimeout(hideSetup, 900);
            syncNow(true);
          } else {
            setSetupStatus("The script answered but not as expected — re-check the deployment.", "err");
          }
        })
        .catch(() => {
          setSetupStatus("Couldn't reach the script. Check the URL and that access is 'Anyone with the link'.", "err");
        });
    });
  }

  // ==========================================================================
  // [9] SYNC  (the heavy lifting lives in sync.js — this is just the UI part)
  // ==========================================================================

  /** silent=true means: no toasts (used for automatic syncs). */
  function syncNow(silent) {
    if (!config || !config.webAppUrl) {
      if (!silent) showSetup(false);
      return;
    }
    const btn = $("#syncBtn");
    btn.disabled = true;
    S.doSync().then((res) => {
      btn.disabled = false;
      updateSyncStatus();
      if (silent) return;
      if (res.ok) {
        showToast(res.synced === 0 ? "Already up to date" : "Synced " + res.synced + " day(s) to Google Sheet");
      } else if (res.reason === "offline") {
        showToast("Offline — data saved locally, will sync later");
      } else if (res.reason === "busy") {
        showToast("Sync already in progress");
      } else {
        showToast("Sync failed: " + res.reason);
      }
    });
  }

  /** Auto-sync on popup open if the last sync was more than 1 hour ago.
      (background.js also syncs hourly even when the popup is closed.) */
  function maybeAutoSync() {
    if (!config || !config.webAppUrl || !navigator.onLine) return;
    chrome.storage.local.get(["lastSyncAt"], (d) => {
      if (!d.lastSyncAt || Date.now() - d.lastSyncAt > 3600 * 1000) syncNow(true);
    });
  }

  /** Footer text: "3 days pending" / "Synced 09:45 PM" / "Not connected". */
  function updateSyncStatus() {
    const el = $("#syncStatus");
    if (!config || !config.webAppUrl) {
      el.textContent = "Not connected";
      el.className = "muted";
      return;
    }
    S.pendingCount().then((n) => {
      chrome.storage.local.get(["lastSyncAt"], (d) => {
        if (n > 0) {
          el.textContent = n + " day" + (n === 1 ? "" : "s") + " pending";
          el.className = "muted pending";
        } else if (d.lastSyncAt) {
          el.textContent = "Synced " + S.fmtTime12(d.lastSyncAt);
          el.className = "muted ok";
        } else {
          el.textContent = "Connected";
          el.className = "muted";
        }
      });
    });
  }

  // ==========================================================================
  // [10] EXPORT  (downloads THIS YEAR's Google Sheet data, not raw local data)
  // ==========================================================================

  const HEADERS_FALLBACK = ["Date", "Day", "Today (HH:MM:SS)", "Net Total (cumulative)", "Comment"];

  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    chrome.downloads.download({ url, filename, saveAs: true }, () => {
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    });
  }

  /** Timestamp for file names, e.g. "20260703-2145". */
  function stamp() {
    const d = new Date();
    return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + "-" + pad(d.getHours()) + pad(d.getMinutes());
  }

  /** Asks the Apps Script for every row of this year's sheet. */
  function fetchYearRows() {
    const year = String(new Date().getFullYear());
    const url = config.webAppUrl + "?action=export&year=" + year +
      "&spreadsheetId=" + encodeURIComponent(config.spreadsheetId || "");
    return fetch(url).then((r) => r.json()).then((j) => {
      if (!j || !j.ok) throw new Error((j && j.error) || "server error");
      return { year, rows: j.rows || [] };
    });
  }

  function exportRowsTxt(year, rows) {
    const all = rows.length ? rows : [HEADERS_FALLBACK];
    // Work out how wide each column needs to be, then pad every cell.
    const colCount = Math.max(...all.map((r) => r.length));
    const widths = [];
    for (let c = 0; c < colCount; c++) {
      widths[c] = Math.max(...all.map((r) => String(r[c] == null ? "" : r[c]).length));
    }
    const line = (r) => {
      const cells = [];
      for (let c = 0; c < colCount; c++) cells.push(String(r[c] == null ? "" : r[c]).padEnd(widths[c]));
      return cells.join("  |  ");
    };
    const text =
      "TASK TIME TRACKER — YEAR " + year + " (from Google Sheet)\n" +
      "Exported: " + new Date().toLocaleDateString() + " " + S.fmtTime12(Date.now(), true) + "\n\n" +
      all.map(line).join("\n") + "\n";
    download(new Blob([text], { type: "text/plain" }), "study-log-" + year + "-" + stamp() + ".txt");
    showToast("Exported .txt");
  }

  function exportRowsXlsx(year, rows) {
    const all = rows.length ? rows : [HEADERS_FALLBACK];
    const bytes = window.TTExport.xlsxBytes(all[0], all.slice(1)); // from zip.js
    const blob = new Blob([bytes], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    download(blob, "study-log-" + year + "-" + stamp() + ".xlsx");
    showToast("Exported .xlsx");
  }

  function onExport() {
    if (!config || !config.webAppUrl) { showSetup(false); return; }
    if (!navigator.onLine) { showToast("Export needs internet — it downloads the yearly sheet data"); return; }

    const run = (fn) => () => {
      showToast("Fetching sheet…");
      fetchYearRows()
        .then((r) => fn(r.year, r.rows))
        .catch((e) => showToast("Export failed: " + e.message));
    };
    choiceModal("Export this year's Google Sheet data. Choose a format:", [
      { label: "Excel (.xlsx)", primary: true, onPick: run(exportRowsXlsx) },
      { label: "Text (.txt)", primary: false, onPick: run(exportRowsTxt) },
    ]);
  }

  // ==========================================================================
  // [11] CLEAR ALL
  // ==========================================================================

  function onClearAll() {
    if (!tasks.length && !sessions.length) { showToast("Nothing to clear"); return; }
    confirmModal(
      "Clear ALL tasks and session history? This cannot be undone.\n\nDaily totals not yet synced to your Google Sheet are kept and will still sync.",
      () => {
        tasks = [];
        sessions = [];
        saveTasks();
        saveSessions();
        render(); // tasks disappear from the screen immediately
        showToast("All tasks and history cleared");
      },
      "Clear all"
    );
  }

  // ==========================================================================
  // [12] STARTUP  (connect every button to its function, then draw the screen)
  // ==========================================================================

  function wireEvents() {
    const addRow = $("#addRow");
    const nameInput = $("#taskName");

    // "+" button shows/hides the new-task input.
    $("#addToggle").addEventListener("click", () => {
      addRow.classList.toggle("hidden");
      if (!addRow.classList.contains("hidden")) nameInput.focus();
    });

    const submitAdd = () => {
      addTask(nameInput.value);
      nameInput.value = "";
      nameInput.focus();
    };
    $("#addBtn").addEventListener("click", submitAdd);
    nameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submitAdd();
      if (e.key === "Escape") addRow.classList.add("hidden");
    });

    // Footer buttons.
    $("#syncBtn").addEventListener("click", () => syncNow(false));
    $("#exportBtn").addEventListener("click", onExport);
    $("#clearBtn").addEventListener("click", onClearAll);

    // Gear button toggles the Google Sheet settings.
    $("#settingsToggle").addEventListener("click", () => {
      const panel = $("#setupPanel");
      if (panel.classList.contains("hidden")) showSetup(!!config);
      else hideSetup();
    });
    $("#saveConfig").addEventListener("click", saveConfig);
    $("#cancelConfig").addEventListener("click", hideSetup);

    // Clicking the dark area around a dialog closes it.
    $("#modalOverlay").addEventListener("click", (e) => {
      if (e.target === $("#modalOverlay")) closeModal();
    });

    // The moment internet comes back, try to sync.
    window.addEventListener("online", () => syncNow(true));
  }

  document.addEventListener("DOMContentLoaded", () => {
    wireEvents();
    loadState().then(applyDayRollover).then(() => {
      render();
      renderClock();
      setInterval(() => { renderClock(); watchForDayChange(); }, 1000);  // banner clock + midnight check
      refreshHijriOnline();
      updateSyncStatus();
      if (!config || !config.webAppUrl) {
        showSetup(false);              // first launch: ask for the Google Sheet link
      } else {
        maybeAutoSync();
      }
    });
  });
})();
