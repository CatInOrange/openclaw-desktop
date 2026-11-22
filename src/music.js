'use strict';
const $=id=>document.getElementById(id);
const audio=$('audio');
let state={}, source='', token=0, playPending=false, playAttempt=0;
const command=(action,value)=>window.music.command(action,value).catch(()=>{ $('status').textContent='音乐服务暂不可用，请重试。'; });
function apply(next) {
  state=next;
  const theme=state.theme||{};
  for(const [name,value] of Object.entries({'--fg':theme.foreground,'--bg':theme.background,'--hover':theme.hover,'--border':theme.border})) if(value) document.documentElement.style.setProperty(name,value);
  $('card').hidden=!state.expanded;
  $('panel').setAttribute('aria-expanded',String(Boolean(state.expanded)));
  $('toggle').textContent=state.playing?'Ⅱ':'▶';
  $('toggle').setAttribute('aria-label',state.playing?'暂停':'播放');
  $('toggle').title=state.playing?'暂停':'播放';
  $('like').setAttribute('aria-pressed',String(Boolean(state.track?.liked)));
  $('like').textContent=state.track?.liked?'♥':'♡';
  $('like').title=state.track?.liked?'取消喜欢':'喜欢';
  $('like').disabled=state.busy||!state.track||!state.authenticated;
  $('next').disabled=state.busy;
  $('toggle').disabled=state.busy;
  $('login').disabled=state.busy;
  $('logout').disabled=state.busy;
  $('strip').dataset.busy=String(Boolean(state.busy));
  $('strip').dataset.error=String(Boolean(state.message&&!state.playing));
  $('name').textContent=state.track?.name||'还没有播放歌曲';
  $('name').title=state.track?.name||'';
  $('artist').textContent=state.track?.artist||'';
  $('status').textContent=state.message||(state.busy?'正在准备…':state.playing?'正在播放':state.track?'已暂停':'点击播放开启心动模式');
  $('qr').hidden=!state.qr;
  if(state.qr) $('qr').src=state.qr;else $('qr').removeAttribute('src');
  $('login').hidden=state.authenticated;
  $('login').textContent=state.qr?'刷新二维码':'扫码登录';
  $('logout').hidden=!state.authenticated;
  if(state.token!==token || (state.track?.url||'')!==source) {
    audio.pause();token=state.token;source=state.track?.url||'';playPending=false;
    if(source) audio.src=source;else audio.removeAttribute('src');
    audio.load();
  }
  if(!state.playing) {audio.pause();playPending=false;++playAttempt;}
  else if(source && audio.paused && !playPending) {
    playPending=true;const requestedToken=token, attempt=++playAttempt;
    audio.play().catch(error=>{
      if(requestedToken===token && attempt===playAttempt && state.playing && error.name!=='AbortError') void command(error.name==='NotAllowedError'?'blocked':'failed',token);
    }).finally(()=>{if(requestedToken===token && attempt===playAttempt)playPending=false;});
  }
}
for(const action of ['toggle','like','next','panel','login','logout']) $(action).addEventListener('click',()=>void command(action));
audio.addEventListener('ended',()=>void command('ended',token));
audio.addEventListener('error',()=>{if(source&&state.playing)void command('failed',token);});
audio.addEventListener('playing',()=>{void command('playing',token);$('status').textContent='正在播放';});
let receivedState=false;
window.music.onState(next=>{receivedState=true;apply(next);});
void window.music.command('initial').then(next=>{if(!receivedState)apply(next);}).catch(()=>{});
