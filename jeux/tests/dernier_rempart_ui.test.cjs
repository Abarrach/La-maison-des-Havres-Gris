'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const Engine=require('../dernier_rempart_engine.js');
const View=require('../dernier_rempart_view.js');
function harness({local=true,accept=true,networkFail=false}={}) {
    const elements=new Map(),requests=[],windowHandlers={},documentHandlers={};
    const gradient={addColorStop(){}};
    const context=new Proxy({}, {get:(o,p)=>p in o?o[p]:p.startsWith('create')?()=>gradient:()=>{},set:(o,p,v)=>(o[p]=v,true)});
    function element(id) {
        if(!elements.has(id))elements.set(id,{
            id,hidden:false,textContent:'',style:{},dataset:{},disabled:false,handlers:{},children:[],width:960,height:640,
            classList:{toggle(){}},addEventListener(type,fn){this.handlers[type]=fn;},focus(){},setAttribute(){},
            getBoundingClientRect(){return{width:960,height:640,left:0,top:0};},getContext(){return context;},
            setPointerCapture(){},closest(){return null;},replaceChildren(){this.children=[];},append(...items){this.children.push(...items);}
        });
        return elements.get(id);
    }
    let latest,frame,nextTimer=1;const timers=new Map();
    class TrackedGame extends Engine.Game {constructor(seed){super(seed);latest=this;}}
    const window={devicePixelRatio:1,addEventListener:(k,fn)=>windowHandlers[k]=fn};
    const document={hidden:false,getElementById:element,createElement:tag=>element('created'+elements.size+tag),
        querySelectorAll:()=>[],addEventListener:(k,fn)=>documentHandlers[k]=fn};
    const sandbox={Rempart:{...Engine,Game:TrackedGame},RempartView:View,document,window,Image:class{},
        location:{hostname:local?'127.0.0.1':'guild.invalid',protocol:'http:'},crypto:webcrypto,TextEncoder,AbortController,
        setTimeout:(fn)=>{timers.set(nextTimer,fn);return nextTimer++;},clearTimeout:id=>timers.delete(id),
        requestAnimationFrame:fn=>{frame=fn;},console,
        fetch:async(url,options={})=>{
            const body=options.body?JSON.parse(options.body):null;requests.push({url,body});
            if(networkFail&&body?.action==='submit')throw new Error('Network failed');
            let data={ok:true,leaderboard:[],scores:[]};
            if(body?.action==='token')data={ok:true,secret:'test-only-no-live-secret'};
            if(body?.action==='submit')data=accept?{ok:true}:{ok:false,error:'invalid_score',max:500};
            return{ok:true,json:async()=>data};
        }};
    vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../dernier_rempart.js'),'utf8'),sandbox);
    let now=100;
    return{element,requests,windowHandlers,documentHandlers,document,
        game:()=>latest,click:id=>element(id).handlers.click(),
        tick(seconds){for(let i=0;i<seconds*60;i++){now+=1000/60;frame(now);}},
        key(code){documentHandlers.keydown({code,repeat:false,target:element('game'),preventDefault(){}});},
        pointer(type,x=300,y=300){element('game').handlers[type]({button:0,pointerId:1,clientX:x,clientY:y,preventDefault(){}});}};
}
async function settle(done){
    const deadline=Date.now()+5000;
    while(!done()){
        if(Date.now()>deadline)throw new Error('La soumission simulée ne se termine pas.');
        await new Promise(resolve=>setTimeout(resolve,5));
    }
}
(async()=>{
    const local=harness();local.click('start');local.tick(.5);
    assert.ok(local.game().enemies.length>0);
    local.click('pause');const t=local.game().time;local.tick(3);assert.equal(local.game().time,t);
    assert.equal(local.element('paused').hidden,false);
    local.click('resume');local.pointer('pointerdown');local.tick(.4);local.pointer('pointercancel');
    assert.ok(local.game().stats.shots>=2);
    const shots=local.game().stats.shots;local.tick(.4);assert.equal(local.game().stats.shots,shots);
    local.key('Space');assert.equal(local.game().stats.pulses,1);assert.ok(local.game().pulse<100);
    local.windowHandlers.blur();const bt=local.game().time;local.tick(1);assert.equal(local.game().time,bt);
    local.click('resume');local.document.hidden=true;local.documentHandlers.visibilitychange();local.tick(1);assert.equal(local.game().time,bt);
    local.document.hidden=false;local.click('resume');local.game().cities.forEach(c=>c.hp=0);local.tick(.1);
    assert.equal(local.element('ending').hidden,false);assert.equal(local.requests.length,0);
    local.click('restart');assert.equal(local.game().score,0);assert.equal(local.game().time,0);assert.equal(local.element('ending').hidden,true);
    console.log('OK démarrage, tirs maintenus, pointercancel, pause/reprise, perte de focus, onglet masqué, impulsion, fin, relance, aucun appel réseau local');
    for(const options of [{accept:true},{accept:false},{accept:true,networkFail:true}]) {
        const h=harness({local:false,...options});h.click('start');h.game().score=1500;h.game().cities.forEach(c=>c.hp=0);h.tick(.1);
        await settle(()=>/Score accepté|Score non enregistré/.test(h.element('save').textContent));
        const submissions=h.requests.filter(r=>r.body?.action==='submit');assert.equal(submissions.length,1);
        assert.equal(submissions[0].body.score,1500);assert.match(submissions[0].body.hash,/^[0-9a-f]{64}$/);
        if(options.accept&&!options.networkFail){assert.match(h.element('save').textContent,/Score accepté/);assert.match(h.element('best').textContent,/1.?500/);}
        else{assert.match(h.element('save').textContent,/non enregistré/);assert.equal(h.element('retry-save').hidden,false);assert.ok(!/1.?500/.test(h.element('best').textContent));}
    }
    console.log('OK score signé, acceptation, refus explicite, panne réseau, aucun faux record');
    console.log('Tests interface réussis (DOM/canvas simulés, aucun serveur de scores contacté).');
})().catch(e=>{console.error(e);process.exitCode=1;});
