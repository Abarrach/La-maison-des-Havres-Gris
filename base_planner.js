'use strict';

// ============================================================
// base_planner.js — Constructeur de base Dune Awakening (Three.js)
// Sessions 3–5+ — Claim complet + multi-étages lisibles + undo/redo + rotation (R/Ctrl-Z/Y)
//                + sous-catégories sidebar + Wall_Round_Corner + détection toits par label
//                + mode click-to-place (clic sidebar → clics canvas) + Escape pour annuler.
// ============================================================

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
// ?v= : cache-busting. Bump à chaque modif des modules pour forcer le rechargement
// (sinon le navigateur sert l'ancienne version mise en cache).
import { createEngine, M, costMatch, typeMatch } from './planner_socket_engine.js?v=lot26railattach';
import { createMeshFactory } from './planner_mesh.js?v=lot26railattach';

// ============================================================
// MOTEUR — bascule ancien (géométrie+grille) / nouveau (sockets+meshes réels)
// ============================================================
const ENGINE = 'sockets';            // 'sockets' = nouveau moteur · 'legacy' = ancien
const CM_PER_CELL  = 512;            // 1 cellule legacy = 1 fondation = 512 cm
const CM_PER_LEVEL = 384;            // 1 niveau d'étage = 384 cm
const WORLD_PER_CM = 1 / CM_PER_CELL;// monde uniforme : 1 unité = 1 cellule (512 cm)
// Accès catalogue normalisé pour le moteur (champs camelCase attendus)
const engineGetPiece = id => state.piecesById.get(id);
const socketEngine = createEngine(engineGetPiece);
const meshFactory  = createMeshFactory({ getPiece: engineGetPiece, modelsBase: 'models/', scale: WORLD_PER_CM });

// ============================================================
// CONSTANTES
// ============================================================
const CELL              = 1;     // 1 cellule = 1 unité monde
const BLOCK_CELLS       = 10;    // 10×10 cellules par bloc de claim
const WALL_UNIT         = 1;     // hauteur d'un mur plein
const FOUNDATION_DEPTH  = 1.0;   // épaisseur d'une fondation = 1 unité de mur (cohérent avec le jeu :
                                  // empiler 2 fondations donne un volume continu sans espace vide entre les 2)
const FLOOR_THICKNESS   = 0.15;  // épaisseur visuelle d'un sol/toit-plat
const PILLAR_W          = 0.25;  // section d'un pilier
const WALL_THICKNESS    = 0.12;  // épaisseur visuelle d'un mur
const RAILING_HEIGHT    = 0.45;

const PIECES_JSON_URL = 'base_pieces_v3.json';

// Groupes "portes" pour le swap de type dans le panneau propriétés
const DOOR_GROUPS = new Set([
  'Door_Frame', 'Door_Frame_Wide', 'Door_Frame_Tall',
  'Door_Frame_Garage', 'PrudenceDoor_Frame', 'Passageway', 'Hatch_Frame',
]);
const isWindowGroup = g => typeof g === 'string' && g.startsWith('Window');
const isDoorGroup   = g => DOOR_GROUPS.has(g);

// Claim limits (règles officielles Dune Awakening)
const MAX_CLAIM_BLOCKS    = 6;   // 1 bloc principal + 5 extensions horizontales
const MAX_VERT_EXTENSIONS = 5;   // pieux verticaux (0–5)
// Valeurs alignées sur le système Advanced Sub-Fief de Dune Awakening :
// - Base : ~14 niveaux de volume = 6 niveaux au-dessus du sol (RDC..N6) + 7 niveaux
//   en sous-sol accessibles via creusement (S1..S7). L'utilisateur peut placer son
//   bâtiment sur le sol (perd ~7-8 niveaux dans le terrain) ou remonter sa console
//   pour récupérer la hauteur — le planner expose les 14 niveaux théoriques.
// - Chaque Vertical Staking Unit ajoute +6 niveaux en hauteur et +4 en sous-sol.
// - Max 5 extensions verticales → S27 → N36 (64 niveaux exploitables).
const BASE_MAX_FLOOR      = 6;   // niveaux au-dessus du sol sans extension
const BASE_MIN_FLOOR      = -7;  // niveaux de sous-sol sans extension (creusement)
const PER_VERT_UP         = 6;   // niveaux supplémentaires en hauteur par pieu vertical
const PER_VERT_DOWN       = 4;   // niveaux supplémentaires en sous-sol par pieu vertical

// Simulation de stabilité (session 7d) — dataminé + confirmé par la communauté DA :
// chaque ancre (fondation/pilier au sol) distribue un budget de 10 pas (= 100 points,
// 10 pts par pièce dans le jeu → 10 sols posables après une fondation, le 10e à 0).
// Chaque saut horizontal ou vertical via mur coûte 1 pas. Saut vertical via fondation
// empilée ou pilier coûte 0 (transmission gratuite).
const STABILITY_BUDGET    = 10;
const STABILITY_COLOR_OK      = 0x4caf76;  // vert — stable avec marge
const STABILITY_COLOR_WARNING = 0xddaa33;  // jaune — limite (budget 0-1)
const STABILITY_COLOR_ERROR   = 0xcc3333;  // rouge — instable ou non-atteint

const FACTION_COLORS = {
  choam_shelter: 0x3a6fa8,
  choam:         0x2d5a9e,
  choam_lvl2:    0x1d3d7a,
  atreides:      0x2d6b2d,
  harkonnen:     0x8b1a1a,
  smugglers:     0x7a6b2d,
  watershippers: 0x1a6b7a,
  extra:         0x5c3a7a,
  blockout:      0x444444,
  placeables:    0xc8a64a,  // machines (raffineries, fabricateurs) : ambré
  vehicles:      0x4a78b8,  // véhicules : bleu acier (distinct des machines)
};

/** Couleur 3D d'une pièce — dispatch sur is_vehicle / is_machine sinon faction. */
function getPieceColor(piece) {
  if (piece.is_vehicle) return FACTION_COLORS.vehicles;
  if (piece.is_machine) return FACTION_COLORS.placeables;
  return FACTION_COLORS[piece.faction_id] ?? 0x666666;
}

const COLOR_GROUND      = 0x0d0805;
const COLOR_CLAIM_FLOOR = 0x2a1a08;
const COLOR_GRID_MINOR  = 0x4b3010;
const COLOR_GRID_MAJOR  = 0x78501a;
const COLOR_CLAIM_BORDER = 0xcda434;
const COLOR_SELECT       = 0xffffff;
const COLOR_GHOST_OK     = 0xcda434;  // doré : placement valide
const COLOR_GHOST_BAD    = 0xa83b3b;  // rouge : placement refusé
const COLOR_HOVER_HL     = 0xf3c44f;  // surbrillance edge/corner cible

// ============================================================
// ÉTAT
// ============================================================
const state = {
  pieces:      [],
  canonicals:  [],   // une pièce par (faction, group) — pas de doublons cosmétiques
  variantMap:  new Map(), // pieceId → Piece[] (toutes les variantes du même groupe)
  piecesById:  new Map(),
  plan: {
    id:    null,
    name:  'Nouveau plan',
    owner: localStorage.getItem('user') || '—',
    claim: { blocks: [{ gx: 0, gy: 0 }], vertical_extensions: 0 },
    floors: [
      { z: -1, name: 'S1',  items: [] },
      { z:  0, name: 'RDC', items: [] },
      { z:  1, name: 'N1',  items: [] },
      { z:  2, name: 'N2',  items: [] },
      { z:  3, name: 'N3',  items: [] },
      { z:  4, name: 'N4',  items: [] },
      { z:  5, name: 'N5',  items: [] },
      { z:  6, name: 'N6',  items: [] },
    ],
  },
  currentFloor:   0,
  // Sélection : selectedItemId = pièce "principale" (dernière cliquée, utilisée pour le
  // panneau de propriétés). selectedItemIds = ensemble complet des sélectionnés
  // (Shift+clic pour ajouter, Ctrl+clic pour toggle, clic simple pour remplacer).
  // Garder les 2 en sync est important : selectedItemIds.has(selectedItemId) doit
  // toujours être vrai si selectedItemId != null.
  selectedItemId:  null,
  selectedItemIds: new Set(),
  // Buffer de copier-coller pour les étages — items du dernier Ctrl+C
  floorClipboard:  null,
  // Simulation de stabilité (session 7d)
  showStability:   false,        // toggle d'affichage (bouton toolbar)
  stabilityMap:    new Map(),    // itemId → budget restant (null/négatif = instable)
  activeFaction:  '',
  activeCategory: '',
  // Onglet de mode sidebar : 'structures' (pièces de construction), 'machines'
  // (raffineries + fabricateurs), 'vehicles'. Filtre la liste sans toucher au
  // catalogue des pièces.
  activeTab:      'structures',
  searchQuery:    '',
  dragPieceId:    null,
  cameraMode:     'ortho',
  orthoZoom:      40,
  // Undo / Redo
  history:        [],   // [{ undo, redo }]
  histFront:      -1,   // index de l'action courante
  // Rotation fantôme (pendant drag OU click-to-place)
  ghostRotation:  0,
  // Pour les triangles : true quand l'utilisateur a forcé la rotation avec R/molette,
  // false par défaut → auto-orientation basée sur l'arête voisine occupée la plus
  // proche du curseur (réplique le comportement du jeu). Reset au changement de pièce.
  ghostUserSetRotation: false,
  // Click-to-place : pièce sélectionnée dans la sidebar, posée par clic sur le canvas
  activePieceId:  null,
  // Vue solide : masque le verre (fenêtres transparentes). ACTIVÉE par défaut
  // (tous les étages visibles et opaques à l'ouverture) — togglable via le bouton / T.
  solidView:      true,
  // Mode demi-étage : la pièce en cours de pose est décalée de +0.5 WALL_UNIT
  ghostHalf:      false,
};

// ============================================================
// THREE.JS GLOBALS
// ============================================================
// Dernier état fantôme (pour re-render ghost au keydown R pendant drag)
let lastGhostState = null;

let scene, renderer;
let orthoCam, perspCam, activeCam;
let orbitControls;
let raycaster, mouseNDC;
let groundPlane;
let claimGroup;
let ghostMesh    = null;
let hoverHelper  = null;   // indicateur sur l'edge/corner/cell ciblé
const placedMeshes = new Map();  // itemId → mesh

// ============================================================
// CACHE DOM
// ============================================================
const dom = {};
function cacheDom() {
  dom.container    = document.getElementById('bp-stage-container');
  dom.hint         = document.getElementById('bp-canvas-hint');
  dom.hudCoords       = document.getElementById('bp-hud-coords');
  dom.hudZoom         = document.getElementById('bp-hud-zoom');
  dom.hudFloorResolve = document.getElementById('bp-hud-floor-resolve');
  dom.zoomReset    = document.getElementById('tool-zoom-reset');
  dom.pieceList    = document.getElementById('bp-piece-list');
  dom.pieceCount   = document.getElementById('bp-piece-count');
  dom.itemCount    = document.getElementById('bp-item-count');
  dom.planName     = document.getElementById('bp-plan-name');
  dom.planOwner    = document.getElementById('bp-plan-owner');
  dom.claimBlocks  = document.getElementById('bp-claim-blocks');
  dom.vertExt      = document.getElementById('bp-vert-ext-count');
  dom.heightRange  = document.getElementById('bp-height-range');
  dom.noSelection  = document.getElementById('bp-no-selection');
  dom.selectedInfo = document.getElementById('bp-selected-info');
  dom.selName      = document.getElementById('bp-sel-name');
  dom.selW         = document.getElementById('bp-sel-w');
  dom.selD         = document.getElementById('bp-sel-d');
  dom.selH         = document.getElementById('bp-sel-h');
  dom.selRot       = document.getElementById('bp-sel-rotation');
  dom.selIcon      = document.getElementById('bp-sel-icon');
  dom.deleteBtn    = document.getElementById('bp-delete-btn');
  dom.rotCw        = document.getElementById('bp-rot-cw');
  dom.rotCcw       = document.getElementById('bp-rot-ccw');
  dom.selSwap      = document.getElementById('bp-sel-swap');
  dom.swapGrid     = document.getElementById('bp-swap-grid');
  dom.selSkin      = document.getElementById('bp-sel-skin');
  dom.skinGrid     = document.getElementById('bp-skin-grid');
  dom.variantBar   = document.getElementById('bp-variant-bar');
  dom.selHalf      = document.getElementById('bp-sel-half');
  dom.hudHalf      = document.getElementById('bp-hud-half');
}
function setText(el, v) { if (el) el.textContent = v; }

// ============================================================
// UNDO / REDO
// ============================================================
const HISTORY_MAX = 50;

function pushHistory(undoFn, redoFn) {
  bpSetDirty(true);                       // toute pose/suppression/rotation = plan modifié
  // Supprime le stack redo si on est en milieu d'historique
  state.history.splice(state.histFront + 1);
  state.history.push({ undo: undoFn, redo: redoFn });
  if (state.history.length > HISTORY_MAX) {
    // Déborde : on jette l'entrée la plus ancienne
    state.history.shift();
    state.histFront = HISTORY_MAX - 1;  // toujours le dernier élément
  } else {
    state.histFront++;
  }
}
function undoAction() {
  if (state.histFront < 0) return;
  state.history[state.histFront].undo();
  state.histFront--;
  bpSetDirty(true);
}
function redoAction() {
  if (state.histFront >= state.history.length - 1) return;
  state.histFront++;
  state.history[state.histFront].redo();
  bpSetDirty(true);
}

// Réinjecte un item précédemment supprimé (pour undo place / redo remove)
function restoreItem(item) {
  const piece = state.piecesById.get(item.piece_id);
  if (!piece) return;
  const floor = getFloor(item.z);
  if (!floor) return;
  if (floor.items.some(i => i.id === item.id)) return; // déjà présent
  floor.items.push(item);
  const mesh = buildMeshForPiece(piece, item);
  scene.add(mesh);
  placedMeshes.set(item.id, mesh);
  updateFloorVisibility();
  updateFloorBadges();
  updatePieceCount();
  recomputeStabilityIfActive();
}

// ============================================================
// INIT
// ============================================================
async function init() {
  cacheDom();
  try { await loadCatalog(); }
  catch (err) {
    console.error('[base_planner] chargement catalogue échoué :', err);
    setText(dom.pieceCount, 'Erreur de chargement');
    return;
  }

  setupScene();
  setupCameras();
  setupRenderer();
  setupLights();
  setupControls();
  setupGrid();
  setupRaycasting();
  setupHoverHelper();

  ensureFloors();       // garantit que tous les étages de la plage initiale existent
  renderSidebar();
  initFilters();
  initToolbar();
  initFloorTabs();      // génère dynamiquement les onglets selon les extensions
  initVertPips();       // branche les pips de pieux verticaux
  initDragDrop();
  bpInitPersistence();  // boutons Sauvegarder / Mes plans / Partager + auto-load ?plan=<token>
  initKeyboard();
  initResize();

  updatePlanPanel();
  updateFloorVisibility();
  updateFloorBadges();
  applySolidView();     // mode solide actif par défaut → bouton actif + rendu opaque
  hideHint();
  animate();
}

document.addEventListener('DOMContentLoaded', init);

// ============================================================
// CHARGEMENT CATALOGUE
// ============================================================
// Pièces retirées de la palette (entrées dataminées sans mesh / contenu non sorti).
// Conservé en code (et non par suppression du JSON) pour survivre à une régénération
// du catalogue. Tank = pas encore sorti ; TreadWheel = sans intérêt ; les 2 fabricateurs
// n'ont pas de mesh exportable.
const EXCLUDED_PIECE_IDS = new Set([
  'Tank_Vehicle', 'TreadWheel_Vehicle',
  'PortableFabricator_Placeable', 'ConstructionFabricator_Placeable',
]);

async function loadCatalog() {
  const url = ENGINE === 'sockets' ? 'planner_pieces.json?v=lot26railattach' : PIECES_JSON_URL;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error('pieces ' + resp.status);
  const piecesData = await resp.json();
  state.pieces = (piecesData.pieces || [])
    .filter(p => p.faction_id !== 'blockout' && !EXCLUDED_PIECE_IDS.has(p.id));

  // Normalisation camelCase pour le moteur de sockets (planner_pieces.json est en snake_case).
  for (const p of state.pieces) {
    p.sockets       = p.sockets || [];
    p.socketProfile = p.socket_profile ?? null;
    p.isFoundation  = !!p.is_foundation;
    p.isPillar      = !!p.is_pillar_socket;
    p.snapRotation  = p.snap_rotation ?? null;
    // Re-dérive la catégorie depuis le GROUP (les catégories dataminées sont incohérentes :
    // colonnes en 'foundations', rambardes en 'pillars', triangles larges en 'extra'…).
    if (ENGINE === 'sockets') p.category = deriveGameCategory(p);
  }

  const { canonicals, variantMap } = buildVariantIndex(state.pieces);
  state.canonicals = canonicals;
  state.variantMap = variantMap;

  // Mode sockets : on montre TOUTES les pièces individuellement (vrais meshes = vraies
  // apparences différentes), pas une pièce canonique avec un sélecteur de skins.
  if (ENGINE === 'sockets') {
    state.canonicals = state.pieces.slice();
    state.variantMap = new Map(state.pieces.map(p => [p.id, [p]]));
  }

  state.piecesById = new Map();
  for (const p of state.pieces) state.piecesById.set(p.id, p);
}

/** Catégorie "comme dans le jeu", dérivée du group (fiable) plutôt que du champ dataminé. */
function deriveGameCategory(p) {
  const g = p.group || '', id = p.id || '';
  if (/Window/i.test(id) || /^Window/.test(g)) return 'windows';
  if (/^Foundation/.test(g)) return 'foundations';
  if (/^Floor/.test(g))      return 'floors';
  if (/^(Roof|Rooftop)/.test(g)) return 'roofs';
  if (/^Railing/.test(g))    return 'railings';
  if (/^(Door|Gate|Hatch|Passageway|PrudenceDoor|Arch)/.test(g)) return 'doors';
  if (/^(Ramp|Stairs)/.test(g)) return 'stairs';
  // Piliers / colonnes = FONDATIONS (catégorie officielle du jeu) → ancres de stabilité.
  if (/^Pillar/.test(g))     return 'foundations';
  if (/^(Ladder|Tower)/.test(g)) return 'structures';
  if (/^Wall/.test(g))       return 'walls';
  return p.category || 'walls';
}

/**
 * Construit l'index des variantes cosmétiques.
 * Deux pièces de même (faction_id, group) sont des variantes cosmétiques (même forme,
 * même snap, skin différent). On expose :
 *  - canonicals : une pièce par (faction, group), la première par menu_order
 *  - variantMap : pieceId → Piece[] (toutes les variantes du groupe, triées par menu_order)
 */
function buildVariantIndex(pieces) {
  const byKey = new Map();
  for (const p of pieces) {
    // Utiliser getDisplayGroup pour que les fenêtres (Window_Round_Corner)
    // ne soient pas groupées avec les murs (Wall_Round_Corner) de même groupe JSON
    const key = (p.faction_id || '') + '\x00' + (getDisplayGroup(p) || p.id);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(p);
  }
  for (const arr of byKey.values()) {
    arr.sort((a, b) => (a.menu_order ?? 9999) - (b.menu_order ?? 9999));
  }
  const variantMap = new Map();
  for (const arr of byKey.values()) {
    for (const p of arr) variantMap.set(p.id, arr);
  }
  // Canoniques : première pièce rencontrée par groupe (ordre JSON = ordre menu naturel)
  const canonicals = [];
  const seen = new Set();
  for (const p of pieces) {
    const key = (p.faction_id || '') + '\x00' + (getDisplayGroup(p) || p.id);
    if (!seen.has(key)) {
      seen.add(key);
      canonicals.push(byKey.get(key)[0]);
    }
  }
  return { canonicals, variantMap };
}

// ============================================================
// SCÈNE / RENDERER / LUMIÈRES
// ============================================================
function setupScene() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x050301);
  scene.fog = new THREE.Fog(0x050301, 80, 200);
}
function setupRenderer() {
  const w = dom.container.clientWidth;
  const h = dom.container.clientHeight;
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(w, h);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type    = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace  = THREE.SRGBColorSpace;
  dom.container.appendChild(renderer.domElement);
  renderer.domElement.style.display = 'block';
}
function setupLights() {
  scene.add(new THREE.AmbientLight(0xffe8c0, 0.45));
  const sun = new THREE.DirectionalLight(0xfff0d0, 1.1);
  sun.position.set(15, 30, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left   = -30;
  sun.shadow.camera.right  =  30;
  sun.shadow.camera.top    =  30;
  sun.shadow.camera.bottom = -30;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far  = 80;
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0xffe8c0, 0x1a0f05, 0.3));
}

// ============================================================
// CAMÉRAS
// ============================================================
function setupCameras() {
  const w = dom.container.clientWidth;
  const h = dom.container.clientHeight;
  const aspect = w / h;
  const target = new THREE.Vector3(BLOCK_CELLS / 2, 0, BLOCK_CELLS / 2);

  const o = computeOrthoSize();
  orthoCam = new THREE.OrthographicCamera(-o.x / 2, o.x / 2, o.y / 2, -o.y / 2, 0.1, 200);
  orthoCam.position.set(target.x, 50, target.z);
  orthoCam.up.set(0, 0, -1);
  orthoCam.lookAt(target);

  perspCam = new THREE.PerspectiveCamera(45, aspect, 0.1, 500);
  perspCam.position.set(target.x - 12, 18, target.z + 18);
  perspCam.lookAt(target);

  activeCam = orthoCam;
}
function computeOrthoSize() {
  return { x: dom.container.clientWidth / state.orthoZoom, y: dom.container.clientHeight / state.orthoZoom };
}
function applyOrthoSize() {
  const { x, y } = computeOrthoSize();
  orthoCam.left   = -x / 2; orthoCam.right  = x / 2;
  orthoCam.top    =  y / 2; orthoCam.bottom = -y / 2;
  orthoCam.updateProjectionMatrix();
}
function setupControls() {
  orbitControls = new OrbitControls(perspCam, renderer.domElement);
  orbitControls.target.set(BLOCK_CELLS / 2, 0, BLOCK_CELLS / 2);
  orbitControls.minDistance   = 5;
  orbitControls.maxDistance   = 80;
  orbitControls.maxPolarAngle = Math.PI * 0.49;
  orbitControls.enableDamping = true;
  orbitControls.dampingFactor = 0.08;
  orbitControls.enabled = false;
  // Désactive le zoom intégré : on gère tout via le handler wheel custom
  // (sinon Ctrl+molette zoome ET tourne en même temps en mode 3D).
  orbitControls.enableZoom = false;
  orbitControls.update();
}

// ============================================================
// GRILLE / CLAIM
// ============================================================
let gridHelper = null;
function setupGrid() {
  claimGroup = new THREE.Group();
  scene.add(claimGroup);

  const groundMat = new THREE.MeshStandardMaterial({ color: COLOR_GROUND, roughness: 1, metalness: 0 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.01;
  ground.receiveShadow = true;
  scene.add(ground);

  for (const b of state.plan.claim.blocks) drawClaimBlock(b.gx, b.gy);
  rebuildGrid();
}

/** Bornes monde du claim (en unités = cellules). */
function claimBoundsWorld() {
  const blocks = (state.plan.claim && state.plan.claim.blocks) || [];
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const b of blocks) {
    minX = Math.min(minX, b.gx * BLOCK_CELLS);     maxX = Math.max(maxX, b.gx * BLOCK_CELLS + BLOCK_CELLS);
    minZ = Math.min(minZ, b.gy * BLOCK_CELLS);     maxZ = Math.max(maxZ, b.gy * BLOCK_CELLS + BLOCK_CELLS);
  }
  if (!isFinite(minX)) { minX = 0; maxX = BLOCK_CELLS; minZ = 0; maxZ = BLOCK_CELLS; }
  return { minX, maxX, minZ, maxZ };
}

/** (Re)construit la grille de fond pour couvrir tout le claim + une marge. */
function rebuildGrid() {
  if (gridHelper) { scene.remove(gridHelper); gridHelper.geometry.dispose(); gridHelper.material.dispose(); }
  const b = claimBoundsWorld();
  const margin = BLOCK_CELLS;                       // 1 bloc de marge autour
  const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
  let size = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) + margin * 2;
  size = Math.ceil(size / 2) * 2;                   // pair → lignes alignées sur les entiers
  gridHelper = new THREE.GridHelper(size, size, COLOR_GRID_MAJOR, COLOR_GRID_MINOR);
  gridHelper.position.set(cx, 0.005, cz);           // centrée sur le claim → couvre les extensions
  gridHelper.material.transparent = true;
  gridHelper.material.opacity = 0.55;
  scene.add(gridHelper);
}
function drawClaimBlock(gx, gy) {
  const ox = gx * BLOCK_CELLS;
  const oz = gy * BLOCK_CELLS;
  const mat = new THREE.MeshStandardMaterial({ color: COLOR_CLAIM_FLOOR, roughness: 0.95, metalness: 0 });
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(BLOCK_CELLS, BLOCK_CELLS), mat);
  plane.rotation.x = -Math.PI / 2;
  plane.position.set(ox + BLOCK_CELLS / 2, 0.001, oz + BLOCK_CELLS / 2);
  plane.receiveShadow = true;
  claimGroup.add(plane);

  const borderGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(ox, 0.02, oz),
    new THREE.Vector3(ox + BLOCK_CELLS, 0.02, oz),
    new THREE.Vector3(ox + BLOCK_CELLS, 0.02, oz + BLOCK_CELLS),
    new THREE.Vector3(ox, 0.02, oz + BLOCK_CELLS),
    new THREE.Vector3(ox, 0.02, oz),
  ]);
  claimGroup.add(new THREE.Line(borderGeo, new THREE.LineBasicMaterial({ color: COLOR_CLAIM_BORDER })));
}

// ============================================================
// RAYCASTING
// ============================================================
function setupRaycasting() {
  raycaster = new THREE.Raycaster();
  mouseNDC  = new THREE.Vector2();
  groundPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(1000, 1000),
    new THREE.MeshBasicMaterial({ visible: false })
  );
  groundPlane.rotation.x = -Math.PI / 2;
  groundPlane.position.y = 0;
  scene.add(groundPlane);
}
function screenToWorld(clientX, clientY) {
  const rect = renderer.domElement.getBoundingClientRect();
  mouseNDC.x = ((clientX - rect.left) / rect.width)  * 2 - 1;
  mouseNDC.y = -((clientY - rect.top)  / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouseNDC, activeCam);
  const hits = raycaster.intersectObject(groundPlane);
  return hits.length > 0 ? hits[0].point : null;
}
function raycastPlacedMeshes(clientX, clientY) {
  const rect = renderer.domElement.getBoundingClientRect();
  mouseNDC.x = ((clientX - rect.left) / rect.width)  * 2 - 1;
  mouseNDC.y = -((clientY - rect.top)  / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouseNDC, activeCam);
  // RÉCURSIF : en mode sockets les pièces sont des Group (vrai mesh glb en sous-objets),
  // sans géométrie propre → un raycast non-récursif ne touchait jamais rien.
  const hits = raycaster.intersectObjects(Array.from(placedMeshes.values()), true);
  if (!hits.length) return null;
  // Le ray touche un sous-mesh : remonter jusqu'au groupe porteur de l'itemId.
  let o = hits[0].object;
  while (o && o.userData.itemId == null && o.parent) o = o.parent;
  return (o && o.userData.itemId != null) ? o : null;
}

// ============================================================
// GEOMETRY FACTORIES — par type de pièce
// ============================================================
/** Prisme triangle ÉQUILATÉRAL pour Floor_Wedge / Foundation_Wedge / roof wedges.
 *
 *  Géométrie en jeu (confirmée par analyse vidéo Dune Awakening) :
 *  - 3 côtés strictement égaux à 1 unité (= 1 côté de cellule)
 *  - 3 angles de 60°
 *  - Hauteur (perpendiculaire à la base) = √3/2 ≈ 0.866 unité
 *  - 2 triangles base-contre-base forment un LOSANGE 60°/120° (PAS un rectangle)
 *  - 6 triangles autour d'un point forment un hexagone régulier
 *
 *  Convention de centrage : la BASE est sur l'arête sud de la cellule (z = -d/2 local).
 *  L'apex pointe vers le NORD à z = -d/2 + √3/2 ≈ 0.366 en local (donc à l'intérieur
 *  de la cellule, ≈0.866 unité après le sud, n'atteint pas le nord puisque √3/2 < 1).
 *  Centre de rotation = centre de cellule (origine locale 0,0,0). Les rotations
 *  0/90/180/270 placent ainsi la base sur les 4 arêtes de la cellule.
 *
 *  Note Phase 1 : la géométrie est maintenant correcte (équilatéral) mais le système
 *  de snap reste cellule-aligné (4 rotations). Le snap par arête + 6 rotations à 60°
 *  arrivera en Phase 2-4. Conséquence visuelle : un triangle posé seul a sa base
 *  flush avec une arête de cellule et son apex N'ATTEINT PAS l'arête opposée (gap
 *  visible de ~0.134 unité = 1 - √3/2). C'est attendu — le triangle équilatéral est
 *  géométriquement plus court que la cellule carrée.
 */
function makeTrianglePrismGeometry(w, h, d) {
  const H = w * Math.sqrt(3) / 2;  // hauteur de l'équilatéral (≈ 0.866 si w=1)
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);          // base gauche
  shape.lineTo(w, 0);          // base droite
  shape.lineTo(w / 2, H);      // apex au-dessus du milieu de la base
  shape.closePath();
  const geom = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false });
  // Rotation +PI/2 autour de X : shape passe de XY à XZ, extrusion +Z devient -Y.
  geom.rotateX(Math.PI / 2);
  geom.translate(0, h, 0);            // bottom à Y=0
  // Centrer sur la cellule : base à z = -d/2 (sud), apex à z = H - d/2.
  // Note : H = √3/2 ≈ 0.866 < d=1, donc l'apex est à z ≈ 0.366 (sous le nord à z=0.5).
  geom.translate(-w / 2, 0, -d / 2);
  return geom;
}

/** Mur triangulaire : face avant en triangle rectangle (plan XY), extrudée de WALL_THICKNESS sur Z.
 *  Géométrie centrée XYZ (compatible avec le placement standard des murs edge).
 *  corner ∈ {'BL','BR','TL','TR'} = position du coin avec l'angle droit (= coin "plein").
 *  Convention : x ∈ [0,w] horizontal, y ∈ [0,h] vertical (face du mur vue de face en +Z).
 */
function makeTriangleWallGeometry(w, h, corner) {
  const t = WALL_THICKNESS;
  const shape = new THREE.Shape();
  switch (corner) {
    case 'BL':  // (0,0)─(w,0) base, montant gauche, hypoténuse (w,0)→(0,h)
      shape.moveTo(0, 0); shape.lineTo(w, 0); shape.lineTo(0, h);
      break;
    case 'BR':  // (0,0)─(w,0) base, montant droit, hypoténuse (0,0)→(w,h)
      shape.moveTo(0, 0); shape.lineTo(w, 0); shape.lineTo(w, h);
      break;
    case 'TL':  // base haute (0,h)─(w,h), montant gauche, hypoténuse (0,0)→(w,h)
      shape.moveTo(0, 0); shape.lineTo(w, h); shape.lineTo(0, h);
      break;
    case 'TR':  // base haute (0,h)─(w,h), montant droit, hypoténuse (w,0)→(0,h)
      shape.moveTo(w, 0); shape.lineTo(w, h); shape.lineTo(0, h);
      break;
  }
  shape.closePath();
  const geom = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false });
  geom.translate(-w / 2, -h / 2, -t / 2);
  return geom;
}

/** Détermine le coin "plein" (angle droit) d'un mur triangulaire à partir du nom de groupe.
 *  Couvre Wall_Triangle_{Top|Bottom}[_Half|_Wide|_Tall]_{Left|Right}.
 */
function triangleWallCorner(group) {
  const isTop   = group.indexOf('_Top') !== -1;
  const isRight = group.endsWith('_Right');
  return (isTop ? 'T' : 'B') + (isRight ? 'R' : 'L');
}

/** True si le groupe est une rampe de toit (wedge montant simple).
 *  Inclut Roof, Roof_Half, Angled_Wedge_*, Roof_Wedge_*, Roof_Cover_*.
 *  Les Roof_Cover et Roof_Wedge ont des géométries spécifiques en jeu (couvertures
 *  à 2 pans, wedges sur footprint triangulaire) mais on les approxime en rampes
 *  simples pour ne pas tomber sur la slab plate. À raffiner dans une session future. */
function isRoofRampGroup(group) {
  return group === 'Roof' || group === 'Roof_Half'
      || group.startsWith('Angled_Wedge')
      || group.startsWith('Roof_Wedge')
      || group.startsWith('Roof_Cover');
}

/** True si le groupe est un coin de toit pyramidal (sommet à un coin). */
function isRoofCornerGroup(group) {
  return group === 'Roof_Corner' || group === 'Roof_Corner_Half';
}

/** True si le groupe est un coin de toit INTÉRIEUR (creux concave à un coin). */
function isRoofCornerInwardGroup(group) {
  return group === 'Roof_Corner_Inward' || group === 'Roof_Corner_Half_Inward';
}

/** True si le groupe est un toit arrondi (dim.shape === 'corner' + categorie roofs).
 *  Géré séparément du bloc générique pour pouvoir le distinguer des autres rooflike. */
function isRoofRoundCornerGroup(group) {
  return group === 'Roof_Round_Corner' || group === 'Roof_Round_Corner_Half';
}

/** Rampe : slab incliné fin (FLOOR_THICKNESS d'épaisseur).
 *  Avant à Y=0, arrière à Y=h. Géométrie centrée sur XZ.
 */
function makeRampGeometry(w, h, d) {
  const t = FLOOR_THICKNESS;
  const v = new Float32Array([
    0, 0,   0,  w, 0,   0,   // 0,1 : avant bas
    0, t,   0,  w, t,   0,   // 2,3 : avant haut
    0, h-t, d,  w, h-t, d,   // 4,5 : arrière bas
    0, h,   d,  w, h,   d,   // 6,7 : arrière haut
  ]);
  const idx = [
    2, 7, 3,  2, 6, 7,   // surface haute (walkable)
    0, 1, 5,  0, 5, 4,   // surface basse
    0, 2, 3,  0, 3, 1,   // face avant
    4, 5, 7,  4, 7, 6,   // face arrière
    0, 4, 6,  0, 6, 2,   // face gauche
    1, 3, 7,  1, 7, 5,   // face droite
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(v, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.translate(-w / 2, 0, -d / 2);
  return g;
}

/**
 * Toit en coin (pyramide oblique). 5 vertices = 4 coins de base + 1 sommet
 * unique au-dessus du coin "NE" (+X, +Z). L'arête (0→4) entre le coin SW au
 * sol et le sommet NE en hauteur est la crête diagonale. Le coin orienté est
 * imposé canonique (NE) — l'utilisateur tourne la pièce pour orienter ailleurs.
 * Géométrie centrée XZ, bas à Y=0.
 *
 * toNonIndexed() + computeVertexNormals() → arêtes nettes (normales par face),
 * pour un rendu uniforme façon "blueprint" cohérent avec les autres toits.
 */
function makeRoofCornerGeometry(w, d, h) {
  const positions = new Float32Array([
    -w/2, 0, -d/2,   // 0 : SW bas
     w/2, 0, -d/2,   // 1 : SE bas
     w/2, 0,  d/2,   // 2 : NE bas
    -w/2, 0,  d/2,   // 3 : NW bas
     w/2, h,  d/2,   // 4 : sommet, au-dessus de NE
  ]);
  const indices = [
    0, 2, 1,  0, 3, 2,    // face bas (Y=0)
    1, 4, 2,              // mur Est plat (plan X=+w/2)
    3, 2, 4,              // mur Nord plat (plan Z=+d/2)
    0, 1, 4,              // toit incliné côté SE (crête 0→4)
    0, 4, 3,              // toit incliné côté NW (crête 0→4)
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.setIndex(indices);
  const nonIdx = g.toNonIndexed();
  nonIdx.computeVertexNormals();
  return nonIdx;
}

/**
 * Toit en coin INTÉRIEUR (creux concave). Volume fermé : 4 coins de base à Y=0
 * + 3 sommets à Y=h aux coins NON creux (SW, SE, NW). Le coin NE descend jusqu'au
 * sol au coin de base correspondant → pente concave allant du sommet SE-NW vers NE.
 * 7 vertices, 10 triangles. Géométrie centrée XZ, bas à Y=0.
 */
function makeRoofCornerInwardGeometry(w, d, h) {
  const positions = new Float32Array([
    -w/2, 0, -d/2,   // 0 : SW bas
     w/2, 0, -d/2,   // 1 : SE bas
     w/2, 0,  d/2,   // 2 : NE bas (= aussi le coin creux du dessus)
    -w/2, 0,  d/2,   // 3 : NW bas
    -w/2, h, -d/2,   // 4 : SW haut
     w/2, h, -d/2,   // 5 : SE haut
    -w/2, h,  d/2,   // 6 : NW haut
  ]);
  const indices = [
    0, 2, 1,  0, 3, 2,    // face bas (Y=0) — quad complet
    4, 5, 6,              // face supérieure triangulaire (Y=h, 3 coins hauts)
    0, 1, 5,  0, 5, 4,    // mur Sud (Z=-d/2) — quad complet
    0, 4, 6,  0, 6, 3,    // mur Ouest (X=-w/2) — quad complet
    1, 2, 5,              // mur Est triangulaire (plan X=+w/2, coin NE au sol)
    3, 6, 2,              // mur Nord triangulaire (plan Z=+d/2, coin NE au sol)
    5, 2, 6,              // pente concave descendant de l'arête 5-6 vers le coin 2
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.setIndex(indices);
  const nonIdx = g.toNonIndexed();
  nonIdx.computeVertexNormals();
  return nonIdx;
}

/**
 * Toit incliné en rampe (wedge plein). Footprint w×d au sol, pente qui monte de
 * Y=0 (côté -Z) à Y=h (côté +Z). 6 vertices = 4 coins de base + 2 sommets hauts
 * sur l'arête +Z. Géométrie centrée XZ, bas à Y=0.
 * Utilisé pour Roof, Roof_Half, Angled_Wedge_Bottom/Top et leurs Half variants —
 * la différence Bottom/Top du jeu est une question d'orientation, gérée via la
 * rotation utilisateur.
 */
function makeRoofRampGeometry(w, d, h) {
  const positions = new Float32Array([
    -w/2, 0, -d/2,   // 0 : avant-gauche bas
     w/2, 0, -d/2,   // 1 : avant-droit  bas
     w/2, 0,  d/2,   // 2 : arrière-droit bas
    -w/2, 0,  d/2,   // 3 : arrière-gauche bas
     w/2, h,  d/2,   // 4 : arrière-droit haut
    -w/2, h,  d/2,   // 5 : arrière-gauche haut
  ]);
  const indices = [
    0, 2, 1,  0, 3, 2,    // face bas (Y=0)
    3, 4, 2,  3, 5, 4,    // face arrière (Z=+d/2, plate verticale)
    0, 1, 4,  0, 4, 5,    // face supérieure inclinée (le toit visible)
    0, 5, 3,              // triangle latéral gauche (X=-w/2)
    1, 2, 4,              // triangle latéral droit (X=+w/2)
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.setIndex(indices);
  // toNonIndexed + computeVertexNormals = arêtes nettes (normales par face)
  const nonIdx = g.toNonIndexed();
  nonIdx.computeVertexNormals();
  return nonIdx;
}

/** Escalier marche par marche (n marches). Origine au coin bas-avant.
 *  Chaque marche s'étend jusqu'au fond (zFar = d) pour un profil continu
 *  fidèle au jeu. La face "bas" est absente → espace vide sous l'escalier.
 */
function makeStairsGeometry(w, h, d, steps = 5) {
  const stepRise = h / steps;
  const stepRun  = d / steps;
  const t = stepRise * 0.35;   // épaisseur de chaque marche (planche fine)
  const positions = [];
  const indices   = [];
  let vOff = 0;
  for (let i = 0; i < steps; i++) {
    const yBot  = stepRise * i;
    const yTop  = yBot + t;
    const zNear = stepRun * i;
    const zFar  = stepRun * (i + 1);
    positions.push(
      0, yBot, zNear,  w, yBot, zNear,  w, yBot, zFar,  0, yBot, zFar,  // 0-3
      0, yTop, zNear,  w, yTop, zNear,  w, yTop, zFar,  0, yTop, zFar,  // 4-7
    );
    const o = vOff;
    indices.push(
      o+4, o+6, o+5,  o+4, o+7, o+6,  // dessus (+Y)
      o+0, o+4, o+5,  o+0, o+5, o+1,  // avant (-Z)
      o+2, o+6, o+7,  o+2, o+7, o+3,  // arrière (+Z)
      o+0, o+3, o+7,  o+0, o+7, o+4,  // gauche (-X)
      o+1, o+5, o+6,  o+1, o+6, o+2,  // droite (+X)
      // pas de face dessous — vide entre marches et plancher
    );
    vOff += 8;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  g.translate(-w / 2, 0, -d / 2);
  return g;
}

/**
 * Cadre de porte : deux montants + linteau, ouverture libre en bas.
 * Géométrie centrée sur Y (de -h/2 à +h/2) → compatible avec placeMeshAt edge.
 * frameW : largeur des montants, fhRatio : fraction de h pour le linteau.
 */
function makeDoorFrameGeometry(w, h, frameW = 0.10, fhRatio = 0.12) {
  const t    = WALL_THICKNESS;
  const fh   = h * fhRatio;   // hauteur du linteau
  const opH  = h - fh;        // hauteur de l'ouverture (du sol jusqu'au linteau)
  const hy   = h / 2;         // offset de centrage vertical

  const pos = [];
  const idx = [];
  let vi = 0;

  // Ajoute un pavé x1→x2, y1→y2 (coordonnées absolues, décalées de -hy),
  // sur toute l'épaisseur du mur (z de -t/2 à +t/2).
  function box(x1, y1, x2, y2) {
    const Y1 = y1 - hy, Y2 = y2 - hy;
    const z1 = -t / 2,  z2 =  t / 2;
    const b = vi;
    pos.push(
      x1,Y1,z1, x2,Y1,z1, x2,Y2,z1, x1,Y2,z1,
      x1,Y1,z2, x2,Y1,z2, x2,Y2,z2, x1,Y2,z2,
    );
    idx.push(
      b,b+2,b+1, b,b+3,b+2,       // avant
      b+4,b+5,b+6, b+4,b+6,b+7,  // arrière
      b,b+1,b+5, b,b+5,b+4,       // bas
      b+3,b+7,b+6, b+3,b+6,b+2,  // haut
      b,b+4,b+7, b,b+7,b+3,       // gauche
      b+1,b+2,b+6, b+1,b+6,b+5,  // droite
    );
    vi += 8;
  }

  const hw = w / 2;
  box(-hw,        0,  -hw + frameW, opH);  // montant gauche
  box(hw - frameW, 0,   hw,         opH);  // montant droit
  box(-hw,       opH,   hw,          h);   // linteau

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * Cadre de fenêtre : allège (bas) + traverse (haut) + montants latéraux.
 * Ouverture centrale vide → vitrage ajouté séparément dans buildMeshForPiece.
 * Géométrie centrée sur Y (de -h/2 à +h/2).
 */
function makeWindowGeometry(w, h, frameW = 0.09) {
  const t       = WALL_THICKNESS;
  const sillH   = h * 0.28;              // allège basse
  const topH    = h * 0.18;              // traverse haute
  const openH   = h - sillH - topH;      // hauteur de l'ouverture vitrée
  const hy      = h / 2;

  const pos = [];
  const idx = [];
  let vi = 0;

  function box(x1, y1, x2, y2) {
    const Y1 = y1 - hy, Y2 = y2 - hy;
    const z1 = -t / 2,  z2 =  t / 2;
    const b = vi;
    pos.push(
      x1,Y1,z1, x2,Y1,z1, x2,Y2,z1, x1,Y2,z1,
      x1,Y1,z2, x2,Y1,z2, x2,Y2,z2, x1,Y2,z2,
    );
    idx.push(
      b,b+2,b+1, b,b+3,b+2,
      b+4,b+5,b+6, b+4,b+6,b+7,
      b,b+1,b+5, b,b+5,b+4,
      b+3,b+7,b+6, b+3,b+6,b+2,
      b,b+4,b+7, b,b+7,b+3,
      b+1,b+2,b+6, b+1,b+6,b+5,
    );
    vi += 8;
  }

  const hw = w / 2;
  box(-hw, 0,             hw,  sillH);           // allège
  box(-hw, sillH + openH, hw,  h);                // traverse haute
  box(-hw, sillH, -hw + frameW, sillH + openH);  // montant gauche
  box(hw - frameW, sillH,  hw, sillH + openH);   // montant droit

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * Quart de disque SOLIDE (fondation arrondie en coin) — pie-slice de CELL×CELL × depth.
 * Origine à (0, -depth/2, 0), arc dans le quadrant +X,+Z (angle 0→PI/2).
 */
function makeRoundFoundationGeometry(outerR = CELL, depth = FOUNDATION_DEPTH, segments = 8) {
  const halfD = depth / 2;
  const N = segments;
  const pos = [], idx = [];

  // Niveau bas : center (0) + arc[0..N] (1..N+1)
  pos.push(0, -halfD, 0);
  for (let i = 0; i <= N; i++) {
    const a = (Math.PI / 2) * (i / N);
    pos.push(outerR * Math.cos(a), -halfD, outerR * Math.sin(a));
  }
  // Niveau haut : center (N+2) + arc[0..N] (N+3..2N+3)
  pos.push(0, halfD, 0);
  for (let i = 0; i <= N; i++) {
    const a = (Math.PI / 2) * (i / N);
    pos.push(outerR * Math.cos(a), halfD, outerR * Math.sin(a));
  }

  const bC = 0, tC = N + 2;
  const bA = i => 1 + i;
  const tA = i => N + 3 + i;

  // Face basse (normal -Y) : CCW depuis le bas
  for (let i = 0; i < N; i++) idx.push(bC, bA(i), bA(i + 1));
  // Face haute (normal +Y) : CCW depuis le haut
  for (let i = 0; i < N; i++) idx.push(tC, tA(i + 1), tA(i));
  // Paroi externe arrondie (normal radial outward)
  for (let i = 0; i < N; i++) {
    idx.push(bA(i), tA(i), tA(i+1),  bA(i), tA(i+1), bA(i+1));
  }
  // Face radiale angle=0 (plan z=0, normal -Z)
  idx.push(bC, bA(0), tA(0),  bC, tA(0), tC);
  // Face radiale angle=PI/2 (plan x=0, normal -X)
  idx.push(bC, tC, tA(N),  bC, tA(N), bA(N));

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  // toNonIndexed() duplique les sommets pour que chaque triangle ait les siens.
  // computeVertexNormals() calcule alors une normale par face (flat shading géométrique)
  // sans interpolation entre la face haute et la paroi courbe → pas de dégradé.
  const flat = g.toNonIndexed();
  flat.computeVertexNormals();
  return flat;
}

/**
 * Quart de cylindre CREUX façon FENÊTRE — arc de 0 à PI/2 dans le plan XZ.
 * Génère un cadre ouvert : allège en bas, traverse en haut, montants aux deux extrémités.
 * Le vide central (ouverture vitrée) n'a PAS de géométrie — le vitrage est ajouté séparément.
 */
function makeRoundCornerWindowGeometry(outerR = CELL, h = WALL_UNIT, thickness = WALL_THICKNESS, segments = 8) {
  const innerR = outerR - thickness;
  const sillH  = h * 0.25;   // hauteur de l'allège
  const topH   = h * 0.21;   // hauteur de la traverse
  const y1     = sillH;
  const y2     = h - topH;

  const positions = [];
  const indices   = [];

  /** Ajoute une bande de quart-cylindre entre yBot et yTop. */
  function addBand(yBot, yTop) {
    const base = positions.length / 3;
    for (let i = 0; i <= segments; i++) {
      const a = (Math.PI / 2) * (i / segments);
      const c = Math.cos(a), s = Math.sin(a);
      positions.push(
        outerR * c, yBot, outerR * s,   // 4i+0  outer-bot
        outerR * c, yTop, outerR * s,   // 4i+1  outer-top
        innerR * c, yBot, innerR * s,   // 4i+2  inner-bot
        innerR * c, yTop, innerR * s,   // 4i+3  inner-top
      );
    }
    for (let i = 0; i < segments; i++) {
      const a = base + i * 4, b = base + (i + 1) * 4;
      indices.push(a,   a+1, b+1,  a,   b+1, b);     // face extérieure
      indices.push(a+2, b+2, b+3,  a+2, b+3, a+3);   // face intérieure
      indices.push(a+1, a+3, b+3,  a+1, b+3, b+1);   // dessus
      indices.push(a,   b,   b+2,  a,   b+2, a+2);   // dessous
    }
    // Capuchon angle=0 (normal -Z)
    indices.push(base, base+3, base+1,  base, base+2, base+3);
    // Capuchon angle=PI/2 (normal -X)
    const e = base + segments * 4;
    indices.push(e, e+1, e+3,  e, e+3, e+2);
  }

  addBand(0,  y1);   // allège (sill)
  addBand(y2, h);    // traverse (top bar)

  // ── Montant angle=0 (plan z=0, normal -Z) ──
  const jb = positions.length / 3;
  positions.push(
    outerR, y1, 0,   // jb+0 outer-bot
    outerR, y2, 0,   // jb+1 outer-top
    innerR, y1, 0,   // jb+2 inner-bot
    innerR, y2, 0,   // jb+3 inner-top
  );
  indices.push(jb, jb+3, jb+1,  jb, jb+2, jb+3);

  // ── Montant angle=PI/2 (plan x=0, normal -X) ──
  const jp = positions.length / 3;
  positions.push(
    0, y1, outerR,   // jp+0 outer-bot
    0, y2, outerR,   // jp+1 outer-top
    0, y1, innerR,   // jp+2 inner-bot
    0, y2, innerR,   // jp+3 inner-top
  );
  indices.push(jp, jp+1, jp+3,  jp, jp+3, jp+2);

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

/**
 * Quart de cylindre creux (murs arrondis) — arc de 0 à PI/2 dans le plan XZ.
 * L'origine est au centre de l'arc (coin intérieur de la cellule).
 * segments = résolution angulaire (8 suffit).
 */
function makeRoundCornerWallGeometry(outerR, h, thickness = WALL_THICKNESS, segments = 8) {
  const innerR = outerR - thickness;
  const positions = [];
  const indices   = [];

  // Pour chaque colonne angulaire : 4 sommets (outer-bot, outer-top, inner-bot, inner-top)
  for (let i = 0; i <= segments; i++) {
    const a = (Math.PI / 2) * (i / segments);
    const c = Math.cos(a), s = Math.sin(a);
    positions.push(
      outerR * c, 0, outerR * s,   // 4i+0 outer-bot
      outerR * c, h, outerR * s,   // 4i+1 outer-top
      innerR * c, 0, innerR * s,   // 4i+2 inner-bot
      innerR * c, h, innerR * s,   // 4i+3 inner-top
    );
  }

  for (let i = 0; i < segments; i++) {
    const a = i * 4, b = (i + 1) * 4;
    // Face extérieure (normale vers l'extérieur)
    indices.push(a, a+1, b+1,  a, b+1, b);
    // Face intérieure (normale vers l'intérieur)
    indices.push(a+2, b+2, b+3,  a+2, b+3, a+3);
    // Dessus
    indices.push(a+1, a+3, b+3,  a+1, b+3, b+1);
    // Dessous
    indices.push(a, b, b+2,  a, b+2, a+2);
  }
  // Capuchon côté angle 0 (normale vers -Z)
  indices.push(0, 3, 1,  0, 2, 3);
  // Capuchon côté angle PI/2 (normale vers +X)
  const e = segments * 4;
  indices.push(e, e+1, e+3,  e, e+3, e+2);

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

// ============================================================
// CONSTRUCTION DU MESH POUR UNE PIÈCE
// ============================================================
function createGeometryForPiece(piece) {
  const dim   = piece.dimensions || { w: 1, d: 1, h: 1, shape: 'square' };
  const rules = piece.placement_rules || {};
  const w     = (dim.w || 1) * CELL;
  const d     = (dim.d || 1) * CELL;
  const cat   = piece.category;
  const group = piece.group || '';
  const isHalf = (dim.h === 0.5);

  // --- Machine (raffinerie / fabricateur) : box aux dimensions RÉELLES en mètres ---
  // dim.w × dim.d × dim.h sont les cellules entières (arrondi sup) utilisées pour le snap
  // et le blocage. Pour le visuel on utilise la vraie taille (real_size_m), centrée
  // sur le footprint logique → on voit la machine "à l'aise" dans sa case réservée
  // et on comprend tout de suite pourquoi la cellule entière est bloquée.
  if (piece.is_machine) {
    const rs = piece.real_size_m || { w: CELL * 2.5, d: CELL * 2.5, h: CELL * 2.5 };
    // 1 cellule monde = 1 unité Three.js = 2.5 m → divise les mètres par 2.5 pour avoir des unités.
    const vw = rs.w / 2.5, vd = rs.d / 2.5, vh = rs.h / 2.5;
    return new THREE.BoxGeometry(vw, vh, vd);
  }

  // --- Porte : cadre avec ouverture basse ---
  if (cat === 'doors' && isDoorGroup(group) && rules.snap_target === 'edge') {
    const h = (dim.h && dim.h > 0 ? dim.h : 1) * WALL_UNIT;
    // Porte large (w ≥ 1.5 cellule) → montants plus fins pour ne pas obstruer l'ouverture
    const frameW = w >= 1.5 * CELL ? 0.12 : 0.10;
    return makeDoorFrameGeometry(w, h, frameW);
  }

  // --- Fondation arrondie en coin : disque-quart solide ---
  if (cat === 'foundations' && dim.shape === 'corner') {
    return makeRoundFoundationGeometry(CELL, FOUNDATION_DEPTH);
  }

  // --- Fenêtre arrondie en coin : cadre ouvert (allège + traverse + montants) ---
  if (isPieceWindowType(piece) && rules.snap_target === 'edge' && dim.shape === 'corner') {
    const h = (dim.h && dim.h > 0 ? dim.h : 1) * WALL_UNIT;
    return makeRoundCornerWindowGeometry(CELL, h, WALL_THICKNESS);
  }

  // --- Fenêtre plate : cadre rectangulaire avec allège et traverse ---
  if (isPieceWindowType(piece) && rules.snap_target === 'edge') {
    const h = (dim.h && dim.h > 0 ? dim.h : 1) * WALL_UNIT;
    return makeWindowGeometry(w, h);
  }

  // --- Murs arrondis en coin (Wall_Round_Corner*) — quart de cylindre ---
  if (rules.snap_target === 'edge' && dim.shape === 'corner') {
    const h = (dim.h && dim.h > 0 ? dim.h : 1) * WALL_UNIT;
    return makeRoundCornerWallGeometry(CELL, h, WALL_THICKNESS);
  }

  // --- Murs triangulaires (face avant découpée en triangle rectangle) ---
  if (rules.snap_target === 'edge' && group.startsWith('Wall_Triangle_')) {
    const h = (dim.h && dim.h > 0 ? dim.h : 1) * WALL_UNIT;
    return makeTriangleWallGeometry(w, h, triangleWallCorner(group));
  }

  // --- Murs droits (snap arête) ---
  if (rules.snap_target === 'edge') {
    const h = (dim.h && dim.h > 0 ? dim.h : 1) * WALL_UNIT;
    return new THREE.BoxGeometry(w, h, WALL_THICKNESS);
  }

  // --- Pillar Corner (snap coin) ---
  if (rules.snap_target === 'corner') {
    const h = (dim.h && dim.h > 0 ? dim.h : 1) * WALL_UNIT;
    return new THREE.BoxGeometry(PILLAR_W, h, PILLAR_W);
  }

  // --- Pillar Central (snap cellule) ---
  if (piece.is_pillar) {
    const h = (dim.h && dim.h > 0 ? dim.h : 1) * WALL_UNIT;
    return new THREE.BoxGeometry(PILLAR_W, h, PILLAR_W);
  }

  // --- Stairs / Ramps (catégorie stairs) ---
  if (cat === 'stairs') {
    const h = isHalf ? WALL_UNIT / 2 : WALL_UNIT;
    if (group.includes('Stairs') && !group.includes('Corner')) {
      return makeStairsGeometry(w, h, d, isHalf ? 3 : 5);
    }
    // Tous les autres (ramps + stairs_corner approximé en rampe pour v2)
    return makeRampGeometry(w, h, d);
  }

  // --- Toits inclinés (rampes / coins / coins intérieurs) ---
  // IMPORTANT : ces branches passent AVANT les checks de shape (dim.shape='corner'
  // / footprint_shape='triangle_*') car certains roofs ont ces propriétés (ex.
  // Roof_Wedge_Top_Half : shape=corner + footprint=triangle_isosceles) et seraient
  // sinon interceptés par les branches génériques de slab plate.
  if (cat === 'roofs' && isRoofRampGroup(group)) {
    const h = (dim.h === 0.5 ? 0.5 : 1) * WALL_UNIT;
    return makeRoofRampGeometry(w, d, h);
  }
  if (cat === 'roofs' && isRoofCornerGroup(group)) {
    const h = (dim.h === 0.5 ? 0.5 : 1) * WALL_UNIT;
    return makeRoofCornerGeometry(w, d, h);
  }
  if (cat === 'roofs' && isRoofCornerInwardGroup(group)) {
    const h = (dim.h === 0.5 ? 0.5 : 1) * WALL_UNIT;
    return makeRoofCornerInwardGeometry(w, d, h);
  }

  // --- Sol / Toit arrondi en coin : quart de disque plat (même forme que fondation arrondie) ---
  // Note: les Roof_Round_Corner restent en slab plate quart-de-disque pour le moment —
  // à raffiner en arc rond incliné dans une session future.
  if ((cat === 'floors' || cat === 'roofs') && dim.shape === 'corner') {
    return makeRoundFoundationGeometry(CELL, FLOOR_THICKNESS);
  }

  // --- Triangulaires (wedges, round corners de fondations) ---
  if (rules.footprint_shape === 'triangle_isosceles' || rules.footprint_shape === 'triangle_equilateral') {
    let h;
    if (cat === 'foundations') h = FOUNDATION_DEPTH;
    else if (cat === 'floors' || cat === 'roofs') h = FLOOR_THICKNESS;
    else h = (dim.h && dim.h > 0 ? dim.h : 0.3) * WALL_UNIT;
    return makeTrianglePrismGeometry(w, h, d);
  }

  // --- Sol / Toit-plat (slab fin) ---
  if (cat === 'floors' || cat === 'roofs') {
    return new THREE.BoxGeometry(w, FLOOR_THICKNESS, d);
  }

  // --- Fondation (pavé épais) ---
  if (cat === 'foundations') {
    return new THREE.BoxGeometry(w, FOUNDATION_DEPTH, d);
  }

  // --- Rambarde (snap arête mais peu épais, surélevé) ---
  if (cat === 'railings') {
    return new THREE.BoxGeometry(w, RAILING_HEIGHT, WALL_THICKNESS);
  }

  // --- Fallback : pavé selon dimensions ---
  const h = (dim.h && dim.h > 0 ? dim.h : 0.4) * WALL_UNIT;
  return new THREE.BoxGeometry(w, h, d);
}

/** Position & rotation du mesh selon l'item (snap_target + axis + rotation utilisateur). */
function placeMeshAt(mesh, item, piece) {
  const dim   = piece.dimensions || {};
  const rules = piece.placement_rules || {};
  const w     = (dim.w || 1) * CELL;
  const d     = (dim.d || 1) * CELL;
  // item.half = true → décalage de +½ étage (Shift pendant la pose : monte d'un demi-niveau
  // au-dessus du SOL COURANT, pour placer un plancher au sommet de demi-escaliers/rampes/murs).
  // L'item reste enregistré dans l'étage courant (item.z inchangé), pas dans l'étage au-dessus.
  const yBase = getFloorYBase(item.z ?? state.currentFloor) + getCategoryYOffset(piece)
              + (item.half ? 0.5 * WALL_UNIT : 0);
  const cat   = piece.category;
  const group = piece.group || '';

  // ---- Machine (snap cellule, footprint w×d cellules, posée sur le sol) ----
  // Centré sur le footprint logique. La box visuelle (taille réelle en m) est
  // automatiquement centrée sur cette position grâce à BoxGeometry centré XYZ.
  if (piece.is_machine) {
    const rs = piece.real_size_m || { h: dim.h * 2.5 };
    const realH = rs.h / 2.5;  // mètres → unités Three.js
    mesh.position.x = item.x + w / 2;
    mesh.position.z = item.y + d / 2;
    mesh.position.y = yBase + realH / 2;
    if (item.rotation) mesh.rotation.y = THREE.MathUtils.degToRad(item.rotation);
    return;
  }

  // ---- Fondation arrondie en coin (snap_target='cell', shape='corner') ----
  // Géométrie : disque-quart, origine à (0,0,0) = coin bas de la cellule.
  // Rotation autour du centre de la cellule (item.x+CELL/2, item.y+CELL/2).
  if (cat === 'foundations' && dim.shape === 'corner') {
    const userRad = THREE.MathUtils.degToRad(item.rotation || 0);
    const cx = item.x + CELL / 2, cz = item.y + CELL / 2;
    const dx0 = -CELL / 2, dz0 = -CELL / 2;
    mesh.position.x = cx + dx0 * Math.cos(userRad) + dz0 * Math.sin(userRad);
    mesh.position.z = cz - dx0 * Math.sin(userRad) + dz0 * Math.cos(userRad);
    mesh.position.y = yBase + FOUNDATION_DEPTH / 2;
    mesh.rotation.y = userRad;
    return;
  }

  // ---- Sol / Toit arrondi en coin (même logique, épaisseur FLOOR_THICKNESS) ----
  if ((cat === 'floors' || cat === 'roofs') && dim.shape === 'corner') {
    const userRad = THREE.MathUtils.degToRad(item.rotation || 0);
    const cx = item.x + CELL / 2, cz = item.y + CELL / 2;
    const dx0 = -CELL / 2, dz0 = -CELL / 2;
    mesh.position.x = cx + dx0 * Math.cos(userRad) + dz0 * Math.sin(userRad);
    mesh.position.z = cz - dx0 * Math.sin(userRad) + dz0 * Math.cos(userRad);
    mesh.position.y = yBase + FLOOR_THICKNESS / 2;
    mesh.rotation.y = userRad;
    return;
  }

  // ---- Snap edge — mur/fenêtre arrondi(e) : rotation autour du centre de cellule ----
  if (rules.snap_target === 'edge' && dim.shape === 'corner') {
    // L'arc occupe une cellule CELL×CELL ; son centre géométrique sert de pivot de rotation.
    // Origin de l'arc en frame de base (sans rotation user) = coin (item.x, item.y),
    // soit un décalage (-CELL/2, -CELL/2) depuis le centre de la cellule.
    const baseRotY = (item.axis === 'h') ? 0 : -Math.PI / 2;
    const userRad  = THREE.MathUtils.degToRad(item.rotation || 0);
    // Centre de la cellule occupée par l'arc — dépend de l'axe :
    //   axis='h' : arc dans le quadrant +X,+Z depuis (item.x, item.y) → centre à (+CELL/2, +CELL/2)
    //   axis='v' : arc dans le quadrant -X,+Z depuis (item.x, item.y) → centre à (-CELL/2, +CELL/2)
    let cx, cz, dx0, dz0;
    if (item.axis === 'h') {
      cx = item.x + CELL / 2;  cz = item.y + CELL / 2;
      dx0 = -CELL / 2;  dz0 = -CELL / 2;
    } else {
      cx = item.x - CELL / 2;  cz = item.y + CELL / 2;
      dx0 =  CELL / 2;  dz0 = -CELL / 2;
    }
    // Rotation Three.js Y positive : +X → -Z, formule (x,z)→(x·cosα+z·sinα, -x·sinα+z·cosα)
    mesh.position.x = cx + dx0 * Math.cos(userRad) + dz0 * Math.sin(userRad);
    mesh.position.z = cz - dx0 * Math.sin(userRad) + dz0 * Math.cos(userRad);
    mesh.position.y = yBase; // arc non centré en Y (origine au bas)
    mesh.rotation.y = baseRotY + userRad;
    return; // rotation déjà appliquée — ne pas retomber dans le bloc générique ci-dessous
  }
  // ---- Snap edge — mur droit ----
  else if (rules.snap_target === 'edge') {
    if (item.axis === 'h') {
      mesh.position.x = item.x + w / 2;
      mesh.position.z = item.y;
      mesh.rotation.y = 0;
    } else {
      mesh.position.x = item.x;
      mesh.position.z = item.y + w / 2;
      mesh.rotation.y = Math.PI / 2;
    }
    // Hauteur : BoxGeometry centré → +h/2
    const h = (dim.h && dim.h > 0 ? dim.h : 1) * WALL_UNIT;
    if (cat === 'railings') {
      mesh.position.y = yBase + RAILING_HEIGHT / 2;
    } else {
      mesh.position.y = yBase + h / 2;
    }
  }
  // ---- Snap corner ----
  else if (rules.snap_target === 'corner') {
    mesh.position.x = item.x;
    mesh.position.z = item.y;
    const h = (dim.h && dim.h > 0 ? dim.h : 1) * WALL_UNIT;
    mesh.position.y = yBase + h / 2;
  }
  // ---- Pillar central ----
  else if (piece.is_pillar) {
    mesh.position.x = item.x + 0.5;
    mesh.position.z = item.y + 0.5;
    const h = (dim.h && dim.h > 0 ? dim.h : 1) * WALL_UNIT;
    mesh.position.y = yBase + h / 2;
  }
  // ---- Stairs / Ramps (géométrie centrée XZ, origine bas) ----
  else if (cat === 'stairs') {
    mesh.position.x = item.x + w / 2;
    mesh.position.z = item.y + d / 2;
    mesh.position.y = yBase;
  }
  // ---- Toits inclinés (rampe / coin / coin intérieur) : géométrie origine Y=0 ----
  // IMPORTANT : passe AVANT la branche triangle car certains roof_wedge ont
  // footprint=triangle_isosceles et seraient sinon interceptés.
  // mesh.y = yBase + FLOOR_THICKNESS pour poser la base du wedge AU SOMMET des murs
  // (yBase est positionné FLOOR_THICKNESS en-dessous pour les rooflike, convention slab plat).
  else if (cat === 'roofs' && (isRoofRampGroup(group) || isRoofCornerGroup(group) || isRoofCornerInwardGroup(group))) {
    mesh.position.x = item.x + w / 2;
    mesh.position.z = item.y + d / 2;
    mesh.position.y = yBase + FLOOR_THICKNESS;
  }
  // ---- Triangulaires (géométrie ÉQUILATÉRALE centrée XZ, origine bas) ----
  // Phase 1 du refactor triangle : la géométrie est maintenant équilatérale (3 côtés
  // égaux de 1 unité, hauteur √3/2 ≈ 0.866). Le mesh reste centré sur la cellule
  // (item.x + w/2, item.y + d/2) — la base s'aligne donc sur une arête de cellule
  // (sud par défaut, rot 0) et l'apex pointe vers l'intérieur de la cellule à
  // 0.866 unité (n'atteint pas l'arête opposée à z=1). Centre de rotation = centre
  // de cellule, donc rot 0/90/180/270 placent la base sur les 4 arêtes du carré.
  // À VENIR (Phase 2-4) : snap par arête (au lieu de cellule) + rotations 60° + ancrage.
  else if (rules.footprint_shape === 'triangle_isosceles' || rules.footprint_shape === 'triangle_equilateral') {
    // Refactor Phase 2.3 : si l'item est ancré sur une arête (snap_kind='anchor'),
    // on résout sa position via resolveTrianglePosition au lieu d'utiliser (item.x,
    // item.y) comme cellule. Pour les anciens items cellule-snap, on garde le
    // comportement précédent (utilisé tant que la migration Phase 2.4 n'a pas
    // converti l'item).
    if (item.snap_kind === 'anchor') {
      const resolved = resolveTrianglePosition(item, state.plan);
      if (resolved) {
        mesh.position.x = resolved.x;
        mesh.position.z = resolved.z;
        mesh.position.y = yBase;
        // La rotation absolue est posée ici ; le bloc "rotation utilisateur"
        // plus bas l'écraserait sinon → on neutralise item.rotation pour ce path
        // en posant directement mesh.rotation.y et en sortant par retour anticipé
        // de la fonction.
        mesh.rotation.y = THREE.MathUtils.degToRad(resolved.rotation);
        return;
      }
      // Si la résolution échoue (orphelin ou cycle), fallback sur l'ancien mode
      // pour ne pas crasher : positionne au centre des coords stockées si présent.
      console.warn('[triangle] anchor non résolu pour item', item.id, '— fallback cell');
    }
    mesh.position.x = item.x + w / 2;
    mesh.position.z = item.y + d / 2;
    mesh.position.y = yBase;
  }
  // ---- Foundation / Floor / Roof (BoxGeometry centré) ----
  else if (cat === 'foundations') {
    mesh.position.x = item.x + w / 2;
    mesh.position.z = item.y + d / 2;
    mesh.position.y = yBase + FOUNDATION_DEPTH / 2;
  }
  else if (cat === 'floors' || cat === 'roofs') {
    mesh.position.x = item.x + w / 2;
    mesh.position.z = item.y + d / 2;
    mesh.position.y = yBase + FLOOR_THICKNESS / 2;
  }
  else {
    mesh.position.x = item.x + w / 2;
    mesh.position.z = item.y + d / 2;
    const h = (dim.h && dim.h > 0 ? dim.h : 0.4) * WALL_UNIT;
    mesh.position.y = yBase + h / 2;
  }

  // Rotation utilisateur s'ajoute à l'orientation d'arête
  if (item.rotation) {
    mesh.rotation.y += THREE.MathUtils.degToRad(item.rotation);
  }
}

/** Y du « sol » de l'étage (la face haute des fondations). */
function getFloorYBase(floorIndex) {
  return FOUNDATION_DEPTH + floorIndex * WALL_UNIT;
}

/** Décalage Y par catégorie depuis le yBase (= surface de marche de l'étage).
 *  Convention : yBase = FOUNDATION_DEPTH + Z*WALL_UNIT (la surface où on marche au niveau Z).
 *  - foundation  : -FOUNDATION_DEPTH → TOP à yBase
 *  - floor       : -FLOOR_THICKNESS  → TOP à yBase (plancher ordinaire)
 *  - Rooftop     : WALL_UNIT - FLOOR_THICKNESS → TOP à yBase+WALL_UNIT (plafond/toit plat)
 *  - roofs (inclinés) : WALL_UNIT - FLOOR_THICKNESS → même hauteur
 *  - walls, doors, stairs… : 0
 */
function getCategoryYOffset(piece) {
  const cat = piece.category;
  if (cat === 'foundations')  return -FOUNDATION_DEPTH;
  // Toit/plafond (group Rooftop OU label "Toit*"/"Plafond*") : haut des murs
  if (cat === 'floors' && isPieceRooflike(piece)) return WALL_UNIT - FLOOR_THICKNESS;
  if (cat === 'floors')       return -FLOOR_THICKNESS;
  if (cat === 'roofs')        return WALL_UNIT - FLOOR_THICKNESS;
  return 0;
}

/** Retourne true si la pièce se comporte comme un toit/plafond (posé en haut des murs).
 *  Couvre :
 *   - Toutes les pièces de la catégorie 'roofs' (toits inclinés)
 *   - group === 'Rooftop' (Toit plat 2 et variantes)
 *   - Pièces catégorie 'floors' dont le label_fr commence par "Toit" ou contient "Plafond"
 *     (ex : "Toit plat", "Toit plat triangulaire", "Plafond du palais de Caladán")
 */
function isPieceRooflike(piece) {
  if (!piece) return false;
  if (piece.category === 'roofs') return true;
  if (piece.category === 'floors') {
    if (piece.group === 'Rooftop') return true;
    const lbl = (piece.label_fr || piece.label_en || '').toLowerCase();
    if (lbl.startsWith('toit') || lbl.includes('plafond') || lbl.includes('ceiling')) return true;
  }
  return false;
}

/**
 * Crée un sprite-texte (canvas → texture) pour étiqueter une machine/véhicule.
 * Toujours face à la caméra (Sprite), visible à travers les autres objets
 * (depthTest=false) pour rester lisible même quand la machine est partiellement
 * occultée par un mur ou un plafond.
 */
function makeMachineLabelSprite(text, accentColor) {
  // Mesure du texte pour adapter la largeur du canvas
  const FONT = 'bold 44px "Trebuchet MS", "Segoe UI", sans-serif';
  const PADDING_X = 28;
  const HEIGHT_PX = 68;
  const measureCanvas = document.createElement('canvas');
  const mctx = measureCanvas.getContext('2d');
  mctx.font = FONT;
  const textW = mctx.measureText(text).width;
  const canvasW = Math.max(192, Math.ceil(textW + PADDING_X * 2));

  const canvas = document.createElement('canvas');
  canvas.width  = canvasW;
  canvas.height = HEIGHT_PX;
  const ctx = canvas.getContext('2d');

  // Fond pastille semi-opaque + bordure colorée accentuée (couleur de la pièce)
  ctx.fillStyle = 'rgba(8, 5, 2, 0.78)';
  const r = 10;  // rayon des coins
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.lineTo(canvasW - r, 0);
  ctx.quadraticCurveTo(canvasW, 0, canvasW, r);
  ctx.lineTo(canvasW, HEIGHT_PX - r);
  ctx.quadraticCurveTo(canvasW, HEIGHT_PX, canvasW - r, HEIGHT_PX);
  ctx.lineTo(r, HEIGHT_PX);
  ctx.quadraticCurveTo(0, HEIGHT_PX, 0, HEIGHT_PX - r);
  ctx.lineTo(0, r);
  ctx.quadraticCurveTo(0, 0, r, 0);
  ctx.closePath();
  ctx.fill();

  // Bordure : couleur d'accent (ambré pour machines, bleu acier pour véhicules)
  const rb = (accentColor >> 16) & 255;
  const gb = (accentColor >> 8)  & 255;
  const bb =  accentColor        & 255;
  ctx.strokeStyle = `rgba(${rb}, ${gb}, ${bb}, 0.85)`;
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // Texte ivoire
  ctx.fillStyle = '#f5e6c5';
  ctx.font = FONT;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvasW / 2, HEIGHT_PX / 2 + 2);

  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 4;
  tex.needsUpdate = true;

  const mat = new THREE.SpriteMaterial({
    map: tex,
    depthTest:  false,   // toujours visible
    depthWrite: false,
    transparent: true,
  });
  const sprite = new THREE.Sprite(mat);
  // Échelle : conserve le ratio canvas, hauteur de référence = 0.35 unité monde
  // (1 unité = 1 cellule = 2.5 m, donc label ≈ 88 cm de haut au sol)
  const baseHeight = 0.35;
  sprite.scale.set(baseHeight * (canvasW / HEIGHT_PX), baseHeight, 1);
  sprite.renderOrder = 999;  // au-dessus de tout
  return sprite;
}

function buildMeshForPiece(piece, item) {
  if (ENGINE === 'sockets') return socketBuildMesh(item);
  const color = getPieceColor(piece);
  const geo   = createGeometryForPiece(piece);
  // Machines : matériau semi-transparent pour qu'on voie les pièces structurelles à travers
  const mat   = piece.is_machine
    ? new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0.30, transparent: true, opacity: 0.55 })
    : new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.15 });
  const mesh  = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  // Outline noir (edges) pour la lisibilité — plus marqué sur les machines pour visualiser le volume
  const edges = new THREE.EdgesGeometry(geo, 30);
  const edgesOpacity = piece.is_machine ? 0.75 : 0.45;
  const edgesMat = new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: edgesOpacity });
  const edgesLine = new THREE.LineSegments(edges, edgesMat);
  mesh.add(edgesLine);
  mesh.userData.edges = edgesLine;

  // Label texte pour machines/véhicules — flotte juste au-dessus du sommet du cube
  if (piece.is_machine) {
    const label = makeMachineLabelSprite(piece.label_fr || piece.label_en || piece.id, color);
    const rs = piece.real_size_m || { h: 2.5 };
    const realH = rs.h / 2.5;
    label.position.set(0, realH / 2 + 0.25, 0);
    mesh.add(label);
    mesh.userData.label = label;
  }

  placeMeshAt(mesh, item, piece);

  const _dimW  = piece.dimensions || {};
  const _rules = piece.placement_rules || {};

  // Vitrage arc pour fenêtre arrondie en coin — toujours visible, opacité réduite en solidView
  if (isPieceWindowType(piece) && _rules.snap_target === 'edge' && _dimW.shape === 'corner') {
    const h      = (_dimW.h && _dimW.h > 0 ? _dimW.h : 1) * WALL_UNIT;
    const sillH  = h * 0.25;
    const topH   = h * 0.21;
    const openH  = h - sillH - topH;   // hauteur exacte de l'ouverture
    // Vitrage centré dans l'épaisseur du mur (20%→80%), bien visible
    const gGlass = makeRoundCornerWallGeometry(CELL - WALL_THICKNESS * 0.2, openH, WALL_THICKNESS * 0.60, 8);
    const mGlass = new THREE.MeshStandardMaterial({
      color: 0x88ddff, transparent: true, opacity: state.solidView ? 0.18 : 0.38,
      roughness: 0.05, metalness: 0.25, depthWrite: false,
    });
    const glass = new THREE.Mesh(gGlass, mGlass);
    glass.position.y = sillH;   // posé juste au-dessus de l'allège
    // Stocké dans cornerGlass (pas glassPanel) : toujours visible, opacité seule change
    mesh.add(glass);
    mesh.userData.cornerGlass = glass;
  }

  // Vitrage semi-transparent pour les fenêtres plates (pas pour les arrondies)
  if (isPieceWindowType(piece)
      && _rules.snap_target === 'edge'
      && _dimW.shape !== 'corner') {   // fenêtre arrondie → pas de verre rectangulaire
    const h      = (_dimW.h && _dimW.h > 0 ? _dimW.h : 1) * WALL_UNIT;
    const ww     = (_dimW.w || 1) * CELL;
    const sillH  = h * 0.28;
    const openH  = h * 0.54;
    const frameW = 0.09;
    const gGlass = new THREE.BoxGeometry(ww - frameW * 2, openH, WALL_THICKNESS * 0.22);
    const mGlass = new THREE.MeshStandardMaterial({
      color: 0x88ddff, transparent: true, opacity: 0.28,
      roughness: 0.05, metalness: 0.25, depthWrite: false,
    });
    const glass = new THREE.Mesh(gGlass, mGlass);
    glass.position.y = sillH + openH / 2 - h / 2; // centré dans l'ouverture (espace local)
    glass.visible = !state.solidView;               // respecte le mode vue solide
    mesh.add(glass);
    mesh.userData.glassPanel = glass;
  }

  mesh.userData.itemId    = item.id;
  mesh.userData.pieceId   = piece.id;
  mesh.userData.piece     = piece;
  mesh.userData.baseColor = color;
  mesh.userData.floorZ    = item.z ?? state.currentFloor;
  return mesh;
}

// ============================================================
// VISIBILITÉ PAR ÉTAGE — opacité, overlay doré N-1
// ============================================================
function updateFloorVisibility() {
  if (state.solidView) return;   // vue solide gère elle-même l'opacité
  const cur   = state.currentFloor;
  const selId = state.selectedItemId;
  for (const [itemId, mesh] of placedMeshes) {
    // ── Meshes socket (Groups) : visibilité par SPAN d'étages ────────────────
    // Une pièce occupe [floorZ .. floorTop] (floorTop > floorZ pour les pièces hautes
    // comme la Grande porte). Opaque si l'étage courant est dans le span, estompée si
    // entièrement en dessous, masquée si entièrement au-dessus.
    if (mesh.userData.socket) {
      const fz = mesh.userData.floorZ ?? 0;
      const ft = mesh.userData.floorTop ?? fz;
      if (fz > cur) { mesh.visible = false; continue; }    // entièrement au-dessus
      mesh.visible = true;
      const op = (cur <= ft) ? 1 : 0.28;                   // dans le span = opaque, sinon estompé
      mesh.traverse(o => { if (o.isMesh && o.material) {
        o.material.transparent = op < 1; o.material.opacity = op; o.material.needsUpdate = true;
      }});
      continue;
    }
    const z     = mesh.userData.floorZ;
    if (z === undefined) continue;
    const piece  = mesh.userData.piece;
    const isRoof = isPieceRooflike(piece);
    const isSel  = (itemId === selId);
    const edges  = mesh.userData.edges;
    const mat    = mesh.material;

    // ── Toits : logique décalée d'un étage ─────────────────────────────────
    // Un toit posé à Z occupe la même hauteur que le plancher de Z+1.
    // Sur Z   → plafond : semi-transparent avec contours dorés
    // Sur Z+1 → plancher : pleine opacité (on voit le sol sur lequel on marche)
    // Sous Z  → masqué
    if (isRoof) {
      if (z > cur) {
        mesh.visible = false;
      } else if (z === cur) {
        // Plafond de l'étage courant — assez opaque pour être visible, contours dorés nets
        mesh.visible    = true;
        mat.transparent = true;
        mat.opacity     = 0.65;
        mat.color.setHex(mesh.userData.baseColor);
        if (edges) {
          edges.material.color.setHex(isSel ? COLOR_SELECT : 0xcda434);
          edges.material.opacity = 0.90;
        }
        mat.needsUpdate = true;
      } else if (z === cur - 1) {
        // Plancher de l'étage courant (toit de Z-1) — pleine opacité
        mesh.visible    = true;
        mat.transparent = false;
        mat.opacity     = 1;
        mat.color.setHex(mesh.userData.baseColor);
        if (edges && !isSel) {
          edges.material.color.setHex(0x000000);
          edges.material.opacity = 0.45;
        }
        mat.needsUpdate = true;
      } else if (z === cur - 2) {
        // Toit deux étages plus bas — translucide, contours discrets
        mesh.visible    = true;
        mat.transparent = true;
        mat.opacity     = 0.40;
        mat.color.setHex(mesh.userData.baseColor);
        if (edges && !isSel) {
          edges.material.color.setHex(0x000000);
          edges.material.opacity = 0.25;
        } else if (edges && isSel) {
          edges.material.color.setHex(COLOR_SELECT);
          edges.material.opacity = 0.80;
        }
        mat.needsUpdate = true;
      } else {
        mesh.visible    = true;
        mat.transparent = true;
        mat.opacity     = 0.12;
        mat.color.setHex(mesh.userData.baseColor);
        if (edges && !isSel) {
          edges.material.color.setHex(0x000000);
          edges.material.opacity = 0.10;
        }
        mat.needsUpdate = true;
      }
      continue;
    }

    // ── Pièces non-toit ─────────────────────────────────────────────────────
    // Cas spécial : un plancher (ou fondation) à z = cur+1 occupe physiquement la même
    // hauteur que le plafond de cur (y ≈ WALL_UNIT au-dessus du sol courant). On l'affiche
    // donc comme plafond semi-transparent pour qu'on voie le "plafond plancher" depuis cur.
    // Fondations : toujours opaques comme les murs (pas de transparence plafond)
    const isFloorLike = piece?.category === 'floors';
    if (z === cur + 1 && isFloorLike) {
      // Plancher d'un étage au-dessus = plafond visuel du courant.
      // Pièce d'un autre étage → contours sombres discrets (pas de doré).
      mesh.visible    = true;
      mat.transparent = true;
      mat.opacity     = 0.55;
      mat.color.setHex(mesh.userData.baseColor);
      if (edges && !isSel) {
        edges.material.color.setHex(0x000000);
        edges.material.opacity = 0.30;
      } else if (edges && isSel) {
        edges.material.color.setHex(COLOR_SELECT);
        edges.material.opacity = 0.80;
      }
      mat.needsUpdate = true;
      continue;
    }
    if (z > cur) { mesh.visible = false; continue; }
    mesh.visible = true;
    if (z === cur) {
      mat.transparent = false;
      mat.opacity     = 1;
      mat.color.setHex(mesh.userData.baseColor);
      if (edges && !isSel) {
        edges.material.color.setHex(0x000000);
        edges.material.opacity = 0.45;
      }
    } else if (z === cur - 1) {
      // Étage N-1 : translucide, contours sombres discrets (plus de doré envahissant)
      mat.transparent = true;
      mat.opacity     = 0.40;
      mat.color.setHex(mesh.userData.baseColor);
      if (edges && !isSel) {
        edges.material.color.setHex(0x000000);
        edges.material.opacity = 0.25;
      } else if (edges && isSel) {
        edges.material.color.setHex(COLOR_SELECT);
        edges.material.opacity = 0.80;
      }
    } else {
      // Étages N-2 et en-dessous : très translucides
      mat.transparent = true;
      mat.opacity     = 0.18;
      mat.color.setHex(mesh.userData.baseColor);
      if (edges && !isSel) {
        edges.material.color.setHex(0x000000);
        edges.material.opacity = 0.10;
      }
    }
    mat.needsUpdate = true;
  }
}

/** Met à jour les badges compteurs sur chaque onglet d'étage. */
function updateFloorBadges() {
  const scroll = document.getElementById('bp-floors-scroll');
  if (!scroll) return;
  for (const f of state.plan.floors) {
    const tab = scroll.querySelector(`.bp-floor-tab[data-floor="${f.z}"]`);
    if (!tab) continue;
    let badge = tab.querySelector('.bp-floor-badge');
    if (f.items.length === 0) {
      if (badge) badge.remove();
    } else {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'bp-floor-badge';
        tab.appendChild(badge);
      }
      badge.textContent = f.items.length;
    }
  }
}

/** Affiche un indicateur HUD quand l'auto-stack résout sur un étage différent du courant. */
function showFloorResolveHud(resolvedFloor, customMessage) {
  if (!dom.hudFloorResolve) return;
  if (customMessage) {
    // Message personnalisé (utilisé par copier-coller d'étage, etc.)
    dom.hudFloorResolve.textContent = customMessage;
    dom.hudFloorResolve.classList.add('visible');
    // Auto-hide après 2.5s pour les messages personnalisés
    clearTimeout(showFloorResolveHud._timer);
    showFloorResolveHud._timer = setTimeout(() => {
      dom.hudFloorResolve.classList.remove('visible');
    }, 2500);
    return;
  }
  if (resolvedFloor !== state.currentFloor) {
    const name = resolvedFloor < 0 ? 'S' + Math.abs(resolvedFloor)
               : resolvedFloor === 0 ? 'RDC' : 'N' + resolvedFloor;
    dom.hudFloorResolve.textContent = '↑ ' + name;
    dom.hudFloorResolve.classList.add('visible');
  } else {
    dom.hudFloorResolve.classList.remove('visible');
  }
}

// ============================================================
// SNAP (per snap_target)
// ============================================================
/** Pour une cellule (cx,cz) et coordonnées locales (lx,lz∈[0,1]), retourne l'edge le plus proche. */
function nearestEdgeOfCell(cx, cz, lx, lz) {
  const dN = lz;        // bord nord
  const dS = 1 - lz;    // bord sud
  const dW = lx;        // bord ouest
  const dE = 1 - lx;    // bord est
  const min = Math.min(dN, dS, dW, dE);
  if (min === dN) return { x: cx,     y: cz,     axis: 'h' };
  if (min === dS) return { x: cx,     y: cz + 1, axis: 'h' };
  if (min === dW) return { x: cx,     y: cz,     axis: 'v' };
  /* dE */         return { x: cx + 1, y: cz,     axis: 'v' };
}

/** Calcule la cible de snap selon la règle de la pièce. */
function snapForPiece(worldPos, piece) {
  if (!worldPos) return null;
  const rules = piece.placement_rules || {};
  const cat   = piece.category;

  // Phase 3.2 + 4b refactor triangle — Pour tous les sols/fondations en
  // snap_target='cell', on essaie d'abord le snap par arête (ancrage). Le snap
  // qui place la pièce le plus PROCHE du curseur l'emporte (cellule vs ancre).
  //
  // Triangle (footprint équilatéral/isocèle) : toujours en ancrage, jamais en
  // cellule (règle "doit être relié" du jeu). Si aucune arête libre → null.
  //
  // Carré/fondation (footprint square) : ancrage si attractif, sinon grille.
  // Permet de garder la pose libre sur grille en zone vide, tout en snappant
  // naturellement aux pièces existantes quand le curseur s'en approche.
  const isTriangle = rules.footprint_shape === 'triangle_isosceles'
                  || rules.footprint_shape === 'triangle_equilateral';
  const isFloorOrFoundation = cat === 'floors' || cat === 'foundations';

  if (isFloorOrFoundation && rules.snap_target === 'cell') {
    const z = state.currentFloor;
    const nearest = findNearestFreeEdge(worldPos, state.plan, z);

    if (isTriangle) {
      if (!nearest) return null;
      return {
        kind: 'anchor',
        anchor_item_id: nearest.item.id,
        anchor_edge_index: nearest.edge.index,
      };
    }

    // Pour les pièces carrées : ancrage si le CURSEUR est proche d'une arête libre.
    // Le seuil = à quelle distance de l'arête on bascule de "grille" à "ancrage".
    // 0.5 = quand le curseur est plus près d'une arête que du centre de cellule.
    // Au-delà → la pièce s'aligne sur la grille.
    const ANCHOR_THRESHOLD = 0.5;
    if (nearest && nearest.dist < ANCHOR_THRESHOLD) {
      return {
        kind: 'anchor',
        anchor_item_id: nearest.item.id,
        anchor_edge_index: nearest.edge.index,
      };
    }
    // sinon : fallback grille → on continue avec le code cell-snap ci-dessous
  }

  const cx = Math.floor(worldPos.x / CELL);
  const cz = Math.floor(worldPos.z / CELL);
  const lx = worldPos.x / CELL - cx;
  const lz = worldPos.z / CELL - cz;

  if (rules.snap_target === 'edge') {
    return { kind: 'edge', ...nearestEdgeOfCell(cx, cz, lx, lz) };
  }
  if (rules.snap_target === 'corner') {
    return { kind: 'corner', x: Math.round(worldPos.x / CELL), y: Math.round(worldPos.z / CELL) };
  }
  // cell par défaut
  return { kind: 'cell', x: cx, y: cz };
}

/**
 * Retourne false si les deux catégories occupent le même espace vertical sur un étage.
 * Paires compatibles (Y non-chevauchants) :
 *  - floors/foundations (sous la surface) + roofs (slab haut)
 *  - floors/foundations (sous la surface) + stairs (posés sur la surface, montent)
 *  - roofs (slab haut)                    + stairs (montent depuis la surface)
 */
/** Classe verticale d'une pièce pour le calcul de conflits d'occupation.
 *  - 'floor'  : plancher (y bas des murs)
 *  - 'roof'   : toit/plafond (y haut des murs) — roofs inclinés, Rooftop, et labels "Toit*"/"Plafond*"
 *  - 'stair'  : escaliers/rampes (du sol jusqu'en haut)
 *  - 'other'  : tout le reste (murs, portes, piliers…)
 */
function vertClass(piece) {
  if (!piece) return 'other';
  // Machine : repose au-dessus d'un sol (fondation, plancher), donc on doit pouvoir
  // la poser sur une cellule qui contient déjà l'un de ces deux types.
  if (piece.is_machine)              return 'machine';
  const cat = piece.category;
  if (cat === 'foundations')         return 'floor';
  // isPieceRooflike couvre roofs + group=Rooftop + label "Toit*"/"Plafond*"
  if (isPieceRooflike(piece))        return 'roof';
  if (cat === 'floors')              return 'floor';
  if (cat === 'stairs')              return 'stair';
  return 'other';
}

/** Retourne true si deux pièces occupent le même espace vertical (= conflit possible).
 *  Accepte désormais les objets pièce complets pour différencier Rooftop des planchers. */
function sameVerticalSpace(pieceA, pieceB) {
  // Compatibilité avec les anciens appels par catégorie (chaîne)
  const vcA = (typeof pieceA === 'string') ? pieceA : vertClass(pieceA);
  const vcB = (typeof pieceB === 'string') ? pieceB : vertClass(pieceB);
  const isFloor   = v => v === 'floor' || v === 'floors' || v === 'foundations';
  const isRoof    = v => v === 'roof'  || v === 'roofs';
  const isStair   = v => v === 'stair' || v === 'stairs';
  const isMachine = v => v === 'machine';
  if (isFloor(vcA) && isRoof(vcB))                       return false;
  if (isRoof(vcA)  && isFloor(vcB))                      return false;
  if (isStair(vcA) && (isFloor(vcB) || isRoof(vcB)))     return false;
  if ((isFloor(vcA) || isRoof(vcA)) && isStair(vcB))     return false;
  // Machine repose AU-DESSUS du sol : la cellule peut contenir une fondation/plancher
  // et la machine simultanément (espaces verticaux différents, machine sur la surface).
  if (isMachine(vcA) && (isFloor(vcB) || isRoof(vcB)))   return false;
  if ((isFloor(vcA) || isRoof(vcA)) && isMachine(vcB))   return false;
  return true;
}

// ============================================================
// ARÊTES 3D DES PIÈCES (refactor triangle Phase 2.1)
// ============================================================

/**
 * Calcule les arêtes 3D (dans le plan XZ) d'une pièce posée, dans son orientation
 * actuelle (item.rotation appliquée autour du centre de cellule).
 *
 * Utilisé par le snap par arête des triangles : étant donné une pièce posée, on
 * connaît ses N arêtes "libres" (= non partagées avec un voisin direct), et un
 * nouveau triangle peut s'ancrer à l'une d'elles avec sa base alignée dessus.
 *
 * Renvoie un tableau d'arêtes. Chaque arête :
 *   { p1, p2, mid, outX, outZ, length, index }
 *  - p1, p2  : extrémités en monde (objets {x, z})
 *  - mid     : milieu de l'arête
 *  - outX/Z  : composantes du vecteur normal sortant unité (perpendiculaire à
 *              l'arête, pointant vers l'extérieur de la pièce)
 *  - length  : longueur de l'arête (1 pour carré standard, 1 pour côté de triangle équi)
 *  - index   : index stable de l'arête dans la pièce
 *              - carré : 0=sud, 1=est, 2=nord, 3=ouest (avant rotation)
 *              - triangle : 0=base, 1=oblique droite, 2=oblique gauche
 *
 * Pour les pièces non-ancrables (murs, escaliers, machines), renvoie un tableau vide.
 *
 * Note convention rotation : Three.js mesh.rotation.y positif applique la matrice
 *   [cos  0  sin]   à un vecteur local (lx, 0, lz), donnant
 *   [-sin 0  cos]   (lx*cos + lz*sin, 0, -lx*sin + lz*cos).
 * On utilise exactement cette même formule pour calculer les vertices visuels.
 */
function getPieceEdges(piece, item) {
  if (!piece || !item) return [];
  const rules = piece.placement_rules || {};
  const cat   = piece.category;
  // Seuls les sols/fondations (carrés ou triangulaires) sont ancrables pour l'instant.
  if (cat !== 'floors' && cat !== 'foundations') return [];

  const dim = piece.dimensions || {};
  const w   = (dim.w || 1) * CELL;
  const d   = (dim.d || 1) * CELL;
  const isTriangle = rules.footprint_shape === 'triangle_isosceles'
                  || rules.footprint_shape === 'triangle_equilateral';

  const cx = item.x + w / 2;
  const cz = item.y + d / 2;
  const rotRad = THREE.MathUtils.degToRad(item.rotation || 0);
  const cosR = Math.cos(rotRad);
  const sinR = Math.sin(rotRad);

  // Transforme un point local (avant rotation, relatif au centre de pièce) en monde.
  const toWorld = (lx, lz) => ({
    x: cx + lx * cosR + lz * sinR,
    z: cz - lx * sinR + lz * cosR,
  });

  if (isTriangle) {
    const H = w * Math.sqrt(3) / 2;     // hauteur équilatérale ≈ 0.866 si w=1
    // Vertices locaux (cohérents avec makeTrianglePrismGeometry) :
    //   base gauche  : (-w/2, -d/2)
    //   base droite  : ( w/2, -d/2)
    //   apex         : (0,     H - d/2)
    const v0 = toWorld(-w / 2, -d / 2);  // base gauche
    const v1 = toWorld( w / 2, -d / 2);  // base droite
    const v2 = toWorld( 0,      H - d / 2); // apex
    return [
      buildEdge(v0, v1, v2,    0),  // base       : 0 → 1, normale opposée à apex
      buildEdge(v1, v2, v0,    1),  // oblique dr : 1 → 2, normale opposée à base gauche
      buildEdge(v2, v0, v1,    2),  // oblique g  : 2 → 0, normale opposée à base droite
    ];
  }

  // Pièce carrée (sol ou fondation) — 4 arêtes
  const sw = toWorld(-w / 2, -d / 2);
  const se = toWorld( w / 2, -d / 2);
  const ne = toWorld( w / 2,  d / 2);
  const nw = toWorld(-w / 2,  d / 2);
  const center = { x: cx, z: cz };
  return [
    buildEdge(sw, se, center, 0),  // sud
    buildEdge(se, ne, center, 1),  // est
    buildEdge(ne, nw, center, 2),  // nord
    buildEdge(nw, sw, center, 3),  // ouest
  ];
}

/**
 * Phase 3.1 — Ensemble des arêtes "consommées" sur un étage : impossibles à
 * utiliser comme cible d'ancrage d'un nouveau triangle.
 *
 * Une arête (itemId, edgeIndex) est considérée occupée si :
 *  - Un autre triangle a son anchor_item_id == itemId et anchor_edge_index == edgeIndex
 *  - Ou bien c'est la BASE (index 0) d'un triangle déjà ancré (sa propre base
 *    est consommée par son ancrage côté parent — un autre triangle ne peut pas
 *    s'y attacher).
 *
 * Renvoie un Set<string> "itemId:edgeIndex".
 */
function getUsedEdges(plan, z) {
  const used = new Set();
  const floor = plan.floors.find(f => f.z === z);
  if (!floor) return used;
  for (const it of floor.items) {
    if (it.snap_kind !== 'anchor') continue;
    used.add(`${it.anchor_item_id}:${it.anchor_edge_index}`);
    used.add(`${it.id}:0`);  // la base de cet item est consommée par son ancrage
  }
  return used;
}

/**
 * Phase 3.1 — Cherche l'arête LIBRE la plus proche d'un point monde sur un
 * étage donné. Une arête est libre si elle n'est pas dans le set "used".
 *
 * Renvoie { piece, item, edge, dist } où :
 *  - piece, item : la pièce qui porte l'arête
 *  - edge : l'objet d'arête de getPieceEdges
 *  - dist : distance du point au SEGMENT (pas au milieu) — permet un snap plus
 *    naturel quand le curseur est près d'un bout d'arête, pas au milieu
 *
 * Renvoie null si aucune arête libre n'est trouvée.
 */
function findNearestFreeEdge(worldPos, plan, z) {
  if (!worldPos) return null;
  const floor = plan.floors.find(f => f.z === z);
  if (!floor) return null;
  const used = getUsedEdges(plan, z);

  let best = null;
  for (const it of floor.items) {
    const piece = state.piecesById.get(it.piece_id);
    if (!piece) continue;

    // Pour les triangles ancrés, on doit utiliser leur POSITION RÉSOLUE (pas
    // les x/y de cell-mode qui peuvent être périmés) pour calculer leurs arêtes.
    let renderItem = it;
    if (it.snap_kind === 'anchor') {
      const res = resolveTrianglePosition(it, plan);
      if (!res) continue;   // orphelin → on l'ignore comme ancrable
      const dim = piece.dimensions || { w: 1, d: 1 };
      const aw = (dim.w || 1) * CELL;
      const ad = (dim.d || 1) * CELL;
      renderItem = {
        ...it,
        x: res.x - aw / 2,
        y: res.z - ad / 2,
        rotation: res.rotation,
      };
    }

    const edges = getPieceEdges(piece, renderItem);
    for (const edge of edges) {
      if (used.has(`${it.id}:${edge.index}`)) continue;
      const dist = distancePointToSegment(worldPos, edge.p1, edge.p2);
      if (!best || dist < best.dist) {
        best = { piece, item: it, edge, dist };
      }
    }
  }
  return best;
}

/**
 * Phase 4a — Polygone XZ d'une pièce posée (vertices en monde, ordre contiguous).
 * Pour carré : 4 vertices. Pour triangle équilatéral : 3 vertices.
 * Utilise getPieceEdges qui gère déjà la rotation et le type de footprint.
 */
function getPiecePolygon(piece, item) {
  const edges = getPieceEdges(piece, item);
  if (edges.length === 0) return [];
  // Chaque arête a p1 → p2 ; les p1 successives forment le polygone.
  return edges.map(e => e.p1);
}

/**
 * Phase 4a — Test de chevauchement de 2 polygones convexes XZ via le théorème
 * des axes séparateurs (SAT). Renvoie true si les polygones se recouvrent
 * réellement (chevauchement de surface > epsilon). Renvoie false si :
 *  - Polygones disjoints
 *  - Polygones simplement touchants par une arête (gap = 0 dans la tolérance)
 *
 * Algorithme : pour chaque axe perpendiculaire à une arête de l'un des
 * polygones, on projette les deux polygones et on vérifie s'ils se chevauchent
 * sur cet axe. Si UN axe sépare les polygones, ils ne se touchent pas. Si TOUS
 * les axes montrent un chevauchement, les polygones se recouvrent.
 */
function polygonsOverlap(polyA, polyB) {
  if (polyA.length < 3 || polyB.length < 3) return false;
  const EPS = 0.001;   // tolérance pour considérer "touchant" comme non-overlap
  const collectAxes = (poly) => {
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const j = (i + 1) % poly.length;
      const dx = poly[j].x - poly[i].x;
      const dz = poly[j].z - poly[i].z;
      const len = Math.hypot(dx, dz);
      if (len < 1e-9) continue;
      // Normale (perpendiculaire) à l'arête, unité
      out.push({ x: -dz / len, z: dx / len });
    }
    return out;
  };
  const axes = [...collectAxes(polyA), ...collectAxes(polyB)];
  const projectMinMax = (poly, ax) => {
    let mn = Infinity, mx = -Infinity;
    for (const v of poly) {
      const p = v.x * ax.x + v.z * ax.z;
      if (p < mn) mn = p;
      if (p > mx) mx = p;
    }
    return [mn, mx];
  };
  for (const ax of axes) {
    const [minA, maxA] = projectMinMax(polyA, ax);
    const [minB, maxB] = projectMinMax(polyB, ax);
    // Si un axe sépare les deux projections (même avec tolérance), pas de chevauchement
    if (maxA <= minB + EPS || maxB <= minA + EPS) return false;
  }
  return true;
}

/**
 * Phase 4a — Helper : renvoie le polygone monde d'un item existant en gérant
 * sa résolution si snap_kind === 'anchor'.
 */
function getItemWorldPolygon(item, plan) {
  const piece = state.piecesById.get(item.piece_id);
  if (!piece) return [];
  let renderItem = item;
  if (item.snap_kind === 'anchor') {
    const res = resolveTrianglePosition(item, plan);
    if (!res) return [];
    const dim = piece.dimensions || { w: 1, d: 1 };
    renderItem = {
      ...item,
      x: res.x - (dim.w || 1) * CELL / 2,
      y: res.z - (dim.d || 1) * CELL / 2,
      rotation: res.rotation,
    };
  }
  return getPiecePolygon(piece, renderItem);
}

/** Distance d'un point au segment 2D (plan XZ). Projection clamp [0,1]. */
function distancePointToSegment(p, a, b) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len2 = dx * dx + dz * dz;
  if (len2 < 1e-12) return Math.hypot(p.x - a.x, p.z - a.z);
  let t = ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2;
  t = Math.max(0, Math.min(1, t));
  const px = a.x + t * dx;
  const pz = a.z + t * dz;
  return Math.hypot(p.x - px, p.z - pz);
}

/**
 * Phase 3.3 — Pour un snap de type 'anchor', construit un objet item virtuel
 * complet (avec x, y, rotation dérivés) prêt à passer à buildMeshForPiece /
 * positionMesh. Utilisé pour le ghost ET pour la pose réelle.
 *
 * Renvoie null si l'ancre n'est plus résolvable au moment de l'appel.
 */
function materializeAnchorSnap(snap, pieceId, floorZ) {
  if (!snap || snap.kind !== 'anchor') return null;
  const piece = state.piecesById.get(pieceId);
  if (!piece) return null;
  const tmpItem = {
    piece_id: pieceId,
    snap_kind: 'anchor',
    anchor_item_id: snap.anchor_item_id,
    anchor_edge_index: snap.anchor_edge_index,
    z: floorZ,
  };
  const resolved = resolveTrianglePosition(tmpItem, state.plan);
  if (!resolved) return null;
  const dim = piece.dimensions || { w: 1, d: 1 };
  const w = (dim.w || 1) * CELL;
  const d = (dim.d || 1) * CELL;
  return {
    ...tmpItem,
    // x, y dérivés au coin SW pour compat avec le reste du code
    x: resolved.x - w / 2,
    y: resolved.z - d / 2,
    rotation: resolved.rotation,
  };
}

/**
 * Migration Phase 2.4 : convertit les triangles d'un plan stockés en mode cellule
 * (snap_kind absent ou 'cell') vers le nouveau mode 'anchor' (ancrage à l'arête
 * d'une pièce voisine). Modifie le plan en place.
 *
 * Pour chaque triangle en mode cellule :
 *  1. Calcule le milieu de sa base actuelle en monde (à partir de x, y, rotation)
 *  2. Cherche l'arête de la pièce voisine la plus proche de ce milieu
 *  3. Si une arête à ≤ tolérance est trouvée → convertit en mode 'anchor'
 *  4. Sinon → laisse le triangle en mode cellule (continuera de rendre via le
 *     fallback dans positionMesh). Aucun item n'est supprimé.
 *
 * Renvoie le nombre de triangles migrés.
 */
function migrateTriangleSnaps(plan) {
  if (!plan || !Array.isArray(plan.floors)) return 0;
  const TOL = 0.15;   // tolérance en unités monde pour matcher base ↔ arête
  let migrated = 0;

  /** Calcule le milieu de la base d'un triangle stocké en mode cellule. */
  const baseMidOf = (tri, piece) => {
    const dim = piece.dimensions || { w: 1, d: 1 };
    const w = (dim.w || 1) * CELL;
    const d = (dim.d || 1) * CELL;
    const cx = tri.x + w / 2;
    const cz = tri.y + d / 2;
    const rotRad = THREE.MathUtils.degToRad(tri.rotation || 0);
    const cosR = Math.cos(rotRad);
    const sinR = Math.sin(rotRad);
    return {
      x: cx + 0 * cosR + (-d / 2) * sinR,
      z: cz - 0 * sinR + (-d / 2) * cosR,
    };
  };

  /** Cherche l'arête la plus proche d'un point parmi les ancres candidates. */
  const findNearestEdge = (baseMid, candidates) => {
    let best = { anchor: null, index: -1, dist: Infinity };
    for (const other of candidates) {
      const otherPiece = state.piecesById.get(other.piece_id);
      if (!otherPiece) continue;
      const edges = getPieceEdges(otherPiece, other);
      for (const e of edges) {
        const dx = e.mid.x - baseMid.x;
        const dz = e.mid.z - baseMid.z;
        const dist = Math.hypot(dx, dz);
        if (dist < best.dist) best = { anchor: other, index: e.index, dist };
      }
    }
    return best;
  };

  for (const floor of plan.floors) {
    if (!Array.isArray(floor.items)) continue;

    // ── Pré-passe : nettoyer les ancrages cassés (cycles, anchors orphelins) ─────
    // Si une ancre existante ne se résout pas (cycle ou item disparu), on retire
    // les champs anchor pour forcer une re-migration propre depuis les données
    // cellule (x, y, rotation toujours conservés dans l'item).
    for (const it of floor.items) {
      if (it.snap_kind !== 'anchor') continue;
      const resolved = resolveTrianglePosition(it, plan);
      if (resolved === null) {
        delete it.snap_kind;
        delete it.anchor_item_id;
        delete it.anchor_edge_index;
      }
    }

    // Set des items déjà "résolvables" sans risque de cycle :
    //  - toutes les pièces non-triangulaires (carrés, fondations) : toujours OK
    //  - les triangles déjà ancrés (la pré-passe ci-dessus a garanti que leur
    //    résolution réussit, donc pas de cycle ni d'orphelin)
    const resolvable = new Set();
    const trianglesToMigrate = [];

    for (const it of floor.items) {
      const p = state.piecesById.get(it.piece_id);
      if (!p) continue;
      const rules = p.placement_rules || {};
      const isTri = rules.footprint_shape === 'triangle_isosceles'
                 || rules.footprint_shape === 'triangle_equilateral';
      if (!isTri) {
        resolvable.add(it.id);
      } else if (it.snap_kind === 'anchor') {
        // pré-passe a validé : ancrage OK
        resolvable.add(it.id);
      } else {
        trianglesToMigrate.push(it);
      }
    }

    // Migration par vagues : chaque vague tente d'ancrer les triangles restants
    // vers des items DÉJÀ résolvables. À chaque ajout au set, on relance une vague.
    // Garantit l'absence de cycle puisqu'un triangle ne peut s'ancrer qu'à du
    // déjà-résolu. Les triangles isolés (sans voisin résolu) restent en cell mode.
    let progress = true;
    while (progress) {
      progress = false;
      for (let i = trianglesToMigrate.length - 1; i >= 0; i--) {
        const tri = trianglesToMigrate[i];
        const piece = state.piecesById.get(tri.piece_id);
        if (!piece) { trianglesToMigrate.splice(i, 1); continue; }

        // Candidats : items résolvables, en excluant le triangle lui-même
        const candidates = floor.items.filter(o => o.id !== tri.id && resolvable.has(o.id));
        if (candidates.length === 0) continue;

        const baseMid = baseMidOf(tri, piece);
        const best = findNearestEdge(baseMid, candidates);
        if (best.anchor && best.dist <= TOL) {
          tri.snap_kind         = 'anchor';
          tri.anchor_item_id    = best.anchor.id;
          tri.anchor_edge_index = best.index;
          resolvable.add(tri.id);
          trianglesToMigrate.splice(i, 1);
          migrated++;
          progress = true;
        }
      }
    }
    // Les triangles restants dans trianglesToMigrate n'ont pas trouvé d'ancre
    // valide → restent en cell mode (fallback dans positionMesh).
  }
  return migrated;
}

/**
 * Pour un item triangle avec snap_kind === 'anchor', calcule sa position 3D
 * absolue (mesh.position.x, mesh.position.z) et sa rotation effective en degrés.
 *
 * Algorithme :
 *  1. Suivre la référence anchor_item_id → trouver la pièce d'ancrage
 *  2. Si l'ancre est elle-même ancrée (chaîne de triangles), récursion
 *  3. Calculer les arêtes monde de l'ancre via getPieceEdges
 *  4. Sélectionner l'arête d'index anchor_edge_index
 *  5. Positionner le triangle : base sur l'arête (centre = milieu d'arête),
 *     apex à √3/2 unité dans la direction de la normale sortante
 *  6. Calculer la rotation Three.js telle que le local +Z (direction de l'apex)
 *     s'aligne sur la normale sortante : θ = atan2(outX, outZ)
 *
 * Renvoie { x, z, rotation } en coords monde / degrés.
 * Renvoie null si la chaîne d'ancrage est cassée (orphelin) ou cyclique.
 *
 * Le paramètre visited (Set d'ids) sert à détecter les cycles d'ancrage
 * (improbable mais possible si le fichier est édité à la main).
 */
function resolveTrianglePosition(item, plan, visited) {
  if (!item || item.snap_kind !== 'anchor') return null;
  if (!visited) visited = new Set();
  if (visited.has(item.id)) return null;   // cycle
  visited.add(item.id);

  const anchorId = item.anchor_item_id;
  if (!anchorId) return null;

  const floor = plan.floors.find(f => f.z === item.z);
  if (!floor) return null;
  const anchor = floor.items.find(it => it.id === anchorId);
  if (!anchor) return null;

  const anchorPiece = state.piecesById.get(anchor.piece_id);
  if (!anchorPiece) return null;

  // Si l'ancre est elle-même un triangle ancré, on doit la résoudre d'abord
  // pour avoir des coords monde valides pour ses arêtes.
  let resolvedAnchor = anchor;
  if (anchor.snap_kind === 'anchor') {
    const res = resolveTrianglePosition(anchor, plan, visited);
    if (!res) return null;
    // Reconstruit un item "virtuel" résolu : getPieceEdges attend item.x/y au coin SW
    // (interprétation cellule), donc on dérive depuis le centre résolu.
    const aDim = anchorPiece.dimensions || { w: 1, d: 1 };
    const aw = (aDim.w || 1) * CELL;
    const ad = (aDim.d || 1) * CELL;
    resolvedAnchor = {
      ...anchor,
      x: res.x - aw / 2,
      y: res.z - ad / 2,
      rotation: res.rotation,
    };
  }

  const edges = getPieceEdges(anchorPiece, resolvedAnchor);
  const edge = edges.find(e => e.index === item.anchor_edge_index);
  if (!edge) return null;

  // Rotation : local +Z (apex direction) doit s'aligner sur la normale sortante.
  // Three.js mesh.rotation.y applique (lx, lz) → (lx*cos + lz*sin, -lx*sin + lz*cos).
  // Pour (0, 1) → (outX, outZ) : sin = outX, cos = outZ → θ = atan2(outX, outZ)
  const θ = Math.atan2(edge.outX, edge.outZ);
  const rotationDeg = ((THREE.MathUtils.radToDeg(θ) % 360) + 360) % 360;

  // Position : la base du triangle est au milieu de l'arête d'ancrage.
  // Le mesh est positionné de telle sorte que sa base locale (z = -d/2) tombe
  // sur edge.mid. Donc mesh.position = edge.mid + (d/2) * outward.
  const piece = state.piecesById.get(item.piece_id);
  const dim   = piece?.dimensions || { d: 1 };
  const d     = (dim.d || 1) * CELL;
  const x = edge.mid.x + (d / 2) * edge.outX;
  const z = edge.mid.z + (d / 2) * edge.outZ;

  return { x, z, rotation: rotationDeg };
}

/**
 * Helper : construit un objet arête à partir de 2 extrémités p1, p2 et d'un
 * point intérieur (inside) qui sert à déterminer la direction "sortante" de la
 * normale. La normale pointe à l'opposé de inside.
 */
function buildEdge(p1, p2, inside, index) {
  const mid = { x: (p1.x + p2.x) / 2, z: (p1.z + p2.z) / 2 };
  const dx  = p2.x - p1.x;
  const dz  = p2.z - p1.z;
  const len = Math.hypot(dx, dz) || 1;  // garde-fou contre /0
  // 2 perpendiculaires : (-dz, dx) et (dz, -dx). On choisit celle qui s'éloigne de inside.
  let nx = -dz / len;
  let nz =  dx / len;
  // Produit scalaire entre (nx, nz) et (inside - mid) : si > 0 alors la normale
  // pointe vers inside → on l'inverse.
  if (nx * (inside.x - mid.x) + nz * (inside.z - mid.z) > 0) {
    nx = -nx;
    nz = -nz;
  }
  return { p1, p2, mid, outX: nx, outZ: nz, length: len, index };
}

// ============================================================
// FOOTPRINT & PLAGE D'ÉTAGES (pour blocage volumétrique machines/véhicules)
// ============================================================

/**
 * Ensemble des cellules (entières) occupées par la pièce, à partir du coin
 * (item.x, item.y), en tenant compte de la rotation (échange w↔d à 90°/270°).
 * Note: rotation 90°/270° ne pivote PAS autour du centre — elle échange juste
 * w et d ; le coin (item.x, item.y) reste l'origine du footprint. Le rendu 3D
 * tourne autour du centre visuel, ce qui peut créer un décalage visuel pour
 * les pièces non carrées. À régler dans une session future si gênant.
 * Retourne un Set<string> au format "x,y".
 */
function getOccupiedCells(piece, item) {
  const dim = piece.dimensions || {};
  let dw = Math.max(1, dim.w || 1);
  let dd = Math.max(1, dim.d || 1);
  const rot = ((item.rotation || 0) % 360 + 360) % 360;
  if (rot === 90 || rot === 270) { const t = dw; dw = dd; dd = t; }
  const cells = new Set();
  for (let i = 0; i < dw; i++) {
    for (let j = 0; j < dd; j++) {
      cells.add((item.x + i) + ',' + (item.y + j));
    }
  }
  return cells;
}

/**
 * Plage d'étages [zMin, zMax] occupée par la pièce.
 * - Machines/véhicules : [z, z + dim.h - 1] (dim.h = cellules entières = étages bloqués)
 * - Pièce standard    : [z, z]
 */
function getFloorRange(piece, item) {
  const z = item.z != null ? item.z : 0;
  if (piece.is_machine) {
    const h = Math.max(1, (piece.dimensions && piece.dimensions.h) || 1);
    return [z, z + h - 1];
  }
  return [z, z];
}

/** Cellules adjacentes à une arête (snap.kind === 'edge'). Retourne 2 clés "x,y". */
function edgeAdjacentCells(snap) {
  // axis='h' : arête horizontale à y=snap.y, sépare les cellules y=snap.y-1 et y=snap.y
  // axis='v' : arête verticale à x=snap.x, sépare les cellules x=snap.x-1 et x=snap.x
  if (snap.axis === 'h') return [snap.x + ',' + (snap.y - 1), snap.x + ',' + snap.y];
  return [(snap.x - 1) + ',' + snap.y, snap.x + ',' + snap.y];
}

/** Cellules adjacentes à un coin (snap.kind === 'corner'). Retourne 4 clés "x,y". */
function cornerAdjacentCells(snap) {
  return [
    (snap.x - 1) + ',' + (snap.y - 1),
    snap.x + ',' + (snap.y - 1),
    (snap.x - 1) + ',' + snap.y,
    snap.x + ',' + snap.y,
  ];
}

/**
 * Renvoie l'indice de plancher physique porté par un sol/fondation/toit.
 * Convention : "plancher Z" = la surface où l'on marche à l'étage Z.
 *  - foundation/plancher à étage z → porte le plancher_z
 *  - rooflike (toit plat, plafond) à étage z → porte le plancher_(z+1)
 *    (le toit-plat de l'étage z EST le sol de l'étage z+1)
 */
function carriedFloorIndex(piece, item) {
  if (isPieceRooflike(piece)) return (item.z || 0) + 1;
  return item.z || 0;
}

/**
 * Vérifie si la pose d'une machine (footprint w×d cellules, hauteur h étages)
 * entre en conflit avec l'existant. La machine candidate occupe le volume
 * [item.x..+w] × [item.y..+d] et s'étend verticalement du plancher_floorZ
 * au plancher_(floorZ+h).
 *
 * Conflits :
 *  - autre machine dont le footprint × plage d'étages se chevauche
 *  - mur (snap edge) avec arête INTÉRIEURE au footprint
 *  - pilier coin avec les 4 cellules adjacentes dans le footprint
 *  - pilier central dans le footprint
 *  - sol / fondation / toit-plat dont le plancher porté est STRICTEMENT
 *    à l'intérieur de la plage verticale de la machine (= plancher traverse la machine).
 *    Un sol au pied (plancher_floorZ) ou un toit-plat au sommet (plancher_floorZ+h) sont autorisés.
 */
function isMachinePlacementAllowed(piece, snap, floorZ) {
  const ghost = {
    x: snap.x, y: snap.y, z: floorZ,
    axis: snap.axis, rotation: state.ghostRotation || 0,
  };
  const newCells = getOccupiedCells(piece, ghost);
  const h = Math.max(1, (piece.dimensions && piece.dimensions.h) || 1);
  const newZmin = floorZ;
  const newZmax = floorZ + h - 1;
  if (newZmax > getMaxFloor() || newZmin < getMinFloor()) return false;

  // Test contre tous les étages dans la plage de la machine
  for (let z = newZmin; z <= newZmax; z++) {
    const floor = getFloor(z);
    if (!floor) continue;
    for (const it of floor.items) {
      const other = state.piecesById.get(it.piece_id);
      if (!other) continue;
      const otherSnap = (other.placement_rules || {}).snap_target;

      const [oZmin, oZmax] = getFloorRange(other, it);
      if (z < oZmin || z > oZmax) continue;

      // 1) Autre machine : intersection footprints (la plage d'étages se chevauche déjà)
      if (other.is_machine) {
        const otherCells = getOccupiedCells(other, it);
        for (const c of newCells) if (otherCells.has(c)) return false;
        continue;
      }

      // 2) Mur : conflit si mur INTÉRIEUR au footprint
      if (otherSnap === 'edge') {
        const adj = edgeAdjacentCells(it);
        if (newCells.has(adj[0]) && newCells.has(adj[1])) return false;
        continue;
      }

      // 3) Pilier coin : conflit si entouré par la machine
      if (otherSnap === 'corner') {
        const adj = cornerAdjacentCells(it);
        if (adj.every(c => newCells.has(c))) return false;
        continue;
      }

      // 4) Pilier central
      if (otherSnap === 'cell' && other.is_pillar) {
        if (newCells.has(it.x + ',' + it.y)) return false;
        continue;
      }

      // 5) Sol / fondation / toit-plat : conflit ssi le plancher porté est
      //    STRICTEMENT à l'intérieur de la plage verticale de la machine.
      //    - plancher porté < newZmin+1 OU > newZmax+1 : OK (en dehors de la machine)
      //    - plancher porté ∈ [newZmin+1, newZmax] (= entre les deux planchers extrêmes) : CONFLIT
      //    Cas valides : sol au pied (plancher_newZmin), toit-plat au sommet (plancher_newZmin+h = plancher_(newZmax+1)).
      if (otherSnap === 'cell' && (other.category === 'foundations' || other.category === 'floors')) {
        const floorY = carriedFloorIndex(other, it);
        if (floorY > newZmin && floorY < newZmin + h) {
          const otherCells = getOccupiedCells(other, it);
          for (const c of newCells) if (otherCells.has(c)) return false;
        }
        continue;
      }
    }
  }
  return true;
}

/**
 * Vérifie qu'une pièce non-machine ne tombe pas à l'intérieur du volume d'une
 * machine existante. Géré séparément parce que les machines couvrent plusieurs
 * cellules et plusieurs étages.
 *
 * Règles :
 *  - Mur / pilier coin / pilier central : conflit si dans le footprint × plage d'étages
 *  - Sol/fondation/toit-plat : conflit si le plancher porté est STRICTEMENT à l'intérieur
 *    de la plage verticale de la machine (= traverse). Le sol au pied de la machine ou
 *    le toit-plat à son sommet sont autorisés.
 */
function checkAgainstExistingMachines(piece, snap, floorZ) {
  // On parcourt tous les étages où une machine pourrait avoir été POSÉE pour
  // ensuite s'étendre jusqu'à floorZ (machine multi-étages).
  for (let z = getMinFloor(); z <= floorZ; z++) {
    const f = getFloor(z);
    if (!f) continue;
    for (const it of f.items) {
      const other = state.piecesById.get(it.piece_id);
      if (!other || !other.is_machine) continue;
      const [oZmin, oZmax] = getFloorRange(other, it);

      const otherCells = getOccupiedCells(other, it);
      const isSolOrToit = (piece.category === 'foundations' || piece.category === 'floors');

      // SOL / FONDATION / TOIT-PLAT : conflit si plancher porté est strictement
      // à l'intérieur de la plage verticale de la machine [oZmin..oZmin+h]
      if (snap.kind === 'cell' && isSolOrToit && !piece.is_pillar) {
        const floorY = carriedFloorIndex(piece, { z: floorZ });
        const oH = Math.max(1, (other.dimensions && other.dimensions.h) || 1);
        if (floorY > oZmin && floorY < oZmin + oH) {
          if (otherCells.has(snap.x + ',' + snap.y)) return false;
        }
        continue;
      }

      // MUR / PILIER : conflit si dans la plage d'étages de la machine
      if (floorZ < oZmin || floorZ > oZmax) continue;

      if (snap.kind === 'edge') {
        const adj = edgeAdjacentCells(snap);
        if (otherCells.has(adj[0]) && otherCells.has(adj[1])) return false;
      } else if (snap.kind === 'corner') {
        const adj = cornerAdjacentCells(snap);
        if (adj.every(c => otherCells.has(c))) return false;
      } else if (snap.kind === 'cell' && piece.is_pillar) {
        if (otherCells.has(snap.x + ',' + snap.y)) return false;
      }
    }
  }
  return true;
}

/** Vérifie si la pose est compatible sur l'étage floorZ explicite. */
function isPlacementAllowedOnFloor(piece, snap, floorZ) {
  // 1. Limites verticales du claim
  if (floorZ < getMinFloor() || floorZ > getMaxFloor()) return false;
  // 2. Limite XZ du claim — pour les snaps d'ancrage, on saute ce check ici
  //    car le ghost peut être loin de la grille de claim ; on validera plutôt
  //    la position résolue plus bas.
  if (snap.kind !== 'anchor' && !isWithinClaim(snap)) return false;

  // Phase 3.5 — snap d'ancrage : vérifications spécifiques au mode arête.
  //  a) L'arête cible n'est pas déjà utilisée par un autre triangle ancré
  //  b) La position résolue est dans le claim
  //  c) Phase 4a : aucun chevauchement de polygone avec une pièce existante
  if (snap.kind === 'anchor') {
    const floor = getFloor(floorZ);
    if (!floor) return false;
    for (const it of floor.items) {
      if (it.snap_kind !== 'anchor') continue;
      if (it.anchor_item_id === snap.anchor_item_id
          && it.anchor_edge_index === snap.anchor_edge_index) {
        return false;   // arête déjà occupée
      }
    }
    // Position résolue dans le claim ?
    const materialized = materializeAnchorSnap(snap, piece.id, floorZ);
    if (!materialized) return false;
    const cellSnap = { kind: 'cell', x: Math.floor(materialized.x + 0.5), y: Math.floor(materialized.y + 0.5) };
    if (!isWithinClaim(cellSnap)) return false;

    // Phase 4a — Anti-overlap : la nouvelle pièce ne doit pas recouvrir un sol/
    // fondation existant. Touche-arête OK (tolérance epsilon dans polygonsOverlap).
    const myPoly = getPiecePolygon(piece, materialized);
    for (const it of floor.items) {
      const otherPiece = state.piecesById.get(it.piece_id);
      if (!otherPiece) continue;
      const oCat = otherPiece.category;
      if (oCat !== 'floors' && oCat !== 'foundations') continue;
      const otherPoly = getItemWorldPolygon(it, state.plan);
      if (otherPoly.length === 0) continue;
      if (polygonsOverlap(myPoly, otherPoly)) return false;
    }
    return true;
  }

  // 3. Dispatch volumétrique : machines/véhicules ont un footprint multi-cellule
  //    et une hauteur multi-étage. Les pièces standards vérifient en plus qu'elles
  //    ne tombent pas dans une machine existante (refactor introduit pour la
  //    gestion d'espace machines).
  if (piece.is_machine) {
    return isMachinePlacementAllowed(piece, snap, floorZ);
  }
  if (!checkAgainstExistingMachines(piece, snap, floorZ)) return false;

  const floor = getFloor(floorZ);
  if (!floor) return true;
  const rules  = piece.placement_rules || {};
  const ignore = new Set(rules.ignore_groups || []);

  for (const it of floor.items) {
    const other = state.piecesById.get(it.piece_id);
    if (!other) continue;
    // Les machines sont traitées par checkAgainstExistingMachines : skip dans la boucle classique
    if (other.is_machine) continue;

    const otherSnap = (other.placement_rules || {}).snap_target;

    if (snap.kind === 'edge' && otherSnap === 'edge') {
      if (it.x === snap.x && it.y === snap.y && it.axis === snap.axis) {
        // Demi-étage vs étage entier sur la même arête : heights différentes → compatible
        if ((it.half || false) !== (state.ghostHalf || false)) continue;
        if (!ignore.has(other.group) && !(other.placement_rules?.ignore_groups || []).includes(piece.group)) {
          return false;
        }
      }
    } else if (snap.kind === 'cell' && otherSnap === 'cell') {
      if (it.x === snap.x && it.y === snap.y) {
        // Toit/Rooftop vs plancher/fondation : hauteurs différentes, pas de conflit
        if (!sameVerticalSpace(piece, other)) continue;
        // Demi-étage vs étage entier : décalage Y de 0.5 → pas de chevauchement
        if ((it.half || false) !== (state.ghostHalf || false)) continue;
        // Note : on n'autorise PAS plusieurs triangles dans la même cellule.
        // Les triangles isocèles se chevauchent partiellement à des rotations
        // différentes (un triangle 0° et un 90° couvrent tous les deux le coin
        // NE-NW par exemple). Le comportement in-game est aussi : 1 pièce par
        // cellule. La logique "complémentarité" précédente était trop permissive.
        if (!ignore.has(other.group) && !(other.placement_rules?.ignore_groups || []).includes(piece.group)) {
          return false;
        }
      }
    } else if (snap.kind === 'corner' && otherSnap === 'corner') {
      if (it.x === snap.x && it.y === snap.y) {
        if (!ignore.has(other.group) && !(other.placement_rules?.ignore_groups || []).includes(piece.group)) {
          return false;
        }
      }
    }
  }

  // Phase 4a — Anti-overlap polygon : si la pièce est un sol/fondation en mode
  // cellule, on vérifie aussi qu'elle ne chevauche pas une pièce ancrée existante
  // (les checks cell-vs-cell ci-dessus ne couvrent que les conflits de grille).
  if (snap.kind === 'cell' && (piece.category === 'floors' || piece.category === 'foundations')) {
    const myItem = {
      piece_id: piece.id,
      x: snap.x,
      y: snap.y,
      rotation: state.ghostRotation || 0,
    };
    const myPoly = getPiecePolygon(piece, myItem);
    if (myPoly.length > 0) {
      for (const it of floor.items) {
        if (it.snap_kind !== 'anchor') continue;   // déjà couvert par cell-vs-cell
        const otherPiece = state.piecesById.get(it.piece_id);
        if (!otherPiece) continue;
        const oCat = otherPiece.category;
        if (oCat !== 'floors' && oCat !== 'foundations') continue;
        const otherPoly = getItemWorldPolygon(it, state.plan);
        if (otherPoly.length === 0) continue;
        if (polygonsOverlap(myPoly, otherPoly)) return false;
      }
    }
  }

  return true;
}

/** Wrapper utilisant l'étage courant (compat ascendante). */
function isPlacementAllowed(piece, snap) {
  return isPlacementAllowedOnFloor(piece, snap, state.currentFloor);
}

/**
 * Cherche le premier étage (à partir de state.currentFloor, vers le haut) où le placement
 * est libre. Permet l'empilement vertical automatique des murs et des sols.
 * Les coins (piliers) n'empilent pas.
 */
function findBestPlacementFloor(piece, snap) {
  const rules = piece.placement_rules || {};
  if (rules.snap_target === 'corner') return state.currentFloor;
  // Snap d'ancrage (Phase 3) : l'ancre est forcément sur l'étage courant
  // (snapForPiece a cherché les arêtes libres de state.currentFloor uniquement)
  if (snap.kind === 'anchor') return state.currentFloor;
  if (!isWithinClaim(snap)) return state.currentFloor; // hors claim → ghost rouge immédiat
  // Machines / véhicules : PAS d'auto-stack. La pièce reste sur l'étage sélectionné
  // par l'utilisateur ; si conflit, ghost rouge → l'utilisateur change d'étage à la main.
  // Évite qu'une raffinerie de 6 étages se pose mystérieusement à N3 parce que le RDC
  // est occupé.
  if (piece.is_machine) return state.currentFloor;
  // Mode demi-étage (Shift) : on vise l'étage du dessous + offset +0.5.
  // Visuellement la pièce descend d'un demi-niveau par rapport à l'étage courant.
  // Si on est déjà au minimum, on reste sur l'étage courant (ascenseur sans sous-sol).
  if (state.ghostHalf) {
    return state.currentFloor > getMinFloor()
      ? state.currentFloor - 1   // stocké en-dessous, affiché à -0.5 + 0.5 = même hauteur - 0.5
      : state.currentFloor;      // plancher bas : monte à +0.5 dans le même étage
  }
  const maxZ = getMaxFloor();
  for (let z = state.currentFloor; z <= maxZ; z++) {
    if (isPlacementAllowedOnFloor(piece, snap, z)) return z;
  }
  return state.currentFloor; // tout occupé ou hors plage
}

// ============================================================
// PLACEMENT / SUPPRESSION
// ============================================================
/** Place une pièce depuis un snap. rotation (degrés) = rotation fantôme au moment du dépôt.
 *  Retourne l'itemId créé. */
function placePieceFromSnap(pieceId, snap, floorZ, rotation = 0) {
  const piece = state.piecesById.get(pieceId);
  if (!piece) return null;
  const targetZ = floorZ ?? state.currentFloor;
  const floor   = getFloor(targetZ);
  if (!floor) return null;

  const itemId = 'item_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  let item;
  if (snap.kind === 'anchor') {
    // Phase 3.3 — Item triangle ancré : on stocke uniquement les références
    // d'ancrage. Pour la robustesse face au fallback (positionMesh), on calcule
    // aussi x, y et rotation dérivés au moment de la création — ils ne servent
    // pas au rendu normal (qui passe par resolveTrianglePosition) mais évitent
    // un NaN si l'ancre disparaît plus tard.
    const materialized = materializeAnchorSnap(snap, pieceId, targetZ);
    if (!materialized) return null;
    item = {
      id: itemId,
      piece_id: pieceId,
      snap_kind: 'anchor',
      anchor_item_id: snap.anchor_item_id,
      anchor_edge_index: snap.anchor_edge_index,
      z: targetZ,
      rotation: materialized.rotation,
      x: materialized.x,
      y: materialized.y,
      half: state.ghostHalf || false,
    };
  } else {
    item = {
      id: itemId,
      piece_id: pieceId,
      snap_kind: snap.kind,
      x: snap.x, y: snap.y,
      axis: snap.axis,
      z: targetZ,
      rotation: rotation % 360,
      half: state.ghostHalf || false,   // demi-étage : décalage Y de +0.5 WALL_UNIT
    };
  }
  floor.items.push(item);

  const mesh = buildMeshForPiece(piece, item);
  scene.add(mesh);
  placedMeshes.set(itemId, mesh);
  updateFloorVisibility();
  updateFloorBadges();
  updatePieceCount();

  // Historique undo/redo
  const savedItem = JSON.parse(JSON.stringify(item));
  pushHistory(
    () => _removeItemCore(savedItem.id),
    () => restoreItem(JSON.parse(JSON.stringify(savedItem))),
  );
  recomputeStabilityIfActive();
  return itemId;
}

/** Dispose complet d'un mesh (edges + vitrage + label + géométrie). */
function disposeMesh(mesh) {
  if (!mesh) return;
  // Groupes (meshes socket / ghost) : pas de geometry/material direct → traverse.
  if (mesh.isGroup || (!mesh.geometry && mesh.children && mesh.children.length)) {
    mesh.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose());
    });
    return;
  }
  if (mesh.userData.edges) {
    mesh.userData.edges.geometry.dispose();
    mesh.userData.edges.material.dispose();
  }
  if (mesh.userData.glassPanel) {
    mesh.userData.glassPanel.geometry.dispose();
    mesh.userData.glassPanel.material.dispose();
  }
  if (mesh.userData.cornerGlass) {
    mesh.userData.cornerGlass.geometry.dispose();
    mesh.userData.cornerGlass.material.dispose();
  }
  if (mesh.userData.label) {
    if (mesh.userData.label.material.map) mesh.userData.label.material.map.dispose();
    mesh.userData.label.material.dispose();
  }
  mesh.geometry.dispose();
  mesh.material.dispose();
}

/** Supprime un item du plan ET de la scène (pas d'historique). */
function _removeItemCore(itemId) {
  const mesh = placedMeshes.get(itemId);
  if (mesh) {
    disposeMesh(mesh);
    scene.remove(mesh);
    placedMeshes.delete(itemId);
  }
  for (const f of state.plan.floors) {
    f.items = f.items.filter(i => i.id !== itemId);
  }
  // Désélection cohérente avec la sélection multi : retire du Set ET du scalaire
  if (state.selectedItemIds && state.selectedItemIds.has(itemId)) {
    state.selectedItemIds.delete(itemId);
    if (state.selectedItemId === itemId) {
      const remaining = Array.from(state.selectedItemIds);
      state.selectedItemId = remaining.length ? remaining[remaining.length - 1] : null;
      if (!state.selectedItemId) {
        if (dom.noSelection)  dom.noSelection.style.display  = 'flex';
        if (dom.selectedInfo) dom.selectedInfo.style.display = 'none';
      }
    }
  }
  updatePieceCount();
  updateFloorVisibility();
  updateFloorBadges();
  recomputeStabilityIfActive();
}

/** Remplace le type de pièce d'un item posé (même position / rotation), avec undo/redo. */
function swapItemPiece(itemId, newPieceId) {
  const item = getItemById(itemId);
  if (!item || item.piece_id === newPieceId) return;
  const oldPieceId = item.piece_id;

  const doSwap = (pid) => {
    item.piece_id = pid;
    const piece = state.piecesById.get(pid);
    if (!piece) return;
    const cur = placedMeshes.get(itemId);
    if (cur) { disposeMesh(cur); scene.remove(cur); }
    const nMesh = buildMeshForPiece(piece, item);
    scene.add(nMesh);
    placedMeshes.set(itemId, nMesh);
    // Re-sélectionne pour rafraîchir le panneau propriétés
    if (state.selectedItemId === itemId) { state.selectedItemId = null; select(nMesh); }
    updateFloorVisibility();
    updateFloorBadges();
  };

  doSwap(newPieceId);
  pushHistory(() => doSwap(oldPieceId), () => doSwap(newPieceId));
}

/** Supprime un item avec enregistrement dans l'historique undo/redo. */
function removeItem(itemId) {
  // Sauvegarde l'item avant suppression pour pouvoir le restaurer (undo)
  let savedItem = null;
  for (const f of state.plan.floors) {
    const it = f.items.find(i => i.id === itemId);
    if (it) { savedItem = JSON.parse(JSON.stringify(it)); break; }
  }
  _removeItemCore(itemId);
  if (savedItem) {
    pushHistory(
      () => restoreItem(JSON.parse(JSON.stringify(savedItem))),
      () => _removeItemCore(savedItem.id),
    );
  }
}

// ============================================================
// GHOST (preview drag)
// ============================================================
/** Retire le mesh fantôme de la scène (ne réinitialise PAS ghostRotation — appelé
 *  à chaque dragover pour reconstruire le ghost, la rotation doit persister). */
function clearGhost() {
  if (ghostMesh) {
    disposeMesh(ghostMesh);
    scene.remove(ghostMesh);
    ghostMesh = null;
  }
  hideHoverHelper();
  if (dom.hudFloorResolve) dom.hudFloorResolve.classList.remove('visible');
  // Note : ghostRotation et lastGhostState sont conservés pendant le drag ;
  //         ils sont remis à zéro uniquement par endDrag().
}

/** Réinitialise l'état du drag (drop, dragend, dragleave). */
function endDrag() {
  clearGhost();
  // Si on est en mode click-to-place, on garde ghostRotation et activePieceId (l'utilisateur
  // peut continuer à poser plusieurs exemplaires).
  if (!state.activePieceId) {
    state.ghostRotation = 0;
    state.ghostUserSetRotation = false;
  }
  lastGhostState = null;
  state.dragPieceId = null;
}

// ============================================================
// MODE CLICK-TO-PLACE
// ============================================================

/** Active (ou désactive si null) une pièce pour la pose au clic. */
function setActivePiece(pieceId) {
  if (pieceId !== state.activePieceId) {
    state.ghostRotation = 0;
    state.ghostUserSetRotation = false;  // ré-active l'auto-rotation pour la nouvelle pièce
    state.ghostHalf     = false;   // remet le demi-étage à zéro quand on change de pièce
    updateHalfHud();
    lastGhostState = null;
    clearGhost();
  }
  state.activePieceId = pieceId;
  // Surligne le canonical dans la sidebar (même si c'est un variant qui est actif)
  const canonicalId = pieceId
    ? (state.variantMap.get(pieceId)?.[0]?.id ?? pieceId)
    : null;
  document.querySelectorAll('.bp-piece-item').forEach(el => {
    el.classList.toggle('active', el.dataset.pieceId === canonicalId);
  });
  // Barre de variantes cosmétiques
  if (pieceId) {
    const variants = state.variantMap.get(pieceId);
    if (variants && variants.length > 1) showVariantBar(variants, pieceId);
    else hideVariantBar();
  } else {
    hideVariantBar();
  }
}

/**
 * Auto-rotation pour les triangles (footprint isocèle/équilatéral).
 * Réplique le comportement du jeu : la BASE du triangle se colle à l'arête
 * voisine occupée la plus proche du curseur. Renvoie 0/90/180/270 ou null
 * si aucune cellule voisine n'est occupée par un sol/fondation/triangle.
 *
 * Convention rotation (cohérente avec le rendu existant) :
 *   - rot 0   : pointe nord (+Z), base SUD  → voisin (cx, cy-1)
 *   - rot 90  : pointe ouest    , base EST  → voisin (cx+1, cy)
 *   - rot 180 : pointe sud      , base NORD → voisin (cx, cy+1)
 *   - rot 270 : pointe est      , base OUEST→ voisin (cx-1, cy)
 */
function computeTriangleAutoRotation(cx, cy, z, lx, lz) {
  const floor = state.plan.floors.find(f => f.z === z);
  if (!floor) return null;

  // Ensemble des cellules occupées par un sol/fondation (incluant triangles)
  // au même étage. C'est suffisant pour repérer une arête "supportable".
  const occupied = new Set();
  for (const it of floor.items) {
    const p = state.piecesById.get(it.piece_id);
    if (!p) continue;
    const cat = p.category;
    if (cat !== 'floors' && cat !== 'foundations') continue;
    const cells = getOccupiedCells(p, it);
    for (const c of cells) occupied.add(c);
  }
  if (occupied.size === 0) return null;

  // 4 arêtes candidates : { rotation, distance curseur, clé voisin }
  const edges = [
    { rot: 0,   dist: lz,     nbr: `${cx},${cy - 1}` },
    { rot: 90,  dist: 1 - lx, nbr: `${cx + 1},${cy}` },
    { rot: 180, dist: 1 - lz, nbr: `${cx},${cy + 1}` },
    { rot: 270, dist: lx,     nbr: `${cx - 1},${cy}` },
  ];

  const candidates = edges
    .filter(e => occupied.has(e.nbr))
    .sort((a, b) => a.dist - b.dist);

  return candidates.length > 0 ? candidates[0].rot : null;
}

/**
 * Rotation effective pour le ghost et la pose :
 *  - si l'utilisateur a forcé via R/molette → state.ghostRotation
 *  - sinon pour les triangles → auto-rotation (sinon fallback state.ghostRotation)
 *  - sinon (pièces non-triangulaires) → state.ghostRotation
 */
function computeEffectiveRotation(piece, snap, world, resolvedFloor) {
  if (state.ghostUserSetRotation) return state.ghostRotation;

  const rules = piece.placement_rules || {};
  const isTriangle = rules.footprint_shape === 'triangle_isosceles'
                  || rules.footprint_shape === 'triangle_equilateral';
  if (!isTriangle || snap.kind !== 'cell') return state.ghostRotation;

  const lx = world.x / CELL - snap.x;
  const lz = world.z / CELL - snap.y;
  const auto = computeTriangleAutoRotation(snap.x, snap.y, resolvedFloor, lx, lz);
  return auto !== null ? auto : state.ghostRotation;
}

// ============================================================
// MOTEUR SOCKETS — rendu / curseur / snap / ghost / pose (ENGINE='sockets')
// item socket : { id, piece_id, x, y (cm horizontal), cz (cm hauteur), z (niveau, bucketing), rotation }
// ============================================================
function applyTransformSocket(g, item) {
  g.position.set((item.x || 0) * WORLD_PER_CM, (item.cz || 0) * WORLD_PER_CM, (item.y || 0) * WORLD_PER_CM);
  g.rotation.y = THREE.MathUtils.degToRad(item.rotation || 0);
}
// Nombre d'étages SUPPLÉMENTAIRES qu'une pièce occupe au-dessus de sa base
// (0 pour mur/sol/fondation standard, 4 pour la Grande porte de 5 niveaux).
function pieceLevelSpan(piece) {
  let maxLz = 0;
  for (const s of (piece?.sockets || [])) if (s.lz > maxLz) maxLz = s.lz;
  return Math.max(0, Math.round(maxLz / CM_PER_LEVEL) - 1);
}
function socketBuildMesh(item) {
  const g = meshFactory.buildObject(item.piece_id, {});
  applyTransformSocket(g, item);
  const piece = state.piecesById.get(item.piece_id);
  // userData attendu par updateFloorVisibility / sélection
  g.userData.socket  = true;
  g.userData.floorZ  = item.z;                          // étage de base
  g.userData.floorTop = item.z + pieceLevelSpan(piece); // dernier étage occupé (pièces hautes)
  g.userData.piece   = piece;
  g.userData.itemId  = item.id;
  return g;
}
function socketCursorCm(clientX, clientY) {
  // PRIORITÉ : la géométrie réellement SOUS le curseur (pièce posée). Le point actif
  // suit alors visuellement la souris quel que soit l'angle de caméra, au lieu d'être
  // projeté sur le plan du sol (Y=0) — décalage gênant en vue 3D (cf. retour utilisateur :
  // croix dans le vide mais ghost accroché loin sur un sol surélevé).
  const rect = renderer.domElement.getBoundingClientRect();
  mouseNDC.x = ((clientX - rect.left) / rect.width)  * 2 - 1;
  mouseNDC.y = -((clientY - rect.top)  / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouseNDC, activeCam);
  const hits = raycaster.intersectObjects(Array.from(placedMeshes.values()), true);
  if (hits.length) {
    const p = hits[0].point;
    if (isFinite(p.x) && isFinite(p.y) && isFinite(p.z)) {
      // Étage visé = celui dont la SURFACE est à la HAUTEUR du point touché (pas le
      // floorZ de la pièce). Surface du niveau f à cz=(f+1)×384 → floor = round(cz/384)-1.
      // Conséquence intuitive : survoler le HAUT d'un escalier/rampe vise le niveau du
      // dessus (→ on enchaîne pour monter) ; survoler le bas vise le niveau du bas.
      const cz = p.y / WORLD_PER_CM;
      const floor = Math.round(cz / CM_PER_LEVEL) - 1;
      return { x: p.x / WORLD_PER_CM, y: p.z / WORLD_PER_CM, z: cz, floor };
    }
  }
  // Sinon (curseur dans le vide) : projection sur le plan du sol à l'étage courant.
  const world = screenToWorld(clientX, clientY);
  if (!world) return null;
  const x = world.x / WORLD_PER_CM, y = world.z / WORLD_PER_CM;
  // Guard NaN : quand le curseur sort du ground plane (bord haut du canvas, angle rasant),
  // Three.js peut renvoyer un point avec NaN. Sans ce guard, toutes les distances passent
  // le filtre (NaN > G = false), ce qui fait accrocher n'importe quoi n'importe où.
  if (!isFinite(x) || !isFinite(y)) return null;
  return { x, y, z: (state.currentFloor || 0) * CM_PER_LEVEL, floor: state.currentFloor || 0 };
}
function socketPlacedList() {
  const out = [];
  for (const f of state.plan.floors) for (const it of f.items) {
    out.push({ id: it.id, building_type: it.piece_id, x: it.x, y: it.y, z: it.cz || 0, rotation: it.rotation || 0 });
  }
  return out;
}
// Catégories qui DOIVENT s'accrocher par socket (pas de pose libre en dehors du vide).
// Fondations : pose libre toujours autorisée (point de départ de la base).
const SOCKET_ONLY_CATS = new Set(['walls','doors','rooftop','ramp','pillar','decoration']);
const norm360 = d => ((d % 360) + 360) % 360;
// Une position cm est-elle dans la zone de fief ? (centre de la pièce dans un bloc de claim)
// Bloc (gx,gy) → monde [gx*10 .. gx*10+10]. Pièce → cm×WORLD_PER_CM. Tolérance ½ case sur le bord.
function socketInClaim(cmX, cmY) {
  // eps petit : les murs de périmètre (sur le bord exact 0 ou 10) passent, mais une
  // fondation une case dehors (centre à 10.5) est refusée.
  const wx = cmX * WORLD_PER_CM, wy = cmY * WORLD_PER_CM, eps = 0.05;
  for (const b of (state.plan.claim?.blocks || [])) {
    const ox = b.gx * BLOCK_CELLS, oz = b.gy * BLOCK_CELLS;
    if (wx >= ox - eps && wx <= ox + BLOCK_CELLS + eps && wy >= oz - eps && wy <= oz + BLOCK_CELLS + eps) return true;
  }
  return false;
}
// Hauteur cm attendue pour poser sur un étage donné (défaut : étage courant).
// Mesuré : RDC → fondation cz=0, murs/sols cz=384. Donc fondation = niveau×384, autres = (niveau+1)×384.
function expectedCzFor(piece, floor) {
  const f = (floor != null) ? floor : (state.currentFloor || 0);
  return (f + (piece?.is_foundation ? 0 : 1)) * CM_PER_LEVEL;
}
function socketComputeSnap(pieceId, cur) {
  const placed = socketPlacedList();
  const piece = state.piecesById.get(pieceId);
  // Étage cible = celui de la pièce SOUS le curseur (cur.floor), sinon l'étage courant.
  // Permet de poser/empiler là où on pointe en 3D, pas seulement sur l'onglet actif.
  const curFloor = (cur.floor != null) ? cur.floor : (state.currentFloor || 0);

  // ── Machines / véhicules : pose libre centrée à l'étage visé ──
  if (piece?.is_machine || piece?.is_vehicle) {
    const zHint = expectedCzFor(piece, curFloor);
    const { wC, dC } = footprintDims(piece, state.ghostRotation || 0);
    return {
      pos: { x: placeableSnapAxis(cur.x, wC), y: placeableSnapAxis(cur.y, dC), z: zHint },
      rotation: state.ghostRotation || 0, snapped: false, floor: curFloor,
    };
  }

  // ── Fondations + PILIERS/COLONNES : pose LIBRE sur la grille (cz = niveau×384) AVEC
  // AUTO-EMPILEMENT : si la case est déjà occupée par une fondation/pilier au niveau courant,
  // on monte d'un étage → cliquer plusieurs fois empile les fondations vers le haut.
  if (piece?.is_foundation || piece?.is_pillar) {
    const baseF = curFloor;
    const maxF = getMaxFloor();
    for (let floor = baseF; floor <= maxF; floor++) {
      const g = socketEngine.gridSnap(cur.x, cur.y, floor * CM_PER_LEVEL);
      const occupied = state.plan.floors.some(f => f.items.some(it => {
        if (it.z !== floor) return false;
        const op = state.piecesById.get(it.piece_id);
        if (!op || !(op.is_foundation || op.is_pillar)) return false;
        return Math.abs((it.x || 0) - g.x) < 30 && Math.abs((it.y || 0) - g.y) < 30;
      }));
      if (!occupied) return { pos: g, rotation: state.ghostRotation || 0, snapped: false, floor };
    }
    const g = socketEngine.gridSnap(cur.x, cur.y, baseF * CM_PER_LEVEL);
    return { pos: g, rotation: state.ghostRotation || 0, snapped: false, floor: baseF };
  }

  // ── Pièces accrochées (murs, sols, toits, escaliers…) : AUTO-EMPILEMENT ──
  // Rampes / escaliers : posables SUR un sol → on retire sols/fondations/toits-plats de l'occ.
  let occList = placed;
  if (getEffectiveCategory(piece) === 'stairs') {
    occList = placed.filter(it => {
      const p = state.piecesById.get(it.building_type);
      if (!p) return true;
      const c = getEffectiveCategory(p);
      return c !== 'floors' && c !== 'foundations' && c !== 'roofs_flat';
    });
  }
  const occ = socketEngine.occSet(occList);
  // On essaie l'étage visé puis on MONTE. À chaque niveau, snapPiece renvoie l'accroche
  // LIBRE la plus proche du curseur. On retient le niveau dont l'accroche est la plus proche :
  // si l'emplacement sous le curseur est déjà occupé, l'accroche du DESSUS (juste au-dessus)
  // est plus proche que la case voisine libre → la pièce s'empile vers le haut. Ainsi cliquer
  // plusieurs fois au même endroit monte étage par étage.
  const base = curFloor;
  const top = Math.min(base + 8, getMaxFloor());
  const NEAR = CM_PER_CELL * 0.65;   // « bien sous le curseur » (< accroche d'une case voisine ~362)
  let best = null;
  for (let floor = base; floor <= top; floor++) {
    const zHint = (floor + 1) * CM_PER_LEVEL;   // non-fondation : cz = (floor+1)×384
    const r = socketEngine.snapPiece(cur, pieceId, placed, occ, { zHint, zTol: CM_PER_LEVEL / 2 });
    if (!r) { if (best) break; else continue; }   // plus rien au-dessus → stop (pile contiguë)
    const dOr = Math.hypot(cur.x - r.pos.x, cur.y - r.pos.y);
    if (!best || dOr < best.dOr - 1) best = { r, dOr, floor: Math.round(r.pos.z / CM_PER_LEVEL) - 1 };
    // PRIORITÉ AU PLUS BAS : si l'accroche est bien sous le curseur, on s'arrête (pas d'empilement
    // intempestif). L'auto-empilement ne se déclenche que si l'étage courant n'a RIEN de proche
    // (case occupée → l'accroche libre la plus proche est une voisine lointaine → on monte).
    if (dOr <= NEAR) break;
  }
  if (!best) {
    // Pose LIBRE de secours (positionnement manuel + rotation R) quand AUCUN socket ne
    // matche, pour les pièces qui seraient sinon IMPOSABLES :
    //  - MURS/FENÊTRES arrondis : sockets BP_DuneCurvedWallSocket_C non mappés aux sols.
    //  - RAMBARDES : surtout les rambardes INCLINÉES dont l'unique socket est `No_Cost` à
    //    types vides → 0 socket actif → jamais accrochables par le moteur. (Les rambardes
    //    droites/arrondies s'accrochent quand le curseur est près d'un bord ; sinon elles
    //    retombent ici en pose libre plutôt que de rester imposables.)
    // Les SOLS arrondis ont des sockets de bord normaux → ils s'accrochent (PAS de fallback,
    // sinon ils flotteraient n'importe où).
    const cat = getEffectiveCategory(piece);
    if (/Round_Corner/.test(piece?.group || '') && (cat === 'walls' || cat === 'windows')) {
      const g = socketEngine.gridSnap(cur.x, cur.y, (base + 1) * CM_PER_LEVEL);
      return { pos: g, rotation: state.ghostRotation || 0, snapped: false, floor: base };
    }
    return null;
  }
  return {
    pos: best.r.pos,
    rotation: norm360(best.r.rotation + (state.ghostRotation || 0)),
    snapped: true, floor: best.floor,
  };
}
// Une pièce posée en `pos` (cm) serait-elle stable ? (mode sockets)
// Les ancres (fondation/pilier au sol) le sont toujours.
function socketCandidateStable(pieceId, pos, zLevel, rotation) {
  const piece = state.piecesById.get(pieceId);
  if (piece && (piece.is_foundation || piece.is_pillar) && (pos.z || 0) <= 1) return true;
  const cand = { id: '_ghost_stab_', piece_id: pieceId, x: pos.x, y: pos.y, cz: pos.z, z: zLevel, rotation: rotation || 0 };
  const b = computeStabilitySocket([cand]).get('_ghost_stab_');
  return b != null && b >= 0;
}

// ── Anti-chevauchement machines / véhicules (mode sockets) ──────────────────
// Empreinte en cellules de fondation (512 cm) dérivée de la TAILLE RÉELLE (m),
// centrée sur la cellule d'origine. (dimensions.w/d du catalogue sont en unités
// 2.5 m ≠ cellule socket 5.12 m → on repart de real_size_m.)
const SOCKET_CELL_M = CM_PER_CELL / 100;   // 5.12 m
const HALF_CELL = CM_PER_CELL / 2;         // 256 cm
// Empreinte d'un placeable (en cases). Priorité au champ `footprint` (dérivé du
// vrai mesh dans planner_pieces.json) ; fallback sur real_size_m si absent.
function placeableFootprint(piece) {
  const fp = piece.footprint;
  if (fp) return { w: Math.max(1, fp.w || 1), d: Math.max(1, fp.d || 1), h: Math.max(1, fp.h || 1) };
  const rs = piece.real_size_m || {};
  const c = (m, div) => Math.max(1, Math.ceil((m || div) / div - 0.15));
  return { w: c(rs.w, SOCKET_CELL_M), d: c(rs.d, SOCKET_CELL_M), h: c(rs.h, CM_PER_LEVEL / 100) };
}
// Snap d'un axe pour un footprint de `cells` cases, CENTRÉ : origine = k*512 + cells*256.
// → footprint pair (2,4…) centré sur un BORD de case ; impair centré sur le MILIEU d'une case.
// Conséquence : le mesh (centré sur l'origine) tombe pile sur ses cases, et bouger d'une case
// translate d'exactement une case.
function placeableSnapAxis(v, cells) {
  return Math.round((v - cells * HALF_CELL) / CM_PER_CELL) * CM_PER_CELL + cells * HALF_CELL;
}
function footprintDims(piece, rotation) {
  const fp = placeableFootprint(piece);
  let wC = fp.w, dC = fp.d;
  const rot = ((rotation || 0) % 360 + 360) % 360;
  if (rot === 90 || rot === 270) { const t = wC; wC = dC; dC = t; }
  return { wC, dC, h: fp.h };
}
function socketFootprintCells(piece, item) {
  const { wC, dC } = footprintDims(piece, item.rotation);
  const cx0 = Math.round(((item.x || 0) - wC * HALF_CELL) / CM_PER_CELL);  // case de gauche/bas
  const cy0 = Math.round(((item.y || 0) - dC * HALF_CELL) / CM_PER_CELL);
  const cells = new Set();
  for (let i = 0; i < wC; i++) for (let j = 0; j < dC; j++) cells.add((cx0 + i) + ',' + (cy0 + j));
  return cells;
}
// Nombre de niveaux occupés en hauteur par un placeable (≥1).
function socketLevelSpanReal(piece) {
  return placeableFootprint(piece).h;
}
// Cellule (case) d'un item posé (origine au centre/bord selon snap → on retombe sur l'entier).
function socketItemCell(it) {
  return Math.round(((it.x || 0) - HALF_CELL) / CM_PER_CELL) + ',' + Math.round(((it.y || 0) - HALF_CELL) / CM_PER_CELL);
}
// Cases ayant une SURFACE praticable au niveau z : fondation/sol à z, ou toit-plat (plafond) à z-1.
function socketSurfaceCells(z) {
  const set = new Set();
  for (const f of state.plan.floors) for (const it of f.items) {
    const p = state.piecesById.get(it.piece_id);
    if (!p) continue;
    const cat = getEffectiveCategory(p);
    if ((p.is_foundation || cat === 'floors') && it.z === z) set.add(socketItemCell(it));
    else if (cat === 'roofs_flat' && it.z === z - 1) set.add(socketItemCell(it));   // toit plat = sol du niveau au-dessus
  }
  return set;
}
// Raison de refus d'un placeable (null = OK) : chevauchement / pas de sol porteur / traverse un mur.
function socketPlaceableReason(pieceId, pos, zLevel, rotation) {
  const piece = state.piecesById.get(pieceId);
  if (!piece || !(piece.is_machine || piece.is_vehicle)) return null;
  const cCells = socketFootprintCells(piece, { x: pos.x, y: pos.y, rotation });
  const cz0 = zLevel, cz1 = zLevel + socketLevelSpanReal(piece) - 1;

  // 1. Chevauchement avec un autre placeable (même volume).
  for (const f of state.plan.floors) for (const it of f.items) {
    const op = state.piecesById.get(it.piece_id);
    if (!op || !(op.is_machine || op.is_vehicle)) continue;
    const oz0 = it.z, oz1 = it.z + socketLevelSpanReal(op) - 1;
    if (cz1 < oz0 || oz1 < cz0) continue;
    const oCells = socketFootprintCells(op, it);
    for (const c of cCells) if (oCells.has(c)) return 'Emplacement occupé';
  }

  // 2. Sol porteur requis sous TOUTE l'empreinte (sinon flottant / hors plancher).
  const surf = socketSurfaceCells(zLevel);
  for (const c of cCells) if (!surf.has(c)) return 'Pas de sol sous la pièce';

  // 3. Ne doit pas traverser un mur (mur strictement à l'intérieur de l'empreinte).
  const { wC, dC } = footprintDims(piece, rotation);
  const cx0 = Math.round((pos.x - wC * HALF_CELL) / CM_PER_CELL);
  const cy0 = Math.round((pos.y - dC * HALF_CELL) / CM_PER_CELL);
  const x0 = cx0 * CM_PER_CELL, x1 = (cx0 + wC) * CM_PER_CELL;
  const y0 = cy0 * CM_PER_CELL, y1 = (cy0 + dC) * CM_PER_CELL;
  const EPS = 20;
  for (const f of state.plan.floors) for (const it of f.items) {
    const p = state.piecesById.get(it.piece_id);
    if (!p) continue;
    const cat = getEffectiveCategory(p);
    if (cat !== 'walls' && cat !== 'windows') continue;
    if (it.z < cz0 || it.z > cz1) continue;
    const wx = it.x || 0, wy = it.y || 0;
    if (wx > x0 + EPS && wx < x1 - EPS && wy > y0 + EPS && wy < y1 - EPS) return 'Traverse un mur';
  }
  return null;
}
function socketPlaceableBlocked(pieceId, pos, zLevel, rotation) {
  return socketPlaceableReason(pieceId, pos, zLevel, rotation) != null;
}

let lastSocketSnap = null;
let lastSocketClientPos = { x: 0, y: 0 };   // mémorise le curseur pour refresh R-key
function socketShowGhost(pieceId, clientX, clientY) {
  lastSocketClientPos = { x: clientX, y: clientY };
  const cur = socketCursorCm(clientX, clientY);
  if (!cur) return false;
  const snap = socketComputeSnap(pieceId, cur);
  if (!snap) { clearGhost(); lastSocketSnap = null; return false; }
  const lvl = snap.floor != null ? snap.floor : (state.currentFloor || 0);
  snap.inClaim = socketInClaim(snap.pos.x, snap.pos.y);   // dans la zone de fief ?
  // Mode stabilité : ghost rouge si la pièce serait instable (hors budget).
  snap.unstable = state.showStability && snap.inClaim &&
    !socketCandidateStable(pieceId, snap.pos, lvl, snap.rotation);
  // Machines / véhicules : ghost rouge si l'emplacement est déjà occupé.
  snap.blocked = snap.inClaim && socketPlaceableBlocked(pieceId, snap.pos, lvl, snap.rotation);
  lastSocketSnap = { pieceId, snap };
  clearGhost();
  const col = (!snap.inClaim || snap.unstable || snap.blocked) ? COLOR_GHOST_BAD
            : (snap.snapped ? COLOR_GHOST_OK : 0x6a8f6a);
  const g = meshFactory.buildObject(pieceId, { color: col, opacity: 0.5 });
  applyTransformSocket(g, { x: snap.pos.x, y: snap.pos.y, cz: snap.pos.z, rotation: snap.rotation });
  ghostMesh = g;
  scene.add(ghostMesh);
  // Auto-empilement : HUD "↑ Nx" si la pose se fait au-dessus du tab courant (masqué sinon).
  showFloorResolveHud?.(lvl);
  setText(dom.hudCoords, `x:${Math.round(snap.pos.x)} y:${Math.round(snap.pos.y)} z:${Math.round(snap.pos.z)} cm`);
  return true;
}
function socketPlaceAt(pieceId, clientX, clientY) {
  const cur = socketCursorCm(clientX, clientY);
  if (!cur) return null;
  const snap = (lastSocketSnap && lastSocketSnap.pieceId === pieceId) ? lastSocketSnap.snap : socketComputeSnap(pieceId, cur);
  if (!snap) return null;   // pose refusée (snap null = pas d'accrochage valide)
  // Refus hors de la zone de fief
  if (!socketInClaim(snap.pos.x, snap.pos.y)) { showFloorResolveHud?.(state.currentFloor, 'Hors de la zone de fief'); return null; }
  // Anti-superposition : rejeter si une pièce du MÊME type occupe déjà ce point d'origine
  // (même x,y,z à ~30 cm près). On compare au type pour autoriser sol+trappe, mur+fenêtre…
  const all = socketPlacedList();
  const DUP = 30;
  if (all.some(it => it.building_type === pieceId &&
        Math.abs(it.x - snap.pos.x) < DUP && Math.abs(it.y - snap.pos.y) < DUP && Math.abs(it.z - snap.pos.z) < DUP)) return null;
  // Étage de pose : snap.floor (auto-empilement) sinon l'étage courant. Le niveau est dérivé
  // de l'accroche (cz), ce qui permet d'empiler au-dessus en cliquant au même endroit.
  const lvl = snap.floor != null ? snap.floor : (state.currentFloor || 0);
  const targetFloor = getFloor(lvl) || getFloor(state.currentFloor) || state.plan.floors[0];
  if (!targetFloor) return null;
  // Mode stabilité ON : refuse la pose si la pièce serait instable (hors budget de 9 pas).
  if (state.showStability && !socketCandidateStable(pieceId, snap.pos, targetFloor.z, snap.rotation)) {
    showFloorResolveHud?.(state.currentFloor, 'Pose refusée : stabilité insuffisante');
    return null;
  }
  // Machines / véhicules : refuse si occupé / sans sol porteur / à travers un mur.
  const placeReason = socketPlaceableReason(pieceId, snap.pos, targetFloor.z, snap.rotation);
  if (placeReason) {
    showFloorResolveHud?.(state.currentFloor, 'Pose refusée : ' + placeReason.toLowerCase());
    return null;
  }
  const item = {
    id: (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'it_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    piece_id: pieceId,
    x: snap.pos.x, y: snap.pos.y, cz: snap.pos.z,
    z: targetFloor.z,
    rotation: snap.rotation,
  };
  targetFloor.items.push(item);
  const mesh = socketBuildMesh(item);
  scene.add(mesh);
  placedMeshes.set(item.id, mesh);
  updateFloorVisibility();
  updateFloorBadges();
  updatePieceCount();
  recomputeStabilityIfActive();
  const saved = JSON.parse(JSON.stringify(item));
  pushHistory(
    () => _removeItemCore(saved.id),
    () => restoreItem(JSON.parse(JSON.stringify(saved))),
  );
  return item.id;
}

/** Affiche le ghost pour une pièce à la position écran donnée. Renvoie true si OK. */
function tryShowGhostForPiece(pieceId, clientX, clientY) {
  if (ENGINE === 'sockets') return socketShowGhost(pieceId, clientX, clientY);
  const piece = state.piecesById.get(pieceId);
  if (!piece) return false;
  const world = screenToWorld(clientX, clientY);
  if (!world) return false;
  const snap = snapForPiece(world, piece);
  if (!snap) return false;
  const resolvedFloor = findBestPlacementFloor(piece, snap);
  const allowed = isPlacementAllowedOnFloor(piece, snap, resolvedFloor);
  const effectiveRot = computeEffectiveRotation(piece, snap, world, resolvedFloor);
  lastGhostState = { piece, snap, resolvedFloor, allowed, effectiveRot };
  showGhost(piece, snap, resolvedFloor, allowed, effectiveRot);
  showFloorResolveHud(resolvedFloor);
  setText(dom.hudCoords, formatSnapHud(snap));
  return true;
}

/** Pose la pièce active à la position écran. Renvoie l'itemId créé ou null. */
function tryPlacePieceAt(pieceId, clientX, clientY) {
  if (ENGINE === 'sockets') return socketPlaceAt(pieceId, clientX, clientY);
  const piece = state.piecesById.get(pieceId);
  if (!piece) return null;
  const world = screenToWorld(clientX, clientY);
  if (!world) return null;
  const snap = snapForPiece(world, piece);
  if (!snap) return null;
  const resolvedFloor = findBestPlacementFloor(piece, snap);
  if (!isPlacementAllowedOnFloor(piece, snap, resolvedFloor)) return null;
  // Mode stabilité ON : refuse la pose si la pièce serait instable (budget < 0)
  if (state.showStability && !wouldBeStableAfterPlacing(piece, snap, resolvedFloor)) {
    showFloorResolveHud(resolvedFloor, 'Pose refusée : stabilité insuffisante');
    return null;
  }
  const effectiveRot = computeEffectiveRotation(piece, snap, world, resolvedFloor);
  return placePieceFromSnap(pieceId, snap, resolvedFloor, effectiveRot);
}

function showGhost(piece, snap, resolvedFloor, allowed, rotation = state.ghostRotation) {
  clearGhost();
  let tmpItem;
  if (snap.kind === 'anchor') {
    // Phase 3.4 — Pour un ghost triangle ancré, on dérive x, y, rotation depuis
    // l'ancre via materializeAnchorSnap. Si la résolution échoue (ancre orpheline
    // pendant le hover), on n'affiche pas le ghost.
    const m = materializeAnchorSnap(snap, piece.id, resolvedFloor);
    if (!m) return;
    tmpItem = {
      id: 'ghost',
      piece_id: piece.id,
      snap_kind: 'anchor',
      anchor_item_id: snap.anchor_item_id,
      anchor_edge_index: snap.anchor_edge_index,
      x: m.x, y: m.y,
      z: resolvedFloor,
      rotation: m.rotation,
      half: state.ghostHalf,
    };
  } else {
    tmpItem = {
      id: 'ghost',
      piece_id: piece.id,
      snap_kind: snap.kind,
      x: snap.x, y: snap.y,
      axis: snap.axis,
      z: resolvedFloor,
      rotation,                       // rotation effective (auto pour triangles, sinon ghostRotation)
      half: state.ghostHalf,          // demi-étage fantôme courant (touche H)
    };
  }
  const mesh = buildMeshForPiece(piece, tmpItem);
  const color = allowed ? COLOR_GHOST_OK : COLOR_GHOST_BAD;
  mesh.material.color.setHex(color);
  mesh.material.transparent = true;
  mesh.material.opacity = 0.45;
  mesh.material.depthWrite = false;
  mesh.castShadow = false;
  if (mesh.userData.edges) mesh.userData.edges.material.color.setHex(color);
  ghostMesh = mesh;
  scene.add(ghostMesh);

  showHoverHelper(snap, resolvedFloor);
}

// ============================================================
// HOVER HELPER — surbrillance edge/corner/cell ciblée
// ============================================================
function setupHoverHelper() {
  // Pas créé immédiatement, créé à la demande dans showHoverHelper
}

function hideHoverHelper() {
  if (hoverHelper) {
    if (hoverHelper.geometry) hoverHelper.geometry.dispose();
    if (hoverHelper.material) hoverHelper.material.dispose();
    scene.remove(hoverHelper);
    hoverHelper = null;
  }
}

function showHoverHelper(snap, resolvedFloor) {
  hideHoverHelper();
  const yBase = getFloorYBase(resolvedFloor ?? state.currentFloor) + 0.025;
  const mat = new THREE.MeshBasicMaterial({
    color: COLOR_HOVER_HL,
    transparent: true, opacity: 0.85,
    depthWrite: false,
  });

  if (snap.kind === 'edge') {
    // Petite barre fine posée sur l'arête, dans le sens de l'arête
    const isH = snap.axis === 'h';
    const geo = isH
      ? new THREE.BoxGeometry(CELL, 0.03, 0.10)
      : new THREE.BoxGeometry(0.10, 0.03, CELL);
    hoverHelper = new THREE.Mesh(geo, mat);
    if (isH) hoverHelper.position.set(snap.x + CELL / 2, yBase, snap.y);
    else     hoverHelper.position.set(snap.x, yBase, snap.y + CELL / 2);
  } else if (snap.kind === 'corner') {
    const geo = new THREE.CylinderGeometry(0.18, 0.18, 0.04, 16);
    hoverHelper = new THREE.Mesh(geo, mat);
    hoverHelper.position.set(snap.x, yBase, snap.y);
  } else if (snap.kind === 'anchor') {
    // Phase 3.4 — Highlight de l'arête cible (segment) en orientant une fine
    // barre 3D alignée sur l'arête de la pièce d'ancrage.
    const z = resolvedFloor ?? state.currentFloor;
    const floor = state.plan.floors.find(f => f.z === z);
    const anchor = floor && floor.items.find(it => it.id === snap.anchor_item_id);
    const anchorPiece = anchor && state.piecesById.get(anchor.piece_id);
    if (anchor && anchorPiece) {
      let renderItem = anchor;
      if (anchor.snap_kind === 'anchor') {
        const res = resolveTrianglePosition(anchor, state.plan);
        if (res) {
          const aDim = anchorPiece.dimensions || { w: 1, d: 1 };
          renderItem = { ...anchor, x: res.x - aDim.w * CELL / 2, y: res.z - aDim.d * CELL / 2, rotation: res.rotation };
        }
      }
      const edges = getPieceEdges(anchorPiece, renderItem);
      const edge = edges.find(e => e.index === snap.anchor_edge_index);
      if (edge) {
        // Barre fine de longueur = edge.length, orientée selon l'arête
        const geo = new THREE.BoxGeometry(edge.length, 0.04, 0.12);
        hoverHelper = new THREE.Mesh(geo, mat);
        hoverHelper.position.set(edge.mid.x, yBase, edge.mid.z);
        const angle = Math.atan2(edge.p2.z - edge.p1.z, edge.p2.x - edge.p1.x);
        hoverHelper.rotation.y = -angle;   // ajuste pour le repère Three.js
      }
    }
  } else {
    // Cellule : carré translucide
    const geo = new THREE.BoxGeometry(CELL * 0.95, 0.03, CELL * 0.95);
    const cellMat = mat.clone();
    cellMat.opacity = 0.30;
    hoverHelper = new THREE.Mesh(geo, cellMat);
    hoverHelper.position.set(snap.x + CELL / 2, yBase, snap.y + CELL / 2);
  }
  if (hoverHelper) scene.add(hoverHelper);
}

// ============================================================
// SÉLECTION (multi : Set selectedItemIds + scalaire selectedItemId pour le panneau)
// ============================================================

/** Applique l'apparence "sélectionnée" à un mesh (edges dorés). */
function _markSelectedVisual(mesh) {
  if (!mesh) return;
  if (mesh.userData.edges) {
    mesh.userData.edges.material.color.setHex(COLOR_SELECT);
    mesh.userData.edges.material.opacity = 1;
  }
  // Groupes sockets (glb) : pas d'edges → surlignage par émissif doré.
  if (mesh.isGroup) mesh.traverse(o => {
    if (o.isMesh && o.material && o.material.emissive) { o.material.emissive.setHex(0x5a4416); o.material.emissiveIntensity = 1; }
  });
}

/** Applique l'apparence "non-sélectionnée" à un mesh (edges noirs / émissif éteint). */
function _markUnselectedVisual(mesh) {
  if (!mesh) return;
  if (mesh.userData.edges) {
    mesh.userData.edges.material.color.setHex(0x000000);
    mesh.userData.edges.material.opacity = 0.45;
  }
  if (mesh.isGroup) mesh.traverse(o => {
    if (o.isMesh && o.material && o.material.emissive) o.material.emissive.setHex(0x000000);
  });
}

/**
 * Sélectionne un mesh selon le mode :
 *  - 'replace' (défaut) : remplace toute la sélection par celui-ci
 *  - 'add'     (Shift+clic) : ajoute à la sélection existante
 *  - 'toggle'  (Ctrl+clic)  : ajoute si absent, retire si présent
 * Le panneau de propriétés suit toujours la pièce "principale" (dernière interaction).
 */
function select(mesh, mode = 'replace') {
  const id = mesh.userData.itemId;
  if (!id) return;

  if (mode === 'replace') {
    deselectAll();
    state.selectedItemIds.add(id);
    state.selectedItemId = id;
    _markSelectedVisual(mesh);
  } else if (mode === 'add') {
    if (!state.selectedItemIds.has(id)) {
      state.selectedItemIds.add(id);
      _markSelectedVisual(mesh);
    }
    state.selectedItemId = id;
  } else if (mode === 'toggle') {
    if (state.selectedItemIds.has(id)) {
      state.selectedItemIds.delete(id);
      _markUnselectedVisual(mesh);
      // Le scalaire principal devient le dernier id encore sélectionné (ou null)
      if (state.selectedItemId === id) {
        const remaining = Array.from(state.selectedItemIds);
        state.selectedItemId = remaining.length ? remaining[remaining.length - 1] : null;
      }
    } else {
      state.selectedItemIds.add(id);
      state.selectedItemId = id;
      _markSelectedVisual(mesh);
    }
  }
  // Met à jour le panneau (sur la pièce "principale" ou vide)
  if (state.selectedItemId) {
    const main = placedMeshes.get(state.selectedItemId);
    if (main) updateSelectedPanel(main);
  } else {
    if (dom.noSelection)  dom.noSelection.style.display  = 'flex';
    if (dom.selectedInfo) dom.selectedInfo.style.display = 'none';
  }
}

/** Désélectionne tout, ou un id spécifique si fourni. */
function deselect(itemId) {
  if (itemId) {
    if (state.selectedItemIds.has(itemId)) {
      const mesh = placedMeshes.get(itemId);
      _markUnselectedVisual(mesh);
      state.selectedItemIds.delete(itemId);
    }
    if (state.selectedItemId === itemId) {
      const remaining = Array.from(state.selectedItemIds);
      state.selectedItemId = remaining.length ? remaining[remaining.length - 1] : null;
    }
  } else {
    deselectAll();
  }
}

/** Désélectionne toutes les pièces. */
function deselectAll() {
  for (const id of state.selectedItemIds) {
    _markUnselectedVisual(placedMeshes.get(id));
  }
  state.selectedItemIds.clear();
  state.selectedItemId = null;
  if (dom.noSelection)  dom.noSelection.style.display  = 'flex';
  if (dom.selectedInfo) dom.selectedInfo.style.display = 'none';
}

// ============================================================
// COPIER-COLLER D'ÉTAGE (Ctrl+C / Ctrl+V)
// ============================================================

/**
 * Copie tous les items de l'étage courant dans state.floorClipboard.
 * Clone profond pour éviter d'avoir des références partagées (sinon une modif
 * d'un item original modifierait le buffer).
 */
function copyCurrentFloor() {
  const floor = getFloor(state.currentFloor);
  if (!floor || floor.items.length === 0) {
    showFloorResolveHud(state.currentFloor, 'Étage vide — rien à copier');
    return;
  }
  state.floorClipboard = {
    sourceZ: state.currentFloor,
    items:   floor.items.map(it => JSON.parse(JSON.stringify(it))),
  };
  showFloorResolveHud(state.currentFloor, `${state.floorClipboard.items.length} pièces copiées`);
}

/**
 * Colle le contenu du clipboard sur l'étage courant. Chaque item reçoit un
 * nouvel `id` et son `z` est réécrit. Les items dont la pose entre en conflit
 * sont ignorés (ghost rouge → on ne pose pas).
 * Toute la pose est groupée dans une seule entrée d'historique pour pouvoir
 * Ctrl+Z d'un coup.
 */
function pasteFloorClipboard() {
  if (!state.floorClipboard || state.floorClipboard.items.length === 0) {
    showFloorResolveHud(state.currentFloor, 'Clipboard vide (Ctrl+C d\'abord)');
    return;
  }
  const targetZ = state.currentFloor;
  const sourceZ = state.floorClipboard.sourceZ ?? targetZ;
  const dCz     = (targetZ - sourceZ) * CM_PER_LEVEL;   // décalage de hauteur entre étages
  const placed  = [];
  const skipped = [];
  const floor   = getFloor(targetZ);
  if (!floor) { showFloorResolveHud(targetZ, 'Étage cible introuvable'); return; }

  const DUP = 30;
  const exists = (pid, x, y, cz) => floor.items.some(it =>
    it.piece_id === pid && Math.abs((it.x || 0) - x) < DUP &&
    Math.abs((it.y || 0) - y) < DUP && Math.abs((it.cz || 0) - cz) < DUP);

  for (const src of state.floorClipboard.items) {
    const piece = state.piecesById.get(src.piece_id);
    if (!piece) { skipped.push(src); continue; }
    // Coordonnées sockets en cm : x/y inchangés, hauteur décalée du nb d'étages.
    const x = src.x || 0, y = src.y || 0, cz = (src.cz || 0) + dCz;
    // Ignore les doublons exacts (même type au même point sur l'étage cible).
    if (exists(src.piece_id, x, y, cz)) { skipped.push(src); continue; }
    const newItem = {
      id: (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
        : 'item_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      piece_id: src.piece_id,
      x, y, cz,
      z:        targetZ,
      rotation: src.rotation || 0,
    };
    floor.items.push(newItem);
    const mesh = buildMeshForPiece(piece, newItem);
    scene.add(mesh);
    placedMeshes.set(newItem.id, mesh);
    placed.push(newItem);
  }

  // Historique : 1 entrée pour le coller entier (undo restaure tout, redo recolle)
  if (placed.length > 0) {
    const placedSnapshot = placed.map(it => JSON.parse(JSON.stringify(it)));
    pushHistory(
      () => { for (const it of placedSnapshot) _removeItemCore(it.id); },
      () => { for (const it of placedSnapshot) restoreItem(JSON.parse(JSON.stringify(it))); },
    );
  }
  updateFloorVisibility();
  updateFloorBadges();
  updatePieceCount();

  const msg = `${placed.length} collées` + (skipped.length ? ` (${skipped.length} ignorées : conflit ou pièce inconnue)` : '');
  showFloorResolveHud(targetZ, msg);
  recomputeStabilityIfActive();
}
function updateSelectedPanel(mesh) {
  const piece = mesh.userData.piece;
  const item  = getItemById(mesh.userData.itemId);
  if (!piece || !item) return;
  if (dom.noSelection)  dom.noSelection.style.display  = 'none';
  if (dom.selectedInfo) dom.selectedInfo.style.display = 'flex';
  setText(dom.selName, piece.label_fr || piece.id);
  const d = piece.dimensions || {};
  setText(dom.selW, d.w || 1);
  setText(dom.selD, d.d || 0);
  setText(dom.selH, d.h || 0);
  setText(dom.selRot, (item.rotation || 0) + '°');
  // Bouton demi-étage
  if (dom.selHalf) {
    dom.selHalf.classList.toggle('active', !!item.half);
    dom.selHalf.onclick = () => toggleSelectedHalf();
  }
  if (dom.selIcon) {
    dom.selIcon.style.background = facCss(piece.faction_id, 0.3);
    dom.selIcon.style.border     = '1px solid ' + facCss(piece.faction_id, 0.6);
    dom.selIcon.textContent      = fmtDimsLabel(piece.dimensions || {});
  }
  if (dom.deleteBtn) dom.deleteBtn.onclick = () => removeItem(item.id);
  if (dom.rotCw)     dom.rotCw.onclick  = () => rotateSelected(+90);
  if (dom.rotCcw)    dom.rotCcw.onclick = () => rotateSelected(-90);

  // === Swap de type — portes & fenêtres ===
  const pGroup = piece.group || '';
  const snap   = (piece.placement_rules || {}).snap_target;
  // Swap de type : portes uniquement (les fenêtres ont group='Wall', pas de swap inter-type)
  const isPieceWindow = isPieceWindowType(piece);
  if (isDoorGroup(pGroup) && !isPieceWindow && dom.selSwap && dom.swapGrid) {
    const swapList = state.canonicals.filter(c =>
      c.faction_id === piece.faction_id &&
      c.category   === piece.category &&
      (c.placement_rules || {}).snap_target === snap &&
      isDoorGroup(c.group)
    );
    if (swapList.length > 1) {
      dom.swapGrid.innerHTML = '';
      for (const c of swapList) {
        const isCurrent = c.group === pGroup;
        const btn = document.createElement('button');
        btn.className = 'bp-swap-btn' + (isCurrent ? ' current' : '');
        const colorBg = facCss(c.faction_id, 0.30);
        const colorBd = facCss(c.faction_id, 0.55);
        btn.innerHTML =
          `<div class="bp-swap-btn-icon" style="background:${colorBg};border:1px solid ${colorBd};">`
          + fmtDimsLabel(c.dimensions || {}) + '</div>'
          + `<div class="bp-swap-btn-label">${fmtGroupLabel(c.group)}</div>`;
        if (!isCurrent) btn.addEventListener('click', () => swapItemPiece(item.id, c.id));
        dom.swapGrid.appendChild(btn);
      }
      dom.selSwap.style.display = '';
    } else {
      dom.selSwap.style.display = 'none';
    }
  } else if (dom.selSwap) {
    dom.selSwap.style.display = 'none';
  }

  // === Variantes cosmétiques (skins) ===
  const variants = state.variantMap.get(piece.id) || [];
  if (variants.length > 1 && dom.selSkin && dom.skinGrid) {
    dom.skinGrid.innerHTML = '';
    variants.forEach((v, i) => {
      const isCur = v.id === piece.id;
      const btn = document.createElement('button');
      btn.className = 'bp-swap-btn' + (isCur ? ' current' : '');
      const colorBg = facCss(v.faction_id, 0.30);
      const colorBd = facCss(v.faction_id, 0.55);
      btn.innerHTML =
        `<div class="bp-swap-btn-icon" style="background:${colorBg};border:1px solid ${colorBd};">`
        + String(i + 1) + '</div>'
        + `<div class="bp-swap-btn-label">${v.label_fr || v.label_en || ''}</div>`;
      if (!isCur) btn.addEventListener('click', () => swapItemPiece(item.id, v.id));
      dom.skinGrid.appendChild(btn);
    });
    dom.selSkin.style.display = '';
  } else if (dom.selSkin) {
    dom.selSkin.style.display = 'none';
  }
}
/** Bascule le décalage demi-étage (half) de la pièce sélectionnée. */
function toggleSelectedHalf() {
  const itemId = state.selectedItemId;
  if (!itemId) return;
  const item = getItemById(itemId);
  const mesh = placedMeshes.get(itemId);
  if (!item || !mesh) return;
  const piece = mesh.userData.piece;

  const prevHalf = !!item.half;
  const nextHalf = !prevHalf;

  const applyHalf = (h) => {
    item.half = h;
    applyTransformSocket(mesh, item);
    // Met à jour le bouton dans le panneau
    const btn = document.getElementById('bp-sel-half');
    if (btn) btn.classList.toggle('active', h);
  };

  applyHalf(nextHalf);
  pushHistory(
    () => applyHalf(prevHalf),
    () => applyHalf(nextHalf),
  );
}

function rotateSelected(delta) {
  const itemId = state.selectedItemId;
  if (!itemId) return;
  const item = getItemById(itemId);
  const mesh = placedMeshes.get(itemId);
  if (!item || !mesh) return;

  const prevRot = item.rotation || 0;
  const nextRot = (prevRot + delta + 360) % 360;
  const piece   = mesh.userData.piece;

  const applyRot = (rot) => {
    item.rotation = rot;
    applyTransformSocket(mesh, item);
    setText(dom.selRot, rot + '°');
  };

  applyRot(nextRot);
  pushHistory(
    () => applyRot(prevRot),
    () => applyRot(nextRot),
  );
  recomputeStabilityIfActive();
}

// ============================================================
// SIDEBAR
// ============================================================

/**
 * Détecte si une pièce est une fenêtre, quelle que soit sa catégorie JSON.
 * - La plupart des fenêtres ont "window" dans l'ID (category='walls', group='Wall'…)
 * - Exception connue : Watershippers_Window_Wide → category='doors', group='Window_Wide'
 *   → capturé par le test sur le group.
 */
function isPieceWindowType(p) {
  return /window/i.test(p.id)
    || ((p.group || '').startsWith('Window'))
    || /fen[eê]tre/i.test(p.label_fr || '');
}

/**
 * Groupes Floor_* qui mélangent des planchers (posés au sol) et des toits plats
 * (posés en haut des murs) sous le même `group` JSON. Pour ces groupes, on suffixe
 * `_Roof` les pièces rooflike afin de les séparer dans la barre de variantes
 * et la sidebar. Les autres groupes Floor_* (ex. Floor_Triangle_Wide_*) ne sont
 * pas mixtes et n'ont pas besoin de suffixe.
 */
const MIXED_FLOOR_GROUPS = new Set([
  'Floor', 'Floor_Round_Corner', 'Floor_Round_Corner_Inverted', 'Floor_Wedge'
]);

/**
 * Groupe d'affichage "virtuel" d'une pièce.
 * - Fenêtres : reclassées en Window/Window_Round_Corner quel que soit leur group JSON.
 * - Floors rooflike dont le group est mixte : suffixe `_Roof` (ex. Floor → Floor_Roof)
 *   pour les séparer des planchers normaux dans la barre de variantes.
 */
function getDisplayGroup(p) {
  if (isPieceWindowType(p)) {
    return (p.dimensions || {}).shape === 'corner' ? 'Window_Round_Corner' : 'Window';
  }
  if (MIXED_FLOOR_GROUPS.has(p.group) && isPieceRooflike(p)) {
    return p.group + '_Roof';
  }
  // Machines : 1 tuile par pièce dans la sidebar (Small/Medium/Large ont des tailles
  // différentes — il faut pouvoir choisir directement laquelle on pose).
  if (p.is_machine) {
    return p.id;
  }
  return p.group || '';
}

/**
 * Catégorie effective pour le filtrage sidebar.
 * - Fenêtres → catégorie virtuelle 'windows'.
 * - Floors rooflike → catégorie virtuelle 'roofs_flat' (toits plats), séparée des
 *   planchers normaux qui restent en 'floors'. Note : la catégorie *réelle* de la
 *   pièce reste 'floors' dans le JSON, donc `isPieceRooflike`, `getCategoryYOffset`
 *   et les `ignore_groups` continuent de fonctionner normalement.
 */
function getEffectiveCategory(p) {
  if (isPieceWindowType(p)) return 'windows';
  if (p.category === 'floors' && isPieceRooflike(p)) return 'roofs_flat';
  return p.category;
}

/** Formate un nom de groupe (ex: "Wall_Round_Corner" → "Mur arrondi") en français. */
function fmtGroupLabel(group) {
  const MAP = {
    Foundation: 'Fondation', Foundation_Wedge: 'Fond. triangulaire', Foundation_Round_Corner: 'Fond. arrondie',
    Wall: 'Mur', Wall_Half: 'Demi-mur', Wall_Protuding: 'Mur saillant',
    Wall_Round_Corner: 'Mur arrondi', Wall_Round_Corner_Half: 'Demi-mur arrondi',
    Wall_Round_Corner_Sideless: 'Mur arrondi ouvert',
    Window: 'Fenêtre', Window_Round_Corner: 'Fenêtre arrondie',
    Wall_Triangle_Bottom_Left: 'Mur △ bas-gauche', Wall_Triangle_Bottom_Right: 'Mur △ bas-droit',
    Wall_Triangle_Bottom_Half_Left: 'Demi △ bas-gauche', Wall_Triangle_Bottom_Half_Right: 'Demi △ bas-droit',
    Wall_Triangle_Top_Left: 'Mur △ haut-gauche', Wall_Triangle_Top_Right: 'Mur △ haut-droit',
    Wall_Triangle_Top_Half_Left: 'Demi △ haut-gauche', Wall_Triangle_Top_Half_Right: 'Demi △ haut-droit',
    Wall_Inclined_Wide_Left: 'Mur incliné large G', Wall_Inclined_Wide_Right: 'Mur incliné large D',
    Wall_Inclined_Tall: 'Mur incliné haut', Wall_Inclined_Corner_Tall: 'Coin incliné haut',
    Wall_Triangle_Top_Wide_Left: 'Mur △ large haut-G', Wall_Triangle_Top_Wide_Right: 'Mur △ large haut-D',
    Wall_Triangle_Bottom_Tall_Left: 'Mur △ haut bas-G', Wall_Triangle_Bottom_Tall_Right: 'Mur △ haut bas-D',
    Wall_Triangle_Top_Tall_Left: 'Mur △ haut haut-G', Wall_Triangle_Top_Tall_Right: 'Mur △ haut haut-D',
    Pillar: 'Pilier', Pillar_Corner: 'Pilier coin', Passageway: 'Passage',
    Ladder: 'Échelle', Tower: 'Tour', Arch: 'Arche',
    Door_Frame: 'Porte', Door_Frame_Wide: 'Porte large', Door_Frame_Tall: 'Porte haute',
    Door_Frame_Garage: 'Porte garage', Hatch_Frame: 'Trappe', PrudenceDoor_Frame: 'Porte blindée',
    Gate_Big: 'Grand portail', Window_Wide: 'Fenêtre',
    Floor: 'Sol', Floor_Wedge: 'Sol triangulaire', Floor_Round_Corner: 'Sol arrondi',
    Floor_Round_Corner_Inverted: 'Sol arrondi inv.', Rooftop: 'Terrasse',
    Floor_Triangle_Wide_Left: 'Sol △ large G', Floor_Triangle_Wide_Right: 'Sol △ large D',
    Floor_Roof: 'Toit plat', Floor_Wedge_Roof: 'Toit plat triangulaire',
    Floor_Round_Corner_Roof: 'Toit plat arrondi',
    Floor_Round_Corner_Inverted_Roof: 'Toit plat arrondi inv.',
    Roof: 'Toit plat', Roof_Half: 'Demi-toit', Roof_Corner: 'Toit coin',
    Roof_Corner_Half: 'Demi-toit coin', Roof_Corner_Inward: 'Toit coin intérieur',
    Roof_Corner_Half_Inward: 'Demi-toit coin int.',
    Roof_Round_Corner: 'Toit arrondi', Roof_Round_Corner_Half: 'Demi-toit arrondi',
    Roof_Cover_Bottom_Left: 'Couverture bas-G', Roof_Cover_Bottom_Right: 'Couverture bas-D',
    Roof_Cover_Bottom_Half_Left: 'Demi-couv. bas-G', Roof_Cover_Bottom_Half_Right: 'Demi-couv. bas-D',
    Roof_Cover_Top_Left: 'Couverture haut-G', Roof_Cover_Top_Right: 'Couverture haut-D',
    Roof_Cover_Top_Half_Left: 'Demi-couv. haut-G', Roof_Cover_Top_Half_Right: 'Demi-couv. haut-D',
    Roof_Wedge_Bottom: 'Toit △ bas', Roof_Wedge_Top: 'Toit △ haut',
    Roof_Wedge_Bottom_Half: 'Demi-toit △ bas', Roof_Wedge_Top_Half: 'Demi-toit △ haut',
    Angled_Wedge_Bottom: 'Toit angulaire bas', Angled_Wedge_Top: 'Toit angulaire haut',
    Stairs: 'Escaliers', Stairs_Corner: 'Escaliers coin', Stairs_Corner_Inward: 'Esc. coin int.',
    Stairs_Half: 'Demi-escaliers', Stairs_Corner_Half: 'Demi-esc. coin',
    Stairs_Corner_Half_Inward: 'Demi-esc. coin int.',
    Ramp: 'Rampe', Ramp_Corner: 'Rampe coin', Ramp_Corner_Inward: 'Rampe coin int.',
    Ramp_Half: 'Demi-rampe', Ramp_Corner_Half: 'Demi-rampe coin',
    Ramp_Corner_Half_Inward: 'Demi-rampe coin int.', Ramp_Round_Corner: 'Rampe arrondie',
    Ramp_Wide: 'Rampe large', Ramp_Edge_Wide_Left: 'Bord rampe G', Ramp_Edge_Wide_Right: 'Bord rampe D',
    Railing: 'Rambarde', Railing_Round_Corner: 'Rambarde arrondie',
    Railing_Inclined: 'Rambarde inclinée', Railing_Inclined_Half: 'Rambarde incl. ½',
    // Machines (raffineries / fabricateurs)
    OreRefinery: 'Raff. minerai', SpiceRefinery: 'Raff. épice', ChemicalRefinery: 'Raff. chimique',
    Fabricator: 'Fabricateur', PortableFabricator: 'Fab. portable',
    ConstructionFabricator: 'Fab. construction', SurvivalFabricator: 'Fab. survie',
    WeaponsFabricator: 'Fab. armes', WearablesFabricator: 'Fab. vêtements',
    VehiclesFabricator: 'Fab. véhicules',
    // Véhicules
    Sandbike: 'Moto des sables', Buggy: 'Buggy', Tank: "Char d'assaut",
    Sandcrawler: 'Chenille', TreadWheel: 'Roue tout-terrain',
    LightOrnithopter: 'Ornitho. éclaireur', MediumOrnithopter: "Ornitho. d'assaut",
    TransportOrnithopter: 'Ornitho. de transport',
  };
  return MAP[group] || group.replace(/_/g, ' ');
}

// Couleur de faction d'une pièce en #rrggbb (pour les glyphes SVG de la palette).
function facHex(p) { return '#' + (getPieceColor(p) & 0xffffff).toString(16).padStart(6, '0'); }

// Classe une pièce en « famille de glyphe » pour l'icône de palette (vue de profil).
function pieceIconKind(p) {
  if (p.is_vehicle) return 'vehicle';
  if (p.is_machine) return 'machine';
  const cat = getEffectiveCategory(p);
  const g = p.group || '';
  const tri = /Triangle|Wedge/.test(g);
  switch (cat) {
    case 'foundations': return tri ? 'foundation_tri' : 'foundation';
    case 'floors':      return tri ? 'floor_tri' : 'floor';
    case 'roofs_flat':  return 'roof_flat';
    case 'roofs':       return /Cover|Wedge|Angled|Half|Corner/.test(g) ? 'roof_slope' : 'roof_flat';
    case 'windows':     return 'window';
    case 'doors':       return /Hatch/.test(g) ? 'hatch' : (/Gate|Garage/.test(g) ? 'gate' : 'door');
    case 'stairs':      return /Ramp/.test(g) ? 'ramp' : 'stairs';
    case 'railings':    return 'railing';
    case 'walls':       return tri ? 'wall_tri' : (/Half/.test(g) ? 'wall_half' : 'wall');
    case 'structures':  return /Ladder/.test(g) ? 'ladder' : (/Tower/.test(g) ? 'tower' : 'pillar');
    default:            return 'wall';
  }
}

// Génère le glyphe SVG (vue de profil) d'une pièce, teinté couleur de faction.
function pieceIconSVG(p) {
  const c = facHex(p);
  const hole = '#160d05';                                    // « creux » = fond de la tuile
  const f = `fill="${c}" fill-opacity="0.34"`;
  const S = inner => `<svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="${c}"`
    + ` stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round">${inner}</svg>`;
  const base = `<line x1="2.5" y1="20.5" x2="21.5" y2="20.5" stroke="${c}" stroke-opacity="0.4" stroke-width="1.2"/>`;
  switch (pieceIconKind(p)) {
    case 'foundation':     return S(`${base}<rect x="4" y="11" width="16" height="9" rx="1" ${f}/><line x1="4" y1="14.6" x2="20" y2="14.6" stroke-opacity="0.5" stroke-width="1.1"/>`);
    case 'foundation_tri': return S(`${base}<path d="M4 20 L20 20 L4 11 Z" ${f}/>`);
    case 'floor':          return S(`<rect x="3" y="13" width="18" height="4" rx="1" ${f}/>`);
    case 'floor_tri':      return S(`<path d="M3 17 L21 17 L3 13 Z" ${f}/>`);
    case 'roof_flat':      return S(`<rect x="3" y="12" width="18" height="4" rx="0.5" ${f}/><path d="M4 12 L4 9.5 M20 12 L20 9.5"/>`);
    case 'roof_slope':     return S(`<path d="M4 18 L20 8 L20 18 Z" ${f}/>`);
    case 'wall':           return S(`${base}<rect x="7.5" y="5" width="9" height="15" rx="0.5" ${f}/>`);
    case 'wall_half':      return S(`${base}<rect x="7.5" y="12.5" width="9" height="7.5" rx="0.5" ${f}/>`);
    case 'wall_tri':       return S(`${base}<path d="M7 20 L17 20 L17 5 Z" ${f}/>`);
    case 'window':         return S(`${base}<rect x="7.5" y="5" width="9" height="15" rx="0.5" ${f}/><rect x="10" y="9" width="4" height="5" fill="${hole}" stroke-width="1.2"/>`);
    case 'door':           return S(`${base}<rect x="6.5" y="5" width="11" height="15" rx="0.5" ${f}/><path d="M9.5 20 L9.5 11.5 Q12 8.8 14.5 11.5 L14.5 20" fill="${hole}" stroke-width="1.2"/>`);
    case 'gate':           return S(`${base}<rect x="4" y="5" width="16" height="15" rx="0.5" ${f}/><rect x="7" y="9" width="10" height="11" fill="${hole}" stroke-width="1.2"/>`);
    case 'hatch':          return S(`<rect x="4" y="9" width="16" height="6" rx="1" ${f}/><rect x="9" y="10.4" width="6" height="3.2" fill="${hole}" stroke-width="1.1"/>`);
    case 'stairs':         return S(`<path d="M4 20 L4 16 L8 16 L8 12 L12 12 L12 8 L16 8 L16 20 Z" ${f}/>`);
    case 'ramp':           return S(`${base}<path d="M4 20 L20 8 L20 20 Z" ${f}/>`);
    case 'pillar':         return S(`${base}<rect x="9.5" y="4" width="5" height="16" rx="0.5" ${f}/>`);
    case 'ladder':         return S(`${base}<line x1="9" y1="4" x2="9" y2="20"/><line x1="15" y1="4" x2="15" y2="20"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="9" y1="12.5" x2="15" y2="12.5"/><line x1="9" y1="17" x2="15" y2="17"/>`);
    case 'tower':          return S(`${base}<rect x="8" y="7" width="8" height="13" ${f}/><path d="M8 7 L9 4.5 L15 4.5 L16 7"/>`);
    case 'railing':        return S(`${base}<line x1="5" y1="11" x2="19" y2="11"/><line x1="6" y1="11" x2="6" y2="20"/><line x1="12" y1="11" x2="12" y2="20"/><line x1="18" y1="11" x2="18" y2="20"/>`);
    case 'machine':        return S(`<circle cx="12" cy="12" r="6.4" ${f}/><circle cx="12" cy="12" r="2.3" fill="${hole}" stroke-width="1.1"/><g stroke-width="1.3"><line x1="12" y1="3.2" x2="12" y2="5.6"/><line x1="12" y1="18.4" x2="12" y2="20.8"/><line x1="3.2" y1="12" x2="5.6" y2="12"/><line x1="18.4" y1="12" x2="20.8" y2="12"/></g>`);
    case 'vehicle':        return S(`${base}<path d="M4 17 L6 12 L15 12 L19 15 L20 17 Z" ${f}/><circle cx="8" cy="17.3" r="1.8" fill="${hole}"/><circle cx="17" cy="17.3" r="1.8" fill="${hole}"/>`);
    default:               return S(`${base}<rect x="7.5" y="5" width="9" height="15" ${f}/>`);
  }
}

// ============================================================
// VIGNETTES DE PALETTE — rendu offscreen des meshes glb en images
// (lazy via IntersectionObserver + cache session). Fallback = glyphe SVG.
// ============================================================
const THUMB_SIZE = 128;
let _thumbRenderer = null, _thumbScene = null, _thumbCam = null, _thumbHead = null;
const _thumbCache = new Map();    // pieceId → dataURL
const _thumbPending = new Map();  // pieceId → Promise

function _initThumbRenderer() {
  if (_thumbRenderer) return;
  _thumbRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  _thumbRenderer.setSize(THUMB_SIZE, THUMB_SIZE);
  _thumbRenderer.setPixelRatio(1);
  _thumbRenderer.setClearColor(0x000000, 0);
  _thumbScene = new THREE.Scene();
  // Éclairage homogène : hémisphère (pas de face totalement sombre) + key + headlight
  // (suit la caméra → la face vue est toujours éclairée). Évite le rendu « à moitié sombre ».
  _thumbScene.add(new THREE.AmbientLight(0xffffff, 0.55));
  _thumbScene.add(new THREE.HemisphereLight(0xffffff, 0x6b5a3a, 1.0));
  const key = new THREE.DirectionalLight(0xffffff, 0.9); key.position.set(4, 7, 6); _thumbScene.add(key);
  _thumbHead = new THREE.DirectionalLight(0xffffff, 0.5); _thumbScene.add(_thumbHead);
  _thumbCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 5000);
}

/** Rend la vignette d'une pièce (Promise<dataURL|null>). Cache par id. */
function renderThumb(piece) {
  const id = piece.id;
  if (_thumbCache.has(id)) return Promise.resolve(_thumbCache.get(id));
  if (_thumbPending.has(id)) return _thumbPending.get(id);
  if (!piece.mesh) return Promise.resolve(null);
  const pr = meshFactory.loadModel(piece.mesh).then(scene => {
    if (!scene) return null;
    _initThumbRenderer();
    const obj = scene.clone(true);
    // Matériau argile (les géométries sont PARTAGÉES → on ne touche/dispose QUE les matériaux).
    const mats = [];
    obj.traverse(o => { if (o.isMesh) { o.material = meshFactory.clayMaterial(0xcfc6b4, 1); mats.push(o.material); } });
    const box = new THREE.Box3().setFromObject(obj);
    if (box.isEmpty()) return null;
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    obj.position.sub(center);
    _thumbScene.add(obj);
    const maxd = Math.max(size.x, size.y, size.z) || 1;
    // Cadrage plus plein : on prend la plus grande des extensions (diagonale au sol OU hauteur),
    // avec une marge. Remplit mieux la vignette qu'une sphère englobante, sans rogner.
    const r = Math.max(Math.hypot(size.x, size.z) * 0.5, size.y * 0.5, maxd * 0.5) * 1.1;
    _thumbCam.left = -r; _thumbCam.right = r; _thumbCam.top = r; _thumbCam.bottom = -r;
    _thumbCam.near = 0.01; _thumbCam.far = maxd * 20;
    _thumbCam.position.set(maxd * 0.9, maxd * 1.05, maxd * 0.9);   // angle isométrique légèrement plongeant
    _thumbCam.lookAt(0, 0, 0);
    if (_thumbHead) _thumbHead.position.copy(_thumbCam.position);   // headlight = suit la caméra
    _thumbCam.updateProjectionMatrix();
    _thumbRenderer.render(_thumbScene, _thumbCam);
    const url = _thumbRenderer.domElement.toDataURL('image/png');
    _thumbScene.remove(obj);
    for (const m of mats) m.dispose();                    // matériaux du clone uniquement
    _thumbCache.set(id, url);
    return url;
  }).catch(() => null);
  _thumbPending.set(id, pr);
  return pr;
}

// Applique la vignette à l'icône (longhands explicites → jamais réinitialisés par un raccourci CSS).
function _applyThumb(el, url) {
  el.style.backgroundImage = 'url(' + url + ')';
  el.style.backgroundSize = 'contain';
  el.style.backgroundRepeat = 'no-repeat';
  el.style.backgroundPosition = 'center';
  el.classList.add('has-thumb');
}

let _thumbObserver = null;
function _getThumbObserver() {
  if (_thumbObserver) return _thumbObserver;
  _thumbObserver = new IntersectionObserver(entries => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      const el = en.target;
      _thumbObserver.unobserve(el);
      const piece = state.piecesById.get(el.dataset.thumbPiece);
      if (!piece) continue;
      renderThumb(piece).then(url => {
        if (url && el.isConnected) _applyThumb(el, url);
      });
    }
  }, { root: null, rootMargin: '150px' });
  return _thumbObserver;
}

function createPieceEl(p) {
  const colorBd = facCss(p, 0.55);
  const el = document.createElement('div');
  el.className = 'bp-piece-item';
  if (state.activePieceId === p.id) el.classList.add('active');
  el.draggable = true;
  el.dataset.pieceId = p.id;
  el.innerHTML =
    `<div class="bp-piece-icon" style="background-color:${facCss(p, 0.12)};border:1px solid ${colorBd};">`
    + pieceIconSVG(p)
    + '</div>'
    + '<div class="bp-piece-label">' + (p.label_fr || p.id) + '</div>';

  // Vignette du vrai mesh (lazy) : glyphe SVG en attendant, puis image quand rendue.
  if (p.mesh) {
    const iconEl = el.querySelector('.bp-piece-icon');
    if (iconEl) {
      iconEl.dataset.thumbPiece = p.id;
      if (_thumbCache.has(p.id)) _applyThumb(iconEl, _thumbCache.get(p.id));
      else _getThumbObserver().observe(iconEl);
    }
  }

  // Drag & drop (méthode historique). Coexiste avec le click-to-place :
  // - on garde activePieceId actif (les deux modes peuvent cohabiter)
  // - un dragstart "accidentel" sur une pièce déjà active n'efface plus la surbrillance
  el.addEventListener('dragstart', (e) => {
    state.dragPieceId = p.id;
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('text/plain', p.id);
  });
  el.addEventListener('dragend', () => endDrag());

  // Click-to-place : active le canonical (+ barre variantes) ; re-clic sur même groupe → désactive
  el.addEventListener('click', (ev) => {
    ev.stopPropagation();
    // Si une pièce du même groupe est déjà active → désactiver
    const curVariants = state.activePieceId
      ? (state.variantMap.get(state.activePieceId) || []) : [];
    const sameGroup = curVariants.some(v => v.id === p.id);
    setActivePiece(sameGroup ? null : p.id);
  });
  return el;
}

/**
 * Test du filtre faction : les placeables (machines, véhicules) sont universels
 * et apparaissent sur tous les onglets de faction structurelle.
 */
function passesFactionFilter(p) {
  if (!state.activeFaction) return true;
  if (p.faction_id === 'placeables') return true;
  return p.faction_id === state.activeFaction;
}

/**
 * Onglet de mode auquel appartient une pièce :
 * - véhicule       → 'vehicles'
 * - autre machine  → 'machines'
 * - tout le reste  → 'structures'
 */
function pieceTabOf(p) {
  if (p.is_vehicle) return 'vehicles';
  if (p.is_machine) return 'machines';
  return 'structures';
}

/** Catégories pertinentes par onglet — utilisé pour filtrer les options du <select>. */
const TAB_CATEGORIES = {
  structures: new Set(['foundations','walls','windows','floors','roofs_flat','roofs','doors','stairs','structures','railings']),
  machines:   new Set(['refineries','fabricators']),
  vehicles:   new Set(['vehicles']),
};

/**
 * Active un onglet de mode. Réajuste les widgets dépendants :
 * - pills faction visibles uniquement sur 'structures' (machines/véhicules sont universels)
 * - options du select catégorie filtrées au tab
 * - reset de activeCategory si l'option courante n'est plus pertinente
 * - reset de activeFaction quand on quitte 'structures' (les pills sont cachés)
 */
function setActiveTab(tab) {
  if (!TAB_CATEGORIES[tab]) return;
  state.activeTab = tab;

  // Onglets : visuel actif/inactif
  document.querySelectorAll('.bp-mode-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });

  // Pills faction : pertinents uniquement sur Structures
  const pillsBox = document.getElementById('bp-faction-filters');
  if (pillsBox) pillsBox.style.display = (tab === 'structures') ? '' : 'none';
  if (tab !== 'structures') state.activeFaction = '';
  // Resynchronise visuellement la pill active si on revient sur structures
  if (tab === 'structures') {
    document.querySelectorAll('.bp-faction-pill').forEach(p => {
      p.classList.toggle('active', (p.dataset.faction || '') === state.activeFaction);
    });
  }

  // Select catégorie : ne montrer que les options pertinentes du tab
  const select = document.getElementById('bp-category-select');
  if (select) {
    const allowed = TAB_CATEGORIES[tab];
    for (const opt of select.options) {
      // Option vide "— Toutes les catégories —" toujours visible
      opt.hidden = !!opt.value && !allowed.has(opt.value);
    }
    // Reset si la catégorie courante n'est plus dans le tab
    if (state.activeCategory && !allowed.has(state.activeCategory)) {
      state.activeCategory = '';
      select.value = '';
    }
  }

  renderSidebar();
}

function renderSidebar() {
  const q = state.searchQuery.toLowerCase();
  // Recherche active → toutes les pièces (y compris variantes)
  // Pas de recherche → canoniques uniquement (un seul mur, une seule fenêtre, etc.)
  let source;
  if (q) {
    source = state.pieces.filter(p => {
      if (pieceTabOf(p) !== state.activeTab) return false;
      if (!passesFactionFilter(p)) return false;
      if (state.activeCategory && getEffectiveCategory(p) !== state.activeCategory) return false;
      return (p.label_fr || '').toLowerCase().includes(q)
          || (p.id || '').toLowerCase().includes(q);
    });
  } else {
    source = state.canonicals.filter(p => {
      if (pieceTabOf(p) !== state.activeTab) return false;
      if (!passesFactionFilter(p)) return false;
      if (state.activeCategory && getEffectiveCategory(p) !== state.activeCategory) return false;
      return true;
    });
  }

  const toShow = source.slice(0, 300);
  if (!dom.pieceList) return;
  dom.pieceList.innerHTML = '';

  // Sous-catégories : uniquement si filtre catégorie actif, pas de recherche, plusieurs groupes
  const useGroups = state.activeCategory && !q &&
    new Set(toShow.map(p => getDisplayGroup(p))).size > 1;

  if (useGroups) {
    const byGroup = new Map();
    for (const p of toShow) {
      const dg = getDisplayGroup(p);
      if (!byGroup.has(dg)) byGroup.set(dg, []);
      byGroup.get(dg).push(p);
    }
    for (const [group, pieces] of byGroup) {
      const header = document.createElement('div');
      header.className = 'bp-group-header';
      header.textContent = fmtGroupLabel(group);
      dom.pieceList.appendChild(header);
      const grid = document.createElement('div');
      grid.className = 'bp-group-grid';
      for (const p of pieces) grid.appendChild(createPieceEl(p));
      dom.pieceList.appendChild(grid);
    }
  } else {
    for (const p of toShow) dom.pieceList.appendChild(createPieceEl(p));
  }

  if (q) {
    setText(dom.pieceCount, toShow.length + ' / ' + source.length + ' trouvées');
  } else if (source.length < state.canonicals.length) {
    setText(dom.pieceCount, source.length + ' / ' + state.canonicals.length + ' types');
  } else {
    setText(dom.pieceCount,
      state.canonicals.length + ' types · ' + state.pieces.length + ' variantes au total');
  }
}
function fmtDimsLabel(d) {
  if (!d) return '?';
  if (d.d === 0) return d.w > 1 ? d.w + '×H' : '│';
  if (d.shape === 'triangle') return '◤';
  if (d.shape === 'corner')   return '◜';
  if (d.shape === 'pillar')   return '◉';
  if ((d.w || 1) === 1 && (d.d || 1) === 1) return '■';
  return (d.w || 1) + '×' + (d.d || 1);
}
function facCss(idOrPiece, alpha) {
  const c = (idOrPiece && typeof idOrPiece === 'object')
    ? getPieceColor(idOrPiece)
    : (FACTION_COLORS[idOrPiece] ?? 0x666666);
  const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

// ============================================================
// BARRE DE VARIANTES COSMÉTIQUES (sidebar — bas de liste)
// ============================================================
function showVariantBar(variants, activeId) {
  if (!dom.variantBar) return;
  const inner = dom.variantBar.querySelector('.bp-variant-bar-inner');
  if (!inner) return;
  inner.querySelectorAll('.bp-variant-btn').forEach(b => b.remove());
  variants.forEach((v, i) => {
    const btn = document.createElement('button');
    btn.className = 'bp-variant-btn' + (v.id === activeId ? ' active' : '');
    btn.textContent = String(i + 1);
    btn.dataset.tooltip = v.label_fr || v.label_en || v.id;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      setActivePiece(v.id);
    });
    inner.appendChild(btn);
  });
  dom.variantBar.classList.add('open');
}
function hideVariantBar() {
  if (dom.variantBar) dom.variantBar.classList.remove('open');
}

// ============================================================
// FILTRES / TOOLBAR / FLOORS / KEYBOARD / RESIZE
// ============================================================
function initFilters() {
  document.querySelectorAll('.bp-mode-tab').forEach(btn => {
    btn.addEventListener('click', () => setActiveTab(btn.dataset.tab));
  });
  document.querySelectorAll('.bp-faction-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      state.activeFaction = pill.dataset.faction || '';
      document.querySelectorAll('.bp-faction-pill').forEach(p => p.classList.toggle('active', p === pill));
      renderSidebar();
    });
  });
  document.getElementById('bp-category-select')?.addEventListener('change', (e) => { state.activeCategory = e.target.value; renderSidebar(); });
  document.getElementById('bp-search-input')?.addEventListener('input', (e) => { state.searchQuery = e.target.value; renderSidebar(); });

  // Applique l'état initial (tab Structures par défaut) pour synchroniser visibilité des widgets
  setActiveTab(state.activeTab);
}
function initToolbar() {
  document.getElementById('tool-view-ortho')?.addEventListener('click', () => setCameraMode('ortho'));
  document.getElementById('tool-view-3d')?.addEventListener('click',    () => setCameraMode('persp'));
  document.getElementById('tool-zoom-in')?.addEventListener('click',    () => zoomBy(1.2));
  document.getElementById('tool-zoom-out')?.addEventListener('click',   () => zoomBy(1 / 1.2));
  document.getElementById('tool-zoom-reset')?.addEventListener('click', resetView);
  document.getElementById('tool-grid')?.addEventListener('click', (e) => {
    e.currentTarget.classList.toggle('active');
    claimGroup.visible = !claimGroup.visible;
  });
  document.getElementById('tool-solid')?.addEventListener('click', (e) => {
    toggleSolidView();
  });
  document.getElementById('tool-stability')?.addEventListener('click', toggleStabilityMode);
}

/** Bascule entre vue normale (verre transparent, visibilité par étage)
 *  et vue solide (tous les étages visibles et opaques, sans verre). */
function toggleSolidView() {
  state.solidView = !state.solidView;
  applySolidView();
}
/** Applique l'état `state.solidView` courant aux meshes + au bouton (idempotent).
 *  Appelée par toggleSolidView ET à l'init (mode solide actif par défaut). */
function applySolidView() {
  const btn = document.getElementById('tool-solid');
  if (btn) btn.classList.toggle('active', state.solidView);

  if (state.solidView) {
    // ── Mode solide : tout opaque, tout visible ──────────────────────────────
    for (const mesh of placedMeshes.values()) {
      mesh.visible = true;
      // Groupes socket (ENGINE=sockets) → traverse les sous-meshes
      if (mesh.isGroup) {
        mesh.traverse(o => { if (o.isMesh && o.material) {
          o.material.transparent = false; o.material.opacity = 1; o.material.needsUpdate = true;
        }});
      } else {
        const mat = mesh.material;
        if (mat) { mat.transparent = false; mat.opacity = 1; mat.color.setHex(mesh.userData.baseColor); mat.needsUpdate = true; }
        const edges = mesh.userData.edges;
        if (edges) { edges.material.color.setHex(0x000000); edges.material.opacity = 0.45; edges.material.needsUpdate = true; }
        if (mesh.userData.glassPanel) mesh.userData.glassPanel.visible = false;
        if (mesh.userData.cornerGlass) { mesh.userData.cornerGlass.material.opacity = 0.18; mesh.userData.cornerGlass.material.needsUpdate = true; }
      }
    }
  } else {
    // ── Mode normal : restaurer la visibilité ───────────────────────────────
    for (const mesh of placedMeshes.values()) {
      if (mesh.isGroup) {
        mesh.traverse(o => { if (o.isMesh && o.material) { o.material.transparent = false; o.material.opacity = 1; o.material.needsUpdate = true; }});
        continue;
      }
      if (mesh.userData.glassPanel) mesh.userData.glassPanel.visible = true;
      if (mesh.userData.cornerGlass) {
        mesh.userData.cornerGlass.material.opacity = 0.38;
        mesh.userData.cornerGlass.material.needsUpdate = true;
      }
    }
    updateFloorVisibility();
  }
}
function setCameraMode(mode) {
  if (mode === state.cameraMode) return;
  state.cameraMode = mode;
  activeCam = (mode === 'ortho') ? orthoCam : perspCam;
  orbitControls.enabled = (mode === 'persp');
  document.getElementById('tool-view-ortho')?.classList.toggle('active', mode === 'ortho');
  document.getElementById('tool-view-3d')?.classList.toggle('active',    mode === 'persp');
  renderer.domElement.style.cursor = (mode === 'persp') ? 'grab' : 'crosshair';
}
function zoomBy(factor) {
  if (state.cameraMode === 'ortho') {
    state.orthoZoom = Math.max(8, Math.min(120, state.orthoZoom * factor));
    applyOrthoSize();
  } else {
    const dir = new THREE.Vector3().subVectors(perspCam.position, orbitControls.target);
    dir.multiplyScalar(1 / factor);
    perspCam.position.copy(orbitControls.target).add(dir);
    orbitControls.update();
  }
  updateHudZoom();
}
function resetView() {
  const tgt = new THREE.Vector3(BLOCK_CELLS / 2, 0, BLOCK_CELLS / 2);
  if (state.cameraMode === 'ortho') {
    state.orthoZoom = 40;
    applyOrthoSize();
    orthoCam.position.set(tgt.x, 50, tgt.z);
    orthoCam.lookAt(tgt);
  } else {
    perspCam.position.set(tgt.x - 12, 18, tgt.z + 18);
    orbitControls.target.copy(tgt);
    orbitControls.update();
  }
  updateHudZoom();
}
function updateHudZoom() {
  let pct;
  if (state.cameraMode === 'ortho') pct = Math.round((state.orthoZoom / 40) * 100);
  else                              pct = Math.round((20 / perspCam.position.distanceTo(orbitControls.target)) * 100);
  setText(dom.hudZoom, pct + '%');
  setText(dom.zoomReset, pct + '%');
}
/** Met à jour le HUD "½" affiché pendant la pose en mode demi-étage. */
function updateHalfHud() {
  if (!dom.hudHalf) return;
  dom.hudHalf.style.display = state.ghostHalf ? 'block' : 'none';
}
/** Réinitialise le mode demi-étage fantôme (après fin de pose). */
function resetGhostHalf() {
  state.ghostHalf = false;
  updateHalfHud();
}
function initFloorTabs() {
  updateFloorTabs();
}

function switchFloor(z, doScroll = true) {
  state.currentFloor = z;
  updatePieceCount();
  deselect();
  updateFloorVisibility();
  // Mettre à jour l'onglet actif
  const scroll = document.getElementById('bp-floors-scroll');
  if (scroll) {
    scroll.querySelectorAll('.bp-floor-tab').forEach(t => {
      t.classList.toggle('active', parseInt(t.dataset.floor) === z);
    });
    if (doScroll) {
      const active = scroll.querySelector('.bp-floor-tab.active');
      if (active) active.scrollIntoView({ inline: 'center', behavior: 'smooth' });
    }
  }
}
function initKeyboard() {
  document.addEventListener('keydown', (e) => {
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    // Undo — Ctrl+Z
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault(); undoAction(); return;
    }
    // Redo — Ctrl+Y ou Ctrl+Shift+Z
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) {
      e.preventDefault(); redoAction(); return;
    }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault(); redoAction(); return;
    }

    // Ctrl+C — copie tout le contenu de l'étage courant dans floorClipboard
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'c' || e.key === 'C')) {
      e.preventDefault(); copyCurrentFloor(); return;
    }
    // Ctrl+V — colle le clipboard sur l'étage courant
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'v' || e.key === 'V')) {
      e.preventDefault(); pasteFloorClipboard(); return;
    }

    // Escape — annule le mode click-to-place ou désélectionne tout
    if (e.key === 'Escape') {
      if (state.activePieceId) { setActivePiece(null); return; }
      if (state.selectedItemIds.size > 0) { deselectAll(); return; }
    }

    // R — rotation : fantôme pendant drag/click-to-place, pièces sélectionnées, sinon reset vue
    if (e.key === 'r' || e.key === 'R') {
      if (state.dragPieceId || state.activePieceId) {
        if (ENGINE === 'sockets') {
          // En mode sockets : rotation manuelle de +90°, puis refresh immédiat du ghost
          // avec la dernière position curseur mémorisée.
          state.ghostRotation = ((state.ghostRotation || 0) + 90) % 360;
          const pid = state.activePieceId || state.dragPieceId;
          if (pid) socketShowGhost(pid, lastSocketClientPos.x, lastSocketClientPos.y);
          return;
        }
        // Base = rotation effective courante (peut être l'auto-rotation pour les triangles).
        // +90° depuis cette base puis bascule en mode manuel (désactive l'auto-rotation
        // jusqu'au changement de pièce).
        const baseRot = lastGhostState?.effectiveRot ?? state.ghostRotation;
        state.ghostRotation = (baseRot + 90) % 360;
        state.ghostUserSetRotation = true;
        if (lastGhostState) {
          const { piece, snap, resolvedFloor, allowed } = lastGhostState;
          clearGhost();
          lastGhostState = { piece, snap, resolvedFloor, allowed, effectiveRot: state.ghostRotation };
          showGhost(piece, snap, resolvedFloor, allowed, state.ghostRotation);
          showFloorResolveHud(resolvedFloor);
        }
        return;
      }
      // Rotation +90° sur toutes les pièces sélectionnées (chacune autour de son propre centre)
      if (state.selectedItemIds.size > 0) {
        for (const id of Array.from(state.selectedItemIds)) {
          if (state.selectedItemId === id) rotateSelected(+90);
          else {
            // Pour les autres : rotation directe sans passer par le scalaire
            const prev = state.selectedItemId;
            state.selectedItemId = id;
            rotateSelected(+90);
            state.selectedItemId = prev;
          }
        }
        return;
      }
      resetView(); // fallback : reset caméra si rien de sélectionné
      return;
    }

    if ((e.key === 'Delete' || e.key === 'Backspace') && state.selectedItemIds.size > 0) {
      // Suppression multi : on parcourt une copie (removeItem modifie le Set indirectement)
      for (const id of Array.from(state.selectedItemIds)) removeItem(id);
      deselectAll();
    }
    if (e.key === 'v' || e.key === 'V') setCameraMode(state.cameraMode === 'ortho' ? 'persp' : 'ortho');
    if (e.key === 't' || e.key === 'T') toggleSolidView();
  });

  // ── Shift maintenu : demi-étage pendant la pose ────────────────────────────
  // Le ghost descend d'un demi-niveau tant que Shift est enfoncé.
  // Sur la pièce sélectionnée (Shift seul sans pose active) : rien — utiliser le bouton ½.
  function refreshGhostHalf(wantHalf) {
    if (wantHalf === state.ghostHalf) return;
    state.ghostHalf = wantHalf;
    updateHalfHud();
    if (lastGhostState && (state.dragPieceId || state.activePieceId)) {
      const { piece, snap, resolvedFloor, allowed, effectiveRot } = lastGhostState;
      clearGhost();
      showGhost(piece, snap, resolvedFloor, allowed, effectiveRot ?? state.ghostRotation);
    }
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Shift') refreshGhostHalf(true);
  });
  document.addEventListener('keyup', (e) => {
    if (e.key === 'Shift') refreshGhostHalf(false);
  });
}
function initResize() {
  const ro = new ResizeObserver(() => onResize());
  ro.observe(dom.container);
  window.addEventListener('resize', onResize);
}
function onResize() {
  const w = dom.container.clientWidth, h = dom.container.clientHeight;
  if (w === 0 || h === 0) return;
  renderer.setSize(w, h);
  applyOrthoSize();
  perspCam.aspect = w / h;
  perspCam.updateProjectionMatrix();
}

// ============================================================
// DRAG & DROP CANVAS
// ============================================================
function initDragDrop() {
  const el = renderer.domElement;

  // Distinguer un CLIC d'un GLISSÉ (orbite caméra) : si la souris a bougé entre
  // mousedown et mouseup, on ne pose PAS la pièce active et on ne désélectionne pas
  // (sinon impossible de pivoter la vue sans perdre/poser la pièce — retour utilisateur).
  let downX = 0, downY = 0, dragged = false;
  const DRAG_PX = 5;
  el.addEventListener('mousedown', (e) => { if (e.button === 0) { downX = e.clientX; downY = e.clientY; dragged = false; } });

  // Drag-and-drop : même moteur que le click-to-place (sockets). Le ghost suit le
  // curseur pendant le survol, la pose se fait au drop via le moteur de sockets.
  el.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (!state.dragPieceId) return;
    tryShowGhostForPiece(state.dragPieceId, e.clientX, e.clientY);
  });

  el.addEventListener('drop', (e) => {
    e.preventDefault();
    if (!state.dragPieceId) { endDrag(); return; }
    tryPlacePieceAt(state.dragPieceId, e.clientX, e.clientY);
    endDrag();
  });

  el.addEventListener('dragleave', () => endDrag());

  el.addEventListener('click', (e) => {
    // Glissé (orbite caméra) → ni pose ni (dé)sélection : on laisse la vue pivoter.
    if (dragged) { dragged = false; return; }
    // Mode click-to-place : pose la pièce, garde le mode actif pour pose multiple
    if (state.activePieceId) {
      state.ghostHalf = e.shiftKey;        // capture Shift au moment du clic
      tryPlacePieceAt(state.activePieceId, e.clientX, e.clientY);
      state.ghostHalf = e.shiftKey;        // conserve l'état Shift pour le ghost suivant
      updateHalfHud();
      // Reactualise le ghost immédiatement (la pose peut avoir libéré la cellule au-dessus, etc.)
      tryShowGhostForPiece(state.activePieceId, e.clientX, e.clientY);
      return;
    }
    // Sinon : sélection d'une pièce posée
    const hit = raycastPlacedMeshes(e.clientX, e.clientY);
    if (hit) {
      // Shift = ajouter à la sélection ; Ctrl/Cmd = toggle ; sinon remplacer
      const mode = e.shiftKey ? 'add' : (e.ctrlKey || e.metaKey) ? 'toggle' : 'replace';
      select(hit, mode);
    } else {
      // Clic dans le vide sans modificateur : tout désélectionner
      if (!e.shiftKey && !e.ctrlKey && !e.metaKey) deselectAll();
    }
  });

  // Click droit : annule le mode click-to-place
  el.addEventListener('contextmenu', (e) => {
    if (state.activePieceId) {
      e.preventDefault();
      setActivePiece(null);
    }
  });

  let lastCursorRay = 0;
  el.addEventListener('mousemove', (e) => {
    // Détection glissé (bouton gauche maintenu + déplacement) → orbite, pas un clic.
    if ((e.buttons & 1) && Math.hypot(e.clientX - downX, e.clientY - downY) > DRAG_PX) dragged = true;

    if (state.dragPieceId) return;  // pendant un drag, dragover gère le ghost
    // Mode click-to-place : ghost suit le curseur (curseur de pose).
    if (state.activePieceId) {
      el.style.cursor = 'crosshair';
      // Shift tenu → demi-étage ; sync en temps réel même si la souris bougait déjà
      if (e.shiftKey !== state.ghostHalf) {
        state.ghostHalf = e.shiftKey;
        updateHalfHud();
      }
      tryShowGhostForPiece(state.activePieceId, e.clientX, e.clientY);
      return;
    }
    // Sinon : curseur « main » (orbite) par défaut, « pointeur » si on survole une pièce
    // cliquable (sélection). Raycast throttlé pour rester léger sur les grosses bases.
    if (!(e.buttons & 1)) {
      const now = performance.now();
      if (now - lastCursorRay > 60) {
        lastCursorRay = now;
        const over = raycastPlacedMeshes(e.clientX, e.clientY);
        el.style.cursor = over ? 'pointer' : (state.cameraMode === 'persp' ? 'grab' : 'crosshair');
      }
    }
    // MAJ HUD coords
    const world = screenToWorld(e.clientX, e.clientY);
    if (!world) return;
    const cx = Math.floor(world.x / CELL);
    const cz = Math.floor(world.z / CELL);
    setText(dom.hudCoords, `x:${cx} y:${cz}`);
  });

  el.addEventListener('wheel', (e) => {
    // Ctrl + molette : rotation du ghost par paliers de 90° (drag OU click-to-place)
    // ne zoome PAS (pas de fallthrough vers zoomBy)
    if (e.ctrlKey) {
      e.preventDefault();
      e.stopPropagation();
      if (state.dragPieceId || state.activePieceId) {
        const delta = e.deltaY < 0 ? -90 : 90;  // molette vers le haut = -90°
        if (ENGINE === 'sockets') {
          state.ghostRotation = norm360((state.ghostRotation || 0) + delta);
          const pid = state.activePieceId || state.dragPieceId;
          if (pid) socketShowGhost(pid, lastSocketClientPos.x, lastSocketClientPos.y);
          return;
        }
        // Base = rotation effective courante (peut être l'auto-rotation pour les triangles).
        const baseRot = lastGhostState?.effectiveRot ?? state.ghostRotation;
        state.ghostRotation = (baseRot + delta + 360) % 360;
        state.ghostUserSetRotation = true;
        if (lastGhostState) {
          const { piece, snap, resolvedFloor, allowed } = lastGhostState;
          clearGhost();
          lastGhostState = { piece, snap, resolvedFloor, allowed, effectiveRot: state.ghostRotation };
          showGhost(piece, snap, resolvedFloor, allowed, state.ghostRotation);
          showFloorResolveHud(resolvedFloor);
        }
      }
      return;
    }
    // Molette seule : zoom (ortho ET persp, géré entièrement ici car OrbitControls.enableZoom=false)
    e.preventDefault();
    zoomBy(e.deltaY < 0 ? 1.12 : 1 / 1.12);
  }, { passive: false });
}

function formatSnapHud(snap) {
  if (snap.kind === 'edge')   return `arête x:${snap.x} y:${snap.y} ${snap.axis === 'h' ? '─' : '│'}`;
  if (snap.kind === 'corner') return `coin x:${snap.x} y:${snap.y}`;
  if (snap.kind === 'anchor') return `ancre #${snap.anchor_edge_index} → ${snap.anchor_item_id.slice(-5)}`;
  return `x:${snap.x} y:${snap.y}`;
}

// ============================================================
// PANEL DROIT
// ============================================================
function updatePlanPanel() {
  setText(dom.planName,  state.plan.name);
  setText(dom.planOwner, state.plan.owner);
  updatePieceCount();
  updateClaimPanel();
}
function updateClaimPanel() {
  const blocks  = state.plan.claim.blocks;
  const vertExt = state.plan.claim.vertical_extensions;
  setText(dom.claimBlocks, blocks.length + ' / ' + MAX_CLAIM_BLOCKS);
  setText(dom.vertExt,     vertExt + ' / ' + MAX_VERT_EXTENSIONS);
  const maxN = BASE_MAX_FLOOR + vertExt * PER_VERT_UP;
  const maxS = -BASE_MIN_FLOOR + vertExt * PER_VERT_DOWN;
  setText(dom.heightRange, 'S' + maxS + ' → N' + maxN);
  renderClaimViz();
  renderVertPips();
}
function updatePieceCount() {
  const floor = getFloor(state.currentFloor);
  setText(dom.itemCount, floor ? floor.items.length : 0);
}

// ============================================================
// HELPERS
// ============================================================
function getFloor(z)    { return state.plan.floors.find(f => f.z === z) || null; }
function getItemById(id) {
  for (const f of state.plan.floors) { const it = f.items.find(i => i.id === id); if (it) return it; }
  return null;
}
function hideHint() { if (dom.hint) dom.hint.style.display = 'none'; }

// ============================================================
// GESTION DU CLAIM — limites XZ et verticales
// ============================================================

/** Étage maximum autorisé selon les pieux verticaux. */
function getMaxFloor() {
  return BASE_MAX_FLOOR + state.plan.claim.vertical_extensions * PER_VERT_UP;
}
/** Étage minimum autorisé (sous-sol). Base = -7, étendu par les pieux verticaux. */
function getMinFloor() {
  return BASE_MIN_FLOOR - state.plan.claim.vertical_extensions * PER_VERT_DOWN;
}

/** Complète state.plan.floors avec les entrées manquantes pour la plage [min..max]. */
function ensureFloors() {
  const min = getMinFloor(), max = getMaxFloor();
  for (let z = min; z <= max; z++) {
    if (!state.plan.floors.find(f => f.z === z)) {
      const name = z < 0 ? 'S' + Math.abs(z) : z === 0 ? 'RDC' : 'N' + z;
      state.plan.floors.push({ z, name, items: [] });
    }
  }
  state.plan.floors.sort((a, b) => a.z - b.z);
}

/** Vrai si la cellule (cx,cy) est dans un bloc de claim. */
function isCellInClaim(cx, cy) {
  for (const b of state.plan.claim.blocks) {
    const ox = b.gx * BLOCK_CELLS, oz = b.gy * BLOCK_CELLS;
    if (cx >= ox && cx < ox + BLOCK_CELLS && cy >= oz && cy < oz + BLOCK_CELLS) return true;
  }
  return false;
}

/** Vrai si le snap (cell/edge/corner) est à l'intérieur du claim. */
function isWithinClaim(snap) {
  switch (snap.kind) {
    case 'cell':
      return isCellInClaim(snap.x, snap.y);
    case 'edge':
      return snap.axis === 'h'
        ? isCellInClaim(snap.x, snap.y - 1) || isCellInClaim(snap.x, snap.y)
        : isCellInClaim(snap.x - 1, snap.y) || isCellInClaim(snap.x, snap.y);
    case 'corner':
      return isCellInClaim(snap.x - 1, snap.y - 1) || isCellInClaim(snap.x, snap.y - 1)
          || isCellInClaim(snap.x - 1, snap.y)     || isCellInClaim(snap.x, snap.y);
  }
  return false;
}

/** Vérifie que tous les blocs forment un graphe connexe (BFS). */
function isClaimConnected(blocks) {
  if (blocks.length <= 1) return true;
  const set     = new Set(blocks.map(b => b.gx + ',' + b.gy));
  const visited = new Set();
  const queue   = [blocks[0]];
  visited.add(blocks[0].gx + ',' + blocks[0].gy);
  while (queue.length) {
    const c = queue.shift();
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const k = (c.gx + dx) + ',' + (c.gy + dy);
      if (set.has(k) && !visited.has(k)) { visited.add(k); queue.push({ gx: c.gx+dx, gy: c.gy+dy }); }
    }
  }
  return visited.size === blocks.length;
}

/** Ajoute un bloc de claim en (gx,gy) si c'est valide (adjacent, limite non atteinte). */
function addClaimBlock(gx, gy) {
  const blocks = state.plan.claim.blocks;
  if (blocks.length >= MAX_CLAIM_BLOCKS) return;
  if (blocks.find(b => b.gx === gx && b.gy === gy)) return;
  const adjacent = blocks.some(b => Math.abs(b.gx - gx) + Math.abs(b.gy - gy) === 1);
  if (!adjacent) return;
  blocks.push({ gx, gy });
  drawClaimBlock(gx, gy);
  rebuildGrid();          // la grille suit l'extension du fief
  renderClaimViz();
  updateClaimPanel();
}

/** Retire le bloc (gx,gy) si ce n'est pas le principal et que le claim reste connexe. */
function removeClaimBlock(gx, gy) {
  if (gx === 0 && gy === 0) return; // principal : indestructible
  const remaining = state.plan.claim.blocks.filter(b => !(b.gx === gx && b.gy === gy));
  if (!isClaimConnected(remaining)) return; // préserve la connectivité
  state.plan.claim.blocks = remaining;
  rebuildClaimVisuals3D();
  rebuildGrid();          // la grille se réajuste à la réduction du fief
  renderClaimViz();
  updateClaimPanel();
}

/** Recrée le rendu 3D du claim (claimGroup) depuis l'état courant. */
function rebuildClaimVisuals3D() {
  while (claimGroup.children.length) {
    const obj = claimGroup.children[0];
    claimGroup.remove(obj);
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
      else obj.material.dispose();
    }
  }
  for (const b of state.plan.claim.blocks) drawClaimBlock(b.gx, b.gy);
}

/** Applique n pieux verticaux (0–5) et met à jour onglets + UI. */
function setVerticalExtensions(n) {
  state.plan.claim.vertical_extensions = Math.max(0, Math.min(MAX_VERT_EXTENSIONS, n));
  ensureFloors();
  updateFloorTabs();
  renderVertPips();
  updateClaimPanel();
}

/** Met à jour l'état visuel des 5 pips de pieux verticaux. */
function renderVertPips() {
  const n = state.plan.claim.vertical_extensions;
  for (let i = 0; i < MAX_VERT_EXTENSIONS; i++) {
    const pip = document.getElementById('vp' + i);
    if (pip) pip.classList.toggle('active', i < n);
  }
}

/** Branche les pips sur setVerticalExtensions (toggle par clic). */
function initVertPips() {
  for (let i = 0; i < MAX_VERT_EXTENSIONS; i++) {
    const pip = document.getElementById('vp' + i);
    if (!pip) continue;
    pip.addEventListener('click', () => {
      const cur = state.plan.claim.vertical_extensions;
      // Clic sur pip i : étend à i+1 ou réduit à i si c'est déjà le dernier actif
      const newVal = i < cur ? i : i + 1;
      setVerticalExtensions(newVal);
    });
  }
}

/**
 * Redessine la mini-grille 2D du claim dans le panneau droit.
 * Affiche les blocs existants (or) et les cases adjacentes disponibles (+).
 */
function renderClaimViz() {
  const grid = document.getElementById('bp-claim-viz-grid');
  if (!grid) return;

  const blocks   = state.plan.claim.blocks;
  const blockSet = new Set(blocks.map(b => b.gx + ',' + b.gy));
  const canAdd   = blocks.length < MAX_CLAIM_BLOCKS;

  // Positions adjacentes libres
  const available = new Set();
  if (canAdd) {
    for (const b of blocks) {
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const k = (b.gx+dx) + ',' + (b.gy+dy);
        if (!blockSet.has(k)) available.add(k);
      }
    }
  }

  // Bounding box (blocs + disponibles)
  let minX = 0, maxX = 0, minY = 0, maxY = 0;
  for (const b of blocks) {
    minX = Math.min(minX, b.gx); maxX = Math.max(maxX, b.gx);
    minY = Math.min(minY, b.gy); maxY = Math.max(maxY, b.gy);
  }
  for (const k of available) {
    const [gx, gy] = k.split(',').map(Number);
    minX = Math.min(minX, gx); maxX = Math.max(maxX, gx);
    minY = Math.min(minY, gy); maxY = Math.max(maxY, gy);
  }
  // Bornes symétriques : le bloc principal est en (0,0) et on peut faire jusqu'à 5
  // extensions dans N'IMPORTE quelle direction (+1 anneau de cellules disponibles = ±6).
  minX = Math.max(minX, -6); maxX = Math.min(maxX, 6);
  minY = Math.max(minY, -6); maxY = Math.min(maxY, 6);

  const cols = maxX - minX + 1;
  const rows = maxY - minY + 1;
  grid.style.gridTemplateColumns = `repeat(${cols}, 22px)`;
  grid.style.gridTemplateRows    = `repeat(${rows}, 22px)`;
  grid.innerHTML = '';

  for (let gy = minY; gy <= maxY; gy++) {
    for (let gx = minX; gx <= maxX; gx++) {
      const key    = gx + ',' + gy;
      const isMain = gx === 0 && gy === 0;
      const isBlock = blockSet.has(key);
      const isAvail = available.has(key);

      const cell = document.createElement('div');
      cell.className = 'bp-claim-viz-cell'
        + (isMain          ? ' main'      : '')
        + (isBlock && !isMain ? ' ext'    : '')
        + (isAvail         ? ' available' : '');

      if (isMain) {
        cell.textContent = '⚑';
        cell.title = 'Bloc principal (fixe)';
      } else if (isBlock) {
        cell.textContent = '×';
        cell.title = `Bloc (${gx},${gy}) — cliquer pour retirer`;
        cell.style.cursor = 'pointer';
        const _gx = gx, _gy = gy;
        cell.addEventListener('click', () => removeClaimBlock(_gx, _gy));
      } else if (isAvail) {
        cell.textContent = '+';
        cell.title = 'Cliquer pour ajouter ce bloc';
        cell.style.cursor = 'pointer';
        const _gx = gx, _gy = gy;
        cell.addEventListener('click', () => addClaimBlock(_gx, _gy));
      }
      grid.appendChild(cell);
    }
  }
}

/**
 * Régénère les onglets d'étage dans le footer selon getMinFloor/getMaxFloor.
 * Appelée à l'init et à chaque changement d'extensions verticales.
 */
function updateFloorTabs() {
  const scroll = document.getElementById('bp-floors-scroll');
  if (!scroll) return;
  const min = getMinFloor(), max = getMaxFloor();
  scroll.innerHTML = '';

  for (let z = min; z <= max; z++) {
    if (z === 0) {
      const sep = document.createElement('div');
      sep.className = 'bp-floor-ground-sep';
      sep.title = 'Niveau du sol';
      scroll.appendChild(sep);
    }
    const name = z < 0 ? 'S' + Math.abs(z) : z === 0 ? 'RDC' : 'N' + z;
    const btn  = document.createElement('button');
    btn.className = 'bp-floor-tab' + (z < 0 ? ' underground' : '') + (z === state.currentFloor ? ' active' : '');
    btn.dataset.floor = z;
    btn.textContent = name;
    btn.addEventListener('click', () => switchFloor(parseInt(btn.dataset.floor)));
    scroll.appendChild(btn);
  }

  // Si l'étage courant est hors plage, revenir au plus proche
  if (state.currentFloor < min)      switchFloor(min, false);
  else if (state.currentFloor > max) switchFloor(max, false);

  // Scroll vers l'onglet actif
  const active = scroll.querySelector('.bp-floor-tab.active');
  if (active) active.scrollIntoView({ inline: 'center', behavior: 'smooth' });

  updateFloorBadges();
}

// ============================================================
// STABILITÉ — simulation (session 7d)
// ============================================================
// Modèle dataminé + confirmé par la communauté Dune Awakening :
//  - Sources de stabilité = fondation / pilier / colonne au sol (z=0)
//  - Chaque ancre distribue un budget de 9 pas
//  - Saut horizontal entre 2 pièces adjacentes = 1 pas
//  - Saut vertical via mur = 1 pas
//  - Saut vertical via fondation empilée ou pilier = 0 pas (gratuit)
//  - Pièce non atteinte ou budget < 0 → instable (rouge)
//  - Budget 0-1 → limite (jaune), budget >= 2 → stable (vert)

/** True si la pièce est une ancre au sol (fondation/pilier au RDC). */
function isStabilityAnchor(piece, item) {
  if (ENGINE === 'sockets') {
    // Ancres (comme dans le jeu : Foundation / Pillar / Column au sol).
    // - Fondation : ancre si elle touche le sol (cz ≈ 0). Empilée en hauteur → pas une ancre.
    if (piece.is_foundation) return (item.cz || 0) <= 1;
    // - Pilier / colonne au niveau du sol (RDC ou sous-sol, z ≤ 0) : totem vertical = ancre.
    //   (cz d'un pilier RDC = 384 car posé sur la fondation → on teste le NIVEAU, pas cz.)
    if (piece.is_pillar) return (item.z || 0) <= 0;
    return false;
  }
  if (item.z !== 0) return false;
  if (piece.category === 'foundations') return true;
  if (piece.is_pillar) return true;
  const rules = piece.placement_rules || {};
  if (rules.snap_target === 'corner') return true;  // pilier coin
  return false;
}

/** Retourne le Set des cellules touchées par un item (cell, edge, corner). */
function getItemFootprintCells(piece, item) {
  const rules = piece.placement_rules || {};
  if (rules.snap_target === 'cell') {
    return getOccupiedCells(piece, item);
  } else if (rules.snap_target === 'edge') {
    return new Set(edgeAdjacentCells({ x: item.x, y: item.y, axis: item.axis }));
  } else if (rules.snap_target === 'corner') {
    return new Set(cornerAdjacentCells({ x: item.x, y: item.y }));
  }
  return new Set();
}

/** Coût en pas de stabilité pour aller de `from` à `to`. */
function stabilityCost(fromNode, toNode) {
  const fromZ = fromNode.item.z, toZ = toNode.item.z;
  if (fromZ === toZ) return 1;                    // horizontal
  if (Math.abs(fromZ - toZ) !== 1) return Infinity; // pas voisins directs
  // Vertical : le coût dépend de la pièce de support (la plus basse)
  const lower = fromZ < toZ ? fromNode : toNode;
  const lp = lower.piece;
  if (lp.is_pillar) return 0;                     // pilier central → gratuit
  if (lp.category === 'foundations') return 0;    // empilement fondations → gratuit
  return 1;                                       // mur / colonne d'angle / autres → 1
}

// ============================================================
// STABILITÉ — moteur SOCKETS
// Connectivité par COÏNCIDENCE de sockets monde (même règle que le snap) :
// deux pièces sont structurellement jointes si l'un de leurs sockets respectifs
// occupe le même point monde et que les costs/types sont compatibles.
// Le budget (9 pas) se propage en BFS depuis les ancres (fondations/piliers au sol).
// ============================================================
const STAB_GRID = 8;   // cm — quantification pour regrouper les sockets coïncidents

function stabSocketKey(x, y, z) {
  return `${Math.round(x / STAB_GRID)},${Math.round(y / STAB_GRID)},${Math.round(z / STAB_GRID)}`;
}
// Sockets exprimés dans le repère monde (cm) pour un item posé.
function stabWorldSockets(item, piece) {
  const out = [];
  const p = { x: item.x || 0, y: item.y || 0, z: item.cz || 0, rotation: item.rotation || 0 };
  for (const s of (piece.sockets || [])) {
    if (s.cost === 'No_Cost') continue;   // socket neutre → pas de jonction structurelle
    const w = M(p, s.lx, s.ly, s.lz);
    out.push({ wx: w.x, wy: w.y, wz: w.z, sock: s });
  }
  return out;
}
// Un socket de COIN (décalé en diagonale, |lx|>1 ET |ly|>1) : sert l'accroche des
// piliers d'angle. Deux sols voisins en DIAGONALE partagent un tel socket, ce qui
// créerait un raccourci de stabilité illégitime (ils ne se touchent que par un coin,
// pas une face porteuse). On rejette donc les jonctions COIN↔COIN, mais on garde
// COIN↔centre (un vrai pilier d'angle supporte bien le sol).
const stabIsCornerSocket = s => Math.abs(s.lx) > 1 && Math.abs(s.ly) > 1;

// Deux sockets posés se joignent (coïncidence + compatibilité bidirectionnelle).
function stabSocketsJoin(a, b) {
  if (stabIsCornerSocket(a.sock) && stabIsCornerSocket(b.sock)) return false;   // pas de diagonale sol↔sol
  if (Math.abs(a.wx - b.wx) > STAB_GRID || Math.abs(a.wy - b.wy) > STAB_GRID || Math.abs(a.wz - b.wz) > STAB_GRID) return false;
  return (costMatch(a.sock.cost, b.sock.cost) || costMatch(b.sock.cost, a.sock.cost)) && typeMatch(a.sock, b.sock);
}

/**
 * Calcule le budget de stabilité restant par item (moteur sockets).
 * @param {Array} [extraItems] items virtuels à inclure (ghost de pose à tester).
 * @returns {Map<string, number>} itemId → budget restant (absent = jamais atteint).
 */
function computeStabilitySocket(extraItems) {
  // 1. Nodes
  const nodes = [];
  const pushItem = (it) => {
    const piece = state.piecesById.get(it.piece_id);
    if (!piece || !piece.sockets || !piece.sockets.length) return;
    nodes.push({ item: it, piece, ws: stabWorldSockets(it, piece) });
  };
  for (const f of state.plan.floors) for (const it of f.items) pushItem(it);
  if (extraItems) for (const it of extraItems) pushItem(it);

  // 2. Buckets de sockets → adjacence (coïncidence + compatibilité)
  const bucket = new Map();
  nodes.forEach((n, ni) => { for (const ws of n.ws) {
    const k = stabSocketKey(ws.wx, ws.wy, ws.wz);
    if (!bucket.has(k)) bucket.set(k, []);
    bucket.get(k).push({ ni, ws });
  }});
  const adj = nodes.map(() => new Set());
  for (const arr of bucket.values()) {
    for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) {
      const A = arr[i], B = arr[j];
      if (A.ni === B.ni || adj[A.ni].has(B.ni)) continue;
      if (stabSocketsJoin(A.ws, B.ws)) { adj[A.ni].add(B.ni); adj[B.ni].add(A.ni); }
    }
  }

  // 3. Ancres → budget initial
  const budget = new Map();   // ni → budget restant
  const queue = [];
  nodes.forEach((n, ni) => {
    if (isStabilityAnchor(n.piece, n.item)) { budget.set(ni, STABILITY_BUDGET); queue.push(ni); }
  });

  // 4. BFS « max budget restant » (réutilise stabilityCost via les niveaux item.z)
  let iter = 0; const MAX_ITER = nodes.length * 12 + 100;
  while (queue.length && iter < MAX_ITER) {
    iter++;
    const ci = queue.shift();
    const cb = budget.get(ci);
    if (cb == null || cb <= 0) continue;
    for (const ni of adj[ci]) {
      const cost = stabilityCost(nodes[ci], nodes[ni]);
      if (!isFinite(cost)) continue;
      const nb = cb - cost;
      const ex = budget.get(ni);
      if (ex == null || nb > ex) { budget.set(ni, nb); queue.push(ni); }
    }
  }
  if (iter >= MAX_ITER) console.warn('[stability/socket] BFS hit max iter (' + MAX_ITER + ')');

  // 5. Remap ni → itemId
  const out = new Map();
  nodes.forEach((n, ni) => { if (budget.has(ni)) out.set(n.item.id, budget.get(ni)); });
  return out;
}

/** Recalcule l'état de stabilité de toutes les pièces. Met à jour state.stabilityMap. */
function computeStability() {
  if (ENGINE === 'sockets') { state.stabilityMap = computeStabilitySocket(); return; }
  // 1. Collecte tous les nodes (item + piece + cellules + z)
  const nodes = [];
  for (const f of state.plan.floors) {
    for (const it of f.items) {
      const piece = state.piecesById.get(it.piece_id);
      if (!piece) continue;
      nodes.push({
        item:  it,
        piece,
        cells: getItemFootprintCells(piece, it),
      });
    }
  }

  // 2. Index par z → Map<"x,y", node[]> pour findNeighbors rapide
  const indexByZ = new Map();
  for (const n of nodes) {
    const z = n.item.z;
    if (!indexByZ.has(z)) indexByZ.set(z, new Map());
    const m = indexByZ.get(z);
    for (const c of n.cells) {
      if (!m.has(c)) m.set(c, []);
      m.get(c).push(n);
    }
  }

  // 3. Identifie les ancres et initialise leur budget
  const budget = new Map();
  for (const n of nodes) {
    if (isStabilityAnchor(n.piece, n.item)) budget.set(n.item.id, STABILITY_BUDGET);
  }

  // 4. BFS Dijkstra-inverse : on maximise le budget restant à chaque node
  const queue = Array.from(budget.keys()).map(id => nodes.find(n => n.item.id === id)).filter(Boolean);
  let iter = 0;
  const MAX_ITER = nodes.length * 10 + 100;   // garde-fou anti-boucle infinie
  while (queue.length > 0 && iter < MAX_ITER) {
    iter++;
    const cur = queue.shift();
    const curBudget = budget.get(cur.item.id);
    if (curBudget == null || curBudget <= 0) continue;
    // Voisins : items touchant une cellule occupée ou adjacente, au même z ou z±1
    const candidates = new Set();
    for (const c of cur.cells) {
      const [x, y] = c.split(',').map(Number);
      // Même cellule, cellules adjacentes (4-dir), même z
      const sameZIdx = indexByZ.get(cur.item.z);
      if (sameZIdx) {
        for (const [dx, dy] of [[0,0],[1,0],[-1,0],[0,1],[0,-1]]) {
          const k = (x+dx) + ',' + (y+dy);
          const items = sameZIdx.get(k);
          if (items) for (const o of items) if (o !== cur) candidates.add(o);
        }
      }
      // Z+1 et Z-1 : même cellule (pour propagation verticale)
      for (const dz of [-1, 1]) {
        const idx = indexByZ.get(cur.item.z + dz);
        if (idx) {
          const items = idx.get(c);
          if (items) for (const o of items) if (o !== cur) candidates.add(o);
        }
      }
    }
    for (const n of candidates) {
      const cost = stabilityCost(cur, n);
      if (!isFinite(cost)) continue;
      const newBudget = curBudget - cost;
      const existing = budget.get(n.item.id);
      if (existing == null || newBudget > existing) {
        budget.set(n.item.id, newBudget);
        queue.push(n);
      }
    }
  }
  if (iter >= MAX_ITER) console.warn('[stability] BFS hit max iter limit (' + MAX_ITER + ')');

  state.stabilityMap = budget;
}

/** Couleur de stabilité pour un budget donné (null/<0 = rouge, 0-1 = jaune, ≥2 = vert). */
function stabilityColorFor(budget) {
  if (budget == null || budget < 0) return STABILITY_COLOR_ERROR;
  if (budget < 2)                   return STABILITY_COLOR_WARNING;
  return STABILITY_COLOR_OK;
}

/** Applique les couleurs vert/jaune/rouge selon state.stabilityMap. */
function applyStabilityVisuals() {
  for (const [id, mesh] of placedMeshes.entries()) {
    const piece = mesh.userData.piece;
    if (!piece) continue;
    // Meshes sockets = Group (boîte fallback OU glb argile) → on tinte chaque sous-mesh.
    if (mesh.isGroup) {
      const target = state.showStability ? stabilityColorFor(state.stabilityMap.get(id)) : 0xcfc6b4;
      mesh.userData.stabilityTint = state.showStability ? target : null;   // mémorisé pour le swap glb async
      mesh.traverse(o => { if (o.isMesh && o.material && o.material.color) o.material.color.setHex(target); });
      continue;
    }
    if (!mesh.material || !mesh.material.color) continue;
    mesh.material.color.setHex(state.showStability ? stabilityColorFor(state.stabilityMap.get(id)) : getPieceColor(piece));
  }
}

/** Recalcule + applique si le mode stabilité est actif. À appeler après pose/suppression/move. */
function recomputeStabilityIfActive() {
  if (!state.showStability) return;
  computeStability();
  applyStabilityVisuals();
}

/** Toggle de l'affichage stabilité. */
function toggleStabilityMode() {
  state.showStability = !state.showStability;
  if (state.showStability) computeStability();
  applyStabilityVisuals();
  const btn = document.getElementById('tool-stability');
  if (btn) btn.classList.toggle('active', state.showStability);
}

/**
 * Simule l'ajout d'un nouvel item au plan, calcule sa stabilité, et retourne
 * true si elle est OK (budget ≥ 0 ou pièce devient elle-même une nouvelle ancre).
 * Utilisé pour bloquer les poses instables quand le mode stabilité est actif.
 * Optimisation : pas de recalcul si pas en mode stabilité (la fonction renvoie true).
 */
function wouldBeStableAfterPlacing(piece, snap, floorZ) {
  if (!state.showStability) return true;  // mode off → ne bloque jamais

  // Phase 3 — pour un snap d'ancrage (triangle), on dérive x, y, rotation depuis
  // la matérialisation. Pas d'arête de claim à vérifier, mais on simule la
  // présence d'un item posé pour le calcul de stabilité.
  let ghostItem;
  if (snap.kind === 'anchor') {
    const m = materializeAnchorSnap(snap, piece.id, floorZ);
    if (!m) return true;   // ancre orpheline → on ne bloque pas par stabilité
    ghostItem = {
      id:                '_ghost_stab_',
      piece_id:          piece.id,
      snap_kind:         'anchor',
      anchor_item_id:    snap.anchor_item_id,
      anchor_edge_index: snap.anchor_edge_index,
      x:                 m.x,
      y:                 m.y,
      z:                 floorZ,
      rotation:          m.rotation,
      half:              state.ghostHalf || false,
    };
  } else {
    ghostItem = {
      id:       '_ghost_stab_',
      piece_id: piece.id,
      x:        snap.x,
      y:        snap.y,
      axis:     snap.axis,
      z:        floorZ,
      rotation: state.ghostRotation || 0,
      half:     state.ghostHalf || false,
    };
  }
  if (isStabilityAnchor(piece, ghostItem)) return true;

  // Insertion temporaire du ghost dans le plan, recalcul, lecture, retrait
  const floor = getFloor(floorZ);
  if (!floor) return true;
  floor.items.push(ghostItem);
  computeStability();
  const budget = state.stabilityMap.get('_ghost_stab_');
  // Retire le ghost et restaure l'état précédent
  floor.items.pop();
  // Recalcul propre pour restaurer state.stabilityMap sans le ghost
  computeStability();

  return budget != null && budget >= 0;
}

// ============================================================
// PERSISTANCE PHP — sauvegarde / partage de plans (session 8)
// ============================================================
// API endpoint : base_planner_api.php (POST avec champ `action`)
// Auth : on envoie `owner` = pseudo localStorage à chaque requête, le serveur
// vérifie l'ownership avant les actions destructives.
//
// state.currentPlanId / state.currentPlanName : identifiant et nom du plan actif
// state.readonly : true si on visite un plan partagé qui ne nous appartient pas
// state.currentShareToken : token public si le plan est partagé

state.currentPlanId     = null;
state.currentPlanName   = '';
state.readonly          = false;
state.currentShareToken = null;
state.pendingDeletePlanId = null;

/** Pseudo de l'utilisateur connecté (depuis localStorage, comme le reste du site). */
function bpCurrentUser() {
  return localStorage.getItem('user') || '';
}

/** POST helper vers base_planner_api.php. Retourne une promise. */
async function bpApiCall(action, params = {}) {
  const body = Object.assign({ action, owner: bpCurrentUser() }, params);
  const res  = await fetch('base_planner_api.php', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

/** Sérialise l'état courant en JSON stockable. Ne sauvegarde QUE ce qui est nécessaire
 *  pour reconstruire le plan : claim + items posés (pas les meshes Three.js).
 *  La structure réelle est state.plan.{floors, claim} (pas state.{floors, claim}). */
function bpSerializePlanData() {
  const srcFloors = (state.plan && state.plan.floors) || [];
  const floors = srcFloors.map(f => ({
    z:     f.z,
    name:  f.name,
    items: (f.items || []).map(it => {
      const out = {
        id:       it.id,
        piece_id: it.piece_id,
        x:        it.x,
        y:        it.y,
        axis:     it.axis,
        z:        it.z,
        rotation: it.rotation || 0,
        half:     it.half || false,
      };
      // Moteur sockets : hauteur cm (rendu + moteur). Indispensable pour recharger.
      if (it.cz != null) out.cz = it.cz;
      // Refactor triangle Phase 2.5 : si l'item est ancré, on sérialise les
      // champs d'ancrage. Les autres items (cell-snap) restent au format
      // historique pour compat ascendante (les anciens serveurs/lecteurs ne
      // verront pas ces nouveaux champs).
      if (it.snap_kind === 'anchor') {
        out.snap_kind         = 'anchor';
        out.anchor_item_id    = it.anchor_item_id;
        out.anchor_edge_index = it.anchor_edge_index;
      }
      return out;
    }),
  }));
  const itemCount = floors.reduce((s, f) => s + f.items.length, 0);
  return {
    version:      ENGINE === 'sockets' ? 2 : 1,   // v2 = items en cm (sockets)
    claim:        (state.plan && state.plan.claim) || null,
    floors,
    currentFloor: state.currentFloor,
    item_count:   itemCount,
    floor_count:  floors.length,
  };
}

/** Applique des données plan au state et reconstruit les meshes. */
function bpApplyPlanData(data) {
  if (!data || !Array.isArray(data.floors)) return;

  // Vider la scène des items actuels
  for (const m of placedMeshes.values()) { scene.remove(m); disposeMesh(m); }
  placedMeshes.clear();
  state.selectedItemId = null;

  // Reset state.plan.{claim, floors}
  if (!state.plan) state.plan = {};
  if (data.claim) {
    state.plan.claim = data.claim;
    if (claimGroup) { rebuildClaimVisuals3D(); rebuildGrid(); }   // redessine fief + grille du plan chargé
  }
  state.plan.floors = data.floors.map(f => ({
    z:     f.z,
    name:  f.name || (f.z < 0 ? 'S' + Math.abs(f.z) : f.z === 0 ? 'RDC' : 'N' + f.z),
    items: [],
  }));
  state.currentFloor = data.currentFloor != null ? data.currentFloor : 0;
  state.history   = [];
  state.histFront = -1;

  // Reconstruire les items (1ère passe : juste les données, pas les meshes)
  let skipped = 0;
  for (const fData of data.floors) {
    const floor = state.plan.floors.find(f => f.z === fData.z);
    if (!floor) continue;
    for (const itData of (fData.items || [])) {
      const piece = state.piecesById.get(itData.piece_id);
      if (!piece) { skipped++; continue; }   // pièce inconnue (catalogue mis à jour)
      floor.items.push(itData);
    }
  }
  if (skipped > 0) console.warn('[plan] ' + skipped + ' pièces ignorées (id introuvable dans le catalogue)');

  // Refactor triangle Phase 2.4 : migrer les anciens triangles (cell-snap) vers
  // le nouveau format ancrage (anchor-snap). Doit se faire APRÈS que tous les
  // items soient chargés pour que chaque triangle puisse trouver sa pièce
  // d'ancrage parmi ses voisins.
  const migrated = migrateTriangleSnaps(state.plan);
  if (migrated > 0) console.info('[plan] ' + migrated + ' triangles migrés en mode ancrage');

  // 2e passe : créer les meshes (ordre indifférent car les triangles ancrés se
  // résolvent dynamiquement via leur anchor_item_id, pas via une référence directe).
  for (const floor of state.plan.floors) {
    for (const itData of floor.items) {
      const piece = state.piecesById.get(itData.piece_id);
      if (!piece) continue;
      const mesh = buildMeshForPiece(piece, itData);
      scene.add(mesh);
      placedMeshes.set(itData.id, mesh);
    }
  }

  // Refresh UI
  if (typeof rebuildFloorTabs === 'function') rebuildFloorTabs();
  if (typeof switchFloor === 'function')      switchFloor(state.currentFloor, false);
  updateFloorVisibility();
  updateFloorBadges();
  updatePieceCount();
  state.dirty = false;            // un plan fraîchement chargé n'est pas "modifié"
  bpRefreshPlanHud();
  recomputeStabilityIfActive();
}

/** Marque le plan comme modifié / à jour et rafraîchit l'indicateur. */
function bpSetDirty(v) {
  if (state.dirty === v) return;
  state.dirty = v;
  bpRefreshPlanHud();
}
/** Y a-t-il des pièces posées dans le plan ? */
function bpPlanHasItems() {
  return !!(state.plan && state.plan.floors && state.plan.floors.some(f => f.items && f.items.length));
}

/** Affiche le nom du plan actif + état (modifié, readonly, partagé) dans le panneau de droite. */
function bpRefreshPlanHud() {
  const nameEl = document.getElementById('bp-plan-name') || document.querySelector('.bp-plan-name-display');
  if (nameEl) {
    let label = state.currentPlanName || (state.plan && state.plan.name) || 'Nouveau plan';
    if (state.readonly) label += ' (lecture seule)';
    nameEl.textContent = label;
  }
  const metaEl = document.getElementById('bp-plan-meta');
  if (metaEl) {
    const owner = (typeof bpCurrentUser === 'function' && bpCurrentUser()) || localStorage.getItem('user') || '—';
    const saved = state.currentPlanId && !state.dirty;
    const state_txt = state.readonly ? 'Lecture seule'
                    : saved ? '<span style="color:#4caf76;">Enregistré ✓</span>'
                    : state.dirty ? '<span style="color:#e0a83a;">Non sauvegardé •</span>'
                    : 'Non sauvegardé';
    metaEl.innerHTML = state_txt + '<br>Propriétaire : <span id="bp-plan-owner">' + owner + '</span>';
  }
}

/** Reset complet du state pour démarrer un plan vide. */
function bpResetPlan() {
  for (const m of placedMeshes.values()) { scene.remove(m); disposeMesh(m); }
  placedMeshes.clear();
  state.selectedItemId      = null;
  state.currentPlanId       = null;
  state.currentPlanName     = '';
  state.currentShareToken   = null;
  state.readonly            = false;
  state.history             = [];
  state.histFront           = -1;
  if (!state.plan) state.plan = {};
  state.plan.id   = null;
  state.plan.name = 'Nouveau plan';
  // Reset floors au minimum (RDC + 6 niveaux comme à l'init)
  state.plan.floors = [
    { z:  0, name: 'RDC', items: [] },
    { z:  1, name: 'N1',  items: [] },
    { z:  2, name: 'N2',  items: [] },
    { z:  3, name: 'N3',  items: [] },
    { z:  4, name: 'N4',  items: [] },
    { z:  5, name: 'N5',  items: [] },
    { z:  6, name: 'N6',  items: [] },
  ];
  state.currentFloor = 0;
  state.dirty = false;
  // Nettoie l'URL (?plan=) → un rechargement repart bien de ce plan vierge.
  try { history.replaceState(null, '', window.location.pathname); } catch (e) {}
  if (typeof rebuildFloorTabs === 'function') rebuildFloorTabs();
  if (typeof switchFloor === 'function')      switchFloor(0, false);
  updateFloorVisibility();
  updateFloorBadges();
  updatePieceCount();
  bpRefreshPlanHud();
}

/** Crée un nouveau plan, avec confirmation si le plan courant n'est pas enregistré. */
function bpRequestNewPlan() {
  const unsaved = bpPlanHasItems() && (state.dirty || !state.currentPlanId);
  if (unsaved) {
    const modal = document.getElementById('modal-new-plan');
    if (modal) { modal.classList.add('open'); return; }
    // Fallback sans modale
    if (!window.confirm('Le plan actuel n’est pas enregistré. Créer un nouveau plan et perdre les modifications ?')) return;
  }
  bpResetPlan();
}

// ─── Sauvegarde ────────────────────────────────────────────────────────────

function bpOpenSaveModal() {
  if (state.readonly) {
    alert('Plan en lecture seule — utilisez "Mes plans" puis "+ Nouveau plan" pour partir de zéro.');
    return;
  }
  const input = document.getElementById('save-plan-name');
  if (input) input.value = state.currentPlanName || '';

  // Adapte le titre + le bouton selon update vs création.
  // L'utilisateur voit clairement s'il met à jour un plan existant ou en crée un nouveau.
  const isUpdate = !!state.currentPlanId;
  const titleEl  = document.querySelector('#modal-save .bp-modal-title');
  const confirmBtn = document.getElementById('save-confirm-btn');
  if (titleEl) titleEl.textContent = isUpdate ? 'Mettre à jour le plan' : 'Sauvegarder le plan';
  if (confirmBtn) confirmBtn.textContent = isUpdate ? 'Mettre à jour' : 'Sauvegarder';

  document.getElementById('modal-save').classList.add('open');
}

async function bpSaveCurrentPlan() {
  const nameInput = document.getElementById('save-plan-name');
  const name = nameInput ? nameInput.value.trim() : '';
  if (!name) { alert('Donnez un nom au plan.'); return; }
  if (!bpCurrentUser()) { alert('Connectez-vous pour sauvegarder.'); return; }

  const data = bpSerializePlanData();
  const params = { name, description: '', data };
  if (state.currentPlanId) params.id = state.currentPlanId;

  const res = await bpApiCall('save', params);
  if (res.status === 'ok') {
    state.currentPlanId   = res.plan.id;
    state.currentPlanName = res.plan.name;
    // Synchronise aussi state.plan.{id,name} pour que l'affichage du panneau (qui lit
    // state.plan.name via setText(dom.planName, ...)) reflète le nom du plan sauvegardé.
    if (!state.plan) state.plan = {};
    state.plan.id   = res.plan.id;
    state.plan.name = res.plan.name;
    state.dirty     = false;          // plan à jour avec le serveur
    document.getElementById('modal-save').classList.remove('open');
    bpRefreshPlanHud();
    // Tente de relancer la fonction d'update du panneau si elle existe
    if (typeof updatePlanPanel === 'function') updatePlanPanel();
  } else {
    alert('Erreur sauvegarde : ' + (res.message || 'inconnue'));
  }
}

// ─── Mes plans (liste + chargement + suppression) ──────────────────────────

async function bpOpenPlansModal() {
  if (!bpCurrentUser()) { alert('Connectez-vous pour voir vos plans.'); return; }
  document.getElementById('modal-plans').classList.add('open');
  const listEl = document.getElementById('plans-list');
  if (listEl) listEl.innerHTML = '<div style="text-align:center; padding:20px; color:#888;">Chargement…</div>';
  const res = await bpApiCall('list');
  if (res.status !== 'ok') { listEl.innerHTML = '<div style="color:#c66;">Erreur : ' + (res.message || '?') + '</div>'; return; }
  bpRenderPlansList(res.plans || []);
}

function bpRenderPlansList(plans) {
  const listEl = document.getElementById('plans-list');
  if (!listEl) return;
  if (plans.length === 0) {
    listEl.innerHTML = '<div style="text-align:center; padding:20px; color:#888; font-style:italic;">Aucun plan sauvegardé</div>';
    return;
  }
  listEl.innerHTML = '';
  for (const p of plans) {
    const row = document.createElement('div');
    row.className = 'bp-plan-row';
    const date = new Date(p.updated_at * 1000);
    const dateStr = date.toLocaleDateString('fr-FR') + ' ' + date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    const meta = (p.item_count != null ? p.item_count + ' pièces — ' : '') +
                 (p.floor_count != null ? p.floor_count + ' étages — ' : '') +
                 'maj ' + dateStr +
                 (p.is_shared ? ' — partagé' : '');
    row.innerHTML =
      '<div class="bp-plan-row-info">' +
      '  <div class="bp-plan-row-name">' + (p.name || '(sans nom)') + '</div>' +
      '  <div class="bp-plan-row-meta">' + meta + '</div>' +
      '</div>' +
      '<button class="bp-plan-row-del" title="Supprimer">✕</button>';
    row.querySelector('.bp-plan-row-info').addEventListener('click', () => bpLoadPlanById(p.id));
    row.querySelector('.bp-plan-row-del').addEventListener('click', (e) => {
      e.stopPropagation();
      state.pendingDeletePlanId = p.id;
      document.getElementById('modal-delete-plan').classList.add('open');
    });
    listEl.appendChild(row);
  }
}

async function bpLoadPlanById(planId) {
  const res = await bpApiCall('load', { id: planId });
  if (res.status !== 'ok') { alert('Chargement impossible : ' + (res.message || '?')); return; }
  state.currentPlanId       = res.plan.id;
  state.currentPlanName     = res.plan.name;
  state.currentShareToken   = res.plan.share_token || null;
  state.readonly            = !!res.readonly;
  if (!state.plan) state.plan = {};
  state.plan.id   = res.plan.id;
  state.plan.name = res.plan.name;
  bpApplyPlanData(res.plan.data);
  document.getElementById('modal-plans').classList.remove('open');
}

async function bpDeletePlanConfirmed() {
  if (!state.pendingDeletePlanId) return;
  const res = await bpApiCall('delete', { id: state.pendingDeletePlanId });
  document.getElementById('modal-delete-plan').classList.remove('open');
  if (res.status === 'ok') {
    if (state.currentPlanId === state.pendingDeletePlanId) bpResetPlan();
    state.pendingDeletePlanId = null;
    // Recharge la liste
    bpOpenPlansModal();
  } else {
    alert('Erreur suppression : ' + (res.message || '?'));
  }
}

// ─── Partage ───────────────────────────────────────────────────────────────

function bpOpenShareModal() {
  if (!state.currentPlanId) {
    alert('Sauvegardez d\'abord le plan pour pouvoir le partager.');
    return;
  }
  const toggle = document.getElementById('share-toggle-public');
  const link   = document.getElementById('share-link-input');
  if (toggle) toggle.checked = !!state.currentShareToken;
  if (link)   link.value     = state.currentShareToken ? bpShareUrl(state.currentShareToken) : '';
  document.getElementById('modal-share').classList.add('open');
}

function bpShareUrl(token) {
  const base = window.location.origin + window.location.pathname;
  return base + '?plan=' + encodeURIComponent(token);
}

async function bpTogglePublicShare(checked) {
  if (!state.currentPlanId) return;
  if (checked) {
    const res = await bpApiCall('share', { id: state.currentPlanId });
    if (res.status === 'ok') {
      state.currentShareToken = res.share_token;
      const link = document.getElementById('share-link-input');
      if (link) link.value = bpShareUrl(res.share_token);
    } else {
      alert('Erreur partage : ' + (res.message || '?'));
      document.getElementById('share-toggle-public').checked = false;
    }
  } else {
    const res = await bpApiCall('unshare', { id: state.currentPlanId });
    if (res.status === 'ok') {
      state.currentShareToken = null;
      const link = document.getElementById('share-link-input');
      if (link) link.value = '';
    } else {
      alert('Erreur : ' + (res.message || '?'));
      document.getElementById('share-toggle-public').checked = true;
    }
  }
}

function bpCopyShareLink() {
  const link = document.getElementById('share-link-input');
  if (!link || !link.value) return;
  link.select();
  try {
    navigator.clipboard.writeText(link.value);
    const btn = document.getElementById('share-copy-btn');
    if (btn) {
      const old = btn.textContent;
      btn.textContent = '✓ Copié';
      setTimeout(() => { btn.textContent = old; }, 1500);
    }
  } catch (e) {
    document.execCommand('copy');
  }
}

// ─── Auto-load via URL ?plan=<token> ───────────────────────────────────────

async function bpTryLoadFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const token  = params.get('plan');
  if (!token) return;
  const res = await bpApiCall('load_shared', { token });
  if (res.status !== 'ok') {
    console.warn('[plan] Chargement partagé échoué :', res.message);
    return;
  }
  state.currentPlanId     = res.plan.id;
  state.currentPlanName   = res.plan.name;
  state.currentShareToken = res.plan.share_token || null;
  state.readonly          = !!res.readonly;
  bpApplyPlanData(res.plan.data);
  // Nettoie l'URL (retire ?plan=…) → un rechargement (Ctrl+Shift+R) repart d'un plan VIERGE
  // au lieu de recharger le plan. Le lien de partage reste fonctionnel à la 1ʳᵉ ouverture.
  try { history.replaceState(null, '', window.location.pathname); } catch (e) {}
}

// ─── Câblage boutons + auto-load ───────────────────────────────────────────

function bpInitPersistence() {
  // Note : les boutons toolbar (btn-save-plan/btn-my-plans/btn-share-plan) et
  // save-confirm-btn sont câblés dans base_planner.html (handlers inline) qui
  // dispatchent vers bpOpenSaveModal / bpOpenPlansModal / bpOpenShareModal /
  // bpSaveCurrentPlan si elles existent. On évite le double câblage ici.
  document.getElementById('new-plan-btn')         ?.addEventListener('click', () => {
    document.getElementById('modal-plans').classList.remove('open');
    bpRequestNewPlan();
  });
  document.getElementById('delete-plan-confirm-btn')?.addEventListener('click', bpDeletePlanConfirmed);
  document.getElementById('share-toggle-public')  ?.addEventListener('change', (e) => bpTogglePublicShare(e.target.checked));
  document.getElementById('share-copy-btn')       ?.addEventListener('click', bpCopyShareLink);

  // Charge automatiquement si URL ?plan=<token>
  bpTryLoadFromUrl();
  bpRefreshPlanHud();
}

// ─── Exposer les fonctions API sur window ──────────────────────────────────
// Le script est chargé en mode `type="module"` → tout est dans le scope du module,
// PAS accessible depuis les handlers inline du HTML (qui sont en scope global).
// On expose explicitement ce dont le HTML a besoin.
window.bpOpenSaveModal       = bpOpenSaveModal;
window.bpOpenPlansModal      = bpOpenPlansModal;
window.bpOpenShareModal      = bpOpenShareModal;
window.bpSaveCurrentPlan     = bpSaveCurrentPlan;
window.bpResetPlan           = bpResetPlan;
window.bpRequestNewPlan      = bpRequestNewPlan;
window.bpLoadPlanById        = bpLoadPlanById;
window.bpDeletePlanConfirmed = bpDeletePlanConfirmed;
window.bpTogglePublicShare   = bpTogglePublicShare;
window.bpCopyShareLink       = bpCopyShareLink;

// Debug helpers : permet d'inspecter state, screenToWorld, snapForPiece, etc.
// depuis la console DevTools (sinon inaccessibles à cause du module ES6).
window.bpDebug = {
  state,
  screenToWorld,
  snapForPiece,
  computeStability,
  placedMeshes,
  // Phase 2-3 refactor triangle : helpers d'arête, résolution, migration, snap
  getPieceEdges,
  resolveTrianglePosition: (item) => resolveTrianglePosition(item, state.plan),
  migrateTriangleSnaps: () => migrateTriangleSnaps(state.plan),
  findNearestFreeEdge: (worldPos, z = state.currentFloor) => findNearestFreeEdge(worldPos, state.plan, z),
  getUsedEdges: (z = state.currentFloor) => Array.from(getUsedEdges(state.plan, z)),
  // Helpers prêts à l'emploi pour debug rapide
  listTriangles(z = 0) {
    const floor = state.plan.floors.find(f => f.z === z);
    if (!floor) return [];
    return floor.items.filter(it => {
      const p = state.piecesById.get(it.piece_id);
      return p && /triangle/.test((p.placement_rules || {}).footprint_shape || '');
    }).map(it => ({ x: it.x, y: it.y, rot: it.rotation || 0, piece_id: it.piece_id }));
  },
  lastPlaced(z = 0) {
    const floor = state.plan.floors.find(f => f.z === z);
    if (!floor) return null;
    return floor.items.slice(-1)[0];
  },
};

// ============================================================
// BOUCLE DE RENDU
// ============================================================
function animate() {
  if (!window.__bpPauseRender) requestAnimationFrame(animate);
  if (orbitControls.enabled) orbitControls.update();
  renderer.render(scene, activeCam);
}
// Hook debug (test/preview) : permet de capturer (pause la boucle rAF) et d'inspecter.
window.__bp = {
  state, placedMeshes, socketEngine, meshFactory,
  get scene() { return scene; },           // getter : scene assignée pendant init()
  get ghostMesh() { return ghostMesh; },
  pauseRender() { window.__bpPauseRender = true; },
  resumeRender() { if (window.__bpPauseRender) { window.__bpPauseRender = false; animate(); } },
  renderOnce() { renderer.render(scene, activeCam); },
  itemsFlat() { return state.plan.floors.flatMap(f => f.items.map(it => ({ ...it }))); },
  serialize() { return bpSerializePlanData(); },
  applyPlan(d) { return bpApplyPlanData(d); },
  inClaim(x, y) { return socketInClaim(x, y); },
};
