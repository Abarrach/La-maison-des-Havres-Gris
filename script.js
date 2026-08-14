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

// ── Noms FR des schémas uniques ──────────────────────────────────────────────
// Les coffres du .d.json listent désormais leur butin notable (`notableLoot`)
// avec le NOM et l'ID de l'objet enseigné — on peut donc dire quel schéma unique
// tombe dans quelle grotte. gaming.tools ne publie que l'anglais : on rebranche
// le nom FRANÇAIS via `plans_uniques.json` (registre dataminé du site).
// Best-effort : fichier absent → on garde le nom anglais, jamais de traduction
// inventée.
let _ddPlanNames = null;
async function ddPlanNames() {
  if (_ddPlanNames) return _ddPlanNames;
  _ddPlanNames = {};
  try {
    const r = await fetch('plans_uniques.json');
    if (r.ok) {
      const j = await r.json();
      if (j && j.plans) _ddPlanNames = j.plans;
    }
  } catch { /* pas de registre local : on restera en anglais */ }
  return _ddPlanNames;
}

// L'id du SCHÉMA et celui de l'OBJET enseigné divergent souvent
// (ex. « lightornithopterchoamboostheatefficient2_schematic » enseigne
// « ornithopterlightboost_unique_lessheat_5 »). On essaie les deux, dans les
// deux conventions de suffixe → 135/140 uniques nommés en FR (seed 01).
function ddPlanFr(names, itemId, schemId) {
  const cands = [itemId, schemId, (schemId || '').replace(/_schematic$/, ''), 'schematic_' + (itemId || '')];
  for (const c of cands) if (c && names[c] && names[c].n) return names[c].n;
  return null;
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
    const planNames = await ddPlanNames();
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
          cell: ddCell(loc.x, loc.y), name: (l.name || '').trim(),
          notable: false, tier: 0, unique: false, rarity: 0, _loot: {}, _uniq: {},
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

      // Schémas uniques réellement listés dans le coffre (nom + chance de tirage)
      const uniques = [];
      for (const nl of (l.notableLoot || [])) {
        const e = nl.entity || {};
        if (!e.isSchematic || e.rarity !== 'Unique') continue;
        const t = (e.teachesItems && e.teachesItems[0]) || {};
        const id = t.id || e.id || '';
        uniques.push({
          id,
          nom: ddPlanFr(planNames, id, e.id) || t.name || e.name || id,
          p: nl.probability || 0,
        });
      }

      for (const p of (l.parentMarkers || [])) {
        if (!p || !p.name) continue;
        const s = sites[keyOf(p.name, p.gridCell)];
        if (!s) continue;                      // le parent doit exister comme marqueur
        if (tier > s.tier) s.tier = tier;
        if (isUnique) s.unique = true;
        if (lbl) s._loot[lbl] = true;
        // Un même coffre est listé une fois par marqueur parent : on dédoublonne
        // par id d'objet et on garde la meilleure chance vue.
        for (const u of uniques) {
          const prev = s._uniq[u.id];
          if (!prev || u.p > prev.p) s._uniq[u.id] = u;
        }
      }
    }

    // rarity ≥ 3 = ★ pépite (schéma unique listé, coffre Unique OU palier UltraRare)
    for (const s of Object.values(sites)) {
      s.uniques = Object.values(s._uniq).sort((a, b) => b.p - a.p);
      if (s.uniques.length) s.unique = true;
      s.rarity = (s.unique || s.tier >= 3) ? 3 : s.tier;
      s.loot = Object.keys(s._loot);
      delete s._loot;
      delete s._uniq;
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
// `cluster` = filons regroupés en concentrations ; `threshold` = nombre minimum de
// nœuds pour afficher une concentration, `thresholdStar` = le seuil appliqué quand
// le filtre global ★ est actif. `rare` = grottes/labos/épaves dont les
// rares/ultra-rares sont mis en avant (anneau coloré + ★).
//
// Seuils filons : ★ actif = seulement les très gros champs (≥ 70 nœuds — souvent
// un seul par carte, ex. 103 nœuds au seed 01) ; ★ inactif = tous les champs
// exploitables (≥ 20 nœuds, soit ~15 titane / ~10 stravidium). L'ancien seuil
// unique à 70 ne laissait qu'UN marqueur affiché en permanence.
const DD_CLUSTER_MIN      = 20;
const DD_CLUSTER_MIN_STAR = 70;

// Nombre de schémas uniques détaillés dans une infobulle (le reste est résumé).
const DD_UNIQUES_MAX = 8;

const DD_LAYERS = [
  { id: 'spice_large',  label: "Grand champ d'épice",   icon: 'spicefieldlarge',  size: 64, on: true  },
  { id: 'spice_medium', label: "Champ d'épice moyen",   icon: 'spicefieldmedium', size: 24, on: false },
  { id: 'titanium',     label: 'Titane (champ regroupé)',     icon: 'titaniumore',   size: 54, on: true, cluster: true, threshold: DD_CLUSTER_MIN, thresholdStar: DD_CLUSTER_MIN_STAR },
  { id: 'stravidium',   label: 'Stravidium (champ regroupé)', icon: 'stravidiumore', size: 54, on: true, cluster: true, threshold: DD_CLUSTER_MIN, thresholdStar: DD_CLUSTER_MIN_STAR },
  { id: 'ecolab',       label: 'Labos (pépites surlignées)', icon: 'ecolab',     size: 52, on: true,  rare: true },
  { id: 'cave',         label: 'Grottes (pépites surlignées)', icon: 'cave',   size: 52, on: true,  rare: true },
  { id: 'shipwreck',    label: 'Épaves (pépites surlignées)',  icon: 'shipwreck', size: 54, on: false, rare: true },
];

// Clés d'état versionnées : en changer le numéro REMET TOUT LE MONDE aux
// nouveaux défauts, y compris les joueurs ayant déjà ouvert la carte (leur
// réglage mémorisé serait sinon conservé indéfiniment). V3 = vue par défaut
// « le meilleur » : épice large + titane + stravidium + labos + grottes, ★ ACTIF.
const DD_FILTER_KEY = 'ddFiltersV3';
const DD_STAR_KEY   = 'ddStarredOnlyV3';

let ddLayerGroups  = {};   // id → L.layerGroup
let ddLayerVisible = null;  // id → bool (persisté)
let _ddLastData    = null;  // dernières données rendues (pour re-render filtre global)

// ★ actif par défaut (choix produit) : la carte s'ouvre sur les meilleurs sites
// et les plus grosses concentrations. ⚠ Conséquence assumée : seuls les champs
// de filons de 70 nœuds et plus sont visibles à l'ouverture (souvent un seul par
// carte) — les ~15 autres champs exploitables n'apparaissent qu'en décochant ★,
// d'où le rappel « ★ actif » dans la légende.
let ddStarredOnly = (() => {
  try { const v = localStorage.getItem(DD_STAR_KEY); return v === null ? true : v === '1'; }
  catch { return true; }
})();

function loadDDFilterState() {
  if (ddLayerVisible) return ddLayerVisible;
  ddLayerVisible = {};
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(DD_FILTER_KEY) || '{}'); } catch {}
  for (const L0 of DD_LAYERS) {
    ddLayerVisible[L0.id] = (L0.id in saved) ? !!saved[L0.id] : L0.on;
  }
  return ddLayerVisible;
}
function saveDDFilterState() {
  try { localStorage.setItem(DD_FILTER_KEY, JSON.stringify(ddLayerVisible)); } catch {}
}

// Graduation d'un champ de filons : plus la concentration est grosse, plus
// l'icône est grande et opaque. Même principe que les POI ordinaires estompés —
// avec le seuil descendu à 20 nœuds, la carte porte une quinzaine de champs et
// les gros doivent rester repérables d'un coup d'œil.
// Échelle : au seuil bas → 55 % de la taille et bien estompé ; au seuil ★ (et
// au-delà) → pleine taille et pleine opacité.
function ddClusterScale(layer, count) {
  const lo = layer.threshold     || 1;
  const hi = layer.thresholdStar || (lo * 3);
  const t  = Math.max(0, Math.min(1, (count - lo) / Math.max(1, hi - lo)));
  return { size: Math.round(layer.size * (0.55 + 0.45 * t)), opacity: 0.6 + 0.4 * t };
}

// Icône d'un marqueur : pastille de comptage (concentration de filons),
// anneau doré pour un site notable (★ si coffre Unique/UltraRare) ou icône simple.
function ddMakeIcon(layer, item) {
  const url = `${CDN_ICONS}/${layer.icon}.webp`;
  let   s   = layer.size;
  const count  = item.count  || 1;
  const rarity = item.rarity || 0;
  if (layer.cluster && count > 1) {
    s = ddClusterScale(layer, count).size;
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

// Les noms de POI/schémas viennent d'une source externe → échappement avant
// injection dans l'infobulle HTML.
function ddEsc(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
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
    // Filons : seuil de regroupement, relevé quand ★ est actif (« que les gros »)
    const minNodes = (ddStarredOnly && L0.thresholdStar) ? L0.thresholdStar : L0.threshold;
    if (minNodes) list = list.filter(it => (it.count || 1) >= minNodes);
    // Filtre global « pépites uniquement » : sur les POI, ne garder que les ★
    if (ddStarredOnly && L0.rare) list = list.filter(it => (it.rarity || 0) >= 3);
    counts[L0.id] = list.length;
    for (const it of list) {
      const pos   = gameToLeaflet(it.x, it.y);
      const cell  = it.cell || 'ABCDEFGHI'[Math.min(8, Math.floor(pos.lat / (DD_IMG_H / 9)))] + Math.min(9, Math.floor(pos.lng / (DD_IMG_W / 9)) + 1);
      const cnt   = it.count || 1;
      const rar   = it.rarity || 0;
      // Opacité : POI ordinaire estompé (ni pépite ★ ni notable « gros »),
      // et champs de filons gradués selon la taille de la concentration.
      const faded   = L0.rare && rar < 3 && !it.notable;
      const opacity = L0.cluster ? ddClusterScale(L0, cnt).opacity : (faded ? 0.78 : 1);
      let label   = L0.label;
      if (L0.cluster && cnt > 1) label += ` — ${cnt} nœuds`;
      if (rar >= 3) label += ' — ★ ' + ((it.loot && it.loot.length) ? it.loot.join(' + ') : 'loot rare');
      else if (it.notable) label += ' — site notable';
      if (it.name) label += ` — ${it.name}`;
      label += ` — cellule ${cell}`;

      // Liste des schémas uniques du site (nom + chance de tirage du coffre).
      // La table d'un coffre compte de 7 à 50 entrées : tout afficher rend
      // l'infobulle illisible, on garde donc les plus probables et on annonce
      // le reste. ⚠ Le contenu des tables ne change PAS d'une semaine à l'autre
      // (vérifié sur les seeds 01/02/05 : mêmes 140 uniques) — c'est le
      // PLACEMENT des coffres qui tourne. Un site à peu d'entrées et forte
      // probabilité vaut donc bien mieux qu'un site à 50 entrées.
      let tip = ddEsc(label);
      if (it.uniques && it.uniques.length) {
        const pct  = v => (v >= 0.01 ? Math.round(v * 100) + ' %' : '< 1 %');
        const top  = it.uniques.slice(0, DD_UNIQUES_MAX);   // déjà triés par probabilité
        const rest = it.uniques.length - top.length;
        tip += `<div class="dd-tip-uniques"><b>Schémas uniques (${it.uniques.length})</b>`
             + top.map(u => `<div>• ${ddEsc(u.nom)}${u.p ? ` <span class="dd-tip-pct">${pct(u.p)}</span>` : ''}</div>`).join('')
             + (rest ? `<div class="dd-tip-more">+ ${rest} autre${rest > 1 ? 's' : ''}, ${pct(top[top.length - 1].p)} ou moins</div>` : '')
             + '</div>';
      }

      // Les gros champs passent au-dessus des petits (sinon un 103 nœuds peut se
      // retrouver caché derrière un 21 nœuds voisin).
      const zPlan = L0.cluster ? Math.min(19, Math.round(cnt / 6)) : (rar >= 3 ? 20 : (it.notable ? 15 : 10));
      L.marker(pos, { icon: ddMakeIcon(L0, it), opacity, zIndexOffset: zPlan })
        .bindTooltip(tip, { sticky: true, className: 'dd-zone-tooltip' })
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
  ddUpdateStatus();
}

// Ligne d'état de la légende. Le rappel « ★ actif » est important : avec le
// filtre en place à l'ouverture, un joueur ne voit qu'un champ de filons sur
// une quinzaine, sans forcément comprendre pourquoi.
let _ddStatusBase = '';
function ddUpdateStatus() {
  const el = document.getElementById('dd-overlay-status');
  if (!el || !_ddStatusBase) return;
  el.textContent = _ddStatusBase
    + (ddStarredOnly ? ' · ★ actif — décocher pour voir tous les champs de filons' : '');
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
    // Pour les filons, le seuil courant dépend du filtre ★ → on l'affiche.
    // `data-tip` = infobulle maison (cf. map.html), pas le `title` natif.
    const minNodes = (ddStarredOnly && L0.thresholdStar) ? L0.thresholdStar : L0.threshold;
    const libelle  = `${L0.label}${minNodes ? ` — ${minNodes} nœuds et plus` : ''}${n ? ' (' + n + ')' : ''}`;
    btn.dataset.tip = libelle;
    btn.setAttribute('aria-label', libelle);
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
  // ultra-rare/unique, et relève le seuil des champs de filons aux plus gros.
  const starBtn = document.createElement('button');
  starBtn.className = 'dd-filter-btn dd-filter-star' + (ddStarredOnly ? ' active' : '');
  starBtn.dataset.tip = `Le meilleur uniquement — sites à schéma unique / loot ultra-rare, `
                      + `et champs de filons de ${DD_CLUSTER_MIN_STAR} nœuds et plus `
                      + `(sinon ${DD_CLUSTER_MIN} et plus)`;
  starBtn.setAttribute('aria-label', starBtn.dataset.tip);
  starBtn.innerHTML = '<span style="font-size:22px;line-height:1;color:#f3c44f">★</span>';
  starBtn.addEventListener('click', () => {
    ddStarredOnly = !ddStarredOnly;
    try { localStorage.setItem(DD_STAR_KEY, ddStarredOnly ? '1' : '0'); } catch {}
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
    _ddStatusBase  = `✅ Seed #${data.seed} — ${zoneCount} zones · ${nbSpice} grands champs (${src})`;
    statusEl.style.color = '';
    ddUpdateStatus();
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
  allBtn.dataset.tip = 'Afficher tous les sietchs';
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
    btn.dataset.tip = sietch;
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
}

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