'use strict';
// ============================================================
// proto_atreides.js — PROTOTYPE de validation (Atréides).
// Utilise les modules réutilisables :
//   planner_socket_engine.js  (accrochage par sockets, sans Three)
//   planner_mesh.js           (vrais meshes .glb + matériau argile)
// ============================================================
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createEngine, q } from './planner_socket_engine.js';
import { createMeshFactory, MESH_TUNE } from './planner_mesh.js';

const SCALE = 0.01;                              // cm → mètres (rendu)

// ============================================================
// DONNÉES + MOTEUR
// ============================================================
const byId = new Map();
let pieces = [];
let placed = [];                                 // {id, building_type, x, y, z, rotation} en cm
let nextId = 1;

const getPiece = t => byId.get(t);
const engine = createEngine(getPiece);
const meshFx = createMeshFactory({ getPiece, modelsBase: 'models/', scale: SCALE });

let manualRot = 0;
function computeSnap(type, cur) {
  const r = engine.snapPiece(cur, type, placed, engine.occSet(placed));
  if (r) return { ...r, snapped: true };
  return { pos: engine.gridSnap(cur.x, cur.y, cur.z), rotation: manualRot, snapped: false };
}

// ============================================================
// RENDU
// ============================================================
function applyTransform(g, p) {
  g.position.set(p.x * SCALE, p.z * SCALE, p.y * SCALE);
  g.rotation.y = (p.rotation || 0) * Math.PI / 180;
}

// ============================================================
// SCÈNE
// ============================================================
const stage = document.getElementById('stage');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0d0805);
scene.fog = new THREE.Fog(0x0d0805, 40, 120);

const camera = new THREE.PerspectiveCamera(55, stage.clientWidth / stage.clientHeight, 0.1, 1000);
camera.position.set(14, 12, 16);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(stage.clientWidth, stage.clientHeight);
stage.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.dampingFactor = 0.1;
controls.mouseButtons = { MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
controls.target.set(0, 1, 0);

scene.add(new THREE.HemisphereLight(0xfff0d8, 0x20140a, 1.1));
const dir = new THREE.DirectionalLight(0xffe9c4, 1.4); dir.position.set(8, 16, 6); scene.add(dir);

const tile = 512 * SCALE;
const grid = new THREE.GridHelper(tile * 16, 16, 0x78501a, 0x4b3010);
grid.position.y = 0.002; scene.add(grid);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(tile * 16, tile * 16),
  new THREE.MeshStandardMaterial({ color: 0x150d06, roughness: 1 }));
ground.rotation.x = -Math.PI / 2; scene.add(ground);

const placedGroup = new THREE.Group(); scene.add(placedGroup);
let ghost = null, selectedType = null;

const raycaster = new THREE.Raycaster();
const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const ndc = new THREE.Vector2();
function cursorUE(ev) {
  const r = renderer.domElement.getBoundingClientRect();
  ndc.x = ((ev.clientX - r.left) / r.width) * 2 - 1;
  ndc.y = -((ev.clientY - r.top) / r.height) * 2 + 1;
  raycaster.setFromCamera(ndc, camera);
  const hit = new THREE.Vector3();
  if (!raycaster.ray.intersectPlane(plane, hit)) return null;
  return { x: hit.x / SCALE, y: hit.z / SCALE, z: 0 };
}

const statusEl = document.getElementById('status');
function setStatus(snap) {
  if (!selectedType) { statusEl.textContent = 'Choisis une pièce…'; return; }
  const nm = byId.get(selectedType).name;
  if (!snap) { statusEl.innerHTML = `<b>${nm}</b>`; return; }
  const tag = snap.snapped ? `<span class="ok">● accroché (socket)</span>` : `<span class="grid">● grille libre</span>`;
  statusEl.innerHTML = `<b>${nm}</b> — ${tag} · rot ${Math.round(snap.rotation)}°`;
}

let lastSnap = null;
function updateGhost(ev) {
  if (!selectedType || !ghost) return;
  const cur = cursorUE(ev); if (!cur) return;
  const snap = computeSnap(selectedType, cur);
  lastSnap = snap;
  applyTransform(ghost, snap.pos);
  const col = snap.snapped ? 0xcda434 : 0x6a8f6a;
  ghost.traverse(o => { if (o.isMesh && o.material.color) o.material.color.setHex(col); });
  setStatus(snap);
}

function selectType(type) {
  selectedType = type;
  if (ghost) { scene.remove(ghost); ghost = null; }
  ghost = meshFx.buildObject(type, { color: 0xcda434, opacity: 0.5 });
  scene.add(ghost);
  document.querySelectorAll('.piece').forEach(el => el.classList.toggle('active', el.dataset.id === type));
  setStatus(null);
}
function cancelSelect() {
  selectedType = null;
  if (ghost) { scene.remove(ghost); ghost = null; }
  document.querySelectorAll('.piece').forEach(el => el.classList.remove('active'));
  setStatus(null);
}
function placeAt(snap) {
  const item = { id: nextId++, building_type: selectedType, x: snap.pos.x, y: snap.pos.y, z: snap.pos.z, rotation: snap.rotation };
  placed.push(item);
  const g = meshFx.buildObject(selectedType, { color: 0x3f7a3f, opacity: 1.0 });
  applyTransform(g, item);
  g.userData.id = item.id;
  placedGroup.add(g);
}

// ============================================================
// INTERACTION
// ============================================================
let downPos = null;
renderer.domElement.addEventListener('pointerdown', e => { if (e.button === 0) downPos = { x: e.clientX, y: e.clientY }; });
renderer.domElement.addEventListener('pointermove', updateGhost);
renderer.domElement.addEventListener('pointerup', e => {
  if (e.button !== 0 || !downPos) return;
  const moved = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
  downPos = null;
  if (moved > 4 || !selectedType || !lastSnap) return;
  placeAt(lastSnap);
});
renderer.domElement.addEventListener('contextmenu', e => e.preventDefault());
window.addEventListener('keydown', e => {
  if (e.key === 'r' || e.key === 'R') manualRot = q(manualRot + 90);
  else if (e.key === 'Escape') cancelSelect();
  else if (e.key === 'Delete' || e.key === 'Backspace') {
    placed = []; nextId = 1;
    while (placedGroup.children.length) placedGroup.remove(placedGroup.children[0]);
  }
});
window.addEventListener('resize', () => {
  camera.aspect = stage.clientWidth / stage.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(stage.clientWidth, stage.clientHeight);
});

// ============================================================
// UI PALETTE
// ============================================================
const CAT_ORDER = ['Foundation', 'Floor', 'Wall', 'Ramp', 'Rooftop', 'Pillar', 'Door', 'Decoration'];
let activeCat = 'Foundation';
function buildPalette() {
  const cats = [...new Set(pieces.map(p => p.category))].sort((a, b) => {
    const ia = CAT_ORDER.indexOf(a), ib = CAT_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  const catBar = document.getElementById('cats');
  catBar.innerHTML = '';
  for (const c of cats) {
    const el = document.createElement('div');
    el.className = 'cat' + (c === activeCat ? ' active' : '');
    el.textContent = c;
    el.onclick = () => { activeCat = c; buildPalette(); };
    catBar.appendChild(el);
  }
  renderList();
}
function renderList() {
  const list = document.getElementById('list'); list.innerHTML = '';
  for (const p of pieces.filter(p => p.category === activeCat)) {
    const el = document.createElement('div');
    el.className = 'piece'; el.dataset.id = p.templateId;
    el.innerHTML = `<span class="sw"></span><span class="nm">${p.name}<br><span class="sk">${p.sockets.length} sockets · ${p.socketProfile || '—'}</span></span>`;
    el.onclick = () => selectType(p.templateId);
    list.appendChild(el);
  }
}

// ============================================================
// BOOT
// ============================================================
(async function () {
  const all = await fetch('dune_pieces_sockets.json').then(r => r.json());
  pieces = all.filter(p => p.faction === 'Atreides');
  for (const p of pieces) byId.set(p.templateId, p);
  buildPalette();
  animate();
  window.__proto = {
    byId, engine, meshFx, MESH_TUNE, camera, controls, scene, THREE,
    get placed() { return placed; },
    reset() { placed = []; nextId = 1; while (placedGroup.children.length) placedGroup.remove(placedGroup.children[0]); },
    computeSnap,
    place(type, cur) { const s = computeSnap(type, cur); if (!s) return null;
      const it = { id: nextId++, building_type: type, x: s.pos.x, y: s.pos.y, z: s.pos.z, rotation: s.rotation };
      placed.push(it); const g = meshFx.buildObject(type, { color: 0x3f7a3f, opacity: 1 }); applyTransform(g, it); placedGroup.add(g);
      return { ...it, snapped: s.snapped }; },
    frame(tx, ty, tz, dist) { controls.target.set(tx, ty, tz);
      camera.position.set(tx + dist, ty + dist * 0.8, tz + dist); controls.update(); },
  };
})();

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
