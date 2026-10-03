/* D Vault reverse play. Shared by the video player (settings menu) and the Shorts player (⋮ menu).
   A <video> cannot play backwards natively, so the video is paused and stepped backwards by seeking,
   in real time: after each seek lands, the next target is (currentTime - elapsed * playbackRate), so
   the speed stays correct even if some frames are skipped.
   - Starts from wherever the playhead is.
   - If the playhead is at the very start (or the video has ended), it starts from the end instead.
   - Stops at the start, when the user plays/pauses, or when the source changes. */
(function(){
  const states=new WeakMap();
  const START_EPS=.25;
  const isActive=v=>!!v&&states.has(v);
  function stop(v,silent){
    const st=v&&states.get(v);if(!st)return false;
    states.delete(v);
    cancelAnimationFrame(st.raf);clearTimeout(st.guard);
    v.removeEventListener('seeked',st.onSeeked);
    ['play','emptied','loadstart'].forEach(e=>v.removeEventListener(e,st.onForeign));
    if(!silent){try{st.onStop&&st.onStop(v)}catch(_){}}
    return true;
  }
  function start(v,onStop){
    if(!v)return false;
    const dur=v.duration;
    if(!dur||!isFinite(dur))return false;
    if(isActive(v))stop(v,true);
    v.pause();
    // At the starting point (or finished): reverse from the end of the video.
    if(v.ended||v.currentTime<=START_EPS){try{v.currentTime=Math.max(0,dur-.05)}catch(_){}}
    const st={raf:0,guard:0,waiting:false,last:performance.now(),onStop};
    st.onSeeked=()=>{st.waiting=false;clearTimeout(st.guard)};
    // Something else started normal playback / swapped the source: reverse gives way to it.
    st.onForeign=()=>stop(v);
    states.set(v,st);
    v.addEventListener('seeked',st.onSeeked);
    ['play','emptied','loadstart'].forEach(e=>v.addEventListener(e,st.onForeign));
    const step=now=>{
      if(states.get(v)!==st)return;
      if(!st.waiting){
        const dt=Math.max(0,(now-st.last)/1000);st.last=now;
        const rate=Math.max(.1,Number(v.playbackRate)||1);
        let t=v.currentTime-dt*rate;
        if(t<=.03){
          if(v.loop){t=Math.max(0,(v.duration||dur)-.05)}
          else{try{v.currentTime=0}catch(_){}stop(v);return}
        }
        st.waiting=true;
        // If a seek never reports back, do not freeze the loop.
        st.guard=setTimeout(()=>{st.waiting=false},500);
        try{v.currentTime=t}catch(_){st.waiting=false}
      }
      st.raf=requestAnimationFrame(step);
    };
    st.raf=requestAnimationFrame(step);
    return true;
  }
  window.DVReverse={start,stop,isActive};
})();
