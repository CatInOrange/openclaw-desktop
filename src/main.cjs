'use strict';
const {app, BrowserWindow, WebContentsView, ipcMain, Menu, Tray, nativeImage, screen, shell, dialog} = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {normalizeGateway, allowedExternal, sameOrigin, restoreBounds} = require('./policy.cjs');
if (process.env.OPENCLAW_DESKTOP_USER_DATA) app.setPath('userData', path.resolve(process.env.OPENCLAW_DESKTOP_USER_DATA));
app.setName('OpenClaw Desktop');
const icon = path.join(__dirname, '../assets/icon.png');
const shellUrl = pathToFileURL(path.join(__dirname, 'shell.html')).href;
let win, view, tray, quitting = false, retryTimer, loadTimer, saveTimer, retryCount = 0, viewLoaded = false;
let config = {}, configPath;
let state = {phase: 'setup', address: '', message: '连接你的 OpenClaw Gateway', canBack: false, trayAvailable: false};
function save() {
  try {
    fs.mkdirSync(path.dirname(configPath), {recursive: true});
    fs.writeFileSync(configPath + '.tmp', JSON.stringify(config, null, 2), {mode: 0o600});
    fs.renameSync(configPath + '.tmp', configPath);
  } catch { if (win && !win.isDestroyed()) publish({notice: '本地设置保存失败；下次启动可能需要重新填写地址。'}); }
}
function publish(next) {
  state = {...state, ...next};
  if (win && !win.isDestroyed()) win.webContents.send('desktop:state', state);
}
function stopRetry() { clearTimeout(retryTimer); clearTimeout(loadTimer); retryTimer = null; loadTimer = null; }
function placeView() {
  if (!view || !win || win.isDestroyed()) return;
  const [width, height] = win.getContentSize();
  view.setBounds({x: 0, y: win.isFullScreen() ? 0 : 32, width, height: Math.max(0, height - (win.isFullScreen() ? 0 : 32))});
}
function showWindow() { if (!win) return; if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
function hideView() { if (view) view.setVisible(false); }
function openSettings() {
  stopRetry(); hideView();
  publish({phase: 'setup', canBack: Boolean(view && !view.webContents.isDestroyed() && viewLoaded), message: '连接设置'});
  showWindow();
}
function scheduleRetry(message) {
  if (state.phase === 'setup' || quitting) return;
  stopRetry(); hideView();
  const seconds = Math.min(30, 2 ** Math.min(retryCount++, 5));
  publish({phase: 'error', message: `${message} · ${seconds} 秒后重试`, canBack: false});
  retryTimer = setTimeout(loadGateway, seconds * 1000);
}
function loadGateway() {
  stopRetry();
  if (!view || view.webContents.isDestroyed()) return;
  viewLoaded = false;
  hideView(); publish({phase: 'loading', message: '正在加载 Control UI…', canBack: false});
  // did-fail-load owns errors and retry; suppress the duplicated rejected promise.
  view.webContents.loadURL(config.gateway).catch(() => {});
  loadTimer = setTimeout(() => {
    if (!view || view.webContents.isDestroyed()) return;
    view.webContents.stop(); scheduleRetry('页面加载超时');
  }, 20000);
}
function makeRemote() {
  if (view) {
    win.contentView.removeChildView(view);
    if (!view.webContents.isDestroyed()) view.webContents.close();
  }
  const remote = new WebContentsView({webPreferences: {
    partition: 'persist:control-ui', nodeIntegration: false, contextIsolation: true,
    sandbox: true, webSecurity: true, allowRunningInsecureContent: false,
  }});
  view = remote;
  remote.setBackgroundColor('#10151c');
  win.contentView.addChildView(remote); placeView(); hideView();
  const wc = remote.webContents;
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
    retryCount = 0; viewLoaded = true; stopRetry();
    if (state.phase === 'setup') { publish({canBack: true}); return; }
    placeView(); remote.setVisible(true);
    publish({phase: 'ready', message: '页面已加载 · 登录与连接状态见 Control UI', canBack: true});
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
    tray.setContextMenu(Menu.buildFromTemplate([
      {label: '打开 OpenClaw', click: showWindow},
      {label: '重新连接', click: () => {showWindow(); reconnect();}},
      {label: '连接设置', click: openSettings}, {type: 'separator'},
      {label: '退出', click: () => app.quit()},
    ]));
    tray.on('click', showWindow); publish({trayAvailable: true});
  } catch { tray = null; publish({trayAvailable: false, notice: '系统托盘不可用，关闭窗口将退出应用。'}); }
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', showWindow);
  app.whenReady().then(() => {
    configPath = path.join(app.getPath('userData'), 'desktop.json');
    try { config = JSON.parse(fs.readFileSync(configPath, 'utf8')); if (!config || typeof config !== 'object' || Array.isArray(config)) config = {}; } catch { config = {}; }
    if (config.gateway) { try { config.gateway = normalizeGateway(config.gateway); } catch { delete config.gateway; } }
    state.address = config.gateway || '';
    win = new BrowserWindow({
      ...restoreBounds(config.window, screen.getAllDisplays()), minWidth: 720, minHeight: 520,
      show: false, title: 'OpenClaw Desktop', icon, backgroundColor: '#10151c',
      autoHideMenuBar: true, frame: false,
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
      back: () => { if (view && !view.webContents.isDestroyed() && state.canBack) {
        view.setVisible(true); publish({phase: 'ready', message: '页面已加载 · 登录与连接状态见 Control UI'});
      }},
    })) ipcMain.handle(`desktop:${name}`, (event, ...args) => {
      if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame || event.senderFrame.url !== shellUrl) throw new Error('Untrusted sender');
      return handler(event, ...args);
    });
    const remoteSession = require('electron').session.fromPartition('persist:control-ui');
    remoteSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    remoteSession.setPermissionCheckHandler(() => false);
    remoteSession.on('will-download', async (_event, item) => {
      // Let Electron's native Save dialog handle user-requested downloads.
      item.setSaveDialogOptions({title: '保存下载文件'});
    });
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      {label: '应用', submenu: [
        {label: '连接设置', accelerator: 'CmdOrCtrl+L', click: openSettings},
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
    buildTray();
    for (const event of ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen']) {
      win.on(event, () => {
        placeView();
        publish({maximized: win.isMaximized(), fullscreen: win.isFullScreen()});
        saveWindow();
      });
    }
    win.on('resize', () => {placeView(); clearTimeout(saveTimer); saveTimer = setTimeout(saveWindow, 250);});
    win.on('move', () => {clearTimeout(saveTimer); saveTimer = setTimeout(saveWindow, 250);});
    win.on('close', event => {saveWindow(); if (!quitting && tray) {event.preventDefault(); win.hide();}});
    win.on('closed', () => {win = null; app.quit();});
    win.loadURL(shellUrl).then(() => {
      if (config.window?.maximized) win.maximize();
      showWindow();
      if (config.gateway) connect(config.gateway); else publish({phase: 'setup'});
    });
  }).catch(error => {dialog.showErrorBox('OpenClaw Desktop 启动失败', error.message); app.exit(1);});
}
app.on('activate', showWindow);
app.on('before-quit', () => {quitting = true; stopRetry(); clearTimeout(saveTimer); if (configPath) saveWindow(); if (view && !view.webContents.isDestroyed()) view.webContents.close();});
app.on('window-all-closed', () => {if (quitting || !tray) app.quit();});
