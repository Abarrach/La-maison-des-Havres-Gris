'use strict';
const assert = require('node:assert/strict');
const { Game, segmentDistance } = require('../dernier_rempart_engine.js');
let passed = 0;
function test(name, fn) { fn(); console.log('OK '+name); passed++; }
function advance(g, seconds, fps=120) { for(let i=0;i<seconds*fps;i++) { g.step(1/fps); g.drainEvents(); } }
function empty() { const g=new Game(42); g.schedule=[]; g.drainEvents(); return g; }
test('segment balayé : pas de traversée sans collision',()=>{
    assert.equal(segmentDistance(50,0,0,0,100,0),0);
    assert.equal(segmentDistance(50,10,0,0,100,0),10);
});
test('première salve avant une demi-seconde',()=>{
    const g=new Game(5); advance(g,.5); assert.ok(g.enemies.length>=2);
});
test('tir borné, cadence et énergie non négative',()=>{
    const g=empty(); assert.ok(g.fire(-10,900)); assert.equal(g.shots[0].tx,12); assert.equal(g.shots[0].ty,522);
    assert.equal(g.fire(200,200),false); assert.equal(g.fire(NaN,200),false);
    for(let i=0;i<1200;i++){g.fire(400,100);g.step(1/120);g.drainEvents();assert.ok(g.energy>=0);}
    assert.ok(g.stats.shots<=44);
});
test('tir explose exactement au point visé',()=>{
    const g=empty();g.fire(300,300);advance(g,.4);
    assert.ok(g.blasts.some(b=>b.x===300&&b.y===300));assert.equal(g.shots.length,0);
});
test('réaction en chaîne : score, recharge et compteur partagés',()=>{
    const g=empty();g.pulse=0;g.spawn({x:300,y:200,target:0});g.spawn({x:340,y:200,target:0});g.spawn({x:380,y:200,target:0});
    for(const e of g.enemies){e.vx=0;e.vy=0;}
    g.explode(300,200,undefined,15);advance(g,.5);
    assert.equal(g.stats.kills,3);assert.equal(g.stats.bestChain,3);assert.equal(g.score,450);assert.equal(g.pulse,12);
});
test('blindage : une explosion ne frappe qu’une fois',()=>{
    const g=empty();g.spawn({x:300,y:200,target:0,kind:'armored'});g.enemies[0].vx=0;g.enemies[0].vy=0;
    g.explode(300,200);advance(g,.3);assert.equal(g.enemies[0].hp,1);assert.equal(g.stats.kills,0);
    g.explode(300,200);advance(g,.05);assert.equal(g.stats.kills,1);
});
test('charge multiple : deux enfants rapides, pas de faux point',()=>{
    const g=empty();g.spawn({x:300,y:300,target:0,kind:'split'});advance(g,.05);
    assert.equal(g.enemies.length,2);assert.ok(g.enemies.every(e=>e.kind==='fast'));assert.equal(g.score,0);
});
test('charge détruite avant séparation : pas d’enfant',()=>{
    const g=empty();g.spawn({x:300,y:200,target:0,kind:'split'});g.enemies[0].splitY=201;
    g.explode(300,200);advance(g,.1);assert.equal(g.stats.kills,1);assert.equal(g.enemies.length,0);
});
test('impulsion : détruit le blindage, pas de recharge autoréférente',()=>{
    const g=empty();g.spawn({x:300,y:200,target:0,kind:'armored'});
    assert.ok(g.emergency());assert.equal(g.emergency(),false);advance(g,.4);
    assert.equal(g.enemies.length,0);assert.equal(g.pulse,0);assert.equal(g.score,25);
});
test('réparation limitée et bâtiments détruits jamais ressuscités',()=>{
    const g=empty();g.cities[0].hp=0;g.cities[1].hp=1;g.cities[2].hp=2;
    g.nextWave();assert.deepEqual(g.cities.map(c=>c.hp),[0,2,2]);assert.equal(g.score,300);
});
test('pause logique / fin : aucun tir ni progression après game over',()=>{
    const g=empty();g.cities.forEach(c=>c.hp=0);g.step(.1);assert.equal(g.state,'over');
    const time=g.time;advance(g,1);assert.equal(g.time,time);assert.equal(g.fire(100,100),false);assert.equal(g.emergency(),false);
});
test('menaces variées à partir de la quatrième vague',()=>{
    const g=new Game(314);g.nextWave();g.nextWave();g.nextWave();
    assert.deepEqual([...new Set(g.schedule.map(s=>s.kind))].sort(),['armored','fast','normal','split']);
});
test('rafale : surchauffe, blocage puis refroidissement sans clic parasite',()=>{
    const g=empty();
    for(let i=0;i<6;i++){g.fire(450,100);advance(g,.17);}
    assert.equal(g.overheated,true);assert.equal(g.stats.overheats,1);
    const shots=g.stats.shots;assert.equal(g.fire(450,100),false);assert.equal(g.stats.shots,shots);
    advance(g,1.7);assert.equal(g.overheated,false);assert.ok(g.fire(450,100));
});
test('tirs espacés : aucune surchauffe, température bornée',()=>{
    const g=empty();
    for(let i=0;i<20;i++){assert.ok(g.fire(450,100));advance(g,.62);assert.ok(g.heat>=0&&g.heat<=100);}
    assert.equal(g.stats.overheats,0);
});
test('explosion précise : pas de couverture au-delà de son rayon',()=>{
    const g=empty();g.spawn({x:355,y:200,target:0});g.enemies[0].vx=0;g.enemies[0].vy=0;
    g.explode(300,200);advance(g,.6);assert.equal(g.stats.kills,0);assert.equal(g.blasts.length,0);
});
test('cinq victimes : une chaîne rapporte plus du double de cinq tirs isolés',()=>{
    const a=empty(),b=empty(),chain={kills:0,emergency:false};
    for(let i=0;i<5;i++){
        a.kill({kind:'normal',x:300,y:200},chain);
        b.kill({kind:'normal',x:300,y:200},{kills:0,emergency:false});
    }
    assert.ok(a.score>b.score*2);assert.equal(a.stats.chainBonus,500);
});
test('tir utile : un seul crédit par tir, y compris blindage sans destruction',()=>{
    const g=empty();g.spawn({x:300,y:200,target:0,kind:'armored'});g.enemies[0].vx=0;g.enemies[0].vy=0;
    g.fire(300,200);advance(g,.6);
    assert.equal(g.stats.usefulShots,1);assert.equal(g.stats.kills,0);
    g.fire(300,200);advance(g,.6);assert.equal(g.stats.usefulShots,2);assert.equal(g.stats.kills,1);
});
function run(seed, policy, fps=60, maxSeconds=180) {
    const g=new Game(seed);let nextShot=0, maxEntities=0;
    const random=require('../dernier_rempart_engine.js').seeded(seed+555);
    for(let frame=0;frame<maxSeconds*fps&&g.state==='playing';frame++) {
        if(g.time>=nextShot) {
            nextShot=g.time+(policy==='aim'?.62:.17);
            if(policy==='spam')g.fire(random()*960,70+random()*445);
            if(policy==='sweep')g.fire(100+760*(.5+.5*Math.sin(g.time*4)),350);
            if(policy==='directed'&&g.enemies.length){const e=g.enemies[Math.floor(random()*g.enemies.length)];g.fire(e.x,e.y);}
            if(policy==='aim'&&g.enemies.length) {
                const e=g.enemies.reduce((a,b)=>a.y/a.vy>b.y/b.vy?a:b);
                // Anticipation approximative, pas de connaissance du futur générateur.
                const flight=Math.hypot(e.x-480,e.y-558)/930+.09;
                g.fire(e.x+e.vx*flight,e.y+e.vy*flight);
            }
        }
        g.step(1/fps);g.drainEvents();maxEntities=Math.max(maxEntities,g.enemies.length+g.blasts.length+g.shots.length);
        assert.ok(Number.isFinite(g.score));assert.ok(g.energy>=0&&g.energy<=12.00001);
    }
    return {time:Math.round(g.time),score:g.score,wave:g.wave,kills:g.stats.kills,maxEntities};
}
test('simulation reproductible à graine identique',()=>assert.deepEqual(run(123,'aim'),run(123,'aim')));
test('30/60/120 Hz : temps d’échec passif équivalent',()=>{
    const times=[30,60,120].map(fps=>run(123,'none',fps).time);
    assert.ok(Math.max(...times)-Math.min(...times)<=1);
});
const report={};
for(const policy of ['none','spam','sweep','directed','aim']) {
    const results=Array.from({length:24},(_,i)=>run(i+1,policy));
    report[policy]={seconds:Math.round(results.reduce((s,r)=>s+r.time,0)/results.length),score:Math.round(results.reduce((s,r)=>s+r.score,0)/results.length),maxEntities:Math.max(...results.map(r=>r.maxEntities)),maxWave:Math.max(...results.map(r=>r.wave))};
}
test('équilibrage : inaction rapidement sanctionnée, visée récompensée',()=>{
    assert.ok(report.none.seconds<22);assert.ok(report.aim.score>report.spam.score*1.5);assert.ok(report.aim.seconds>report.none.seconds*2);
    assert.ok(report.aim.maxEntities<250);
    assert.ok(report.aim.seconds>report.sweep.seconds*2);
    assert.ok(report.aim.seconds>report.directed.seconds*1.5);
    assert.ok(report.aim.score>report.directed.score*2);
});
console.log(JSON.stringify(report,null,2));
console.log(passed+' tests passés');
