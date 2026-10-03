const CACHE_NAME="dvault-shell-v21";
const SHELL=["/","/index.html","/style.css","/app.js","/local-storage.js","/local-preview.js","/local-api.js","/local-bootstrap.js","/local-progress.js","/autothumb.js","/orientationdetect.js","/preview.js","/reverse-play.js","/details.js","/sidebar.js","/theme.js","/perf.js","/offline.js","/idb-store.js","/idb-downloads.js","/offline-player.js","/watch.html","/watch.js","/shorts.html","/shorts.js","/shorts.css","/photos.html","/photos.js","/downloads.html","/downloads.js","/settings.html","/d-vault-logo.svg","/favicon.ico","/icon-192.png","/icon-512.png","/apple-touch-icon.png","/icons/watch-later.svg","/icons/volume.png","/icons/thumbnail-icon.png","/icons/star.svg","/icons/shorts-icon.png","/icons/search.png","/icons/screenshot-icon.png","/icons/remove-from-shorts.svg","/icons/playlist-icon.png","/icons/mute.png","/icons/mark-as-shorts.svg","/icons/liked-icon.png","/icons/heart.png","/icons/eye-show.png","/icons/eye-hide.png","/icons/download.png","/icons/details-icon.png","/icons/delete-icon.png"];
self.addEventListener("install",e=>e.waitUntil(caches.open(CACHE_NAME).then(c=>Promise.all(SHELL.map(u=>c.add(new Request(u,{cache:"reload"})).catch(()=>{})))).then(()=>self.skipWaiting())));
self.addEventListener("activate",e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
// Stale-while-revalidate: serve the cached shell instantly (no network wait),
// refresh it in the background so the next open has the latest files.
self.addEventListener("fetch",e=>{
  const r=e.request;
  if(r.method!=="GET"||r.headers.has("range"))return;
  const u=new URL(r.url);
  if(u.origin!==location.origin||u.pathname.startsWith("/api/"))return;
  e.respondWith((async()=>{
    const c=await caches.match(r,{ignoreSearch:true});
    const net=fetch(r,{cache:"no-cache"}).then(n=>{if(n.status===200){const copy=n.clone();caches.open(CACHE_NAME).then(x=>x.put(r,copy)).catch(()=>{})}return n});
    if(c){e.waitUntil(net.catch(()=>{}));return c}
    try{return await net}catch{return new Response("",{status:503})}
  })());
});
