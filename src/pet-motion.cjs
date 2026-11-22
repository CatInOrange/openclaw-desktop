'use strict';
// Geometry/parameters follow dsh-pet 0.4.9 move-action.ts, motion.ts and
// assets/config.jsonc. Work in Electron DIP, not physical screen pixels.
function planWalk({bounds,area,size,direction,random=Math.random}) {
 const distance=(60+180*random())*size/462;
 const targetX=Math.round(bounds.x+(direction===1?1:-1)*distance);
 const side=size*200/640,margin=20;
 // Transparent padding may overhang; the character body must stay reachable.
 if(targetX+side<area.x+margin||targetX+size-side>area.x+area.width-margin)return null;
 return {startX:bounds.x,targetX,y:bounds.y,direction:direction===1?1:-1,leadSec:2,tailSec:2};
}
function walkPosition(plan,progress){const p=Math.max(0,Math.min(1,progress));return {x:Math.round(plan.startX+(plan.targetX-plan.startX)*p),y:plan.y};}
module.exports={planWalk,walkPosition};
