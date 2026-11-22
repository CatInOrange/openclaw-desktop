'use strict';
// Actual Node -> detached Windows PowerShell -> receipt/commit -> EXE replace.
// Only disposable system console utilities are launched; no Electron GUI.
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const assert=require('node:assert/strict'),{createHash}=require('node:crypto'),{spawn}=require('node:child_process');
const {launchReplacement}=require('../src/portable-update.cjs');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function main(){
 assert.equal(process.platform,'win32');
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
  console.log('Actual detached PowerShell handoff passed: bootstrap, commit, replace, revalidation failure and preservation.');
 }catch(error){
  for(const name of ['success','hash failure']){try{console.error('HELPER OUTPUT '+name+':\n'+await fs.readFile(path.join(root,name,'result.json.helper.log'),'utf8'));}catch{}}
  throw error;
 }finally{await fs.rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
