'use strict';
const {Worker} = require('node:worker_threads');
const fs = require('node:fs');
const path = require('node:path');
function createMusicApi(directory) {
  fs.mkdirSync(directory, {recursive: true, mode: 0o700});
  const worker = new Worker(path.join(__dirname.replace(/app\.asar([/\\])/, 'app.asar.unpacked$1'), 'music-worker.cjs'), {
    workerData: {appDirectory: __dirname},
    env: {...process.env, TMPDIR: directory, TMP: directory, TEMP: directory, NETEASE_COOKIE: '', ENABLE_RANDOM_CN_IP: 'false'},
    stdout: true, stderr: true,
  });
  // Do not forward dependency diagnostics: upstream errors can contain cookies.
  worker.stdout.resume(); worker.stderr.resume();
  let sequence = 0, closed = false;
  const pending = new Map();
  function rejectAll() {
    closed = true;
    for (const {reject, timer} of pending.values()) {clearTimeout(timer); reject(new Error('音乐服务已停止，请重启客户端。'));}
    pending.clear();
  }
  worker.on('error', rejectAll); worker.on('exit', rejectAll);
  worker.on('message', ({id, body, error}) => {
    const item = pending.get(id); if (!item) return;
    pending.delete(id); clearTimeout(item.timer);
    if (error) {const failure = new Error('网易云请求失败，请稍后重试。'); failure.code = error.code; item.reject(failure);} else item.resolve(body);
  });
  return {
    call(name, args = {}) {
      if (closed) return Promise.reject(new Error('音乐服务已停止，请重启客户端。'));
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        const timer = setTimeout(() => {pending.delete(id); reject(new Error('音乐请求超时，请稍后重试。'));}, 25000);
        pending.set(id, {resolve, reject, timer}); worker.postMessage({id, name, args});
      });
    },
    stop() {rejectAll(); void worker.terminate();},
  };
}
function createMusicVault(directory, safeStorage) {
  const file = path.join(directory, 'music-session.bin');
  return {
    load() {try {return safeStorage.isEncryptionAvailable() && safeStorage.getSelectedStorageBackend?.() !== 'basic_text' ? safeStorage.decryptString(fs.readFileSync(file)) : '';} catch {return '';}},
    save(cookie) {
      if (!safeStorage.isEncryptionAvailable() || safeStorage.getSelectedStorageBackend?.() === 'basic_text') return false;
      fs.mkdirSync(directory, {recursive:true});
      fs.writeFileSync(file + '.tmp', safeStorage.encryptString(cookie), {mode:0o600});
      fs.renameSync(file + '.tmp', file); return true;
    },
    clear() {try {fs.unlinkSync(file);} catch {}},
  };
}
module.exports = {createMusicApi, createMusicVault};
