'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const {EventEmitter} = require('node:events');
const {createHash} = require('node:crypto');
const {normalizeVideo, updateVideo} = require('../src/video-config.cjs');
const {byteRange, createMediaHandler} = require('../src/media.cjs');
const {applyBackground} = require('../src/background.cjs');
const {createBootPlayer} = require('../src/boot.js');

test('video preferences preserve independent switches and reject invalid patches', () => {
  const initial = normalizeVideo(null);
  assert.equal(initial.bootEnabled, true);
  const next = updateVideo(initial, {bootEnabled: false, strength: 12});
  assert.equal(next.bootEnabled, false); assert.equal(next.backgroundEnabled, true); assert.equal(next.strength, 12);
  assert.equal(normalizeVideo({strength: -8}).strength, 0);
  for (const patch of [{strength: NaN}, {strength: 101}, {bootSound: 'yes'}, {unknown: true}, []]) assert.throws(() => updateVideo(initial, patch));
});

test('media handler serves full, ranged, suffix and HEAD requests but no other local files', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-media-'));
  try {
    fs.writeFileSync(path.join(dir, 'boot.mp4'), '0123456789');
    const serve = createMediaHandler(dir);
    const request = (suffix = '/boot.mp4', options) => serve(new Request('oc-video://assets' + suffix, options));
    let response = await request(); assert.equal(response.status, 200); assert.equal(await response.text(), '0123456789');
    response = await request('/boot.mp4', {headers: {Range: 'bytes=2-4'}});
    assert.equal(response.status, 206); assert.equal(response.headers.get('content-range'), 'bytes 2-4/10'); assert.equal(await response.text(), '234');
    response = await request('/boot.mp4', {headers: {Range: 'bytes=-3'}}); assert.equal(await response.text(), '789');
    response = await request('/boot.mp4', {method: 'HEAD'}); assert.equal(response.headers.get('content-length'), '10'); assert.equal(await response.text(), '');
    response = await request('/boot.mp4', {headers: {Range: 'bytes=10-'}}); assert.equal(response.status, 416);
    assert.equal((await request('/desktop.json')).status, 404);
    assert.equal((await request('/%2e%2e%2fdesktop.json')).status, 404);
    assert.equal((await request('/boot.mp4', {method: 'POST'})).status, 405);
    assert.equal((await serve(new Request('oc-video://other/boot.mp4'))).status, 404);
    assert.equal((await request('/background.mp4')).status, 404);
    assert.equal(byteRange('bytes=0-1,4-5', 10), null); assert.equal(byteRange('bytes=-0', 10), null);
  } finally {fs.rmSync(dir, {recursive: true, force: true});}
});

test('bundled videos are the unmodified, pinned upstream files with attribution', () => {
  const assets = path.join(__dirname, '../assets/video');
  for (const [name, expected] of [['boot.mp4', 'e95b45d08d6bdbb0b42f97dc3bcb3891debd27347a1ab9589d257a305abae2db'], ['background.mp4', '9187a3947dca8ce83e2832ac3d884a05fc36349e253a29b5b11bb4f829ece937']]) {
    assert.equal(createHash('sha256').update(fs.readFileSync(path.join(assets, name))).digest('hex'), expected);
  }
  assert.match(fs.readFileSync(path.join(assets, 'LICENSE.dsh-video-skin'), 'utf8'), /MIT License/);
  assert.match(fs.readFileSync(path.join(assets, 'NOTICE.md'), 'utf8'), /Something11235/);
});

class Element extends EventEmitter {
  constructor() {
    super(); this.attributes = new Map(); this.paused = true; this.volume = 1; this.plays = 0; this.pauses = 0; this.isConnected = false;
    const values = new Map();
    this.style = {setProperty: (k, v) => values.set(k, v), getPropertyValue: k => values.get(k) || '', removeProperty: k => values.delete(k)};
    this.classList = {add() {}};
  }
  setAttribute(k, v) {this.attributes.set(k, v);}
  getAttribute(k) {return this.attributes.get(k) || null;}
  removeAttribute(k) {this.attributes.delete(k);}
  set src(v) {this.setAttribute('src', v);}
  addEventListener(name, callback) {this.on(name, callback);}
  appendChild(child) {this.child = child;}
  prepend(child) {this.child = child; child.isConnected = true;}
  remove() {this.isConnected = false;}
  play() {this.plays++; this.paused = false; this.emit('playing'); return this.rejectPlay ? Promise.reject(new Error('autoplay')) : Promise.resolve();}
  pause() {this.paused = true; this.pauses++;}
  load() {}
}

test('background stays silent, pauses while hidden, adapts themes, and restores native surfaces when off or failed', async () => {
  const root = new Element(); root.dataset = {themeMode: 'dark'};
  const body = new Element();
  const context = {document: {documentElement: root, body, hidden: false, createElement: () => new Element()}, getComputedStyle: () => ({colorScheme: 'dark'})};
  const apply = settings => vm.runInNewContext(`(${applyBackground.toString()})(${JSON.stringify(settings)})`, context);
  const settings = {enabled: true, active: true, strength: 60, url: 'oc-video://assets/background.mp4'};
  apply(settings); await new Promise(done => setImmediate(done));
  let video = body.child.child;
  assert.equal(video.muted, true); assert.equal(video.volume, 0); assert.equal(video.loop, true);
  assert.equal(root.getAttribute('data-oc-video'), 'on');
  const darkSurface = root.style.getPropertyValue('--oc-video-surface');
  root.dataset.themeMode = 'light'; apply(settings);
  assert.notEqual(root.style.getPropertyValue('--oc-video-surface'), darkSurface);
  assert.equal(root.style.getPropertyValue('--bg'), '');
  apply({...settings, active: false}); assert.equal(video.paused, true);
  apply(settings); assert.equal(video.paused, false);
  context.document.hidden = true; apply(settings); assert.equal(video.paused, true);
  context.document.hidden = false;
  video.emit('error'); assert.equal(root.getAttribute('data-oc-video'), null); assert.equal(apply(settings).state, 'error');
  apply({...settings, enabled: false}); assert.equal(video.getAttribute('src'), null);
  assert.equal(root.style.getPropertyValue('--oc-video-surface'), '');
  apply(settings); assert.notEqual(body.child.child, video);
});

function fakeClock() {
  let now = 0, id = 0;
  const tasks = new Map();
  const clock = {
    setTimeout(fn, ms) {tasks.set(++id, {fn, at: now + ms}); return id;},
    clearTimeout(id) {tasks.delete(id);},
    setInterval(fn, ms) {tasks.set(++id, {fn, at: now + ms, interval: ms}); return id;},
    clearInterval(id) {tasks.delete(id);},
    tick(ms) {
      const end = now + ms;
      while (true) {
        const [key, task] = [...tasks].filter(([, task]) => task.at <= end).sort((a,b) => a[1].at - b[1].at)[0] || [];
        if (!task) break;
        now = task.at; tasks.delete(key);
        if (task.interval) tasks.set(key, {...task, at: now + task.interval});
        task.fn();
      }
      now = end;
    },
  };
  return clock;
}
function bootFixture() {
  const video = new Element(), overlay = new Element(), clock = fakeClock();
  let done = 0;
  const player = createBootPlayer({video, overlay, clock, onDone: () => done++});
  return {video, overlay, clock, player, done: () => done};
}
test('boot plays through with audio by default, exposes no skip or sound control, and finishes once', async () => {
  const f = bootFixture();
  await f.player.start({url: 'oc-video://assets/boot.mp4'});
  assert.equal(f.video.muted, false); assert.equal(f.video.volume, 1);
  assert.equal(f.player.skip, undefined); assert.equal(f.player.toggleSound, undefined);
  f.clock.tick(8000); assert.equal(f.done(), 0);
  f.video.emit('ended'); f.clock.tick(150); assert.ok(f.video.volume < 1); assert.equal(f.done(), 0);
  f.clock.tick(200); assert.equal(f.done(), 1); assert.equal(f.overlay.hidden, true);
  f.video.emit('ended'); f.clock.tick(20000); assert.equal(f.done(), 1);
  await f.player.start({sound: true, url: 'ignored'}); assert.equal(f.video.plays, 1);
});
test('boot autoplay rejection falls back to mute and decoding failure never blocks entry', async () => {
  const f = bootFixture();
  let attempts = 0;
  f.video.play = () => {if (++attempts === 1) return Promise.reject(new Error('autoplay')); f.video.emit('playing'); return Promise.resolve();};
  await f.player.start({sound: true, url: 'video'});
  assert.equal(f.video.muted, true);
  assert.equal(f.done(), 0); f.video.emit('error'); assert.equal(f.done(), 1);
});
test('no-first-frame or never-ending media still has an automatic error deadline', async () => {
  for (const action of ['no-frame', 'never-ends']) {
    const f = bootFixture();
    if (action === 'no-frame') f.video.play = () => Promise.resolve();
    await f.player.start({sound: false, url: 'video'});
    f.clock.tick(action === 'no-frame' ? 5100 : 19000);
    assert.equal(f.done(), 1, action);
  }
});

test('background controller reapplies CSS after navigation and drops stale read results', async () => {
  const {watchBackground} = require('../src/background.cjs');
  const wc = new EventEmitter(); wc.isDestroyed = () => false;
  let release, cssCalls = 0, reads = 0;
  wc.insertCSS = () => {if (++cssCalls === 1) return new Promise(done => {release = done;}); return Promise.resolve();};
  wc.executeJavaScriptInIsolatedWorld = (world) => {assert.equal(world, 1002); reads++; return Promise.resolve({state: 'off'});};
  const updates = [];
  const watcher = watchBackground(wc, () => ({enabled: false}), value => updates.push(value), 60000);
  try {
    wc.emit('dom-ready'); wc.emit('dom-ready'); release();
    await new Promise(done => setImmediate(done));
    assert.equal(reads, 0);
    await watcher.refresh(); assert.equal(cssCalls, 2); assert.deepEqual(updates, ['off']);
    watcher.stop(); await watcher.refresh(); assert.equal(reads, 1); assert.equal(wc.listenerCount('dom-ready'), 0);
  } finally {watcher.stop();}
});
