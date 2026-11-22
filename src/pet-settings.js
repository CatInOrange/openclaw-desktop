'use strict';
(()=>{
 const slider=document.querySelector('#size'),value=document.querySelector('#size-value'),status=document.querySelector('#save-status');let timer;
 const sizeLabel=()=>{value.textContent=Math.round(Number(slider.value)/462*100)+'%';};
 function render(s){for(const name of ['enabled','top','roaming'])document.getElementById(name).checked=s[name];if(document.activeElement!==slider)slider.value=s.size;sizeLabel();}
 async function update(patch){try{const r=await window.petSettings.update(patch);if(!r.ok)throw new Error(r.error);status.textContent='已保存到本机';status.dataset.error='false';return true;}catch(e){status.textContent=e.message;status.dataset.error='true';return false;}}
 slider.oninput=()=>{sizeLabel();clearTimeout(timer);const size=Number(slider.value);timer=setTimeout(()=>void update({size}),60);};
 slider.onchange=()=>{clearTimeout(timer);void update({size:Number(slider.value)});};
 for(const name of ['enabled','top','roaming'])document.getElementById(name).onchange=e=>void update({[name]:e.target.checked});
 document.querySelector('#reset').onclick=()=>{clearTimeout(timer);void update({size:462,enabled:true,top:true,roaming:true});};
 document.querySelector('#done').onclick=async()=>{clearTimeout(timer);if(await update({size:Number(slider.value)}))window.petSettings.close();};
 window.petSettings.onState(render);window.petSettings.initial().then(render).catch(e=>{status.textContent=e.message;status.dataset.error='true';});
})();
