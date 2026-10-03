# D Vault Android Storage Bridge

The web UI never receives arbitrary filesystem paths. The Android host should expose a JavaScript bridge backed by Android Storage Access Framework (SAF).

Recommended bridge methods:

- `pickFolder()` → `{ token, name }`
- `listFiles(token)` → recursive file records:
  `{ path, name, size, lastModified, mimeType, url? }`
- `readFile(token, path)` → only required when `url` cannot be supplied
- `renameFile(token, path, newName)`
- `deleteFile(token, path)`
- `createFolder(token, parentPath, name)`

For best playback/preview performance, `listFiles()` should return a WebView-loadable local `url` for each file when the Android host can safely expose one through SAF. The host must enforce the persisted URI permission granted by the system picker.

The bridge must not bypass Android storage restrictions, inspect unrelated folders, upload media, or expose filesystem paths to a remote server.
