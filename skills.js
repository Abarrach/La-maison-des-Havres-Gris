// === CONFIGURATION DES STATS (Label + Description) ===
const statConfig = {
    "degats": { label: "Dégâts", desc: "Augmente les dégâts globaux infligés." },
    "attenuation": { label: "Atténuation Dégâts", desc: "Réduit les dégâts subis." },
    "dmg_chancelant": { label: "Dégâts (Chancelant)", desc: "Augmente les dégâts contre les cibles chancelantes." },
    "stockage": { label: "Capacité Stockage", desc: "Augmente le poids et le volume maximum transportable." },
    "rendement_vehicule": { label: "Rendement (Véhicule)", desc: "Améliore l'extraction minière par véhicule." },
    "rendement_compacteur": { label: "Rendement (Compacteur)", desc: "Améliore le rendement du compacteur statique." },
    "rendement_base": { label: "Rendement Minier", desc: "Améliore l'extraction minière de base." },
    "durabilite_craft": { label: "Durabilité (Craft)", desc: "Augmente la durabilité maximale des objets fabriqués." },
    "hp": { label: "Santé Max", desc: "Augmente vos points de vie totaux." },
    "stamina": { label: "Endurance Max", desc: "Augmente votre barre d'énergie pour courir/grimper." },
    "headshot_dmg": { label: "Dégâts Tête", desc: "Augmente les dégâts infligés lors des tirs à la tête." },
    "barrel_dmg": { label: "Dégâts Explosifs", desc: "Augmente les dégâts des grenades et barils explosifs." },
    "butin_humain": { label: "Butin Humain", desc: "Améliore le butin trouvé sur les cadavres ennemis." },
    "scrip": { label: "Gains Scrip", desc: "Augmente l'argent (Solaris) gagné lors des missions." },
    "landsraad_points": { label: "Contrib. Faction", desc: "Augmente les points d'influence gagnés pour la guilde." },
    "tax_reduction": { label: "Réduc. Impôts", desc: "Réduit les taxes d'entretien hebdomadaires de la base." },
    "corruption_cost": { label: "Coût Corruption", desc: "Réduit le coût pour corrompre les officiels Landsraad." },
    "stealth_range": { label: "Discrétion Visuelle", desc: "Réduit la distance à laquelle les ennemis vous repèrent." },
    "detection_speed": { label: "Vitesse Détection", desc: "Réduit la vitesse à laquelle les ennemis vous identifient." },
    "scan_range": { label: "Protection Scan", desc: "Il faut être plus près de vous pour pouvoir vous scanner." },
    "duree_scan": { label: "Réduc. Scan Subi", desc: "Réduit la durée pendant laquelle vous restez affiché sur les radars." },
    "delai_piege": { label: "Délai Mines", desc: "Retarde l'explosion des pièges ennemis déclenchés." },
    "inv_slots": { label: "Emplacements", desc: "Ajoute des slots permanents à votre inventaire." },
    "fuel_efficiency": { label: "Éco. Carburant", desc: "Réduit la consommation de fuel des véhicules." },
    "boost_heat": { label: "Réduc. Chaleur", desc: "Le boost du véhicule génère moins de chaleur." },
    "refroidissement": { label: "Refroidissement", desc: "Le véhicule refroidit plus vite après une surchauffe." },
    "vitesse": { label: "Vitesse Pointe", desc: "Augmente la vitesse maximale du véhicule." },
    "tempete": { label: "Résist. Tempête", desc: "Réduit les dégâts subis par le véhicule dans les tempêtes de Coriolis." },
    "recup_vehicule": { label: "Coût Récupération", desc: "Réduit le prix pour rappeler un véhicule détruit ou perdu." },
    "resistance_vehicule": { label: "Résistance Dégâts", desc: "Le véhicule subit moins de dégâts des chocs et tirs." },
    "conso_suspensor": { label: "Conso. Suspensor", desc: "Réduit l'énergie consommée par la ceinture antigravité." },
    "escalade": { label: "Endurance Escalade", desc: "Réduit le coût en endurance pour grimper aux murs." },
    "scanner": { label: "Portée Scanner", desc: "Détecte les ressources et ennemis de plus loin." },
    "sonde": { label: "Vitesse Sonde", desc: "Réduit le temps nécessaire pour scanner une zone avec la sonde." },
    "brouillard": { label: "Dévoilement Carte", desc: "Dévoile une plus grande zone de la carte en explorant." },
    "menace_vers": { label: "Discrétion Vers", desc: "Réduit les vibrations (Pas rythmés) pour ne pas attirer les Vers." },
    "qualite_butin": { label: "Niveau Butin", desc: "Augmente la qualité des objets trouvés dans les coffres." },
    "butin_general": { label: "Qualité Butin", desc: "Chance accrue de trouver des objets rares dans les caches." },
    "yield_water": { label: "Récolte Eau", desc: "Augmente la quantité d'eau récoltée sur les plantes." },
    "yield_blood": { label: "Récolte Sang", desc: "Augmente la quantité de sang récoltée sur les cadavres." },
    "ramassage": { label: "Ramassage Manuel", desc: "Multiplie les ressources ramassées à la main (pierres, fibres)." },
    "salvage_chance": { label: "Recyclage Ferraille", desc: "Augmente le rendement en recyclant les débris de ferraille." },
    "mineraux_rares": { label: "Chance Minéraux", desc: "Augmente la chance de trouver des gemmes ou métaux rares en minant." },
    "jackpot": { label: "Chance Jackpot", desc: "Petite chance d'obtenir un énorme montant de ressources d'un coup." },
    "compacteur": { label: "Portée Compacteur", desc: "Permet d'utiliser le compacteur de ressources de plus loin." },
    "menace_compacteur": { label: "Discrétion Compacteur", desc: "Le compacteur génère moins de vibrations." },
    "tool_energy": { label: "Éco. Outils", desc: "Les outils (lasers, pioches) consomment moins d'énergie/durabilité." },
    "taille_cadavre": { label: "Place Cadavres", desc: "Les cadavres occupent moins de place dans l'inventaire." },
    "slot_dist": { label: "Slot Arme Dist.", desc: "Ajoute un emplacement de modification pour arme à distance." },
    "slot_melee": { label: "Slot Arme Mêlée", desc: "Ajoute un emplacement de modification pour arme de mêlée." },
    "slot_armor": { label: "Slot Armure", desc: "Ajoute un emplacement de modification pour l'armure." },
    "repair_efficiency": { label: "Efficacité Répa.", desc: "Vous perdez moins de durabilité max en réparant un objet." },
    "double_craft": { label: "Chance Double Craft", desc: "Chance de produire deux objets pour le prix d'un (munitions/soins)." },
    "epice": { label: "Rendement Épice", desc: "Augmente la quantité d'épice raffinée." },
    "recyclage": { label: "Rendement Recyclage", desc: "Augmente les ressources récupérées en recyclant des objets." },
    "jackpot_recycle": { label: "Jackpot Recyclage", desc: "Chance d'obtenir des composants rares en recyclant." },
    "vitesse_usine": { label: "Vitesse Usine", desc: "Réduit le temps de fabrication et de raffinage des machines." },
    "cout_modif": { label: "Coût Modifs", desc: "Réduit les ressources nécessaires pour fabriquer des améliorations." },
    "qualite_modif": { label: "Qualité Modifs", desc: "Augmente la chance d'obtenir de meilleures statistiques sur les améliorations créées." },
    "chimie": { label: "Rendement Chimie", desc: "Bonus de production lors du raffinage chimique." },
    "minerais": { label: "Rendement Lingots", desc: "Bonus de production lors de la fonte de minerais." },
    "recup_schema": { label: "Récupération Schéma", desc: "Chance de récupérer le schéma de fabrication lors du recyclage." },
    "double_permis": { label: "Chance Double Permis", desc: "Chance d'obtenir un permis supplémentaire en apprenant un schéma." },
    "skill_points": { label: "Points Compétence", desc: "Points utilisés pour débloquer de nouveaux talents." }
};

// === JALONS IMPORTANTS PAR MÉTIER ===
const MILESTONES = {
    "COMBAT":      { 6: "Santé +15", 77: "Santé +25 🏛 + Casque niv.75", 100: "+5 pts compétence" },
    "SABOTAGE":    { 19: "+5% Contrib. Faction 🏛", 43: "+10% Contrib. Faction 🏛", 75: "Casque Saboteur" },
    "EXPLORATION": { 25: "+1 Slot inventaire 🏛", 50: "+1 Slot inventaire 🏛", 74: "Discrétion Vers 🏛", 75: "Casque Explorateur" },
    "RECOLTE":     { 15: "Ramassage ×150% 🏛", 55: "Ramassage ×150% 🏛", 75: "Casque Récolteur" },
    "FABRICATION": { 8: "25% Double Craft 🏛", 52: "Fusion de Fragments 🏛", 63: "Rendement Minerai 🏛", 75: "Casque Artisan", 100: "15% Double Permis 🏛" }
};

// === BUILDS PRÉDÉFINIS ===
const PRESETS = [
    { id: "spice_farmer",  icon: "🌾", label: "Farmer d'Épice",       desc: "Maximise l'épice raffinée et les rendements de recyclage.", levels: { COMBAT:0, SABOTAGE:0, EXPLORATION:0, RECOLTE:35, FABRICATION:52 } },
    { id: "guild_crafter", icon: "🔨", label: "Crafteur de Guilde",    desc: "Slots d'augmentation max, double craft et recyclage optimisé.", levels: { COMBAT:0, SABOTAGE:0, EXPLORATION:0, RECOLTE:0, FABRICATION:100 } },
    { id: "landsraad",     icon: "🏛", label: "Contributeur Landsraad",desc: "Maximise les points de faction et les bonus Landsraad.", levels: { COMBAT:0, SABOTAGE:72, EXPLORATION:38, RECOLTE:15, FABRICATION:22 } },
    { id: "explorer",      icon: "🚗", label: "Explorateur",           desc: "Performance véhicule, inventaire étendu, survie tempêtes.", levels: { COMBAT:0, SABOTAGE:0, EXPLORATION:100, RECOLTE:0, FABRICATION:0 } },
    { id: "pvp",           icon: "⚔", label: "Combattant PvP",        desc: "HP + endurance + discrétion et dégâts headshots.", levels: { COMBAT:77, SABOTAGE:50, EXPLORATION:0, RECOLTE:0, FABRICATION:0 } },
    { id: "balanced",      icon: "⚖", label: "Équilibré",             desc: "Un peu de tout : craft, exploration, récolte et faction.", levels: { COMBAT:0, SABOTAGE:19, EXPLORATION:50, RECOLTE:35, FABRICATION:52 } }
];


// ================================================================
// TABLES XP & MISSIONS (source: method.gg / données officielles)
// 1 mission Landsraad = 125 XP. Identiques pour tous les arbres.
// ================================================================
const XP_CUMUL     = {1:100, 2:205, 3:315, 4:431, 5:553, 6:681, 7:816, 8:958, 9:1107, 10:1264, 11:1428, 12:1599, 13:1777, 14:1963, 15:2157, 16:2359, 17:2570, 18:2790, 19:3019, 20:3258, 21:3504, 22:3757, 23:4017, 24:4285, 25:4561, 26:4845, 27:5137, 28:5438, 29:5748, 30:6067, 31:6393, 32:6727, 33:7069, 34:7419, 35:7777, 36:8143, 37:8518, 38:8902, 39:9295, 40:9697, 41:10107, 42:10525, 43:10951, 44:11385, 45:11827, 46:12277, 47:12736, 48:13204, 49:13681, 50:14167, 51:14661, 52:15163, 53:15673, 54:16191, 55:16717, 56:17251, 57:17794, 58:18346, 59:18907, 60:19477, 61:20052, 62:20632, 63:21217, 64:21807, 65:22402, 66:23002, 67:23608, 68:24220, 69:24838, 70:25462, 71:26086, 72:26710, 73:27334, 74:27958, 75:28582, 76:29206, 77:29830, 78:30454, 79:31078, 80:31702, 81:32326, 82:32950, 83:33574, 84:34198, 85:34822, 86:35446, 87:36070, 88:36694, 89:37318, 90:37942, 91:38566, 92:39190, 93:39814, 94:40438, 95:41062, 96:41686, 97:42310, 98:42934, 99:43558, 100:44182};
const MISSIONS_CUMUL = {1:1, 2:2, 3:3, 4:4, 5:5, 6:6, 7:7, 8:8, 9:9, 10:11, 11:12, 12:13, 13:15, 14:16, 15:18, 16:19, 17:21, 18:23, 19:25, 20:27, 21:29, 22:31, 23:33, 24:35, 25:37, 26:39, 27:42, 28:44, 29:46, 30:49, 31:52, 32:54, 33:57, 34:60, 35:63, 36:66, 37:69, 38:72, 39:75, 40:78, 41:81, 42:85, 43:88, 44:92, 45:95, 46:99, 47:102, 48:106, 49:110, 50:114, 51:118, 52:122, 53:126, 54:130, 55:134, 56:139, 57:143, 58:147, 59:152, 60:156, 61:161, 62:166, 63:170, 64:175, 65:180, 66:185, 67:189, 68:194, 69:199, 70:204, 71:209, 72:214, 73:219, 74:224, 75:229, 76:234, 77:239, 78:244, 79:249, 80:254, 81:259, 82:264, 83:269, 84:274, 85:279, 86:284, 87:289, 88:294, 89:299, 90:304, 91:309, 92:314, 93:319, 94:324, 95:329, 96:334, 97:339, 98:344, 99:349, 100:354};
// Calcule XP et missions entre deux niveaux (from → to)
// Les missions utilisent la table officielle MISSIONS_CUMUL pour éviter les écarts d'arrondi
function progressionEntre(from, to) {
    const xpFrom  = XP_CUMUL[from]      || 0;
    const xpTo    = XP_CUMUL[to]        || 0;
    const xp      = Math.max(0, xpTo - xpFrom);
    const mFrom   = MISSIONS_CUMUL[from] || 0;
    const mTo     = MISSIONS_CUMUL[to]   || 0;
    const missions = Math.max(0, mTo - mFrom);
    return { xp, missions };
}

// === ÉTAT GLOBAL ===
let selectionState = { COMBAT:0, SABOTAGE:0, EXPLORATION:0, RECOLTE:0, FABRICATION:0 };
let isLandsraadFilter = false;

const URL_KEYS     = { COMBAT:"c", SABOTAGE:"s", EXPLORATION:"e", RECOLTE:"r", FABRICATION:"f" };
const URL_KEYS_REV = { c:"COMBAT", s:"SABOTAGE", e:"EXPLORATION", r:"RECOLTE", f:"FABRICATION" };

// ================================================================
// INIT
// ================================================================
document.addEventListener("DOMContentLoaded", async () => {
    if (!localStorage.getItem("user")) { window.location.href = "login.html"; return; }

    const container = document.getElementById("skills-container");
    let allSkillsData = [];
    try {
        const res = await fetch("metiers.json?v=" + Date.now());
        allSkillsData = await res.json();
    } catch {
        container.innerHTML = "<p style='color:red'>Erreur JSON (metiers.json introuvable)</p>"; return;
    }

    // Restaurer état depuis URL
    const urlParams = new URLSearchParams(window.location.search);
    for (const [key, metier] of Object.entries(URL_KEYS_REV)) {
        const v = parseInt(urlParams.get(key));
        if (!isNaN(v) && v >= 0 && v <= 100) selectionState[metier] = v;
    }

    const metiers = {};
    const order = ["COMBAT","SABOTAGE","EXPLORATION","RECOLTE","FABRICATION"];
    allSkillsData.forEach(item => { if (!metiers[item.metier]) metiers[item.metier] = []; metiers[item.metier].push(item); });

    order.forEach(mName => {
        if (!metiers[mName]) return;
        metiers[mName].sort((a,b) => a.niveau - b.niveau);

        const col = document.createElement("div");
        col.className = "skill-column";
        col.innerHTML = `
            <div class="skill-header">${mName}</div>
            <div class="skill-stats" id="stats-${mName}"><div style="color:#666;text-align:center;padding:10px;">Sélectionnez un niveau</div></div>
            <div class="skill-list" id="list-${mName}"></div>`;
        container.appendChild(col);
        const listContainer = col.querySelector(".skill-list");

        metiers[mName].forEach(skill => {
            const item = document.createElement("div");
            item.className = "skill-item";
            if (skill.is_landsraad_favorable) item.classList.add("is-landsraad");
            item.dataset.metier = mName;
            item.dataset.niveau = skill.niveau;
            item.dataset.json = JSON.stringify(skill);

            const lsIcon    = skill.is_landsraad_favorable ? '<span class="landsraad-icon tooltip-container">🏛<span class="tooltip-text landsraad-tip">Favorable Landsraad</span></span>' : '';
            const msIcon    = (MILESTONES[mName]?.[skill.niveau]) ? `<span class="milestone-badge tooltip-container">⭐<span class="tooltip-text milestone-tip">${MILESTONES[mName][skill.niveau]}</span></span>` : '';
            const spiceBadge= (!skill.is_passive && skill.cout_epice !== undefined) ? `<span class="spice-cost-badge">💎${skill.cout_epice}</span>` : '';

            item.innerHTML = `${lsIcon}${msIcon}<span class="lvl-badge">${skill.niveau}</span>${spiceBadge}<div class="talent-name">${skill.talent}</div><div class="talent-desc">${skill.description}</div>`;
            item.onclick = () => toggleSkill(mName, skill.niveau);
            listContainer.appendChild(item);
        });
    });

    window._allSkillsDataGlobal = allSkillsData;
    injectToolbar();
    injectDeltaSimulator();
    adjustBoardHeight();
    order.forEach(m => { if (selectionState[m] > 0) updateDisplay(m); });
    if (urlParams.get('tab') === 'requetes') setTimeout(() => switchTab('requetes'), 50);
});


// ================================================================
// AJUSTEMENT HAUTEUR DU BOARD
// ================================================================
function adjustBoardHeight() {
    const board = document.getElementById('skills-container');
    if (!board) return;
    const top = board.getBoundingClientRect().top;
    board.style.height = (window.innerHeight - top - 10) + 'px';
}
window.addEventListener('resize', adjustBoardHeight);

// ================================================================
// SIMULATEUR DE PROGRESSION (delta niveau A → niveau B)
// ================================================================
function injectDeltaSimulator() {
    const switcher = document.getElementById("view-switcher");
    if (!switcher || document.getElementById("delta-panel")) return;

    const panel = document.createElement("div");
    panel.id = "delta-panel";
    panel.innerHTML = `
        <div id="delta-panel-inner">
            <div class="delta-title">🧮 Calculateur de Progression</div>
            <div class="delta-row">
                <div class="delta-field">
                    <label>Métier</label>
                    <select id="delta-metier">
                        <option value="COMBAT">Combat</option>
                        <option value="SABOTAGE">Sabotage</option>
                        <option value="EXPLORATION">Exploration</option>
                        <option value="RECOLTE" selected>Récolte</option>
                        <option value="FABRICATION">Fabrication</option>
                    </select>
                </div>
                <div class="delta-field">
                    <label>Niveau actuel</label>
                    <input type="number" id="delta-from" min="0" max="99" value="0" oninput="computeDelta()">
                </div>
                <div class="delta-field">
                    <label>Niveau cible</label>
                    <input type="number" id="delta-to" min="1" max="100" value="100" oninput="computeDelta()">
                </div>
            </div>
            <div id="delta-results" class="delta-results"></div>
        </div>
    `;

    // Insérer après la toolbar
    const toolbar = document.getElementById("skills-toolbar");
    const insertAfter = toolbar || switcher;
    insertAfter.insertAdjacentElement('afterend', panel);

    computeDelta();
}

window.computeDelta = function() {
    const from = Math.max(0, Math.min(99, parseInt(document.getElementById('delta-from')?.value) || 0));
    const to   = Math.max(1, Math.min(100, parseInt(document.getElementById('delta-to')?.value)  || 100));
    const metier = document.getElementById('delta-metier')?.value || 'RECOLTE';

    const resultsEl = document.getElementById('delta-results');
    if (!resultsEl) return;

    if (from >= to) {
        resultsEl.innerHTML = `<span class="delta-warn"⚠️ Le niveau cible doit être supérieur au niveau actuel.</span>`;
        return;
    }

    const prog = progressionEntre(from, to);
    const semaines = Math.ceil(prog.missions / 35);
    const jours    = Math.ceil(prog.missions / 5);

    // Calculer le coût en épice pour les nœuds keystones dans la plage
    let epiceRange = 0;
    if (window._allSkillsDataGlobal) {
        window._allSkillsDataGlobal
            .filter(s => s.metier === metier && !s.is_passive && s.cout_epice !== undefined && s.niveau > from && s.niveau <= to)
            .forEach(s => epiceRange += s.cout_epice);
    }

    // Couleur dynamique selon l'effort
    const couleurMissions = prog.missions <= 50 ? '#41d37a' : prog.missions <= 150 ? '#d4a23b' : '#ff6b6b';

    resultsEl.innerHTML = `
        <div class="delta-stat-grid">
            <div class="delta-stat">
                <div class="delta-stat-val" style="color:${couleurMissions}">${prog.missions.toLocaleString()}</div>
                <div class="delta-stat-lbl">missions</div>
            </div>
            <div class="delta-stat">
                <div class="delta-stat-val" style="color:#a78bfa">${prog.xp.toLocaleString()}</div>
                <div class="delta-stat-lbl">XP requis</div>
            </div>
            <div class="delta-stat">
                <div class="delta-stat-val" style="color:#c084fc">${epiceRange > 0 ? epiceRange : '—'}</div>
                <div class="delta-stat-lbl">épice</div>
            </div>
            <div class="delta-stat">
                <div class="delta-stat-val" style="color:#9ca3af">${semaines}</div>
                <div class="delta-stat-lbl">semaines</div>
            </div>
            <div class="delta-stat">
                <div class="delta-stat-val" style="color:#6b7280">${jours}</div>
                <div class="delta-stat-lbl">jours min.</div>
            </div>
        </div>
        <div class="delta-detail">
            Niv. <b>${from}</b> → <b>${to}</b> en <b>${metier.charAt(0)+metier.slice(1).toLowerCase()}</b>
            &nbsp;·&nbsp; ${prog.xp.toLocaleString()} XP
            &nbsp;·&nbsp; max 35 missions/semaine · max 5/jour
        </div>
    `;
};

// ================================================================
// BARRE D'OUTILS SIMULATEUR
// ================================================================
function injectToolbar() {
    const switcher = document.getElementById("view-switcher");
    if (!switcher) return;
    const t = document.createElement("div");
    t.id = "skills-toolbar";
    t.style.cssText = "text-align:center;margin:4px 0 8px 0;display:flex;flex-wrap:wrap;justify-content:center;gap:8px;padding:0 20px;";

    const btnF = document.createElement("button");
    btnF.id = "btn-landsraad-filter"; btnF.className = "switch-btn";
    btnF.innerHTML = "🏛 Vue Landsraad"; btnF.title = "Filtrer sur les talents Landsraad";
    btnF.onclick = toggleLandsraadFilter;
    t.appendChild(btnF); t.appendChild(makeSep());

    const lbl = document.createElement("span");
    lbl.style.cssText = "color:#888;font-size:11px;align-self:center;font-family:'Cinzel',serif;";
    lbl.textContent = "Builds :";
    t.appendChild(lbl);

    PRESETS.forEach(p => {
        const b = document.createElement("button");
        b.className = "switch-btn preset-btn";
        b.innerHTML = `${p.icon} ${p.label}`; b.title = p.desc;
        b.onclick = () => loadPreset(p);
        t.appendChild(b);
    });

    t.appendChild(makeSep());
    const btnS = document.createElement("button");
    btnS.id = "btn-share"; btnS.className = "switch-btn";
    btnS.innerHTML = "🔗 Copier le lien"; btnS.title = "Partager ce build via URL";
    btnS.onclick = copyShareLink;
    t.appendChild(btnS);

    switcher.insertAdjacentElement('afterend', t);
}
function makeSep() { const s = document.createElement("span"); s.style.cssText = "border-left:1px solid #3b2a16;margin:0 4px;"; return s; }

// ================================================================
// SIMULATEUR
// ================================================================
function toggleSkill(metier, niveau) {
    const items = Array.from(document.querySelectorAll(`.skill-item[data-metier="${metier}"]`));
    const idx = items.findIndex(el => parseInt(el.dataset.niveau) === niveau);
    selectionState[metier] = (selectionState[metier] === niveau) ? (idx > 0 ? parseInt(items[idx-1].dataset.niveau) : 0) : niveau;
    updateDisplay(metier);
    updateURL();
}

window.resetSkills = function() {
    for (let m in selectionState) selectionState[m] = 0;
    ["COMBAT","SABOTAGE","EXPLORATION","RECOLTE","FABRICATION"].forEach(updateDisplay);
    updateURL();
};

function updateDisplay(metier) {
    const items = document.querySelectorAll(`.skill-item[data-metier="${metier}"]`);
    const sel = selectionState[metier];
    let stats = {}, uniques = [], spice = 0;

    items.forEach(el => {
        const n = parseInt(el.dataset.niveau);
        const d = JSON.parse(el.dataset.json);
        const active = d.is_passive ? (sel > 0) : (n > 0 && n <= sel);
        if (active) {
            el.classList.add("active");
            if (!d.is_passive && d.cout_epice) spice += d.cout_epice;
            if (d.stat && d.valeur !== undefined) {
                if (!stats[d.stat]) stats[d.stat] = { val:0, suffix: d.suffixe||"" };
                stats[d.stat].val += d.is_passive ? d.valeur * sel : d.valeur;
            } else if (!d.stat && !uniques.some(u=>u.name===d.talent)) {
                uniques.push({ name: d.talent, desc: d.description });
            }
        } else { el.classList.remove("active"); }
    });

    if (isLandsraadFilter) applyLandsraadFilter();

    const box = document.getElementById(`stats-${metier}`);
    if (!box) return;
    if (sel === 0 && !Object.keys(stats).length) { box.innerHTML = `<div style="color:#666;text-align:center;padding:10px;">Sélectionnez un niveau</div>`; return; }

    const prog = progressionEntre(0, sel);
    let html = `<div class="stat-group"><div class="stat-group-title">Progression vers Niv. ${sel}</div>
        <div class="stat-row tooltip-container">
            <span>📜 Missions nécessaires</span>
            <span class="stat-val" style="color:#d4a23b">${prog.missions}</span>
            <div class="tooltip-text">Nombre de missions Landsraad (125 XP chacune) pour atteindre le niveau ${sel} depuis zéro. Total XP : ${prog.xp.toLocaleString()}.</div>
        </div>
        <div class="stat-row tooltip-container">
            <span>💎 Épice (nœuds keystones)</span>
            <span class="stat-val" style="color:#c084fc">${spice}</span>
            <div class="tooltip-text">Somme des coûts en Épice de tous les nœuds keystones jusqu'au niveau ${sel}.</div>
        </div>
        <div class="stat-row tooltip-container">
            <span>⏱️ Semaines (35 missions/sem.)</span>
            <span class="stat-val" style="color:#9ca3af">${Math.ceil(prog.missions/35)}</span>
            <div class="tooltip-text">Au rythme maximum de 35 missions Landsraad par semaine, nombre de semaines pour atteindre le niveau ${sel}.</div>
        </div>
    </div>`;

    if (Object.keys(stats).length) {
        html += `<div class="stat-group"><div class="stat-group-title">Statistiques Totales</div>`;
        for (let [k,o] of Object.entries(stats)) {
            const cfg = statConfig[k]||{label:k,desc:"—"};
            const col = o.val<0?'#41d37a':'#fff', pre = o.val>0?'+':'';
            html += `<div class="stat-row tooltip-container"><span>${cfg.label}</span><span class="stat-val" style="color:${col}">${pre}${Math.round(o.val*100)/100}${o.suffix}</span><div class="tooltip-text">${cfg.desc}</div></div>`;
        }
        html += `</div>`;
    }
    if (uniques.length) {
        html += `<div class="stat-group"><div class="stat-group-title">Déblocages</div>`;
        uniques.forEach(u => { html += `<div class="tooltip-container" style="color:#aaa;font-size:10px;cursor:help;margin-bottom:2px;"><span>• ${u.name}</span><div class="tooltip-text">${u.desc}</div></div>`; });
        html += `</div>`;
    }
    box.innerHTML = html;
}

// ================================================================
// URL / SHARE / PRESETS / FILTRE
// ================================================================
function updateURL() {
    const p = new URLSearchParams(window.location.search);
    for (const [m,k] of Object.entries(URL_KEYS)) { if (selectionState[m]>0) p.set(k,selectionState[m]); else p.delete(k); }
    history.replaceState(null,'', location.pathname+(p.toString()?'?'+p:''));
}
window.copyShareLink = function() {
    const url = location.href;
    const showFeedback = () => {
        const b = document.getElementById("btn-share"); if(!b) return;
        const o=b.innerHTML; b.innerHTML="✅ Copié !"; b.style.borderColor="#41d37a"; b.style.color="#41d37a";
        setTimeout(()=>{b.innerHTML=o;b.style.borderColor="";b.style.color="";},2000);
    };
    const fallback = () => {
        // Fallback via un élément textarea temporaire (fonctionne en HTTP)
        try {
            const ta = document.createElement("textarea");
            ta.value = url; ta.style.cssText = "position:fixed;opacity:0;";
            document.body.appendChild(ta); ta.select();
            document.execCommand("copy");
            document.body.removeChild(ta);
            showFeedback();
        } catch { prompt("Lien :", url); }
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(showFeedback).catch(fallback);
    } else {
        fallback();
    }
};
window.loadPreset = function(p) {
    for (const [m,l] of Object.entries(p.levels)) selectionState[m]=l;
    ["COMBAT","SABOTAGE","EXPLORATION","RECOLTE","FABRICATION"].forEach(updateDisplay);
    updateURL();
    document.querySelectorAll(".preset-btn").forEach(b=>b.classList.toggle("active", b.innerHTML.includes(p.icon)&&b.innerHTML.includes(p.label)));
};
window.toggleLandsraadFilter = function() {
    isLandsraadFilter = !isLandsraadFilter;
    const b = document.getElementById("btn-landsraad-filter");
    if(b){b.classList.toggle("active",isLandsraadFilter);b.innerHTML=isLandsraadFilter?"🏛 Vue Landsraad ✓":"🏛 Vue Landsraad";}
    applyLandsraadFilter();
};
function applyLandsraadFilter() {
    document.querySelectorAll(".skill-item").forEach(el=>{
        if(isLandsraadFilter){const d=JSON.parse(el.dataset.json);el.style.opacity=d.is_landsraad_favorable?"":"0.18";el.style.filter=d.is_landsraad_favorable?"":"grayscale(1)";}
        else{el.style.opacity="";el.style.filter="";}
    });
}

// ================================================================
// ONGLETS
// ================================================================
window.switchTab = function(tab) {
    const sim=document.getElementById('skills-container'), req=document.getElementById('requests-container');
    const rst=document.getElementById('reset-btn-container'), tb=document.getElementById('skills-toolbar');
    const bs=document.getElementById('btn-simulateur'), br=document.getElementById('btn-requetes');
    if(tab==='simulateur'){
        sim.style.display='flex';req.style.display='none';rst.style.display='block';if(tb)tb.style.display='flex';
        const dp=document.getElementById('delta-panel');if(dp)dp.style.display='block';
        bs.classList.add('active');br.classList.remove('active');
    }else{
        sim.style.display='none';req.style.display='block';rst.style.display='none';if(tb)tb.style.display='none';
        const dp2=document.getElementById('delta-panel');if(dp2)dp2.style.display='none';
        bs.classList.remove('active');br.classList.add('active');loadRequests();
    }
};

// ================================================================
// REQUÊTES — ÉTAT
// ================================================================
const currentUserReq = localStorage.getItem("user");
let allRequests=[], allMapBases=[], isHistoryVisible=false;
const MAX_IMAGES = 4;
let pendingImages = []; // [{name, base64}]

// Compteur de notes
window.updateNotesCounter = function(el) {
    const c=document.getElementById('notes-counter'); if(!c) return;
    const n=el.value.length; c.textContent=`${n} / 400`;
    c.style.color = n>350?'#ff6b6b':n>280?'#d4a23b':'#555';
};

// ================================================================
// GESTION DES IMAGES
// ================================================================
document.addEventListener('paste', function(e) {
    const rc=document.getElementById('requests-container');
    if(!rc||rc.style.display==='none') return;
    const items=(e.clipboardData||e.originalEvent.clipboardData).items;
    for(let i in items){
        const it=items[i];
        if(it.kind==='file'&&it.type.startsWith('image/')){
            if(pendingImages.length>=MAX_IMAGES){showToast(`Maximum ${MAX_IMAGES} captures atteint.`,'warn');return;}
            resizeImage(it.getAsFile(),1280,1280).then(b64=>{
                pendingImages.push({name:"collée.png",base64:b64});
                renderImgPreviews();showToast("📋 Image ajoutée.",'ok');
            });
        }
    }
});

window.handleFileSelect = function(input) {
    const files=Array.from(input.files), rem=MAX_IMAGES-pendingImages.length;
    if(rem<=0){showToast(`Maximum ${MAX_IMAGES} captures atteint.`,'warn');return;}
    const toProcess=files.slice(0,rem);
    if(files.length>rem) showToast(`Seules ${rem} image(s) ajoutée(s) sur ${files.length}.`,'warn');
    Promise.all(toProcess.map(f=>resizeImage(f,1280,1280).then(b64=>({name:f.name,base64:b64})))).then(res=>{
        pendingImages.push(...res);renderImgPreviews();
    });
    input.value="";
};

window.removeImage = function(idx) { pendingImages.splice(idx,1); renderImgPreviews(); };

function renderImgPreviews() {
    const zone=document.getElementById('img-preview-zone');
    const span=document.getElementById('file-name');
    if(span){ span.textContent=pendingImages.length?`${pendingImages.length} capture(s) prête(s)`:''; span.style.color=pendingImages.length?'#41d37a':'#aaa'; }
    if(!zone) return;
    zone.innerHTML=pendingImages.map((img,i)=>`
        <div class="img-thumb-wrap">
            <img src="${img.base64}" class="img-thumb" onclick="openImageModal(this.src)" title="${img.name}">
            <button class="img-thumb-remove" onclick="removeImage(${i})" title="Retirer">×</button>
        </div>`).join('');
}

// ================================================================
// TOAST
// ================================================================
function showToast(msg,type='ok') {
    let t=document.getElementById('craft-toast');
    if(!t){t=document.createElement('div');t.id='craft-toast';t.style.cssText='position:fixed;bottom:60px;left:50%;transform:translateX(-50%);padding:8px 18px;border-radius:6px;font-size:12px;font-weight:bold;z-index:9999;transition:opacity 0.4s;pointer-events:none;';document.body.appendChild(t);}
    t.textContent=msg;t.style.background=type==='ok'?'rgba(65,211,122,0.9)':'rgba(255,107,107,0.9)';t.style.color=type==='ok'?'#000':'#fff';t.style.opacity='1';
    clearTimeout(t._t);t._t=setTimeout(()=>t.style.opacity='0',2500);
}

// ================================================================
// SOUMETTRE
// ================================================================
window.submitRequest = async function() {
    const type  = document.getElementById('request-type').value;
    const notes = document.getElementById('request-notes').value;
    const btn   = document.querySelector('.btn-submit');
    if (!type) return alert("Sélectionnez un type de demande.");

    btn.innerText = "Envoi...";
    btn.disabled  = true;

    try {
        const res = await fetch("save.php", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                action : "addRequete",
                user   : currentUserReq,
                type,
                notes,
                images : pendingImages.map(i => i.base64)
            })
        });

        // Lire la réponse brute d'abord — si PHP a crashé, ce sera du HTML
        const rawText = await res.text();
        let r;
        try {
            r = JSON.parse(rawText);
        } catch (parseErr) {
            // PHP a retourné autre chose que du JSON (erreur PHP, warning, 500...)
            console.error("⚠️ Réponse PHP non-JSON (HTTP " + res.status + ") :", rawText);
            alert(
                "Erreur serveur — PHP n'a pas retourné de JSON valide.\n" +
                "HTTP " + res.status + "\n\n" +
                "Ouvrez la console (F12) pour voir la réponse complète.\n\n" +
                "Extrait : " + rawText.substring(0, 300)
            );
            return;
        }

        if (r.ok) {
            document.getElementById('request-type').value     = "";
            document.getElementById('request-notes').value    = "";
            document.getElementById('file-name').textContent  = "";
            document.getElementById('notes-counter').textContent = "0 / 400";
            pendingImages = [];
            renderImgPreviews();
            loadRequests();
            showToast("✅ Demande postée !", 'ok');
        } else {
            alert("Erreur serveur : " + r.error);
        }

    } catch (networkErr) {
        // Vrai problème réseau (serveur injoignable, CORS, timeout...)
        console.error("❌ Erreur réseau submitRequest :", networkErr);
        alert("Erreur réseau : " + networkErr.message);
    } finally {
        btn.innerText = "Poster la demande";
        btn.disabled  = false;
    }
};

// ================================================================
// CHARGEMENT & RENDU REQUÊTES
// ================================================================
async function loadRequests() {
    try {
        const r1=await fetch("save.php",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"getRequetes"})});
        allRequests=await r1.json();
        const r2=await fetch("bases.json?ts="+Date.now());
        if(r2.ok) allMapBases=await r2.json();
        renderRequestsTab();
    }catch(e){console.error(e);}
}

function renderRequestsTab() {
    const la=document.getElementById('requests-list'),lh=document.getElementById('history-list');
    la.innerHTML="";lh.innerHTML="";
    if(!allRequests||!allRequests.length){la.innerHTML="<p style='text-align:center;color:#aaa;'>Aucune demande enregistrée.</p>";return;}
    const active=allRequests.filter(r=>r.status!=='done'), done=allRequests.filter(r=>r.status==='done');
    if(!active.length) la.innerHTML="<p style='text-align:center;color:#aaa;font-style:italic;'>Toutes les demandes ont été traitées.</p>";
    else active.forEach(r=>la.appendChild(createReqCard(r)));
    if(!done.length) lh.innerHTML="<p style='text-align:center;color:#aaa;'>Aucun historique.</p>";
    else done.forEach(r=>lh.appendChild(createReqCard(r)));
}

// ================================================================
// CARTE REQUÊTE — rétrocompatible image (string) + images (array)
// ================================================================
function createReqCard(req) {
    const card=document.createElement('div');
    card.className=`req-card status-${req.status}`;

    // Normalisation images : ancien format image (string) ou nouveau images (array)
    const imgs=Array.isArray(req.images)&&req.images.length ? req.images : (req.image?[req.image]:[]);
    const imgsHtml=imgs.length ? `<div class="req-images-row">${imgs.map(s=>`<img src="${s}" class="req-image" onclick="openImageModal(this.src)" title="Agrandir">`).join('')}</div>` : '';

    let info=`<div class="req-info">
        <span>👤 <span class="req-player">${req.player}</span></span>
        <span class="req-type">${req.type}</span>
        ${req.notes?`<span class="req-notes">📝 ${req.notes}</span>`:''}
        ${imgsHtml}
        ${req.crafterAssigned?`<span style="font-size:.85em;color:#3b82f6;margin-top:5px;">🛠️ Pris en charge par : ${req.crafterAssigned}</span>`:''}
    </div>`;

    let actions=`<div class="req-actions">`;
    if(req.player===currentUserReq) actions+=`<button class="btn-action" style="background:#a83b3b;color:#fff;padding:6px 10px;" onclick="deleteRequest('${req.id}')" title="Supprimer">🗑️</button>`;
    const hasBase=allMapBases.some(b=>b.user===req.player);
    actions+=hasBase?`<a href="map.html?focus=${encodeURIComponent(req.player)}" class="btn-action btn-map">🗺️ Voir Base</a>`:`<span class="btn-action" style="background:#333;color:#777;border:1px solid #444;cursor:help;" title="Pas de base renseignée">🚫 Pas de base</span>`;
    if(req.status!=='done'){
        if(req.status==='pending') actions+=`<button class="btn-action btn-take" onclick="updateReqStatus('${req.id}','progress')">Prendre en charge</button>`;
        else if(req.status==='progress'&&req.crafterAssigned===currentUserReq) actions+=`<button class="btn-action btn-done" onclick="updateReqStatus('${req.id}','done')">Marquer Terminé</button>`;
    }else actions+=`<span style="color:#41d37a;font-weight:bold;align-self:center;">✔️ Fait</span>`;
    actions+=`</div>`;

    card.innerHTML=info+actions;return card;
}

// ================================================================
// MODAL IMAGE HD
// ================================================================
window.openImageModal = function(src) { document.getElementById('modal-image-hd').src=src; document.getElementById('image-modal-overlay').style.display='flex'; };
window.closeImageModal = function() { document.getElementById('image-modal-overlay').style.display='none'; };

// ================================================================
// HISTORIQUE / STATUT / SUPPRESSION
// ================================================================
window.toggleHistory = function() {
    isHistoryVisible=!isHistoryVisible;
    document.getElementById('history-list').style.display=isHistoryVisible?"block":"none";
    document.getElementById('btn-history').innerText=isHistoryVisible?"Masquer l'historique":"Voir l'historique des services terminés";
};
window.updateReqStatus = async function(id,status) {
    try{const r=await fetch("save.php",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"updateRequete",id,status,crafter:currentUserReq})});const d=await r.json();if(d.ok)loadRequests();else alert("Erreur : "+d.error);}catch{alert("Erreur réseau.");}
};
window.deleteRequest = async function(id) {
    if(!confirm("Supprimer cette demande ?")) return;
    try{const r=await fetch("save.php",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"deleteRequete",id})});const d=await r.json();if(d.ok)loadRequests();else alert("Erreur : "+d.error);}catch{alert("Erreur réseau.");}
};

// ================================================================
// COMPRESSION IMAGE
// ================================================================
function resizeImage(file,maxW,maxH) {
    return new Promise((res,rej)=>{
        const rd=new FileReader();rd.readAsDataURL(file);
        rd.onload=e=>{const img=new Image();img.src=e.target.result;img.onload=()=>{
            let w=img.width,h=img.height;
            if(w>h){if(w>maxW){h=Math.round(h*maxW/w);w=maxW;}}else{if(h>maxH){w=Math.round(w*maxH/h);h=maxH;}}
            const cv=document.createElement('canvas');cv.width=w;cv.height=h;
            cv.getContext('2d').drawImage(img,0,0,w,h);res(cv.toDataURL('image/jpeg',.8));
        };img.onerror=rej;};rd.onerror=rej;
    });
}

// Compat ancienne fonction HTML (si encore référencée)
window.previewImage = function(input) { handleFileSelect(input); };
