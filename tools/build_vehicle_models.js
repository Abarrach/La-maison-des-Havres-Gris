#!/usr/bin/env node
/**
 * build_vehicle_models.js — Véhicules du planner recomposés depuis leurs VRAIES pièces (2026-10-24).
 *
 *   node tools/build_vehicle_models.js              → <base des modèles>/SM_Composite_*.glb
 *   node tools/build_vehicle_models.js --seul=Sandbike,Buggy
 *   node tools/build_vehicle_models.js --inventaire  (boîtes englobantes des pièces, pour trier)
 *   node tools/build_vehicle_models.js --lod=1       (niveau de détail, 2 par défaut)
 *
 * Le jeu n'a pour la plupart des véhicules qu'un SM_ProxyMesh d'un seul tenant, au matériau
 * gris « blockout » : rien à colorer. Les vrais véhicules sont modulaires (caisse, châssis,
 * cockpit, roues ou ailes, moteur…) et leurs pièces sont modélisées EN PLACE, à une exception :
 * le CHÂSSIS est dans son propre repère, le reste est accroché à son os « body ». Toutes les
 * autres pièces sont donc relevées de la hauteur de cet os (2026-10-24 : châssis du buggy
 * posé sur le toit, patins de l'orni léger au-dessus de la caisse ; les épaves, aux mêmes
 * positions que les pièces saines, confirment que chaque pièce est juste DANS SON repère).
 * Lue dans les matrices de liaison (inverseBindMatrices) du squelette : la hauteur seule, en
 * valeur absolue, car le repère du châssis est retourné sur certains véhicules (os à −1,5 m
 * pour le buggy, +3,67 m pour l'orni moyen) alors que les pièces tombent juste relevées de
 * |hauteur| dans les deux cas — comparé aux maquettes du jeu. On les fusionne
 * en gardant ce que tools/build_colored_models.js lit (POSITION, NORMAL, TEXCOORD_0..2 et le
 * NOM des matériaux) : il les colore et les texture ensuite comme n'importe quelle pièce.
 *
 * Livrée : Atréides quand elle existe (moto, buggy, ornis léger et moyen) ; le transport,
 * la chenillette et le tank n'existent qu'en CHOAM. Configuration de base : pas de modules
 * optionnels (scanner, lance-roquettes…), sauf ceux qui complètent la silhouette.
 *
 * Remplace tools/build_tank_model.js (le tank y passe aussi, désormais texturé).
 * Les .glb vont dans la base locale (tools/models_dir.js) : relancer ensuite
 * tools/build_planner_pieces.js (emprise mesurée sur le modèle) et tools/build_colored_models.js.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

try { os.setPriority(0, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* sans effet hors Windows/Linux */ }

const RACINE = path.resolve(__dirname, '..');
const EXTRACT = path.join(RACINE, 'tools/extract');
const EXE = path.join(EXTRACT, 'bin/Release/net10.0/DuneExtract.exe');
const BASE = require('./models_dir')();
const TRAVAIL = path.join(os.tmpdir(), 'dunemap_vehicules');
const ARGS = process.argv.slice(2);
const SEUL = (ARGS.find(a => a.startsWith('--seul=')) || '').slice(7).split(',').filter(Boolean);
const INVENTAIRE = ARGS.includes('--inventaire');
// Niveau de détail des pièces : en LOD0 les sept véhicules faisaient 1 million de sommets
// (42 Mo une fois allégés) pour un planner vu de haut.
const LOD = Number((ARGS.find(a => a.startsWith('--lod=')) || '--lod=2').slice(6));
const MESHES = path.join(TRAVAIL, 'meshes_lod' + LOD);
const GENERATEUR = 'Assemblage tools/build_vehicle_models.js';   // pas « DuneMap… » : à colorer ensuite
const V = '/Game/Dune/Vehicles';

// sortie : nom du .glb (= `mesh` dans planner_pieces.json) ; pieces : noms d'assets du dossier Mesh/.
const VEHICULES = {
  Sandbike: { sortie: 'SM_Composite_ATR_1MGC_Sandbike', dossier: `${V}/GroundVehicles/GroundCar/AtreidesFaction/1Man`,
    pieces: ['SK_ATR_1MGC_Chassis', 'SK_ATR_1MGC_Locomotion_FL', 'SK_ATR_1MGC_Locomotion_FR', 'SK_ATR_1MGC_Locomotion_Rear',
      'SM_ATR_1MGC_MainHull', 'SM_ATR_1MGC_Engine', 'SM_ATR_1MGC_PSU', 'SM_ATR_1MGC_Inventory',
      'SM_ATR_1MGC_Windshield', 'SM_ATR_1MGC_Windshield_Glass'] },
  Buggy: { sortie: 'SM_Composite_ACB_Buggy', dossier: `${V}/GroundVehicles/GroundCar/AtreidesFaction/Buggy`,
    pieces: ['SK_ACB_Body', 'SK_ACB_Chassis', 'SK_ACB_LM_Tread_FL', 'SK_ACB_LM_Tread_FR', 'SK_ACB_LM_Tread_RL', 'SK_ACB_LM_Tread_RR',
      'SM_ACB_Cockpit', 'SM_ACB_Cockpit_Glass', 'SM_ACB_Engine', 'SM_ACB_PSU', 'SM_ACB_Inventory',
      'SM_ACB_Interior_Back', 'SM_ACB_Interior_Cockpit'] },
  OrniLeger: { sortie: 'SM_Composite_AOL_Ornithopter_Light', dossier: `${V}/FlyingVehicles/Ornithopter/AtreidesFaction/Light`,
    // Modélisé AILES REPLIÉES (pose de repos : 14,4 × 6,2 m, l'emprise du proxy replié) : il
    // remplace l'orni léger replié ; le déployé garde son proxy. SK_AOL_Wings_01 = les quatre
    // ailes (les DF_/Dash_Wing_* en sont des doublons, un par mode de vol).
    pieces: ['SK_AOL_Body_01', 'SK_AOL_Chassis_01', 'SK_AOL_Cockpit_01', 'SK_AOL_Wings_01',
      'SM_AOL_Body_Interior_01', 'SM_AOL_Cockpit_Interior_01', 'SM_AOL_Cockpit_Glass_01',
      'SM_AOL_Engine_01', 'SM_AOL_PSU_01', 'SM_AOL_Inventory'] },
  OrniMoyen: { sortie: 'SM_Composite_AMO_Ornithopter_Medium', dossier: `${V}/FlyingVehicles/Ornithopter/AtreidesFaction/Medium`,
    // Ailes déployées (44 m, comme le proxy). SK_AMO_DF_Wings = les six ailes réunies.
    pieces: ['SK_AMO_Body', 'SK_AMO_Chassis', 'SK_AMO_Cockpit', 'SK_AMO_DF_Wings',
      'SM_AMO_Body_Interior', 'SM_AMO_Cockpit_Interior', 'SM_AMO_Cockpit_Glass',
      'SM_AMO_Engine', 'SM_AMO_PSU', 'SM_AMO_Inventory', 'SM_AMO_Tails'] },
  OrniTransport: { sortie: 'SM_Composite_CTO_Ornithopter_Transport', dossier: `${V}/FlyingVehicles/Ornithopter/ChoamFaction/Transport`,
    // Ailes déployées (68 m, comme le proxy). SK_CTO_Locomotion = les huit ailes réunies.
    pieces: ['SK_CTO_Chassis', 'SK_CTO_Cockpit', 'SK_CTO_Locomotion',
      'SM_CTO_Hull_Main_L', 'SM_CTO_Hull_Main_R', 'SM_CTO_Hull_Tail_L', 'SM_CTO_Hull_Tail_R',
      'SM_CTO_Engine', 'SM_CTO_PSU', 'SM_CTO_Interior', 'SM_CTO_Turbine_L', 'SM_CTO_Turbine_R', 'SM_CTO_Cockpit_Glass'] },
  Chenillette: { sortie: 'SM_Composite_CIGC_Sandcrawler', dossier: `${V}/GroundVehicles/GroundCar/ChoamFaction/Industrial`,
    pieces: ['SK_CIGC_Chassis', 'SK_CIGC_Cockpit', 'SK_CIGC_LM_Treads',               // les deux chenilles réunies
      'SK_CIGC_UT_Header', 'SK_CIGC_UT_Cylinder',
      'SM_CIGC_Engine', 'SM_CIGC_PowerSupply', 'SM_CIGC_Cockpit_Interior', 'SM_CIGC_Cockpit_Glass'] },
  // Le tank (« 4MGC », pas encore sorti) : canon sur la tourelle, booster à l'arrière ; les
  // vitres et bandes de chenilles statiques sont en coordonnées locales (portées par un os).
  Tank: { sortie: 'SM_Composite_CH_4MGC_Tank', dossier: `${V}/GroundVehicles/GroundCar/ChoamFaction/4Man`,
    pieces: ['Body', 'Chassis', 'Cockpit', 'Locomotion_FL', 'Locomotion_FR', 'Locomotion_RL', 'Locomotion_RR', 'UT_Gun', 'UT_Boost']
      .map(n => `SK_CH_4MGC_${n}`).concat(['Body_Interior', 'Engine', 'PSU'].map(n => `SM_CH_4MGC_${n}`)) },
};
const choisis = Object.entries(VEHICULES).filter(([k]) => !SEUL.length || SEUL.includes(k));

// ── 1. Extraction des pièces ───────────────────────────────────────────────────────
fs.mkdirSync(MESHES, { recursive: true });
const conf = JSON.parse(fs.readFileSync(path.join(EXTRACT, 'extract.config.json'), 'utf8'));
delete conf.meshes.extra;
conf.out = path.join(TRAVAIL, 'json');
conf.mapstructtypes = path.resolve(EXTRACT, conf.mapstructtypes || '../mapstructtypes.json');
conf.targets = [];
const confTemp = path.join(TRAVAIL, 'config.json');
fs.writeFileSync(confTemp, JSON.stringify(conf));
const manquantes = choisis.flatMap(([, v]) => v.pieces.map(p => ({ p, v })))
  .filter(({ p }) => !fs.existsSync(path.join(MESHES, p + '.glb')));
if (manquantes.length) {
  const catalogue = path.join(TRAVAIL, 'catalogue.json');
  fs.writeFileSync(catalogue, JSON.stringify({ pieces: manquantes.map(({ p, v }) => ({ mesh_path: `${v.dossier}/Mesh/${p}.${p}` })) }));
  console.log(`▶ extraction de ${manquantes.length} pièce(s) (priorité basse)…`);
  execFileSync(EXE, ['--config', confTemp, '--meshes', '--catalogue', catalogue, '--models', MESHES, '--lod', String(LOD)],
    { cwd: EXTRACT, stdio: ['ignore', 'inherit', 'inherit'] });
}

// ── 2. Lecture des pièces ──────────────────────────────────────────────────────────
const lireGlb = f => {
  const b = fs.readFileSync(f), len = b.readUInt32LE(12);
  return { json: JSON.parse(b.slice(20, 20 + len).toString()), bin: b.slice(20 + len + 8) };
};
const lire = (g, id, comps) => {
  const a = g.json.accessors[id], bv = g.json.bufferViews[a.bufferView];
  const base = (bv.byteOffset || 0) + (a.byteOffset || 0), pas = bv.byteStride || comps * 4, out = new Float32Array(a.count * comps);
  for (let i = 0; i < a.count; i++) for (let k = 0; k < comps; k++) out[i * comps + k] = g.bin.readFloatLE(base + i * pas + k * 4);
  return out;
};
const lireIdx = (g, id) => {
  const a = g.json.accessors[id], bv = g.json.bufferViews[a.bufferView], base = (bv.byteOffset || 0) + (a.byteOffset || 0);
  const t = { 5121: 1, 5123: 2, 5125: 4 }[a.componentType], out = new Uint32Array(a.count);
  for (let i = 0; i < a.count; i++) out[i] = t === 4 ? g.bin.readUInt32LE(base + i * 4) : t === 2 ? g.bin.readUInt16LE(base + i * 2) : g.bin[base + i];
  return out;
};

// ── 3. Fusion : un mesh, une primitive par morceau, les matériaux gardés par NOM ─────────
function ecrireGlb(f, prims, nomsMat, nom) {
  const morceaux = [], vues = [], acces = [];
  let dec = 0;
  const ajouter = (t, cible) => {
    const buf = Buffer.from(t.buffer, t.byteOffset, t.byteLength);
    morceaux.push(buf); vues.push({ buffer: 0, byteOffset: dec, byteLength: buf.length, ...(cible ? { target: cible } : {}) });
    dec += buf.length; while (dec % 4) { morceaux.push(Buffer.alloc(1)); dec++; }
    return vues.length - 1;
  };
  const primitives = prims.map(p => {
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < p.pos.length; i++) { mn[i % 3] = Math.min(mn[i % 3], p.pos[i]); mx[i % 3] = Math.max(mx[i % 3], p.pos[i]); }
    const n = p.pos.length / 3, attr = {};
    acces.push({ bufferView: ajouter(p.pos, 34962), componentType: 5126, count: n, type: 'VEC3', min: mn, max: mx }); attr.POSITION = acces.length - 1;
    if (p.nor) { acces.push({ bufferView: ajouter(p.nor, 34962), componentType: 5126, count: n, type: 'VEC3' }); attr.NORMAL = acces.length - 1; }
    p.uvs.forEach((uv, k) => { if (uv) { acces.push({ bufferView: ajouter(uv, 34962), componentType: 5126, count: n, type: 'VEC2' }); attr['TEXCOORD_' + k] = acces.length - 1; } });
    acces.push({ bufferView: ajouter(p.idx, 34963), componentType: p.idx instanceof Uint16Array ? 5123 : 5125, count: p.idx.length, type: 'SCALAR' });
    return { attributes: attr, indices: acces.length - 1, material: p.mat };
  });
  const gltf = {
    asset: { version: '2.0', generator: GENERATEUR },
    scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: nom }],
    meshes: [{ name: nom, primitives }],
    materials: nomsMat.map(name => ({ name })),
    accessors: acces, bufferViews: vues, buffers: [{ byteLength: dec }],
  };
  let js = Buffer.from(JSON.stringify(gltf));
  while (js.length % 4) js = Buffer.concat([js, Buffer.from(' ')]);
  const bin = Buffer.concat(morceaux);
  const tete = Buffer.alloc(12); tete.write('glTF', 0); tete.writeUInt32LE(2, 4); tete.writeUInt32LE(28 + js.length + bin.length, 8);
  const bj = Buffer.alloc(8); bj.writeUInt32LE(js.length, 0); bj.write('JSON', 4);
  const bb = Buffer.alloc(8); bb.writeUInt32LE(bin.length, 0); bb.write('BIN\0', 4);
  fs.writeFileSync(f, Buffer.concat([tete, bj, js, bb, bin]));
}

/** Position (repère du maillage) de l'os nommé, d'après sa matrice de liaison inverse. */
function positionOs(g, nom) {
  const s = g.json.skins && g.json.skins[0];
  if (!s) return null;
  const k = s.joints.findIndex(n => (g.json.nodes[n].name || '').toLowerCase() === nom);
  if (k < 0) return null;
  const a = g.json.accessors[s.inverseBindMatrices], bv = g.json.bufferViews[a.bufferView];
  const o = (bv.byteOffset || 0) + (a.byteOffset || 0) + k * 64, m = [];
  for (let i = 0; i < 16; i++) m.push(g.bin.readFloatLE(o + i * 4));
  // Inverse d'une matrice rigide (colonnes) : t = −Rᵀ·t_ibm.
  return [0, 1, 2].map(c => -(m[c * 4] * m[12] + m[c * 4 + 1] * m[13] + m[c * 4 + 2] * m[14]));
}

for (const [cle, v] of choisis) {
  const prims = [], nomsMat = [], boites = [];
  const chassis = v.pieces.find(p => /^SK_.*Chassis/.test(p));
  const gc = chassis && fs.existsSync(path.join(MESHES, chassis + '.glb')) ? lireGlb(path.join(MESHES, chassis + '.glb')) : null;
  const osBody = gc && positionOs(gc, 'body');
  const releve = osBody ? Math.abs(osBody[1]) : 0;
  for (const piece of v.pieces) {
    const f = path.join(MESHES, piece + '.glb');
    if (!fs.existsSync(f)) { console.warn(`  ✘ ${cle} : ${piece} introuvable`); continue; }
    const g = lireGlb(f);
    const dy = piece === chassis ? 0 : releve;
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (const m of g.json.meshes || []) for (const p of m.primitives) {
      const nomMat = (g.json.materials && g.json.materials[p.material] || {}).name || '';
      if (/Decal|_DM$/i.test(nomMat)) continue;                        // décalcomanies
      const pos = lire(g, p.attributes.POSITION, 3);
      if (dy) for (let i = 1; i < pos.length; i += 3) pos[i] += dy;
      for (let i = 0; i < pos.length; i++) { mn[i % 3] = Math.min(mn[i % 3], pos[i]); mx[i % 3] = Math.max(mx[i % 3], pos[i]); }
      const nor = p.attributes.NORMAL != null ? lire(g, p.attributes.NORMAL, 3) : null;
      const uvs = [0, 1, 2].map(k => p.attributes['TEXCOORD_' + k] != null ? lire(g, p.attributes['TEXCOORD_' + k], 2) : null);
      const n = pos.length / 3;
      const idx = p.indices != null ? lireIdx(g, p.indices) : Uint32Array.from({ length: n }, (_, i) => i);
      if (!nomsMat.includes(nomMat)) nomsMat.push(nomMat);
      prims.push({ pos, nor, uvs, idx: n <= 65535 ? Uint16Array.from(idx) : idx, mat: nomsMat.indexOf(nomMat) });
    }
    boites.push(`${piece.padEnd(36)} x ${mn[0].toFixed(2)}…${mx[0].toFixed(2)}  y ${mn[1].toFixed(2)}…${mx[1].toFixed(2)}  z ${mn[2].toFixed(2)}…${mx[2].toFixed(2)}`);
  }
  if (INVENTAIRE) { console.log(`\n## ${cle}`); boites.forEach(b => console.log('  ' + b)); continue; }
  if (!prims.length) continue;
  const dst = path.join(BASE, v.sortie + '.glb');
  ecrireGlb(dst, prims, nomsMat, v.sortie);
  console.log(`✔ ${cle} → ${path.basename(dst)} (relevé ${releve.toFixed(2)} m, ${v.pieces.length} pièces, ${prims.length} morceaux, ${(fs.statSync(dst).size / 1048576).toFixed(1)} Mo)`);
}
