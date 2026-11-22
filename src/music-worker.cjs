'use strict';
// Private worker only. No web server, unlock providers, or credentials in logs.
const {parentPort} = require('node:worker_threads');
const fs = require('node:fs');
const path = require('node:path');
console.log = console.info = console.warn = console.error = () => {};
const base = path.dirname(require.resolve('@neteasecloudmusicapienhanced/api/package.json'));
const token = path.join(require('node:os').tmpdir(), 'anonymous_token');
if (!fs.existsSync(token)) fs.writeFileSync(token, '', {mode: 0o600});
const request = require(path.join(base, 'util/request'));
const {cookieToJson} = require(path.join(base, 'util'));
const allowed = new Set(['login_qr_key','login_qr_create','login_qr_check','login_status','user_playlist','playlist_detail','playmode_intelligence_list','song_detail','song_url','likelist','like']);
parentPort.on('message', async ({id, name, args}) => {
  try {
    if (!allowed.has(name)) throw new Error('Unsupported operation');
    const result = await require(path.join(base, 'module', name + '.js'))({
      ...args, cookie: cookieToJson(args.cookie || ''), timeout: 20000, randomCNIP: false,
    }, request);
    parentPort.postMessage({id, body: result.body});
  } catch (error) {
    parentPort.postMessage({id, error: {code: Number(error.body?.code) || Number(error.status) || 0}});
  }
});
