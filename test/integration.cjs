(async () => {
'use strict';
const {_electron: electron} = require('playwright-core');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const userData = awaitDir();
function awaitDir() { return fs.mkdtemp(path.join(os.tmpdir(), 'openclaw-desktop-test-')); }
const fixture = '<!doctype html><html><title>Fixture Control UI</title><body style="background:#182430;color:white"><h1>Gateway fixture</h1><input id="message" placeholder="Message"><script>localStorage.setItem("desktop-persistence-probe", "retained");</script></body></html>';
let server, app, responseCode = 200;
function listen(port = 0) {
  return new Promise(resolve => {
    server = http.createServer((_req, res) => {res.writeHead(responseCode, {'Content-Type':'text/html'}); res.end(fixture);});
    server.listen(port, '127.0.0.1', () => resolve(server.address().port));
  });
}
async function launch() {
  const instance = await electron.launch({args:[root, ...(process.platform === 'linux' && process.getuid?.() === 0 ? ['--no-sandbox'] : [])], env:{...process.env, OPENCLAW_DESKTOP_USER_DATA:await userData}, timeout:30000});
  return instance;
}
async function waitPhase(instance, phase) {
  for (let i = 0; i < 100; i++) {
    const actual = await instance.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].webContents.executeJavaScript('window.desktop.initial()'));
    if (actual.phase === phase) return actual;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Phase timeout: ' + phase);
}
try {
  const port = await listen(); const address = `http://127.0.0.1:${port}/`;
  app = await launch();
  const page = await app.firstWindow();
  await page.locator('#address').waitFor({state:'visible'});
  await fs.mkdir(path.join(root,'test-output'),{recursive:true});
  await page.screenshot({path:path.join(root,'test-output/connection.png')});
  await page.locator('#address').fill(address + '?token=not-to-save');
  await page.locator('#connect-button').click();
  await page.locator('#form-error').filter({hasText:'Token'}).waitFor();
  await page.locator('#address').fill(address);
  await page.locator('#connect-button').click();
  await waitPhase(app,'ready');
  const remoteSecurity = await app.evaluate(async ({BrowserWindow}) => {
    const contents = BrowserWindow.getAllWindows()[0].contentView.children[0].webContents;
    return contents.executeJavaScript('({bridge:typeof window.desktop,node:typeof require,probe:localStorage.getItem("desktop-persistence-probe")})');
  });
  assert.deepEqual(remoteSecurity,{bridge:'undefined',node:'undefined',probe:'retained'});
  console.log('PASS: real Electron loads Gateway; remote page has no native bridge or Node access');
  await page.locator('#settings').click();
  await page.locator('#back').waitFor({state:'visible'});
  await page.locator('#back').click(); await waitPhase(app,'ready');
  const windowState = await app.evaluate(({BrowserWindow}) => {
    const w = BrowserWindow.getAllWindows()[0]; w.setBounds({width:1100,height:740}); w.close();
    return {visible:w.isVisible(),alive:!w.isDestroyed()};
  });
  assert.deepEqual(windowState,{visible:false,alive:true});
  await app.evaluate(({BrowserWindow}) => {BrowserWindow.getAllWindows()[0].show();});
  console.log('PASS: connection settings return, close-to-tray, and window restore');
  responseCode = 503;
  await page.locator('#reload').click();
  const failedStatus = await waitPhase(app, 'error');
  assert.match(failedStatus.message, /503/);
  responseCode = 200;
  await page.locator('#retry').click();
  await waitPhase(app, 'ready');
  console.log('PASS: HTTP errors are not mistaken for a successful page load');
  await new Promise(resolve => server.close(resolve));
  await page.locator('#reload').click();
  await waitPhase(app,'error');
  assert.equal(await page.locator('#waiting').isVisible(),true);
  await page.screenshot({path:path.join(root,'test-output/reconnect.png')});
  await listen(port);
  await waitPhase(app,'ready');
  console.log('PASS: failed page load displays retry UI and automatically recovers');
  await app.evaluate(async ({BrowserWindow}) => {await BrowserWindow.getAllWindows()[0].contentView.children[0].webContents.executeJavaScript('localStorage.setItem("desktop-persistence-probe", "survived-restart")');});
  await app.close(); app = null;
  const config = JSON.parse(await fs.readFile(path.join(await userData,'desktop.json'),'utf8'));
  assert.equal(config.gateway,address); assert.equal(config.window.width,1100);
  assert.equal(JSON.stringify(config).includes('not-to-save'),false);
  app = await launch(); await waitPhase(app,'ready');
  const retained = await app.evaluate(async ({BrowserWindow}) => {
    const w=BrowserWindow.getAllWindows()[0];
    return {width:w.getBounds().width, probe:await w.contentView.children[0].webContents.executeJavaScript('localStorage.getItem("desktop-persistence-probe")')};
  });
  assert.equal(retained.width,1100); assert.equal(retained.probe,'survived-restart');
  console.log('PASS: full restart restores Gateway, browser storage, and window bounds');
  console.log('Integration checks passed. Screenshots: test-output/');
} finally {
  if (app) await app.close();
  if (server?.listening) await new Promise(resolve => server.close(resolve));
}

})().catch(error => {console.error(error); process.exitCode=1;});
