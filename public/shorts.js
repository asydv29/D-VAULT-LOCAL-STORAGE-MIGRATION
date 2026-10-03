const $=(s,ctx)=>(ctx||document).querySelector(s);
const $$=(s,ctx)=>Array.from((ctx||document).querySelectorAll(s));
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const api=(u,o)=>fetch(u,o).then(async r=>{const j=await r.json().catch(()=>({}));if(!r.ok)throw Error(j.error||"Request failed");return j});
function fmtViews(n){n=Number(n||0);if(n>=1e9)return (n/1e9).toFixed(1).replace(".0","")+"B views";if(n>=1e6)return (n/1e6).toFixed(1).replace(".0","")+"M views";if(n>=1e3)return (n/1e3).toFixed(1).replace(".0","")+"K views";return n+" views"}
function ago(d){if(!d)return "Recently";const s=Math.max(0,(Date.now()-new Date(d).getTime())/1000);if(s<3600)return Math.floor(s/60)+"m ago";if(s<86400)return Math.floor(s/3600)+"h ago";if(s<2592000)return Math.floor(s/86400)+"d ago";if(s<31536000)return Math.floor(s/2592000)+"mo ago";return Math.floor(s/31536000)+"y ago"}
function fmtSize(b){b=Number(b);if(!b||b<0)return "";const u=["B","KB","MB","GB","TB"];let i=0;while(b>=1024&&i<u.length-1){b/=1024;i++}return (i?b.toFixed(1):String(Math.round(b)))+" "+u[i]}

const feed=$("#shortsFeed"),emptyEl=$("#shortsEmpty"),loadingEl=$("#shortsLoading"),toastEl=$("#shortsToast");
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
    // Share failed for some other reason — fall through to the download link.
  }
  downloadBlob(blob,filename);
  return "saved";
}
function toast(m){toastEl.textContent=m;toastEl.classList.add("show");clearTimeout(toast._t);toast._t=setTimeout(()=>toastEl.classList.remove("show"),2200)}

const params=new URLSearchParams(location.search);
const startId=params.get("id");
// Which filtered page (if any) this feed was opened from — liked, favorites,
// or watch later. When set, the feed only ever contains Shorts matching that
// same filter, so swiping to the next/previous Short never leaves the list
// the person was browsing and never falls back to a random unrelated Short.
const listMode=params.get("list");
const listFilters={liked:v=>v.liked,favorites:v=>v.favorite,watchlater:v=>v.watchLater};
const listPredicate=listFilters[listMode]||null;
// Hamburger-menu "Shorts" link lands here with ?random=1 so it drops the
// person straight into a random Short instead of always the first one.
const wantRandom=params.get("random")==="1";

let muted=localStorage.getItem("mytube_shorts_muted")!=="0";
let speed=1;
let quality="auto";
let items=[];
let activeIndex=-1;
let currentMenuSlide=null;
let downloadedIds=new Set();
// Keeps the rail "Save"/"✓ Saved" state in sync with what's actually sitting
// in the app's IndexedDB storage (idb-downloads.js).
async function refreshDownloadedIds(){
  if(!window.AppDownloads)return;
  try{
    const list=await AppDownloads.listVideos();
    downloadedIds=new Set(list.map(x=>String(x.id)));
  }catch{}
}

function slideHTML(v,i){
  const letter=esc((v.title||"M").trim()[0]||"M").toUpperCase();
  // Offline items (see startOfflineShorts) carry their own blob URL instead
  // of a server stream URL — everything else about the slide is identical.
  const stream=v.offlineSrc||("/api/videos/"+encodeURIComponent(v.id)+"/stream");
  return `<section class="short-slide" data-id="${esc(v.id)}" data-index="${i}">
    <video class="short-video" data-src="${stream}" playsinline webkit-playsinline preload="none" poster="${esc(v.thumbnail||"")}"${muted?" muted":""}></video>
    <div class="short-spinner-wrap hidden"><div class="short-mini-spinner"></div></div>
    <div class="short-tap-layer"></div>
    <div class="short-center-icon hidden"><svg viewBox="0 0 24 24" width="44" height="44" fill="#fff" style="margin-left:4px"><path d="M8 5v14l11-7z"></path></svg></div>
    <div class="short-seek-flash left"><span class="short-seek-icon">◁◁</span><span class="short-seek-amount">10s</span></div>
    <div class="short-seek-flash right"><span class="short-seek-icon">▷▷</span><span class="short-seek-amount">10s</span></div>
    <div class="short-speed-flash">▶▶ 2x</div>

    <div class="shorts-topbar">
      <span class="shorts-topbar-title">Shorts</span>
      <div class="shorts-topbar-actions">
        <button class="shorts-icon-btn short-reverse-btn" aria-label="Reverse play"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" class="shorts-icon-svg"><path d="M9.6 8.6 16.3 12 9.6 15.4Z"></path><path d="M4.3 15.3A8.4 8.4 0 0 1 17 5.1"></path><path d="M15.2 6.1 17.6 5.6 17.2 3.2"></path><path d="M19.7 8.7A8.4 8.4 0 0 1 7 18.9"></path><path d="M8.8 17.9 6.4 18.4 6.8 20.8"></path></svg></button>
        <button class="shorts-icon-btn short-mute-btn${muted?" is-muted":""}" aria-label="Mute">
          <img class="short-icon-volume shorts-icon-invert" src="/icons/volume.png" alt="">
          <img class="short-icon-mute" src="/icons/mute.png" alt="">
        </button>
        <button class="shorts-icon-btn short-search-btn" aria-label="Search"><svg class="shorts-icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg></button>
        <button class="shorts-icon-btn shorts-dots-btn short-more-btn" aria-label="More options">⋮</button>
      </div>
    </div>

    <div class="short-rail">
      <button class="short-rail-btn short-like-btn${v.liked?" liked":""}" aria-label="Like">
        <span class="short-rail-icon"><svg class="short-like-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg></span>
        <span class="short-rail-count short-like-label">${v.liked?"Liked":"Like"}</span>
      </button>
      <button class="short-rail-btn short-download-btn${downloadedIds.has(String(v.id))?" is-saved":""}" aria-label="${downloadedIds.has(String(v.id))?"Saved":"Download"}"${downloadedIds.has(String(v.id))?" disabled":""}>
        <span class="short-rail-icon">${downloadedIds.has(String(v.id))?"✓":'<img class="shorts-icon-invert" src="/icons/download.png" alt="">'}</span>
        <span class="short-rail-count">${downloadedIds.has(String(v.id))?"Saved":"Save"}</span>
      </button>
      <button class="short-rail-btn short-fav-btn${v.favorite?" faved":""}" aria-label="Favorite">
        <span class="short-rail-icon short-fav-star">${v.favorite?"★":"☆"}</span>
        <span class="short-rail-count">${v.favorite?"Saved":"Favorite"}</span>
      </button>
    </div>

    <button class="short-rail-btn short-screenshot-btn short-screenshot-mid" aria-label="Screenshot">
      <span class="short-rail-icon short-screenshot-icon"><img class="shorts-icon-invert" src="/icons/screenshot-icon.png" width="26" height="26" alt=""></span>
    </button>

    <div class="short-bottom-info">
      <div class="short-channel-row">
        <span class="short-channel-avatar">${letter}</span>
        <span class="short-channel-name">D Vault</span>
      </div>
      <p class="short-title">${esc(v.title||"Untitled")}</p>
      <p class="short-stats">${[v.quality,fmtViews(v.views),fmtSize(v.size),ago(v.createdTime)].filter(Boolean).join(" · ")}</p>
    </div>

    <div class="short-preview" aria-hidden="true"><canvas class="short-preview-canvas" width="72" height="128"></canvas><div class="short-preview-time">00:00 / 00:00</div></div>
    <div class="short-progress"><div class="short-progress-track"><div class="short-progress-fill"><span class="short-progress-thumb"></span></div></div></div>
  </section>`;
}

// Used by rail/menu actions that need the server (like, favorite,
// download-in-app for a not-yet-saved video, remove from Shorts, download
// to device). Offline items are already saved locally, so there's nothing
// useful these can do without a connection.
function offlineGuard(){
  if(window.MyTubeOffline&&MyTubeOffline.isOffline()){
    toast("Not available offline");
    return true;
  }
  return false;
}

function render(){
  feed.innerHTML=items.map((v,i)=>slideHTML(v,i)).join("");
  $$(".short-slide").forEach(wireSlide);
}

async function ensureLoaded(i){
  for(const j of [i-1,i,i+1,i+2,i+3,i+4]){
    const slide=feed.children[j];
    if(!slide)continue;
    const v=slide.querySelector("video");
    if(!v.getAttribute("src")){
      v.muted=muted;
      v.defaultMuted=muted;
      v.preload="auto";
      v.playbackRate=speed;
      // D Vault local media should bypass the compatibility /api stream route
      // whenever possible. A direct Blob URL lets the browser use its native
      // local-file media pipeline and avoids Range/fetch timing issues that
      // can prevent Shorts from reaching loadeddata/playing.
      const id=slide.dataset.id;
      let src=null;
      try{src=await window.DVaultMedia?.url(id)}catch{}
      v.src=src||v.dataset.src;
      v.load();
    }
  }
}

function updateCenterIcon(slide,v){
  const icon=slide.querySelector(".short-center-icon");
  const playing=(!v.paused&&!v.ended)||!!window.DVReverse?.isRunning(v);
  icon.classList.toggle("hidden",playing);
}

function activateSlide(i,slideEl){
  if(i===activeIndex)return;
  const prevSlide=activeIndex>=0?feed.children[activeIndex]:null;
  if(prevSlide){
    const pv=prevSlide.querySelector("video");
    if(pv){window.DVReverse?.stop(pv,true);pv.pause()}
  }
  activeIndex=i;
  ensureLoaded(i);
  // Build the scrub-preview sprite for this Short and the next two right away
  // instead of waiting for the slow background queue.
  if(window.DVaultPreview?.prioritizeSprite){for(let k=0;k<3;k++){const it=items[i+k];if(it&&it.id&&!String(it.id).startsWith("picker:"))DVaultPreview.prioritizeSprite(String(it.id),k)}}
  const v=slideEl.querySelector("video");
  v.muted=muted;
  v.playbackRate=speed;
  const tryPlay=()=>v.play().catch(()=>{
    // Browsers often block un-muted autoplay when play() is triggered from
    // a scroll/IntersectionObserver callback rather than a direct click/tap.
    // Fall back to a muted autoplay so the next Short still starts on its
    // own, then restore sound right after if the user has sound turned on.
    if(!v.muted){
      v.muted=true;
      v.play().then(()=>{if(!muted)v.muted=false}).catch(()=>updateCenterIcon(slideEl,v));
    }else{
      updateCenterIcon(slideEl,v);
    }
  });
  if(v.readyState>=2)tryPlay();else v.addEventListener("loadeddata",tryPlay,{once:true});
  updateCenterIcon(slideEl,v);
  const item=items[i];
  if(item){
    history.replaceState(null,"","/shorts.html?id="+encodeURIComponent(item.id));
    document.title=(item.title||"Shorts")+" — Shorts — D Vault";
  }
}

function setupObserver(){
  const observer=new IntersectionObserver(entries=>{
    entries.forEach(entry=>{
      const slide=entry.target;
      const i=Number(slide.dataset.index);
      const v=slide.querySelector("video");
      if(entry.intersectionRatio>=0.6){
        if(i!==activeIndex)activateSlide(i,slide);
      }else if(i!==activeIndex&&v){
        v.pause();
      }
    });
  },{threshold:[0,0.6,1]});
  $$(".short-slide").forEach(s=>observer.observe(s));
}

function wireSlide(slide){
  const v=slide.querySelector("video");
  const tap=slide.querySelector(".short-tap-layer");
  const spinner=slide.querySelector(".short-spinner-wrap");
  let counted=false;

  // Auto-hide: once playback is under way, fade everything except the
  // mute button, the three-dot menu and Like. Pausing or tapping brings
  // the full UI straight back.
  let hideTimer=null;
  const showUI=()=>{clearTimeout(hideTimer);slide.classList.remove("ui-hidden")};
  const scheduleHide=()=>{
    clearTimeout(hideTimer);
    hideTimer=setTimeout(()=>{if(!v.paused&&!v.ended)slide.classList.add("ui-hidden")},2200);
  };
  v.addEventListener("play",scheduleHide);
  v.addEventListener("pause",showUI);
  v.addEventListener("ended",showUI);
  v.addEventListener("seeking",showUI);

  // ---- Gestures on the tap layer ----
  // • Single tap:            play / pause
  // • Double tap left/right: seek -10s / +10s (accumulates on rapid repeats)
  // • Press & hold:          play at 2x while held, back to normal on release
  const seekFlashLeft=slide.querySelector(".short-seek-flash.left");
  const seekFlashRight=slide.querySelector(".short-seek-flash.right");
  const speedFlash=slide.querySelector(".short-speed-flash");
  const LONG_PRESS_MS=350,TAP_MOVE_TOLERANCE=12,DOUBLE_TAP_MS=300,SEEK_STEP=10;
  let longPressTimer=null,isLongPressing=false,pointerActive=false,pointerStartX=0,pointerStartY=0;
  let tapTimer=null,pendingSide=null;
  let seekAccum={left:0,right:0},seekAccumTimer=null;

  function startLongPress(){
    isLongPressing=true;
    v.playbackRate=2;
    speedFlash.classList.add("show");
  }
  function endLongPress(){
    if(!isLongPressing)return;
    isLongPressing=false;
    v.playbackRate=speed;
    speedFlash.classList.remove("show");
  }
  v.addEventListener("pause",endLongPress);

  function doSeek(side){
    if(!v.duration)return;
    const delta=side==="left"?-SEEK_STEP:SEEK_STEP;
    v.currentTime=Math.min(Math.max(0,v.currentTime+delta),v.duration);
    const el=side==="left"?seekFlashLeft:seekFlashRight;
    const other=side==="left"?seekFlashRight:seekFlashLeft;
    other.classList.remove("show");
    seekAccum[side]+=SEEK_STEP;
    seekAccum[side==="left"?"right":"left"]=0;
    el.querySelector(".short-seek-amount").textContent=seekAccum[side]+"s";
    el.classList.add("show");
    clearTimeout(seekAccumTimer);
    seekAccumTimer=setTimeout(()=>{
      el.classList.remove("show");
      seekAccum.left=0;seekAccum.right=0;
    },650);
  }

  tap.addEventListener("contextmenu",e=>e.preventDefault());

  // Laptops (mouse/trackpad) and tablets (larger touchscreens) don't need
  // the double-tap-to-seek debounce that phones use — on those devices a
  // single click/tap should pause or play immediately. Phones keep the
  // short wait so a fast second tap on the same side can still seek.
  function isImmediateTapDevice(pointerType){
    if(pointerType==="mouse"||pointerType==="pen")return true;
    return Math.min(window.innerWidth,window.innerHeight)>=600;
  }
  function togglePlayback(){
    if(window.DVReverse?.isActive(v)){DVReverse.toggle(v);updateCenterIcon(slide,v);return}
    if(v.paused||v.ended)v.play().catch(()=>{});else v.pause();
  }

  tap.addEventListener("pointerdown",e=>{
    if(e.pointerType==="mouse"&&e.button!==0)return;
    pointerActive=true;
    pointerStartX=e.clientX;pointerStartY=e.clientY;
    clearTimeout(longPressTimer);
    longPressTimer=setTimeout(()=>{if(pointerActive)startLongPress()},LONG_PRESS_MS);
  });

  tap.addEventListener("pointermove",e=>{
    if(!pointerActive)return;
    if(Math.abs(e.clientX-pointerStartX)>TAP_MOVE_TOLERANCE||Math.abs(e.clientY-pointerStartY)>TAP_MOVE_TOLERANCE){
      clearTimeout(longPressTimer);
      if(isLongPressing)endLongPress();
      pointerActive=false;
    }
  });

  function finishPress(e){
    clearTimeout(longPressTimer);
    if(!pointerActive)return;
    pointerActive=false;
    if(isLongPressing){endLongPress();return}
    const rect=tap.getBoundingClientRect();
    const clientX=e.clientX!=null?e.clientX:pointerStartX;
    const side=(clientX-rect.left)<rect.width/2?"left":"right";
    if(tapTimer&&pendingSide===side){
      clearTimeout(tapTimer);tapTimer=null;pendingSide=null;
      doSeek(side);
      return;
    }
    clearTimeout(tapTimer);
    pendingSide=side;

    if(isImmediateTapDevice(e.pointerType)){
      // React right away instead of waiting to see if a second tap follows.
      // A same-side second tap within the window still seeks (handled by
      // the pendingSide check above), it just no longer blocks the pause.
      tapTimer=setTimeout(()=>{tapTimer=null;pendingSide=null},DOUBLE_TAP_MS);
      togglePlayback();
      return;
    }

    tapTimer=setTimeout(()=>{
      tapTimer=null;pendingSide=null;
      if(slide.classList.contains("ui-hidden")){
        // UI (icons, title, stats) is faded out during playback — the
        // first tap just brings it back instead of pausing immediately.
        showUI();
        scheduleHide();
        return;
      }
      togglePlayback();
    },DOUBLE_TAP_MS);
  }
  tap.addEventListener("pointerup",finishPress);
  tap.addEventListener("pointercancel",()=>{
    clearTimeout(longPressTimer);
    if(isLongPressing)endLongPress();
    pointerActive=false;
    clearTimeout(tapTimer);tapTimer=null;pendingSide=null;
  });

  ["play","pause","ended"].forEach(evt=>v.addEventListener(evt,()=>updateCenterIcon(slide,v)));
  v.addEventListener("ended",()=>{
    const i=Number(slide.dataset.index);
    const next=feed.children[i+1];
    if(next)next.scrollIntoView({behavior:"smooth"});
  });
  v.addEventListener("waiting",()=>spinner.classList.remove("hidden"));
  v.addEventListener("playing",()=>spinner.classList.add("hidden"));
  v.addEventListener("canplay",()=>spinner.classList.add("hidden"));
  v.addEventListener("play",()=>{
    if(counted)return;counted=true;
    api("/api/videos/"+encodeURIComponent(slide.dataset.id)+"/view",{method:"POST"}).catch(()=>{});
  });
  v.addEventListener("timeupdate",()=>{
    if(!v.duration||progressBar.classList.contains("dragging"))return;
    progressFill.style.width=(v.currentTime/v.duration*100)+"%";
  });

  // ---- Draggable progress/seek bar (YouTube-style scrubber) ----
  const progressBar=slide.querySelector(".short-progress");
  const progressFill=slide.querySelector(".short-progress-fill");
  let wasPlayingBeforeDrag=false;
  let wasReverseBeforeDrag=false;
  function ratioFromEvent(e){
    const rect=progressBar.getBoundingClientRect();
    return Math.min(1,Math.max(0,(e.clientX-rect.left)/rect.width));
  }
  function seekTo(ratio){
    progressFill.style.width=(ratio*100)+"%";
    if(v.duration)v.currentTime=ratio*v.duration;
  }
  // ---- Sprite thumbnail preview above the progress bar ----
  // Uses the same one-image sprite sheet + metadata as the watch page, so
  // scrubbing never has to seek the video just to show a frame.
  const prevBox=slide.querySelector(".short-preview");
  const prevCanvas=slide.querySelector(".short-preview-canvas");
  const prevCtx=prevCanvas.getContext("2d");
  const prevTime=slide.querySelector(".short-preview-time");
  let spriteMeta=null,spriteImg=null,spriteLoading=null,spriteFailedAt=0,prevSeq=0;
  const fmtT=t=>{t=Math.max(0,Math.floor(t||0));const h=Math.floor(t/3600),m=Math.floor(t%3600/60),sec=t%60;return h?h+":"+String(m).padStart(2,"0")+":"+String(sec).padStart(2,"0"):m+":"+String(sec).padStart(2,"0")};
  // Portrait scrub popup: fixed 5:8 box (drawn at 1.5x for sharpness).
  const PREV_W=156,PREV_H=252;
  const sizePrevCanvas=()=>{if(prevCanvas.width!==PREV_W||prevCanvas.height!==PREV_H){prevCanvas.width=PREV_W;prevCanvas.height=PREV_H}};
  const coverCrop=(x,y,w,h)=>{const ar=PREV_W/PREV_H;if(w/h>ar){const nw=h*ar;return{x:x+(w-nw)/2,y,w:nw,h}}const nh=w/ar;return{x,y:y+(h-nh)/2,w,h:nh}};
  const loadSprite=async()=>{
    if(spriteMeta&&spriteImg)return true;
    if(String(slide.dataset.id).startsWith("picker:")||String(v.currentSrc||v.src||"").startsWith("blob:"))return false;
    if(spriteFailedAt&&Date.now()-spriteFailedAt<15000)return false;
    if(spriteLoading)return spriteLoading;
    spriteLoading=(async()=>{
      try{
        const id=encodeURIComponent(slide.dataset.id);
        const mr=await api("/api/previews/"+id+"/metadata");
        const im=new Image();im.decoding="async";const asset=window.DVaultPreview&&await DVaultPreview.asset(decodeURIComponent(id),"sprite");if(asset?.blob)im.src=URL.createObjectURL(asset.blob);else im.src="/api/previews/"+id+"/sprite";
        await new Promise((res,rej)=>{im.onload=res;im.onerror=rej});
        spriteMeta=mr;spriteImg=im;return true;
      }catch(_){spriteFailedAt=Date.now()-12000;return false}finally{spriteLoading=null}
    })();
    return spriteLoading;
  };
  const drawSpriteAt=async(t,seq)=>{
    if(!await loadSprite()){if(seq===prevSeq)drawVideoFrame();return}
    if(seq!==prevSeq)return;
    const interval=Number(spriteMeta.intervalSeconds)||4;
    const idx=Math.max(0,Math.min((Number(spriteMeta.frameCount)||1)-1,Math.floor(t/interval)));
    const fw=Number(spriteMeta.frameWidth)||160,fh=Number(spriteMeta.frameHeight)||90,cols=Number(spriteMeta.columns)||20;
    // Sprite frames are letterboxed into a 16:9 cell; crop to the real video
    // area so vertical Shorts show as a tall thumbnail without black bars.
    const vw=v.videoWidth||fw,vh=v.videoHeight||fh,sc=Math.min(fw/vw,fh/vh);
    const cw=Math.max(1,vw*sc),ch=Math.max(1,vh*sc);
    const sx=(idx%cols)*fw+(fw-cw)/2,sy=Math.floor(idx/cols)*fh+(fh-ch)/2;
    // Fixed portrait popup (5:8). Centre-crop the frame to fill it - never stretch.
    const c=coverCrop(sx,sy,cw,ch);
    sizePrevCanvas();
    prevCanvas.style.display="block";
    try{prevCtx.clearRect(0,0,PREV_W,PREV_H);prevCtx.drawImage(spriteImg,c.x,c.y,c.w,c.h,0,0,PREV_W,PREV_H)}catch(_){}
  };
  const fmtP=t=>{t=Math.max(0,Math.floor(t||0));const h=Math.floor(t/3600),m=Math.floor(t%3600/60),sec=t%60,p=n=>String(n).padStart(2,"0");return h?h+":"+p(m)+":"+p(sec):p(m)+":"+p(sec)};
  // Fallback when there is no sprite sheet (picker/blob videos, or sprite not
  // generated yet): paint the video's own current frame into the popup.
  const drawVideoFrame=()=>{
    if(!v.videoWidth||!v.videoHeight)return;
    const c=coverCrop(0,0,v.videoWidth,v.videoHeight);
    sizePrevCanvas();
    prevCanvas.style.display="block";
    try{prevCtx.drawImage(v,c.x,c.y,c.w,c.h,0,0,PREV_W,PREV_H)}catch(_){}
  };
  v.addEventListener("seeked",()=>{if(progressBar.classList.contains("dragging")&&!spriteImg)drawVideoFrame()});
  // The sprite is generated in the background; the moment it exists, drop the
  // "failed" cool-down so the very next scrub uses it.
  window.addEventListener("dvault:sprite-ready",e=>{if(String(e.detail?.id)===String(slide.dataset.id)){spriteFailedAt=0;spriteMeta=null;spriteImg=null}});
  function showPreview(e){
    if(!v.duration)return;
    const t=ratioFromEvent(e)*v.duration;
    // Centered popup (thumbnail + big "current / total" time), like short-drama apps.
    prevTime.textContent=fmtP(t)+" / "+fmtP(v.duration);
    prevBox.classList.add("show");
    drawSpriteAt(t,++prevSeq);
  }
  function hidePreview(){prevSeq++;prevBox.classList.remove("show")}
  progressBar.addEventListener("pointermove",e=>{
    if(e.pointerType==="mouse"&&!progressBar.classList.contains("dragging"))showPreview(e);
  });
  progressBar.addEventListener("pointerleave",()=>{if(!progressBar.classList.contains("dragging"))hidePreview()});
  progressBar.addEventListener("pointerdown",e=>{
    e.stopPropagation();
    progressBar.setPointerCapture(e.pointerId);
    progressBar.classList.add("dragging");
    showUI();
    wasPlayingBeforeDrag=!v.paused&&!v.ended;
    wasReverseBeforeDrag=!!window.DVReverse?.isActive(v);
    window.DVReverse?.stop(v,true);
    v.pause();
    seekTo(ratioFromEvent(e));
    showPreview(e);
  });
  progressBar.addEventListener("pointermove",e=>{
    if(!progressBar.classList.contains("dragging"))return;
    e.stopPropagation();
    seekTo(ratioFromEvent(e));
    showPreview(e);
  });
  function endDrag(e){
    if(!progressBar.classList.contains("dragging"))return;
    e.stopPropagation();
    progressBar.classList.remove("dragging");
    seekTo(ratioFromEvent(e));
    hidePreview();
    if(wasReverseBeforeDrag){wasReverseBeforeDrag=false;window.DVReverse?.start(v,()=>updateCenterIcon(slide,v));updateCenterIcon(slide,v)}
    else if(wasPlayingBeforeDrag)v.play().catch(()=>{});
    scheduleHide();
  }
  progressBar.addEventListener("pointerup",endDrag);
  progressBar.addEventListener("pointercancel",endDrag);
  progressBar.addEventListener("click",e=>e.stopPropagation());

  slide.querySelector(".short-reverse-btn").onclick=e=>{e.stopPropagation();toggleShortReverse(slide)};
  slide.querySelector(".short-mute-btn").onclick=e=>{
    e.stopPropagation();
    muted=!muted;
    localStorage.setItem("mytube_shorts_muted",muted?"1":"0");
    $$(".short-video").forEach(vv=>vv.muted=muted);
    $$(".short-mute-btn").forEach(b=>b.classList.toggle("is-muted",muted));
  };

  slide.querySelector(".short-search-btn").onclick=e=>{
    e.stopPropagation();
    location.href="/?focusSearch=1";
  };

  slide.querySelector(".short-more-btn").onclick=e=>{
    e.stopPropagation();
    openMoreMenu(slide);
  };

  const likeBtn=slide.querySelector(".short-like-btn");
  likeBtn.onclick=async e=>{
    e.stopPropagation();
    if(offlineGuard())return;
    const id=slide.dataset.id;
    // Flip the heart instantly (optimistic update) instead of waiting on the
    // network round-trip, then reconcile with — or roll back to match —
    // whatever the server actually returns.
    const wasLiked=likeBtn.classList.contains("liked");
    likeBtn.classList.toggle("liked",!wasLiked);
    likeBtn.querySelector(".short-like-label").textContent=wasLiked?"Like":"Liked";
    try{
      const r=await api("/api/videos/"+encodeURIComponent(id)+"/like",{method:"POST"});
      likeBtn.classList.toggle("liked",r.active);
      likeBtn.querySelector(".short-like-label").textContent=r.active?"Liked":"Like";
      const item=items.find(x=>String(x.id)===String(id));if(item)item.liked=r.active;
    }catch(err){
      likeBtn.classList.toggle("liked",wasLiked);
      likeBtn.querySelector(".short-like-label").textContent=wasLiked?"Liked":"Like";
      toast(err.message);
    }
  };

  const favBtn=slide.querySelector(".short-fav-btn");
  favBtn.onclick=async e=>{
    e.stopPropagation();
    if(offlineGuard())return;
    const id=slide.dataset.id;
    const wasFaved=favBtn.classList.contains("faved");
    favBtn.classList.toggle("faved",!wasFaved);
    favBtn.querySelector(".short-fav-star").textContent=wasFaved?"☆":"★";
    favBtn.querySelector(".short-rail-count").textContent=wasFaved?"Favorite":"Saved";
    try{
      const r=await api("/api/videos/"+encodeURIComponent(id)+"/favorite",{method:"POST"});
      favBtn.classList.toggle("faved",r.active);
      favBtn.querySelector(".short-fav-star").textContent=r.active?"★":"☆";
      favBtn.querySelector(".short-rail-count").textContent=r.active?"Saved":"Favorite";
      const item=items.find(x=>String(x.id)===String(id));if(item)item.favorite=r.active;
    }catch(err){
      favBtn.classList.toggle("faved",wasFaved);
      favBtn.querySelector(".short-fav-star").textContent=wasFaved?"★":"☆";
      favBtn.querySelector(".short-rail-count").textContent=wasFaved?"Saved":"Favorite";
      toast(err.message);
    }
  };

  // Rail "Screenshot" button — grabs whatever frame the video is currently
  // paused/playing on and saves it as a compressed JPEG, same-origin canvas
  // capture so no server round-trip is needed.
  const screenshotBtn=slide.querySelector(".short-screenshot-btn");
  screenshotBtn.onclick=async e=>{
    e.stopPropagation();
    const vid=slide.querySelector(".short-video");
    if(!vid||!vid.videoWidth){toast("Video isn't ready yet");return}
    try{
      const canvas=document.createElement("canvas");
      canvas.width=vid.videoWidth;
      canvas.height=vid.videoHeight;
      canvas.getContext("2d").drawImage(vid,0,0,canvas.width,canvas.height);
      // toDataURL, not toBlob - see the comment on dataUrlToBlob above for
      // why: toBlob's callback runs late enough that the resulting download
      // can lose its connection to this click and get silently dropped by
      // some browsers.
      const dataUrl=canvas.toDataURL("image/jpeg",0.85);
      const blob=dataUrlToBlob(dataUrl);
      try{
        const result=await saveCapturedFrame(blob,"short-"+(slide.dataset.id||"screenshot")+".jpg");
        if(result==="saved")toast("Screenshot saved");
      }catch{
        toast("Couldn't capture screenshot");
      }
    }catch(err){
      toast("Couldn't capture screenshot");
    }
  };

  // Rail "Save" button — saves the short into the app's own IndexedDB
  // storage (in-app Downloads page), instead of handing it to the OS/system
  // file manager. Downloading straight to device storage now lives in the
  // ⋮ more menu ("Download to device"), wired further down.
  const downloadBtn=slide.querySelector(".short-download-btn");
  downloadBtn.onclick=async e=>{
    e.stopPropagation();
    if(downloadBtn.disabled)return;
    if(offlineGuard())return;
    if(!window.AppDownloads){
      toast("In-app downloads aren't supported in this browser.");
      return;
    }
    const id=slide.dataset.id;
    const item=items.find(x=>String(x.id)===String(id));
    const streamUrl="/api/videos/"+encodeURIComponent(id)+"/stream";
    const label=downloadBtn.querySelector(".short-rail-count");
    const originalLabel=label.textContent;
    downloadBtn.disabled=true;
    label.textContent="Saving…";
    try{
      // Uses AppDownloads.startDownload (see idb-downloads.js) rather than a
      // plain fetch here, so this save keeps going via Background Fetch —
      // with its own system notification — even if the app is backgrounded
      // or closed mid-download, instead of dying with the tab.
      const handle=AppDownloads.startDownload({
        id,title:(item&&item.title)||"short",streamUrl,
        posterUrl:(item&&item.thumbnail)||undefined,
        onProgress:({received,total})=>{
          label.textContent=total
            ?Math.min(99,Math.round(received/total*100))+"%"
            :(received/1048576).toFixed(1)+"MB";
        }
      });
      await handle.promise;
      downloadedIds.add(String(id));
      downloadBtn.classList.add("is-saved");
      const iconEl=downloadBtn.querySelector(".short-rail-icon");
      if(iconEl)iconEl.textContent="✓";
      label.textContent="Saved";
      toast("Saved in app storage");
    }catch(err){
      toast(err.message||"Couldn't save this video in the app.");
      label.textContent=originalLabel;
      downloadBtn.disabled=false;
    }
  };
}

// ---- Three-dot "more" menu: speed + quality + PiP + copy link ----
const moreMenu=$("#shortsMoreMenu"),menuBackdrop=$("#shortsMenuBackdrop"),moreMain=$("#shortsMoreMain"),
  speedPanel=$("#shortsSpeedPanel"),qualityPanel=$("#shortsQualityPanel"),
  speedBtn=$("#shortsSpeedBtn"),qualityBtn=$("#shortsQualityBtn"),
  speedValue=$("#shortsSpeedValue"),qualityValueEl=$("#shortsQualityValue"),
  pipBtn=$("#shortsPipBtn"),reportBtn=$("#shortsReportBtn"),qualityStatus=$("#shortsQualityStatus"),
  watchFullBtn=$("#shortsWatchFullBtn"),removeBtn=$("#shortsRemoveBtn"),downloadDeviceBtn=$("#shortsDownloadDeviceBtn"),
  detailsBtn=$("#shortsDetailsBtn"),detailsPanel=$("#shortsDetailsPanel"),detailsBody=$("#shortsDetailsBody"),
  watchLaterBtn=$("#shortsWatchLaterBtn"),watchLaterLabel=$("#shortsWatchLaterLabel");

function showPanel(panel){
  moreMain.classList.add("hidden");speedPanel.classList.add("hidden");qualityPanel.classList.add("hidden");detailsPanel.classList.add("hidden");
  panel.classList.remove("hidden");
}
// "Save to Watch Later" label follows the current Short's saved state. The
// bookmark icon stays an outline either way — only the wording changes.
function refreshWatchLaterLabel(slide){
  const id=slide&&slide.dataset.id;
  const item=items.find(x=>String(x.id)===String(id));
  watchLaterLabel.textContent=item&&item.watchLater?"Remove from Watch Later":"Save to Watch Later";
}
function openMoreMenu(slide){
  currentMenuSlide=slide;
  refreshWatchLaterLabel(slide);
  moreMain.classList.remove("hidden");speedPanel.classList.add("hidden");qualityPanel.classList.add("hidden");detailsPanel.classList.add("hidden");
  moreMenu.hidden=false;menuBackdrop.hidden=false;
}
function closeMoreMenu(){moreMenu.hidden=true;menuBackdrop.hidden=true}
menuBackdrop.onclick=closeMoreMenu;
speedBtn.onclick=()=>showPanel(speedPanel);
// Reverse play (top-bar button): from the current spot, or from the end if the Short is at its very start.
function toggleShortReverse(slide){
  const v=slide&&slide.querySelector("video");
  if(!v)return;
  if(window.DVReverse?.isActive(v)){DVReverse.stop(v);updateCenterIcon(slide,v);return}
  const ok=window.DVReverse?.start(v,()=>updateCenterIcon(slide,v));
  if(ok)updateCenterIcon(slide,v);else toast("Short is not ready yet");
}
qualityBtn.onclick=()=>showPanel(qualityPanel);

// ---- Details: everything known about the Short's file, gathered from the
// item data already loaded for the feed plus the slide's own <video> element
// (resolution / real duration). Nothing new is fetched.
function detailQualityLabel(w,h){
  if(!w||!h)return "";
  const e=Math.max(Math.min(w,h),Math.round(Math.max(w,h)*9/16));
  if(e>=2000)return "4K";if(e>=1300)return "2K";if(e>=1000)return "1080p";
  if(e>=680)return "720p";if(e>=460)return "480p";if(e>=340)return "360p";
  return e+"p";
}
function detailDuration(sec){
  if(!isFinite(sec)||sec<=0)return "";
  sec=Math.round(sec);
  const h=Math.floor(sec/3600),m=Math.floor((sec%3600)/60),x=sec%60;
  return (h?h+":"+String(m).padStart(2,"0"):String(m))+":"+String(x).padStart(2,"0");
}
function detailDate(iso){
  if(!iso)return "";
  const d=new Date(iso);
  if(isNaN(d.getTime()))return "";
  return d.toLocaleString(undefined,{year:"numeric",month:"short",day:"numeric",hour:"numeric",minute:"2-digit"});
}
function detailGcd(a,b){return b?detailGcd(b,a%b):a}
function buildDetailRows(slide){
  const id=slide&&slide.dataset.id;
  const item=items.find(x=>String(x.id)===String(id))||{};
  const video=slide&&slide.querySelector(".short-video");
  const name=item.title||item.name||"";
  const ext=/\.([a-z0-9]+)$/i.exec(name);
  const w=video&&video.videoWidth,h=video&&video.videoHeight;
  let res="";
  if(w&&h){
    const g=detailGcd(w,h),q=detailQualityLabel(w,h);
    res=w+" × "+h+(q?" ("+q+")":"");
    // Orientation + aspect ratio, e.g. "Portrait (9:16)"
    res+="\n"+(h>w?"Portrait":h<w?"Landscape":"Square")+" ("+(w/g)+":"+(h/g)+")";
  }
  const bytes=Number(item.size);
  const sizeText=bytes>0?fmtSize(bytes)+" ("+bytes.toLocaleString()+" bytes)":"";
  const dur=detailDuration(video&&video.duration)||item.duration||"";
  const created=detailDate(item.createdTime);
  const src=item.offlineSrc?"Saved in app storage (offline copy)":(downloadedIds.has(String(id))?"Local storage · also saved in app":(String(id).startsWith("picker:")?"Local photos":"Local storage"));
  return [
    ["Title",name||"Untitled"],
    ["Type",ext?ext[1].toUpperCase():""],
    ["Resolution",res],
    ["Size",sizeText],
    ["Duration",dur],
    ["Uploaded",created?created+" · "+ago(item.createdTime):""],
    ["Views",String(Number(item.views||0).toLocaleString())],
    ["Liked",item.liked?"Yes":"No"],
    ["Favorite",item.favorite?"Yes":"No"],
    ["Source",src],
    ["Video ID",String(id||"")]
  ].filter(r=>r[1]);
}
detailsBtn.onclick=()=>{
  const slide=currentMenuSlide||feed.children[activeIndex];
  detailsBody.innerHTML="";
  buildDetailRows(slide).forEach(([k,v])=>{
    const row=document.createElement("div");row.className="shorts-details-row";
    const key=document.createElement("span");key.className="shorts-details-key";key.textContent=k;
    const val=document.createElement("span");val.className="shorts-details-val";
    // A "\n" in a value becomes a line break (used for resolution + orientation).
    v.split("\n").forEach((line,i)=>{if(i)val.appendChild(document.createElement("br"));val.appendChild(document.createTextNode(line))});
    row.appendChild(key);row.appendChild(val);detailsBody.appendChild(row);
  });
  detailsBody.scrollTop=0;
  showPanel(detailsPanel);
};
$$("[data-back]").forEach(b=>b.onclick=()=>showPanel(moreMain));

$$("#shortsSpeedPanel [data-speed]").forEach(b=>b.onclick=()=>{
  speed=+b.dataset.speed;
  $$(".short-video").forEach(v=>v.playbackRate=speed);
  speedValue.textContent=speed===1?"Normal":speed+"×";
  $$("#shortsSpeedPanel [data-speed]").forEach(x=>x.classList.toggle("active",x===b));
  closeMoreMenu();
  toast("Speed: "+(speed===1?"Normal":speed+"×"));
});

$$("#shortsQualityPanel [data-quality]").forEach(b=>b.onclick=()=>{
  quality=b.dataset.quality;
  qualityValueEl.textContent=quality==="auto"?"Auto":"Original";
  $$("#shortsQualityPanel [data-quality]").forEach(x=>x.classList.toggle("active",x===b));
  qualityStatus.hidden=false;qualityStatus.textContent="Playing "+(quality==="auto"?"Auto":"Original");
  setTimeout(()=>qualityStatus.hidden=true,1200);
  closeMoreMenu();
});

watchFullBtn.onclick=()=>{
  closeMoreMenu();
  const slide=feed.children[activeIndex];
  const id=slide&&slide.dataset.id;
  if(id)location.href="/watch.html?id="+encodeURIComponent(id);
};

watchLaterBtn.onclick=async()=>{
  closeMoreMenu();
  if(offlineGuard())return;
  const slide=currentMenuSlide||feed.children[activeIndex];
  const id=slide&&slide.dataset.id;
  if(!id)return;
  const item=items.find(x=>String(x.id)===String(id));
  const was=!!(item&&item.watchLater);
  if(item)item.watchLater=!was;
  try{
    const r=await api("/api/videos/"+encodeURIComponent(id)+"/watchlater",{method:"POST"});
    if(item)item.watchLater=r.active;
    toast(r.active?"Saved to Watch Later":"Removed from Watch Later");
  }catch(err){
    if(item)item.watchLater=was;
    toast(err.message||"Couldn't update Watch Later");
  }
};

removeBtn.onclick=async()=>{
  closeMoreMenu();
  if(offlineGuard())return;
  const slide=feed.children[activeIndex];
  const id=slide&&slide.dataset.id;
  if(!id)return;
  try{
    await api("/api/videos/"+encodeURIComponent(id)+"/short",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({short:false})});
    const removedIndex=activeIndex;
    items=items.filter(x=>String(x.id)!==String(id));
    slide.remove();
    $$(".short-slide").forEach((s,i)=>{s.dataset.index=i});
    toast("Removed from Shorts");
    if(!items.length){emptyEl.hidden=false;return}
    activeIndex=-1;
    const nextIndex=Math.min(removedIndex,items.length-1);
    const nextSlide=feed.children[nextIndex];
    if(nextSlide){
      activateSlide(nextIndex,nextSlide);
      nextSlide.scrollIntoView({block:"start"});
    }
  }catch(err){toast(err.message)}
};

// Download to device — the file-manager/OS download that used to live on
// the rail "Save" button. Saves the video as a real file on the device
// instead of into the app's own storage.
downloadDeviceBtn.onclick=async()=>{
  closeMoreMenu();
  if(offlineGuard())return;
  const slide=feed.children[activeIndex];
  const id=slide&&slide.dataset.id;
  if(!id)return;
  const item=items.find(x=>String(x.id)===String(id));
  const streamUrl="/api/videos/"+encodeURIComponent(id)+"/stream";
  toast("Checking…");
  try{
    const probe=await fetch(streamUrl,{headers:{Range:"bytes=0-1"},credentials:"include"});
    if(!probe.ok){
      const j=await probe.json().catch(()=>({}));
      throw Error(j.error||"Download failed.");
    }
    probe.body?.cancel().catch(()=>{});
    const a=document.createElement("a");
    a.href=streamUrl+"?download=1";
    a.download=(item&&item.title)||"short";
    document.body.appendChild(a);a.click();a.remove();
    toast("Downloading…");
  }catch(err){
    toast(err.message||"Download failed. Try again in a moment.");
  }
};

pipBtn.onclick=async()=>{
  closeMoreMenu();
  const slide=feed.children[activeIndex];
  const v=slide&&slide.querySelector("video");
  if(!v)return;
  try{
    if(document.pictureInPictureElement)await document.exitPictureInPicture();
    else await v.requestPictureInPicture();
  }catch(err){toast("Picture-in-picture isn't available for this video")}
};

reportBtn.onclick=()=>{
  closeMoreMenu();
  const slide=feed.children[activeIndex];
  const id=slide&&slide.dataset.id;
  const url=location.origin+"/shorts.html?id="+encodeURIComponent(id||"");
  if(navigator.clipboard&&navigator.clipboard.writeText){
    navigator.clipboard.writeText(url).then(()=>toast("Link copied")).catch(()=>toast(url));
  }else toast(url);
};

// Keyboard navigation for desktop.
document.addEventListener("keydown",e=>{
  if(!moreMenu.hidden)return;
  if(e.key==="ArrowDown"){e.preventDefault();feed.children[activeIndex+1]?.scrollIntoView({behavior:"smooth"});}
  else if(e.key==="ArrowUp"){e.preventDefault();feed.children[activeIndex-1]?.scrollIntoView({behavior:"smooth"});}
  else if(e.key==="ArrowLeft"){
    e.preventDefault();
    const slide=feed.children[activeIndex],v=slide&&slide.querySelector("video");
    if(v&&v.duration)v.currentTime=Math.max(0,v.currentTime-10);
  }
  else if(e.key==="ArrowRight"){
    e.preventDefault();
    const slide=feed.children[activeIndex],v=slide&&slide.querySelector("video");
    if(v&&v.duration)v.currentTime=Math.min(v.duration,v.currentTime+10);
  }
  else if(e.code==="Space"){
    e.preventDefault();
    const slide=feed.children[activeIndex],v=slide&&slide.querySelector("video");
    if(v){if(v.paused||v.ended)v.play().catch(()=>{});else v.pause();}
  }
});

// Offline fallback for the Shorts feed: when the video list can't be
// fetched (no connection, or any other network failure), play whatever was
// saved locally via "Save"/"Download offline" instead of just erroring out.
// Returns true if it managed to start a feed of downloaded videos.
async function startOfflineShorts(){
  if(!window.AppDownloads)return false;
  let downloads=[];
  try{downloads=await AppDownloads.listVideos()}catch{return false}
  if(!downloads.length)return false;
  if(window.MyTubeOffline)MyTubeOffline.showBanner("You're offline — playing your downloaded videos.");
  downloads.sort((a,b)=>(b.savedAt||0)-(a.savedAt||0));
  downloadedIds=new Set(downloads.map(d=>String(d.id)));
  items=downloads.map(d=>({
    id:d.id,
    title:d.title||"Downloaded video",
    thumbnail:d.poster?URL.createObjectURL(d.poster):"",
    views:0,
    createdTime:d.savedAt?new Date(d.savedAt).toISOString():null,
    liked:false,
    favorite:false,
    isShort:true,
    size:d.size||(d.blob&&d.blob.size)||null,
    offlineSrc:URL.createObjectURL(d.blob)
  }));
  loadingEl.classList.add("hidden");
  render();
  const slides=$$(".short-slide");
  slides[0].scrollIntoView({block:"start"});
  setupObserver();
  activateSlide(0,slides[0]);
  return true;
}

async function main(){
  // Confirms which account is signed in *before* touching the offline
  // downloads cache below (idb-downloads.js), so it's correctly scoped to
  // this account from the first read - see local storage identity. Not fatal if
  // it fails (e.g. offline); the /api/videos call right after still
  // enforces the real, server-side per-account isolation.
  
  const downloadedIdsReady=refreshDownloadedIds();
  let all;
  try{
    all=await api("/api/videos");
  }catch(err){
    if(await startOfflineShorts())return;
    loadingEl.classList.add("hidden");
    toast(err.message||"Could not load videos");
    return;
  }
  await downloadedIdsReady;
  items=all.filter(v=>v.isShort&&(!listPredicate||listPredicate(v)));
  if(!listPredicate&&startId&&!items.some(v=>String(v.id)===String(startId))){
    const direct=all.find(v=>String(v.id)===String(startId));
    if(direct)items.unshift(direct);
  }
  // Shuffle so every time you start playing Shorts you get a fresh running
  // order (Fisher-Yates). This is the only moment the recommended order
  // changes — saved (for the general/non-liked list) so the home page's
  // Shorts grid matches it too until the next time you play Shorts.
  for(let i=items.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    [items[i],items[j]]=[items[j],items[i]];
  }
  if(!listPredicate){
    try{localStorage.setItem("mytube_shorts_order",JSON.stringify(items.map(v=>v.id)))}catch{}
  }
  loadingEl.classList.add("hidden");
  if(!items.length){emptyEl.hidden=false;return}
  let startIndex=0;
  if(startId){const i=items.findIndex(v=>String(v.id)===String(startId));if(i>=0)startIndex=i}
  else if(wantRandom&&items.length>1){startIndex=Math.floor(Math.random()*items.length)}
  render();
  const slides=$$(".short-slide");
  slides[startIndex].scrollIntoView({block:"start"});
  setupObserver();
  activateSlide(startIndex,slides[startIndex]);
}
main();
