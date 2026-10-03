/* D Vault local orientation detector — no network media access. */
(function(){
  const attempted=new Set(),queue=[];let active=0;
  function pump(){if(active>=2||!queue.length)return;active++;const {id,resolve}=queue.shift();detect(id).then(resolve).catch(()=>resolve(null)).finally(()=>{active--;pump()});if(active<2)pump()}
  async function detect(id){
    const url=await window.DVaultMedia?.url(id);if(!url)return null;
    const v=document.createElement("video");v.muted=true;v.playsInline=true;v.preload="metadata";v.src=url;
    try{await new Promise((res,rej)=>{v.onloadedmetadata=res;v.onerror=rej;setTimeout(()=>rej(Error("timeout")),12000)});const width=v.videoWidth,height=v.videoHeight,duration=v.duration;const r=await fetch("/api/videos/"+encodeURIComponent(id)+"/orientation",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({width,height,duration})});return r.ok?r.json():null}
    finally{v.pause();v.removeAttribute("src");v.load();v.remove()}
  }
  window.detectOrientation=function(id){if(!id||attempted.has(id))return Promise.resolve(null);attempted.add(id);return new Promise(resolve=>{queue.push({id,resolve});pump()})}
})();