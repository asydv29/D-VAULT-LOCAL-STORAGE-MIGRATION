/* D Vault — browser-local API compatibility layer.
   Keeps the existing DPlayer UI calling /api/* while all media/metadata stay local. */
(function(){
  "use strict";
  const S=window.DVaultStorage, P=window.DVaultPreview;
  const origFetch=window.fetch.bind(window);
  const VIDEO=/\.(mp4|webm|mkv|mov|m4v|avi|ts|mts|m2ts)$/i, IMAGE=/\.(jpe?g|png|webp|gif)$/i;
  const json=(d,status=200)=>new Response(JSON.stringify(d),{status,headers:{"content-type":"application/json; charset=utf-8"}});
  const err=(msg,status=400)=>json({error:msg},status);
  const uid=()=>crypto.randomUUID();
  const escPath=x=>decodeURIComponent(x);
  const extMime=n=>({mp4:"video/mp4",webm:"video/webm",mkv:"video/x-matroska",mov:"video/quicktime",m4v:"video/mp4",avi:"video/x-msvideo",ts:"video/mp2t",mts:"video/mp2t",m2ts:"video/mp2t",jpg:"image/jpeg",jpeg:"image/jpeg",png:"image/png",webp:"image/webp",gif:"image/gif"})[(String(n).match(/\.([^.]+)$/)||[])[1]?.toLowerCase()]||"application/octet-stream";
  async function sha(s){const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s));return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("").slice(0,32)}
  async function fingerprint(x){
    const core=[x.size||0,x.lastModified||0,x.name||"",x.relativePath||x.path||""].join("|");
    return sha(core);
  }
  function activeReady(){return S.getActive().then(x=>!!x)}
  let scanning=null;
  function scan(){return scanning||(scanning=scanOnce().finally(()=>{scanning=null}))}
  async function scanOnce(){
    const active=await S.ensurePermission();if(!active)throw Object.assign(new Error("Storage permission required."),{code:"NO_STORAGE"});
    const files=await S.listFiles(), old=await S.all("meta"), oldByCore=new Map(), oldById=new Map();
    const coreOf=(size,lm,name)=>size+"|"+lm+"|"+name;
    old.forEach(r=>{oldById.set(r.id,r);if(r.type==="video"||r.type==="image"){const k=coreOf(r.fileSize||0,r.lastModified||0,r.filename||"");if(!oldByCore.has(k))oldByCore.set(k,r)}});
    const entries=[];
    for(const f of files){
      const name=f.name||String(f.relativePath||f.path||"").split("/").pop()||"file";
      if(!VIDEO.test(name)&&!IMAGE.test(name))continue;
      entries.push({f,name,type:VIDEO.test(name)?"video":"image",size:Number(f.size)||0,lm:Number(f.lastModified)||0,rel:String(f.relativePath||f.path||name)});
    }
    // Only records whose file vanished/changed can be "moved" files; comparing
    // new files against every old record was O(n^2) with an await each.
    const liveCores=new Set(entries.map(e=>coreOf(e.size,e.lm,e.name)));
    const orphans=old.filter(r=>r.fileHandle&&(r.type==="video"||r.type==="image")&&!liveCores.has(coreOf(r.fileSize||0,r.lastModified||0,r.filename||"")));
    const seen=new Set(), out=[], dirty=[], toQueue=[];
    for(const e of entries){
      const {f,name,type,size,lm,rel}=e, core=coreOf(size,lm,name);
      let id=oldByCore.get(core)?.id;
      if(!id&&f.fileHandle&&orphans.length){for(const prev of orphans){if(prev.type===type&&!seen.has(prev.id)){try{if(await f.fileHandle.isSameEntry(prev.fileHandle)){id=prev.id;break}}catch{}}}}
      if(!id)id=await fingerprint({size,lastModified:lm,name,relativePath:rel});
      const previous=oldById.get(id)||oldByCore.get(core)||{};
      const isNew=!oldById.has(id);
      const changed=Number(previous.fileSize)!==size||Number(previous.lastModified)!==lm||previous.relativePath!==rel;
      const verStale=type==="video"&&Number(previous.previewVersion||0)!==Number(P?.VERSION||2);
      if(!isNew&&!changed&&!verStale){seen.add(id);out.push(previous);if(type==="video"&&P&&(!previous.sprite||!previous.thumbnail))toQueue.push(id);continue}
      const r={...previous,key:id,id,type,filename:name,title:name.replace(/\.[^.]+$/,""),relativePath:rel,path:rel,fileSize:size,size,mimeType:f.mimeType||extMime(name),lastModified:lm,folder:rel.includes("/")?rel.slice(0,rel.lastIndexOf("/")):"",native:!!f.native,url:f.url||null,token:f.token||null,fileHandle:f.fileHandle||null,createdTime:previous.createdTime||new Date(lm||Date.now()).toISOString(),views:Number(previous.views||0),liked:!!previous.liked,favorite:!!previous.favorite,watchLater:!!previous.watchLater,isShort:!!previous.isShort,watchProgress:Number(previous.watchProgress||0),previewVersion:P?.VERSION||2};
      if(type==="video"&&(changed||verStale)){r.thumbnail=null;r.sprite=null;r.previewStatus="queued";r.previewVersion=P?.VERSION||2}
      if(type==="image"){r.thumbnail="/api/photos/"+encodeURIComponent(id)+"/thumbnail";r.url="/api/photos/"+encodeURIComponent(id)+"/stream"}
      dirty.push(r);seen.add(id);out.push(r);if(type==="video"&&P)toQueue.push(id);
    }
    await S.putMany("meta",dirty);
    const gone=old.filter(r=>(r.type==="video"||r.type==="image")&&!seen.has(r.id)).map(r=>r.id);
    await S.delMany("meta",gone);
    if(P)toQueue.forEach((id,i)=>P.enqueue(id,i<20?1:10));
    const changedLib=dirty.length>0||gone.length>0;
    if(changedLib)try{window.dispatchEvent(new CustomEvent("dvault:library-changed",{detail:{added:dirty.length,removed:gone.length}}))}catch{}
    return out;
  }
  async function records(){let a=await S.all("meta");return a.filter(x=>x.type==="video"||x.type==="image")}
  const mediaUrls=new Map();
  async function mediaUrl(id){
    id=String(id);if(mediaUrls.has(id))return mediaUrls.get(id);
    const r=await getRec(id);if(!r)return null;
    if(r.native&&r.url){mediaUrls.set(id,r.url);return r.url}
    const f=await blobFor(r),u=URL.createObjectURL(f);mediaUrls.set(id,u);return u;
  }
  async function thumbnailUrl(id){
    const k=id+":thumburl";if(mediaUrls.has(k))return mediaUrls.get(k);
    const a=await S.get("assets",id+":thumbnail:"+(P?.VERSION||2));
    if(a){const u=URL.createObjectURL(a.blob);mediaUrls.set(k,u);return u}
    return null;
  }
  async function videoList(q){
    let vs=(await records()).filter(x=>x.type==="video");
    if(q?.get("folder"))vs=vs.filter(x=>x.folder===q.get("folder")||x.relativePath.startsWith(q.get("folder")+"/"));
    if(q?.get("list")==="liked")vs=vs.filter(x=>x.liked);
    if(q?.get("list")==="favorites")vs=vs.filter(x=>x.favorite);
    if(q?.get("list")==="watchlater")vs=vs.filter(x=>x.watchLater);
    if(q?.get("view")==="history"){const h=new Set(localHistory());vs=vs.filter(x=>x.watchProgress>0||h.has(x.id))}
    // One key listing + one batched read instead of two IndexedDB round trips per video.
    const V=P?.VERSION||2, keys=new Set(await S.allKeys("assets"));
    const need=vs.filter(r=>keys.has(r.id+":thumbnail:"+V)&&!mediaUrls.has(r.id+":thumburl"));
    if(need.length){const blobs=await S.getMany("assets",need.map(r=>r.id+":thumbnail:"+V));need.forEach((r,i)=>{const a=blobs[i];if(a?.blob)mediaUrls.set(r.id+":thumburl",URL.createObjectURL(a.blob))})}
    const placeholder="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22640%22 height=%22360%22%3E%3Crect width=%22100%25%22 height=%22100%25%22 fill=%22%23222222%22/%3E%3C/svg%3E";
    return vs.map(r=>{
      if(P){const ready=keys.has(r.id+":sprite:"+V);r.preview=r.preview||{};r.preview.ready=ready;r.preview.hover="/api/videos/"+encodeURIComponent(r.id)+"/stream";r.preview.hoverRev=r.preview.hover;r.preview.sprite=ready?"/api/previews/"+encodeURIComponent(r.id)+"/sprite":null}
      const tu=mediaUrls.get(r.id+":thumburl")||null;
      const effectiveShort=!!r.isShort || (!!r.width&&!!r.height&&Number(r.height)>Number(r.width));
      return {...r,id:r.id,title:r.title,thumbnail:tu||r.thumbnail||placeholder,duration:r.duration?fmtDur(r.duration):"",size:r.fileSize,mimeType:r.mimeType,createdTime:r.createdTime,views:r.views,liked:r.liked,favorite:r.favorite,watchLater:r.watchLater,isShort:effectiveShort,quality:quality(r.width,r.height),orientationKnown:!!(r.width&&r.height)}
    });
  }
  function fmtDur(s){s=Math.floor(Number(s)||0);const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sec=s%60;return h?h+":"+String(m).padStart(2,"0")+":"+String(sec).padStart(2,"0"):m+":"+String(sec).padStart(2,"0")}
  function quality(w,h){h=Number(h)||0;return h>=2160?"4K":h>=1440?"1440p":h>=1080?"1080p":h>=720?"720p":h>=480?"480p":h>=360?"360p":h?"SD":""}
  function localHistory(){try{return JSON.parse(localStorage.getItem("dvault_history")||"[]")}catch{return[]}}
  function addHistory(id){const a=localHistory().filter(x=>x!==id);a.unshift(id);localStorage.setItem("dvault_history",JSON.stringify(a.slice(0,200)))}
  async function getRec(id){return S.get("meta",id)}
  async function blobFor(r){return S.fileFor(r)}
  async function responseForFile(r,req){
    if(r.native&&r.url){
      const rr=await origFetch(r.url,{headers:req.headers});return rr;
    }
    const file=await blobFor(r), total=file.size;
    const range=req.headers.get("Range"), headers={"content-type":r.mimeType||file.type||extMime(r.filename),"accept-ranges":"bytes","cache-control":"no-store","content-length":String(total)};
    if(!range)return new Response(file,{status:200,headers});
    const m=/bytes=(\d*)-(\d*)/.exec(range);if(!m)return new Response(file,{status:200,headers});
    let start=m[1]?Number(m[1]):Math.max(0,total-Number(m[2]||"0"));let end=m[2]?Number(m[2]):total-1;
    start=Math.max(0,Math.min(start,total-1));end=Math.max(start,Math.min(end,total-1));
    const part=file.slice(start,end+1,file.type||r.mimeType);
    headers["content-length"]=String(part.size);headers["content-range"]=`bytes ${start}-${end}/${total}`;
    return new Response(part,{status:206,headers});
  }
  async function thumbResponse(id,photo=false){
    const r=await getRec(id);if(!r)return err("File not found",404);
    const version=P?.VERSION||2;
    let asset=await S.get("assets",id+":thumbnail:"+version);
    if(!asset&&r.type==="video"&&P){
      await P.ensureThumbnail(id);
      asset=await S.get("assets",id+":thumbnail:"+version);
    }

    // Photos are image files, not video frames. The previous fallback tried
    // to load a JPG/PNG/WebP/GIF into <video>, which fails on mobile browsers
    // and caused the broken-image/🖼 placeholder shown in the Photos grid.
    // Decode the actual image and cache a small WebP thumbnail instead.
    if(!asset&&r.type==="image"){
      let objectUrl=null;
      try{
        const file=await blobFor(r);
        objectUrl=URL.createObjectURL(file);
        const img=await new Promise((resolve,reject)=>{
          const i=new Image();
          i.onload=()=>resolve(i);
          i.onerror=()=>reject(new Error("Image could not be decoded"));
          i.src=objectUrl;
        });
        const max=640,iw=img.naturalWidth||img.width||1,ih=img.naturalHeight||img.height||1;
        const scale=Math.min(1,max/Math.max(iw,ih));
        const w=Math.max(1,Math.round(iw*scale)),h=Math.max(1,Math.round(ih*scale));
        const c=document.createElement("canvas");c.width=w;c.height=h;
        const ctx=c.getContext("2d",{alpha:false});
        ctx.drawImage(img,0,0,w,h);
        const blob=await new Promise(resolve=>c.toBlob(resolve,"image/webp",.82));
        if(blob){
          asset={key:id+":thumbnail:"+version,type:"thumbnail",id,blob,version};
          await S.put("assets",asset);
        }
      }catch{}
      finally{if(objectUrl)URL.revokeObjectURL(objectUrl)}
    }

    if(!asset){
      // Video fallback: capture a frame directly from the local video.
      if(r.type!=="video")return err("Thumbnail unavailable",404);
      let objectUrl=null;
      try{
        const file=await blobFor(r);objectUrl=URL.createObjectURL(file);
        const c=document.createElement("canvas"),v=document.createElement("video");
        v.muted=true;v.playsInline=true;v.preload="metadata";v.src=objectUrl;
        await new Promise((res,rej)=>{v.onloadedmetadata=res;v.onerror=()=>rej(new Error("Video metadata unavailable"))});
        v.currentTime=Math.min(3,Math.max(0,v.duration/3||0));
        await new Promise((res,rej)=>{v.onseeked=res;v.onerror=()=>rej(new Error("Video seek failed"))});
        c.width=320;c.height=Math.max(1,Math.round(320*(v.videoHeight/v.videoWidth||.5625)));
        c.getContext("2d").drawImage(v,0,0,c.width,c.height);
        const blob=await new Promise(res=>c.toBlob(res,"image/webp",.8));
        if(blob)return new Response(blob,{headers:{"content-type":"image/webp","cache-control":"no-store"}});
      }catch{}
      finally{if(objectUrl)URL.revokeObjectURL(objectUrl)}
      return err("Thumbnail unavailable",404);
    }
    return new Response(asset.blob,{headers:{"content-type":asset.blob.type||"image/webp","cache-control":"no-store"}});
  }
  async function spriteResponse(id){
    const a=await S.get("assets",id+":sprite:"+(P?.VERSION||2));if(!a&&P){await P.ensureSprite(id);return spriteResponse(id)}
    if(!a)return err("Preview not ready",404);return new Response(a.blob,{headers:{"content-type":"image/webp","cache-control":"no-store"}});
  }
  async function metadataResponse(id){
    const r=await getRec(id);if(!r)return err("Video not found",404);
    if(P&&!(await S.get("assets",id+":sprite:"+P.VERSION)))P.enqueue(id,8);
    const s=r.sprite||null; if(s)return json(s);
    const a=await S.get("assets",id+":sprite:"+(P?.VERSION||2));
    return a?json(r.sprite||{ready:true,frameCount:60,frameWidth:160,frameHeight:90,columns:10,intervalSeconds:(r.duration||600)/60,version:P?.VERSION||2}):err("Preview not ready",404);
  }
  async function toggle(id,field){const r=await getRec(id);if(!r)return err("Video not found",404);r[field]=!r[field];await S.put("meta",r);return json({active:r[field]})}
  async function route(req){
    const u=new URL(req.url),p=u.pathname;
    if(!p.startsWith("/api/"))return null;
    if(p==="/api/me")return json({email:"local@dvault",name:"Local user"});
    if(p==="/api/videos"&&req.method==="GET"){let q=u.searchParams;let vs=await videoList(q);if(!vs.length&&!q.get("folder")&&!q.get("view")&&!q.get("list")){try{await scan();vs=await videoList(q)}catch{}}return json(vs)}
    if(p==="/api/folders"&&req.method==="GET"){
      // Folders are derived from the selected local directory tree, not from
      // the old server/D1 folder endpoint.  The sidebar can race the initial
      // local scan, so make this endpoint self-initializing when metadata is
      // empty.  Also include every ancestor directory so nested folders are
      // rendered correctly (e.g. Movies/Action/2026).
      let rs=await records();
      if(!rs.length){try{await scan();rs=await records()}catch{}}
      const set=new Map();
      for(const r of rs){
        if(r.type!=="video"&&r.type!=="image")continue;
        const rel=String(r.relativePath||r.path||"").replace(/^\/+|\/+$|/g,"");
        const parts=rel.split("/").filter(Boolean);
        if(parts.length<2)continue;
        let path="";
        for(let i=0;i<parts.length-1;i++){
          path=path?path+"/"+parts[i]:parts[i];
          const cur=set.get(path)||{count:0};
          cur.count++;
          set.set(path,cur);
        }
      }
      const out=[...set.entries()].map(([id,v])=>({
        id,
        name:id.split("/").pop(),
        count:v.count,
        path:id,
        parentId:id.includes("/")?id.slice(0,id.lastIndexOf("/")):null
      }));
      out.sort((a,b)=>a.path.localeCompare(b.path));
      return json(out);
    }
    if(p==="/api/photos"&&req.method==="GET"){let ps=(await records()).filter(x=>x.type==="image");if(!ps.length){try{await scan();ps=(await records()).filter(x=>x.type==="image")}catch{}}return json(await Promise.all(ps.map(async r=>({id:r.id,title:r.title,name:r.filename,isVideo:false,liked:r.liked,thumb:(await thumbnailUrl(r.id))||"/api/photos/"+encodeURIComponent(r.id)+"/thumbnail",url:await mediaUrl(r.id)}))))}
    if(p==="/api/liked"||p==="/api/favorites"||p==="/api/watch-later"){const q=new URLSearchParams();q.set("list",p.includes("liked")?"liked":p.includes("favorites")?"favorites":"watchlater");return json(await videoList(q))}
    if(p==="/api/playlists"&&req.method==="GET"){const pls=await S.all("settings");const arr=pls.filter(x=>x.key.startsWith("playlist:")).map(x=>x.value);const vid=u.searchParams.get("videoId");return json(arr.map(pl=>({...pl,count:pl.videoIds?.length||0,inPlaylist:vid?pl.videoIds?.includes(vid):false})))}
    if(p==="/api/playlists"&&req.method==="POST"){const b=await req.json();const pl={id:uid(),name:String(b.name||"Untitled").slice(0,200),videoIds:[]};await S.put("settings",{key:"playlist:"+pl.id,value:pl});return json(pl)}
    let m=p.match(/^\/api\/playlists\/([^/]+)\/videos(?:\/([^/]+))?$/);if(m){const pl=await S.get("settings","playlist:"+decodeURIComponent(m[1]));if(!pl?.value)return err("Playlist not found",404);const v=pl.value,vid=decodeURIComponent(m[2]||"");if(req.method==="POST"){const b=await req.json();if(!v.videoIds.includes(b.videoId))v.videoIds.push(b.videoId)}else if(req.method==="DELETE"){v.videoIds=v.videoIds.filter(x=>x!==vid)}await S.put("settings",{key:"playlist:"+v.id,value:v});return json({ok:true})}
    m=p.match(/^\/api\/playlists\/([^/]+)$/);if(m){const key="playlist:"+decodeURIComponent(m[1]),rec=await S.get("settings",key);if(!rec)return err("Playlist not found",404);if(req.method==="DELETE"){await S.del("settings",key);return json({ok:true})}if(req.method==="POST"){const b=await req.json();rec.value.name=String(b.name||rec.value.name);await S.put("settings",rec);return json(rec.value)}}
    m=p.match(/^\/api\/videos\/([^/]+)\/(like|favorite|watchlater|view|stream|thumbnail|delete|short|orientation|rename)$/);
    if(m){const id=decodeURIComponent(m[1]),act=m[2],r=await getRec(id);if(!r)return err("Video not found",404);
      if(act==="like")return toggle(id,"liked");
      if(act==="favorite")return toggle(id,"favorite");
      if(act==="watchlater")return toggle(id,"watchLater");
      if(act==="view"&&req.method==="POST"){r.views=(r.views||0)+1;addHistory(id);await S.put("meta",r);return json({ok:true})}
      if(act==="short"&&req.method==="POST"){const b=await req.json();r.isShort=!!b.short;await S.put("meta",r);return json({isShort:r.isShort})}
      if(act==="rename"&&req.method==="POST"){const b=await req.json();const oldName=r.filename;const name=String(b.name||"").trim();if(!name)return err("A video name is required");const ext=(oldName.match(/(\.[^.]+)$/)||[])[1]||"";const finalName=name.toLowerCase().endsWith(ext.toLowerCase())?name:name+ext;await S.renameFile(r,finalName);r.filename=finalName;r.title=finalName.replace(/\.[^.]+$/,"");r.relativePath=r.relativePath.replace(/[^/]+$/,finalName);r.path=r.relativePath;r.thumbnail=null;r.sprite=null;r.previewStatus="queued";await S.put("meta",r);mediaUrls.delete(id+":thumburl");if(P)P.invalidate(id);return json({ok:true,id,name:r.title})}
      if(act==="delete"&&(req.method==="DELETE"||req.method==="POST")){await S.deleteFile(r);await S.del("meta",id);for(const k of ["thumbnail","sprite"])await S.del("assets",id+":"+k+":"+(P?.VERSION||2)).catch(()=>{});return json({ok:true})}
      if(act==="orientation"&&req.method==="POST"){const b=await req.json().catch(()=>({}));r.width=Number(b.width)||r.width;r.height=Number(b.height)||r.height;r.duration=Number(b.duration)||r.duration;r.isShort=r.height>r.width;await S.put("meta",r);return json({isPortrait:r.isShort,isShort:r.isShort,duration:fmtDur(r.duration),quality:quality(r.width,r.height),orientationKnown:!!(r.width&&r.height)})}
      if(act==="thumbnail"&&req.method==="POST"){const blob=await req.blob();await S.put("assets",{key:id+":thumbnail:"+(P?.VERSION||2),type:"thumbnail",id,blob,version:P?.VERSION||2});mediaUrls.delete(id+":thumburl");r.thumbnail="/api/videos/"+encodeURIComponent(id)+"/thumbnail?v="+Date.now();r.thumbnailTimestamp=null;r.previewVersion=P?.VERSION||2;await S.put("meta",r);return json({ok:true})}
      if(act==="thumbnail")return thumbResponse(id);
      if(act==="stream")return responseForFile(r,req);
    }
    m=p.match(/^\/api\/photos\/([^/]+)\/(thumbnail|stream)$/);if(m){const r=await getRec(decodeURIComponent(m[1]));if(!r)return err("Photo not found",404);if(m[2]==="stream")return responseForFile(r,req);return thumbResponse(r.id,true)}
    m=p.match(/^\/api\/previews\/([^/]+)\/(thumbnail|hover|hoverrev|sprite|metadata)$/);if(m){const id=decodeURIComponent(m[1]);if(m[2]==="sprite")return spriteResponse(id);if(m[2]==="metadata")return metadataResponse(id);if(m[2]==="thumbnail")return thumbResponse(id)}
    return err("Not found",404);
  }
  window.fetch=async function(input,init){
    const req=input instanceof Request?input:new Request(input,init);
    if(new URL(req.url,location.href).pathname.startsWith("/api/")){
      try{const r=await route(req);if(r)return r}catch(e){return err(e.message||"Local storage error",500)}
    }
    return origFetch(input,init);
  };
  window.DVaultAPI={scan,records,origFetch}; window.DVaultMedia={url:mediaUrl,thumbnailUrl};
})();