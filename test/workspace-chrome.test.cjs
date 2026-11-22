'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {applyWorkspaceChrome} = require('../src/workspace-chrome.cjs');
function fixture() {
  const elements = new Map();
  const make = () => {
    const attrs = new Map(), values = new Map();
    return {attrs, style: {setProperty: (k,v) => values.set(k,v), getPropertyValue: k => values.get(k)},
      setAttribute(k,v) {attrs.set(k,v);}, removeAttribute(k) {attrs.delete(k);}, hasAttribute(k) {return attrs.has(k);},
      remove() {elements.delete(this.id);}, getBoundingClientRect() {return this.rect;}};
  };
  const root = make(), header = make();
  header.rect = {top: 0, right: 1200, width: 950, height: 48};
  const document = {documentElement: root, body: {appendChild: x => elements.set(x.id,x)}, createElement: make,
    getElementById: id => elements.get(id), querySelectorAll: selector => selector.includes('data-oc-caption-row') ? [header] : [header]};
  const context = {document, window: {innerWidth: 1200}};
  return {root, header, elements, apply: settings => vm.runInNewContext(`(${applyWorkspaceChrome.toString()})(${JSON.stringify(settings)})`,context)};
}
test('caption layout reserves only the right header, scales with zoom, and restores on fullscreen/hidden', () => {
  const f = fixture(), settings = {integratedChrome: true, chromeActive: true, reserveControls: true, zoom: 1};
  f.apply(settings);
  assert.equal(f.header.attrs.get('data-oc-caption-row'), 'right');
  assert.equal(f.root.style.getPropertyValue('--oc-caption-inset'), '144px');
  assert.equal(f.elements.size, 0);
  f.apply({...settings, zoom: .5}); assert.equal(f.root.style.getPropertyValue('--oc-caption-inset'), '288px');
  f.apply({...settings, reserveControls: false}); assert.equal(f.root.style.getPropertyValue('--oc-caption-inset'), '0px');
  f.header.rect.right = 800; f.apply(settings); assert.equal(f.header.attrs.get('data-oc-caption-row'), 'left');
  for (const patch of [{fullscreen: true}, {chromeActive: false}, {integratedChrome: false}]) {
    f.apply({...settings,...patch}); assert.equal(f.root.hasAttribute('data-oc-caption'), false);
    assert.equal(f.header.hasAttribute('data-oc-caption-row'), false);
  }
});
test('pages without a toolbar get a fallback that disappears when chat returns', () => {
  const f = fixture(), settings = {integratedChrome: true, chromeActive: true, reserveControls: true, zoom: 1};
  f.header.rect.height = 0; f.apply(settings);
  assert.equal(f.root.hasAttribute('data-oc-caption-fallback'), true); assert.equal(f.elements.size, 1);
  f.header.rect = {top: 48, right: 1200, width: 950, height: 48}; f.apply(settings);
  assert.equal(f.root.hasAttribute('data-oc-caption-fallback'), false); assert.equal(f.elements.size, 0);
});
