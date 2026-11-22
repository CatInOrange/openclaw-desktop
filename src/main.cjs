'use strict';
const {app, BrowserWindow, WebContentsView, ipcMain, Menu, Tray, nativeImage, screen, shell, dialog, protocol, session, net} = require('electron');
const {DEFAULT_THEME, normalizeTheme} = require('./theme.cjs');
const {watchTheme} = require('./theme-sync.cjs');
const {normalizeVideo, updateVideo} = require('./video-config.cjs');
const {SCHEME, MEDIA_URL, createMediaHandler} = require('./media.cjs');
const {watchBackground} = require('./background.cjs');
const fs = require('node:fs');
const {createUpdater} = require('./updater.cjs');
let updater;
function refreshTray(){if(tray&&!quitting)tray.setContextMenu(Menu.buildFromTemplate(trayItems()));}
function trayItems(){return [
 {label:'打开 OpenClaw',click:showWindow},
 {label:'重新连接',click:()=>{showWindow();reconnect();}},
 {label:'连接设置',click:openSettings},
 {label:'视频与外观…',click:openAppearance},
 {label:'显示桌宠',click:()=>petWindow?.show()},
 {label:'桌宠设置…',click:()=>petWindow?.openSettings()},
 {type:'separator'},...(updater?.menu()||[]),
 {type:'separator'},{label:'退出',click:()=>app.quit()}
];}
const {createPetWindow} = require('./pet-window.cjs');
const {watchPetGateway} = require('./pet-observer.cjs');
let petWindow, stopPetObserver = () => {};
const {createMusicPanel} = require('./music-panel.cjs');
let musicPanel;
const {safeStorage} = require('electron');
const {windowChromeOptions, applyWindowChrome} = require('./window-chrome.cjs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {normalizeGateway, allowedExternal, sameOrigin, restoreBounds} = require('./policy.cjs');
if (process.env.OPENCLAW_DESKTOP_USER_DATA) app.setPath('userData', path.resolve(process.env.OPENCLAW_DESKTOP_USER_DATA));
app.setName('OpenClaw Desktop');
const startupTrace = require('./startup-trace.cjs').createStartupTrace(app);
startupTrace('main-enter');
// A media-only scheme: exactly two packaged MP4 files, never arbitrary local paths.
protocol.registerSchemesAsPrivileged([{scheme: SCHEME, privileges: {standard: true, secure: true, stream: true, supportFetchAPI: true, bypassCSP: true}}]);
const icon = path.join(__dirname, '../assets/icon.png');
const shellUrl = pathToFileURL(path.join(__dirname, 'shell.html')).href;
let win, view, tray, quitting = false, retryTimer, loadTimer, saveTimer, retryCount = 0, viewLoaded = false;
let config = {}, configPath, stopThemeSync = () => {}, backgroundSync, bootTimer, remoteVisible = false, afterBoot = null;
let state = {phase: 'setup', address: '', message: '连接你的 OpenClaw Gateway', canBack: false, trayAvailable: false};
function save() {
  try {
    fs.mkdirSync(path.dirname(configPath), {recursive: true});
    fs.writeFileSync(configPath + '.tmp', JSON.stringify(config, null, 2), {mode: 0o600});
    fs.renameSync(configPath + '.tmp', configPath);
    return true;
  } catch { if (win && !win.isDestroyed()) publish({notice: '本地设置保存失败；下次启动可能需要重新填写地址。'}); return false; }
}
function publish(next) {
  state = {...state, ...next};
  if (win && !win.isDestroyed()) {
    state.nativeControls = process.platform === 'win32';
    state.integratedTitlebar = applyWindowChrome(win, state, process.platform);
    win.webContents.send('desktop:state', state);
    musicPanel?.update({visible:state.phase === 'ready' && !state.bootPlaying,theme:state.theme});
  }
}
function stopRetry() { clearTimeout(retryTimer); clearTimeout(loadTimer); retryTimer = null; loadTimer = null; }
function placeView() {
  if (!view || !win || win.isDestroyed()) return;
  const [width, height] = win.getContentSize();
  const previewWidth = state.phase === 'appearance' && viewLoaded ? Math.max(0, width - 380) : width;
  const top = process.platform === 'win32' || win.isFullScreen() ? 0 : 32;
  view.setBounds({x: 0, y: top, width: previewWidth, height: Math.max(0, height - top)});
  musicPanel?.update({visible:state.phase === 'ready' && !state.bootPlaying,theme:state.theme});
}
function showWindow() { if (!win) return; if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
function updatePlayback() {backgroundSync?.refresh();}
function hideView() {remoteVisible = false; if (view) view.setVisible(false); updatePlayback();}
function syncRemoteVisibility() {
  const wasVisible = remoteVisible;
  remoteVisible = ['ready', 'appearance'].includes(state.phase) && !state.bootPlaying && viewLoaded;
  placeView();
  if (view) {
    view.setVisible(remoteVisible);
    if (remoteVisible && !wasVisible) view.webContents.executeJavaScriptInIsolatedWorld(1002, [{code: "document.documentElement.removeAttribute('data-oc-enter'); void document.body.offsetWidth; document.documentElement.setAttribute('data-oc-enter', '');"}]).catch(() => {});
  }
  updatePlayback();
}
function finishBoot() {
  clearTimeout(bootTimer);
  startupTrace('boot-finished');
  if (!state.bootPlaying) return;
  const action = afterBoot; afterBoot = null;
  publish({bootPlaying: false});
  if (action) action(); else syncRemoteVisibility();
}
function openAppearance() {
  if (state.bootPlaying) {afterBoot = openAppearance; return;}
  hideView();
  publish({phase: 'appearance', canBack: Boolean(view && viewLoaded)});
  syncRemoteVisibility(); showWindow();
}
function backToWorkspace() {
  if (view && !view.webContents.isDestroyed() && viewLoaded) {
    publish({phase: 'ready', message: '页面已加载 · 登录与连接状态见 Control UI'});
    syncRemoteVisibility();
  } else if (config.gateway) reconnect();
  else {publish({phase: 'setup'}); hideView();}
}
function setVideo(patch) {
  try {
    const next = updateVideo(config.video, patch), previous = config.video;
    config.video = next;
    if (!save()) {config.video = previous; return {ok: false, error: '设置未能保存，请检查本地数据目录。'};}
    publish({video: next, notice: ''});
    if (!next.bootEnabled) finishBoot();
    updatePlayback();
    return {ok: true};
  } catch (error) {return {ok: false, error: error.message};}
}
function openSettings() {
  if (state.bootPlaying) {afterBoot = openSettings; return;}
  stopRetry(); hideView();
  publish({phase: 'setup', canBack: Boolean(view && !view.webContents.isDestroyed() && viewLoaded), message: '连接设置'});
  showWindow();
}
function scheduleRetry(message) {
  if (state.phase === 'setup' || quitting) return;
  stopRetry(); viewLoaded = false; hideView();
  const seconds = Math.min(30, 2 ** Math.min(retryCount++, 5));
  if (state.phase === 'appearance') {publish({message, canBack: false}); return;}
  publish({phase: 'error', message: `${message} · ${seconds} 秒后重试`, canBack: false});
  retryTimer = setTimeout(loadGateway, seconds * 1000);
}
function loadGateway() {
  stopRetry();
  if (!view || view.webContents.isDestroyed()) return;
  viewLoaded = false;
  hideView(); publish({phase: 'loading', message: '正在加载 Control UI…', canBack: false});
  // did-fail-load owns errors and retry; suppress the duplicated rejected promise.
  // Start navigation independently of optional pet monitoring setup.
  view.webContents.loadURL(config.gateway).catch(() => {});
  loadTimer = setTimeout(() => {
    if (!view || view.webContents.isDestroyed()) return;
    view.webContents.stop(); scheduleRetry('页面加载超时');
  }, 20000);
}
function makeRemote() {
  stopPetObserver();
  stopThemeSync(); backgroundSync?.stop();
  if (view) {
    win.contentView.removeChildView(view);
    if (!view.webContents.isDestroyed()) view.webContents.close();
  }
  const remote = new WebContentsView({webPreferences: {
    partition: 'persist:control-ui', nodeIntegration: false, contextIsolation: true,
    sandbox: true, webSecurity: true, allowRunningInsecureContent: false,
    // Keep UI hydration and WebSocket work running behind the opening video.
    backgroundThrottling: false,
  }});
  view = remote;
  remote.setBackgroundColor((state.theme || DEFAULT_THEME).background);
  win.contentView.addChildView(remote); musicPanel?.raise(); placeView(); hideView();
  const wc = remote.webContents;
  stopPetObserver = watchPetGateway(wc, event => petWindow?.event(event), {isTrusted: () => view === remote && !quitting && sameOrigin(wc.getURL(), config.gateway)});
  let themeErrorLogged = false;
  stopThemeSync = watchTheme(wc, value => {
    if (view !== remote || quitting || !sameOrigin(wc.getURL(), config.gateway)) return;
    const theme = normalizeTheme(value);
    if (!theme || JSON.stringify(theme) === JSON.stringify(state.theme)) return;
    config.theme = theme; save();
    remote.setBackgroundColor(theme.background);
    publish({theme});
  }, error => {
    if (themeErrorLogged) return;
    themeErrorLogged = true;
    // Local diagnostic only: no page content, tokens or addresses.
    try { fs.appendFileSync(path.join(app.getPath('userData'), 'theme-sync.log'), `${new Date().toISOString()} v${app.getVersion()} theme read failed: ${error.name}\n`); } catch {}
  });
  backgroundSync = watchBackground(wc, () => ({
    enabled: Boolean(config.video.backgroundEnabled) && sameOrigin(wc.getURL(), config.gateway),
    strength: config.video.strength, glassTransparency: config.video.glassTransparency,
    integratedChrome: process.platform === 'win32', chromeActive: remoteVisible, fullscreen: win.isFullScreen(),
    reserveControls: state.phase !== 'appearance', musicControls:state.phase === 'ready', zoom: wc.getZoomFactor(), url: MEDIA_URL + 'background.mp4',
    active: remoteVisible && !state.bootPlaying && win.isVisible() && !win.isMinimized(),
  }), status => {
    if (view === remote && !quitting && state.backgroundStatus !== status) publish({backgroundStatus: status});
  });
  let httpFailure = 0;
  wc.on('did-start-navigation', (_event, _url, inPlace, isMainFrame) => {if (isMainFrame && !inPlace) httpFailure = 0;});
  wc.on('did-navigate', (_event, _url, statusCode) => {if (statusCode >= 400) httpFailure = statusCode;});
  const current = () => view === remote && !quitting;
  const external = url => { if (allowedExternal(url)) shell.openExternal(url).catch(() => {}); };
  wc.setWindowOpenHandler(({url}) => { external(url); return {action: 'deny'}; });
  wc.on('will-navigate', (event, url) => {
    if (!sameOrigin(url, config.gateway)) { event.preventDefault(); external(url); }
  });
  wc.on('will-redirect', (event, url) => {
    if (!sameOrigin(url, config.gateway)) {
      event.preventDefault();
      if (current()) scheduleRetry('已阻止跨站重定向，请检查 Gateway 地址');
    }
  });
  wc.on('did-finish-load', () => {
    if (!current()) return;
    if (httpFailure) { scheduleRetry(`服务器返回 HTTP ${httpFailure}`); return; }
    startupTrace('control-ui-loaded');
    retryCount = 0; viewLoaded = true; stopRetry();
    if (['setup', 'appearance'].includes(state.phase)) { publish({canBack: true}); syncRemoteVisibility(); return; }
    placeView();
    publish({phase: 'ready', message: '页面已加载 · 登录与连接状态见 Control UI', canBack: true});
    syncRemoteVisibility();
  });
  wc.on('did-fail-load', (_event, code, description, _url, isMainFrame) => {
    if (current() && isMainFrame && code !== -3) scheduleRetry(`页面加载失败（${description}）`);
  });
  wc.on('render-process-gone', () => { if (current()) scheduleRetry('页面进程已退出'); });
  wc.on('context-menu', (_event, p) => {
    const items = [];
    if (p.isEditable) items.push({role: 'undo'}, {role: 'redo'}, {type: 'separator'}, {role: 'cut'}, {role: 'copy'}, {role: 'paste'}, {role: 'selectAll'});
    else if (p.selectionText) items.push({role: 'copy'}, {role: 'selectAll'});
    if (p.linkURL && allowedExternal(p.linkURL)) items.push({label: '在浏览器中打开链接', click: () => external(p.linkURL)});
    if (items.length) Menu.buildFromTemplate(items).popup({window: win});
  });
}
function connect(address) {
  const gateway = normalizeGateway(address);
  stopRetry(); retryCount = 0;
  config.gateway = gateway; save();
  publish({address: gateway, notice: ''}); makeRemote(); loadGateway();
  return {ok: true};
}
function reconnect() {
  if (!config.gateway) return openSettings();
  retryCount = 0;
  if (!view || view.webContents.isDestroyed()) makeRemote();
  loadGateway();
}
function saveWindow() {
  if (!win || win.isDestroyed()) return;
  config.window = {...win.getNormalBounds(), maximized: win.isMinimized() ? Boolean(config.window?.maximized) : win.isMaximized()}; save();
}
function buildTray() {
  try {
    tray = new Tray(nativeImage.createFromPath(icon).resize({width: 24, height: 24}));
    tray.setToolTip('OpenClaw Desktop');
    refreshTray();
    tray.on('click', showWindow); publish({trayAvailable: true});
  } catch { tray = null; publish({trayAvailable: false, notice: '系统托盘不可用，关闭窗口将退出应用。'}); }
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', showWindow);
  app.whenReady().then(() => {
    startupTrace('app-ready');
    configPath = path.join(app.getPath('userData'), 'desktop.json');
    try { config = JSON.parse(fs.readFileSync(configPath, 'utf8')); if (!config || typeof config !== 'object' || Array.isArray(config)) config = {}; } catch { config = {}; }
    if (config.gateway) { try { config.gateway = normalizeGateway(config.gateway); } catch { delete config.gateway; } }
    state.address = config.gateway || '';
    state.theme = normalizeTheme(config.theme) || DEFAULT_THEME;
    config.video = normalizeVideo(config.video);
    state.video = config.video; state.bootPlaying = config.video.bootEnabled;
    state.version = app.getVersion(); state.backgroundStatus = 'waiting';
    const mediaHandler = createMediaHandler(path.join(__dirname, '../assets/video'));
    session.defaultSession.protocol.handle(SCHEME, mediaHandler);
    const remoteSession = session.fromPartition('persist:control-ui');
    remoteSession.protocol.handle(SCHEME, mediaHandler);
    win = new BrowserWindow({
      ...restoreBounds(config.window, screen.getAllDisplays()), minWidth: 720, minHeight: 520,
      show: false, title: 'OpenClaw Desktop', icon, backgroundColor: state.theme.background,
      autoHideMenuBar: true, ...windowChromeOptions(process.platform, state.theme),
      webPreferences: {preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true},
    });
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
    // No native bridge is exposed to the remote Control UI; only this local shell can invoke IPC.
    for (const [name, handler] of Object.entries({
      initial: () => ({...state, maximized: win.isMaximized(), fullscreen: win.isFullScreen()}),
      minimize: () => win.minimize(),
      maximize: () => {if (win.isMaximized()) win.unmaximize(); else win.maximize();},
      close: () => win.close(),
      connect: (_event, address) => {try { return connect(address); } catch (error) { return {ok: false, error: error.message}; }},
      reconnect: reconnect,
      settings: openSettings,
      appearance: openAppearance,
      video: (_event, patch) => setVideo(patch),
      bootDone: finishBoot,
      back: backToWorkspace,
    })) ipcMain.handle(`desktop:${name}`, (event, ...args) => {
      if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame || event.senderFrame.url !== shellUrl) throw new Error('Untrusted sender');
      return handler(event, ...args);
    });
    remoteSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    remoteSession.setPermissionCheckHandler(() => false);
    remoteSession.on('will-download', async (_event, item) => {
      // Let Electron's native Save dialog handle user-requested downloads.
      item.setSaveDialogOptions({title: '保存下载文件'});
    });
    updater = createUpdater({app,dialog,fetcher:(...args)=>net.fetch(...args),config,save,getWindow:()=>win,onChange:refreshTray});
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      {label: '应用', submenu: [
        {label: '连接设置', accelerator: 'CmdOrCtrl+L', click: openSettings},
        {label: '视频与外观…', accelerator: 'CmdOrCtrl+Shift+V', click: openAppearance},
        {label: '显示桌宠', click: () => petWindow?.show()},
        {label: '桌宠设置…', click: () => petWindow?.openSettings()},
        {label: '检查更新…', click: () => void updater.check()},
        {label: '重新加载', accelerator: 'CmdOrCtrl+R', click: reconnect},
        {type: 'separator'}, {label: '退出', accelerator: 'CmdOrCtrl+Q', click: () => app.quit()},
      ]},
      {label: '编辑', submenu: [{role: 'undo'}, {role: 'redo'}, {type: 'separator'}, {role: 'cut'}, {role: 'copy'}, {role: 'paste'}, {role: 'selectAll'}]},
      {label: '视图', submenu: [
        {label: '放大', accelerator: 'CmdOrCtrl+Plus', click: () => {if (view) view.webContents.setZoomLevel(Math.min(3, view.webContents.getZoomLevel() + 0.5));}},
        {label: '缩小', accelerator: 'CmdOrCtrl+-', click: () => {if (view) view.webContents.setZoomLevel(Math.max(-3, view.webContents.getZoomLevel() - 0.5));}},
        {label: '实际大小', accelerator: 'CmdOrCtrl+0', click: () => {if (view) view.webContents.setZoomLevel(0);}},
        {role: 'togglefullscreen'},
      ]},
    ]));
    petWindow = createPetWindow({BrowserWindow, ipcMain, Menu, screen, config, save, openSession: key => {
      if (!config.gateway || !view || view.webContents.isDestroyed()) return;
      const target = new URL(config.gateway); target.searchParams.set('session', key);
      view.webContents.loadURL(target.href).catch(() => {}); showWindow();
    }});
    musicPanel = createMusicPanel({app,win,WebContentsView,ipcMain,safeStorage});
    buildTray();
    for (const event of ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen']) {
      win.on(event, () => {
        placeView();
        publish({maximized: win.isMaximized(), fullscreen: win.isFullScreen()});
        saveWindow();
      });
    }
    for (const event of ['show', 'hide', 'minimize', 'restore']) win.on(event, () => {
      publish({windowActive: win.isVisible() && !win.isMinimized()}); updatePlayback();
    });
    win.on('resize', () => {placeView(); clearTimeout(saveTimer); saveTimer = setTimeout(saveWindow, 250);});
    win.on('move', () => {clearTimeout(saveTimer); saveTimer = setTimeout(saveWindow, 250);});
    win.on('close', event => {saveWindow(); if (!quitting && tray) {event.preventDefault(); win.hide();}});
    win.on('closed', () => {win = null; app.quit();});
    win.loadURL(shellUrl).then(() => {
      startupTrace('shell-loaded');
      if (config.window?.maximized) win.maximize();
      showWindow();
      startupTrace('window-shown');
      void updater.reportPrevious();
      if (state.bootPlaying) bootTimer = setTimeout(finishBoot, 20000);
      if (config.gateway) connect(config.gateway); else publish({phase: 'setup'});
    });
  }).catch(error => {dialog.showErrorBox('OpenClaw Desktop 启动失败', error.message); app.exit(1);});
}
app.on('activate', showWindow);
app.on('before-quit', () => {quitting = true; musicPanel?.stop(); stopPetObserver(); petWindow?.stop(); clearTimeout(bootTimer); backgroundSync?.stop(); stopThemeSync(); stopRetry(); clearTimeout(saveTimer); if (configPath) saveWindow(); if (view && !view.webContents.isDestroyed()) view.webContents.close();});
app.on('window-all-closed', () => {if (quitting || !tray) app.quit();});
