'use strict';
// Isolated overlay; authenticated monitoring comes from shared protocol adapter,
// never chat text. Page messages cannot invoke native functions or arbitrary URLs.
(() => {
  let state = createPetState(), settings = {}, enabled=false, collapsed=false, opened=false;
  let host, ui, video, label, rows, handle, card, action='', mediaEpoch=0, drag;
  let notice='', position=0.55;
  const media = new Map();
  const idlePool=['idle','idle-cube','idle-juggle','idle-swing','idle-walk'];
  let confirmedIdle=false, rotationActive=false;
  const names={offline:'连接中断',unknown:'状态待确认',idle:'空闲',thinking:'正在响应',working:'执行工具',result:'整理结果',waiting:'等待批准',success:'已完成',error:'运行异常'};
  function button(text, title, handler) {
    const b=document.createElement('button');b.textContent=text;b.title=title;b.setAttribute('aria-label',title);b.onclick=handler;return b;
  }
  function mount() {
    if (host) return;
    host=document.createElement('div');host.id='oc-mobile-pet';
    host.style.cssText='position:fixed;right:0;top:55%;z-index:2147483000;pointer-events:none';
    ui=host.attachShadow({mode:'closed'});
    const css=document.createElement('style');css.textContent=`
      :host{font:13px system-ui;color-scheme:light dark}button{font:inherit;color:inherit;border:0;background:transparent;min-width:36px;min-height:36px;border-radius:12px;cursor:pointer}button:focus-visible{outline:2px solid #7b93d5}button:active{background:#8883}
      .pet{position:relative;pointer-events:auto;width:112px;height:68px;touch-action:none;user-select:none;background:transparent;border:0;padding:0;overflow:hidden}.pet video{width:176px;height:99px;position:absolute;left:-32px;top:-15px;pointer-events:none}.pet.keyboard{width:76px;height:48px}.pet.keyboard video{width:117px;height:66px;left:-21px;top:-9px}.pet.keyboard small{right:3px;font-size:9px}.pet.unknown video{opacity:.45;filter:grayscale(1)}.pet small{position:absolute;right:7px;bottom:0;background:light-dark(#fffc,#17212ee8);border-radius:8px;padding:1px 4px;font-size:10px}
      .tools{pointer-events:auto;text-align:right}.card{pointer-events:auto;position:absolute;right:8px;bottom:100%;width:min(280px,calc(100vw - 32px));max-height:40vh;overflow:auto;background:light-dark(#fffffff5,#17212ef5);box-shadow:0 4px 24px #0004;border:1px solid #8885;border-radius:16px;padding:12px;backdrop-filter:blur(12px)}.card p{margin:0 0 6px;overflow-wrap:anywhere}.rows button{display:block;text-align:left;width:100%;overflow-wrap:anywhere} [hidden]{display:none!important}
    `;ui.append(css);
    card=document.createElement('section');card.className='card';card.hidden=true;card.setAttribute('aria-label','小宠工作状态');
    label=document.createElement('p');card.append(label);
    rows=document.createElement('div');rows.className='rows';card.append(rows);
    card.append(button('关闭','关闭状态',()=>{opened=false;render();}));ui.append(card);
    handle=button('◉','展开小宠',()=>{collapsed=false;render();});handle.hidden=true;handle.style.pointerEvents='auto';ui.append(handle);
    const pet=button('','查看小宠工作状态',()=>{});pet.className='pet';video=document.createElement('video');video.muted=true;video.loop=true;video.playsInline=true;pet.append(video);const hint=document.createElement('small');pet.append(hint);ui.append(pet);
    const tools=document.createElement('div');tools.className='tools';tools.append(button('›','收起小宠',()=>{collapsed=true;opened=false;render();}));ui.append(tools);
    pet.onpointerdown=e=>{drag={y:e.clientY,start:e.clientY,moved:false};pet.setPointerCapture(e.pointerId);};
    pet.onpointermove=e=>{if(!drag)return;if(Math.abs(e.clientY-drag.start)>6)drag.moved=true;if(drag.moved){const h=window.visualViewport?.height||innerHeight;position=Math.max(.15,Math.min(.85,position+(e.clientY-drag.y)/h));host.style.top=(position*100)+'%';drag.y=e.clientY;}};
    pet.onpointerup=()=>{if(drag&&!drag.moved)opened=!opened;drag=null;render();};pet.onpointercancel=()=>{drag=null;};
    pet.onclick=e=>{if(e.detail===0){opened=!opened;render();}};
    video.onended=()=>{
      if(!confirmedIdle||!rotationActive||document.hidden)return;
      const pool=idlePool.filter(name=>name!==action);
      animate(pool[Math.floor(Math.random()*pool.length)],true);
    };
    video.onerror=()=>{hint.textContent='动画不可用';};
    document.documentElement.append(host);
  }
  async function animate(next, active) {
    rotationActive=Boolean(active);
    if (!video) return;
    if (!active) {mediaEpoch++;video.pause();action='';return;}
    if (action===next) {video.play().catch(()=>{});return;}
    action=next;video.loop=!(confirmedIdle&&idlePool.includes(next));const epoch=++mediaEpoch;
    try {
      if (!media.has(next)) {const r=await browser.runtime.sendMessage({type:'pet-media',name:next});if(!r?.url?.startsWith('data:video/webm;base64,'))throw Error();media.set(next,r.url);}
      if(epoch!==mediaEpoch)return;video.src=media.get(next);video.play().catch(()=>{video.parentNode.querySelector('small').textContent='点开查看状态';});
    } catch {if(epoch===mediaEpoch)video.parentNode.querySelector('small').textContent='动画不可用';}
  }
  function render() {
    if(!enabled){if(host)host.hidden=true;animate('idle',false);return;}
    mount();host.hidden=false;
    const keyboard=settings.keyboardVisible || ((window.visualViewport?.height||innerHeight)<innerHeight*0.72);
    if(keyboard)opened=false;
    const small=collapsed;
    video.parentNode.classList.toggle('keyboard',Boolean(keyboard));
    handle.hidden=!small;video.parentNode.hidden=small;ui.querySelector('.tools').hidden=small;
    card.hidden=!opened||small;
    const s=summarizePetState(state);const unknown=['unknown','offline'].includes(s.action);
    video.parentNode.classList.toggle('unknown',unknown);
    video.parentNode.querySelector('small').textContent=unknown?'?':s.waitingCount?'!':'';
    label.textContent=(names[s.action]||names.unknown)+(s.activeAgents?' · '+s.activeAgents+' 个 Agent':'')+(notice?' · '+notice:'');
    rows.replaceChildren();
    if(opened)for(const r of s.sessions.filter(r=>r.active||r.waiting||r.error).slice(0,12)){
      rows.append(button((r.waiting?'待批准':names[r.action]||'状态未知')+' · '+r.agentId+' · '+(r.title||r.sessionKey), '打开会话',()=>{
        const url=new URL(location.href);url.searchParams.set('session',r.sessionKey);url.pathname=url.pathname.replace(/\/(?:chat|overview|sessions|agents|settings)\/?$/,'/chat');
        if(url.pathname===location.pathname&&!/\/chat\/?$/.test(url.pathname))url.pathname=url.pathname.replace(/\/?$/,'/chat');
        location.assign(url.href);
      }));
    }
    confirmedIdle=s.action==='idle'&&s.connected===true&&s.complete===true;
    const next=confirmedIdle&&idlePool.includes(action)?action:unknown?'idle':s.action;
    video.loop=!(confirmedIdle&&idlePool.includes(next));
    animate(next,!small && settings.active && !document.hidden);
  }
  globalThis.ocApplyPetSettings=value=>{
    settings=value||{};const next=Boolean(settings.allowed&&settings.petEnabled&&settings.active&&!document.hidden);
    if(next!==enabled){enabled=next;state=createPetState();opened=false;window.postMessage({type:'oc-pet-control',active:enabled},location.origin);}
    render();
  };
  window.addEventListener('message',e=>{
    if(!enabled||e.source!==window||e.origin!==location.origin||e.data?.type!=='oc-pet-facts'||typeof e.data.json!=='string'||e.data.json.length>2000000)return;
    try{const events=JSON.parse(e.data.json);if(!Array.isArray(events))return;for(const event of events.slice(0,4096)){if(event.type==='notice')notice=String(event.message||'').slice(0,200);else applyPetEvent(state,event);}render();}catch{/* unsupported facts remain unknown */}
  });
  document.addEventListener('visibilitychange',()=>{if(document.hidden){enabled=false;state=createPetState();window.postMessage({type:'oc-pet-control',active:false},location.origin);render();}});
  window.visualViewport?.addEventListener('resize',render);
  window.addEventListener('pagehide',()=>{enabled=false;render();});
})();
