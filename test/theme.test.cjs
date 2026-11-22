'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const {normalizeTheme} = require('../src/theme.cjs');
test('theme IPC and saved settings accept only opaque RGB colors', () => {
  const theme = {background: 'rgb(250, 249, 246)', foreground: 'rgb(32, 36, 42)', dark: false};
  assert.deepEqual(normalizeTheme({...theme, unexpected: 'ignored'}), theme);
  for (const value of [null, {}, {...theme, dark: 'false'}, {...theme, background: 'rgb(999, 0, 0)'}, {...theme, background: 'url(https://example.com)'}, {...theme, foreground: 'rgba(0, 0, 0, 0)'}]) assert.equal(normalizeTheme(value), null);
});
test('reader reflects current light, dark and skin overrides in an isolated world', () => {
  const {readTheme} = require('../src/theme-sync.cjs');
  const vars = {'--bg': 'rgb(250, 249, 246)', '--text': 'rgb(32, 36, 42)'};
  const root = {dataset: {themeMode: 'light'}, appendChild() {}};
  const context = {
    document: {documentElement: root, createElement() {return {style: {}, remove() {}};}},
    getComputedStyle: el => el === root ? {getPropertyValue: key => vars[key] || ''} : {color: el.style.color},
  };
  const sample = () => vm.runInNewContext(`(${readTheme.toString()})()`, context);
  assert.equal(sample().background, vars['--bg']);
  root.dataset.themeMode = 'dark'; vars['--bg'] = 'rgb(16, 21, 28)';
  assert.equal(sample().dark, true); assert.equal(sample().background, vars['--bg']);
  vars['--desktop-titlebar-bg'] = 'rgb(0, 0, 0)';
  assert.equal(sample().background, vars['--desktop-titlebar-bg']);
});
test('main-owned watcher retries after failures and stops without late updates', async () => {
  const {EventEmitter} = require('node:events');
  const {watchTheme} = require('../src/theme-sync.cjs');
  const wc = new EventEmitter(); wc.isDestroyed = () => false;
  let resolve, calls = 0, errors = 0;
  wc.executeJavaScriptInIsolatedWorld = (id, scripts) => {
    assert.equal(id, 1001); assert.ok(scripts[0].code.includes('getComputedStyle'));
    calls++;
    if (calls === 1) return Promise.reject(new Error('navigation'));
    return new Promise(done => {resolve = done;});
  };
  const updates = [];
  const stop = watchTheme(wc, value => updates.push(value), () => errors++, 60000);
  await new Promise(done => setImmediate(done));
  assert.equal(errors, 1);
  wc.emit('dom-ready');
  wc.emit('dom-ready'); assert.equal(calls, 2); // no overlapping reads
  resolve({dark: false}); await new Promise(done => setImmediate(done));
  assert.equal(updates.length, 1);
  wc.emit('dom-ready'); stop(); resolve({dark: true});
  await new Promise(done => setImmediate(done));
  assert.equal(updates.length, 1); assert.equal(wc.listenerCount('dom-ready'), 0);
});
