'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {createMusicPanel,musicBounds}=require('../src/music-panel.cjs');
test('music strip and panel stay clear of native captions and track fullscreen positions',()=>{
 assert.deepEqual(musicBounds(1200,false,'win32',false),{x:904,y:0,width:152,height:48});
 assert.deepEqual(musicBounds(720,true,'win32',false,true),{x:256,y:0,width:320,height:520});
 assert.deepEqual(musicBounds(1200,false,'win32',true),{x:1048,y:0,width:152,height:48});
});
test('only packaged top-frame music view can invoke commands; remote UI has no music bridge',async()=>{
 let wc,options;const handlers=new Map();
 class View {
  constructor(opts){options=opts;wc=this.webContents=new EventEmitter();Object.assign(wc,{mainFrame:{url:''},send(){},isDestroyed:()=>false,close(){},setWindowOpenHandler(){},loadURL(url){this.mainFrame.url=url;return Promise.resolve();}});}
  setBounds(){}setVisible(){}setBackgroundColor(){}
 }
 const panel=createMusicPanel({app:{getPath:()=>'/unused'},win:{contentView:{addChildView(){}},isDestroyed:()=>false,getContentSize:()=>[1200,800],isFullScreen:()=>false},WebContentsView:View,ipcMain:{handle:(name,handler)=>handlers.set(name,handler)}});
 const invoke=handlers.get('music:command'),event={sender:wc,senderFrame:wc.mainFrame};
 assert.equal(options.webPreferences.nodeIntegration,false);assert.equal(options.webPreferences.sandbox,true);
 assert.throws(()=>invoke({...event,sender:{}},'next'),/Untrusted/);
 assert.throws(()=>invoke({...event,senderFrame:{url:wc.mainFrame.url}},'next'),/Untrusted/);
 assert.throws(()=>invoke(event,'arbitrary-url'),/Unsupported/);
 assert.equal(invoke(event,'initial').playing,false);
 await invoke(event,'panel');assert.equal(invoke(event,'initial').expanded,true);
 panel.stop();
});
