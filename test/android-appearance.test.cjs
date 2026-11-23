'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require('node:path').join(__dirname, '../android/app/src/main/assets/appearance/appearance.js'), 'utf8');
async function fixture(settings, broken = false) {
  let tick, fetches = 0, now = 10000;
  const reports = [];
  const applied = [], events = {};
  const context = {
    browser: {runtime: {sendNativeMessage: async (_, message) => { reports.push(message.status); return typeof settings === 'string' ? settings : JSON.stringify(settings); },
      sendMessage: async () => {fetches++; if (broken) throw Error('secret URL/token'); return {url: 'data:video/mp4;base64,bG9jYWw='};}}},
    fetch: () => {throw Error('content fetch forbidden');},
    Date: {now: () => now},
    applyBackground: value => applied.push(value),
    setInterval: fn => {tick = fn; return 1;}, clearInterval() {},
    document: {getElementById: () => null, hidden: false, addEventListener: (name, fn) => {events[name] = fn;}},
    window: {addEventListener: (name, fn) => {events[name] = fn;}}
  };
  vm.runInNewContext(source, context);
  await new Promise(resolve => setImmediate(resolve));
  return {applied, events, context, tick, reports, fetches: () => fetches, advance: () => { now += 4000; }};
}
test('Android appearance never loads media when native origin authorization denies', async () => {
  const run = await fixture({allowed: false, enabled: true});
  assert.equal(run.fetches(), 0); assert.equal(run.applied.length, 0);
});
test('Android appearance uses origin-independent cached data media, pauses when hidden, stops on unload', async () => {
  const run = await fixture({allowed: true, enabled: true, active: true, strength: 60});
  assert.equal(run.applied.at(-1).url, 'data:video/mp4;base64,bG9jYWw='); assert.equal(run.applied.at(-1).active, true);
  run.context.document.hidden = true; await run.tick();
  assert.equal(run.applied.at(-1).active, false); assert.equal(run.fetches(), 1);
  run.events.pagehide({persisted: false});
  assert.equal(run.applied.at(-1).enabled, false); const count = run.applied.length; await run.tick(); assert.equal(run.applied.length, count);
});
test('Android local media failure backs off, then permits retry', async () => {
  const run = await fixture({allowed: true, enabled: true, active: true}, true);
  assert.equal(run.applied.at(-1).enabled, false);
  await run.tick(); assert.equal(run.fetches(), 1); assert.equal(run.applied.at(-1).enabled, false);
  assert.equal(run.reports.at(-1).error, 'local-media-message:Error');
  run.advance(); await run.tick(); assert.equal(run.fetches(), 2);
});

test('a transient native message failure does not permanently disable wallpaper', async () => {
  const run = await fixture({allowed: true, enabled: true, active: true});
  run.context.browser.runtime.sendNativeMessage = async () => { throw Error('disconnected'); };
  await run.tick(); assert.equal(run.applied.at(-1).enabled, false);
  run.context.browser.runtime.sendNativeMessage = async () => ({allowed: true, enabled: true, active: true});
  run.advance(); await run.tick();
  assert.equal(run.applied.at(-1).enabled, true);
  assert.equal(run.fetches(), 1);
});

 test('media service only answers same-extension top-level content with fixed bundled bytes', async () => {
  let listener;
  const context = {OPENCLAW_BACKGROUND_MEDIA: 'data:video/mp4;base64,bG9jYWw=',
    browser: {runtime: {id: 'appearance@openclaw.mobile', onMessage: {addListener(fn) {listener = fn;}}}}};
  vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname, '../android/app/src/main/assets/appearance/media-service.js'), 'utf8'), context);
  const sender = {id: 'appearance@openclaw.mobile', frameId: 0, url: 'https://gateway.example/'};
  assert.equal((await listener({type: 'bundled-wallpaper'}, sender)).url, context.OPENCLAW_BACKGROUND_MEDIA);
  assert.equal((await listener({type: 'bundled-wallpaper'}, {...sender, frameId: undefined})).url, context.OPENCLAW_BACKGROUND_MEDIA);
  for (const denied of [{...sender, id: 'another'}, {...sender, frameId: 1}, {...sender, url: 'file:///private'}]) {
    assert.equal(listener({type: 'bundled-wallpaper'}, denied), undefined);
  }
  assert.equal(listener({type: 'fetch', url: 'https://arbitrary.example/'}, sender), undefined);
});

test('renderer exceptions retain a bounded stage, never raw exception text', async () => {
  const run = await fixture({allowed: true, enabled: true, active: true});
  run.context.applyBackground = settings => {if (settings.enabled) throw new TypeError('private URL and token');};
  await run.tick(); await run.tick();
  assert.equal(run.reports.at(-1).error, 'renderer:TypeError');
});

test('native JSON string is decoded before authorization and rendering', async () => {
  const run = await fixture(JSON.stringify({allowed: true, enabled: true, active: true, strength: 61}));
  assert.equal(run.fetches(), 1);
  assert.equal(run.applied.at(-1).strength, 61);
  const denied = await fixture(JSON.stringify({allowed: false, enabled: true}));
  assert.equal(denied.fetches(), 0);
  const malformed = await fixture('{');
  await malformed.tick();
  assert.equal(malformed.fetches(), 0);
  assert.equal(malformed.reports.at(-1).state, 'error');
  assert.match(malformed.reports.at(-1).error, /^settings-decode:/);
});
