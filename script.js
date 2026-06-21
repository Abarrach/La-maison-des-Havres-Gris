// === CONFIGURATION DES CARTES ===
const mapConfig = {
  hagga: {
    name: "Bassin de Hagga",
    image: "map.jpg",
    maxBases: 1,
    bounds: [[0, 0], [2556, 2556]]
  },
  deep_desert: {
    name: "Deep Desert",
    image: "deep_desert.jpg?v=1",
    maxBases: 2,
    bounds: [[0, 0], [6120, 6144]]
  }
};

const SIETCHS = [
  'Sietch Abbir', 'Sietch al-Mut', 'Sietch Alraab', 'Sietch Barkan', 'Sietch Coanua', 'Sietch Eaqrab',
  'Sietch Fajr', 'Sietch Gara Kulon', 'Sietch Hajar', 'Sietch Jacurutu', 'Sietch Kathib',
  'Sietch Khafash', 'Sietch Legg', 'Sietch Makab', 'Sietch Nadir', 'Sietch Rajifiri', 'Sietch Ramal',
  'Sietch Rifana', 'Sietch Sandrat', 'Sietch Saajid', 'Sietch Ta\'lab', 'Sietch Tabr', 'Sietch Tharwa',
  'Sietch Umbu', 'Sietch Yaracuwan'
];

// === GLOBALES ===
let map, currentLayer;
let currentMapId = 'hagga';
let currentSietch = null;
let currentUser = null;
let isAdmin = false;
let markers = [];
let selectedCoords = null;
let timerInterval = null;

// === DEEP DESERT — OVERLAY DYNAMIQUE ===
// Bounds officielles gaming.tools pour la Deep Desert (source : BoVuGAsD.js) :
//   min:{x:-1270000,y:-1270000}  max:{x:1168400,y:1168400}  transformType:"flipVertical"
// Le monde n'est PAS centré en (0,0) — décalage de -50 800 en x et y.
// Total : 2 438 400 × 2 438 400 = 9 × 271 000 (9 colonnes/lignes exactes).
const DD_WORLD_MIN_X = -1270000;
const DD_WORLD_MAX_X =  1168400;
const DD_WORLD_MIN_Y = -1270000;
const DD_WORLD_MAX_Y =  1168400;
const DD_WORLD_W = DD_WORLD_MAX_X - DD_WORLD_MIN_X; // 2438400
const DD_WORLD_H = DD_WORLD_MAX_Y - DD_WORLD_MIN_Y; // 2438400
const DD_IMG_W   = 6144;
const DD_IMG_H   = 6120;

// Référence compteur hebdo, ALIGNÉE sur un vrai reset (mardi 05:00 Paris = 03:00
// UTC en été). Semaine du 9 juin 2026 = compteur 16 → 16 % 12 = seed 4 (vérifié
// contre la page gaming.tools). Le %12 (cf. currentActorSeed) donne le seed actif.
// ⚠ L'ancienne réf (13 mai) tombait un mercredi → bascule 1 jour trop tard après
// chaque reset du mardi (épice de la semaine précédente pendant ~1 jour).
const DD_REF_SEED = 16;
const DD_REF_DATE = new Date('2026-06-09T03:00:00Z');

function gameToLeaflet(gx, gy) {
  // transformType:"flipVertical" → lat = MAX_Y - gy (Y inversé pour l'affichage)
  const lng = (gx - DD_WORLD_MIN_X) / DD_WORLD_W * DD_IMG_W;
  const lat = (DD_WORLD_MAX_Y - gy) / DD_WORLD_H * DD_IMG_H;
  return L.latLng(lat, lng);
}

function estimateDDSeed() {
  const ms = Date.now() - DD_REF_DATE.getTime();
  const weeks = Math.floor(ms / (7 * 24 * 3600 * 1000));
  return Math.max(1, DD_REF_SEED + weeks);
}

// Seed acteurs de la SEMAINE EN COURS = compteur hebdo modulo 12 (rotation
// gaming.tools sur 12 variantes). Vérifié : estimateDDSeed()=16 → 16%12=4, soit
// exactement le seed annoncé par la page gaming.tools. ⚠ L'ancien bug : le fetch
// essayait seed=0 (une vieille semaine figée) au lieu de est%12.
function currentActorSeed() {
  return ((estimateDDSeed() % 12) + 12) % 12;
}

// Coordonnées monde → cellule A1..I9 (validé contre le gridCell officiel)
function ddCell(x, y) {
  const lng = (x - DD_WORLD_MIN_X) / DD_WORLD_W * DD_IMG_W;
  const lat = (DD_WORLD_MAX_Y - y) / DD_WORLD_H * DD_IMG_H;
  const r = Math.min(8, Math.floor(lat / (DD_IMG_H / 9)));
  const c = Math.min(9, Math.floor(lng / (DD_IMG_W / 9)) + 1);
  return 'ABCDEFGHI'[r] + c;
}

// Regroupe des nœuds (filons) en concentrations (greedy, rayon fixe) →
// centroïdes + count. Le rayon ≈ demi-cellule pour capturer un « champ » entier
// sans le scinder aux bords (mieux qu'une grille fixe).
function ddClusterPts(pts, radius = 150000) {
  const used = new Array(pts.length).fill(false);
  const r2 = radius * radius;
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    if (used[i]) continue;
    const cx = pts[i].x, cy = pts[i].y;
    let sx = 0, sy = 0, n = 0;
    for (let j = i; j < pts.length; j++) {
      if (used[j]) continue;
      const dx = pts[j].x - cx, dy = pts[j].y - cy;
      if (dx * dx + dy * dy <= r2) { used[j] = true; sx += pts[j].x; sy += pts[j].y; n++; }
    }
    const x = sx / n, y = sy / n;
    out.push({ x, y, cell: ddCell(x, y), count: n });
  }
  return out;
}

// Décodeur du format « flatted » de gaming.tools (.d.json : grand tableau plat
// où chaque valeur de champ est un INDEX vers une autre entrée). `skip` = clés
// à ne pas développer (parentMarkers, lourd et inutile ici).
function ddFlatResolve(flat, i, skip, depth = 0) {
  if (depth > 14) return null;
  if (typeof i !== 'number') return i;
  const v = flat[i];
  if (Array.isArray(v)) return v.map(r => ddFlatResolve(flat, r, skip, depth + 1));
  if (v && typeof v === 'object') {
    const o = {};
    for (const k in v) o[k] = skip.includes(k) ? null : ddFlatResolve(flat, v[k], skip, depth + 1);
    return o;
  }
  return v;
}

// Acteurs bruts → couches (zones, épice L/M/S, filons regroupés)
function processActors(seed, actors) {
  const zones = [];
  const spiceL = [], spiceM = [], spiceS = [], tiPts = [], stPts = [];
  for (const a of actors) {
    const mk = a.map_marker_id;
    if (a.type === 'BP_SecurityZone_C') {
      zones.push({ zoneType: a.metadata?.Type ?? 'Unknown', bounds: a.metadata?.Bounds ?? [], cx: a.x, cy: a.y });
    } else if (mk === 'spicefieldlarge')  spiceL.push({ x: a.x, y: a.y, cell: ddCell(a.x, a.y) });
    else if (mk === 'spicefieldmedium')   spiceM.push({ x: a.x, y: a.y, cell: ddCell(a.x, a.y) });
    else if (mk === 'spicefieldsmall')    spiceS.push({ x: a.x, y: a.y, cell: ddCell(a.x, a.y) });
    else if (mk === 'titaniumore')        tiPts.push({ x: a.x, y: a.y });
    else if (mk === 'stravidiumore')      stPts.push({ x: a.x, y: a.y });
  }
  return {
    seed, zones,
    layers: {
      spice_large: spiceL, spice_medium: spiceM, spice_small: spiceS,
      titanium: ddClusterPts(tiPts), stravidium: ddClusterPts(stPts),
      cave: [], ecolab: [], shipwreck: [],
    },
  };
}

// POI (grottes/labos/épaves) depuis le .d.json gaming.tools — best-effort
let _ddPoiCache = {};
async function fetchDDPois(nn) {
  if (_ddPoiCache[nn]) return _ddPoiCache[nn];
  const world = 'deepdesert_1_' + String(nn).padStart(2, '0');
  try {
    const r = await fetch(`https://cdn-hosted.gaming.tools/dune/data/en/maps/${world}.d.json`);
    if (!r.ok) return null;
    const flat = await r.json();
    if (!Array.isArray(flat) || !flat[0]) return null;
    const root = ddFlatResolve(flat, 0, []);
    const locs = root.locations || [];
    const RANK = { Basic: 1, Rare: 2, UltraRare: 3 };
    const out = { cave: [], ecolab: [], shipwreck: [] };
    const sites = {};  // clé « nom|cellule » → site
    const keyOf = (name, gridCell) => (name || '') + '|' + (gridCell || '');

    // 1) SITES depuis les marqueurs (dédup nom+cellule : des grottes différentes
    //    partagent le même nom, ex. « Forgotten Cave » → ne PAS fusionner).
    //    `notable` = hasNotableLoot du marqueur = ce qui fait grossir l'icône
    //    chez gaming.tools (vérifié : 6 grottes A1 A5 A8 C3 C7 I5).
    for (const l of locs) {
      if ((l.locationType || '') !== 'marker') continue;
      if (!out[l.iconId]) continue;            // uniquement grottes/labos/épaves
      const loc = l.location;
      if (!loc || typeof loc !== 'object') continue;
      const key = keyOf(l.name, l.gridCell);
      let s = sites[key];
      if (!s) {
        s = sites[key] = {
          iconId: l.iconId, x: loc.x, y: loc.y,
          cell: ddCell(loc.x, loc.y), name: l.name || '',
          notable: false, tier: 0, unique: false, rarity: 0, _loot: {},
        };
      }
      if (l.hasNotableLoot) s.notable = true;
    }

    // 2) LOOT depuis les coffres, rattaché au site parent (nom+cellule)
    for (const l of locs) {
      if ((l.locationType || '') !== 'lootContainer') continue;
      const lt = l.lootTable || '';
      const isUnique = /Unique/.test(lt);
      const m = lt.match(/(UltraRare|Rare|Basic)_(Cave|Ecolab|Shipwreck)/);
      const tier = m ? RANK[m[1]] : 0;
      const lbl = isUnique ? 'Schéma unique' : (tier === 3 ? 'Coffre ultra-rare' : null);
      for (const p of (l.parentMarkers || [])) {
        if (!p || !p.name) continue;
        const s = sites[keyOf(p.name, p.gridCell)];
        if (!s) continue;                      // le parent doit exister comme marqueur
        if (tier > s.tier) s.tier = tier;
        if (isUnique) s.unique = true;
        if (lbl) s._loot[lbl] = true;
      }
    }

    // rarity ≥ 3 = ★ pépite (coffre Unique OU palier UltraRare)
    for (const s of Object.values(sites)) {
      s.rarity = (s.unique || s.tier >= 3) ? 3 : s.tier;
      s.loot = Object.keys(s._loot);
      delete s._loot;
      out[s.iconId].push(s);
    }
    _ddPoiCache[nn] = out;
    return out;
  } catch { return null; }
}

// Fetch direct navigateur (NON bloqué par Cloudflare, contrairement au serveur).
// Source principale : le serveur (proxy PHP) est bloqué par Cloudflare en 403,
// donc on récupère tout côté client avec le bon seed (= semaine en cours).
async function fetchActorsDirect() {
  const nn = currentActorSeed();
  let data = null;
  // nn = semaine en cours ; seed=0 = repli ultime si nn échoue totalement
  for (const seed of [nn, 0]) {
    try {
      const r = await fetch(`https://dune-api-v2.gaming.tools/actors?world=deepdesert_1&seed=${seed}`);
      if (!r.ok) continue;
      const actors = await r.json();
      if (Array.isArray(actors) && actors.length > 100) { data = processActors(nn, actors); break; }
    } catch { /* réseau, on essaie le suivant */ }
  }
  if (!data) return null;
  // POI (best-effort : n'empêche pas l'affichage de l'épice si indisponible)
  const pois = await fetchDDPois(nn);
  if (pois) Object.assign(data.layers, pois);
  return data;
}

let ddZoneLayer    = null;
let ddGridLayer    = null;
let ddOverlayShown = false;

const iconSet = {
  guilde: L.icon({ iconUrl: 'icons/guilde.png', iconSize: [48, 48], iconAnchor: [24, 48], popupAnchor: [0, -48] }),
  landsraad: L.icon({ iconUrl: 'icons/landsraad.png', iconSize: [48, 48], iconAnchor: [24, 48], popupAnchor: [0, -48] }),
  joueur: L.icon({ iconUrl: 'icons/joueur.png', iconSize: [48, 48], iconAnchor: [24, 48], popupAnchor: [0, -48] }),
  ressource: L.icon({ iconUrl: 'icons/ressource.png', iconSize: [48, 48], iconAnchor: [24, 48], popupAnchor: [0, -48] })
};

// === INITIALISATION ===
document.addEventListener("DOMContentLoaded", async () => {
  currentUser = localStorage.getItem("user");
  const role = localStorage.getItem("role");
  isAdmin = (role === "admin");

  if (!currentUser) {
    window.location.href = "index.html";
    return;
  }

  const userInfo = document.getElementById("user-info");
  if (userInfo) userInfo.innerText = `[${currentUser}] ${isAdmin ? 'Admin' : ''}`;

  await checkDeepDesertWipe();
  setupMapSwitcher();
  initMap();
  startStormTimer();

  if (isAdmin) createAdminPanel();
});

// === MODALES ===
function showCustomConfirm(title, message, onConfirm) {
    const overlay = document.getElementById('custom-modal-overlay');
    const titleEl = document.getElementById('modal-title');
    const msgEl = document.getElementById('modal-message');
    const inputEl = document.getElementById('modal-input');
    const btnConf = document.getElementById('modal-btn-confirm');
    const btnCanc = document.getElementById('modal-btn-cancel');

    titleEl.innerText = title;
    msgEl.innerHTML = message;
    msgEl.style.display = 'block';
    inputEl.style.display = 'none';
    document.getElementById('modal-select').style.display = 'none';
    overlay.style.display = 'flex';

    const newBtnConf = btnConf.cloneNode(true);
    btnConf.parentNode.replaceChild(newBtnConf, btnConf);
    const newBtnCanc = btnCanc.cloneNode(true);
    btnCanc.parentNode.replaceChild(newBtnCanc, btnCanc);

    newBtnConf.addEventListener('click', () => { overlay.style.display = 'none'; if(onConfirm) onConfirm(); });
    newBtnCanc.addEventListener('click', () => { overlay.style.display = 'none'; });
}

function showCustomPrompt(title, message, existingText, onConfirm) {
    const overlay = document.getElementById('custom-modal-overlay');
    const titleEl = document.getElementById('modal-title');
    const msgEl = document.getElementById('modal-message');
    const inputEl = document.getElementById('modal-input');
    const btnConf = document.getElementById('modal-btn-confirm');
    const btnCanc = document.getElementById('modal-btn-cancel');

    titleEl.innerText = title;
    msgEl.innerText = message;
    msgEl.style.display = 'block';
    inputEl.style.display = 'block';
    document.getElementById('modal-select').style.display = 'none';
    inputEl.value = existingText || "";
    overlay.style.display = 'flex';
    inputEl.focus(); 

    const newBtnConf = btnConf.cloneNode(true);
    btnConf.parentNode.replaceChild(newBtnConf, btnConf);
    const newBtnCanc = btnCanc.cloneNode(true);
    btnCanc.parentNode.replaceChild(newBtnCanc, btnCanc);

    newBtnConf.addEventListener('click', () => {
        const val = inputEl.value.trim();
        overlay.style.display = 'none';
        if(onConfirm) onConfirm(val);
    });
    newBtnCanc.addEventListener('click', () => { overlay.style.display = 'none'; });
    inputEl.onkeydown = function(e) { if(e.key === 'Enter') newBtnConf.click(); };
}

function showCustomSelect(title, message, options, defaultValue, onConfirm) {
    const overlay = document.getElementById('custom-modal-overlay');
    const titleEl = document.getElementById('modal-title');
    const msgEl = document.getElementById('modal-message');
    const inputEl = document.getElementById('modal-input');
    const selectEl = document.getElementById('modal-select');
    const btnConf = document.getElementById('modal-btn-confirm');
    const btnCanc = document.getElementById('modal-btn-cancel');

    titleEl.innerText = title;
    msgEl.innerText = message;
    msgEl.style.display = 'block';
    inputEl.style.display = 'none';
    selectEl.innerHTML = options.map(o => `<option value="${o}"${o === defaultValue ? ' selected' : ''}>${o}</option>`).join('');
    selectEl.style.display = 'block';
    overlay.style.display = 'flex';

    const newBtnConf = btnConf.cloneNode(true);
    btnConf.parentNode.replaceChild(newBtnConf, btnConf);
    const newBtnCanc = btnCanc.cloneNode(true);
    btnCanc.parentNode.replaceChild(newBtnCanc, btnCanc);

    newBtnConf.addEventListener('click', () => {
        const val = selectEl.value;
        selectEl.style.display = 'none';
        overlay.style.display = 'none';
        if (onConfirm) onConfirm(val);
    });
    newBtnCanc.addEventListener('click', () => {
        selectEl.style.display = 'none';
        overlay.style.display = 'none';
    });
}

// === LOGIQUE ===
async function checkDeepDesertWipe() {
    try {
        const res = await fetch("save.php", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "checkWipe" })
        });
        const json = await res.json();
        if (json.ok && json.message.includes("effectué")) console.log("Wipe Deep Desert appliqué.");
    } catch (e) {}
}

function startStormTimer() { updateTimer(); timerInterval = setInterval(updateTimer, 1000); }
function updateTimer() {
    const now = new Date();
    const day = now.getDay(); 
    const hour = now.getHours();
    let target = new Date(now);
    target.setHours(5, 0, 0, 0);
    if (day === 2 && hour < 5) {} 
    else {
        let daysToAdd = (2 - day + 7) % 7;
        if (daysToAdd === 0 && (day !== 2 || hour >= 5)) daysToAdd = 7;
        target.setDate(now.getDate() + daysToAdd);
    }
    const diff = target - now;
    const d = Math.floor(diff / (1000 * 60 * 60 * 24));
    const h = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const s = Math.floor((diff % (1000 * 60)) / 1000);
    const timerText = document.getElementById("timer-text");
    if (timerText) timerText.innerText = "Tempête : " + (d > 0 ? `${d}j ` : "") + `${h}h ${m}m ${s}s`;
}

function initMap() {
  map = L.map("map", { crs: L.CRS.Simple, minZoom: -5, maxZoom: 2, zoomControl: false, attributionControl: false });
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  loadMapLayer(currentMapId);
  map.on("click", (e) => {
    selectedCoords = e.latlng;
    if (isAdmin) {
      const d = document.getElementById("coordDisplay");
      if(d) d.innerText = `Coords : ${selectedCoords.lat.toFixed(0)}, ${selectedCoords.lng.toFixed(0)}`;
    } else {
      addOrReplaceOwnBase(selectedCoords.lat, selectedCoords.lng);
    }
  });
}

function setupMapSwitcher() {
  document.querySelectorAll('.map-switch-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.map-switch-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      const newMapId = e.target.dataset.map;
      if (newMapId !== currentMapId) {
        currentMapId = newMapId;
        loadMapLayer(currentMapId);
        if(document.getElementById("player-panel").classList.contains("visible")) togglePlayerPanel();
      }
    });
  });
}

// ── Grille A1-I9 pour la Deep Desert ─────────────────────────────────────────
function createDDGrid() {
  const ROWS  = ['A','B','C','D','E','F','G','H','I']; // 0=A bas, 8=I haut
  const cellW = 6144 / 9;   // ≈ 682.7
  const cellH = 6120 / 9;   // = 680
  const group = L.layerGroup();

  // Lignes horizontales
  for (let r = 0; r <= 9; r++) {
    L.polyline([[r * cellH, 0], [r * cellH, 6144]], {
      color: 'rgba(255,255,255,0.18)', weight: 1, interactive: false
    }).addTo(group);
  }
  // Lignes verticales
  for (let c = 0; c <= 9; c++) {
    L.polyline([[0, c * cellW], [6120, c * cellW]], {
      color: 'rgba(255,255,255,0.18)', weight: 1, interactive: false
    }).addTo(group);
  }
  // Étiquettes — coin supérieur-gauche (à l'écran) de chaque cellule
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      // lat bas = bas écran ; coin bas-gauche de chaque cellule (comme dune.gaming.tools)
      const labelLat = r * cellH + cellH * 0.1;
      const labelLng = c * cellW + cellW * 0.03;
      L.marker([labelLat, labelLng], {
        icon: L.divIcon({
          className: 'dd-grid-label',
          html: `${ROWS[r]}${c + 1}`,
          iconSize:   [30, 14],
          iconAnchor: [0, 14],
        }),
        interactive: false,
        keyboard:    false,
        zIndexOffset: -1000,
      }).addTo(group);
    }
  }
  return group;
}

async function loadMapLayer(mapId) {
  const config = mapConfig[mapId];
  const timerDiv = document.getElementById("storm-timer");
  if (timerDiv) {
      if (mapId === 'deep_desert') timerDiv.classList.add('visible');
      else timerDiv.classList.remove('visible');
  }

  updateSietchUI(mapId);

  if (currentLayer) { map.removeLayer(currentLayer); currentLayer = null; }

  // Retirer l'overlay DD, la grille ET les couches de marqueurs (épice, filons,
  // POI) si on quitte la Deep Desert — sinon ils restent affichés sur Hagga.
  if (mapId !== 'deep_desert') {
    if (ddZoneLayer)  { map.removeLayer(ddZoneLayer);  ddZoneLayer = null; }
    if (ddGridLayer)  { map.removeLayer(ddGridLayer);  ddGridLayer = null; }
    for (const id in ddLayerGroups) {
      if (ddLayerGroups[id]) map.removeLayer(ddLayerGroups[id]);
    }
    ddLayerGroups = {};
    ddOverlayShown = false;
  }

  if (config.image) {
      // Cache-buster : on utilise le seed DD courant (mis à jour chaque mardi par dd_map_update.php)
      const ddSeed  = window._ddCurrentSeed || estimateDDSeed();
      const imgUrl  = mapId === 'deep_desert'
          ? config.image.replace(/\?.*$/, '') + '?v=' + ddSeed
          : config.image;
      currentLayer = L.imageOverlay(imgUrl, config.bounds, { zIndex: 1 }).addTo(map);
      map.fitBounds(config.bounds);
  }

  markers.forEach(m => map.removeLayer(m.marker));
  markers = [];
  await fetchAndDisplayBases();

  // Grille A1-I9 et overlay zones PVP/PVE en Deep Desert
  if (mapId === 'deep_desert') {
    if (ddGridLayer) { map.removeLayer(ddGridLayer); ddGridLayer = null; }
    ddGridLayer = createDDGrid().addTo(map);
    buildDDFilterBar();            // barre visible immédiatement (comptes ajoutés au chargement)
    if (!ddOverlayShown) loadDDOverlay();
  }
}

function updateSietchUI(mapId) {
  const sietchContainer = document.getElementById('sietch-selector-container');
  const ddLegend = document.getElementById('dd-legend');
  const ddFilters = document.getElementById('dd-filter-bar');
  if (sietchContainer) sietchContainer.style.display = (mapId === 'hagga') ? 'flex' : 'none';
  if (ddLegend) ddLegend.style.display = (mapId === 'deep_desert') ? 'flex' : 'none';
  if (ddFilters) ddFilters.style.display = (mapId === 'deep_desert') ? 'flex' : 'none';
}

// === COUCHES FILTRABLES (style method.gg) ===================================
// Icônes officielles du jeu (CDN gaming.tools, accessibles depuis les navigateurs)
const CDN_ICONS = 'https://cdn-hosted.gaming.tools/dune/images/map-icons';

// Couches affichables sur la Deep Desert. `on` = visible par défaut à l'ouverture.
// `cluster` = filons regroupés en concentrations ; `threshold` = ne garder que les
// concentrations de plus de N nœuds. `rare` = grottes/labos/épaves dont les
// rares/ultra-rares sont mis en avant (anneau coloré + ★).
const DD_LAYERS = [
  { id: 'spice_large',  label: "Grand champ d'épice",   icon: 'spicefieldlarge',  size: 64, on: true  },
  { id: 'spice_medium', label: "Champ d'épice moyen",   icon: 'spicefieldmedium', size: 24, on: false },
  { id: 'titanium',     label: 'Titane (grosse concentration > 70)',     icon: 'titaniumore',   size: 54, on: true, cluster: true, threshold: 70 },
  { id: 'stravidium',   label: 'Stravidium (grosse concentration > 70)', icon: 'stravidiumore', size: 54, on: true, cluster: true, threshold: 70 },
  { id: 'ecolab',       label: 'Labos (pépites surlignées)', icon: 'ecolab',     size: 52, on: true,  rare: true },
  { id: 'cave',         label: 'Grottes (pépites surlignées)', icon: 'cave',   size: 52, on: false, rare: true },
  { id: 'shipwreck',    label: 'Épaves (pépites surlignées)',  icon: 'shipwreck', size: 54, on: false, rare: true },
];

let ddLayerGroups  = {};   // id → L.layerGroup
let ddLayerVisible = null;  // id → bool (persisté)
let _ddLastData    = null;  // dernières données rendues (pour re-render filtre global)
let ddStarredOnly  = (() => { try { return localStorage.getItem('ddStarredOnly') === '1'; } catch { return false; } })();

function loadDDFilterState() {
  if (ddLayerVisible) return ddLayerVisible;
  ddLayerVisible = {};
  let saved = {};
  // Clé versionnée (V2) : ignore l'ancien état sauvegardé pour appliquer les
  // nouveaux défauts (épice large + titane + stravidium + labos).
  try { saved = JSON.parse(localStorage.getItem('ddFiltersV2') || '{}'); } catch {}
  for (const L0 of DD_LAYERS) {
    ddLayerVisible[L0.id] = (L0.id in saved) ? !!saved[L0.id] : L0.on;
  }
  return ddLayerVisible;
}
function saveDDFilterState() {
  try { localStorage.setItem('ddFiltersV2', JSON.stringify(ddLayerVisible)); } catch {}
}

// Icône d'un marqueur : pastille de comptage (concentration de filons),
// anneau doré pour un site notable (★ si coffre Unique/UltraRare) ou icône simple.
function ddMakeIcon(layer, item) {
  const url = `${CDN_ICONS}/${layer.icon}.webp`;
  let   s   = layer.size;
  const count  = item.count  || 1;
  const rarity = item.rarity || 0;
  if (layer.cluster && count > 1) {
    return L.divIcon({
      className: 'dd-cluster-icon',
      html: `<img src="${url}" width="${s}" height="${s}"><span class="dd-cluster-badge">${count}</span>`,
      iconSize:   [s, s],
      iconAnchor: [s / 2, s / 2],
    });
  }
  if (rarity >= 3) {  // site mis en avant : anneau doré + ★
    const col = '#f3c44f';
    return L.divIcon({
      className: 'dd-rare-icon',
      html: `<span class="dd-rare-ring" style="border-color:${col};box-shadow:0 0 8px ${col}"><img src="${url}" width="${s - 8}" height="${s - 8}"><span class="dd-rare-star">★</span></span>`,
      iconSize:   [s, s],
      iconAnchor: [s / 2, s / 2],
    });
  }
  // POI ordinaire (ni pépite ni notable) : plus petit. Un site `notable`
  // (hasNotableLoot) garde la pleine taille → effet « gros icône » de gaming.tools.
  if (layer.rare && !item.notable) s = Math.round(s * 0.6);
  return L.icon({ iconUrl: url, iconSize: [s, s], iconAnchor: [s / 2, s / 2], popupAnchor: [0, -s / 2] });
}

// Rendu zones PVP/PVE + toutes les couches de marqueurs à partir des données proxy
function renderDDData(data) {
  if (ddZoneLayer) map.removeLayer(ddZoneLayer);
  ddZoneLayer = L.layerGroup();

  const ZONE_STYLES = {
    NullSec:  { color: '#cc2222', fillColor: '#cc2222', fillOpacity: 0.18, weight: 1.5, opacity: 0.7 },
    Security: { color: '#2255cc', fillColor: '#2255cc', fillOpacity: 0.12, weight: 1,   opacity: 0.5 },
  };
  const ZONE_LABELS = { NullSec: '⚔ PVP (NullSec)', Security: '🛡 PVE (Security)' };

  let zoneCount = 0;
  for (const zone of (data.zones || [])) {
    if (!zone.bounds || zone.bounds.length < 2) continue;
    const pts  = zone.bounds.map(b => gameToLeaflet(b.x, b.y));
    const lats = pts.map(p => p.lat);
    const lngs = pts.map(p => p.lng);
    const sw   = L.latLng(Math.min(...lats), Math.min(...lngs));
    const ne   = L.latLng(Math.max(...lats), Math.max(...lngs));
    L.rectangle([sw, ne], ZONE_STYLES[zone.zoneType] || ZONE_STYLES.Security)
      .bindTooltip(ZONE_LABELS[zone.zoneType] || zone.zoneType, { sticky: true, className: 'dd-zone-tooltip' })
      .addTo(ddZoneLayer);
    zoneCount++;
  }
  ddZoneLayer.addTo(map);

  // Couches de marqueurs (épice, filons, POI) — rétro-compat : si pas de
  // `layers`, on retombe sur l'ancien `resources` (= grands champs d'épice).
  _ddLastData   = data;
  const visible = loadDDFilterState();
  const layers  = data.layers || { spice_large: (data.resources || []).map(r => ({ x: r.x, y: r.y })) };
  const counts  = {};

  for (const L0 of DD_LAYERS) {
    if (ddLayerGroups[L0.id]) { map.removeLayer(ddLayerGroups[L0.id]); }
    const grp  = L.layerGroup();
    let list   = layers[L0.id] || [];
    // Filons : ne garder que les grosses concentrations (> threshold nœuds)
    if (L0.threshold) list = list.filter(it => (it.count || 1) > L0.threshold);
    // Filtre global « pépites uniquement » : sur les POI, ne garder que les ★
    if (ddStarredOnly && L0.rare) list = list.filter(it => (it.rarity || 0) >= 3);
    counts[L0.id] = list.length;
    for (const it of list) {
      const pos   = gameToLeaflet(it.x, it.y);
      const cell  = it.cell || 'ABCDEFGHI'[Math.min(8, Math.floor(pos.lat / (DD_IMG_H / 9)))] + Math.min(9, Math.floor(pos.lng / (DD_IMG_W / 9)) + 1);
      const cnt   = it.count || 1;
      const rar   = it.rarity || 0;
      // estompé uniquement si POI ordinaire (ni pépite ★ ni notable « gros »)
      const faded = L0.rare && rar < 3 && !it.notable;
      let label   = L0.label;
      if (L0.cluster && cnt > 1) label += ` — ${cnt} nœuds`;
      if (rar >= 3) label += ' — ★ ' + ((it.loot && it.loot.length) ? it.loot.join(' + ') : 'loot rare');
      else if (it.notable) label += ' — site notable';
      if (it.name) label += ` — ${it.name}`;
      label += ` — cellule ${cell}`;
      L.marker(pos, { icon: ddMakeIcon(L0, it), opacity: faded ? 0.78 : 1, zIndexOffset: rar >= 3 ? 20 : (it.notable ? 15 : (L0.cluster ? 5 : 10)) })
        .bindTooltip(label, { sticky: true, className: 'dd-zone-tooltip' })
        .addTo(grp);
    }
    ddLayerGroups[L0.id] = grp;
    // Le filtre ★ ne fait que RESTREINDRE les catégories déjà affichées (il
    // n'en force aucune) : si seules les grottes sont actives, ★ ne montre que
    // les grottes étoilées, pas toutes les catégories.
    if (visible[L0.id]) grp.addTo(map);
  }

  buildDDFilterBar(counts);
  ddOverlayShown = true;
  return { zoneCount, counts };
}

// Re-rendu des couches POI sans refetch (bascule du filtre global)
function ddRerender() {
  if (_ddLastData) renderDDData(_ddLastData);
}

// Barre de filtres à icônes (boutons ronds cliquables, façon method.gg)
function buildDDFilterBar(counts) {
  const bar = document.getElementById('dd-filter-bar');
  if (!bar) return;
  bar.innerHTML = '';
  const visible = loadDDFilterState();
  for (const L0 of DD_LAYERS) {
    const n   = counts ? (counts[L0.id] || 0) : 0;
    const btn = document.createElement('button');
    btn.className = 'dd-filter-btn' + (visible[L0.id] ? ' active' : '');
    btn.title = `${L0.label}${n ? ' (' + n + ')' : ''}`;
    btn.innerHTML = `<img src="${CDN_ICONS}/${L0.icon}.webp" alt="">`;
    btn.addEventListener('click', () => {
      visible[L0.id] = !visible[L0.id];
      const grp = ddLayerGroups[L0.id];
      if (grp) { visible[L0.id] ? grp.addTo(map) : map.removeLayer(grp); }
      btn.classList.toggle('active', visible[L0.id]);
      saveDDFilterState();
    });
    bar.appendChild(btn);
  }

  // Bouton global « pépites uniquement » (★) : ne laisse que les sites à loot
  // ultra-rare/unique, toutes catégories de POI confondues.
  const starBtn = document.createElement('button');
  starBtn.className = 'dd-filter-btn dd-filter-star' + (ddStarredOnly ? ' active' : '');
  starBtn.title = 'Pépites uniquement (sites à loot ultra-rare / schéma unique)';
  starBtn.innerHTML = '<span style="font-size:22px;line-height:1;color:#f3c44f">★</span>';
  starBtn.addEventListener('click', () => {
    ddStarredOnly = !ddStarredOnly;
    try { localStorage.setItem('ddStarredOnly', ddStarredOnly ? '1' : '0'); } catch {}
    starBtn.classList.toggle('active', ddStarredOnly);
    ddRerender();
  });
  bar.appendChild(starBtn);

  bar.style.display = 'flex';
}

async function loadDDOverlay() {
  const statusEl = document.getElementById('dd-overlay-status');
  if (statusEl) statusEl.textContent = '⏳ Chargement des zones…';

  let data = null;
  let fromProxy = false;

  // ── 1. Fetch direct navigateur (PRINCIPAL) ───────────────────────────────
  // Le serveur (proxy PHP) est bloqué par Cloudflare (403). Le navigateur, lui,
  // passe : on récupère donc tout côté client avec le bon seed (semaine en cours).
  data = await fetchActorsDirect();

  // ── 2. Repli : proxy PHP (sert un cache s'il a pu en constituer un) ───────
  if (!data) {
    if (statusEl) statusEl.textContent = '⏳ Tentative via le serveur…';
    try {
      const r = await fetch('dd_proxy.php');
      if (r.ok) {
        const json = await r.json();
        if (!json.error && (json.layers || json.zones)) { data = json; fromProxy = true; }
      }
    } catch { /* proxy indisponible */ }
  }

  if (!data) {
    if (statusEl) statusEl.textContent = '⚠ Zones non disponibles';
    console.warn('[DD overlay] Impossible de récupérer les données.');
    return;
  }

  window._ddCurrentSeed = data.seed;
  const { zoneCount, counts } = renderDDData(data);
  if (statusEl) {
    const src      = fromProxy ? '📦 proxy' : '🌐 direct';
    const nbSpice  = (counts && counts.spice_large) || 0;
    statusEl.textContent = `✅ Seed #${data.seed} — ${zoneCount} zones · ${nbSpice} grands champs (${src})`;
    statusEl.style.color = '';
  }
}

function reloadBases() {
  markers.forEach(m => map.removeLayer(m.marker));
  markers = [];
  return fetchAndDisplayBases();
}

function createInstanceIcon(type, instance) {
  const baseIcon = iconSet[type] || iconSet.joueur;
  if (!instance) return baseIcon;
  const color = instance === 'pvp' ? '#cc2222' : '#2255cc';
  return L.divIcon({
    className: '',
    html: `<div style="position:relative;width:48px;height:48px;">
             <img src="${baseIcon.options.iconUrl}" width="48" height="48" style="display:block;">
             <div style="position:absolute;top:2px;right:2px;width:13px;height:13px;background:${color};border-radius:50%;border:2px solid #fff;box-shadow:0 0 4px rgba(0,0,0,0.8);"></div>
           </div>`,
    iconSize: [48, 48],
    iconAnchor: [24, 48],
    popupAnchor: [0, -48]
  });
}

function renderSietchQuickBtns(sietchsWithBases, countsBySietch = {}) {
  const container = document.getElementById('sietch-quick-btns');
  if (!container) return;
  container.innerHTML = '';
  // Bouton "Tous"
  const total = Object.values(countsBySietch).reduce((a, b) => a + b, 0);
  const allBtn = document.createElement('button');
  allBtn.className = 'sietch-quick-btn' + (!currentSietch ? ' active' : '');
  allBtn.innerHTML = `Tous <span style="
    display:inline-flex;align-items:center;justify-content:center;
    min-width:18px;height:18px;padding:0 4px;
    background:rgba(0,0,0,0.45);border-radius:9px;
    font-size:10px;font-weight:700;margin-left:4px;
    color:inherit;line-height:1;">${total}</span>`;
  allBtn.title = 'Afficher tous les sietchs';
  allBtn.onclick = () => {
    currentSietch = null;
    const sel = document.getElementById('sietch-select');
    if (sel) sel.value = '';
    reloadBases();
  };
  container.appendChild(allBtn);

  sietchsWithBases.forEach(sietch => {
    const btn = document.createElement('button');
    btn.className = 'sietch-quick-btn' + (sietch === currentSietch ? ' active' : '');
    const label = sietch.replace('Sietch ', '');
    const count = countsBySietch[sietch] || 0;
    btn.innerHTML = `${label} <span style="
      display:inline-flex;align-items:center;justify-content:center;
      min-width:18px;height:18px;padding:0 4px;
      background:rgba(0,0,0,0.45);border-radius:9px;
      font-size:10px;font-weight:700;margin-left:4px;
      color:inherit;line-height:1;">${count}</span>`;
    btn.title = sietch;
    btn.onclick = () => {
      currentSietch = (currentSietch === sietch) ? null : sietch;
      const sel = document.getElementById('sietch-select');
      if (sel) sel.value = currentSietch || '';
      reloadBases();
    };
    container.appendChild(btn);
  });
}

async function fetchAndDisplayBases() {
  try {
      const response = await fetch("bases.json?ts=" + Date.now());
      const allBases = await response.json();

      let currentMapBases = allBases.filter(b => (b.map || 'hagga') === currentMapId);

      if (currentMapId === 'hagga') {
        // Boutons rapides : sietchs qui ont au moins une base
        const haggaBases = allBases.filter(b => (b.map || 'hagga') === 'hagga' && b.sietch);
        const sietchsWithBases = [...new Set(haggaBases.map(b => b.sietch))].sort();
        const countsBySietch = {};
        haggaBases.forEach(b => { countsBySietch[b.sietch] = (countsBySietch[b.sietch] || 0) + 1; });
        renderSietchQuickBtns(sietchsWithBases, countsBySietch);

        // Filtre par sietch sélectionné
        if (currentSietch) {
          currentMapBases = currentMapBases.filter(b => b.sietch === currentSietch);
        }
      }

      currentMapBases.forEach(b => addMarker(b.user, b.x, b.y, b.type, b.note, b.sietch || '', b.instance || ''));

      // Auto-focus depuis l'URL
      const urlParams = new URLSearchParams(window.location.search);
      const focusUser = urlParams.get('focus');
      if (focusUser) {
          setTimeout(() => { highlightBase(focusUser); }, 500);
          window.history.replaceState({}, document.title, window.location.pathname);
      }

  } catch (e) { console.error("Erreur chargement bases:", e); }
}
function addMarker(user, x, y, type = "joueur", note = "", sietch = "", instance = "") {
  const icon = (currentMapId === 'deep_desert' && instance)
    ? createInstanceIcon(type, instance)
    : (iconSet[type] || iconSet.joueur);
  const isOwner = (user === currentUser);
  const canEdit = isOwner || isAdmin;
  const deleteBtn = canEdit ? `<br><button class="delete-btn" onclick="removeBasePrompt('${user}', ${x}, ${y})">🗑 Supprimer</button>` : "";

  let instanceBadge = '';
  if (instance) {
    const col = instance === 'pvp' ? '#cc2222' : '#2255cc';
    instanceBadge = ` <span style="color:${col};font-size:11px;font-weight:bold;">[${instance.toUpperCase()}]</span>`;
  }
  let popupContent = `<b>${user}</b>${instanceBadge}`;
  if (sietch) popupContent += `<br><small style="color:#a67c33">${sietch}</small>`;
  popupContent += `<br><small>${type}</small>`;

  const safeUser = user.replace(/'/g, "\\'");
  const safeNote = note ? note.replace(/'/g, "&apos;") : "";

  if (note) {
      const clickAction = canEdit ? `onclick="editBaseNote('${safeUser}', ${x}, ${y}, '${safeNote}')"` : "";
      const classEditable = canEdit ? "editable-note" : "";
      const titleAttr = canEdit ? "title='Cliquez pour modifier'" : "";
      popupContent += `<br><span class="base-note ${classEditable}" ${clickAction} ${titleAttr}>Note : ${note}</span>`;
  } else if (canEdit) {
      popupContent += `<br><span class="base-note-add" onclick="editBaseNote('${safeUser}', ${x}, ${y}, '')">+ Ajouter une note</span>`;
  }
  popupContent += deleteBtn;

  let tooltipContent = `<div>${user}</div>`;
  if (sietch) tooltipContent += `<div class="tooltip-subtext">${sietch}</div>`;
  if (instance) tooltipContent += `<div class="tooltip-subtext">${instance.toUpperCase()}</div>`;
  if (note && note.trim() !== "") tooltipContent += `<div class="tooltip-subtext">${note}</div>`;

  const m = L.marker([x, y], { icon }).addTo(map)
    .bindPopup(popupContent)
    .bindTooltip(tooltipContent, { permanent: false, direction: 'top', offset: [0, -40], className: 'base-tooltip' });

  attachHoverSound(m);
  markers.push({ user, x, y, type, map: currentMapId, marker: m });
}

window.editBaseNote = function(user, x, y, currentNote) {
    showCustomPrompt("NOTE", "Modifier la note :", currentNote, async function(newNote) {
        if (newNote.trim() === currentNote) return; 
        const payload = { action: "updateNote", user: user, x: x, y: y, note: newNote.trim() };
        try {
            const res = await fetch("save.php", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
            const json = await res.json();
            if (json.ok) loadMapLayer(currentMapId);
            else alert("Erreur : " + (json.error || "Inconnue"));
        } catch (e) { alert("Erreur réseau."); }
    });
};

async function addOrReplaceOwnBase(x, y) {
  if (currentMapId === 'hagga') {
    await addOrReplaceHaggaBase(x, y);
  } else if (currentMapId === 'deep_desert') {
    await addOrReplaceDeepDesertBase(x, y);
  }
}

async function addOrReplaceHaggaBase(x, y) {
  const res = await fetch("bases.json?ts=" + Date.now());
  const all = await res.json();
  const myBases = all.filter(b => b.user === currentUser && (b.map || 'hagga') === 'hagga');

  const doPlace = (sietch) => {
    showCustomPrompt("NOTE", "Ajouter une note ? (Optionnel)", "", (note) => {
      saveBase(currentUser, x, y, "joueur", note, sietch, '');
    });
  };

  const askSietch = (then) => {
    showCustomSelect("SIETCH", "Dans quel sietch vous installez-vous ?", SIETCHS, currentSietch || SIETCHS[0], then);
  };

  if (myBases.length >= 1) {
    showCustomConfirm("DÉPLACEMENT", "Vous avez déjà une base.<br>Voulez-vous la déplacer ici ?", async () => {
      await removeBase(currentUser, myBases[0].x, myBases[0].y);
      askSietch(doPlace);
    });
  } else {
    showCustomConfirm("NOUVELLE BASE", "Placer votre base ici ?", () => {
      askSietch(doPlace);
    });
  }
}

async function addOrReplaceDeepDesertBase(x, y) {
  showCustomSelect("INSTANCE", "Dans quelle instance du Deep Desert ?", ["PVP", "PVE"], "PVP", async (instanceLabel) => {
    const instance = instanceLabel.toLowerCase();
    const res = await fetch("bases.json?ts=" + Date.now());
    const all = await res.json();
    const myBases = all.filter(b =>
      b.user === currentUser && (b.map || 'hagga') === 'deep_desert' && (b.instance || '') === instance
    );

    const doPlace = () => {
      showCustomPrompt("NOTE", "Ajouter une note ? (Optionnel)", "", (note) => {
        saveBase(currentUser, x, y, "joueur", note, '', instance);
      });
    };

    if (myBases.length >= 1) {
      showCustomConfirm("DÉPLACEMENT", `Vous avez déjà une base en ${instanceLabel}.<br>Voulez-vous la déplacer ici ?`, async () => {
        await removeBase(currentUser, myBases[0].x, myBases[0].y);
        doPlace();
      });
    } else {
      showCustomConfirm("NOUVELLE BASE", `Placer votre base en ${instanceLabel} ici ?`, doPlace);
    }
  });
}

async function saveBase(user, x, y, type, note = "", sietch = "", instance = "") {
  const payload = { action: "add", user, x, y, type, mapId: currentMapId, note, sietch, instance };
  const res = await fetch("save.php", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify(payload) });
  const json = await res.json();
  if(json.ok) loadMapLayer(currentMapId);
  else alert("Erreur: " + json.error);
}

function removeBasePrompt(u, x, y) { showCustomConfirm("SUPPRESSION", "Voulez-vous vraiment supprimer cette base ?", () => { removeBase(u, x, y); }); }
async function removeBase(u, x, y) {
  await fetch("save.php", { method: "POST", body: JSON.stringify({ action: "remove", user: u, x, y }) });
  loadMapLayer(currentMapId);
}

// === ADMIN PANEL ===
function createAdminPanel() {
  const toggleBtn = document.getElementById("admin-toggle");
  if(toggleBtn) {
      toggleBtn.style.display = "flex";
      toggleBtn.onclick = () => {
          const panel = document.querySelector(".admin-panel");
          if(panel) panel.classList.toggle("visible");
      };
  }

  const p = document.createElement("div");
  p.className = "admin-panel"; 
  p.innerHTML = `
    <h3>Gestion Admin</h3>
    <div class="admin-row"><input type="text" id="baseName" placeholder="Nom (Joueur/POI)"></div>
    <div class="admin-row">
      <select id="baseType">
        <option value="joueur">🏠 Joueur</option>
        <option value="guilde">🏯 Guilde</option>
        <option value="landsraad">🏛 Landsraad</option>
        <option value="ressource">💧 Ressource</option>
      </select>
    </div>
    <div class="admin-row"><input type="text" id="baseNote" placeholder="Note (ex: Petit gisement)"></div>
    
    <button id="addBaseBtn">Ajouter Base</button>
    <div style="margin:10px 0; border-top:1px solid #5c4025;"></div>
    <button id="manageUsersBtn">👥 Gérer Utilisateurs</button>
    <p id="coordDisplay" style="margin-top:10px;font-size:11px;color:#d3b46f;text-align:center;">Cliquez sur la carte...</p>
  `;
  document.body.appendChild(p);
  
  document.getElementById("addBaseBtn").onclick = () => {
    if(!selectedCoords) return alert("Cliquez sur la carte !");
    const n = document.getElementById("baseName").value.trim();
    const type = document.getElementById("baseType").value;
    const note = document.getElementById("baseNote").value.trim();
    if(!n) return;

    if (currentMapId === 'deep_desert') {
      showCustomSelect("INSTANCE", "Dans quelle instance du Deep Desert ?", ["PVP", "PVE"], "PVP", (instanceLabel) => {
        saveBase(n, selectedCoords.lat, selectedCoords.lng, type, note, '', instanceLabel.toLowerCase());
      });
    } else if (currentMapId === 'hagga') {
      showCustomSelect("SIETCH", "Dans quel sietch ?", SIETCHS, currentSietch || SIETCHS[0], (sietch) => {
        saveBase(n, selectedCoords.lat, selectedCoords.lng, type, note, sietch, '');
      });
    } else {
      saveBase(n, selectedCoords.lat, selectedCoords.lng, type, note);
    }
  };
  document.getElementById("manageUsersBtn").onclick = openUserManager;
}

// === USER MANAGER ===
let userPanel;
async function openUserManager() {
  if(userPanel) { userPanel.remove(); userPanel=null; return; }
  try {
      const res = await fetch("get_users.php?ts=" + Date.now());
      if (!res.ok) throw new Error("Erreur accès (403/404)");
      const users = await res.json();
      users.sort((a, b) => {
          if (a.role === 'admin' && b.role !== 'admin') return -1;
          if (a.role !== 'admin' && b.role === 'admin') return 1;
          return a.user.localeCompare(b.user, undefined, { sensitivity: 'base' });
      });
      userPanel = document.createElement("div");
      userPanel.className = "admin-panel visible"; 
      userPanel.style.right = "340px";
      userPanel.style.zIndex = "1100";
      userPanel.innerHTML = `<div style="display:flex;justify-content:space-between;margin-bottom:10px;"><h3 style="margin:0;border:none;">Utilisateurs</h3><button class="small-btn" style="width:20px;background:#a83b3b;" onclick="closeUserManager()">X</button></div>`;
      if (!users || users.length === 0) {
          userPanel.innerHTML += "<div style='padding:10px; font-style:italic;'>Aucun utilisateur trouvé ou accès refusé.</div>";
      } else {
          users.forEach(u => {
            const isAdmin = u.role === 'admin';
            const safe = u.user.replace(/'/g, "\\'");
            userPanel.innerHTML += `
              <div class="user-row">
                <div style="display:flex;justify-content:space-between;font-size:13px;">
                  <span style="font-weight:bold;color:${isAdmin?'#f3c44f':'#f5deb3'}">${u.user}</span>
                  <span>${u.role}</span>
                </div>
                <div style="display:flex;gap:5px;margin-top:4px;">
                  <button class="small-btn" onclick="toggleRole('${safe}','${u.role}')" style="flex:1;background:${isAdmin?'#8b6e3b':'#4a6b3b'}">${isAdmin?'Rétrograder':'Promouvoir'}</button>
                  <button class="small-btn" onclick="deleteUser('${safe}')" style="background:#a83b3b;width:30px;">🗑</button>
                </div>
              </div>`;
          });
      }
      document.body.appendChild(userPanel);
  } catch (e) { console.error(e); alert("Erreur : Impossible de charger la liste des utilisateurs."); }
}

window.closeUserManager = () => { if(userPanel) userPanel.remove(); userPanel=null; };
window.toggleRole = async (t, r) => {
  const nr = r === 'admin' ? 'user' : 'admin';
  const res = await fetch("save.php", { method:"POST", body:JSON.stringify({action:"updateRole", target:t, role:nr}) });
  const j = await res.json();
  if(j.ok) { closeUserManager(); openUserManager(); } else alert(j.error);
};
window.deleteUser = async (t) => {
  showCustomConfirm("ADMIN", "Supprimer l'utilisateur "+t+" ?", async () => {
      const res = await fetch("save.php", { method:"POST", body:JSON.stringify({action:"deleteUser", target:t}) });
      const j = await res.json();
      if(j.ok) { closeUserManager(); openUserManager(); loadMapLayer(currentMapId); } else alert(j.error);
  });
};

// === LISTE JOUEURS ===
async function togglePlayerPanel() {
  const p = document.getElementById("player-panel");
  if(p.classList.contains("visible")) { p.classList.remove("visible"); return; }
  const res = await fetch("bases.json?ts=" + Date.now());
  const allBases = await res.json();
  const mapBases = allBases.filter(b => (b.map || 'hagga') === currentMapId);
  const list = document.getElementById("player-list");
  list.innerHTML = "";
  if (mapBases.length === 0) {
      list.innerHTML = "<div style='font-style:italic; padding:5px;'>Aucune base...</div>";
      p.classList.add("visible");
      return;
  }
  const categories = [ { id: 'guilde', label: 'Bases Guilde' }, { id: 'landsraad', label: 'Bases Landsraad' }, { id: 'joueur', label: 'Bases Joueurs' }, { id: 'ressource', label: 'Ressources' } ];
  categories.forEach(cat => {
      const items = mapBases.filter(b => b.type === cat.id);
      if (items.length > 0) {
          const header = document.createElement("div");
          header.className = "category-header";
          header.innerText = cat.label;
          list.appendChild(header);
          const uniqueNames = [...new Set(items.map(b => b.user))];
          uniqueNames.sort((a, b) => a.localeCompare(b));
          uniqueNames.forEach(name => {
              const playerBase = items.find(b => b.user === name);
              const playerSietch = playerBase ? (playerBase.sietch || '') : '';
              const d = document.createElement("div");
              d.className = "player-item";
              // Affiche le sietch en sous-titre si Hagga
              if (currentMapId === 'hagga' && playerSietch) {
                d.innerHTML = `<span>${name}</span><br><small style="color:#a67c33;font-size:10px;">${playerSietch.replace('Sietch ', '')}</small>`;
              } else {
                d.innerText = name;
              }
              d.onclick = async () => {
                if (currentMapId === 'hagga' && playerSietch && playerSietch !== currentSietch) {
                  currentSietch = playerSietch;
                  const sel = document.getElementById('sietch-select');
                  if (sel) sel.value = currentSietch;
                  await reloadBases();
                }
                highlightBase(name);
              };
              list.appendChild(d);
          });
      }
  });
  p.classList.add("visible");
}

function highlightBase(user) {
  const entry = markers.find(m => m.user === user);
  if (entry) {
    map.flyTo(entry.marker.getLatLng(), map.getZoom(), { duration: 0.5 });
    setTimeout(() => entry.marker.openPopup(), 600);
  } else {
      showCustomConfirm("INFO", "Ce joueur n'a pas de base visible sur cette carte.", null);
  }
}

document.addEventListener("DOMContentLoaded", () => {
    const btn = document.getElementById("toggle-players");
    if(btn) btn.addEventListener("click", togglePlayerPanel);

    // Sélecteur de sietch Hagga
    const sietchSelect = document.getElementById('sietch-select');
    if (sietchSelect) {
        SIETCHS.forEach(s => {
            const opt = document.createElement('option');
            opt.value = s;
            opt.textContent = s;
            sietchSelect.appendChild(opt);
        });
        sietchSelect.addEventListener('change', () => {
            currentSietch = sietchSelect.value || null;
            reloadBases();
        });
    }
});

let audioUnlocked = false;
const hoverSound = new Audio("sounds/sand_hover.mp3"); hoverSound.volume = 0.5;
window.addEventListener("pointerdown", () => { if(!audioUnlocked) { hoverSound.muted=true; hoverSound.play().catch(()=>{}); audioUnlocked=true; } }, {once:true});
function attachHoverSound(marker) {
  let cd = false;
  marker.on("mouseover", () => { if(audioUnlocked && !cd) { cd=true; hoverSound.currentTime=0; hoverSound.muted=false; hoverSound.play().catch(()=>{}); setTimeout(()=>cd=false,180); } });
}