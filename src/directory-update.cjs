'use strict';
const fs=require('node:fs/promises'),nativeFs=require('node:fs'),path=require('node:path');
const {randomBytes}=require('node:crypto');
const {spawn}=require('node:child_process');
const {version:parseVersion}=require('./update-core.cjs');
const safeVersion=value=>typeof value==='string'&&value.length<=80&&!value.startsWith('v')&&!!parseVersion(value);
const samePath=(a,b)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
async function normalFile(file) {const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink())throw new Error('目录版文件路径无效');return stat;}
async function normalDirectory(directory) {const stat=await fs.lstat(directory);if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error('目录版文件夹不能是链接');}
async function detectDirectoryInstall({exe,version,rootHint}) {
 if(!safeVersion(version)||!exe||!path.isAbsolute(exe)||path.basename(exe)!=='OpenClaw Desktop.exe')return null;
 const root=path.resolve(rootHint||path.join(path.dirname(exe),'../..'));
 if(!rootHint&&path.basename(path.dirname(exe))!==version)return null;
 const expected=path.join(root,'versions',version,'OpenClaw Desktop.exe');
 if(!samePath(path.resolve(exe),expected))return null;
 try {
  await normalDirectory(root);await normalDirectory(path.join(root,'versions'));await normalDirectory(path.dirname(expected));
  await normalFile(expected);await normalFile(path.join(root,'OpenClaw.exe'));
  if(!samePath(await fs.realpath(root),root)||!samePath(await fs.realpath(expected),expected))return null;
  const pointerPath=path.join(root,'current.json'),stat=await normalFile(pointerPath);
  if(stat.size>4096)return null;
  const pointer=JSON.parse(await fs.readFile(pointerPath,'utf8'));
  if(pointer.schema!==1||pointer.version!==version||(pointer.previous!=null&&!safeVersion(pointer.previous)))return null;
  return {root,version,launcher:path.join(root,'OpenClaw.exe'),entry:expected,previous:pointer.previous};
 }catch{return null;}
}
async function writableDirectoryInstall(install) {
 await normalDirectory(install.root);
 const probe=path.join(install.root,`.openclaw-write-${randomBytes(12).toString('hex')}`);
 try {await fs.writeFile(probe,'',{flag:'wx',mode:0o600});}catch{throw new Error('程序目录不可写，请先将整个目录移到自己的工具文件夹。');}
 finally {await fs.unlink(probe).catch(()=>{});}
}
async function acknowledgeDirectoryLaunch({rootHint,token,exe,version}) {
 if(!rootHint||typeof token!=='string'||!/^[a-f0-9]{48}$/.test(token))return false;
 const install=await detectDirectoryInstall({rootHint,exe,version});if(!install)return false;
 const directory=path.join(install.root,'.update');await normalDirectory(directory);
 if(!samePath(await fs.realpath(directory),directory))return false;
 const destination=path.join(directory,`health-${token}.json`);
 await fs.writeFile(destination,token,{flag:'wx',mode:0o600});return true;
}
async function launchDirectoryReplacement({install,file,hash,directory,result,version,pid=process.pid,timeoutMs=30000,helperSource=path.join(__dirname,'directory-launcher.exe')},spawnProcess=spawn) {
 await writableDirectoryInstall(install);
 if(!safeVersion(version)||!/^[a-f0-9]{64}$/.test(hash))throw new Error('目录版升级参数无效');
 const helper=path.join(directory,'directory-update.exe'),payloadPath=path.join(directory,'directory-payload.json');
 const ready=path.join(directory,'directory-ready'),commit=path.join(directory,'directory-commit'),cancel=path.join(directory,'directory-cancel');
 const token=randomBytes(24).toString('hex'),log=result+'.helper.log';
 await fs.writeFile(helper,await fs.readFile(helperSource));
 await fs.writeFile(payloadPath,JSON.stringify({root:install.root,source:file,hash,version,fromVersion:install.version,result,ready,commit,cancel,token,pid}),{mode:0o600});
 const env={...process.env};
 for(const key of Object.keys(env))if(['electron_run_as_node','openclaw_launch_token'].includes(key.toLowerCase()))delete env[key];
 const fd=nativeFs.openSync(log,'a',0o600);let child,spawnError,exitCode,closed=false;
 const closeLog=()=>{if(!closed){closed=true;nativeFs.closeSync(fd);}};
 try {
  child=spawnProcess(helper,['--apply',payloadPath],{cwd:directory,detached:true,windowsHide:true,stdio:['ignore',fd,fd],env});
  child.on('error',e=>{spawnError=e;closeLog();});child.on('exit',code=>{exitCode=code??-1;closeLog();});child.on('spawn',closeLog);child.unref();
  const deadline=Date.now()+timeoutMs;
  while(Date.now()<deadline) {
   if(spawnError)throw new Error('无法启动目录更新助手：'+spawnError.message);
   if(exitCode!==undefined)throw new Error(`目录更新助手提前退出（${exitCode}）`);
   let receipt;try{receipt=(await fs.readFile(ready,'utf8')).trim();}catch{}
   if(receipt===token){await fs.writeFile(commit,token,{flag:'wx',mode:0o600});return;}
   await new Promise(resolve=>setTimeout(resolve,50));
  }
  throw new Error('目录更新助手启动超时，客户端未退出');
 }catch(error) {
  await fs.writeFile(cancel,token).catch(()=>{});
  const message=error.message+`\n诊断日志：${log}`;
  await fs.writeFile(result,JSON.stringify({phase:'failed',mode:'directory',version,message}),{mode:0o600}).catch(()=>{});
  throw new Error(message);
 }finally {closeLog();}
}
module.exports={safeVersion,detectDirectoryInstall,writableDirectoryInstall,acknowledgeDirectoryLaunch,launchDirectoryReplacement};
