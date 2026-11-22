'use strict';
const fs=require('node:fs/promises');
const nativeFs=require('node:fs');
const path=require('node:path');
const {randomBytes}=require('node:crypto');
const {spawn}=require('node:child_process');
async function writableTarget(target){
 if(!target||!path.isAbsolute(target)||path.extname(target).toLowerCase()!=='.exe')throw new Error('当前不是可原位升级的 Windows 便携版');
 const stat=await fs.lstat(target);if(!stat.isFile()||stat.isSymbolicLink())throw new Error('便携 EXE 路径无效');
 const probe=path.join(path.dirname(target),`.openclaw-write-${process.pid}-${Date.now()}`);
 try{const f=await fs.open(probe,'wx');await f.close();}catch{throw new Error('EXE 所在目录不可写，请先移到你自己的工具目录');}finally{await fs.unlink(probe).catch(()=>{});}
}
async function launchReplacement({target,file,hash,directory,result,version,pid=process.pid,timeoutMs=30000,helperSource=path.join(__dirname,'portable-update-helper.exe')},spawnProcess=spawn){
 await writableTarget(target);
 const helper=path.join(directory,'replace.exe'),payloadPath=path.join(directory,'payload.json'),ready=path.join(directory,'ready');
 const commit=path.join(directory,'commit'),cancel=path.join(directory,'cancel'),token=randomBytes(24).toString('hex');
 const log=result+'.helper.log';
 // readFile works for packed ASAR resources too; no external script path is executed.
 await fs.writeFile(helper,await fs.readFile(helperSource));
 await fs.writeFile(payloadPath,JSON.stringify({target,source:file,hash,result,ready,commit,cancel,token,version,pid}),{mode:0o600});
 const env={...process.env};
 for(const key of Object.keys(env))if(['electron_run_as_node','psmodulepath'].includes(key.toLowerCase()))delete env[key];

 const fd=nativeFs.openSync(log,'a',0o600);let child,spawnError,exitCode,closed=false;
 const closeLog=()=>{if(!closed){closed=true;nativeFs.closeSync(fd);}};
 try{
  // A GUI-subsystem helper has no console host and survives real parent exit.
  child=spawnProcess(helper,[payloadPath],{detached:true,windowsHide:true,stdio:['ignore',fd,fd],env});
  child.on('error',e=>{spawnError=e;closeLog();});child.on('exit',code=>{exitCode=code??-1;closeLog();});child.on('spawn',closeLog);child.unref();
  const deadline=Date.now()+timeoutMs;
  while(Date.now()<deadline){
   if(spawnError)throw new Error('无法启动更新助手：'+spawnError.message);
   if(exitCode!==undefined)throw new Error(`更新助手提前退出（${exitCode}）`);
   let receipt;try{receipt=(await fs.readFile(ready,'utf8')).trim();}catch{}
   if(receipt===token){
    // Only this explicit commit permits the helper to wait for exit and replace.
    // A late helper after timeout cannot silently apply an abandoned update.
    await fs.writeFile(commit,token,{flag:'wx',mode:0o600});return;
   }
   await new Promise(resolve=>setTimeout(resolve,50));
  }
  throw new Error('更新助手启动超过 30 秒，客户端未退出');
 }catch(error){
  await fs.writeFile(cancel,token).catch(()=>{});
  const message=error.message+`\n诊断日志：${log}`;
  await fs.writeFile(result,JSON.stringify({phase:'failed',version,message}),{mode:0o600}).catch(()=>{});
  throw new Error(message);
 }finally{closeLog();}
}
module.exports={writableTarget,launchReplacement};
