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
test('isolated observer mirrors theme changes, overrides and suppresses duplicates', () => {
  let ready, notify;
  const sent = [];
  const vars = {'--bg': 'rgb(250, 249, 246)', '--text': 'rgb(32, 36, 42)'};
  const root = {dataset: {themeMode: 'light'}, appendChild() {}};
  const window = {addEventListener(_name, cb) {ready = cb;}, matchMedia() {return {addEventListener() {}};}};
  window.top = window;
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/remote-theme.cjs'), 'utf8'), {
    require: () => ({ipcRenderer: {send: (_channel, value) => sent.push(value)}}), window,
    document: {documentElement: root, addEventListener() {}, createElement() {return {style: {}, remove() {}};}},
    getComputedStyle: el => el === root ? {colorScheme: root.dataset.themeMode, getPropertyValue: key => vars[key] || ''} : {color: el.style.color},
    MutationObserver: class {constructor(cb) {notify = cb;} observe() {}},
    setTimeout: cb => {cb(); return 1;}, clearTimeout() {},
  });
  ready();
  assert.equal(sent[0].background, vars['--bg']);
  notify(); assert.equal(sent.length, 1);
  root.dataset.themeMode = 'dark'; vars['--bg'] = 'rgb(16, 21, 28)'; vars['--text'] = 'rgb(233, 237, 243)';
  notify(); assert.equal(sent[1].dark, true); assert.equal(sent[1].background, vars['--bg']);
  vars['--desktop-titlebar-bg'] = 'rgb(0, 0, 0)'; notify(); assert.equal(sent[2].background, 'rgb(0, 0, 0)');
});
