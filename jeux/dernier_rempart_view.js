(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.RempartView = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';
    // Palette alignée sur les autres jeux du hub (or/ocre/rouille). Le bleu froid est
    // RÉSERVÉ à l'impulsion Holtzman : c'est le seul élément du jeu qui n'est pas de
    // la poussière ou du feu, et le garder unique le rend lisible au premier coup d'œil.
    const COLORS = { normal: '#ff7a55', fast: '#ffc94f', split: '#e08ad0', armored: '#d8cbb4' };
    const OR = '#f5deb3', OR_VIF = '#ffe6b0', AMBRE = '#cda434';

    // Générateur déterministe : le décor doit être identique d'une partie à l'autre
    // (et dans les tests), seuls le vent et le temps le font bouger.
    function rng(seed) {
        let s = seed >>> 0;
        return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
    }

    // Décor animé. Le fond peint reste la plaque lointaine ; tout ce qui bouge est
    // dessiné par-dessus ou par-dessous, comme dans Worm Rider (ciel procédural).
    function makeSky() {
        const r = rng(0x5ADEC0DE);
        const etoiles = [];
        for (let i = 0; i < 46; i++) etoiles.push({ x: r() * 960, y: 18 + r() * 320, taille: r() < .78 ? .7 : 1.4, phase: r() * 6.28 });
        const voiles = [];          // nappes de poussière haute, deux profondeurs
        for (let i = 0; i < 9; i++) voiles.push({ x: r() * 1100, y: 55 + r() * 230, l: 150 + r() * 260, h: 12 + r() * 26, v: .35 + r() * .5, a: .05 + r() * .07 });
        // Sable en suspension. Trois populations plutôt qu'une : c'est le mélange de
        // tailles et de vitesses qui donne la profondeur, et les quelques éclats vifs
        // qui donnent le scintillement du soleil rasant sur les grains.
        const grains = [];
        for (let i = 0; i < 190; i++) {
            const eclat = r() < .26;                       // grain pris dans la lumière
            grains.push({
                x: r() * 960, y: 26 + r() * 570,
                v: (eclat ? 14 : 7) + r() * 38,
                taille: eclat ? 1.4 + r() * 1.2 : (r() < .75 ? .8 : 1.4),
                a: eclat ? .6 + r() * .4 : .18 + r() * .34,
                eclat,
                phase: r() * 6.283,
                freq: eclat ? 2.4 + r() * 3.6 : .8 + r() * 1.4   // les éclats battent plus vite
            });
        }
        const cretes = [];          // crêtes de dunes proches, balayées par le vent
        for (let i = 0; i < 14; i++) cretes.push({ x: r() * 960, y: 512 + r() * 26, l: 26 + r() * 44, a: .06 + r() * .1 });
        return { etoiles, voiles, grains, cretes, vent: 0, rafale: 0 };
    }
    class View {
        constructor(canvas, background, buildings, battery) {
            this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.background = background;
            this.buildings = buildings;
            this.battery = battery;
            this.turrets = new Map();
            this.particles = []; this.labels = []; this.banner = ''; this.bannerLife = 0;
            this.pulseFlash = 0; this.impactFlash = 0; this.aim = null;
            this.sky = makeSky(); this.skyTime = 0; this.tempete = 0;
            this.reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
        }
        events(events) {
            for (const e of events) {
                if(e.type === 'fire') {
                    const t=this.turrets.get(e.launcherX);
                    if(t){t.angle=e.angle;t.kick=1;}
                }
                if (e.type === 'kill' || e.type === 'impact' || e.type === 'armor') {
                    const color = e.type === 'impact' ? '#ff9c6b' : e.type === 'armor' ? '#e6d7b8' : '#ffd693';
                    for (let i = 0; i < (this.reduced ? 3 : e.type === 'impact' ? 32 : 12); i++) {
                        const a = Math.random() * Math.PI * 2, v = 30 + Math.random() * 100;
                        this.particles.push({ x: e.x, y: e.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, age: 0, life: .3 + Math.random() * .5, color });
                    }
                    if (e.type === 'kill' && !e.emergency) {
                        const text = e.chain >= 3 ? 'CHAÎNE ' + e.chain + '  +' + e.points : e.late ? 'SAUVETAGE +' + e.points : '+' + e.points;
                        this.labels.push({ x: e.x, y: e.y - 16, text, life: .9, color: e.chain >= 3 ? '#ffd693' : '#f5deb3' });
                    }
                    if (e.type === 'armor') this.labels.push({ x: e.x, y: e.y, text: 'BLINDAGE BRISÉ', life: .8, color });
                    if (e.type === 'impact') this.impactFlash = .35;
                }
                if (e.type === 'repair') this.labels.push({ x: e.x, y: 505, text: 'RÉPARATION +1', life: 1.7, color: '#e8c88a' });
                // Fin de vague : les deux bonus sont annoncés SÉPARÉMENT. C'est le seul moment
                // où le joueur peut relier ce qu'il a fait à ce qu'il a gagné.
                if (e.type === 'bonus') {
                    this.labels.push({ x: 480, y: 252, text: 'TENUE DE POSITION  +' + e.tenue, life: 2.4, color: '#f5deb3' });
                    this.labels.push({ x: 480, y: 276, text: 'PRÉCISION  +' + e.precision + '   (' + Math.round(e.taux * 100) + ' % de tirs utiles)',
                        life: 2.4, color: e.taux >= .75 ? '#cda434' : e.taux >= .5 ? '#b7a077' : '#c4553c' });
                }
                if (e.type === 'wave') {
                    this.banner = 'VAGUE ' + String(e.wave).padStart(2, '0') + '  /  ' + e.pattern;
                    this.subtitle = e.wave === 2 ? 'DARDS : PROJECTILES À HAUTE VITESSE' : e.wave === 3 ? 'OGIVES À SOUS-MUNITIONS : INTERCEPTEZ EN ALTITUDE' : e.wave === 4 ? 'OBUS BLINDÉS : DEUX EXPLOSIONS DISTINCTES' : e.wave % 5 === 0 ? 'SATURATION : SALVE RENFORCÉE' : 'INTERCEPTEZ · ENCHAÎNEZ · TENEZ';
                    this.bannerLife = 2.4;
                }
                if (e.type === 'overheat') this.labels.push({ x:480,y:470,text:'SURCHAUFFE — REFROIDISSEMENT',life:1.5,color:'#ff9279' });
                if (e.type === 'cooled') this.labels.push({ x:480,y:470,text:'CANONS DISPONIBLES',life:.8,color:'#e8c88a' });
                if (e.type === 'pulse') this.pulseFlash = .5;
            }
            this.particles = this.particles.slice(-420); this.labels = this.labels.slice(-24);
        }
        advance(dt) {
            this.skyTime += dt;
            const sk = this.sky;
            // Le vent respire (deux sinus décalés) : jamais deux passages identiques,
            // jamais de défilement mécanique. Les rafales sont ce qui donne l'impression
            // que le désert est vivant même quand le ciel est vide.
            sk.vent = 26 + 16 * Math.sin(this.skyTime * .21) + 9 * Math.sin(this.skyTime * .73 + 1.3);
            sk.rafale = Math.max(0, Math.sin(this.skyTime * .12 - 1.1)) ** 3;
            if (!this.reduced) {
                const souffle = sk.vent * (1 + sk.rafale * 1.6);
                for (const v of sk.voiles) { v.x -= souffle * v.v * .06 * dt * 10; if (v.x + v.l < -40) v.x = 1000 + Math.random() * 120; }
                for (const g of sk.grains) {
                    g.x -= (souffle * .55 + g.v) * dt;
                    g.y += Math.sin(this.skyTime * 1.7 + g.x * .01) * 5 * dt;
                    if (g.x < -6) { g.x = 966; g.y = 30 + Math.random() * 560; }
                }
                for (const c of sk.cretes) { c.x -= souffle * .05 * dt * 10; if (c.x + c.l < -30) c.x = 980 + Math.random() * 60; }
            }
            for(const t of this.turrets.values()) {
                if(this.aim) {
                    const target=Math.atan2(this.aim.y-t.y,this.aim.x-t.x)+Math.PI/2;
                    const delta=Math.atan2(Math.sin(target-t.angle),Math.cos(target-t.angle));
                    t.angle+=delta*(1-Math.exp(-24*dt));
                }
                t.kick=Math.max(0,t.kick-dt*8);
            }
            for (const p of this.particles) { p.age += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += dt * 65; }
            this.particles = this.particles.filter(p => p.age < p.life);
            for (const f of this.labels) { f.life -= dt; if (!this.reduced) f.y -= dt * 24; }
            this.labels = this.labels.filter(f => f.life > 0);
            this.bannerLife = Math.max(0, this.bannerLife - dt);
            this.pulseFlash = Math.max(0, this.pulseFlash - dt);
            this.impactFlash = Math.max(0, this.impactFlash - dt);
        }
        text(text, x, y, size = 12, color = '#d9c8a8', align = 'center') {
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
            c.fillStyle = '#0e060388'; c.beginPath(); c.ellipse(0, 2, 65, 6, 0, 0, Math.PI * 2); c.fill();
            if (!alive) {
                c.fillStyle = '#33261d'; c.beginPath(); c.moveTo(-48, 0); c.lineTo(-28, -11); c.lineTo(-13, -5); c.lineTo(-2, -19); c.lineTo(20, -7); c.lineTo(38, -12); c.lineTo(50, 0); c.fill();
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
                    c.fillStyle = '#e8c88a66'; c.fillRect(tx - 10, -25, 20, 4); c.fillStyle = wall;
                    this.line([[tx - 16,-8],[tx + 16,-8]], '#b7a58980');
                }
                this.line([[-48,-8],[-48,-22],[-42,-22]], '#ad9e82', 3);
            } else if (index === 1) {
                for (const tx of [-29, 29]) {
                    c.fillRect(tx - 10, -53, 20, 52); c.strokeRect(tx - 10, -53, 20, 52);
                    c.fillStyle = '#231a12'; c.fillRect(tx - 7, -48, 14, 27); c.fillStyle = wall;
                    for (let j = 0; j < 5; j++) this.line([[tx - 6,-44 + j * 5],[tx + 6,-48 + j * 5]], '#ab9a78', 2);
                    c.fillRect(tx - 14, -57, 28, 5);
                }
                c.fillRect(-20, -23, 40, 23); c.strokeRect(-20, -23, 40, 23);
                this.circle(0, -13, 6, '#e8c88a', '#a8813f80', 2);
            } else {
                c.beginPath(); c.moveTo(-53, 0); c.lineTo(-47, -29); c.lineTo(-24, -41); c.lineTo(30, -41); c.lineTo(51, -26); c.lineTo(56, 0); c.closePath(); c.fill(); c.stroke();
                c.fillStyle = '#1a120c'; c.fillRect(-32, -25, 63, 25);
                for (let j = 0; j < 6; j++) this.line([[-31,-24 + j * 4],[30,-24 + j * 4]], '#8d7a5a70');
                this.line([[-38,-1],[-38,-29],[36,-29],[36,-1]], '#d3b072', 2);
            }
            c.fillStyle = '#efdcb4'; for (const tx of [-8, 0, 8]) c.fillRect(tx, -7, 3, 3);
            c.fillStyle = '#4a3e2f'; c.fillRect(-52, -1, 104, 7);
            for (let i = 0; i < 3; i++) {
                c.fillStyle = i < city.hp ? city.hp === 1 ? '#ff9279' : '#d9c399' : '#ffffff20';
                c.fillRect(-22 + i * 16, 14, 12, 3);
            }
            this.text(city.name, 0, 33, 10, '#d5c4a3');
            if (city.hp === 1) { c.globalAlpha = .5 + .3 * Math.sin(time * 5); this.circle(0, -24, 58, '#ff927970'); }
            c.restore();
        }
        munition(kind, hp = 1) {
            const c = this.ctx, color = COLORS[kind];
            // Toutes les silhouettes pointent vers +Y ; même dessin dans la légende.
            const hull = (points, fill) => {
                c.beginPath(); points.forEach((p,i)=>i?c.lineTo(...p):c.moveTo(...p));
                c.closePath(); c.fillStyle=fill; c.fill(); c.strokeStyle='#e9d9b8'; c.lineWidth=.8; c.stroke();
            };
            if(kind === 'fast') {
                hull([[0,15],[-2,5],[-2,-10],[-5,-14],[0,-11],[5,-14],[2,-10],[2,5]],'#bba77c');
                this.line([[0,-9],[0,10]],'#fff0b6',1.5);
            } else if(kind === 'split') {
                for(const x of [-6,6]) { c.save(); c.translate(x,-2); hull([[-3,-9],[3,-9],[3,6],[0,10],[-3,6]],'#6e526c'); c.restore(); }
                hull([[-4,-13],[4,-13],[5,6],[0,13],[-5,6]],'#b5a08b');
                this.line([[-9,-4],[9,-4]],color,3);
            } else if(kind === 'armored') {
                hull([[-7,-11],[7,-11],[9,4],[5,12],[0,15],[-5,12],[-9,4]],hp>1?'#6b6152':'#463c32');
                this.line([[-6,-6],[6,-6]],color,3);
                this.line([[-7,0],[7,0]],'#2a231b',2);
                this.line([[0,-9],[0,10]],'#e1d2ae',1);
                if(hp>1){this.line([[-12,-9],[-12,8]],color,2);this.line([[12,-9],[12,8]],color,2);}
            } else {
                hull([[-4,-10],[4,-10],[4,5],[0,13],[-4,5]],'#b6a18a');
                hull([[-4,-9],[-9,-13],[-9,-4],[-4,-2]],'#776959');
                hull([[4,-9],[9,-13],[9,-4],[4,-2]],'#776959');
                this.line([[-4,2],[4,2]],color,3);
            }
        }
        turret(t, overheated) {
            const c=this.ctx,x=t.x,y=t.y;
            // Socle immobile, tête et tubes articulés : ne pas faire tourner le bâtiment entier.
            c.save();c.translate(x,y);
            if(this.battery && this.battery.complete && this.battery.naturalWidth>0) {
                const h=this.battery.naturalHeight,w=this.battery.naturalWidth;
                c.drawImage(this.battery,0,h*.72,w,h*.28,-38,5,76,22);
            } else {
                c.fillStyle='#77664d';c.beginPath();c.moveTo(-35,20);c.lineTo(-26,5);c.lineTo(26,5);c.lineTo(35,20);c.closePath();c.fill();
            }
            this.circle(0,0,17,'#c5ac7d','#252827',2);
            c.save();c.rotate(t.angle);
            const recoil=this.reduced?0:t.kick*4;
            const metal=c.createLinearGradient(-15,0,15,0);
            metal.addColorStop(0,'#292b2a');metal.addColorStop(.32,'#a99b79');metal.addColorStop(.55,'#625d4f');metal.addColorStop(1,'#222627');
            c.translate(0,recoil);
            for(const dx of [-8,8]) {
                c.fillStyle=metal;c.fillRect(dx-4,-30,8,29);
                c.strokeStyle='#b49d70';c.lineWidth=1;c.strokeRect(dx-4,-30,8,29);
                for(let j=0;j<4;j++)this.line([[dx-5,-9-j*4],[dx+5,-9-j*4]],'#393c36',2);
                c.fillStyle='#111918';c.fillRect(dx-3,-31,6,4);
            }
            c.fillStyle=metal;c.beginPath();c.moveTo(-16,-7);c.lineTo(-11,-14);c.lineTo(11,-14);c.lineTo(16,-7);c.lineTo(13,13);c.lineTo(-13,13);c.closePath();c.fill();
            this.line([[-11,7],[11,7]],'#c6aa73',2);
            this.line([[0,-10],[0,3]],overheated?'#ff7957':'#e8c77e',2);
            if(t.kick>.45 && !this.reduced) {
                c.globalAlpha=t.kick;
                for(const dx of [-8,8])this.line([[dx,-32],[dx,-39]],'#fff0c6',3);
                c.globalAlpha=1;
            }
            c.restore();c.restore();
        }
        // Décor : plaque peinte + couches animées. Tout ce qui bouge ici est lent et de
        // faible contraste — le ciel doit rester la zone de lecture des trajectoires,
        // jamais une animation qui capte l'œil pendant une salve.
        decor(g) {
            const c = this.ctx, sk = this.sky, t = this.skyTime;
            const plaque = this.background && (this.background.complete || this.background.width) && this.background.width > 0;

            // Ciel de repli : crépuscule chaud d'Arrakis, dans la lignée de Worm Rider.
            // Sert tel quel si la plaque n'est pas chargée — le jeu reste jouable et dans le ton.
            const ciel = c.createLinearGradient(0, 0, 0, 640);
            ciel.addColorStop(0, '#150a0b'); ciel.addColorStop(.4, '#37170f');
            ciel.addColorStop(.72, '#7d3b1c'); ciel.addColorStop(.85, '#c47a33'); ciel.addColorStop(1, '#4b2a16');
            c.fillStyle = ciel; c.fillRect(0, 0, 960, 640);
            if (plaque) c.drawImage(this.background, 0, 0, 960, 640);

            // La plaque est peinte en heure bleue, le hub est ocre. `soft-light` réchauffe
            // sans écraser le modelé du rocher, ce qu'un aplat en source-over ferait.
            if (plaque) {
                c.globalCompositeOperation = 'soft-light';
                c.fillStyle = 'rgba(208,122,48,.66)'; c.fillRect(0, 0, 960, 640);
                c.globalCompositeOperation = 'source-over';
            }
            const voile = c.createLinearGradient(0, 0, 0, 640);
            voile.addColorStop(0, '#1a0a05b0'); voile.addColorStop(.55, '#25100626'); voile.addColorStop(1, '#170803ee');
            c.fillStyle = voile; c.fillRect(0, 0, 960, 640);

            // Étoiles : seulement dans le ciel dégagé, jamais sur les falaises latérales.
            for (const e of sk.etoiles) {
                if (e.x < 95 || e.x > 890) continue;
                c.globalAlpha = (.18 + .3 * (1 + Math.sin(t * .9 + e.phase)) / 2) * (1 - e.y / 420);
                c.fillStyle = '#ffeccb'; c.fillRect(e.x, e.y, e.taille, e.taille);
            }
            c.globalAlpha = 1;

            // Halo de la lune de la plaque (sinon lune dessinée) — respiration très lente.
            const lx = 838, ly = 256, pulse = 1 + .06 * Math.sin(t * .35);
            const halo = c.createRadialGradient(lx, ly, 4, lx, ly, 96 * pulse);
            halo.addColorStop(0, 'rgba(255,236,200,.20)'); halo.addColorStop(.45, 'rgba(228,168,96,.07)'); halo.addColorStop(1, 'rgba(228,168,96,0)');
            c.fillStyle = halo; c.beginPath(); c.arc(lx, ly, 96 * pulse, 0, Math.PI * 2); c.fill();
            if (!plaque) { c.fillStyle = '#e8d6b0'; c.beginPath(); c.arc(lx, ly, 17, 0, Math.PI * 2); c.fill(); }

            // Nappes de poussière haute : la seule chose qui traverse le ciel en continu.
            // Dégradé RADIAL, pas linéaire — un dégradé horizontal laisse les bords haut et
            // bas francs, et neuf ellipses à bords francs lisent comme des bandes de balayage.
            for (const v of sk.voiles) {
                if (v.x + v.l < 0 || v.x > 960) continue;   // hors champ : pas de dégradé inutile
                const cx = v.x + v.l / 2, cy = v.y + Math.sin(t * .3 + v.x * .01) * 5, rx = v.l / 2;
                const grad = c.createRadialGradient(cx, cy, 0, cx, cy, rx);
                const a = v.a * .72 * (1 + sk.rafale);
                grad.addColorStop(0, 'rgba(222,160,92,' + a.toFixed(3) + ')');
                grad.addColorStop(.6, 'rgba(222,160,92,' + (a * .45).toFixed(3) + ')');
                grad.addColorStop(1, 'rgba(222,160,92,0)');
                c.save(); c.translate(cx, cy); c.scale(1, v.h / rx); c.translate(-cx, -cy);
                c.fillStyle = grad; c.beginPath(); c.arc(cx, cy, rx, 0, Math.PI * 2); c.fill();
                c.restore();
            }

            // Front de tempête : monte avec les vagues. Le décor raconte la difficulté au
            // lieu de la laisser au seul compteur — et il reste sous la ligne de tir.
            // Courbe calée sur les parties RÉELLES, pas sur la vague maximale théorique :
            // presque personne ne dépasse la vague 5-6, donc une montée linéaire jusqu'à 11
            // laissait l'immense majorité des parties dans un décor vide. Racine ~0,55 :
            // l'ambiance est déjà là dès la vague 1, l'essentiel du changement visible se
            // joue entre 1 et 5, et la saturation arrive vers 8 pour les acharnés.
            this.tempete = Math.pow(Math.min(1, ((g && g.wave) || 1) / 8), .55);
            if (this.tempete > .01) {
                for (let i = 0; i < 4; i++) {
                    const base = 505 - i * 27 * this.tempete, amp = 10 + i * 9, a = this.tempete * (.34 - i * .07);
                    c.fillStyle = 'rgba(176,96,44,' + Math.max(0, a).toFixed(3) + ')';
                    c.beginPath(); c.moveTo(0, 530);
                    for (let x = 0; x <= 960; x += 24) c.lineTo(x, base - Math.sin(x * .013 + t * (.35 + i * .2) + i) * amp - Math.sin(x * .004 - t * .17) * amp * .6);
                    c.lineTo(960, 530); c.closePath(); c.fill();
                }
                // Voile global : dégradé, pas aplat. Un aplat sur tout l'écran écrase le
                // relief des falaises et la scène devient une bouillie ocre uniforme.
                const poussiere = c.createLinearGradient(0, 0, 0, 640);
                poussiere.addColorStop(0, 'rgba(140,74,36,' + (this.tempete * .3).toFixed(3) + ')');
                poussiere.addColorStop(.55, 'rgba(140,74,36,' + (this.tempete * .09).toFixed(3) + ')');
                poussiere.addColorStop(1, 'rgba(140,74,36,' + (this.tempete * .2).toFixed(3) + ')');
                c.fillStyle = poussiere; c.fillRect(0, 0, 960, 640);
            }

            // Brume de sol : sépare les bâtiments du lointain et ancre la scène.
            const brume = c.createLinearGradient(0, 468, 0, 540);
            brume.addColorStop(0, 'rgba(214,150,86,0)');
            brume.addColorStop(.5, 'rgba(214,150,86,' + (.1 + sk.rafale * .1).toFixed(3) + ')');
            brume.addColorStop(1, 'rgba(214,150,86,0)');
            c.fillStyle = brume; c.fillRect(0, 468, 960, 72);

            // Crêtes de sable balayées au premier plan bas.
            for (const cr of sk.cretes) {
                c.globalAlpha = cr.a * (1 + sk.rafale * .8);
                this.line([[cr.x, cr.y], [cr.x + cr.l, cr.y - 2]], '#ffcf95', 1);
            }
            c.globalAlpha = 1;

            // Grains en suspension : la couche qui fait respirer tout l'écran.
            // Le scintillement est un battement d'opacité par grain (phase et fréquence
            // propres), pas un clignotement global — sinon tout l'écran pulse ensemble et
            // ça se voit comme un défaut d'affichage.
            // La lumière vient du couchant, bas et à droite : plus un grain est près de
            // l'horizon, plus il accroche. `lueur` est un halo carré à bas alpha, pas un
            // dégradé radial — cent cinquante dégradés par image, c'est un téléphone à genoux.
            for (const gr of sk.grains) {
                const battement = gr.eclat
                    ? .28 + .72 * Math.pow((1 + Math.sin(t * gr.freq + gr.phase)) / 2, 2)
                    : .55 + .45 * Math.sin(t * gr.freq + gr.phase);
                const rasance = .58 + .42 * Math.min(1, Math.max(0, (gr.y - 90) / 380));
                const alpha = gr.a * battement * rasance * (.85 + sk.rafale * .8);
                if (alpha < .02) continue;
                if (gr.eclat) {
                    // Halo + cœur en disques : un grain qui accroche le soleil n'est pas un
                    // carré, et à deux pixels de côté ça se voit. Deux arcs par éclat restent
                    // bon marché — c'est le dégradé radial qu'il fallait éviter, pas le tracé.
                    c.globalAlpha = alpha * .22;
                    c.fillStyle = '#ffdca6';
                    c.beginPath(); c.arc(gr.x, gr.y, gr.taille * 2.3, 0, Math.PI * 2); c.fill();
                    c.globalAlpha = Math.min(1, alpha * 1.2);
                    c.fillStyle = '#fff4d8';
                    c.beginPath(); c.arc(gr.x, gr.y, gr.taille * .75, 0, Math.PI * 2); c.fill();
                } else {
                    c.globalAlpha = alpha;
                    c.fillStyle = '#ffd18a';
                    c.fillRect(gr.x, gr.y, gr.taille, gr.taille);
                }
            }
            c.globalAlpha = 1;
        }

        draw(g, active = true) {
            const c = this.ctx;
            c.setTransform(this.canvas.width / 960, 0, 0, this.canvas.height / 640, 0, 0);
            c.globalAlpha = 1; c.clearRect(0, 0, 960, 640);
            this.decor(g);
            // Repère de danger fixe, sans masquer les trajectoires.
            c.setLineDash([3, 9]); this.line([[20,410],[940,410]], '#edb27325'); c.setLineDash([]);
            this.text('ZONE CRITIQUE', 18, 403, 9, '#d5aa7270', 'left');
            for (let i = 0; i < 3; i++) this.building(g.cities[i], i, g.time);
            for (const launcher of g.launchers) {
                if(!this.turrets.has(launcher.x))this.turrets.set(launcher.x,{...launcher,angle:0,kick:0});
                this.turret(this.turrets.get(launcher.x),g.overheated);
            }
            for (const s of g.shots) {
                this.line([[s.sx,s.sy],[s.x,s.y]], '#ffd18a40', 1);
                const len = Math.hypot(s.tx - s.sx, s.ty - s.sy) || 1;
                this.line([[s.x - (s.tx - s.sx)/len*22,s.y - (s.ty - s.sy)/len*22],[s.x,s.y]], '#ffe6b0', 2.5);
                this.circle(s.tx, s.ty, 5, '#ffe6b080');
                this.line([[s.tx - 9,s.ty],[s.tx + 9,s.ty]], '#ffe6b080');
                this.line([[s.tx,s.ty - 9],[s.tx,s.ty + 9]], '#ffe6b080');
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
                const speed = Math.hypot(e.vx, e.vy) || 1;
                const trail = e.kind === 'fast' ? 52 : 30;
                this.line([[e.x-e.vx/speed*trail,e.y-e.vy/speed*trail],[e.x-e.vx/speed*12,e.y-e.vy/speed*12]], color + '88', e.kind==='fast'?1:3);
                c.save(); c.translate(e.x,e.y); c.rotate(Math.atan2(e.vy,e.vx) - Math.PI/2);
                this.munition(e.kind,e.hp);
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
                c.shadowColor = '#140803'; c.shadowBlur = 5;
                this.text(f.text, Math.max(65,Math.min(895,f.x)), f.y, 12, f.color);
            }
            c.shadowBlur = 0; c.globalAlpha = 1;
            if (active && this.aim) {
                this.circle(this.aim.x,this.aim.y,44,'#e8b96a55');
                this.circle(this.aim.x,this.aim.y,10,g.energy >= 1 && !g.overheated ? '#f5deb3' : '#ff947d');
                this.line([[this.aim.x - 15,this.aim.y],[this.aim.x - 6,this.aim.y]],'#f5deb3');
                this.line([[this.aim.x + 6,this.aim.y],[this.aim.x + 15,this.aim.y]],'#f5deb3');
            }
            if (this.bannerLife > 0 && active) {
                c.globalAlpha = Math.min(1,this.bannerLife*2);
                const bannerY = this.canvas.getBoundingClientRect().width < 550 ? 200 : 112;
                this.text(this.banner,480,bannerY,17,'#edcb91');
                this.text(this.subtitle,480,bannerY+21,10,'#e4cfa8'); c.globalAlpha = 1;
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
