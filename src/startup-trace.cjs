'use strict';
const fs=require('node:fs'),path=require('node:path');
function createStartupTrace(app) {
 const id=Date.now().toString(36);let file;
 return stage=>{
  try {
   if(!file){file=path.join(app.getPath('userData'),'startup.log');fs.mkdirSync(path.dirname(file),{recursive:true});if(fs.existsSync(file)&&fs.statSync(file).size>65536)fs.renameSync(file,file+'.last');}
   fs.appendFileSync(file,JSON.stringify({session:id,version:app.getVersion(),stage,nodeMs:Math.round(performance.now())})+'\n',{mode:0o600});
  }catch{}
 };
}
module.exports={createStartupTrace};
