'use strict';
const assert=require('node:assert/strict');
const {Game,LAUNCHERS,BARREL}=require('../dernier_rempart_engine.js');
const View=require('../dernier_rempart_view.js');
const gradient={addColorStop(){}};
const ctx=new Proxy({}, {get:(o,k)=>o[k] || (k.startsWith('create')?()=>gradient:()=>{})});
function setup(){
    const game=new Game(42);
    const view=new View({width:960,height:640,getContext:()=>ctx,getBoundingClientRect:()=>({width:960})});
    view.draw(game);return {game,view};
}
for(const fps of [30,60,120]){
    const {view}=setup();view.aim={x:940,y:250};
    for(let i=0;i<fps/2;i++)view.advance(1/fps);
    for(const t of view.turrets.values()){
        const target=Math.atan2(250-t.y,940-t.x)+Math.PI/2;
        assert.ok(Math.abs(target-t.angle)<.001,'rotation vers la droite');
    }
    view.aim={x:12,y:100};
    for(let i=0;i<fps/2;i++)view.advance(1/fps);
    for(const t of view.turrets.values())assert.ok(t.angle<0,'rotation vers la gauche');
}
const {game,view}=setup();
game.fire(385,200);view.events(game.drainEvents());
const shot=game.shots[0],middle=LAUNCHERS[1];
assert.equal(shot.sx,middle.x);assert.equal(shot.sy,middle.y-BARREL);
assert.equal(view.turrets.get(middle.x).kick,1);
view.advance(.2);assert.equal(view.turrets.get(middle.x).kick,0);
// L'enveloppe totale de la tourelle centrale reste hors du cartouche Énergie.
assert.ok(middle.x+42<480-35);
assert.ok(middle.y+27<640);
assert.ok(middle.y-42>558);
console.log('OK rotation 30/60/120 Hz, visée gauche/droite, bouche de tir, recul et dégagement Énergie');
