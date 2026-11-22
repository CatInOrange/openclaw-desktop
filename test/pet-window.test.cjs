'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {createPetWindow}=require('../src/pet-window.cjs');
function harness(config={}){
 const handlers=new Map(),windows=[];let saves=0,opened=[],menu,failWrites=false;
 class FakeWindow extends EventEmitter{
  constructor(opts){super();this.opts=opts;this.bounds={x:opts.x,y:opts.y,width:opts.width,height:opts.height};this.visible=false;this.dead=false;this.sent=[];this.webContents=new EventEmitter();this.webContents.mainFrame={};this.webContents.setWindowOpenHandler=fn=>{this.openHandler=fn;};this.webContents.send=(...args)=>this.sent.push(args);windows.push(this);}
  loadURL(url){this.webContents.mainFrame.url=url;return Promise.resolve();}
  getBounds(){return this.bounds;}isDestroyed(){return this.dead;}
  setBounds(v){this.bounds=v;}setPosition(x,y){this.bounds.x=x;this.bounds.y=y;this.emit('move');}
  show(){this.visible=true;}focus(){}close(){this.dead=true;this.emit('closed');}
  showInactive(){this.visible=true;}hide(){this.visible=false;}destroy(){this.dead=true;}
  setAlwaysOnTop(value){this.top=value;}setIgnoreMouseEvents(value){this.ignore=value;}
 }
 const ipcMain={handle:(k,v)=>handlers.set(k,v),removeHandler:k=>handlers.delete(k)};
 const area={x:0,y:0,width:1000,height:800};
 const pet=createPetWindow({BrowserWindow:FakeWindow,ipcMain,Menu:{buildFromTemplate:items=>{menu=items;return {popup(){}};}},screen:{getPrimaryDisplay:()=>({workArea:area}),getDisplayMatching:()=>({workArea:area})},config,save:()=>failWrites?false:++saves,openSession:k=>opened.push(k)});
 const win=windows[0];
 const command=(name,value,event={sender:win.webContents,senderFrame:win.webContents.mainFrame})=>handlers.get('pet:command')(event,name,value);
 return {pet,win,windows,failSaving:()=>{failWrites=true;},menu:()=>menu,command,handlers,opened,config,saves:()=>saves};
}
test('pet IPC refuses other senders, child frames and arbitrary page URLs',async()=>{
 const h=harness();await Promise.resolve();
 assert.throws(()=>h.command('hide',null,{sender:{},senderFrame:h.win.webContents.mainFrame}),/Untrusted/);
 assert.throws(()=>h.command('hide',null,{sender:h.win.webContents,senderFrame:{...h.win.webContents.mainFrame}}),/Untrusted/);
 const url=h.win.webContents.mainFrame.url;h.win.webContents.mainFrame.url='https://attacker.example';assert.throws(()=>h.command('hide'),/Untrusted/);h.win.webContents.mainFrame.url=url;
 assert.deepEqual(h.win.openHandler(),{action:'deny'});h.pet.stop();
});
test('pet settings synchronize size and top; hiding and showing persist independently',async()=>{
 const h=harness({pet:{size:190,layoutVersion:2,top:false,enabled:false}});await Promise.resolve();
 assert.equal(h.win.visible,false);h.command('initial');let display=h.win.sent.at(-1)[1];assert.equal(display.top,false);assert.equal(display.size,190);
 h.command('bigger');assert.equal(h.config.pet.size,210);assert.equal(h.win.getBounds().width,210);assert.equal(h.win.sent.at(-1)[1].size,210);
 h.command('top',true);assert.equal(h.win.top,true);assert.equal(h.win.sent.at(-1)[1].top,true);
 h.pet.show();assert.equal(h.win.visible,true);assert.equal(h.config.pet.enabled,true);
 h.command('hide');assert.equal(h.win.visible,false);assert.equal(h.config.pet.enabled,false);assert.ok(h.saves()>3);h.pet.stop();
});
test('restored and expanded bounds remain in work area; cleanup removes IPC and destroys window',async()=>{
 const h=harness({pet:{x:9000,y:-100,size:1000}});await Promise.resolve();
 const inside=()=>{const b=h.win.getBounds();assert.ok(b.x>=0&&b.y>=0&&b.x+b.width<=1000&&b.y+b.height<=800);};inside();assert.equal(h.win.getBounds().width,720);
 h.command('expand',true);inside();assert.equal(h.win.getBounds().height,735);assert.equal(h.win.sent.at(-1)[1].expanded,true);
 h.command('expand',false);inside();h.pet.stop();assert.equal(h.handlers.size,0);assert.equal(h.win.dead,true);
});
test('session navigation only accepts admitted session keys',async()=>{
 const h=harness();await Promise.resolve();h.command('open','https://evil.example');assert.deepEqual(h.opened,[]);
 h.pet.event({type:'connection',connected:true});h.pet.event({type:'snapshot',sessions:[{key:'agent:a:main',agentId:'a',hasActiveRun:true}],complete:true});h.command('open','agent:a:main');assert.deepEqual(h.opened,['agent:a:main']);h.pet.stop();
});

test('old default migrates to the upstream 462 by 260 stage',()=>{const h=harness({pet:{size:190}});assert.equal(h.win.opts.width,462);assert.equal(h.win.opts.height,260);h.pet.stop();});

test('right click exposes work status and roaming without changing visibility',()=>{
 const h=harness();h.win.webContents.emit('context-menu');
 const menu=h.menu();assert.ok(menu.find(item=>item.label==='OpenClaw 工作状态'));
 menu.find(item=>item.label==='OpenClaw 工作状态').click();assert.equal(h.win.sent.at(-1)[1].expanded,true);
 menu.find(item=>item.label==='空闲时走动').click({checked:false});assert.equal(h.config.pet.roaming,false);
 h.pet.stop();
});

test('settings stay accessible with a hidden pet, persist live size/visibility and reject remote IPC',async()=>{
 const h=harness();h.pet.openSettings();await Promise.resolve();
 const local=h.windows[1],settings=h.handlers.get('pet:settings');
 const event={sender:local.webContents,senderFrame:local.webContents.mainFrame};
 assert.throws(()=>settings({sender:h.win.webContents,senderFrame:h.win.webContents.mainFrame},'initial'),/Untrusted/);
 assert.equal(settings(event,'initial').size,462);
 assert.equal(settings(event,'update',{size:600,enabled:false,top:false,roaming:false}).ok,true);
 assert.equal(h.win.getBounds().width,600);assert.equal(h.win.visible,false);assert.equal(local.visible,true);assert.equal(h.config.pet.size,600);
 h.pet.openSettings();assert.equal(h.windows.length,2);
 assert.equal(settings(event,'update',{size:Infinity}).ok,false);assert.equal(settings(event,'update',{url:'https://evil.example'}).ok,false);
 h.failSaving();assert.equal(settings(event,'update',{size:400}).ok,false);assert.equal(h.win.getBounds().width,600);assert.equal(h.config.pet.size,600);
 h.pet.stop();assert.equal(h.handlers.size,0);
});

test('walk IPC uses absolute planned positions, ignores stale ids and stops when work starts',()=>{
 const h=harness();h.pet.event({type:'connection',connected:true});h.pet.event({type:'snapshot',sessions:[],complete:true});
 const plan=h.command('walk-plan',{direction:-1});assert.ok(plan);
 h.command('walk-step',{id:plan.id,progress:.5});const halfway=h.win.getBounds().x;
 h.command('walk-step',{id:plan.id,progress:.5});assert.equal(h.win.getBounds().x,halfway);
 h.command('walk-step',{id:plan.id-1,progress:1});assert.equal(h.win.getBounds().x,halfway);
 h.pet.event({type:'snapshot',sessions:[{key:'agent:a:main',agentId:'a',hasActiveRun:true}],complete:true});
 h.command('walk-step',{id:plan.id,progress:1});assert.equal(h.win.getBounds().x,halfway);assert.equal(h.command('walk-plan',{direction:-1}),null);h.pet.stop();
});
