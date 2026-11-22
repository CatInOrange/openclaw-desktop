'use strict';
// Electron Node mode only: no BrowserWindow, Chromium renderer, or virtual display.
// Measures portable bootstrap/extraction separately from unpacked Node startup.
const fs=require('node:fs'),fsp=fs.promises,path=require('node:path'),os=require('node:os');
const {spawn}=require('node:child_process');
async function measure(exe,label,samples,root) {
 const values=[];
 for(let index=0;index<samples;index++) {
  const report=path.join(root,`${label}-${index}.json`),script=path.join(root,'probe.cjs');
  const before=Date.now();
  const child=spawn(exe,[script],{windowsHide:true,stdio:'ignore',env:{...process.env,ELECTRON_RUN_AS_NODE:'1',OPENCLAW_START_REPORT:report}});
  let spawnError;child.on('error',e=>{spawnError=e;});
  let found;
  for(let n=0;n<900;n++) {
   if(spawnError)throw spawnError;
   try {found=JSON.parse(await fsp.readFile(report,'utf8'));break;}catch{}
   await new Promise(resolve=>setTimeout(resolve,100));
  }
  if(!found){child.kill();throw new Error(`${label}: Node-mode probe did not return within 90s`);}
  const item={label,sample:index+1,bootstrapMs:found.at-before,nodeUptimeMs:found.nodeMs,extractedFiles:found.files};
  values.push(item);console.log(JSON.stringify(item));
  // NSIS must finish deleting its disposable extraction directory before next run.
  if(child.exitCode===null) await Promise.race([new Promise(resolve=>child.once('exit',resolve)),new Promise(resolve=>{const t=setTimeout(resolve,10000);t.unref();})]);
 }
 return values;
}
(async()=>{
 if(process.platform!=='win32')throw new Error('Windows portable comparison only');
 const root=await fsp.mkdtemp(path.join(os.tmpdir(),'oc-bootstrap-'));
 try {
  await fsp.writeFile(path.join(root,'probe.cjs'),`const fs=require('node:fs'),path=require('node:path');const at=Date.now(),nodeMs=Math.round(performance.now());function count(dir){let n=0;for(const e of fs.readdirSync(dir,{withFileTypes:true})){if(e.isDirectory())n+=count(path.join(dir,e.name));else n++;}return n;}fs.writeFileSync(process.env.OPENCLAW_START_REPORT,JSON.stringify({at,nodeMs,files:count(path.dirname(process.execPath))}));`);
  const results=[];
  if(process.argv[2])results.push(...await measure(path.resolve(process.argv[2]),'previous-portable',2,root));
  results.push(...await measure(path.resolve(`dist/OpenClaw-Desktop-${require('../package.json').version}-win-x64.exe`),'new-portable',2,root));
  results.push(...await measure(path.resolve('dist/win-unpacked/OpenClaw Desktop.exe'),'unpacked',2,root));
  await fsp.writeFile('dist/STARTUP-MEASUREMENTS.json',JSON.stringify({method:'Electron Node-mode bootstrap, not GUI time-to-interactive',results},null,2));
 }finally{await fsp.rm(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
