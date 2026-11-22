'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{createHash}=require('node:crypto');
const {buildDirectoryPackage}=require('../scripts/build-directory-package.cjs');
test('directory distribution contains a stable launcher, a strict version pointer and a complete hashed inventory',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'oc-dir-package-'));
 try {
  const input=path.join(root,'input'),output=path.join(root,'directory'),launcher=path.join(root,'launcher.exe');
  await fs.mkdir(path.join(input,'resources'),{recursive:true});await fs.writeFile(path.join(input,'OpenClaw Desktop.exe'),'runtime');await fs.writeFile(path.join(input,'resources','app.asar'),'archive');await fs.writeFile(launcher,'native launcher');
  const result=await buildDirectoryPackage({input,output,launcher,version:'0.4.7'});assert.equal(result.files,2);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(output,'current.json'),'utf8')),{schema:1,version:'0.4.7'});
  assert.equal(await fs.readFile(path.join(output,'OpenClaw.exe'),'utf8'),'native launcher');
  const versionRoot=path.join(output,'versions','0.4.7'),manifest=JSON.parse(await fs.readFile(path.join(versionRoot,'update-manifest.json'),'utf8'));
  assert.equal(manifest.schema,1);assert.equal(manifest.version,'0.4.7');assert.equal(manifest.files.length,2);
  for(const entry of manifest.files){const bytes=await fs.readFile(path.join(versionRoot,entry.path));assert.equal(entry.size,bytes.length);assert.equal(entry.sha256,createHash('sha256').update(bytes).digest('hex'));assert.ok(!entry.path.includes('\\'));}
  await assert.rejects(buildDirectoryPackage({input,output:path.join(root,'live-install'),launcher,version:'0.4.7'}),/staging path/);
  await assert.rejects(buildDirectoryPackage({input,output,launcher,version:'../escape'}),/version/);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
