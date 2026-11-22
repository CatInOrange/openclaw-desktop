'use strict';
const fs=require('node:fs/promises'),nativeFs=require('node:fs'),path=require('node:path');
const {createHash}=require('node:crypto');
const {safeVersion}=require('../src/directory-update.cjs');
async function digest(file){const hash=createHash('sha256');for await(const part of nativeFs.createReadStream(file))hash.update(part);return hash.digest('hex');}
async function inventory(directory,prefix='') {
 const entries=await fs.readdir(path.join(directory,prefix),{withFileTypes:true}),files=[];
 for(const entry of entries.sort((a,b)=>a.name.localeCompare(b.name,'en'))) {
  const relative=prefix?prefix+'/'+entry.name:entry.name;
  if(entry.isSymbolicLink()||/[\\:]/.test(entry.name)||entry.name.endsWith('.')||entry.name.endsWith(' '))throw new Error('Unsupported packaged path: '+relative);
  if(entry.isDirectory())files.push(...await inventory(directory,relative));
  else if(entry.isFile()) {if(relative==='update-manifest.json')continue;const file=path.join(directory,relative);const stat=await fs.stat(file);files.push({path:relative,size:stat.size,sha256:await digest(file)});}
  else throw new Error('Unsupported packaged entry: '+relative);
 }
 const names=new Set();for(const file of files){const key=file.path.toLowerCase();if(names.has(key))throw new Error('Case-colliding packaged path');names.add(key);}
 return files;
}
async function buildDirectoryPackage({input,output,launcher,version}) {
 if(!safeVersion(version))throw new Error('Invalid directory package version');
 const target=path.join(output,'versions',version);
 await fs.mkdir(path.dirname(output),{recursive:true});
 // Only generated staging directories are replaced, never a live installation.
 if(path.basename(output)!=='directory'||path.resolve(input)===path.resolve(output))throw new Error('Unexpected directory staging path');
 await fs.rm(output,{recursive:true,force:true});
 await fs.mkdir(target,{recursive:true});
 await fs.cp(input,target,{recursive:true,dereference:false});
 const files=await inventory(target);
 for(const required of ['OpenClaw Desktop.exe','resources/app.asar'])if(!files.some(x=>x.path===required))throw new Error('Missing runtime file '+required);
 await fs.writeFile(path.join(target,'update-manifest.json'),JSON.stringify({schema:1,version,files},null,2)+'\n');
 await fs.copyFile(launcher,path.join(output,'OpenClaw.exe'));
 await fs.writeFile(path.join(output,'current.json'),JSON.stringify({schema:1,version},null,2)+'\n');
 return {files:files.length,bytes:files.reduce((n,x)=>n+x.size,0),version,output};
}
if(require.main===module) buildDirectoryPackage({input:path.resolve(process.argv[2]||'dist/win-unpacked'),output:path.resolve('dist/directory'),launcher:path.resolve('src/directory-launcher.exe'),version:require('../package.json').version}).then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={buildDirectoryPackage,inventory};
