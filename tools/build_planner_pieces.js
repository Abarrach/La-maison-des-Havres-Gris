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
    out.mesh           = s.mesh || null;         // basename glb (SM_/SK_…)
    out.mesh_rel       = s.meshPath || null;     // Dune/.../SM_xxx.glb
    if (out.mesh) withMesh++;
    if (out.sockets.length) withSockets++;
  } else {
    out.sockets = [];                            // machines/véhicules/blockout → fallback
    out.mesh = null;
  }
  return out;
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
