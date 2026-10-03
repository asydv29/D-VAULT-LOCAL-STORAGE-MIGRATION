const $=s=>document.querySelector(s);
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const api=async(u,o)=>{const r=await fetch(u,o);if(!r.ok){const j=await r.json().catch(()=>({}));throw Object.assign(Error(j.error||r.statusText),{status:r.status})}return r.json()};

const params=new URLSearchParams(location.search);
const likedOnly=params.get('list')==='liked';

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

// Active-nav highlighting (including the "Liked" item while browsing
// /photos.html?list=liked) is handled by sidebar.js's shared
// highlightActive() — DP_SIDEBAR_SKIP above only opts this page out of
// sidebar.js's toggle/liked-group wiring, not its active-state logic.

if(likedOnly){
  $('#photosTitle').textContent='Liked photos';
  const importBtnEl=$('#importBtn');
  if(importBtnEl)importBtnEl.hidden=true;
}

const toastEl=$("#toast");
const show=t=>{if(!toastEl)return;toastEl.textContent=t;toastEl.classList.add("show");clearTimeout(show._t);show._t=setTimeout(()=>toastEl.classList.remove("show"),2200)};

function ago(d){if(!d)return 'Recently';const s=Math.max(0,(Date.now()-new Date(d).getTime())/1000);if(s<3600)return Math.floor(s/60)+' minutes ago';if(s<86400)return Math.floor(s/3600)+' hours ago';if(s<2592000)return Math.floor(s/86400)+' days ago';if(s<31536000)return Math.floor(s/2592000)+' months ago';return Math.floor(s/31536000)+' years ago'}

let all=[];       // every photo (or every liked photo, if likedOnly)
let shown=[];      // after the on-page search filter, what's actually rendered
let viewerIndex=-1;
let slideshowTimer=null;

function renderEmpty(){
  const icon=likedOnly?'♡':'🖼';
  const title=likedOnly?'No liked photos yet':'No photos found';
  const text=likedOnly?'Open a photo and tap ♡ to like it — it will show up here.':'Photos and images from your selected local storage will show up here.';
  return `<div class="empty-state"><div class="empty-icon">${icon}</div><h2>${title}</h2><p>${text}</p></div>`;
}

// A Drive thumbnail can fail transiently - most commonly remote's own
// per-account rate limit (see src/remote-storage-do.js's friendlyDriveError) when a
// lot of requests land on the same connected Drive account at once, or a
// briefly expired token. Retry twice with a growing delay before giving up;
// if it still fails, swap in a plain placeholder icon instead of leaving
// the browser's broken-image glyph in the grid forever.
window.handlePhotoThumbFail=function(img){
  const tries=Number(img.dataset.retries||0);
  if(tries>=2){
    img.style.display='none';
    const tile=img.closest('.photo-tile');
    if(tile&&!tile.querySelector('.photo-fallback-icon')){
      const span=document.createElement('span');
      span.className='photo-fallback-icon';
      span.textContent=tile.querySelector('.photo-video-badge')?'▶':'🖼';
      span.style.cssText='display:flex;align-items:center;justify-content:center;width:100%;height:100%;font-size:28px;opacity:.5';
      tile.prepend(span);
    }
    return;
  }
  img.dataset.retries=String(tries+1);
  setTimeout(()=>{
    const sep=img.src.indexOf('?')===-1?'?':'&';
    img.src=img.src.replace(/[?&]retry=\d+/,'')+sep+'retry='+Date.now();
  },1200*(tries+1));
};
function render(){
  const q=($('#photosSearch').value||'').trim().toLowerCase();
  shown=q?all.filter(p=>(p.title||'').toLowerCase().includes(q)):all.slice();
  $('#photosCount').textContent=shown.length?(shown.length+(shown.length===1?' photo':' photos')):'';
  const grid=$('#grid');
  grid.innerHTML=shown.length?shown.map((p,i)=>`<button type="button" class="photo-tile" data-photo-index="${i}" aria-label="${esc(p.title)}"><img loading="lazy" decoding="async" src="${esc(p.thumb)}" alt="" onerror="window.handlePhotoThumbFail&&window.handlePhotoThumbFail(this)">${p.isVideo?'<span class="photo-video-badge">▶</span>':''}${p.liked?'<span class="photo-like-badge">♥</span>':''}</button>`).join(''):renderEmpty();
  grid.querySelectorAll('[data-photo-index]').forEach(b=>b.onclick=()=>openViewer(Number(b.dataset.photoIndex)));
}

// Same idea as the Home page's instant-back cache: remember the last photo
// list for this tab so coming back to Photos paints immediately, then quietly
// refresh underneath instead of showing a skeleton while /api/photos (which
// lists the whole Drive) runs.
const PHOTOS_CACHE_KEY='dp_photos_cache'+(likedOnly?'_liked':'');
function photosSig(list){return list.map(p=>p.id+'|'+p.thumb+'|'+(p.liked?1:0)+'|'+(p.title||'')).join('\n')}
function loadPhotosCache(){
  try{
    const owner='local';
    if(!owner)return null;
    const c=JSON.parse(sessionStorage.getItem(PHOTOS_CACHE_KEY)||'null');
    return c&&c.owner===owner&&Array.isArray(c.all)&&c.all.length?c:null;
  }catch{return null}
}
function savePhotosCache(){
  try{
    const owner='local';
    if(!owner)return;
    sessionStorage.setItem(PHOTOS_CACHE_KEY,JSON.stringify({owner,all}));
  }catch{}
}

async function load(){
  const grid=$('#grid');
  const cached=loadPhotosCache();
  if(cached){
    all=cached.all;
    render();
  }else{
    grid.innerHTML=Array.from({length:10}).map(()=>'<div class="photo-tile skel-card"><div class="skel-thumb" style="width:100%;height:100%"></div></div>').join('');
  }
  // /api/me and /api/photos don't depend on each other - start both now.
  const mePromise=api('/api/me');
  const photosPromise=api('/api/photos');
  mePromise.catch(()=>{});photosPromise.catch(()=>{});
  let me;
  try{
    me=await mePromise;
  }catch(e){
    location.href='/settings.html';
    return;
  }
  
  $('#accountStatus').textContent='Local storage vault';
  {const initial=((me.name||me.email||'').trim()[0]||'A').toUpperCase();const av=$('#avatarInitial');if(av)av.textContent=initial}
  try{
    const photos=await photosPromise;
    const next=likedOnly?photos.filter(p=>p.liked):photos;
    next.sort((a,b)=>new Date(b.createdTime||0)-new Date(a.createdTime||0));
    const unchanged=cached&&photosSig(next)===photosSig(all);
    all=next;
    if(!unchanged)render(); // nothing changed since the cached paint -> leave the grid (and its loaded images) alone
    savePhotosCache();
  }catch(e){
    if(e.status===401){location.href='/settings.html';return}
    all=[];
    if(/Local storage isn't selected/.test(e.message||'')){
      $('#accountStatus').textContent='Local storage is not connected yet.';
      grid.innerHTML='<div class="empty-state"><div class="empty-icon">🔗</div><h2>Select your local storage</h2><p>Select your local storage on the Settings page to see your photos here.</p></div>';
      return;
    }
    $('#accountStatus').textContent='Could not load photos: '+(e.message||'Unknown error');
    grid.innerHTML=renderEmpty();
  }
}

$('#photosSearchForm').onsubmit=e=>{e.preventDefault();render()};
let photosSearchTimer=0;$('#photosSearch').oninput=()=>{clearTimeout(photosSearchTimer);photosSearchTimer=setTimeout(render,120)};

// Title-bar search icon expands the search box in place; collapses again
// once it's empty and loses focus.
(function(){
  const btn=$('#photosSearchToggleBtn'),form=$('#photosSearchForm'),input=$('#photosSearch');
  if(!btn||!form||!input)return;
  function openSearch(){form.classList.add('open');btn.setAttribute('aria-expanded','true');input.focus()}
  function closeSearch(){form.classList.remove('open');btn.setAttribute('aria-expanded','false')}
  btn.onclick=()=>{form.classList.contains('open')?(input.value.trim()?input.focus():closeSearch()):openSearch()};
  input.addEventListener('keydown',e=>{if(e.key==='Escape'){input.value='';render();closeSearch()}});
  document.addEventListener('click',e=>{if(form.classList.contains('open')&&!input.value.trim()&&!form.contains(e.target)&&!btn.contains(e.target))closeSearch()});
})();

// Title-bar account button: mirrors the "You" entry point on the other
// pages (sign-in check with a quick toast, or bounce to login).
if($('#avatarBtn'))$('#avatarBtn').onclick=async()=>{const a=await window.DVaultStorage.getActive();show(a?'Storage: '+a.name:'No storage folder selected')};

// ---- Instant photo swaps ----
// A full-size original can be several MB, and it used to start downloading
// only at the moment you tapped Next/Prev, with the previous photo sitting
// frozen on screen until the new one arrived. Now:
//   1. the small preview the grid already loaded is shown immediately,
//   2. the full-size version loads in the background and swaps in when ready,
//   3. once it's in, the neighbouring photos are fetched ahead of time so the
//      next swipe (or the next slideshow step) is already sitting in cache.
// Neighbour preloading is skipped on Data Saver / 2G, and only goes 2 ahead
// on a fast (4G) connection, so it doesn't quietly burn a data plan.
const fullPhotoCache=new Map(); // url -> Image, most recently used last
let photoToken=0;               // bumped on every navigation so a late load can't overwrite a newer photo
function loadFullPhoto(url){
  let im=fullPhotoCache.get(url);
  if(im){fullPhotoCache.delete(url)}
  else{
    im=new Image();
    im.decoding='async';
    im.src=url;
  }
  fullPhotoCache.set(url,im); // (re)insert as most recent
  while(fullPhotoCache.size>7)fullPhotoCache.delete(fullPhotoCache.keys().next().value);
  return im;
}
function preloadNeighbors(){
  if(shown.length<2||viewerIndex<0)return;
  const conn=navigator.connection;
  if(conn&&(conn.saveData||/2g$/.test(conn.effectiveType||'')))return;
  const n=shown.length,fast=!conn||conn.effectiveType==='4g';
  (fast?[1,-1,2]:[1]).forEach(d=>{
    const q=shown[(viewerIndex+d+n)%n];
    if(q&&!q.isVideo&&q.url)loadFullPhoto(q.url);
  });
}
function showPhoto(imgEl,p){
  const token=++photoToken;
  const full=loadFullPhoto(p.url);
  const apply=()=>{
    if(token!==photoToken)return; // navigated away while this was loading
    imgEl.src=p.url;              // already downloaded, so this is instant
    preloadNeighbors();
  };
  if(full.complete&&full.naturalWidth>0){apply();return}
  if(p.thumb)imgEl.src=p.thumb; // already in the browser's cache from the grid
  full.addEventListener('load',apply,{once:true});
  full.addEventListener('error',()=>{
    // Keep the preview on screen if there is one; only fall back to
    // pointing the <img> at the original (the old behaviour) when there
    // isn't, so a failure still shows the usual broken-image state.
    if(token===photoToken&&!p.thumb)imgEl.src=p.url;
  },{once:true});
}

// ---- Full-screen viewer ----
function updateViewer(){
  const p=shown[viewerIndex];
  if(!p)return closeViewer();
  resetZoom();
  try{window.getSelection&&window.getSelection().removeAllRanges()}catch(_){}
  document.querySelectorAll('.viewer-zoom').forEach(b=>b.hidden=!!p.isVideo);
  $('#viewerCounter').textContent=(viewerIndex+1)+' / '+shown.length;
  const imgEl=$('#viewerImg'),videoEl=$('#viewerVideo');
  videoEl.pause();
  videoEl.removeAttribute('src');
  videoEl.load();
  if(p.isVideo){
    photoToken++; // cancel any photo still loading in the background
    imgEl.hidden=true;
    videoEl.hidden=false;
    videoEl.src=p.url;
  }else{
    videoEl.hidden=true;
    imgEl.hidden=false;
    imgEl.alt=p.title||'';
    showPhoto(imgEl,p);
  }
  $('#viewerDownload').href=p.url;
  const likeBtn=$('#viewerLike');
  likeBtn.classList.toggle('is-liked',!!p.liked);
  $('#viewerPrev').style.visibility=shown.length>1?'visible':'hidden';
  $('#viewerNext').style.visibility=shown.length>1?'visible':'hidden';
  renderFilmstrip();
}
function renderFilmstrip(){
  const strip=$('#viewerFilmstrip');
  strip.innerHTML=shown.map((p,i)=>`<button type="button" class="${i===viewerIndex?'active':''}" data-fs-index="${i}" aria-label="${esc(p.title||'')}"><img loading="lazy" decoding="async" src="${esc(p.thumb)}" alt=""></button>`).join('');
  strip.querySelectorAll('[data-fs-index]').forEach(b=>b.onclick=()=>{stopSlideshow();viewerIndex=Number(b.dataset.fsIndex);updateViewer()});
  const activeBtn=strip.querySelector('button.active');
  if(activeBtn)activeBtn.scrollIntoView({inline:'center',block:'nearest'});
}
function openViewer(i){
  // One history entry per viewer session, so Back (browser/phone) closes the
  // viewer - and leaves fullscreen - instead of leaving the Photos page.
  if(!(history.state&&history.state.dpViewer))history.pushState({dpViewer:1},'');
  viewerIndex=i;
  updateViewer();
  $('#photoViewer').classList.add('show');
}
function closeViewer(fromPop){
  resetZoom();
  // A hidden element can stay the fullscreen element and leave the page
  // blank/unclickable - always leave fullscreen when the viewer closes.
  if(document.fullscreenElement){try{document.exitFullscreen().catch(()=>{})}catch(_){}}
  viewerIndex=-1;
  photoToken++; // any photo still loading must not touch the closed viewer
  stopSlideshow();
  $('#photoViewer').classList.remove('show');
  $('#viewerMoreMenu').classList.remove('show');
  const videoEl=$('#viewerVideo');
  videoEl.pause();
  videoEl.removeAttribute('src');
  videoEl.load();
  // Viewer opened with a history entry: closing via the X must consume it.
  if(fromPop!==true&&history.state&&history.state.dpViewer)history.back();
}
function stopSlideshow(){
  if(!slideshowTimer)return;
  clearInterval(slideshowTimer);
  slideshowTimer=null;
  const btn=$('#viewerSlideshow');
  if(btn)btn.textContent='Start slideshow';
}
function startSlideshow(){
  if(shown.length<2)return;
  slideshowTimer=setInterval(()=>{
    viewerIndex=(viewerIndex+1)%shown.length;
    updateViewer();
  },3000);
  $('#viewerSlideshow').textContent='Stop slideshow';
}
$('#viewerClose').onclick=closeViewer;
$('#photoViewer').addEventListener('click',e=>{if(e.target.id==='photoViewer')closeViewer()});
$('#viewerPrev').onclick=()=>{if(!shown.length)return;stopSlideshow();viewerIndex=(viewerIndex-1+shown.length)%shown.length;updateViewer()};
$('#viewerNext').onclick=()=>{if(!shown.length)return;stopSlideshow();viewerIndex=(viewerIndex+1)%shown.length;updateViewer()};
$('#viewerMore').onclick=e=>{e.stopPropagation();$('#viewerMoreMenu').classList.toggle('show')};
$('#viewerSlideshow').onclick=()=>{
  $('#viewerMoreMenu').classList.remove('show');
  if(slideshowTimer)stopSlideshow();else startSlideshow();
};
// Fullscreen — same requestFullscreen/exitFullscreen approach used by the
// video players elsewhere in the app, applied to the whole photo-viewer
// overlay so the counter/nav arrows stay usable while zoomed to fullscreen.
const viewer=$('#photoViewer');
$('#viewerFullscreen').onclick=async()=>{
  $('#viewerMoreMenu').classList.remove('show');
  try{
    if(document.fullscreenElement)await document.exitFullscreen();
    else await viewer.requestFullscreen();
  }catch(err){
    show(err.message||"Fullscreen isn't supported in this browser");
  }
};
document.addEventListener('fullscreenchange',()=>{
  const btn=$('#viewerFullscreen');
  if(btn)btn.textContent=document.fullscreenElement===viewer?'Exit fullscreen':'Fullscreen';
});
$('#viewerShare').onclick=async()=>{
  $('#viewerMoreMenu').classList.remove('show');
  const p=shown[viewerIndex];
  if(!p)return;
  const shareUrl=location.origin+p.url;
  try{
    if(navigator.share){
      await navigator.share({title:p.title||'Photo',url:shareUrl});
    }else if(navigator.clipboard){
      await navigator.clipboard.writeText(shareUrl);
      show('Link copied to clipboard');
    }else{
      show("Sharing isn't supported in this browser");
    }
  }catch(err){
    if(err&&err.name==='AbortError')return;
    show(err.message||'Could not share');
  }
};
document.addEventListener('click',e=>{
  const menu=$('#viewerMoreMenu');
  if(menu.classList.contains('show')&&!menu.contains(e.target)&&e.target.id!=='viewerMore')menu.classList.remove('show');
});
$('#viewerDelete').onclick=()=>{
  show('Deleting isn\'t connected yet — this needs a local storage permission first');
};
document.addEventListener('keydown',e=>{
  if(!$('#photoViewer').classList.contains('show'))return;
  if(e.key==='Escape')closeViewer();
  else if(e.key==='ArrowLeft')$('#viewerPrev').click();
  else if(e.key==='ArrowRight')$('#viewerNext').click();
});
$('#viewerLike').onclick=async()=>{
  const p=shown[viewerIndex];
  if(!p)return;
  const btn=$('#viewerLike');
  btn.disabled=true;
  try{
    const res=await api(p.likeUrl,{method:'POST'});
    p.liked=res.active;
    const master=all.find(x=>x.id===p.id);
    if(master)master.liked=res.active;
    if(likedOnly&&!res.active){
      // Unliking here means it should drop out of the Liked photos list.
      all=all.filter(x=>x.id!==p.id);
      render();
      closeViewer();
    }else{
      updateViewer();
      render();
    }
    show(res.active?'Added to Liked':'Removed from Liked');
  }catch(err){
    show(err.message||'Could not update like');
  }finally{
    btn.disabled=false;
  }
};

load();


// ---- Photo zoom (works normally and in fullscreen) ----
// Wheel / +,- keys / buttons / double-click / pinch to zoom; drag to pan when zoomed.
var zs=1,ztx=0,zty=0;
function zImg(){return document.getElementById('viewerImg')}
function applyZoom(anim){
  const im=zImg();if(!im)return;
  im.classList.toggle('zoom-anim',!!anim);
  im.classList.toggle('zoomed',zs>1);
  im.style.transform=zs===1&&!ztx&&!zty?'':`translate(${ztx}px,${zty}px) scale(${zs})`;
}
function resetZoom(){zs=1;ztx=0;zty=0;const im=zImg();if(im){im.classList.remove('panning');applyZoom(false)}}
function clampPan(){
  const im=zImg(),v=document.getElementById('photoViewer');if(!im||!v)return;
  const mx=Math.max(0,(im.offsetWidth*zs-v.clientWidth)/2),my=Math.max(0,(im.offsetHeight*zs-v.clientHeight)/2);
  ztx=Math.min(mx,Math.max(-mx,ztx));zty=Math.min(my,Math.max(-my,zty));
}
// Zoom to ns keeping the point (clientX,clientY) fixed under the finger/cursor.
function zoomTo(ns,cx,cy,anim){
  const im=zImg();if(!im||im.hidden)return;
  ns=Math.min(6,Math.max(1,ns));
  const r=im.getBoundingClientRect();
  if(cx==null){cx=r.left+r.width/2;cy=r.top+r.height/2}
  const lx=r.left+r.width/2-ztx,ly=r.top+r.height/2-zty; // layout centre (unaffected by pan)
  const px=cx-lx,py=cy-ly,k=ns/zs;
  ztx=px-(px-ztx)*k;zty=py-(py-zty)*k;zs=ns;
  if(zs<=1.001){zs=1;ztx=0;zty=0}else clampPan();
  applyZoom(anim);
}
(function(){
  const viewer=document.getElementById('photoViewer'),im=zImg();
  if(!viewer||!im)return;
  document.getElementById('viewerZoomIn').onclick=()=>zoomTo(zs*1.5,null,null,true);
  document.getElementById('viewerZoomOut').onclick=()=>zoomTo(zs/1.5,null,null,true);
  viewer.addEventListener('wheel',e=>{
    if(!viewer.classList.contains('show')||im.hidden||e.target.closest('.photo-viewer-bar,.photo-viewer-filmstrip'))return;
    e.preventDefault();
    zoomTo(zs*Math.exp(-e.deltaY*0.0015),e.clientX,e.clientY,false);
  },{passive:false});
  im.addEventListener('dblclick',e=>{e.preventDefault();zoomTo(zs>1?1:2.5,e.clientX,e.clientY,true)});
  const ptrs=new Map();let lastD=0,lastMx=0,lastMy=0,lastTap=0,moved=false;
  const mid=()=>{const a=[...ptrs.values()];return a.length===2?{x:(a[0].x+a[1].x)/2,y:(a[0].y+a[1].y)/2,d:Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y)}:{x:a[0].x,y:a[0].y,d:0}};
  im.addEventListener('pointerdown',e=>{
    if(im.hidden)return;
    ptrs.set(e.pointerId,{x:e.clientX,y:e.clientY});moved=false;
    try{im.setPointerCapture(e.pointerId)}catch(_){}
    const m=mid();lastMx=m.x;lastMy=m.y;lastD=m.d;
    if(zs>1)im.classList.add('panning');
  });
  im.addEventListener('pointermove',e=>{
    if(!ptrs.has(e.pointerId))return;
    ptrs.set(e.pointerId,{x:e.clientX,y:e.clientY});
    const m=mid();
    if(ptrs.size===2&&lastD){zoomTo(zs*m.d/lastD,m.x,m.y,false)}
    if(zs>1){ztx+=m.x-lastMx;zty+=m.y-lastMy;clampPan();applyZoom(false)}
    if(Math.abs(m.x-lastMx)+Math.abs(m.y-lastMy)>2)moved=true;
    lastMx=m.x;lastMy=m.y;lastD=m.d;
  });
  const end=e=>{
    if(!ptrs.has(e.pointerId))return;
    const wasOne=ptrs.size===1;ptrs.delete(e.pointerId);im.classList.remove('panning');
    if(ptrs.size===1){const m=mid();lastMx=m.x;lastMy=m.y;lastD=0}
    // double-tap on touch screens (dblclick doesn't fire reliably there)
    if(e.type==='pointerup'&&e.pointerType==='touch'&&wasOne&&!moved){
      const now=Date.now();
      if(now-lastTap<300){zoomTo(zs>1?1:2.5,e.clientX,e.clientY,true);lastTap=0}else lastTap=now;
    }
  };
  im.addEventListener('pointerup',end);im.addEventListener('pointercancel',end);
  document.addEventListener('keydown',e=>{
    if(!viewer.classList.contains('show')||im.hidden)return;
    if(e.key==='+'||e.key==='='){e.preventDefault();zoomTo(zs*1.5,null,null,true)}
    else if(e.key==='-'||e.key==='_'){e.preventDefault();zoomTo(zs/1.5,null,null,true)}
    else if(e.key==='0'){resetZoom()}
  });
  window.addEventListener('resize',()=>{if(zs>1){clampPan();applyZoom(false)}});
})();

window.addEventListener('popstate',()=>{if($('#photoViewer').classList.contains('show'))closeViewer(true)});
