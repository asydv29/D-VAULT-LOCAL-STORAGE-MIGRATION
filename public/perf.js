// perf.js - "get ready before the tap lands".
//
// What this actually does (and doesn't):
//   A web page can't make the network itself faster, so nothing here tries
//   to. What it CAN do is stop a video's first request from paying for work
//   that could have happened earlier. Every cold stream request makes the
//   Worker look the file up on Local storage (name/size/remote account token) before a
//   single video byte can flow - that round trip is the slowest part of
//   "tap -> first frame" (see the comments in src/index.js's stream handler).
//   The Worker already caches that lookup for ~2 minutes, so a tiny 1-byte
//   Range request for a video the person is *about to* open pays that cost
//   in the background, and the real request a moment later skips it.
//
// It costs about one byte of video data per warm-up, at low priority, and it
// never runs when Data Saver is on, on 2G, or offline.
(function () {
  "use strict";

  var conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  // Speculative work is skipped on Data Saver / very slow links. (The page
  // the person is *already opening* is not speculative - see `force`.)
  function shouldSkip(force) {
    if (navigator.onLine === false) return true;
    if (force) return false;
    if (!conn) return false;
    return !!conn.saveData || /(^|-)2g$/.test(conn.effectiveType || "");
  }

  // The Worker caches the Drive lookup for 120s; re-warming sooner is pointless.
  var WARM_TTL_MS = 100000;
  var MAX_INFLIGHT = 2;
  var warmed = new Map(); // id -> last warm time
  var inflight = 0;

  function warm(id, opts) {
    // Media is local now: there is no server lookup to pre-warm, and the fake
    // Range request made the page walk the folder tree on every hover/tap.
    return;
    if (!id) return;
    id = String(id);
    if (shouldSkip(opts && opts.force)) return;
    var now = Date.now();
    var last = warmed.get(id);
    if (last && now - last < WARM_TTL_MS) return;
    if (inflight >= MAX_INFLIGHT) return;
    warmed.set(id, now);
    // Keep the map from growing forever on a huge library.
    if (warmed.size > 200) warmed.delete(warmed.keys().next().value);
    inflight++;
    var done = function () { inflight = Math.max(0, inflight - 1); };
    try {
      fetch("/api/videos/" + encodeURIComponent(id) + "/stream", {
        method: "GET",
        headers: { Range: "bytes=0-0" },
        credentials: "same-origin",
        // keepalive lets the request finish even if a tap navigates away
        // right after; priority keeps it from competing with thumbnails.
        keepalive: true,
        priority: "low"
      }).then(function (r) {
        try { if (r.body) r.body.cancel(); } catch (_) {}
        // A failed warm-up shouldn't block trying again later.
        if (!r.ok) warmed.delete(id);
        done();
      }).catch(function () { warmed.delete(id); done(); });
    } catch (_) {
      warmed.delete(id);
      done();
    }
  }

  // Pull a video id out of whatever was pointed at / pressed: grid cards carry
  // data-watch="<id>", other links carry ?id=<id> in a watch/shorts URL.
  function idFrom(node) {
    if (!node || !node.closest) return null;
    var el = node.closest("[data-watch], a[href*='watch.html?id='], a[href*='shorts.html?id=']");
    if (!el) return null;
    if (el.dataset && el.dataset.watch) return el.dataset.watch;
    try { return new URL(el.href, location.href).searchParams.get("id"); } catch (_) { return null; }
  }

  // Mouse: warm after the pointer rests on a card for a moment (so sweeping
  // across a grid doesn't warm everything it passes over).
  var hoverTimer = null, hoverId = null;
  document.addEventListener("pointerover", function (e) {
    if (e.pointerType !== "mouse") return;
    var id = idFrom(e.target);
    if (!id || id === hoverId) return;
    hoverId = id;
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(function () { warm(id); }, 120);
  }, { passive: true, capture: true });
  document.addEventListener("pointerout", function (e) {
    if (e.pointerType !== "mouse") return;
    if (!idFrom(e.relatedTarget) || idFrom(e.relatedTarget) !== hoverId) {
      clearTimeout(hoverTimer);
      hoverId = null;
    }
  }, { passive: true, capture: true });

  // Touch / pen / mouse press: warm right away. A finger touching a card is
  // the strongest "about to open" signal there is, and the tap itself takes
  // ~50-150ms - free head start. (Only the card under the finger at the
  // start of a gesture, so a scroll flick warms one video, not twenty.)
  document.addEventListener("pointerdown", function (e) {
    var id = idFrom(e.target);
    if (id) warm(id);
  }, { passive: true, capture: true });

  // Keyboard users tabbing onto a card.
  document.addEventListener("focusin", function (e) {
    var id = idFrom(e.target);
    if (id) warm(id);
  }, { passive: true });

  // On the watch page itself, start right now, in parallel with the library
  // list request that main() makes - the video is about to be requested
  // either way, so this isn't speculative (ignores Data Saver).
  if (/\/watch\.html$/.test(location.pathname)) {
    warm(new URLSearchParams(location.search).get("id"), { force: true });
  }

  window.DPPerf = { warm: warm };
})();
