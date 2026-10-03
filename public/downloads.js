const $=s=>document.querySelector(s);
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fmtSize=b=>{if(!b)return"";const u=["B","KB","MB","GB"];let i=0;while(b>=1024&&i<u.length-1){b/=1024;i++}return`${b.toFixed(i?1:0)} ${u[i]}`};

// ---- Sidebar (mirrors the drawer on the other pages) ----
(function(){
  const sidebar=$("#sidebar"),backdrop=$("#sidebarBackdrop"),menuBtn=$("#menuBtn");
  if(!sidebar||!backdrop||!menuBtn)return;
  const open=()=>{sidebar.classList.add("open");backdrop.classList.add("show")};
  const close=()=>{sidebar.classList.remove("open");backdrop.classList.remove("show")};
  menuBtn.onclick=()=>{sidebar.classList.contains("open")?close():open()};
  const sidebarClose=$("#sidebarClose");
  if(sidebarClose)sidebarClose.onclick=close;
  backdrop.onclick=close;
  document.addEventListener("keydown",e=>{if(e.key==="Escape")close()});
})();

const toastEl=$("#toast");
const show=t=>{if(!toastEl)return;toastEl.textContent=t;toastEl.classList.add("show");clearTimeout(show._t);show._t=setTimeout(()=>toastEl.classList.remove("show"),2200)};

let openUrls=[];
function revokeOpenUrls(){openUrls.forEach(u=>URL.revokeObjectURL(u));openUrls=[]}

// The most recently loaded/sorted list of completed downloads (same order
// as the grid) and the index within it that's currently open in the
// player — lets the ⏮/⏭ transport buttons step to the previous/next
// downloaded video instead of seeking. Pending (still-downloading) items
// are never in this list since they're not playable yet.
let currentItems=[];
let currentIndex=-1;

async function renderStorageNote(){
  const el=$("#dlStorage");if(!el||!window.AppDownloads)return;
  const est=await AppDownloads.estimateStorage();
  if(est && est.usage!=null && est.quota){
    el.textContent=`Using ${fmtSize(est.usage)} of ${fmtSize(est.quota)} in-app storage`;
  }
}

function pendingCardHtml(id,info){
  const pct=info.total?Math.min(99,Math.round(info.received/info.total*100)):null;
  const bgTag=info.background?'<span class="dl-bg-tag">Background — safe to close the app</span>':'<span class="dl-bg-tag dl-bg-tag-fg">Keep the app open</span>';
  const barHtml=pct!=null
    ?`<div class="dl-progress"><div class="dl-progress-bar" style="width:${pct}%"></div></div><p class="dl-pct">Downloading… ${pct}% ${bgTag}</p>`
    :`<div class="dl-progress"><div class="dl-progress-bar indeterminate"></div></div><p class="dl-pct">Downloading… ${(info.received/1048576).toFixed(1)}MB ${bgTag}</p>`;
  return `<article class="video-card dl-card dl-pending" data-pending-id="${esc(id)}">
    <div class="thumb">⏳</div>
    <div class="card-row">
      <div class="channel-avatar">${esc((info.title||"M").trim()[0].toUpperCase())}</div>
      <div class="card-body">
        <span class="video-title">${esc(info.title||"Untitled video")}</span>
        ${barHtml}
        <button type="button" class="dl-cancel" data-cancel="${esc(id)}">✕ Cancel download</button>
      </div>
    </div>
  </article>`;
}

async function load(){
  const grid=$("#grid");
  // Confirms which account is signed in before reading the offline
  // downloads cache (idb-downloads.js), which is scoped per-account - see
  // local storage identity. This page has no other server call that would
  // otherwise catch a signed-out visitor.
  try{
    const r=await fetch("/api/me",{credentials:"include"});
    if(!r.ok)throw Error("storage unavailable");
    const me=await r.json();
    if(!me){location.href="/settings.html";return}
    
    const initial=((me.name||me.email||"").trim()[0]||"A").toUpperCase();
    const av=$("#avatarInitial");if(av)av.textContent=initial;
  }catch{location.href="/settings.html";return}
  if(!window.AppDownloads){
    grid.innerHTML='<div class="empty-state"><div class="empty-icon">⚠</div><h2>Not supported</h2><p>This browser does not support in-app storage.</p></div>';
    return;
  }
  // Reconcile with any Background Fetch downloads before rendering — these
  // keep running even while the app is closed, so progress (or "it already
  // finished/failed while nothing was open") may have changed since the
  // last time a page was here to hear about it.
  await AppDownloads.syncBackgroundDownloads();
  const active=AppDownloads.getActiveDownloads();
  const pendingIds=Object.keys(active);
  const pendingHtml=pendingIds.map(pid=>pendingCardHtml(pid,active[pid])).join("");

  let items=[];
  try{items=await AppDownloads.listVideos()}catch(err){
    grid.innerHTML='<div class="empty-state"><div class="empty-icon">⚠</div><h2>Could not load downloads</h2><p>'+esc(err.message||"")+'</p></div>';
    return;
  }
  revokeOpenUrls();
  if(!items.length && !pendingIds.length){
    grid.innerHTML='<div class="empty-state"><div class="empty-icon">📲</div><h2>No downloads yet</h2><p>Videos you save with "Download offline" from the watch page show up here, playable even without the download button/system file manager.</p></div>';
    return;
  }
  items.sort((a,b)=>(b.savedAt||0)-(a.savedAt||0));
  currentItems=items;
  const doneHtml=items.map(it=>{
    let posterUrl="";
    if(it.poster){posterUrl=URL.createObjectURL(it.poster);openUrls.push(posterUrl)}
    return `<article class="video-card dl-card" data-id="${esc(it.id)}">
      <div class="thumb">${posterUrl?`<img src="${posterUrl}" alt="">`:'<div class="no-poster">▶</div>'}</div>
      <div class="card-row">
        <div class="channel-avatar">${esc((it.title||"M").trim()[0].toUpperCase())}</div>
        <div class="card-body">
          <span class="video-title">${esc(it.title||"Untitled video")}</span>
          <p class="dl-size">${fmtSize(it.size)} · saved ${it.savedAt?new Date(it.savedAt).toLocaleDateString():""}</p>
          <button type="button" class="dl-remove" data-remove="${esc(it.id)}">🗑 Remove from app storage</button>
        </div>
      </div>
    </article>`;
  }).join("");
  grid.innerHTML=pendingHtml+doneHtml;
  renderStorageNote();
}

// Live-update in-progress download cards (percent, or a finished download
// dropping off the pending list) without re-rendering the whole grid —
// this can fire many times a second while a download is running.
function refreshPending(){
  const grid=$("#grid");
  if(!grid)return;
  const active=AppDownloads.getActiveDownloads();
  const pendingIds=Object.keys(active);
  const shown=new Set([...grid.querySelectorAll("[data-pending-id]")].map(el=>el.dataset.pendingId));
  const sameSet=pendingIds.length===shown.size&&pendingIds.every(pid=>shown.has(pid));
  if(!sameSet){
    // A download started, finished, or was canceled — the pending list
    // itself changed, so do a full reload to pick up any newly-saved video.
    load();
    return;
  }
  pendingIds.forEach(pid=>{
    const card=grid.querySelector(`[data-pending-id="${CSS.escape(pid)}"]`);
    if(!card)return;
    const info=active[pid];
    const pct=info.total?Math.min(99,Math.round(info.received/info.total*100)):null;
    const bar=card.querySelector(".dl-progress-bar"),label=card.querySelector(".dl-pct");
    const bgTag=info.background?'<span class="dl-bg-tag">Background — safe to close the app</span>':'<span class="dl-bg-tag dl-bg-tag-fg">Keep the app open</span>';
    if(pct!=null){
      bar.classList.remove("indeterminate");
      bar.style.width=pct+"%";
      label.innerHTML=`Downloading… ${pct}% ${bgTag}`;
    }else{
      label.innerHTML=`Downloading… ${(info.received/1048576).toFixed(1)}MB ${bgTag}`;
    }
  });
}
if(window.AppDownloads)AppDownloads.onActiveDownloadsChanged(refreshPending);
// Background Fetch downloads are often running in a tab that's no longer
// open (surviving a closed tab is the whole point), so live progress lives
// in the browser's own registration, not anything this page gets pushed.
// Poll it directly every few seconds while any background download is
// pending, rather than relying only on broadcast messages, which nothing
// resends if this page happened to miss one.
async function pollBackgroundProgress(){
  if(!window.AppDownloads)return;
  const active=AppDownloads.getActiveDownloads();
  if(Object.values(active).some(a=>a?.background)){
    await AppDownloads.syncBackgroundDownloads();
    refreshPending();
  }
}
setInterval(pollBackgroundProgress,2500);
// Mobile/desktop browsers throttle or fully suspend setInterval timers on a
// hidden tab, so a background download that finishes (or keeps progressing)
// while this tab is backgrounded/locked can leave the % frozen on an old
// value even though the download itself is still running fine — the poll
// above simply never got to fire. Force an immediate re-sync the instant the
// tab becomes visible again, instead of waiting for the interval to resume
// (or for the user to manually refresh) so the UI catches up right away.
document.addEventListener("visibilitychange",()=>{
  if(document.visibilityState==="visible")pollBackgroundProgress();
});

const player=$("#dlPlayer"),dlVideo=$("#dlVideo");
const dlPlayerCtrl=window.OfflinePlayer?OfflinePlayer.attach(player,dlVideo,{
  isActive:()=>player.classList.contains("show"),
  onPrev:()=>playIndex(currentIndex-1),
  onNext:()=>playIndex(currentIndex+1)
}):null;
let playingUrl=null;
function closePlayer(){
  player.classList.remove("show");
  dlVideo.pause();dlVideo.removeAttribute("src");dlVideo.load();
  if(playingUrl){URL.revokeObjectURL(playingUrl);playingUrl=null}
  currentIndex=-1;
}
$("#dlPlayerClose").onclick=closePlayer;
player.addEventListener("click",e=>{if(e.target===player)closePlayer()});

// Plays the item at currentItems[idx] (if in range) and updates the
// player's ⏮/⏭ enabled state to match the new position in the list.
async function playIndex(idx){
  if(idx<0||idx>=currentItems.length)return;
  const item=currentItems[idx];
  try{
    const rec=await AppDownloads.getVideo(item.id);
    if(!rec||!rec.blob)throw Error("That download could not be found.");
    if(playingUrl)URL.revokeObjectURL(playingUrl);
    playingUrl=URL.createObjectURL(rec.blob);
    dlVideo.src=playingUrl;
    currentIndex=idx;
    player.classList.add("show");
    if(dlPlayerCtrl){
      dlPlayerCtrl.reset(rec.title);
      dlPlayerCtrl.setNav(currentIndex>0,currentIndex<currentItems.length-1);
    }
    dlVideo.play().catch(()=>{});
  }catch(err){show(err.message||"Couldn't play that download.")}
}

document.addEventListener("click",async e=>{
  const cancelId=e.target.closest("[data-cancel]")?.dataset.cancel;
  if(cancelId){
    e.stopPropagation();
    // The download only actually runs on whichever watch-page tab started
    // it; this just asks that tab (if it's still open) to abort it.
    AppDownloads.requestCancelDownload(cancelId);
    return;
  }
  const removeId=e.target.closest("[data-remove]")?.dataset.remove;
  if(removeId){
    e.stopPropagation();
    try{
      await AppDownloads.deleteVideo(removeId);
      show("Removed from app storage");
      load();
    }catch(err){show(err.message||"Couldn't remove that download.")}
    return;
  }
  const card=e.target.closest(".dl-card:not(.dl-pending)");
  if(card){
    const id=card.dataset.id;
    const idx=currentItems.findIndex(it=>String(it.id)===id);
    await playIndex(idx>=0?idx:0);
  }
});

// Title-bar search icon: expands into a plain text filter over the
// download cards already on the page (titles only — no server round trip).
(function(){
  const btn=$("#dlSearchToggleBtn"),form=$("#dlSearchForm"),input=$("#dlSearch");
  if(!btn||!form||!input)return;
  function openSearch(){form.classList.add("open");btn.setAttribute("aria-expanded","true");input.focus()}
  function closeSearch(){form.classList.remove("open");btn.setAttribute("aria-expanded","false")}
  function applyFilter(){
    const q=(input.value||"").trim().toLowerCase();
    document.querySelectorAll("#grid .dl-card").forEach(card=>{
      const title=(card.querySelector(".video-title")?.textContent||"").toLowerCase();
      const id=String(card.dataset.id||card.dataset.pendingId||"").toLowerCase();
      // Title, video ID, or a pasted watch link containing the ID.
      card.style.display=!q||title.includes(q)||(id&&(id.includes(q)||(id.length>=8&&q.includes(id))))?"":"none";
    });
  }
  btn.onclick=()=>{form.classList.contains("open")?(input.value.trim()?input.focus():closeSearch()):openSearch()};
  form.onsubmit=e=>e.preventDefault();
  input.oninput=applyFilter;
  input.addEventListener("keydown",e=>{if(e.key==="Escape"){input.value="";applyFilter();closeSearch()}});
  document.addEventListener("click",e=>{if(form.classList.contains("open")&&!input.value.trim()&&!form.contains(e.target)&&!btn.contains(e.target))closeSearch()});
})();

// Title-bar account button: same quick sign-in check used elsewhere.
$("#avatarBtn").onclick=async()=>{
  try{
    const r=await fetch("/api/me",{credentials:"include"});
    if(!r.ok)throw Error("storage unavailable");
    const me=await r.json();
    if(!me.signedIn)throw Error("not signed in");
    show("Signed in as "+(me.email||""));
  }catch{location.href="/settings.html"}
};

load();
