/* D Vault — local storage manager
 * Browser: File System Access API + persistent IndexedDB directory handle.
 * Android WebView: optional window.DVaultAndroid bridge (Storage Access Framework).
 * No uploads, filesystem paths, account authentication, or remote media are used.
 */
(function(){
  "use strict";
  const DB="dvault-local", VER=1;
  const STORES=["handles","meta","assets","settings"];
  let dbp=null;
  function db(){
    if(dbp)return dbp;
    dbp=new Promise((resolve,reject)=>{
      const r=indexedDB.open(DB,VER);
      r.onupgradeneeded=()=>{
        const d=r.result;
        STORES.forEach(s=>{if(!d.objectStoreNames.contains(s))d.createObjectStore(s,{keyPath:"key"})});
      };
      r.onsuccess=()=>resolve(r.result); r.onerror=()=>reject(r.error);
    }); return dbp;
  }
  async function tx(store,mode,fn){
    const d=await db();
    return new Promise((resolve,reject)=>{
      const t=d.transaction(store,mode), s=t.objectStore(store);
      let out;
      try{out=fn(s)}catch(e){reject(e);return}
      t.oncomplete=()=>resolve(out);
      t.onerror=()=>reject(t.error||new Error("IndexedDB error"));
    });
  }
  async function put(store,value){return tx(store,"readwrite",s=>s.put(value))}
  async function get(store,key){const d=await db();return new Promise((res,rej)=>{const r=d.transaction(store).objectStore(store).get(key);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
  async function del(store,key){return tx(store,"readwrite",s=>s.delete(key))}
  async function all(store){const d=await db();return new Promise((res,rej)=>{const r=d.transaction(store).objectStore(store).getAll();r.onsuccess=()=>res(r.result||[]);r.onerror=()=>rej(r.error)})}

  // Batch helpers: one transaction for many reads/writes instead of one each.
  async function putMany(store,values){if(!values.length)return;return tx(store,"readwrite",s=>{for(const v of values)s.put(v)})}
  async function allKeys(store){const d=await db();return new Promise((res,rej)=>{const r=d.transaction(store).objectStore(store).getAllKeys();r.onsuccess=()=>res(r.result||[]);r.onerror=()=>rej(r.error)})}
  async function getMany(store,keys){const d=await db();return new Promise((res,rej)=>{const t=d.transaction(store),s=t.objectStore(store),out=new Array(keys.length);keys.forEach((k,i)=>{s.get(k).onsuccess=e=>{out[i]=e.target.result}});t.oncomplete=()=>res(out);t.onerror=()=>rej(t.error)})}
  async function delMany(store,keys){if(!keys.length)return;return tx(store,"readwrite",s=>{for(const k of keys)s.delete(k)})}

  const KEY="root";
  async function getRoot(){return (await get("handles",KEY))?.handle||null}
  async function setRoot(handle,name){
    try{navigator.storage?.persist?.()}catch{}
    await put("handles",{key:KEY,handle,name:name||handle?.name||"Selected folder",updatedAt:Date.now()});
    await put("settings",{key:"active",name:name||handle?.name||"Selected folder",selectedAt:Date.now()});
  }
  async function verifyHandle(handle){
    if(!handle)return false;
    try{
      const p=handle.queryPermission?await handle.queryPermission({mode:"readwrite"}):"granted";
      return p==="granted";
    }catch{return false}
  }
  async function requestPermission(handle){
    if(!handle)return false;
    try{
      if(handle.requestPermission){
        const p=await handle.requestPermission({mode:"readwrite"});
        return p==="granted";
      }
      return true;
    }catch{return false}
  }

  async function pickBrowserFolder(){
    if(!window.showDirectoryPicker)throw Object.assign(new Error("Local folder access is not supported in this browser."),{code:"UNSUPPORTED"});
    const h=await window.showDirectoryPicker({mode:"readwrite"});
    const ok=await requestPermission(h);
    if(!ok)throw Object.assign(new Error("Storage permission was not granted."),{code:"DENIED"});
    await setRoot(h,h.name);
    return h;
  }

  /* Native Android bridge contract:
     pickFolder() -> string/token or object {token,name}
     listFiles(token) -> [{path,name,size,lastModified,mimeType,isDirectory}]
     readFile(token,path) -> base64 string OR {base64,mimeType,name,size,lastModified}
     write/rename/delete/createFolder are optional and only used when supplied.
     Native code must implement these using Android Storage Access Framework.
  */
  async function pickAndroidFolder(){
    const a=window.DVaultAndroid;
    if(!a||typeof a.pickFolder!=="function")throw Object.assign(new Error("Local folder access is not supported in this browser. Please use a supported browser or the D Vault Android application."),{code:"UNSUPPORTED"});
    const raw=await Promise.resolve(a.pickFolder());
    const info=typeof raw==="string"?{token:raw,name:"Selected storage"}:(raw||{});
    if(!info.token)throw new Error("Unable to access this folder.");
    await put("settings",{key:"androidRoot",token:info.token,name:info.name||"Selected storage",selectedAt:Date.now(),native:true});
    return {native:true,token:info.token,name:info.name||"Selected storage"};
  }

  async function selectFolder(){
    if(window.DVaultAndroid&&typeof window.DVaultAndroid.pickFolder==="function")return pickAndroidFolder();
    return pickBrowserFolder();
  }

  async function getActive(){
    const h=await getRoot();
    if(h)return {kind:"browser",handle:h,name:h.name};
    const n=await get("settings","androidRoot");
    if(n?.native)return {kind:"android",token:n.token,name:n.name};
    return null;
  }

  async function ensurePermission(){
    const root=await getRoot();
    if(root){
      const ok=await requestPermission(root);
      if(!ok)throw Object.assign(new Error("Storage permission required."),{code:"DENIED"});
      return {kind:"browser",handle:root,name:root.name};
    }
    const n=await get("settings","androidRoot");
    if(n?.native)return {kind:"android",token:n.token,name:n.name};
    return null;
  }

  async function *walkBrowser(dir,prefix=""){
    for await(const [name,entry] of dir.entries()){
      const rel=prefix?prefix+"/"+name:name;
      if(entry.kind==="directory")yield* walkBrowser(entry,rel);
      else yield {fileHandle:entry,name,relativePath:rel};
    }
  }

  async function listFiles(){
    const active=await ensurePermission();
    if(!active) return [];
    if(active.kind==="android"){
      const a=window.DVaultAndroid;
      if(typeof a.listFiles!=="function")throw new Error("Android storage bridge is missing listFiles().");
      const out=await Promise.resolve(a.listFiles(active.token));
      return Array.isArray(out)?out.map(x=>({...x,native:true,token:active.token})):[]; 
    }
    const out=[];
    for await(const x of walkBrowser(active.handle))out.push(x);
    return out;
  }

  async function fileFor(record){
    if(record?.native){
      const a=window.DVaultAndroid;
      if(typeof a.readFile!=="function")throw new Error("Android storage bridge is missing readFile().");
      const raw=await Promise.resolve(a.readFile(record.token,record.relativePath||record.path));
      if(typeof raw==="string"){
        const bin=atob(raw), u=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);
        return new File([u],record.name||record.relativePath.split("/").pop(),{type:record.mimeType||"application/octet-stream",lastModified:Number(record.lastModified)||Date.now()});
      }
      const bin=atob(raw.base64||"");const u=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);
      return new File([u],raw.name||record.name||"file",{type:raw.mimeType||record.mimeType||"application/octet-stream",lastModified:Number(raw.lastModified||record.lastModified)||Date.now()});
    }
    const active=await ensurePermission();
    if(!active||!active.handle)throw new Error("Storage folder is not selected.");
    let dir=active.handle;
    const parts=String(record.relativePath||"").split("/").filter(Boolean);
    for(let i=0;i<parts.length-1;i++)dir=await dir.getDirectoryHandle(parts[i]);
    return dir.getFileHandle(parts[parts.length-1]).then(h=>h.getFile());
  }

  async function fileHandleFor(record){
    const active=await ensurePermission();
    if(!active||active.kind!=="browser")return null;
    const parts=String(record.relativePath||"").split("/").filter(Boolean);
    let dir=active.handle;
    for(let i=0;i<parts.length-1;i++)dir=await dir.getDirectoryHandle(parts[i]);
    return dir.getFileHandle(parts[parts.length-1]);
  }

  async function renameFile(record,newName){
    newName=String(newName||"").trim();
    if(!newName)throw new Error("A file name is required.");
    const active=await ensurePermission();
    if(active.kind==="android"){
      if(typeof window.DVaultAndroid.renameFile!=="function")throw new Error("Android rename is not available.");
      await Promise.resolve(window.DVaultAndroid.renameFile(active.token,record.relativePath,newName));
      return;
    }
    const fh=await fileHandleFor(record);
    if(!fh)throw new Error("Local file is not accessible.");
    const file=await fh.getFile();
    const parts=String(record.relativePath||"").split("/").filter(Boolean);
    const oldBase=parts.pop();
    let dir=active.handle;
    for(const p of parts)dir=await dir.getDirectoryHandle(p);
    // FileSystemFileHandle.move() is not consistently supported on Android/Chrome
    // and can throw "The object can not be modified in this way.". Use the
    // standards-compatible copy-then-delete operation instead.
    if(oldBase===newName)return;
    const target=await dir.getFileHandle(newName,{create:true});
    const w=await target.createWritable();
    try{
      await w.write(file);
      await w.close();
    }catch(e){
      try{await w.abort?.()}catch{}
      throw e;
    }
    // Only remove the original after the new file has been written successfully.
    await dir.removeEntry(oldBase);
  }

  async function deleteFile(record){
    const active=await ensurePermission();
    if(active.kind==="android"){
      if(typeof window.DVaultAndroid.deleteFile!=="function")throw new Error("Android delete is not available.");
      await Promise.resolve(window.DVaultAndroid.deleteFile(active.token,record.relativePath));return;
    }
    const parts=record.relativePath.split("/").filter(Boolean);let dir=active.handle;
    for(let i=0;i<parts.length-1;i++)dir=await dir.getDirectoryHandle(parts[i]);
    await dir.removeEntry(parts[parts.length-1]);
  }

  async function getFile(record){return fileFor(record)}
  async function getFileUrl(record){const f=await fileFor(record);return URL.createObjectURL(f)}
  async function saveMetadata(record){return put("meta",record)}
  async function getMetadata(id){return get("meta",id)}
  async function exists(record){try{await fileFor(record);return true}catch{return false}}
  async function createFolder(name,parent){
    const active=await ensurePermission();if(active?.kind==="android"){if(typeof window.DVaultAndroid.createFolder!=="function")throw new Error("Android folder creation is not available.");return window.DVaultAndroid.createFolder(active.token,parent||"",name)}
    const dir=parent||active?.handle;if(!dir)throw new Error("Storage folder is not selected.");return dir.getDirectoryHandle(String(name).trim(),{create:true})
  }
  async function scan(){return window.DVaultAPI?.scan?window.DVaultAPI.scan():[]}
  window.DVaultStorage={
    db,get,put,del,all,putMany,allKeys,getMany,delMany,selectFolder,getRoot,getActive,ensurePermission,scan,listFiles,getFile,fileFor,getFileUrl,getMetadata,saveMetadata,deleteFile,renameFile,createFolder,exists,fileHandleFor,
    async clearRoot(){await del("handles",KEY);await del("settings","androidRoot")},
    isBrowserSupported:()=>!!window.showDirectoryPicker,
    isAndroidBridge:()=>!!(window.DVaultAndroid&&typeof window.DVaultAndroid.pickFolder==="function")
  };
})();