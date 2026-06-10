// P0 — Catalogue unifié pour le planner (moteur sockets + meshes).
// Base = base_pieces_v3.json (tous les champs UI : label_fr, faction_id, category,
// group, menu_order, icon_path, dimensions, placement_rules, is_machine/vehicle…).
// Enrichi par dune_pieces_sockets.json (sockets, socketProfile, snapRotation,
// cornersShape, size, mesh, meshPath, isFoundation, isPillar) joint sur id↔templateId.
// Usage : node tools/build_planner_pieces.js
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const v3 = JSON.parse(fs.readFileSync(path.join(ROOT, 'base_pieces_v3.json'), 'utf8'));
const sockArr = JSON.parse(fs.readFileSync(path.join(ROOT, 'dune_pieces_sockets.json'), 'utf8'));
const sock = new Map(sockArr.map(s => [s.templateId, s]));

// Utilitaires (placeables fonctionnels : éoliennes, pièges à vent, générateurs, citernes,
// deathstills, recycleur, ateliers, stockage…) — absents de base_pieces_v3 (datamining
// DT_PlaceableData_Functional). real_size_m = bbox du mesh .glb ; coûts dans planner_costs.json.
const utilFile = path.join(ROOT, 'planner_utilities.json');
const UTILITIES = fs.existsSync(utilFile)
  ? JSON.parse(fs.readFileSync(utilFile, 'utf8')).utilities || []
  : [];

// --- Normalisation socket central pilier des sols (No_Cost → Foundation_Edge) ---
// Dans le dump du jeu, le socket central `BP_DunePillarSocket_C` d'un sol est `No_Cost`
// (gratuit côté jeu). Or le moteur de snap ignore tout socket No_Cost (ni actif ni cible),
// ce qui rend impossible de poser un sol AU-DESSUS d'un pilier (et un pilier sur un sol).
// On le promeut en `Foundation_Edge` — exactement comme le socket central des fondations,
// que le moteur gère déjà — pour autoriser les deux sens d'accrochage. On garde le dump
// d'origine intact ; la correction vit ici et survit à une ré-extraction des données.
let promotedPillarSockets = 0;
function promotePillarCenterSocket(s) {
  if (s.cost !== 'No_Cost') return false;
  if (Math.abs(s.lx || 0) > 1 || Math.abs(s.ly || 0) > 1) return false;
  if (!(s.types || []).includes('BP_DunePillarSocket_C')) return false;
  s.cost = 'Foundation_Edge';
  promotedPillarSockets++;
  return true;
}

// --- Normalisation sockets « rambarde inclinée » (angled railing) ---
// Mécanisme du jeu : une rambarde INCLINÉE s'accroche sur le CÔTÉ d'un escalier/rampe via des
// sockets `BP_DuneAngledRailingSocket_*` en No_Cost. MAIS le dump est asymétrique (la rampe a
// `types=[AR]` / `targetTypes=[]`, la rambarde l'inverse) ET en No_Cost → le moteur (qui ignore
// les No_Cost et exige la réciprocité de typeMatch) ne peut JAMAIS les connecter → rambardes
// inclinées imposables. FIX : rendre ces sockets symétriques (types=targetTypes=union) et
// promouvoir No_Cost → Sideways (accroche latérale, même lz des 2 côtés) → le moteur accroche
// la rambarde sur le flanc de l'escalier/rampe. Variantes (_1_S_ plein / _05_S_ demi) conservées
// → une rambarde pleine ne s'accroche qu'à une rampe pleine, etc.
let promotedRailingSockets = 0;
const isAngledRailingType = t => /AngledRailingSocket/.test(t);
function normalizeAngledRailingSocket(s) {
  const all = [...(s.types || []), ...(s.targetTypes || [])];
  if (!all.some(isAngledRailingType)) return false;
  const union = Array.from(new Set(all));
  s.types = union;
  s.targetTypes = union;
  if (s.cost === 'No_Cost') s.cost = 'Sideways';
  promotedRailingSockets++;
  return true;
}

// --- Câblage mesh des MACHINES / VÉHICULES (placeables sans données socket) ---
// Ces pièces n'ont pas d'entrée dans dune_pieces_sockets.json → `mesh` restait null après
// build → vignettes/objets en fallback glyphe. Le mesh (machines = SM Props Choam ;
// véhicules = SM_ProxyMesh véhicule complet low-poly) est mappé ICI pour survivre aux
// régénérations (auparavant patch manuel dans planner_pieces.json, perdu à chaque rebuild).
// basename → models/<basename>.glb.
const MV_MESH = {
  // Machines (17) — Props/Choam
  Fabricator_Placeable: 'SM_Plac_Choam_Fabricator_Large_01',
  SpiceRefinery_Placeable: 'SM_Env_Props_Choam_SpiceRefinery',
  MediumOreRefinery_Placeable: 'SM_Env_Prop_Choam_OreRefinery_01',
  SmallOreRefinery_Placeable: 'SM_Env_Prop_Choam_OreRefinery_Small',
  SmallChemicalRefinery_Placeable: 'SM_Env_Prop_Choam_ChemicalRefinery_Small',
  WeaponsFabricator_Placeable: 'SM_Env_Prop_Choam_Fabricator_Weapons',
  WearablesFabricator_Placeable: 'SM_Env_Prop_Choam_Fabricator_Wearables',
  VehiclesFabricator_Placeable: 'SM_Env_Prop_Choam_Fabricator_Vehicles',
  SurvivalFabricator_Placeable: 'SM_Env_Prop_Choam_Fabricator_Survival',
  MediumChemicalRefinery_Placeable: 'SM_Env_Prop_Choam_ChemicalRefinery_Medium',
  MediumSpiceRefinery_Placeable: 'SM_Env_Prop_Choam_SpiceRefinery_Medium',
  AdvancedWeaponsFabricator_Placeable: 'SM_Env_Prop_Choam_Fabricator_Weapons_Advanced',
  AdvancedWearablesFabricator_Placeable: 'SM_Env_Prop_Choam_Fabricator_Wearables_Advandced',
  Advanced_VehiclesFabricator_Placeable: 'SM_Env_Prop_Choam_Fabricator_Vehicles_Large',
  Advanced_SurvivalFabricator_Placeable: 'SM_Env_Prop_Choam_Fabricator_Survival_Advanced_01_assemble',
  LargeOreRefinery_Placeable: 'SM_Env_Prop_Choam_OreRefinery_Large',
  LargeSpiceRefinery_Placeable: 'SM_Env_Prop_Choam_SpiceRefinery_Large_Full',
  // Véhicules (6) — ProxyMeshes
  Sandbike_Vehicle: 'SM_ProxyMesh_Choam_GC_Sandbike',
  Buggy_Vehicle: 'SM_ProxyMesh_Choam_GC_Buggy',
  Sandcrawler_Vehicle: 'SM_ProxyMesh_Choam_GC_Industrial',
  LightOrnithopter_Vehicle: 'SM_ProxyMesh_Choam_Ornithopter_Light',
  MediumOrnithopter_Vehicle: 'SM_ProxyMesh_Choam_Ornithopter_Medium',
  TransportOrnithopter_Vehicle: 'SM_ProxyMesh_Choam_Ornithopter_Transport',
};
let mvMeshWired = 0;

// --- Correction des axes w/d inversés (footprint des placeables) ---
// L'empreinte (footprint en cases) et la boîte visuelle des machines sont dérivées de
// `real_size_m`. Or pour CERTAINES pièces, `real_size_m.w`/`.d` (et `dimensions.w`/`.d`)
// sont INVERSÉS par rapport à l'orientation réelle du mesh .glb (axe X = largeur, Z =
// profondeur). Vérifié par la bbox des glb : épice moyenne data {w:3.1,d:6.2} mais mesh
// X:6.33×Z:3.10 ; grande raffinerie de minerai data {w:8.6,d:13.5} mais mesh X:13.49×Z:8.32.
// Conséquence : empreinte tournée de 90° → machine pas centrée (snappée sur une ligne), et
// la grande raffinerie « prend 9 cases » au lieu de 6 (boîte 2×3 mal orientée vs mesh).
// FIX : on échange w↔d pour ces ids À LA GÉNÉRATION (les 21 autres machines/véhicules ont
// des axes corrects, vérifiés). base_pieces_v3.json reste intact → survit à une ré-extraction.
const SWAP_WD_IDS = new Set([
  'MediumSpiceRefinery_Placeable',  // épice moyenne : mesh 6.33×3.10 → footprint 2×1 (centré)
  'LargeOreRefinery_Placeable',     // grande minerai : mesh 13.49×8.32 → footprint 3×2 = 6 cases
]);
let swappedAxes = 0;
function swapWD(o) {
  if (!o || typeof o.w !== 'number' || typeof o.d !== 'number') return o;
  return { ...o, w: o.d, d: o.w };
}

// --- Désactivation du socket courbe (CurvedWall) sur les SOLS arrondis ---
// Le sol arrondi (Floor_Round_Corner) porte un socket `BP_DuneCurvedWallSocket_C` ACTIF
// (cost Down, en 256,256,20). En présence d'un MUR arrondi voisin, ce socket s'accroche au
// socket courbe du mur (Up, en haut lz404) → le sol est aspiré SUR LE HAUT du mur au lieu de
// se poser dans le recoin (bug signalé : « mur arrondi bloque le sol arrondi »). Le mur arrondi
// se pose en pose libre (il n'a pas besoin de ce socket) → on neutralise le socket courbe CÔTÉ
// SOL (No_Cost = ignoré par le moteur) pour que le sol se comporte pareil avec ou sans mur.
let deactivatedFloorCurved = 0;
function deactivateFloorCurvedSocket(s, group) {
  if (!/^Floor/.test(group || '')) return false;
  if (!(s.types || []).includes('BP_DuneCurvedWallSocket_C')) return false;
  if (s.cost === 'No_Cost') return false;
  s.cost = 'No_Cost';
  deactivatedFloorCurved++;
  return true;
}

let enriched = 0, withMesh = 0, withSockets = 0;
const pieces = v3.pieces.map(p => {
  const s = sock.get(p.id);
  const out = { ...p };
  if (s) {
    enriched++;
    out.socket_profile = s.socketProfile || null;
    out.snap_rotation  = s.snapRotation || null;
    out.corners_shape  = s.cornersShape || null;
    out.is_foundation  = !!s.isFoundation;
    out.is_pillar_socket = !!s.isPillar;
    out.socket_size    = s.size || null;        // {x,y,z} normalisé du jeu
    out.sockets        = s.sockets || [];
    out.sockets.forEach(promotePillarCenterSocket);     // sol↔pilier (cf. note ci-dessus)
    out.sockets.forEach(normalizeAngledRailingSocket);  // rambarde inclinée ↔ flanc rampe/escalier
    out.sockets.forEach(sk => deactivateFloorCurvedSocket(sk, s.group));  // sol arrondi ne s'aspire plus sur un mur arrondi
    out.mesh           = s.mesh || null;         // basename glb (SM_/SK_…)
    out.mesh_rel       = s.meshPath || null;     // Dune/.../SM_xxx.glb
    if (out.mesh) withMesh++;
    if (out.sockets.length) withSockets++;
  } else {
    out.sockets = [];                            // machines/véhicules/blockout → fallback
    out.mesh = null;
  }
  // Câblage mesh machines/véhicules (survit aux régénérations).
  if (MV_MESH[p.id]) { out.mesh = MV_MESH[p.id]; mvMeshWired++; }
  // Correction d'axes w/d inversés vs mesh (footprint centré, cf. note ci-dessus).
  if (SWAP_WD_IDS.has(p.id)) {
    out.real_size_m = swapWD(out.real_size_m);
    out.dimensions  = swapWD(out.dimensions);
    swappedAxes++;
  }
  return out;
});

// ── Injection des UTILITAIRES (nouvelle catégorie « utilities ») ──────────────
// Pièces posables comme les machines (is_machine réutilise toute la logique de pose/
// footprint/collision/mesh) + drapeau is_utility (onglet de palette dédié). Footprint
// dérivé de real_size_m (bbox mesh). Survit aux régénérations (lit planner_utilities.json).
const CELL_M = 5.12, LEVEL_M = 3.84;
const fpCells = m => Math.max(1, Math.ceil((m || CELL_M) / CELL_M - 0.15));
const hLevels = m => Math.max(1, Math.ceil((m || LEVEL_M) / LEVEL_M));
let utilWired = 0;
UTILITIES.forEach((u, i) => {
  const rs = u.real_size_m || { w: 2, d: 2, h: 2 };
  pieces.push({
    id: u.id,
    faction_id: 'placeables', faction_label: 'placeables',
    category: 'utilities', group: u.group || 'Utility',
    label_fr: u.label_fr, label_en: u.label_en,
    dimensions: { w: fpCells(rs.w), d: fpCells(rs.d), h: hLevels(rs.h), shape: 'square' },
    real_size_m: rs,
    placement_rules: { snap_target: 'cell', footprint_shape: 'square' },
    menu_order: 90000000 + i,
    icon_path: null, mesh_path: null,
    is_machine: true,   // réutilise pose/footprint/collision/mesh des placeables
    is_utility: true,   // onglet de palette « Utilitaires »
    sockets: [],
    mesh: u.mesh || null,
    power: u.power || 0, water_capacity: u.water_capacity || 0,
  });
  utilWired++;
});

const result = {
  version: 'planner-1',
  generated_at: new Date().toISOString(),
  source: { ui: 'base_pieces_v3.json', engine: 'dune_pieces_sockets.json' },
  count: pieces.length,
  pieces,
};
fs.writeFileSync(path.join(ROOT, 'planner_pieces.json'), JSON.stringify(result, null, 2));

console.log(`planner_pieces.json écrit : ${pieces.length} pièces`);
console.log(`  enrichies (sockets data) : ${enriched}`);
console.log(`  avec sockets non vides   : ${withSockets}`);
console.log(`  avec mesh (.glb)         : ${withMesh}`);
console.log(`  sans données socket      : ${pieces.length - enriched} (machines/véhicules/blockout → fallback)`);
console.log(`  sockets centraux pilier promus (No_Cost→Foundation_Edge) : ${promotedPillarSockets}`);
console.log(`  sockets rambarde inclinée normalisés (→Sideways) : ${promotedRailingSockets}`);
console.log(`  mesh machines/véhicules câblés : ${mvMeshWired}`);
console.log(`  sockets courbes désactivés sur sols arrondis : ${deactivatedFloorCurved}`);
console.log(`  axes w/d inversés corrigés (footprint centré) : ${swappedAxes}`);
console.log(`  utilitaires injectés (cat. utilities)         : ${utilWired}`);
