/* D Vault reverse play. Shared by the video player (settings menu) and the Shorts player (⋮ menu).

   Fast path (smooth): a <video> can't play backwards, and seeking backwards frame by frame is slow
   because every seek re-decodes from a keyframe. So instead a hidden second <video> decodes the file
   FORWARD in short chunks (about 1s of video, at 2x or more), each frame is copied into memory as a
   small bitmap, and the frames are drawn onto a canvas laid over the player in reverse order, on the
   real clock. The next earlier chunk is decoded while the current one is shown.
   Fallback: if the browser lacks requestVideoFrameCallback / createImageBitmap, or the hidden decoder
   fails, it falls back to stepping backwards by seeking.

   - Starts from wherever the playhead is; at the very start (or when ended) it starts from the end.
   - Speed follows the player's playback speed.
   - Stops at the start, or when the user plays/pauses, or when the source changes. */
(function(){
  const states=new WeakMap();
  const START_EPS=.25,MAX_SIDE=640;
  const FAST=typeof HTMLVideoElement!=='undefined'&&'requestVideoFrameCallback' in HTMLVideoElement.prototype&&typeof createImageBitmap==='function';
  const isActive=v=>!!v&&states.has(v);
  // Reverse mode is "on" until the user turns it off; inside it, play/pause only pauses/resumes the reverse.
  const isRunning=v=>isActive(v)&&!states.get(v).paused;
  const pause=v=>{const st=v&&states.get(v);if(st)st.paused=true;return !!st};
  const resume=v=>{const st=v&&states.get(v);if(st)st.paused=false;return !!st};
  const toggle=v=>{const st=v&&states.get(v);if(!st)return false;st.paused=!st.paused;return true};

  function stop(v,silent,reason){
    const st=v&&states.get(v);if(!st)return false;
    states.delete(v);
    try{st.cleanup&&st.cleanup(reason)}catch(_){}
    ['play','emptied','loadstart'].forEach(e=>v.removeEventListener(e,st.foreign));
    if(!silent){try{st.onStop&&st.onStop(v)}catch(_){}}
    return true;
  }

  // ---------- smooth path: forward-decoded chunks drawn in reverse ----------
  function runFast(v,st,dur,fallback){
    const o=st.opts||{};
    const dv=document.createElement('video');
    dv.muted=true;dv.defaultMuted=true;dv.playsInline=true;dv.preload='auto';dv.setAttribute('playsinline','');
    dv.style.cssText='position:fixed;left:0;top:0;width:2px;height:2px;opacity:.01;pointer-events:none;z-index:-1';
    let alive=true,frames=[],decoding=false,bufLow=Infinity,T=o.fromEnd?Math.max(0,dur-.05):v.currentTime,nextEnd=T,raf=0,cv=null,ctx=null,drawn=null;
    let t0=0,lastSync=0,tickN=0,W=0,H=0,fails=0,boxW=-1,boxH=-1,metaTimer=0;
    st.T=T;
    const closeAll=a=>a.forEach(f=>{try{f.bmp.close()}catch(_){}});
    st.cleanup=reason=>{
      alive=false;cancelAnimationFrame(raf);clearTimeout(metaTimer);
      closeAll(frames);frames=[];
      if(cv){cv.remove();cv=null}
      try{dv.pause()}catch(_){}
      dv.removeAttribute('src');try{dv.load()}catch(_){}
      dv.remove();
      if(reason!=='src'&&!o.noSync){try{v.currentTime=Math.max(0,Math.min(st.T,dur))}catch(_){}}
    };
    const rate=()=>Math.max(.1,Number(o.rate||v.playbackRate)||1);
    const gap=()=>Math.max(.03,rate()/30-.005);
    const decodeSeg=(a,b)=>{
      decoding=true;
      return new Promise(res=>{
        const got=[],pending=[];let done=false,lastMt=-1,guard=0;
        const finish=async()=>{
          if(done)return;done=true;clearTimeout(guard);
          try{dv.pause()}catch(_){}
          await Promise.all(pending);
          if(!alive){closeAll(got);decoding=false;res();return}
          if(got.length){fails=0;frames=frames.concat(got).sort((x,y)=>x.t-y.t);bufLow=a;nextEnd=a}
          else if(++fails>=2){decoding=false;res();fallback();return}
          decoding=false;res();
        };
        const onFrame=(now,meta)=>{
          if(done||!alive)return;
          const mt=meta.mediaTime;
          if(mt>=a-.02&&mt<=b+.1&&mt!==lastMt&&(lastMt<0||mt-lastMt>=gap()||mt>=b-.001)){
            lastMt=mt;
            const o=W&&H?{resizeWidth:W,resizeHeight:H,resizeQuality:'low'}:undefined;
            pending.push(createImageBitmap(dv,o).then(bmp=>{if(!alive){try{bmp.close()}catch(_){}return}got.push({t:mt,bmp})}).catch(()=>{}));
          }
          if(mt>=b-.001||dv.ended){finish();return}
          dv.requestVideoFrameCallback(onFrame);
        };
        const onSeeked=()=>{
          dv.removeEventListener('seeked',onSeeked);
          if(done||!alive)return;
          dv.playbackRate=o.decodeRate||Math.min(8,Math.max(2,rate()*2));
          dv.requestVideoFrameCallback(onFrame);
          dv.play().catch(finish);
        };
        dv.addEventListener('seeked',onSeeked);
        dv.addEventListener('ended',finish,{once:true});
        guard=setTimeout(finish,((b-a)/2+5)*1000);
        try{dv.currentTime=a}catch(_){finish()}
      });
    };
    const syncBox=()=>{
      if(!cv||o.host)return;
      const p=v.parentElement;if(!p)return;
      if(getComputedStyle(p).position==='static')p.style.position='relative';
      const cs=getComputedStyle(v);
      cv.style.cssText=`position:absolute;left:${v.offsetLeft}px;top:${v.offsetTop}px;width:${v.offsetWidth}px;height:${v.offsetHeight}px;object-fit:${cs.objectFit};object-position:${cs.objectPosition};transform:${cs.transform};transform-origin:${cs.transformOrigin};pointer-events:none;background:#000`;
      boxW=v.offsetWidth;boxH=v.offsetHeight;
    };
    const showFrame=f=>{
      if(!cv){
        cv=document.createElement('canvas');cv.className='dv-reverse-canvas';
        cv.width=f.bmp.width;cv.height=f.bmp.height;ctx=cv.getContext('2d',{alpha:false});
        if(o.host){cv.style.cssText='position:absolute;left:0;top:0;width:100%;height:100%;object-fit:cover;z-index:2;pointer-events:none;background:#000';o.host.appendChild(cv)}
        else{v.insertAdjacentElement('afterend',cv);syncBox()}
      }else if(cv.width!==f.bmp.width||cv.height!==f.bmp.height){cv.width=f.bmp.width;cv.height=f.bmp.height}
      try{ctx.drawImage(f.bmp,0,0)}catch(_){}
      drawn=f;
    };
    let last=performance.now();
    const tick=now=>{
      if(!alive||states.get(v)!==st)return;
      const dt=st.paused?0:Math.min(.1,Math.max(0,(now-last)/1000));last=now;
      // Advance the reverse clock only through media that is already decoded.
      if(bufLow<Infinity){
        if(bufLow<=.001)T-=dt*rate();else T=Math.max(bufLow,T-dt*rate());
        st.T=Math.max(0,T);
        if(bufLow<=.001&&T<=.03){st.T=0;stop(v);return}
      }
      if(o.onTick){try{o.onTick(st.T,dur)}catch(_){}}
      if(o.maxSeconds&&t0&&now-t0>o.maxSeconds*1000){stop(v);return}
      if(frames.length){
        let i=frames.length-1;while(i>0&&frames[i].t>T+.001)i--;
        const f=frames[i];
        if(f!==drawn&&f.t<=T+.05)showFrame(f);
        while(frames.length>i+2){const x=frames.pop();try{x.bmp.close()}catch(_){}}
      }
      if(!decoding&&nextEnd>.001&&(nextEnd-T)<Math.max(1,rate())*1.5+.3){
        const len=bufLow===Infinity?.6*Math.max(1,rate()):Math.max(1,rate());
        decodeSeg(Math.max(0,nextEnd-len),nextEnd);
      }
      if(cv&&!o.host&&(++tickN%12===0||boxW!==v.offsetWidth||boxH!==v.offsetHeight))syncBox();
      // Keep the real player's playhead / progress bar roughly in step.
      if(!o.noSync&&now-lastSync>400&&!v.seeking){lastSync=now;try{v.currentTime=Math.max(0,T)}catch(_){}}
      raf=requestAnimationFrame(tick);
    };
    dv.addEventListener('error',()=>{if(alive)fallback()},{once:true});
    dv.addEventListener('loadedmetadata',()=>{
      clearTimeout(metaTimer);if(!alive)return;
      const vw=dv.videoWidth||0,vh=dv.videoHeight||0;
      if(vw&&vh){const s=Math.min(1,(o.maxSide||MAX_SIDE)/Math.max(vw,vh));W=Math.max(2,Math.round(vw*s));H=Math.max(2,Math.round(vh*s))}
      last=t0=performance.now();raf=requestAnimationFrame(tick);
    },{once:true});
    metaTimer=setTimeout(()=>{if(alive)fallback()},6000);
    dv.src=v.currentSrc||v.src;
    document.body.appendChild(dv);
    dv.load();
  }

  // ---------- fallback: step backwards by seeking ----------
  function runSeek(v,st,dur){
    st.waiting=false;st.last=performance.now();st.guard=0;st.raf=0;
    st.onSeeked=()=>{st.waiting=false;clearTimeout(st.guard)};
    v.addEventListener('seeked',st.onSeeked);
    st.cleanup=()=>{cancelAnimationFrame(st.raf);clearTimeout(st.guard);v.removeEventListener('seeked',st.onSeeked)};
    const step=now=>{
      if(states.get(v)!==st)return;
      if(st.paused){st.last=now;st.raf=requestAnimationFrame(step);return}
      if(!st.waiting){
        const dt=Math.max(0,(now-st.last)/1000);st.last=now;
        const rate=Math.max(.1,Number(v.playbackRate)||1);
        let t=v.currentTime-dt*rate;
        if(t<=.03){
          if(v.loop)t=Math.max(0,(v.duration||dur)-.05);
          else{try{v.currentTime=0}catch(_){}stop(v);return}
        }
        st.waiting=true;
        st.guard=setTimeout(()=>{st.waiting=false},500);
        try{v.currentTime=t}catch(_){st.waiting=false}
      }
      st.raf=requestAnimationFrame(step);
    };
    st.raf=requestAnimationFrame(step);
  }

  function start(v,onStop){
    if(!v)return false;
    const dur=v.duration;
    if(!dur||!isFinite(dur))return false;
    if(isActive(v))stop(v,true);
    v.pause();
    // At the starting point (or finished): reverse from the end of the video.
    if(v.ended||v.currentTime<=START_EPS){try{v.currentTime=Math.max(0,dur-.05)}catch(_){}}
    const st={onStop};
    st.foreign=ev=>{
      // Anything trying to start normal (forward) playback is blocked while reverse is on.
      if(ev&&ev.type==='play'){try{v.pause()}catch(_){}return}
      stop(v,false,'src');
    };
    states.set(v,st);
    ['play','emptied','loadstart'].forEach(e=>v.addEventListener(e,st.foreign));
    const fallback=()=>{
      if(states.get(v)!==st)return;
      try{st.cleanup&&st.cleanup('fallback')}catch(_){}
      runSeek(v,st,dur);
    };
    // The real player may still be finishing the "jump to the end" seek; start from its settled time.
    const go=()=>{
      if(states.get(v)!==st)return;
      if(FAST)runFast(v,st,dur,fallback);else runSeek(v,st,dur);
    };
    if(v.seeking)v.addEventListener('seeked',go,{once:true});else go();
    return true;
  }

  // Card preview (home / search / recommendations): plays the whole video backwards at `rate`x onto a canvas
  // that fills `host`, without touching the preview <video>. Returns false if the fast path can't be used.
  function startPreview(v,host,o){
    if(!FAST||!v||!host)return false;
    const dur=v.duration;
    if(!dur||!isFinite(dur))return false;
    if(isActive(v))stop(v,true);
    const st={onStop:o.onEnd,opts:{host,rate:o.rate||3,decodeRate:4,noSync:true,maxSide:480,maxSeconds:o.maxSeconds,onTick:o.onProgress,fromEnd:true}};
    states.set(v,st);
    runFast(v,st,dur,()=>{if(states.get(v)!==st)return;stop(v,true);try{o.onFail&&o.onFail()}catch(_){}});
    return true;
  }
  window.DVReverse={start,stop,isActive,isRunning,pause,resume,toggle,startPreview,supportsFast:FAST};
})();
