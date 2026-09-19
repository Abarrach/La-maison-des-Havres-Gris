(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.RempartView = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';
    const COLORS = { normal: '#ff9279', fast: '#ffcf73', split: '#dfabff', armored: '#c9e5f5' };
    class View {
        constructor(canvas, background, buildings) {
            this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.background = background;
            this.buildings = buildings;
            this.particles = []; this.labels = []; this.banner = ''; this.bannerLife = 0;
            this.pulseFlash = 0; this.impactFlash = 0; this.aim = null;
            this.reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
        }
        events(events) {
            for (const e of events) {
                if (e.type === 'kill' || e.type === 'impact' || e.type === 'armor') {
                    const color = e.type === 'impact' ? '#ff9c6b' : e.type === 'armor' ? '#d5e9f6' : '#ffd693';
                    for (let i = 0; i < (this.reduced ? 3 : e.type === 'impact' ? 32 : 12); i++) {
                        const a = Math.random() * Math.PI * 2, v = 30 + Math.random() * 100;
                        this.particles.push({ x: e.x, y: e.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, age: 0, life: .3 + Math.random() * .5, color });
                    }
                    if (e.type === 'kill' && !e.emergency) {
                        const text = e.chain >= 3 ? 'CHAÎNE ' + e.chain + '  +' + e.points : e.late ? 'SAUVETAGE +' + e.points : '+' + e.points;
                        this.labels.push({ x: e.x, y: e.y - 16, text, life: .9, color: e.chain >= 3 ? '#ffd693' : '#bcecf1' });
                    }
                    if (e.type === 'armor') this.labels.push({ x: e.x, y: e.y, text: 'BLINDAGE BRISÉ', life: .8, color });
                    if (e.type === 'impact') this.impactFlash = .35;
                }
                if (e.type === 'repair') this.labels.push({ x: e.x, y: 505, text: 'RÉPARATION +1', life: 1.7, color: '#93e5ee' });
                if (e.type === 'wave') {
                    this.banner = 'VAGUE ' + String(e.wave).padStart(2, '0') + '  /  ' + e.pattern;
                    this.subtitle = e.wave === 2 ? 'NOUVEAU : FLÈCHES RAPIDES' : e.wave === 3 ? 'CHARGES MULTIPLES : DÉTRUISEZ-LES EN ALTITUDE' : e.wave === 4 ? 'BLINDÉS : DEUX EXPLOSIONS DISTINCTES' : e.wave % 5 === 0 ? 'SATURATION : SALVE RENFORCÉE' : 'INTERCEPTEZ · ENCHAÎNEZ · TENEZ';
                    this.bannerLife = 2.4;
                }
                if (e.type === 'overheat') this.labels.push({ x:480,y:470,text:'SURCHAUFFE — REFROIDISSEMENT',life:1.5,color:'#ff9279' });
                if (e.type === 'cooled') this.labels.push({ x:480,y:470,text:'CANONS DISPONIBLES',life:.8,color:'#93e5ee' });
                if (e.type === 'pulse') this.pulseFlash = .5;
            }
            this.particles = this.particles.slice(-420); this.labels = this.labels.slice(-24);
        }
        advance(dt) {
            for (const p of this.particles) { p.age += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += dt * 65; }
            this.particles = this.particles.filter(p => p.age < p.life);
            for (const f of this.labels) { f.life -= dt; if (!this.reduced) f.y -= dt * 24; }
            this.labels = this.labels.filter(f => f.life > 0);
            this.bannerLife = Math.max(0, this.bannerLife - dt);
            this.pulseFlash = Math.max(0, this.pulseFlash - dt);
            this.impactFlash = Math.max(0, this.impactFlash - dt);
        }
        text(text, x, y, size = 12, color = '#c6d4dc', align = 'center') {
            const c = this.ctx; c.font = size + 'px system-ui, sans-serif'; c.textAlign = align; c.fillStyle = color; c.fillText(text, x, y);
        }
        line(points, color, width = 1) {
            const c = this.ctx; c.strokeStyle = color; c.lineWidth = width; c.beginPath();
            points.forEach((p, i) => i ? c.lineTo(...p) : c.moveTo(...p)); c.stroke();
        }
        circle(x, y, r, stroke, fill, width = 1) {
            if (r <= 0) return;
            const c = this.ctx; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2);
            if (fill) { c.fillStyle = fill; c.fill(); }
            if (stroke) { c.strokeStyle = stroke; c.lineWidth = width; c.stroke(); }
        }
        building(city, index, time) {
            const c = this.ctx, x = city.x, y = 558;
            c.save(); c.translate(x, y);
            const alive = city.hp > 0;
            c.fillStyle = '#070d1377'; c.beginPath(); c.ellipse(0, 2, 65, 6, 0, 0, Math.PI * 2); c.fill();
            if (!alive) {
                c.fillStyle = '#293037'; c.beginPath(); c.moveTo(-48, 0); c.lineTo(-28, -11); c.lineTo(-13, -5); c.lineTo(-2, -19); c.lineTo(20, -7); c.lineTo(38, -12); c.lineTo(50, 0); c.fill();
                this.text('PERDU', 0, 26, 10, '#ec997f'); c.restore(); return;
            }
            if (this.buildings && this.buildings.complete && this.buildings.naturalWidth > 0) {
                const cell = this.buildings.naturalWidth / 3;
                c.drawImage(this.buildings,index*cell,0,cell,this.buildings.naturalHeight,-68,-109,136,128);
                if(city.hp < 3) {
                    c.globalAlpha=.45;
                    this.line([[-15,-48],[-5,-32],[-13,-20],[3,-8]],'#160e0b',3);
                    c.globalAlpha=1;
                }
                for(let i=0;i<3;i++){c.fillStyle=i<city.hp?(city.hp===1?'#ff9279':'#d9c399'):'#ffffff20';c.fillRect(-22+i*16,14,12,3);}
                this.text(city.name,0,33,10,'#e3d7c1');
                if(city.hp===1)this.circle(0,-35,62,'#ff927950');
                c.restore();return;
            }
            const wall = c.createLinearGradient(-42, -40, 35, 0); wall.addColorStop(0, '#8b7c65'); wall.addColorStop(.5, '#4e5352'); wall.addColorStop(1, '#252d33');
            c.fillStyle = wall; c.strokeStyle = '#c4bba16b'; c.lineWidth = 1;
            if (index === 0) {
                for (const tx of [-25, 16]) {
                    c.fillRect(tx - 15, -35, 30, 34); c.strokeRect(tx - 15, -35, 30, 34);
                    c.beginPath(); c.ellipse(tx, -35, 15, 7, 0, Math.PI, Math.PI * 2); c.fill(); c.stroke();
                    c.fillStyle = '#9fe4e666'; c.fillRect(tx - 10, -25, 20, 4); c.fillStyle = wall;
                    this.line([[tx - 16,-8],[tx + 16,-8]], '#b7a58980');
                }
                this.line([[-48,-8],[-48,-22],[-42,-22]], '#ad9e82', 3);
            } else if (index === 1) {
                for (const tx of [-29, 29]) {
                    c.fillRect(tx - 10, -53, 20, 52); c.strokeRect(tx - 10, -53, 20, 52);
                    c.fillStyle = '#182731'; c.fillRect(tx - 7, -48, 14, 27); c.fillStyle = wall;
                    for (let j = 0; j < 5; j++) this.line([[tx - 6,-44 + j * 5],[tx + 6,-48 + j * 5]], '#9bafae', 2);
                    c.fillRect(tx - 14, -57, 28, 5);
                }
                c.fillRect(-20, -23, 40, 23); c.strokeRect(-20, -23, 40, 23);
                this.circle(0, -13, 6, '#96ecf1', '#7abbc380', 2);
            } else {
                c.beginPath(); c.moveTo(-53, 0); c.lineTo(-47, -29); c.lineTo(-24, -41); c.lineTo(30, -41); c.lineTo(51, -26); c.lineTo(56, 0); c.closePath(); c.fill(); c.stroke();
                c.fillStyle = '#101f29'; c.fillRect(-32, -25, 63, 25);
                for (let j = 0; j < 6; j++) this.line([[-31,-24 + j * 4],[30,-24 + j * 4]], '#84918470');
                this.line([[-38,-1],[-38,-29],[36,-29],[36,-1]], '#a0d7d9', 2);
            }
            c.fillStyle = '#c7e6dc'; for (const tx of [-8, 0, 8]) c.fillRect(tx, -7, 3, 3);
            c.fillStyle = '#3e4a4b'; c.fillRect(-52, -1, 104, 7);
            for (let i = 0; i < 3; i++) {
                c.fillStyle = i < city.hp ? city.hp === 1 ? '#ff9279' : '#a3dde0' : '#ffffff20';
                c.fillRect(-22 + i * 16, 14, 12, 3);
            }
            this.text(city.name, 0, 33, 10, '#bbcbd0');
            if (city.hp === 1) { c.globalAlpha = .5 + .3 * Math.sin(time * 5); this.circle(0, -24, 58, '#ff927970'); }
            c.restore();
        }
        draw(g, active = true) {
            const c = this.ctx;
            c.setTransform(this.canvas.width / 960, 0, 0, this.canvas.height / 640, 0, 0);
            c.globalAlpha = 1; c.clearRect(0, 0, 960, 640);
            const sky = c.createLinearGradient(0, 0, 0, 640); sky.addColorStop(0, '#111d2b'); sky.addColorStop(.7, '#293643'); sky.addColorStop(1, '#77604b');
            c.fillStyle = sky; c.fillRect(0, 0, 960, 640);
            if (this.background && (this.background.complete || this.background.width) && this.background.width > 0) c.drawImage(this.background, 0, 0, 960, 640);
            const veil = c.createLinearGradient(0, 0, 0, 640); veil.addColorStop(0, '#07131c66'); veil.addColorStop(.6, '#06121c22'); veil.addColorStop(1, '#07131ce8');
            c.fillStyle = veil; c.fillRect(0, 0, 960, 640);
            // Repère de danger fixe, sans masquer les trajectoires.
            c.setLineDash([3, 9]); this.line([[20,410],[940,410]], '#edb27325'); c.setLineDash([]);
            this.text('ZONE CRITIQUE', 18, 403, 9, '#d5aa7270', 'left');
            for (let i = 0; i < 3; i++) this.building(g.cities[i], i, g.time);
            for (const x of [70, 480, 890]) {
                const y = x === 480 ? 604 : 558;
                c.fillStyle = '#1b2c36'; c.fillRect(x - 19, y - 10, 38, 13);
                c.save(); c.translate(x, y - 11);
                const aim = this.aim || { x, y: 180 };
                c.rotate(Math.atan2(aim.y - 558, aim.x - x) + Math.PI / 2);
                c.fillStyle = '#acbaba'; c.fillRect(-4, -22, 8, 22); c.fillStyle = '#263d49'; c.fillRect(-7, -5, 14, 12); c.restore();
                this.circle(x, y - 5, 4, '#a0e6e8', '#b9f8f1');
            }
            for (const s of g.shots) {
                this.line([[s.sx,s.sy],[s.x,s.y]], '#85ecff40', 1);
                const len = Math.hypot(s.tx - s.sx, s.ty - s.sy) || 1;
                this.line([[s.x - (s.tx - s.sx)/len*22,s.y - (s.ty - s.sy)/len*22],[s.x,s.y]], '#bdfaff', 2.5);
                this.circle(s.tx, s.ty, 5, '#bdfaff80');
                this.line([[s.tx - 9,s.ty],[s.tx + 9,s.ty]], '#bdfaff80');
                this.line([[s.tx,s.ty - 9],[s.tx,s.ty + 9]], '#bdfaff80');
            }
            for (const b of g.blasts) {
                if (b.r < .5) continue;
                const emergency = b.chain.emergency;
                const grad = c.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r);
                grad.addColorStop(0, emergency ? '#bdf9ff11' : '#fff3c43a');
                grad.addColorStop(.75, emergency ? '#7fe8ff08' : '#ffb65a12');
                grad.addColorStop(1, emergency ? '#a4efff66' : '#ffdb9744');
                this.circle(b.x, b.y, b.r, emergency ? '#9de9f888' : '#ffe2ad99', grad, 1.5);
                if (b.age < .18 && !emergency) this.circle(b.x, b.y, 3 + 5 * (1 - b.age/.18), null, '#fff6df');
            }
            for (const e of g.enemies) {
                const color = COLORS[e.kind];
                this.line([[e.sx,e.sy],[e.x,e.y]], color + '35');
                const speed = Math.hypot(e.vx, e.vy), tx = e.x - e.vx / speed * 35, ty = e.y - e.vy / speed * 35;
                this.line([[tx,ty],[e.x,e.y]], color + 'aa', 2);
                c.save(); c.translate(e.x,e.y); c.rotate(Math.atan2(e.vy,e.vx) - Math.PI/2);
                c.fillStyle = color; c.strokeStyle = '#fff0da'; c.lineWidth = 1;
                c.beginPath();
                if (e.kind === 'split') { c.moveTo(0,9); c.lineTo(-8,0); c.lineTo(0,-10); c.lineTo(8,0); }
                else if (e.kind === 'armored') { c.moveTo(0,10); c.lineTo(-8,4); c.lineTo(-8,-5); c.lineTo(0,-10); c.lineTo(8,-5); c.lineTo(8,4); }
                else { c.moveTo(0,e.kind === 'fast' ? 11 : 8); c.lineTo(-5,-6); c.lineTo(0,-3); c.lineTo(5,-6); }
                c.closePath(); c.fill(); c.stroke();
                if (e.kind === 'armored' && e.hp > 1) this.circle(0,0,13,color + 'aa',null,2);
                if (e.kind === 'split') this.line([[-4,0],[0,4],[4,0]], '#493664', 2);
                c.restore();
                if (e.y > 430) this.circle(e.x,e.y,16,color + '66');
            }
            for (const p of this.particles) {
                c.globalAlpha = Math.max(0, 1 - p.age/p.life);
                this.line([[p.x - p.vx*.025,p.y - p.vy*.025],[p.x,p.y]], p.color, 2);
            }
            c.globalAlpha = 1;
            for (const f of this.labels) {
                c.globalAlpha = Math.min(1, f.life * 3);
                c.shadowColor = '#001019'; c.shadowBlur = 5;
                this.text(f.text, Math.max(65,Math.min(895,f.x)), f.y, 12, f.color);
            }
            c.shadowBlur = 0; c.globalAlpha = 1;
            if (active && this.aim) {
                this.circle(this.aim.x,this.aim.y,44,'#a6edf155');
                this.circle(this.aim.x,this.aim.y,10,g.energy >= 1 && !g.overheated ? '#b7f3f2' : '#ff947d');
                this.line([[this.aim.x - 15,this.aim.y],[this.aim.x - 6,this.aim.y]],'#b7f3f2');
                this.line([[this.aim.x + 6,this.aim.y],[this.aim.x + 15,this.aim.y]],'#b7f3f2');
            }
            if (this.bannerLife > 0 && active) {
                c.globalAlpha = Math.min(1,this.bannerLife*2);
                const bannerY = this.canvas.getBoundingClientRect().width < 550 ? 200 : 112;
                this.text(this.banner,480,bannerY,17,'#edcb91');
                this.text(this.subtitle,480,bannerY+21,10,'#d0dde2'); c.globalAlpha = 1;
            }
            if (!this.reduced && this.pulseFlash > 0) { c.fillStyle = 'rgba(153,232,242,' + this.pulseFlash*.16 + ')'; c.fillRect(0,0,960,640); }
            if (this.impactFlash > 0) {
                const edge = c.createLinearGradient(0,460,0,640); edge.addColorStop(0,'#ff674000'); edge.addColorStop(1,'rgba(255,103,64,' + this.impactFlash*.7 + ')');
                c.fillStyle = edge; c.fillRect(0,460,960,180);
            }
        }
    }
    return View;
});
