const $=s=>document.querySelector(s),id=new URLSearchParams(location.search).get("id");
function fmtViews(n){n=Number(n||0);if(n>=1e9)return (n/1e9).toFixed(1).replace(".0","")+"B views";if(n>=1e6)return (n/1e6).toFixed(1).replace(".0","")+"M views";if(n>=1e3)return (n/1e3).toFixed(1).replace(".0","")+"K views";return n+" views"}
function fmtSize(b){b=Number(b);if(!b||b<0)return "";const u=["B","KB","MB","GB","TB"];let i=0;while(b>=1024&&i<u.length-1){b/=1024;i++}return (i?b.toFixed(1):String(Math.round(b)))+" "+u[i]}
function ago(d){if(!d)return "Recently";const s=Math.max(0,(Date.now()-new Date(d).getTime())/1000);if(s<3600)return Math.floor(s/60)+" minutes ago";if(s<86400)return Math.floor(s/3600)+" hours ago";if(s<2592000)return Math.floor(s/86400)+" days ago";if(s<31536000)return Math.floor(s/2592000)+" months ago";return Math.floor(s/31536000)+" years ago"}
// Card meta line: quality · views · file size · uploaded (unknown parts are left out).
function cardStats(v){return [v.quality,fmtViews(v.views),fmtSize(v.size),ago(v.createdTime)].filter(Boolean).join(" · ")}

const api=(u,o)=>fetch(u,o).then(async r=>{const j=await r.json().catch(()=>({}));if(!r.ok)throw Error(j.error||"Request failed");return j});

// Tiny dedicated cache for videos whose codec needed a client-side fix to
// play (see the "Fix & Play" flow in main()). Converting an incompatible
// file always costs real time on the device doing the work, so the win we
// can actually deliver is: pay that cost once per video per device, then
// every later open of the same video starts instantly from the cached,
// already-compatible copy instead of re-detecting/re-converting it.
const DP_FIX_DB="dp-codec-cache",DP_FIX_STORE="fixed";
function dpFixDb(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(DP_FIX_DB,1);
    req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains(DP_FIX_STORE))req.result.createObjectStore(DP_FIX_STORE)};
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error||Error("Could not open in-app storage."));
  });
}
async function getCachedFix(vid){
  try{
    const db=await dpFixDb();
    const rec=await new Promise((resolve,reject)=>{
      const tx=db.transaction(DP_FIX_STORE,"readonly");
      const r=tx.objectStore(DP_FIX_STORE).get(vid);
      r.onsuccess=()=>resolve(r.result||null);
      r.onerror=()=>reject(r.error);
    });
    db.close();
    return rec?rec.blob:null;
  }catch(_){return null}
}
async function putCachedFix(vid,blob){
  try{
    const db=await dpFixDb();
    await new Promise((resolve,reject)=>{
      const tx=db.transaction(DP_FIX_STORE,"readwrite");
      tx.objectStore(DP_FIX_STORE).put({blob,savedAt:Date.now()},vid);
      tx.oncomplete=resolve;
      tx.onerror=()=>reject(tx.error);
    });
    db.close();
  }catch(_){}
}
const fmt=s=>{if(!Number.isFinite(s)||s<0)return"0:00";s=Math.floor(s);const h=Math.floor(s/3600),m=Math.floor(s%3600/60),x=s%60;return h?`${h}:${String(m).padStart(2,"0")}:${String(x).padStart(2,"0")}`:`${m}:${String(x).padStart(2,"0")}`};
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
// Shared play/pause glyphs for the center overlay (paused hint) and the
// brief pause/resume flash shown on tap/click/spacebar - a crisp SVG glyph
// instead of a plain "▶"/"❚❚" text character, sized to match the circle.
const PLAY_SVG='<svg viewBox="0 0 24 24" width="46" height="46" fill="#fff" style="margin-left:5px"><path d="M8 5v14l11-7z"></path></svg>';
const PAUSE_SVG='<svg viewBox="0 0 24 24" width="44" height="44" fill="#fff"><path d="M6 5h4v14H6zm8 0h4v14h-4z"></path></svg>';
// Same glyph, scaled down to sit inside the 38x38 control-bar button —
// the YouTube-style flat play/pause icon instead of a plain text character.
const PLAY_SVG_SM='<svg viewBox="0 0 24 24" width="20" height="20" fill="#fff" style="margin-left:2px"><path d="M8 5v14l11-7z"></path></svg>';
const PAUSE_SVG_SM='<svg viewBox="0 0 24 24" width="20" height="20" fill="#fff"><path d="M6 5h4v14H6zm8 0h4v14h-4z"></path></svg>';

// ---- Watch-page title: show the first 10 words, then a "...more" button that
// reveals the full video name. Short titles (10 words or fewer) show as-is.
const TITLE_WORD_LIMIT=10;
function setWatchTitle(text){
  const el=$("#title");
  if(!el)return;
  const full=String(text||"Untitled video").trim()||"Untitled video";
  const words=full.split(/\s+/);
  el.textContent="";
  if(words.length<=TITLE_WORD_LIMIT){el.textContent=full;return}
  el.appendChild(document.createTextNode(words.slice(0,TITLE_WORD_LIMIT).join(" ")+" "));
  const more=document.createElement("button");
  more.type="button";
  more.className="title-more";
  more.textContent="...more";
  more.setAttribute("aria-expanded","false");
  more.onclick=e=>{e.preventDefault();e.stopPropagation();el.textContent=full};
  el.appendChild(more);
}

// ---- Hamburger navigation drawer (mirrors the one on the home page) ----
(function(){
  const sidebar=$("#sidebar"),backdrop=$("#sidebarBackdrop"),menuBtn=$("#menuBtn");
  if(!sidebar||!backdrop||!menuBtn)return;
  function openMenu(){sidebar.classList.add("open");backdrop.classList.add("show");document.body.classList.add("dp-sidebar-locked")}
  function closeMenu(){sidebar.classList.remove("open");backdrop.classList.remove("show");document.body.classList.remove("dp-sidebar-locked")}
  menuBtn.onclick=()=>{sidebar.classList.contains("open")?closeMenu():openMenu()};
  const sidebarClose=$("#sidebarClose");
  if(sidebarClose)sidebarClose.onclick=closeMenu;
  backdrop.onclick=closeMenu;
  document.addEventListener("keydown",e=>{if(e.key==="Escape")closeMenu()});

  document.querySelectorAll("[data-view]").forEach(b=>b.onclick=()=>{location.href="/?view="+encodeURIComponent(b.dataset.view)});

  // Both sidebar.js's own active-highlighting and its liked-group wiring
  // are skipped on this page (see DP_SIDEBAR_SKIP above), so mark the
  // single "Liked" nav item active here directly when relevant.
  const likedNav=$('[data-nav="liked"]');
  if(likedNav&&new URLSearchParams(location.search).get("list")==="liked")likedNav.classList.add("active");

  const modal=$("#modal");
  function showAccountModal(email){
    $("#modalTitle").textContent="Account";
    $("#modalText").textContent=email;
    const actions=$("#modalActions");
    actions.innerHTML="";
    const out=document.createElement("button");
    out.type="button";out.className="modal-signout";out.textContent="Storage settings";
    out.onclick=()=>{out.disabled=true;out.textContent="Signing out…";location.href="/settings.html"};
    actions.appendChild(out);
    modal.classList.add("show");
  }
  const modalClose=$("#modalClose");
  if(modalClose)modalClose.onclick=()=>modal.classList.remove("show");
  if(modal)modal.onclick=e=>{if(e.target.id==="modal")modal.classList.remove("show")};
  const profileBtn=$("#profileBtn");
  if(profileBtn)profileBtn.onclick=()=>{location.href="/settings.html"};

  window.DVaultStorage?.getActive().then(a=>{const el=$("#accountStatus");if(el)el.textContent=a?"Storage: "+a.name:"No storage selected"}).catch(()=>{});

  function toggleFolderChildren(fid){
    const kids=document.getElementById("fc-"+fid);
    if(!kids)return;
    const isOpenNow=kids.style.display!=="none";
    kids.style.display=isOpenNow?"none":"block";
    const toggleBtn=document.querySelector('[data-toggle="'+fid+'"]');
    if(toggleBtn)toggleBtn.classList.toggle("open",!isOpenNow);
  }
  function renderFolderTree(folders){
    // Merged folders (folder.mergedInto set) shouldn't appear as their own
    // entry here - same rule as the home page's sidebar tree in app.js -
    // otherwise a folder that's been merged away still shows up (often
    // duplicating another folder's name) even though opening it just shows
    // the same videos as the folder it was merged into.
    const visibleFolders=folders.filter(f=>!f.mergedInto);
    const map=new Map(visibleFolders.map(f=>[f.id,{...f,children:[]}]));
    const roots=[];
    map.forEach(f=>{
      if(f.parentId&&map.has(f.parentId))map.get(f.parentId).children.push(f);
      else roots.push(f);
    });
    const byName=(a,b)=>a.name.localeCompare(b.name);
    (function sortTree(nodes){nodes.sort(byName);nodes.forEach(n=>sortTree(n.children))})(roots);
    function renderNodes(nodes,depth){
      if(!nodes.length)return "";
      return '<div class="folder-list">'+nodes.map(n=>{
        const hasKids=n.children.length>0;
        return `<div class="folder-node">
          <div class="folder-row" style="padding-left:${depth*14}px">
            ${hasKids?`<button class="folder-toggle" data-toggle="${esc(n.id)}" aria-label="Expand folder">▸</button>`:'<span class="folder-toggle-spacer"></span>'}
            <button class="folder-link" data-folder="${esc(n.id)}">${window.DPSidebarIcons?window.DPSidebarIcons.folder:''} <span>${esc(n.name)}</span></button>
          </div>
          ${hasKids?`<div class="folder-children" id="fc-${esc(n.id)}" style="display:none">${renderNodes(n.children,depth+1)}</div>`:""}
        </div>`;
      }).join("")+"</div>";
    }
    const tree=$("#folderTree");
    if(!tree)return;
    tree.innerHTML=roots.length?renderNodes(roots,0):'<div class="side-small">No folders found.</div>';
    document.querySelectorAll("[data-toggle]").forEach(b=>b.onclick=e=>{e.preventDefault();e.stopPropagation();toggleFolderChildren(b.dataset.toggle)});
    document.querySelectorAll("[data-folder]").forEach(b=>{
      const hasKids=!!document.getElementById("fc-"+b.dataset.folder);
      if(!hasKids){b.onclick=()=>{location.href="/?folder="+encodeURIComponent(b.dataset.folder)};return}
      let clickTimer=null;
      b.onclick=()=>{
        if(clickTimer){clearTimeout(clickTimer);clickTimer=null;return}
        clickTimer=setTimeout(()=>{clickTimer=null;toggleFolderChildren(b.dataset.folder)},260);
      };
      b.ondblclick=e=>{e.preventDefault();if(clickTimer){clearTimeout(clickTimer);clickTimer=null}location.href="/?folder="+encodeURIComponent(b.dataset.folder)};
    });
  }
  api("/api/folders").then(renderFolderTree).catch(err=>{
    const tree=$("#folderTree");
    if(tree)tree.innerHTML='<div class="side-small">Could not load folders.</div>';
  });

  // Playlists list — same shape as the home page's sidebar (see
  // renderPlaylistList/loadPlaylists in app.js), just reading straight from
  // /api/playlists rather than tracking which one is currently open, since
  // the watch page itself is never "inside" a playlist view.
  function renderPlaylistList(pls){
    const el=$("#playlistList");
    if(!el)return;
    el.innerHTML=pls.length
      ?pls.map(p=>`<div class="folder-node"><div class="folder-row"><span class="folder-toggle-spacer"></span><button class="folder-link" data-playlist-link="${esc(p.id)}">${window.DPSidebarIcons?window.DPSidebarIcons.playlist:''} <span>${esc(p.name)}</span></button><button type="button" class="folder-menu-btn" data-playlist-menu="${esc(p.id)}" aria-label="Playlist options">⋮</button><div class="folder-menu" id="wpmenu-${esc(p.id)}"><button data-playlist-rename2="${esc(p.id)}">Rename</button><button class="unmerge-btn" data-playlist-delete2="${esc(p.id)}">Delete</button></div></div></div>`).join("")
      :"<div class='side-small'>No playlists yet — use the ➕ above, or a video's ⋮ menu.</div>";
    document.querySelectorAll("[data-playlist-link]").forEach(b=>b.onclick=()=>{location.href="/?playlist="+encodeURIComponent(b.dataset.playlistLink)});
    document.querySelectorAll("[data-playlist-menu]").forEach(b=>b.onclick=e=>{
      e.stopPropagation();
      const menu=document.getElementById('wpmenu-'+b.dataset.playlistMenu); // raw id — CSS.escape is only for selectors, and broke ids starting with a digit
      const wasOpen=menu.classList.contains('open');
      document.querySelectorAll('.folder-menu.open').forEach(m=>m.classList.remove('open'));
      menu.classList.toggle('open',!wasOpen);
    });
    document.querySelectorAll("[data-playlist-rename2]").forEach(b=>b.onclick=async e=>{
      e.stopPropagation();
      document.querySelectorAll('.folder-menu.open').forEach(m=>m.classList.remove('open'));
      const p=pls.find(x=>x.id===b.dataset.playlistRename2);
      const name=(prompt('Rename playlist:',p?p.name:'')||'').trim();
      if(!name)return;
      try{
        await api('/api/playlists/'+encodeURIComponent(b.dataset.playlistRename2),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name})});
        loadPlaylists();
      }catch(err){}
    });
    document.querySelectorAll("[data-playlist-delete2]").forEach(b=>b.onclick=async e=>{
      e.stopPropagation();
      document.querySelectorAll('.folder-menu.open').forEach(m=>m.classList.remove('open'));
      const p=pls.find(x=>x.id===b.dataset.playlistDelete2);
      if(!confirm('Delete playlist "'+(p?p.name:'this playlist')+'"? The videos themselves won\'t be deleted.'))return;
      try{
        await api('/api/playlists/'+encodeURIComponent(b.dataset.playlistDelete2),{method:'DELETE'});
        loadPlaylists();
      }catch(err){}
    });
  }
  document.addEventListener('click',e=>{
    if(!e.target.closest('.folder-menu-btn')&&!e.target.closest('.folder-menu'))document.querySelectorAll('.folder-menu.open').forEach(m=>m.classList.remove('open'));
  });
  function loadPlaylists(){
    api("/api/playlists").then(renderPlaylistList).catch(()=>{
      const el=$("#playlistList");
      if(el)el.innerHTML="<div class='side-small'>Could not load playlists.</div>";
    });
  }
  loadPlaylists();
  const newPlaylistBtn=$("#newPlaylistBtn");
  if(newPlaylistBtn)newPlaylistBtn.onclick=async()=>{
    const name=(prompt("Playlist name:")||"").trim();
    if(!name)return;
    try{
      await api("/api/playlists",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({name})});
      // The Playlists section starts collapsed — open it so the new one shows.
      if(window.DPSidebar&&DPSidebar.openPlaylists)DPSidebar.openPlaylists();
      loadPlaylists();
    }catch(e){alert(e.message||"Could not create playlist")}
  };
})();

// ---- Title bar search: the box opens in place on this same watch page
// (no navigation) — only submitting a query hands off to the home page's
// results, same as typing a search there. ----
(function(){
  const btn=$("#watchSearchBtn"),form=$("#watchSearchForm"),input=$("#watchSearchInput"),back=$("#watchSearchBack");
  if(!btn||!form||!input)return;
  const openSearch=()=>{
    document.body.classList.add("search-mode");
    form.classList.add("show");
    input.focus();
  };
  const closeSearch=()=>{
    document.body.classList.remove("search-mode");
    form.classList.remove("show");
    input.value="";
  };
  btn.onclick=openSearch;
  if(back)back.onclick=closeSearch;
  document.addEventListener("keydown",e=>{
    if(e.key==="Escape"&&document.body.classList.contains("search-mode"))closeSearch();
  });
  form.onsubmit=e=>{
    e.preventDefault();
    const q=input.value.trim();
    location.href="/"+(q?"?q="+encodeURIComponent(q):"");
  };
})();

// Offline fallback — used both when the network is genuinely down and when
// this specific video can't be found on the server (e.g. it was removed
// but a copy was saved with "Download offline" earlier). Returns true if it
// managed to render a working local player, so the caller can stop instead
// of showing the normal error page.
async function tryPlayOffline(){
  if(!window.AppDownloads)return false;
  let rec;
  try{rec=await AppDownloads.getVideo(id)}catch{return false}
  if(!rec||!rec.blob)return false;
  renderOfflinePlayer(rec);
  return true;
}
function renderOfflinePlayer(rec){
  if(window.MyTubeOffline)MyTubeOffline.showBanner("You're offline — playing your downloaded copy.");
  const posterUrl=rec.poster?URL.createObjectURL(rec.poster):"";
  document.body.innerHTML=
    '<main class="offline-watch" style="max-width:900px;margin:0 auto">'
    +'<div id="offlinePlayerRoot" style="position:relative;width:100%;aspect-ratio:16/9;background:#000;overflow:hidden">'
    +'<button class="dl-player-close" id="offlinePlayerBack" aria-label="Back" style="position:absolute;top:14px;left:16px;background:transparent;color:#fff;border:0;width:38px;height:38px;display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:20"><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="filter:drop-shadow(0 1px 3px #000a) drop-shadow(0 0 2px #0008)"><path d="M15 5l-8 7 8 7"/></svg></button>'
    +'<video id="offlineVideo" playsinline'+(posterUrl?' poster="'+esc(posterUrl)+'"':'')+' style="width:100%;height:100%;display:block;background:#000"></video>'
    +'</div>'
    +'<div style="padding:14px 16px">'
    +'<h2 style="margin:0 0 6px;color:#f1f1f1">'+esc(rec.title||"Untitled video")+'</h2>'
    +'<p style="color:#aaa;font-size:13px;margin:0 0 14px">Playing from your downloads — no connection needed.</p>'
    +'<a href="/" style="color:#3ea6ff;text-decoration:none">← Back to D Vault</a>'
    +'</div></main>';
  const root=document.getElementById("offlinePlayerRoot");
  const v=document.getElementById("offlineVideo");
  v.src=URL.createObjectURL(rec.blob);
  v.autoplay=true;
  if(window.OfflinePlayer)OfflinePlayer.attach(root,v,{isActive:()=>true,title:rec.title});
  document.getElementById("offlinePlayerBack").onclick=()=>{location.href="/"};
  v.play().catch(()=>{});
}

async function main(){
 // Opening IndexedDB is its own async round trip (10-300ms on some phones,
 // slowest the first time in a page). It only needs the id from the URL -
 // not the video list - so start it now and let it run alongside the list
 // request below, instead of paying for it afterwards right before the
 // video can start. getCachedFix() swallows its own errors (resolves to
 // null), so an unused/ignored result here can never throw.
 const cachedFixP=getCachedFix(String(id));
 let videos;
 try{
   videos=await api("/api/videos");
 }catch(e){
   if(await tryPlayOffline())return;
   throw e;
 }
 const vinfo=videos.find(x=>String(x.id)===String(id));
 if(!vinfo){
   if(await tryPlayOffline())return;
   throw Error("Video not found");
 }
 const v=$("#video"),player=$("#player"),hint=$("#gestureHint"),speedBadge=$("#speedBadge"),controls=$("#controls"); let stream="/api/videos/"+encodeURIComponent(id)+"/stream"; if(window.DVaultMedia){const localUrl=await DVaultMedia.url(id);if(localUrl)stream=localUrl;}
 // preload="auto" (set in watch.html) tells the browser to buffer the
 // video ahead of time for smooth playback the moment the person taps
 // play - but on some Android WebViews (the installed app wrapping this
 // site) that same eager buffering can trigger a spontaneous "play" event
 // on its own once enough data is buffered, even though nothing here ever
 // calls v.play() on load. allowAutoplay stays false until the person
 // actually taps play/pause (or a gesture/keyboard shortcut that maps to
 // it) - see play() below - so any "play" event that fires before that
 // gets immediately paused again, guaranteeing playback never starts
 // until they ask for it.
 let allowAutoplay=false;
 v.addEventListener("play",()=>{if(!allowAutoplay){v.pause();return}window.DVaultPreview?.setPlaybackActive?.(true)});
 v.addEventListener("pause",()=>{window.DVaultPreview?.setPlaybackActive?.(false)});
 const fileName=String(vinfo.title||"").toLowerCase();
 const isTs=/\.(ts|mts|m2ts)$/.test(fileName);
 const tsStatus=$("#tsStatus");
 let tsPrepared=false,tsPreparing=false,tsObjectUrl=null,ffmpeg=null;
 // Generic fallback for files whose extension looks fine (e.g. .mp4) but
 // whose actual video/audio codec the browser can't decode natively (HEVC,
 // AC-3/E-AC-3/DTS audio, etc). Unlike the .TS path above this isn't known
 // up front - it only kicks in once the <video> element itself reports
 // error code 3/4, so it's driven from diagnose()/showBox() below instead
 // of being decided at load time.
 let codecFallbackUrl=null,codecFallbackTrying=false,codecFallbackFailed=false;
 if(isTs && tsStatus){
   tsStatus.hidden=false;
   tsStatus.textContent="This .TS video will be prepared for browser playback when you press Play.";
 }
 // If this exact video already needed converting on this device before,
 // skip straight to the cached, known-playable copy - no re-detection,
 // no re-conversion, no error flash first. This is what makes repeat
 // opens of a previously-broken file start instantly.
 let usedCachedFix=false;
 if(!isTs){
   const cachedBlob=await cachedFixP; // started at the top of main(), usually already done
   if(cachedBlob){
     codecFallbackUrl=URL.createObjectURL(cachedBlob);
     v.src=codecFallbackUrl;
     usedCachedFix=true;
   }
 }
 if(!isTs && !usedCachedFix) v.src=stream;
 // ---- Stream health: no more silent black screen ----
 // While the main video is starting, hold back background thumbnail /
 // orientation captures (they pull video bytes through the same local storage
 // connection and can starve the real player). If the stream then fails or
 // never starts, find out WHY (HTTP status / server message / codec) and show
 // it with a Retry button, auto-retrying transient Drive errors first.
 if(!isTs){
   window.__dpHoldBackground=true;
   const releaseBg=()=>{window.__dpHoldBackground=false};
   v.addEventListener("loadedmetadata",releaseBg,{once:true});
   setTimeout(releaseBg,20000);
   let tries=0,metaOk=false,diagnosing=false,box=null;
   v.addEventListener("loadedmetadata",()=>{metaOk=true;if(box){box.remove();box=null}});
   const showBox=(text,extraBtn)=>{
     if(!box){
       box=document.createElement("div");
       box.style.cssText="position:absolute;left:12px;right:12px;top:50%;transform:translateY(-50%);z-index:30;background:rgba(20,20,20,.94);color:#f1f1f1;border-radius:12px;padding:14px 16px;font-size:14px;line-height:1.4;text-align:center";
       player.appendChild(box);
     }
     box.innerHTML="";
     const p=document.createElement("div");p.textContent=text;p.style.marginBottom="10px";box.appendChild(p);
     const row=document.createElement("div");row.style.cssText="display:flex;gap:8px;justify-content:center;flex-wrap:wrap";
     // Optional extra action (e.g. "Fix & Play") shown to the left of Retry.
     if(extraBtn){
       const fixBtn=document.createElement("button");fixBtn.type="button";fixBtn.textContent=extraBtn.label;
       fixBtn.style.cssText="background:transparent;color:#f1f1f1;border:1px solid rgba(255,255,255,.55);border-radius:18px;padding:8px 16px;font-weight:600;cursor:pointer";
       fixBtn.onclick=e=>{e.stopPropagation();extraBtn.onClick()};
       row.appendChild(fixBtn);
     }
     const retry=document.createElement("button");retry.type="button";retry.textContent="Retry";
     retry.style.cssText="background:#fff;color:#111;border:0;border-radius:18px;padding:8px 20px;font-weight:600;cursor:pointer";
     retry.onclick=e=>{e.stopPropagation();tries=0;box.remove();box=null;v.src=stream;v.load()};
     row.appendChild(retry);
     box.appendChild(row);
     box.addEventListener("click",e=>e.stopPropagation());
     box.addEventListener("touchstart",e=>e.stopPropagation(),{passive:true});
   };
   const diagnose=async(why)=>{
     if(metaOk||diagnosing)return;
     diagnosing=true;
     const mediaErr=v.error?v.error.code:0;
     let status=0,msg="";
     try{
       const r=await fetch(stream,{headers:{Range:"bytes=0-1"},credentials:"include",cache:"no-store"});
       status=r.status;
       if(!r.ok){const j=await r.json().catch(()=>null);msg=(j&&j.error)||r.statusText||""}
       else if(r.body)r.body.cancel().catch(()=>{});
     }catch(e){msg=(e&&e.message)||"Network error"}
     diagnosing=false;
     if(metaOk)return;
     console.error("D Vault stream problem:",{why,mediaErr,status,msg});
     const transient=status===0||status===429||status>=500;
     if(transient&&tries<2){
       tries++;
       setTimeout(()=>{if(!metaOk){v.src=stream;v.load()}},tries*2500);
       return;
     }
     if(status===401)return showBox("Your session expired. Please return to Storage settings.");
     if(status>=400)return showBox("Couldn't load this video ("+status+")"+(msg?": "+msg:"."));
     if(mediaErr===4||mediaErr===3){
       const codecMsg="This browser can't play this file's video format ("+(mediaErr===4?"not supported":"decode error")+").";
       if(codecFallbackFailed)return showBox(codecMsg+" Use Download and play it in another player.");
       return showBox(codecMsg+" You can try converting it in-browser, or download it and use another player.",{
         label:codecFallbackTrying?"Converting…":"Fix & Play",
         onClick:()=>{if(!codecFallbackTrying)runCodecFallback()}
       });
     }
     return showBox(why==="timeout"?"The video is taking too long to start.":"The video couldn't be played (error "+mediaErr+").");
   };
   // Runs once the native player has already told us (via mediaErr 3/4)
   // that it can't decode this file - re-encodes it client-side to
   // H.264/AAC mp4 with the same FFmpeg.wasm instance the .TS path uses
   // (ensureFfmpeg is declared further down but is already assigned by
   // the time this can actually be invoked, since it's only ever called
   // from a user tapping the "Fix & Play" button after the script has
   // finished running top to bottom).
   // Tests whether a blob URL actually plays, using a detached <video> so
   // it never touches the real player element or its listeners/diagnose
   // wiring while the test is running.
   const testPlayable=url=>new Promise(resolve=>{
     const t=document.createElement("video");
     t.preload="metadata";t.muted=true;
     let done=false;
     const finish=ok=>{if(done)return;done=true;clearTimeout(to);t.removeAttribute("src");t.load();resolve(ok)};
     const to=setTimeout(()=>finish(false),5000);
     t.addEventListener("loadedmetadata",()=>finish(true),{once:true});
     t.addEventListener("error",()=>finish(false),{once:true});
     t.src=url;
   });
   var runCodecFallback=async()=>{
     if(codecFallbackTrying)return;
     codecFallbackTrying=true;
     showBox("Fixing this video for playback…",{label:"Converting…",onClick:()=>{}});
     try{
       await ensureFfmpeg();
       const response=await fetch(stream,{credentials:"same-origin"});
       if(!response.ok)throw Error("Unable to download the video for conversion.");
       const input=await response.arrayBuffer();
       const inName="input"+((/\.[a-z0-9]{2,4}$/i.exec(fileName)||[".mp4"])[0]);
       ffmpeg.FS("writeFile",inName,new Uint8Array(input));

       // Fast path first: a plain remux (no re-encode) only takes a
       // couple of seconds and fixes container/moov-atom problems, which
       // covers a good share of "won't play" files. It does NOT fix a
       // genuinely unsupported codec (e.g. HEVC), so verify it actually
       // plays before trusting it - if not, fall through to a real
       // re-encode below instead of handing back a still-broken file.
       let finalBlob=null;
       try{
         await ffmpeg.run("-i",inName,"-c","copy","-movflags","faststart","remux.mp4");
         const remuxed=ffmpeg.FS("readFile","remux.mp4");
         const remuxBlob=new Blob([remuxed.buffer],{type:"video/mp4"});
         const remuxUrl=URL.createObjectURL(remuxBlob);
         if(await testPlayable(remuxUrl)){finalBlob=remuxBlob}
         else{URL.revokeObjectURL(remuxUrl)}
         try{ffmpeg.FS("unlink","remux.mp4")}catch(_){}
       }catch(_){}

       if(!finalBlob){
         ffmpeg.setProgress(({ratio})=>{
           const pct=Math.max(0,Math.min(100,Math.round((ratio||0)*100)));
           if(box)showBox("Converting this video for playback… "+pct+"%",{label:"Converting…",onClick:()=>{}});
         });
         await ffmpeg.run("-i",inName,"-c:v","libx264","-preset","ultrafast","-crf","23","-c:a","aac","-b:a","128k","-movflags","faststart","output.mp4");
         const out=ffmpeg.FS("readFile","output.mp4");
         finalBlob=new Blob([out.buffer],{type:"video/mp4"});
         try{ffmpeg.FS("unlink","output.mp4")}catch(_){}
       }
       try{ffmpeg.FS("unlink",inName)}catch(_){}

       codecFallbackUrl=URL.createObjectURL(finalBlob);
       metaOk=false;
       if(box){box.remove();box=null}
       v.src=codecFallbackUrl;
       v.load();
       // If even this won't play, don't loop - fall through to the plain
       // download message next time diagnose() runs.
       v.addEventListener("error",()=>{codecFallbackFailed=true},{once:true});
       v.play().catch(()=>{});
       // Cache it so the next time this same video is opened on this
       // device, it starts instantly from here instead of converting again.
       putCachedFix(String(id),finalBlob).catch(()=>{});
     }catch(err){
       codecFallbackFailed=true;
       showBox("Couldn't convert this video: "+(err.message||"unknown error")+". Use Download and play it in another player.");
     }finally{
       codecFallbackTrying=false;
     }
   };
   v.addEventListener("error",()=>diagnose("error"));
   setTimeout(()=>{if(!metaOk&&!v.error)diagnose("timeout")},12000);
 }
 setWatchTitle(vinfo.title);
 $("#title").classList.remove("skel-text");
 // Hand vinfo (size/createdTime/title) off to the meta-row script below,
 // which already listens for the video's own loadedmetadata event to show
 // duration — this lets it also show file type, size, and upload date
 // without a second network request.
 window.__vinfo=vinfo;
 document.dispatchEvent(new CustomEvent("dp:vinfo",{detail:vinfo}));
 v.poster=vinfo.thumbnail||("/api/videos/"+encodeURIComponent(id)+"/thumbnail");
 // Drive doesn't reliably hand back a usable generated thumbnail, so if the
 // poster 404s, grab one from the video itself and swap it in once ready.
 (function(){
   const testImg=new Image();
   testImg.onerror=()=>{
     if(window.autoThumbnail)window.autoThumbnail(id).then(url=>{if(url)v.poster=url});
   };
   testImg.src=v.poster;
 })();
 const likeBtn=$("#like");
 const setLikeState=liked=>{likeBtn.classList.toggle("is-liked",!!liked);likeBtn.querySelector(".like-label").textContent=liked?"Liked":"Like"};
 setLikeState(vinfo.liked);
 // "Save to Watch Later" and "Add to favorites" are two separate lists,
 // each with its own state and endpoint.
 const watchLaterBtn=$("#fav"),favStarBtn=$("#favStar");
 const setWatchLaterState=on=>{
   watchLaterBtn.classList.toggle("is-saved",!!on);
   watchLaterBtn.querySelector(".fav-label").textContent=on?"Saved to Watch Later":"Save to Watch Later";
 };
 const setFavState=on=>{
   if(!favStarBtn)return;
   favStarBtn.classList.toggle("is-saved",!!on);
   favStarBtn.querySelector(".fav-star-label").textContent=on?"Remove from favorites":"Add to favorites";
 };
 setWatchLaterState(vinfo.watchLater);
 setFavState(vinfo.favorite);

 // Player loading spinner: shown until the stream has real playable data.
 const playerLoading=$("#playerLoading");
 const hidePlayerLoading=()=>playerLoading&&playerLoading.classList.add("hidden");
 // Entering/leaving fullscreen makes the browser resize and recomposite the
 // <video> surface, which briefly fires a "waiting" event on most browsers
 // even though playback is fine and about to resume on its own. Covering
 // the whole player with the opaque loading overlay for that split second
 // is what reads as the screen "blanking out" - so ignore waiting events
 // for a short grace window around a fullscreen change, and nudge playback
 // to resume in case the transition itself paused it.
 let fsTransitioning=false,fsGraceTimer=null,wasPlayingBeforeFs=false;
 const armFsGrace=()=>{
   fsTransitioning=true;
   clearTimeout(fsGraceTimer);
   fsGraceTimer=setTimeout(()=>{fsTransitioning=false},800);
 };
 document.addEventListener("fullscreenchange",()=>{
   armFsGrace();
   hidePlayerLoading();
   if(wasPlayingBeforeFs&&v.paused&&!v.ended)v.play().catch(()=>{});
 });
 if(playerLoading){
   ["loadeddata","canplay","playing"].forEach(ev=>v.addEventListener(ev,hidePlayerLoading));
   v.addEventListener("error",hidePlayerLoading);
   v.addEventListener("waiting",()=>{if(!fsTransitioning)playerLoading.classList.remove("hidden")});
   v.addEventListener("canplay",hidePlayerLoading);
 }

 const playBtn=$("#playBtn"),center=$("#centerPlay"),centerFlash=$("#centerFlash");
 // Whether the big center play/pause icon should be visible: never while
 // actually playing, and — while paused — only when the rest of the
 // controls are currently shown, so a tap that hides the control bar
 // hides this icon right along with it (and a second tap brings both back).
 //
 // Exception: pressing the small play/pause button in the control bar
 // should only flip that button's own icon, not pop the big center
 // circle in too — suppressCenterPop mutes one round of that visibility
 // update right after such a click.
 let suppressCenterPop=false,suppressCenterPopTimer=null;
 const armCenterPopSuppression=()=>{
   suppressCenterPop=true;
   clearTimeout(suppressCenterPopTimer);
   suppressCenterPopTimer=setTimeout(()=>{suppressCenterPop=false},400);
 };
 const updateCenterVisibility=()=>{
   const wantVisible=(v.paused||v.ended)&&!window.DVReverse?.isRunning(v)&&!controls.classList.contains("auto-hidden");
   if(wantVisible&&suppressCenterPop){center.classList.add("hidden");return}
   center.classList.toggle("hidden",!wantVisible);
 };
 const ui=()=>{
   const playing=(!v.paused&&!v.ended)||!!window.DVReverse?.isRunning(v);
   playBtn.innerHTML=playing?PAUSE_SVG_SM:PLAY_SVG_SM;
   playBtn.setAttribute("aria-label",playing?"Pause":"Play");
   showControls();
   updateCenterVisibility();
 };
 // Brief center play/pause flash, similar to the on-screen icon YouTube shows
 // when you click/tap the middle of the video or press Space/K.
 const flashCenter=svg=>{
   if(!centerFlash)return;
   centerFlash.innerHTML=svg;
   centerFlash.classList.remove("pulse");
   void centerFlash.offsetWidth;
   centerFlash.classList.add("pulse");
 };
 const togglePlayWithFlash=()=>{
   flashCenter(((v.paused||v.ended)&&!window.DVReverse?.isRunning(v))?PLAY_SVG:PAUSE_SVG);
   play();
 };
 // Shared FFmpeg.wasm loader, reused by the .TS conversion flow, the
 // quality menu's in-browser resolution transcoding, and the codec
 // fallback above. Memoizes the in-flight *promise* (not just the loaded
 // instance) so that calling this from two places at nearly the same time
 // - e.g. the background warm-up below racing a user tapping "Fix & Play"
 // - waits on the same single load instead of a second caller getting
 // back a not-yet-loaded instance and immediately erroring on it.
 let ffmpegLoading=null;
 const ensureFfmpeg=async()=>{
   if(ffmpeg)return ffmpeg;
   if(!ffmpegLoading){
     ffmpegLoading=(async()=>{
       // ffmpeg.min.js is loaded with `async` (see watch.html) so a slow or
       // blocked CDN can never hold up the whole watch page - which means
       // it may still be arriving if this runs very soon after page load.
       // Wait for it (bounded) instead of erroring on a not-yet-set global.
       if(!window.FFmpeg){
         await new Promise(resolve=>{
           const s=document.querySelector('script[src*="ffmpeg.min.js"]');
           if(!s||window.FFmpeg)return resolve();
           s.addEventListener("load",resolve,{once:true});
           s.addEventListener("error",resolve,{once:true});
           setTimeout(resolve,12000);
         });
       }
       if(!window.FFmpeg)throw Error("The browser video converter could not be loaded.");
       const apiFF=window.FFmpeg;
       const inst=apiFF.createFFmpeg({
         log:false,
         corePath:"https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.11.6/dist/ffmpeg-core.js"
       });
       await inst.load();
       ffmpeg=inst;
       return inst;
     })().catch(err=>{ffmpegLoading=null;throw err});
   }
   return ffmpegLoading;
 };
 // Quietly start loading the converter in the background once the page
 // has settled, so if this video (or the next one) turns out to need the
 // codec fallback, the slow one-time download has already happened
 // instead of blocking on the error box. Cheap to call even if it's
 // never needed - the browser/service-worker cache means this is a
 // no-op on every visit after the very first.
 const warmFfmpeg=()=>{ensureFfmpeg().catch(()=>{})};
 if("requestIdleCallback" in window)requestIdleCallback(warmFfmpeg,{timeout:15000});
 else setTimeout(warmFfmpeg,4000);
 const prepareTs=async()=>{
   if(!isTs||tsPrepared)return true;
   if(tsPreparing)return false;
   tsPreparing=true;
   if(tsStatus){tsStatus.hidden=false;tsStatus.textContent="Preparing .TS video for playback…";tsStatus.classList.add("working")}
   try{
     await ensureFfmpeg();
     ffmpeg.setProgress(({ratio})=>{
       if(tsStatus){
         const pct=Math.max(0,Math.min(100,Math.round((ratio||0)*100)));
         tsStatus.textContent=`Preparing .TS video… ${pct}%`;
       }
     });
     const response=await fetch(stream,{credentials:"same-origin"});
     if(!response.ok)throw Error("Unable to download the .TS video for conversion.");
     const input=await response.arrayBuffer();
     ffmpeg.FS("writeFile","input.ts",new Uint8Array(input));
     try{
       await ffmpeg.run("-i","input.ts","-c","copy","-movflags","faststart","output.mp4");
     }catch(_){
       await ffmpeg.run("-i","input.ts","-c:v","libx264","-preset","ultrafast","-crf","23","-c:a","aac","-b:a","128k","-movflags","faststart","output.mp4");
     }
     const out=ffmpeg.FS("readFile","output.mp4");
     tsObjectUrl=URL.createObjectURL(new Blob([out.buffer],{type:"video/mp4"}));
     v.src=tsObjectUrl;
     if(pv){pv.src=tsObjectUrl;try{pv.load()}catch(_){}}
     if(pv2){pv2.src=tsObjectUrl;try{pv2.load()}catch(_){}}
     previewCache.clear();
     tsPrepared=true;
     if(tsStatus){tsStatus.textContent="Ready";setTimeout(()=>tsStatus.hidden=true,900)}
     return true;
   }catch(err){
     if(tsStatus){tsStatus.hidden=false;tsStatus.classList.remove("working");tsStatus.textContent="Could not prepare this .TS video: "+(err.message||"unknown error")}
     return false;
   }finally{tsPreparing=false}
 };
 const play=async()=>{
   allowAutoplay=true;
   if(window.DVReverse?.isActive(v)){DVReverse.toggle(v);ui();return}
   if(!v.paused){v.pause();return}
   if(isTs && !tsPrepared){
     const ok=await prepareTs();
     if(!ok)return;
   }
   v.play().catch(()=>{});
 };
 playBtn.onclick=e=>{e.stopPropagation();armCenterPopSuppression();play()};
 center.onclick=e=>{e.stopPropagation();togglePlayWithFlash()};
 ["play","pause","ended"].forEach(e=>v.addEventListener(e,ui));

 // Auto-hide controls.
 // On phones/tablets, tapping the video toggles the controls instead of
 // creating a permanent touch layer over the picture.
 let hideTimer=null;
 // True while the timeline is being dragged (finger/mouse held down), so the
 // control bar never auto-hides mid-drag, even if you stop at one point.
 let scrubHold=false;
 const screenshotBtn=$("#screenshotBtn");
 // Saves a captured video-frame Blob to the person's device.
 //
 // Android/Chrome and desktop browsers save an <a download> click straight
 // to the Downloads (or Pictures) folder with no dialog at all, so those
 // platforms use the anchor approach directly — quiet, no share sheet.
 //
 // Only iOS Safari is the exception: it silently ignores a script-triggered
 // click on an <a download> link (only a directly-tapped download is
 // honored), so a plain anchor there can fail with no error and no file.
 // The Web Share API's file-share ("Save Image"/"Save to Photos") is the
 // one thing that reliably saves a script-generated file on iOS, so iOS
 // alone falls back to it when available.
 const isIOS=/iP(hone|ad|od)/.test(navigator.userAgent)||(navigator.platform==="MacIntel"&&navigator.maxTouchPoints>1);
 function downloadBlob(blob,filename){
   const url=URL.createObjectURL(blob);
   const a=document.createElement("a");
   a.href=url;
   a.download=filename;
   document.body.appendChild(a);
   a.click();
   a.remove();
   setTimeout(()=>URL.revokeObjectURL(url),4000);
 }
 // canvas.toDataURL() is synchronous (unlike canvas.toBlob(), whose callback
 // fires on a later task, well after the click event that triggered it has
 // finished) - a Blob is still what saveCapturedFrame/downloadBlob/share()
 // all expect, so this decodes the dataURL's base64 payload back into one,
 // synchronously, with no fetch()/Promise involved either.
 function dataUrlToBlob(dataUrl){
   const [header,base64]=dataUrl.split(",");
   const mime=(header.match(/:(.*?);/)||[])[1]||"image/jpeg";
   const binary=atob(base64);
   const bytes=new Uint8Array(binary.length);
   for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
   return new Blob([bytes],{type:mime});
 }
 async function saveCapturedFrame(blob,filename){
   if(!isIOS){
     downloadBlob(blob,filename);
     return "saved";
   }
   try{
     const file=new File([blob],filename,{type:"image/jpeg"});
     if(navigator.canShare&&navigator.canShare({files:[file]})){
       await navigator.share({files:[file]});
       return "saved";
     }
   }catch(err){
     if(err&&err.name==="AbortError")return "cancelled";
   }
   downloadBlob(blob,filename);
   return "saved";
 }
 // True while the mouse is resting on the seek bar (hover preview showing):
 // the controls must stay up for as long as you keep pointing there.
 let seekHover=false;
 // Laptop/desktop (mouse + hover): controls auto-hide after 10s when paused, 5s when playing.
 const isDesktopPointer=()=>{try{return matchMedia('(hover:hover) and (pointer:fine)').matches}catch(_){return false}};
 const hideControls=()=>{
   // Don't collapse the control bar while the More panel or the quality
   // submenu is open — both live inside #controls, so hiding it here was
   // silently yanking an already-open menu off-screen a couple seconds
   // after it appeared, which looked like the button did nothing at all.
   if($("#moreMenu")?.classList.contains("show")||$("#qualityMenu")?.classList.contains("show"))return;
   if(scrubHold||seekHover)return;
   controls.classList.add("auto-hidden");
   updateCenterVisibility();
   hideTimer=null;
 };
 const showControls=()=>{
   controls.classList.remove("auto-hidden");
   // The screenshot button always stays visible and clickable, playing or
   // paused, hidden or shown — it never gets the auto-hidden class, unlike
   // the rest of the control bar.
   updateCenterVisibility();
   clearTimeout(hideTimer);
   // Paused gets a shorter fuse (1.5s) than playing (2s): while
   // playing, the bar staying up for a while is harmless since the video
   // is still moving underneath it; while paused, the frame is static, so
   // leaving the bar/center-play button up for a bit longer after the
   // last tap just sits there covering the paused frame for no reason.
   if(scrubHold)return;
   hideTimer=setTimeout(hideControls,isDesktopPointer()?((v.paused||v.ended)?10000:5000):((v.paused||v.ended)?1500:2000));
 };
 // Tapping the video toggles the controls (and the screenshot button,
 // which now always shows/hides together with them, except that the
 // screenshot button stays put while paused — see hideControls above)
 // whether the video is playing or paused — a tap while paused hides
 // the rest of the bar just as it would while playing, and tapping
 // again brings them back.
 //
 // On touch devices, a tap that *reveals* the hidden controls is
 // immediately followed by the browser's own synthetic "click" event
 // at the same coordinates. If a control (e.g. the screenshot button)
 // happens to sit right under that point, it had been invisible and
 // un-clickable up to this exact instant, but showControls() just made
 // it visible and clickable a moment before that synthetic click fires
 // — so the same tap that was only meant to reveal the UI ends up
 // "pressing" whatever button just appeared underneath it. suppressGhostClick
 // flags that one follow-up click so it gets swallowed instead of acted on.
 let suppressGhostClick=false,suppressGhostClickTimer=null;
 const armGhostClickGuard=()=>{
   suppressGhostClick=true;
   clearTimeout(suppressGhostClickTimer);
   suppressGhostClickTimer=setTimeout(()=>{suppressGhostClick=false},400);
 };
 player.addEventListener("click",e=>{
   if(!suppressGhostClick)return;
   suppressGhostClick=false;
   clearTimeout(suppressGhostClickTimer);
   e.preventDefault();
   e.stopPropagation();
   e.stopImmediatePropagation();
 },true);
 const toggleControls=()=>{
   if(controls.classList.contains("auto-hidden")){
     armGhostClickGuard();
     showControls();
   }else{
     clearTimeout(hideTimer);
     hideControls();
   }
 };
 const restartHide=()=>showControls();
 v.addEventListener("pause",()=>{if(isDesktopPointer())showControls()});
 v.addEventListener("ended",()=>{if(isDesktopPointer())showControls()});

 player.addEventListener("pointermove",e=>{
   if(e.target.closest(".controls")) restartHide();
   else if(e.pointerType==="mouse") restartHide();
 },{passive:true});
 player.addEventListener("pointerdown",e=>{
   if(e.target.closest(".controls")) return;
   if(e.pointerType==="mouse") return;
   // Do not preventDefault: this keeps native video gestures and seeking usable.
 },{passive:true});
 player.addEventListener("mouseenter",restartHide);
 player.addEventListener("mouseleave",()=>{
   if(!v.paused&&!v.ended) hideTimer=setTimeout(hideControls,700);
 });
 controls.addEventListener("pointermove",e=>{
   e.stopPropagation();
   restartHide();
 },{passive:true});
 controls.addEventListener("pointerdown",e=>e.stopPropagation());
 showControls();

 // Timeline and thumbnail preview.
 const timeline=$("#timeline"),seekArea=$("#seekArea"),played=$("#played"),buffered=$("#buffered"),scrubber=$("#scrubber"),preview=$("#preview"),canvas=$("#previewCanvas"),ctx=canvas.getContext("2d"),ptime=$("#previewTime");
 let pv=null,busy=false,wanted=0,dragging=false,wasPlayingBeforeDrag=false;
 let spriteMeta=null,spriteImg=null,spriteLoading=null,spriteFailedAt=0;
 const loadSprite=async()=>{
   if(spriteMeta&&spriteImg)return true;
   // A failed fetch used to be retried on every single pointermove during a
   // drag (each one calls drawSpriteAt -> loadSprite again), so on a video
   // with no generated preview yet the box would pop open and then get
   // yanked shut roughly every frame - looking exactly like "it hides while
   // I'm sliding". Back off for a few seconds after a failure instead of
   // hammering the endpoint again on the very next move.
   if(spriteFailedAt&&Date.now()-spriteFailedAt<15000)return false;
   if(spriteLoading)return spriteLoading;
   spriteLoading=(async()=>{
     try{
       const mr=await api('/api/previews/'+encodeURIComponent(id)+'/metadata');
       const im=new Image(); im.decoding="async"; const asset=window.DVaultPreview&&await DVaultPreview.asset(id,"sprite"); if(asset?.blob)im.src=URL.createObjectURL(asset.blob); else im.src="/api/previews/"+encodeURIComponent(id)+"/sprite";
       await new Promise((resolve,reject)=>{im.onload=resolve;im.onerror=reject});
       spriteMeta=mr;spriteImg=im;return true;
     }catch(_){spriteFailedAt=Date.now();return false}finally{spriteLoading=null}
   })(); return spriteLoading;
 };
 const drawNativeAt=async(t,seq)=>{
   try{
     const src=window.DVaultMedia?await DVaultMedia.url(id):null;if(!src)return false;
     if(!window.__dvPreviewVideo){window.__dvPreviewVideo=document.createElement("video");window.__dvPreviewVideo.muted=true;window.__dvPreviewVideo.playsInline=true;window.__dvPreviewVideo.preload="metadata"}
     const pv=window.__dvPreviewVideo;if(pv.src!==src){pv.src=src;await new Promise((res,rej)=>{pv.onloadedmetadata=res;pv.onerror=rej})}
     pv.currentTime=Math.max(0,Math.min(t,(pv.duration||t)-.05));await new Promise(res=>{pv.onseeked=res;setTimeout(res,1200)});
     if(seq!==undefined&&seq!==spritePreviewSeq)return false;
     const c=document.getElementById("previewCanvas"),cx=c.getContext("2d");if(!pv.videoWidth)return false;
     const sc=Math.min(192/pv.videoWidth,108/pv.videoHeight);c.width=192;c.height=108;cx.clearRect(0,0,192,108);cx.drawImage(pv,0,0,192,108);return true;
   }catch{return false}
 };
 const drawSpriteAt=async(t,seq)=>{
   if(!await loadSprite()||!spriteMeta||!spriteImg)return drawNativeAt(t,seq);
   // A newer preview frame was requested while this one was still loading -
   // drop it instead of painting a stale/out-of-order frame over the canvas.
   if(seq!==undefined&&seq!==spritePreviewSeq)return false;
   const interval=Number(spriteMeta.intervalSeconds)||4,idx=Math.max(0,Math.min((Number(spriteMeta.frameCount)||1)-1,Math.floor(t/interval)));
   const fw=Number(spriteMeta.frameWidth)||160,fh=Number(spriteMeta.frameHeight)||90,cols=Number(spriteMeta.columns)||20;
   const sx=(idx%cols)*fw,sy=Math.floor(idx/cols)*fh;
   try{ctx.clearRect(0,0,192,108);ctx.drawImage(spriteImg,sx,sy,fw,fh,0,0,192,108);return true}catch(_){return false}
 };
 const fracFromX=x=>{const r=timeline.getBoundingClientRect();return Math.max(0,Math.min(1,(x-r.left)/r.width))};
 const setUI=f=>{const pct=(f*100)+'%';played.style.width=pct;scrubber.style.left=pct;timeline.setAttribute('aria-valuenow',String(Math.round(f*(v.duration||0))))};
 const SNAP=.5;
 // Sprite preview replaces the old hidden-video seek/prefetch system. The
 // browser downloads one small WebP instead of repeatedly seeking Drive.
 const schedulePrefetch=()=>{};
 if(v.duration){} else v.addEventListener('loadedmetadata',()=>{}, {once:true});
 let previewOpen=false,spritePreviewSeq=0;
 const showPrev=x=>{
   if(!v.duration)return;
   previewOpen=true;const f=fracFromX(x),rawT=f*v.duration,pr=player.getBoundingClientRect();
   preview.style.left=Math.max(100,Math.min(pr.width-100,x-pr.left))+'px';preview.classList.add('show');ptime.textContent=fmt(rawT);
   // Load/draw the matching thumbnail frame, but a slow or missing sprite no
   // longer closes the preview box mid-drag - it just leaves the last frame
   // (or a blank canvas) in place while the timestamp keeps updating. Only
   // pointerup/leave/cancel (below) actually close the box now.
   const seq=++spritePreviewSeq;drawSpriteAt(rawT,seq);
 };
 const hidePrev=()=>{previewOpen=false;spritePreviewSeq++;preview.classList.remove('show')};
 let pendingSeekT=null;
 // scrubTo used to set v.currentTime directly on every single pointermove
 // while dragging - so just passing the cursor/finger back over an earlier
 // (already-watched) part of the timeline on the way to somewhere else made
 // the browser actually re-fetch/re-buffer that earlier "back" part, even
 // though you never meant to land there. Now it only updates the visual
 // played-bar position and the sprite preview, and remembers where you're
 // currently pointing at (pendingSeekT); the real seek - the only thing that
 // triggers a real network fetch - happens once, in endDrag, for wherever
 // you actually release. That means only the part you land on (typically
 // the next upcoming part you're aiming for) ever gets downloaded.
 const scrubTo=x=>{if(!v.duration)return;const f=fracFromX(x),t=Math.round((f*v.duration)/SNAP)*SNAP;setUI(f);pendingSeekT=t};
 let pendingX=null,rafId=null;
 const flushPointerMove=()=>{rafId=null;if(pendingX===null)return;const x=pendingX;pendingX=null;showPrev(x);if(dragging)scrubTo(x)};
 const queuePointerMove=x=>{pendingX=x;if(rafId===null)rafId=requestAnimationFrame(flushPointerMove)};
 const beginDrag=x=>{if(!v.duration)return;dragging=true;scrubHold=true;pendingSeekT=null;wasPlayingBeforeDrag=!v.paused&&!v.ended;if(wasPlayingBeforeDrag)v.pause();timeline.classList.add('dragging');scrubTo(x);showPrev(x);showControls();clearTimeout(hideTimer)};
 // commit=true (a real pointerup - you deliberately let go here) actually
 // seeks, once, to the last position you were pointing at. commit=false (the
 // gesture got interrupted - cancelled, tab hidden, window blurred) drops
 // the pending position instead of seeking there, since that was never a
 // deliberate release.
 const endDrag=(commit=true)=>{if(!dragging)return;dragging=false;scrubHold=false;if(rafId!==null){cancelAnimationFrame(rafId);rafId=null}pendingX=null;timeline.classList.remove('dragging');if(commit&&pendingSeekT!==null)v.currentTime=pendingSeekT;pendingSeekT=null;if(wasPlayingBeforeDrag)v.play().catch(()=>{});restartHide()};
 seekArea.addEventListener('pointermove',e=>{if(!dragging&&e.pointerType!=='mouse')return;if(e.pointerType==='mouse'&&!seekHover){seekHover=true;showControls()}queuePointerMove(e.clientX)});
 seekArea.addEventListener('pointerenter',e=>{if(e.pointerType==='mouse'){seekHover=true;showControls()}});
 seekArea.addEventListener('pointerleave',()=>{seekHover=false;if(!dragging){hidePrev();showControls()}});
 seekArea.addEventListener('pointerdown',e=>{e.preventDefault();e.stopPropagation();try{seekArea.setPointerCapture(e.pointerId)}catch(_){}beginDrag(e.clientX)});
 seekArea.addEventListener('pointerup',e=>{try{seekArea.releasePointerCapture(e.pointerId)}catch(_){}endDrag(true);hidePrev();setTimeout(hidePrev,60)});
 seekArea.addEventListener('pointercancel',()=>{endDrag(false);hidePrev();setTimeout(hidePrev,60)});
 window.addEventListener('pointerup',e=>{if(e.pointerType!=='mouse'&&!dragging)hidePrev()},true);
 window.addEventListener('pointercancel',()=>{endDrag(false);hidePrev()},true);
 document.addEventListener('visibilitychange',()=>{if(document.hidden){endDrag(false);hidePrev()}});
 window.addEventListener('blur',()=>{endDrag(false);hidePrev()});
 timeline.setAttribute('tabindex','0');timeline.setAttribute('role','slider');timeline.setAttribute('aria-label','Seek');timeline.setAttribute('aria-valuemin','0');
 timeline.addEventListener('keydown',e=>{if(!v.duration)return;let t=null;if(e.key==='ArrowLeft')t=Math.max(0,v.currentTime-5);else if(e.key==='ArrowRight')t=Math.min(v.duration,v.currentTime+5);else if(e.key==='Home')t=0;else if(e.key==='End')t=v.duration;if(t===null)return;e.preventDefault();v.currentTime=t;setUI(t/v.duration)});
 v.addEventListener("timeupdate",()=>{
   if(!v.duration)return;
   if(!dragging)setUI(v.currentTime/v.duration);
   $("#time").textContent=fmt(v.currentTime)+" / "+fmt(v.duration);
 });
 v.addEventListener("progress",()=>{
   if(!v.duration||!v.buffered.length)return;
   try{buffered.style.width=Math.min(100,v.buffered.end(v.buffered.length-1)/v.duration*100)+"%"}catch(_){}
 });
 v.addEventListener("loadedmetadata",()=>{
   $("#time").textContent=fmt(v.currentTime)+" / "+fmt(v.duration);
   timeline.setAttribute("aria-valuemax",String(Math.round(v.duration)));
   showControls();
 });

 // Volume. Custom div-based slider (same pointer-driven pattern as the
 // seek bar above) instead of a native <input type=range> — some mobile
 // browsers/WebViews don't fully honor -webkit-appearance:none on range
 // inputs and paint their own native thumb/glow on top of it, so a hand-built
 // track+fill+thumb is the only way to guarantee it looks the same everywhere.
 const volArea=$("#volumeArea"),volTrack=$("#volumeTrack"),volFill=$("#volumeFill"),volThumb=$("#volumeThumb"),mute=$("#muteBtn");
 const volui=()=>{
   const pct=(v.volume*100)+"%";
   volFill.style.width=pct;volThumb.style.left=pct;
   volTrack.setAttribute("aria-valuenow",String(Math.round(v.volume*100)));
   const isMuted=v.muted||v.volume===0;
   mute.classList.toggle("is-muted",isMuted);
   mute.setAttribute("aria-label",isMuted?"Unmute":"Mute");
 };
 const volFromX=x=>{const r=volTrack.getBoundingClientRect();return r.width?Math.max(0,Math.min(1,(x-r.left)/r.width)):0};
 const setVolume=x=>{v.muted=false;v.volume=volFromX(x);volui()};
 let volDragging=false;
 const volBeginDrag=x=>{volDragging=true;volTrack.classList.add("dragging");setVolume(x);showControls()};
 const volEndDrag=()=>{if(!volDragging)return;volDragging=false;volTrack.classList.remove("dragging")};
 volArea.addEventListener("pointerdown",e=>{e.preventDefault();e.stopPropagation();try{volArea.setPointerCapture(e.pointerId)}catch(_){}volBeginDrag(e.clientX)});
 volArea.addEventListener("pointermove",e=>{if(!volDragging)return;setVolume(e.clientX);showControls()});
 volArea.addEventListener("pointerup",e=>{try{volArea.releasePointerCapture(e.pointerId)}catch(_){}volEndDrag()});
 volArea.addEventListener("pointercancel",volEndDrag);
 window.addEventListener("pointerup",e=>{if(e.pointerType!=="mouse")volEndDrag()},true);
 window.addEventListener("pointercancel",volEndDrag,true);
 volTrack.setAttribute("tabindex","0");volTrack.setAttribute("role","slider");volTrack.setAttribute("aria-label","Volume");
 volTrack.setAttribute("aria-valuemin","0");volTrack.setAttribute("aria-valuemax","100");
 volTrack.addEventListener("keydown",e=>{
   let d=null;
   if(e.key==="ArrowLeft")d=-.05;else if(e.key==="ArrowRight")d=.05;else if(e.key==="Home")d=-1;else if(e.key==="End")d=1;
   if(d===null)return;
   e.preventDefault();v.muted=false;v.volume=e.key==="Home"?0:e.key==="End"?1:Math.max(0,Math.min(1,v.volume+d));volui();
 });
 mute.onclick=e=>{e.stopPropagation();v.muted=!v.muted;volui();showControls()};

 // Seek helper, used by keyboard shortcuts (arrows, J/L).
 const skip=(seconds)=>{
   if(!Number.isFinite(v.duration))return;
   v.currentTime=Math.max(0,Math.min(v.duration,v.currentTime+seconds));
   show(`${seconds>0?"+":"−"}${Math.abs(seconds)} seconds`);
   showControls();
 };

 // Quality menu: Auto/Original play the source stream directly and instantly.
 // 240p–1080p are produced on demand with FFmpeg.wasm right in the browser
 // (there's no server-side transcoding pipeline here) and cached per-session
 // so switching back to a resolution you already prepared is instant.
 const qb=$("#qualityBtn"),qm=$("#qualityMenu"),qualityStatus=$("#qualityStatus");
 const QUALITY_LABELS={auto:"Auto",original:"Original","1080":"1080p","720":"720p","480":"480p","360":"360p","240":"240p"};
 let currentQuality="original",qualityBusy=false,sourceFsName=null,sourceFsFrom=null;
 const qualityCache={};
 qb.onclick=e=>{e.stopPropagation();qm.classList.toggle("show");moreMenu.classList.remove("show");showControls()};

 const updateQualityMenuActive=()=>{
   qm.querySelectorAll("button[data-quality]").forEach(b=>b.classList.toggle("active",b.dataset.quality===currentQuality));
 };
 const ensureQualitySource=async()=>{
   if(isTs&&!tsPrepared){
     const ok=await prepareTs();
     if(!ok)throw Error("Video isn't ready yet.");
   }
   return (isTs&&tsObjectUrl)?tsObjectUrl:stream;
 };
 // Writes the full source video into FFmpeg's virtual filesystem once, reusing
 // it for every resolution the viewer picks so it's only downloaded once.
 const ensureSourceInFs=async()=>{
   const from=await ensureQualitySource();
   await ensureFfmpeg();
   if(sourceFsName&&sourceFsFrom===from)return sourceFsName;
   const resp=await fetch(from,{credentials:"same-origin"});
   if(!resp.ok)throw Error("Unable to load the video source.");
   const buf=await resp.arrayBuffer();
   const name="qsource"+Date.now()+(/\.ts(\?|$)/i.test(from)?".ts":".mp4");
   if(sourceFsName){try{ffmpeg.FS("unlink",sourceFsName)}catch(_){}}
   ffmpeg.FS("writeFile",name,new Uint8Array(buf));
   sourceFsName=name;sourceFsFrom=from;
   return name;
 };
 // Swap the <video> source while preserving playback position/state.
 const applyQualitySource=async(url,resumeTime,wasPlaying)=>{
   v.src=url;
   await new Promise(res=>{
     const onMeta=()=>{v.removeEventListener("loadedmetadata",onMeta);res()};
     v.addEventListener("loadedmetadata",onMeta);
   });
   if(resumeTime)try{v.currentTime=resumeTime}catch(_){}
   if(wasPlaying)v.play().catch(()=>{});
 };
 async function setQuality(q){
   if(qualityBusy||q===currentQuality){qm.classList.remove("show");return}
   const label=QUALITY_LABELS[q]||q;
   const resumeTime=v.currentTime,wasPlaying=!v.paused&&!v.ended;
   qualityBusy=true;
   qm.classList.remove("show");
   try{
     if(q==="auto"||q==="original"){
       const src=await ensureQualitySource();
       currentQuality=q;
       qb.textContent=label;
       updateQualityMenuActive();
       await applyQualitySource(src,resumeTime,wasPlaying);
       show(label);
     }else{
       let url=qualityCache[q];
       if(!url){
         if(qualityStatus){qualityStatus.hidden=false;qualityStatus.classList.add("working");qualityStatus.textContent=`Preparing ${label}…`}
         const srcName=await ensureSourceInFs();
         ffmpeg.setProgress(({ratio})=>{
           if(qualityStatus){
             const pct=Math.max(0,Math.min(100,Math.round((ratio||0)*100)));
             qualityStatus.textContent=`Preparing ${label}… ${pct}%`;
           }
         });
         const outName=`out_${q}_${Date.now()}.mp4`;
         await ffmpeg.run("-i",srcName,"-vf",`scale=-2:${q}`,"-c:v","libx264","-preset","ultrafast","-crf","23","-c:a","aac","-b:a","128k","-movflags","faststart",outName);
         const out=ffmpeg.FS("readFile",outName);
         url=URL.createObjectURL(new Blob([out.buffer],{type:"video/mp4"}));
         qualityCache[q]=url;
       }
       currentQuality=q;
       qb.textContent=label;
       updateQualityMenuActive();
       await applyQualitySource(url,resumeTime,wasPlaying);
       if(pv){pv.src=url;try{pv.load()}catch(_){}}
       if(qualityStatus){qualityStatus.classList.remove("working");qualityStatus.textContent=`Playing ${label}`;setTimeout(()=>qualityStatus.hidden=true,1200)}
     }
   }catch(err){
     if(qualityStatus){qualityStatus.hidden=false;qualityStatus.classList.remove("working");qualityStatus.textContent="Could not prepare "+label+": "+(err.message||"unknown error");setTimeout(()=>qualityStatus.hidden=true,2500)}
     else show("Couldn't switch quality");
   }finally{
     qualityBusy=false;
     showControls();
   }
 }
 qm.querySelectorAll("button[data-quality]").forEach(b=>b.onclick=e=>{
   e.stopPropagation();
   setQuality(b.dataset.quality);
 });

 // Change thumbnail.
 const thumbInput=$("#watchThumbnailInput");
 const prepareThumbnail=async file=>{
   if(!file.type.startsWith("image/"))throw Error("Please choose an image file.");
   const url=URL.createObjectURL(file);
   try{
     const img=await new Promise((resolve,reject)=>{
       const i=new Image();
       i.onload=()=>resolve(i);
       i.onerror=()=>reject(Error("The selected image could not be read."));
       i.src=url;
     });
     const max=1600,scale=Math.min(1,max/Math.max(img.naturalWidth,img.naturalHeight));
     const w=Math.max(1,Math.round(img.naturalWidth*scale)),h=Math.max(1,Math.round(img.naturalHeight*scale));
     const canvas=document.createElement("canvas");canvas.width=w;canvas.height=h;
     canvas.getContext("2d").drawImage(img,0,0,w,h);
     const blob=await new Promise(resolve=>canvas.toBlob(resolve,"image/jpeg",.88));
     if(!blob)throw Error("Could not prepare the thumbnail.");
     return blob;
   }finally{URL.revokeObjectURL(url)}
 };
 $("#changeThumbnailBtn").onclick=e=>{e.stopPropagation();thumbInput.dataset.videoId=id;thumbInput.value="";thumbInput.click();show("Choose a thumbnail")};
 thumbInput.onchange=async()=>{
   const file=thumbInput.files?.[0];if(!file)return;
   const targetId=thumbInput.dataset.videoId||id;
   try{
     const blob=await prepareThumbnail(file);
     if(blob.size>1900000)throw Error("Thumbnail is too large. Please choose a smaller image.");
     const r=await fetch("/api/videos/"+encodeURIComponent(targetId)+"/thumbnail",{
       method:"POST",headers:{"Content-Type":"image/jpeg"},body:blob
     });
     const j=await r.json().catch(()=>({}));
     if(!r.ok)throw Error(j.error||"Thumbnail upload failed.");
     // Refresh recommendation/home thumbnail cache after a successful change.
     document.querySelectorAll(".rec-thumb img").forEach(img=>{
       const base=img.src.split("?")[0];img.src=base+"?t="+Date.now();
     });
     show("Thumbnail changed");
   }catch(err){show(err.message||"Thumbnail upload failed.");}
 };

 // Save to playlist — same modal/API pattern as the home page grid's ⋮ menu,
 // reusing the shared #modal markup already in watch.html.
 async function showPlaylistModal(videoId){
   $("#modalTitle").textContent="Save to playlist";
   $("#modalText").textContent="";
   const actions=$("#modalActions");
   actions.innerHTML="<div class='side-small'>Loading playlists…</div>";
   $("#modal").classList.add("show");
   let items;
   try{
     items=await api("/api/playlists?videoId="+encodeURIComponent(videoId));
   }catch(e){
     actions.innerHTML="<div class='side-small'>Could not load playlists.</div>";
     return;
   }
   renderPlaylistModal(videoId,items);
 }
 function renderPlaylistModal(videoId,items){
   const actions=$("#modalActions");
   actions.innerHTML="";
   const list=document.createElement("div");
   list.className="pl-modal-list";
   if(!items.length){
     const empty=document.createElement("div");
     empty.className="side-small";
     empty.textContent="No playlists yet — create one below.";
     list.appendChild(empty);
   }
   items.forEach(pl=>{
     const row=document.createElement("label");
     row.className="pl-modal-item";
     const cb=document.createElement("input");
     cb.type="checkbox";
     cb.checked=!!pl.inPlaylist;
     cb.onchange=async()=>{
       cb.disabled=true;
       const wasChecked=cb.checked;
       try{
         if(wasChecked)await api("/api/playlists/"+encodeURIComponent(pl.id)+"/videos",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({videoId})});
         else await api("/api/playlists/"+encodeURIComponent(pl.id)+"/videos/"+encodeURIComponent(videoId),{method:"DELETE"});
         show(wasChecked?"Added to "+pl.name:"Removed from "+pl.name);
       }catch(err){
         cb.checked=!wasChecked;
         show(err.message||"Could not update playlist");
       }
       cb.disabled=false;
     };
     const span=document.createElement("span");
     span.textContent=pl.name+" · "+pl.count+" video"+(pl.count===1?"":"s");
     row.appendChild(cb);row.appendChild(span);
     list.appendChild(row);
   });
   actions.appendChild(list);
   const form=document.createElement("form");
   form.className="pl-modal-create";
   const input=document.createElement("input");
   input.type="text";input.placeholder="New playlist name";input.maxLength=200;
   const btn=document.createElement("button");
   btn.type="submit";btn.textContent="Create";
   form.appendChild(input);form.appendChild(btn);
   form.onsubmit=async e=>{
     e.preventDefault();
     const name=input.value.trim();
     if(!name)return;
     btn.disabled=true;input.disabled=true;
     try{
       const created=await api("/api/playlists",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({name})});
       await api("/api/playlists/"+encodeURIComponent(created.id)+"/videos",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({videoId})});
       show('Created "'+name+'" and added the video');
       const items2=await api("/api/playlists?videoId="+encodeURIComponent(videoId));
       renderPlaylistModal(videoId,items2);
     }catch(err){
       show(err.message||"Could not create playlist");
       btn.disabled=false;input.disabled=false;
     }
   };
   actions.appendChild(form);
 }
 const playlistBtn=$("#playlistBtn");
 if(playlistBtn)playlistBtn.onclick=e=>{e.stopPropagation();showPlaylistModal(id)};


 // off-screen canvas and downloads it as a compressed JPEG. Works entirely
 // in the browser (no server round trip): the video element is same-origin
 // (served from /api/videos/.../stream on this site), so the canvas
 // isn't tainted and toDataURL is allowed.
 if(screenshotBtn)screenshotBtn.onclick=async e=>{
  e.stopPropagation();
  showControls();
  try{
    if(!v.videoWidth||!v.videoHeight)throw Error("Video isn't ready yet.");
    const c=document.createElement("canvas");
    c.width=v.videoWidth;c.height=v.videoHeight;
    c.getContext("2d").drawImage(v,0,0,c.width,c.height);
    // toDataURL, not toBlob: toBlob's callback runs on a later task, by
    // which point the click that started all this is no longer "live" as
    // far as the browser's user-activation tracking is concerned, so the
    // download this eventually triggers can get silently dropped (some
    // browsers, Brave among them, do exactly this with no visible error -
    // saveCapturedFrame still reports "saved" because nothing actually
    // threw). toDataURL runs synchronously, right here in the click
    // handler, so there's no gap for that activation to expire in.
    const dataUrl=c.toDataURL("image/jpeg",0.85);
    const blob=dataUrlToBlob(dataUrl);
    const base=(vinfo.title||"video").replace(/[\\/:*?"<>|]/g,"").trim()||"video";
    const stamp=fmt(v.currentTime).replace(/:/g,"-");
    try{
      const result=await saveCapturedFrame(blob,`${base} - ${stamp}.jpg`);
      if(result==="saved"){
        screenshotBtn.classList.remove("flash");
        void screenshotBtn.offsetWidth;
        screenshotBtn.classList.add("flash");
        show("Screenshot saved");
      }
    }catch{
      show("Couldn't capture that frame.");
    }
  }catch(err){
    if(err&&err.name==="SecurityError")show("Can't capture this video's frames (blocked by its source).");
    else show(err.message||"Couldn't capture that frame.");
  }
};

 // Download — single click, always original quality. A tiny ranged probe
 // request first means a Drive/server error shows up as a message instead of
 // silently downloading a few-byte broken file that looks like the video
 // but isn't (the <a download> approach can't otherwise tell an error
 // response from a real one).
 $("#downloadBtn").onclick=async e=>{
   e.stopPropagation();
   const btn=$("#downloadBtn");
   const original=btn.textContent;
   btn.disabled=true;btn.textContent="Checking…";
   try{
     const probe=await fetch(stream,{headers:{Range:"bytes=0-1"},credentials:"include"});
     if(!probe.ok){
       const j=await probe.json().catch(()=>({}));
       throw Error(j.error||"Download failed.");
     }
     probe.body?.cancel().catch(()=>{});
     const a=document.createElement("a");a.href=stream+"?download=1";a.download=vinfo.title||"video";
     document.body.appendChild(a);a.click();a.remove();
     show("Downloading original quality");
   }catch(err){
     show(err.message||"Download failed. Try again in a moment.");
   }finally{
     btn.disabled=false;btn.textContent=original;
   }
 };

 // Download offline — like the download button above, but instead of
 // handing the file to the OS/system file manager, it streams the video
 // into this app's own IndexedDB storage so it can be watched later from
 // the in-app Downloads page, even offline. Completely separate from
 // downloadBtn above; that button is untouched.
 const downloadInAppBtn=$("#downloadInAppBtn");
 const cancelDownloadBtn=$("#cancelDownloadInAppBtn");
 // Update just the label span's text, never the button's own textContent —
 // downloadInAppBtn/cancelDownloadBtn each have an icon <span> plus this
 // label <span> inside them (that's what keeps the icon+text layout in the
 // More menu). Setting .textContent on the button itself wipes out both
 // spans and replaces them with a single plain text node, so the icon
 // vanishes and the row falls back to default (icon-less, right-aligned)
 // flex layout — which is exactly what used to happen to "Download offline"
 // after starting, and especially after cancelling, a download.
 const downloadInAppLabel=downloadInAppBtn?.querySelector(".more-menu-label");
 const cancelDownloadLabel=cancelDownloadBtn?.querySelector(".more-menu-label");
 let downloadHandle=null;

 if(downloadInAppBtn && downloadInAppLabel && window.AppDownloads){
   const setDownloadingUi=downloading=>{
     downloadInAppBtn.hidden=downloading;
     if(cancelDownloadBtn)cancelDownloadBtn.hidden=!downloading;
   };

   downloadInAppBtn.onclick=async e=>{
     e.stopPropagation();
     if(downloadInAppBtn.disabled||downloadHandle)return;
     const original=downloadInAppLabel.textContent;
     setDownloadingUi(true);
     downloadInAppBtn.disabled=true;
     downloadInAppLabel.textContent="Starting…";
     downloadHandle=AppDownloads.startDownload({
       id,title:vinfo.title||"video",streamUrl:stream,posterUrl:v.poster,
       onProgress:({received,total,background})=>{
         // downloadInAppBtn is hidden for the whole download (setDownloadingUi
         // above swaps it out for cancelDownloadBtn), so the progress text has
         // to be written there for it to actually be visible - writing it onto
         // the hidden button meant the percentage/MB count never appeared on
         // screen even though it was being computed correctly the whole time.
         const pct=total?`${Math.min(99,Math.round(received/total*100))}%`:`${(received/1048576).toFixed(1)}MB`;
         downloadInAppLabel.textContent=`Saving… ${pct}`;
         // Background Fetch keeps this download running even if the app is
         // closed; the foreground fallback doesn't, so say which one this
         // is instead of leaving it ambiguous whether it's safe to leave.
         const tag=background?" (background — safe to close the app)":" (keep the app open)";
         if(cancelDownloadLabel)cancelDownloadLabel.textContent=`✕ Cancel — ${pct}${tag}`;
       }
     });
     try{
       await downloadHandle.promise;
       downloadInAppLabel.textContent="Saved ✓";
       show("Saved in app storage");
       setTimeout(()=>{downloadInAppLabel.textContent=original},1800);
     }catch(err){
       if(err?.name==="AbortError"){
         downloadInAppLabel.textContent=original;
         show("Download canceled");
       }else{
         show(err.message||"Couldn't save this video in the app.");
         downloadInAppLabel.textContent=original;
       }
     }finally{
       downloadInAppBtn.disabled=false;
       downloadHandle=null;
       setDownloadingUi(false);
       if(cancelDownloadLabel)cancelDownloadLabel.textContent="✕ Cancel download"; // reset for next time, since onProgress overwrote it with a percentage
     }
   };

   if(cancelDownloadBtn){
     cancelDownloadBtn.onclick=e=>{
       e.stopPropagation();
       if(downloadHandle)downloadHandle.cancel();
     };
   }
 }

 // Likes/favorites. Flip the UI immediately (optimistic update) instead of
 // waiting for the network round-trip, then reconcile with — or roll back
 // to match — whatever the server actually returns.
 $("#like").onclick=async e=>{
   e.stopPropagation();
   const wasLiked=likeBtn.classList.contains("is-liked");
   setLikeState(!wasLiked);
   try{
     setLikeState((await api(`/api/videos/${encodeURIComponent(id)}/like`,{method:"POST"})).active);
   }catch(err){
     setLikeState(wasLiked);
     show(err.message||"Couldn't update like.");
   }
 };
 // Toggle helper shared by the two buttons: flips the UI immediately, then
 // reconciles with (or rolls back to match) what the server returns.
 const wireSavedToggle=(btn,setState,action,failMsg)=>{
   if(!btn)return;
   btn.onclick=async e=>{
     e.stopPropagation();
     const was=btn.classList.contains("is-saved");
     setState(!was);
     try{
       setState((await api(`/api/videos/${encodeURIComponent(id)}/${action}`,{method:"POST"})).active);
     }catch(err){
       setState(was);
       show(err.message||failMsg);
     }
   };
 };
 wireSavedToggle(watchLaterBtn,setWatchLaterState,"watchlater","Couldn't update Watch Later.");
 wireSavedToggle(favStarBtn,setFavState,"favorite","Couldn't update favorites.");

 // Rename — actually renames the file in local storage, same file this
 // video streams from, so the new name sticks everywhere it's shown.
 const renameBtn=$("#renameBtn");
 if(renameBtn)renameBtn.onclick=async e=>{
   e.stopPropagation();
   const name=(prompt("Rename video:",vinfo.title||"")||"").trim();
   if(!name||name===vinfo.title)return;
   try{
     renameBtn.disabled=true;
     await api(`/api/videos/${encodeURIComponent(id)}/rename`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({name})});
     vinfo.title=name;
     setWatchTitle(name);
     show("Video renamed");
   }catch(err){
     show(err.message||"Could not rename video.");
   }finally{
     renameBtn.disabled=false;
   }
 };

 // Delete — moves the file to Trash in local storage and sends the
 // viewer back to their previous page (falling back to home).
 const deleteBtn=$("#deleteBtn");
 if(deleteBtn)deleteBtn.onclick=async e=>{
   e.stopPropagation();
   if(!confirm(`Delete "${vinfo.title||"this video"}"? It will be deleted from the selected storage folder.`))return;
   try{
     deleteBtn.disabled=true;deleteBtn.textContent="Deleting…";
     await api(`/api/videos/${encodeURIComponent(id)}/delete`,{method:"DELETE"});
     if(document.referrer && new URL(document.referrer).origin===location.origin)history.back();
     else location.href="/";
   }catch(err){
     deleteBtn.disabled=false;deleteBtn.innerHTML="<img src=\"/icons/delete-icon.png\" alt=\"\" class=\"action-icon icon-plain\"> Delete";
     show(err.message||"Could not delete video.");
   }
 };

 // Fullscreen.
 $("#fullscreenBtn").onclick=async e=>{
   e.stopPropagation();
   wasPlayingBeforeFs=!v.paused&&!v.ended;
   armFsGrace();
   try{document.fullscreenElement?await document.exitFullscreen():await player.requestFullscreen()}
   catch(_){try{await v.webkitEnterFullscreen()}catch(__){}}
 };
 // Picture-in-picture (also reachable from the ⋮ more menu and the "I" shortcut).
 const togglePip=async()=>{
   try{document.pictureInPictureElement?await document.exitPictureInPicture():await v.requestPictureInPicture()}catch(_){}
 };

 // Touch and mouse interaction.
 // A tap on the picture toggles the control bar. Pressing and holding the
 // right side — finger on touch, or a held-down click on desktop — temporarily
 // plays at 2x, like the YouTube gesture, and restores the previous speed on
 // release. Fullscreen is only triggered by the fullscreen button.
 let longPressTimer=null,longPressActive=false,longPressPointerId=null;
 let savedRate=1;

 // Pinch-to-zoom while watching in landscape — mirrors YouTube's mobile
 // gesture: pinching outward crops the video to fill the frame, pinching
 // inward restores the letterboxed fit. Only two simultaneous touch points
 // count as a pinch, so it never fights the single-finger tap / long-press /
 // skip gestures below.
 const activeTouches=new Map();
 let pinchBaseDist=null,pinchGestureActive=false,pinchStartScale=1;
 const isLandscape=()=>matchMedia("(orientation: landscape)").matches;
 const touchDist=()=>{
   const pts=[...activeTouches.values()];
   return Math.hypot(pts[0].x-pts[1].x,pts[0].y-pts[1].y);
 };
 const touchMid=()=>{
   const pts=[...activeTouches.values()];
   return {x:(pts[0].x+pts[1].x)/2,y:(pts[0].y+pts[1].y)/2};
 };

 // Continuous zoom-in, YouTube-style: pinching outward magnifies the video
 // beyond the frame (not just a crop-to-fill toggle) and a single finger can
 // then drag around the enlarged image. Zoom resets on rotate or Fit/Fill.
 const MIN_ZOOM=1,MAX_ZOOM=4;
 let zoomScale=1,panX=0,panY=0;
 let dragPointerId=null,dragStartX=0,dragStartY=0,dragOriginPanX=0,dragOriginPanY=0,dragMoved=false;
 const clamp=(n,lo,hi)=>Math.max(lo,Math.min(hi,n));
 const clampPan=()=>{
   const rect=player.getBoundingClientRect();
   const maxX=(rect.width*(zoomScale-1))/2,maxY=(rect.height*(zoomScale-1))/2;
   panX=clamp(panX,-maxX,maxX);
   panY=clamp(panY,-maxY,maxY);
 };
 const applyTransform=()=>{
   v.style.transform=zoomScale===1?"":`translate(${panX}px,${panY}px) scale(${zoomScale})`;
 };
 const resetZoom=()=>{
   if(zoomScale===1 && panX===0 && panY===0)return;
   v.classList.remove("zoom-live");
   zoomScale=1;panX=0;panY=0;
   applyTransform();
 };

 // Anything that is itself a real control (the bottom bar, or a standalone
 // button/link floating over the video like the screenshot button) must be
 // excluded from the player's tap/long-press/double-tap-skip gesture zone.
 // Previously only ".controls" and "#centerPlay" were excluded, so a tap on
 // the screenshot button (which sits outside .controls, pinned in the
 // right-side 38% "long-press to 2x" / "double-tap to skip" zone) also got
 // interpreted as part of that gesture - a slightly slow tap could kick off
 // 2x speed, two quick screenshot taps could register as a double-tap skip,
 // and every tap toggled the control bar as a side effect. Matches the
 // equivalent check already used in offline-player.js.
 const isInsideControls=e=>!!e.target.closest(".controls, button, a");
 const clearLongPress=()=>{
   if(longPressTimer){clearTimeout(longPressTimer);longPressTimer=null}
 };
 const endLongPress=()=>{
   clearLongPress();
   if(!longPressActive)return;
   longPressActive=false;
   if(longPressPointerId!==null){
     try{player.releasePointerCapture(longPressPointerId)}catch(_){}
   }
   longPressPointerId=null;
   v.playbackRate=savedRate;
   speedBadge.classList.remove("show");
   showControls();
 };

 // Native vertical page scrolling is enabled on the player with touch-action: pan-y.
 // Keep touch gestures here focused on playback controls (double-tap/pinch/long-press).

 player.addEventListener("pointerdown",e=>{
   if(isInsideControls(e) || e.target.closest("#centerPlay"))return;

   if(e.pointerType==="touch"){
     activeTouches.set(e.pointerId,{x:e.clientX,y:e.clientY});
     if(activeTouches.size===2 && isLandscape()){
       // A second finger just landed — this is a pinch, not a tap, long
       // press, or skip. Cancel whatever the first finger started.
       pinchGestureActive=true;
       clearLongPress();
       if(longPressActive)endLongPress();
       resetTap();
       dragPointerId=null;dragMoved=false;
       pinchBaseDist=touchDist();
       pinchStartScale=zoomScale;
       v.classList.add("zoom-live");
       return;
     }
     if(activeTouches.size>1)return;

     // A single finger down while already zoomed in starts a potential pan —
     // confirmed once it actually moves, so it doesn't steal plain taps.
     if(zoomScale>1){
       dragPointerId=e.pointerId;
       dragStartX=e.clientX;dragStartY=e.clientY;
       dragOriginPanX=panX;dragOriginPanY=panY;
       dragMoved=false;
     }
   }

   const rect=player.getBoundingClientRect();
   const x=e.clientX-rect.left;
   const inRightZone=x >= rect.width*0.62;

   // On desktop, only the right-side long-press-to-2x gesture applies here;
   // double-click already toggles fullscreen and single click isn't hijacked.
   if(e.pointerType==="mouse" && !inRightZone)return;

   // Only the right 38% of the video activates the long-press gesture.
   if(inRightZone){
     clearLongPress();
     longPressPointerId=e.pointerId;
     longPressTimer=setTimeout(()=>{
       longPressTimer=null;
       if(v.paused || v.ended)return;
       longPressActive=true;
       savedRate=v.playbackRate || 1;
       v.playbackRate=2;
       speedBadge.classList.add("show");
       showControls();
       try{player.setPointerCapture(e.pointerId)}catch(_){}
     },450);
   }
 },{passive:true});

 player.addEventListener("pointermove",e=>{
   if(e.pointerType!=="touch")return;

   if(pinchGestureActive && activeTouches.has(e.pointerId)){
     activeTouches.set(e.pointerId,{x:e.clientX,y:e.clientY});
     if(activeTouches.size!==2 || pinchBaseDist===null || pinchBaseDist===0)return;
     const d=touchDist();
     zoomScale=clamp(pinchStartScale*(d/pinchBaseDist),MIN_ZOOM,MAX_ZOOM);
     if(zoomScale===MIN_ZOOM){panX=0;panY=0}else clampPan();
     applyTransform();
     showControls();
     return;
   }

   if(dragPointerId===e.pointerId && zoomScale>1){
     const dx=e.clientX-dragStartX,dy=e.clientY-dragStartY;
     if(!dragMoved){
       if(Math.hypot(dx,dy)<8)return;
       dragMoved=true;
       clearLongPress();
       if(longPressActive)endLongPress();
       resetTap();
       v.classList.add("zoom-live");
     }
     panX=dragOriginPanX+dx;panY=dragOriginPanY+dy;
     clampPan();
     applyTransform();
   }
 },{passive:true});

 player.addEventListener("pointerup",e=>{
   if(isInsideControls(e) || e.target.closest("#centerPlay"))return;

   if(e.pointerType==="touch"){
     activeTouches.delete(e.pointerId);
     if(activeTouches.size>=1)return; // another finger still down mid-pinch
     if(pinchGestureActive){
       pinchGestureActive=false;pinchBaseDist=null;
       v.classList.remove("zoom-live");
       if(zoomScale<=1.03){zoomScale=1;panX=0;panY=0;applyTransform()}
       else show(Math.round(zoomScale*100)+"% zoom");
       endLongPress();
       return;
     }
     if(dragPointerId===e.pointerId){
       const wasDrag=dragMoved;
       dragPointerId=null;dragMoved=false;
       v.classList.remove("zoom-live");
       if(wasDrag){endLongPress();return}
     }
   }

   const wasLong=longPressActive;
   endLongPress();

   if(e.pointerType==="mouse"){
     // A held-down click on the right zone already did its 2x thing above;
     // a plain click on the rest of the video toggles play/pause, YouTube-style.
     if(wasLong)return;
     const rect=player.getBoundingClientRect();
     const x=e.clientX-rect.left;
     const inRightZone=x >= rect.width*0.62;
     if(!inRightZone) togglePlayWithFlash();
     return;
   }
   if(wasLong)return;

   const rect=player.getBoundingClientRect();
   const x=e.clientX-rect.left;
   if(x<rect.width*0.38){
     if(registerDoubleTapSkip("left"))return;
   }else if(x>=rect.width*0.62){
     if(registerDoubleTapSkip("right"))return;
   }else{
     // Middle zone, single tap: toggle play/pause while the video is
     // actually playing (with the same flash the center button and mouse
     // click give) - matches the mouse-click behavior below. While paused,
     // there's already a dedicated big center Play button for resuming
     // playback, so a plain tap on the rest of the paused picture instead
     // toggles the control bar, same as tapping the left/right thirds does.
     // Previously this always resumed playback instead, so the only way to
     // hide the bar while paused was to hold long enough to dodge the
     // double-tap-seek zones on the edges.
     resetTap();
     if(v.paused||v.ended){toggleControls();}else{togglePlayWithFlash();}
     return;
   }

   toggleControls();
 },{passive:true});

 const cancelTouch=e=>{
   if(e.pointerType==="touch"){
     activeTouches.delete(e.pointerId);
     if(activeTouches.size===0){pinchGestureActive=false;pinchBaseDist=null}
     if(dragPointerId===e.pointerId){dragPointerId=null;dragMoved=false}
   }
   v.classList.remove("zoom-live");
   endLongPress();
 };
 player.addEventListener("pointercancel",cancelTouch,{passive:true});
 player.addEventListener("pointerleave",e=>{
   if(e.pointerType==="touch"){
     activeTouches.delete(e.pointerId);
     if(activeTouches.size===0){pinchGestureActive=false;pinchBaseDist=null}
     if(dragPointerId===e.pointerId){dragPointerId=null;dragMoved=false;v.classList.remove("zoom-live")}
   }
   if(longPressActive)endLongPress();
   else clearLongPress();
 },{passive:true});
 // Rotating out of landscape (or the fit/fill toggle) clears any zoom so the
 // video isn't stuck magnified where the pinch gesture no longer applies.
 matchMedia("(orientation: landscape)").addEventListener("change",()=>{if(!isLandscape())resetZoom()});
 player.addEventListener("contextmenu",e=>{
   if(longPressActive || e.pointerType!=="mouse")e.preventDefault();
 });

 // Two-finger vertical page scrolling on mobile/WebView.
 // Double-tap to seek ±10s, YouTube-style, on the left/right thirds of the
 // video (touch only — desktop already has J/L and the arrow-key shortcuts).
 // A double-tap is two quick releases, while the long-press-for-2x gesture
 // above requires a sustained hold, so the two never collide. Extra taps on
 // the same side within the window keep stacking (10s, then 20s, then 30s…).
 const skipLeftEl=$("#skipLeft"),skipRightEl=$("#skipRight"),skipLeftText=$("#skipLeftText"),skipRightText=$("#skipRightText");
 const DOUBLE_TAP_MS=350;
 let tapSide=null,tapCount=0,tapTotal=0,tapTimer=null;
 const skipSilent=seconds=>{
   if(!Number.isFinite(v.duration))return;
   v.currentTime=Math.max(0,Math.min(v.duration,v.currentTime+seconds));
   showControls();
 };
 const resetTap=()=>{tapSide=null;tapCount=0;tapTotal=0;clearTimeout(tapTimer);tapTimer=null};
 const flashSkip=(el,textEl,secs)=>{
   textEl.textContent=secs+" seconds";
   el.classList.remove("pulse");
   void el.offsetWidth;
   el.classList.add("pulse");
 };
 const registerDoubleTapSkip=side=>{
   if(tapSide===side)tapCount++;
   else{tapSide=side;tapCount=1;tapTotal=0}
   clearTimeout(tapTimer);
   tapTimer=setTimeout(resetTap,DOUBLE_TAP_MS);
   if(tapCount<2)return false;
   tapTotal+=10;
   skipSilent(side==="left"?-10:10);
   flashSkip(side==="left"?skipLeftEl:skipRightEl,side==="left"?skipLeftText:skipRightText,tapTotal);
   return true;
 };

 // Zoom-to-fill / fit.
 const fitBtn=$("#fitBtn");
 let fillMode=false;
 const updateFit=()=>{
   v.style.objectFit=fillMode?"cover":"contain";
   fitBtn.textContent=fillMode?"Fit":"Fill";
   fitBtn.setAttribute("aria-label",fillMode?"Fit video":"Zoom to fill");
 };
 fitBtn.onclick=e=>{
   e.stopPropagation();
   fillMode=!fillMode;
   updateFit();
   resetZoom();
   show(fillMode?"Zoom to fill":"Fit to screen");
   showControls();
 };
 updateFit();

 // Gesture hint no longer blocks clicks.
 const show=t=>{hint.textContent=t;hint.classList.add("show");clearTimeout(show._t);show._t=setTimeout(()=>hint.classList.remove("show"),700)};

 // Keyboard shortcuts help panel.
 const shortcutsPanel=$("#shortcutsPanel"),shortcutsClose=$("#shortcutsClose");
 const toggleShortcuts=open=>{
   const willShow=open===undefined?shortcutsPanel.hidden:open;
   shortcutsPanel.hidden=!willShow;
   if(willShow)showControls();
 };
 shortcutsClose.onclick=e=>{e.stopPropagation();toggleShortcuts(false)};
 shortcutsPanel.addEventListener("pointerdown",e=>{
   e.stopPropagation();
   if(e.target===shortcutsPanel)toggleShortcuts(false);
 });

 // Three-dot "more options" menu: playback speed, keyboard shortcuts, picture-in-picture.
 const moreBtn=$("#moreBtn"),moreMenu=$("#moreMenu"),moreMenuMain=$("#moreMenuMain"),moreMenuSpeed=$("#moreMenuSpeed"),
   moreSpeedBtn=$("#moreSpeedBtn"),moreSpeedValue=$("#moreSpeedValue"),moreSpeedBack=$("#moreSpeedBack"),
   moreShortcutsBtn=$("#moreShortcutsBtn"),morePipBtn=$("#morePipBtn"),
   moreShortBtn=$("#moreShortBtn"),moreShortLabel=$("#moreShortLabel"),moreShortIcon=$("#moreShortIcon");
 const speedLabel=r=>r===1?"Normal":r+"×";
 const sets=r=>{v.playbackRate=r;if(moreSpeedValue)moreSpeedValue.textContent=speedLabel(r);closeMoreMenu();showControls()};
 // Laptop/desktop positioning. .more-menu lives inside .player, which
 // clips its own contents (rounded corners on the video) — so the old
 // fixed right:10px/bottom:55px offset got its top rows sheared off by
 // that overflow:hidden the moment the menu was tall enough, on any
 // pointer-and-hover ("laptop") width. Phones/touch devices are unaffected
 // — they already get the viewport-anchored bottom sheet (see the matching
 // CSS media query), which was fixed the same way for the same reason.
 // The fix here is the same idea applied to the anchored popup instead of
 // a full-width sheet: position:fixed (see CSS) escapes the clipping
 // ancestor entirely, and we compute where that puts it relative to the
 // ⋮ button ourselves, since fixed positioning no longer follows the
 // button's spot in the page's own layout.
 const moreMenuAnchoredQuery=window.matchMedia("(min-width:601px) and (hover:hover) and (pointer:fine)");
 const positionMoreMenu=()=>{
   if(!moreMenu)return;
   moreMenu.style.top="";
   moreMenu.style.left="";
   if(!moreMenuAnchoredQuery.matches||!moreBtn)return;
   const br=moreBtn.getBoundingClientRect(),mr=moreMenu.getBoundingClientRect();
   let left=br.right-mr.width;
   left=Math.max(8,Math.min(left,window.innerWidth-mr.width-8));
   let top=br.top-mr.height-8;
   if(top<8)top=Math.min(br.bottom+8,window.innerHeight-mr.height-8);
   moreMenu.style.left=left+"px";
   moreMenu.style.top=top+"px";
 };
 const openMoreMenu=()=>{
   moreMenu?.classList.add("show");
   qm.classList.remove("show");
   positionMoreMenu();
   showControls();
 };
 const closeMoreMenu=()=>{moreMenu?.classList.remove("show");showControls()};
 if(moreBtn)moreBtn.onclick=e=>{e.stopPropagation();moreMenu?.classList.contains("show")?closeMoreMenu():openMoreMenu()};
 window.addEventListener("resize",()=>{if(moreMenu?.classList.contains("show"))positionMoreMenu()});
 if(moreSpeedBtn)moreSpeedBtn.onclick=e=>{e.stopPropagation();moreMenuMain?.classList.add("hidden");moreMenuSpeed?.classList.remove("hidden");positionMoreMenu()};
 if(moreSpeedBack)moreSpeedBack.onclick=e=>{e.stopPropagation();moreMenuSpeed?.classList.add("hidden");moreMenuMain?.classList.remove("hidden");positionMoreMenu()};
 moreMenuSpeed?.querySelectorAll("button[data-speed]").forEach(b=>b.onclick=e=>{e.stopPropagation();sets(+b.dataset.speed)});
 // Reverse play: plays backwards from the current spot (or from the end if the
 // video is at the very start). Tapping it again, or play/pause, stops it.
 const moreReverseBtn=$("#moreReverseBtn"),moreReverseValue=$("#moreReverseValue");
 const syncReverseUi=()=>{if(moreReverseValue)moreReverseValue.textContent=window.DVReverse?.isActive(v)?"On":"Off";ui()};
 if(moreReverseBtn)moreReverseBtn.onclick=e=>{
   e.stopPropagation();
   if(!window.DVReverse)return;
   if(DVReverse.isActive(v)){DVReverse.stop(v)}
   else{allowAutoplay=true;if(!DVReverse.start(v,syncReverseUi))show("Video is not ready yet")}
   closeMoreMenu();syncReverseUi();
 };
 if(moreShortcutsBtn)moreShortcutsBtn.onclick=e=>{e.stopPropagation();closeMoreMenu();toggleShortcuts(true)};
 if(morePipBtn)morePipBtn.onclick=e=>{e.stopPropagation();closeMoreMenu();togglePip()};

 // Mark as Short / Remove from Shorts, mirroring the ⋮ menu on the home
 // page grid (public/app.js) - toggles the same video_shorts override.
 // Guarded with `if(moreShortBtn && moreShortLabel)`: if a deploy ever
 // ships watch.js without the matching watch.html (missing these two
 // elements), the Shorts toggle simply won't appear instead of throwing
 // and taking down the whole watch page.
 // Details: everything already known about this video (plus the live
 // resolution/duration read from the player element).
 const showWatchDetails=()=>{if(window.DPDetails)window.DPDetails.open(vinfo,{video:v})};
 const moreDetailsBtn=$("#moreDetailsBtn");
 if(moreDetailsBtn)moreDetailsBtn.onclick=e=>{e.stopPropagation();closeMoreMenu();showWatchDetails()};
 const detailsBtn=$("#detailsBtn");
 if(detailsBtn)detailsBtn.onclick=e=>{
   e.stopPropagation();
   const am=$("#actionsMoreMenu");if(am)am.classList.remove("open","show");
   showWatchDetails();
 };
 if(moreShortBtn&&moreShortLabel){
   const setShortLabel=()=>{moreShortLabel.textContent=vinfo.isShort?"Remove from Shorts":"Mark as Short";if(moreShortIcon)moreShortIcon.src=vinfo.isShort?"/icons/remove-from-shorts.svg":"/icons/mark-as-shorts.svg"};
   setShortLabel();
   moreShortBtn.onclick=async e=>{
     e.stopPropagation();
     closeMoreMenu();
     if(moreShortBtn.disabled)return;
     moreShortBtn.disabled=true;
     const next=!vinfo.isShort;
     try{
       await api("/api/videos/"+encodeURIComponent(id)+"/short",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({short:next})});
       vinfo.isShort=next;
       setShortLabel();
       show(next?"Marked as Short":"Removed from Shorts");
     }catch(err){
       show(err.message||"Couldn't update Shorts.");
     }finally{
       moreShortBtn.disabled=false;
     }
   };
 }

 // Cast, via the standard Remote Playback API (Chromecast on Chrome/Edge/
 // Android) with a fallback to WebKit's AirPlay picker on Safari/iOS. The
 // button stays hidden wherever neither is supported, and hidden by default
 // until a receiver is actually known to be available.
 const moreCastBtn=$("#moreCastBtn");
 if(moreCastBtn){
   const castLabel=moreCastBtn.querySelector("span");
   const setCastLabel=txt=>{if(castLabel)castLabel.textContent=txt};
   if(typeof v.webkitShowPlaybackTargetPicker==="function"){
     v.addEventListener("webkitplaybacktargetavailabilitychanged",e=>{
       moreCastBtn.hidden=e.availability!=="available";
     });
     v.addEventListener("webkitcurrentplaybacktargetiswirelesschanged",()=>{
       setCastLabel(v.webkitCurrentPlaybackTargetIsWireless?"Casting…":"Cast");
     });
     moreCastBtn.onclick=e=>{
       e.stopPropagation();closeMoreMenu();
       try{v.webkitShowPlaybackTargetPicker()}catch(_){}
     };
   }else if("remote" in v && v.remote && typeof v.remote.watchAvailability==="function"){
     v.remote.watchAvailability(available=>{moreCastBtn.hidden=!available}).catch(()=>{});
     v.remote.addEventListener("connect",()=>setCastLabel("Casting…"));
     v.remote.addEventListener("disconnect",()=>setCastLabel("Cast"));
     moreCastBtn.onclick=async e=>{
       e.stopPropagation();closeMoreMenu();
       try{await v.remote.prompt()}catch(_){}
     };
   }else{
     moreCastBtn.remove();
   }
 }

 // Keyboard shortcuts.
 const speeds=[.5,.75,1,1.25,1.5,1.75,2,2.5,3];
 const nudgeSpeed=dir=>{
   const cur=v.playbackRate;
   let idx=0,best=Infinity;
   speeds.forEach((s,i)=>{const d=Math.abs(s-cur);if(d<best){best=d;idx=i}});
   idx=Math.max(0,Math.min(speeds.length-1,idx+dir));
   sets(speeds[idx]);
   show(speeds[idx]+"×");
 };
 const changeVolume=delta=>{
   v.muted=false;
   v.volume=Math.max(0,Math.min(1,+(v.volume+delta).toFixed(2)));
   volui();
   show(Math.round(v.volume*100)+"%");
   showControls();
 };
 const seekToPercent=f=>{
   if(!Number.isFinite(v.duration))return;
   v.currentTime=v.duration*f;
   showControls();
 };
 const stepFrame=dir=>{
   if(!Number.isFinite(v.duration))return;
   v.currentTime=Math.max(0,Math.min(v.duration,v.currentTime+dir/30));
   showControls();
 };
 const isTypingTarget=el=>{
   if(!el)return false;
   const tag=el.tagName;
   return tag==="INPUT"||tag==="TEXTAREA"||tag==="SELECT"||el.isContentEditable;
 };
 document.addEventListener("keydown",e=>{
   if(e.defaultPrevented||e.ctrlKey||e.metaKey||e.altKey)return;
   const active=document.activeElement;
   if(isTypingTarget(active))return;
   // Let a focused button keep native Space/Enter activation.
   if(active&&active.tagName==="BUTTON"&&(e.key===" "||e.key==="Enter"))return;
   // The timeline has its own Left/Right/Home/End seek handling when focused.
   if(active===timeline&&["ArrowLeft","ArrowRight","Home","End"].includes(e.key))return;

   if(e.key==="Escape"){
     if(!shortcutsPanel.hidden){toggleShortcuts(false)}
     return;
   }
   if(e.key==="?"){e.preventDefault();toggleShortcuts();return}
   if(!shortcutsPanel.hidden)return;

   switch(e.key){
     case " ":case "k":case "K":
       e.preventDefault();togglePlayWithFlash();break;
     case "ArrowLeft":
       e.preventDefault();skip(-5);break;
     case "ArrowRight":
       e.preventDefault();skip(5);break;
     case "j":case "J":
       skip(-10);break;
     case "l":case "L":
       skip(10);break;
     case "ArrowUp":
       e.preventDefault();changeVolume(.05);break;
     case "ArrowDown":
       e.preventDefault();changeVolume(-.05);break;
     case "m":case "M":
       v.muted=!v.muted;volui();show(v.muted?"Muted":"Unmuted");showControls();break;
     case "f":case "F":
       $("#fullscreenBtn").click();break;
     case "i":case "I":
       togglePip();break;
     case ",":
       if(v.paused){v.pause();stepFrame(-1);show("◀ frame")}
       break;
     case ".":
       if(v.paused){v.pause();stepFrame(1);show("frame ▶")}
       break;
     case "<":
       nudgeSpeed(-1);break;
     case ">":
       nudgeSpeed(1);break;
     case "Home":
       e.preventDefault();seekToPercent(0);break;
     case "End":
       e.preventDefault();seekToPercent(1);break;
     default:
       if(e.key>="0"&&e.key<="9"){
         e.preventDefault();
         seekToPercent((+e.key)/10);
       }
   }
 });

 // Close popup menus when clicking elsewhere.
 document.addEventListener("click",e=>{
   if(!moreMenu.contains(e.target)&&e.target!==moreBtn)closeMoreMenu();
   if(!qm.contains(e.target)&&e.target!==qb){
     const wasOpen=qm.classList.contains("show");
     qm.classList.remove("show");
     if(wasOpen)showControls(); // restart the auto-hide countdown now that it's actually closed
   }
 });

 // Recommendations with real Drive-backed thumbnails.
 // Folders are never valid recommendations — filter them out the
 // same way the home page does, defensively, even though /api/videos already
 // targets video files. Shorts are excluded too, same as the home page grid —
 // they only belong in the dedicated Shorts tab, not mixed into regular
 // video recommendations.
 const recList=$("#recommendationList"),recSentinel=$("#recSentinel"),upNextList=$("#upNextList");
 const seenRecIds=new Set([String(id)]); // the video being watched is never listed, and no id is listed twice
 const others=videos.filter(x=>{
   if(String(x.id)===String(id))return false;
   if(String(x.mimeType||"").toLowerCase()==="application/vnd.google-apps.folder")return false;
   if(x.isFolder)return false;
   if(x.isShort)return false;
   if(seenRecIds.has(String(x.id)))return false;
   seenRecIds.add(String(x.id));
   return true;
 });
 function shuffleArr(arr){const a=arr.slice();for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}
 // Shuffle on initial load too, not just on manual/idle refresh - otherwise
 // every video's recommendation panel shows the same underlying list order,
 // just with that video itself filtered out.
 let recOrder=shuffleArr(others);
 function thumbFor(x){return x.thumbnail||("/api/videos/"+encodeURIComponent(x.id)+"/thumbnail")}
 // Recovery for a related/up-next thumbnail that fails to load: first try
 // the direct /thumbnail endpoint (in case x.thumbnail was a stale custom
 // URL), then fall back to generating one client-side from the video frame
 // (autothumb.js, already loaded on this page), and only hide the <img> -
 // instead of leaving the browser's broken-image glyph on screen - if both
 // of those also fail.
 window.handleRecThumbFail=function(img,id){
   const direct="/api/videos/"+encodeURIComponent(id)+"/thumbnail";
   if(!img.dataset.triedDirect&&img.src.indexOf(direct)===-1){
     img.dataset.triedDirect="1";
     img.src=direct;
     return;
   }
   if(img.dataset.autoTried)return;
   img.dataset.autoTried="1";
   if(!window.autoThumbnail){img.style.visibility="hidden";return}
   window.autoThumbnail(id).then(url=>{
     if(url)img.src=url;
     else img.style.visibility="hidden";
   });
 };
 function upNextCardHtml(x){
   return `<div class="up-next-card" data-rec-id="${esc(x.id)}">
       <a class="rec-thumb-link" href="/watch.html?id=${encodeURIComponent(x.id)}">
         <div class="rec-thumb">
           <img src="${esc(thumbFor(x))}" alt="" loading="lazy" onerror="window.handleRecThumbFail&&window.handleRecThumbFail(this,'${esc(x.id)}')">
           <video class="rec-thumb-preview" muted loop playsinline preload="none" data-src="${x.preview?.ready&&x.preview?.hover?esc(x.preview.hover):''}" data-src-rev="${x.preview?.ready&&x.preview?.hoverRev?esc(x.preview.hoverRev):''}"></video>
           ${x.isShort?'<span class="short-badge">Shorts</span>':''}
           <span class="rec-play">▶</span>
         </div>
       </a>
       <div class="up-next-info-row">
         <a class="up-next-info" href="/watch.html?id=${encodeURIComponent(x.id)}">
           <strong>${esc(x.title||"Untitled video")}</strong>
           <small>${x.liked?"💗 ":""}D Vault</small>
           <small class="card-stats">${esc(cardStats(x))}</small>
         </a>
         <button type="button" class="more-btn rec-more-btn" data-rec-menu="${esc(x.id)}" aria-label="More options">⋮</button>
       </div>
       <div class="card-menu" id="rec-menu-${esc(x.id)}">
         <button type="button" data-rec-like="${esc(x.id)}">${x.liked?"👍 Liked":"👍 Like"}</button>
         <button type="button" data-rec-playlist="${esc(x.id)}"><img src="/icons/playlist-icon.png" alt="" class="menu-icon icon-invert"> Save to playlist</button>
         <button type="button" data-rec-thumb="${esc(x.id)}"><img src="/icons/thumbnail-icon.png" alt="" class="menu-icon"> Change thumbnail</button>
         <button type="button" data-rec-rename="${esc(x.id)}">✏️ Rename</button>
         <button type="button" data-rec-savefile="${esc(x.id)}"><img src="/icons/download.png" alt="" class="menu-icon icon-invert"> Download</button>
         <button type="button" data-rec-short="${esc(x.id)}">${x.isShort?'<img src="/icons/remove-from-shorts.svg" alt="" class="menu-icon"> Remove from Shorts':'<img src="/icons/mark-as-shorts.svg" alt="" class="menu-icon"> Mark as Short'}</button>
         <button type="button" data-rec-details="${esc(x.id)}">${window.DPDetails?window.DPDetails.icon:""} Details</button>
         <button type="button" data-rec-delete="${esc(x.id)}" class="delete-btn"><img src="/icons/delete-icon.png" alt="" class="menu-icon"> Delete</button>
       </div>
     </div>`;
 }
 // The first UP_NEXT_COUNT videos in the shuffled order double as the "up
 // next" sidebar queue (same order goToNext() autoplays through), so the
 // grid below starts reading from that index onward and never renders those
 // same cards again. UP_NEXT_COUNT is a baseline on the stacked mobile/tablet
 // layout, but on the desktop two-column layout it's recalculated to however
 // many fixed-size cards fit the player's height, so the sidebar fills all
 // the way down to the bottom of the player instead of leaving empty space.
 // Every card stays the exact same fixed size (same as the related-videos
 // grid below) — only the gap between cards is stretched to soak up
 // whatever's left, so the stack still lands flush on the player's bottom
 // edge with no leftover blank space.
 let UP_NEXT_COUNT=2;
 const UP_NEXT_BASE_GAP=16;
 // A phone with "Request desktop site" turned on reports a wide viewport
 // (matchMedia width checks alone would think it's a real desktop window),
 // but it's still a touch device - pointer/hover media features see through
 // that spoofing, so use them instead of width to detect an actual touch
 // device. On touch, skip the fixed-size "up next" sidebar cards entirely
 // and fold every related video into the one grid below instead.
 function isTouchLayout(){return matchMedia("(pointer:coarse) and (hover:none)").matches}
 // Figure out how many up-next cards fit next to the player, plus the gap
 // needed between them so the whole stack's height matches the player's
 // height exactly. Renders a small probe batch first (so there's a real
 // card in the DOM to measure), then grows to the number that fits.
 function fitUpNext(){
   if(isTouchLayout())return{count:0,gap:UP_NEXT_BASE_GAP};
   if(matchMedia("(max-width:1100px)").matches)return{count:Math.min(2,recOrder.length),gap:UP_NEXT_BASE_GAP};
   const ply=document.getElementById("player");
   const firstCard=upNextList.querySelector(".up-next-card");
   if(!ply||!firstCard)return{count:Math.min(2,recOrder.length),gap:UP_NEXT_BASE_GAP};
   const cardHeight=firstCard.getBoundingClientRect().height;
   if(!cardHeight)return{count:Math.min(2,recOrder.length),gap:UP_NEXT_BASE_GAP};
   const playerHeight=ply.getBoundingClientRect().height;
   const fit=Math.floor((playerHeight+UP_NEXT_BASE_GAP)/(cardHeight+UP_NEXT_BASE_GAP));
   const count=Math.max(1,Math.min(fit,recOrder.length));
   // Distribute whatever's left over after the fixed-size cards across the
   // gaps between them, so the cards themselves never change size but the
   // stack's total height still lands exactly on the player's bottom edge.
   let gap=UP_NEXT_BASE_GAP;
   if(count>1){
     const leftover=playerHeight-(count*cardHeight+(count-1)*UP_NEXT_BASE_GAP);
     gap=UP_NEXT_BASE_GAP+Math.max(0,leftover)/(count-1);
   }
   return{count,gap};
 }
 function renderUpNext(){
   if(!upNextList)return;
   // The divider line sits immediately before #upNextList in the markup
   // (see public/watch.html) - hide it along with the list itself.
   const recDivider=upNextList.previousElementSibling;
   if(!recOrder.length){
     upNextList.style.display="";
     if(recDivider)recDivider.style.display="";
     upNextList.innerHTML="<div class='empty-recommendations'>No other videos found.</div>";
     upNextList.style.gap="";
     UP_NEXT_COUNT=0;
     return;
   }
   if(isTouchLayout()){
     upNextList.innerHTML="";
     upNextList.style.display="none";
     if(recDivider)recDivider.style.display="none";
     UP_NEXT_COUNT=0;
     return;
   }
   upNextList.style.display="";
   if(recDivider)recDivider.style.display="";
   const probeCount=Math.min(2,recOrder.length);
   upNextList.style.gap="";
   upNextList.innerHTML=recOrder.slice(0,probeCount).map(upNextCardHtml).join("");
   const fit=fitUpNext();
   UP_NEXT_COUNT=fit.count;
   const picks=recOrder.slice(0,UP_NEXT_COUNT);
   upNextList.innerHTML=picks.map(upNextCardHtml).join("");
   upNextList.style.gap=fit.gap+"px";
 }
 // Re-fit (and, if the count changed, re-render the whole recommendations
 // area so the grid below still starts past whatever's now in the sidebar)
 // whenever the window is resized - covers maximizing/restoring the window
 // or crossing the breakpoint where the sidebar stacks under the player.
 let upNextResizeTimer=null;
 window.addEventListener("resize",()=>{
   clearTimeout(upNextResizeTimer);
   upNextResizeTimer=setTimeout(()=>{
     if(!upNextList||!recOrder.length)return;
     if(fitUpNext().count!==UP_NEXT_COUNT)renderRecommendations();
     else{
       // Count didn't change, but the player's height may still have moved
       // slightly - re-tune just the gap without a full re-render.
       upNextList.style.gap=fitUpNext().gap+"px";
     }
   },200);
 });
 function recCardHtml(x){
   return `<div class="rec-card" data-rec-id="${esc(x.id)}">
       <a class="rec-thumb-link" href="/watch.html?id=${encodeURIComponent(x.id)}">
         <div class="rec-thumb">
           <img src="${esc(thumbFor(x))}" alt="" loading="lazy" onerror="window.handleRecThumbFail&&window.handleRecThumbFail(this,'${esc(x.id)}')">
           <video class="rec-thumb-preview" muted loop playsinline preload="none" data-src="${x.preview?.ready&&x.preview?.hover?esc(x.preview.hover):''}" data-src-rev="${x.preview?.ready&&x.preview?.hoverRev?esc(x.preview.hoverRev):''}"></video>
           ${x.isShort?'<span class="short-badge">Shorts</span>':''}
           <span class="rec-play">▶</span>
         </div>
       </a>
       <div class="rec-info-row">
         <a class="rec-info" href="/watch.html?id=${encodeURIComponent(x.id)}">
           <strong>${esc(x.title||"Untitled video")}</strong>
           <small>${x.liked?"💗 ":""}D Vault</small>
           <small class="card-stats">${esc(cardStats(x))}</small>
         </a>
         <button type="button" class="more-btn rec-more-btn" data-rec-menu="${esc(x.id)}" aria-label="More options">⋮</button>
       </div>
       <div class="card-menu" id="rec-menu-${esc(x.id)}">
         <button type="button" data-rec-like="${esc(x.id)}">${x.liked?"👍 Liked":"👍 Like"}</button>
         <button type="button" data-rec-playlist="${esc(x.id)}"><img src="/icons/playlist-icon.png" alt="" class="menu-icon icon-invert"> Save to playlist</button>
         <button type="button" data-rec-thumb="${esc(x.id)}"><img src="/icons/thumbnail-icon.png" alt="" class="menu-icon"> Change thumbnail</button>
         <button type="button" data-rec-rename="${esc(x.id)}">✏️ Rename</button>
         <button type="button" data-rec-savefile="${esc(x.id)}"><img src="/icons/download.png" alt="" class="menu-icon icon-invert"> Download</button>
         <button type="button" data-rec-short="${esc(x.id)}">${x.isShort?'<img src="/icons/remove-from-shorts.svg" alt="" class="menu-icon"> Remove from Shorts':'<img src="/icons/mark-as-shorts.svg" alt="" class="menu-icon"> Mark as Short'}</button>
         <button type="button" data-rec-details="${esc(x.id)}">${window.DPDetails?window.DPDetails.icon:""} Details</button>
         <button type="button" data-rec-delete="${esc(x.id)}" class="delete-btn"><img src="/icons/delete-icon.png" alt="" class="menu-icon"> Delete</button>
       </div>
     </div>`;
 }
 const REC_PAGE_SIZE=10,REC_MAX_CARDS=240;
 let recCursor=0;
 function renderRecommendations(){
   renderUpNext();
   // Start the grid past the videos already shown in the up-next sidebar,
   // so the same card never renders twice on the page at once.
   recCursor=Math.min(UP_NEXT_COUNT,recOrder.length);
   if(!recOrder.length){
     recList.innerHTML="<div class='empty-recommendations'>No other videos found.</div>";
     return;
   }
   recList.innerHTML="";
   // Pre-fill enough cards to cover taller (laptop/desktop) viewports up front,
   // instead of relying only on the scroll-triggered sentinel for the first screen.
   const initialFill=Math.min(REC_MAX_CARDS,Math.max(recCursor+REC_PAGE_SIZE*2,recOrder.length));
   while(recCursor<initialFill&&appendRecommendations());
 }
 function appendRecommendations(){
   // Each video is shown at most once on this page: the up-next queue plus
   // this grid walk through the shuffled pool exactly one time. When the
   // last video has been rendered we stop - no wrapping around and no
   // reshuffled second pass that would put the same video on screen again.
   if(recCursor>=recOrder.length)return false;
   const take=Math.min(REC_PAGE_SIZE,recOrder.length-recCursor);
   const batch=recOrder.slice(recCursor,recCursor+take);
   recCursor+=take;
   recList.insertAdjacentHTML("beforeend",batch.map(recCardHtml).join(""));
   window.DPlayerPreview&&window.DPlayerPreview.wire();
   return true;
 }
 renderRecommendations();

 // Recommendation card ⋮ menus — Like, Change thumbnail, Download offline,
 // Mark as Short, Delete. A single delegated listener shared by recList (the
 // grid below) and upNextList (the sidebar queue) — rather than wiring
 // buttons per-card — so newly-appended/reshuffled cards in either list work
 // without re-binding anything, and opening a menu in one list closes any
 // open menu in the other.
 async function onRecMenuClick(e){
   const menuBtn=e.target.closest("[data-rec-menu]");
   if(menuBtn){
     e.preventDefault();e.stopPropagation();
     const menu=$("#rec-menu-"+CSS.escape(menuBtn.dataset.recMenu));
     const wasOpen=menu.classList.contains("open");
     document.querySelectorAll(".card-menu.open").forEach(m=>m.classList.remove("open"));
     if(!wasOpen)menu.classList.add("open");
     return;
   }
   const likeBtn=e.target.closest("[data-rec-like]");
   if(likeBtn){
     e.preventDefault();e.stopPropagation();
     const vid=likeBtn.dataset.recLike;
     const wasLiked=likeBtn.textContent.includes("Liked");
     likeBtn.textContent=wasLiked?"👍 Like":"👍 Liked";
     try{
       const r=await api(`/api/videos/${encodeURIComponent(vid)}/like`,{method:"POST"});
       likeBtn.textContent=r.active?"👍 Liked":"👍 Like";
       const x=others.find(o=>String(o.id)===String(vid));
       if(x)x.liked=r.active;
     }catch(err){
       likeBtn.textContent=wasLiked?"👍 Liked":"👍 Like";
       show(err.message||"Couldn't update like.");
     }
     return;
   }
   const recDetailsBtn=e.target.closest("[data-rec-details]");
   if(recDetailsBtn){
     e.preventDefault();e.stopPropagation();
     document.querySelectorAll(".card-menu.open").forEach(m=>m.classList.remove("open"));
     const vid=recDetailsBtn.dataset.recDetails;
     const x=others.find(o=>String(o.id)===String(vid))||(typeof videos!=="undefined"&&videos.find(o=>String(o.id)===String(vid)))||{id:vid};
     if(window.DPDetails)window.DPDetails.open(x);
     return;
   }
   const thumbBtn=e.target.closest("[data-rec-thumb]");
   if(thumbBtn){
     e.preventDefault();e.stopPropagation();
     thumbInput.dataset.videoId=thumbBtn.dataset.recThumb;
     thumbInput.value="";
     thumbInput.click();
     show("Choose a thumbnail");
     return;
   }
   const recRenameBtn=e.target.closest("[data-rec-rename]");
   if(recRenameBtn){
     e.preventDefault();e.stopPropagation();
     document.querySelectorAll(".card-menu.open").forEach(m=>m.classList.remove("open"));
     const vid=recRenameBtn.dataset.recRename;
     const x=others.find(o=>String(o.id)===String(vid));
     const name=(prompt("Rename video:",x?x.title:"")||"").trim();
     if(!name||name===(x&&x.title))return;
     try{
       await api(`/api/videos/${encodeURIComponent(vid)}/rename`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({name})});
       if(x)x.title=name;
       document.querySelectorAll(`[data-rec-id="${CSS.escape(vid)}"] .rec-info strong, [data-rec-id="${CSS.escape(vid)}"] strong`).forEach(el=>el.textContent=name);
       show("Video renamed");
     }catch(err){show(err.message||"Could not rename video")}
     return;
   }
   const recPlaylistBtn=e.target.closest("[data-rec-playlist]");
   if(recPlaylistBtn){
     e.preventDefault();e.stopPropagation();
     showPlaylistModal(recPlaylistBtn.dataset.recPlaylist);
     return;
   }
   const shortBtn=e.target.closest("[data-rec-short]");
   if(shortBtn){
     e.preventDefault();e.stopPropagation();
     const vid=shortBtn.dataset.recShort;
     const x=others.find(o=>String(o.id)===String(vid));
     try{
       await api(`/api/videos/${encodeURIComponent(vid)}/short`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({short:!(x&&x.isShort)})});
       if(x)x.isShort=!x.isShort;
       shortBtn.innerHTML=x&&x.isShort?'<img src="/icons/remove-from-shorts.svg" alt="" class="menu-icon"> Remove from Shorts':'<img src="/icons/mark-as-shorts.svg" alt="" class="menu-icon"> Mark as Short';
     }catch(err){show(err.message||"Couldn't update Shorts status.")}
     return;
   }
   const deleteBtn=e.target.closest("[data-rec-delete]");
   if(deleteBtn){
     e.preventDefault();e.stopPropagation();
     const vid=deleteBtn.dataset.recDelete;
     const x=others.find(o=>String(o.id)===String(vid));
     if(!confirm('Delete "'+(x?x.title:"this video")+'"? It will be deleted from the selected storage folder.'))return;
     try{
       deleteBtn.disabled=true;
       await api(`/api/videos/${encodeURIComponent(vid)}/delete`,{method:"DELETE"});
       show("Video deleted");
       // Drop it from the recommendation pools so it can't resurface via
       // infinite scroll/reshuffle, and remove its card straight away.
       const idx=others.findIndex(o=>String(o.id)===String(vid));
       if(idx!==-1)others.splice(idx,1);
       const delAt=recOrder.findIndex(o=>String(o.id)===String(vid));
       if(delAt!==-1&&delAt<recCursor)recCursor--;
       recOrder=recOrder.filter(o=>String(o.id)!==String(vid));
       $(`.rec-card[data-rec-id="${CSS.escape(vid)}"]`)?.remove();
       document.querySelectorAll(`.up-next-card[data-rec-id="${CSS.escape(vid)}"]`).forEach(c=>c.remove());
     }catch(err){show(err.message||"Could not delete video");deleteBtn.disabled=false}
     return;
   }
   const downloadBtn=e.target.closest("[data-rec-download]");
   if(downloadBtn){
     e.preventDefault();e.stopPropagation();
     if(downloadBtn.disabled||!window.AppDownloads)return;
     const vid=downloadBtn.dataset.recDownload;
     const x=others.find(o=>String(o.id)===String(vid));
     const original=downloadBtn.textContent;
     downloadBtn.disabled=true;
     downloadBtn.textContent="Starting…";
     const handle=AppDownloads.startDownload({
       id:vid,title:(x&&x.title)||"video",
       streamUrl:"/api/videos/"+encodeURIComponent(vid)+"/stream",
       posterUrl:thumbFor(x||{id:vid}),
       onProgress:({received,total,background})=>{
         const pct=total
           ?`${Math.min(99,Math.round(received/total*100))}%`
           :`${(received/1048576).toFixed(1)}MB`;
         downloadBtn.textContent=`Saving… ${pct}${background?" 🔒":""}`;
       }
     });
     try{
       await handle.promise;
       downloadBtn.textContent="Saved ✓";
       show("Saved in app storage");
       setTimeout(()=>{downloadBtn.textContent=original;downloadBtn.disabled=false},1800);
     }catch(err){
       downloadBtn.textContent=original;
       downloadBtn.disabled=false;
       show(err?.name==="AbortError"?"Download canceled":(err.message||"Couldn't save this video in the app."));
     }
     return;
   }
   // Plain file download to the device (server sends an attachment header
   // when ?download=1 is present) - separate from "Download offline"
   // above, which saves inside the app's own storage instead. Same
   // range-probe-first approach as the main video's #downloadBtn, so a
   // Drive/server error shows up as a message instead of silently saving
   // a broken few-byte file.
   const saveFileBtn=e.target.closest("[data-rec-savefile]");
   if(saveFileBtn){
     e.preventDefault();e.stopPropagation();
     if(saveFileBtn.disabled)return;
     const vid=saveFileBtn.dataset.recSavefile;
     const x=others.find(o=>String(o.id)===String(vid));
     const streamUrl=window.DVaultMedia?await DVaultMedia.url(vid):"/api/videos/"+encodeURIComponent(vid)+"/stream";
     const original=saveFileBtn.innerHTML;
     saveFileBtn.disabled=true;
     saveFileBtn.textContent="Checking…";
     try{
       const probe=await fetch(streamUrl,{headers:{Range:"bytes=0-1"},credentials:"include"});
       if(!probe.ok){
         const j=await probe.json().catch(()=>({}));
         throw Error(j.error||"Download failed.");
       }
       probe.body?.cancel().catch(()=>{});
       const a=document.createElement("a");
       a.href=streamUrl+"?download=1";
       a.download=(x&&x.title)||"video";
       document.body.appendChild(a);a.click();a.remove();
       show("Downloading original quality");
     }catch(err){
       show(err.message||"Download failed. Try again in a moment.");
     }finally{
       saveFileBtn.disabled=false;saveFileBtn.innerHTML=original;
     }
     return;
   }
 }
 recList.addEventListener("click",onRecMenuClick);
 upNextList.addEventListener("click",onRecMenuClick);
 // Close any open recommendation-card menu when clicking elsewhere — including
 // the rest of that same card (thumbnail, title, blank space), not just
 // outside the card entirely. Only a click inside the open menu itself (its
 // own buttons already stopPropagation before reaching here) should leave it
 // open.
 document.addEventListener("click",e=>{
   if(!e.target.closest(".card-menu.open"))document.querySelectorAll(".card-menu.open").forEach(m=>m.classList.remove("open"));
 });

 // Infinite scroll: load more recommended videos as the viewer scrolls down,
 // until every video has been shown once (then the list simply ends).
 if(recSentinel&&"IntersectionObserver" in window){
   const recObserver=new IntersectionObserver(entries=>{
     if(entries.some(en=>en.isIntersecting))appendRecommendations();
   },{root:null,rootMargin:"600px 0px"});
   recObserver.observe(recSentinel);
 }

 // Auto-refresh removed per request - recommendations now only reshuffle on
 // initial load or when the viewer taps the manual refresh button.
 const recAutoTimer=null;

 // Manual refresh button — reshuffle the recommendations on demand.
 const recRefreshBtn=$("#recRefreshBtn");
 recRefreshBtn?.addEventListener("click",e=>{
   e.stopPropagation();
   if(others.length<2)return;
   recOrder=shuffleArr(others);
   renderRecommendations();
   recRefreshBtn.classList.remove("spinning");
   void recRefreshBtn.offsetWidth;
   recRefreshBtn.classList.add("spinning");
 });

 // On mobile/tablet the refresh button moves to sit right below the video
 // title, above the up-next list; on desktop it stays by "Related videos".
 const recRefreshSlot=$("#recRefreshSlot");
 const recHead=recRefreshBtn?.parentElement;
 if(recRefreshBtn&&recRefreshSlot&&recHead){
   const recRefreshMq=window.matchMedia("(max-width:1100px)");
   const placeRecRefreshBtn=()=>(recRefreshMq.matches?recRefreshSlot:recHead).appendChild(recRefreshBtn);
   placeRecRefreshBtn();
   if(recRefreshMq.addEventListener)recRefreshMq.addEventListener("change",placeRecRefreshBtn);
   else recRefreshMq.addListener(placeRecRefreshBtn);
 }

 // Autoplay the next recommended video as soon as the current one ends.
 function goToNext(next){
   clearInterval(recAutoTimer);
   location.href="/watch.html?id="+encodeURIComponent(next.id);
 }
 v.addEventListener("ended",()=>{
   const next=recOrder[0];
   if(next)goToNext(next);
 });
 // Shortly before this video ends, quietly do the server-side lookup for the
 // one that will auto-play next, so the switch doesn't start from cold (see
 // perf.js). Timed for the last ~45s, not earlier, because the server only
 // holds that lookup for about two minutes. Costs ~1 byte; skipped on Data
 // Saver / 2G / offline like every other warm-up.
 let warmedNext=false;
 v.addEventListener("timeupdate",()=>{
   if(warmedNext||!(v.duration>0)||v.duration-v.currentTime>45)return;
   warmedNext=true;
   const next=recOrder[0];
   if(next&&window.DPPerf)DPPerf.warm(next.id);
 });

 let counted=false;
 v.addEventListener("play",()=>{
   if(!counted){counted=true;api(`/api/videos/${encodeURIComponent(id)}/view`,{method:"POST"}).catch(()=>{})}
 });
 ui();volui();
}
(window.DVaultBootstrap?window.DVaultBootstrap.ready():Promise.resolve()).then(main).catch(e=>document.body.innerHTML='<main class="error-page"><h2>'+esc(e.message)+'</h2><a href="/">← Back to D Vault</a></main>');
