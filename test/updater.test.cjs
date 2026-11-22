'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs/promises');const path=require('node:path');const os=require('node:os');const {createHash}=require('node:crypto');
const {createUpdater}=require('../src/updater.cjs');
async function harness(responses=[0,0],valid=true,helperFails=false){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'oc updater '));const exe=path.join(dir,'client.exe');await fs.writeFile(exe,'old');let quits=0,replaces=0,requests=0;const messages=[];const config={};const bytes=Buffer.from('new');const hash=valid?createHash('sha256').update(bytes).digest('hex'):'0'.repeat(64);
 const url='https://github.com/CatInOrange/openclaw-desktop/releases/download/v0.4.2/';
 const name='OpenClaw-Desktop-0.4.2-win-x64.exe';
 const updater=createUpdater({platform:'win32',env:{PORTABLE_EXECUTABLE_FILE:exe},app:{isPackaged:true,getVersion:()=> '0.4.1',getPath:()=>dir,quit:()=>quits++},getWindow:()=>null,dialog:{showMessageBox:async options=>{messages.push(options);return {response:responses.shift()??1};}},config,save(){},fetcher:async u=>{requests++;return new Response(u.includes('api.github')?JSON.stringify([{tag_name:'v0.4.2',prerelease:true,body:'notes',assets:[{name,state:'uploaded',size:3,browser_download_url:url+name},{name:'SHA256SUMS',state:'uploaded',browser_download_url:url+'SHA256SUMS'}]}]):u.endsWith('SHA256SUMS')?`${hash}  ${name}`:bytes);},replace:async args=>{if(helperFails)throw new Error('helper failed');assert.equal(args.target,exe);assert.equal(await fs.readFile(args.file,'utf8'),'new');replaces++;}});
 return {updater,config,messages,quits:()=>quits,replaces:()=>replaces,requests:()=>requests,cleanup:()=>fs.rm(dir,{recursive:true,force:true})};
}
test('updater requires restart approval, prevents duplicate runs, and quits only after helper readiness',async()=>{
 const h=await harness();try{await Promise.all([h.updater.check(),h.updater.check()]);assert.equal(h.quits(),1);assert.equal(h.replaces(),1);assert.equal(h.requests(),3);}finally{await h.cleanup();}
});
test('declining restart or failing verification never quits or replaces the current client',async()=>{
 for(const [responses,valid]of [[[0,1],true],[[0,0],false],[[1],true]]){const h=await harness(responses,valid);try{await h.updater.check();assert.equal(h.quits(),0);assert.equal(h.replaces(),0);}finally{await h.cleanup();}}
});
test('update channel persists only on an explicit menu selection',async()=>{
 const h=await harness();try{const entry=h.updater.menu().find(item=>item.submenu);entry.submenu[1].click();assert.equal(h.config.updates.channel,'stable');assert.equal(h.requests(),0);}finally{await h.cleanup();}
});

test('an unavailable update helper keeps the current client running',async()=>{
 const h=await harness([0,0],true,true);try{await h.updater.check();assert.equal(h.quits(),0);assert.ok(h.messages.some(m=>m.type==='error'&&m.detail==='helper failed'));}finally{await h.cleanup();}
});
