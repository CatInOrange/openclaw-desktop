'use strict';
(() => {
const video=document.querySelector('video'),badge=document.querySelector('#badge'),card=document.querySelector('#card');
const canvas=document.querySelector('canvas'),ctx=canvas.getContext('2d',{willReadFrequently:true});
let action='',drag=null,opened=false;
const statuses={waiting:'等待批准',working:'执行工具',thinking:'正在响应',result:'整理结果',idle:'空闲'};
function expand(value){opened=value;card.hidden=!value;window.pet.command('expand',value);}
badge.onclick=()=>expand(!opened);document.querySelector('#dismiss').onclick=()=>expand(false);
for(const name of ['smaller','bigger','hide'])document.getElementById(name).onclick=()=>window.pet.command(name);
document.querySelector('#top').onchange=e=>window.pet.command('top',e.target.checked);
window.pet.onState(s=>{
 document.documentElement.style.setProperty('--pet-size',(s.size||190)+'px');
 document.querySelector('#top').checked=s.top!==false;
 if(typeof s.expanded==='boolean'){opened=s.expanded;card.hidden=!opened;}
 const next=['idle','thinking','working','result','waiting','success','error'].includes(s.action)?s.action:'idle';
 if(next!==action){action=next;video.src='../assets/pet/'+action+'.webm';video.play().catch(()=>{});}
 video.classList.toggle('offline',!s.connected||!s.complete);
 badge.textContent=!s.connected?'连接中断':!s.complete?'状态待确认':s.waitingCount?`${s.waitingCount} 项待处理`:s.activeAgents?`${s.activeAgents} 个 Agent 工作中`:s.errorCount?`${s.errorCount} 项异常`:'空闲';
 document.querySelector('#connection').textContent=badge.textContent+(s.notice?' · '+s.notice:'');
 const list=document.querySelector('#sessions');list.replaceChildren();
 for(const row of (s.sessions||[]).filter(row=>row.active||row.waiting||row.error).slice(0,60)){const b=document.createElement('button');b.className='row';b.textContent=(row.waiting?'待批准':row.error&&!row.active?'运行异常':statuses[row.action]||'状态未知')+' · '+(row.agentId||'Agent')+' · '+(row.title||row.sessionKey||row.key||'会话');b.onclick=()=>window.pet.command('open',row.sessionKey||row.key);list.append(b);}
});
const pet=document.querySelector('#pet');
pet.onpointerdown=e=>{if(e.target===badge||e.button!==0)return;drag={x:e.screenX,y:e.screenY,startX:e.screenX,startY:e.screenY,moved:false};e.currentTarget.setPointerCapture(e.pointerId);};
pet.onpointermove=e=>{if(!drag)return;if(!drag.moved&&Math.hypot(e.screenX-drag.startX,e.screenY-drag.startY)<5)return;drag.moved=true;window.pet.command('move',{x:e.screenX-drag.x,y:e.screenY-drag.y});drag.x=e.screenX;drag.y=e.screenY;};
pet.onpointerup=e=>{if(!drag)return;const clicked=!drag.moved;drag=null;if(pet.hasPointerCapture(e.pointerId))pet.releasePointerCapture(e.pointerId);if(clicked)expand(!opened);};
pet.onpointercancel=pet.onlostpointercapture=()=>{drag=null;};
// Sample the actual video alpha: empty pixels pass clicks to windows underneath.
document.addEventListener('pointermove',e=>{
 let hit=opened||!!drag||e.target===badge;
 if(!hit&&video.readyState>=2){try{const r=video.getBoundingClientRect(),w=Math.ceil(r.width),h=Math.ceil(r.height);if(canvas.width!==w)canvas.width=w;if(canvas.height!==h)canvas.height=h;ctx.clearRect(0,0,w,h);const scale=Math.min(w/video.videoWidth,h/video.videoHeight),vw=video.videoWidth*scale,vh=video.videoHeight*scale;ctx.drawImage(video,(w-vw)/2,(h-vh)/2,vw,vh);const x=Math.floor(e.clientX-r.left),y=Math.floor(e.clientY-r.top);hit=x>=0&&x<w&&y>=0&&y<h&&ctx.getImageData(x,y,1,1).data[3]>24;}catch{hit=true;}}
 window.pet.command('hit',hit);
});
document.addEventListener('pointerleave',()=>{if(!drag&&!opened)window.pet.command('hit',false);});

})();
