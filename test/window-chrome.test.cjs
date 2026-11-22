'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {supportsAcrylic, applyWindowChrome} = require('../src/window-chrome.cjs');
test('native glass is gated to supported Windows and restores opaque chrome', () => {
  assert.equal(supportsAcrylic('win32', '10.0.22621'), true);
  for (const [platform, release] of [['linux', '10.0.22621'], ['win32', '10.0.19045'], ['win32', '10.0.22000'], ['win32', 'invalid']]) assert.equal(supportsAcrylic(platform, release), false);
  const calls = [];
  const win = {setBackgroundMaterial: x => calls.push(x), setBackgroundColor: x => calls.push(x)};
  const state = {theme: {background: '#eeeeee'}, video: {backgroundEnabled: true}, phase: 'ready', bootPlaying: false};
  assert.equal(applyWindowChrome(win, state, 'win32', '10.0.26100'), true);
  assert.deepEqual(calls, ['acrylic', '#00000000']);
  applyWindowChrome(win, state, 'win32', '10.0.26100'); assert.equal(calls.length, 2);
  assert.equal(applyWindowChrome(win, {...state, phase: 'setup'}, 'win32', '10.0.26100'), false);
  assert.deepEqual(calls.slice(-2), ['none', '#eeeeee']);
  assert.equal(applyWindowChrome(win, {...state, video: {backgroundEnabled: false}}, 'win32', '10.0.26100'), false);
});
test('failed native material falls back to a fully painted theme surface', () => {
  let color;
  const win = {setBackgroundMaterial() {throw new Error('unavailable');}, setBackgroundColor: x => {color = x;}};
  assert.equal(applyWindowChrome(win, {theme: {background: '#10151c'}, video: {backgroundEnabled: true}, phase: 'ready'}, 'win32', '10.0.26100'), false);
  assert.equal(color, '#10151c');
});
