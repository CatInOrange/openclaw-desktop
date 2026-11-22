'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const {check,download}=require('./update-core.cjs');
const {writableTarget,launchReplacement}=require('./portable-update.cjs');
const {detectDirectoryInstall,writableDirectoryInstall,launchDirectoryReplacement}=require('./directory-update.cjs');
function createUpdater({app,dialog,fetcher,config,save,getWindow,onChange=()=>{},platform=process.platform,env=process.env,replace=launchReplacement,directoryReplace=launchDirectoryReplacement}) {
 let busy=false,label='检查更新…',controller=null,applying=false;
 const channel=()=>config.updates?.channel==='stable'?'stable':'preview';
 const resultPath=path.join(app.getPath('userData'),'update-result.json');
 const message=options=>{const win=getWindow();return win&&!win.isDestroyed()?dialog.showMessageBox(win,options):dialog.showMessageBox(options);};
 const setLabel=value=>{if(label!==value){label=value;onChange();}};
 async function run(){
  if(busy)return;
  if(platform!=='win32'||!app.isPackaged){await message({type:'info',message:'自动升级仅支持已打包的 Windows 客户端',detail:'开发模式或其他平台请手动下载对应版本。'});return;}
  busy=true;controller=new AbortController();onChange();let directory,keep=false;
  try {
   const install=env.PORTABLE_EXECUTABLE_FILE?null:await detectDirectoryInstall({exe:app.getPath('exe'),version:app.getVersion(),rootHint:env.OPENCLAW_INSTALL_ROOT});
   if(!env.PORTABLE_EXECUTABLE_FILE&&!install){await message({type:'info',message:'此目录还没有固定更新启动器',detail:'请先手动下载新版目录 ZIP，完整解压后运行根目录 OpenClaw.exe。以后可在此处自动更新。原有登录和设置保留。'});return;}
   const format=install?'directory':'portable';
   if(install)await writableDirectoryInstall(install);else await writableTarget(env.PORTABLE_EXECUTABLE_FILE);
   setLabel('正在检查更新…');
   const release=await check(fetcher,app.getVersion(),channel(),AbortSignal.any([controller.signal,AbortSignal.timeout(30000)]),format);
   if(!release){await message({type:'info',message:'当前已是此通道最新可用版本',detail:`当前 v${app.getVersion()} · ${channel()==='preview'?'预览版':'稳定版'}通道`});return;}
   const choice=await message({type:'info',message:`发现新版本 v${release.version}`,detail:`当前 v${app.getVersion()}\n\n${release.notes||'本次发布未提供更新说明。'}`,buttons:['下载更新','取消'],defaultId:0,cancelId:1});
   if(choice.response!==0||controller.signal.aborted)return;
   directory=await fs.mkdtemp(path.join(app.getPath('temp'),'openclaw-update-'));
   const staged=await download(fetcher,release,directory,AbortSignal.any([controller.signal,AbortSignal.timeout(15*60*1000)]),(count,total)=>setLabel(`正在下载更新：${Math.floor(count*100/total)}%（点击下方可取消）`));
   setLabel('更新已下载，等待确认…');
   const consent=await message({type:'question',message:`v${release.version} 已下载并校验，立即重启升级？`,detail:'只退出桌面客户端，不会重启 Gateway 或取消服务器上的 Agent 工作。请先保存尚未提交的编辑内容。'+(install?'新版本会在退出后校验并部署到独立目录；保留上一版，启动确认失败时自动回退。':'旧 EXE 会保留为 .previous.exe。'),buttons:['重启并升级','暂不升级'],defaultId:1,cancelId:1});
   if(consent.response!==0||controller.signal.aborted)return;
   applying=true;setLabel('正在启动更新助手…');onChange();
   if(install)await directoryReplace({install,...staged,directory,result:resultPath,version:release.version});
   else await replace({target:env.PORTABLE_EXECUTABLE_FILE,...staged,directory,result:resultPath,version:release.version});
   keep=true;app.quit();
  }catch(error){
   if(!controller.signal.aborted)await message({type:'error',message:'未能完成升级，当前客户端保持不变',detail:error.name==='TimeoutError'?'连接超时，请检查网络后重试。':error.message});
  }finally{
   if(directory&&!keep)await fs.rm(directory,{recursive:true,force:true}).catch(()=>{});
   busy=false;applying=false;controller=null;setLabel('检查更新…');onChange();
  }
 }
 return {
  check:run,
  menu:()=>[
   {label,enabled:!busy,click:()=>void run()},
   ...(busy&&!applying?[{label:'取消本次更新',click:()=>controller?.abort()}]:[]),
   {label:`更新通道：${channel()==='preview'?'预览版':'稳定版'}`,enabled:!busy,submenu:['preview','stable'].map(value=>({label:value==='preview'?'预览版（含稳定版）':'仅稳定版',type:'radio',checked:channel()===value,click:()=>{config.updates={...config.updates,channel:value};save();onChange();}}))}
  ],
  async reportPrevious(){
   try{const result=JSON.parse((await fs.readFile(resultPath,'utf8')).replace(/^\uFEFF/,''));await fs.rename(resultPath,resultPath+'.last');if(result.phase==='failed')await message({type:'error',message:'上次升级未成功',detail:result.message+(result.mode==='directory'?'\n固定启动器会使用 current.json 指向的版本；旧版本目录仍保留。':'\n旧版保留在原路径或旁边的 .previous.exe；可从此文件恢复。')});}catch{}
  }
 };
}
module.exports={createUpdater};
