'use strict';
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {createPetState,applyPetEvent,summarizePetState}=require('./pet-state.cjs');
function createPetWindow({BrowserWindow,ipcMain,Menu,screen,config,save,openSession}){
 const url=pathToFileURL(path.join(__dirname,'pet.html')).href;
 const state=createPetState();let win,expanded=false,timer,stopped=false,notice='';
 const pref=config.pet&&typeof config.pet==='object'?config.pet:{};config.pet=pref;
 // Migrate only the previous default; preserve explicitly resized pets.
 if(!pref.layoutVersion){if(!pref.size||pref.size===190)pref.size=462;pref.layoutVersion=2;}
 let size=Math.max(160,Math.min(720,Number(pref.size)||462));
 function dimensions(){return expanded?{width:Math.max(360,size),height:Math.round(size*9/16)+330}:{width:size,height:Math.round(size*9/16)};}
 function persist(){if(!win||win.isDestroyed())return;const b=win.getBounds();Object.assign(pref,{x:b.x+b.width-size,y:b.y+b.height-Math.round(size*9/16),size});save();}
 function publish(){if(win&&!win.isDestroyed())win.webContents.send('pet:state',{...summarizePetState(state),size,top:pref.top!==false,expanded,notice,roaming:pref.roaming!==false});}
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
    {label:'OpenClaw 工作状态',click:()=>{expanded=true;resize();publish();}},
    {type:'separator'},
    {label:'空闲时走动',type:'checkbox',checked:pref.roaming!==false,click:item=>{pref.roaming=item.checked;save();publish();}},
    {label:'置顶',type:'checkbox',checked:pref.top!==false,click:item=>{pref.top=item.checked;win.setAlwaysOnTop(pref.top);save();publish();}},
    {label:'放大',click:()=>{size=Math.min(720,size+20);resize();persist();publish();}},
    {label:'缩小',click:()=>{size=Math.max(160,size-20);resize();persist();publish();}},
    {label:'隐藏',click:()=>{pref.enabled=false;win.hide();save();}}
   ]).popup({window:win});
  });
  win.loadURL(url).then(()=>{if(stopped)return;publish();if(pref.enabled!==false)win.showInactive();});
  win.on('move',()=>{clearTimeout(timer);timer=setTimeout(persist,300);});
 }
 function resize(){const b=win.getBounds(),d=dimensions(),area=screen.getDisplayMatching(b).workArea;win.setBounds({x:Math.max(area.x,Math.min(b.x+b.width-d.width,area.x+area.width-d.width)),y:Math.max(area.y,Math.min(b.y+b.height-d.height,area.y+area.height-d.height)),...d});}
 ipcMain.handle('pet:command',(event,name,value)=>{
  if(!win||event.sender!==win.webContents||event.senderFrame!==win.webContents.mainFrame||event.senderFrame.url!==url)throw new Error('Untrusted sender');
  if(name==='initial')publish();
  else if(name==='hit'&&typeof value==='boolean')win.setIgnoreMouseEvents(!value,{forward:true});
  else if(name==='expand'){expanded=!!value;win.setIgnoreMouseEvents(false);resize();publish();}
  else if(name==='move'&&value&&Number.isFinite(value.x)&&Number.isFinite(value.y)){const b=win.getBounds();const target={...b,x:b.x+Math.max(-200,Math.min(200,Math.round(value.x))),y:b.y+Math.max(-200,Math.min(200,Math.round(value.y)))};const area=screen.getDisplayMatching(target).workArea;win.setPosition(Math.max(area.x,Math.min(target.x,area.x+area.width-b.width)),Math.max(area.y,Math.min(target.y,area.y+area.height-b.height)));}
  else if(name==='smaller'||name==='bigger'){size=Math.max(160,Math.min(720,size+(name==='bigger'?20:-20)));resize();persist();publish();}
  else if(name==='top'){pref.top=!!value;win.setAlwaysOnTop(pref.top);save();publish();}
  else if(name==='hide'){pref.enabled=false;win.hide();save();}
  else if(name==='open'&&typeof value==='string'&&summarizePetState(state).sessions.some(s=>(s.sessionKey||s.key)===value))openSession(value);
 });
 ensure();const tick=setInterval(publish,1000);tick.unref();
 return {event(e){if(e.type==='notice')notice=String(e.message||'');else {if(e.type==='connection')notice='';applyPetEvent(state,e);}publish();},show(){ensure();pref.enabled=true;win.showInactive();save();},stop(){stopped=true;clearInterval(tick);clearTimeout(timer);persist();ipcMain.removeHandler('pet:command');if(win&&!win.isDestroyed())win.destroy();}};
}
module.exports={createPetWindow};
