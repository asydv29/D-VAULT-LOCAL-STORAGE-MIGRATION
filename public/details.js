/* Shared "Details" dialog for video cards (home, folders, liked, watch later,
   favorites, history, watch-page recommendations) and the watch page's own
   More menus. Shows only what is already known about the video - nothing is
   fetched. Usage: DPDetails.open(item, { video: <video element>, saved: bool }) */
(function(){
  // Menu-item icon: sized like the other card-menu icons (.menu-icon = 16px).
  // Injected at load so it applies before the dialog is ever opened.
  (function(){
    const st=document.createElement('style');
    st.textContent='svg.dp-details-icon{width:16px;height:16px;flex:none;vertical-align:-3px;margin-right:7px;overflow:visible}';
    document.head.appendChild(st);
  })();
  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
  function gcd(a,b){return b?gcd(b,a%b):a}
  function qualityLabel(w,h){
    if(!w||!h)return '';
    const e=Math.max(Math.min(w,h),Math.round(Math.max(w,h)*9/16));
    if(e>=2000)return '4K';if(e>=1300)return '2K';if(e>=1000)return '1080p';
    if(e>=680)return '720p';if(e>=460)return '480p';if(e>=340)return '360p';
    return e+'p';
  }
  function fmtDur(sec){
    if(!isFinite(sec)||sec<=0)return '';
    sec=Math.round(sec);
    const h=Math.floor(sec/3600),m=Math.floor(sec%3600/60),x=sec%60;
    return (h?h+':'+String(m).padStart(2,'0'):String(m))+':'+String(x).padStart(2,'0');
  }
  function fmtSize(b){
    b=Number(b);if(!b||b<0)return '';
    const u=['B','KB','MB','GB','TB'];let i=0;
    while(b>=1024&&i<u.length-1){b/=1024;i++}
    return (i?b.toFixed(1):String(Math.round(b)))+' '+u[i];
  }
  function fmtDate(iso){
    if(!iso)return '';
    const d=new Date(iso);
    if(isNaN(d.getTime()))return '';
    return d.toLocaleString(undefined,{year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
  }
  function ago(iso){
    const t=new Date(iso).getTime();
    if(!t)return '';
    const s=Math.max(0,(Date.now()-t)/1000);
    const steps=[[31536000,'year'],[2592000,'month'],[604800,'week'],[86400,'day'],[3600,'hour'],[60,'minute']];
    for(const [n,name] of steps)if(s>=n){const k=Math.floor(s/n);return k+' '+name+(k>1?'s':'')+' ago'}
    return 'just now';
  }

  function rows(item,opts){
    item=item||{};opts=opts||{};
    const id=String(item.id||'');
    const name=item.title||item.name||'';
    const ext=/\.([a-z0-9]+)$/i.exec(item.name||name);
    const vid=opts.video;
    const w=vid&&vid.videoWidth,h=vid&&vid.videoHeight;
    let res='';
    if(w&&h){
      const g=gcd(w,h),q=qualityLabel(w,h);
      res=w+' × '+h+(q?' ('+q+')':'')+'\n'+(h>w?'Portrait':h<w?'Landscape':'Square')+' ('+(w/g)+':'+(h/g)+')';
    }else if(item.quality){
      res=item.quality;
      if(item.orientationKnown||item.isPortrait)res+='\n'+(item.isPortrait?'Portrait':'Landscape');
    }
    const bytes=Number(item.size);
    const sizeText=bytes>0?fmtSize(bytes)+' ('+bytes.toLocaleString()+' bytes)':'';
    const dur=fmtDur(vid&&vid.duration)||item.duration||'';
    const created=fmtDate(item.createdTime);
    const src=opts.saved?(id.startsWith('picker:')?'Local photos · also saved in app':'Local storage · also saved in app')
      :(id.startsWith('picker:')?'Local photos':'Local storage');
    const flags=[item.liked?'Liked':'',item.favorite?'Favorite':'',item.watchLater?'In Watch Later':'',item.isShort?'Marked as Short':''].filter(Boolean).join(', ');
    return [
      ['Title',name||'Untitled'],
      ['Type',ext?ext[1].toUpperCase():''],
      ['Resolution',res],
      ['Size',sizeText],
      ['Duration',dur],
      ['Uploaded',created?created+(item.createdTime?' · '+ago(item.createdTime):''):''],
      ['Views',item.views==null?'':Number(item.views||0).toLocaleString()],
      ['Status',flags],
      ['Source',src],
      ['Video ID',id]
    ].filter(r=>r[1]);
  }

  let modal=null;
  function ensureModal(){
    if(modal)return modal;
    const st=document.createElement('style');
    st.textContent='.dp-details-modal .modal-card{width:min(460px,92vw);max-height:82vh;display:flex;flex-direction:column;padding:22px 22px 16px}'
      +'.dp-details-modal h2{margin:0 26px 12px 0;font-size:18px}'
      +'.dp-details-body{overflow-y:auto;overscroll-behavior:contain}'
      +'.dp-details-row{display:grid;grid-template-columns:96px 1fr;gap:12px;padding:9px 0;border-top:1px solid #ffffff1a;font-size:14px;line-height:1.4}'
      +'.dp-details-row:first-child{border-top:0}'
      +'.dp-details-key{color:#aaa}.dp-details-val{color:#f1f1f1;word-break:break-word;user-select:text;-webkit-user-select:text}';
    document.head.appendChild(st);
    modal=document.createElement('div');
    modal.className='modal dp-details-modal';
    modal.innerHTML='<div class="modal-card" role="dialog" aria-modal="true" aria-label="Video details"><button type="button" class="modal-close" aria-label="Close">×</button><h2>Details</h2><div class="dp-details-body"></div></div>';
    document.body.appendChild(modal);
    const close=()=>modal.classList.remove('show');
    modal.addEventListener('click',e=>{if(e.target===modal||e.target.closest('.modal-close'))close()});
    document.addEventListener('keydown',e=>{if(e.key==='Escape'&&modal.classList.contains('show'))close()});
    return modal;
  }

  function open(item,opts){
    const m=ensureModal();
    const body=m.querySelector('.dp-details-body');
    body.innerHTML=rows(item,opts).map(([k,v])=>
      '<div class="dp-details-row"><span class="dp-details-key">'+esc(k)+'</span><span class="dp-details-val">'+esc(v).replace(/\n/g,'<br>')+'</span></div>').join('');
    body.scrollTop=0;
    m.classList.add('show');
  }

  const ICON='<img src="/icons/details-icon.png" alt="" class="menu-icon icon-invert dp-details-icon">';
  window.DPDetails={open,rows,icon:ICON};
})();
