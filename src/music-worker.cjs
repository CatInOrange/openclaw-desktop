'use strict';
// Private worker only. No web server, unlock providers, or credentials in logs.
const {parentPort, workerData} = require('node:worker_threads');
const fs = require('node:fs');
const path = require('node:path');
console.log = console.info = console.warn = console.error = () => {};
// Only the worker bootstrap is unpacked. Resolve dependencies from app.asar,
// not app.asar.unpacked, so thousands of loose files are not extracted each launch.
const appRequire = require('node:module').createRequire(path.join(workerData?.appDirectory || __dirname, 'music-worker.cjs'));
const base = path.dirname(appRequire.resolve('@neteasecloudmusicapienhanced/api/package.json'));
const token = path.join(require('node:os').tmpdir(), 'anonymous_token');
if (!fs.existsSync(token)) fs.writeFileSync(token, '', {mode: 0o600});
const request = appRequire(path.join(base, 'util/request'));
const {cookieToJson} = appRequire(path.join(base, 'util'));
const allowed = new Set(['login_qr_key','login_qr_create','login_qr_check','login_status','user_playlist','playlist_detail','playmode_intelligence_list','song_detail','song_url','likelist','like']);
parentPort.on('message', async ({id, name, args}) => {
  try {
    if (!allowed.has(name)) throw new Error('Unsupported operation');
    const result = await appRequire(path.join(base, 'module', name + '.js'))({
      ...args, cookie: cookieToJson(args.cookie || ''), timeout: 20000, randomCNIP: false,
    }, request);
    parentPort.postMessage({id, body: result.body});
  } catch (error) {
    parentPort.postMessage({id, error: {code: Number(error.body?.code) || Number(error.status) || 0}});
  }
});
