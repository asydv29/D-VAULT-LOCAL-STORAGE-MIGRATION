// idb-store.js
// Low-level IndexedDB access shared between page scripts and the service
// worker (see sw.js's backgroundfetch* handlers). Kept dependency-free so it
// can be loaded either as a normal <script> (where `self` is the window) or
// via importScripts() inside the service worker (where `self` is the SW's
// own global scope) — either way it exposes the same `self.IDBStore`.
(function () {
  const DB_NAME = "mytube-downloads",
    DB_VERSION = 2,
    VIDEOS_STORE = "videos",
    PENDING_STORE = "pending";

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(VIDEOS_STORE)) {
          db.createObjectStore(VIDEOS_STORE, { keyPath: "id" });
        }
        // Tracks a download that's running as a Background Fetch, keyed by
        // video id. Lets the service worker's backgroundfetch* handlers
        // (which only get a background-fetch id, not the video's title or
        // poster URL) figure out which video a given registration belongs
        // to — even if the page/tab that started the download has since
        // been closed.
        if (!db.objectStoreNames.contains(PENDING_STORE)) {
          db.createObjectStore(PENDING_STORE, { keyPath: "id" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || Error("Could not open in-app storage."));
    });
  }

  async function withStore(storeName, mode, fn) {
    const db = await openDb();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, mode);
        const store = tx.objectStore(storeName);
        let result;
        Promise.resolve(fn(store)).then((r) => { result = r; }).catch(reject);
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error || Error("In-app storage request failed."));
        tx.onabort = () => reject(tx.error || Error("In-app storage request was aborted."));
      });
    } finally {
      db.close();
    }
  }

  function reqToPromise(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function saveVideo(record) {
    return withStore(VIDEOS_STORE, "readwrite", (store) => reqToPromise(store.put(record)));
  }
  function getVideo(id) {
    return withStore(VIDEOS_STORE, "readonly", (store) => reqToPromise(store.get(String(id))));
  }
  function deleteVideo(id) {
    return withStore(VIDEOS_STORE, "readwrite", (store) => reqToPromise(store.delete(String(id))));
  }
  function listVideos() {
    return withStore(VIDEOS_STORE, "readonly", (store) => reqToPromise(store.getAll()));
  }

  function savePending(record) {
    return withStore(PENDING_STORE, "readwrite", (store) => reqToPromise(store.put(record)));
  }
  function getPending(id) {
    return withStore(PENDING_STORE, "readonly", (store) => reqToPromise(store.get(String(id))));
  }
  function deletePending(id) {
    return withStore(PENDING_STORE, "readwrite", (store) => reqToPromise(store.delete(String(id))));
  }
  function listPending() {
    return withStore(PENDING_STORE, "readonly", (store) => reqToPromise(store.getAll()));
  }

  // Rough estimate of how much space this app is using / has left, when
  // the browser supports it. Returns null if unavailable.
  async function estimateStorage() {
    if (!navigator.storage || !navigator.storage.estimate) return null;
    try { return await navigator.storage.estimate(); } catch { return null; }
  }

  self.IDBStore = {
    saveVideo, getVideo, deleteVideo, listVideos,
    savePending, getPending, deletePending, listPending,
    estimateStorage,
  };
})();
