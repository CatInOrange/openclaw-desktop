'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {createMusicApi,createMusicVault}=require('../src/music-api.cjs');
test('real isolated worker initializes dependencies and creates QR locally without a server or network',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'oc-music-worker-'));const api=createMusicApi(dir);
 try {
  const result=await api.call('login_qr_create',{key:'offline-test-key',qrimg:true});
  assert.equal(result.code,200);assert.match(result.data.qrimg,/^data:image\/png;base64,/);
  assert.equal(result.data.qrurl,'https://music.163.com/login?codekey=offline-test-key');
  await assert.rejects(api.call('unblock',{}),/请求失败/);
 } finally {api.stop();fs.rmSync(dir,{recursive:true,force:true});}
});
test('vault stores encrypted bytes, decrypts across instances, deletes on logout and refuses basic_text fallback',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'oc-music-vault-'));
 const storage={isEncryptionAvailable:()=>true,encryptString:x=>Buffer.from(x.split('').reverse().join('')),decryptString:x=>x.toString().split('').reverse().join(''),getSelectedStorageBackend:()=> 'os_crypt'};
 try {
  const vault=createMusicVault(dir,storage);assert.equal(vault.load(),'');assert.equal(vault.save('private-cookie'),true);
  assert.notEqual(fs.readFileSync(path.join(dir,'music-session.bin'),'utf8'),'private-cookie');
  assert.equal(createMusicVault(dir,storage).load(),'private-cookie');
  const insecure=createMusicVault(dir,{...storage,getSelectedStorageBackend:()=> 'basic_text'});
  assert.equal(insecure.save('new-cookie'),false);assert.equal(insecure.load(),'');
  vault.clear();assert.equal(vault.load(),'');
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
