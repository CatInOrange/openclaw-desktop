'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createPetState, applyPetEvent: apply, summarizePetState: summary} = require('../src/pet-state.cjs');
const a = {key: 'agent:a:main', agentId: 'a', sessionId: 'A'};
const b = {key: 'agent:b:main', agentId: 'b', sessionId: 'B'};
function ready(rows) {const s=createPetState(); apply(s,{type:'connection',connected:true}); apply(s,{type:'snapshot',sessions:rows,complete:true});return s;}
test('direct activity counts agents, not parent child projections or sessions', () => {
  const s=ready([{...a,hasActiveRun:true},{...a,key:'agent:a:other',hasActiveRun:true},{...b,hasActiveRun:false,hasActiveSubagentRun:true}]);
  assert.equal(summary(s).activeAgents,1);assert.equal(summary(s).activeSessions,2);assert.equal(summary(s).action,'thinking');
});
test('one terminal cannot clear another agent; exact tools tracked independently', () => {
  const s=ready([{...a,hasActiveRun:true,activeRunIds:['r1','r2']},{...b,hasActiveRun:true,activeRunIds:['r3']}]);
  for(const [runId,toolCallId] of [['r1','t1'],['r2','t2']])apply(s,{...a,type:'tool',phase:'start',runId,toolCallId},100);
  apply(s,{...a,type:'tool',phase:'end',runId:'r1',toolCallId:'t1'},200);
  assert.equal(summary(s,200).action,'working');
  apply(s,{...a,type:'run',phase:'end',runId:'r2'},300);
  assert.equal(summary(s,300).activeAgents,2); // aggregate fact awaits snapshot
  apply(s,{type:'snapshot',complete:true,sessions:[{...a,hasActiveRun:false},{...b,hasActiveRun:true}]},400);
  assert.equal(summary(s,400).activeAgents,1);assert.equal(summary(s,400).action,'thinking');
});
test('approval priority, resolution, expiration, errors do not mask active work', () => {
  const s=ready([{...a,hasActiveRun:true},{...b,hasActiveRun:false}]);
  apply(s,{...b,type:'approval',phase:'pending',approvalId:'p',expiresAt:1000},100);
  assert.equal(summary(s,500).action,'waiting');assert.equal(summary(s,1001).waitingCount,0);
  apply(s,{...b,type:'run',phase:'error',runId:'r'},1100);
  assert.equal(summary(s,1100).action,'thinking');assert.equal(summary(s,1100).errorCount,1);
});
test('disconnection retires prompts; reconnect and incomplete snapshots never report idle', () => {
  const s=ready([{...a,hasActiveRun:false}]);
  apply(s,{...a,type:'approval',phase:'pending',approvalId:'p'});
  apply(s,{type:'connection',connected:false});assert.equal(summary(s).action,'offline');
  apply(s,{type:'connection',connected:true});assert.equal(summary(s).action,'unknown');assert.equal(summary(s).waitingCount,0);
  apply(s,{type:'snapshot',sessions:[],complete:false});assert.equal(summary(s).action,'unknown');
  apply(s,{type:'snapshot',sessions:[],complete:true});assert.equal(summary(s).action,'idle');
});
test('missing exact run IDs does not imply idle, unknown direct activity stays unknown', () => {
  assert.equal(summary(ready([{...a,hasActiveRun:true}])).action,'thinking');
  assert.equal(summary(ready([{...a,activeRunIds:[]}])).action,'unknown');
});
test('new session generation does not inherit old prompts, errors or tools', () => {
  const s=ready([{...a,hasActiveRun:true}]);
  apply(s,{...a,type:'approval',phase:'pending',approvalId:'p'});
  apply(s,{type:'snapshot',complete:true,sessions:[{...a,sessionId:'new',hasActiveRun:false}]});
  assert.equal(summary(s).action,'idle');assert.equal(summary(s).waitingCount,0);
});
test('success requires authoritative no-active snapshot, abort does not celebrate', () => {
  const s=ready([{...a,hasActiveRun:true}]);
  apply(s,{...a,type:'run',runId:'r',phase:'end'},100);
  assert.notEqual(summary(s,100).action,'success');
  apply(s,{type:'snapshot',complete:true,sessions:[{...a,hasActiveRun:false}]},200);
  assert.equal(summary(s,200).action,'success');assert.equal(summary(s,5000).action,'idle');
  apply(s,{...a,type:'run',runId:'r2',phase:'aborted'},6000);assert.equal(summary(s,6000).action,'idle');
});
test('stable focus and missing session ID events resolve only unique session', () => {
  const s=ready([{...a,hasActiveRun:true},{...b,hasActiveRun:true}]);
  const focus=summary(s).focus;
  apply(s,{key:b.key,type:'run',phase:'start',runId:'r'});
  assert.equal(s.sessions.size,2);assert.equal(summary(s).focus,focus);
});
test('late events from retired generations cannot replace a fresh row', () => {
  const s=ready([{...a,sessionId:'new',hasActiveRun:false}]);
  apply(s,{...a,type:'tool',phase:'start',runId:'old',toolCallId:'old'});
  assert.equal(summary(s).action,'idle');assert.equal(summary(s).sessions[0].sessionId,'new');
});
