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

// --- Normalisation socket de BASE des pièces arrondies (No_Cost → Foundation_Edge) ---
// Même mécanisme que ci-dessus, autre famille. Un mur/toit/rampe ARRONDI s'assoit sur une
// fondation par un socket `BP_DuneBuildingFoundationSocket_C` placé SOUS lui (lz < 0), que
// le jeu note `No_Cost`. Le moteur refusant à un No_Cost d'initier une accroche, ces pièces
// n'avaient AUCUNE accroche possible sur une fondation : mesuré à 0 candidat, aussi bien
// avec les sockets dataminés qu'avec les anciens faits à la main. En jeu elles se posent
// pourtant sans difficulté, et les TYPES correspondent déjà (la fondation expose
// `BP_DuneBuildingFoundationSocket_C`) : seul le coût bloquait.
// On ne promeut que sur les pièces NON-fondation : sur une fondation, ce même socket sert
// de cible, le promouvoir y ferait s'empiler les fondations entre elles.
let promotedRoundBaseSockets = 0;
function promoteRoundBaseSocket(s, piece) {
  if (s.cost !== 'No_Cost') return false;
  if (piece.is_foundation) return false;
  if (!(s.types || []).includes('BP_DuneBuildingFoundationSocket_C')) return false;
  if ((s.lz || 0) >= 0) return false;            // doit être SOUS la pièce
  s.cost = 'Foundation_Edge';
  promotedRoundBaseSockets++;
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
  // Véhicules — recomposés depuis leurs vraies pièces par tools/build_vehicle_models.js
  // (livrée Atréides quand elle existe, puis colorés/texturés comme les pièces). Les proxys du
  // jeu (SM_ProxyMesh, gris uni) restent là où il n'existe pas de pose équivalente.
  Sandbike_Vehicle: 'SM_Composite_ATR_1MGC_Sandbike',
  Buggy_Vehicle: 'SM_Composite_ACB_Buggy',
  Sandcrawler_Vehicle: 'SM_Composite_CIGC_Sandcrawler',
  LightOrnithopter_Vehicle: 'SM_ProxyMesh_Choam_Ornithopter_Light',     // pièces modélisées ailes repliées
  MediumOrnithopter_Vehicle: 'SM_Composite_AMO_Ornithopter_Medium',
  TransportOrnithopter_Vehicle: 'SM_Composite_CTO_Ornithopter_Transport',
  TreadWheel_Vehicle: 'SM_ProxyMesh_OldEmpire_TreadWheel',   // trouvé le 2026-10-24 (DLC B1C2), pas de pièces
  Tank_Vehicle: 'SM_Composite_CH_4MGC_Tank',                  // pas encore sorti, pas de proxy
};
// Contenu annoncé mais pas encore sorti : signalé dans le nom.
const A_VENIR = new Set(['Tank_Vehicle']);

// --- Ornis AILES REPLIÉES (2026-10-24) : pièces à part dans l'onglet Véhicules ---
// Le jeu a un modèle replié pour trois ornis (rangé à côté du proxy déployé, jamais cité
// par le catalogue, donc jamais extrait) : un orni posé au sol a les ailes repliées, et
// c'est sa vraie emprise dans un hangar. Clone de la pièce d'origine (même label_en →
// mêmes coûts dans la Synthèse), seul le modèle change. Les deux légers/moyens repliés
// sont des modèles Atréides : le jeu n'en a pas en version CHOAM.
const VEHICULES_REPLIES = [
  // L'orni léger replié : ses vraies pièces (modélisées ailes repliées), plus le proxy.
  { id: 'LightOrnithopter_Vehicle_Folded',     base: 'LightOrnithopter_Vehicle',     mesh: 'SM_Composite_AOL_Ornithopter_Light' },
  { id: 'MediumOrnithopter_Vehicle_Folded',    base: 'MediumOrnithopter_Vehicle',    mesh: 'SM_ProxyMesh_Atreides_Ornithopter_Medium_Folded' },
  { id: 'TransportOrnithopter_Vehicle_Folded', base: 'TransportOrnithopter_Vehicle', mesh: 'SM_ProxyMesh_Choam_Ornithopter_Transport_Folded' },
];
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
    out.sockets.forEach(sk => promoteRoundBaseSocket(sk, out));  // arrondis ↔ fondation
    out.sockets.forEach(normalizeAngledRailingSocket);  // rambarde inclinée ↔ flanc rampe/escalier
    out.sockets.forEach(sk => deactivateFloorCurvedSocket(sk, s.group));  // sol arrondi ne s'aspire plus sur un mur arrondi
    out.mesh           = s.mesh || null;         // basename glb (SM_/SK_…)
    out.mesh_rel       = s.meshPath || null;     // Dune/.../SM_xxx.glb
    if (out.mesh) withMesh++;
    if (out.sockets.length) withSockets++;
  } else {
    out.sockets = [];                            // machines/véhicules/blockout → fallback
    // Pas d'entrée socket, mais le catalogue connaît quand même le mesh : `mesh_path` finit
    // par le nom d'asset, qui EST le nom du .glb. Sans cette reprise, un set ajouté par un
    // patch (Sardaukar, 2026-10-19) resterait en volumes gris alors que ses meshes sont
    // exportables. Un .glb absent retombe de toute façon sur la boîte (planner_mesh.js).
    out.mesh = meshDepuisChemin(p.mesh_path);
    out.mesh_rel = null;
  }
  // Câblage mesh machines/véhicules (survit aux régénérations).
  if (MV_MESH[p.id]) { out.mesh = MV_MESH[p.id]; mvMeshWired++; }
  if (A_VENIR.has(p.id)) out.label_fr = out.label_fr + ' (à venir)';
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
/** `/Game/.../SM_Truc.SM_Truc` → `SM_Truc` : le nom de fichier .glb attendu par le planner. */
function meshDepuisChemin(mp) {
  if (!mp) return null;
  const sansObjet = mp.includes('.') ? mp.slice(0, mp.lastIndexOf('.')) : mp;
  return sansObjet.slice(sansObjet.lastIndexOf('/') + 1) || null;
}

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

// ── Véhicules : ailes repliées + emprise prise SUR LE MODÈLE (2026-10-24) ─────
// L'emprise des véhicules (real_size_m du catalogue) était très en dessous de leur modèle :
// orni de transport réservé 16 × 12 m pour un modèle de 32 × 68 m — il traversait les murs
// quelle que soit la position des ailes, et « est-ce que ça tient ? » ne voulait rien dire.
// On mesure donc la boîte du .glb (mètres ; X = largeur w, Z = profondeur d, Y = hauteur,
// comme pour les utilitaires), et on note son centre : le modèle n'est pas centré sur son
// origine (ornis : -1,9 à -3,4 m en X), planner_mesh.js le recentre sur l'emprise.
const glbBoite = (() => {
  const dossier = require('./models_dir')();
  return nom => {
    const f = path.join(dossier, nom + '.glb');
    if (!fs.existsSync(f)) return null;
    const b = fs.readFileSync(f);
    const j = JSON.parse(b.slice(20, 20 + b.readUInt32LE(12)).toString());
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (const m of j.meshes || []) for (const pr of m.primitives || []) {
      const a = j.accessors[pr.attributes.POSITION];
      for (let i = 0; i < 3; i++) { mn[i] = Math.min(mn[i], a.min[i]); mx[i] = Math.max(mx[i], a.max[i]); }
    }
    return { mn, mx };
  };
})();
const r2 = v => Math.round(v * 100) / 100;
let repliesAjoutes = 0, vehiculesMesures = 0;
for (const v of VEHICULES_REPLIES) {
  const base = pieces.find(p => p.id === v.base);
  if (!base) { console.warn(`  ⚠ ${v.id} : pièce d'origine ${v.base} absente`); continue; }
  pieces.push({ ...base, id: v.id, label_fr: base.label_fr + ' (ailes repliées)', mesh: v.mesh,
                menu_order: (base.menu_order || 0) + 0.5 });
  repliesAjoutes++;
}
for (const p of pieces) {
  if (!p.is_vehicle || !p.mesh) continue;
  const bx = glbBoite(p.mesh);
  if (!bx) { console.warn(`  ⚠ ${p.id} : ${p.mesh}.glb absent de la base des modèles — emprise du catalogue gardée`); continue; }
  const [x0, y0, z0] = bx.mn, [x1, y1, z1] = bx.mx;
  p.real_size_m = { w: r2(x1 - x0), d: r2(z1 - z0), h: r2(y1 - y0) };
  p.dimensions = { w: fpCells(p.real_size_m.w), d: fpCells(p.real_size_m.d), h: hLevels(p.real_size_m.h), shape: 'square' };
  // y = point le plus bas, posé au sol par planner_mesh.js : le tank descendait de 1,8 m sous
  // le plancher, les ornis flottaient de 0,6 à 2,3 m (origine des modèles ≠ sol).
  p.mesh_center_m = { x: r2((x0 + x1) / 2), y: r2(y0), z: r2((z0 + z1) / 2) };
  vehiculesMesures++;
}

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
console.log(`  sockets de base arrondis promus (No_Cost→Foundation_Edge) : ${promotedRoundBaseSockets}`);
console.log(`  sockets rambarde inclinée normalisés (→Sideways) : ${promotedRailingSockets}`);
console.log(`  mesh machines/véhicules câblés : ${mvMeshWired}`);
console.log(`  sockets courbes désactivés sur sols arrondis : ${deactivatedFloorCurved}`);
console.log(`  axes w/d inversés corrigés (footprint centré) : ${swappedAxes}`);
console.log(`  utilitaires injectés (cat. utilities)         : ${utilWired}`);
console.log(`  ornis ailes repliées ajoutés                  : ${repliesAjoutes}`);
console.log(`  véhicules mesurés sur leur modèle             : ${vehiculesMesures}`);
