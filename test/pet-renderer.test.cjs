'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
test('pet renderer initializes with the immutable preload bridge and plays idle without a Gateway',()=>{
 const elements=new Map();let receive,plays=0;
 const get=key=>{
  if(!elements.has(key))elements.set(key,{style:{setProperty(){}},classList:{toggle(){}},getContext:()=>({}),play:()=>{plays++;return Promise.resolve();},replaceChildren(){},append(){}});
  return elements.get(key);
 };
 const context=vm.createContext({document:{querySelector:get,getElementById:id=>get('#'+id),documentElement:get('html'),addEventListener(){}},console});
 // Electron contextBridge exposes an immutable own property on the global.
 const bridge={command:()=>Promise.resolve(),onState:fn=>{receive=fn;}};
 Object.defineProperty(context,'pet',{value:bridge,writable:false,configurable:false});
 context.window=context;
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/pet.js'),'utf8'),context);
 assert.equal(typeof receive,'function');
 receive({action:'offline',connected:false,complete:false,sessions:[]});
 assert.equal(get('video').src,'../assets/pet/idle.webm');
 assert.equal(plays,1);
 assert.equal(get('#connection').textContent,'连接中断');
 receive({action:'working',connected:true,complete:true,activeAgents:2,sessions:[]});
 assert.equal(get('video').src,'../assets/pet/working.webm');
 assert.equal(get('#connection').textContent,'2 个 Agent 工作中');
 receive({action:'idle',connected:true,complete:true,sessions:[]});
 get('video').onended();
 assert.match(get('video').src,/idle-(cube|juggle|swing)\.webm$/);
 const idleSource=get('video').src;
 receive({action:'idle',connected:true,complete:true,sessions:[]});
 assert.equal(get('video').src,idleSource);
 receive({action:'working',connected:true,complete:true,sessions:[]});
 assert.equal(get('video').src,'../assets/pet/working.webm');
});
