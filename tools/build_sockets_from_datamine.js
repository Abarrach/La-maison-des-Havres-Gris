#!/usr/bin/env node
'use strict';
/**
 * build_sockets_from_datamine.js — Régénère la géométrie d'accroche du planner.
 *
 * ── L'angle mort que ce script comble ───────────────────────────────────────
 * `dune_socket_profiles.json`, `dune_group_config.json` et `dune_pieces_sockets.json`
 * étaient les SEULES données du site sans pipeline : issues d'un reverse engineering
 * manuel (dune.layout.tools + FModel) fait dans une session de 2026-06. Conséquence
 * directe : un set de construction ajouté par un patch arrivait sans aucune accroche,
 * et se posait en mode « cellule » — constaté avec le set Sardaukar du 2026-10-19.
 *
 * Or tout est dans les DataTables du jeu, à condition d'avoir la table des types de
 * `TMap` (cf. tools/build_mapstructtypes.js) :
 *
 *   DT_DuneSocketSetupData   → 71 profils. Deux tableaux PARALLÈLES :
 *                              m_SocketInstances[i]           = transform du socket i
 *                              m_PerInstanceStaticSocketData[i] = ses types + son coût
 *   CDT_BuildableGroupData   → par groupe : m_SocketSetup (quel profil), la rotation
 *                              d'accroche, la forme des coins, l'offset de caméra
 *   base_pieces_v3.json      → quelle pièce appartient à quel groupe
 *
 * La chaîne est donc : pièce → groupe → profil → sockets.
 *
 * ── Vérification plutôt que confiance ───────────────────────────────────────
 * `--check` régénère en mémoire et COMPARE aux fichiers en place sans rien écrire.
 * C'est ainsi qu'on a validé le script : les 71 profils du jeu reproduisent à
 * l'identique ceux obtenus à la main six mois plus tôt.
 *
 * Usage :
 *   node tools/build_sockets_from_datamine.js --check     compare, n'écrit rien
 *   node tools/build_sockets_from_datamine.js             écrit les 3 fichiers
 *   node tools/build_sockets_from_datamine.js [racine_Systems]
 */
const fs = require('fs');
const path = require('path');

const RACINE = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const CHECK = args.includes('--check');
const SYS = args.find(a => !a.startsWith('--'))
  || 'J:/Download/Fmodel/Output/Exports/DuneSandbox/Content/Dune/Systems';
const DATA = path.join(SYS, 'Building/Data');

const F_SETUP = path.join(DATA, 'DT_DuneSocketSetupData.json');
const F_GROUP = path.join(DATA, 'CDT_BuildableGroupData.json');
const F_PIECES = path.join(RACINE, 'base_pieces_v3.json');

for (const [nom, f] of [['DT_DuneSocketSetupData', F_SETUP], ['CDT_BuildableGroupData', F_GROUP], ['base_pieces_v3.json', F_PIECES]]) {
  if (!fs.existsSync(f)) {
    console.error(`Introuvable : ${f}\n→ ${nom} manque. Lance d'abord l'export :`);
    console.error('  DuneExtract --config tools/extract/extract.config.json --only building');
    process.exit(1);
  }
}

const lire = (f) => { const j = JSON.parse(fs.readFileSync(f, 'utf8')); return (Array.isArray(j) ? j[0] : j).Rows || {}; };

/** `BlueprintGeneratedClass'BP_Truc_C'` → `BP_Truc_C` : seul le nom de classe nous sert. */
function nomClasse(ref) {
  const s = (ref && ref.ObjectName) || '';
  const m = s.match(/'([^']+)'/);
  return m ? m[1] : (s || null);
}

/**
 * Lacet (yaw) depuis le quaternion.
 *
 * Les sockets ne tournent que sur Z dans ces données — le vérifier plutôt que le
 * supposer, car notre format ne stocke QUE le lacet : une rotation sur X ou Y serait
 * perdue en silence, et l'accroche partirait de travers sans message d'erreur.
 */
const horsLacet = [];
function yawDeg(rot, contexte) {
  if (!rot) return 0;
  const { X = 0, Y = 0, Z = 0, W = 1 } = rot;
  if (Math.abs(X) > 1e-4 || Math.abs(Y) > 1e-4) horsLacet.push(`${contexte} (X=${X}, Y=${Y})`);
  const deg = 2 * Math.atan2(Z, W) * 180 / Math.PI;
  // Le quaternion redonne 160.528785 là où l'angle réel est 160.53 : on arrondit au
  // centième, et à l'entier quand on en est à un millième près (la plupart des sockets
  // sont à des multiples de 45°). Même raison que pour les positions : éviter un bruit
  // de régénération qui masquerait un vrai changement.
  const centiemes = Math.round(deg * 100) / 100;
  return Math.abs(centiemes - Math.round(centiemes)) < 1e-3 ? Math.round(centiemes) : centiemes;
}

/**
 * Positions arrondies au dixième de centimètre.
 *
 * Le jeu stocke 147.80167 ; le fichier historique (fait à la main) notait 147.8. Garder
 * la précision brute ferait ressortir 16 profils comme « modifiés » à chaque régénération
 * pour deux millièmes de centimètre — du bruit qui masquerait un vrai changement. À
 * l'échelle du planner (1 cellule = 512 unités), 0,1 est déjà sous le seuil du visible.
 */
const nombre = (v) => (typeof v === 'number' ? Math.round(v * 10) / 10 : 0);

// ── 1. Profils de sockets ───────────────────────────────────────────────────
const profils = {};
for (const [nom, ligne] of Object.entries(lire(F_SETUP))) {
  const d = (ligne && ligne.m_SocketSetupData) || {};
  const instances = d.m_SocketInstances || [];
  const statiques = d.m_PerInstanceStaticSocketData || [];
  const sockets = instances.map((inst, i) => {
    const st = statiques[i] || {};
    const t = inst.Translation || {};
    return {
      lx: nombre(t.X), ly: nombre(t.Y), lz: nombre(t.Z),
      yawDeg: yawDeg(inst.Rotation, `${nom}[${i}]`),
      types: (st.m_SocketTypes || []).map(nomClasse).filter(Boolean),
      targetTypes: (st.m_TargetSocketTypes || []).map(nomClasse).filter(Boolean),
      cost: (st.m_SocketCosts && st.m_SocketCosts.Name) || null,
    };
  });
  if (instances.length !== statiques.length) {
    console.warn(`⚠ ${nom} : ${instances.length} transforms pour ${statiques.length} descriptions `
      + '— les deux tableaux doivent être parallèles, résultat douteux.');
  }
  profils[nom] = { sockets };
}

// ── 2. Configuration des groupes ────────────────────────────────────────────
const sansPrefixe = (v) => (typeof v === 'string' ? v.split('::').pop() : v);
const groupes = {};
for (const [nom, g] of Object.entries(lire(F_GROUP))) {
  groupes[nom] = {
    socketSetupName: (g.m_SocketSetup && g.m_SocketSetup.Name) || 'Empty',
    snapRotation: sansPrefixe(g.m_BrushPlacementSnapRotation) || 'SnapOne',
    cornersShape: sansPrefixe(g.m_BuildableBrushCornersShape) || 'Square',
    ghostCameraAngleOffset: nombre(g.m_GhostFacingCameraAngleOffset),
  };
}

// ── 3. Résolution par pièce ─────────────────────────────────────────────────
// `size` et `hasGlb` ne sont PAS dans les DataTables : la taille vient de la boîte
// englobante du .glb et la présence du mesh, du dossier models/. On les reprend donc
// du fichier existant quand il les connaît, plutôt que d'inventer une valeur.
const ancienPieces = fs.existsSync(path.join(RACINE, 'dune_pieces_sockets.json'))
  ? JSON.parse(fs.readFileSync(path.join(RACINE, 'dune_pieces_sockets.json'), 'utf8')) : [];
const ancienParId = new Map(ancienPieces.map(p => [p.templateId, p]));

const catalogue = JSON.parse(fs.readFileSync(F_PIECES, 'utf8')).pieces || [];
const sansGroupe = [];
const pieces = catalogue
  .filter(p => p.group && !p.is_machine && !p.is_vehicle)
  .map(p => {
    const cfg = groupes[p.group];
    if (!cfg) { sansGroupe.push(`${p.id} (groupe ${p.group})`); }
    const profil = cfg ? cfg.socketSetupName : 'Empty';
    const ancien = ancienParId.get(p.id) || {};
    const mesh = p.mesh_path ? p.mesh_path.split('/').pop().split('.')[0] : null;
    return {
      templateId: p.id,
      name: p.label_en || p.label_fr || p.id,
      faction: ancien.faction || p.faction_id || null,
      category: ancien.category || p.category || null,
      group: p.group,
      socketProfile: profil,
      snapRotation: cfg ? cfg.snapRotation : 'SnapOne',
      cornersShape: cfg ? cfg.cornersShape : 'Square',
      isFoundation: !!p.is_foundation,
      isPillar: !!p.is_pillar,
      size: ancien.size || null,
      mesh: mesh || ancien.mesh || null,
      hasGlb: fs.existsSync(path.join(RACINE, 'models', (mesh || '') + '.glb')) || !!ancien.hasGlb,
      sockets: (profils[profil] || { sockets: [] }).sockets,
    };
  });

// ── Comparaison / écriture ──────────────────────────────────────────────────
function comparer(rel, produit, clefDe) {
  const chemin = path.join(RACINE, rel);
  if (!fs.existsSync(chemin)) return console.log(`  ${rel} : pas de fichier existant à comparer`);
  const ancienJ = JSON.parse(fs.readFileSync(chemin, 'utf8'));
  const idx = (o) => (Array.isArray(o) ? new Map(o.map(x => [clefDe(x), x])) : new Map(Object.entries(o)));
  const a = idx(ancienJ), b = idx(produit);
  const ajoutes = [...b.keys()].filter(k => !a.has(k));
  const retires = [...a.keys()].filter(k => !b.has(k));
  const diffs = [...b.keys()].filter(k => a.has(k) && JSON.stringify(a.get(k)) !== JSON.stringify(b.get(k)));
  console.log(`  ${rel} : ${a.size} → ${b.size}  (+${ajoutes.length} −${retires.length} ~${diffs.length})`);
  const ech = (l) => l.slice(0, 6).join(', ') + (l.length > 6 ? `, … (+${l.length - 6})` : '');
  if (ajoutes.length) console.log(`      ajoutés  : ${ech(ajoutes)}`);
  if (retires.length) console.log(`      retirés  : ${ech(retires)}`);
  if (diffs.length) console.log(`      diffèrent: ${ech(diffs)}`);
  return { ajoutes, retires, diffs };
}

console.log(`profils : ${Object.keys(profils).length} · groupes : ${Object.keys(groupes).length} · pièces : ${pieces.length}`);
if (horsLacet.length) {
  console.log(`\n⚠ ${horsLacet.length} socket(s) avec une rotation hors lacet — notre format ne garde que le lacet :`);
  console.log('   ' + horsLacet.slice(0, 5).join(' | '));
}
if (sansGroupe.length) {
  console.log(`\n⚠ ${sansGroupe.length} pièce(s) dont le groupe est absent de la table : profil « Empty » (pose cellule).`);
  console.log('   ' + sansGroupe.slice(0, 5).join(' | '));
}

if (CHECK) {
  console.log('\n=== Comparaison avec les fichiers en place (aucune écriture) ===');
  comparer('dune_socket_profiles.json', profils, null);
  comparer('dune_group_config.json', groupes, null);
  comparer('dune_pieces_sockets.json', pieces, p => p.templateId);
  process.exit(0);
}

fs.writeFileSync(path.join(RACINE, 'dune_socket_profiles.json'), JSON.stringify(profils, null, 2) + '\n');
fs.writeFileSync(path.join(RACINE, 'dune_group_config.json'), JSON.stringify(groupes, null, 2) + '\n');
fs.writeFileSync(path.join(RACINE, 'dune_pieces_sockets.json'), JSON.stringify(pieces, null, 2) + '\n');
console.log('\n3 fichiers écrits. Enchaîne : node tools/update_datamine.js --only=planner_pieces --force');
