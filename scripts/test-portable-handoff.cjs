'use strict';
// Actual Node -> hidden Windows PowerShell -> receipt/commit -> EXE replace.
// Only disposable system console utilities are launched; no Electron GUI.
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const assert=require('node:assert/strict'),{createHash}=require('node:crypto'),{spawn}=require('node:child_process');
const {launchReplacement}=require('../src/portable-update.cjs');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function main(){
 assert.equal(process.platform,'win32');
 if(process.argv[2]==='--caller'){await launchReplacement(JSON.parse(await fs.readFile(process.argv[3],'utf8')));return;}
 const root=await fs.mkdtemp(path.join(os.tmpdir(),"openclaw 启动 [test]'s "));
 try{
  for(const corrupt of [false,true]){
   const dir=path.join(root,corrupt?'hash failure':'success');await fs.mkdir(dir);
   const target=path.join(dir,'client.exe'),file=path.join(dir,'download.exe'),result=path.join(dir,'result.json');
   await fs.copyFile(path.join(process.env.SystemRoot,'System32','where.exe'),target);
   await fs.copyFile(path.join(process.env.SystemRoot,'System32','whoami.exe'),file);
   const oldHash=hash(await fs.readFile(target)),newHash=hash(await fs.readFile(file));let child;
   await launchReplacement({target,file,hash:corrupt?'0'.repeat(64):newHash,directory:dir,result,version:'test',pid:2147483647},(...args)=>{child=spawn(...args);return child;});
   await new Promise((resolve,reject)=>{
    if(child.exitCode!==null)return resolve();const timer=setTimeout(()=>reject(new Error('Helper did not settle')),30000);
    child.once('exit',()=>{clearTimeout(timer);resolve();});child.once('error',e=>{clearTimeout(timer);reject(e);});
   });
   const outcome=JSON.parse((await fs.readFile(result,'utf8')).replace(/^\uFEFF/,''));
   assert.equal(outcome.phase,corrupt?'failed':'installed');
   assert.equal(hash(await fs.readFile(target)),corrupt?oldHash:newHash);
   if(!corrupt)assert.equal(hash(await fs.readFile(target+'.previous.exe')),oldHash);
  }
  // Production order: caller really exits, then helper verifies and replaces.
  const dir=path.join(root,'real parent exit');await fs.mkdir(dir);
  const target=path.join(dir,'client.exe'),file=path.join(dir,'download.exe'),result=path.join(dir,'result.json');
  await fs.copyFile(path.join(process.env.SystemRoot,'System32','where.exe'),target);await fs.copyFile(path.join(process.env.SystemRoot,'System32','whoami.exe'),file);
  const oldHash=hash(await fs.readFile(target)),newHash=hash(await fs.readFile(file)),input=path.join(dir,'caller.json');
  await fs.writeFile(input,JSON.stringify({target,file,hash:newHash,directory:dir,result,version:'test'}));
  const caller=spawn(process.execPath,[__filename,'--caller',input],{windowsHide:true,stdio:['ignore','pipe','pipe']});let output='';caller.stdout.on('data',b=>{output+=b;});caller.stderr.on('data',b=>{output+=b;});
  const code=await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(new Error('Caller did not exit')),40000);caller.once('exit',code=>{clearTimeout(t);resolve(code);});caller.once('error',e=>{clearTimeout(t);reject(e);});});assert.equal(code,0,output);
  const deadline=Date.now()+15000;let outcome;
  while(Date.now()<deadline){try{outcome=JSON.parse((await fs.readFile(result,'utf8')).replace(/^\uFEFF/,''));if(outcome.phase==='failed')throw new Error(outcome.message);await fs.access(file);}catch(e){if(outcome?.phase==='installed'&&e.code==='ENOENT')break;if(e.code!=='ENOENT')throw e;}await new Promise(r=>setTimeout(r,100));}
  assert.equal(outcome?.phase,'installed');assert.equal(hash(await fs.readFile(target)),newHash);assert.equal(hash(await fs.readFile(target+'.previous.exe')),oldHash);
  console.log('Actual hidden PowerShell handoff passed, including real caller exit before replacement.');
 }catch(error){
  for(const name of ['success','hash failure','real parent exit']){try{console.error('HELPER OUTPUT '+name+':\n'+await fs.readFile(path.join(root,name,'result.json.helper.log'),'utf8'));}catch{}}
  throw error;
 }finally{await fs.rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
