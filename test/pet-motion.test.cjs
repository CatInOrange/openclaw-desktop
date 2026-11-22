'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {planWalk,walkPosition}=require('../src/pet-motion.cjs');
const area={x:-1200,y:0,width:1200,height:900};
test('walk distances scale with upstream 462 reference width and land at the exact planned endpoint',()=>{
 for(const size of [231,462,720]){
  const p=planWalk({bounds:{x:-800,y:100},area,size,direction:1,random:()=>.5});assert.ok(p);assert.equal(p.targetX-p.startX,Math.round(150*size/462));
  assert.equal(walkPosition(p,0).x,p.startX);assert.equal(walkPosition(p,1).x,p.targetX);assert.equal(walkPosition(p,2).x,p.targetX);
 }
});
test('an unreachable whole step is rejected, not shortened at the edge; transparent padding is allowed',()=>{
 const a={x:0,y:0,width:1000,height:800};
 assert.equal(planWalk({bounds:{x:-100,y:200},area:a,size:462,direction:-1,random:()=>0}),null);
 const p=planWalk({bounds:{x:0,y:200},area:a,size:462,direction:-1,random:()=>0});assert.ok(p);assert.equal(p.targetX,-60);assert.equal(p.y,200);
});
