'use strict';
(() => {
const video=document.querySelector('video'),card=document.querySelector('#card');
const canvas=document.querySelector('canvas'),ctx=canvas.getContext('2d',{willReadFrequently:true});
let action='',drag=null,opened=false,confirmedIdle=false,lastState=null,playError='';
const idlePool=['idle','idle-cube','idle-juggle','idle-swing'];
video.muted=true;video.playsInline=true;
function play(name){action=name;video.src='../assets/pet/'+name+'.webm';video.loop=name==='idle'&&!confirmedIdle||!idlePool.includes(name);video.play().catch(()=>{playError='动画播放失败，点击角色查看并重试';if(lastState)render(lastState);});}
video.onended=()=>{if(!confirmedIdle)return;const pool=idlePool.filter(name=>name!==action);play(pool[Math.floor(Math.random()*pool.length)]);};
video.onerror=()=>{playError='动画加载失败（'+(video.error?.code||'未知')+'）';document.querySelector('#connection').textContent=playError;};
const statuses={waiting:'等待批准',working:'执行工具',thinking:'正在响应',result:'整理结果',idle:'空闲'};
function expand(value){opened=value;card.hidden=!value;window.pet.command('expand',value);}
document.querySelector('#dismiss').onclick=()=>expand(false);
for(const name of ['smaller','bigger','hide'])document.getElementById(name).onclick=()=>window.pet.command(name);
document.querySelector('#top').onchange=e=>window.pet.command('top',e.target.checked);
function render(s){
 lastState=s;confirmedIdle=s.action==='idle'&&s.connected&&s.complete;
 document.documentElement.style.setProperty('--pet-size',(s.size||462)+'px');
 document.querySelector('#top').checked=s.top!==false;
 if(typeof s.expanded==='boolean'){opened=s.expanded;card.hidden=!opened;}
 const next=['idle','thinking','working','result','waiting','success','error'].includes(s.action)?s.action:'idle';
 if(next!==action&&!(confirmedIdle&&idlePool.includes(action)))play(next);
 video.loop=!confirmedIdle; 
 video.classList.toggle('offline',!s.connected||!s.complete);
 const statusText=!s.connected?'连接中断':!s.complete?'状态待确认':s.waitingCount?`${s.waitingCount} 项待处理`:s.activeAgents?`${s.activeAgents} 个 Agent 工作中`:s.errorCount?`${s.errorCount} 项异常`:'空闲';
 document.querySelector('#connection').textContent=statusText+(s.notice?' · '+s.notice:'')+(playError?' · '+playError:'');
 const list=document.querySelector('#sessions');list.replaceChildren();
 for(const row of (s.sessions||[]).filter(row=>row.active||row.waiting||row.error).slice(0,60)){const b=document.createElement('button');b.className='row';b.textContent=(row.waiting?'待批准':row.error&&!row.active?'运行异常':statuses[row.action]||'状态未知')+' · '+(row.agentId||'Agent')+' · '+(row.title||row.sessionKey||row.key||'会话');b.onclick=()=>window.pet.command('open',row.sessionKey||row.key);list.append(b);}
}
window.pet.onState(render);
const pet=document.querySelector('#pet');
pet.onpointerdown=e=>{if(e.button!==0)return;drag={x:e.screenX,y:e.screenY,startX:e.screenX,startY:e.screenY,moved:false};e.currentTarget.setPointerCapture(e.pointerId);};
pet.onpointermove=e=>{if(!drag)return;if(!drag.moved&&Math.hypot(e.screenX-drag.startX,e.screenY-drag.startY)<5)return;drag.moved=true;window.pet.command('move',{x:e.screenX-drag.x,y:e.screenY-drag.y});drag.x=e.screenX;drag.y=e.screenY;};
pet.onpointerup=e=>{if(!drag)return;const clicked=!drag.moved;drag=null;if(pet.hasPointerCapture(e.pointerId))pet.releasePointerCapture(e.pointerId);if(clicked){if(video.paused){playError='';video.play().catch(()=>{playError='动画播放失败';if(lastState)render(lastState);});}expand(!opened);}};
pet.onpointercancel=pet.onlostpointercapture=()=>{drag=null;};
// Sample the actual video alpha: empty pixels pass clicks to windows underneath.
document.addEventListener('pointermove',e=>{
 let hit=opened||!!drag;
 if(!hit&&video.readyState>=2){try{const r=video.getBoundingClientRect(),w=Math.ceil(r.width),h=Math.ceil(r.height);if(canvas.width!==w)canvas.width=w;if(canvas.height!==h)canvas.height=h;ctx.clearRect(0,0,w,h);const scale=Math.min(w/video.videoWidth,h/video.videoHeight),vw=video.videoWidth*scale,vh=video.videoHeight*scale;ctx.drawImage(video,(w-vw)/2,(h-vh)/2,vw,vh);const x=Math.floor(e.clientX-r.left),y=Math.floor(e.clientY-r.top);hit=x>=0&&x<w&&y>=0&&y<h&&ctx.getImageData(x,y,1,1).data[3]>24;}catch{hit=true;}}
 window.pet.command('hit',hit);
});
document.addEventListener('pointerleave',()=>{if(!drag&&!opened)window.pet.command('hit',false);});

})();
