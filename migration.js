const SIETCHS = [
  'Sietch Abbir', 'Sietch Alraab', 'Sietch Barkan', 'Sietch Coanua', 'Sietch Fajr',
  'Sietch Gara Kulon', 'Sietch Hajar', 'Sietch Jacurutu', 'Sietch Kathib', 'Sietch Legg',
  'Sietch Makab', 'Sietch Nadir', 'Sietch Ramal', 'Sietch Rifana', 'Sietch Sandrat',
  'Sietch Saajid', 'Sietch Tabr', 'Sietch Tharwa', 'Sietch Umbu', 'Sietch Yaracuwan'
];

let map;
let currentCoords = null;
let reservations = [];
let markersLayer = L.layerGroup();
let ghostLayer   = L.layerGroup();
let currentSietch = null;
let ghostProjections = [];

const bounds = [[0, 0], [2556, 2556]];
const mapImage = "map.jpg";

document.addEventListener("DOMContentLoaded", () => {
    populateSietchSelect();

    map = L.map("map", { crs: L.CRS.Simple, minZoom: -2, maxZoom: 2, zoomControl: false, attributionControl: false });
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    L.imageOverlay(mapImage, bounds).addTo(map);
    map.fitBounds(bounds);
    ghostLayer.addTo(map);
    markersLayer.addTo(map);


    map.on('click', function(e) {
        currentCoords = e.latlng;
        document.getElementById('modal-title-text').innerText = "Placer un marqueur";
        document.getElementById('res-sietch').value = currentSietch || SIETCHS[0];
        document.getElementById('reservation-modal').style.display = 'flex';
        document.getElementById('res-pseudo').focus();
    });

    loadReservations();
    loadGhostProjections();
    setInterval(loadReservations, 5000);
    setInterval(loadGhostProjections, 10000);
});

function populateSietchSelect() {
    const sel = document.getElementById('res-sietch');
    if (!sel) return;
    sel.innerHTML = SIETCHS.map(s => `<option value="${s}">${s}</option>`).join('');
}

// === MODALES PERSONNALISÉES ===
function showCustomConfirm(title, message, onConfirm) {
    const overlay = document.getElementById('custom-modal-overlay');
    const titleEl = document.getElementById('generic-modal-title');
    const msgEl = document.getElementById('generic-modal-message');
    const inputEl = document.getElementById('generic-modal-input');
    const btnConf = document.getElementById('generic-modal-btn-confirm');
    const btnCanc = document.getElementById('generic-modal-btn-cancel');

    titleEl.innerText = title;
    msgEl.innerHTML = message;
    msgEl.style.display = 'block';
    inputEl.style.display = 'none';
    overlay.style.display = 'flex';

    const newBtnConf = btnConf.cloneNode(true);
    btnConf.parentNode.replaceChild(newBtnConf, btnConf);
    const newBtnCanc = btnCanc.cloneNode(true);
    btnCanc.parentNode.replaceChild(newBtnCanc, btnCanc);

    if (onConfirm) {
        newBtnCanc.style.display = "block";
        newBtnConf.addEventListener('click', () => { overlay.style.display = 'none'; onConfirm(); });
    } else {
        newBtnCanc.style.display = "none";
        newBtnConf.innerText = "OK";
        newBtnConf.addEventListener('click', () => { overlay.style.display = 'none'; });
    }
    newBtnCanc.addEventListener('click', () => { overlay.style.display = 'none'; });
}

function showCustomPrompt(title, message, placeholder, onConfirm) {
    const overlay = document.getElementById('custom-modal-overlay');
    const titleEl = document.getElementById('generic-modal-title');
    const msgEl = document.getElementById('generic-modal-message');
    const inputEl = document.getElementById('generic-modal-input');
    const btnConf = document.getElementById('generic-modal-btn-confirm');
    const btnCanc = document.getElementById('generic-modal-btn-cancel');

    titleEl.innerText = title;
    msgEl.innerHTML = message;
    msgEl.style.display = 'block';
    inputEl.style.display = 'block';
    inputEl.value = "";
    inputEl.placeholder = placeholder || "Votre texte...";
    overlay.style.display = 'flex';
    inputEl.focus();

    const newBtnConf = btnConf.cloneNode(true);
    btnConf.parentNode.replaceChild(newBtnConf, btnConf);
    const newBtnCanc = btnCanc.cloneNode(true);
    btnCanc.parentNode.replaceChild(newBtnCanc, btnCanc);

    newBtnCanc.style.display = "block";
    newBtnConf.innerText = "Confirmer";

    newBtnConf.addEventListener('click', () => {
        const val = inputEl.value.trim();
        overlay.style.display = 'none';
        if (onConfirm) onConfirm(val);
    });
    newBtnCanc.addEventListener('click', () => { overlay.style.display = 'none'; });
    inputEl.onkeydown = function(e) { if (e.key === 'Enter') newBtnConf.click(); };
}

// === FILTRE SIETCH ===
function renderSietchFilterButtons() {
    const bar = document.getElementById('sietch-filter-bar');
    if (!bar) return;

    const sietchsPresents = [...new Set(
        reservations.filter(r => r.sietch).map(r => r.sietch)
    )].sort();

    bar.innerHTML = `<button class="sietch-filter-btn all-btn${!currentSietch ? ' active' : ''}" data-sietch="">Tous (${reservations.length})</button>`;

    sietchsPresents.forEach(sietch => {
        const count = reservations.filter(r => r.sietch === sietch).length;
        const shortName = sietch.replace('Sietch ', '');
        const active = currentSietch === sietch ? ' active' : '';
        bar.innerHTML += `<button class="sietch-filter-btn${active}" data-sietch="${sietch}">${shortName} (${count})</button>`;
    });

    bar.querySelectorAll('.sietch-filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            currentSietch = btn.dataset.sietch || null;
            renderSietchFilterButtons();
            renderMarkers();
            renderSideLists();
        });
    });
}

// === ACTIONS ===
function closeModal() {
    document.getElementById('reservation-modal').style.display = 'none';
    currentCoords = null;
    document.getElementById('res-pseudo').value = '';
    document.getElementById('res-sietch').value = currentSietch || SIETCHS[0];
    document.getElementById('res-type').value = 'souhait';
    document.getElementById('res-dispo').value = 'dispo_seul';
}

window.editReservation = function(pseudo, sietch, type, dispo, lat, lng) {
    currentCoords = { lat: lat, lng: lng };
    document.getElementById('modal-title-text').innerText = "Modifier ce marqueur";
    document.getElementById('res-pseudo').value = pseudo;
    document.getElementById('res-sietch').value = sietch || SIETCHS[0];
    document.getElementById('res-type').value = type;
    document.getElementById('res-dispo').value = dispo;
    document.getElementById('reservation-modal').style.display = 'flex';
    map.closePopup();
};

function saveReservation() {
    const pseudo = document.getElementById('res-pseudo').value.trim();
    const sietch = document.getElementById('res-sietch').value;
    const type = document.getElementById('res-type').value;
    const dispo = document.getElementById('res-dispo').value;

    if (!pseudo) {
        showCustomConfirm("ERREUR", "Le pseudo est obligatoire !", null);
        return;
    }

    const data = { pseudo, lat: currentCoords.lat, lng: currentCoords.lng, type, dispo, sietch };

    fetch('migration_api.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    })
    .then(res => res.json())
    .then(result => {
        if (result.status === 'error') {
            showCustomConfirm("ERREUR SERVEUR", result.message || "Erreur inconnue", null);
            return;
        }
        closeModal();
        loadReservations();
    })
    .catch(err => {
        showCustomConfirm("ERREUR", "Impossible de joindre migration_api.php.<br><small>" + err + "</small>", null);
    });
}

window.deleteReservation = function(id) {
    showCustomConfirm("SUPPRESSION", "Voulez-vous vraiment supprimer ce marqueur ?", () => {
        fetch('migration_api.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'delete', id: id })
        }).then(res => res.json()).then(loadReservations);
    });
};

// === Offrir un fief ===
window.offerFief = function(helpeePseudo) {
    showCustomPrompt(
        "OFFRIR UN FIEF",
        `Vous allez offrir un fief à <strong style="color:#f3c44f;">${helpeePseudo}</strong>.<br>Entrez VOTRE pseudo ci-dessous :`,
        "Ex: Paul",
        (helper) => {
            if (!helper) return;
            helper = helper.trim();

            let helperData = reservations.find(r => r.pseudo.toLowerCase() === helper.toLowerCase());

            if (helperData) {
                if (helperData.dispo !== 'dispo_aide') {
                    showCustomConfirm("ACTION REFUSÉE", "Votre base indique que vous n'avez pas de fief libre !<br><br>Modifiez d'abord votre marqueur en choisissant : <strong style='color:#5bc0de;'>Présent ET j'ai de la place</strong>.", null);
                    return;
                }
                if (helperData.covering) {
                    showCustomConfirm("ACTION REFUSÉE", `Vous couvrez déjà <strong>${helperData.covering}</strong> !`, null);
                    return;
                }
            }

            fetch('migration_api.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'cover', helper: helper, helpee: helpeePseudo })
            }).then(res => res.json()).then(data => {
                if (data.status === 'error') showCustomConfirm("ERREUR", data.message, null);
                else loadReservations();
            });
        }
    );
};

// === Annuler l'aide ===
window.cancelOffer = function(helpeePseudo) {
    showCustomConfirm(
        "ANNULER L'AIDE",
        `Voulez-vous annuler l'aide apportée à <strong style="color:#f3c44f;">${helpeePseudo}</strong> ?<br><br><span style="font-size:12px; color:#888;">Il retournera dans la liste des personnes ayant besoin d'un fief.</span>`,
        () => {
            fetch('migration_api.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'uncover', helpee: helpeePseudo })
            }).then(res => res.json()).then(loadReservations);
        }
    );
};

// === CHARGEMENT & RENDU ===
function loadReservations() {
    fetch('migration_api.php')
        .then(res => res.json())
        .then(data => {
            if (JSON.stringify(data) !== JSON.stringify(reservations)) {
                reservations = data;
                renderSietchFilterButtons();
                renderMarkers();
                renderSideLists();
            }
        });
}

function createSvgMarker(color, glowColor) {
    return `
        <div style="filter: drop-shadow(0 0 8px ${glowColor});">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="36" height="36">
                <path fill="${color}" stroke="#ffffff" stroke-width="1.5" d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
            </svg>
        </div>
    `;
}

function getVisible() {
    return currentSietch
        ? reservations.filter(r => r.sietch === currentSietch)
        : reservations;
}

function renderSideLists() {
    const helpContainer = document.getElementById('help-list-content');
    const offerContainer = document.getElementById('offer-list-content');
    if (!helpContainer || !offerContainer) return;

    const visible = getVisible();
    const needingHelp = visible.filter(r => r.dispo === 'absent');

    if (needingHelp.length === 0) {
        helpContainer.innerHTML = "<div style='font-style:italic; color:#888; padding:5px; text-align:center;'>Aucune demande.</div>";
    } else {
        let html = "";
        needingHelp.forEach(res => {
            let safePseudo = res.pseudo.replace(/'/g, "\\'");
            const sietchBadge = res.sietch ? `<span class="sietch-badge">${res.sietch.replace('Sietch ', '')}</span>` : '';

            if (res.coveredBy) {
                html += `
                    <div class="help-item" style="border-left: 3px solid #41d37a; opacity:0.8; padding:8px;">
                        <div onclick="focusOnMarker(${res.lat}, ${res.lng})">
                            <strong style="color:#41d37a; font-size:14px; text-decoration:line-through;">${res.pseudo}</strong>${sietchBadge}<br>
                            <span style="font-size:11px; color:#aaa;">Couvert par ${res.coveredBy} ✅</span>
                        </div>
                        <button onclick="cancelOffer('${safePseudo}')" style="margin-top:8px; width:100%; background:#555; color:#fff; border:none; padding:4px 0; font-size:10px; border-radius:3px; cursor:pointer;">Annuler l'aide</button>
                    </div>
                `;
            } else {
                html += `
                    <div class="help-item" style="border-left: 3px solid #ff6b6b; padding:8px;">
                        <div onclick="focusOnMarker(${res.lat}, ${res.lng})">
                            <strong style="color:#ff6b6b; font-size:14px;">${res.pseudo}</strong>${sietchBadge}<br>
                            <span style="font-size:11px; color:#aaa;">Besoin d'un sous-fief</span>
                        </div>
                        <button onclick="offerFief('${safePseudo}')" style="margin-top:8px; width:100%; background:#41d37a; color:#000; border:none; font-weight:bold; padding:4px 0; font-size:10px; border-radius:3px; cursor:pointer;">Je lui offre mon fief</button>
                    </div>
                `;
            }
        });
        helpContainer.innerHTML = html;
    }

    const offeringHelp = visible.filter(r => r.dispo === 'dispo_aide' && !r.covering);
    if (offeringHelp.length === 0) {
        offerContainer.innerHTML = "<div style='font-style:italic; color:#888; padding:5px; text-align:center;'>Aucune offre libre.</div>";
    } else {
        let html = "";
        offeringHelp.forEach(res => {
            const sietchBadge = res.sietch ? `<span class="sietch-badge">${res.sietch.replace('Sietch ', '')}</span>` : '';
            html += `
                <div class="help-item" onclick="focusOnMarker(${res.lat}, ${res.lng})" title="Voir sa base sur la carte">
                    <strong style="color:#41d37a; font-size:14px;">${res.pseudo}</strong>${sietchBadge}<br>
                    <span style="font-size:11px; color:#aaa;">🤝 Propose son aide</span>
                </div>
            `;
        });
        offerContainer.innerHTML = html;
    }
}

window.focusOnMarker = function(lat, lng) {
    map.flyTo([lat, lng], 1, { duration: 0.8 });
};

function renderMarkers() {
    markersLayer.clearLayers();

    const visible = getVisible();

    visible.forEach(res => {
        let mainColor = '#00e5ff';
        let glowColor = 'rgba(0, 229, 255, 0.8)';
        let typeText = "💭 Souhait";

        if (res.type === 'imperatif') {
            mainColor = '#ff0066'; glowColor = 'rgba(255, 0, 102, 0.8)'; typeText = "🛑 IMPÉRATIF";
        }

        let customIcon = L.divIcon({
            className: 'custom-svg-icon',
            html: createSvgMarker(mainColor, glowColor),
            iconSize: [36, 36], iconAnchor: [18, 36], popupAnchor: [0, -36]
        });

        let dispoText = ""; let dispoColor = "";
        if (res.dispo === 'dispo_seul') {
            dispoText = "✅ Présent"; dispoColor = "#41d37a";
        } else if (res.dispo === 'dispo_aide') {
            if (res.covering) { dispoText = `✅ Aide accordée à ${res.covering}`; dispoColor = "#41d37a"; }
            else { dispoText = "🤝 Présent + Offre Fief"; dispoColor = "#5bc0de"; }
        } else if (res.dispo === 'absent') {
            if (res.coveredBy) { dispoText = `✅ Couvert par ${res.coveredBy}`; dispoColor = "#41d37a"; }
            else { dispoText = "❌ Absent (Besoin Fief)"; dispoColor = "#ff6b6b"; }
        }

        let safePseudo = res.pseudo.replace(/'/g, "\\'");
        let safeSietch = (res.sietch || '').replace(/'/g, "\\'");

        const sietchLine = res.sietch
            ? `<div style="font-size:11px; color:#a67c33; margin-top:2px;">📍 ${res.sietch}</div>`
            : '';

        let tooltipContent = `
            <div style="text-align:center; line-height:1.4;">
                <strong style="color:#f3c44f; font-size:14px; text-transform:uppercase;">${res.pseudo}</strong><br>
                ${sietchLine}
                <span style="font-size:11px; color:#ccc;">${typeText}</span><br>
                <span style="font-size:11px; color:${dispoColor}; font-weight:bold;">${dispoText}</span>
            </div>
        `;

        let actionBtn = "";
        if (res.dispo === 'absent') {
            if (res.coveredBy) {
                actionBtn = `<button onclick="cancelOffer('${safePseudo}')" style="flex:1; background:#555; color:#fff; border:none; padding:5px; cursor:pointer; border-radius:3px;">Annuler l'aide</button>`;
            } else {
                actionBtn = `<button onclick="offerFief('${safePseudo}')" style="flex:1; background:#41d37a; color:#000; border:none; font-weight:bold; padding:5px; cursor:pointer; border-radius:3px;">Je lui offre mon fief</button>`;
            }
        }

        let popupContent = `
            <div style="text-align:center; font-family:sans-serif; min-width: 180px;">
                <strong style="color:#f3c44f; font-size:16px;">${res.pseudo}</strong><br>
                ${sietchLine}
                <span style="font-size:12px; color:#aaa;">${typeText}</span><br>
                <div style="margin-top:8px; font-size:12px; color:${dispoColor}; font-weight:bold;">${dispoText}</div>

                ${actionBtn ? `<div style="display:flex; gap:5px; margin-top:12px;">${actionBtn}</div>` : ""}

                <div style="display:flex; gap:5px; margin-top:10px;">
                    <button onclick="editReservation('${safePseudo}', '${safeSietch}', '${res.type}', '${res.dispo}', ${res.lat}, ${res.lng})"
                            style="flex:1; background:#8b6e3b; color:#fff; border:none; padding:5px; cursor:pointer; border-radius:3px;">
                        Éditer
                    </button>
                    <button onclick="deleteReservation('${res.id}')"
                            style="flex:1; background:#a83b3b; color:white; border:none; padding:5px; cursor:pointer; border-radius:3px;">
                        Supprimer
                    </button>
                </div>
            </div>
        `;

        L.marker([res.lat, res.lng], { icon: customIcon })
         .addTo(markersLayer)
         .bindTooltip(tooltipContent, { direction: 'top', offset: [0, -30], className: 'base-tooltip' })
         .bindPopup(popupContent);
    });
}

// ── MARQUEURS FANTÔMES (bases confirmées sur destination.html) ───────────────

function loadGhostProjections() {
    fetch('destination_api.php')
        .then(res => res.json())
        .then(data => {
            const confirmed = (data || []).filter(r => r.status === 'confirmee');
            if (JSON.stringify(confirmed) !== JSON.stringify(ghostProjections)) {
                ghostProjections = confirmed;
                renderGhostMarkers();
            }
        })
        .catch(() => {}); // silencieux si destination_api.php absent
}

function getVisibleGhosts() {
    // Exclure les joueurs déjà présents dans migration
    const notDuplicate = ghostProjections.filter(g =>
        !reservations.some(r => r.pseudo.toLowerCase() === g.pseudo.toLowerCase())
    );
    return currentSietch
        ? notDuplicate.filter(g => g.sietch === currentSietch)
        : notDuplicate;
}

function renderGhostMarkers() {
    ghostLayer.clearLayers();

    getVisibleGhosts().forEach(g => {
        const ghostIcon = L.divIcon({
            className: 'custom-svg-icon',
            html: `
                <div style="opacity:0.72; filter:drop-shadow(0 0 6px rgba(106,180,255,0.7));">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="36" height="36">
                        <path fill="#6ab4ff" stroke="#ffffff" stroke-width="1.5" stroke-dasharray="3 2"
                              d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
                        <text x="12" y="9.5" text-anchor="middle" dominant-baseline="middle" fill="#fff" font-size="6" font-weight="bold">?</text>
                    </svg>
                </div>`,
            iconSize: [36, 36], iconAnchor: [18, 36], popupAnchor: [0, -36]
        });

        const sietchLine  = g.sietch   ? `<div style="font-size:11px; color:#a67c33; margin-top:2px;">📍 ${g.sietch}</div>` : '';
        const noteLine    = g.note     ? `<div style="font-size:11px; color:#aaa; margin-top:4px; font-style:italic;">📋 ${g.note}</div>` : '';
        const scoutLine   = g.placedBy ? `<div style="font-size:10px; color:#666; margin-top:2px;">Repéré par ${g.placedBy}</div>` : '';

        const safePseudo = g.pseudo.replace(/'/g, "\\'");
        const safeSietch = (g.sietch || '').replace(/'/g, "\\'");

        const tooltipContent = `
            <div style="text-align:center; line-height:1.4;">
                <strong style="color:#6ab4ff; font-size:13px; text-transform:uppercase;">${g.pseudo}</strong><br>
                ${sietchLine}
                <span style="font-size:11px; color:#6ab4ff;">🔵 Position confirmée (Destination)</span>
            </div>`;

        const popupContent = `
            <div style="text-align:center; font-family:sans-serif; min-width:200px;">
                <strong style="color:#6ab4ff; font-size:15px;">${g.pseudo}</strong><br>
                ${sietchLine}
                ${scoutLine}
                <div style="margin-top:6px; font-size:12px; color:#6ab4ff; font-weight:bold;">🔵 Position confirmée sur Icarus</div>
                ${noteLine}
                <div style="margin-top:10px; font-size:11px; color:#888;">
                    Cliquez ci-dessous si c'est votre base pour finaliser votre inscription dans le plan de migration.
                </div>
                <button onclick="activateGhost('${safePseudo}', '${safeSietch}', ${g.lat}, ${g.lng})"
                        style="margin-top:8px; width:100%; background:linear-gradient(to bottom,#5a9fd4,#2e6a9e);
                               color:#fff; border:none; font-weight:bold; padding:8px; cursor:pointer;
                               border-radius:4px; font-size:12px;">
                    ✋ C'est ma base — m'inscrire
                </button>
            </div>`;

        L.marker([g.lat, g.lng], { icon: ghostIcon })
         .addTo(ghostLayer)
         .bindTooltip(tooltipContent, { direction: 'top', offset: [0, -30], className: 'base-tooltip' })
         .bindPopup(popupContent);
    });
}

window.activateGhost = function(pseudo, sietch, lat, lng) {
    showCustomPrompt(
        "VÉRIFICATION",
        `Est-ce bien la base de <strong style="color:#f3c44f;">${pseudo}</strong> ?<br>Entrez votre pseudo pour continuer :`,
        pseudo,
        inputPseudo => {
            if (!inputPseudo) return;
            if (inputPseudo.trim().toLowerCase() !== pseudo.toLowerCase()) {
                showCustomConfirm("REFUSÉ", "Ce pseudo ne correspond pas à cette base.", null);
                return;
            }
            // Ouvre le modal migration pré-rempli
            currentCoords = { lat, lng };
            document.getElementById('modal-title-text').innerText = "Finaliser mon inscription";
            document.getElementById('res-pseudo').value  = pseudo;
            document.getElementById('res-sietch').value  = sietch || SIETCHS[0];
            document.getElementById('res-type').value    = 'souhait';
            document.getElementById('res-dispo').value   = 'dispo_seul';
            document.getElementById('reservation-modal').style.display = 'flex';
            map.closePopup();
        }
    );
};
