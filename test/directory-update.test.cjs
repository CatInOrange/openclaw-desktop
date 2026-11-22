'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {EventEmitter}=require('node:events');
const {safeVersion,detectDirectoryInstall,writableDirectoryInstall,acknowledgeDirectoryLaunch,launchDirectoryReplacement}=require('../src/directory-update.cjs');
async function fixture(){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),"oc directory's [space] ")),version='0.4.7',folder=path.join(root,'versions',version),exe=path.join(folder,'OpenClaw Desktop.exe');
 await fs.mkdir(folder,{recursive:true});await fs.mkdir(path.join(root,'.update'));await fs.writeFile(exe,'old');await fs.writeFile(path.join(root,'OpenClaw.exe'),'launcher');await fs.writeFile(path.join(root,'current.json'),JSON.stringify({schema:1,version}));
 return {root,version,exe,folder,cleanup:()=>fs.rm(root,{recursive:true,force:true})};
}
test('managed install must match the current pointer, real executable location and fixed launcher',async()=>{
 const f=await fixture();try {
  assert.ok(safeVersion('0.4.7-beta.1'));for(const value of ['../oops','0.4.7/evil','v0.4.7',null])assert.equal(safeVersion(value),false);
  const install=await detectDirectoryInstall(f);assert.equal(install.root,f.root);await writableDirectoryInstall(install);
  assert.equal(await detectDirectoryInstall({...f,rootHint:os.tmpdir()}),null);
  assert.equal(await detectDirectoryInstall({...f,version:'0.4.8'}),null);
  await fs.writeFile(path.join(f.root,'current.json'),JSON.stringify({schema:1,version:'../outside'}));assert.equal(await detectDirectoryInstall(f),null);
 }finally{await f.cleanup();}
});
test('health acknowledgement is confined to the active install and a fresh random token',async()=>{
 const f=await fixture(),token='ab'.repeat(24);try {
  assert.equal(await acknowledgeDirectoryLaunch({...f,rootHint:f.root,token}),true);
  assert.equal(await fs.readFile(path.join(f.root,'.update',`health-${token}.json`),'utf8'),token);
  for(const invalid of ['../oops','bad','a'.repeat(47)])assert.equal(await acknowledgeDirectoryLaunch({...f,rootHint:f.root,token:invalid}),false);
  assert.equal(await acknowledgeDirectoryLaunch({...f,rootHint:f.root,version:'0.4.8',token}),false);
  await assert.rejects(acknowledgeDirectoryLaunch({...f,rootHint:f.root,token}));
 }finally{await f.cleanup();}
});
test('a version symlink cannot masquerade as a managed install',async t=>{
 const f=await fixture();try{
  await fs.rm(f.folder,{recursive:true});const outside=path.join(f.root,'outside');await fs.mkdir(outside);await fs.writeFile(path.join(outside,'OpenClaw Desktop.exe'),'external');
  try {await fs.symlink(outside,f.folder,process.platform==='win32'?'junction':'dir');}catch(error){if(error.code==='EPERM'){t.skip('symlink privilege unavailable');return;}throw error;}
  assert.equal(await detectDirectoryInstall(f),null);
 }finally{await f.cleanup();}
});
test('native directory handoff commits only the matching receipt and passes independent helper arguments',async()=>{
 const f=await fixture();try {
  const install=await detectDirectoryInstall(f),directory=path.join(f.root,'handoff');await fs.mkdir(directory);let received;
  await launchDirectoryReplacement({install,helperSource:install.launcher,directory,file:path.join(directory,'download.zip'),hash:'ab'.repeat(32),result:path.join(f.root,'result.json'),version:'0.4.8'},(_command,args,options)=>{
   received={args,options};const child=new EventEmitter();child.unref=()=>{};
   void fs.readFile(args[1],'utf8').then(JSON.parse).then(p=>fs.writeFile(p.ready,p.token));return child;
  });
  assert.equal(received.args[0],'--apply');assert.equal(received.options.cwd,directory);assert.equal(received.options.detached,true);assert.equal(received.options.shell,undefined);
  const payload=JSON.parse(await fs.readFile(received.args[1],'utf8'));
  assert.equal(payload.fromVersion,'0.4.7');assert.equal(payload.root,f.root);assert.match(payload.token,/^[a-f0-9]{48}$/);assert.equal(await fs.readFile(payload.commit,'utf8'),payload.token);
 }finally{await f.cleanup();}
});
test('missing/wrong native receipt cancels a directory handoff without switching the current pointer',async()=>{
 const f=await fixture();try {
  const install=await detectDirectoryInstall(f),directory=path.join(f.root,'handoff');await fs.mkdir(directory);let payload;
  await assert.rejects(launchDirectoryReplacement({install,helperSource:install.launcher,directory,file:'unused.zip',hash:'ab'.repeat(32),result:path.join(f.root,'result.json'),version:'0.4.8',timeoutMs:100},(_command,args)=>{
   const child=new EventEmitter();child.unref=()=>{};void fs.readFile(args[1],'utf8').then(JSON.parse).then(p=>{payload=p;return fs.writeFile(p.ready,'wrong');});return child;
  }),/客户端未退出/);
  await assert.rejects(fs.access(payload.commit));assert.equal(await fs.readFile(payload.cancel,'utf8'),payload.token);
  assert.equal(JSON.parse(await fs.readFile(path.join(f.root,'current.json'))).version,'0.4.7');
 }finally{await f.cleanup();}
});
