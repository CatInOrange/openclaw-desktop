'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require('node:path').join(__dirname, '../android/app/src/main/assets/appearance/appearance.js'), 'utf8');
async function fixture(settings, broken = false) {
  let tick, fetches = 0, revoked = false;
  const applied = [], events = {};
  const context = {
    browser: {runtime: {sendNativeMessage: async () => settings, getURL: () => 'moz-extension://local/background.mp4'}},
    fetch: async () => {fetches++; if (broken) throw Error('codec/source'); return {ok: true, blob: async () => ({})};},
    URL: {createObjectURL: () => 'blob:local', revokeObjectURL: () => {revoked = true;}},
    applyBackground: value => applied.push(value),
    setInterval: fn => {tick = fn; return 1;}, clearInterval() {},
    document: {hidden: false, addEventListener: (name, fn) => {events[name] = fn;}},
    window: {addEventListener: (name, fn) => {events[name] = fn;}}
  };
  vm.runInNewContext(source, context);
  await new Promise(resolve => setImmediate(resolve));
  return {applied, events, context, tick, fetches: () => fetches, revoked: () => revoked};
}
test('Android appearance never loads media when native origin authorization denies', async () => {
  const run = await fixture({allowed: false, enabled: true});
  assert.equal(run.fetches(), 0); assert.equal(run.applied.length, 0);
});
test('Android appearance uses a cached local blob, pauses when hidden, releases on unload', async () => {
  const run = await fixture({allowed: true, enabled: true, active: true, strength: 60});
  assert.equal(run.applied.at(-1).url, 'blob:local'); assert.equal(run.applied.at(-1).active, true);
  run.context.document.hidden = true; await run.tick();
  assert.equal(run.applied.at(-1).active, false); assert.equal(run.fetches(), 1);
  run.events.pagehide({persisted: false});
  assert.equal(run.applied.at(-1).enabled, false); assert.equal(run.revoked(), true);
});
test('Android local media failure falls back without repeated loading', async () => {
  const run = await fixture({allowed: true, enabled: true, active: true}, true);
  assert.equal(run.applied.at(-1).enabled, false);
  await run.tick(); assert.equal(run.fetches(), 1); assert.equal(run.applied.at(-1).enabled, false);
});
