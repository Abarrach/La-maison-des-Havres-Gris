#!/usr/bin/env node
'use strict';

/**
 * build_enriched_pieces.js
 *
 * Fusionne base_pieces_data.json (curé par Claude) avec les exports FModel
 * (DT_BuildingData_*.json + DT_BuildableGroupData_Building.json) pour produire
 * base_pieces_v2.json — la source unique de vérité pour le base planner 3D.
 *
 * - Corrige le champ `group` quand le curé diverge du DT (autoritaire = DT)
 * - Ajoute `placement_rules` (snap_target, rotation_mode, footprint_shape,
 *   vertical_offset, ignore_groups, socket_setup) depuis BuildableGroupData
 * - Ajoute `game_data` (collision_pct, attached_placeables_detailed) depuis
 *   le BuildingData de chaque faction
 *
 * Usage : node build_enriched_pieces.js
 */

const fs   = require('fs');
const path = require('path');

// ============================================================
// CONFIG
// ============================================================
const FMODEL_BASE  = 'J:/Download/Fmodel/Output/Exports/DuneSandbox/Content/Dune/Systems/Building/Data';
const CURATED_FILE = 'J:/Download/files2/base_pieces_data.json';
const OUTPUT_FILE  = 'J:/Download/Serveur/Carte Dune OK/DuneMap/base_pieces_v2.json';

// faction_id (curé) → fichier DT_BuildingData_*
const FACTION_FILES = {
  choam_shelter: 'BuildingData/DT_BuildingData_Choam_Shelter.json',
  choam:         'BuildingData/DT_BuildingData_Choam.json',
  choam_lvl2:    'BuildingData/DT_BuildingData_Choam_Level2.json',
  atreides:      'BuildingData/DT_BuildingData_Atreides.json',
  harkonnen:     'BuildingData/DT_BuildingData_Harkonnen.json',
  smugglers:     'BuildingData/DT_BuildingData_Smugglers.json',
  watershippers: 'BuildingData/DT_BuildingData_Watershippers.json',
  extra:         'BuildingData/DT_BuildingData_MiniSets.json',
  blockout:      'BuildingData/DT_BuildingData_Blockout.json',
};

// ============================================================
// HELPERS
// ============================================================
function loadJson(file) {
  if (!fs.existsSync(file)) {
    console.warn(`  ⚠ fichier introuvable : ${file}`);
    return null;
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function loadDataTable(file) {
  const json = loadJson(file);
  if (!json) return null;
  // Les DataTable FModel sont un tableau [{ Type: "DataTable", ..., Rows: {...} }]
  return Array.isArray(json) && json[0] && json[0].Rows ? json[0].Rows : null;
}

// ============================================================
// MAPPING DES ENUMS UE → STRINGS NORMALISÉS
// ============================================================
function mapSnapRotation(val) {
  if (!val) return 'cardinal';
  if (val.includes('SnapOne'))  return 'fixed';     // carrés symétriques, rotation inutile
  if (val.includes('SnapHalf')) return 'cardinal';  // 4 orientations N/E/S/W
  if (val.includes('SnapAll'))  return 'free';      // rotations + offsets
  return 'cardinal';
}

function mapCornersShape(val) {
  if (!val) return 'square';
  if (val.includes('TriangleEquilateral')) return 'triangle_equilateral';
  if (val.includes('TriangleIsosceles'))   return 'triangle_isosceles';
  return 'square';
}

// ============================================================
// SNAP TARGET — où la pièce s'ancre dans la grille
// ============================================================
// 'cell'   : centre d'une cellule (fondations, sols, toits, escaliers…)
// 'edge'   : arête entre deux cellules (murs, portes, fenêtres, hatches, échelles, rambardes)
// 'corner' : coin entre 4 cellules (piliers d'angle)
const EDGE_GROUPS = new Set([
  'Wall', 'Wall_Half', 'Wall_Protuding',
  'Wall_Round_Corner', 'Wall_Round_Corner_Sideless', 'Wall_Round_Corner_Half',
  'Wall_Inclined_Tall', 'Wall_Inclined_Corner_Tall',
  'Wall_Inclined_Wide_Left', 'Wall_Inclined_Wide_Right',
  'Door_Frame', 'Door_Frame_Tall', 'Door_Frame_Wide', 'Door_Frame_Garage',
  'PrudenceDoor_Frame',
  'Hatch_Frame',
  'Window_Wide', 'Arch',
  'Ladder',
  'Railing', 'Railing_Inclined', 'Railing_Inclined_Half', 'Railing_Round_Corner',
]);

const CORNER_GROUPS = new Set([
  'Pillar_Corner',
]);

function deriveSnapTarget(piece, dtGroupName) {
  if (EDGE_GROUPS.has(dtGroupName)) return 'edge';
  if (CORNER_GROUPS.has(dtGroupName)) return 'corner';
  // Fallback : si pas dans nos sets mais dimensions.d===0, c'est une pièce d'arête
  if (piece.dimensions && piece.dimensions.d === 0) return 'edge';
  return 'cell';
}

// ============================================================
// SCRIPT PRINCIPAL
// ============================================================
console.log('=== Enrichissement base_pieces_data.json ===\n');

// --- Chargement du curé
console.log('▸ Lecture du JSON curé...');
const curated = loadJson(CURATED_FILE);
if (!curated) {
  console.error(`✗ Impossible de lire ${CURATED_FILE}`);
  process.exit(1);
}
console.log(`  ${curated.pieces.length} pièces chargées\n`);

// --- Chargement des DT_BuildingData
console.log('▸ Lecture des DT_BuildingData_* (FModel)...');
const buildingData = {};
let dtTotal = 0;
for (const [faction, file] of Object.entries(FACTION_FILES)) {
  const fullPath = path.posix.join(FMODEL_BASE, file);
  const rows = loadDataTable(fullPath);
  if (rows) {
    buildingData[faction] = rows;
    const n = Object.keys(rows).length;
    dtTotal += n;
    console.log(`  ✓ ${faction.padEnd(15)} → ${n} rows`);
  } else {
    console.log(`  ✗ ${faction.padEnd(15)} → fichier manquant`);
  }
}
console.log(`  Total DT rows : ${dtTotal}\n`);

// --- Chargement du group data
console.log('▸ Lecture du DT_BuildableGroupData_Building...');
const groupDataFile = path.posix.join(FMODEL_BASE, 'BuildableGroupData/DT_BuildableGroupData_Building.json');
const groupData = loadDataTable(groupDataFile);
if (!groupData) {
  console.error('✗ DT_BuildableGroupData_Building introuvable');
  process.exit(1);
}
console.log(`  ${Object.keys(groupData).length} groupes définis\n`);

// ============================================================
// ENRICHISSEMENT
// ============================================================
console.log('▸ Enrichissement des pièces...');

const stats = {
  total:            curated.pieces.length,
  dt_matched:       0,
  dt_missing:       0,
  group_matched:    0,
  group_missing:    0,
  group_corrected:  0,
  by_snap_target:   { cell: 0, edge: 0, corner: 0 },
  by_rotation:      { fixed: 0, cardinal: 0, free: 0 },
  by_footprint:     { square: 0, triangle_isosceles: 0, triangle_equilateral: 0 },
  missing_dt_rows:  [],
  missing_groups:   new Set(),
  group_corrections: [],
};

const enriched = curated.pieces.map(piece => {
  const factionRows = buildingData[piece.faction_id];
  const dtRow = factionRows ? factionRows[piece.id] : null;

  if (dtRow) {
    stats.dt_matched++;
  } else {
    stats.dt_missing++;
    if (stats.missing_dt_rows.length < 30) {
      stats.missing_dt_rows.push(`${piece.faction_id}/${piece.id}`);
    }
  }

  // Groupe autoritaire depuis le DT (sinon fallback sur curé)
  const dtGroupName = (dtRow && dtRow.m_BuildableGroupType && dtRow.m_BuildableGroupType.Name)
    ? dtRow.m_BuildableGroupType.Name
    : piece.group;

  if (dtRow && dtGroupName !== piece.group) {
    stats.group_corrected++;
    if (stats.group_corrections.length < 30) {
      stats.group_corrections.push(`${piece.id}: "${piece.group}" → "${dtGroupName}"`);
    }
  }

  // Données du groupe
  const groupRow = groupData[dtGroupName];
  if (groupRow) {
    stats.group_matched++;
  } else {
    stats.group_missing++;
    stats.missing_groups.add(dtGroupName);
  }

  // === placement_rules ===
  const snapTarget     = deriveSnapTarget(piece, dtGroupName);
  const rotationMode   = mapSnapRotation(groupRow && groupRow.m_BrushPlacementSnapRotation);
  const footprintShape = mapCornersShape(groupRow && groupRow.m_BuildableBrushCornersShape);

  stats.by_snap_target[snapTarget]++;
  stats.by_rotation[rotationMode]++;
  stats.by_footprint[footprintShape]++;

  const placement_rules = {
    snap_target:           snapTarget,
    rotation_mode:         rotationMode,
    footprint_shape:       footprintShape,
    vertical_offset_pct:   (groupRow && groupRow.m_GhostScoreCenterOffsetVerticalPercentage) || 0,
    socket_setup:          (groupRow && groupRow.m_SocketSetup && groupRow.m_SocketSetup.Name) || null,
    ignore_groups:         (groupRow && groupRow.m_IgnoreBuildableGroups || []).map(g => g.Name),
    show_orientation_arrow: (groupRow && groupRow.m_bShowBrushOrientationArrow) || false,
  };

  // === game_data (extras du BuildingData row) ===
  const game_data = {};
  if (dtRow) {
    if (dtRow.m_OverrideCollisionDetectionPercentage) {
      const c = dtRow.m_OverrideCollisionDetectionPercentage;
      game_data.collision_pct = { x: c.X, y: c.Y, z: c.Z };
    }
    if (Array.isArray(dtRow.m_AttachedPlaceables) && dtRow.m_AttachedPlaceables.length > 0) {
      game_data.attached_placeables_detailed = dtRow.m_AttachedPlaceables.map(ap => ({
        type:        (ap.m_PlaceableType && ap.m_PlaceableType.Name) || null,
        translation: (ap.m_RelativeTransform && ap.m_RelativeTransform.Translation) || null,
        rotation:    (ap.m_RelativeTransform && ap.m_RelativeTransform.Rotation) || null,
      }));
    }
  }

  return Object.assign({}, piece, {
    group: dtGroupName,               // corrigé depuis le DT
    placement_rules,
  }, Object.keys(game_data).length > 0 ? { game_data } : {});
});

// ============================================================
// RAPPORT
// ============================================================
console.log(`\n  Pièces traitées        : ${enriched.length}/${stats.total}`);
console.log(`  DT row trouvé          : ${stats.dt_matched}`);
console.log(`  DT row manquant        : ${stats.dt_missing}`);
console.log(`  Groupe trouvé          : ${stats.group_matched}`);
console.log(`  Groupe manquant        : ${stats.group_missing}`);
console.log(`  Groupes corrigés (DT)  : ${stats.group_corrected}`);

console.log('\n  Snap target :');
console.log(`    cell   : ${stats.by_snap_target.cell}`);
console.log(`    edge   : ${stats.by_snap_target.edge}`);
console.log(`    corner : ${stats.by_snap_target.corner}`);

console.log('\n  Rotation mode :');
console.log(`    fixed    : ${stats.by_rotation.fixed}`);
console.log(`    cardinal : ${stats.by_rotation.cardinal}`);
console.log(`    free     : ${stats.by_rotation.free}`);

console.log('\n  Footprint :');
console.log(`    square              : ${stats.by_footprint.square}`);
console.log(`    triangle_isosceles  : ${stats.by_footprint.triangle_isosceles}`);
console.log(`    triangle_equilateral: ${stats.by_footprint.triangle_equilateral}`);

if (stats.missing_dt_rows.length > 0) {
  console.log(`\n  ⚠ DT rows manquants (${stats.missing_dt_rows.length} affichés, max 30) :`);
  stats.missing_dt_rows.slice(0, 30).forEach(r => console.log(`    - ${r}`));
}

if (stats.missing_groups.size > 0) {
  console.log('\n  ⚠ Groupes inconnus dans BuildableGroupData :');
  Array.from(stats.missing_groups).forEach(g => console.log(`    - ${g}`));
}

if (stats.group_corrections.length > 0) {
  console.log(`\n  ✎ Corrections de groupe (${stats.group_corrections.length} affichées, max 30) :`);
  stats.group_corrections.slice(0, 30).forEach(c => console.log(`    - ${c}`));
}

// ============================================================
// ÉCRITURE
// ============================================================
const finalStats = Object.assign({}, stats, {
  missing_groups: Array.from(stats.missing_groups),
});

const output = {
  version: '2.0',
  generated_at: new Date().toISOString(),
  source: {
    curated_file: path.basename(CURATED_FILE),
    fmodel_building_data_factions: Object.keys(FACTION_FILES).filter(f => buildingData[f]),
    fmodel_group_data: 'DT_BuildableGroupData_Building.json',
  },
  count: enriched.length,
  enrichment_stats: finalStats,
  pieces: enriched,
};

console.log(`\n▸ Écriture de ${OUTPUT_FILE}...`);
fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2), 'utf8');
const size = fs.statSync(OUTPUT_FILE).size;
console.log(`  ✓ ${enriched.length} pièces enrichies (${(size / 1024).toFixed(0)} KB)\n`);

console.log('=== Terminé ===');
