'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const cases=require('../shared/contracts/gateway-cases.json');
const {normalizeGateway,sameOrigin}=require('../src/policy.cjs');
test('desktop Gateway validation conforms to the shared Android/desktop contract',()=>{
 for(const row of cases.valid)assert.equal(normalizeGateway(row.input),row.normalized);
 for(const value of cases.invalid)assert.throws(()=>normalizeGateway(value));
 for(const row of cases.originPairs)assert.equal(sameOrigin(row.a,row.b),row.same);
});
test('desktop compatibility entry uses the single portable music business core',()=>{
 assert.equal(require('../src/music-controller.cjs').MusicController,require('../shared/core/music-controller.cjs').MusicController);
});
