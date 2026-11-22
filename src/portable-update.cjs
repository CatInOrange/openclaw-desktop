'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const {spawn}=require('node:child_process');
async function writableTarget(target){
 if(!target||!path.isAbsolute(target)||path.extname(target).toLowerCase()!=='.exe')throw new Error('当前不是可原位升级的 Windows 便携版');
 const stat=await fs.lstat(target);if(!stat.isFile()||stat.isSymbolicLink())throw new Error('便携 EXE 路径无效');
 const probe=path.join(path.dirname(target),`.openclaw-write-${process.pid}-${Date.now()}`);
 try{const f=await fs.open(probe,'wx');await f.close();}catch{throw new Error('EXE 所在目录不可写，请先移到你自己的工具目录');}finally{await fs.unlink(probe).catch(()=>{});}
}
async function launchReplacement({target,file,hash,directory,result,version,pid=process.pid},spawnProcess=spawn){
 await writableTarget(target);
 const helper=path.join(directory,'replace.ps1'),payloadPath=path.join(directory,'payload.json'),ready=path.join(directory,'ready');
 await fs.copyFile(path.join(__dirname,'portable-update.ps1'),helper);
 await fs.writeFile(payloadPath,JSON.stringify({target,source:file,hash,result,ready,version,pid}),{mode:0o600});
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 const powershell=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
 const child=spawnProcess(powershell,['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',helper,'-PayloadPath',payloadPath],{detached:true,windowsHide:true,stdio:'ignore',env});
 let spawnError;child.on('error',e=>{spawnError=e;});child.unref();
 for(let i=0;i<100;i++){
  if(spawnError)throw new Error('无法启动更新助手：'+spawnError.message);
  try{await fs.access(ready);return;}catch{}
  await new Promise(resolve=>setTimeout(resolve,50));
 }
 // Do not exit the client when the helper did not confirm readiness.
 throw new Error('更新助手未就绪，客户端未退出；请稍后重试');
}
module.exports={writableTarget,launchReplacement};
