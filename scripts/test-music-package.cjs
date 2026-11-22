'use strict';
// Artifact + actual Electron Node runtime verification. Never starts Chromium/a GUI.
const fs=require('node:fs');const path=require('node:path');const os=require('node:os');
const {spawnSync}=require('node:child_process');const assert=require('node:assert/strict');
const {extractFile,statFile}=require('@electron/asar');
const resources=path.resolve(process.argv[2]||'dist/win-unpacked/resources');
const archive=path.join(resources,'app.asar');
for(const name of ['music-api.cjs','music-worker.cjs','music-controller.cjs','music-panel.cjs','music-preload.cjs','music.html','music.js','music.css'])assert.ok(extractFile(archive,path.normalize('src/'+name)).length);
assert.equal(statFile(archive,path.normalize('src/music-worker.cjs')).unpacked,true);
assert.equal(statFile(archive,path.normalize('node_modules/@neteasecloudmusicapienhanced/api/module/song_url.js')).unpacked,true);
const root=path.dirname(resources);
const electron=process.platform==='win32'?path.join(root,'OpenClaw Desktop.exe'):path.join(root,'openclaw-desktop-shell');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'oc-music-package-'));
const script=path.join(directory,'probe.cjs');
fs.writeFileSync(script,`
 const {createMusicApi}=require(${JSON.stringify(path.join(archive,'src/music-api.cjs'))});
 const api=createMusicApi(${JSON.stringify(directory)});
 (async()=>{try{const qr=await api.call('login_qr_create',{key:'offline-packaged-test',qrimg:true});if(!qr.data?.qrimg?.startsWith('data:image/png;base64,'))throw new Error('No QR');console.log('PACKAGED_MUSIC_WORKER_OK');}finally{api.stop();}})().catch(()=>{process.exitCode=1;});
`);
try {
 const result=spawnSync(electron,[script],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},encoding:'utf8',timeout:45000,windowsHide:true});
 assert.equal(result.status,0,`${result.error?.message||''} ${result.stderr}`);
 assert.match(result.stdout,/PACKAGED_MUSIC_WORKER_OK/);
 console.log('Packaged music dependency, isolated worker and QR verified with Electron runtime (non-GUI)');
} finally {fs.rmSync(directory,{recursive:true,force:true});}
