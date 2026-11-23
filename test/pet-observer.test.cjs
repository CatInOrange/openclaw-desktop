'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {installPetObserver} = require('../src/pet-observer.cjs');
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };
function harness(handler, initiallyActive = true) {
  const intervals = [], requests = [];
  let clock = Date.now();
  class Socket {
    constructor() { this.readyState = 1; this.listeners = {}; }
    addEventListener(name, cb) { (this.listeners[name] ||= []).push(cb); }
    emit(name, message) { for (const cb of this.listeners[name] || []) cb(name === 'message' ? {data: JSON.stringify(message)} : {}); }
    send(raw) {
      const req = JSON.parse(raw); requests.push(req);
      const value = handler(req);
      if (value !== undefined) queueMicrotask(() => this.emit('message', {type: 'res', id: req.id, ok: !value.error, payload: value, error: value.error}));
    }
  }
  const window = {WebSocket: Socket};
  const context = {window, Date: {now: () => clock}, setInterval: cb => {intervals.push(cb); return cb;}, clearInterval() {}, setTimeout, clearTimeout};
  vm.runInNewContext(`(${installPetObserver.toString()})({initiallyActive:${initiallyActive}})`, context);
  const socket = new window.WebSocket('ws://test');
  socket.emit('message', {type: 'res', id: 'ui-connect', ok: true, payload: {type: 'hello-ok'}});
  return {window, socket, requests, intervals, advance: ms => {clock += ms; intervals[0]();}, drain: () => JSON.parse(JSON.stringify(window.__ocPetObserver.drain())), stop: () => window.__ocPetObserver.stop()};
}

test('authenticated socket reads paginated roster, subscribes idle approvals, and maps structured tool/terminal events', async () => {
  const h = harness(req => {
    if (req.method === 'sessions.subscribe') return {subscribed: true};
    if (req.method === 'sessions.list') return req.params.offset === 0 ? {sessions: [{key: 'agent:a:one', agentId: 'a', hasActiveRun: true, activeRunIds: ['r1']}], hasMore: true, nextOffset: 1} : {sessions: [{key: 'agent:b:idle', agentId: 'b', hasActiveRun: false}], hasMore: false};
    if (req.method === 'sessions.messages.subscribe') return {approvalReplay: {sessionKey: req.params.key, approvals: req.params.agentId === 'b' ? [{id: 'p1', status: 'pending', expiresAtMs: Date.now() + 60000}] : [], truncated: false}};
    return {};
  });
  await flush();
  const initial = h.drain();
  assert.equal(initial.find(e => e.type === 'snapshot').complete, true);
  assert.equal(initial.find(e => e.type === 'snapshot').sessions.length, 2);
  assert.ok(initial.some(e => e.type === 'approval' && e.approvalId === 'p1' && e.phase === 'pending'));
  assert.equal(h.requests.filter(r => r.method === 'sessions.messages.subscribe').length, 2);
  h.socket.emit('message', {type: 'event', event: 'agent', payload: {sessionKey: 'agent:a:one', runId: 'r1', stream: 'tool', data: {phase: 'start', toolCallId: 't1', args: {secret: 'not exported'}}}});
  h.socket.emit('message', {type: 'event', event: 'chat', payload: {sessionKey: 'agent:a:one', runId: 'r1', state: 'final', message: 'not exported'}});
  h.socket.emit('message', {type: 'event', event: 'session.approval', payload: {sessionKey: 'agent:b:idle', phase: 'terminal', approval: {id: 'p1', status: 'approved'}}});
  assert.deepEqual(h.drain().map(e => [e.type, e.phase]), [['tool', 'start'], ['run', 'end'], ['approval', 'resolved']]);
  h.stop();
});

test('permission denied or truncated approval replay preserves activity truth but reports incomplete approval coverage', async () => {
  for (const denied of [true, false]) {
    const h = harness(req => {
      if (req.method === 'sessions.list') return {sessions: [{key: 'agent:a:idle', agentId: 'a', hasActiveRun: false}], hasMore: false};
      if (req.method === 'sessions.messages.subscribe') return denied ? {error: {code: 'FORBIDDEN'}} : {approvalReplay: {sessionKey: req.params.key, approvals: [], truncated: true}};
      return {};
    });
    await flush();
    const events = h.drain();
    assert.equal(events.find(e => e.type === 'snapshot').complete, true);
    assert.equal(events.find(e => e.type === 'snapshot').approvalsComplete, false);
    assert.ok(events.find(e => e.type === 'notice').message);
    h.stop();
  }
});

test('disconnect invalidates an in-flight roster response', async () => {
  let withheld;
  const h = harness(req => {
    if (req.method === 'sessions.list') { withheld = req; return undefined; }
    return {};
  });
  await flush();
  h.drain();
  h.socket.emit('close');
  h.socket.emit('message', {type: 'res', id: withheld.id, ok: true, payload: {sessions: [], hasMore: false}});
  await flush();
  const events = h.drain();
  assert.ok(events.some(e => e.type === 'connection' && e.connected === false));
  assert.ok(!events.some(e => e.type === 'snapshot' && e.complete));
  h.stop();
});


test('periodic authoritative approval replay clears missed terminal notifications', async () => {
  let pending = true;
  const h = harness(req => {
    if (req.method === 'sessions.list') return {sessions: [{key: 'agent:a:idle', agentId: 'a', hasActiveRun: false}], hasMore: false};
    if (req.method === 'sessions.messages.subscribe') return {approvalReplay: {sessionKey: req.params.key, approvals: pending ? [{id: 'p1'}] : [], truncated: false}};
    return {};
  });
  await flush();
  assert.ok(h.drain().some(e => e.type === 'approval' && e.phase === 'pending'));
  pending = false;
  h.advance(31000);
  await flush();
  assert.ok(h.drain().some(e => e.type === 'approval' && e.approvalId === 'p1' && e.phase === 'resolved'));
  h.stop();
});

test('live approval arriving during stale replay is not cleared', async () => {
  let replayRequest;
  const h = harness(req => {
    if (req.method === 'sessions.list') return {sessions: [{key: 'agent:a:idle', agentId: 'a', hasActiveRun: false}], hasMore: false};
    if (req.method === 'sessions.messages.subscribe') { replayRequest = req; return undefined; }
    return {};
  });
  await flush();
  h.drain();
  h.socket.emit('message', {type: 'event', event: 'session.approval', payload: {sessionKey: 'agent:a:idle', phase: 'pending', approval: {id: 'live'}}});
  h.socket.emit('message', {type: 'res', id: replayRequest.id, ok: true, payload: {approvalReplay: {sessionKey: 'agent:a:idle', approvals: [], truncated: false}}});
  await flush();
  const events = h.drain();
  assert.ok(events.some(e => e.type === 'approval' && e.approvalId === 'live' && e.phase === 'pending'));
  assert.ok(!events.some(e => e.type === 'approval' && e.approvalId === 'live' && e.phase === 'resolved'));
  assert.equal(events.find(e => e.type === 'snapshot').approvalsComplete, false);
  h.stop();
});


test('mobile default-off performs no roster RPC; enabling reuses socket and suspension retires subscriptions', async () => {
 const h=harness(req => {
   if(req.method==='sessions.list')return {sessions:[{key:'agent:a:main',agentId:'a',hasActiveRun:false}],hasMore:false};
   if(req.method==='sessions.messages.subscribe')return {approvalReplay:{sessionKey:req.params.key,approvals:[],truncated:false}};
   return {};
 },false);
 await flush();h.advance(16000);await flush();assert.equal(h.requests.length,0);
 h.window.__ocPetObserver.setActive(true);await flush();
 assert.ok(h.drain().some(e=>e.type==='snapshot'&&e.complete));
 h.window.__ocPetObserver.setActive(false);await flush();
 assert.ok(h.requests.some(r=>r.method==='sessions.messages.unsubscribe'));
 const count=h.requests.length;h.advance(16000);await flush();assert.equal(h.requests.length,count);
 h.window.__ocPetObserver.setActive(true);await flush();assert.ok(h.drain().some(e=>e.type==='snapshot'&&e.complete));h.stop();
});
