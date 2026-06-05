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
