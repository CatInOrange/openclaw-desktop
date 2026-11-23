'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
function fixture(){
  const nodes=[];
  class Element{
    constructor(tag){this.tag=tag;this.children=[];this.style={};this.hidden=false;this.classes=new Set();this.classList={toggle:(name,on)=>on?this.classes.add(name):this.classes.delete(name)};nodes.push(this);}
    append(...children){for(const c of children){c.parentNode=this;this.children.push(c);}}
    attachShadow(){return this.shadow=new Element('shadow');}
    setAttribute(){} replaceChildren(){this.children=[];}
    querySelector(selector){return nodes.find(n=>selector==='small'?n.tag==='small':selector==='.tools'?n.className==='tools':false);}
    play(){this.playing=true;return Promise.resolve();} pause(){this.playing=false;}
  }
  const events={},document={hidden:false,createElement:tag=>new Element(tag),documentElement:new Element('html'),addEventListener:(name,fn)=>events[name]=fn};
  const context={document,innerHeight:800,location:{origin:'https://example.test'},window:{postMessage(){},addEventListener(){},visualViewport:{height:800,addEventListener(){}}},
    createPetState:()=>({}),summarizePetState:()=>({action:'idle',sessions:[]}),applyPetEvent(){},browser:{runtime:{sendMessage:async()=>({url:'data:video/webm;base64,YQ=='})}}};
  vm.runInNewContext(fs.readFileSync(path.join(root,'android/app/src/main/assets/appearance/pet-mobile.js'),'utf8'),context);
  return {context,nodes,events,document,pet:()=>nodes.find(n=>n.className==='pet'),video:()=>nodes.find(n=>n.tag==='video'),host:()=>nodes.find(n=>n.id==='oc-mobile-pet')};
}
test('keyboard retains a miniature pet, manual collapse survives, and background pauses',async()=>{
  const f=fixture();const settings={allowed:true,petEnabled:true,active:true,keyboardVisible:false};
  f.context.ocApplyPetSettings(settings);await new Promise(setImmediate);
  assert.equal(f.pet().hidden,false);assert.equal(f.video().playing,true);
  f.context.ocApplyPetSettings({...settings,keyboardVisible:true});await new Promise(setImmediate);
  assert.equal(f.pet().hidden,false);assert.equal(f.pet().classes.has('keyboard'),true);
  f.nodes.find(n=>n.title==='收起小宠').onclick();
  assert.equal(f.pet().hidden,true);assert.equal(f.video().playing,false);
  f.context.ocApplyPetSettings(settings);assert.equal(f.pet().hidden,true);
  f.nodes.find(n=>n.title==='展开小宠').onclick();assert.equal(f.pet().hidden,false);
  f.context.ocApplyPetSettings({...settings,active:false});assert.equal(f.host().hidden,true);assert.equal(f.video().playing,false);
  f.context.ocApplyPetSettings(settings);assert.equal(f.host().hidden,false);
});
test('mobile wallpaper compatibility targets only transcript canvases, never every descendant',()=>{
  const css=fs.readFileSync(path.join(root,'src/background.css'),'utf8');
  const start=css.indexOf('/* New Control UI mobile');
  const compatibility=css.slice(css.indexOf('*/',start)+2);
  assert.match(compatibility,/html\[data-oc-video="on"\] \.shell:not\(\.shell--settings\)/);
  assert.match(compatibility,/\.sidebar-region\.sidebar-region--mobile-host:not\(\.sidebar-region--expanded\):not\(\.sidebar-region--expanded-side\)/);
  assert.match(compatibility,/\[data-mobile-open\] > \.sidebar-region__primary/);
  assert.doesNotMatch(compatibility,/\*|\.chat-mobile-host\s*[,\{]|\.chat-composer\s*[,\{]/);
});
