#!/usr/bin/env node
/**
 * build_plan_sources_from_datamine.js — OÙ trouver chaque plan (schématique).
 *
 * Complète `build_loot_locations_from_datamine.js`, qui ne couvrait que les lieux NOMMÉS
 * (Loot_DifficultyScaled : donjon, stations expérimentales) parce qu'ils listent leurs objets
 * explicitement. Il laissait de côté l'essentiel du jeu : grottes, épaves, écolabs, coffres
 * enterrés, strongholds, camps… qui ne listent PAS leurs objets mais les sélectionnent par
 * REQUÊTE SUR TAGS. C'est ce qui manquait — et c'est là que tombe la majorité des plans.
 *
 * Comment on résout la requête :
 *  chaque ligne de table porte un `ItemTagsFilter` dont le moteur a déjà calculé une forme
 *  lisible dans `AutoDescription`, par exemple :
 *      ALL( ALL( Items.Holsters, Loot.Fremen, LootTier.2 ), NONE( Rarity.Rare ) )
 *  On analyse cette expression (ALL/ANY/NONE, imbriquées) plutôt que le flux de jetons brut
 *  `QueryTokenStream` : c'est la même information, déjà décodée par le jeu, donc moins
 *  d'hypothèses de notre part et un résultat vérifiable à l'œil.
 *  Les tags de chaque objet viennent de CDT_BaseItems → StaticData.ItemTags.
 *
 * CE QU'ON PRODUIT : « ce plan peut tomber ici », PAS une probabilité. Pour un conteneur à
 * tags, la probabilité dépend de la taille du pool d'objets éligibles au moment du tirage
 * (variable selon le palier de difficulté et les paquets de contenu actifs) : l'annoncer
 * serait un faux chiffre. Les probabilités ne sont conservées que là où le jeu liste ses
 * objets explicitement, c'est-à-dire dans stuff_loot.json.
 *
 * Prérequis FModel : exporter Systems/LootTables/, Systems/Looting/ et Systems/Items/.
 * Usage : node tools/build_plan_sources_from_datamine.js [racine_Systems]
 */
const fs = require('fs');
const path = require('path');

const RACINE = path.resolve(__dirname, '..');
const SYS = process.argv[2] || 'J:/Download/Fmodel/Output/Exports/DuneSandbox/Content/Dune/Systems';
const LOOT = path.join(SYS, 'LootTables');
const ITEMS = path.join(SYS, 'Items');
const SORTIE = path.join(RACINE, 'plan_sources.json');

if (!fs.existsSync(LOOT)) { console.error('Introuvable : ' + LOOT); process.exit(1); }

// ── Libellés lisibles ────────────────────────────────────────────────────────
// Un joueur cherche « où aller », pas un nom d'asset. On traduit le dossier de la table
// en lieu, et le préfixe Basic/Rare/UltraRare en niveau de conteneur.
const LIEUX = {
  Basic_Cave: 'Grotte', Rare_Cave: 'Grotte', UltraRare_Cave: 'Grotte',
  Basic_Shipwreck: 'Épave', Rare_Shipwreck: 'Épave', UltraRare_Shipwreck: 'Épave',
  Small_Shipwreck: 'Petite épave',
  Basic_Ecolab: 'Écolab', Rare_Ecolab: 'Écolab', UltraRare_Ecolab: 'Écolab',
  Basic_Base: 'Base ennemie', Rare_base: 'Base ennemie', UltraRare_Base: 'Base ennemie',
  Basic_Exploration: 'Exploration', Rare_Exploration: 'Exploration', UltraRare_Exploration: 'Exploration',
  Buried_Treasure: 'Trésor enterré',
  Stronghold: 'Bastion',
  Deserters: 'Déserteurs', Loot_Deserters: 'Déserteurs',
  Slavers: 'Esclavagistes', Loot_Slavers: 'Esclavagistes',
  Sandflies: 'Mouches des sables', Loot_Sandflies: 'Mouches des sables',
  SheolCore: 'Sheol', MysaTaril: 'Mysa Taril', PyonVillage: 'Village pyon',
  GrabenMiningGallery: 'Galerie minière du Graben', HarkonnenSpiceSilo: 'Silo à épice Harkonnen',
  Ecolab177: 'Écolab 177', EcolabLaserLab: 'Écolab (laboratoire laser)',
  EcolabSpice: 'Écolab (épice)', EcolabTheSpa: 'Écolab (le Spa)',
  EcolabWaterRefinery: 'Écolab (raffinerie d\'eau)', EcolabExplosivesResearch: 'Écolab (explosifs)',
  Weapon_Rack_Medium: 'Râtelier d\'armes', Weapon_Rack_Small: 'Râtelier d\'armes',
  Vehicles: 'Véhicule', Chapter2: 'Chapitre 2',
  Loot_MaasKharet: 'Maas Kharet', Loot_Shipwrecks: 'Épave',
  Loot_Contracts: 'Contrat', Loot_Events: 'Événement',
  Loot_LandsraadMaps: 'Landsraad', Loot_SpecializationKeystone: 'Clé de spécialisation',
  // Désert Profond : les agencements (LootLayout1..8) tournent avec le reset hebdomadaire.
  // On ne distingue pas l'agencement, qui ne dit rien d'exploitable une semaine donnée.
  DeepDesert: 'Désert Profond', DeepDesertNew: 'Désert Profond',
};
const NIVEAUX = { Basic: 'Basique', Rare: 'Rare', UltraRare: 'Ultra Rare' };

function libelle(relDir, fichier) {
  const seg = relDir.split(/[\\/]/).filter(Boolean);
  for (let i = seg.length - 1; i >= 0; i--) if (LIEUX[seg[i]]) {
    const lieu = LIEUX[seg[i]];
    const m = seg[i].match(/^(Basic|Rare|UltraRare)/) || fichier.match(/_(Basic|Rare|UltraRare)_/);
    return m ? { lieu, niveau: NIVEAUX[m[1]] } : { lieu, niveau: null };
  }
  // Dossier non cartographié : on préfère ne rien annoncer plutôt qu'un nom d'asset brut.
  return null;
}

// ── Tags des objets ──────────────────────────────────────────────────────────
function chargerTags() {
  const f = path.join(ITEMS, 'CDT_BaseItems.json');
  if (!fs.existsSync(f)) { console.error('Introuvable : ' + f + '\n→ exporter Systems/Items/ dans FModel.'); process.exit(1); }
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  const rows = (Array.isArray(j) ? j[0] : j).Rows || {};
  const out = new Map();
  for (const [cle, r] of Object.entries(rows)) {
    const t = r && r.StaticData && r.StaticData.ItemTags;
    if (Array.isArray(t) && t.length) out.set(cle.toLowerCase(), t);
  }
  return out;
}

// ── Analyse d'AutoDescription → prédicat ────────────────────────────────────
// Grammaire : OP( arg, arg, … ) où OP ∈ ALL | ANY | NONE, un arg étant un tag ou une
// sous-expression. Un tag correspond si l'objet le porte OU porte un tag plus spécifique
// (« Items.Holsters » couvre « Items.Holsters.Belt ») : c'est la sémantique des GameplayTags.
function analyser(expr) {
  let i = 0;
  const s = String(expr || '').trim();
  function noeud() {
    sauterEspaces();
    const m = /^(ALL|ANY|NONE)\s*\(/i.exec(s.slice(i));
    if (!m) return feuille();
    i += m[0].length;
    const op = m[1].toUpperCase(), args = [];
    for (;;) {
      sauterEspaces();
      if (s[i] === ')') { i++; break; }
      if (s[i] === ',') { i++; continue; }
      if (i >= s.length) break;
      args.push(noeud());
    }
    return { op, args };
  }
  function feuille() {
    sauterEspaces();
    let j = i;
    while (j < s.length && !',()'.includes(s[j])) j++;
    const tag = s.slice(i, j).trim();
    i = j;
    return { tag };
  }
  function sauterEspaces() { while (i < s.length && /\s/.test(s[i])) i++; }
  const n = noeud();
  return (n && (n.op || n.tag)) ? n : null;
}

function evalue(n, tags) {
  if (!n) return false;
  if (n.tag) return tags.some(t => t === n.tag || t.startsWith(n.tag + '.'));
  const r = n.args.map(a => evalue(a, tags));
  if (n.op === 'ALL') return r.length > 0 && r.every(Boolean);
  if (n.op === 'ANY') return r.some(Boolean);
  if (n.op === 'NONE') return !r.some(Boolean);
  return false;
}

// ── Parcours des tables ──────────────────────────────────────────────────────
const tagsParObjet = chargerTags();
console.log(`Tags chargés : ${tagsParObjet.size} objets`);
const schematiques = [...tagsParObjet.keys()].filter(k => k.includes('schematic'));
console.log(`  dont schématiques : ${schematiques.length}`);

// Index de TOUTES les tables par nom d'asset : les tables se référencent entre elles
// (« /Game/…/DT_LootTable_Unique_T2_Pool.DT_LootTable_Unique_T2_Pool »).
const parNom = new Map(), relParNom = new Map();
(function indexer(dir, rel) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { indexer(p, path.join(rel, e.name)); continue; }
    if (!e.name.endsWith('.json')) continue;
    const nom = e.name.replace(/\.json$/, '');
    parNom.set(nom, p); relParNom.set(nom, rel);
  }
})(LOOT, '');
console.log(`Tables indexées : ${parNom.size}`);

const cache = new Map();
function lire(nom) {
  if (cache.has(nom)) return cache.get(nom);
  const p = parNom.get(nom);
  let rows = {};
  if (p) { try { rows = (JSON.parse(fs.readFileSync(p, 'utf8'))[0] || {}).Rows || {}; } catch (e) { /* table illisible */ } }
  cache.set(nom, rows);
  return rows;
}
// « /Game/…/Dossier.DT_Truc » → « DT_Truc »
function refVers(ref) {
  const a = ref && ref.AssetPathName;
  if (!a) return null;
  const n = String(a).split('.').pop();
  return n && parNom.has(n) ? n : null;
}

const sources = new Map();   // idObjet → Set("Lieu · Niveau")
function ajouter(id, lib) {
  if (!lib) return;
  const k = id.toLowerCase();
  if (!sources.has(k)) sources.set(k, new Set());
  sources.get(k).add(lib.niveau ? lib.lieu + ' · ' + lib.niveau : lib.lieu);
}

// Descente récursive depuis une table racine : on suit les renvois vers d'autres tables
// (c'est ainsi qu'une petite épave atteint les pools Unique_T2..T5) et on attribue à TOUT
// ce qu'on trouve le libellé de la RACINE — c'est le lieu où le joueur doit se rendre.
let nbDirects = 0, nbRequetes = 0;
function descendre(nom, lib, vus) {
  if (vus.has(nom) || vus.size > 400) return;
  vus.add(nom);
  for (const r of Object.values(lire(nom))) {
    const tmpl = r.ItemTemplateId && r.ItemTemplateId.Name;
    if (tmpl && tmpl !== 'None' && tmpl.toLowerCase().includes('schematic')) { ajouter(tmpl, lib); nbDirects++; }
    const desc = r.ItemTagsFilter && r.ItemTagsFilter.AutoDescription;
    if (desc && desc.trim()) {
      const q = analyser(desc);
      if (q) {
        nbRequetes++;
        for (const id of schematiques) if (evalue(q, tagsParObjet.get(id))) ajouter(id, lib);
      }
    }
    for (const champ of ['LootTable', 'LootWeightedTable']) {
      const suiv = refVers(r[champ]);
      if (suiv) descendre(suiv, lib, vus);
    }
  }
}

// Racines = toute table située dans un dossier CARTOGRAPHIÉ (un vrai lieu). Les pools
// intermédiaires (Unique/, Crafting/…) ne sont pas des lieux : ils ne sont jamais racine,
// mais sont atteints par descente et héritent du lieu qui les consomme.
let nbRacines = 0;
for (const [nom, rel] of relParNom) {
  const lib = libelle(rel, nom);
  if (!lib) continue;
  nbRacines++;
  descendre(nom, lib, new Set());
}
console.log(`Racines explorées : ${nbRacines}  (objets listés : ${nbDirects}, requêtes évaluées : ${nbRequetes})`);

const out = {};
for (const [id, set] of sources) out[id] = [...set].sort();
fs.writeFileSync(SORTIE, JSON.stringify({
  generated_at: new Date().toISOString(),
  source: 'datamine FModel — LootTables (objets listés + requêtes sur tags) × CDT_BaseItems.ItemTags',
  note: 'OÙ un plan peut tomber. Volontairement SANS probabilité : pour un conteneur à tags, '
      + 'elle dépend de la taille du pool éligible au moment du tirage, l\'annoncer serait un '
      + 'faux chiffre. Les probabilités restent dans stuff_loot.json, qui ne couvre que les '
      + 'lieux listant leurs objets explicitement.',
  count: Object.keys(out).length,
  sources: out,
}));
console.log(`\nplan_sources.json écrit — ${Math.round(fs.statSync(SORTIE).size / 1024)} Ko`);
console.log(`  schématiques avec au moins une source : ${Object.keys(out).length}`);
