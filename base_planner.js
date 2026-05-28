'use strict';

// ============================================================
// base_planner.js — Constructeur de base Dune Awakening (Three.js)
// Sessions 3–5+ — Claim complet + multi-étages lisibles + undo/redo + rotation (R/Ctrl-Z/Y)
//                + sous-catégories sidebar + Wall_Round_Corner + détection toits par label
//                + mode click-to-place (clic sidebar → clics canvas) + Escape pour annuler.
// ============================================================

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

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
// chaque ancre (fondation/pilier au sol) distribue un budget de 9 pas. Chaque saut
// horizontal ou vertical via mur coûte 1 pas. Saut vertical via fondation empilée
// ou pilier coûte 0 (transmission gratuite).
const STABILITY_BUDGET    = 9;
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
  // Vue solide : masque le verre (fenêtres transparentes)
  solidView:      false,
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
}
function redoAction() {
  if (state.histFront >= state.history.length - 1) return;
  state.histFront++;
  state.history[state.histFront].redo();
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
  hideHint();
  animate();
}

document.addEventListener('DOMContentLoaded', init);

// ============================================================
// CHARGEMENT CATALOGUE
// ============================================================
async function loadCatalog() {
  const resp = await fetch(PIECES_JSON_URL);
  if (!resp.ok) throw new Error('pieces ' + resp.status);
  const piecesData = await resp.json();
  state.pieces = (piecesData.pieces || []).filter(p => p.faction_id !== 'blockout');

  const { canonicals, variantMap } = buildVariantIndex(state.pieces);
  state.canonicals = canonicals;
  state.variantMap = variantMap;

  state.piecesById = new Map();
  for (const p of state.pieces) state.piecesById.set(p.id, p);
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

  const grid = new THREE.GridHelper(40, 40, COLOR_GRID_MAJOR, COLOR_GRID_MINOR);
  grid.position.y = 0.005;
  grid.material.transparent = true;
  grid.material.opacity = 0.55;
  scene.add(grid);
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
  const hits = raycaster.intersectObjects(Array.from(placedMeshes.values()), false);
  return hits.length > 0 ? hits[0].object : null;
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
  // 2. Limite XZ du claim
  if (!isWithinClaim(snap)) return false;

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
  const item = {
    id: itemId,
    piece_id: pieceId,
    snap_kind: snap.kind,
    x: snap.x, y: snap.y,
    axis: snap.axis,
    z: targetZ,
    rotation: rotation % 360,
    half: state.ghostHalf || false,   // demi-étage : décalage Y de +0.5 WALL_UNIT
  };
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

/** Affiche le ghost pour une pièce à la position écran donnée. Renvoie true si OK. */
function tryShowGhostForPiece(pieceId, clientX, clientY) {
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
  const tmpItem = {
    id: 'ghost',
    piece_id: piece.id,
    snap_kind: snap.kind,
    x: snap.x, y: snap.y,
    axis: snap.axis,
    z: resolvedFloor,
    rotation,                       // rotation effective (auto pour triangles, sinon ghostRotation)
    half: state.ghostHalf,          // demi-étage fantôme courant (touche H)
  };
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
  } else {
    // Cellule : carré translucide
    const geo = new THREE.BoxGeometry(CELL * 0.95, 0.03, CELL * 0.95);
    const cellMat = mat.clone();
    cellMat.opacity = 0.30;
    hoverHelper = new THREE.Mesh(geo, cellMat);
    hoverHelper.position.set(snap.x + CELL / 2, yBase, snap.y + CELL / 2);
  }
  scene.add(hoverHelper);
}

// ============================================================
// SÉLECTION (multi : Set selectedItemIds + scalaire selectedItemId pour le panneau)
// ============================================================

/** Applique l'apparence "sélectionnée" à un mesh (edges dorés). */
function _markSelectedVisual(mesh) {
  if (mesh && mesh.userData.edges) {
    mesh.userData.edges.material.color.setHex(COLOR_SELECT);
    mesh.userData.edges.material.opacity = 1;
  }
}

/** Applique l'apparence "non-sélectionnée" à un mesh (edges noirs). */
function _markUnselectedVisual(mesh) {
  if (mesh && mesh.userData.edges) {
    mesh.userData.edges.material.color.setHex(0x000000);
    mesh.userData.edges.material.opacity = 0.45;
  }
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
  const placed  = [];
  const skipped = [];

  for (const src of state.floorClipboard.items) {
    const piece = state.piecesById.get(src.piece_id);
    if (!piece) { skipped.push(src); continue; }

    // Construit un snap compatible avec isPlacementAllowedOnFloor
    const rules = piece.placement_rules || {};
    const snap = {
      kind: rules.snap_target || 'cell',
      x:    src.x,
      y:    src.y,
      axis: src.axis,
    };
    if (!isPlacementAllowedOnFloor(piece, snap, targetZ)) {
      skipped.push(src);
      continue;
    }
    // Crée un nouvel item avec nouvel id, mais conserve x/y/axis/rotation/half
    const newItem = {
      id:       'item_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      piece_id: src.piece_id,
      snap_kind: snap.kind,
      x:        src.x,
      y:        src.y,
      axis:     src.axis,
      z:        targetZ,
      rotation: src.rotation || 0,
      half:     src.half || false,
    };
    const floor = getFloor(targetZ);
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
    mesh.rotation.set(0, 0, 0);
    placeMeshAt(mesh, item, piece);
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
    mesh.rotation.set(0, 0, 0);
    placeMeshAt(mesh, item, piece);
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

function createPieceEl(p) {
  const colorBg = facCss(p, 0.30);
  const colorBd = facCss(p, 0.55);
  const el = document.createElement('div');
  el.className = 'bp-piece-item';
  if (state.activePieceId === p.id) el.classList.add('active');
  el.draggable = true;
  el.dataset.pieceId = p.id;
  el.innerHTML =
    `<div class="bp-piece-icon" style="background:${colorBg};border:1px solid ${colorBd};">`
    + fmtDimsLabel(p.dimensions || {})
    + '</div>'
    + '<div class="bp-piece-label">' + (p.label_fr || p.id) + '</div>';

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
  const btn = document.getElementById('tool-solid');
  if (btn) btn.classList.toggle('active', state.solidView);

  if (state.solidView) {
    // ── Mode solide : tout opaque, tout visible, pas de verre ──────────────
    for (const mesh of placedMeshes.values()) {
      mesh.visible = true;
      const mat = mesh.material;
      if (mat) {
        mat.transparent = false;
        mat.opacity     = 1;
        mat.color.setHex(mesh.userData.baseColor);
        mat.needsUpdate = true;
      }
      const edges = mesh.userData.edges;
      if (edges) {
        edges.material.color.setHex(0x000000);
        edges.material.opacity = 0.45;
        edges.material.needsUpdate = true;
      }
      if (mesh.userData.glassPanel) mesh.userData.glassPanel.visible = false;
      if (mesh.userData.cornerGlass) {
        mesh.userData.cornerGlass.material.opacity = 0.18;
        mesh.userData.cornerGlass.material.needsUpdate = true;
      }
    }
  } else {
    // ── Mode normal : restaurer le verre et la visibilité par étage ────────
    for (const mesh of placedMeshes.values()) {
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

  el.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (!state.dragPieceId) return;
    state.ghostHalf = e.shiftKey;          // Shift tenu → demi-étage
    updateHalfHud();
    const piece = state.piecesById.get(state.dragPieceId);
    if (!piece) return;
    const world = screenToWorld(e.clientX, e.clientY);
    if (!world) return;
    const snap = snapForPiece(world, piece);
    if (!snap) return;
    const resolvedFloor = findBestPlacementFloor(piece, snap);
    const allowed = isPlacementAllowedOnFloor(piece, snap, resolvedFloor);
    const effectiveRot = computeEffectiveRotation(piece, snap, world, resolvedFloor);
    // Mémorise l'état pour re-render immédiat lors d'un keydown R
    lastGhostState = { piece, snap, resolvedFloor, allowed, effectiveRot };
    showGhost(piece, snap, resolvedFloor, allowed, effectiveRot);
    showFloorResolveHud(resolvedFloor);
    setText(dom.hudCoords, formatSnapHud(snap));
  });

  el.addEventListener('drop', (e) => {
    e.preventDefault();
    state.ghostHalf = e.shiftKey;          // capture Shift au moment du drop
    if (!state.dragPieceId) { endDrag(); return; }
    const piece = state.piecesById.get(state.dragPieceId);
    if (!piece) { endDrag(); return; }
    const world = screenToWorld(e.clientX, e.clientY);
    if (!world) { endDrag(); return; }
    const snap = snapForPiece(world, piece);
    if (!snap) { endDrag(); return; }
    const resolvedFloor = findBestPlacementFloor(piece, snap);
    const dropRot = computeEffectiveRotation(piece, snap, world, resolvedFloor);
    if (isPlacementAllowedOnFloor(piece, snap, resolvedFloor)) {
      if (state.showStability && !wouldBeStableAfterPlacing(piece, snap, resolvedFloor)) {
        showFloorResolveHud(resolvedFloor, 'Pose refusée : stabilité insuffisante');
      } else {
        placePieceFromSnap(state.dragPieceId, snap, resolvedFloor, dropRot);
      }
    }
    endDrag();
    state.ghostHalf = false;
    updateHalfHud();
  });

  el.addEventListener('dragleave', () => endDrag());

  el.addEventListener('click', (e) => {
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

  el.addEventListener('mousemove', (e) => {
    if (state.dragPieceId) return;  // pendant un drag, dragover gère le ghost
    // Mode click-to-place : ghost suit le curseur
    if (state.activePieceId) {
      // Shift tenu → demi-étage ; sync en temps réel même si la souris bougait déjà
      if (e.shiftKey !== state.ghostHalf) {
        state.ghostHalf = e.shiftKey;
        updateHalfHud();
      }
      tryShowGhostForPiece(state.activePieceId, e.clientX, e.clientY);
      return;
    }
    // Sinon : MAJ HUD coords seulement
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
  minX = Math.max(minX, -3); maxX = Math.min(maxX, 5);
  minY = Math.max(minY, -2); maxY = Math.min(maxY, 3);

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

/** Recalcule l'état de stabilité de toutes les pièces. Met à jour state.stabilityMap. */
function computeStability() {
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

/** Applique les couleurs vert/jaune/rouge selon state.stabilityMap. */
function applyStabilityVisuals() {
  for (const [id, mesh] of placedMeshes.entries()) {
    const piece = mesh.userData.piece;
    if (!piece || !mesh.material || !mesh.material.color) continue;
    let color;
    if (state.showStability) {
      const b = state.stabilityMap.get(id);
      if (b == null || b < 0) color = STABILITY_COLOR_ERROR;
      else if (b < 2)         color = STABILITY_COLOR_WARNING;
      else                    color = STABILITY_COLOR_OK;
    } else {
      color = getPieceColor(piece);  // restaure la couleur normale
    }
    mesh.material.color.setHex(color);
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

  // Si la pièce candidate serait une ancre, elle est stable d'office
  const ghostItem = {
    id:       '_ghost_stab_',
    piece_id: piece.id,
    x:        snap.x,
    y:        snap.y,
    axis:     snap.axis,
    z:        floorZ,
    rotation: state.ghostRotation || 0,
    half:     state.ghostHalf || false,
  };
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
    items: (f.items || []).map(it => ({
      id:       it.id,
      piece_id: it.piece_id,
      x:        it.x,
      y:        it.y,
      axis:     it.axis,
      z:        it.z,
      rotation: it.rotation || 0,
      half:     it.half || false,
    })),
  }));
  const itemCount = floors.reduce((s, f) => s + f.items.length, 0);
  return {
    version:      1,
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
  if (data.claim) state.plan.claim = data.claim;
  state.plan.floors = data.floors.map(f => ({
    z:     f.z,
    name:  f.name || (f.z < 0 ? 'S' + Math.abs(f.z) : f.z === 0 ? 'RDC' : 'N' + f.z),
    items: [],
  }));
  state.currentFloor = data.currentFloor != null ? data.currentFloor : 0;
  state.history   = [];
  state.histFront = -1;

  // Reconstruire les items
  let skipped = 0;
  for (const fData of data.floors) {
    const floor = state.plan.floors.find(f => f.z === fData.z);
    if (!floor) continue;
    for (const itData of (fData.items || [])) {
      const piece = state.piecesById.get(itData.piece_id);
      if (!piece) { skipped++; continue; }   // pièce inconnue (catalogue mis à jour)
      floor.items.push(itData);
      const mesh = buildMeshForPiece(piece, itData);
      scene.add(mesh);
      placedMeshes.set(itData.id, mesh);
    }
  }
  if (skipped > 0) console.warn('[plan] ' + skipped + ' pièces ignorées (id introuvable dans le catalogue)');

  // Refresh UI
  if (typeof rebuildFloorTabs === 'function') rebuildFloorTabs();
  if (typeof switchFloor === 'function')      switchFloor(state.currentFloor, false);
  updateFloorVisibility();
  updateFloorBadges();
  updatePieceCount();
  bpRefreshPlanHud();
  recomputeStabilityIfActive();
}

/** Affiche le nom du plan actif + état (modifié, readonly, partagé) dans le panneau de droite. */
function bpRefreshPlanHud() {
  const nameEl = document.getElementById('plan-name-display') || document.querySelector('.bp-plan-name-display');
  if (nameEl) {
    let label = state.currentPlanName || (state.plan && state.plan.name) || 'Nouveau plan';
    if (state.readonly) label += ' (lecture seule)';
    nameEl.textContent = label;
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
  if (typeof rebuildFloorTabs === 'function') rebuildFloorTabs();
  if (typeof switchFloor === 'function')      switchFloor(0, false);
  updateFloorVisibility();
  updateFloorBadges();
  updatePieceCount();
  bpRefreshPlanHud();
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
}

// ─── Câblage boutons + auto-load ───────────────────────────────────────────

function bpInitPersistence() {
  // Note : les boutons toolbar (btn-save-plan/btn-my-plans/btn-share-plan) et
  // save-confirm-btn sont câblés dans base_planner.html (handlers inline) qui
  // dispatchent vers bpOpenSaveModal / bpOpenPlansModal / bpOpenShareModal /
  // bpSaveCurrentPlan si elles existent. On évite le double câblage ici.
  document.getElementById('new-plan-btn')         ?.addEventListener('click', () => {
    document.getElementById('modal-plans').classList.remove('open');
    bpResetPlan();
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
  // Phase 2.1 refactor triangle : helpers d'arête
  getPieceEdges,
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
  requestAnimationFrame(animate);
  if (orbitControls.enabled) orbitControls.update();
  renderer.render(scene, activeCam);
}
