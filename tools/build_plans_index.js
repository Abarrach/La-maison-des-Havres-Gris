#!/usr/bin/env node
/**
 * build_plans_index.js — Construit `plans_index.json`, la table qui permet à `plans.html`
 * de relier un nom de plan ANGLAIS (tel que l'exporte l'addon en jeu) à son identifiant
 * interne, et quand c'est connu, au LIEU où il tombe.
 *
 * Pourquoi ce pont existe : l'addon exporte des noms anglais, alors que les données du site
 * (stuff_data.json) sont en français et que les lieux (stuff_loot.json) sont indexés par
 * identifiant. Le maillon manquant est la table de chaînes du jeu, qui donne nom ↔ identifiant.
 * Elle n'est PAS récupérable en ligne (gaming.tools est derrière Cloudflare, depuis le poste
 * comme depuis le serveur) : elle vient du datamine FModel.
 *
 * Deux motifs de clés coexistent dans la table de chaînes, il faut les deux :
 *   ITEMS/SCHEMATIC_<ID>_SCHEMATIC_NAME   → <ID> est directement l'identifiant d'objet,
 *                                            celui qu'utilise stuff_loot.json → lieu résoluble
 *   ITEMS/SCHEMATIC_SCHEMATIC_<NOM>_NAME  → identifiant de schématique (autre nommage) ;
 *                                            aucun lieu rattachable en l'état, mais le nom est
 *                                            reconnu, ce qui évite de le donner pour inconnu
 *
 * PRINCIPE : on n'invente jamais un lieu. Un plan sans lieu connu sort avec `id` seul, et la
 * page laisse l'utilisateur saisir l'information à la main.
 *
 * Prérequis FModel : exporter en JSON
 *   Content/Dune/Localization/ST_Localization_Items.uasset
 *
 * Usage : node tools/build_plans_index.js [chemin_ST_Localization_Items.json]
 */
const fs = require('fs');
const path = require('path');

const RACINE = path.resolve(__dirname, '..');
const LOC = process.argv[2]
  || 'J:/Download/Fmodel/Output/Exports/DuneSandbox/Content/Dune/Localization/ST_Localization_Items.json';
const LOOT = path.join(RACINE, 'stuff_loot.json');
const SORTIE = path.join(RACINE, 'plans_index.json');

if (!fs.existsSync(LOC)) {
  console.error('Introuvable : ' + LOC
    + '\n→ dans FModel, exporter Content/Dune/Localization/ST_Localization_Items.uasset en JSON.');
  process.exit(1);
}

// Même normalisation que la page : c'est elle qui doit faire foi des deux côtés.
function norm(s) {
  return String(s).toLowerCase()
    .replace(/[‘’`´]/g, "'")   // apostrophes typographiques → droite
    .replace(/\s+/g, ' ')
    .replace(/[^a-z0-9' ]/g, '')
    .trim();
}

const st = (() => { const j = JSON.parse(fs.readFileSync(LOC, 'utf8')); return (Array.isArray(j) ? j[0] : j).StringTable; })();
const entrees = st.KeysToEntries || {};
const loot = fs.existsSync(LOOT) ? (JSON.parse(fs.readFileSync(LOOT, 'utf8')).loot || {}) : {};

// Sources de drop (build_plan_sources_from_datamine.js) : « où ça peut tomber », sans
// probabilité. Les tables de butin nomment les schématiques avec un suffixe `_schematic`
// que les clés de localisation n'ont pas — d'où la double tentative de correspondance.
const SRC = path.join(RACINE, 'plan_sources.json');
const srcMap = fs.existsSync(SRC) ? (JSON.parse(fs.readFileSync(SRC, 'utf8')).sources || {}) : {};
function sourcesDe(id) { return srcMap[id + '_schematic'] || srcMap[id] || null; }

// Lieux RÉELS (build_plan_locations_from_maps.js) : un coffre posé à la main dans un niveau,
// qui tire dans un pool Unique. C'est l'information la plus forte des trois — elle nomme un
// type de POI où aller, pas une catégorie de conteneur. Même double tentative de nom que
// ci-dessus, pour la même raison de suffixe `_schematic`.
const LIEUX_POSES = path.join(RACINE, 'plan_locations.json');
const locMap = fs.existsSync(LIEUX_POSES) ? (JSON.parse(fs.readFileSync(LIEUX_POSES, 'utf8')).locations || {}) : {};
function lieuxPosesDe(id) { return locMap[id + '_schematic'] || locMap[id] || null; }

const plans = {};
let nbDirect = 0, nbSchem = 0, nbCollision = 0;

for (const [cle, valeur] of Object.entries(entrees)) {
  const nom = String(valeur || '').trim();
  if (!nom) continue;

  let id = null, direct = false;
  let m = cle.match(/^ITEMS\/SCHEMATIC_SCHEMATIC_(.+)_NAME$/);
  if (m) { id = 'schematic_' + m[1].toLowerCase(); }
  else {
    m = cle.match(/^ITEMS\/SCHEMATIC_(.+)_SCHEMATIC_NAME$/);
    if (m) { id = m[1].toLowerCase(); direct = true; }
  }
  if (!id) continue;

  const k = norm(nom);
  if (!k) continue;
  // Un même libellé peut exister sous deux clés : on privilégie celle dont l'identifiant
  // est directement rattachable à un lieu, sinon on garde la première rencontrée.
  if (plans[k]) {
    nbCollision++;
    const dejaAvecLieu = !!(loot[plans[k].id] || []).length;
    if (dejaAvecLieu || !direct) continue;
  }
  const lieux = (loot[id] || []).slice()
    .sort((a, b) => (b.chance || 0) - (a.chance || 0))
    .map(x => ({ o: x.location, c: x.chance, t: x.tier }));

  plans[k] = { n: nom, id };
  if (lieux.length) plans[k].l = lieux;
  const s = sourcesDe(id);
  if (s && s.length) plans[k].s = s;
  const g = lieuxPosesDe(id);
  // On ne publie que les lieux effectivement nommés : un coffre dont le motif de niveau
  // n'a pas été reconnu sortirait sous un libellé technique, ce qui n'aide pas le joueur.
  if (g && g.length) {
    const nommes = g.filter(x => x.lieu);
    if (nommes.length) plans[k].g = nommes.map(x => ({ o: x.lieu, r: x.region, n: x.coffres }));
  }
  if (direct) nbDirect++; else nbSchem++;
}

const avecLieu = Object.values(plans).filter(p => p.l).length;
const avecSource = Object.values(plans).filter(p => p.s).length;
const avecPose = Object.values(plans).filter(p => p.g).length;
const avecInfo = Object.values(plans).filter(p => p.l || p.s || p.g).length;
const out = {
  generated_at: new Date().toISOString(),
  source: 'ST_Localization_Items (datamine FModel) + stuff_loot.json',
  note: 'Table nom anglais → identifiant, et lieu de drop QUAND il est connu. Les lieux '
      + 'proviennent de stuff_loot.json, qui ne couvre que les lieux NOMMÉS '
      + '(Loot_DifficultyScaled) : la majorité des plans n\'y figure donc pas encore. '
      + 'Aucun lieu n\'est déduit ni approximé — absence de lieu = information non disponible.',
  count: Object.keys(plans).length,
  with_location: avecLieu,
  with_source: avecSource,
  with_placed: avecPose,
  plans,
};
fs.writeFileSync(SORTIE, JSON.stringify(out));

console.log(`plans_index.json écrit — ${Math.round(fs.statSync(SORTIE).size / 1024)} Ko`);
console.log(`  noms indexés          : ${out.count}`);
console.log(`    · identifiant direct : ${nbDirect}  (lieu potentiellement résoluble)`);
console.log(`    · identifiant schéma : ${nbSchem}  (nom reconnu, pas de lieu rattachable)`);
console.log(`  avec un lieu précis   : ${avecLieu}  (lieux nommés, avec probabilité)`);
console.log(`  avec une source       : ${avecSource}  (grotte, épave, désert profond…)`);
console.log(`  avec un LIEU POSÉ     : ${avecPose}  (coffre réel dans un niveau, pool Unique)`);
console.log(`  avec au moins une info: ${avecInfo}`);
if (nbCollision) console.log(`  libellés en double    : ${nbCollision} (arbitrage : on garde celui qui porte un lieu)`);
