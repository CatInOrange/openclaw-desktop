'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs/promises');const path=require('node:path');const os=require('node:os');const {createHash}=require('node:crypto');
const {compare,selectRelease,checksum,download,check,API}=require('../src/update-core.cjs');
const {writableTarget}=require('../src/portable-update.cjs');
function release(tag='v0.4.2',pre=true){const name=`OpenClaw-Desktop-${tag.slice(1)}-win-x64.exe`;return {tag_name:tag,prerelease:pre,assets:[name,'SHA256SUMS'].map(name=>({name,state:'uploaded',size:4,browser_download_url:`https://github.com/CatInOrange/openclaw-desktop/releases/download/${tag}/${name}`}))};}
test('release selection respects semantic ordering, channel, incomplete and draft releases',()=>{
 assert.equal(compare('0.4.10','0.4.9'),1);assert.equal(compare('0.4.1','0.4.1-beta.9'),1);assert.equal(compare('0.4.1-beta.10','0.4.1-beta.2'),1);
 const list=[release('v0.4.9'),release('v0.4.3',false),{...release('v0.5.0'),draft:true},{...release('v0.6.0'),assets:[]}];
 assert.equal(selectRelease(list,'0.4.1','stable').version,'0.4.3');assert.equal(selectRelease(list,'0.4.1','preview').version,'0.4.9');assert.equal(selectRelease(list,'0.4.9'),null);
 const wrong=release();wrong.assets[0].browser_download_url='https://example.com/evil.exe';assert.throws(()=>selectRelease([wrong],'0.4.1'),/官方/);
});
test('checksums require exactly one exact filename',()=>{
 const hash='ab'.repeat(32);assert.equal(checksum(`\uFEFF${hash}  app.exe\r\n`,'app.exe'),hash);
 assert.throws(()=>checksum(`${hash}  other.exe`,'app.exe'));assert.throws(()=>checksum(`${hash}  app.exe\n${hash}  app.exe`,'app.exe'));
});
test('download verifies bytes and deletes truncated or mismatched files',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'oc-update-'));
 try{
  const r=selectRelease([release()],'0.4.1'),body=Buffer.from('test');const good=createHash('sha256').update(body).digest('hex');
  for(const [name,data,hash,ok]of [['ok',body,good,true],['bad-hash',body,'0'.repeat(64),false],['truncated',Buffer.from('bad'),good,false],['oversize',Buffer.from('too long'),good,false]]){
   const dir=path.join(root,name);let progress=0;
   const fetcher=async url=>new Response(url===r.sumsURL?`${hash}  ${r.name}\n`:data);
   const task=download(fetcher,r,dir,new AbortController().signal,n=>{progress=n;});
   if(ok){const result=await task;assert.deepEqual(await fs.readFile(result.file),body);assert.equal(progress,4);}else{await assert.rejects(task);await assert.rejects(fs.access(path.join(dir,'download.exe')));}
  }
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('update checks are unauthenticated, fail visibly on rate limits and use public releases',async()=>{
 const result=await check(async(url,opts)=>{assert.equal(url,API);assert.equal(opts.credentials,'omit');assert.equal(opts.headers.Authorization,undefined);return new Response(JSON.stringify([release()]));},'0.4.1','preview');assert.equal(result.version,'0.4.2');
 await assert.rejects(check(async()=>new Response('',{status:403}),'0.4.1','preview'),/受限/);
});
test('portable target preflight handles paths with spaces, rejects missing EXEs and removes probes',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'oc portable '));try{
  const exe=path.join(dir,"client's [test].exe");await fs.writeFile(exe,'test');await writableTarget(exe);assert.deepEqual(await fs.readdir(dir),[path.basename(exe)]);
  await assert.rejects(writableTarget(path.join(dir,'missing.exe')));await assert.rejects(writableTarget('relative.exe'));
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
module.exports={release};

test('helper launch uses argument arrays and waits for its readiness receipt before allowing exit',async()=>{
 const {launchReplacement}=require('../src/portable-update.cjs');const {EventEmitter}=require('node:events');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),"oc helper's [space] "));
 try{
  const exe=path.join(dir,"client's app.exe");await fs.writeFile(exe,'old');let received;
  await launchReplacement({target:exe,file:path.join(dir,'download.exe'),hash:'ab'.repeat(32),directory:dir,result:path.join(dir,'result.json'),version:'0.4.2'},(_command,args,options)=>{
   received={args,options};const child=new EventEmitter();child.unref=()=>{};
   void fs.readFile(args.at(-1),'utf8').then(JSON.parse).then(p=>fs.writeFile(p.ready,'ready'));
   return child;
  });
  assert.equal(received.options.detached,true);assert.equal(received.options.shell,undefined);assert.equal(received.args.at(-1),path.join(dir,'payload.json'));
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
