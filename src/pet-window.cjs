'use strict';
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {createPetState,applyPetEvent,summarizePetState}=require('./pet-state.cjs');
function createPetWindow({BrowserWindow,ipcMain,screen,config,save,openSession}){
 const url=pathToFileURL(path.join(__dirname,'pet.html')).href;
 const state=createPetState();let win,expanded=false,timer,stopped=false,notice='';
 const pref=config.pet&&typeof config.pet==='object'?config.pet:{};config.pet=pref;
 let size=Math.max(160,Math.min(300,Number(pref.size)||190));
 function dimensions(){return expanded?{width:360,height:size+330}:{width:size,height:size+20};}
 function persist(){if(!win||win.isDestroyed())return;const b=win.getBounds();Object.assign(pref,{x:b.x+b.width-size,y:b.y+b.height-size-20,size});save();}
 function publish(){if(win&&!win.isDestroyed())win.webContents.send('pet:state',{...summarizePetState(state),size,top:pref.top!==false,expanded,notice});}
 function ensure(){
  if(win&&!win.isDestroyed())return;
  const area=screen.getPrimaryDisplay().workArea;const d=dimensions();
  const candidate={x:Number.isFinite(pref.x)?pref.x:area.x+area.width-d.width-30,y:Number.isFinite(pref.y)?pref.y:area.y+area.height-d.height-30,...d};
  const display=screen.getDisplayMatching(candidate).workArea;
  candidate.x=Math.max(display.x,Math.min(candidate.x,display.x+display.width-d.width));candidate.y=Math.max(display.y,Math.min(candidate.y,display.y+display.height-d.height));
  win=new BrowserWindow({...candidate,frame:false,transparent:true,resizable:false,show:false,skipTaskbar:true,alwaysOnTop:pref.top!==false,webPreferences:{preload:path.join(__dirname,'pet-preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',e=>e.preventDefault());
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
  else if(name==='smaller'||name==='bigger'){size=Math.max(160,Math.min(300,size+(name==='bigger'?20:-20)));resize();persist();publish();}
  else if(name==='top'){pref.top=!!value;win.setAlwaysOnTop(pref.top);save();publish();}
  else if(name==='hide'){pref.enabled=false;win.hide();save();}
  else if(name==='open'&&typeof value==='string'&&summarizePetState(state).sessions.some(s=>(s.sessionKey||s.key)===value))openSession(value);
 });
 ensure();const tick=setInterval(publish,1000);tick.unref();
 return {event(e){if(e.type==='notice')notice=String(e.message||'');else {if(e.type==='connection')notice='';applyPetEvent(state,e);}publish();},show(){ensure();pref.enabled=true;win.showInactive();save();},stop(){stopped=true;clearInterval(tick);clearTimeout(timer);persist();ipcMain.removeHandler('pet:command');if(win&&!win.isDestroyed())win.destroy();}};
}
module.exports={createPetWindow};
