'use strict';
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {MusicController} = require('./music-controller.cjs');
const {createMusicApi, createMusicVault} = require('./music-api.cjs');
function musicBounds(width, expanded, platform, fullscreen, qr = false) {
  const controls = platform === 'win32' && !fullscreen ? 144 : 0;
  const panelWidth = expanded ? 320 : 144;
  return {x:Math.max(0,width-controls-panelWidth),y:platform !== 'win32' && !fullscreen ? 32 : 0,width:panelWidth,height:expanded?(qr?520:280):48};
}
function createMusicPanel({app, win, WebContentsView, ipcMain, safeStorage, platform = process.platform}) {
  const url = pathToFileURL(path.join(__dirname,'music.html')).href;
  const view = new WebContentsView({webPreferences:{preload:path.join(__dirname,'music-preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false,partition:'music-player',autoplayPolicy:'no-user-gesture-required'}});
  view.setBackgroundColor('#00000000'); win.contentView.addChildView(view); view.setVisible(false);
  const wc = view.webContents;
  wc.setWindowOpenHandler(()=>({action:'deny'}));
  wc.on('will-navigate',event=>event.preventDefault());
  wc.session?.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
  wc.session?.setPermissionCheckHandler(()=>false);
  let backend, stopped=false, visible=false, theme={}, current={};
  const api = {call:(...args)=>(backend ||= createMusicApi(path.join(app.getPath('userData'),'music-runtime'))).call(...args),stop:()=>backend?.stop()};
  const controller = new MusicController({api,vault:createMusicVault(app.getPath('userData'),safeStorage),onChange:state=>{
    current=state; layout();
    if(!wc.isDestroyed()) wc.send('music:state',{...state,theme});
  }});
  function layout() {
    if(stopped || win.isDestroyed()) return;
    view.setBounds(musicBounds(win.getContentSize()[0],Boolean(current.expanded),platform,win.isFullScreen(),Boolean(current.qr)));
    view.setVisible(visible);
  }
  const actions = new Set(['panel','toggle','next','like','login','logout','ended','failed','playing','blocked']);
  ipcMain.handle('music:command',(event,action,token)=>{
    if(event.sender!==wc || event.senderFrame!==wc.mainFrame || event.senderFrame.url!==url) throw new Error('Untrusted sender');
    if(action === 'initial') return {...controller.state,theme};
    if(!actions.has(action)) throw new Error('Unsupported music action');
    if(['ended','failed','playing','blocked'].includes(action) && !Number.isSafeInteger(token)) return;
    return controller.command(action,token);
  });
  wc.on('render-process-gone',()=>{controller.emit({playing:false,message:'音乐界面已恢复，点击播放继续。'}); if(!stopped) void wc.loadURL(url).catch(()=>{});});
  void wc.loadURL(url).catch(()=>{});
  return {
    update(next) {visible = next.visible;theme=next.theme;layout(); if(!wc.isDestroyed()) wc.send('music:state',{...controller.state,theme});},
    raise() {if(!stopped) win.contentView.addChildView(view);},
    stop() {stopped=true;controller.stop();if(!wc.isDestroyed()) wc.close();},
  };
}
module.exports={createMusicPanel,musicBounds};
