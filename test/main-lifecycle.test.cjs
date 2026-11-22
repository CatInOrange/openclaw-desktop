'use strict';
// Pure Node model of Electron APIs. No Electron process or GUI is launched.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const {createRequire} = require('node:module');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const mainPath = require.resolve('../src/main.cjs');
const localRequire = createRequire(mainPath);
async function fixture(video = {}, platform = 'linux', observerReady = Promise.resolve()) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-main-'));
  fs.writeFileSync(path.join(directory, 'desktop.json'), JSON.stringify({gateway: 'https://claw.example.com/', video}));
  let window, remote, settings, failWrites = false;
  const app = new EventEmitter();
  Object.assign(app, {setName() {}, setPath() {}, getPath: () => directory, getVersion: () => '0.3.0', requestSingleInstanceLock: () => true, whenReady: () => Promise.resolve(), quit() {}, exit() {throw new Error('startup failed');}});
  class Contents extends EventEmitter {
    constructor() {super(); this.url = ''; this.mainFrame = {url: ''};}
    setWindowOpenHandler() {} isDestroyed() {return false;}
    loadURL(url) {this.url = url; this.mainFrame.url = url; return Promise.resolve();}
    executeJavaScriptInIsolatedWorld(_world, scripts) {this.reveals = (this.reveals || 0) + 1; return Promise.resolve();}
    getZoomFactor() {return 1;}
    getURL() {return this.url;}
    send() {} close() {} stop() {}
  }
  class Window extends EventEmitter {
    constructor(options) {super(); this.options = options; window = this; this.webContents = new Contents(); this.contentView = {addChildView() {}, removeChildView() {}}; this.visible = false; this.minimized = false;}
    loadURL(url) {return this.webContents.loadURL(url);}
    isDestroyed() {return false;} isMinimized() {return this.minimized;} isMaximized() {return false;} isFullScreen() {return false;}
    isVisible() {return this.visible;} getContentSize() {return [1200, 800];}
    getNormalBounds() {return {x: 0, y: 0, width: 1200, height: 800};}
    setBackgroundColor() {} setTitleBarOverlay(value) {this.overlay = value;} focus() {}
    show() {this.visible = true; this.emit('show');} hide() {this.visible = false; this.emit('hide');}
    restore() {this.minimized = false; this.emit('restore');}
  }
  class View {
    constructor(options) {remote = this; this.options = options; this.webContents = new Contents();}
    setBounds(value) {this.bounds = value;} setVisible(value) {this.visible = value;} setBackgroundColor() {}
  }
  class Tray extends EventEmitter {setToolTip() {} setContextMenu() {}}
  const session = new EventEmitter(); Object.assign(session, {protocol: {handle() {}}, setPermissionRequestHandler() {}, setPermissionCheckHandler() {}});
  const handlers = new Map();
  const electron = {app, BrowserWindow: Window, WebContentsView: View, Tray, ipcMain: {handle: (key, handler) => handlers.set(key, handler)},
    Menu: {buildFromTemplate: () => ({}), setApplicationMenu() {}}, nativeImage: {createFromPath: () => ({resize() {}})},
    screen: {getAllDisplays: () => [{workArea: {x: 0, y: 0, width: 1920, height: 1080}}]}, shell: {}, dialog: {showErrorBox() {}}, protocol: {registerSchemesAsPrivileged() {}}, session: {defaultSession: session, fromPartition: () => session}};
  const fakeFs = Object.create(fs);
  fakeFs.writeFileSync = (...args) => {if (failWrites) throw new Error('read only'); return fs.writeFileSync(...args);};
  const context = {__dirname: path.dirname(mainPath), process: {env: {}, platform}, setTimeout, clearTimeout, require(name) {
    if (name === 'electron') return electron;
    if (name === 'node:fs') return fakeFs;
    if (name === './pet-window.cjs') return {createPetWindow: () => ({event() {}, show() {}, stop() {}})};
    if (name === './pet-observer.cjs') return {watchPetGateway: () => Object.assign(() => {}, {ready: observerReady})};
    if (name === './theme-sync.cjs') return {watchTheme: () => () => {}};
    if (name === './background.cjs') return {watchBackground: (_wc, getSettings) => {settings = getSettings; return {stop() {}, refresh() {}};}};
    return localRequire(name);
  }};
  vm.runInNewContext(fs.readFileSync(mainPath, 'utf8') + '\nglobalThis.hooks = {getState: () => state, finishBoot, openAppearance, backToWorkspace, reconnect, setVideo};', context);
  await new Promise(done => setImmediate(done));
  return {window, remote, app, hooks: context.hooks, settings: () => settings(), handlers,
    rejectWrites: () => {failWrites = true;},
    cleanup() {app.emit('before-quit'); fs.rmSync(directory, {recursive: true, force: true});},
    saved: () => JSON.parse(fs.readFileSync(path.join(directory, 'desktop.json'), 'utf8'))};
}

test('boot gates the ready view, finishes once, and never restarts on reconnect or tray restore', async () => {
  const f = await fixture();
  try {
    assert.equal(f.remote.options.webPreferences.backgroundThrottling, false);
    assert.equal(f.remote.webContents.getURL(), 'https://claw.example.com/');
    assert.equal(f.hooks.getState().bootPlaying, true);
    f.remote.webContents.emit('did-finish-load');
    assert.equal(f.hooks.getState().phase, 'ready'); assert.equal(f.remote.visible, false);
    assert.equal(f.remote.webContents.reveals || 0, 0);
    f.hooks.finishBoot(); assert.equal(f.remote.webContents.reveals, 1); assert.equal(f.remote.visible, true); assert.equal(f.settings().active, true);
    f.window.hide(); assert.equal(f.settings().active, false);
    f.window.show(); assert.equal(f.settings().active, true); assert.equal(f.hooks.getState().bootPlaying, false);
    f.hooks.reconnect(); f.remote.webContents.emit('did-finish-load');
    assert.equal(f.hooks.getState().bootPlaying, false); assert.equal(f.remote.visible, true);
  } finally {f.cleanup();}
});
test('appearance panel keeps live preview, restores full width, and persists independent switches', async () => {
  const f = await fixture({bootEnabled: false});
  try {
    f.remote.webContents.emit('did-finish-load');
    assert.equal(f.remote.visible, true);
    f.hooks.openAppearance(); assert.equal(f.hooks.getState().phase, 'appearance');
    assert.equal(f.remote.visible, true); assert.equal(f.remote.bounds.width, 820);
    assert.equal(f.hooks.setVideo({backgroundEnabled: false}).ok, true);
    assert.equal(f.settings().enabled, false); assert.equal(f.saved().video.backgroundEnabled, false);
    assert.equal(f.saved().video.bootEnabled, false);
    f.hooks.backToWorkspace(); assert.equal(f.remote.bounds.width, 1200);
    f.rejectWrites(); const result = f.hooks.setVideo({backgroundEnabled: true});
    assert.equal(result.ok, false); assert.equal(f.hooks.getState().video.backgroundEnabled, false);
  } finally {f.cleanup();}
});
test('remote frames cannot invoke video preferences or skip boot through local IPC', async () => {
  const f = await fixture();
  try {
    const handler = f.handlers.get('desktop:video');
    assert.throws(() => handler({sender: f.remote.webContents, senderFrame: f.remote.webContents.mainFrame}, {bootEnabled: false}), /Untrusted sender/);
    const local = {sender: f.window.webContents, senderFrame: f.window.webContents.mainFrame};
    assert.equal(handler(local, {bootEnabled: false}).ok, true);
    assert.equal(f.hooks.getState().bootPlaying, false);
  } finally {f.cleanup();}
});

test('opening appearance during boot waits for completion rather than skipping the video', async () => {
  const f = await fixture();
  try {
    f.remote.webContents.emit('did-finish-load');
    f.hooks.openAppearance();
    assert.equal(f.hooks.getState().bootPlaying, true);
    assert.equal(f.hooks.getState().phase, 'ready');
    assert.equal(f.remote.visible, false);
    f.hooks.finishBoot();
    assert.equal(f.hooks.getState().phase, 'appearance');
    assert.equal(f.remote.visible, true);
  } finally {f.cleanup();}
});

test('Windows caption overlay shares the full-height workspace without exposing remote IPC', async () => {
  const f = await fixture({}, 'win32');
  try {
    assert.equal(f.window.options.titleBarStyle, 'hidden');
    assert.equal(f.window.options.titleBarOverlay.color, '#00000000');
    f.remote.webContents.emit('did-finish-load'); f.hooks.finishBoot();
    assert.equal(f.remote.bounds.y, 0); assert.equal(f.remote.bounds.height, 800);
    assert.equal(f.window.overlay.height, 48);
    assert.equal(f.hooks.getState().integratedTitlebar, true);
    assert.equal(f.settings().reserveControls, true);
    assert.equal(f.settings().integratedChrome, true);
    assert.equal(f.remote.options.webPreferences.preload, undefined);
    f.hooks.openAppearance(); assert.equal(f.settings().reserveControls, false);
    assert.equal(f.window.overlay.height, 32);
    assert.equal(f.remote.bounds.width, 820);
    const handler = f.handlers.get('desktop:close');
    assert.throws(() => handler({sender: f.remote.webContents, senderFrame: f.remote.webContents.mainFrame}), /Untrusted sender/);
    assert.equal(f.hooks.setVideo({glassTransparency: 91}).ok, true);
    assert.equal(f.saved().video.glassTransparency, 91);
    assert.equal(f.settings().glassTransparency, 91);
  } finally {f.cleanup();}
});


test('a stalled pet observer cannot block loading Control UI', async () => {
  const f = await fixture({bootEnabled: false}, 'win32', new Promise(() => {}));
  try {
    await new Promise(done => setTimeout(done, 1100));
    assert.equal(f.remote.webContents.getURL(), 'https://claw.example.com/');
    f.remote.webContents.emit('did-finish-load');
    assert.equal(f.hooks.getState().phase, 'ready');
    assert.equal(f.remote.visible, true);
  } finally {f.cleanup();}
});

test('a rejected pet observer does not block Control UI', async () => {
  const f = await fixture({bootEnabled: false}, 'win32', Promise.resolve().then(() => {throw new Error('CDP unavailable');}));
  try {
    assert.equal(f.remote.webContents.getURL(), 'https://claw.example.com/');
  } finally {f.cleanup();}
});
