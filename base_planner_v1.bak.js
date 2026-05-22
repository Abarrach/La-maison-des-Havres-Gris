'use strict';
// ============================================================
// base_planner.js — Constructeur de base Dune Awakening
// Étape 2 : drag & drop minimal (Konva.js)
// ============================================================

// ---- CONSTANTES ----
const CELL_SIZE   = 40;   // px par cellule de grille
const BLOCK_CELLS = 10;   // cellules par bloc de claim

const FACTION_COLORS = {
  choam_shelter: '#3a6fa8',
  choam:         '#2d5a9e',
  choam_lvl2:    '#1d3d7a',
  atreides:      '#2d6b2d',
  harkonnen:     '#8b1a1a',
  smugglers:     '#7a6b2d',
  watershippers: '#1a6b7a',
  extra:         '#5c3a7a',
  blockout:      '#444444',
};

const FACTION_COLORS_ALPHA = {
  choam_shelter: 'rgba(58,111,168,0.35)',
  choam:         'rgba(45,90,158,0.35)',
  choam_lvl2:    'rgba(29,61,122,0.35)',
  atreides:      'rgba(45,107,45,0.35)',
  harkonnen:     'rgba(139,26,26,0.35)',
  smugglers:     'rgba(122,107,45,0.35)',
  watershippers: 'rgba(26,107,122,0.35)',
  extra:         'rgba(92,58,122,0.35)',
  blockout:      'rgba(68,68,68,0.35)',
};

// ---- ÉTAT GLOBAL ----
const state = {
  plan: {
    id: null,
    name: 'Nouveau plan',
    owner: localStorage.getItem('user') || '—',
    claim: {
      blocks: [{ gx: 0, gy: 0 }],
      vertical_extensions: 0,
    },
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
  dragPieceId:    null,
  activeTool:     'select',  // 'select' | 'pan'
  pieces:         [],
  placeables:     [],
  activeFaction:  '',
  activeCategory: '',
  searchQuery:    '',
  activeTab:      'pieces',
};

// ---- KONVA ----
let stage, gridLayer, itemsLayer, ghostLayer;
let isPanning    = false;
let lastPanPos   = null;

// ---- CACHE DOM (éléments utilisés dans les handlers chauds ou répétés) ----
let elHudCoords    = null;
let elHudZoom      = null;
let elZoomReset    = null;
let elItemCount    = null;
let elPieceCount   = null;
let elPlanName     = null;
let elPlanOwner    = null;
let elClaimBlocks  = null;
let elVertExt      = null;
let elHeightRange  = null;

/** Résout tous les éléments DOM une seule fois, après DOMContentLoaded */
function cacheDomRefs() {
  elHudCoords   = document.getElementById('bp-hud-coords');
  elHudZoom     = document.getElementById('bp-hud-zoom');
  elZoomReset   = document.getElementById('tool-zoom-reset');
  elItemCount   = document.getElementById('bp-item-count');
  elPieceCount  = document.getElementById('bp-piece-count');
  elPlanName    = document.getElementById('bp-plan-name');
  elPlanOwner   = document.getElementById('bp-plan-owner');
  elClaimBlocks = document.getElementById('bp-claim-blocks');
  elVertExt     = document.getElementById('bp-vert-ext-count');
  elHeightRange = document.getElementById('bp-height-range');
}

/** Setter null-safe pour textContent */
function setText(el, val) { if (el) el.textContent = val; }

// ============================================================
// INITIALISATION
// ============================================================
document.addEventListener('DOMContentLoaded', function () {
  loadData().then(function () {
    // requestAnimationFrame garantit que le layout flex est calculé avant initStage()
    requestAnimationFrame(function () {
      try {
        cacheDomRefs();
        initStage();
        renderSidebar();
        initFilters();
        initFloorTabs();
        initToolbar();
        initModalSave();
        drawGrid();
        updatePlanPanel();
      } catch (err) {
        console.error('[base_planner] Erreur initialisation :', err);
      }
    });
  });
});

// ============================================================
// CHARGEMENT DES DONNÉES
// ============================================================
function loadData() {
  return Promise.all([
    fetch('base_pieces_data.json').then(function (r) { return r.json(); }),
    fetch('base_placeables_data.json').then(function (r) { return r.json(); }),
  ]).then(function (results) {
    var piecesData     = results[0];
    var placeablesData = results[1];
    // Exclure le set blockout (debug)
    state.pieces     = piecesData.pieces.filter(function (p) { return p.faction_id !== 'blockout'; });
    state.placeables = placeablesData.placeables;
  }).catch(function (err) {
    console.error('Erreur chargement JSON :', err);
    setText(elPieceCount, 'Erreur de chargement');
  });
}

// ============================================================
// SIDEBAR — RENDU
// ============================================================
function renderSidebar() {
  var list   = document.getElementById('bp-piece-list');
  var source = state.activeTab === 'pieces' ? state.pieces : state.placeables;
  var query  = state.searchQuery.toLowerCase();

  var filtered = source.filter(function (p) {
    if (state.activeTab === 'pieces') {
      if (state.activeFaction  && p.faction_id !== state.activeFaction)  return false;
      if (state.activeCategory && p.category   !== state.activeCategory) return false;
    }
    if (query) {
      var label = (p.label_fr || '').toLowerCase();
      var id    = (p.id || '').toLowerCase();
      if (!label.includes(query) && !id.includes(query)) return false;
    }
    return true;
  });

  // Limiter à 200 items pour les perfs du DOM
  var toShow = filtered.slice(0, 200);

  list.innerHTML = '';
  toShow.forEach(function (p) {
    var color  = FACTION_COLORS[p.faction_id]       || '#555555';
    var colorA = FACTION_COLORS_ALPHA[p.faction_id] || 'rgba(80,80,80,0.3)';

    var el = document.createElement('div');
    el.className = 'bp-piece-item';
    el.draggable = true;
    el.dataset.pieceId = p.id;
    el.innerHTML =
      '<div class="bp-piece-icon" style="background:' + colorA + ';border:1px solid ' + color + '80;">'
        + fmtDims(p.dimensions || {})
      + '</div>'
      + '<div class="bp-piece-label">' + (p.label_fr || p.id) + '</div>';

    el.addEventListener('dragstart', function (e) {
      state.dragPieceId = p.id;
      e.dataTransfer.effectAllowed = 'copy';
      e.dataTransfer.setData('text/plain', p.id);
    });
    el.addEventListener('dragend', function () {
      clearGhost();
      state.dragPieceId = null;
    });
    list.appendChild(el);
  });

  var shown = toShow.length;
  var total = filtered.length;
  var src   = source.length;
  setText(elPieceCount,
    (total === src)
      ? src + ' pièces'
      : shown + ' / ' + total + ' affichées (filtrés sur ' + src + ')');
}

function fmtDims(d) {
  if (!d || d.d === 0) {
    return d && d.w > 1 ? d.w + '×H' : '│';
  }
  var w = d.w || 1;
  var depth = d.d || 1;
  if (d.shape === 'triangle') return '◤';
  if (d.shape === 'corner')   return '◜';
  if (d.shape === 'pillar')   return '◉';
  if (w === 1 && depth === 1) return '■';
  return w + '×' + depth;
}

// ============================================================
// FILTRES
// ============================================================
function initFilters() {
  document.getElementById('tab-pieces').addEventListener('click', function () {
    state.activeTab = 'pieces';
    document.getElementById('tab-pieces').classList.add('active');
    document.getElementById('tab-placeables').classList.remove('active');
    renderSidebar();
  });
  document.getElementById('tab-placeables').addEventListener('click', function () {
    state.activeTab = 'placeables';
    document.getElementById('tab-placeables').classList.add('active');
    document.getElementById('tab-pieces').classList.remove('active');
    renderSidebar();
  });

  document.querySelectorAll('.bp-faction-pill').forEach(function (pill) {
    pill.addEventListener('click', function () {
      document.querySelectorAll('.bp-faction-pill').forEach(function (p) { p.classList.remove('active'); });
      pill.classList.add('active');
      state.activeFaction = pill.dataset.faction || '';
      renderSidebar();
    });
  });

  document.getElementById('bp-category-select').addEventListener('change', function () {
    state.activeCategory = this.value;
    renderSidebar();
  });

  document.getElementById('bp-search-input').addEventListener('input', function () {
    state.searchQuery = this.value;
    renderSidebar();
  });
}

// ============================================================
// KONVA — INIT STAGE
// ============================================================
function initStage() {
  var container = document.getElementById('bp-stage-container');
  var w = container.clientWidth;
  var h = container.clientHeight;

  stage = new Konva.Stage({ container: 'bp-stage-container', width: w, height: h });

  gridLayer  = new Konva.Layer({ listening: false });
  itemsLayer = new Konva.Layer();
  ghostLayer = new Konva.Layer({ listening: false });

  stage.add(gridLayer);
  stage.add(itemsLayer);
  stage.add(ghostLayer);

  // Centrer sur le claim initial (1 bloc 10×10)
  var bw = BLOCK_CELLS * CELL_SIZE;
  stage.position({ x: Math.round((w - bw) / 2), y: Math.round((h - bw) / 2) });

  // Masquer le hint (null-check : le HTML déployé peut être antérieur)
  var hintEl = document.getElementById('bp-canvas-hint');
  if (hintEl) hintEl.style.display = 'none';

  // Zoom molette
  stage.on('wheel', function (e) {
    e.evt.preventDefault();
    var scaleBy  = 1.12;
    var oldScale = stage.scaleX();
    var ptr      = stage.getPointerPosition();
    var newScale = e.evt.deltaY < 0 ? oldScale * scaleBy : oldScale / scaleBy;
    newScale = Math.min(5, Math.max(0.2, newScale));

    var ptTo = { x: (ptr.x - stage.x()) / oldScale, y: (ptr.y - stage.y()) / oldScale };
    stage.scale({ x: newScale, y: newScale });
    stage.position({ x: ptr.x - ptTo.x * newScale, y: ptr.y - ptTo.y * newScale });
    updateHUDZoom(newScale);
  });

  // Pan clic milieu (toujours) ou clic gauche si outil Pan
  stage.on('mousedown', function (e) {
    var isPanClick = e.evt.button === 1 || (e.evt.button === 0 && state.activeTool === 'pan');
    if (isPanClick) {
      isPanning  = true;
      lastPanPos = { x: e.evt.clientX, y: e.evt.clientY };
      stage.container().style.cursor = 'grabbing';
    }
  });
  stage.on('mousemove', function (e) {
    // HUD coordonnées
    var pos = stage.getPointerPosition();
    if (pos) {
      var world = screenToWorld(pos.x, pos.y);
      var cx = Math.floor(world.x / CELL_SIZE);
      var cy = Math.floor(world.y / CELL_SIZE);
      setText(elHudCoords, 'x:' + cx + ' y:' + cy);
    }
    // Pan
    if (!isPanning) return;
    var dx = e.evt.clientX - lastPanPos.x;
    var dy = e.evt.clientY - lastPanPos.y;
    stage.position({ x: stage.x() + dx, y: stage.y() + dy });
    lastPanPos = { x: e.evt.clientX, y: e.evt.clientY };
  });
  stage.on('mouseup', function (e) {
    if (isPanning) {
      isPanning = false;
      stage.container().style.cursor = state.activeTool === 'pan' ? 'grab' : 'crosshair';
    }
  });

  // Clic vide → désélection
  stage.on('click', function (e) {
    if (e.target === stage) deselectItem();
  });

  // Drag & drop depuis la sidebar
  var cont = document.getElementById('bp-stage-container');
  cont.addEventListener('dragover', function (e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (!state.dragPieceId) return;
    var rect    = cont.getBoundingClientRect();
    var snapped = snapPos(e.clientX - rect.left, e.clientY - rect.top, state.dragPieceId);
    drawGhost(snapped, state.dragPieceId);
  });
  cont.addEventListener('drop', function (e) {
    e.preventDefault();
    if (!state.dragPieceId) return;
    var rect    = cont.getBoundingClientRect();
    var snapped = snapPos(e.clientX - rect.left, e.clientY - rect.top, state.dragPieceId);
    placePiece(state.dragPieceId, snapped.cx, snapped.cy, 0);
    clearGhost();
    state.dragPieceId = null;
  });
  cont.addEventListener('dragleave', clearGhost);

  // Suppr = supprimer sélection
  document.addEventListener('keydown', function (e) {
    if ((e.key === 'Delete' || e.key === 'Backspace') && state.selectedItemId) {
      // Ne pas interférer avec les champs texte
      if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') return;
      deleteSelected();
    }
    // R = recentrer
    if (e.key === 'r' || e.key === 'R') { resetView(); }
  });

  // Resize fenêtre
  window.addEventListener('resize', function () {
    stage.size({ width: container.clientWidth, height: container.clientHeight });
    drawGrid();
  });

  updateHUDZoom(1);
}

// ============================================================
// GRILLE
// ============================================================
function drawGrid() {
  gridLayer.destroyChildren();

  // Grand fond noir opaque derrière tout (contraste net avec les blocs de claim)
  var bigSize = 400 * CELL_SIZE;
  gridLayer.add(new Konva.Rect({
    x: -bigSize / 2, y: -bigSize / 2,
    width: bigSize, height: bigSize,
    fill: '#050301',
    listening: false,
  }));

  // Lignes de grille légères en dehors du claim (zone étendue)
  var ext = 5; // cellules supplémentaires autour
  var totalBlocks = state.plan.claim.blocks;
  var minX = 0, minY = 0, maxX = BLOCK_CELLS, maxY = BLOCK_CELLS;
  totalBlocks.forEach(function (b) {
    minX = Math.min(minX, b.gx * BLOCK_CELLS);
    minY = Math.min(minY, b.gy * BLOCK_CELLS);
    maxX = Math.max(maxX, (b.gx + 1) * BLOCK_CELLS);
    maxY = Math.max(maxY, (b.gy + 1) * BLOCK_CELLS);
  });
  for (var i = minX - ext; i <= maxX + ext; i++) {
    gridLayer.add(new Konva.Line({
      points: [(i) * CELL_SIZE, (minY - ext) * CELL_SIZE, (i) * CELL_SIZE, (maxY + ext) * CELL_SIZE],
      stroke: 'rgba(45,28,10,0.45)', strokeWidth: 0.5, listening: false,
    }));
  }
  for (var j = minY - ext; j <= maxY + ext; j++) {
    gridLayer.add(new Konva.Line({
      points: [(minX - ext) * CELL_SIZE, j * CELL_SIZE, (maxX + ext) * CELL_SIZE, j * CELL_SIZE],
      stroke: 'rgba(45,28,10,0.45)', strokeWidth: 0.5, listening: false,
    }));
  }

  // Blocs de claim
  state.plan.claim.blocks.forEach(function (b) { drawClaimBlock(b.gx, b.gy); });

  gridLayer.batchDraw();
}

function drawClaimBlock(bx, by) {
  var ox = bx * BLOCK_CELLS * CELL_SIZE;
  var oy = by * BLOCK_CELLS * CELL_SIZE;
  var bw = BLOCK_CELLS * CELL_SIZE;

  // Fond du bloc — nettement plus chaud que le fond noir
  gridLayer.add(new Konva.Rect({
    x: ox, y: oy, width: bw, height: bw,
    fill: '#2a1a08', listening: false,
  }));

  // Lignes de grille internes
  for (var i = 0; i <= BLOCK_CELLS; i++) {
    var isMajor = (i === 0 || i === BLOCK_CELLS);
    var clr   = isMajor ? 'rgba(120,80,25,0.9)' : 'rgba(75,48,16,0.65)';
    var sw    = isMajor ? 1.5 : 0.5;
    gridLayer.add(new Konva.Line({
      points: [ox + i * CELL_SIZE, oy, ox + i * CELL_SIZE, oy + bw],
      stroke: clr, strokeWidth: sw, listening: false,
    }));
    gridLayer.add(new Konva.Line({
      points: [ox, oy + i * CELL_SIZE, ox + bw, oy + i * CELL_SIZE],
      stroke: clr, strokeWidth: sw, listening: false,
    }));
  }

  // Bordure dorée
  gridLayer.add(new Konva.Rect({
    x: ox, y: oy, width: bw, height: bw,
    stroke: '#cda434', strokeWidth: 3, fill: 'transparent', cornerRadius: 2,
    listening: false,
  }));

  // Étiquette coin haut-gauche
  var isMain = (bx === 0 && by === 0);
  gridLayer.add(new Konva.Text({
    x: ox + 5, y: oy + 5,
    text: isMain ? '⚑ 10×10' : '+ 10×10',
    fontSize: 9,
    fill: isMain ? '#cda434' : '#7a5c2e',
    listening: false,
  }));
}

// ============================================================
// SNAP & PLACEMENT
// ============================================================
function snapPos(sx, sy, pieceId) {
  var world  = screenToWorld(sx, sy);
  var piece  = getPiece(pieceId);
  var isWall = piece && piece.dimensions && piece.dimensions.d === 0;

  if (isWall) {
    // Mur : snap sur le bord de la cellule (en X ou Y selon l'orientation naturelle)
    // Rotation par défaut = 0 → mur horizontal sur le bord haut de la cellule
    var cx = Math.floor(world.x / CELL_SIZE);
    var cy = Math.round(world.y / CELL_SIZE);  // snapper sur le bord entre cy-1 et cy
    return { cx: cx, cy: cy, isWall: true };
  } else {
    // Pièce pleine → snap sur le coin haut-gauche de la cellule
    return {
      cx: Math.floor(world.x / CELL_SIZE),
      cy: Math.floor(world.y / CELL_SIZE),
      isWall: false,
    };
  }
}

function placePiece(pieceId, cx, cy, rotation) {
  var floor = getFloor(state.currentFloor);
  if (!floor) return;

  var itemId = 'item_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  var item   = { id: itemId, piece_id: pieceId, x: cx, y: cy, rotation: rotation };
  floor.items.push(item);

  renderPiece(item);
  updatePieceCount();
}

function renderPiece(item) {
  var piece  = getPiece(item.piece_id);
  if (!piece) return;

  var color  = FACTION_COLORS[piece.faction_id]       || '#555555';
  var colorA = FACTION_COLORS_ALPHA[piece.faction_id] || 'rgba(80,80,80,0.3)';
  var dim    = piece.dimensions || { w: 1, d: 1, h: 1, shape: 'square' };
  var isWall = (dim.d === 0);

  var pw = (dim.w || 1) * CELL_SIZE;
  var ph = isWall ? Math.round(CELL_SIZE * 0.16) : (dim.d || 1) * CELL_SIZE;

  // Position monde
  var wx = item.x * CELL_SIZE;
  // Murs : l'ancrage est sur le bord entre cy-1 et cy, centré verticalement sur ce bord
  var wy = isWall
    ? item.y * CELL_SIZE - Math.round(CELL_SIZE * 0.08)
    : item.y * CELL_SIZE;

  var group = new Konva.Group({
    id: item.id,
    x: wx,
    y: wy,
    rotation: item.rotation,
    // Pour les rotations : offset = coin haut-gauche de la pièce
  });

  var rect = new Konva.Rect({
    width: pw, height: ph,
    fill: colorA,
    stroke: color,
    strokeWidth: isWall ? 1.5 : 1,
    cornerRadius: 2,
  });
  group.add(rect);

  // Texte (uniquement si assez grand)
  if (!isWall && CELL_SIZE >= 28 && pw >= 28 && ph >= 20) {
    group.add(new Konva.Text({
      width: pw, height: ph,
      text: (piece.label_fr || '').substring(0, 10),
      fontSize: 8,
      fill: 'rgba(255,255,255,0.45)',
      align: 'center',
      verticalAlign: 'middle',
      listening: false,
    }));
  }

  // Interactions
  group.on('click tap', function (e) {
    e.cancelBubble = true;
    selectItem(item.id, item, piece);
  });
  group.on('mouseenter', function () {
    if (state.activeTool === 'select') {
      rect.stroke('#f3c44f');
      itemsLayer.batchDraw();
      stage.container().style.cursor = 'pointer';
    }
  });
  group.on('mouseleave', function () {
    var sel = (state.selectedItemId === item.id);
    rect.stroke(sel ? '#ffffff' : color);
    itemsLayer.batchDraw();
    stage.container().style.cursor = state.activeTool === 'pan' ? 'grab' : 'crosshair';
  });

  itemsLayer.add(group);
  itemsLayer.batchDraw();
}

// ============================================================
// GHOST (aperçu drag)
// ============================================================
function drawGhost(snapped, pieceId) {
  ghostLayer.destroyChildren();
  var piece  = getPiece(pieceId);
  if (!piece) return;

  var color  = FACTION_COLORS[piece.faction_id] || '#cda434';
  var dim    = piece.dimensions || { w: 1, d: 1 };
  var isWall = (dim.d === 0);

  var pw = (dim.w || 1) * CELL_SIZE;
  var ph = isWall ? Math.round(CELL_SIZE * 0.16) : (dim.d || 1) * CELL_SIZE;
  var wx = snapped.cx * CELL_SIZE;
  var wy = isWall ? snapped.cy * CELL_SIZE - Math.round(CELL_SIZE * 0.08) : snapped.cy * CELL_SIZE;

  // Highlight cellule cible
  ghostLayer.add(new Konva.Rect({
    x: snapped.cx * CELL_SIZE,
    y: isWall ? (snapped.cy - 1) * CELL_SIZE : snapped.cy * CELL_SIZE,
    width: CELL_SIZE, height: CELL_SIZE,
    fill: 'rgba(205,164,52,0.06)',
    stroke: 'rgba(205,164,52,0.25)',
    strokeWidth: 1,
  }));

  // Ghost piece
  ghostLayer.add(new Konva.Rect({
    x: wx, y: wy, width: pw, height: ph,
    fill: color + '30',
    stroke: color,
    strokeWidth: 1.5,
    dash: [4, 3],
    cornerRadius: 2,
    opacity: 0.8,
  }));

  ghostLayer.batchDraw();
}

function clearGhost() {
  ghostLayer.destroyChildren();
  ghostLayer.batchDraw();
}

// ============================================================
// SÉLECTION
// ============================================================
function selectItem(itemId, item, piece) {
  // Désélectionner l'ancien
  if (state.selectedItemId && state.selectedItemId !== itemId) {
    var prevGroup = itemsLayer.findOne('#' + state.selectedItemId);
    if (prevGroup) {
      var prevItem  = findItemById(state.selectedItemId);
      var prevPiece = prevItem ? getPiece(prevItem.piece_id) : null;
      var prevColor = prevPiece ? (FACTION_COLORS[prevPiece.faction_id] || '#555') : '#555';
      var prevRect  = prevGroup.findOne('Rect');
      if (prevRect) { prevRect.stroke(prevColor); }
      itemsLayer.batchDraw();
    }
  }

  state.selectedItemId = itemId;

  // Surbrillance blanc
  var grp = itemsLayer.findOne('#' + itemId);
  if (grp) {
    var r = grp.findOne('Rect');
    if (r) { r.stroke('#ffffff'); itemsLayer.batchDraw(); }
  }

  // Panel droit
  document.getElementById('bp-no-selection').style.display  = 'none';
  document.getElementById('bp-selected-info').style.display = 'flex';

  var dim = piece.dimensions || { w: 1, d: 0, h: 1 };
  document.getElementById('bp-sel-name').textContent     = piece.label_fr || piece.id;
  document.getElementById('bp-sel-w').textContent        = dim.w || 1;
  document.getElementById('bp-sel-d').textContent        = dim.d || 0;
  document.getElementById('bp-sel-h').textContent        = dim.h || 0;
  document.getElementById('bp-sel-rotation').textContent = (item.rotation || 0) + '°';

  var iconEl = document.getElementById('bp-sel-icon');
  iconEl.style.background = FACTION_COLORS_ALPHA[piece.faction_id] || 'rgba(80,80,80,0.3)';
  iconEl.style.border     = '1px solid ' + (FACTION_COLORS[piece.faction_id] || '#555') + '88';
  iconEl.textContent      = fmtDims(dim);

  // Boutons delete & rotation
  document.getElementById('bp-delete-btn').onclick = function () { deleteSelected(); };
  document.getElementById('bp-rot-cw').onclick      = function () { rotateSelected(+90, item, piece); };
  document.getElementById('bp-rot-ccw').onclick     = function () { rotateSelected(-90, item, piece); };
}

function deselectItem() {
  if (state.selectedItemId) {
    var prevGroup = itemsLayer.findOne('#' + state.selectedItemId);
    if (prevGroup) {
      var prevItem  = findItemById(state.selectedItemId);
      var prevPiece = prevItem ? getPiece(prevItem.piece_id) : null;
      var prevColor = prevPiece ? (FACTION_COLORS[prevPiece.faction_id] || '#555') : '#555';
      var prevRect  = prevGroup.findOne('Rect');
      if (prevRect) { prevRect.stroke(prevColor); itemsLayer.batchDraw(); }
    }
  }
  state.selectedItemId = null;
  document.getElementById('bp-no-selection').style.display  = 'flex';
  document.getElementById('bp-selected-info').style.display = 'none';
}

function deleteSelected() {
  if (!state.selectedItemId) return;
  var grp = itemsLayer.findOne('#' + state.selectedItemId);
  if (grp) { grp.destroy(); itemsLayer.batchDraw(); }

  var floor = getFloor(state.currentFloor);
  if (floor) {
    floor.items = floor.items.filter(function (i) { return i.id !== state.selectedItemId; });
  }
  deselectItem();
  updatePieceCount();
}

function rotateSelected(delta, item, piece) {
  item.rotation = ((item.rotation || 0) + delta + 360) % 360;
  document.getElementById('bp-sel-rotation').textContent = item.rotation + '°';
  var grp = itemsLayer.findOne('#' + item.id);
  if (grp) { grp.rotation(item.rotation); itemsLayer.batchDraw(); }
}

// ============================================================
// ONGLETS ÉTAGES
// ============================================================
function initFloorTabs() {
  document.querySelectorAll('.bp-floor-tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      document.querySelectorAll('.bp-floor-tab').forEach(function (t) { t.classList.remove('active'); });
      tab.classList.add('active');
      switchFloor(parseInt(tab.dataset.floor));
    });
  });
}

function switchFloor(z) {
  state.currentFloor = z;
  itemsLayer.destroyChildren();
  itemsLayer.batchDraw();

  var floor = getFloor(z);
  if (floor) {
    floor.items.forEach(function (item) { renderPiece(item); });
  }
  deselectItem();
  updatePieceCount();
}

// ============================================================
// TOOLBAR
// ============================================================
function initToolbar() {
  document.getElementById('tool-select').addEventListener('click', function () { setActiveTool('select'); });
  document.getElementById('tool-pan').addEventListener('click',    function () { setActiveTool('pan'); });

  document.getElementById('tool-zoom-in').addEventListener('click',    function () { zoomStage(1.25); });
  document.getElementById('tool-zoom-out').addEventListener('click',   function () { zoomStage(0.8); });
  document.getElementById('tool-zoom-reset').addEventListener('click', function () { resetView(); });

  document.getElementById('tool-undo').addEventListener('click', function () { /* TODO undo */ });
  document.getElementById('tool-redo').addEventListener('click', function () { /* TODO redo */ });

  document.getElementById('tool-grid').addEventListener('click', function () {
    this.classList.toggle('active');
    gridLayer.visible(!gridLayer.visible());
    gridLayer.batchDraw();
  });
  document.getElementById('tool-snap').addEventListener('click', function () {
    this.classList.toggle('active');  // TODO: gestion snap on/off
  });
}

function setActiveTool(tool) {
  state.activeTool = tool;
  document.querySelectorAll('.bp-toolbar .bp-tool-btn').forEach(function (b) { b.classList.remove('active'); });
  var el = document.getElementById('tool-' + tool);
  if (el) el.classList.add('active');
  stage.container().style.cursor = tool === 'pan' ? 'grab' : 'crosshair';
}

function zoomStage(factor) {
  var oldScale = stage.scaleX();
  var newScale = Math.min(5, Math.max(0.2, oldScale * factor));
  var cx = stage.width()  / 2;
  var cy = stage.height() / 2;
  var ptTo = { x: (cx - stage.x()) / oldScale, y: (cy - stage.y()) / oldScale };
  stage.scale({ x: newScale, y: newScale });
  stage.position({ x: cx - ptTo.x * newScale, y: cy - ptTo.y * newScale });
  updateHUDZoom(newScale);
}

function resetView() {
  var container = document.getElementById('bp-stage-container');
  stage.scale({ x: 1, y: 1 });
  var bw = BLOCK_CELLS * CELL_SIZE;
  stage.position({
    x: Math.round((container.clientWidth  - bw) / 2),
    y: Math.round((container.clientHeight - bw) / 2),
  });
  updateHUDZoom(1);
}

// ============================================================
// MODALE SAVE — bouton confirmer
// ============================================================
function initModalSave() {
  document.getElementById('save-confirm-btn').addEventListener('click', function () {
    var name = (document.getElementById('save-plan-name').value || '').trim();
    if (!name) { alert('Veuillez donner un nom au plan.'); return; }
    state.plan.name = name;
    document.getElementById('bp-plan-name').textContent = name;
    document.getElementById('modal-save').classList.remove('open');
    // TODO: appel API PHP (étape sauvegarde)
  });
}

// ============================================================
// PANEL DROIT — mise à jour infos plan
// ============================================================
function updatePlanPanel() {
  setText(elPlanName,  state.plan.name);
  setText(elPlanOwner, state.plan.owner);
  updatePieceCount();
  updateClaimPanel();
}

function updateClaimPanel() {
  var blocks  = state.plan.claim.blocks;
  var vertExt = state.plan.claim.vertical_extensions;

  setText(elClaimBlocks, blocks.length + ' / 6');
  setText(elVertExt,     vertExt + ' / 5');

  // Hauteur disponible
  var maxN = 6 + vertExt * 7;
  var maxS = vertExt > 0 ? vertExt * 5 : 0;
  var rangeStr = (maxS > 0 ? 'S' + maxS + ' → ' : 'RDC → ') + 'N' + maxN;
  setText(elHeightRange, rangeStr);

  // Pips verticaux
  for (var i = 0; i < 5; i++) {
    var pip = document.getElementById('vp' + i);
    if (pip) pip.classList.toggle('active', i < vertExt);
  }

  // Visualiseur de forme (mini-grille 6 cellules linéaires pour l'instant)
  // (une visualisation plus riche nécessite de connaître la 2D de la forme)
  var grid = document.getElementById('bp-claim-viz-grid');
  if (grid) {
    var cells = grid.querySelectorAll('.bp-claim-viz-cell');
    cells.forEach(function (cell, idx) {
      cell.className = 'bp-claim-viz-cell';
      if (idx === 0) {
        cell.classList.add('main');
      } else if (idx < blocks.length) {
        cell.classList.add('ext');
      } else {
        cell.classList.add('available');
      }
    });
  }
}

// ============================================================
// HELPERS
// ============================================================
function screenToWorld(sx, sy) {
  return {
    x: (sx - stage.x()) / stage.scaleX(),
    y: (sy - stage.y()) / stage.scaleY(),
  };
}

function getPiece(id) {
  return state.pieces.find(function (p) { return p.id === id; })
      || state.placeables.find(function (p) { return p.id === id; })
      || null;
}

function getFloor(z) {
  return state.plan.floors.find(function (f) { return f.z === z; }) || null;
}

function findItemById(id) {
  for (var fi = 0; fi < state.plan.floors.length; fi++) {
    var items = state.plan.floors[fi].items;
    for (var ii = 0; ii < items.length; ii++) {
      if (items[ii].id === id) return items[ii];
    }
  }
  return null;
}

function updatePieceCount() {
  var floor = getFloor(state.currentFloor);
  setText(elItemCount, floor ? floor.items.length : 0);
}

function updateHUDZoom(scale) {
  var pct = Math.round(scale * 100);
  setText(elHudZoom,   pct + '%');
  setText(elZoomReset, pct + '%');
}
