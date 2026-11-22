'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{createHash}=require('node:crypto');
const {createUpdater}=require('../src/updater.cjs');const {selectRelease}=require('../src/update-core.cjs');
function release(version,format){const name=`OpenClaw-Desktop-${version}-win-x64${format==='directory'?'-directory.zip':'.exe'}`,url=`https://github.com/CatInOrange/openclaw-desktop/releases/download/v${version}/`;return {tag_name:'v'+version,prerelease:true,assets:[{name,state:'uploaded',size:3,browser_download_url:url+name},{name:'SHA256SUMS',state:'uploaded',browser_download_url:url+'SHA256SUMS'}]};}
test('directory update selection never silently falls back to the portable EXE or an old raw ZIP',()=>{
 const all=[release('0.4.9','portable'),release('0.4.8','directory')];
 assert.equal(selectRelease(all,'0.4.7','preview','directory').version,'0.4.8');assert.equal(selectRelease(all,'0.4.7').version,'0.4.9');
 assert.equal(selectRelease([release('0.4.9','portable')],'0.4.7','preview','directory'),null);
});
async function harness(consent=[0,0],valid=true,helperFails=false){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'oc-managed-updater-')),folder=path.join(root,'versions','0.4.7'),exe=path.join(folder,'OpenClaw Desktop.exe');
 await fs.mkdir(folder,{recursive:true});await fs.writeFile(exe,'old');await fs.writeFile(path.join(root,'OpenClaw.exe'),'launcher');await fs.writeFile(path.join(root,'current.json'),JSON.stringify({schema:1,version:'0.4.7'}));
 let quits=0,replaces=0,requests=0;const messages=[],r=release('0.4.8','directory'),name=r.assets[0].name,bytes=Buffer.from('zip'),hash=valid?createHash('sha256').update(bytes).digest('hex'):'0'.repeat(64);
 const updater=createUpdater({platform:'win32',env:{OPENCLAW_INSTALL_ROOT:root},app:{isPackaged:true,getVersion:()=> '0.4.7',getPath:kind=>kind==='exe'?exe:root,quit:()=>quits++},config:{},save(){},getWindow:()=>null,
  dialog:{showMessageBox:async message=>{messages.push(message);return {response:consent.shift()??1};}},
  fetcher:async url=>{requests++;return new Response(url.includes('api.github')?JSON.stringify([r]):url.endsWith('SHA256SUMS')?`${hash}  ${name}\n`:bytes);},
  replace:()=>{throw new Error('Wrong portable update path');},directoryReplace:async args=>{if(helperFails)throw new Error('directory helper failed');assert.equal(args.install.root,root);assert.equal(path.basename(args.file),'download.zip');assert.equal(await fs.readFile(args.file,'utf8'),'zip');replaces++;},
 });
 return {root,updater,messages,quits:()=>quits,replaces:()=>replaces,requests:()=>requests,cleanup:()=>fs.rm(root,{recursive:true,force:true})};
}
test('managed directory updater downloads the ZIP, asks before exit, and hands off without overwriting the live version',async()=>{
 const h=await harness();try{
  await Promise.all([h.updater.check(),h.updater.check()]);assert.equal(h.quits(),1);assert.equal(h.replaces(),1);assert.equal(h.requests(),3);
  assert.match(h.messages[1].detail,/独立目录/);assert.equal(JSON.parse(await fs.readFile(path.join(h.root,'current.json'),'utf8')).version,'0.4.7');
 }finally{await h.cleanup();}
});
test('declined restart, bad checksum or native helper failure leaves the running directory intact',async()=>{
 for(const [consent,valid,helperFails]of [[[0,1],true,false],[[0,0],false,false],[[0,0],true,true]]){
  const h=await harness(consent,valid,helperFails);try{await h.updater.check();assert.equal(h.quits(),0);assert.equal(h.replaces(),0);assert.equal(JSON.parse(await fs.readFile(path.join(h.root,'current.json'),'utf8')).version,'0.4.7');}finally{await h.cleanup();}
 }
});
