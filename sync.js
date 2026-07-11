/*
 * sync.js — Google Sheets sync engine, shared by popup.js and background.js.
 *
 * Data model in chrome.storage.local:
 *   config      : { sheetUrl, spreadsheetId, webAppUrl }
 *   dailyTotals : { "2026-07-03": { ms: 5415000, last: 1751500000000 }, ... }
 *                 (accumulated stopped-session time per local calendar day)
 *   syncedMeta  : { "2026-07-03": 5415000, ... }  ms value last accepted by
 *                 the sheet — a day is "pending" while its ms differs.
 *   lastSyncAt  : timestamp of last successful sync attempt
 *
 * Dedupe strategy (requirement 7):
 *   - client side: a day is only sent when its total changed since the last
 *     accepted sync, so unchanged days are never re-sent;
 *   - server side: Apps Script upserts by date, so re-sends update the row
 *     in place rather than adding a duplicate.
 *
 * Offline handling (requirement 2):
 *   - totals just accumulate in dailyTotals while offline (any number of days);
 *   - on a successful sync, fully-synced PAST days are deleted locally so each
 *     new day starts fresh; today's entry stays (it may still grow).
 */
(function (root) {
  "use strict";

  function storageGet(keys) {
    return new Promise(function (res) { chrome.storage.local.get(keys, res); });
  }
  function storageSet(obj) {
    return new Promise(function (res) { chrome.storage.local.set(obj, res); });
  }

  var pad = function (n) { return String(n).padStart(2, "0"); };

  function fmtHMS(ms) {
    var t = Math.max(0, Math.floor(ms / 1000));
    return pad(Math.floor(t / 3600)) + ":" + pad(Math.floor((t % 3600) / 60)) + ":" + pad(t % 60);
  }

  /** Local calendar-day key: "2026-07-03". */
  function dateKey(d) {
    d = d instanceof Date ? d : new Date(d);
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  var DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  function keyToDate(key) {
    var p = key.split("-");
    return new Date(+p[0], +p[1] - 1, +p[2]);
  }

  function dayName(key) { return DAYS[keyToDate(key).getDay()]; }

  /** "03-Jul-2026" — deterministic, used by the server to find a day's row. */
  function dateText(key) {
    var d = keyToDate(key);
    return pad(d.getDate()) + "-" + MONTHS_SHORT[d.getMonth()] + "-" + d.getFullYear();
  }

  /** 12-hour "09:45 PM". */
  function fmtTime12(ts, withSeconds) {
    var d = new Date(ts);
    var h = d.getHours();
    var ap = h >= 12 ? "PM" : "AM";
    h = h % 12; if (h === 0) h = 12;
    var s = pad(h) + ":" + pad(d.getMinutes());
    if (withSeconds) s += ":" + pad(d.getSeconds());
    return s + " " + ap;
  }

  function getConfig() {
    return storageGet(["config"]).then(function (d) {
      var c = d.config;
      return c && c.webAppUrl ? c : null;
    });
  }

  /** List of days whose totals the sheet hasn't accepted yet. */
  function pendingEntries(totals, synced) {
    return Object.keys(totals).sort().filter(function (k) {
      var ms = totals[k] && totals[k].ms || 0;
      return ms > 0 && ms !== synced[k];
    }).map(function (k) {
      return {
        date: k,
        day: dayName(k),
        dateText: dateText(k),
        timeText: fmtTime12(totals[k].last || Date.now()),
        totalMs: totals[k].ms,
        hms: fmtHMS(totals[k].ms),
      };
    });
  }

  var inFlight = false;

  /**
   * Sync all pending days to the Google Sheet.
   * Resolves { ok, synced?, reason? } — never rejects.
   */
  function doSync() {
    if (inFlight) return Promise.resolve({ ok: false, reason: "busy" });
    inFlight = true;

    return storageGet(["config", "dailyTotals", "syncedMeta"]).then(function (data) {
      var cfg = data.config;
      if (!cfg || !cfg.webAppUrl) return { ok: false, reason: "not-configured" };

      var totals = data.dailyTotals || {};
      var synced = data.syncedMeta || {};
      var entries = pendingEntries(totals, synced);

      if (!entries.length) {
        return storageSet({ lastSyncAt: Date.now() }).then(function () {
          return { ok: true, synced: 0 };
        });
      }

      return fetch(cfg.webAppUrl, {
        method: "POST",
        // text/plain avoids a CORS preflight, which Apps Script can't answer.
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ spreadsheetId: cfg.spreadsheetId || "", entries: entries }),
      }).then(function (res) {
        return res.json();
      }).then(function (json) {
        if (!json || !json.ok) {
          return { ok: false, reason: (json && json.error) || "server-error" };
        }
        // Mark accepted; clear fully-synced PAST days so they start fresh.
        var today = dateKey(new Date());
        entries.forEach(function (e) { synced[e.date] = e.totalMs; });
        var newTotals = {}, newSynced = {};
        Object.keys(totals).forEach(function (k) {
          if (k >= today) {
            newTotals[k] = totals[k];
            if (synced[k] != null) newSynced[k] = synced[k];
          }
        });
        return storageSet({
          dailyTotals: newTotals,
          syncedMeta: newSynced,
          lastSyncAt: Date.now(),
        }).then(function () {
          return { ok: true, synced: entries.length };
        });
      }).catch(function () {
        return { ok: false, reason: "offline" };
      });
    }).finally(function () {
      inFlight = false;
    });
  }

  /** Count of days waiting to reach the sheet. */
  function pendingCount() {
    return storageGet(["dailyTotals", "syncedMeta"]).then(function (d) {
      return pendingEntries(d.dailyTotals || {}, d.syncedMeta || {}).length;
    });
  }

  root.TTSync = {
    doSync: doSync,
    getConfig: getConfig,
    pendingCount: pendingCount,
    fmtHMS: fmtHMS,
    fmtTime12: fmtTime12,
    dateKey: dateKey,
    dateText: dateText,
    dayName: dayName,
  };
})(typeof self !== "undefined" ? self : this);
