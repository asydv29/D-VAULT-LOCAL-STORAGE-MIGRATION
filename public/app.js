const $=s=>document.querySelector(s);const params=new URLSearchParams(location.search);const list=params.get('list')||'';const view=params.get('view')||'';const folder=params.get('folder')||'';const playlist=params.get('playlist')||'';const initialQuery=params.get('q')||'';let all=[];let activeCat='';let folders=[];let playlists=[];
$('#search').value=initialQuery;
// Keep the current search text reflected in the URL (without adding a new
// history entry) so that clicking into a video and then using the browser's
// Back button returns to these same search results instead of resetting to
// the plain home screen.
function syncSearchUrl(){
  const q=($('#search').value||'').trim();
  const u=new URL(location.href);
  if(q)u.searchParams.set('q',q);else u.searchParams.delete('q');
  history.replaceState(history.state,'',u);
}
let recSeed=[];let firstLoadDone=false;let selectMode=false;let selected=new Set();let lastRendered=[];let downloadedIds=new Set();
// Home filter tabs (All / Videos / Shorts / Photos). Starts from the
// existing `view=shorts` param so a link like `/?list=liked&view=shorts`
// (reached via the Shorts tab while browsing Liked) lands on the right
// tab; otherwise defaults to 'all' (videos and Shorts together).
let homeFilter=view==='shorts'?'shorts':'all';
// Keeps the card menu's "Download offline"/"✓ Saved" state in sync with
// what's actually sitting in the app's IndexedDB storage (idb-downloads.js).
async function refreshDownloadedIds(){
  if(!window.AppDownloads)return;
  try{
    const items=await AppDownloads.listVideos();
    const next=new Set(items.map(x=>String(x.id)));
    const changed=next.size!==downloadedIds.size||[...next].some(x=>!downloadedIds.has(x));
    downloadedIds=next;
    if(changed)render();
  }catch{}
}
function shuffle(arr){const a=arr.slice();for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}
function shuffleRecommendations(){recSeed=shuffle(all.map(v=>v.id))}
function showSkeleton(){
  $('#grid').innerHTML=Array.from({length:8}).map(()=>`<div class="video-card skel-card"><div class="skel-thumb"></div><div class="skel-line"></div><div class="skel-line short"></div></div>`).join('');
}
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const api=async(u,o)=>{const r=await fetch(u,o);if(!r.ok){const j=await r.json().catch(()=>({}));throw Object.assign(Error(j.error||r.statusText),{status:r.status})}return r.json()};
const toast=(m)=>{const e=$('#toast');e.textContent=m;e.classList.add('show');clearTimeout(window.__toast);window.__toast=setTimeout(()=>e.classList.remove('show'),2200)};
function fmtViews(n){n=Number(n||0);if(n>=1e9)return (n/1e9).toFixed(1).replace('.0','')+'B views';if(n>=1e6)return (n/1e6).toFixed(1).replace('.0','')+'M views';if(n>=1e3)return (n/1e3).toFixed(1).replace('.0','')+'K views';return n+' views'}
function ago(d){if(!d)return 'Recently';const s=Math.max(0,(Date.now()-new Date(d).getTime())/1000);if(s<3600)return Math.floor(s/60)+' minutes ago';if(s<86400)return Math.floor(s/3600)+' hours ago';if(s<2592000)return Math.floor(s/86400)+' days ago';if(s<31536000)return Math.floor(s/2592000)+' months ago';return Math.floor(s/31536000)+' years ago'}
function fmtSize(b){b=Number(b);if(!b||b<0)return '';const u=['B','KB','MB','GB','TB'];let i=0;while(b>=1024&&i<u.length-1){b/=1024;i++}return (i?b.toFixed(1):String(Math.round(b)))+' '+u[i]}
// Card meta line: quality · views · file size · uploaded. Any part that isn't
// known yet (e.g. quality before a video's dimensions have been detected, or
// size for remote photos videos) is simply left out.
function cardStats(v){return [v.quality,fmtViews(v.views),fmtSize(v.size),ago(v.createdTime)].filter(Boolean).join(' · ')}
function historyIds(){try{return JSON.parse(localStorage.getItem('mytube_history')||'[]')}catch{return []}}
function addHistory(id){const a=historyIds().filter(x=>x!==id);a.unshift(id);localStorage.setItem('mytube_history',JSON.stringify(a.slice(0,100)))}
function shortsOrder(){try{return JSON.parse(localStorage.getItem('mytube_shorts_order')||'[]')}catch{return []}}
// history/shorts-order above are cleared on sign-out and on any detected
// account switch (see local storage identity) so they never mix between accounts
// sharing a browser.

// ---- Grid rendering -------------------------------------------------------
// render() used to replace the whole grid's innerHTML on every call: every
// filter switch (All/Videos/Shorts), search keystroke, silent refresh and
// orientation-detection reload threw away every <img>, re-parsed hundreds of
// cards, re-attached ~12 handlers per card, and replayed the entrance
// animation for all of them. Now each card is built once, keyed by video id,
// and reused as long as its markup is unchanged; a render only creates cards
// that are new/changed and moves/removes the rest. Loaded thumbnails stay put.
const cardCache=new Map(); // id -> {html, el}
// Carries the current filtered view (liked/favorites/watchlater) into the
// Shorts player link so swiping to the next Short there stays inside that
// same filtered set instead of falling back to every Short in the library.
function videoHref(v){if(!v.isShort)return '/watch.html?id='+encodeURIComponent(v.id);const scoped=(list==='liked'||list==='favorites'||list==='watchlater')?list:'';return '/shorts.html?'+(scoped?'list='+encodeURIComponent(scoped)+'&':'')+'id='+encodeURIComponent(v.id)}
function cardHtml(v){return `<article class="video-card${selected.has(v.id)?' is-selected':''}"><a class="thumb" target="_top" href="${videoHref(v)}" data-watch="${esc(v.id)}"><span class="select-check${selected.has(v.id)?' checked':''}" data-select="${esc(v.id)}" aria-label="Select video"></span><img loading="lazy" decoding="async" src="${esc(v.thumbnail)}" alt="" onerror="window.handleThumbFail&&window.handleThumbFail(this,'${esc(v.id)}')"><video class="thumb-preview" muted playsinline preload="none" data-local-id="${esc(v.id)}" data-src="${v.preview?.ready&&v.preview?.hover?esc(v.preview.hover):''}" data-src-rev="${v.preview?.ready&&v.preview?.hoverRev?esc(v.preview.hoverRev):''}"></video>${v.isShort?'<span class="short-badge">Shorts</span>':''}<span class="duration">${esc(v.duration||'')}</span><span class="thumb-play">▶</span><span class="thumb-loadbar"></span></a><div class="card-row"><div class="channel-avatar">${esc((v.title||'M').trim()[0].toUpperCase())}</div><div class="card-body"><a class="video-title" target="_top" href="${videoHref(v)}" data-watch="${esc(v.id)}">${esc(v.title)}</a><p class="channel">D Vault</p><p class="stats">${cardStats(v)}</p></div><button class="more-btn" data-menu="${esc(v.id)}">⋮</button></div><div class="card-menu" id="menu-${esc(v.id)}"><button data-short="${esc(v.id)}">${v.isShort?'<img src="/icons/remove-from-shorts.svg" alt="" class="menu-icon"> Remove from Shorts':'<img src="/icons/mark-as-shorts.svg" alt="" class="menu-icon"> Mark as Short'}</button><button data-playlist-add="${esc(v.id)}"><img src="/icons/playlist-icon.png" alt="" class="menu-icon icon-invert"> Save to playlist</button>${playlist?`<button data-unplaylist="${esc(v.id)}">➖ Remove from this playlist</button>`:''}<button data-watchlater="${esc(v.id)}" class="${v.watchLater?'is-saved':''}"><img src="/icons/watch-later.svg" alt="" class="menu-icon icon-invert"> ${v.watchLater?'Remove from Watch Later':'Save to Watch Later'}</button><button data-fav="${esc(v.id)}" class="${v.favorite?'is-saved':''}"><img src="/icons/star.svg" alt="" class="menu-icon icon-invert"> ${v.favorite?'Remove from favorites':'Add to favorites'}</button><button data-thumb="${esc(v.id)}"><img src="/icons/thumbnail-icon.png" alt="" class="menu-icon"> Change thumbnail</button><button data-rename="${esc(v.id)}">✏️ Rename</button>${downloadedIds.has(String(v.id))?'<button class="is-saved" disabled>✓ Saved</button>':`<button data-download="${esc(v.id)}">📲 Download offline</button>`}<button data-savefile="${esc(v.id)}"><img src="/icons/download.png" alt="" class="menu-icon icon-invert"> Download</button><button data-details="${esc(v.id)}">${window.DPDetails?window.DPDetails.icon:''} Details</button><button data-delete="${esc(v.id)}" class="delete-btn"><img src="/icons/delete-icon.png" alt="" class="menu-icon"> Delete</button></div></article>`}
function syncGridCards(grid,vs){
  const els=new Array(vs.length);
  const fresh=[];
  for(let i=0;i<vs.length;i++){
    const v=vs[i],html=cardHtml(v),hit=cardCache.get(v.id);
    if(hit&&hit.html===html)els[i]=hit.el;else fresh.push({i,v,html});
  }
  if(fresh.length){
    const tmp=document.createElement('div');
    tmp.innerHTML=fresh.map(f=>f.html).join('');
    bindCards(tmp);
    const kids=Array.from(tmp.children);
    fresh.forEach((f,k)=>{
      const el=kids[k];
      cardCache.set(f.v.id,{html:f.html,el});
      els[f.i]=el;
      // Only the first few new cards get the fade-in - animating hundreds at
      // once is itself a source of jank on phones.
      if(k<12){el.classList.add('card-enter');el.addEventListener('animationend',()=>el.classList.remove('card-enter'),{once:true})}
    });
  }
  // Remove whatever shouldn't be there (skeletons, empty state, filtered-out
  // cards), then put the wanted cards in order, moving only what's out of place.
  const want=new Set(els);
  for(const c of Array.from(grid.children))if(!want.has(c))c.remove();
  let ref=grid.firstElementChild;
  for(const el of els){
    if(el===ref)ref=ref.nextElementSibling;
    else grid.insertBefore(el,ref);
  }
}
function pruneCardCache(){
  const live=new Set(all.map(v=>v.id));
  for(const id of Array.from(cardCache.keys()))if(!live.has(id))cardCache.delete(id);
}
// Coalesce bursts of render requests (typing, several detections landing
// together) into a single render on the next frame.
let renderQueued=0;
function renderSoon(){if(renderQueued)return;renderQueued=requestAnimationFrame(()=>{renderQueued=0;render()})}
function bindCards(root){
 root.querySelectorAll('[data-watch]').forEach(a=>a.addEventListener('click',e=>{if(selectMode){e.preventDefault();toggleSelect(a.dataset.watch);return}addHistory(a.dataset.watch)}));
 root.querySelectorAll('[data-select]').forEach(el=>el.onclick=e=>{e.preventDefault();e.stopPropagation();toggleSelect(el.dataset.select)});
 root.querySelectorAll('[data-short]').forEach(b=>b.onclick=async e=>{
   e.preventDefault();e.stopPropagation();
   const vid=b.dataset.short;
   const v=all.find(x=>x.id===vid);
   try{await api('/api/videos/'+encodeURIComponent(vid)+'/short',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({short:!(v&&v.isShort)})});await load()}catch(err){toast(err.message)}
 });
root.querySelectorAll('[data-thumb]').forEach(b=>b.onclick=e=>{
  e.preventDefault();e.stopPropagation();
  const input=$('#thumbnailInput');
  input.dataset.videoId=b.dataset.thumb;
  input.value='';
  input.click();
});
root.querySelectorAll('[data-rename]').forEach(b=>b.onclick=async e=>{
  e.preventDefault();e.stopPropagation();
  document.querySelectorAll('.card-menu.open').forEach(x=>x.classList.remove('open'));
  const vid=b.dataset.rename;
  const v=all.find(x=>x.id===vid);
  const name=(prompt('Rename video:',v?v.title:'')||'').trim();
  if(!name||name===(v&&v.title))return;
  try{
    await api('/api/videos/'+encodeURIComponent(vid)+'/rename',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name})});
    toast('Video renamed');
    await load();
  }catch(err){toast(err.message||'Could not rename video')}
});
// "Save to Watch Later" and "Add to favorites" are two separate lists.
root.querySelectorAll('[data-watchlater]').forEach(b=>b.onclick=async e=>{
  e.preventDefault();e.stopPropagation();
  document.querySelectorAll('.card-menu.open').forEach(x=>x.classList.remove('open'));
  const vid=b.dataset.watchlater;
  const v=all.find(x=>x.id===vid);
  const was=!!(v&&v.watchLater);
  if(v)v.watchLater=!was;
  try{
    const active=(await api('/api/videos/'+encodeURIComponent(vid)+'/watchlater',{method:'POST'})).active;
    if(v)v.watchLater=active;
    toast(active?'Saved to Watch Later':'Removed from Watch Later');
    await load();
  }catch(err){
    if(v)v.watchLater=was;
    toast(err.message||"Couldn't update Watch Later");
  }
});
root.querySelectorAll('[data-fav]').forEach(b=>b.onclick=async e=>{
  e.preventDefault();e.stopPropagation();
  document.querySelectorAll('.card-menu.open').forEach(x=>x.classList.remove('open'));
  const vid=b.dataset.fav;
  const v=all.find(x=>x.id===vid);
  const was=!!(v&&v.favorite);
  if(v)v.favorite=!was;
  try{
    const active=(await api('/api/videos/'+encodeURIComponent(vid)+'/favorite',{method:'POST'})).active;
    if(v)v.favorite=active;
    toast(active?'Added to favorites':'Removed from favorites');
    await load();
  }catch(err){
    if(v)v.favorite=was;
    toast(err.message||"Couldn't update favorites");
  }
});
root.querySelectorAll('[data-playlist-add]').forEach(b=>b.onclick=e=>{
  e.preventDefault();e.stopPropagation();
  document.querySelectorAll('.card-menu.open').forEach(x=>x.classList.remove('open'));
  showPlaylistModal(b.dataset.playlistAdd);
});
root.querySelectorAll('[data-unplaylist]').forEach(b=>b.onclick=async e=>{
  e.preventDefault();e.stopPropagation();
  const vid=b.dataset.unplaylist;
  try{
    await api('/api/playlists/'+encodeURIComponent(playlist)+'/videos/'+encodeURIComponent(vid),{method:'DELETE'});
    toast('Removed from playlist');
    await load();
    loadPlaylists();
  }catch(err){toast(err.message||'Could not remove video')}
});
root.querySelectorAll('[data-delete]').forEach(b=>b.onclick=async e=>{
  e.preventDefault();e.stopPropagation();
  const vid=b.dataset.delete;
  const v=all.find(x=>x.id===vid);
  if(!confirm('Delete "'+(v?v.title:'this video')+'"? It will be deleted from the selected storage folder.'))return;
  try{
    b.disabled=true;
    await api('/api/videos/'+encodeURIComponent(vid)+'/delete',{method:'DELETE'});
    toast('Video deleted');
    await load();
  }catch(e){toast(e.message||'Could not delete video');b.disabled=false}
});
root.querySelectorAll('[data-download]').forEach(b=>b.onclick=async e=>{
  e.preventDefault();e.stopPropagation();
  if(b.disabled||!window.AppDownloads)return;
  const vid=b.dataset.download;
  const v=all.find(x=>x.id===vid);
  const original=b.textContent;
  b.disabled=true;
  b.textContent='Starting…';
  const cancelBtn=document.createElement('button');
  cancelBtn.type='button';
  cancelBtn.className='dl-inline-cancel';
  cancelBtn.textContent='✕ Cancel download';
  b.insertAdjacentElement('afterend',cancelBtn);
  const noteEl=document.createElement('p');
  noteEl.className='dl-bg-note';
  cancelBtn.insertAdjacentElement('afterend',noteEl);
  const handle=AppDownloads.startDownload({
    id:vid,title:(v&&v.title)||'video',
    streamUrl:'/api/videos/'+encodeURIComponent(vid)+'/stream',
    posterUrl:(v&&v.thumbnail)||('/api/videos/'+encodeURIComponent(vid)+'/thumbnail'),
    onProgress:({received,total,background})=>{
      b.textContent=total?`Saving… ${Math.min(99,Math.round(received/total*100))}%`:`Saving… ${(received/1048576).toFixed(1)}MB`;
      // Background Fetch keeps running even if this tab/app is closed;
      // the foreground fallback (older Safari/Firefox, or when Background
      // Fetch fails to register) doesn't, so say so plainly either way
      // instead of leaving it ambiguous whether it's safe to leave.
      noteEl.textContent=background?'Downloading in background — you can close the app':'Keep this open until it finishes saving';
    }
  });
  cancelBtn.onclick=e2=>{e2.preventDefault();e2.stopPropagation();handle.cancel()};
  try{
    await handle.promise;
    downloadedIds.add(String(vid));
    b.textContent='✓ Saved';
    b.classList.add('is-saved');
    toast('Saved in app storage');
  }catch(err){
    b.textContent=original;
    b.disabled=false;
    toast(err&&err.name==='AbortError'?'Download canceled':(err.message||"Couldn't save this video in the app."));
  }finally{
    cancelBtn.remove();
    noteEl.remove();
  }
});
root.querySelectorAll('[data-savefile]').forEach(b=>b.onclick=async e=>{
  // Plain file download to the device (the server sends the video with an
  // attachment header when ?download is present). Separate from "Save offline
  // in app", which stores it inside D Vault for offline playback.
  e.preventDefault();e.stopPropagation();
  document.querySelectorAll('.card-menu.open').forEach(x=>x.classList.remove('open'));
  const vid=b.dataset.savefile;
  const a=document.createElement('a');
  a.href=(window.DVaultMedia?await DVaultMedia.url(vid):'/api/videos/'+encodeURIComponent(vid)+'/stream?download=1');
  a.download=''; // let the server's filename (with extension) be used
  a.style.display='none';
  document.body.appendChild(a);a.click();a.remove();
  toast('Download started');
});
root.querySelectorAll('[data-details]').forEach(b=>b.onclick=e=>{
  e.preventDefault();e.stopPropagation();
  document.querySelectorAll('.card-menu.open').forEach(x=>x.classList.remove('open'));
  const id=b.dataset.details;
  const item=(typeof all!=='undefined'&&all.find(x=>String(x.id)===String(id)))||{id};
  if(window.DPDetails)window.DPDetails.open(item,{saved:downloadedIds.has(String(id))});
});
root.querySelectorAll('[data-menu]').forEach(b=>b.onclick=e=>{e.preventDefault();e.stopPropagation();const menu=$('#menu-'+CSS.escape(b.dataset.menu));const wasOpen=menu.classList.contains('open');document.querySelectorAll('.card-menu.open').forEach(x=>x.classList.remove('open'));if(!wasOpen)menu.classList.add('open')});
}
let dvaultVisibleObserver=null;
function prioritizeVisiblePreviews(){
  if(!window.DVaultPreview?.prioritize||!window.IntersectionObserver)return;
  if(dvaultVisibleObserver)dvaultVisibleObserver.disconnect();
  dvaultVisibleObserver=new IntersectionObserver(entries=>entries.forEach(e=>{if(e.isIntersecting){const a=e.target.querySelector("[data-watch]");if(a)DVaultPreview.prioritize(a.dataset.watch)}}),{rootMargin:"500px"});
  document.querySelectorAll(".video-card").forEach(x=>dvaultVisibleObserver.observe(x));
}
function render(){let q=($('#search').value||'').trim().toLowerCase();let vs=all.filter(v=>{const text=(v.title+' '+(v.description||'')+' '+(v.category||'')).toLowerCase();const cat=!activeCat||v.category===activeCat||activeCat==='Music'&&/music|song|mix/i.test(text)||activeCat==='Mixes'&&/mix/i.test(text)||activeCat==='Romantic Music'&&/romantic|love/i.test(text);const idl=String(v.id||'').toLowerCase();return (text.includes(q)||idl.includes(q)||(idl.length>=8&&q.includes(idl)))&&cat});if(view==='history'){const ids=historyIds();const hr=new Map(ids.map((x,i)=>[x,i]));vs.sort((a,b)=>hr.get(a.id)-hr.get(b.id));vs=vs.filter(v=>hr.has(v.id))}const isRecommendedView=!list&&!view&&!activeCat&&!q;if(isRecommendedView&&recSeed.length){const rr=new Map(recSeed.map((x,i)=>[x,i]));vs.sort((a,b)=>(rr.has(a.id)?rr.get(a.id):1e9)-(rr.has(b.id)?rr.get(b.id):1e9))}else vs.sort((a,b)=>(new Date(b.createdTime||0)-new Date(a.createdTime||0)));if(homeFilter==='shorts'){vs=vs.filter(v=>v.isShort);if(!list&&!activeCat&&!q){const order=shortsOrder();if(order.length){const orr=new Map(order.map((x,i)=>[x,i]));vs.sort((a,b)=>(orr.has(a.id)?orr.get(a.id):1e9)-(orr.has(b.id)?orr.get(b.id):1e9))}}}else if(homeFilter==='videos'){vs=vs.filter(v=>!v.isShort);}
/* homeFilter==='all': no isShort filtering — videos and Shorts render together. */
lastRendered=vs.map(v=>v.id);
const grid=$('#grid');
if(vs.length){syncGridCards(grid,vs)}else{grid.innerHTML=(()=>{
  const likedShorts=homeFilter==='shorts'&&list==='liked';
  const likedVideos=list==='liked'&&homeFilter!=='shorts';
  const icon=homeFilter==='shorts'?'◈':'⌕';
  const title=likedShorts?'No liked Shorts yet':likedVideos?'No liked videos yet':homeFilter==='shorts'?'No Shorts yet':'No videos found';
  const text=likedShorts?'Like a Short and it will show up here.':likedVideos?'Like a video and it will show up here.':homeFilter==='shorts'?'Nothing marked as a Short yet — open a video\'s ⋮ menu and choose "Mark as Short".':'Try another search or choose a local storage folder and add media files.';
  return `<div class="empty-state"><div class="empty-icon">${icon}</div><h2>${title}</h2><p>${text}</p></div>`;
})();}
 $('#grid').classList.toggle('select-mode',selectMode);
window.DPlayerPreview&&window.DPlayerPreview.wire();updateSelectBar();prioritizeVisiblePreviews();observeUnknownOrientations();}
// Multi-select: a toggle button switches the grid into selection mode, where
// tapping a card selects it (instead of opening the video) and a toolbar
// offers bulk Favorite/Like/Delete across everything currently checked.
function toggleSelect(id){
  if(selected.has(id))selected.delete(id);else selected.add(id);
  render();
}
function updateSelectBar(){
  const bar=$('#selectBar');
  if(!bar)return;
  const line=$('#selectLine');
  if(line)line.classList.toggle('is-selecting',selectMode);
  if(!selectMode){
    bar.innerHTML=`<button class="select-toggle" id="selectToggleBtn" type="button">☑ Select</button>`;
    $('#selectToggleBtn').onclick=()=>{selectMode=true;selected.clear();render()};
    return;
  }
  const n=selected.size;
  const allSelected=lastRendered.length>0&&lastRendered.every(id=>selected.has(id));
  bar.innerHTML=`<div class="select-toolbar">
    <button class="select-cancel" id="selectCancelBtn" type="button">✕ Cancel</button>
    <span class="select-count">${n?n+' selected':'Select videos'}</span>
    <button class="select-all-btn" id="selectAllBtn" type="button">${allSelected?'Deselect all':'Select all'}</button>
    <div class="select-actions">
      <button data-bulk="favorite" ${n?'':'disabled'}><span class="fav-icon"></span>Favorite</button>
      <button data-bulk="like" ${n?'':'disabled'}>👍 Like</button>
      <button data-bulk="save" ${n?'':'disabled'}>⬇ Download</button>
      <button data-bulk="download" ${n&&window.AppDownloads?'':'disabled'}>📲 Download offline</button>
      <button data-bulk="delete" class="delete-btn" ${n?'':'disabled'}><img src="/icons/delete-icon.png" alt="" class="menu-icon"> Delete</button>
    </div>
  </div>`;
  $('#selectCancelBtn').onclick=()=>{selectMode=false;selected.clear();render()};
  $('#selectAllBtn').onclick=()=>{
    if(allSelected)lastRendered.forEach(id=>selected.delete(id));
    else lastRendered.forEach(id=>selected.add(id));
    render();
  };
  document.querySelectorAll('[data-bulk]').forEach(b=>b.onclick=()=>runBulkAction(b.dataset.bulk));
}
async function runBulkAction(action){
  const ids=[...selected];
  if(!ids.length)return;
  if(action==='delete'&&!confirm(`Delete ${ids.length} video${ids.length>1?'s':''}? They will be deleted from the selected storage folder.`))return;
  if(action==='download'){await runBulkDownload(ids);return}
  if(action==='save'){await runBulkSaveToDevice(ids);return}
  $('#selectBar').querySelectorAll('button').forEach(b=>b.disabled=true);
  let ok=0,fail=0;
  for(const id of ids){
    try{
      const path=action==='delete'?'/delete':'/'+action;
      await api('/api/videos/'+encodeURIComponent(id)+path,{method:action==='delete'?'DELETE':'POST'});
      ok++;
    }catch(e){fail++}
  }
  const verb=action==='delete'?'deleted':'updated';
  toast(fail?`${ok} ${verb}, ${fail} failed`:`${ok} video${ok===1?'':'s'} ${verb}`);
  selectMode=false;selected.clear();
  await load();
}
// Bulk "Download offline": saves each selected video into the app's own
// IndexedDB storage (see idb-downloads.js). Runs a few downloads at once
// (BULK_DOWNLOAD_CONCURRENCY) instead of strictly one-at-a-time, so the
// connection's real throughput gets used instead of sitting idle between
// files. Kept modest (not higher) because every one of these is a full
// video stream pulled through the same single shared remote storage account
// (see src/remote-storage-do.js) that also serves ordinary playback and thumbnails -
// too many at once trips remote's own per-account rate limit, which then
// breaks unrelated things on the same account (thumbnails, the Photos page)
// until it clears. Progress across all in-flight downloads is shown in the
// toolbar's count label.
const BULK_DOWNLOAD_CONCURRENCY=2;
async function runBulkDownload(ids){
  if(!window.AppDownloads){toast("Downloads aren't supported in this browser.");return}
  $('#selectBar').querySelectorAll('button').forEach(b=>b.disabled=true);
  const countEl=$('.select-count');
  const toolbar=$('.select-toolbar');
  // Tell the person up front whether these downloads can survive them
  // closing the app - Background Fetch (used automatically when the
  // browser supports it) keeps going in the background; the foreground
  // fallback (Safari/iOS, Firefox, or if Background Fetch fails to
  // register) stops the moment the app closes.
  const bgSupported=await AppDownloads.supportsBackgroundDownload();
  toast(bgSupported?'Downloading in the background — safe to close the app':'Keep the app open until these finish downloading');
  let ok=0,fail=0,canceled=false,started=0,done=0;
  const activeHandles=new Set();
  const progress=new Map();
  const cancelBtn=document.createElement('button');
  cancelBtn.type='button';
  cancelBtn.className='select-bulk-cancel';
  cancelBtn.textContent='✕ Cancel';
  cancelBtn.onclick=()=>{canceled=true;cancelBtn.disabled=true;cancelBtn.textContent='Canceling…';activeHandles.forEach(h=>h.cancel())};
  if(toolbar)toolbar.appendChild(cancelBtn);
  const updateLabel=()=>{
    if(!countEl)return;
    const parts=[...progress.values()];
    const pctParts=parts.filter(p=>p!=null);
    const avg=pctParts.length?Math.round(pctParts.reduce((a,b)=>a+b,0)/pctParts.length):null;
    countEl.textContent=`Downloading ${done+1<=ids.length?done+1:ids.length}-${Math.min(started,ids.length)}/${ids.length}`+(avg!=null?`… ${avg}%`:'…')+(bgSupported?' (background)':'');
  };
  let cursor=0;
  async function worker(){
    while(!canceled){
      const i=cursor++;
      if(i>=ids.length)return;
      const id=ids[i];
      const v=all.find(x=>x.id===id);
      started++;
      progress.set(id,0);
      updateLabel();
      try{
        const handle=AppDownloads.startDownload({
          id,title:(v&&v.title)||'video',
          streamUrl:'/api/videos/'+encodeURIComponent(id)+'/stream',
          posterUrl:(v&&v.thumbnail)||('/api/videos/'+encodeURIComponent(id)+'/thumbnail'),
          onProgress:({received,total})=>{
            progress.set(id,total?Math.min(99,Math.round(received/total*100)):null);
            updateLabel();
          }
        });
        activeHandles.add(handle);
        await handle.promise;
        activeHandles.delete(handle);
        downloadedIds.add(String(id));
        ok++;
      }catch(e){fail++}
      progress.delete(id);
      done++;
      updateLabel();
    }
  }
  await Promise.all(Array.from({length:Math.min(BULK_DOWNLOAD_CONCURRENCY,ids.length)},worker));
  cancelBtn.remove();
  toast(canceled?`Canceled — ${ok} saved offline`:(fail?`${ok} saved offline, ${fail} failed`:`${ok} video${ok===1?'':'s'} saved offline`));
  selectMode=false;selected.clear();
  render();
}
// Bulk "Download": hands each selected video to the browser/OS to save into
// device storage (e.g. the Downloads folder) - the same probe-then-<a
// download> approach as the single download button on watch.html - rather
// than into this app's own IndexedDB like "Download offline" above.
async function runBulkSaveToDevice(ids){
  $('#selectBar').querySelectorAll('button').forEach(b=>b.disabled=true);
  const countEl=$('.select-count');
  const toolbar=$('.select-toolbar');
  let ok=0,fail=0,canceled=false;
  const cancelBtn=document.createElement('button');
  cancelBtn.type='button';
  cancelBtn.className='select-bulk-cancel';
  cancelBtn.textContent='✕ Cancel';
  cancelBtn.onclick=()=>{canceled=true;cancelBtn.disabled=true;cancelBtn.textContent='Canceling…'};
  if(toolbar)toolbar.appendChild(cancelBtn);
  for(let i=0;i<ids.length&&!canceled;i++){
    const id=ids[i];
    const v=all.find(x=>x.id===id);
    const label=`Downloading ${i+1}/${ids.length}`;
    if(countEl)countEl.textContent=label+'…';
    const stream='/api/videos/'+encodeURIComponent(id)+'/stream';
    try{
      const probe=await fetch(stream,{headers:{Range:'bytes=0-1'},credentials:'include'});
      if(!probe.ok){
        const j=await probe.json().catch(()=>({}));
        throw Error(j.error||'Download failed.');
      }
      probe.body?.cancel().catch(()=>{});
      const a=document.createElement('a');a.href=stream+'?download=1';a.download=(v&&v.title)||'video';
      document.body.appendChild(a);a.click();a.remove();
      ok++;
      // A short pause between kicking off each download - firing a burst of
      // auto-triggered downloads back to back gets throttled or blocked by
      // the browser (Chrome prompts to allow "multiple downloads" after a
      // handful in quick succession), so pacing them keeps every file
      // actually landing in the OS downloads folder.
      if(i<ids.length-1&&!canceled)await new Promise(r=>setTimeout(r,600));
    }catch(e){fail++}
  }
  cancelBtn.remove();
  toast(canceled?`Canceled — ${ok} downloaded`:(fail?`${ok} downloaded, ${fail} failed`:`${ok} video${ok===1?'':'s'} downloaded`));
  selectMode=false;selected.clear();
  render();
}
window.handleThumbFail=function(img,id){
  if(img.dataset.autoTried)return;
  img.dataset.autoTried='1';
  // Swap in a shimmering placeholder the instant the real thumbnail 404s,
  // rather than leaving the browser's broken-image glyph sitting in the
  // corner of the card for however long auto-generation takes below.
  const thumbEl=img.closest('.thumb');
  if(thumbEl)thumbEl.classList.add('thumb-pending');
  if(!window.autoThumbnail){img.style.visibility='hidden';return}
  window.autoThumbnail(id).then(url=>{
    if(url){img.src=url;img.style.visibility=''}
    // If generation genuinely failed, hide the <img> instead of leaving
    // the browser's broken-image glyph on screen forever - the card's
    // dark background behind it reads fine on its own.
    else img.style.visibility='hidden';
    if(thumbEl)thumbEl.classList.remove('thumb-pending');
  });
};
async function prepareThumbnail(file){
  if(!file.type.startsWith('image/'))throw Error('Please choose an image file.');
  const url=URL.createObjectURL(file);
  try{
    const img=await new Promise((resolve,reject)=>{
      const i=new Image();
      i.onload=()=>resolve(i);
      i.onerror=()=>reject(Error('The selected image could not be read.'));
      i.src=url;
    });
    const max=1600,scale=Math.min(1,max/Math.max(img.naturalWidth,img.naturalHeight));
    const w=Math.max(1,Math.round(img.naturalWidth*scale)),h=Math.max(1,Math.round(img.naturalHeight*scale));
    const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
    const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0,w,h);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.88));
    if(!blob)throw Error('Could not prepare the thumbnail.');
    return blob;
  }finally{URL.revokeObjectURL(url)}
}
$('#thumbnailInput').onchange=async()=>{
  const input=$('#thumbnailInput'),file=input.files?.[0],videoId=input.dataset.videoId;
  if(!file||!videoId)return;
  try{
    toast('Preparing thumbnail…');
    const blob=await prepareThumbnail(file);
    if(blob.size>1900000)throw Error('Thumbnail is still too large. Please choose a smaller image.');
    const r=await fetch('/api/videos/'+encodeURIComponent(videoId)+'/thumbnail',{
      method:'POST',headers:{'Content-Type':'image/jpeg'},body:blob
    });
    const j=await r.json().catch(()=>({}));
    if(!r.ok)throw Error(j.error||'Thumbnail upload failed.');
    toast('Thumbnail changed');
    await load();
  }catch(e){toast(e.message||'Thumbnail upload failed.')}
};
function folderVideosUrl(){
  if(playlist)return '/api/playlists/'+encodeURIComponent(playlist)+'/videos';
  if(list==='liked')return '/api/liked';
  if(list==='favorites')return '/api/favorites';
  if(list==='watchlater')return '/api/watch-later';
  return '/api/videos'+(folder?('?folder='+encodeURIComponent(folder)):'');
}
function updateFolderHeader(){
  const el=$('#folderHeader');
  if(!el)return;
  if(!folder){el.hidden=true;return}
  const f=folders.find(x=>x.id===folder);
  $('#folderHeaderTitle').textContent=f?f.name:'Folder';
  el.hidden=false;
}
function renderFolderTree(){
  // Merged folders are hidden from the main tree entirely - they're only
  // reachable from the "⋮" menu of the folder they were merged into (see
  // mergedByTarget below).
  const visibleFolders=folders.filter(f=>!f.mergedInto);
  const map=new Map(visibleFolders.map(f=>[f.id,{...f,children:[]}]));
  const roots=[];
  map.forEach(f=>{
    if(f.parentId&&map.has(f.parentId))map.get(f.parentId).children.push(f);
    else roots.push(f);
  });
  const mergedByTarget=new Map();
  folders.forEach(f=>{
    if(!f.mergedInto)return;
    if(!mergedByTarget.has(f.mergedInto))mergedByTarget.set(f.mergedInto,[]);
    mergedByTarget.get(f.mergedInto).push(f);
  });
  const byName=(a,b)=>a.name.localeCompare(b.name);
  (function sortTree(nodes){nodes.sort(byName);nodes.forEach(n=>sortTree(n.children))})(roots);
  function pathToActive(nodes){
    for(const n of nodes){
      if(n.id===folder)return [n.id];
      const sub=pathToActive(n.children);
      if(sub)return [n.id,...sub];
    }
    return null;
  }
  const openPath=new Set(folder?(pathToActive(roots)||[]):[]);
  function renderNodes(nodes,depth){
    if(!nodes.length)return '';
    return '<div class="folder-list">'+nodes.map(n=>{
      const hasKids=n.children.length>0;
      const isOpen=openPath.has(n.id);
      const mergedKids=(mergedByTarget.get(n.id)||[]).slice().sort(byName);
      let mergedKidsHtml='';
      if(mergedKids.length){
        const rows=mergedKids.map(mc=>{
          return '<div class="merged-child-row"><button class="folder-link" data-folder="'+esc(mc.id)+'" title="View '+esc(mc.name)+'">'+(window.DPSidebarIcons?window.DPSidebarIcons.folder:'')+' <span>'+esc(mc.name)+'</span></button><button class="unmerge-btn" data-unmerge-folder="'+esc(mc.id)+'" title="Unmerge '+esc(mc.name)+'">✕</button></div>';
        }).join('');
        mergedKidsHtml='<div class="folder-menu-divider"></div><div class="folder-menu-label">Merged in ('+mergedKids.length+')</div>'+rows;
      }
      return `<div class="folder-node">
        <div class="folder-row${n.id===folder?' active':''}" style="padding-left:${depth*14}px">
          ${hasKids?`<button class="folder-toggle${isOpen?' open':''}" data-toggle="${esc(n.id)}" aria-label="Expand folder">▸</button>`:'<span class="folder-toggle-spacer"></span>'}
          <button class="folder-link" data-folder="${esc(n.id)}">${window.DPSidebarIcons?window.DPSidebarIcons.folder:''} <span>${esc(n.name)}</span></button>
          <button type="button" class="folder-menu-btn" data-folder-menu="${esc(n.id)}" aria-label="Folder options">⋮</button>
          <div class="folder-menu" id="fm-${esc(n.id)}">
            <button data-merge-folder="${esc(n.id)}">🔀 Merge into another folder…</button>
            ${mergedKidsHtml}
          </div>
        </div>
        ${hasKids?`<div class="folder-children" id="fc-${esc(n.id)}" style="display:${isOpen?'block':'none'}">${renderNodes(n.children,depth+1)}</div>`:''}
      </div>`;
    }).join('')+'</div>';
  }
  $('#folderTree').innerHTML=roots.length?renderNodes(roots,0):'<div class="side-small">No folders found.</div>';
  document.querySelectorAll('[data-toggle]').forEach(b=>b.onclick=e=>{
    e.preventDefault();e.stopPropagation();
    toggleFolderChildren(b.dataset.toggle);
  });
  document.querySelectorAll('[data-folder-menu]').forEach(b=>b.onclick=e=>{
    e.preventDefault();e.stopPropagation();
    const menu=$('#fm-'+CSS.escape(b.dataset.folderMenu));
    const wasOpen=menu.classList.contains('open');
    document.querySelectorAll('.folder-menu.open').forEach(x=>x.classList.remove('open'));
    if(!wasOpen)menu.classList.add('open');
  });
  document.querySelectorAll('[data-merge-folder]').forEach(b=>b.onclick=e=>{
    e.preventDefault();e.stopPropagation();
    document.querySelectorAll('.folder-menu.open').forEach(x=>x.classList.remove('open'));
    showFolderMergeModal(b.dataset.mergeFolder);
  });
  document.querySelectorAll('[data-unmerge-folder]').forEach(b=>b.onclick=async e=>{
    e.preventDefault();e.stopPropagation();
    document.querySelectorAll('.folder-menu.open').forEach(x=>x.classList.remove('open'));
    const id=b.dataset.unmergeFolder;
    try{
      await api('/api/folders/'+encodeURIComponent(id)+'/merge',{method:'DELETE'});
      toast('Unmerged');
      await loadFolders();
      if(folder&&(folder===id||folders.some(f=>f.id===folder)))await load();
    }catch(err){toast(err.message||'Could not unmerge')}
  });
  document.querySelectorAll('[data-folder]').forEach(b=>{
    const hasKids=!!document.getElementById('fc-'+b.dataset.folder);
    if(!hasKids){
      // Leaf folders have nothing to expand — a single click just opens them.
      b.onclick=()=>{location.href='/?folder='+encodeURIComponent(b.dataset.folder)};
      return;
    }
    // Folders with subfolders: single click expands/collapses the subfolder
    // list; double click opens the folder's videos (and collapses the list,
    // since the click that triggers dblclick already toggled it open).
    let clickTimer=null;
    b.onclick=()=>{
      if(clickTimer){clearTimeout(clickTimer);clickTimer=null;return}
      clickTimer=setTimeout(()=>{
        clickTimer=null;
        toggleFolderChildren(b.dataset.folder);
      },260);
    };
    b.ondblclick=e=>{
      e.preventDefault();
      if(clickTimer){clearTimeout(clickTimer);clickTimer=null}
      location.href='/?folder='+encodeURIComponent(b.dataset.folder);
    };
  });
}
function toggleFolderChildren(id){
  const kids=document.getElementById('fc-'+id);
  if(!kids)return;
  const isOpenNow=kids.style.display!=='none';
  kids.style.display=isOpenNow?'none':'block';
  const toggleBtn=document.querySelector('[data-toggle="'+id+'"]');
  if(toggleBtn)toggleBtn.classList.toggle('open',!isOpenNow);
}
// "Merge into another folder" modal: view-only grouping (see
// ensureFolderMergesSchema in src/index.js) - picking a target here never
// touches remote storage, it just makes the target folder's video list also
// show this folder's videos. Reuses the app's single shared #modal, same
// as showPlaylistModal above.
function showFolderMergeModal(sourceId){
  const src=folders.find(f=>f.id===sourceId);
  $('#modalTitle').textContent='Merge "'+((src&&src.name)||'this folder')+'" into…';
  $('#modalText').textContent='Videos from this folder will also show up when browsing the folder you pick. Nothing changes in remote storage itself.';
  const actions=$('#modalActions');
  actions.innerHTML='';
  const list=document.createElement('div');
  list.className='folder-merge-list';
  const targets=folders.filter(f=>f.id!==sourceId).sort((a,b)=>a.name.localeCompare(b.name));
  if(!targets.length){
    const empty=document.createElement('div');
    empty.className='side-small';
    empty.textContent='No other folders to merge into.';
    list.appendChild(empty);
  }
  targets.forEach(f=>{
    const row=document.createElement('div');
    row.className='folder-merge-item';
    const isCurrent=src&&src.mergedInto===f.id;
    row.innerHTML='<span>'+(window.DPSidebarIcons?window.DPSidebarIcons.folder:'')+' '+esc(f.name)+(isCurrent?' (current)':'')+'</span>';
    row.onclick=async()=>{
      if(isCurrent){$('#modal').classList.remove('show');return}
      try{
        await api('/api/folders/'+encodeURIComponent(sourceId)+'/merge',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({targetFolderId:f.id})});
        toast('Merged into '+f.name);
        $('#modal').classList.remove('show');
        await loadFolders();
        if(folder===f.id||folder===sourceId)await load();
      }catch(err){toast(err.message||'Could not merge folders')}
    };
    list.appendChild(row);
  });
  actions.appendChild(list);
  $('#modal').classList.add('show');
}
// Playlists: a flat (non-nested) list of the signed-in user's own
// collections, shown in the sidebar the same way Folders is above. Unlike
// folders (which come from Drive's real directory structure), playlists are
// purely a D Vault concept stored in local IndexedDB.
function updatePlaylistHeader(){
  const el=$('#playlistHeader');
  if(!el)return;
  if(!playlist){el.hidden=true;return}
  const p=playlists.find(x=>x.id===playlist);
  $('#playlistHeaderTitle').textContent=p?p.name:'Playlist';
  el.hidden=false;
}
function renderPlaylistList(){
  const el=$('#playlistList');
  if(!el)return;
  el.innerHTML=playlists.length?playlists.map(p=>`<div class="folder-node"><div class="folder-row${p.id===playlist?' active':''}"><span class="folder-toggle-spacer"></span><button class="folder-link" data-playlist-link="${esc(p.id)}">${window.DPSidebarIcons?window.DPSidebarIcons.playlist:''} <span>${esc(p.name)}</span></button><button type="button" class="folder-menu-btn" data-playlist-menu="${esc(p.id)}" aria-label="Playlist options">⋮</button><div class="folder-menu" id="pmenu-${esc(p.id)}"><button data-playlist-rename2="${esc(p.id)}">Rename</button><button class="unmerge-btn" data-playlist-delete2="${esc(p.id)}">Delete</button></div></div></div>`).join(''):'<div class="side-small">No playlists yet — use the ➕ above, or a video\'s ⋮ menu.</div>';
  document.querySelectorAll('[data-playlist-link]').forEach(b=>b.onclick=()=>{location.href='/?playlist='+encodeURIComponent(b.dataset.playlistLink)});
  document.querySelectorAll('[data-playlist-menu]').forEach(b=>b.onclick=e=>{
    e.stopPropagation();
    const menu=document.getElementById('pmenu-'+b.dataset.playlistMenu); // getElementById takes the raw id — CSS.escape here broke ids starting with a digit
    const wasOpen=menu.classList.contains('open');
    document.querySelectorAll('.folder-menu.open').forEach(m=>m.classList.remove('open'));
    menu.classList.toggle('open',!wasOpen);
  });
  document.querySelectorAll('[data-playlist-rename2]').forEach(b=>b.onclick=async e=>{
    e.stopPropagation();
    document.querySelectorAll('.folder-menu.open').forEach(m=>m.classList.remove('open'));
    const p=playlists.find(x=>x.id===b.dataset.playlistRename2);
    const name=(prompt('Rename playlist:',p?p.name:'')||'').trim();
    if(!name)return;
    try{
      await api('/api/playlists/'+encodeURIComponent(b.dataset.playlistRename2),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name})});
      toast('Playlist renamed');
      await loadPlaylists();
    }catch(err){toast(err.message||'Could not rename playlist')}
  });
  document.querySelectorAll('[data-playlist-delete2]').forEach(b=>b.onclick=async e=>{
    e.stopPropagation();
    document.querySelectorAll('.folder-menu.open').forEach(m=>m.classList.remove('open'));
    const p=playlists.find(x=>x.id===b.dataset.playlistDelete2);
    if(!confirm('Delete playlist "'+(p?p.name:'this playlist')+'"? The videos themselves won\'t be deleted.'))return;
    try{
      await api('/api/playlists/'+encodeURIComponent(b.dataset.playlistDelete2),{method:'DELETE'});
      toast('Playlist deleted');
      if(playlist===b.dataset.playlistDelete2)location.href='/';
      else await loadPlaylists();
    }catch(err){toast(err.message||'Could not delete playlist')}
  });
}
async function loadPlaylists(){
  try{
    playlists=await api('/api/playlists');
    renderPlaylistList();
    updatePlaylistHeader();
  }catch(e){
    $('#playlistList').innerHTML='<div class="side-small">Could not load playlists.</div>';
  }
}
// "Save to playlist" modal: reuses the app's single shared #modal, building
// a checkbox per existing playlist (checked if this video is already in
// it - toggling calls the add/remove endpoint immediately, the same
// press-to-toggle feel as the like/favorite buttons) plus a small inline
// form for creating a brand new playlist with this video already in it.
async function showPlaylistModal(videoId){
  $('#modalTitle').textContent='Save to playlist';
  $('#modalText').textContent='';
  const actions=$('#modalActions');
  actions.innerHTML='<div class="side-small">Loading playlists…</div>';
  $('#modal').classList.add('show');
  let items;
  try{
    items=await api('/api/playlists?videoId='+encodeURIComponent(videoId));
  }catch(e){
    actions.innerHTML='<div class="side-small">Could not load playlists.</div>';
    return;
  }
  renderPlaylistModal(videoId,items);
}
function renderPlaylistModal(videoId,items){
  const actions=$('#modalActions');
  actions.innerHTML='';
  const list=document.createElement('div');
  list.className='pl-modal-list';
  if(!items.length){
    const empty=document.createElement('div');
    empty.className='side-small';
    empty.textContent='No playlists yet — create one below.';
    list.appendChild(empty);
  }
  items.forEach(pl=>{
    const row=document.createElement('label');
    row.className='pl-modal-item';
    const cb=document.createElement('input');
    cb.type='checkbox';
    cb.checked=!!pl.inPlaylist;
    cb.onchange=async()=>{
      cb.disabled=true;
      const wasChecked=cb.checked;
      try{
        if(wasChecked)await api('/api/playlists/'+encodeURIComponent(pl.id)+'/videos',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({videoId})});
        else await api('/api/playlists/'+encodeURIComponent(pl.id)+'/videos/'+encodeURIComponent(videoId),{method:'DELETE'});
        toast(wasChecked?'Added to '+pl.name:'Removed from '+pl.name);
        if(playlist===pl.id)await load();
        await loadPlaylists();
      }catch(err){
        cb.checked=!wasChecked;
        toast(err.message||'Could not update playlist');
      }
      cb.disabled=false;
    };
    const span=document.createElement('span');
    span.textContent=pl.name+' · '+pl.count+' video'+(pl.count===1?'':'s');
    row.appendChild(cb);row.appendChild(span);
    list.appendChild(row);
  });
  actions.appendChild(list);
  const form=document.createElement('form');
  form.className='pl-modal-create';
  const input=document.createElement('input');
  input.type='text';input.placeholder='New playlist name';input.maxLength=200;
  const btn=document.createElement('button');
  btn.type='submit';btn.textContent='Create';
  form.appendChild(input);form.appendChild(btn);
  form.onsubmit=async e=>{
    e.preventDefault();
    const name=input.value.trim();
    if(!name)return;
    btn.disabled=true;input.disabled=true;
    try{
      const created=await api('/api/playlists',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name})});
      await api('/api/playlists/'+encodeURIComponent(created.id)+'/videos',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({videoId})});
      toast('Created "'+name+'" and added the video');
      await loadPlaylists();
      const items2=await api('/api/playlists?videoId='+encodeURIComponent(videoId));
      renderPlaylistModal(videoId,items2);
    }catch(err){
      toast(err.message||'Could not create playlist');
      btn.disabled=false;input.disabled=false;
    }
  };
  actions.appendChild(form);
}
async function loadFolders(){
  try{
    folders=await api('/api/folders');
    renderFolderTree();
    updateFolderHeader();
  }catch(e){
    $('#folderTree').innerHTML='<div class="side-small">Could not load folders.</div>';
  }
}
document.querySelectorAll('[data-nav]').forEach(a=>{
  const isActive=(a.dataset.nav==='home'&&!list&&!folder&&!view)||(a.dataset.nav==='shorts'&&view==='shorts'&&list!=='liked')||(a.dataset.nav==='liked'&&list==='liked')||(a.dataset.nav==='favorites'&&list==='favorites')||(a.dataset.nav==='watchlater'&&list==='watchlater')||(a.dataset.nav==='history'&&view==='history');
  a.classList.toggle('active',isActive);
});
updateFolderHeader();
let orientationReloadTimer=null;
let orientationObserver=null;
// Auto orientation/Shorts detection used to fire for every video in the
// account the instant the home page loaded (up to MAX_CONCURRENT hidden
// <video> streams at once, regardless of what was actually on screen).
// Those hidden streams pull real bytes through the same single shared
// remote storage account and Durable Object (see src/remote-storage-do.js) that's also
// serving whatever the user is actually watching, so a library with many
// undetected videos could make real playback buffer/lag even on a fast
// connection - the bottleneck was self-inflicted background bandwidth,
// not the user's internet. Detection is now gated by an
// IntersectionObserver so a video is only ever queued once its card is
// actually visible (or about to scroll into view), the same way native
// lazy-loaded images work.
function ensureOrientationObserver(){
  if(orientationObserver)return orientationObserver;
  orientationObserver=new IntersectionObserver(entries=>{
    entries.forEach(entry=>{
      if(!entry.isIntersecting)return;
      orientationObserver.unobserve(entry.target);
      if(!window.detectOrientation)return;
      const id=entry.target.dataset.watch;
      window.detectOrientation(id).then(result=>{
        if(!result)return;
        const v=all.find(x=>x.id===id);
        if(v&&typeof result.isShort==='boolean'){
          // The server now returns the effective values, so update this
          // video in place and re-render once for a whole burst of results
          // - no need to re-download the entire library for each detection.
          v.orientationKnown=true;v.isPortrait=!!result.isPortrait;v.isShort=result.isShort;
          if(result.duration)v.duration=result.duration;
          if(result.quality)v.quality=result.quality;
          clearTimeout(orientationReloadTimer);
          orientationReloadTimer=setTimeout(renderSoon,700);
        }else{
          // Older server response without those fields: fall back to one
          // quiet reload, well after the last detection lands.
          clearTimeout(orientationReloadTimer);
          orientationReloadTimer=setTimeout(()=>load(true),4000);
        }
      });
    });
  },{rootMargin:'600px'});
  return orientationObserver;
}
function observeUnknownOrientations(){
  if(!window.detectOrientation)return;
  const obs=ensureOrientationObserver();
  const byId=new Map(all.map(x=>[x.id,x]));
  document.querySelectorAll('.thumb[data-watch]').forEach(el=>{
    const v=byId.get(el.dataset.watch);
    if(v&&!v.orientationKnown)obs.observe(el);
  });
}
// ---- Instant-back cache: when the user comes back to Home (Back button,
// or the logo/"Home" link from the watch page), show the exact same feed
// immediately instead of a skeleton + fresh fetch, then quietly refresh
// underneath. Keyed by which feed this is (all videos vs a folder vs
// liked/favorites) so switching between those never shows the wrong list.
const HOME_CACHE_KEY='mytube_home_cache';
function saveHomeCache(){
  try{
    const owner='local';
    if(!owner)return; // don't cache before we've confirmed who's signed in
    sessionStorage.setItem(HOME_CACHE_KEY,JSON.stringify({owner,url:folderVideosUrl(),all,recSeed,ts:Date.now()}));
  }catch{}
}
function loadHomeCache(){
  try{
    const raw=sessionStorage.getItem(HOME_CACHE_KEY);
    if(!raw)return null;
    const cache=JSON.parse(raw);
    // Only ever reused for the same account that was last confirmed signed
    // in on this tab (see local storage identity) - otherwise a different
    // account's cached videos could flash on screen before the fresh
    // /api/me + video fetch below has a chance to correct it.
    const owner='local';
    if(!cache||!owner||cache.owner!==owner||cache.url!==folderVideosUrl()||!Array.isArray(cache.all)||!cache.all.length)return null;
    return cache;
  }catch{return null}
}

// ---- Offline fallback: when there's no connection, show what's already
// saved in this browser's in-app storage (IndexedDB) instead of an error
// or bouncing the user to the sign-in page. See idb-downloads.js. ----
let offlineUrls=[];
function revokeOfflineUrls(){offlineUrls.forEach(u=>URL.revokeObjectURL(u));offlineUrls=[]}
async function showOfflineHome(){
  firstLoadDone=true;
  if(window.MyTubeOffline)MyTubeOffline.showBanner("You're offline — showing your downloaded videos.");
  $('#accountStatus').textContent="You're offline";
  revokeOfflineUrls();
  if(!window.AppDownloads){
    $('#grid').innerHTML=renderEmpty('⚠','You\'re offline','Reconnect to the internet to load your videos.');
    return;
  }
  let items=[];
  try{items=await AppDownloads.listVideos()}catch{}
  if(!items.length){
    $('#grid').innerHTML=renderEmpty('📲','You\'re offline','No downloaded videos yet. While you\'re online, use "Download offline" (or Save on a Short) so videos are here next time you\'re offline.');
    return;
  }
  items.sort((a,b)=>(b.savedAt||0)-(a.savedAt||0));
  $('#grid').innerHTML=items.map(it=>{
    let posterUrl='';
    if(it.poster){posterUrl=URL.createObjectURL(it.poster);offlineUrls.push(posterUrl)}
    const href='/watch.html?id='+encodeURIComponent(it.id);
    return `<article class="video-card"><a class="thumb" target="_top" href="${href}" data-watch="${esc(it.id)}">${posterUrl?`<img src="${posterUrl}" alt="">`:'<div class="no-poster" style="display:flex;align-items:center;justify-content:center;height:100%;background:#1c1c1c;color:#666;font-size:34px">▶</div>'}<span class="thumb-play">▶</span></a><div class="card-row"><div class="channel-avatar">${esc((it.title||'M').trim()[0].toUpperCase())}</div><div class="card-body"><a class="video-title" target="_top" href="${href}" data-watch="${esc(it.id)}">${esc(it.title||'Untitled video')}</a><p class="channel">D Vault</p><p class="stats">${['Downloaded',fmtSize(it.size),'available offline'].filter(Boolean).join(' · ')}</p></div></div></article>`;
  }).join('');
  document.querySelectorAll('[data-watch]').forEach(a=>a.addEventListener('click',()=>addHistory(a.dataset.watch)));
}
function renderEmpty(icon,title,text){return `<div class="empty-state"><div class="empty-icon">${icon}</div><h2>${title}</h2><p>${text}</p></div>`}

// `load()` used to run the sign-in check and the video fetch in one big
// try/catch, so ANY failure while fetching videos from Drive (a slow/cold
// Drive token refresh, a transient Drive error, etc.) - even though the user was
// properly signed in - got misreported as "you're not signed in" and
// bounced the user straight back to /settings.html. Now only an actual 401
// from the server sends you to the sign-in page; other errors show inline.
// A connectivity failure (offline, or a fetch that never reached the
// server at all) never redirects — it falls back to showOfflineHome().
async function load(silent){
  if(window.DVaultBootstrap) await window.DVaultBootstrap.ready();
  // Checked first, before touching the cached home list below: that cache
  // holds whatever was in your regular library last time you were online,
  // not necessarily what's actually downloaded - rendering it even briefly
  // on a reload while offline would flash videos that can't actually play,
  // before getting overwritten a moment later by the downloads-only view.
  if(window.MyTubeOffline&&MyTubeOffline.isOffline())return showOfflineHome();
  if(!silent&&!firstLoadDone){
    const cache=loadHomeCache();
    if(cache){
      all=cache.all;
      recSeed=cache.recSeed||[];
      firstLoadDone=true;
      render();
      silent=true; // already showing content — refresh quietly instead of flashing a skeleton
    }else{
      showSkeleton();
    }
  }
  // Start the (slow) video list request now instead of waiting for /api/me
  // to finish first - they don't depend on each other.
  const videosP=api(folderVideosUrl());videosP.catch(()=>{});
  let me;
  try{
    me=await api('/api/me');
  }catch(e){
    firstLoadDone=true;
    if(window.MyTubeOffline&&MyTubeOffline.looksOffline(e))return showOfflineHome();
    location.href='/settings.html';
    return;
  }
  if(window.MyTubeOffline)MyTubeOffline.hideBanner();
  
  window.DVaultStorage&&window.DVaultStorage.getActive().then(a=>{if(a)$('#accountStatus').textContent='Storage: '+a.name;});
  if(me.email){const initial=((me.name||me.email||'').trim()[0]||'A').toUpperCase();const bn=$('#bnavAvatar');if(bn)bn.textContent=initial;const av=$('#avatarInitial');if(av)av.textContent=initial}
  try{
    all=(await videosP).filter(v=>!v.isFolder);
    pruneCardCache();
    if(!recSeed.length)shuffleRecommendations();
    firstLoadDone=true;
    if(silent)$('#grid').classList.add('refreshing');
    render();
    if(silent)setTimeout(()=>$('#grid').classList.remove('refreshing'),500);
    saveHomeCache();
  }catch(e){
    firstLoadDone=true;
    if(window.MyTubeOffline&&MyTubeOffline.looksOffline(e))return showOfflineHome();
    if(e.status===401){location.href='/settings.html';return}
    all=[]; // never fall back to a previous/other account's videos on error
    if(/remote storage account isn't connected/.test(e.message||'')){
      $('#accountStatus').textContent='remote storage is not connected yet.';
      $('#grid').innerHTML=renderEmpty('🔗','Connect your remote storage','Each D Vault account has its own private library. Connect your remote storage on the Settings page to see your videos, Shorts, and playlists here.');
      return;
    }
    $('#accountStatus').textContent='Could not load videos: '+(e.message||'Unknown error');
    render();
  }
}
window.addEventListener('offline',()=>{if(firstLoadDone)showOfflineHome()});
window.addEventListener('online',()=>{load()});
$('#searchForm').onsubmit=e=>{e.preventDefault();syncSearchUrl();render()};let searchTimer=0;$('#search').oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{syncSearchUrl();render()},120)};document.querySelectorAll('.chip').forEach(b=>b.onclick=()=>{document.querySelectorAll('.chip').forEach(x=>x.classList.remove('active'));b.classList.add('active');activeCat=b.dataset.cat;render()});
// Home filter tabs: All / Videos / Shorts switch the grid in place;
// Photos hands off to the dedicated Photos page (a separate library).
document.querySelectorAll('.filter-tab').forEach(b=>{
  b.classList.toggle('active',b.dataset.filter===homeFilter);
  b.onclick=()=>{
    const f=b.dataset.filter;
    if(f==='photos'){
      // This is a full page navigation, so acknowledge the tap immediately
      // instead of leaving the old grid sitting there looking frozen.
      document.querySelectorAll('.filter-tab').forEach(x=>x.classList.toggle('active',x===b));
      const g=$('#grid');if(g){g.style.transition='opacity .15s';g.style.opacity='.35';g.style.pointerEvents='none'}
      location.href='/photos.html'+(list==='liked'?'?list=liked':'');return}
    if(f===homeFilter)return;
    homeFilter=f;
    document.querySelectorAll('.filter-tab').forEach(x=>x.classList.toggle('active',x===b));
    render();
  };
});
// The search box in the title bar starts collapsed into just the icon
// button; tapping it expands the real input (and it stays expanded
// whenever there's already a query, so results/URL stay legible).
(function(){
  const btn=$('#searchToggleBtn'),form=$('#searchForm'),input=$('#search');
  if(!btn||!form||!input)return;
  function openSearch(){form.classList.add('open');btn.setAttribute('aria-expanded','true');input.focus()}
  function closeSearch(){form.classList.remove('open');btn.setAttribute('aria-expanded','false')}
  btn.onclick=()=>{form.classList.contains('open')&&!input.value.trim()?closeSearch():(form.classList.contains('open')?input.focus():openSearch())};
  input.addEventListener('keydown',e=>{if(e.key==='Escape'){input.value='';syncSearchUrl();render();closeSearch()}});
  document.addEventListener('click',e=>{if(form.classList.contains('open')&&!input.value.trim()&&!form.contains(e.target)&&e.target!==btn&&!btn.contains(e.target))closeSearch()});
  if(initialQuery||params.get('focusSearch'))openSearch();
})();
function openMenu(){$('#sidebar').classList.add('open');$('#sidebarBackdrop').classList.add('show');document.body.classList.add('dp-sidebar-locked')}
function closeMenu(){$('#sidebar').classList.remove('open');$('#sidebarBackdrop').classList.remove('show');document.body.classList.remove('dp-sidebar-locked')}
$('#menuBtn').onclick=()=>{$('#sidebar').classList.contains('open')?closeMenu():openMenu()};
$('#sidebarClose').onclick=closeMenu;
$('#sidebarBackdrop').onclick=closeMenu;
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeMenu()});
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{location.href='/?view='+encodeURIComponent(b.dataset.view)});
$('#createBtn').onclick=()=>showModal('Local storage','Choose a storage folder in Settings to manage your local media.');$('#bellBtn').onclick=()=>showModal('Notifications','You have no new notifications.');
$('#avatarBtn').onclick=async()=>{const a=await window.DVaultStorage.getActive();showModal('Storage',a?a.name:'No storage folder selected');};$('#modalClose').onclick=()=>$('#modal').classList.remove('show');$('#modal').onclick=e=>{if(e.target.id==='modal')$('#modal').classList.remove('show')};function clearModalActions(){const a=$('#modalActions');if(a)a.innerHTML=''}
function showModal(t,m){$('#modalTitle').textContent=t;$('#modalText').textContent=m;clearModalActions();$('#modal').classList.add('show')}
function showAccountModal(email){showModal('Storage',email||'Local storage');}
document.querySelectorAll('[data-bnav]').forEach(a=>{
  const isActive=(a.dataset.bnav==='home'&&!list&&!folder&&!view)||(a.dataset.bnav==='history'&&view==='history');
  a.classList.toggle('active',isActive);
});
const bnavProfileBtn=$('#bnavProfileBtn');
if(bnavProfileBtn)bnavProfileBtn.onclick=()=>location.href='/settings.html';
(function(){
  const bar=$('#homeBottomNav');
  if(!bar)return;
  let lastY=window.scrollY||0,ticking=false;
  window.addEventListener('scroll',()=>{
    if(ticking)return;
    ticking=true;
    requestAnimationFrame(()=>{
      const y=window.scrollY||0;
      if(y<40)bar.classList.remove('hide');
      else if(y>lastY+4)bar.classList.add('hide');
      else if(y<lastY-4)bar.classList.remove('hide');
      lastY=y;ticking=false;
    });
  },{passive:true});
})();
const newPlaylistBtn=$('#newPlaylistBtn');
if(newPlaylistBtn)newPlaylistBtn.onclick=async()=>{
  const name=(prompt('Playlist name:')||'').trim();
  if(!name)return;
  try{
    await api('/api/playlists',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name})});
    toast('Playlist created');
    // The Playlists section starts collapsed — open it so the new one shows.
    if(window.DPSidebar&&DPSidebar.openPlaylists)DPSidebar.openPlaylists();
    await loadPlaylists();
  }catch(e){toast(e.message||'Could not create playlist')}
};
const playlistRenameBtn=$('#playlistRenameBtn');
if(playlistRenameBtn)playlistRenameBtn.onclick=async()=>{
  const p=playlists.find(x=>x.id===playlist);
  const name=(prompt('Rename playlist:',p?p.name:'')||'').trim();
  if(!name)return;
  try{
    await api('/api/playlists/'+encodeURIComponent(playlist),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name})});
    toast('Playlist renamed');
    await loadPlaylists();
  }catch(e){toast(e.message||'Could not rename playlist')}
};
const playlistDeleteBtn=$('#playlistDeleteBtn');
if(playlistDeleteBtn)playlistDeleteBtn.onclick=async()=>{
  const p=playlists.find(x=>x.id===playlist);
  if(!confirm('Delete playlist "'+(p?p.name:'this playlist')+'"? The videos themselves won\'t be deleted.'))return;
  try{
    await api('/api/playlists/'+encodeURIComponent(playlist),{method:'DELETE'});
    toast('Playlist deleted');
    location.href='/';
  }catch(e){toast(e.message||'Could not delete playlist')}
};
document.addEventListener('click',e=>{if(!e.target.closest('.more-btn')&&!e.target.closest('.card-menu'))document.querySelectorAll('.card-menu.open').forEach(x=>x.classList.remove('open'))});
document.addEventListener('click',e=>{if(!e.target.closest('.folder-menu-btn')&&!e.target.closest('.folder-menu'))document.querySelectorAll('.folder-menu.open').forEach(x=>x.classList.remove('open'))});
window.addEventListener("dvault:thumbnail-ready",async e=>{const id=String(e.detail?.id||"");if(!id||!window.DVaultMedia)return;const u=await DVaultMedia.thumbnailUrl(id);if(!u)return;document.querySelectorAll('[data-watch]').forEach(a=>{if(a.dataset.watch===id){const img=a.closest(".video-card")?.querySelector(".thumb img");if(img)img.src=u}});render();});
window.addEventListener("dvault:sprite-ready",()=>{if(typeof load==="function")load(true)});
load();loadFolders();loadPlaylists();refreshDownloadedIds();
// Coming back from the Shorts player's search icon: hand focus straight to the search box.
if(params.get('focusSearch')){const sb=$('#search');if(sb){setTimeout(()=>{sb.focus();sb.select()},50)}}