const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
test('ten original pet animations have pinned bytes and separate attribution',()=>{
 const root=path.join(__dirname,'../assets/pet');
 const manifest=require('../assets/pet/SHA256.json');
 assert.equal(Object.keys(manifest).length,10);
 for(const [file,hash] of Object.entries(manifest)) assert.equal(createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex'),hash);
 assert.match(fs.readFileSync(path.join(root,'NOTICE.md'),'utf8'),/禁止商用/);
});
