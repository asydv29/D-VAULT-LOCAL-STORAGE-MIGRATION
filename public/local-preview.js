/* D Vault — FFmpeg-free preview engine.
   Uses HTMLVideoElement + Canvas and caches only derived preview assets in IndexedDB. */
(function(){
  "use strict";
  const VERSION=3;
  const VIDEO_EXT=/\.(mp4|webm|mkv|mov|m4v|avi|ts|mts|m2ts)$/i;
  const IMAGE_EXT=/\.(jpe?g|png|webp|gif)$/i;
  const meta=()=>window.DVaultStorage;
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  function clamp(n,a,b){return Math.max(a,Math.min(b,n))}
  function mime(name){
    const e=(name.match(/\.([^.]+)$/)||[])[1]?.toLowerCase();
    return ({mp4:"video/mp4",webm:"video/webm",mkv:"video/x-matroska",mov:"video/quicktime",m4v:"video/mp4",avi:"video/x-msvideo",ts:"video/mp2t",mts:"video/mp2t",m2ts:"video/mp2t"})[e]||"application/octet-stream";
  }
  async function hash(s){
    const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s));
    return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("").slice(0,32);
  }
  function scoreFrame(ctx,w,h){
    const data=ctx.getImageData(0,0,w,h).data, step=Math.max(1,Math.floor(data.length/40000))*4;
    let sum=0,sum2=0,edges=0,sat=0,count=0,black=0,white=0;
    for(let i=0;i<data.length-4;i+=step){
      const r=data[i],g=data[i+1],b=data[i+2],v=(r+g+b)/3;
      sum+=v;sum2+=v*v;count++;
      if(v<12)black++; if(v>247)white++;
      const mx=Math.max(r,g,b),mn=Math.min(r,g,b);if(mx-mn>35)sat++;
      if(i+4<data.length){const n=(data[i+4]+data[i+5]+data[i+6])/3;edges+=Math.abs(v-n)}
    }
    const mean=sum/count, variance=Math.max(0,sum2/count-mean*mean), contrast=Math.sqrt(variance);
    const blackRatio=black/count,whiteRatio=white/count;
    const detail=edges/count, color=sat/count;
    const bad=(blackRatio>.72||whiteRatio>.72)?80:0;
    return detail*.55+contrast*.55+color*30-bad;
  }
  function makeVideo(fileOrUrl){
    const v=document.createElement("video");v.muted=true;v.playsInline=true;v.preload="metadata";v.src=typeof fileOrUrl==="string"?fileOrUrl:URL.createObjectURL(fileOrUrl);
    return v;
  }
  function waitMeta(v){return new Promise((res,rej)=>{if(v.readyState>=1&&isFinite(v.duration))return res();const ok=()=>{cleanup();res()};const bad=()=>{cleanup();rej(new Error("Video metadata unavailable"))};const cleanup=()=>{v.removeEventListener("loadedmetadata",ok);v.removeEventListener("error",bad)};v.addEventListener("loadedmetadata",ok,{once:true});v.addEventListener("error",bad,{once:true});setTimeout(()=>{cleanup();rej(new Error("Video metadata timeout"))},12000)})}
  function seek(v,t,timeout=1400){return new Promise((res)=>{let done=false;const finish=()=>{if(done)return;done=true;clearTimeout(timer);v.removeEventListener("seeked",finish);v.removeEventListener("error",bad);res(true)};const bad=()=>{if(done)return;done=true;clearTimeout(timer);v.removeEventListener("seeked",finish);res(false)};const timer=setTimeout(()=>{if(done)return;done=true;v.removeEventListener("seeked",finish);v.removeEventListener("error",bad);res(false)},timeout);v.addEventListener("seeked",finish,{once:true});v.addEventListener("error",bad,{once:true});try{const t2=clamp(t,0,Math.max(0,v.duration-.05));if(typeof v.fastSeek==="function")v.fastSeek(t2);else v.currentTime=t2}catch{bad()}})}
  async function frameAt(v,t,w=320,h=180){
    await seek(v,t);await sleep(20);
    if(!v.videoWidth||!v.videoHeight)throw new Error("No decodable video frame");
    const c=document.createElement("canvas"),scale=Math.min(w/v.videoWidth,h/v.videoHeight);
    c.width=Math.max(2,Math.round(v.videoWidth*scale));c.height=Math.max(2,Math.round(v.videoHeight*scale));
    const c2=c.getContext("2d",{willReadFrequently:true});c2.drawImage(v,0,0,c.width,c.height);
    return {canvas:c,score:scoreFrame(c2,c.width,c.height),timestamp:t};
  }
  function candidates(duration,n){
    const end=Math.max(.1,duration-.15),out=[];
    for(let i=0;i<n;i++){const p=(i+.5)/n;out.push(end*p)}
    return out;
  }
  async function recordFor(id){
    return meta().get("meta",id);
  }
  async function saveMeta(r){return meta().put("meta",r)}
  async function ensureThumbnail(id,force=false){
    const r=await recordFor(id);if(!r)return null;
    if(!force&&r.thumbnail&&r.previewVersion===VERSION)return r.thumbnail;
    let file=null;try{file=r.native&&r.url?r.url:await meta().fileFor(r)}catch{return null}
    const v=makeVideo(file);try{
      await waitMeta(v);r.duration=r.duration||v.duration;r.width=r.width||v.videoWidth;r.height=r.height||v.videoHeight;
      const n=v.duration<120?8:v.duration<600?12:v.duration<1800?18:24;
      let best=null;
      for(const t of candidates(v.duration,n)){
        try{const f=await frameAt(v,t);if(!best||f.score>best.score)best=f}catch{}
      }
      if(!best)throw new Error("No suitable frame");
      const c=document.createElement("canvas"),w=640,h=Math.max(2,Math.round(640*(best.canvas.height/best.canvas.width)));
      c.width=w;c.height=Math.min(640,h);c.getContext("2d").drawImage(best.canvas,0,0,c.width,c.height);
      const blob=await new Promise(res=>c.toBlob(res,"image/webp",.82));
      const key=id+":thumbnail:"+VERSION;await meta().put("assets",{key,type:"thumbnail",id,blob,version:VERSION});
      r.thumbnail="/api/videos/"+encodeURIComponent(id)+"/thumbnail?v="+Date.now();
      r.thumbnailTimestamp=best.timestamp;r.thumbnailScore=best.score;r.previewVersion=VERSION;
      await saveMeta(r);window.dispatchEvent(new CustomEvent("dvault:thumbnail-ready",{detail:{id}}));return r.thumbnail;
    }catch(e){r.previewStatus="error";await saveMeta(r).catch(()=>{});return null}
    finally{if(v.src.startsWith("blob:"))URL.revokeObjectURL(v.src);v.remove()}
  }
  function frameCount(duration,kind="sprite"){
    const d=Number(duration)||0;
    if(kind==="sprite")return d<300?30:d<900?45:d<1800?60:d<3600?90:120;
    return d<600?30:d<1200?40:d<2400?50:60;
  }
  async function ensureSprite(id,force=false){
    const r=await recordFor(id);if(!r)return null;
    const existing=await meta().get("assets",id+":sprite:"+VERSION);
    if(existing&&!force)return r.sprite||{ready:true};
    let file=null;try{file=r.native&&r.url?r.url:await meta().fileFor(r)}catch{return null}
    const v=makeVideo(file);let spriteUrl=null;
    try{
      await waitMeta(v);
      const target=frameCount(v.duration);
      // Generate a deliberately small first-pass sprite. This makes the
      // timeline usable quickly; on slower devices we avoid hundreds of
      // expensive random seeks. The target is still adaptive, but capped
      // for memory/decoder speed.
      const n=Math.min(target, /Android|iPhone|iPad/i.test(navigator.userAgent)?36:60);
      const fw=160,fh=Math.max(90,Math.round(fw*(v.videoHeight/v.videoWidth||.5625))),cols=10,rows=Math.ceil(n/cols);
      const c=document.createElement("canvas");c.width=fw*cols;c.height=fh*rows;const x=c.getContext("2d",{alpha:false});
      x.fillStyle="#111";x.fillRect(0,0,c.width,c.height);
      v.pause();v.muted=true;v.playsInline=true;
      for(let i=0;i<n;i++){
        const t=Math.max(0,(v.duration-.25)*((i+.5)/n));
        const ok=await seek(v,t,1200);
        if(ok&&v.videoWidth){
          try{x.drawImage(v,(i%cols)*fw,Math.floor(i/cols)*fh,fw,fh)}catch{}
        }
        // Yield between frames so playback/UI/input always gets a turn.
        if((i&3)===3)await new Promise(requestAnimationFrame);
      }
      const blob=await new Promise(res=>c.toBlob(res,"image/webp",.72));
      if(!blob)throw new Error("Sprite encoding failed");
      await meta().put("assets",{key:id+":sprite:"+VERSION,type:"sprite",id,blob,version:VERSION});
      r.sprite={ready:true,frameCount:n,frameWidth:fw,frameHeight:fh,columns:cols,rows,intervalSeconds:v.duration/n,version:VERSION};
      r.spriteStatus="ready";r.previewVersion=VERSION;await saveMeta(r);window.dispatchEvent(new CustomEvent("dvault:sprite-ready",{detail:{id}}));
      return r.sprite;
    }catch(e){r.spriteStatus="error";await saveMeta(r).catch(()=>{});return null}
    finally{if(v.src.startsWith("blob:"))URL.revokeObjectURL(v.src);v.remove()}
  }
  async function ensureHover(id){const r=await recordFor(id);return r?.duration?{duration:r.duration}:null}
  const queue=[];let running=0;
  function mobileDevice(){return /Android|iPhone|iPad/i.test(navigator.userAgent)}
  function concurrency(){
    const c=navigator.hardwareConcurrency||4;
    const mem=navigator.deviceMemory||4;
    if(mobileDevice())return 1;
    return Math.max(1,Math.min(2,Math.floor(c/2),mem>=8?2:1));
  }
  let playbackActive=false;
  async function pump(){
    if(playbackActive)return;
    while(running<concurrency()&&queue.length&&!playbackActive){
      const j=queue.shift();running++;
      (async()=>{try{await ensureThumbnail(j.id);if(!playbackActive)await ensureSprite(j.id)}catch{}finally{running--;pump()}})()
    }
  }
  function setPlaybackActive(v){playbackActive=!!v;if(!playbackActive)pump()}

  function enqueue(id,priority=10){const existing=queue.find(x=>x.id===id);if(existing){if(priority<existing.priority)existing.priority=priority;queue.sort((a,b)=>a.priority-b.priority);pump();return}queue.push({id,priority});queue.sort((a,b)=>a.priority-b.priority);pump()}
  function prioritize(id){enqueue(id,0)}
  window.DVaultPreview={VERSION,ensureThumbnail,ensureSprite,ensureHover,enqueue,prioritize,frameCount,setPlaybackActive,
    async asset(id,type){return meta().get("assets",id+":"+type+":"+VERSION)},
    async invalidate(id){for(const k of ["thumbnail","sprite"])await meta().del("assets",id+":"+k+":"+VERSION).catch(()=>{});const r=await recordFor(id);if(r){r.thumbnail=null;r.sprite=null;await saveMeta(r)}}
  };
})();