'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');
test('renderer keeps audio on panel changes, pauses/resumes in place and forwards ended with a stale-event token',async()=>{
 const elements=new Map(),commands=[];let receive,loads=0,plays=0;
 const get=id=>{
  if(!elements.has(id)) elements.set(id,{dataset:{},style:{setProperty(){}},handlers:{},setAttribute(){},removeAttribute(){},addEventListener(name,fn){this.handlers[name]=fn;}});
  return elements.get(id);
 };
 const makeAudio=()=>{const item={dataset:{},handlers:{},paused:true,preload:'',removeAttribute(){},addEventListener(name,fn){this.handlers[name]=fn;},replaceWith(next){elements.set('audio',next);},load(){loads++;},pause(){this.paused=true;},play(){plays++;this.paused=false;return Promise.resolve();}};return item;};
 elements.set('audio',makeAudio());
 const context=vm.createContext({document:{getElementById:get,createElement:()=>makeAudio(),documentElement:get('html')},window:{music:{command:(...args)=>{commands.push(args);return Promise.resolve({playing:false,token:0});},onState:fn=>{receive=fn;}}}});
 vm.runInContext(fs.readFileSync(require.resolve('../src/music.js'),'utf8'),context);await Promise.resolve();
 const state={authenticated:true,track:{id:1,name:'track',url:'https://music.example/a.mp3'},token:1,playing:true};
 receive(state);await Promise.resolve();assert.equal(plays,1);const before=loads;
 receive({...state,expanded:true});receive({...state,expanded:false});assert.equal(loads,before);assert.equal(get('audio').paused,false);
 receive({...state,playing:false});assert.equal(get('audio').paused,true);
 receive(state);await Promise.resolve();assert.equal(get('audio').paused,false);assert.equal(loads,before);
 get('audio').handlers.ended();assert.ok(commands.some(x=>x[0]==='ended'&&x[1]===1));
 const retired=get('audio');const beforeEvents=commands.length;
 receive({...state,token:2,track:{...state.track,url:'https://music.example/b.mp3'}});assert.equal(loads,before+2);retired.handlers.ended();retired.handlers.error();retired.handlers.playing();assert.equal(commands.length,beforeEvents);
});
