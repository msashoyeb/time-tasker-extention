/* ============================================================================
   chrome-shim.js  —  makes the extension code run in a normal mobile browser.

   The timer/sync/export logic (app.js, sync.js) was written for a Chrome
   extension, so it calls a few `chrome.*` APIs. A phone browser doesn't have
   those, so this file provides tiny stand-ins built on ordinary web features:

     chrome.storage.local  ->  window.localStorage   (saves data on the phone)
     chrome.downloads      ->  a normal file download link

   This must load BEFORE zip.js / sync.js / app.js. Nothing else changes, so the
   Chrome extension and this mobile app share the exact same logic.
   ========================================================================== */

(function () {
  "use strict";

  // If a real Chrome extension environment ever loads this, do nothing.
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) return;

  window.chrome = window.chrome || {};
  var PREFIX = "tt:"; // every key is stored as "tt:tasks", "tt:config", etc.

  // ---- chrome.storage.local (get/set/remove) ------------------------------
  chrome.storage = {
    local: {
      get: function (keys, cb) {
        var names;
        if (keys == null) {
          // null/undefined => return everything we saved
          names = Object.keys(localStorage)
            .filter(function (k) { return k.indexOf(PREFIX) === 0; })
            .map(function (k) { return k.slice(PREFIX.length); });
        } else if (typeof keys === "string") {
          names = [keys];
        } else if (Array.isArray(keys)) {
          names = keys;
        } else {
          names = Object.keys(keys); // object of {key: defaultValue}
        }

        var out = {};
        names.forEach(function (n) {
          var raw = localStorage.getItem(PREFIX + n);
          if (raw != null) {
            try { out[n] = JSON.parse(raw); } catch (e) { /* ignore bad value */ }
          } else if (keys && typeof keys === "object" && !Array.isArray(keys)) {
            out[n] = keys[n]; // fall back to the provided default
          }
        });
        if (cb) cb(out);
      },

      set: function (obj, cb) {
        Object.keys(obj).forEach(function (k) {
          localStorage.setItem(PREFIX + k, JSON.stringify(obj[k]));
        });
        if (cb) cb();
      },

      remove: function (keys, cb) {
        (Array.isArray(keys) ? keys : [keys]).forEach(function (k) {
          localStorage.removeItem(PREFIX + k);
        });
        if (cb) cb();
      },
    },
  };

  // ---- chrome.downloads.download (via a temporary <a download>) -----------
  chrome.downloads = {
    download: function (opts, cb) {
      var a = document.createElement("a");
      a.href = opts.url;
      a.download = opts.filename || "download";
      document.body.appendChild(a);
      a.click();
      a.remove();
      if (cb) cb(1);
    },
  };
})();
