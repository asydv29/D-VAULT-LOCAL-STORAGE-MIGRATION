// DPlayer Universal Preview System
// One implementation shared by home/search/library cards and watch-page recommendations.
(function(){
  let active=null;
  const cardSelector='.thumb,.rec-thumb';
  function stop(vid,card){
    if(vid._dpEnded){vid.removeEventListener('ended',vid._dpEnded);vid._dpEnded=null}
    if(active?.vid===vid)active=null;
    card.classList.remove('previewing','loading');
    const bar=card.querySelector('.thumb-loadbar');if(bar){bar.style.width='0';bar.style.transition='none';bar.classList.remove('from-right')}
    vid.pause();vid.removeAttribute('src');vid.load();
  }
  // Progress line = only the part already watched. Driven by the real playhead
  // (not a timed CSS transition), so nothing is drawn for the unplayed remainder.
  function trackBar(vid,card,reverse,invert=reverse){
    const bar=card.querySelector('.thumb-loadbar');if(!bar)return;
    bar.classList.toggle('from-right',!!reverse);bar.style.transition='none';bar.style.width='0';
    const tick=()=>{
      if(active?.vid!==vid)return;
      const d=vid.duration;
      if(d&&isFinite(d)){const f=Math.min(1,Math.max(0,vid.currentTime/d));bar.style.width=((invert?1-f:f)*100).toFixed(2)+'%'}
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  function previewWindow(d){d=Number(d)||0;if(d<600)return 30;if(d<1200)return 40;if(d<2400)return 50;return 60}
  function start(vid,card,startAt=0,fromRight=false){
    // Local D Vault cards intentionally do not need a network data-src.
    // They expose data-local-id and their object URL is assigned by wire().
    if(!vid.dataset.src && !vid.dataset.localId && !vid.src)return;
    if(active&&active.vid!==vid)active.stop();
    if(vid._dpEnded)vid.removeEventListener('ended',vid._dpEnded);
    const finish=()=>{clearTimeout(vid._dpPreviewTimer);vid._dpPreviewTimer=null;stop(vid,card)};vid._dpEnded=finish;vid.addEventListener('ended',finish,{once:true});
    active={vid,card,stop:finish};
    const begin=()=>{try{vid.currentTime=Math.max(0,Math.min(Number(startAt)||0,(vid.duration||9)-.05))}catch(_){}
      vid.muted=true;vid.playsInline=true;vid.loop=false;
      vid.play().then(()=>{card.classList.add('previewing');trackBar(vid,card,fromRight,false);const left=Math.max(0,(Number(vid.duration)||0)-Math.max(0,Number(startAt)||0));vid._dpPreviewTimer=setTimeout(finish,Math.min(previewWindow(vid.duration),left)*1000)}).catch(()=>finish());
    };
    if(vid.readyState>=1)begin();else vid.addEventListener('loadedmetadata',begin,{once:true});
  }
  // Reverse playback seeks backward constantly. Over a streamed (range-request)
  // mp4 every backward seek re-downloads/re-decodes from the previous keyframe,
  // which is what made right->left previews lag. Pull the small hover clip into
  // memory once so seeks are local, and reuse it on later swipes.
  const blobCache=new Map(),revFailed=new Set();
  function getBlobSrc(url){
    if(blobCache.has(url))return blobCache.get(url);
    const p=fetch(url,{credentials:'same-origin'}).then(r=>{if(!r.ok)throw new Error('http '+r.status);return r.blob()}).then(b=>URL.createObjectURL(b));
    blobCache.set(url,p);
    p.catch(()=>blobCache.delete(url));
    if(blobCache.size>8){const k=blobCache.keys().next().value;blobCache.get(k).then(u=>URL.revokeObjectURL(u),()=>{});blobCache.delete(k)}
    return p;
  }
  function wire(){
    const hover=matchMedia('(hover:hover) and (pointer:fine)').matches;
    document.querySelectorAll(cardSelector).forEach(card=>{
      const vid=card.querySelector('.thumb-preview,.rec-thumb-preview');
      if(!vid||(!vid.dataset.src&&!vid.dataset.localId))return;
      // Every card type gets the same progress line element.
      if(!card.querySelector('.thumb-loadbar')){const b=document.createElement('span');b.className='thumb-loadbar';card.appendChild(b)}
      if(hover){
        if(vid.dataset.dpHover)return;vid.dataset.dpHover='1';
        let timer=null;
        card.addEventListener('mouseenter',()=>{clearTimeout(timer);if(active?.vid===vid)return;card.classList.add('loading');timer=setTimeout(async()=>{try{
          const src=(window.DVaultMedia&&vid.dataset.localId)?await DVaultMedia.url(vid.dataset.localId):vid.dataset.src;
          if(!src)throw new Error('No local or remote preview source');
          vid.src=src;vid.preload='auto';card.classList.remove('loading');start(vid,card,0);
        }catch{card.classList.remove('loading')}},180)});
        card.addEventListener('mouseleave',()=>{clearTimeout(timer);if(active?.vid===vid)return;card.classList.remove('loading');if(vid.src){vid.removeAttribute('src');vid.load()}});
      }else{
        if(vid.dataset.dpTouch)return;vid.dataset.dpTouch='1';
        // Mobile/tablet: a horizontal swipe on the card starts the preview.
        //   left -> right : plays forward, from the very start to the end
        //   right -> left : plays in reverse, from the very end back to the start
        // Every new swipe restarts from the matching end (never resumes, and
        // never jumps to wherever the finger happens to be).
        let sx=0,sy=0,drag=false,gid=0,revRaf=null;
        const stopRev=()=>{if(revRaf){cancelAnimationFrame(revRaf);revRaf=null}};
        const runReverse=()=>{
          const dur=vid.duration;if(!dur||!isFinite(dur))return;
          vid.muted=true;vid.playsInline=true;vid.pause();
          let t=Math.max(0,dur-.05),last=performance.now(),guard=null;
          const seekTo=x=>{try{if(typeof vid.fastSeek==='function')vid.fastSeek(x);else vid.currentTime=x}catch(_){}};
          // Seek-driven loop: ask for the next frame only after the previous seek
          // landed (event, not polling), keep real-time speed by using elapsed time.
          const onSeeked=()=>{
            if(active?.vid!==vid)return;
            clearTimeout(guard);
            const now=performance.now();t-=(now-last)/1000;last=now;
            if(t<=0){finish();return}
            revRaf=requestAnimationFrame(()=>{if(active?.vid!==vid)return;seekTo(t);guard=setTimeout(onSeeked,500)});
          };
          const finish=()=>{stopRev();clearTimeout(guard);vid.removeEventListener('seeked',onSeeked);stop(vid,card)};
          active={vid,card,stop:finish};
          card.classList.add('previewing');
          trackBar(vid,card,true);
          vid.addEventListener('seeked',onSeeked);
          last=performance.now();seekTo(t);guard=setTimeout(onSeeked,500);
        };
        const startSwipePreview=reverse=>{
          const my=++gid;
          if(active?.vid===vid)active.stop();
          let done=false;
          const revUrl=vid.dataset.srcRev;
          const begin=()=>{if(done||my!==gid)return;done=true;if(reverse)runReverse();else{card.querySelector('.thumb-loadbar')?.classList.remove('from-right');start(vid,card,0)}};
          const attach=async(src,onMeta)=>{if(my!==gid)return;try{
            const resolved=(window.DVaultMedia&&vid.dataset.localId)?await DVaultMedia.url(vid.dataset.localId):src;
            if(!resolved)throw new Error('No local or remote preview source');
            vid.src=resolved;vid.preload='auto';vid.addEventListener('loadedmetadata',onMeta,{once:true});if(vid.readyState>=1)onMeta();
          }catch{}};
          if(!reverse)attach(vid.dataset.src,begin);
          else{
            const seekFallback=async()=>{
              if(window.DVaultMedia&&vid.dataset.localId){
                try{await attach(await DVaultMedia.url(vid.dataset.localId),begin);return}catch{}
              }
              if(!vid.dataset.src)return;
              getBlobSrc(vid.dataset.src).then(u=>attach(u,begin),()=>attach(vid.dataset.src,begin));
            };
            if(revUrl&&!revFailed.has(revUrl)){
              // Pre-reversed clip: plays forward = smooth. Line grows from the right.
              getBlobSrc(revUrl).then(u=>{
                if(my!==gid)return;
                attach(u,()=>{if(done||my!==gid)return;done=true;start(vid,card,0,true)});
              },()=>{revFailed.add(revUrl);seekFallback()});
            }else seekFallback();
          }
        };
        card.addEventListener('touchstart',e=>{if(e.touches.length!==1)return;sx=e.touches[0].clientX;sy=e.touches[0].clientY;drag=false},{passive:true});
        card.addEventListener('touchmove',e=>{
          if(e.touches.length!==1)return;
          const x=e.touches[0].clientX,y=e.touches[0].clientY,dx=x-sx,dy=y-sy;
          if(!drag&&Math.abs(dx)>12&&Math.abs(dx)>Math.abs(dy)){drag=true;e.preventDefault();startSwipePreview(dx<0)}
          else if(drag)e.preventDefault();
        },{passive:false});
        card.addEventListener('touchend',e=>{if(drag){e.preventDefault();drag=false}},{passive:false});
        card.addEventListener('touchcancel',()=>{drag=false},{passive:true});
      }
    });
  }
  window.DPlayerPreview={wire,stopAll:()=>{if(active)active.stop()}};
  wire();
})();
