'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const {createHash} = require('node:crypto');
const REPO = 'CatInOrange/openclaw-desktop';
const API = `https://api.github.com/repos/${REPO}/releases?per_page=100`;
function version(value) {
 const m = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*))?$/.exec(value || '');
 return m ? {parts:m.slice(1,4).map(Number), pre:m[4]?.split('.') || []} : null;
}
function compare(a,b) {
 const x=version(a),y=version(b);if(!x||!y)throw new Error('版本号无效');
 for(let i=0;i<3;i++)if(x.parts[i]!==y.parts[i])return Math.sign(x.parts[i]-y.parts[i]);
 if(!x.pre.length||!y.pre.length)return x.pre.length===y.pre.length?0:x.pre.length?-1:1;
 for(let i=0;i<Math.max(x.pre.length,y.pre.length);i++) {
  const l=x.pre[i],r=y.pre[i];if(l===r)continue;if(l===undefined)return -1;if(r===undefined)return 1;
  const ln=/^\d+$/.test(l),rn=/^\d+$/.test(r);
  if(ln&&rn)return Math.sign(Number(l)-Number(r));if(ln!==rn)return ln?-1:1;return l<r?-1:1;
 }return 0;
}
function assetURL(value,tag,name) {
 const url=new URL(value);const expected=`/${REPO}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(name)}`;
 if(url.protocol!=='https:'||url.host!=='github.com'||url.pathname!==expected||url.search||url.hash||url.username||url.password)throw new Error('更新资源地址不属于官方发布');
 return url.href;
}
function selectRelease(releases,current,channel='preview',format='portable') {
 if(!['portable','directory'].includes(format))throw new Error('更新包类型无效');
 if(!Array.isArray(releases))throw new Error('更新服务返回格式无效');
 const candidates=releases.filter(r=>!r.draft&&version(r.tag_name)&&(channel==='preview'||(!r.prerelease&&!version(r.tag_name).pre.length))&&compare(r.tag_name,current)>0).sort((a,b)=>compare(b.tag_name,a.tag_name));
 for(const r of candidates){
  const name=`OpenClaw-Desktop-${r.tag_name.replace(/^v/,'')}-win-x64${format==='directory'?'-directory.zip':'.exe'}`;
  const exe=r.assets?.find(a=>a.name===name&&a.state==='uploaded');const sums=r.assets?.find(a=>a.name==='SHA256SUMS'&&a.state==='uploaded');
  if(!exe||!sums)continue;
  if(!(exe.size>0&&exe.size<=1024*1024*1024))throw new Error('更新包大小无效');
  return {version:r.tag_name.replace(/^v/,''),name,size:exe.size,url:assetURL(exe.browser_download_url,r.tag_name,name),sumsURL:assetURL(sums.browser_download_url,r.tag_name,'SHA256SUMS'),notes:String(r.body||'').slice(0,3500)};
 }return null;
}
async function response(fetcher,url,signal){
 const r=await fetcher(url,{signal,credentials:'omit',cache:'no-store',headers:{Accept:'application/vnd.github+json','User-Agent':'OpenClaw-Desktop-Updater'}});
 if(!r.ok)throw new Error(r.status===403||r.status===429?'更新检查受限，请稍后重试':`更新请求失败（HTTP ${r.status}）`);return r;
}
async function smallText(r,max=2*1024*1024){
 let size=0;const parts=[];
 for await(const chunk of r.body){size+=chunk.length;if(size>max)throw new Error('更新元数据过大');parts.push(Buffer.from(chunk));}
 return Buffer.concat(parts).toString('utf8');
}
async function check(fetcher,current,channel,signal,format='portable'){
 const text=await smallText(await response(fetcher,API,signal));return selectRelease(JSON.parse(text),current,channel,format);
}
function checksum(text,name){
 const matches=text.replace(/^\uFEFF/,'').split(/\r?\n/).map(line=>/^([a-fA-F0-9]{64})\s+\*?(.+)$/.exec(line)).filter(m=>m&&m[2]===name);
 if(matches.length!==1)throw new Error('更新包校验信息缺失或重复');return matches[0][1].toLowerCase();
}
async function download(fetcher,release,directory,signal,onProgress=()=>{}) {
 const hash=checksum(await smallText(await response(fetcher,release.sumsURL,signal),65536),release.name);
 await fs.mkdir(directory,{recursive:true});const file=path.join(directory,release.name.endsWith('.zip')?'download.zip':'download.exe');
 const handle=await fs.open(file,'wx');const digest=createHash('sha256');let count=0;
 try {
  const r=await response(fetcher,release.url,signal);
  for await(const chunk of r.body){count+=chunk.length;if(count>release.size)throw new Error('更新包大小超出预期');digest.update(chunk);await handle.writeFile(chunk);onProgress(count,release.size);}
  if(count!==release.size||digest.digest('hex')!==hash)throw new Error('更新包校验失败，未进行替换');
  await handle.sync();await handle.close();return {file,hash};
 }catch(error){await handle.close().catch(()=>{});await fs.unlink(file).catch(()=>{});throw error;}
}
module.exports={API,version,compare,assetURL,selectRelease,checksum,check,download};
