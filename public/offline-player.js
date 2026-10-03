// offline-player.js
// A small, self-contained set of custom video controls used wherever a
// *downloaded* video is played back (watch.js's offline fallback, and the
// Downloads page's own player). The normal online player (watch.js) already
// has a full custom control set with speed/PiP/fill-fit/keyboard/touch
// gestures — this gives the offline/in-app-storage playback the same
// feature set without dragging in all of that player's server-dependent
// bits (scrub-preview thumbnails, quality menu, etc.), which don't apply to
// a local blob anyway.
//
// Usage:
//   OfflinePlayer.attach(containerEl, videoEl, {isActive:()=>true})
// containerEl must be a positioned (relative/fixed) element that videoEl is
// already inside of; this call adds sibling overlay elements to it (skip
// flashes, a bottom control bar, etc.) and wires up all the interaction.
//
// The ⏮ / ⏭ transport buttons move between videos in a playlist rather
// than seeking — pass onPrev/onNext callbacks in opts to wire them up (the
// Downloads page does this to step through downloaded videos). If a
// callback isn't provided, its button is disabled since there's nothing to
// go to (e.g. watch.js's single-video offline fallback). Call the returned
// controller's setNav(hasPrev, hasNext) whenever the caller's position in
// the playlist changes, to enable/disable each button at the ends of the
// list. The double-tap-to-seek screen gesture and the J/L/arrow-key
// shortcuts still skip by seconds within the current video — only these
// two on-screen buttons were repurposed.
// Returns a controller object with destroy() to unbind everything.
(function(){
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
    }
    downloadBlob(blob,filename);
    return "saved";
  }
  const SPEEDS=[0.5,0.75,1,1.25,1.5,1.75,2];
  const PLAY_SVG='<svg viewBox="0 0 24 24" width="38" height="38" fill="#fff" style="margin-left:4px"><path d="M8 5v14l11-7z"></path></svg>';
  const PAUSE_SVG='<svg viewBox="0 0 24 24" width="36" height="36" fill="#fff"><path d="M6 5h4v14H6zm8 0h4v14h-4z"></path></svg>';
  // Same outline icons the main watch page uses for these two, reused here
  // so the offline player's control row matches it exactly instead of the
  // plain "⧉"/"⛶" text glyphs this used to fall back to.
  const PIP_SVG='<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h5"/><rect x="13" y="13" width="8" height="6" rx="1.5"/></svg>';
  const FULLSCREEN_SVG='<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3"></path><path d="M21 8V5a2 2 0 0 0-2-2h-3"></path><path d="M3 16v3a2 2 0 0 0 2 2h3"></path><path d="M16 21h3a2 2 0 0 0 2-2v-3"></path></svg>';
  const fmtTime=s=>{
    if(!Number.isFinite(s)||s<0)s=0;
    s=Math.floor(s);
    const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sec=s%60;
    const mm=h?String(m).padStart(2,"0"):String(m);
    return (h?h+":":"")+mm+":"+String(sec).padStart(2,"0");
  };

  function injectStyles(){
    if(document.getElementById("offline-player-styles"))return;
    const css=`
.op-skip{position:absolute;top:50%;transform:translateY(-50%);width:78px;height:78px;border-radius:50%;background:#0007;color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;font-size:20px;opacity:0;pointer-events:none;transition:opacity .15s ease;z-index:5}
.op-skip-left{left:8%}.op-skip-right{right:8%}
.op-skip .op-skip-icon{font-size:20px;color:#fff;letter-spacing:1px}
.op-skip .op-skip-text{font-size:11px;margin-top:2px}
.op-skip.pulse{animation:opSkipPulse .5s ease}
@keyframes opSkipPulse{0%{opacity:1;transform:translateY(-50%) scale(1.08)}60%{opacity:1;transform:translateY(-50%) scale(1)}100%{opacity:0}}
.op-speed-badge{position:absolute;top:14px;left:50%;transform:translateX(-50%);background:#000a;color:#fff;font-weight:700;font-size:13px;padding:6px 12px;border-radius:20px;opacity:0;pointer-events:none;transition:opacity .15s ease;z-index:6}
.op-speed-badge.show{opacity:1}
.op-center-play{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:64px;height:64px;border-radius:50%;background:#0007;color:#fff;display:flex;align-items:center;justify-content:center;font-size:28px;opacity:0;pointer-events:none;transition:opacity .15s ease;z-index:5}
.op-center-play.show{opacity:1}
.op-controls{position:absolute;left:0;right:0;bottom:0;padding:6px 12px 10px;background:linear-gradient(0deg,#000c,transparent);opacity:0;transform:translateY(4px);transition:opacity .12s cubic-bezier(.4,0,.2,1),transform .12s cubic-bezier(.4,0,.2,1);pointer-events:none;z-index:7}
.op-controls.show{opacity:1;transform:translateY(0);pointer-events:auto}
.op-seekrow{display:flex;align-items:center;gap:10px}
/* Native <input type=range> internals (::-webkit-slider-runnable-track/thumb)
   are engine-specific shadow parts, not real boxes - which is exactly why
   getting a clean, reliably-rounded "pill" end on them took increasingly
   convoluted hacks (short-track-plus-margin-math, then a content-box-clip
   trick) and still didn't render as a smooth "U" on every engine.
   The watch page never had this problem because its seek/volume bars are
   built from plain, real <div>s (.op-timeline/.op-played/.op-buffered/
   .op-scrubber, .op-vol-track/.op-vol-fill/.op-vol-thumb below) with an
   ordinary border-radius - the same technique used here now, driven by
   pointer events instead of a native input's own drag handling. A radius
   at or above half the box's own height always renders as a fully rounded
   stadium end on a real element - no engine-dependent guesswork. */
.op-seek-area{flex:1;position:relative;padding:9px 0 8px;touch-action:none;cursor:pointer}
.op-timeline{position:relative;height:5px;background:#616161;border-radius:999px;cursor:pointer;transition:height .15s ease}
.op-timeline:focus-visible{outline:2px solid #fff;outline-offset:4px;border-radius:999px}
.op-seek-area:hover .op-timeline,.op-timeline.dragging{height:7px}
.op-buffered,.op-played{position:absolute;left:0;top:0;height:100%;border-radius:999px}
.op-buffered{background:#8c8c8c;transition:width .3s ease}
.op-played{background:#fff;box-shadow:0 0 5px #00000040;transition:width .12s linear;will-change:width}
.op-timeline.dragging .op-played,.op-timeline.dragging .op-buffered{transition:none}
.op-scrubber{position:absolute;top:50%;width:14px;height:14px;margin-left:-7px;transform:translateY(-50%);border-radius:50%;background:#fff;box-shadow:0 1px 6px #0000006b;opacity:1;transition:transform .18s cubic-bezier(.34,1.56,.64,1),left .12s linear}
.op-seek-area:hover .op-scrubber{transform:translateY(-50%) scale(1.15)}
.op-timeline.dragging .op-scrubber{transform:translateY(-50%) scale(1.3);transition:transform .18s cubic-bezier(.34,1.56,.64,1)}
.op-time{color:#eee;font-size:13px;white-space:nowrap;font-variant-numeric:tabular-nums}
.op-volume-btn.is-muted .op-vol-icon{-webkit-mask-image:url(/icons/mute.png);mask-image:url(/icons/mute.png)}
.op-vol-icon{display:inline-block;width:20px;height:20px;background-color:#fff;-webkit-mask:url(/icons/volume.png) center/contain no-repeat;mask:url(/icons/volume.png) center/contain no-repeat}
/* Same div-based approach as .op-seek-area above, applied to the volume slider. */
.op-vol-area{display:flex;align-items:center;width:64px;height:24px;cursor:pointer;touch-action:none;margin:0 2px}
.op-vol-track{position:relative;width:100%;height:4px;border-radius:999px;background:#616161;transition:height .15s ease}
.op-vol-area:hover .op-vol-track,.op-vol-track.dragging{height:5px}
.op-vol-fill{position:absolute;left:0;top:0;height:100%;width:0;border-radius:999px;background:#fff;box-shadow:0 0 4px #00000040;pointer-events:none}
.op-vol-thumb{position:absolute;top:50%;left:0;width:11px;height:11px;margin-left:-5.5px;transform:translateY(-50%);border-radius:50%;background:#fff;box-shadow:0 1px 5px #0000006b;pointer-events:none;transition:transform .15s cubic-bezier(.34,1.56,.64,1)}
.op-vol-area:hover .op-vol-thumb,.op-vol-track.dragging .op-vol-thumb{transform:translateY(-50%) scale(1.3)}
.op-vol-track:focus-visible{outline:2px solid #fff;outline-offset:4px;border-radius:999px}
.op-bar{display:flex;align-items:center;gap:6px;margin-top:6px;opacity:1}
.op-bar .op-btn{border:0;background:transparent;color:#fff;cursor:pointer;font-size:13px;font-weight:600;padding:7px 8px;border-radius:8px;display:flex;align-items:center;gap:4px;white-space:nowrap;transition:background .12s ease-out,transform .12s cubic-bezier(.4,0,.2,1)}
.op-bar .op-btn:hover{background:#ffffff22}
.op-bar .op-btn:active{transform:scale(.9);background:#ffffff2a}
.op-bar .op-btn:disabled{opacity:.32;cursor:default;pointer-events:none}
.op-bar .op-spacer{flex:1}
.op-bar .op-icon{font-size:17px;line-height:1}
.op-bar .op-icon-svg{display:inline-flex}
@media(max-width:480px){.op-bar{gap:2px}.op-bar .op-btn{padding:6px 5px;font-size:12px}.op-vol-area{width:56px}}
.op-screenshot-btn{position:absolute;right:16px;top:50%;transform:translateY(-50%);width:38px;height:38px;border-radius:50%;border:none;background:transparent;color:#fff;filter:drop-shadow(0 1px 3px #000a) drop-shadow(0 0 2px #0008);display:grid;place-items:center;cursor:pointer;z-index:8;opacity:1;pointer-events:auto;transition:opacity .2s ease, transform .1s ease}
.op-screenshot-btn img{filter:brightness(0) invert(1);pointer-events:none}
.op-screenshot-btn.auto-hidden{opacity:0;pointer-events:none;transform:translateY(-50%) scale(.9)}
.op-screenshot-btn:active{transform:translateY(-50%) scale(.88)}
.op-screenshot-btn.flash{animation:opScreenshotFlash .4s ease-out}
@keyframes opScreenshotFlash{
  0%{filter:drop-shadow(0 0 0 #ffffffcc) drop-shadow(0 0 0 #ffffffcc)}
  100%{filter:drop-shadow(0 0 10px #ffffff00) drop-shadow(0 0 10px #ffffff00)}
}
@media(max-width:480px){.op-screenshot-btn{width:32px;height:32px}.op-screenshot-btn svg{width:22px;height:22px}}
.op-hint{position:absolute;bottom:64px;left:50%;transform:translateX(-50%);background:#000a;color:#fff;font-weight:700;font-size:12px;padding:6px 12px;border-radius:20px;opacity:0;pointer-events:none;transition:opacity .15s ease;z-index:6;white-space:nowrap}
.op-hint.show{opacity:1}
.op-player-root:fullscreen{width:100vw!important;height:100vh!important;aspect-ratio:auto!important;box-sizing:border-box!important;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)!important}
.op-player-root:-webkit-full-screen{width:100vw!important;height:100vh!important;aspect-ratio:auto!important;box-sizing:border-box!important;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)!important}
.op-player-root video{transform-origin:center center;transition:transform .18s ease;-webkit-touch-callout:none;-webkit-user-select:none;user-select:none}
.op-player-root video.zoom-live{transition:none}
.op-player-root .dl-player-close{transition:opacity .2s ease, transform .15s ease}
.op-player-root .dl-player-close.auto-hidden{opacity:0;pointer-events:none;transform:scale(.9)}
`;
    const style=document.createElement("style");
    style.id="offline-player-styles";
    style.textContent=css;
    document.head.appendChild(style);
  }

  function attach(container,video,opts){
    opts=opts||{};
    const isActive=opts.isActive||(()=>true);
    injectStyles();
    container.classList.add("op-player-root");

    video.removeAttribute("controls");
    video.setAttribute("playsinline","");
    // Without this, a long-press anywhere on the video - including the
    // press-and-hold that's supposed to trigger the 2x-speed gesture below
    // - opens the browser's own "Download video / Copy video frame /
    // Picture-in-Picture" menu on top of it (the -webkit-touch-callout:none
    // on the video in the stylesheet above stops most browsers from ever
    // starting that gesture; this contextmenu handler is the fallback for
    // browsers where it still fires).
    const onContextMenu=e=>e.preventDefault();
    video.addEventListener("contextmenu",onContextMenu);
    container.addEventListener("contextmenu",onContextMenu);

    const make=(tag,cls,html)=>{const el=document.createElement(tag);if(cls)el.className=cls;if(html!=null)el.innerHTML=html;return el};

    const skipLeft=make("div","op-skip op-skip-left",'<span class="op-skip-icon">◁◁</span><span class="op-skip-text"></span>');
    const skipRight=make("div","op-skip op-skip-right",'<span class="op-skip-icon">▷▷</span><span class="op-skip-text"></span>');
    const speedBadge=make("div","op-speed-badge","2×");
    const centerPlay=make("div","op-center-play",PLAY_SVG);
    const hintEl=make("div","op-hint","");
    const screenshotBtn=make("button","op-screenshot-btn",
      '<img src="/icons/screenshot-icon.png" width="24" height="24" alt="">');
    screenshotBtn.type="button";
    screenshotBtn.setAttribute("aria-label","Take a screenshot of this frame");

    const canPip="pictureInPictureEnabled" in document;
    const controls=make("div","op-controls");
    controls.innerHTML=`
      <div class="op-seekrow">
        <span class="op-time">0:00 / 0:00</span>
        <div class="op-seek-area">
          <div class="op-timeline">
            <div class="op-buffered"></div>
            <div class="op-played"></div>
            <div class="op-scrubber"></div>
          </div>
        </div>
      </div>
      <div class="op-bar">
        <button type="button" class="op-btn op-volume-btn" aria-label="Mute"><span class="op-icon op-vol-icon"></span></button>
        <div class="op-vol-area">
          <div class="op-vol-track">
            <div class="op-vol-fill"></div>
            <div class="op-vol-thumb"></div>
          </div>
        </div>
        <span class="op-spacer"></span>
        <button type="button" class="op-btn op-speed" aria-label="Playback speed">1×</button>
        <button type="button" class="op-btn op-fit" aria-label="Fill/fit">Fill</button>
        ${canPip?`<button type="button" class="op-btn op-pip" aria-label="Picture in picture"><span class="op-icon op-icon-svg">${PIP_SVG}</span></button>`:""}
        <button type="button" class="op-btn op-fullscreen" aria-label="Fullscreen"><span class="op-icon op-icon-svg">${FULLSCREEN_SVG}</span></button>
      </div>`;

    container.append(skipLeft,skipRight,speedBadge,centerPlay,hintEl,screenshotBtn,controls);

    // The Downloads page's own player (public/downloads.html) puts a "×"
    // close button directly inside this same container, alongside the
    // video - if it's there, fold it into the same auto-hide behavior as
    // the screenshot button below. Nothing to do here on pages that don't
    // have one (e.g. watch.js's offline fallback).
    const closeBtn=container.querySelector(".dl-player-close");

    const seekArea=controls.querySelector(".op-seek-area"),
      timeline=controls.querySelector(".op-timeline"),
      played=controls.querySelector(".op-played"),
      buffered=controls.querySelector(".op-buffered"),
      scrubber=controls.querySelector(".op-scrubber"),
      timeEl=controls.querySelector(".op-time"),
      speedBtn=controls.querySelector(".op-speed"),
      fitBtn=controls.querySelector(".op-fit"),pipBtn=controls.querySelector(".op-pip"),
      fsBtn=controls.querySelector(".op-fullscreen"),volBtn=controls.querySelector(".op-volume-btn"),
      volArea=controls.querySelector(".op-vol-area"),
      volTrack=controls.querySelector(".op-vol-track"),
      volFill=controls.querySelector(".op-vol-fill"),
      volThumb=controls.querySelector(".op-vol-thumb");

    // ---- basic state ----
    let fillMode=false,speedIdx=SPEEDS.indexOf(1),dragging=false,hideTimer=null;
    let currentTitle=opts.title||"video";

    const updatePlayIcon=()=>{
      centerPlay.innerHTML=video.paused?PLAY_SVG:PAUSE_SVG;
    };
    // ---- screenshot + close-button auto-hide (shown while controls are
    // shown/interacted with, fades out on its own after a few seconds of
    // inactivity) ----
    let hintTimer=null,chromeHideTimer=null;
    const autoHideEls=[screenshotBtn,closeBtn].filter(Boolean);
    const showHint=t=>{
      hintEl.textContent=t;
      hintEl.classList.add("show");
      clearTimeout(hintTimer);
      hintTimer=setTimeout(()=>hintEl.classList.remove("show"),1400);
    };
    const hideChrome=()=>{
      autoHideEls.forEach(el=>el.classList.add("auto-hidden"));
      chromeHideTimer=null;
    };
    const showChrome=()=>{
      autoHideEls.forEach(el=>el.classList.remove("auto-hidden"));
      clearTimeout(chromeHideTimer);
      chromeHideTimer=setTimeout(hideChrome,3000);
    };
    const showControls=()=>{
      controls.classList.add("show");
      showChrome();
      clearTimeout(hideTimer);
      if(!video.paused)hideTimer=setTimeout(()=>controls.classList.remove("show"),2600);
    };
    const flashCenter=()=>{
      centerPlay.classList.add("show");
      clearTimeout(flashCenter._t);
      flashCenter._t=setTimeout(()=>centerPlay.classList.remove("show"),550);
    };
    const togglePlay=()=>{
      if(video.paused)video.play().catch(()=>{});else video.pause();
      flashCenter();showControls();
    };
    video.addEventListener("play",updatePlayIcon);
    video.addEventListener("pause",updatePlayIcon);
    video.addEventListener("ended",()=>{updatePlayIcon();showControls();clearTimeout(hideTimer)});

    // ---- volume / sound bar ----
    // Div-based slider (track+fill+thumb), same pointer-driven pattern as
    // the seek bar below and the same approach the watch page uses - see
    // the comment on .op-seek-area in the CSS above for why a native
    // <input type=range> was dropped in favor of this.
    const volFromX=x=>{const r=volTrack.getBoundingClientRect();return r.width?Math.max(0,Math.min(1,(x-r.left)/r.width)):0};
    const setVolume=x=>{video.muted=false;video.volume=volFromX(x);updateVolUi()};
    let volDragging=false;
    const volBeginDrag=x=>{volDragging=true;volTrack.classList.add("dragging");setVolume(x);showControls()};
    const volEndDrag=()=>{if(!volDragging)return;volDragging=false;volTrack.classList.remove("dragging")};
    volArea.addEventListener("pointerdown",e=>{e.preventDefault();e.stopPropagation();try{volArea.setPointerCapture(e.pointerId)}catch(_){}volBeginDrag(e.clientX)});
    volArea.addEventListener("pointermove",e=>{if(!volDragging)return;setVolume(e.clientX);showControls()});
    volArea.addEventListener("pointerup",e=>{try{volArea.releasePointerCapture(e.pointerId)}catch(_){}volEndDrag()});
    volArea.addEventListener("pointercancel",volEndDrag);
    volTrack.setAttribute("tabindex","0");volTrack.setAttribute("role","slider");volTrack.setAttribute("aria-label","Volume");
    volTrack.setAttribute("aria-valuemin","0");volTrack.setAttribute("aria-valuemax","100");
    volTrack.addEventListener("keydown",e=>{
      let d=null;
      if(e.key==="ArrowLeft")d=-.05;else if(e.key==="ArrowRight")d=.05;else if(e.key==="Home")d=-1;else if(e.key==="End")d=1;
      if(d===null)return;
      e.preventDefault();video.muted=false;video.volume=e.key==="Home"?0:e.key==="End"?1:Math.max(0,Math.min(1,video.volume+d));updateVolUi();
    });
    const updateVolUi=()=>{
      const isMuted=video.muted||video.volume===0;
      const pct=(isMuted?0:video.volume*100)+"%";
      volFill.style.width=pct;volThumb.style.left=pct;
      volTrack.setAttribute("aria-valuenow",String(Math.round((isMuted?0:video.volume)*100)));
      volBtn.classList.toggle("is-muted",isMuted);
      volBtn.setAttribute("aria-label",isMuted?"Unmute":"Mute");
    };
    volBtn.onclick=e=>{e.stopPropagation();video.muted=!video.muted;updateVolUi();showControls()};
    video.addEventListener("volumechange",updateVolUi);
    updateVolUi();

    // Single "cur / total" readout, matching the main watch page's format,
    // instead of a separate elapsed span plus a "-remaining" span.
    const updateTimeText=()=>{timeEl.textContent=fmtTime(video.currentTime)+" / "+fmtTime(video.duration||0)};
    video.addEventListener("loadedmetadata",()=>{updateTimeText();updatePlayIcon()});
    // ---- seek / timeline bar ---- (same div-based approach as watch.js's
    // seekArea/timeline/played/buffered/scrubber, minus the sprite-preview
    // thumbnail feature - not something this offline player supports)
    const fracFromX=x=>{const r=timeline.getBoundingClientRect();return r.width?Math.max(0,Math.min(1,(x-r.left)/r.width)):0};
    const setSeekUi=f=>{const pct=(f*100)+"%";played.style.width=pct;scrubber.style.left=pct;timeline.setAttribute("aria-valuenow",String(Math.round(f*(video.duration||0))))};
    let pendingSeekT=null;
    // Same reasoning as the watch page's scrubTo: only updates the visual
    // played-bar position while dragging: the real seek (the only thing
    // that triggers a network/disk read) happens once, in endDrag, for
    // wherever you actually release.
    const scrubTo=x=>{
      if(!video.duration)return;
      const f=fracFromX(x);
      setSeekUi(f);
      pendingSeekT=f*video.duration;
      timeEl.textContent=fmtTime(pendingSeekT)+" / "+fmtTime(video.duration);
    };
    const beginDrag=x=>{if(!video.duration)return;dragging=true;pendingSeekT=null;timeline.classList.add("dragging");scrubTo(x);showControls()};
    const endDrag=(commit=true)=>{if(!dragging)return;dragging=false;timeline.classList.remove("dragging");if(commit&&pendingSeekT!==null)video.currentTime=pendingSeekT;pendingSeekT=null};
    seekArea.addEventListener("pointerdown",e=>{e.preventDefault();e.stopPropagation();try{seekArea.setPointerCapture(e.pointerId)}catch(_){}beginDrag(e.clientX)});
    seekArea.addEventListener("pointermove",e=>{if(!dragging)return;scrubTo(e.clientX)});
    seekArea.addEventListener("pointerup",e=>{try{seekArea.releasePointerCapture(e.pointerId)}catch(_){}endDrag(true)});
    seekArea.addEventListener("pointercancel",()=>endDrag(false));
    // Interrupted gestures (finger/mouse released elsewhere, tab hidden,
    // window loses focus) drop the pending position instead of seeking -
    // same as the watch page's drag handling. Named so destroy() below can
    // remove them (this attach() can run more than once per page load).
    const onWindowPointerUp=e=>{if(e.pointerType!=="mouse"&&dragging)endDrag(true)};
    const onWindowPointerCancel=()=>endDrag(false);
    const onVisibilityChange=()=>{if(document.hidden){endDrag(false);volEndDrag()}};
    const onWindowBlur=()=>{endDrag(false);volEndDrag()};
    window.addEventListener("pointerup",onWindowPointerUp,true);
    window.addEventListener("pointercancel",onWindowPointerCancel,true);
    document.addEventListener("visibilitychange",onVisibilityChange);
    window.addEventListener("blur",onWindowBlur);
    timeline.setAttribute("tabindex","0");timeline.setAttribute("role","slider");timeline.setAttribute("aria-label","Seek");timeline.setAttribute("aria-valuemin","0");
    timeline.addEventListener("keydown",e=>{
      if(!video.duration)return;
      let t=null;
      if(e.key==="ArrowLeft")t=Math.max(0,video.currentTime-5);else if(e.key==="ArrowRight")t=Math.min(video.duration,video.currentTime+5);else if(e.key==="Home")t=0;else if(e.key==="End")t=video.duration;
      if(t===null)return;
      e.preventDefault();video.currentTime=t;setSeekUi(t/video.duration);
    });
    video.addEventListener("timeupdate",()=>{
      if(dragging)return;
      updateTimeText();
      if(Number.isFinite(video.duration)&&video.duration>0)setSeekUi(video.currentTime/video.duration);
    });
    video.addEventListener("progress",()=>{
      if(!video.duration||!video.buffered.length)return;
      try{buffered.style.width=Math.min(100,video.buffered.end(video.buffered.length-1)/video.duration*100)+"%"}catch(_){}
    });
    video.addEventListener("loadedmetadata",()=>{
      timeline.setAttribute("aria-valuemax",String(Math.round(video.duration)));
    });

    // ---- speed ----
    const applySpeed=()=>{video.playbackRate=SPEEDS[speedIdx];speedBtn.textContent=SPEEDS[speedIdx]===1?"1×":SPEEDS[speedIdx]+"×"};
    speedBtn.onclick=e=>{e.stopPropagation();speedIdx=(speedIdx+1)%SPEEDS.length;applySpeed();showControls()};
    const nudgeSpeed=dir=>{speedIdx=Math.max(0,Math.min(SPEEDS.length-1,speedIdx+dir));applySpeed();showControls()};
    applySpeed();

    // ---- fill/fit ----
    const updateFit=()=>{video.style.objectFit=fillMode?"cover":"contain";fitBtn.textContent=fillMode?"Fit":"Fill"};
    fitBtn.onclick=e=>{e.stopPropagation();fillMode=!fillMode;updateFit();resetZoom();showControls()};
    updateFit();

    // ---- picture-in-picture ----
    const togglePip=async()=>{
      if(!canPip)return;
      try{document.pictureInPictureElement?await document.exitPictureInPicture():await video.requestPictureInPicture()}catch(_){}
    };
    if(pipBtn)pipBtn.onclick=e=>{e.stopPropagation();togglePip()};

    // ---- fullscreen ----
    const toggleFullscreen=async()=>{
      try{
        if(document.fullscreenElement)await document.exitFullscreen();
        else await container.requestFullscreen();
      }catch(_){
        try{await video.webkitEnterFullscreen()}catch(__){}
      }
    };
    fsBtn.onclick=e=>{e.stopPropagation();toggleFullscreen()};

    // ---- screenshot — draws whatever frame is currently showing onto an
    // off-screen canvas and downloads it as a compressed JPEG. Same approach
    // as the watch page's screenshot button: works entirely in the browser
    // (the video is a same-origin blob: URL, so the canvas isn't tainted). ----
    screenshotBtn.onclick=async e=>{
      e.stopPropagation();
      showChrome();
      try{
        if(!video.videoWidth||!video.videoHeight)throw Error("Video isn't ready yet.");
        const c=document.createElement("canvas");
        c.width=video.videoWidth;c.height=video.videoHeight;
        c.getContext("2d").drawImage(video,0,0,c.width,c.height);
        // toDataURL, not toBlob - see the comment on dataUrlToBlob above for
        // why: toBlob's callback runs late enough that the resulting
        // download can lose its connection to this click and get silently
        // dropped by some browsers.
        const dataUrl=c.toDataURL("image/jpeg",0.85);
        const blob=dataUrlToBlob(dataUrl);
        const base=(currentTitle||"video").replace(/[\\/:*?"<>|]/g,"").trim()||"video";
        const stamp=fmtTime(video.currentTime).replace(/:/g,"-");
        try{
          const result=await saveCapturedFrame(blob,`${base} - ${stamp}.jpg`);
          if(result==="saved"){
            screenshotBtn.classList.remove("flash");
            void screenshotBtn.offsetWidth;
            screenshotBtn.classList.add("flash");
            showHint("Screenshot saved");
          }
        }catch{
          showHint("Couldn't capture that frame.");
        }
      }catch(err){
        showHint(err.message||"Couldn't capture that frame.");
      }
    };

    // ---- seek helper (still used by the double-tap gesture + keyboard
    // shortcuts below; no longer wired to the ⏮/⏭ buttons) ----
    const skip=seconds=>{
      if(!Number.isFinite(video.duration))return;
      video.currentTime=Math.max(0,Math.min(video.duration,video.currentTime+seconds));
      showControls();
    };

    const seekToPercent=f=>{
      if(!Number.isFinite(video.duration))return;
      video.currentTime=video.duration*f;
      showControls();
    };
    const changeVolume=d=>{
      video.muted=false;
      video.volume=Math.max(0,Math.min(1,(video.volume||0)+d));
      updateVolUi();
      showControls();
    };
    const stepFrame=dir=>{
      if(!Number.isFinite(video.duration))return;
      video.currentTime=Math.max(0,Math.min(video.duration,video.currentTime+dir/30));
      showControls();
    };

    // ---- touch/mouse gestures: tap-to-toggle, double-tap ±10s, long-press 2x ----
    const isInsideControls=e=>!!e.target.closest(".op-controls, button, a");
    let longPressTimer=null,longPressActive=false,savedRate=1;
    const clearLongPress=()=>{if(longPressTimer){clearTimeout(longPressTimer);longPressTimer=null}};
    const endLongPress=()=>{
      clearLongPress();
      if(!longPressActive)return;
      longPressActive=false;
      video.playbackRate=savedRate;
      speedBadge.classList.remove("show");
      showControls();
    };
    const DOUBLE_TAP_MS=350;
    let tapSide=null,tapCount=0,tapTotal=0,tapTimer=null;
    const resetTap=()=>{tapSide=null;tapCount=0;tapTotal=0;clearTimeout(tapTimer);tapTimer=null};
    const flashSkip=(el,secs)=>{
      el.querySelector(".op-skip-text").textContent=secs+"s";
      el.classList.remove("pulse");
      void el.offsetWidth;
      el.classList.add("pulse");
    };
    const registerDoubleTapSkip=side=>{
      if(tapSide===side)tapCount++;else{tapSide=side;tapCount=1;tapTotal=0}
      clearTimeout(tapTimer);
      tapTimer=setTimeout(resetTap,DOUBLE_TAP_MS);
      if(tapCount<2)return false;
      tapTotal+=10;
      skip(side==="left"?-10:10);
      flashSkip(side==="left"?skipLeft:skipRight,tapTotal);
      return true;
    };

    // ---- continuous pinch-to-zoom + drag-to-pan, YouTube-style ----
    const MIN_ZOOM=1,MAX_ZOOM=4;
    let zoomScale=1,panX=0,panY=0;
    const activeTouches=new Map();
    let pinchGestureActive=false,pinchBaseDist=null,pinchStartScale=1;
    let dragPointerId=null,dragStartX=0,dragStartY=0,dragOriginPanX=0,dragOriginPanY=0,dragMoved=false;
    const clampNum=(n,lo,hi)=>Math.max(lo,Math.min(hi,n));
    const touchDist=()=>{const pts=[...activeTouches.values()];return Math.hypot(pts[0].x-pts[1].x,pts[0].y-pts[1].y)};
    const clampPan=()=>{
      const rect=container.getBoundingClientRect();
      const maxX=(rect.width*(zoomScale-1))/2,maxY=(rect.height*(zoomScale-1))/2;
      panX=clampNum(panX,-maxX,maxX);panY=clampNum(panY,-maxY,maxY);
    };
    const applyTransform=()=>{video.style.transform=zoomScale===1?"":`translate(${panX}px,${panY}px) scale(${zoomScale})`};
    const resetZoom=()=>{
      if(zoomScale===1&&panX===0&&panY===0)return;
      video.classList.remove("zoom-live");
      zoomScale=1;panX=0;panY=0;
      applyTransform();
    };

    let pointerId=null;
    const onPointerDown=e=>{
      if(isInsideControls(e))return;

      if(e.pointerType==="touch"){
        activeTouches.set(e.pointerId,{x:e.clientX,y:e.clientY});
        if(activeTouches.size===2){
          pinchGestureActive=true;
          clearLongPress();
          if(longPressActive)endLongPress();
          resetTap();
          dragPointerId=null;dragMoved=false;
          pinchBaseDist=touchDist();
          pinchStartScale=zoomScale;
          video.classList.add("zoom-live");
          return;
        }
        if(activeTouches.size>1)return;
        if(zoomScale>1){
          dragPointerId=e.pointerId;
          dragStartX=e.clientX;dragStartY=e.clientY;
          dragOriginPanX=panX;dragOriginPanY=panY;
          dragMoved=false;
        }
      }

      if(e.pointerType==="mouse"&&e.button!==0)return;
      const rect=container.getBoundingClientRect();
      const x=e.clientX-rect.left;
      const inRightZone=x>=rect.width*0.62;
      if(e.pointerType==="mouse"&&!inRightZone)return;
      if(inRightZone){
        clearLongPress();
        pointerId=e.pointerId;
        longPressTimer=setTimeout(()=>{
          longPressTimer=null;
          if(video.paused||video.ended)return;
          longPressActive=true;
          savedRate=video.playbackRate||1;
          video.playbackRate=2;
          speedBadge.classList.add("show");
          showControls();
          try{container.setPointerCapture(e.pointerId)}catch(_){}
        },450);
      }
    };
    const onPointerMove=e=>{
      if(e.pointerType!=="touch")return;

      if(pinchGestureActive&&activeTouches.has(e.pointerId)){
        activeTouches.set(e.pointerId,{x:e.clientX,y:e.clientY});
        if(activeTouches.size!==2||pinchBaseDist===null||pinchBaseDist===0)return;
        const d=touchDist();
        zoomScale=clampNum(pinchStartScale*(d/pinchBaseDist),MIN_ZOOM,MAX_ZOOM);
        if(zoomScale===MIN_ZOOM){panX=0;panY=0}else clampPan();
        applyTransform();
        showControls();
        return;
      }

      if(dragPointerId===e.pointerId&&zoomScale>1){
        const dx=e.clientX-dragStartX,dy=e.clientY-dragStartY;
        if(!dragMoved){
          if(Math.hypot(dx,dy)<8)return;
          dragMoved=true;
          clearLongPress();
          if(longPressActive)endLongPress();
          resetTap();
          video.classList.add("zoom-live");
        }
        panX=dragOriginPanX+dx;panY=dragOriginPanY+dy;
        clampPan();
        applyTransform();
      }
    };
    const onPointerUp=e=>{
      if(isInsideControls(e))return;

      if(e.pointerType==="touch"){
        activeTouches.delete(e.pointerId);
        if(activeTouches.size>=1)return;
        if(pinchGestureActive){
          pinchGestureActive=false;pinchBaseDist=null;
          video.classList.remove("zoom-live");
          if(zoomScale<=1.03){zoomScale=1;panX=0;panY=0;applyTransform()}
          endLongPress();
          return;
        }
        if(dragPointerId===e.pointerId){
          const wasDrag=dragMoved;
          dragPointerId=null;dragMoved=false;
          video.classList.remove("zoom-live");
          if(wasDrag){endLongPress();return}
        }
      }

      const wasLong=longPressActive;
      endLongPress();
      if(pointerId!==null){try{container.releasePointerCapture(pointerId)}catch(_){}pointerId=null}
      if(e.pointerType==="mouse"){
        if(wasLong)return;
        const rect=container.getBoundingClientRect();
        const x=e.clientX-rect.left;
        if(x<rect.width*0.62)togglePlay();else controls.classList.contains("show")?controls.classList.remove("show"):showControls();
        return;
      }
      if(wasLong)return;
      const rect=container.getBoundingClientRect();
      const x=e.clientX-rect.left;
      if(x<rect.width*0.38){if(registerDoubleTapSkip("left"))return}
      else if(x>=rect.width*0.62){if(registerDoubleTapSkip("right"))return}
      else{resetTap();togglePlay();return}
      controls.classList.contains("show")?controls.classList.remove("show"):showControls();
    };
    const onPointerCancel=e=>{
      if(e&&e.pointerType==="touch"){
        activeTouches.delete(e.pointerId);
        if(activeTouches.size===0){pinchGestureActive=false;pinchBaseDist=null}
        if(dragPointerId===e.pointerId){dragPointerId=null;dragMoved=false}
      }
      video.classList.remove("zoom-live");
      endLongPress();
    };
    container.addEventListener("pointerdown",onPointerDown,{passive:true});
    container.addEventListener("pointermove",onPointerMove,{passive:true});
    container.addEventListener("pointerup",onPointerUp,{passive:true});
    container.addEventListener("pointercancel",onPointerCancel,{passive:true});
    container.addEventListener("pointerleave",e=>{
      if(e&&e.pointerType==="touch"){
        activeTouches.delete(e.pointerId);
        if(activeTouches.size===0){pinchGestureActive=false;pinchBaseDist=null}
        if(dragPointerId===e.pointerId){dragPointerId=null;dragMoved=false;video.classList.remove("zoom-live")}
      }
      if(longPressActive)endLongPress();else clearLongPress();
    },{passive:true});

    // ---- keyboard shortcuts ----
    const isTypingTarget=el=>{
      if(!el)return false;
      const tag=el.tagName;
      return tag==="INPUT"||tag==="TEXTAREA"||tag==="SELECT"||el.isContentEditable;
    };
    const onKeydown=e=>{
      if(!isActive())return;
      if(e.defaultPrevented||e.ctrlKey||e.metaKey||e.altKey)return;
      if(isTypingTarget(document.activeElement))return;
      if(document.activeElement===seek&&["ArrowLeft","ArrowRight","Home","End"].includes(e.key))return;
      switch(e.key){
        case " ":case "k":case "K":e.preventDefault();togglePlay();break;
        case "ArrowLeft":e.preventDefault();skip(-5);break;
        case "ArrowRight":e.preventDefault();skip(5);break;
        case "j":case "J":skip(-10);break;
        case "l":case "L":skip(10);break;
        case "ArrowUp":e.preventDefault();changeVolume(.05);break;
        case "ArrowDown":e.preventDefault();changeVolume(-.05);break;
        case "m":case "M":video.muted=!video.muted;showControls();break;
        case "f":case "F":toggleFullscreen();break;
        case "i":case "I":togglePip();break;
        case ",":if(video.paused){stepFrame(-1)}break;
        case ".":if(video.paused){stepFrame(1)}break;
        case "<":nudgeSpeed(-1);break;
        case ">":nudgeSpeed(1);break;
        case "Home":e.preventDefault();seekToPercent(0);break;
        case "End":e.preventDefault();seekToPercent(1);break;
        default:
          if(e.key>="0"&&e.key<="9"){e.preventDefault();seekToPercent((+e.key)/10)}
      }
    };
    document.addEventListener("keydown",onKeydown);

    updatePlayIcon();
    setSeekUi(0);
    showControls();

    return{
      setNav(hasPrev,hasNext){
        // The ⏮/⏭ transport buttons this used to enable/disable were
        // removed so the control row matches the reference design exactly
        // (it has no prev/next buttons). The host page (downloads.js) still
        // calls this after every navigation, so it stays here as a no-op
        // rather than making that call throw.
      },
      destroy(){
        document.removeEventListener("keydown",onKeydown);
        window.removeEventListener("pointerup",onWindowPointerUp,true);
        window.removeEventListener("pointercancel",onWindowPointerCancel,true);
        document.removeEventListener("visibilitychange",onVisibilityChange);
        window.removeEventListener("blur",onWindowBlur);
        video.removeEventListener("contextmenu",onContextMenu);
        container.removeEventListener("contextmenu",onContextMenu);
        container.removeEventListener("pointerdown",onPointerDown);
        container.removeEventListener("pointermove",onPointerMove);
        container.removeEventListener("pointerup",onPointerUp);
        container.removeEventListener("pointercancel",onPointerCancel);
        clearTimeout(hideTimer);clearTimeout(tapTimer);clearLongPress();
        clearTimeout(hintTimer);clearTimeout(chromeHideTimer);
        if(closeBtn)closeBtn.classList.remove("auto-hidden");
        [skipLeft,skipRight,speedBadge,centerPlay,hintEl,screenshotBtn,controls].forEach(el=>el.remove());
      },
      reset(title){
        // Call after swapping video.src for a new download, so the bar/time
        // reset immediately instead of showing the previous video's state.
        // Pass the new video's title so screenshots saved from here get a
        // matching filename instead of the previous video's.
        if(typeof title==="string")currentTitle=title;
        speedIdx=SPEEDS.indexOf(1);applySpeed();
        fillMode=false;updateFit();resetZoom();
        setSeekUi(0);timeEl.textContent="0:00 / 0:00";
        hintEl.classList.remove("show");
        updatePlayIcon();updateVolUi();showControls();
      }
    };
  }

  window.OfflinePlayer={attach};
})();
