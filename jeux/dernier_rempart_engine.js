/* Dernier Rempart : simulation déterministe, indépendante du rendu et du serveur. */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.Rempart = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';
    const W = 960, H = 640, GROUND = 558;
    const LAUNCHERS = Object.freeze([{x:70,y:558},{x:385,y:604},{x:890,y:558}].map(Object.freeze));
    const BARREL = 30;
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    // Barème par type : ce qui était DIFFICILE, pas ce qui était gros.
    //  - `fast` va 48 % plus vite que le reste : c'est la cible la plus dure à anticiper.
    //  - `armored` demande DEUX explosions : à 200 il rend 100 par tir, comme un normal.
    //    (à 150 il en rendait 75, soit le pire rendement du jeu pour la cible la plus
    //    impressionnante — un piège à points.)
    //  - `split` intercepté en altitude doit battre le fait de le laisser se séparer,
    //    sinon la légende du jeu (« interceptez avant la séparation ») paie l'inverse
    //    de ce qu'elle demande. 250 contre 2 × 60 : la consigne et le barème s'accordent.
    const VALEUR = { normal: 100, fast: 150, split: 250, armored: 200 };
    const VALEUR_DEBRIS = 60;   // enfant d'une ogive : un débris, pas une cible neuve
    // Plafond de chaîne calé sur ce qui est ATTEIGNABLE. L'ancien ×6 exigeait seize
    // victimes d'une seule explosion ; les meilleures parties plafonnent vers cinq.
    const CHAINE_PALIER = 2, CHAINE_MAX = 4;
    function seeded(seed) {
        let n = seed >>> 0;
        return () => { n += 0x6D2B79F5; let t = n; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    }
    function segmentDistance(x, y, ax, ay, bx, by) {
        const dx = bx - ax, dy = by - ay;
        const t = clamp(((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1), 0, 1);
        return Math.hypot(x - ax - dx * t, y - ay - dy * t);
    }
    class Game {
        constructor(seed = Date.now()) {
            this.random = seeded(seed);
            this.launchers = LAUNCHERS;
            this.seed = seed; this.time = 0; this.wave = 0; this.waveTime = 0;
            this.state = 'playing'; this.score = 0; this.energy = 12; this.pulse = 100;
            this.cooldown = 0; this.enemies = []; this.shots = []; this.blasts = [];
            this.heat = 0; this.overheated = false; this.coolingDelay = 0;
            this.events = []; this.schedule = []; this.nextId = 1;
            this.cities = [190, 480, 770].map((x, i) => ({ x, hp: 3, name: ['EAU', 'ÉNERGIE', 'HANGAR'][i] }));
            this.stats = { kills: 0, shots: 0, bestChain: 0, saves: 0, damage: 0, pulses: 0, usefulShots: 0, chainBonus: 0, overheats: 0, holdBonus: 0, precisionBonus: 0 };
            // Comptabilité de précision. Un tir est rattaché à la vague où sa CHAÎNE
            // S'ACHÈVE, pas à celle où on a appuyé : un tir lâché en fin de vague explose
            // souvent pendant la suivante, et compter le tir d'un côté de la bascule et son
            // utilité de l'autre faisait dépasser 100 % (reproduit à 200 %, soit 1 600 points
            // pour un plafond prévu à 400). Numérateur et dénominateur sont désormais
            // toujours dans la même vague, donc le taux est borné par construction.
            this.tirsResolus = 0; this.tirsUtilesResolus = 0;
            this.nextWave();
        }
        emit(type, data = {}) { this.events.push({ type, ...data }); }
        drainEvents() { return this.events.splice(0); }
        nextWave() {
            if (this.wave) {
                const alive = this.cities.filter(c => c.hp > 0);
                // Deux lignes SÉPARÉES et annoncées comme telles : le joueur doit voir ce que
                // chacun de ses choix lui rapporte. Un bonus unique ne dit rien.
                //  - Tenue : suit le numéro de vague. À 150 fixe, survivre à la vague 11
                //    (62 missiles) payait comme survivre à la vague 1 (22 missiles).
                //  - Précision : le « % utiles » était affiché mais n'entrait jamais dans le
                //    score. Au carré, pour récompenser la maîtrise et non la moyenne :
                //    90 % → 324, 60 % → 144, 40 % → 64.
                const tenue = alive.length * 75 * this.wave;
                const tirs = this.tirsResolus;
                const taux = tirs > 0 ? this.tirsUtilesResolus / tirs : 0;
                const precision = Math.round(400 * taux * taux);
                const bonus = tenue + precision;
                this.stats.holdBonus += tenue; this.stats.precisionBonus += precision;
                this.score += bonus;
                this.emit('bonus', { bonus, tenue, precision, taux });
                // Un seul point réparé, jamais de résurrection : les erreurs restent coûteuses.
                if (alive.length) {
                    const weakest = alive.reduce((a, b) => a.hp <= b.hp ? a : b);
                    if (weakest.hp < 3) { weakest.hp++; this.emit('repair', { x: weakest.x }); }
                }
                this.energy = Math.min(12, this.energy + 3);
            }
            this.wave++; this.waveTime = 0;
            this.tirsResolus = 0; this.tirsUtilesResolus = 0;
            this.waveDuration = Math.max(12, 18 - Math.max(0, this.wave - 4) * .35);
            const count = Math.min(78, 18 + this.wave * 4 + (this.wave % 5 === 0 ? 8 : 0));
            const patterns = ['ÉVENTAIL', 'TIRS CROISÉS', 'SIÈGE'];
            this.pattern = patterns[(this.wave - 1) % 3];
            this.schedule = [];
            const focus = Math.floor(this.random() * 3);
            for (let i = 0; i < count; i++) {
                const group = Math.floor(i / 3), slot = i % 3;
                const at = .25 + group * ((this.waveDuration - 3) / Math.ceil(count / 3)) + slot * .18;
                const roll = this.random();
                let kind = 'normal';
                if (this.wave >= 2 && roll < .24) kind = 'fast';
                if (this.wave >= 3 && roll >= .24 && roll < .43) kind = 'split';
                if (this.wave >= 4 && roll >= .43 && roll < .57) kind = 'armored';
                let x = 65 + this.random() * 830, target = Math.floor(this.random() * 3);
                if (this.pattern === 'TIRS CROISÉS') { x = i % 2 ? 850 : 110; target = i % 2 ? 0 : 2; }
                if (this.pattern === 'SIÈGE') { x = clamp(220 + slot * 240 + (this.random() - .5) * 150, 40, 920); target = focus; }
                this.schedule.push({ at, x, target, kind });
            }
            this.emit('wave', { wave: this.wave, pattern: this.pattern });
        }
        spawn(spec) {
            const alive = this.cities.map((c, i) => c.hp > 0 ? i : -1).filter(i => i >= 0);
            if (!alive.length || this.enemies.length >= 140) return;
            const target = this.cities[spec.target]?.hp > 0 ? spec.target : alive[Math.floor(this.random() * alive.length)];
            const y = spec.y ?? -14, x = spec.x, tx = this.cities[target].x;
            const kind = spec.kind || 'normal';
            const speed = Math.min(178, 82 + this.wave * 9) * (kind === 'fast' ? 1.48 : kind === 'armored' ? .82 : 1);
            const dist = Math.hypot(tx - x, GROUND - y);
            this.enemies.push({ id: this.nextId++, x, y, px: x, py: y, sx: x, sy: y,
                vx: (tx - x) / dist * speed, vy: (GROUND - y) / dist * speed,
                target, kind, debris: !!spec.debris,
                hp: kind === 'armored' ? 2 : 1, splitY: 205 + this.random() * 70, dead: false });
        }
        fire(x, y) {
            if (this.state !== 'playing' || !Number.isFinite(x) || !Number.isFinite(y) || this.cooldown > 0 || this.energy < 1 || this.overheated) return false;
            x = clamp(x, 12, W - 12); y = clamp(y, 35, GROUND - 36);
            const launcher = LAUNCHERS.reduce((a,b)=>Math.abs(a.x-x)<Math.abs(b.x-x)?a:b);
            const angle = Math.atan2(y-launcher.y,x-launcher.x);
            const launchX = launcher.x + Math.cos(angle)*BARREL;
            const launchY = launcher.y + Math.sin(angle)*BARREL;
            this.shots.push({ x: launchX, y: launchY, sx: launchX, sy: launchY, tx: x, ty: y, chain: { kills: 0, emergency: false, shot: true, useful: false } });
            this.energy--; this.cooldown = .16; this.stats.shots++;
            this.heat = Math.min(100, this.heat + 19); this.coolingDelay = .12;
            if (this.heat >= 100) {
                this.overheated = true; this.stats.overheats++; this.emit('overheat');
            }
            this.emit('fire', { x: launchX, y: launchY, launcherX:launcher.x, angle:angle+Math.PI/2 });
            return true;
        }
        emergency() {
            if (this.state !== 'playing' || this.pulse < 100) return false;
            this.pulse = 0; this.stats.pulses++;
            this.explode(W / 2, H / 2, { kills: 0, emergency: true }, 650, .5);
            this.emit('pulse');
            return true;
        }
        explode(x, y, chain = { kills: 0, emergency: false }, max = 44, life = .48) {
            this.blasts.push({ x, y, chain, max, life, age: 0, r: 0, hit: new Set() });
            this.emit('blast', { x, y, emergency: chain.emergency });
        }
        kill(enemy, chain) {
            enemy.dead = true; chain.kills++; this.stats.kills++;
            this.stats.bestChain = Math.max(this.stats.bestChain, chain.kills);
            const late = enemy.y > 410;
            const multi = Math.min(CHAINE_MAX, 1 + Math.floor((chain.kills - 1) / CHAINE_PALIER));
            const efficiencyBonus = chain.emergency ? 0 : Math.min(250, (chain.kills - 1) * 50);
            const valeur = enemy.debris ? VALEUR_DEBRIS : (VALEUR[enemy.kind] || VALEUR.normal);
            // Le sauvetage suit le multiplicateur : à +50 fixe il devenait du bruit dès que
            // la chaîne montait, alors que c'est justement l'interception la plus risquée.
            const points = chain.emergency ? 25 : valeur * multi + (late ? 50 * multi : 0) + efficiencyBonus;
            this.stats.chainBonus += efficiencyBonus;
            this.score += points;
            if (!chain.emergency) {
                this.pulse = Math.min(100, this.pulse + 4 + (late ? 2 : 0));
                this.explode(enemy.x, enemy.y, chain, 42, .5);
                if (late) this.stats.saves++;
            }
            this.emit('kill', { x: enemy.x, y: enemy.y, points, chain: chain.kills, late, emergency: chain.emergency });
        }
        step(dt) {
            if (this.state !== 'playing' || !Number.isFinite(dt) || dt <= 0) return;
            // Sous-pas bornés : mêmes collisions à 30/60/144 Hz, même en rattrapage.
            let remaining = Math.min(dt, .25);
            while (remaining > 1e-8 && this.state === 'playing') {
                const sub = Math.min(remaining, 1 / 120); this.update(sub); remaining -= sub;
            }
        }
        update(dt) {
            this.time += dt; this.waveTime += dt;
            this.cooldown = Math.max(0, this.cooldown - dt);
            const coolingTime = Math.max(0, dt - this.coolingDelay);
            this.coolingDelay = Math.max(0, this.coolingDelay - dt);
            this.heat = Math.max(0, this.heat - coolingTime * 48);
            if (this.overheated && this.heat <= 30) { this.overheated = false; this.emit('cooled'); }
            this.energy = Math.min(12, this.energy + dt * 3.1);
            while (this.schedule.length && this.schedule[0].at <= this.waveTime) this.spawn(this.schedule.shift());
            for (const s of this.shots) {
                const dx = s.tx - s.x, dy = s.ty - s.y, distance = Math.hypot(dx, dy), travel = 930 * dt;
                if (distance <= travel) { s.dead = true; this.explode(s.tx, s.ty, s.chain); }
                else { s.x += dx / distance * travel; s.y += dy / distance * travel; }
            }
            this.shots = this.shots.filter(s => !s.dead);
            // Les explosions enfant n'infligent des dégâts qu'au sous-pas suivant.
            const blasts = this.blasts.slice();
            for (const b of blasts) { b.age += dt; b.r = b.max * Math.min(1, b.age / .14) * Math.min(1, Math.max(0, (b.life - b.age) / .24)); }
            const children = [];
            for (const e of this.enemies) {
                e.px = e.x; e.py = e.y; e.x += e.vx * dt; e.y += e.vy * dt;
                for (const b of blasts) {
                    if (b.age >= b.life || b.hit.has(e.id)) continue;
                    if (segmentDistance(b.x, b.y, e.px, e.py, e.x, e.y) <= b.r + 5) {
                        b.hit.add(e.id);
                        // Un tir qui brise le blindage est utile, même sans destruction.
                        if (b.chain.shot && !b.chain.useful) { b.chain.useful = true; this.stats.usefulShots++; }
                        e.hp -= b.chain.emergency ? 2 : 1;
                        if (e.hp <= 0) { this.kill(e, b.chain); break; }
                        this.emit('armor', { x: e.x, y: e.y });
                    }
                }
                if (e.dead) continue;
                if (e.kind === 'split' && e.y >= e.splitY) {
                    e.dead = true;
                    children.push({ x: e.x - 5, y: e.y, target: (e.target + 2) % 3, kind: 'fast', debris: true },
                        { x: e.x + 5, y: e.y, target: (e.target + 1) % 3, kind: 'fast', debris: true });
                    this.emit('split', { x: e.x, y: e.y });
                } else if (e.y >= GROUND) {
                    e.dead = true;
                    const city = this.cities[e.target];
                    if (city.hp > 0) { city.hp--; this.stats.damage++; this.emit('impact', { x: city.x, y: GROUND, destroyed: city.hp === 0 }); }
                }
            }
            this.enemies = this.enemies.filter(e => !e.dead);
            children.forEach(e => this.spawn(e));
            // Une chaîne est close quand sa DERNIÈRE explosion s'éteint : c'est à ce
            // moment-là, et une seule fois, que le tir entre dans la précision de la vague.
            const expirees = this.blasts.filter(b => b.age >= b.life);
            this.blasts = this.blasts.filter(b => b.age < b.life);
            for (const b of expirees) {
                const c = b.chain;
                if (!c || !c.shot || c.compte) continue;
                if (this.blasts.some(o => o.chain === c)) continue;   // la chaîne se propage encore
                c.compte = true;
                this.tirsResolus++;
                if (c.useful) this.tirsUtilesResolus++;
            }
            if (!this.cities.some(c => c.hp > 0)) { this.state = 'over'; this.emit('over'); return; }
            // Pas d'écran d'attente entre les vagues : les dernières menaces restent actives.
            if (this.waveTime >= this.waveDuration) this.nextWave();
        }
    }
    return { Game, W, H, GROUND, LAUNCHERS, BARREL, seeded, segmentDistance, clamp };
});
