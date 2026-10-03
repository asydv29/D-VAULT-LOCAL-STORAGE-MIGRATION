// idb-downloads.js
// Coordinates "downloaded" videos so pages can save/list/play them from the
// app's own storage instead of handing them to the OS/system file manager.
// The actual byte storage (IndexedDB) lives in idb-store.js, shared with the
// service worker; this file adds download orchestration + cross-tab
// progress tracking on top, and exposes it all as the global `AppDownloads`.
(function () {
  if (!self.IDBStore) return; // idb-store.js must be included first.
  const {
    saveVideo: saveVideoRaw, getVideo: getVideoRaw, deleteVideo: deleteVideoRaw, listVideos: listVideosRaw, estimateStorage,
    savePending, getPending, deletePending,
  } = IDBStore;

  // Each downloaded video is tagged with the D Vault account that saved
  // it (see local storage identity), so on a shared device one account's saved
  // videos never show up - or play - under a different account that signs
  // in afterwards. Records saved before this existed have no owner and are
  // simply hidden rather than guessed at.
  function currentOwner() {
    return "local";
  }
  async function listVideos() {
    const owner = currentOwner();
    if (!owner) return [];
    const items = await listVideosRaw();
    return items.filter((v) => v.owner === owner);
  }
  async function getVideo(id) {
    const owner = currentOwner();
    const rec = await getVideoRaw(id);
    return rec && owner && rec.owner === owner ? rec : undefined;
  }
  async function deleteVideo(id) {
    const owner = currentOwner();
    const rec = await getVideoRaw(id);
    if (rec && owner && rec.owner === owner) return deleteVideoRaw(id);
  }

  // A download runs one of two ways:
  //  - Background Fetch: handed off to the browser via the service worker
  //    (see sw.js), with its own system notification. Keeps running even if
  //    D Vault is backgrounded, the screen locks, or the app is swiped away.
  //    Used automatically whenever the browser supports it.
  //  - Foreground: a plain fetch() held open on whichever tab started it.
  //    Only that tab can drive it, and the browser can throttle or kill it
  //    once the tab is backgrounded. Used as a fallback when Background
  //    Fetch isn't available (e.g. Safari/iOS, Firefox) or fails to start.
  // Either way, any page — the Downloads page, the home grid, the watch
  // page's own recommendations, shorts — should be able to show
  // "Downloading… 42%" for it, and cancel it, even from a different tab.
  // Progress lives in localStorage so a page that loads mid-download can
  // see it immediately, and BroadcastChannel carries live updates + cancel
  // requests to any tabs already open (including messages sent by the
  // service worker itself once a background download finishes).
  const ACTIVE_KEY = "mytube-active-downloads";
  const bc = ("BroadcastChannel" in window) ? new BroadcastChannel("mytube-downloads") : null;
  // AbortControllers for *foreground* downloads running in this tab, keyed
  // by video id. Background Fetch downloads are canceled through the
  // Background Fetch registration instead (see requestCancelDownload) and
  // don't need an entry here.
  const localControllers = {};

  function getActiveDownloads() {
    try { return JSON.parse(localStorage.getItem(ACTIVE_KEY) || "{}"); } catch { return {}; }
  }
  function setActiveDownload(id, data) {
    const all = getActiveDownloads();
    if (data == null) delete all[String(id)]; else all[String(id)] = data;
    try { localStorage.setItem(ACTIVE_KEY, JSON.stringify(all)); } catch {}
    bc?.postMessage({ type: "progress" });
  }
  // Also fires for bg-saved/bg-failed/bg-aborted — the service worker sends
  // these straight to every open tab (not just whichever tab started the
  // download), so a Downloads page left open elsewhere still notices a
  // background download finishing.
  const ACTIVE_CHANGE_TYPES = new Set(["progress", "bg-saved", "bg-failed", "bg-aborted"]);
  function onActiveDownloadsChanged(cb) {
    bc?.addEventListener("message", (e) => { if (ACTIVE_CHANGE_TYPES.has(e.data?.type)) cb(); });
    window.addEventListener("storage", (e) => { if (e.key === ACTIVE_KEY) cb(); });
  }

  async function getBackgroundFetchManager() {
    // D Vault local media is exposed through the page-local fetch adapter; a service worker cannot access that adapter or the selected filesystem handle.
    // Use the foreground/local IndexedDB path instead of handing a /api URL to Background Fetch.
    return null;
    /* if (!("serviceWorker" in navigator) || !("BackgroundFetchManager" in window)) return null; */
    try {
      const reg = await navigator.serviceWorker.ready;
      return reg.backgroundFetch || null;
    } catch { return null; }
  }
  // Lets a caller check up front whether a download it's about to start
  // will actually be able to survive the tab closing/backgrounding, so the
  // UI can set the right expectation ("safe to close the app" vs "keep
  // this open") before the download even begins, not just after the fact
  // via onProgress's background flag once it's already running.
  async function supportsBackgroundDownload() {
    return !!(await getBackgroundFetchManager());
  }

  async function requestCancelDownload(id) {
    id = String(id);
    if (localControllers[id]) localControllers[id].abort();
    bc?.postMessage({ type: "cancel", id });
    // Background Fetch downloads aren't tied to any one tab, so also try to
    // abort the registration directly — this works even from a tab other
    // than the one that started the download, or after that tab closed.
    try {
      const pending = await getPending(id);
      if (pending?.bgId) {
        const bgFetch = await getBackgroundFetchManager();
        const live = await bgFetch?.get(pending.bgId);
        if (live) await live.abort();
      }
    } catch {}
  }
  bc?.addEventListener("message", (e) => {
    if (e.data?.type === "cancel" && localControllers[e.data.id]) localControllers[e.data.id].abort();
  });
  // Whichever tab hears a *background* download's completion/failure/abort
  // first should clear its shared "active" entry — not just the tab that
  // happened to start it. That tab is very often closed by the time a
  // Background Fetch actually finishes (surviving a closed tab is the whole
  // point of Background Fetch), so relying only on startBackgroundDownload's
  // own promise closure below left the entry stuck showing "Downloading…"
  // forever in every other tab, with progress/cancel never reflecting reality.
  bc?.addEventListener("message", (e) => {
    const d = e.data;
    if (d && (d.type === "bg-saved" || d.type === "bg-failed" || d.type === "bg-aborted")) {
      setActiveDownload(d.id, null);
      deletePending(d.id).catch(() => {});
    }
  });
  // If this tab closes/refreshes mid-*foreground*-download, its fetch dies
  // with it — clear its shared progress entry so no page keeps showing
  // "Downloading…" forever for a download that's actually gone. Background
  // Fetch downloads are left alone here since they keep running regardless
  // of this (or any) tab closing.
  window.addEventListener("pagehide", () => {
    Object.keys(localControllers).forEach((id) => setActiveDownload(id, null));
  });

  const BG_ICONS = [{ src: "/d-vault-logo.svg", sizes: "300x300", type: "image/jpeg" }];

  // Reconciles localStorage's view of any *background* downloads with the
  // real Background Fetch registrations, which are the source of truth and
  // outlive any particular page load. Call this before rendering a page
  // that lists pending downloads (see downloads.js) so progress — or "it
  // actually finished/failed while nothing was open to hear about it" — is
  // accurate even after reopening the app.
  async function syncBackgroundDownloads() {
    const bgFetch = await getBackgroundFetchManager();
    if (!bgFetch) return;
    const active = getActiveDownloads();
    for (const id of Object.keys(active)) {
      if (!active[id]?.background) continue;
      const pending = await getPending(id).catch(() => null);
      const live = pending?.bgId ? await bgFetch.get(pending.bgId).catch(() => null) : null;
      if (live && live.result === "") {
        setActiveDownload(id, { ...active[id], received: live.downloaded, total: live.downloadTotal });
      } else {
        // No live in-progress registration and nobody was around to hear
        // the service worker's completion message — stop showing it as
        // pending either way. listVideos() will reflect whether it
        // actually made it into storage.
        setActiveDownload(id, null);
        if (pending) await deletePending(id).catch(() => {});
      }
    }
  }

  async function startBackgroundDownload(bgFetch, { id, title, streamUrl, posterUrl, onProgress }) {
    const existing = await getPending(id).catch(() => null);
    if (existing?.bgId) {
      const live = await bgFetch.get(existing.bgId).catch(() => null);
      if (live && live.result === "") throw Error("Already downloading.");
    }
    const bgId = `dl:${id}:${Date.now()}`;
    await savePending({ id, bgId, title, posterUrl, startedAt: Date.now(), owner: currentOwner() });
    // Background Fetch never infers its size from the response's
    // Content-Length - it only knows a total if we hand it one via
    // downloadTotal at registration time. Without it, both Chrome's own
    // download notification and this app's progress UI have nothing to
    // divide by, so progress looks stuck at 0% even while bytes are
    // actually arriving. A quick HEAD tells us the size first; if it fails
    // for any reason, fall through and register with no total rather than
    // blocking the download - it'll just show MB transferred instead of %.
    let downloadTotal = 0;
    try {
      const head = await fetch(streamUrl, { method: "HEAD", credentials: "include" });
      if (head.ok) downloadTotal = Number(head.headers.get("Content-Length")) || 0;
    } catch {}
    let bgReg;
    try {
      bgReg = await bgFetch.fetch(bgId, [streamUrl], { title: title || "Downloading video", icons: BG_ICONS, downloadTotal });
    } catch (err) {
      await deletePending(id).catch(() => {});
      throw err;
    }
    setActiveDownload(id, { title, received: 0, total: bgReg.downloadTotal || 0, startedAt: Date.now(), background: true });
    onProgress?.({ received: 0, total: bgReg.downloadTotal || 0, background: true });

    // Background Fetch doesn't push progress to the page on its own, so
    // poll the registration periodically. This works from any tab, not
    // just the one that started the download.
    let stopped = false;
    const poll = async () => {
      if (stopped) return;
      const live = await bgFetch.get(bgId).catch(() => null);
      if (!live || stopped) return;
      onProgress?.({ received: live.downloaded, total: live.downloadTotal, background: true });
      setActiveDownload(id, { title, received: live.downloaded, total: live.downloadTotal, startedAt: Date.now(), background: true });
    };
    const timer = setInterval(poll, 800);

    const promise = new Promise((resolve, reject) => {
      const onMsg = (e) => {
        const d = e.data;
        if (!d || d.id !== id) return;
        if (d.type === "bg-saved") { cleanup(); resolve(); }
        else if (d.type === "bg-failed") { cleanup(); reject(Error(d.error || "Download failed.")); }
        else if (d.type === "bg-aborted") { cleanup(); reject(Object.assign(Error("Download canceled."), { name: "AbortError" })); }
      };
      function cleanup() {
        stopped = true;
        clearInterval(timer);
        bc?.removeEventListener("message", onMsg);
        setActiveDownload(id, null);
      }
      bc?.addEventListener("message", onMsg);
    });

    return {
      promise,
      cancel: async () => { try { const live = await bgFetch.get(bgId); if (live) await live.abort(); } catch {} },
      id,
    };
  }

  // Foreground fallback: streams the video into memory on this tab, then
  // saves it. Used automatically when Background Fetch isn't available or
  // fails to register. Unchanged from the original page-only implementation.
  function startForegroundDownload({ id, title, streamUrl, posterUrl, onProgress }) {
    const controller = new AbortController();
    localControllers[id] = controller;
    const startedAt = Date.now();
    let lastBroadcast = 0;
    setActiveDownload(id, { title, received: 0, total: 0, startedAt });
    const promise = (async () => {
      const posterPromise = posterUrl
        ? fetch(posterUrl, { credentials: "include" }).then((pr) => (pr.ok ? pr.blob() : null)).catch(() => null)
        : Promise.resolve(null);
      const res = await fetch(streamUrl, { credentials: "include", signal: controller.signal });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw Error(j.error || "Download failed.");
      }
      const total = Number(res.headers.get("Content-Length")) || 0;
      let received = 0, chunks = [];
      if (res.body && res.body.getReader) {
        const reader = res.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          received += value.length;
          onProgress?.({ received, total, background: false });
          const now = Date.now();
          if (now - lastBroadcast > 300) {
            lastBroadcast = now;
            setActiveDownload(id, { title, received, total, startedAt });
          }
        }
      } else {
        chunks = [await res.arrayBuffer()];
      }
      const blob = new Blob(chunks, { type: res.headers.get("Content-Type") || "video/mp4" });
      const poster = await posterPromise;
      await saveVideoRaw({ id, title, blob, poster, size: blob.size, savedAt: Date.now(), owner: currentOwner() });
    })().finally(() => {
      delete localControllers[id];
      setActiveDownload(id, null);
    });
    return { promise, cancel: () => controller.abort(), id };
  }

  // Downloads a video's full stream into this app's own storage, usable
  // from any page (watch page, its recommendations, the home grid, shorts).
  // Takes {id, title, streamUrl, posterUrl, onProgress}; onProgress is
  // optional and called with {received,total} as bytes arrive. Returns a
  // handle {promise, cancel(), id} — promise resolves once saved, or
  // rejects with an AbortError-named error if canceled. Returns
  // synchronously (like the old implementation) so callers can attach
  // `.cancel` right away, even though which download path gets used is
  // decided asynchronously under the hood.
  function startDownload({ id, title, streamUrl, posterUrl, onProgress }) {
    id = String(id);
    let cancelImpl = null;
    let canceledEarly = false;

    const promise = (async () => {
      const bgFetch = await getBackgroundFetchManager();
      if (bgFetch) {
        try {
          const handle = await startBackgroundDownload(bgFetch, { id, title, streamUrl, posterUrl, onProgress });
          if (canceledEarly) { handle.cancel(); } else { cancelImpl = handle.cancel; }
          return handle.promise;
        } catch {
          // Background Fetch unavailable/denied/failed to register — fall
          // through to the foreground path below.
        }
      }
      if (canceledEarly) throw Object.assign(Error("Download canceled."), { name: "AbortError" });
      const handle = startForegroundDownload({ id, title, streamUrl, posterUrl, onProgress });
      cancelImpl = handle.cancel;
      return handle.promise;
    })();

    return {
      promise,
      cancel: () => { if (cancelImpl) cancelImpl(); else canceledEarly = true; },
      id,
    };
  }

  window.AppDownloads = {
    getVideo, deleteVideo, listVideos, estimateStorage,
    getActiveDownloads, setActiveDownload, onActiveDownloadsChanged,
    requestCancelDownload, startDownload, syncBackgroundDownloads,
    supportsBackgroundDownload,
  };
})();
