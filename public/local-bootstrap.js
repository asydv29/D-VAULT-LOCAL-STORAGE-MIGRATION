/* D Vault startup / folder picker UI. */
(function(){
  "use strict";
  let resolveReady; const readyPromise=new Promise(r=>resolveReady=r);
  let selected=false;
  function css(){
    if(document.getElementById("dvault-start-style"))return;
    const s=document.createElement("style");s.id="dvault-start-style";s.textContent=`
      html.dvault-selecting,html.dvault-selecting body{background:#0f0f0f!important}
      html.dvault-selecting body{visibility:hidden!important}
      #dvaultStorageGate{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:#0f0f0f;color:#fff;font-family:system-ui,-apple-system,Segoe UI,sans-serif;padding:24px}
      #dvaultStorageGate .dv-card{width:min(430px,100%);text-align:center;padding:34px 28px;border:1px solid #2a2a2a;border-radius:18px;background:#151515;box-shadow:0 20px 60px #0008}
      #dvaultStorageGate h1{font-size:30px;margin:0 0 8px;letter-spacing:.02em}
      #dvaultStorageGate p{color:#aaa;line-height:1.55;margin:0 0 22px}
      #dvaultStorageGate button{width:100%;border:0;border-radius:11px;background:#fff;color:#111;font-weight:750;padding:14px 18px;cursor:pointer}
      #dvaultStorageGate button:disabled{opacity:.55;cursor:wait}
      #dvaultStorageGate .dv-status{min-height:20px;color:#aaa;font-size:13px;margin-top:14px}
      #dvaultStorageGate .dv-error{color:#ff9f9f}
      .dvault-storage-card{padding:18px;border-radius:14px;background:#171717;border:1px solid #2b2b2b;margin:16px 0}
    `;document.head.appendChild(s);
  }
  // The gate is mounted on <html>, NOT <body>. Pages such as watch.js replace
  // document.body.innerHTML on error/offline; a gate living inside <body> got
  // wiped by that while "dvault-selecting" kept the page hidden -> permanent
  // black screen with no way out.
  function gate(resumeName){
    css();document.documentElement.classList.add("dvault-selecting");
    let g=document.getElementById("dvaultStorageGate");if(g)return g;
    g=document.createElement("div");g.id="dvaultStorageGate";
    const esc=t=>String(t).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
    g.innerHTML=`<div class="dv-card"><h1>D Vault</h1><p>Your Local Media Vault</p>${resumeName?`<button id="dvResume">Continue with “${esc(resumeName)}”</button><div style="height:10px"></div><button id="dvChoose" style="background:#2a2a2a;color:#fff">Choose a different folder</button>`:`<button id="dvChoose">Choose Storage Folder</button>`}<div class="dv-status" id="dvStorageStatus">${resumeName?"Tap anywhere to continue — your folder is already saved.":"Select the folder that contains your media."}</div></div>`;
    document.documentElement.appendChild(g);
    g.querySelector("#dvChoose").onclick=choose;
    const r=g.querySelector("#dvResume");if(r){r.onclick=resume;g.addEventListener("click",e=>{if(!e.target.closest("#dvChoose")&&!e.target.closest("#dvResume"))resume()})}
    return g;
  }
  function finish(){
    selected=true;document.documentElement.classList.remove("dvault-selecting");
    document.getElementById("dvaultStorageGate")?.remove();resolveReady(true);
  }
  // Runs inside a tap, so requestPermission() is allowed to show its prompt.
  async function resume(){
    const b=document.getElementById("dvResume"),st=document.getElementById("dvStorageStatus");if(!b)return;
    b.disabled=true;st.className="dv-status";st.textContent="Requesting storage permission…";
    try{
      await window.DVaultStorage.ensurePermission();
      st.textContent="Opening D Vault…";
      const have=(await window.DVaultStorage.allKeys("meta")).length>0;
      if(!have&&!SKIP_SCAN())await window.DVaultAPI.scan();
      finish();
      if(have&&!SKIP_SCAN())window.DVaultAPI.scan().catch(()=>{});
    }catch(e){st.textContent=e.message||"Unable to access this folder.";st.className="dv-status dv-error";b.disabled=false}
  }
  // The watch page only needs metadata that a previous scan already stored;
  // re-walking the whole folder before every video start just delays playback.
  function SKIP_SCAN(){return /\/watch\.html$/.test(location.pathname)}
  async function choose(){
    const b=document.getElementById("dvChoose"),st=document.getElementById("dvStorageStatus");if(!b)return;
    b.disabled=true;st.className="dv-status";st.textContent="Requesting storage permission…";
    try{
      await window.DVaultStorage.selectFolder();
      st.textContent="Scanning local media…";
      await window.DVaultAPI.scan();
      st.textContent="Opening D Vault…";finish();
    }catch(e){st.textContent=e.message||"Unable to access this folder.";st.className="dv-status dv-error";b.disabled=false}
  }
  async function init(){
    try{navigator.storage?.persist?.()}catch{}
    try{
      const a=await window.DVaultStorage.getActive();
      if(a){
        try{
          // Without a user gesture requestPermission() just throws, so only
          // query here; if access has lapsed, show a one-tap "Continue" gate.
          let ok=true;
          if(a.kind==="browser"&&a.handle?.queryPermission)ok=(await a.handle.queryPermission({mode:"readwrite"}))==="granted";
          if(ok){
            await window.DVaultStorage.ensurePermission();
            const have=(await window.DVaultStorage.allKeys("meta")).length>0;
            // Library already indexed: open instantly, refresh the index in the background.
            if(!have)await window.DVaultAPI.scan();
            finish();
            if(have&&!SKIP_SCAN()){const bg=()=>window.DVaultAPI.scan().catch(()=>{});window.requestIdleCallback?requestIdleCallback(bg,{timeout:3000}):setTimeout(bg,800)}
            return;
          }
        }catch{}
        gate(a.name||"your media folder");return;
      }
      gate();
    }catch{gate()}
  }
  window.DVaultBootstrap={ready:()=>readyPromise,choose,init,active:()=>window.DVaultStorage.getActive()};
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init();
})();