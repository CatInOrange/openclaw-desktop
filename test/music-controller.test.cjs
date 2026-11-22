'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {MusicController}=require('../src/music-controller.cjs');
function fixture(options={}) {
  let batch=0,requests=[],stored='cookie',likes=new Set([1,2]),changed=[];
  const api={async call(name,args) {
    requests.push({name,args});
    const custom=await options.call?.(name,args);
    if(custom!==undefined)return custom;
    if(name==='login_status')return {data:{profile:{userId:7}}};
    if(name==='user_playlist')return {playlist:[{id:9,specialType:5,creator:{userId:7}}]};
    if(name==='playlist_detail')return {playlist:{trackIds:[{id:1},{id:2}]}};
    if(name==='likelist')return {code:200,ids:[...likes]};
    if(name==='playmode_intelligence_list') {
      const first=++batch*10;
      return {code:200,data:Array.from({length:6},(_,i)=>({songInfo:{id:first+i,name:'song '+(first+i),ar:[{name:'artist'}]}}))};
    }
    if(name==='song_url')return {data:[{code:200,url:`https://music.example/${args.id}.mp3`}]};
    if(name==='song_detail')return {songs:[{id:Number(args.ids),name:'recovered'}]};
    if(name==='like'){if(args.like==='true')likes.add(args.id);else likes.delete(args.id);return {code:200};}
    throw new Error('Unexpected '+name);
  }};
  const vault={load:()=>stored,save:value=>{stored=value;return true;},clear:()=>{stored='';}};
  const controller=new MusicController({api,vault,onChange:state=>changed.push(state),loginInterval:1});
  return {controller,requests,likes,changed,get batches(){return batch;}};
}
test('continuous playback crosses many queue boundaries, never stops at three; prefetch deduplicates',async()=>{
 const f=fixture(),c=f.controller;
 await c.command('toggle'); const played=[];
 for(let i=0;i<40;i++) {
   assert.equal(c.state.playing,true,c.state.message);
   played.push(c.state.track.id);
   await c.command('ended',c.state.token);
 }
 assert.equal(new Set(played).size,40);
 assert.ok(f.batches>=7);
 assert.equal(c.state.playing,true);
 c.stop();
});
test('pause, panel collapse and resume preserve the same track, token and queue',async()=>{
 const f=fixture(),c=f.controller;await c.command('toggle');
 const track=c.state.track,token=c.state.token;
 await c.command('toggle');assert.equal(c.state.playing,false);
 await c.command('panel');await c.command('panel');
 await c.command('toggle');assert.equal(c.state.playing,true);
 assert.equal(c.state.track,track);assert.equal(c.state.token,token);
 assert.equal(f.requests.filter(x=>x.name==='song_url').length,1);
 c.stop();
});
test('duplicate ended/error from an old track cannot double-skip or alter a new track',async()=>{
 const {controller:c}=fixture();await c.command('toggle');const old=c.state.token;
 await Promise.all([c.command('ended',old),c.command('failed',old),c.command('ended',old)]);
 assert.equal(c.state.token,old+1);
 assert.equal(c.state.playing,true);c.stop();
});
test('rapid explicit next commands are serialized and like follows the current track',async()=>{
 const f=fixture(),c=f.controller;await c.command('toggle');
 await Promise.all([c.command('next'),c.command('next'),c.command('like')]);
 assert.equal(c.state.token,3);assert.equal(c.state.track.liked,true);
 const writes=f.requests.filter(x=>x.name==='like');assert.equal(writes[0].args.id,c.state.track.id);
 c.stop();
});
test('unavailable and trial-only tracks are skipped without presenting them as full playback',async()=>{
 let urls=0;
 const {controller:c}=fixture({call:(name)=>{
   if(name==='song_url'&&++urls<=2)return {data:[urls===1?{code:404,url:null}:{code:200,url:'https://music.example/trial',freeTrialInfo:{start:0,end:30}}]};
 }});
 await c.command('toggle');assert.equal(c.state.playing,true);assert.equal(urls,3);c.stop();
});
test('all unplayable tracks stop after a bounded number and remain retryable',async()=>{
 const f=fixture({call:name=>name==='song_url'?{data:[{code:404}]}:undefined}),c=f.controller;
 await c.command('toggle');assert.equal(c.state.playing,false);assert.match(c.state.message,/不可播/);
 assert.equal(f.requests.filter(x=>x.name==='song_url').length,8);
 await c.command('next');assert.equal(f.requests.filter(x=>x.name==='song_url').length,16);c.stop();
});
test('repeated media failures stop after eight until explicit retry; a playing acknowledgement resets the streak',async()=>{
 const {controller:c}=fixture();await c.command('toggle');
 for(let i=0;i<8;i++)await c.command('failed',c.state.token);
 assert.equal(c.state.playing,false);assert.match(c.state.message,/连续歌曲/);
 await c.command('next');assert.equal(c.state.playing,true);
 await c.command('playing',c.state.token);assert.equal(c.failures,0);c.stop();
});
test('a finite recommendation pool recycles rather than ending playback after all unique songs',async()=>{
 const f=fixture({call:name=>name==='playmode_intelligence_list'?{code:200,data:[{songInfo:{id:41,name:'one'}},{songInfo:{id:42,name:'two'}},{songInfo:{id:41,name:'duplicate'}}]}:undefined});
 await f.controller.command('toggle');const played=[];
 for(let n=0;n<12;n++){assert.equal(f.controller.state.playing,true);played.push(f.controller.state.track.id);await f.controller.command('ended',f.controller.state.token);}
 assert.equal(new Set(played).size,2);for(let n=1;n<played.length;n++)assert.notEqual(played[n],played[n-1]);f.controller.stop();
});
test('empty recommendations stop clearly after bounded retries',async()=>{
 const f=fixture({call:name=>name==='playmode_intelligence_list'?{code:200,data:[]}:undefined});
 await f.controller.command('toggle');assert.equal(f.controller.state.playing,false);assert.match(f.controller.state.message,/没有心动推荐/);
 assert.equal(f.requests.filter(x=>x.name==='playmode_intelligence_list').length,3);f.controller.stop();
});
test('metadata-free recommendations are completed before presentation',async()=>{
 const {controller:c}=fixture({call:name=>name==='playmode_intelligence_list'?{code:200,data:[{id:99}]}:undefined});
 await c.command('toggle');assert.equal(c.state.track.name,'recovered');c.stop();
});
test('failed like writes never flip the displayed red heart',async()=>{
 const {controller:c}=fixture({call:name=>name==='like'?{code:500}:undefined});await c.command('toggle');
 await c.command('like');assert.equal(c.state.track.liked,false);assert.match(c.state.message,/同步失败/);assert.equal(c.state.playing,true);c.stop();
});
test('empty liked playlist does not silently switch to FM or daily recommendations',async()=>{
 const {controller:c}=fixture({call:name=>name==='playlist_detail'?{playlist:{trackIds:[]}}:undefined});
 await c.command('toggle');assert.equal(c.state.playing,false);assert.match(c.state.message,/歌单为空/);c.stop();
});
test('expired login clears the vault, stops playback and supports new QR login',async()=>{
 let expired=false;
 const {controller:c}=fixture({call:name=>name==='song_url'&&expired?{code:301}:undefined});
 await c.command('toggle');expired=true;await c.command('next');
 assert.equal(c.cookie,'');assert.equal(c.state.authenticated,false);assert.equal(c.state.playing,false);c.stop();
});
test('logout resets queues, invalidates old audio events and removes credentials',async()=>{
 const {controller:c}=fixture();await c.command('toggle');const token=c.state.token;
 await c.command('logout');await c.command('ended',token);
 assert.equal(c.cookie,'');assert.equal(c.queue.length,0);assert.equal(c.state.track,null);assert.equal(c.state.playing,false);c.stop();
});
test('QR login polls confirmation, encrypts through the vault and can start heart mode afterwards',async()=>{
 let saved='',changed;const done=new Promise(resolve=>{changed=resolve;});
 const f=fixture({call:(name)=>{
  if(name==='login_qr_key')return {data:{unikey:'key'}};
  if(name==='login_qr_create')return {data:{qrimg:'data:image/png;base64,dGVzdA=='}};
  if(name==='login_qr_check')return {code:803,cookie:'confirmed'};
 }}),c=f.controller;
 c.vault={load:()=>'',save:value=>{saved=value;return true;},clear(){}};c.cookie='';
 const original=c.onChange;c.onChange=state=>{original(state);if(state.authenticated)changed();};
 await c.command('toggle');assert.ok(c.state.qr);assert.equal(c.state.expanded,true);
 await done;assert.equal(saved,'confirmed');assert.equal(c.state.authenticated,true);
 await c.command('toggle');assert.equal(c.state.playing,true);c.stop();
});
