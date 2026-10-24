#!/usr/bin/env node
/**
 * build_tank_model.js — Modèle du tank (« 4MGC », pas encore sorti) pour le planner :
 * pièces du jeu assemblées en un seul .glb, COLORÉ d'après ses vrais matériaux.
 *
 *   node tools/build_tank_model.js            → <base des modèles>/SM_Composite_CH_4MGC_Tank.glb
 *
 * Pourquoi un script dédié :
 *  - le tank n'a PAS de modèle simplifié d'un seul tenant (les autres véhicules ont un
 *    SM_ProxyMesh) : seulement des pièces squelettiques (caisse, châssis, cockpit, 4 chenilles,
 *    tourelle, modules). Elles sont modélisées EN PLACE : posées à la même origine, elles
 *    forment le tank — aucun calcul de position (vérifié le 2026-10-24) ;
 *  - le jeu ne contient pas de texture « couleur » d'une pièce : son matériau superpose 12
 *    COUCHES de la bibliothèque du jeu (métal peint, aluminium, or CHOAM, cuir, caoutchouc…)
 *    et chaque morceau de la pièce choisit sa couche par son 2e jeu de coordonnées (TEXCOORD_1),
 *    qui pointe dans une case de la grille T_LayerPreset_12_V2_ID_IndexMap_D (5 colonnes ×
 *    2 rangées + 2 petites cases = 12). On recompose donc une APPROXIMATION : chaque sommet
 *    prend la couleur moyenne de la texture de sa couche × la teinte de la couche (« Layer
 *    ColorTint » du matériau ou de ses parents). Pas d'usure, de saleté ni de motif fin : les
 *    zones peinture / métal / or / caoutchouc sont à leur place, pas plus. La couche 0 (la
 *    peinture principale) est celle que le joueur personnalise : elle garde la couleur de sa
 *    texture de base.
 *
 * Le .glb produit n'a que POSITION, NORMAL, COLOR_0 (linéaire, octets normalisés) et les indices ;
 * planner_mesh.js affiche ses couleurs quand la pièce porte `mesh_colors: true`.
 * Lourd à refaire (deux montages des paks) : à relancer seulement si le tank change.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');

const RACINE = path.resolve(__dirname, '..');
const EXTRACT = path.join(RACINE, 'tools/extract');
const EXE = path.join(EXTRACT, 'bin/Release/net10.0/DuneExtract.exe');
const SORTIE = path.join(require('./models_dir')(), 'SM_Composite_CH_4MGC_Tank.glb');
const TRAVAIL = path.join(os.tmpdir(), 'dunemap_tank');
const DOSSIER = '/Game/Dune/Vehicles/GroundVehicles/GroundCar/ChoamFaction/4Man';

// Configuration représentée : canon sur la tourelle, booster à l'arrière (emplacements à
// variantes : canon ou lance-flammes ; booster, stockage ou bouclier).
const PIECES = ['Body', 'Chassis', 'Cockpit', 'Locomotion_FL', 'Locomotion_FR', 'Locomotion_RL',
  'Locomotion_RR', 'UT_Gun', 'UT_Boost'].map(n => `SK_CH_4MGC_${n}`);

function extraire(args) {
  execFileSync(EXE, args, { cwd: EXTRACT, stdio: ['ignore', 'inherit', 'inherit'] });
}

// ── 1. Pièces (.glb) et matériaux (JSON) ───────────────────────────────────────────
fs.rmSync(TRAVAIL, { recursive: true, force: true });
fs.mkdirSync(path.join(TRAVAIL, 'meshes'), { recursive: true });
const conf = JSON.parse(fs.readFileSync(path.join(EXTRACT, 'extract.config.json'), 'utf8'));
delete conf.meshes.extra;                                    // seulement les pièces du tank
conf.out = path.join(TRAVAIL, 'json');
conf.mapstructtypes = path.resolve(EXTRACT, conf.mapstructtypes || '../mapstructtypes.json');
conf.targets = [
  { id: 'materiaux', path: DOSSIER.replace('/Game/', '') + '/Materials', mode: 'dir' },
  { id: 'maitre', path: 'Art/MaterialLibrary/Materials/Master/MI_DuneMaster_Vehicle', mode: 'file' },
];
const confTemp = path.join(TRAVAIL, 'config.json');
fs.writeFileSync(confTemp, JSON.stringify(conf));
const catalogue = path.join(TRAVAIL, 'catalogue.json');
fs.writeFileSync(catalogue, JSON.stringify({ pieces: PIECES.map(p => ({ mesh_path: `${DOSSIER}/Mesh/${p}.${p}` })) }));
console.log('▶ extraction des pièces et des matériaux…');
extraire(['--config', confTemp, '--meshes', '--catalogue', catalogue, '--models', path.join(TRAVAIL, 'meshes')]);

// ── 2. Matériaux : couches (textures de base), teintes, grille des couches ───────────
const jsonDe = objet => {   // « /Game/Dune/X/Y.Y » ou ObjectPath → fichier JSON exporté
  const rel = String(objet).replace(/\.\d+$/, '').replace(/\.[^/.]+$/, '').replace(/^\/Game\//, 'DuneSandbox/Content/');
  const f = path.join(conf.out, rel + '.json');
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
};
function chaine(nomMateriau) {   // le matériau et ses parents, du plus précis au plus général
  const out = [];
  let doc = jsonDe(`${DOSSIER}/Materials/${nomMateriau}`);
  while (doc && out.length < 6) {
    const exports = Array.isArray(doc) ? doc : [doc];
    const principal = exports.find(e => /Material/.test(e.Type || '')) || exports[0];
    out.push({ exports, props: principal.Properties || {} });
    const parent = principal.Properties && principal.Properties.Parent;
    doc = parent ? jsonDe(parent.ObjectPath) : null;
  }
  return out;
}
function couches(nomMateriau) {
  const ch = chaine(nomMateriau);
  if (!ch.length) return null;
  let textures = null, grille = null;
  const teintes = {};
  for (const { exports, props } of ch) {
    if (!grille && props.OpaqueLayerIndexMap) grille = props.OpaqueLayerIndexMap.ObjectPath;
    for (const v of props.VectorParameterValues || []) {
      if (v.ParameterInfo.Name === 'Layer ColorTint' && !(v.ParameterInfo.Index in teintes)) {
        const c = v.ParameterValue; teintes[v.ParameterInfo.Index] = [c.R, c.G, c.B];
      }
    }
    if (!textures) {
      const ref = (props.TextureParameterValues || []).find(t => t.ParameterInfo.Name === 'Layer BaseColor');
      const nomRef = ref && ref.ParameterValue && String(ref.ParameterValue.ObjectName).split(':').pop().replace(/'$/, '');
      const tableau = nomRef && exports.find(e => e.Type === 'Texture2DRefArray' && e.Name === nomRef);
      if (tableau) textures = tableau.Properties.Textures.map(t => t.ObjectPath.replace(/\.\d+$/, ''));
    }
  }
  return { textures, teintes, grille };
}

const piecesGlb = PIECES.map(p => {
  const b = fs.readFileSync(path.join(TRAVAIL, 'meshes', p + '.glb'));
  const len = b.readUInt32LE(12);
  return { nom: p, json: JSON.parse(b.slice(20, 20 + len).toString()), bin: b.slice(20 + len + 8) };
});
const parMateriau = {};
for (const pg of piecesGlb) for (const m of pg.json.materials || []) {
  if (/Decal|_DM$/i.test(m.name) || parMateriau[m.name]) continue;
  parMateriau[m.name] = couches(m.name);
  if (!parMateriau[m.name] || !parMateriau[m.name].textures) throw new Error(`couches introuvables pour ${m.name}`);
}

// ── 3. Textures des couches + grille → PNG, puis couleur moyenne ──────────────────
const aDecoder = new Set();
for (const c of Object.values(parMateriau)) { c.textures.forEach(t => aDecoder.add(t)); if (c.grille) aDecoder.add(c.grille.replace(/\.\d+$/, '')); }
fs.mkdirSync(path.join(TRAVAIL, 'tex'), { recursive: true });
console.log(`▶ décodage de ${aDecoder.size} textures…`);
extraire(['--config', confTemp, '--models', path.join(TRAVAIL, 'tex'), '--textures', [...aDecoder].join(',')]);

/** PNG 8 bits non entrelacé (ce que produit l'encodeur de CUE4Parse) → { w, h, canaux, data }. */
function lirePng(f) {
  const b = fs.readFileSync(f);
  let pos = 8, w, h, type, idat = [];
  while (pos < b.length) {
    const len = b.readUInt32BE(pos), nom = b.toString('ascii', pos + 4, pos + 8), d = b.slice(pos + 8, pos + 8 + len);
    if (nom === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); if (d[8] !== 8 || d[12] !== 0) throw new Error(`PNG non géré : ${f}`); type = d[9]; }
    else if (nom === 'IDAT') idat.push(d);
    pos += 12 + len;
  }
  const canaux = { 0: 1, 2: 3, 4: 2, 6: 4 }[type];
  const brut = zlib.inflateSync(Buffer.concat(idat)), ligne = w * canaux, data = Buffer.alloc(h * ligne);
  for (let y = 0; y < h; y++) {
    const filtre = brut[y * (ligne + 1)], src = brut.subarray(y * (ligne + 1) + 1, (y + 1) * (ligne + 1));
    for (let x = 0; x < ligne; x++) {
      const a = x >= canaux ? data[y * ligne + x - canaux] : 0, bb = y ? data[(y - 1) * ligne + x] : 0;
      const c = (x >= canaux && y) ? data[(y - 1) * ligne + x - canaux] : 0;
      let v = src[x];
      if (filtre === 1) v += a; else if (filtre === 2) v += bb; else if (filtre === 3) v += (a + bb) >> 1;
      else if (filtre === 4) { const p = a + bb - c, pa = Math.abs(p - a), pb = Math.abs(p - bb), pc = Math.abs(p - c); v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? bb : c); }
      data[y * ligne + x] = v & 255;
    }
  }
  return { w, h, canaux, data };
}
const versLineaire = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
const moyennes = {};
function moyenne(chemin) {
  if (moyennes[chemin]) return moyennes[chemin];
  const f = path.join(TRAVAIL, 'tex', chemin.split('/').pop() + '.png');
  if (!fs.existsSync(f)) return (moyennes[chemin] = [0.5, 0.5, 0.5]);
  const t = lirePng(f), s = [0, 0, 0];
  let n = 0;
  for (let i = 0; i < t.w * t.h; i += 7) {
    for (let k = 0; k < 3; k++) s[k] += versLineaire(t.data[i * t.canaux + Math.min(k, t.canaux - 1)]);
    n++;
  }
  return (moyennes[chemin] = s.map(v => v / n));
}
const grilles = {};
function grille(chemin) {
  const cle = chemin.replace(/\.\d+$/, '');
  if (!grilles[cle]) grilles[cle] = lirePng(path.join(TRAVAIL, 'tex', cle.split('/').pop() + '.png'));
  return grilles[cle];
}

// ── 4. Couleur par sommet, et fusion en un seul .glb ─────────────────────────────
const lire = (pg, idAcc, comps) => {
  const a = pg.json.accessors[idAcc], bv = pg.json.bufferViews[a.bufferView];
  const base = (bv.byteOffset || 0) + (a.byteOffset || 0), pas = bv.byteStride || comps * 4, out = new Float32Array(a.count * comps);
  for (let i = 0; i < a.count; i++) for (let k = 0; k < comps; k++) out[i * comps + k] = pg.bin.readFloatLE(base + i * pas + k * 4);
  return out;
};
const lireIndices = (pg, idAcc) => {
  const a = pg.json.accessors[idAcc], bv = pg.json.bufferViews[a.bufferView], base = (bv.byteOffset || 0) + (a.byteOffset || 0);
  const out = new Uint32Array(a.count), taille = { 5121: 1, 5123: 2, 5125: 4 }[a.componentType];
  for (let i = 0; i < a.count; i++) out[i] = taille === 4 ? pg.bin.readUInt32LE(base + i * 4) : taille === 2 ? pg.bin.readUInt16LE(base + i * 2) : pg.bin[base + i];
  return out;
};
const primitives = [];
const comptes = {};
for (const pg of piecesGlb) for (const m of pg.json.meshes) for (const p of m.primitives) {
  const nomMat = (pg.json.materials[p.material] || {}).name || '';
  if (/Decal|_DM$/i.test(nomMat)) continue;                                 // décalcomanies : rien à voir de loin
  const c = parMateriau[nomMat], g = grille(c.grille || '/Game/Dune/Art/MaterialLibrary/Textures/LayerPresets/T_LayerPreset_12_V2_ID_IndexMap_D');
  const pos = lire(pg, p.attributes.POSITION, 3), nor = lire(pg, p.attributes.NORMAL, 3), uv = lire(pg, p.attributes.TEXCOORD_1, 2);
  const n = pos.length / 3, col = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const x = Math.min(g.w - 1, Math.max(0, Math.floor(uv[i * 2] * g.w))), y = Math.min(g.h - 1, Math.max(0, Math.floor(uv[i * 2 + 1] * g.h)));
    const couche = Math.min(c.textures.length - 1, g.data[(y * g.w + x) * g.canaux]);
    comptes[couche] = (comptes[couche] || 0) + 1;
    const base = moyenne(c.textures[couche]), t = c.teintes[couche] || [1, 1, 1];
    for (let k = 0; k < 3; k++) col[i * 4 + k] = Math.round(255 * Math.min(1, base[k] * t[k]));
    col[i * 4 + 3] = 255;
  }
  const idx = p.indices != null ? lireIndices(pg, p.indices) : Uint32Array.from({ length: n }, (_, i) => i);
  primitives.push({ pos, nor, col, idx: n <= 65535 ? Uint16Array.from(idx) : idx });   // 2 octets par indice quand ça tient
}

// Écriture glTF binaire : un mesh, une primitive par morceau, un matériau à couleurs de sommets.
const morceaux = [], vues = [], acces = [], prims = [];
let decalage = 0;
const ajouter = (typed, cible) => {
  const buf = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
  morceaux.push(buf); vues.push({ buffer: 0, byteOffset: decalage, byteLength: buf.length, ...(cible ? { target: cible } : {}) });
  decalage += buf.length; while (decalage % 4) { morceaux.push(Buffer.alloc(1)); decalage++; }
  return vues.length - 1;
};
for (const p of primitives) {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.pos.length; i++) { mn[i % 3] = Math.min(mn[i % 3], p.pos[i]); mx[i % 3] = Math.max(mx[i % 3], p.pos[i]); }
  const n = p.pos.length / 3;
  acces.push({ bufferView: ajouter(p.pos, 34962), componentType: 5126, count: n, type: 'VEC3', min: mn, max: mx });
  acces.push({ bufferView: ajouter(p.nor, 34962), componentType: 5126, count: n, type: 'VEC3' });
  // Couleurs en octets normalisés (VEC4 : un attribut de sommet doit faire un multiple de 4 octets).
  acces.push({ bufferView: ajouter(p.col, 34962), componentType: 5121, normalized: true, count: n, type: 'VEC4' });
  acces.push({ bufferView: ajouter(p.idx, 34963), componentType: p.idx instanceof Uint16Array ? 5123 : 5125, count: p.idx.length, type: 'SCALAR' });
  const a = acces.length - 4;
  prims.push({ attributes: { POSITION: a, NORMAL: a + 1, COLOR_0: a + 2 }, indices: a + 3, material: 0 });
}
const gltf = {
  asset: { version: '2.0', generator: 'DuneMap tools/build_tank_model.js' },
  scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: 'Tank_4MGC' }],
  meshes: [{ name: 'Tank_4MGC', primitives: prims }],
  materials: [{ name: 'couleurs_des_couches', pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0.2, roughnessFactor: 0.8 }, doubleSided: true }],
  accessors: acces, bufferViews: vues, buffers: [{ byteLength: decalage }],
};
let js = Buffer.from(JSON.stringify(gltf));
while (js.length % 4) js = Buffer.concat([js, Buffer.from(' ')]);
const bin = Buffer.concat(morceaux);
const tete = Buffer.alloc(12); tete.write('glTF', 0); tete.writeUInt32LE(2, 4); tete.writeUInt32LE(12 + 8 + js.length + 8 + bin.length, 8);
const blocJ = Buffer.alloc(8); blocJ.writeUInt32LE(js.length, 0); blocJ.write('JSON', 4);
const blocB = Buffer.alloc(8); blocB.writeUInt32LE(bin.length, 0); blocB.write('BIN\0', 4);
fs.writeFileSync(SORTIE, Buffer.concat([tete, blocJ, js, blocB, bin]));
const total = Object.values(comptes).reduce((s, v) => s + v, 0);
console.log(`✔ ${path.basename(SORTIE)} — ${primitives.length} morceaux, ${total} sommets, ${(fs.statSync(SORTIE).size / 1048576).toFixed(1)} Mo`);
console.log('  répartition des couches :', Object.entries(comptes).map(([c, v]) => `${c}: ${Math.round(100 * v / total)} %`).join(' · '));
