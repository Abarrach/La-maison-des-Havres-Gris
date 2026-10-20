#!/usr/bin/env node
/**
 * test_socket_engine.mjs — Banc d'essai HEADLESS du moteur d'accroche du planner.
 *
 * Pourquoi : une page Three.js ne se teste pas dans un navigateur piloté (l'onglet reste
 * masqué, `matrixWorld` n'est jamais mis à jour, tous les raycasts ratent). Mais
 * `planner_socket_engine.js` est du calcul pur, sans Three.js : on peut donc poser des
 * pièces et interroger l'accroche en Node, avec les VRAIES données du site — ce qui
 * répond à « pourquoi cette pièce refuse de se poser » par une mesure, pas une intuition.
 *
 * Usage :
 *   node tools/test_socket_engine.mjs <pièce posée> <pièce à poser> [...]
 *   node tools/test_socket_engine.mjs Sardaukar_Foundation Sardaukar_Wall_01
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createEngine, costMatch, typeMatch, M, q, j, G } from '../planner_socket_engine.js';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pieces = JSON.parse(fs.readFileSync(path.join(RACINE, 'planner_pieces.json'), 'utf8')).pieces;

// Même normalisation que base_planner.js : le JSON est en snake_case, le moteur attend
// du camelCase. L'oublier fait échouer les accroches pour une raison invisible.
const parId = new Map();
for (const p of pieces) {
  p.sockets = p.sockets || [];
  p.socketProfile = p.socket_profile ?? null;
  p.isFoundation = !!p.is_foundation;
  p.isPillar = !!p.is_pillar_socket;
  p.snapRotation = p.snap_rotation ?? null;
  parId.set(p.id, p);
}
const getPiece = (id) => parId.get(id);
const moteur = createEngine(getPiece);

const [idPose, idAPoser] = process.argv.slice(2);
if (!idPose || !idAPoser) { console.error('Usage : node tools/test_socket_engine.mjs <posée> <à poser>'); process.exit(1); }
for (const id of [idPose, idAPoser]) if (!parId.has(id)) { console.error('Pièce inconnue : ' + id); process.exit(1); }

const posee = { id: 1, building_type: idPose, x: 0, y: 0, z: 0, rotation: 0 };
const liste = [posee];

const IS_PASSIVE = s => s.cost === 'Up' && Math.abs(s.lx) <= 1 && Math.abs(s.ly) <= 1;
const a = getPiece(idAPoser), b = getPiece(idPose);
const actifs = a.sockets.filter(s => s.cost !== 'No_Cost' && !IS_PASSIVE(s));

console.log(`posée    : ${idPose} (${b.sockets.length} sockets, profil ${b.socketProfile})`);
console.log(`à poser  : ${idAPoser} (${a.sockets.length} sockets, profil ${a.socketProfile})`);
console.log(`           dont ACTIFS : ${actifs.length} (les passifs — cost=Up au centre — ne peuvent pas initier)`);

// Pourquoi chaque paire passe ou échoue : c'est l'information qui manque dans l'UI,
// où un refus se résume à une croix sans explication.
console.log('\n=== Appariement socket par socket ===');
let compatibles = 0;
for (const sa of actifs) {
  for (const sb of b.sockets) {
    if (sb.cost === 'No_Cost') continue;
    const okCost = costMatch(sa.cost, sb.cost);
    const okType = typeMatch(sa, sb);
    if (okCost && okType) {
      compatibles++;
      const wp = M(posee, sb.lx, sb.ly, sb.lz);
      const rot = q(sa.yawDeg - sb.yawDeg + posee.rotation - 180);
      const { rx, ry } = j(sa.lx, sa.ly, rot);
      console.log(`  ✓ ${sa.cost}@(${sa.lx},${sa.ly},${sa.lz}) ↔ ${sb.cost}@(${sb.lx},${sb.ly},${sb.lz})`
        + ` → pose en (${Math.round(wp.x - rx)}, ${Math.round(wp.y - ry)}, ${Math.round(wp.z - sa.lz)}) rot ${rot}`);
    }
  }
}
if (!compatibles) {
  console.log('  AUCUNE paire compatible. Détail des refus :');
  for (const sa of actifs) {
    for (const sb of b.sockets) {
      if (sb.cost === 'No_Cost') continue;
      const raison = !costMatch(sa.cost, sb.cost) ? `coût ${sa.cost}↮${sb.cost}` : (!typeMatch(sa, sb) ? 'types incompatibles' : null);
      if (raison) console.log(`    ✗ ${sa.cost}@(${sa.lx},${sa.ly},${sa.lz}) vs ${sb.cost}@(${sb.lx},${sb.ly},${sb.lz}) : ${raison}`);
    }
  }
}

// Ce que le moteur répond vraiment, curseur posé au-dessus de la pièce existante.
console.log('\n=== snapCandidates (ce que fait le planner) ===');
for (const [nom, cur] of [['centre', { x: 0, y: 0 }], ['bord +Y', { x: 0, y: 256 }], ['bord +X', { x: 256, y: 0 }]]) {
  for (const [nomZ, opts] of [['sans zHint', {}], ['zHint=0', { zHint: 0, zTol: 200 }], ['zHint=384', { zHint: 384, zTol: 200 }]]) {
    const r = moteur.snapCandidates(cur, idAPoser, liste, null, opts, 8) || [];
    console.log(`  curseur ${nom.padEnd(8)} ${nomZ.padEnd(12)} → ${r.length} accroche(s)`
      + (r.length ? ` ; 1re en (${Math.round(r[0].pos.x)}, ${Math.round(r[0].pos.y)}, ${Math.round(r[0].pos.z)}) rot ${r[0].rotation}` : ''));
  }
}
