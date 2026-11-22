'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');const {spawn}=require('node:child_process');
(async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),"oc ps 中文 [probe]'s "));
 try{
  const script=path.join(root,'probe.ps1');const code="[IO.File]::WriteAllText($env:OC_BOOT_PROBE, 'ok')";await fs.writeFile(script,code);
  for(const encoded of [false,true])for(const pipe of [false,true]){
   const marker=path.join(root,`${encoded}-${pipe}.marker`),output=[];
   const args=['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass',...(encoded?['-EncodedCommand',Buffer.from(code,'utf16le').toString('base64')]:['-File',script])];
   const child=spawn(path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe'),args,{env:{...process.env,OC_BOOT_PROBE:marker},detached:true,windowsHide:true,stdio:[pipe?'pipe':'ignore','pipe','pipe']});
   child.stdout.on('data',b=>output.push(b.toString()));child.stderr.on('data',b=>output.push(b.toString()));if(pipe)child.stdin.end();
   const exit=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});
   let receipt=false;try{receipt=await fs.readFile(marker,'utf8')==='ok';}catch{}
   console.log(JSON.stringify({encoded,pipe,receipt,...exit,output:output.join('')}));
  }
 }finally{await fs.rm(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
