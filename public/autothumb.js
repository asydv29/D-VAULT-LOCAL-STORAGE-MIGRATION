/* D Vault automatic thumbnail facade. The actual intelligent sampler lives in local-preview.js. */
(function(){
  const cache=new Map();
  window.autoThumbnail=async function(id){
    id=String(id);
    if(cache.has(id))return cache.get(id);
    const p=(async()=>{
      if(!window.DVaultPreview)return null;
      const u=await window.DVaultPreview.ensureThumbnail(id);
      return u||("/api/videos/"+encodeURIComponent(id)+"/thumbnail");
    })();
    cache.set(id,p);try{return await p}catch{cache.delete(id);return null}
  };
})();