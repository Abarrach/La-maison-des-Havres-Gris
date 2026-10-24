#!/usr/bin/env node
/**
 * build_colored_models.js — Modèles du planner EN COULEURS et allégés (2026-10-24).
 *
 *   node tools/build_colored_models.js              → <base>/../models_planner/*.glb
 *   node tools/build_colored_models.js --extraire   (refait l'extraction des matériaux)
 *   node tools/build_colored_models.js --seul=SM_Truc,SM_Machin   (essai sur quelques modèles)
 *
 * Même méthode que le tank (tools/build_tank_model.js), appliquée à tous les modèles que
 * planner_pieces.json référence : le jeu n'a pas de texture « couleur » d'une pièce, son
 * matériau superpose 12 couches de la bibliothèque du jeu, et chaque morceau choisit sa
 * couche par son 2e jeu de coordonnées (TEXCOORD_1), qui pointe dans une case de la grille
 * du matériau (OpaqueLayerIndexMap). Chaque sommet prend la couleur moyenne de la texture
 * de sa couche × la teinte de la couche (« Layer ColorTint », matériau puis parents).
 * Approximation : pas d'usure, de saleté ni de motif ; la peinture personnalisable garde
 * sa couleur de base.
 *
 * TEXTURES (2026-10-24, 2e passe) : en plus de la couleur moyenne, chaque sommet garde le
 * numéro de sa couche (alpha de COLOR_0, local à la primitive) et ses coordonnées de couche
 * (TEXCOORD_0 = UV2 du jeu × « Layer Tiling »). La primitive porte dans ses extras la table
 * de ses couches { t: texture, c: teinte }. Les textures (JPEG 256 px) sont partagées par
 * toutes les pièces : models_planner/couches/*.jpg + couches.json. Le planner les applique ;
 * sans elles, il retombe sur la couleur moyenne.
 *
 * Sortie ALLÉGÉE : POSITION, NORMAL, COLOR_0 (octets normalisés), TEXCOORD_0 et indices seulement. Les
 * modèles source (base locale, tools/models_dir.js) portent 8 jeux de coordonnées, des
 * tangentes et des couleurs que le planner n'utilise pas : 545 Mo → ~150 Mo. La base source
 * reste INTACTE (c'est d'elle qu'on recalcule les couleurs) ; models_planner/ est ce qu'on
 * envoie au serveur, dans /srv/dune-map/models/, sous les mêmes noms.
 *
 * Tourne en priorité basse : l'extraction (lecture des paks) peut se faire pendant qu'on joue.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');

try { os.setPriority(0, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* sans effet hors Windows/Linux */ }

const RACINE = path.resolve(__dirname, '..');
const EXTRACT = path.join(RACINE, 'tools/extract');
const EXE = path.join(EXTRACT, 'bin/Release/net10.0/DuneExtract.exe');
const SOURCE = require('./models_dir')();
const SORTIE = path.join(path.dirname(SOURCE), 'models_planner');
const TRAVAIL = path.join(os.tmpdir(), 'dunemap_couleurs');
const ARGS = process.argv.slice(2);
const SEUL = (ARGS.find(a => a.startsWith('--seul=')) || '').slice(7).split(',').filter(Boolean);
const GENERATEUR = 'DuneMap tools/build_colored_models.js';
const ARGILE = [0.62, 0.56, 0.46];          // repli : matériau illisible (linéaire)
const VITRE = [0.12, 0.16, 0.2];

// ── 1. Modèles et matériaux à traiter ──────────────────────────────────────────
const pieces = JSON.parse(fs.readFileSync(path.join(RACINE, 'planner_pieces.json'), 'utf8')).pieces;
let modeles = [...new Set(pieces.map(p => p.mesh).filter(Boolean))];
if (SEUL.length) modeles = modeles.filter(m => SEUL.includes(m));
const lireGlb = f => {
  const b = fs.readFileSync(f), len = b.readUInt32LE(12);
  return { json: JSON.parse(b.slice(20, 20 + len).toString()), bin: b.slice(20 + len + 8) };
};
const nomsMateriaux = new Set();
for (const m of modeles) {
  const f = path.join(SOURCE, m + '.glb');
  if (!fs.existsSync(f)) continue;
  const g = lireGlb(f);
  if ((g.json.asset.generator || '').startsWith('DuneMap')) continue;   // déjà produit par nous (tank)
  for (const mat of g.json.materials || []) if (mat.name) nomsMateriaux.add(mat.name);
}
fs.mkdirSync(TRAVAIL, { recursive: true });
const listeMat = path.join(TRAVAIL, 'materiaux.txt');
const dejaListe = fs.existsSync(listeMat) ? new Set(fs.readFileSync(listeMat, 'utf8').split('\n')) : new Set();
const manquants = [...nomsMateriaux].filter(n => !dejaListe.has(n));
if (ARGS.includes('--extraire') || manquants.length) {
  fs.writeFileSync(listeMat, [...new Set([...dejaListe, ...nomsMateriaux])].filter(Boolean).join('\n'));
  console.log(`▶ extraction de ${nomsMateriaux.size} matériaux et des textures de leurs couches (priorité basse)…`);
  execFileSync(EXE, ['--config', path.join(EXTRACT, 'extract.config.json'), '--materiaux', listeMat, '--models', TRAVAIL],
    { cwd: EXTRACT, stdio: ['ignore', 'inherit', 'inherit'] });
} else console.log(`(extraction en cache : ${TRAVAIL})`);

// ── 2. Matériaux : couches, teintes, grille ──────────────────────────────────────
const jsonParNom = {};
(function indexer(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) indexer(p);
    else if (e.name.endsWith('.json')) jsonParNom[e.name.slice(0, -5)] = p;
  }
})(path.join(TRAVAIL, 'json'));
const lireMat = nom => jsonParNom[nom] ? JSON.parse(fs.readFileSync(jsonParNom[nom], 'utf8')) : null;
const nomDepuisChemin = p => String(p || '').replace(/\.\d+$/, '').replace(/\.[^/.]+$/, '').split('/').pop();

const infos = {};
function infoMateriau(nom) {
  if (nom in infos) return infos[nom];
  const chaine = [];
  for (let doc = lireMat(nom), n = 0; doc && n < 8; n++) {
    const ex = Array.isArray(doc) ? doc : [doc];
    const principal = ex.find(e => /Material/.test(e.Type || '')) || ex[0];
    chaine.push({ ex, props: principal.Properties || {} });
    const parent = principal.Properties && principal.Properties.Parent;   // peut être null (référence vide)
    doc = parent && parent.ObjectPath ? lireMat(nomDepuisChemin(parent.ObjectPath)) : null;
  }
  let textures = null, grille = null, couleurPlate = null;
  const teintes = {}, repetitions = {};
  for (const { ex, props } of chaine) {
    if (!grille && props.OpaqueLayerIndexMap && props.OpaqueLayerIndexMap.ObjectPath) grille = nomDepuisChemin(props.OpaqueLayerIndexMap.ObjectPath);
    for (const v of props.ScalarParameterValues || []) {
      if (v.ParameterInfo.Name === 'Layer Tiling' && !(v.ParameterInfo.Index in repetitions)) repetitions[v.ParameterInfo.Index] = v.ParameterValue;
    }
    for (const v of props.VectorParameterValues || []) {
      const nm = v.ParameterInfo.Name, c = v.ParameterValue;
      if (nm === 'Layer ColorTint' && !(v.ParameterInfo.Index in teintes)) teintes[v.ParameterInfo.Index] = [c.R, c.G, c.B];
      if (!couleurPlate && /^(Base ?Color|Color|Tint|Albedo)$/i.test(nm)) couleurPlate = [c.R, c.G, c.B];
    }
    if (!textures) {
      const ref = (props.TextureParameterValues || []).find(t => t.ParameterInfo.Name === 'Layer BaseColor');
      const nomRef = ref && ref.ParameterValue && String(ref.ParameterValue.ObjectName).split(':').pop().replace(/'$/, '');
      const tab = nomRef && ex.find(e => e.Type === 'Texture2DRefArray' && e.Name === nomRef);
      if (tab) textures = tab.Properties.Textures.map(t => nomDepuisChemin(t && t.ObjectPath));
    }
  }
  return (infos[nom] = chaine.length ? { textures, teintes, repetitions, grille, couleurPlate } : null);
}

// ── 3. PNG (8 bits, non entrelacé) et couleurs moyennes ────────────────────────────
function lirePng(f) {
  const b = fs.readFileSync(f);
  let pos = 8, w, h, type;
  const idat = [];
  while (pos < b.length) {
    const len = b.readUInt32BE(pos), nom = b.toString('ascii', pos + 4, pos + 8), d = b.slice(pos + 8, pos + 8 + len);
    if (nom === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); if (d[8] !== 8 || d[12] !== 0) throw new Error(`PNG non géré : ${f}`); type = d[9]; }
    else if (nom === 'IDAT') idat.push(d);
    pos += 12 + len;
  }
  const canaux = { 0: 1, 2: 3, 4: 2, 6: 4 }[type];
  const brut = zlib.inflateSync(Buffer.concat(idat)), ligne = w * canaux, data = Buffer.alloc(h * ligne);
  for (let y = 0; y < h; y++) {
    const f0 = brut[y * (ligne + 1)], src = brut.subarray(y * (ligne + 1) + 1, (y + 1) * (ligne + 1));
    for (let x = 0; x < ligne; x++) {
      const a = x >= canaux ? data[y * ligne + x - canaux] : 0, bb = y ? data[(y - 1) * ligne + x] : 0;
      const c = (x >= canaux && y) ? data[(y - 1) * ligne + x - canaux] : 0;
      let v = src[x];
      if (f0 === 1) v += a; else if (f0 === 2) v += bb; else if (f0 === 3) v += (a + bb) >> 1;
      else if (f0 === 4) { const p = a + bb - c, pa = Math.abs(p - a), pb = Math.abs(p - bb), pc = Math.abs(p - c); v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? bb : c); }
      data[y * ligne + x] = v & 255;
    }
  }
  return { w, h, canaux, data };
}
const lin = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
const cacheTex = {};
function texture(nom) {
  if (nom in cacheTex) return cacheTex[nom];
  const f = path.join(TRAVAIL, 'textures', nom + '.png');
  return (cacheTex[nom] = fs.existsSync(f) ? lirePng(f) : null);
}
const moyennes = {};
function moyenne(nom) {
  if (nom in moyennes) return moyennes[nom];
  const t = texture(nom);
  if (!t) return (moyennes[nom] = null);
  const s = [0, 0, 0]; let n = 0;
  for (let i = 0; i < t.w * t.h; i += 3) { for (let k = 0; k < 3; k++) s[k] += lin(t.data[i * t.canaux + Math.min(k, t.canaux - 1)]); n++; }
  return (moyennes[nom] = s.map(v => v / n));
}

// ── 4. Un modèle : couleurs par sommet, fichier allégé ───────────────────────────
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
const texturesUtilisees = new Set();
const stats = { modeles: 0, avant: 0, apres: 0, sommets: 0, couches: 0, plats: 0, repli: 0, sansTexture: new Set(), sansMat: new Set() };

function colorer(nomModele) {
  const src = path.join(SOURCE, nomModele + '.glb'), dst = path.join(SORTIE, nomModele + '.glb');
  if (!fs.existsSync(src)) return;
  const g = lireGlb(src);
  stats.avant += fs.statSync(src).size;
  if ((g.json.asset.generator || '').startsWith('DuneMap')) {        // déjà allégé et coloré (tank)
    fs.copyFileSync(src, dst); stats.apres += fs.statSync(dst).size; stats.modeles++; return;
  }
  const meshesSortie = [];
  for (const m of g.json.meshes || []) {
    const prims = [];
    for (const p of m.primitives) {
      const nomMat = (g.json.materials && g.json.materials[p.material] || {}).name || '';
      if (/Decal|_DM$/i.test(nomMat)) continue;                        // décalcomanies : rien à voir de loin
      const info = infoMateriau(nomMat);
      if (!info) stats.sansMat.add(nomMat);
      const pos = lire(g, p.attributes.POSITION, 3);
      const nor = p.attributes.NORMAL != null ? lire(g, p.attributes.NORMAL, 3) : null;
      const n = pos.length / 3, col = new Uint8Array(n * 4);
      const grille = info && info.textures && info.grille ? texture(info.grille) : null;
      const uv = grille && p.attributes.TEXCOORD_1 != null ? lire(g, p.attributes.TEXCOORD_1, 2) : null;
      // UV2 du jeu : coordonnées répétées des couches (UV0 = dépliage unique de la pièce).
      const uv2 = uv && p.attributes.TEXCOORD_2 != null ? lire(g, p.attributes.TEXCOORD_2, 2) : null;
      const uvc = uv2 ? new Float32Array(n * 2) : null;
      const locales = new Map(), table = [];             // couche du matériau → n° local
      const localeDe = couche => {
        if (!locales.has(couche)) {
          const tex = info.textures[couche] || null, tn = info.teintes[couche] || [1, 1, 1];
          if (tex) texturesUtilisees.add(tex);
          locales.set(couche, table.length);
          table.push({ t: tex, c: tn.map(v => +Math.min(4, Math.max(0, v)).toFixed(4)) });
        }
        return locales.get(couche);
      };
      let plate = null;
      if (!uv) {
        plate = /glass|glas|vitre|window/i.test(nomMat) ? VITRE
          : (info && info.couleurPlate) ? info.couleurPlate
          : (info && info.textures && moyenne(info.textures[0])) ? info.textures.length && moyenne(info.textures[0]).map((v, k) => v * ((info.teintes[0] || [1, 1, 1])[k]))
          : ARGILE;
        if (plate === ARGILE) stats.repli += n; else stats.plats += n;
      } else stats.couches += n;
      for (let i = 0; i < n; i++) {
        let c = plate;
        if (!c) {
          const fu = uv[i * 2] - Math.floor(uv[i * 2]), fv = uv[i * 2 + 1] - Math.floor(uv[i * 2 + 1]);   // la grille se répète
          const x = Math.min(grille.w - 1, Math.floor(fu * grille.w)), y = Math.min(grille.h - 1, Math.floor(fv * grille.h));
          const couche = Math.min(info.textures.length - 1, grille.data[(y * grille.w + x) * grille.canaux]);
          const base = moyenne(info.textures[couche]);
          if (!base) stats.sansTexture.add(info.textures[couche]);
          const t = info.teintes[couche] || [1, 1, 1];
          c = (base || ARGILE).map((v, k) => v * t[k]);
          if (uvc) {
            col[i * 4 + 3] = localeDe(couche);
            const rep = info.repetitions[couche] ?? 1;
            uvc[i * 2] = uv2[i * 2] * rep; uvc[i * 2 + 1] = uv2[i * 2 + 1] * rep;
          } else col[i * 4 + 3] = 255;
        } else col[i * 4 + 3] = 255;                                    // 255 = pas de texture
        for (let k = 0; k < 3; k++) col[i * 4 + k] = Math.round(255 * Math.min(1, Math.max(0, c[k])));
      }
      const idx = p.indices != null ? lireIdx(g, p.indices) : Uint32Array.from({ length: n }, (_, i) => i);
      prims.push({ pos, nor, col, uvc: table.length ? uvc : null, couches: table, idx: n <= 65535 ? Uint16Array.from(idx) : idx });
      stats.sommets += n;
    }
    meshesSortie.push({ name: m.name, prims });
  }
  // Nœuds : on garde ceux qui portent un mesh, avec leur transformation (hiérarchie à plat).
  const noeuds = (g.json.nodes || []).filter(nd => nd.mesh != null).map(nd => {
    const o = { mesh: nd.mesh, name: nd.name };
    for (const k of ['matrix', 'translation', 'rotation', 'scale']) if (nd[k]) o[k] = nd[k];
    return o;
  });
  ecrireGlb(dst, meshesSortie, noeuds);
  stats.apres += fs.statSync(dst).size;
  stats.modeles++;
}

function ecrireGlb(f, meshes, noeuds) {
  const morceaux = [], vues = [], acces = [];
  let dec = 0;
  const ajouter = (t, cible) => {
    const buf = Buffer.from(t.buffer, t.byteOffset, t.byteLength);
    morceaux.push(buf); vues.push({ buffer: 0, byteOffset: dec, byteLength: buf.length, ...(cible ? { target: cible } : {}) });
    dec += buf.length; while (dec % 4) { morceaux.push(Buffer.alloc(1)); dec++; }
    return vues.length - 1;
  };
  const gltfMeshes = meshes.map(m => ({ name: m.name, primitives: m.prims.map(p => {
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < p.pos.length; i++) { mn[i % 3] = Math.min(mn[i % 3], p.pos[i]); mx[i % 3] = Math.max(mx[i % 3], p.pos[i]); }
    const n = p.pos.length / 3, attr = {};
    acces.push({ bufferView: ajouter(p.pos, 34962), componentType: 5126, count: n, type: 'VEC3', min: mn, max: mx }); attr.POSITION = acces.length - 1;
    if (p.nor) { acces.push({ bufferView: ajouter(p.nor, 34962), componentType: 5126, count: n, type: 'VEC3' }); attr.NORMAL = acces.length - 1; }
    acces.push({ bufferView: ajouter(p.col, 34962), componentType: 5121, normalized: true, count: n, type: 'VEC4' }); attr.COLOR_0 = acces.length - 1;
    if (p.uvc) { acces.push({ bufferView: ajouter(p.uvc, 34962), componentType: 5126, count: n, type: 'VEC2' }); attr.TEXCOORD_0 = acces.length - 1; }
    acces.push({ bufferView: ajouter(p.idx, 34963), componentType: p.idx instanceof Uint16Array ? 5123 : 5125, count: p.idx.length, type: 'SCALAR' });
    return { attributes: attr, indices: acces.length - 1, material: 0, ...(p.uvc ? { extras: { couches: p.couches } } : {}) };
  }) }));
  const gltf = {
    asset: { version: '2.0', generator: GENERATEUR },
    scene: 0, scenes: [{ nodes: noeuds.map((_, i) => i) }], nodes: noeuds, meshes: gltfMeshes,
    materials: [{ name: 'couleurs_des_couches', pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0.1, roughnessFactor: 0.85 }, doubleSided: true }],
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

// ── 5. Tous les modèles ─────────────────────────────────────────────────────────────
fs.mkdirSync(SORTIE, { recursive: true });
console.log(`▶ ${modeles.length} modèle(s) → ${SORTIE}`);
for (const m of modeles) {
  try { colorer(m); } catch (e) { console.warn(`  ✘ ${m} : ${e.message}`); }
}
// Textures des couches, partagées par toutes les pièces : JPEG copiés tels quels + leur liste.
const DOSSIER_COUCHES = path.join(SORTIE, 'couches');
fs.mkdirSync(DOSSIER_COUCHES, { recursive: true });
const listeCouches = [...texturesUtilisees].sort().filter(nom => {
  const src = path.join(TRAVAIL, 'textures', nom + '.jpg');
  if (!fs.existsSync(src)) return false;
  fs.copyFileSync(src, path.join(DOSSIER_COUCHES, nom + '.jpg'));
  return true;
});
const poidsCouches = listeCouches.reduce((s, nom) => s + fs.statSync(path.join(DOSSIER_COUCHES, nom + '.jpg')).size, 0);
fs.writeFileSync(path.join(SORTIE, 'couches.json'), JSON.stringify({
  _note: 'Écrit par tools/build_colored_models.js : textures de couches appliquées par le planner (couches/<nom>.jpg).',
  textures: listeCouches }) + '\n');
const pc = v => Math.round(100 * v / Math.max(1, stats.sommets));
console.log(`✔ ${stats.modeles} modèle(s) — ${(stats.avant / 1048576).toFixed(0)} Mo → ${(stats.apres / 1048576).toFixed(0)} Mo`);
console.log(`  sommets : ${stats.sommets} — par couches ${pc(stats.couches)} %, couleur unie ${pc(stats.plats)} %, repli argile ${pc(stats.repli)} %`);
console.log(`  textures de couches : ${listeCouches.length}/${texturesUtilisees.size} (${(poidsCouches / 1048576).toFixed(1)} Mo) → ${DOSSIER_COUCHES}`);
if (stats.sansMat.size) console.log(`  matériaux introuvables (${stats.sansMat.size}) : ${[...stats.sansMat].slice(0, 8).join(', ')}${stats.sansMat.size > 8 ? '…' : ''}`);
if (stats.sansTexture.size) console.log(`  textures de couche manquantes (${stats.sansTexture.size}) : ${[...stats.sansTexture].slice(0, 6).join(', ')}`);
