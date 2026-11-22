'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require('node:path').join(__dirname, '../android/app/src/main/assets/appearance/appearance.js'), 'utf8');
async function fixture(settings, broken = false) {
  let tick, fetches = 0, now = 10000;
  const applied = [], events = {};
  const context = {
    browser: {runtime: {sendNativeMessage: async () => settings, getURL: () => 'moz-extension://local/background.mp4'}},
    fetch: async () => {fetches++; if (broken) throw Error('codec/source'); return {ok: true, blob: async () => ({})};},
    FileReader: class { readAsDataURL() { this.result = 'data:video/mp4;base64,bG9jYWw='; this.onload(); } },
    Date: {now: () => now},
    applyBackground: value => applied.push(value),
    setInterval: fn => {tick = fn; return 1;}, clearInterval() {},
    document: {getElementById: () => null, hidden: false, addEventListener: (name, fn) => {events[name] = fn;}},
    window: {addEventListener: (name, fn) => {events[name] = fn;}}
  };
  vm.runInNewContext(source, context);
  await new Promise(resolve => setImmediate(resolve));
  return {applied, events, context, tick, fetches: () => fetches, advance: () => { now += 4000; }};
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
