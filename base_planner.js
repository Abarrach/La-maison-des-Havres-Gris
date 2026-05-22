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
const FOUNDATION_DEPTH  = 0.5;   // épaisseur visuelle d'une fondation
const FLOOR_THICKNESS   = 0.15;  // épaisseur visuelle d'un sol/toit-plat
const PILLAR_W          = 0.25;  // section d'un pilier
const WALL_THICKNESS    = 0.12;  // épaisseur visuelle d'un mur
const RAILING_HEIGHT    = 0.45;

const PIECES_JSON_URL     = 'base_pieces_v2.json';
const PLACEABLES_JSON_URL = 'base_placeables_data.json';

// Claim limits (règles officielles Dune Awakening)
const MAX_CLAIM_BLOCKS    = 6;   // 1 bloc principal + 5 extensions horizontales
const MAX_VERT_EXTENSIONS = 5;   // pieux verticaux (0–5)
const BASE_MAX_FLOOR      = 6;   // niveaux au-dessus sol sans extension
const PER_VERT_UP         = 7;   // niveaux supplémentaires en hauteur par pieu
const PER_VERT_DOWN       = 5;   // niveaux supplémentaires en sous-sol par pieu

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
};

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
  placeables:  [],
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
  selectedItemId: null,
  activeTab:      'pieces',
  activeFaction:  '',
  activeCategory: '',
  searchQuery:    '',
  dragPieceId:    null,
  cameraMode:     'ortho',
  orthoZoom:      40,
  // Undo / Redo
  history:        [],   // [{ undo, redo }]
  histFront:      -1,   // index de l'action courante
  // Rotation fantôme (pendant drag OU click-to-place)
  ghostRotation:  0,
  // Click-to-place : pièce sélectionnée dans la sidebar, posée par clic sur le canvas
  activePieceId:  null,
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
  const [piecesResp, placeablesResp] = await Promise.all([
    fetch(PIECES_JSON_URL),
    fetch(PLACEABLES_JSON_URL),
  ]);
  if (!piecesResp.ok)     throw new Error('pieces '     + piecesResp.status);
  if (!placeablesResp.ok) throw new Error('placeables ' + placeablesResp.status);

  const piecesData     = await piecesResp.json();
  const placeablesData = await placeablesResp.json();

  state.pieces = (piecesData.pieces || []).filter(p => p.faction_id !== 'blockout');
  state.placeables = placeablesData.placeables || [];

  state.piecesById = new Map();
  for (const p of state.pieces)     state.piecesById.set(p.id, p);
  for (const p of state.placeables) state.piecesById.set(p.id, p);
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
/** Prisme triangle rectangle 1×1 (wedges, round corners de fondations/sols/toits).
 *  Géométrie centrée sur XZ (origine au centre de la cellule) → bottom à Y=0.
 *  La diagonale (hypoténuse) va de (w/2, ?, -d/2) à (-w/2, ?, d/2). Le coin "plein"
 *  est en (-w/2, ?, -d/2). Rotation utilisateur fera tourner autour du centre.
 */
function makeTrianglePrismGeometry(w, h, d) {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(w, 0);
  shape.lineTo(0, d);
  shape.lineTo(0, 0);
  const geom = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false });
  // ExtrudeGeometry crée le shape en XY extrudé vers +Z (vertices : x∈[0,w], y∈[0,d], z∈[0,h]).
  // Rotation +PI/2 autour de X : (x,y,z) → (x,-z,y). Le shape passe en XZ, profondeur d en +Z,
  // hauteur h en -Y. Translate +h → bottom à Y=0. Translate -w/2/-d/2 → centré sur XZ.
  geom.rotateX(Math.PI / 2);
  geom.translate(0, h, 0);            // bottom à Y=0
  geom.translate(-w / 2, 0, -d / 2);  // centré sur XZ
  return geom;
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

  // --- Murs arrondis en coin (Wall_Round_Corner*) — quart de cylindre ---
  if (rules.snap_target === 'edge' && dim.shape === 'corner') {
    const h = (dim.h && dim.h > 0 ? dim.h : 1) * WALL_UNIT;
    return makeRoundCornerWallGeometry(CELL, h, WALL_THICKNESS);
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

  // --- Triangulaires (wedges, round corners de sols/fondations/toits) ---
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
  const yBase = getFloorYBase(item.z ?? state.currentFloor) + getCategoryYOffset(piece);
  const cat   = piece.category;

  // ---- Snap edge — mur arrondi (arc centré sur le coin de l'arête) ----
  if (rules.snap_target === 'edge' && dim.shape === 'corner') {
    const h = (dim.h && dim.h > 0 ? dim.h : 1) * WALL_UNIT;
    // L'arc commence à (outerR, 0, 0) et finit à (0, 0, outerR).
    // On positionne le centre de l'arc (0,0,0) sur le coin gauche/bas de l'arête.
    if (item.axis === 'h') {
      mesh.position.x = item.x;       // coin gauche de l'arête horizontale
      mesh.position.z = item.y;
      mesh.rotation.y = 0;
    } else {
      mesh.position.x = item.x;
      mesh.position.z = item.y;       // coin bas de l'arête verticale
      mesh.rotation.y = -Math.PI / 2; // fait pointer l'arc vers l'intérieur de la cellule
    }
    mesh.position.y = yBase; // origine bas, pas de +h/2 (arc non centré Y)
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
  // ---- Triangulaires (géométrie centrée XZ, origine bas) ----
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

function buildMeshForPiece(piece, item) {
  const color = FACTION_COLORS[piece.faction_id] ?? 0x666666;
  const geo   = createGeometryForPiece(piece);
  const mat   = new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.15 });
  const mesh  = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  // Outline noir (edges) pour la lisibilité
  const edges = new THREE.EdgesGeometry(geo, 30);
  const edgesMat = new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45 });
  const edgesLine = new THREE.LineSegments(edges, edgesMat);
  mesh.add(edgesLine);
  mesh.userData.edges = edgesLine;

  placeMeshAt(mesh, item, piece);

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
    const isFloorLike = piece?.category === 'floors' || piece?.category === 'foundations';
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
function showFloorResolveHud(resolvedFloor) {
  if (!dom.hudFloorResolve) return;
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
  const isFloor = v => v === 'floor' || v === 'floors' || v === 'foundations';
  const isRoof  = v => v === 'roof'  || v === 'roofs';
  const isStair = v => v === 'stair' || v === 'stairs';
  if (isFloor(vcA) && isRoof(vcB))                       return false;
  if (isRoof(vcA)  && isFloor(vcB))                      return false;
  if (isStair(vcA) && (isFloor(vcB) || isRoof(vcB)))     return false;
  if ((isFloor(vcA) || isRoof(vcA)) && isStair(vcB))     return false;
  return true;
}

/** Vérifie si la pose est compatible sur l'étage floorZ explicite. */
function isPlacementAllowedOnFloor(piece, snap, floorZ) {
  // 1. Limites verticales du claim
  if (floorZ < getMinFloor() || floorZ > getMaxFloor()) return false;
  // 2. Limite XZ du claim
  if (!isWithinClaim(snap)) return false;

  const floor = getFloor(floorZ);
  if (!floor) return true;
  const rules  = piece.placement_rules || {};
  const ignore = new Set(rules.ignore_groups || []);

  for (const it of floor.items) {
    const other = state.piecesById.get(it.piece_id);
    if (!other) continue;

    const otherSnap = (other.placement_rules || {}).snap_target;

    if (snap.kind === 'edge' && otherSnap === 'edge') {
      if (it.x === snap.x && it.y === snap.y && it.axis === snap.axis) {
        if (!ignore.has(other.group) && !(other.placement_rules?.ignore_groups || []).includes(piece.group)) {
          return false;
        }
      }
    } else if (snap.kind === 'cell' && otherSnap === 'cell') {
      if (it.x === snap.x && it.y === snap.y) {
        // Toit/Rooftop vs plancher/fondation : hauteurs différentes, pas de conflit
        if (!sameVerticalSpace(piece, other)) continue;
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
  return itemId;
}

/** Supprime un item du plan ET de la scène (pas d'historique). */
function _removeItemCore(itemId) {
  const mesh = placedMeshes.get(itemId);
  if (mesh) {
    if (mesh.userData.edges) {
      mesh.userData.edges.geometry.dispose();
      mesh.userData.edges.material.dispose();
    }
    mesh.geometry.dispose();
    mesh.material.dispose();
    scene.remove(mesh);
    placedMeshes.delete(itemId);
  }
  for (const f of state.plan.floors) {
    f.items = f.items.filter(i => i.id !== itemId);
  }
  if (state.selectedItemId === itemId) deselect();
  updatePieceCount();
  updateFloorVisibility();
  updateFloorBadges();
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
    if (ghostMesh.userData.edges) {
      ghostMesh.userData.edges.geometry.dispose();
      ghostMesh.userData.edges.material.dispose();
    }
    ghostMesh.geometry.dispose();
    ghostMesh.material.dispose();
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
  }
  lastGhostState = null;
  state.dragPieceId = null;
}

// ============================================================
// MODE CLICK-TO-PLACE
// ============================================================

/** Active (ou désactive si null) une pièce pour la pose au clic. */
function setActivePiece(pieceId) {
  // Si on désactive ou on change, on remet la rotation à zéro et on nettoie le ghost
  if (pieceId !== state.activePieceId) {
    state.ghostRotation = 0;
    lastGhostState = null;
    clearGhost();
  }
  state.activePieceId = pieceId;
  // Met à jour le surlignage dans la sidebar
  document.querySelectorAll('.bp-piece-item').forEach(el => {
    el.classList.toggle('active', el.dataset.pieceId === pieceId);
  });
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
  lastGhostState = { piece, snap, resolvedFloor, allowed };
  showGhost(piece, snap, resolvedFloor, allowed);
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
  return placePieceFromSnap(pieceId, snap, resolvedFloor, state.ghostRotation);
}

function showGhost(piece, snap, resolvedFloor, allowed) {
  clearGhost();
  const tmpItem = {
    id: 'ghost',
    piece_id: piece.id,
    snap_kind: snap.kind,
    x: snap.x, y: snap.y,
    axis: snap.axis,
    z: resolvedFloor,
    rotation: state.ghostRotation,  // rotation fantôme courante (touche R)
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
// SÉLECTION
// ============================================================
function select(mesh) {
  if (state.selectedItemId === mesh.userData.itemId) return;
  deselect();
  state.selectedItemId = mesh.userData.itemId;
  if (mesh.userData.edges) {
    mesh.userData.edges.material.color.setHex(COLOR_SELECT);
    mesh.userData.edges.material.opacity = 1;
  }
  updateSelectedPanel(mesh);
}
function deselect() {
  if (!state.selectedItemId) return;
  const mesh = placedMeshes.get(state.selectedItemId);
  if (mesh && mesh.userData.edges) {
    mesh.userData.edges.material.color.setHex(0x000000);
    mesh.userData.edges.material.opacity = 0.45;
  }
  state.selectedItemId = null;
  if (dom.noSelection)  dom.noSelection.style.display  = 'flex';
  if (dom.selectedInfo) dom.selectedInfo.style.display = 'none';
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
  if (dom.selIcon) {
    dom.selIcon.style.background = facCss(piece.faction_id, 0.3);
    dom.selIcon.style.border     = '1px solid ' + facCss(piece.faction_id, 0.6);
    dom.selIcon.textContent      = fmtDimsLabel(piece.dimensions || {});
  }
  if (dom.deleteBtn) dom.deleteBtn.onclick = () => removeItem(item.id);
  if (dom.rotCw)     dom.rotCw.onclick  = () => rotateSelected(+90);
  if (dom.rotCcw)    dom.rotCcw.onclick = () => rotateSelected(-90);
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
}

// ============================================================
// SIDEBAR
// ============================================================

/** Formate un nom de groupe (ex: "Wall_Round_Corner" → "Mur arrondi") en français. */
function fmtGroupLabel(group) {
  const MAP = {
    Foundation: 'Fondation', Foundation_Wedge: 'Fond. triangulaire', Foundation_Round_Corner: 'Fond. arrondie',
    Wall: 'Mur', Wall_Half: 'Demi-mur', Wall_Protuding: 'Mur saillant',
    Wall_Round_Corner: 'Mur arrondi', Wall_Round_Corner_Half: 'Demi-mur arrondi',
    Wall_Round_Corner_Sideless: 'Mur arrondi ouvert',
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
  };
  return MAP[group] || group.replace(/_/g, ' ');
}

function createPieceEl(p) {
  const colorBg = facCss(p.faction_id, 0.30);
  const colorBd = facCss(p.faction_id, 0.55);
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

  // Click-to-place : single-click active la pièce, re-click désactive
  el.addEventListener('click', (ev) => {
    ev.stopPropagation();
    setActivePiece(state.activePieceId === p.id ? null : p.id);
  });
  return el;
}

function renderSidebar() {
  const source = state.activeTab === 'pieces' ? state.pieces : state.placeables;
  const q = state.searchQuery.toLowerCase();
  const filtered = source.filter(p => {
    if (state.activeTab === 'pieces') {
      if (state.activeFaction  && p.faction_id !== state.activeFaction)  return false;
      if (state.activeCategory && p.category   !== state.activeCategory) return false;
    }
    if (q) {
      const label = (p.label_fr || '').toLowerCase();
      const id    = (p.id || '').toLowerCase();
      if (!label.includes(q) && !id.includes(q)) return false;
    }
    return true;
  });
  const toShow = filtered.slice(0, 200);
  if (!dom.pieceList) return;
  dom.pieceList.innerHTML = '';

  // Sous-catégories (groupes) : uniquement si un filtre catégorie est actif
  //   ET qu'il y a plus d'un groupe distinct, ET pas de recherche en cours
  const useGroups = state.activeCategory && !q &&
    new Set(toShow.map(p => p.group)).size > 1;

  if (useGroups) {
    // Regroupe par group (ordre de menu_order naturel conservé)
    const byGroup = new Map();
    for (const p of toShow) {
      if (!byGroup.has(p.group)) byGroup.set(p.group, []);
      byGroup.get(p.group).push(p);
    }
    for (const [group, pieces] of byGroup) {
      // En-tête de sous-catégorie
      const header = document.createElement('div');
      header.className = 'bp-group-header';
      header.textContent = fmtGroupLabel(group);
      dom.pieceList.appendChild(header);
      // Grille pour ce groupe
      const grid = document.createElement('div');
      grid.className = 'bp-group-grid';
      for (const p of pieces) grid.appendChild(createPieceEl(p));
      dom.pieceList.appendChild(grid);
    }
  } else {
    for (const p of toShow) dom.pieceList.appendChild(createPieceEl(p));
  }

  const total = filtered.length, src = source.length;
  setText(dom.pieceCount, (total === src)
    ? src + ' pièces'
    : toShow.length + ' / ' + total + ' affichées (filtrés sur ' + src + ')');
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
function facCss(id, alpha) {
  const c = FACTION_COLORS[id] ?? 0x666666;
  const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

// ============================================================
// FILTRES / TOOLBAR / FLOORS / KEYBOARD / RESIZE
// ============================================================
function initFilters() {
  document.getElementById('tab-pieces')?.addEventListener('click', () => { state.activeTab = 'pieces'; renderSidebar(); });
  document.getElementById('tab-placeables')?.addEventListener('click', () => { state.activeTab = 'placeables'; renderSidebar(); });
  document.querySelectorAll('.bp-faction-pill').forEach(pill => {
    pill.addEventListener('click', () => { state.activeFaction = pill.dataset.faction || ''; renderSidebar(); });
  });
  document.getElementById('bp-category-select')?.addEventListener('change', (e) => { state.activeCategory = e.target.value; renderSidebar(); });
  document.getElementById('bp-search-input')?.addEventListener('input', (e) => { state.searchQuery = e.target.value; renderSidebar(); });
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

    // Escape — annule le mode click-to-place ou désélectionne
    if (e.key === 'Escape') {
      if (state.activePieceId) { setActivePiece(null); return; }
      if (state.selectedItemId) { deselect(); return; }
    }

    // R — rotation : fantôme pendant drag/click-to-place, pièce sélectionnée, sinon reset vue
    if (e.key === 'r' || e.key === 'R') {
      if (state.dragPieceId || state.activePieceId) {
        // +90° sur la rotation fantôme puis re-render immédiat du ghost
        state.ghostRotation = (state.ghostRotation + 90) % 360;
        if (lastGhostState) {
          const { piece, snap, resolvedFloor, allowed } = lastGhostState;
          clearGhost();
          lastGhostState = { piece, snap, resolvedFloor, allowed };
          showGhost(piece, snap, resolvedFloor, allowed);
          showFloorResolveHud(resolvedFloor);
        }
        return;
      }
      if (state.selectedItemId) { rotateSelected(+90); return; }
      resetView(); // fallback : reset caméra si rien de sélectionné
      return;
    }

    if ((e.key === 'Delete' || e.key === 'Backspace') && state.selectedItemId) removeItem(state.selectedItemId);
    if (e.key === 'v' || e.key === 'V') setCameraMode(state.cameraMode === 'ortho' ? 'persp' : 'ortho');
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
    const piece = state.piecesById.get(state.dragPieceId);
    if (!piece) return;
    const world = screenToWorld(e.clientX, e.clientY);
    if (!world) return;
    const snap = snapForPiece(world, piece);
    if (!snap) return;
    const resolvedFloor = findBestPlacementFloor(piece, snap);
    const allowed = isPlacementAllowedOnFloor(piece, snap, resolvedFloor);
    // Mémorise l'état pour re-render immédiat lors d'un keydown R
    lastGhostState = { piece, snap, resolvedFloor, allowed };
    showGhost(piece, snap, resolvedFloor, allowed);
    showFloorResolveHud(resolvedFloor);
    setText(dom.hudCoords, formatSnapHud(snap));
  });

  el.addEventListener('drop', (e) => {
    e.preventDefault();
    if (!state.dragPieceId) { endDrag(); return; }
    const piece = state.piecesById.get(state.dragPieceId);
    if (!piece) { endDrag(); return; }
    const world = screenToWorld(e.clientX, e.clientY);
    if (!world) { endDrag(); return; }
    const snap = snapForPiece(world, piece);
    if (!snap) { endDrag(); return; }
    const resolvedFloor = findBestPlacementFloor(piece, snap);
    const dropRot = state.ghostRotation;   // capture avant endDrag()
    if (isPlacementAllowedOnFloor(piece, snap, resolvedFloor)) {
      // Transmet la rotation fantôme courante à l'item posé
      placePieceFromSnap(state.dragPieceId, snap, resolvedFloor, dropRot);
    }
    endDrag();
  });

  el.addEventListener('dragleave', () => endDrag());

  el.addEventListener('click', (e) => {
    // Mode click-to-place : pose la pièce, garde le mode actif pour pose multiple
    if (state.activePieceId) {
      tryPlacePieceAt(state.activePieceId, e.clientX, e.clientY);
      // Reactualise le ghost immédiatement (la pose peut avoir libéré la cellule au-dessus, etc.)
      tryShowGhostForPiece(state.activePieceId, e.clientX, e.clientY);
      return;
    }
    // Sinon : sélection d'une pièce posée
    const hit = raycastPlacedMeshes(e.clientX, e.clientY);
    if (hit) select(hit);
    else deselect();
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
        state.ghostRotation = (state.ghostRotation + delta + 360) % 360;
        if (lastGhostState) {
          const { piece, snap, resolvedFloor, allowed } = lastGhostState;
          clearGhost();
          lastGhostState = { piece, snap, resolvedFloor, allowed };
          showGhost(piece, snap, resolvedFloor, allowed);
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
  const maxS = vertExt * PER_VERT_DOWN;
  setText(dom.heightRange, (maxS > 0 ? 'S' + maxS + ' → ' : 'RDC → ') + 'N' + maxN);
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
/** Étage minimum autorisé (sous-sol). Retourne 0 si aucune extension. */
function getMinFloor() {
  return -(state.plan.claim.vertical_extensions * PER_VERT_DOWN);
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
// BOUCLE DE RENDU
// ============================================================
function animate() {
  requestAnimationFrame(animate);
  if (orbitControls.enabled) orbitControls.update();
  renderer.render(scene, activeCam);
}
