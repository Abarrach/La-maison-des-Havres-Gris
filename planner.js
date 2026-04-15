let questsData = [];
let participants = [];
let syncInterval = null;
let lastActionTime = 0; // Marqueur de temps

// ==========================================
// 1. INITIALISATION
// ==========================================

fetch('landsraad_data.json')
    .then(r => r.json())
    .then(data => {
        questsData = data.quests;
        displayAllQuests();
        startSync();
    })
    .catch(e => console.error("Erreur JSON:", e));

function startSync() {
    // Premier chargement immédiat
    loadParticipantsFromServer();
    // Puis toutes les 2 secondes
    syncInterval = setInterval(loadParticipantsFromServer, 2000);
}

function loadParticipantsFromServer() {
    // SÉCURITÉ 1 : "Délai de grâce"
    // Si on a touché à la liste il y a moins de 5 secondes, on ne lit pas le serveur
    if (Date.now() - lastActionTime < 5000) {
        return; 
    }

    // SÉCURITÉ 2 : "Anti-Cache" (?t=timestamp)
    fetch('api.php?t=' + Date.now())
        .then(r => r.json())
        .then(serverData => {
            // SÉCURITÉ 3 : "Priorité Locale"
            // Si on a plus de joueurs en local que sur le serveur, c'est qu'on est en train de saisir.
            // On ignore la mise à jour serveur qui est sûrement en retard.
            if (participants.length > serverData.length && (Date.now() - lastActionTime < 10000)) {
                console.log("Ignoré: Serveur en retard sur le local");
                return;
            }

            // Si les données sont vraiment différentes, on met à jour
            if (JSON.stringify(serverData) !== JSON.stringify(participants)) {
                participants = serverData;
                updateUI();
                clearResults(); // Si la liste change, on efface les groupes obsolètes
            }
        })
        .catch(e => console.error("Erreur Sync:", e));
}

function saveParticipantsToServer() {
    // On note qu'on vient de faire une action
    lastActionTime = Date.now();

    fetch('api.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(participants)
    })
    .catch(e => console.error("Erreur Save:", e));
}

// ==========================================
// 2. GESTION DE L'INTERFACE
// ==========================================

function clearResults() {
    const results = document.getElementById('results-area');
    const stats = document.getElementById('stats-area');
    if (results) results.innerHTML = '';
    if (stats) stats.innerHTML = '';
}

// --- POPUPS ---
function showCustomConfirm(title, message, onConfirm) {
    const overlay = document.getElementById('custom-modal-overlay');
    const titleDiv = document.getElementById('modal-title');
    const msgDiv = document.getElementById('modal-message');
    const btnConfirm = document.getElementById('modal-btn-confirm');
    const btnCancel = document.getElementById('modal-btn-cancel');

    titleDiv.innerText = title;
    msgDiv.innerHTML = message;
    overlay.style.display = 'flex';
    btnCancel.style.display = 'block';

    let newBtnConfirm = btnConfirm.cloneNode(true);
    btnConfirm.parentNode.replaceChild(newBtnConfirm, btnConfirm);
    let newBtnCancel = btnCancel.cloneNode(true);
    btnCancel.parentNode.replaceChild(newBtnCancel, btnCancel);

    newBtnConfirm.addEventListener('click', function() {
        overlay.style.display = 'none';
        onConfirm();
    });
    newBtnCancel.addEventListener('click', function() { overlay.style.display = 'none'; });
}

function showCustomAlert(title, message) {
    const overlay = document.getElementById('custom-modal-overlay');
    const titleDiv = document.getElementById('modal-title');
    const msgDiv = document.getElementById('modal-message');
    const btnConfirm = document.getElementById('modal-btn-confirm');
    const btnCancel = document.getElementById('modal-btn-cancel');

    titleDiv.innerText = title;
    msgDiv.innerText = message;
    overlay.style.display = 'flex';
    btnCancel.style.display = 'none'; 
    
    let newBtnConfirm = btnConfirm.cloneNode(true);
    btnConfirm.parentNode.replaceChild(newBtnConfirm, btnConfirm);
    newBtnConfirm.innerText = "OK";
    newBtnConfirm.addEventListener('click', function() { 
        overlay.style.display = 'none'; 
        newBtnConfirm.innerText = "Confirmer";
    });
}

// --- ACTIONS ---

function resetAll() {
    showCustomConfirm(
        "⚠️ NOUVELLE SOIRÉE", 
        "Vous allez effacer TOUTE la liste pour TOUT LE MONDE.<br><br>Êtes-vous sûr de vouloir tout remettre à zéro ?", 
        function() {
            participants = [];
            saveParticipantsToServer();
            updateUI();
            clearResults();
        }
    );
}

function removePlayer(index) {
    let playerToRemove = participants[index];
    showCustomConfirm(
        "SUPPRESSION", 
        `Retirer <strong>${playerToRemove.name}</strong> de la liste ?`, 
        function() {
            participants.splice(index, 1);
            saveParticipantsToServer();
            updateUI();
            clearResults();
        }
    );
}

function addPlayer() {
    const name = document.getElementById('playerName').value.trim();
    const role = document.getElementById('playerRole').value;
    
    if (!name) return showCustomAlert("ERREUR", "Veuillez entrer un nom !");

    let playerQuests = [];
    if (role === 'quester') {
        const checked = document.querySelectorAll('#checkboxContainer input:checked');
        if (checked.length === 0) return showCustomAlert("ATTENTION", "Sélectionnez au moins une quête ou passez en mode Support.");
        checked.forEach(cb => {
            const q = questsData.find(quest => quest.id == cb.value);
            if (q) playerQuests.push(q);
        });
    }

    // AJOUT LOCAL
    participants.push({ name: name, role: role, quests: playerQuests });
    
    // SAUVEGARDE ET BLOCAGE SYNC
    saveParticipantsToServer(); 
    updateUI();
    clearResults(); // On force le reset des groupes
    
    // Reset formulaire
    document.getElementById('playerName').value = ''; 
    document.querySelectorAll('input[name="questCheck"]').forEach(cb => cb.checked = false);
    document.getElementById('selectedCount').innerText = "0/5";
}

// --- UI DISPLAY ---
function displayAllQuests() {
    const container = document.getElementById('checkboxContainer');
    container.innerHTML = '';
    const categories = ["Combat", "Sabotage", "Récolte", "Exploration", "Artisanat"];

    categories.forEach(cat => {
        const catQuests = questsData.filter(q => {
            if (cat === "Récolte") return ["Récolte", "Recolte", "Rassemblement"].includes(q.type);
            return q.type === cat;
        });
        
        if (catQuests.length > 0) {
            const header = document.createElement('div');
            header.className = 'category-header';
            header.innerText = cat;
            container.appendChild(header);

            catQuests.forEach(q => {
                const div = document.createElement('div');
                div.className = 'quest-item';
                div.innerHTML = `<input type="checkbox" value="${q.id}" id="q_${q.id}" name="questCheck"><label for="q_${q.id}" style="display:inline; color:#ccc; cursor:pointer;">${q.name} <span style="color:#666; font-size:0.8em; margin-left:5px; background:#222; padding:0 4px; border-radius:3px;">${q.zone}</span></label>`;
                container.appendChild(div);
            });
        }
    });
    
    container.querySelectorAll('input[name="questCheck"]').forEach(cb => {
        cb.addEventListener('change', updateSelectionCount);
    });
}

function updateSelectionCount() {
    const checked = document.querySelectorAll('input[name="questCheck"]:checked');
    document.getElementById('selectedCount').innerText = `${checked.length}/5`;
    if (checked.length > 5) { 
        showCustomAlert("LIMITE", "Maximum 5 quêtes !");
        this.checked = false; 
        document.getElementById('selectedCount').innerText = `5/5`; 
    }
}

function toggleQuests() {
    const role = document.getElementById('playerRole').value;
    const area = document.getElementById('questSelectionArea');
    if (role === 'support') {
        area.style.opacity = '0.3';
        area.style.pointerEvents = 'none';
    } else {
        area.style.opacity = '1';
        area.style.pointerEvents = 'auto';
    }
}

function updateUI() {
    const list = document.getElementById('participantsList');
    list.innerHTML = '';
    
    if (participants.length === 0) {
        list.innerHTML = '<li style="color:#666; font-style:italic;">Aucun participant inscrit...</li>';
        document.getElementById('count').innerText = '0';
        return;
    }

    participants.forEach((p, index) => {
        const li = document.createElement('li');
        li.className = 'participant-row';
        
        let tooltipHtml = (p.quests && p.quests.length > 0) 
            ? p.quests.map(q => `<div style="display:flex; justify-content:space-between; margin-bottom:3px;"><span style="color:#cda434;">[${q.type}]</span> <span style="color:#fff;">${q.zone}</span></div><div style="font-size:0.9em; color:#aaa; margin-bottom:5px; padding-left:10px;">↳ ${q.name}</div>`).join('')
            : "<em>Rôle : Soutien pur</em>";

        let icon = p.role === 'quester' ? '⚔️' : '🛡️';
        let color = p.role === 'quester' ? '#fff' : '#3498db'; 
        
        li.innerHTML = `
            <div class="tooltip-wrapper">
                <strong style="color:${color};">${p.name}</strong> 
                <span style="font-size:0.8em; color:#888; margin-left:10px;">${icon} ${p.role === 'quester' ? p.quests.length + ' obj.' : 'Support'}</span>
                <div class="tooltip-content">
                    <div style="border-bottom:1px solid #cda434; margin-bottom:5px; color:#cda434; font-weight:bold;">${p.name}</div>
                    ${tooltipHtml}
                </div>
            </div>
            <button class="btn-delete" onclick="removePlayer(${index})" title="Supprimer ce joueur">✖</button>
            `;
        list.appendChild(li);
    });
    document.getElementById('count').innerText = participants.length;
}

// ==========================================
// 4. MOTEUR DE GROUPE
// ==========================================

function calculateGroups() {
    clearResults(); // Nettoyage visuel avant recalcul

    if (participants.length === 0) return showCustomAlert("VIDE", "Aucun participant à trier !");

    // Copie propre pour le tri
    let questers = participants.filter(p => p.role === 'quester').sort((a, b) => b.quests.length - a.quests.length);
    let supports = participants.filter(p => p.role === 'support');
    let groups = [];

    // Phase 1 : Actifs
    questers.forEach(player => {
        let bestGroupIndex = -1;
        let bestOverlap = -1;
        for (let i = 0; i < groups.length; i++) {
            let g = groups[i];
            if (g.members.filter(m => m.role === 'quester').length >= 2) continue; 
            
            let groupZones = new Set();
            g.members.forEach(m => m.quests.forEach(q => groupZones.add(q.zone)));
            let overlap = 0;
            player.quests.forEach(q => { if(groupZones.has(q.zone)) overlap++; });

            if (overlap > bestOverlap) { bestOverlap = overlap; bestGroupIndex = i; }
        }
        if (bestGroupIndex !== -1 && bestOverlap >= 0) {
            groups[bestGroupIndex].members.push(player);
        } else {
            groups.push({ members: [player] });
        }
    });

    // Phase 2 : Supports
    while (supports.length > 0) {
        groups.sort((a, b) => a.members.length - b.members.length);
        groups[0].members.push(supports.pop());
    }

    groups.forEach((g, index) => displayGroupV8(index + 1, g.members));
    generateSummary(groups);
    document.getElementById('results-area').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function sortZonesByActivity(members) {
    let zoneActivityScore = {}; 
    let uniqueZones = new Set();
    members.forEach(m => {
        if(m.quests) {
            m.quests.forEach(q => {
                uniqueZones.add(q.zone);
                zoneActivityScore[q.zone] = (zoneActivityScore[q.zone] || 0) + 1;
            });
        }
    });
    if (uniqueZones.size === 0) return ["Zone Libre"];
    return Array.from(uniqueZones).sort((a, b) => (zoneActivityScore[b] || 0) - (zoneActivityScore[a] || 0));
}

function displayGroupV8(num, members) {
    const div = document.createElement('div');
    div.className = 'group-card';
    
    let sortedZones = sortZonesByActivity(members);
    let membersListTooltip = members.map(m => {
        let ico = m.role === 'quester' ? '⚔️' : '🛡️';
        let col = m.role === 'quester' ? '#fff' : '#3498db';
        return `<div style="margin-bottom:3px; color:${col};">${ico} <strong>${m.name}</strong></div>`;
    }).join("");

    let contentHtml = `
        <h3 style="margin-top:0; border-bottom:1px solid #5a4a2a; padding-bottom:5px;">
            <div class="tooltip-wrapper">
                GROUPE ${num}
                <div class="tooltip-content">
                    <div style="color:#cda434; margin-bottom:5px; border-bottom:1px solid #555;">Composition :</div>
                    ${membersListTooltip}
                </div>
            </div>
            <span style="font-size:0.6em; float:right; font-weight:normal; color:#aaa; margin-top:5px;">${members.length} membres</span>
        </h3>
    `;

    sortedZones.forEach(zone => {
        contentHtml += `<div class="zone-subblock"><div class="zone-title">📍 ${zone}</div><ul style="padding-left:0; list-style:none; margin:0;">`;
        let anyoneActiveHere = false;
        
        members.forEach(m => {
            let questsHere = (m.quests || []).filter(q => q.zone === zone);
            if (questsHere.length > 0) {
                anyoneActiveHere = true;
                let qNames = questsHere.map(q => `↳ ${q.name}`).join("<br>");
                contentHtml += `<li style="color:#fff; font-size:0.9em; margin-bottom:8px; padding-left:8px; border-left:2px solid #cda434; background:rgba(205, 164, 52, 0.1);"><div style="font-weight:bold; color:#eac154;">⚔️ ${m.name} <span style="font-size:0.8em; color:#d35400;">(Actif)</span></div><div style="color:#bbb; font-size:0.85em; padding-left:5px;">${qNames}</div></li>`;
            }
        });
        
        if (anyoneActiveHere) {
             members.forEach(m => {
                let questsHere = (m.quests || []).filter(q => q.zone === zone);
                if (questsHere.length === 0) {
                    let roleLabel = (m.role === 'support') ? "🛡️ Soutien" : "⚔️ (En attente)";
                    let col = (m.role === 'support') ? "#3498db" : "#777";
                    contentHtml += `<li style="color:${col}; font-size:0.85em; padding-left:10px;">${m.name} : ${roleLabel}</li>`;
                }
             });
        } else {
            contentHtml += `<li style="color:#666; font-style:italic; padding-left:10px;">Transit ou repli.</li>`;
        }
        contentHtml += `</ul></div>`;
    });

    div.innerHTML = contentHtml;
    document.getElementById('results-area').appendChild(div);
}

function generateSummary(groups) {
    const container = document.getElementById('stats-area');
    let html = `<h2 style="font-size:1.2em; display:flex; align-items:center;">📊 Bilan de la Soirée</h2>
    <table class="summary-table">
        <thead>
            <tr>
                <th>JOUEUR</th>
                <th style="text-align:center">QUÊTES VALIDÉES</th>
                <th style="text-align:center">VRAI SOUTIEN</th>
                <th style="text-align:center">ACTIVITÉ TOTALE</th>
            </tr>
        </thead>
        <tbody>`;

    participants.forEach(p => {
        let myGroup = groups.find(g => g.members.includes(p));
        let realQuestsValidated = 0;
        let realSupport = 0;
        let pendingQuests = (p.quests || []).length;

        if (myGroup) {
            let sortedZones = sortZonesByActivity(myGroup.members);
            sortedZones.forEach(zone => {
                let questsHere = (p.quests || []).filter(q => q.zone === zone).length;
                if (questsHere > 0) {
                    realQuestsValidated += questsHere;
                    pendingQuests -= questsHere;
                } else {
                    if (pendingQuests <= 0) realSupport++;
                }
            });
        }

        html += `<tr>
            <td><strong style="color:${p.role==='quester'?'#fff':'#3498db'}">${p.name}</strong></td>
            <td style="text-align:center"><span class="stat-badge bg-quest">${realQuestsValidated}</span></td>
            <td style="text-align:center"><span class="stat-badge bg-support">${realSupport}</span></td>
            <td style="text-align:center; font-weight:bold; color:#ccc;">${realQuestsValidated + realSupport}</td>
        </tr>`;
    });

    html += `</tbody></table>
    <div style="text-align:center; margin-top:10px; color:#666; font-style:italic; font-size:0.8em;">
        * Les zones sont triées par priorité. Le soutien ne compte qu'une fois vos propres quêtes terminées.
    </div>`;
    
    container.innerHTML = html;
}