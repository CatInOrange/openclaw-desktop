const {test} = require('node:test');
const assert = require('node:assert/strict');
const {normalizeGateway, allowedExternal, sameOrigin, restoreBounds} = require('../src/policy.cjs');
test('Gateway accepts base paths but never saves credentials or token URLs', () => {
  assert.equal(normalizeGateway(' https://claw.example.com/control '), 'https://claw.example.com/control/');
  assert.equal(normalizeGateway('http://127.0.0.1:18789'), 'http://127.0.0.1:18789/');
  for (const input of ['file:///etc/passwd', 'javascript:alert(1)', 'https://user:secret@host', 'https://host/?token=secret', 'https://host/#token=secret', 'localhost:18789', '']) assert.throws(() => normalizeGateway(input));
});
test('Navigation boundaries reject native schemes and misleading host names', () => {
  assert.equal(allowedExternal('javascript:alert(1)'), false);
  assert.equal(allowedExternal('file:///tmp/test'), false);
  assert.equal(allowedExternal('https://example.com'), true);
  assert.equal(sameOrigin('https://claw.example.com/a', 'https://claw.example.com/'), true);
  assert.equal(sameOrigin('https://claw.example.com.evil.test', 'https://claw.example.com'), false);
  assert.equal(sameOrigin('http://claw.example.com', 'https://claw.example.com'), false);
});
test('Window removed monitor and corrupt bounds fall back to a visible display', () => {
  const displays = [{workArea:{x:0,y:0,width:1920,height:1080}}];
  assert.deepEqual(restoreBounds({x:2400,y:0,width:1200,height:800}, displays), {width:1200,height:800});
  assert.deepEqual(restoreBounds({x:20,y:20,width:1200,height:800}, displays), {x:20,y:20,width:1200,height:800});
  assert.deepEqual(restoreBounds({width:10000,height:-8}, displays), {width:1920,height:600});
});
