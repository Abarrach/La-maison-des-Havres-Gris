const SIETCHS = [
  'Sietch Abbir', 'Sietch Alraab', 'Sietch Barkan', 'Sietch Coanua', 'Sietch Fajr',
  'Sietch Gara Kulon', 'Sietch Hajar', 'Sietch Jacurutu', 'Sietch Kathib', 'Sietch Legg',
  'Sietch Makab', 'Sietch Nadir', 'Sietch Ramal', 'Sietch Rifana', 'Sietch Sandrat',
  'Sietch Saajid', 'Sietch Tabr', 'Sietch Tharwa', 'Sietch Umbu', 'Sietch Yaracuwan'
];

let map, currentCoords = null, projections = [], markersLayer = L.layerGroup();
let currentSietch = null, editingId = null;
let pendingImages        = [];
let existingImages       = [];
let migrationReservations = [];
const bounds = [[0, 0], [2556, 2556]];

document.addEventListener("DOMContentLoaded", () => {
    const sel = document.getElementById('res-sietch');
    if (sel) sel.innerHTML = SIETCHS.map(s => `<option value="${s}">${s}</option>`).join('');

    map = L.map("map", { crs: L.CRS.Simple, minZoom: -2, maxZoom: 2, zoomControl: false, attributionControl: false });
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    L.imageOverlay("map.jpg", bounds).addTo(map);
    map.fitBounds(bounds);
    markersLayer.addTo(map);

    map.on('click', e => {
        currentCoords = e.latlng;
        editingId     = null;
        pendingImages  = [];
        existingImages = [];
        document.getElementById('modal-title-text').innerText = "Placer une base projetée";
        document.getElementById('res-pseudo').value    = '';
        document.getElementById('res-sietch').value    = currentSietch || SIETCHS[0];
        document.getElementById('res-placedby').value  = '';
        document.getElementById('res-note').value      = '';
        renderImagePreviews();
        document.getElementById('reservation-modal').style.display = 'flex';
        document.getElementById('res-pseudo').focus();
    });

    initDropZone();
    initPasteHandler();
    initLightbox();

    loadProjections();
    loadMigrationStatus();
    setInterval(loadProjections, 5000);
    setInterval(loadMigrationStatus, 8000);
});

// ── IMAGES : DRAG & DROP / PASTE / PREVIEW ─────────────────────────────────

function initDropZone() {
    const zone = document.getElementById('img-dropzone');
    if (!zone) return;

    zone.addEventListener('dragover', e => {
        e.preventDefault();
        zone.classList.add('drag-over');
    });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', e => {
        e.preventDefault();
        zone.classList.remove('drag-over');
        const slots = 2 - existingImages.length - pendingImages.length;
        if (slots <= 0) return;
        [...e.dataTransfer.files]
            .filter(f => f.type.startsWith('image/'))
            .slice(0, slots)
            .forEach(f => readFileAsDataUrl(f, addPendingImage));
    });
}

function initPasteHandler() {
    document.addEventListener('paste', e => {
        if (document.getElementById('reservation-modal').style.display !== 'flex') return;
        if (existingImages.length + pendingImages.length >= 2) return;
        const items = e.clipboardData?.items;
        if (!items) return;
        for (const item of items) {
            if (item.type.startsWith('image/')) {
                readFileAsDataUrl(item.getAsFile(), addPendingImage);
                break;
            }
        }
    });
}

function compressImage(dataUrl, cb) {
    const img = new Image();
    img.onload = function() {
        const MAX = 1200;
        let w = img.width, h = img.height;
        if (w > MAX || h > MAX) {
            if (w >= h) { h = Math.round(h * MAX / w); w = MAX; }
            else        { w = Math.round(w * MAX / h); h = MAX; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        cb(canvas.toDataURL('image/jpeg', 0.75));
    };
    img.src = dataUrl;
}

function readFileAsDataUrl(file, cb) {
    const reader = new FileReader();
    reader.onload = ev => compressImage(ev.target.result, cb);
    reader.readAsDataURL(file);
}

function addPendingImage(dataUrl) {
    if (existingImages.length + pendingImages.length >= 2) return;
    pendingImages.push(dataUrl);
    renderImagePreviews();
}

function renderImagePreviews() {
    const container = document.getElementById('img-previews');
    const zone      = document.getElementById('img-dropzone');
    if (!container || !zone) return;

    const total = existingImages.length + pendingImages.length;

    let html = '';
    existingImages.forEach((src, i) => {
        html += `<div class="img-preview-item">
            <img src="${src}" alt="Photo ${i + 1}" onclick="openLightbox('${src}')">
            <button class="img-preview-remove" onclick="removeExistingImage(${i})">✕</button>
        </div>`;
    });
    pendingImages.forEach((src, i) => {
        const thumb = src.length > 200 ? src : src;
        html += `<div class="img-preview-item">
            <img src="${thumb}" alt="Nouveau ${i + 1}" onclick="openLightbox('${thumb}')">
            <button class="img-preview-remove" onclick="removePendingImage(${i})">✕</button>
        </div>`;
    });
    container.innerHTML = html;

    if (total >= 2) {
        zone.style.display = 'none';
    } else {
        zone.style.display = 'flex';
        zone.querySelector('span').textContent = total === 1
            ? 'Ajoutez encore 1 capture (optionnel)'
            : 'Glissez des captures ici, ou collez (Ctrl+V)';
    }
}

window.removeExistingImage = function(i) { existingImages.splice(i, 1); renderImagePreviews(); };
window.removePendingImage  = function(i) { pendingImages.splice(i, 1);  renderImagePreviews(); };

// ── LIGHTBOX ────────────────────────────────────────────────────────────────

function initLightbox() {
    const lb = document.getElementById('img-lightbox');
    if (!lb) return;
    lb.addEventListener('click', e => {
        if (e.target === lb) lb.style.display = 'none';
    });
}

window.openLightbox = function(src) {
    const lb  = document.getElementById('img-lightbox');
    const img = document.getElementById('img-lightbox-img');
    if (!lb || !img) return;
    img.src = src;
    lb.style.display = 'flex';
};

// ── MODALES GÉNÉRIQUES ───────────────────────────────────────────────────────

function showCustomConfirm(title, message, onConfirm) {
    const overlay = document.getElementById('custom-modal-overlay');
    document.getElementById('generic-modal-title').innerText   = title;
    document.getElementById('generic-modal-message').innerHTML = message;
    document.getElementById('generic-modal-message').style.display = 'block';
    document.getElementById('generic-modal-input').style.display   = 'none';
    overlay.style.display = 'flex';

    const btnConf    = document.getElementById('generic-modal-btn-confirm');
    const btnCanc    = document.getElementById('generic-modal-btn-cancel');
    const newBtnConf = btnConf.cloneNode(true);
    const newBtnCanc = btnCanc.cloneNode(true);
    btnConf.parentNode.replaceChild(newBtnConf, btnConf);
    btnCanc.parentNode.replaceChild(newBtnCanc, btnCanc);

    if (onConfirm) {
        newBtnCanc.style.display = 'block';
        newBtnConf.addEventListener('click', () => { overlay.style.display = 'none'; onConfirm(); });
    } else {
        newBtnCanc.style.display = 'none';
        newBtnConf.innerText = 'OK';
        newBtnConf.addEventListener('click', () => { overlay.style.display = 'none'; });
    }
    newBtnCanc.addEventListener('click', () => { overlay.style.display = 'none'; });
}

function showCustomPrompt(title, message, placeholder, onConfirm) {
    const overlay = document.getElementById('custom-modal-overlay');
    document.getElementById('generic-modal-title').innerText   = title;
    document.getElementById('generic-modal-message').innerHTML = message;
    document.getElementById('generic-modal-message').style.display = 'block';
    const inputEl = document.getElementById('generic-modal-input');
    inputEl.style.display = 'block';
    inputEl.value = '';
    inputEl.placeholder = placeholder || '';
    overlay.style.display = 'flex';
    inputEl.focus();

    const btnConf    = document.getElementById('generic-modal-btn-confirm');
    const btnCanc    = document.getElementById('generic-modal-btn-cancel');
    const newBtnConf = btnConf.cloneNode(true);
    const newBtnCanc = btnCanc.cloneNode(true);
    btnConf.parentNode.replaceChild(newBtnConf, btnConf);
    btnCanc.parentNode.replaceChild(newBtnCanc, btnCanc);

    newBtnCanc.style.display = 'block';
    newBtnConf.innerText = 'Confirmer';
    newBtnConf.addEventListener('click', () => {
        const val = inputEl.value.trim();
        overlay.style.display = 'none';
        if (onConfirm) onConfirm(val);
    });
    newBtnCanc.addEventListener('click', () => { overlay.style.display = 'none'; });
    inputEl.onkeydown = e => { if (e.key === 'Enter') newBtnConf.click(); };
}

// ── FILTRE SIETCH ────────────────────────────────────────────────────────────

function renderSietchFilterButtons() {
    const bar = document.getElementById('sietch-filter-bar');
    if (!bar) return;
    const presents = [...new Set(projections.filter(r => r.sietch).map(r => r.sietch))].sort();

    bar.innerHTML = `<button class="sietch-filter-btn all-btn${!currentSietch ? ' active' : ''}" data-sietch="">Tous (${projections.length})</button>`;
    presents.forEach(sietch => {
        const count = projections.filter(r => r.sietch === sietch).length;
        const active = currentSietch === sietch ? ' active' : '';
        bar.innerHTML += `<button class="sietch-filter-btn${active}" data-sietch="${sietch}">${sietch.replace('Sietch ', '')} (${count})</button>`;
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

// ── MODAL PLACEMENT ──────────────────────────────────────────────────────────

function closeModal() {
    document.getElementById('reservation-modal').style.display = 'none';
    currentCoords  = null;
    editingId      = null;
    pendingImages  = [];
    existingImages = [];
}

window.editProjection = function(id) {
    const item = projections.find(r => r.id === id);
    if (!item) return;
    editingId      = id;
    currentCoords  = { lat: item.lat, lng: item.lng };
    pendingImages  = [];
    existingImages = item.images ? [...item.images] : [];

    document.getElementById('modal-title-text').innerText  = "Modifier cette base projetée";
    document.getElementById('res-pseudo').value    = item.pseudo;
    document.getElementById('res-sietch').value    = item.sietch || SIETCHS[0];
    document.getElementById('res-placedby').value  = item.placedBy || '';
    document.getElementById('res-note').value      = item.note || '';
    renderImagePreviews();
    document.getElementById('reservation-modal').style.display = 'flex';
    map.closePopup();
};

function savePlacement() {
    const pseudo   = document.getElementById('res-pseudo').value.trim();
    const sietch   = document.getElementById('res-sietch').value;
    const placedBy = document.getElementById('res-placedby').value.trim();
    const note     = document.getElementById('res-note').value.trim();

    if (!pseudo)   { showCustomConfirm("ERREUR", "Le pseudo du joueur est obligatoire !", null); return; }
    if (!placedBy) { showCustomConfirm("ERREUR", "Votre pseudo (éclaireur) est obligatoire !", null); return; }

    const payload = { pseudo, sietch, placedBy, note };

    if (pendingImages.length > 0) payload.images = pendingImages;

    if (editingId) {
        payload.id         = editingId;
        payload.action     = 'save';
        payload.keepImages = existingImages;
    } else {
        payload.lat = currentCoords.lat;
        payload.lng = currentCoords.lng;
    }

    fetch('destination_api.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    })
    .then(res => res.json())
    .then(result => {
        if (result.status === 'error') { showCustomConfirm("ERREUR", result.message, null); return; }
        closeModal();
        loadProjections();
    })
    .catch(err => showCustomConfirm("ERREUR", "Impossible de joindre destination_api.php.<br><small>" + err + "</small>", null));
}

// ── ACTIONS MARQUEURS ────────────────────────────────────────────────────────

window.deleteProjection = function(id) {
    const item       = projections.find(r => r.id === id);
    const migEntry   = item ? getMigrationEntry(item.pseudo) : null;
    const msg = migEntry
        ? `⚠️ <strong style="color:#f3c44f;">${item.pseudo}</strong> est inscrit sur Migration à ces coordonnées.<br><br>Supprimer ici <strong>ne retirera pas</strong> son entrée sur Migration — il faudra la retirer manuellement.<br><br>Continuer quand même ?`
        : "Voulez-vous vraiment supprimer cette base projetée ?";

    showCustomConfirm("SUPPRESSION", msg, () => {
        fetch('destination_api.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'delete', id })
        }).then(res => res.json()).then(loadProjections);
    });
};

window.confirmBase = function(id) {
    const item = projections.find(r => r.id === id);
    if (!item) return;
    showCustomPrompt(
        "CONFIRMER MA POSITION",
        `Entrez votre pseudo pour valider l'emplacement prévu pour <strong style="color:#f3c44f;">${item.pseudo}</strong> :`,
        "Ex: Paul Atreides",
        pseudo => {
            if (!pseudo) return;
            fetch('destination_api.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'confirm', id, pseudo })
            }).then(res => res.json()).then(data => {
                if (data.status === 'error') showCustomConfirm("ERREUR", data.message, null);
                else loadProjections();
            });
        }
    );
};

window.rejectBase = function(id) {
    const item = projections.find(r => r.id === id);
    if (!item) return;
    showCustomPrompt(
        "REFUSER CET EMPLACEMENT",
        `Entrez votre pseudo pour signaler que l'emplacement de <strong style="color:#f3c44f;">${item.pseudo}</strong> ne convient pas :`,
        "Ex: Paul Atreides",
        pseudo => {
            if (!pseudo) return;
            showCustomPrompt(
                "RAISON DU REFUS",
                "Pourquoi cet emplacement ne convient pas ? <span style='color:#888;'>(optionnel)</span>",
                "Ex: La base ne rentre pas, terrain trop étroit...",
                reason => {
                    fetch('destination_api.php', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ action: 'reject', id, pseudo, reason })
                    }).then(res => res.json()).then(data => {
                        if (data.status === 'error') showCustomConfirm("ERREUR", data.message, null);
                        else loadProjections();
                    });
                }
            );
        }
    );
};

window.resetToProjected = function(id) {
    const item = projections.find(r => r.id === id);
    if (item && item.status === 'confirmee' && isInMigration(item.pseudo)) {
        showCustomConfirm("ACTION BLOQUÉE",
            `<strong style="color:#f3c44f;">${item.pseudo}</strong> est inscrit sur Migration.<br><br>Retirez d'abord son entrée sur Migration avant de remettre la base en projeté.`,
            null);
        return;
    }
    showCustomConfirm("REMETTRE EN PROJETÉ", "Remettre cette base en statut 'Projeté' ?", () => {
        fetch('destination_api.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'reset', id })
        }).then(res => res.json()).then(loadProjections);
    });
};

// ── CHARGEMENT ───────────────────────────────────────────────────────────────

function loadMigrationStatus() {
    fetch('migration_api.php')
        .then(res => res.json())
        .then(data => {
            if (JSON.stringify(data) !== JSON.stringify(migrationReservations)) {
                migrationReservations = data || [];
                renderMarkers();
                renderSideLists();
            }
        })
        .catch(() => {});
}

function getMigrationEntry(pseudo) {
    return migrationReservations.find(r => r.pseudo.toLowerCase() === pseudo.toLowerCase()) || null;
}

function isInMigration(pseudo) {
    return getMigrationEntry(pseudo) !== null;
}

function loadProjections() {
    fetch('destination_api.php')
        .then(res => res.json())
        .then(data => {
            if (JSON.stringify(data) !== JSON.stringify(projections)) {
                projections = data;
                renderSietchFilterButtons();
                renderMarkers();
                renderSideLists();
            }
        });
}

// ── MARQUEURS ────────────────────────────────────────────────────────────────

function createSvgMarker(status) {
    const cfg = {
        projetee:  { fill: '#ff8c00', glow: 'rgba(255,140,0,0.7)',  dash: '4 2' },
        confirmee: { fill: '#41d37a', glow: 'rgba(65,211,122,0.8)', dash: ''    },
        rejetee:   { fill: '#ff4444', glow: 'rgba(255,68,68,0.8)',  dash: ''    },
    };
    const c        = cfg[status] || cfg.projetee;
    const dashAttr = c.dash ? `stroke-dasharray="${c.dash}"` : '';
    const overlay  = status === 'rejetee'   ? `<text x="12" y="9.5" text-anchor="middle" dominant-baseline="middle" fill="#fff" font-size="7" font-weight="bold">✕</text>`
                   : status === 'confirmee' ? `<text x="12" y="9.5" text-anchor="middle" dominant-baseline="middle" fill="#fff" font-size="7" font-weight="bold">✓</text>`
                   : '';
    return `
        <div style="filter:drop-shadow(0 0 8px ${c.glow});">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="36" height="36">
                <path fill="${c.fill}" stroke="#ffffff" stroke-width="1.5" ${dashAttr}
                      d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
                ${overlay}
            </svg>
        </div>`;
}

function buildImagesHtml(images) {
    if (!images || images.length === 0) return '';
    const thumbs = images.map(src =>
        `<img src="${src}" onclick="openLightbox('${src}')"
              style="width:72px; height:50px; object-fit:cover; border-radius:3px;
                     border:1px solid #5c4025; cursor:pointer; display:block;">`
    ).join('');
    return `<div style="display:flex; gap:5px; margin-top:8px; flex-wrap:wrap;">${thumbs}</div>`;
}

function getVisible() {
    return currentSietch ? projections.filter(r => r.sietch === currentSietch) : projections;
}

window.focusOnMarker = function(lat, lng) {
    map.flyTo([lat, lng], 1, { duration: 0.8 });
};

function renderMarkers() {
    markersLayer.clearLayers();

    const statusLabels = {
        projetee:  { text: '🔶 Base projetée', color: '#ff8c00' },
        confirmee: { text: '✅ Confirmée',      color: '#41d37a' },
        rejetee:   { text: '❌ Refusée',        color: '#ff4444' },
    };

    getVisible().forEach(res => {
        const sl         = statusLabels[res.status] || statusLabels.projetee;
        const sietchLine = res.sietch       ? `<div style="font-size:11px; color:#a67c33; margin-top:2px;">📍 ${res.sietch}</div>` : '';
        const noteLine   = res.note         ? `<div style="font-size:11px; color:#aaa; margin-top:4px; font-style:italic;">📋 ${res.note}</div>` : '';
        const rejectLine = res.rejectReason ? `<div style="font-size:11px; color:#ff7070; margin-top:4px;">💬 ${res.rejectReason}</div>` : '';
        const placedLine = res.placedBy     ? `<div style="font-size:10px; color:#666; margin-top:2px;">Repéré par ${res.placedBy}</div>` : '';
        const imagesHtml = buildImagesHtml(res.images);

        const tooltipContent = `
            <div style="text-align:center; line-height:1.4;">
                <strong style="color:#f3c44f; font-size:14px; text-transform:uppercase;">${res.pseudo}</strong><br>
                ${sietchLine}
                <span style="font-size:11px; color:${sl.color}; font-weight:bold;">${sl.text}</span>
                ${noteLine}
            </div>`;

        let actionBtns = '';
        if (res.status === 'projetee') {
            actionBtns = `
                <div style="display:flex; gap:5px; margin-top:8px;">
                    <button onclick="confirmBase('${res.id}')" style="flex:1; background:#41d37a; color:#000; border:none; font-weight:bold; padding:5px; cursor:pointer; border-radius:3px; font-size:11px;">✅ Je confirme</button>
                    <button onclick="rejectBase('${res.id}')" style="flex:1; background:#ff4444; color:#fff; border:none; padding:5px; cursor:pointer; border-radius:3px; font-size:11px;">❌ Ne convient pas</button>
                </div>`;
        } else if (res.status === 'confirmee') {
            const migEntry = getMigrationEntry(res.pseudo);

            if (migEntry) {
                // Libellés dispo
                const dispoLabels = {
                    dispo_seul: { text: 'Présent (seul)',         color: '#41d37a' },
                    dispo_aide: { text: 'Présent (offre un fief)', color: '#5bc0de' },
                    absent:     { text: 'Absent (besoin d\'un fief)', color: '#ff6b6b' },
                };
                const dl = dispoLabels[migEntry.dispo] || { text: migEntry.dispo, color: '#ccc' };

                // Proposition 5 : incohérence dispo vs confirmation
                const dispoWarn = migEntry.dispo === 'absent'
                    ? `<div style="margin-top:4px; font-size:11px; color:#ff9900;">⚠️ Attention : noté <strong>Absent</strong> sur Migration</div>`
                    : '';

                // Proposition 3 : dérive de sietch
                const migSietch = migEntry.sietch || '';
                const destSietch = res.sietch || '';
                const sietchWarn = migSietch && destSietch && migSietch !== destSietch
                    ? `<div style="margin-top:4px; font-size:11px; color:#ff9900;">⚠️ Sietch divergent — Destination : <strong>${destSietch.replace('Sietch ','')}</strong>, Migration : <strong>${migSietch.replace('Sietch ','')}</strong></div>`
                    : '';

                // Proposition 4 : statut migration complet
                const migBlock = `
                    <div style="margin-top:8px; padding:7px; background:rgba(65,211,122,0.1); border:1px solid #41d37a; border-radius:4px; font-size:11px;">
                        <div style="color:#41d37a; font-weight:bold;">✅ Inscrit sur Migration</div>
                        <div style="color:${dl.color}; margin-top:3px;">${dl.text}</div>
                        ${dispoWarn}${sietchWarn}
                    </div>`;

                const lockMsg = `
                    <div style="margin-top:6px; padding:6px 8px; background:#1a0e04; border:1px solid #3a2510; border-radius:3px; font-size:10px; color:#666; text-align:center; user-select:none;">
                        🔒 Inscription Migration active — remettre en projeté impossible
                    </div>`;

                actionBtns = migBlock + lockMsg;

            } else {
                // Pas encore inscrit en migration
                const finalizeBtn = `
                    <button onclick="window.open('migration.html','_blank')"
                            style="margin-top:8px; width:100%; background:linear-gradient(to bottom,#d4a23b,#8b6e3b);
                                   color:#000; border:1px solid #ffd700; font-weight:bold; padding:7px;
                                   cursor:pointer; border-radius:4px; font-size:11px;">
                        → Finaliser sur Migration
                    </button>`;
                const resetBtn = `
                    <button onclick="resetToProjected('${res.id}')"
                            style="width:100%; background:#444; color:#aaa; border:none; padding:4px;
                                   cursor:pointer; border-radius:3px; font-size:10px; margin-top:6px;">
                        ↩ Remettre en projeté
                    </button>`;
                actionBtns = finalizeBtn + resetBtn;
            }
        } else {
            actionBtns = `<button onclick="resetToProjected('${res.id}')" style="width:100%; background:#555; color:#fff; border:none; padding:5px; cursor:pointer; border-radius:3px; font-size:11px; margin-top:8px;">↩ Remettre en projeté</button>`;
        }

        const popupContent = `
            <div style="text-align:center; font-family:sans-serif; min-width:200px;">
                <strong style="color:#f3c44f; font-size:16px;">${res.pseudo}</strong><br>
                ${sietchLine}
                ${placedLine}
                <div style="margin-top:6px; font-size:12px; color:${sl.color}; font-weight:bold;">${sl.text}</div>
                ${noteLine}
                ${rejectLine}
                ${imagesHtml}
                ${actionBtns}
                <div style="display:flex; gap:5px; margin-top:8px;">
                    <button onclick="editProjection('${res.id}')" style="flex:1; background:#8b6e3b; color:#fff; border:none; padding:5px; cursor:pointer; border-radius:3px; font-size:11px;">Éditer</button>
                    <button onclick="deleteProjection('${res.id}')" style="flex:1; background:#a83b3b; color:#fff; border:none; padding:5px; cursor:pointer; border-radius:3px; font-size:11px;">Supprimer</button>
                </div>
            </div>`;

        const icon = L.divIcon({
            className: 'custom-svg-icon',
            html: createSvgMarker(res.status),
            iconSize: [36, 36], iconAnchor: [18, 36], popupAnchor: [0, -36]
        });

        L.marker([res.lat, res.lng], { icon })
         .addTo(markersLayer)
         .bindTooltip(tooltipContent, { direction: 'top', offset: [0, -30], className: 'base-tooltip' })
         .bindPopup(popupContent);
    });
}

// ── PANNEAU LATÉRAL ───────────────────────────────────────────────────────────

function renderSideLists() {
    const total     = projections.length;
    const confirmed = projections.filter(r => r.status === 'confirmee').length;
    const rejected  = projections.filter(r => r.status === 'rejetee').length;
    const pending   = total - confirmed - rejected;

    const progressEl = document.getElementById('progress-content');
    if (progressEl) {
        const pct = total > 0 ? Math.round((confirmed / total) * 100) : 0;
        progressEl.innerHTML = total === 0
            ? `<div style="font-style:italic; color:#888; text-align:center;">Aucune base pour l'instant.</div>`
            : `<div style="display:flex; justify-content:space-between; margin-bottom:6px; font-size:12px;">
                <span style="color:#41d37a;">✅ ${confirmed} confirmée${confirmed > 1 ? 's' : ''}</span>
                <span style="color:#ff8c00;">🔶 ${pending} en attente</span>
                <span style="color:#ff4444;">❌ ${rejected} refusée${rejected > 1 ? 's' : ''}</span>
               </div>
               <div style="background:#333; border-radius:4px; height:8px; overflow:hidden;">
                   <div style="background:#41d37a; width:${pct}%; height:100%; transition:width 0.4s;"></div>
               </div>
               <div style="text-align:center; font-size:11px; color:#888; margin-top:4px;">${pct}% confirmé</div>`;
    }

    const listEl = document.getElementById('bases-list-content');
    if (!listEl) return;

    const visible = getVisible();
    if (visible.length === 0) {
        listEl.innerHTML = "<div style='font-style:italic; color:#888; padding:5px; text-align:center;'>Aucune base projetée.</div>";
        return;
    }

    const order     = { rejetee: 0, projetee: 1, confirmee: 2 };
    const statusCfg = {
        projetee:  { icon: '🔶', color: '#ff8c00' },
        confirmee: { icon: '✅', color: '#41d37a'  },
        rejetee:   { icon: '❌', color: '#ff4444'  },
    };

    listEl.innerHTML = [...visible]
        .sort((a, b) => (order[a.status] ?? 1) - (order[b.status] ?? 1))
        .map(res => {
            const sc          = statusCfg[res.status] || statusCfg.projetee;
            const sietchBadge = res.sietch ? `<span class="sietch-badge">${res.sietch.replace('Sietch ', '')}</span>` : '';
            const rejectNote   = res.rejectReason ? `<br><span style="font-size:10px; color:#888; font-style:italic;">💬 ${res.rejectReason}</span>` : '';
            const photoIcon    = res.images && res.images.length > 0 ? ` 📷` : '';
            let migBadge = '';
            if (res.status === 'confirmee') {
                const me = getMigrationEntry(res.pseudo);
                if (me) {
                    const hasWarn = me.dispo === 'absent' || (me.sietch && res.sietch && me.sietch !== res.sietch);
                    migBadge = hasWarn
                        ? `<span style="font-size:10px; color:#ff9900; margin-left:4px;">⚠️ Migration</span>`
                        : `<span style="font-size:10px; color:#41d37a; margin-left:4px;">⚓ Migration</span>`;
                }
            }
            return `<div class="help-item" onclick="focusOnMarker(${res.lat}, ${res.lng})" style="border-left:3px solid ${sc.color}; padding:8px;">
                <strong style="color:${sc.color};">${sc.icon} ${res.pseudo}${photoIcon}</strong>${sietchBadge}${migBadge}
                ${rejectNote}
            </div>`;
        }).join('');
}
