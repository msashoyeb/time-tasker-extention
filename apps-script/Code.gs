/**
 * Task Time Tracker — Google Sheets bridge (Apps Script Web App).
 *
 * SETUP (one time, ~3 minutes):
 *   1. Open your Google Sheet.
 *   2. Extensions → Apps Script. Delete any code there and paste this file.
 *   3. Click Deploy → New deployment → type: Web app.
 *        - Description : Task Timer bridge
 *        - Execute as  : Me
 *        - Who has access: Anyone with the link
 *   4. Click Deploy, authorize when asked, and COPY the Web app URL
 *      (ends in /exec).
 *   5. Paste that URL (plus your sheet link) into the extension's setup screen.
 *
 * Behavior implemented here:
 *   - Rows go to a sheet named after the entry's year ("2026", "2027", …);
 *     the sheet is created with a header row in A1 if it doesn't exist.
 *   - Columns: Date | Day | Today (HH:MM:SS) | Net Total (cumulative) | Comment
 *   - Net Total = previous day's net + today, reset fresh at each new month.
 *   - When a month ends: one blank row, then the month name, then new rows.
 *   - A synced day is remembered (Script Properties). If you delete its row
 *     in the sheet it is NOT recreated; new days keep appending normally.
 *   - Re-syncing the same day UPDATES its existing row (never a duplicate).
 *   - Column E (Comment) is never written, so your manual comments survive.
 */

var HEADERS = ["Date", "Day", "Today (HH:MM:SS)", "Net Total (cumulative)", "Comment"];

var MONTH_NAMES = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

// ---------------------------------------------------------------------------

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var payload = JSON.parse(e.postData.contents);
    var ss = openSpreadsheet_(payload.spreadsheetId);
    var props = PropertiesService.getScriptProperties();
    var entries = (payload.entries || []).slice().sort(function (a, b) {
      return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
    });
    var results = [];
    entries.forEach(function (entry) {
      results.push(upsertEntry_(ss, props, entry));
    });
    return json_({ ok: true, results: results });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

function doGet(e) {
  try {
    var action = (e.parameter.action || "ping");
    if (action === "ping") return json_({ ok: true, pong: true });

    if (action === "export") {
      var ss = openSpreadsheet_(e.parameter.spreadsheetId);
      var year = e.parameter.year || String(new Date().getFullYear());
      var sh = ss.getSheetByName(year);
      if (!sh) return json_({ ok: true, year: year, rows: [] });
      return json_({ ok: true, year: year, rows: sh.getDataRange().getDisplayValues() });
    }
    return json_({ ok: false, error: "unknown action" });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

// --- Core ------------------------------------------------------------------

/**
 * entry: { date: "2026-07-03", day: "Friday", dateText: "03-Jul-2026",
 *          timeText: "09:45 PM", totalMs: 5415000 }
 */
function upsertEntry_(ss, props, entry) {
  var year = entry.date.slice(0, 4);
  var monthKey = entry.date.slice(0, 7); // "2026-07"
  var sh = ensureYearSheet_(ss, year);

  var dayKey = "d_" + entry.date;
  var monthPropKey = "m_" + monthKey;
  var dayMarker = props.getProperty(dayKey);
  var rowIdx = findRowByDateText_(sh, entry.dateText);

  var dateCell = entry.dateText + " " + (entry.timeText || "");

  if (rowIdx > 0) {
    // Same day synced again — update in place, never duplicate.
    var m = dayMarker ? JSON.parse(dayMarker) : { netBase: 0 };
    var net = (m.netBase || 0) + entry.totalMs;
    sh.getRange(rowIdx, 1, 1, 4).setValues([[
      dateCell, entry.day, msToHMS_(entry.totalMs), msToHMS_(net)
    ]]);
    props.setProperty(dayKey, JSON.stringify({ netBase: m.netBase || 0, total: entry.totalMs }));
    props.setProperty(monthPropKey, JSON.stringify({ net: net, lastDate: entry.date }));
    return { date: entry.date, action: "updated" };
  }

  if (dayMarker) {
    // Was synced before but the row is gone — the user deleted it.
    // Respect that: do not recreate. (Requirement 3.)
    return { date: entry.date, action: "skipped-deleted" };
  }

  // New day.
  var netBase = 0;
  var monthProp = props.getProperty(monthPropKey);
  if (monthProp) {
    netBase = JSON.parse(monthProp).net || 0; // continue this month's running net
  } else {
    // First entry of a new month: blank row + month title (skip if the sheet
    // has no data rows yet — the header is enough at the very top).
    if (sh.getLastRow() >= 2) sh.appendRow([""]);
    var mn = MONTH_NAMES[parseInt(entry.date.slice(5, 7), 10) - 1] + " " + year;
    sh.appendRow([mn]);
    sh.getRange(sh.getLastRow(), 1, 1, 5).setFontWeight("bold");
  }

  var netNew = netBase + entry.totalMs;
  sh.appendRow([dateCell, entry.day, msToHMS_(entry.totalMs), msToHMS_(netNew), ""]);
  props.setProperty(dayKey, JSON.stringify({ netBase: netBase, total: entry.totalMs }));
  props.setProperty(monthPropKey, JSON.stringify({ net: netNew, lastDate: entry.date }));
  return { date: entry.date, action: "appended" };
}

// --- Helpers -----------------------------------------------------------------

function openSpreadsheet_(spreadsheetId) {
  if (spreadsheetId) return SpreadsheetApp.openById(spreadsheetId);
  var active = SpreadsheetApp.getActive();
  if (!active) throw new Error("No spreadsheetId given and script is not bound to a sheet.");
  return active;
}

function ensureYearSheet_(ss, year) {
  var sh = ss.getSheetByName(year);
  if (!sh) sh = ss.insertSheet(year);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight("bold");
    sh.setFrozenRows(1);
  }
  return sh;
}

/** Find a data row whose Date cell starts with dateText (e.g. "03-Jul-2026"). */
function findRowByDateText_(sh, dateText) {
  var last = sh.getLastRow();
  if (last < 2) return -1;
  var values = sh.getRange(2, 1, last - 1, 1).getDisplayValues();
  for (var i = 0; i < values.length; i++) {
    var v = String(values[i][0]);
    if (v.indexOf(dateText) === 0) return i + 2;
  }
  return -1;
}

function msToHMS_(ms) {
  var t = Math.max(0, Math.floor(ms / 1000));
  var h = Math.floor(t / 3600);
  var m = Math.floor((t % 3600) / 60);
  var s = t % 60;
  function p(n) { return (n < 10 ? "0" : "") + n; }
  return p(h) + ":" + p(m) + ":" + p(s);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
