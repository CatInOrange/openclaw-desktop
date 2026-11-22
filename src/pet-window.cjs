'use strict';
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {planWalk,walkPosition}=require('./pet-motion.cjs');
const {createPetState,applyPetEvent,summarizePetState}=require('./pet-state.cjs');
function createPetWindow({BrowserWindow,ipcMain,Menu,screen,config,save,openSession}){
 const url=pathToFileURL(path.join(__dirname,'pet.html')).href;
 const settingsUrl=pathToFileURL(path.join(__dirname,'pet-settings.html')).href;
 const state=createPetState();let settingsWin,walkPlan,walkSerial=0;let win,expanded=false,timer,stopped=false,notice='';
 const pref=config.pet&&typeof config.pet==='object'?config.pet:{};config.pet=pref;
 // Migrate only the previous default; preserve explicitly resized pets.
 if(!pref.layoutVersion){if(!pref.size||pref.size===190)pref.size=462;pref.layoutVersion=2;}
 let size=Math.max(160,Math.min(720,Number(pref.size)||462));
 function dimensions(){return expanded?{width:Math.max(360,size),height:Math.round(size*9/16)+330}:{width:size,height:Math.round(size*9/16)};}
 function persist(){if(!win||win.isDestroyed())return;const b=win.getBounds();Object.assign(pref,{x:b.x+b.width-size,y:b.y+b.height-Math.round(size*9/16),size});save();}
 function settings(){return {size,enabled:pref.enabled!==false,top:pref.top!==false,roaming:pref.roaming!==false};}
 function canWalk(){const s=summarizePetState(state);return !expanded&&!settingsWin&&pref.enabled!==false&&pref.roaming!==false&&s.connected&&s.complete&&s.action==='idle';}
 function openSettings(){
  if(settingsWin&&!settingsWin.isDestroyed()){settingsWin.show();settingsWin.focus();return;}
  walkPlan=null;
  settingsWin=new BrowserWindow({width:490,height:630,minWidth:420,minHeight:580,title:'桌宠设置',autoHideMenuBar:true,backgroundColor:'#141b24',show:false,webPreferences:{preload:path.join(__dirname,'pet-settings-preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false}});
  const local=settingsWin;local.webContents.setWindowOpenHandler(()=>({action:'deny'}));local.webContents.on('will-navigate',e=>e.preventDefault());
  local.on('closed',()=>{if(settingsWin===local)settingsWin=null;publish();});
  local.loadURL(settingsUrl).then(()=>{if(!stopped&&!local.isDestroyed()){local.show();publish();}}).catch(()=>{});
  publish();
 }
 function updateSettings(patch){
  if(!patch||typeof patch!=='object'||Array.isArray(patch))return {ok:false,error:'设置格式无效'};
  for(const [key,value]of Object.entries(patch))if(!['size','enabled','top','roaming'].includes(key)||(key==='size'?typeof value!=='number'||!Number.isFinite(value)||value<160||value>720:typeof value!=='boolean'))return {ok:false,error:'设置值无效'};
  const previous={...pref},oldSize=size;
  Object.assign(pref,patch);if(patch.size!==undefined){size=Math.round(patch.size);pref.size=size;}
  if(save()===false){for(const k of Object.keys(pref))delete pref[k];Object.assign(pref,previous);size=oldSize;return {ok:false,error:'设置保存失败，请检查本地目录权限'};}
  walkPlan=null;resize();win.setAlwaysOnTop(pref.top!==false);if(pref.enabled===false)win.hide();else win.showInactive();publish();return {ok:true};
 }
 ipcMain.handle('pet:settings',(event,name,patch)=>{
  if(!settingsWin||event.sender!==settingsWin.webContents||event.senderFrame!==settingsWin.webContents.mainFrame||event.senderFrame.url!==settingsUrl)throw new Error('Untrusted sender');
  if(name==='initial')return settings();if(name==='update')return updateSettings(patch);if(name==='close')settingsWin.close();
 });
 function publish(){if(settingsWin&&!settingsWin.isDestroyed())settingsWin.webContents.send('pet:settings-state',settings());if(win&&!win.isDestroyed())win.webContents.send('pet:state',{...summarizePetState(state),size,top:pref.top!==false,expanded,notice,roaming:pref.roaming!==false,enabled:pref.enabled!==false,settingsOpen:!!settingsWin});}
 function ensure(){
  if(win&&!win.isDestroyed())return;
  const area=screen.getPrimaryDisplay().workArea;const d=dimensions();
  const candidate={x:Number.isFinite(pref.x)?pref.x:area.x+area.width-d.width-30,y:Number.isFinite(pref.y)?pref.y:area.y+area.height-d.height-30,...d};
  const display=screen.getDisplayMatching(candidate).workArea;
  candidate.x=Math.max(display.x,Math.min(candidate.x,display.x+display.width-d.width));candidate.y=Math.max(display.y,Math.min(candidate.y,display.y+display.height-d.height));
  win=new BrowserWindow({...candidate,frame:false,transparent:true,resizable:false,show:false,skipTaskbar:true,alwaysOnTop:pref.top!==false,webPreferences:{preload:path.join(__dirname,'pet-preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',e=>e.preventDefault());
  win.webContents.on('context-menu',()=>{
   win.setIgnoreMouseEvents(false);
   Menu.buildFromTemplate([
    {label:'桌宠设置…',click:openSettings},
    {label:'OpenClaw 工作状态',click:()=>{expanded=true;resize();publish();}},
    {type:'separator'},
    {label:'空闲时走动',type:'checkbox',checked:pref.roaming!==false,click:item=>{pref.roaming=item.checked;save();publish();}},
    {label:'置顶',type:'checkbox',checked:pref.top!==false,click:item=>{pref.top=item.checked;win.setAlwaysOnTop(pref.top);save();publish();}},
    {label:'放大',click:()=>{size=Math.min(720,size+20);resize();persist();publish();}},
    {label:'缩小',click:()=>{size=Math.max(160,size-20);resize();persist();publish();}},
    {label:'隐藏',click:()=>{pref.enabled=false;walkPlan=null;win.hide();save();publish();}}
   ]).popup({window:win});
  });
  win.loadURL(url).then(()=>{if(stopped)return;publish();if(pref.enabled!==false)win.showInactive();});
  win.on('move',()=>{clearTimeout(timer);timer=setTimeout(persist,300);});
 }
 function resize(){walkPlan=null;const b=win.getBounds(),d=dimensions(),area=screen.getDisplayMatching(b).workArea;win.setBounds({x:Math.max(area.x,Math.min(b.x+b.width-d.width,area.x+area.width-d.width)),y:Math.max(area.y,Math.min(b.y+b.height-d.height,area.y+area.height-d.height)),...d});}
 ipcMain.handle('pet:command',(event,name,value)=>{
  if(!win||event.sender!==win.webContents||event.senderFrame!==win.webContents.mainFrame||event.senderFrame.url!==url)throw new Error('Untrusted sender');
  if(name==='initial')publish();
  else if(name==='hit'&&typeof value==='boolean')win.setIgnoreMouseEvents(!value,{forward:true});
  else if(name==='expand'){expanded=!!value;win.setIgnoreMouseEvents(false);resize();publish();}
  else if(name==='walk-plan'){
   walkPlan=null;if(!canWalk())return null;
   const bounds=win.getBounds(),area=screen.getDisplayMatching(bounds).workArea;
   const plan=planWalk({bounds,area,size,direction:value?.direction});
   if(!plan)return null;walkPlan={...plan,id:++walkSerial};return walkPlan;
  }
  else if(name==='walk-step'){
   if(!walkPlan||!canWalk()||value?.id!==walkPlan.id||!Number.isFinite(value.progress))return;
   const pos=walkPosition(walkPlan,value.progress);win.setPosition(pos.x,pos.y);return pos;
  }
  else if(name==='walk-stop'){walkPlan=null;}
  else if(name==='move'&&value&&Number.isFinite(value.x)&&Number.isFinite(value.y)){walkPlan=null;const b=win.getBounds();const target={...b,x:b.x+Math.max(-200,Math.min(200,Math.round(value.x))),y:b.y+Math.max(-200,Math.min(200,Math.round(value.y)))};const area=screen.getDisplayMatching(target).workArea;win.setPosition(Math.max(area.x,Math.min(target.x,area.x+area.width-b.width)),Math.max(area.y,Math.min(target.y,area.y+area.height-b.height)));}
  else if(name==='smaller'||name==='bigger'){size=Math.max(160,Math.min(720,size+(name==='bigger'?20:-20)));resize();persist();publish();}
  else if(name==='top'){pref.top=!!value;win.setAlwaysOnTop(pref.top);save();publish();}
  else if(name==='hide'){pref.enabled=false;walkPlan=null;win.hide();save();publish();}
  else if(name==='open'&&typeof value==='string'&&summarizePetState(state).sessions.some(s=>(s.sessionKey||s.key)===value))openSession(value);
 });
 ensure();const tick=setInterval(publish,1000);tick.unref();
 return {openSettings,event(e){if(e.type==='notice')notice=String(e.message||'');else {if(e.type==='connection')notice='';applyPetEvent(state,e);}if(!canWalk())walkPlan=null;publish();},show(){ensure();pref.enabled=true;win.showInactive();save();},stop(){stopped=true;clearInterval(tick);clearTimeout(timer);persist();ipcMain.removeHandler('pet:command');ipcMain.removeHandler('pet:settings');if(settingsWin&&!settingsWin.isDestroyed())settingsWin.destroy();if(win&&!win.isDestroyed())win.destroy();}};
}
module.exports={createPetWindow};
