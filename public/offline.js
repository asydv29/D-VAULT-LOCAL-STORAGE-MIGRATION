// offline.js
// Shared helper included on every page:
//  1. Registers the service worker so the app shell can open with no
//     network connection at all (see sw.js).
//  2. Exposes a tiny, consistent "offline" banner + connectivity check
//     that page-specific scripts (app.js, watch.js, shorts.js) use to show
//     downloaded content instead of failing when there's no connection.
(function () {
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    });
  }

  function isOffline() {
    return !navigator.onLine;
  }

  function ensureBannerEl() {
    let el = document.getElementById("offlineBanner");
    if (!el) {
      el = document.createElement("div");
      el.id = "offlineBanner";
      el.className = "offline-banner";
      el.hidden = true;
      document.body.prepend(el);
    }
    return el;
  }

  function showBanner(text) {
    const el = ensureBannerEl();
    el.textContent = text || "You're offline — showing your local D Vault library.";
    el.hidden = false;
  }

  function hideBanner() {
    const el = document.getElementById("offlineBanner");
    if (el) el.hidden = true;
  }

  // True when a fetch/response failure looks like "no network" rather than
  // a real server error — e.g. the browser's fetch() rejecting outright
  // (TypeError: Failed to fetch) instead of returning a non-OK response.
  function looksOffline(err) {
    return isOffline() || (err && !("status" in err));
  }

  window.MyTubeOffline = { isOffline, showBanner, hideBanner, looksOffline };
})();
