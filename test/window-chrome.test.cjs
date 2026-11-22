'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {windowChromeOptions, applyWindowChrome} = require('../src/window-chrome.cjs');
test('transparent native captions merge into workspace and retain local setup controls', () => {
  const calls = [];
  const win = {setTitleBarOverlay: x => calls.push(x), setBackgroundColor() {}};
  const theme = {background: '#10151c', foreground: '#eeeeee'};
  assert.equal(windowChromeOptions('win32', theme).titleBarStyle, 'hidden');
  assert.equal(windowChromeOptions('linux', theme).frame, false);
  const state = {theme, phase: 'ready', canBack: true, bootPlaying: false};
  assert.equal(applyWindowChrome(win, state, 'win32'), true);
  assert.deepEqual(calls[0], {color: '#00000000', symbolColor: '#eeeeee', height: 48});
  applyWindowChrome(win, state, 'win32'); assert.equal(calls.length, 1);
  applyWindowChrome(win, {...state, theme: {...theme, foreground: '#111111'}}, 'win32');
  assert.equal(calls.at(-1).symbolColor, '#111111');
  assert.equal(applyWindowChrome(win, {...state, phase: 'setup'}, 'win32'), false);
  assert.equal(calls.at(-1).height, 32);
});
