/* D Vault local watch progress. */
(function(){
  const S=()=>window.DVaultStorage;
  function id(){return new URLSearchParams(location.search).get("id")}
  const vid=id(); if(!vid)return;
  function save(v){const r=S().get("meta",vid);Promise.resolve(r).then(x=>{if(!x)return;x.watchProgress=Number(v.currentTime||0);x.duration=Number(v.duration||x.duration||0);x.watched=!!(x.duration&&x.watchProgress/x.duration>.9);return S().put("meta",x)}).catch(()=>{})}
  function wire(){
    const v=document.querySelector("#video");if(!v)return;
    v.addEventListener("loadedmetadata",async()=>{try{const r=await S().get("meta",vid);if(r&&r.watchProgress>8&&r.watchProgress<v.duration-10)v.currentTime=r.watchProgress}catch{}});
    let last=0;v.addEventListener("timeupdate",()=>{if(Date.now()-last<3000)return;last=Date.now();save(v)});
    v.addEventListener("pause",()=>save(v));v.addEventListener("ended",()=>save(v));
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",wire,{once:true});else wire();
})();