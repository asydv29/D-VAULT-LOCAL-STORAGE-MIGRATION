// DPlayer Universal Preview System
// One implementation shared by home/search/library cards and watch-page recommendations.
(function(){
  let active=null,hoverCard=null,touching=false;
  const PREVIEW_SPEED=3; // both forward (start->end) and reverse (end->start) previews run at 3x

  const cardSelector='.thumb,.rec-thumb';
  function stop(vid,card){
    if(vid._dpEnded){vid.removeEventListener('ended',vid._dpEnded);vid._dpEnded=null}
    if(active?.vid===vid)active=null;
    card.classList.remove('previewing','loading','scrubbable');
    const bar=card.querySelector('.thumb-loadbar');if(bar){bar.style.width='0';bar.style.transition='none';bar.classList.remove('from-right')}
    card.querySelectorAll('.thumb-rev-canvas,.dv-reverse-canvas').forEach(c=>c.remove());
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
  // ---- Timeline scrubber (forward hover preview only) ----
  // A thin strip along the bottom edge of the card. Press / click / drag on it to jump the
  // preview to that point. It only reacts inside its own strip and swallows its own events, so
  // the card link, menu, select checkbox and the rest of the card behave exactly as before.
  function attachScrub(vid,card){
    let strip=card.querySelector(':scope>.thumb-scrub');
    if(!strip){
      strip=document.createElement('span');strip.className='thumb-scrub';strip.innerHTML='<i></i>';card.appendChild(strip);
      const frac=e=>{const r=strip.getBoundingClientRect();return Math.min(1,Math.max(0,(e.clientX-r.left)/Math.max(1,r.width)))};
      let drag=false,resume=false;
      const jump=e=>{
        const d=vid.duration;if(!d||!isFinite(d))return;
        const t=Math.min(d-.05,frac(e)*d);
        try{if(typeof vid.fastSeek==='function'&&drag)vid.fastSeek(t);else vid.currentTime=t}catch(_){}
      };
      const eat=e=>{e.stopPropagation()};
      ['mousedown','mouseup','touchstart','touchmove','touchend','dblclick','contextmenu'].forEach(n=>strip.addEventListener(n,eat,{passive:true}));
      strip.addEventListener('click',e=>{e.preventDefault();e.stopPropagation()});
      strip.addEventListener('pointerdown',e=>{
        if(active?.vid!==vid)return;
        e.preventDefault();e.stopPropagation();drag=true;resume=!vid.paused;
        try{strip.setPointerCapture(e.pointerId)}catch(_){}
        strip.classList.add('dragging');clearTimeout(vid._dpPreviewTimer);vid._dpPreviewTimer=null;
        vid.pause();jump(e);
      });
      strip.addEventListener('pointermove',e=>{if(!drag)return;e.preventDefault();e.stopPropagation();jump(e)});
      const end=e=>{
        if(!drag)return;drag=false;e.stopPropagation();strip.classList.remove('dragging');
        try{strip.releasePointerCapture(e.pointerId)}catch(_){}
        vid._dpScrubbedAt=performance.now();
        if(active?.vid!==vid)return;
        jump(e);
        if(resume)vid.play().catch(()=>{});
        // Keep the preview alive for another window from the new position.
        const left=Math.max(0,(Number(vid.duration)||0)-vid.currentTime)/PREVIEW_SPEED;
        clearTimeout(vid._dpPreviewTimer);
        vid._dpPreviewTimer=setTimeout(()=>{if(active?.vid===vid)active.stop()},Math.min(previewWindow(vid.duration),left)*1000);
      };
      strip.addEventListener('pointerup',end);strip.addEventListener('pointercancel',end);
      // A drag that ends over the card must not count as a click on the card link.
      card.addEventListener('click',e=>{if(vid._dpScrubbedAt&&performance.now()-vid._dpScrubbedAt<400){e.preventDefault();e.stopPropagation();vid._dpScrubbedAt=0}},true);
    }
    card.classList.add('scrubbable');
    const knob=strip.firstChild;
    const tick=()=>{
      if(active?.vid!==vid||!card.classList.contains('scrubbable'))return;
      const d=vid.duration;if(d&&isFinite(d))knob.style.left=Math.min(100,Math.max(0,vid.currentTime/d*100)).toFixed(2)+'%';
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  function previewWindow(d){d=Number(d)||0;if(d<600)return 30;if(d<1200)return 40;if(d<2400)return 50;return 60}
  const warn=(...a)=>{try{console.warn('[DPlayerPreview]',...a)}catch(_){}};
  // Phones have no console, so failures also show as a short on-screen message.
  // Open any page once with ?previewdebug=1 to also see step-by-step messages (?previewdebug=0 turns it off).
  try{const q=new URLSearchParams(location.search).get('previewdebug');if(q==='1')localStorage.setItem('dvPreviewDebug','1');else if(q==='0')localStorage.removeItem('dvPreviewDebug')}catch(_){}
  let toastEl=null,toastT=null;
  const notify=msg=>{try{
    if(!toastEl){toastEl=document.createElement('div');toastEl.style.cssText='position:fixed;left:50%;bottom:18px;transform:translateX(-50%);max-width:90vw;background:#222;color:#fff;border:1px solid #444;border-radius:10px;padding:9px 14px;font:13px/1.35 system-ui,sans-serif;z-index:2147483646;pointer-events:none;text-align:center';document.body.appendChild(toastEl)}
    toastEl.textContent=msg;toastEl.style.display='block';clearTimeout(toastT);toastT=setTimeout(()=>{toastEl.style.display='none'},5000)}catch(_){}};
  const dbg=msg=>{try{if(localStorage.getItem('dvPreviewDebug')==='1')notify('preview: '+msg)}catch(_){}};
  // Starts the real <video> preview. If the clip cannot be opened or played (autoplay blocked,
  // media error, or no first frame within 7 s) the card is reset and onFail(reason) is called so
  // the caller can fall back to the sprite-sheet preview instead of leaving the card blank.
  function start(vid,card,startAt=0,fromRight=false,onFail){
    // Local D Vault cards intentionally do not need a network data-src.
    // They expose data-local-id and their object URL is assigned by wire().
    if(!vid.dataset.src && !vid.dataset.localId && !vid.src)return;
    if(active&&active.vid!==vid)active.stop();
    if(vid._dpEnded)vid.removeEventListener('ended',vid._dpEnded);
    const finish=()=>{clearTimeout(vid._dpPreviewTimer);vid._dpPreviewTimer=null;stop(vid,card)};vid._dpEnded=finish;vid.addEventListener('ended',finish,{once:true});
    active={vid,card,stop:finish};
    let settled=false,wd=null;
    const onErr=()=>fail('media error');
    const clean=()=>{clearTimeout(wd);vid.removeEventListener('error',onErr)};
    const fail=why=>{
      if(settled)return;settled=true;clean();
      warn('video preview failed:',why,vid.error?('('+vid.error.code+') '+vid.error.message):'');notify('Video preview failed: '+why+(vid.error?' (code '+vid.error.code+')':''));
      const mine=active?.vid===vid;if(mine)finish();
      if(mine&&onFail)try{onFail(why)}catch(e){warn(e)}
    };
    dbg('starting video preview');vid.addEventListener('error',onErr,{once:true});
    wd=setTimeout(()=>fail('no first frame after 7s'),7000);
    const begin=()=>{try{let s0=Number(startAt)||0;if(!fromRight&&s0>0&&vid.duration&&s0>=vid.duration-1)s0=0;vid.currentTime=Math.max(0,Math.min(s0,(vid.duration||9)-.05))}catch(_){}
      vid.muted=true;vid.playsInline=true;vid.loop=false;vid.defaultPlaybackRate=PREVIEW_SPEED;vid.playbackRate=PREVIEW_SPEED;
      vid.play().then(()=>{settled=true;clean();card.classList.add('previewing');trackBar(vid,card,fromRight,false);if(!fromRight)attachScrub(vid,card);const left=Math.max(0,(Number(vid.duration)||0)-Math.max(0,Number(startAt)||0))/PREVIEW_SPEED;vid._dpPreviewTimer=setTimeout(finish,Math.min(previewWindow(vid.duration),left)*1000)}).catch(e=>{if(settled){finish();return}fail('play() rejected: '+(e&&e.name||e))});
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
  // ---- Reverse (right->left swipe) preview ----
  // Seeking a real <video> backwards frame by frame is what made reverse lag:
  // every seek re-decodes from the previous keyframe. The scrub sprite sheet
  // already holds frames spread over the whole video, so reverse is drawn from
  // it on a canvas: no decoding, no seeking, no big download.
  const spriteCache=new Map();
  async function getSprite(id){
    if(spriteCache.has(id))return spriteCache.get(id);
    const P=window.DVaultPreview,S=window.DVaultStorage;if(!P||!S)return null;
    const [r,a]=await Promise.all([S.get('meta',id),P.asset(id,'sprite')]);
    if(!r||!r.sprite||!a||!a.blob)return null;
    const bmp=await createImageBitmap(a.blob);
    const e={bmp,m:r.sprite,vw:Number(r.width)||0,vh:Number(r.height)||0,dur:Number(r.duration)||0};
    spriteCache.set(id,e);
    if(spriteCache.size>12){const k=spriteCache.keys().next().value,o=spriteCache.get(k);spriteCache.delete(k);try{o.bmp.close()}catch(_){}}
    return e;
  }
  // Canvas preview drawn from the cached scrub sprite. No decoding, no file access, no autoplay
  // permission needed. reverse=true: end->start. Otherwise: from startAt forward, ~3x speed.
  function playSprite(vid,card,sp,opt){
    opt=opt||{};const reverse=!!opt.reverse;
    if(active&&active.vid!==vid)active.stop();
    const m=sp.m,n=Math.max(1,Number(m.frameCount)||1),fw=Number(m.frameWidth)||160,fh=Number(m.frameHeight)||90,cols=Number(m.columns)||10;
    const box=card.getBoundingClientRect(),dpr=Math.min(2,window.devicePixelRatio||1);
    const W=Math.max(2,Math.round(box.width*dpr)),H=Math.max(2,Math.round(box.height*dpr));
    const cv=document.createElement('canvas');cv.className='thumb-rev-canvas';cv.width=W;cv.height=H;
    cv.style.cssText='position:absolute;inset:0;width:100%;height:100%;z-index:2;pointer-events:none;background:#000';
    card.appendChild(cv);
    const ctx=cv.getContext('2d',{alpha:false});
    // The cell is letterboxed to the real video shape; crop that, then cover-fit the card.
    const vw=sp.vw||fw,vh=sp.vh||fh,sc=Math.min(fw/vw,fh/vh),cw=Math.max(1,vw*sc),ch=Math.max(1,vh*sc);
    const ar=W/H;let kw=cw,kh=ch;if(cw/ch>ar)kw=ch*ar;else kh=cw/ar;
    const dur=sp.dur||(Number(vid.duration)||0);
    let T,s0=0,span=dur;
    if(reverse)T=(dur>0?Math.max(500,dur/PREVIEW_SPEED*1000):Math.min(5,Math.max(2.5,n*.1))*1000);
    else if(dur>0){s0=Number(opt.startAt)||0;if(s0>=dur-1)s0=0;span=Math.max(.5,Math.min(previewWindow(dur)*PREVIEW_SPEED,dur-s0));T=span/PREVIEW_SPEED*1000}
    else T=Math.min(5,Math.max(2.5,n*.1))*1000;
    const t0=performance.now();let last=-1,raf=0;
    const bar=card.querySelector('.thumb-loadbar');
    const finish=()=>{cancelAnimationFrame(raf);stop(vid,card)};
    active={vid,card,stop:finish};
    card.classList.add('previewing');
    if(bar){bar.classList.toggle('from-right',reverse);bar.style.transition='none'}
    const tick=now=>{
      if(active?.vid!==vid||!cv.isConnected)return;
      const p=Math.min(1,(now-t0)/T);
      let i,frac;
      if(reverse){i=Math.max(0,n-1-Math.floor(p*n));frac=p}
      else if(dur>0){const t=s0+p*span;frac=t/dur;i=Math.min(n-1,Math.max(0,Math.floor(frac*n)))}
      else{frac=p;i=Math.min(n-1,Math.floor(p*n))}
      if(i!==last){last=i;const sx=(i%cols)*fw+(fw-cw)/2+(cw-kw)/2,sy=Math.floor(i/cols)*fh+(fh-ch)/2+(ch-kh)/2;
        try{ctx.drawImage(sp.bmp,sx,sy,kw,kh,0,0,W,H)}catch(_){}}
      if(bar)bar.style.width=(frac*100).toFixed(2)+'%';
      if(p>=1){finish();return}
      raf=requestAnimationFrame(tick);
    };
    raf=requestAnimationFrame(tick);
  }
  function playSpriteReverse(vid,card,sp){playSprite(vid,card,sp,{reverse:true})}
  // Used when the real video cannot be played. Resolves true if a sprite preview started.
  async function spriteFallback(vid,card,startAt,wanted){
    const lid=vid.dataset.localId;
    if(!lid||!window.DVaultPreview||!DVaultPreview.asset){warn('no sprite fallback available for this card');notify('Preview unavailable for this video');return false}
    try{
      let sp=await getSprite(lid);
      if(!sp){
        // Sprite sheet not built yet: build it right now (a few seconds) instead of giving up.
        warn('sprite sheet not ready - building it now');notify('Preparing preview…');
        card.classList.add('loading');
        try{await Promise.race([DVaultPreview.ensureSprite(lid),new Promise(r=>setTimeout(r,25000))])}catch(_){}
        card.classList.remove('loading');
        sp=await getSprite(lid);
      }
      if(!sp){notify('Preview unavailable: could not build preview frames');return false}
      if(wanted&&!wanted())return false;
      playSprite(vid,card,sp,{startAt});return true;
    }catch(e){warn('sprite fallback failed:',e);notify('Preview failed: '+(e&&e.message||e));return false}
  }
  // Home/grid hover preview starts only after the pointer rests on a card this long.
  const HOVER_PREVIEW_DELAY_MS=5000;
  // Hover preview begins playing from this point in the video (falls back to 0 for clips this short).
  const HOVER_PREVIEW_START_SEC=5;
  function wire(){
    document.querySelectorAll(cardSelector).forEach(card=>{
      const vid=card.querySelector('.thumb-preview,.rec-thumb-preview');
      if(!vid||(!vid.dataset.src&&!vid.dataset.localId))return;
      // Every card type gets the same progress line element.
      if(!card.querySelector('.thumb-loadbar')){const b=document.createElement('span');b.className='thumb-loadbar';card.appendChild(b)}
      // Mouse hover and touch swipe are both wired on every card (a media query used to pick one,
      // which left mouse hover dead in desktop-site mode, emulators and some touch laptops).
      if(!vid.dataset.dpHover){
        vid.dataset.dpHover='1';
        let timer=null,hovered=false;
        const wanted=()=>hovered&&(!active||active.vid===vid);
        card.addEventListener('pointerenter',e=>{if(e.pointerType!=='mouse')return;hovered=true;hoverCard=card;clearTimeout(timer);if(active?.vid===vid)return;timer=setTimeout(async()=>{dbg('hover delay done');card.classList.add('loading');try{
          const src=(window.DVaultMedia&&vid.dataset.localId)?await DVaultMedia.url(vid.dataset.localId):vid.dataset.src;
          if(!src)throw new Error('No local or remote preview source');
          if(!hovered){card.classList.remove('loading');return}
          vid.src=src;vid.preload='auto';card.classList.remove('loading');
          start(vid,card,HOVER_PREVIEW_START_SEC,false,()=>{spriteFallback(vid,card,HOVER_PREVIEW_START_SEC,wanted)});
        }catch(e){warn('could not open the video for hover preview:',e);notify('Preview: could not open video ('+(e&&e.name||e&&e.message||e)+')');card.classList.remove('loading');if(hovered)spriteFallback(vid,card,HOVER_PREVIEW_START_SEC,wanted)}},HOVER_PREVIEW_DELAY_MS)});
        card.addEventListener('pointerleave',e=>{if(e.pointerType!=='mouse')return;hovered=false;if(hoverCard===card)hoverCard=null;clearTimeout(timer);if(active?.vid===vid)return;card.classList.remove('loading');if(vid.src){vid.removeAttribute('src');vid.load()}});
      }
      if(!vid.dataset.dpTouch){
        vid.dataset.dpTouch='1';
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
            const now=performance.now();t-=PREVIEW_SPEED*(now-last)/1000;last=now;
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
          const attach=async(src,onMeta,onFail)=>{if(my!==gid)return;try{
            const resolved=(window.DVaultMedia&&vid.dataset.localId)?await DVaultMedia.url(vid.dataset.localId):src;
            if(!resolved)throw new Error('No local or remote preview source');
            vid.src=resolved;vid.preload='auto';vid.addEventListener('loadedmetadata',onMeta,{once:true});if(vid.readyState>=1)onMeta();
          }catch(e){warn('could not open the video for swipe preview:',e);notify('Preview: could not open video ('+(e&&e.name||e&&e.message||e)+')');if(my===gid&&onFail)onFail()}};
          if(!reverse){
            // Forward swipe: start() waits for metadata itself and reports failure, so a
            // blocked/unsupported clip falls back to the sprite preview instead of a blank card.
            (async()=>{try{
              const src=(window.DVaultMedia&&vid.dataset.localId)?await DVaultMedia.url(vid.dataset.localId):vid.dataset.src;
              if(!src)throw new Error('No local or remote preview source');
              if(my!==gid)return;
              done=true;vid.src=src;vid.preload='auto';
              card.querySelector('.thumb-loadbar')?.classList.remove('from-right');
              start(vid,card,0,false,()=>{spriteFallback(vid,card,0,()=>my===gid)});
            }catch(e){warn('could not open the video for swipe preview:',e);notify('Preview: could not open video ('+(e&&e.name||e&&e.message||e)+')');if(my===gid)spriteFallback(vid,card,0,()=>my===gid)}})();
          }
          else{
            const legacyReverse=()=>{
            const lid=vid.dataset.localId;
            const seekFallback=async()=>{
              if(window.DVaultMedia&&lid){
                try{await attach(await DVaultMedia.url(lid),begin);return}catch{}
              }
              if(!vid.dataset.src)return;
              getBlobSrc(vid.dataset.src).then(u=>attach(u,begin),()=>attach(vid.dataset.src,begin));
            };
            if(lid&&window.DVaultPreview&&DVaultPreview.asset){
              getSprite(lid).then(sp=>{
                if(my!==gid)return;
                if(sp){done=true;playSpriteReverse(vid,card,sp);return}
                // No sprite yet: build it now (the next swipe is instant) and use the seek loop this once.
                try{DVaultPreview.prioritizeSprite&&DVaultPreview.prioritizeSprite(lid,0)}catch(_){}
                seekFallback();
              },()=>seekFallback());
            }else if(revUrl&&!revFailed.has(revUrl)){
              getBlobSrc(revUrl).then(u=>{
                if(my!==gid)return;
                attach(u,()=>{if(done||my!==gid)return;done=true;start(vid,card,0,true)});
              },()=>{revFailed.add(revUrl);seekFallback()});
            }else seekFallback();
            };
            // Smooth path: decode the clip forward in the background and draw it backwards on a canvas.
            if(window.DVReverse&&DVReverse.supportsFast){
              let fired=false;
              const fastRev=()=>{
                if(fired||my!==gid)return;fired=true;
                const bar=card.querySelector('.thumb-loadbar');
                if(bar){bar.classList.add('from-right');bar.style.transition='none';bar.style.width='0'}
                const finish=()=>stop(vid,card);
                active={vid,card,stop:()=>{DVReverse.stop(vid,true);finish()}};
                card.classList.add('previewing');
                const ok=DVReverse.startPreview(vid,card,{
                  rate:PREVIEW_SPEED,maxSeconds:previewWindow(vid.duration),
                  onProgress:(T,d)=>{if(bar&&d)bar.style.width=((1-T/d)*100).toFixed(2)+'%'},
                  onEnd:()=>{if(active?.vid===vid)finish()},
                  onFail:()=>{if(my!==gid)return;card.classList.remove('previewing');active=null;legacyReverse()}
                });
                if(!ok){card.classList.remove('previewing');active=null;legacyReverse()}
              };
              attach(vid.dataset.src,fastRev,()=>{if(!fired)legacyReverse()});
            }else legacyReverse();
          }
        };
        card.addEventListener('touchstart',e=>{touching=true;if(e.touches.length!==1)return;sx=e.touches[0].clientX;sy=e.touches[0].clientY;drag=false},{passive:true});
        card.addEventListener('touchmove',e=>{
          if(e.touches.length!==1)return;
          const x=e.touches[0].clientX,y=e.touches[0].clientY,dx=x-sx,dy=y-sy;
          if(!drag&&Math.abs(dx)>12&&Math.abs(dx)>Math.abs(dy)){drag=true;e.preventDefault();dbg('swipe '+(dx<0?'right-to-left':'left-to-right'));startSwipePreview(dx<0)}
          else if(drag)e.preventDefault();
        },{passive:false});
        card.addEventListener('touchend',e=>{touching=false;if(drag){e.preventDefault();drag=false}},{passive:false});
        card.addEventListener('touchcancel',()=>{touching=false;drag=false},{passive:true});
      }
    });
  }
  // True while a preview plays or the pointer/finger is on a card: the page must not rebuild cards then.
  window.DPlayerPreview={wire,busy:()=>!!(active||hoverCard||touching),stopAll:()=>{if(active)active.stop()}};
  wire();
})();
