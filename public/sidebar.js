// ============================================================
// GlobalSidebar — the ONE hamburger-menu/sidebar implementation
// for the entire site.
//
// This file is the single source of truth for the drawer's markup
// (injected into <aside id="sidebar"></aside>, which every page
// leaves empty) AND for its shared behavior: open/close,
// active-page highlighting, the account line and "Folders"/
// "Playlists" lists. ("Liked" is a single, static nav item — see
// template() below — so it has no wiring of its own anymore; the
// 'liked' key in DP_SIDEBAR_SKIP is kept only so older pages that
// still pass it don't need to change.)
//
// A page that already owns a piece of this itself (e.g. app.js's
// richer merge-aware folder tree) can opt that piece out before
// this script runs:
//   window.DP_SIDEBAR_SKIP = ['toggle','active','account','folders','playlists'];
// Every page still gets the same markup, so the drawer looks and
// is structured identically everywhere no matter which pieces of
// behavior it owns locally.
(function(){
  const $=s=>document.querySelector(s);
  const skip=new Set(window.DP_SIDEBAR_SKIP||[]);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const params=new URLSearchParams(location.search);

  async function api(url){
    const r=await fetch(url,{credentials:'include'});
    if(!r.ok){const j=await r.json().catch(()=>({}));throw Object.assign(Error(j.error||r.statusText),{status:r.status})}
    return r.json();
  }

  // ---- Icons (inline SVG — no emoji, per design spec) ----
  const ICON_FOLDER='<svg viewBox="0 0 24 24" width="20" height="20" fill="#f5c518"><path d="M10.2 4.5H4.75A1.75 1.75 0 0 0 3 6.25v11.5c0 .966.784 1.75 1.75 1.75h14.5A1.75 1.75 0 0 0 21 17.75V8.25a1.75 1.75 0 0 0-1.75-1.75h-7.62l-1.43-2Z"/></svg>';
  const ICON_FOLDER_OUTLINE='<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M10.2 4.5H4.75A1.75 1.75 0 0 0 3 6.25v11.5c0 .966.784 1.75 1.75 1.75h14.5A1.75 1.75 0 0 0 21 17.75V8.25a1.75 1.75 0 0 0-1.75-1.75h-7.62l-1.43-2Z"/></svg>';
  const ICON_PLAYLIST_ROW='<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><path d="M4 6h11M4 12h11M4 18h7"/><circle cx="19" cy="16" r="2.6" fill="#fff" stroke="none"/><path d="M19 8v6.4" /></svg>';
  const ICON_LOGOUT='<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>';
  // Outline-only thumbs-up for the single "Liked" nav item (replaces the
  // old filled liked-icon.png), matching the reference icon supplied for
  // this item specifically.
  const ICON_LIKE_OUTLINE='<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7.5 10.25v10H4.75a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1H7.5Z"/><path d="M7.5 10.25l3.9-7.4a2.1 2.1 0 0 1 2.1 2.1v4.05h5.09a2.1 2.1 0 0 1 2.05 2.56l-1.46 6.5a2.1 2.1 0 0 1-2.05 1.64H9.6a2.1 2.1 0 0 1-2.1-2.1v-7.35Z"/></svg>';

  // ---- The ONE sidebar template, used by every page. ----
  function template(){
    // "Liked" needs to land on the liked view of whichever library the
    // user is currently browsing: liked *photos* while on the Photos page,
    // liked *videos* everywhere else. Hardcoding it to the video home page
    // meant tapping Liked while on Photos silently dropped you into the
    // (empty, video-only) home Liked list, so liked photos never appeared.
    const likedHref=location.pathname==='/photos.html'?'/photos.html?list=liked':'/?list=liked';
    return `
    <div class="sidebar-head">
      <img class="brand-logo sidebar-logo" src="/d-vault-logo.svg" alt="">
      <span class="sidebar-title">D Vault</span>
      <button class="icon-btn sidebar-close" id="sidebarClose" aria-label="Close menu">×</button>
    </div>
    <a class="side-item" href="/" data-nav="home">
      <span class="side-icon"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3.2 3 10.5V21a1 1 0 0 0 1 1h5.5a.75.75 0 0 0 .75-.75V15.5a1.75 1.75 0 0 1 3.5 0v5.75c0 .414.336.75.75.75H20a1 1 0 0 0 1-1V10.5L12 3.2Z"/></svg></span>
      <span>Home</span>
    </a>
    <a class="side-item" href="/shorts.html?random=1" data-nav="shorts">
      <span class="side-icon"><img src="/icons/shorts-icon.png" alt="" class="shorts-nav-icon"></span>
      <span>Shorts</span>
    </a>
    <a class="side-item" href="/photos.html" data-nav="photos">
      <span class="side-icon"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M21 5H3a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h18a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1Zm-1 12H4V7h16v10Zm-3-8a2 2 0 1 1 0 4 2 2 0 0 1 0-4ZM5 16l4-5 3 3.5L15 11l4 5H5Z"/></svg></span>
      <span>Photos</span>
    </a>
    <a class="side-item" href="${likedHref}" data-nav="liked">
      <span class="side-icon">${ICON_LIKE_OUTLINE}</span>
      <span>Liked</span>
    </a>
    <a class="side-item" href="/?list=favorites" data-nav="favorites">
      <span class="side-icon fav-icon side-fav-icon"></span>
      <span>Favorites</span>
    </a>
    <a class="side-item" href="/downloads.html" data-nav="downloads">
      <span class="side-icon"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3a1 1 0 0 1 1 1v9.59l2.3-2.3a1 1 0 1 1 1.4 1.42l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.42l2.3 2.3V4a1 1 0 0 1 1-1Z"/><path d="M5 19a1 1 0 0 1 1-1h12a1 1 0 1 1 0 2H6a1 1 0 0 1-1-1Z"/></svg></span>
      <span>Downloads</span>
    </a>
    <button class="side-item" data-view="history" data-nav="history">
      <span class="side-icon"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M13 3a9 9 0 1 0 8.94 10h-2.02A7 7 0 1 1 13 5c1.66 0 3.14.63 4.28 1.66L14 10h7V3l-2.35 2.35A8.98 8.98 0 0 0 13 3Z"/><path d="M12 8v5l4 2-.75 1.3L11 13.5V8Z"/></svg></span>
      <span>History</span>
    </button>
    <div class="side-divider"></div>
    <button class="side-title-row side-title-toggle" id="foldersToggle" type="button" aria-expanded="false">
      <span class="side-title-icon">${ICON_FOLDER_OUTLINE}</span>
      <span class="side-title">Folders</span>
      <span class="side-chevron" id="foldersChevron">❯</span>
    </button>
    <div id="folderTree" class="folder-tree" hidden><div class="side-small">Loading folders…</div></div>
    <div class="side-divider"></div>
    <div class="side-title-row playlists-head">
      <button class="side-title side-playlists-toggle" id="playlistsToggle" type="button" aria-expanded="false" aria-controls="playlistList"><span class="side-title-icon">${ICON_PLAYLIST_ROW}</span><span>Playlists</span></button>
      <button class="side-title-action" id="newPlaylistBtn" type="button" aria-label="New playlist"><img src="/icons/playlist-icon.png" alt="" class="side-title-action-icon"></button>
    </div>
    <div id="playlistList" class="folder-tree playlist-tree" hidden><div class="side-small">Loading playlists…</div></div>
    <div class="side-divider"></div>
    <div class="side-title side-title-muted">You</div>
    <a class="side-item" href="/settings.html">
      <span class="side-icon">⚙</span>
      <span>Storage settings</span>
    </a>
    <a class="side-item" href="/?list=watchlater" data-nav="watchlater">
      <span class="side-icon"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 5h11v2H4V5Zm0 4.5h11v2H4v-2ZM4 13h7v2H4v-2Zm13-1v8l6-4-6-4Z"/></svg></span>
      <span>Watch later</span>
    </a>
    <div class="side-divider"></div>
    <div class="side-small" id="accountStatus">Local storage vault</div>
    `;
  }

  // Render the shared markup into the empty <aside id="sidebar"></aside>
  // every page ships. If a page has somehow already populated it (or the
  // element is missing), leave it alone.
  function render(){
    const sidebar=$('#sidebar');
    if(!sidebar||sidebar.dataset.dpRendered)return;
    sidebar.innerHTML=template();
    sidebar.dataset.dpRendered='1';
  }

  // Open/close the drawer + backdrop.
  function wireToggle(){
    if(skip.has('toggle'))return;
    const sidebar=$('#sidebar'),backdrop=$('#sidebarBackdrop'),menuBtn=$('#menuBtn');
    if(!sidebar||!backdrop||!menuBtn)return;
    const open=()=>{sidebar.classList.add('open');backdrop.classList.add('show');document.body.classList.add('dp-sidebar-locked')};
    const close=()=>{sidebar.classList.remove('open');backdrop.classList.remove('show');document.body.classList.remove('dp-sidebar-locked')};
    menuBtn.onclick=()=>{sidebar.classList.contains('open')?close():open()};
    const sidebarClose=$('#sidebarClose');
    if(sidebarClose)sidebarClose.onclick=close;
    backdrop.onclick=close;
    document.addEventListener('keydown',e=>{if(e.key==='Escape')close()});
  }

  // "Liked" is now a single top-level nav item (see template()) with no
  // expand/collapse state of its own, so there's nothing left to wire here.

  // Buttons like "History" navigate to the home page filtered by view.
  function wireDataView(){
    document.querySelectorAll('[data-view]').forEach(b=>{
      b.onclick=()=>{location.href='/?view='+encodeURIComponent(b.dataset.view)};
    });
  }

  // Expand/collapse the "Folders" list. This is pure UI chrome (not data
  // loading), so it's wired on every page regardless of DP_SIDEBAR_SKIP —
  // whichever script populates #folderTree (this file, or a page's own
  // richer loader) still shows/hides behind the same chevron.
  function wireFoldersToggle(){
    const btn=$('#foldersToggle'),tree=$('#folderTree');
    if(!btn||!tree)return;
    const setOpen=open=>{
      tree.hidden=!open;
      btn.classList.toggle('open',open);
      btn.setAttribute('aria-expanded',open?'true':'false');
    };
    setOpen(!!params.get('folder'));
    btn.onclick=()=>setOpen(tree.hidden);
  }

  // Expand/collapse the "Playlists" list. Created playlists stay hidden until
  // the "Playlists" header is tapped (same idea as "Folders"). Pure UI chrome,
  // so it's wired on every page regardless of DP_SIDEBAR_SKIP — whichever
  // script fills #playlistList (this file, app.js or watch.js) still shows and
  // hides behind the same header. Always starts collapsed.
  function setPlaylistsOpen(open){
    const btn=$('#playlistsToggle'),list=$('#playlistList');
    if(!btn||!list)return;
    list.hidden=!open;
    btn.classList.toggle('open',open);
    btn.setAttribute('aria-expanded',open?'true':'false');
  }
  function wirePlaylistsToggle(){
    const btn=$('#playlistsToggle'),list=$('#playlistList');
    if(!btn||!list)return;
    setPlaylistsOpen(false);
    btn.onclick=()=>setPlaylistsOpen(list.hidden);
  }
  // Tiny feedback helper for pages that have the shared #toast element
  // (home, photos, downloads). Pages without one only get an alert for errors.
  function notify(msg,isError){
    const t=document.getElementById('toast');
    if(t){
      t.textContent=msg;t.classList.add('show');
      clearTimeout(window.__dpSidebarToast);
      window.__dpSidebarToast=setTimeout(()=>t.classList.remove('show'),2200);
    }else if(isError){alert(msg)}
  }

  // A small "⋮" popup menu, shared by folder and playlist rows.
  function closeAllMenus(){
    document.querySelectorAll('.folder-menu.open').forEach(m=>m.classList.remove('open'));
  }
  document.addEventListener('click',e=>{
    if(!e.target.closest('.folder-menu-btn')&&!e.target.closest('.folder-menu'))closeAllMenus();
  });

  // Highlight whichever nav item matches the current page/query.
  function highlightActive(){
    if(skip.has('active'))return;
    const path=location.pathname;
    const list=params.get('list')||'',view=params.get('view')||'';
    document.querySelectorAll('[data-nav]').forEach(a=>{
      const nav=a.dataset.nav;
      const isActive=
        (nav==='home'&&(path==='/'||path==='/index.html')&&!list&&!view)||
        (nav==='shorts'&&path==='/shorts.html'&&list!=='liked')||
        (nav==='photos'&&path==='/photos.html'&&list!=='liked')||
        (nav==='liked'&&list==='liked')||
        (nav==='favorites'&&list==='favorites')||
        (nav==='watchlater'&&list==='watchlater')||
        (nav==='downloads'&&path==='/downloads.html')||
        (nav==='history'&&view==='history');
      a.classList.toggle('active',isActive);
    });
  }

  // Account status line + sign-out is static (a plain /logout link), but
  // the "Signed in as…" text needs the current user's email.
  function loadAccount(){
    if(skip.has('account'))return;
    const el=$('#accountStatus');
    if(!el)return;
    api('/api/me').then(me=>{
      el.textContent='Signed in as '+(me.email||'');
    }).catch(()=>{
      el.textContent='';
    });
  }

  // Folder tree + playlist list: nav-only versions (clicking always takes
  // you to the home page filtered by that folder/playlist), matching how
  // app.js's own folder/playlist links behave.
  function loadFolders(){
    if(skip.has('folders'))return;
    const el=$('#folderTree');
    if(!el)return;
    api('/api/folders').then(folders=>{
      const roots=folders.filter(f=>!f.parentId&&!f.mergedInto).sort((a,b)=>a.name.localeCompare(b.name));
      el.innerHTML=roots.length?roots.map(f=>'<div class="folder-node"><div class="folder-row"><span class="folder-toggle-spacer"></span><button class="folder-link" data-folder-link="'+esc(f.id)+'">'+ICON_FOLDER+' <span>'+esc(f.name)+'</span></button><button type="button" class="folder-menu-btn" data-folder-menu="'+esc(f.id)+'" aria-label="Folder options">⋮</button><div class="folder-menu" id="fmenu-'+esc(f.id)+'"><button data-folder-link="'+esc(f.id)+'">Open folder</button></div></div></div>').join(''):'<div class="side-small">No folders found.</div>';
      el.querySelectorAll('[data-folder-link]').forEach(b=>b.onclick=()=>{location.href='/?folder='+encodeURIComponent(b.dataset.folderLink)});
      el.querySelectorAll('[data-folder-menu]').forEach(b=>b.onclick=e=>{
        e.stopPropagation();
        const menu=$('#fmenu-'+CSS.escape(b.dataset.folderMenu));
        const wasOpen=menu.classList.contains('open');
        closeAllMenus();
        menu.classList.toggle('open',!wasOpen);
      });
    }).catch(()=>{
      el.innerHTML='<div class="side-small">Could not load folders.</div>';
    });
  }

  function loadPlaylists(){
    if(skip.has('playlists'))return;
    const el=$('#playlistList');
    if(!el)return;
    api('/api/playlists').then(list=>{
      el.innerHTML=list.length?list.map(p=>'<div class="folder-node"><div class="folder-row"><span class="folder-toggle-spacer"></span><button class="folder-link" data-playlist-link="'+esc(p.id)+'">'+ICON_PLAYLIST_ROW+' <span>'+esc(p.name)+'</span></button><button type="button" class="folder-menu-btn" data-playlist-menu="'+esc(p.id)+'" aria-label="Playlist options">⋮</button><div class="folder-menu playlist-menu" id="pmenu-'+esc(p.id)+'"><button data-playlist-rename="'+esc(p.id)+'">Rename</button><button class="unmerge-btn" data-playlist-delete="'+esc(p.id)+'">Delete</button></div></div></div>').join(''):'<div class="side-small">No playlists yet.</div>';
      el.querySelectorAll('[data-playlist-link]').forEach(b=>b.onclick=()=>{location.href='/?playlist='+encodeURIComponent(b.dataset.playlistLink)});
      el.querySelectorAll('[data-playlist-menu]').forEach(b=>b.onclick=e=>{
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        const menu=$('#pmenu-'+CSS.escape(b.dataset.playlistMenu));
        if(!menu)return;
        const wasOpen=menu.classList.contains('open');
        closeAllMenus();
        if(wasOpen)return;

        // Playlist menus live inside the scrolling hamburger drawer.
        // Position the popup from the button so it is never clipped by
        // the drawer's scroll area, especially for the last playlist.
        menu.style.position='fixed';
        menu.style.right='auto';
        menu.style.left='0px';
        menu.style.top='0px';
        menu.classList.add('open');
        const br=b.getBoundingClientRect();
        const mr=menu.getBoundingClientRect();
        const gap=4;
        let left=br.right-mr.width;
        let top=br.bottom+gap;
        const pad=8;
        left=Math.max(pad,Math.min(left,window.innerWidth-mr.width-pad));
        if(top+mr.height>window.innerHeight-pad)top=Math.max(pad,br.top-mr.height-gap);
        menu.style.left=Math.round(left)+'px';
        menu.style.top=Math.round(top)+'px';
      });
      el.querySelectorAll('[data-playlist-rename]').forEach(b=>b.onclick=async e=>{
        e.stopPropagation();closeAllMenus();
        const p=list.find(x=>x.id===b.dataset.playlistRename);
        const name=(prompt('Rename playlist:',p?p.name:'')||'').trim();
        if(!name)return;
        try{
          await fetch('/api/playlists/'+encodeURIComponent(b.dataset.playlistRename),{method:'POST',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify({name})});
          loadPlaylists();
        }catch(err){}
      });
      el.querySelectorAll('[data-playlist-delete]').forEach(b=>b.onclick=async e=>{
        e.stopPropagation();closeAllMenus();
        const p=list.find(x=>x.id===b.dataset.playlistDelete);
        if(!confirm('Delete playlist "'+(p?p.name:'this playlist')+'"? The videos themselves won\'t be deleted.'))return;
        try{
          await fetch('/api/playlists/'+encodeURIComponent(b.dataset.playlistDelete),{method:'DELETE',credentials:'include'});
          loadPlaylists();
        }catch(err){}
      });
    }).catch(()=>{
      el.innerHTML='<div class="side-small">Could not load playlists.</div>';
    });
  }

  // "＋ New playlist" button — reuses the same endpoint app.js uses.
  function wireNewPlaylist(){
    if(skip.has('playlists'))return;
    const btn=$('#newPlaylistBtn');
    if(!btn)return;
    btn.onclick=async()=>{
      const name=(prompt('Name this playlist:')||'').trim();
      if(!name)return;
      try{
        const r=await fetch('/api/playlists',{method:'POST',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify({name})});
        const d=await r.json().catch(()=>({}));
        if(!r.ok)throw new Error(d.error||'Could not create playlist');
        notify('Playlist created');
        // Show the list so the new playlist is visibly there.
        setPlaylistsOpen(true);
        loadPlaylists();
      }catch(e){notify(e.message||'Could not create playlist',true)}
    };
  }

  // While the drawer is open, the page behind it must not scroll.
  // `overflow:hidden` on <body> (see .dp-sidebar-locked in style.css) covers
  // desktop and modern phones, but iOS Safari and some Android WebViews
  // still let a finger-drag on the dimmed backdrop scroll the page. So we
  // also cancel touch-scrolling unless the touch is inside the drawer AND
  // the drawer itself has something to scroll. Runs on every page that
  // loads sidebar.js, independent of DP_SIDEBAR_SKIP.
  function lockPageScrollWhileOpen(){
    document.addEventListener('touchmove',e=>{
      const sb=$('#sidebar');
      if(!sb||!sb.classList.contains('open'))return;
      const inside=sb.contains(e.target);
      const scrollable=sb.scrollHeight>sb.clientHeight+1;
      if(inside&&scrollable)return;   // let the drawer scroll itself
      if(e.cancelable)e.preventDefault();
    },{passive:false});
  }

  function init(){
    render();
    lockPageScrollWhileOpen();
    wireToggle();
    wireDataView();
    wireFoldersToggle();
    wirePlaylistsToggle();
    highlightActive();
    loadAccount();
    loadFolders();
    loadPlaylists();
    wireNewPlaylist();
  }

  // Render must happen as soon as the container exists in the DOM (this
  // script tag is placed right after <aside id="sidebar"></aside> on every
  // page, before any page-specific script that reads #folderTree,
  // #playlistList, etc.), so we don't wait for
  // DOMContentLoaded for that part.
  render();
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);
  else init();

  // Exposed so page scripts (app.js, watch.js) that own their own folder
  // tree can re-render the shared icon set consistently if they want to.
  window.DPSidebarIcons={folder:ICON_FOLDER,playlist:ICON_PLAYLIST_ROW,logout:ICON_LOGOUT};
  // Lets page scripts that own their own playlist list (app.js, watch.js)
  // expand the collapsed "Playlists" section, e.g. right after creating one.
  window.DPSidebar={openPlaylists:()=>setPlaylistsOpen(true)};
})();
