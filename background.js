/*
 * background.js — Manifest V3 service worker.
 *
 * - Initializes storage on install.
 * - Runs the hourly auto-sync via chrome.alarms (requirement 7), so pending
 *   days reach the Google Sheet even if the popup is never opened.
 *
 * Timing itself is timestamp-based in chrome.storage.local, so the worker
 * being suspended never affects accuracy.
 */
importScripts("sync.js");

var AUTO_SYNC_ALARM = "tt-auto-sync";

function ensureAlarm() {
  chrome.alarms.get(AUTO_SYNC_ALARM, function (a) {
    if (!a) chrome.alarms.create(AUTO_SYNC_ALARM, { periodInMinutes: 60, delayInMinutes: 5 });
  });
}

chrome.runtime.onInstalled.addListener(function () {
  chrome.storage.local.get(["tasks", "sessions", "dailyTotals", "syncedMeta"], function (data) {
    var patch = {};
    if (!Array.isArray(data.tasks)) patch.tasks = [];
    if (!Array.isArray(data.sessions)) patch.sessions = [];
    if (!data.dailyTotals) patch.dailyTotals = {};
    if (!data.syncedMeta) patch.syncedMeta = {};
    if (Object.keys(patch).length) chrome.storage.local.set(patch);
  });
  ensureAlarm();
});

chrome.runtime.onStartup.addListener(ensureAlarm);

chrome.alarms.onAlarm.addListener(function (alarm) {
  if (alarm.name !== AUTO_SYNC_ALARM) return;
  self.TTSync.doSync(); // no-op when offline / nothing pending / unconfigured
});
