# D Vault

This build continues the existing DPlayer UI while replacing the remote account/media architecture with a local-first storage layer.

## Storage
- Browser: File System Access API (`showDirectoryPicker`) with persisted directory handles in IndexedDB.
- Android WebView: optional `window.DVaultAndroid` bridge backed by Android Storage Access Framework.
- One active storage location at a time.
- No media uploads or remote media server is required.

## Local metadata
IndexedDB database: `dvault-local`
- `handles`
- `meta`
- `assets`
- `settings`

Original video/image files stay in the selected folder.

## Preview engine
`local-preview.js` uses native `HTMLVideoElement` decoding and Canvas.
- Intelligent thumbnail sampling across the full duration.
- Black/blank/highlight-poor frames are penalized.
- Adaptive sprite counts: 30/45/60/90/120.
- Background queue with device-aware concurrency.
- Visible cards receive higher priority.
- Preview assets are versioned (`previewVersion` / engine version 2).
- No FFmpeg is required for normal thumbnails, hover previews, sprites, or timeline previews.

## Compatibility
The application still uses the existing `/api/*` contract internally, but `local-api.js` intercepts those requests in the page and resolves them against local IndexedDB/filesystem data. This keeps the existing UI/player code intact while removing the Cloudflare D1/R2/Google architecture.

The Cloudflare Worker now only serves static application assets.

## Android bridge
See `ANDROID-STORAGE-BRIDGE.md` for the SAF bridge contract.
