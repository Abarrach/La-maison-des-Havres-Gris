(function () {
    'use strict';
    const $ = id => document.getElementById(id);
    const canvas = $('game'), image = new Image(), buildings = new Image(), battery = new Image();
    image.src = 'img/rempart_arrakis.webp';
    buildings.src = 'img/rempart_buildings.png';
    battery.src = 'img/rempart_battery.png';
    let game = new Rempart.Game(), view = new RempartView(canvas, image, buildings, battery), mode = 'menu';
    document.querySelectorAll('canvas[data-munition]').forEach(icon => {
        const legend = new RempartView(icon);
        legend.ctx.translate(20,20); legend.munition(icon.dataset.munition,2);
    });
    let held = false, last = 0, accumulator = 0, runId = 0, lastResult = null, saving = false;
    let scope = 'weekly', leaderboardRequest = 0, best = 0;
    const failedResults = [];
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname) || location.protocol === 'file:';
    const format = n => Math.floor(n).toLocaleString('fr-FR');
    const audio = {
        ctx: null, master: null, noise: null, enabled: true, lastKill: -1,
        async unlock() {
            if (!this.enabled) return;
            try {
                if (!this.ctx) {
                    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
                    this.master = this.ctx.createGain(); this.master.gain.value = .28; this.master.connect(this.ctx.destination);
                    this.noise = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
                    const data = this.noise.getChannelData(0);
                    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
                }
                if (this.ctx.state === 'suspended') await this.ctx.resume();
            } catch (_) { this.enabled = false; $('sound').textContent = 'Son indisponible'; $('sound').setAttribute('aria-pressed','false'); }
        },
        play(type, chain = 1) {
            if (!this.enabled || !this.ctx || this.ctx.state !== 'running') return;
            const ctx = this.ctx, now = ctx.currentTime;
            if (type === 'kill' && now - this.lastKill < .055) return;
            if (type === 'kill') this.lastKill = now;
            const cfg = {
                fire: [180,65,.10,.19,1800], kill: [100,38,.25,.36,1000],
                impact: [65,23,.55,.65,500], pulse: [260,35,.65,.55,2600],
                armor: [640,220,.13,.13,3500], split: [420,180,.13,.09,2200],
                wave: [330,495,.22,.13,0]
            }[type];
            if (!cfg) return;
            const [f1,f2,len,vol,cutoff] = cfg;
            const gain = ctx.createGain(); gain.gain.setValueAtTime(.001,now); gain.gain.linearRampToValueAtTime(vol,now+.008); gain.gain.exponentialRampToValueAtTime(.001,now+len); gain.connect(this.master);
            const osc = ctx.createOscillator(); osc.type = type === 'armor' ? 'triangle' : 'sine';
            osc.frequency.setValueAtTime(f1 * (type === 'kill' ? Math.min(1.5,1+chain*.04) : 1),now);
            osc.frequency.exponentialRampToValueAtTime(f2,now+len); osc.connect(gain); osc.start(now); osc.stop(now+len);
            osc.onended = () => { osc.disconnect(); gain.disconnect(); };
            if (cutoff) {
                const noise = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), ng = ctx.createGain();
                noise.buffer = this.noise; filter.type = 'lowpass'; filter.frequency.value = cutoff;
                ng.gain.setValueAtTime(vol*.7,now); ng.gain.exponentialRampToValueAtTime(.001,now+len);
                noise.connect(filter); filter.connect(ng); ng.connect(this.master); noise.start(now); noise.stop(now+len);
                noise.onended = () => { noise.disconnect(); filter.disconnect(); ng.disconnect(); };
            }
        }
    };
    function status(message, error = false) { $('save').textContent = message; $('save').classList.toggle('error',error); }
    async function request(url, body) {
        const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 8000);
        try {
            const response = await fetch(url, { credentials:'same-origin', signal:controller.signal,
                ...(body ? { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) } : {}) });
            if (!response.ok) throw new Error('HTTP ' + response.status);
            return await response.json();
        } finally { clearTimeout(timeout); }
    }
    async function leaderboard() {
        if (local) { $('leaderboard').textContent = 'Essai local · aucun score envoyé'; return; }
        const id = ++leaderboardRequest;
        try {
            const data = await request('scores_api.php?action=leaderboard&game=dernier_rempart&limit=8&scope='+scope);
            if (id !== leaderboardRequest) return;
            if (!data.ok) throw new Error('indisponible');
            $('leaderboard').replaceChildren();
            for (const [i, entry] of data.leaderboard.entries()) {
                const li = document.createElement('li'), name = document.createElement('span'), score = document.createElement('b');
                name.textContent = (i+1)+'. '+entry.player; score.textContent = format(entry.score); li.append(name,score); $('leaderboard').append(li);
            }
            if (!data.leaderboard.length) $('leaderboard').textContent = 'Le premier record vous attend.';
        } catch (_) { if (id === leaderboardRequest) $('leaderboard').textContent = 'Classement indisponible pour le moment.'; }
    }
    async function personalBest() {
        if (local) return;
        try {
            const data = await request('scores_api.php?action=my_scores&game=dernier_rempart');
            if (data.ok) { best = Math.max(best,...data.scores.map(s => Number(s.score) || 0)); $('best').textContent = 'Record personnel : '+format(best); }
        } catch (_) { /* Le classement n'empêche jamais de jouer. */ }
    }
    async function submit(result) {
        if (saving || !result || result.saved || result.score <= 0) return;
        if (local) { status('Essai local : score non envoyé au classement de guilde.'); return; }
        saving = true;
        if (result.id === runId) { status('Enregistrement du score…'); $('retry-save').hidden = true; }
        try {
            const token = await request('scores_api.php',{action:'token',game:'dernier_rempart'});
            if (!token.ok || !token.secret) throw new Error('Session indisponible. Reconnectez-vous au hub.');
            const digest = await crypto.subtle.digest('SHA-256',new TextEncoder().encode('dernier_rempart'+result.score+result.duration+token.secret));
            const hash = Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
            const data = await request('scores_api.php',{action:'submit',game:'dernier_rempart',score:result.score,duration:result.duration,hash});
            if (!data.ok) {
                const messages = { no_session:'Session expirée : reconnectez-vous au hub.', invalid_score:'Score refusé par le serveur'+(data.max ? ' (plafond actuel : '+format(data.max)+').' : '.'),
                    unknown_game:'Le serveur ne connaît pas encore Dernier Rempart : scores_api.php doit être mis à jour.',
                    cooldown:'Envoi trop rapproché. Réessayez dans quelques secondes.', invalid_hash:'Validation du score refusée. Réessayez.', storage_error:'Le serveur ne peut pas enregistrer le score.' };
                throw new Error(messages[data.error] || 'Score non enregistré par le serveur.');
            }
            result.saved = true; best = Math.max(best,result.score);
            const failedIndex = failedResults.indexOf(result);
            if (failedIndex >= 0) failedResults.splice(failedIndex,1);
            $('retry-save').hidden = failedResults.length === 0;
            $('best').textContent = 'Record personnel : '+format(best);
            if (result.id === runId) status('Score accepté par le serveur : '+format(result.score)+' points.');
            leaderboard();
        } catch (error) {
            if (!failedResults.includes(result)) failedResults.push(result);
            status('Score non enregistré ('+format(result.score)+' points). '+(error.name === 'AbortError' ? 'Le serveur ne répond pas.' : error.message),true);
            $('retry-save').hidden = false;
        } finally {
            saving = false;
            // Si une autre partie s'est terminée pendant l'envoi, ne pas la perdre.
            if (lastResult && lastResult !== result && !lastResult.saved) submit(lastResult);
        }
    }
    function resize() {
        const rect = canvas.getBoundingClientRect(), ratio = Math.min(2,window.devicePixelRatio || 1);
        if (rect.width < 1) return;
        canvas.width = Math.round(rect.width*ratio); canvas.height = Math.round(rect.width*ratio*2/3);
        view.draw(game,mode === 'playing');
    }
    function start() {
        runId++; lastResult = null; held = false; accumulator = 0;
        game = new Rempart.Game((Date.now() ^ Math.floor(Math.random()*0xffffffff)) >>> 0);
        view = new RempartView(canvas,image,buildings,battery); mode = 'playing';
        for (const id of ['intro','paused','ending','retry-save']) $(id).hidden = true;
        $('retry-save').hidden = failedResults.length === 0;
        $('pause').disabled = false; $('pulse').disabled = false; $('pause').textContent = 'Pause · P';
        status(local ? 'Essai local · aucun score envoyé. Clic devant les missiles, Espace en cas d’urgence.' : 'Clic devant les missiles · Espace : secours · les chaînes rechargent l’impulsion.');
        if (failedResults.length) status('Un score précédent reste non enregistré. Le bouton de nouvelle tentative est disponible.',true);
        audio.unlock(); canvas.focus({preventScroll:true}); events(); hud();
    }
    function pause() {
        if (mode !== 'playing' && mode !== 'paused') return;
        mode = mode === 'playing' ? 'paused' : 'playing'; held = false; accumulator = 0;
        $('paused').hidden = mode !== 'paused'; $('pause').textContent = mode === 'paused' ? 'Reprendre · P' : 'Pause · P';
        if (mode === 'playing') canvas.focus({preventScroll:true});
        hud();
    }
    function end() {
        mode = 'over'; held = false; $('ending').hidden = false; $('pause').disabled = true; $('pulse').disabled = true;
        $('end-score').textContent = format(game.score);
        $('end-title').textContent = game.score > best && game.score > 0 ? 'Belle résistance.' : 'Une dernière salve…';
        $('stats').replaceChildren(); $('stats').className = 'stats result-grid';
        for(const [value,label] of [[game.wave,'Vague atteinte'],[Math.floor(game.time)+' s','Résistance'],[game.stats.kills,'Interceptions'],[game.stats.usefulShots+'/'+game.stats.shots,'Tirs utiles'],[game.stats.bestChain,'Meilleure chaîne'],[game.stats.overheats,'Surchauffes']]) {
            const item=document.createElement('div'),number=document.createElement('b'),caption=document.createElement('small');
            number.textContent=value;caption.textContent=label;item.append(number,caption);$('stats').append(item);
        }
        $('advice').textContent = game.stats.overheats >= 2 ? 'Espacez vos tirs : les surchauffes vous privent de défense. Visez le passage d’un groupe avec un seul tir.' : game.pulse >= 100 ? 'Votre impulsion était prête : Espace aurait pu dégager le ciel.' :
            game.stats.bestChain < 4 ? 'Visez les groupes : une seule explosion peut arrêter une salve entière.' :
            'Les charges violettes se divisent. Les intercepter en altitude évite deux menaces rapides.';
        lastResult = { id:runId,score:game.score,duration:Math.floor(game.time),saved:false };
        if (game.score > 0) submit(lastResult); else status('Aucun point cette fois. Anticipez le déplacement des missiles.');
        // Une frappe en cours ne doit jamais relancer involontairement une partie.
        setTimeout(() => { if (mode === 'over') $('restart').focus({preventScroll:true}); },250);
    }
    function events() {
        const list = game.drainEvents(); view.events(list);
        for (const e of list) { audio.play(e.type,e.chain); if (e.type === 'over') end(); }
    }
    function hud() {
        $('score').textContent = format(game.score); $('ammo').textContent = Math.floor(game.energy);
        $('heat').style.width = game.heat+'%';
        const hot = game.overheated || game.heat >= 70;
        $('heat').style.background = hot ? '#ff9279' : '#93e5ee';
        $('heat-value').textContent = Math.ceil(game.heat)+' %';
        $('heat-value').style.color = hot ? '#ff9279' : '#eef3f3';
        $('weapon-state').textContent = game.overheated ? 'SURCHAUFFE · ATTENDEZ' : 'TEMPÉRATURE';
        $('efficiency').textContent = (game.stats.shots ? Math.round(game.stats.usefulShots/game.stats.shots*100) : 0)+' % utiles';
        $('wave').textContent = 'VAGUE '+String(game.wave).padStart(2,'0');
        $('pattern').textContent = game.pattern; $('clock').textContent = 'Salve suivante · '+Math.max(0,Math.ceil(game.waveDuration-game.waveTime))+' s';
        $('pulse').textContent = game.pulse >= 100 ? 'Impulsion prête · Espace' : 'Impulsion · '+Math.floor(game.pulse)+' %';
        $('pulse').classList.toggle('ready',game.pulse >= 100); $('pulse').disabled = mode !== 'playing' || game.pulse < 100;
    }
    function aim(event) {
        const rect = canvas.getBoundingClientRect();
        view.aim = { x:Rempart.clamp((event.clientX-rect.left)/rect.width*960,12,948),y:Rempart.clamp((event.clientY-rect.top)/rect.height*640,35,522) };
    }
    canvas.addEventListener('pointerdown',event => {
        if (mode !== 'playing' || event.button !== 0) return;
        event.preventDefault(); aim(event); held = true; canvas.setPointerCapture(event.pointerId);
        audio.unlock(); game.fire(view.aim.x,view.aim.y); events();
    });
    canvas.addEventListener('pointermove',event => { if (mode === 'playing') aim(event); });
    canvas.addEventListener('pointerup',() => { held=false; });
    canvas.addEventListener('pointercancel',() => { held=false; });
    canvas.addEventListener('lostpointercapture',() => { held=false; });
    canvas.addEventListener('pointerleave',() => { if (!held) view.aim=null; });
    canvas.addEventListener('contextmenu',event => event.preventDefault());
    $('start').addEventListener('click',start); $('restart').addEventListener('click',start);
    $('pause').addEventListener('click',pause); $('resume').addEventListener('click',pause);
    $('pulse').addEventListener('click',() => { game.emergency(); events(); hud(); });
    $('sound').addEventListener('click',() => {
        audio.enabled = !audio.enabled; $('sound').textContent = audio.enabled ? 'Son activé' : 'Son coupé'; $('sound').setAttribute('aria-pressed',String(audio.enabled));
        if (audio.master) audio.master.gain.value = audio.enabled ? .28 : 0;
        if (audio.enabled) audio.unlock();
    });
    $('retry-save').addEventListener('click',() => submit(failedResults[0] || lastResult));
    document.addEventListener('keydown',event => {
        if (event.repeat || event.target.closest('input,textarea,select')) return;
        if (event.code === 'KeyP' || event.code === 'Escape') { event.preventDefault(); pause(); }
        if (event.code === 'Space' && mode === 'playing') { event.preventDefault(); game.emergency(); events(); hud(); }
    });
    window.addEventListener('blur',() => { held=false; if (mode === 'playing') pause(); });
    document.addEventListener('visibilitychange',() => { if (document.hidden && mode === 'playing') pause(); });
    for (const button of document.querySelectorAll('[data-scope]')) button.addEventListener('click',() => {
        scope = button.dataset.scope; for (const b of document.querySelectorAll('[data-scope]')) b.setAttribute('aria-pressed',String(b===button)); leaderboard();
    });
    function frame(now) {
        requestAnimationFrame(frame);
        const dt = last ? Math.min((now-last)/1000,.1) : 0; last=now;
        if (mode === 'playing') {
            accumulator += dt;
            while (accumulator >= 1/120 && mode === 'playing') {
                if (held && view.aim) game.fire(view.aim.x,view.aim.y);
                game.step(1/120); events(); view.advance(1/120); accumulator -= 1/120;
            }
            hud();
        }
        view.draw(game,mode === 'playing');
    }
    window.addEventListener('resize',resize); image.onload=resize; buildings.onload=resize; battery.onload=resize;
    resize(); leaderboard(); personalBest(); requestAnimationFrame(frame);
})();
