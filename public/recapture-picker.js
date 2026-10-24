/* D Vault — "Recapture thumbnail" picker.
   Shows 15 suitable frames spread across the whole video; click one to make it the thumbnail. */
(function(){
  "use strict";
  let cur=null;
  const fmt=t=>{t=Math.max(0,Math.floor(t));const h=Math.floor(t/3600),m=Math.floor(t%3600/60),s=t%60;return (h?h+":"+String(m).padStart(2,"0"):m)+":"+String(s).padStart(2,"0")};
  function css(){
    if(document.getElementById("dvRecapStyle"))return;
    const st=document.createElement("style");st.id="dvRecapStyle";st.textContent=`
      #dvRecap{position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.72);display:flex;align-items:center;justify-content:center;padding:14px;font-family:system-ui,-apple-system,Segoe UI,sans-serif}
      #dvRecap .rc-box{width:min(900px,100%);max-height:92vh;overflow:auto;background:#181818;color:#fff;border:1px solid #2e2e2e;border-radius:16px;padding:18px;box-shadow:0 20px 60px #000a}
      #dvRecap h2{margin:0 0 4px;font-size:18px}
      #dvRecap .rc-sub{color:#aaa;font-size:13px;margin:0 0 14px;min-height:18px}
      #dvRecap .rc-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px}
      #dvRecap .rc-item{position:relative;border:2px solid transparent;border-radius:10px;overflow:hidden;background:#0d0d0d;padding:0;cursor:pointer;aspect-ratio:16/9;color:#fff}
      #dvRecap .rc-item:hover,#dvRecap .rc-item:focus-visible{border-color:#fff;outline:none}
      #dvRecap .rc-item img{width:100%;height:100%;object-fit:cover;display:block}
      #dvRecap .rc-item span{position:absolute;right:5px;bottom:5px;background:rgba(0,0,0,.78);border-radius:6px;padding:2px 6px;font-size:12px;font-variant-numeric:tabular-nums}
      #dvRecap .rc-item.wait{cursor:default;border:1px dashed #333;display:flex;align-items:center;justify-content:center;color:#555;font-size:12px}
      #dvRecap .rc-item.busy{opacity:.5;pointer-events:none}
      #dvRecap .rc-foot{display:flex;justify-content:flex-end;margin-top:14px}
      #dvRecap .rc-foot button{border:0;border-radius:10px;background:#2a2a2a;color:#fff;padding:10px 18px;font-weight:600;cursor:pointer}
      @media(max-width:700px){#dvRecap .rc-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
      @media(max-width:420px){#dvRecap .rc-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
    `;document.head.appendChild(st);
  }
  function close(){if(!cur)return;cur.abort.abort();cur.el.remove();document.removeEventListener("keydown",cur.key);cur=null}
  async function open(id,title){
    if(!window.DVaultPreview?.candidateFrames)return;
    close();css();
    const abort=new AbortController(),el=document.createElement("div");el.id="dvRecap";
    el.innerHTML=`<div class="rc-box" role="dialog" aria-modal="true"><h2>Recapture thumbnail</h2><p class="rc-sub" id="rcSub">Scanning the whole video…</p><div class="rc-grid" id="rcGrid"></div><div class="rc-foot"><button type="button" id="rcCancel">Cancel</button></div></div>`;
    document.body.appendChild(el);
    const key=e=>{if(e.key==="Escape")close()};document.addEventListener("keydown",key);
    cur={el,abort,key};
    const sub=el.querySelector("#rcSub"),grid=el.querySelector("#rcGrid");
    el.querySelector("#rcCancel").onclick=close;
    el.addEventListener("click",e=>{if(e.target===el)close()});
    const mine=cur;let shown=0,total=15;
    const frames=[];
    try{
      await DVaultPreview.candidateFrames(id,15,(fr,i,n)=>{
        if(cur!==mine)return;total=n;shown++;frames.push(fr);
        const b=document.createElement("button");b.type="button";b.className="rc-item";b.title="Use this frame";
        b.innerHTML=`<img alt="" src="${fr.dataUrl}"><span>${fmt(fr.timestamp)}</span>`;
        b.onclick=async()=>{
          grid.querySelectorAll(".rc-item").forEach(x=>x.classList.add("busy"));
          sub.textContent="Saving thumbnail…";
          try{
            if(window.DVaultMedia?.forgetThumb)DVaultMedia.forgetThumb(id);
            await DVaultPreview.setThumbnailAt(id,fr.timestamp);
            close();
            if(typeof open.onDone==="function")open.onDone(true);
          }catch(err){sub.textContent="Could not save thumbnail: "+(err.message||"unknown error");grid.querySelectorAll(".rc-item").forEach(x=>x.classList.remove("busy"))}
        };
        grid.appendChild(b);
        sub.textContent=shown<n?`Scanning… ${shown}/${n} frames`:`${n} frames across the video — pick one`;
      },abort.signal);
      if(cur===mine)sub.textContent=shown?`${shown} frames across the video — pick one`:"No suitable frames found.";
    }catch(err){if(cur===mine)sub.textContent="Could not read this video: "+(err.message||"unknown error")}
  }
  window.DVaultRecapture={open,close};
})();
