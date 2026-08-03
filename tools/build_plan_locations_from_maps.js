#!/usr/bin/env node
/**
 * build_plan_locations_from_maps.js — Construit `plan_locations.json`, la table qui dit
 * DANS QUEL LIEU DU JEU tombe un plan unique.
 *
 * ── Pourquoi ce fichier existe ────────────────────────────────────────────────────────
 * Les tables de butin (`Systems/LootTables/Loot_Experience/Unique/**`) disent quel plan
 * sort d'un pool, mais AUCUN fichier de `Systems/` ne dit où ce pool est posé dans le
 * monde. Le lien manquant n'est pas dans les réglages : il est posé à la main, coffre
 * par coffre, dans les niveaux des blocs de terrain.
 *
 * L'acteur s'appelle `TemporaryLootSpawner` et porte `m_LootConfig.LootTable`. C'est le
 * seul terme qui permet de le trouver — chercher « container » ou « DT_LootTable » dans
 * les niveaux ne donne rien, ce qui a coûté plusieurs explorations infructueuses.
 *
 * Chaîne complète, vérifiée sur un cas réel :
 *   Maps/Biomes/Arrakis/CB/Generic_S_14/CB_..._SB_Cave_14_Loot_Unique_T1_2.json
 *     → TemporaryLootSpawner_0, m_LootConfig.LootTable = DT_LootTable_Unique_T1_2_Main
 *     → cette table est un RÉPARTITEUR par palier : ses lignes ne portent pas d'objet,
 *       elles renvoient vers une sous-table via `LootWeightedTable`, filtrée par
 *       `ForbiddenTags` (LootTier.2..6 interdits ⇒ la ligne ne vaut qu'au palier 1)
 *     → DT_LootTable_Unique_T1_2 → ItemTemplateId = Schematic_UniqueMaulaPistol
 *     → « Way of the Fallen »
 *
 * ── Ce que l'outil produit, et ce qu'il ne produit PAS ────────────────────────────────
 * Il produit le LIEU (type de POI + bloc de terrain) et la position LOCALE au bloc.
 * Il ne produit pas de coordonnées monde : les blocs de terrain sont assemblés de façon
 * procédurale, la position d'un bloc n'est pas dans ces fichiers. Le type de lieu
 * (« grotte », « galerie minière », « avant-poste de déserteurs »…) est ce qui sert
 * réellement au joueur, la position locale n'est gardée que pour distinguer deux coffres
 * d'un même lieu.
 *
 * Aucune probabilité n'est publiée : elle dépend du pool éligible au tirage au moment du
 * loot, l'annoncer serait un faux chiffre. Même règle que `plan_sources.json`.
 *
 * ── Prérequis FModel ──────────────────────────────────────────────────────────────────
 * Exporter en JSON (les sous-dossiers `Meshes/` et `LOD/` sont inutiles, c'est de l'art) :
 *   Content/Dune/Maps/Biomes/<Région>/CB/**
 *   Content/Dune/Systems/LootTables/**            (déjà fait)
 *
 * L'outil marche sur un export PARTIEL : il traite ce qu'il trouve et dit ce qui manque.
 *
 * Usage : node tools/build_plan_locations_from_maps.js [racine_export_FModel]
 */
const fs = require('fs');
const path = require('path');

const RACINE = path.resolve(__dirname, '..');
const EXPORT = process.argv[2] || 'J:/Download/Fmodel/Output/Exports/DuneSandbox/Content/Dune';
const DIR_MAPS = path.join(EXPORT, 'Maps/Biomes');
const DIR_LOOT = path.join(EXPORT, 'Systems/LootTables');
const SORTIE = path.join(RACINE, 'plan_locations.json');

if (!fs.existsSync(DIR_MAPS)) {
  console.error('Introuvable : ' + DIR_MAPS
    + '\n→ dans FModel, exporter Content/Dune/Maps/Biomes/<Région>/CB/ en JSON.');
  process.exit(1);
}

// ── Lecture ─────────────────────────────────────────────────────────────────────────
function fichiersJson(racine) {
  const out = [];
  (function walk(d) {
    let entrees;
    try { entrees = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    for (const e of entrees) {
      const p = path.join(d, e.name);
      // Meshes/LOD ne contiennent que de la géométrie : les sauter fait gagner ~80 % du temps.
      if (e.isDirectory()) { if (!/^(Meshes|LOD|Textures|Materials)$/i.test(e.name)) walk(p); }
      else if (e.name.endsWith('.json')) out.push(p);
    }
  })(racine);
  return out;
}

function lireJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; }
}

// ── Index des tables de butin, par nom court ────────────────────────────────────────
const tables = {};   // nom court → { rows }
if (fs.existsSync(DIR_LOOT)) {
  for (const p of fichiersJson(DIR_LOOT)) {
    const j = lireJson(p);
    if (!j) continue;
    const o = Array.isArray(j) ? j[0] : j;
    if (!o || !o.Rows) continue;
    tables[path.basename(p, '.json')] = o.Rows;
  }
}

function nomCourt(chemin) {
  return String(chemin || '').split('.')[0].split('/').pop();
}

/**
 * Déplie une table jusqu'aux objets. Les tables de butin s'appellent entre elles par
 * `LootTable` (sous-table classique) ET `LootWeightedTable` (tirage pondéré) : il faut
 * suivre les deux, sinon les pools Unique — qui n'utilisent QUE le second — restent vides.
 */
function objetsDe(nomTable, vus, viaUnique) {
  vus = vus || new Set();
  if (!nomTable || vus.has(nomTable)) return [];
  vus.add(nomTable);
  const rows = tables[nomTable];
  if (!rows) return [{ manquante: nomTable }];

  // Un pool `Unique_T*` est un emplacement CHOISI : le level designer a posé ce coffre-là
  // pour ce lot de plans-là. Tout le reste (`Basic_*`, `Rare_*`, `UltraRare_*`) retombe sur
  // le grand pool commun présent dans quasiment tous les coffres du jeu. Distinguer les deux
  // est la seule chose qui rende le résultat exploitable : sans ça, presque chaque plan
  // ressort « de partout », ce qui ne dit rien au joueur.
  //
  // ATTENTION au suffixe `_Main` : `DT_LootTable_Unique_T1_2_Main` n'est PAS le pool, c'est
  // un répartiteur par palier, et une de ses six lignes renvoie vers `UltraRare_Cave_Main`,
  // qui est générique. Marquer « unique » dès le répartiteur contaminait tout le pool commun
  // et faisait ressortir la plupart des plans de quatre ou cinq lieux à la fois. Le drapeau
  // ne se pose donc que sur le pool TERMINAL, celui sans `_Main`.
  const uniqueIci = viaUnique || /Unique_T\d+_\d+$/i.test(nomTable);

  const out = [];
  for (const ligne of Object.values(rows)) {
    const item = (ligne.ItemTemplateId || {}).Name;
    if (item && item !== 'None') out.push({ id: item, unique: uniqueIci });
    for (const champ of ['LootTable', 'LootWeightedTable']) {
      const sous = nomCourt((ligne[champ] || {}).AssetPathName);
      if (sous) out.push(...objetsDe(sous, vus, uniqueIci));
    }
  }
  return out;
}

// ── Nommage lisible du lieu ─────────────────────────────────────────────────────────
/**
 * Le nom du fichier de niveau est la seule source de vérité sur le type de lieu, et il
 * est technique : `CB_Graben_Ecolab_M_00_SB_DesertersOutpost_01_Gameplay`. On en tire un
 * libellé joueur. Tout motif non reconnu est renvoyé tel quel plutôt qu'approximé — un
 * lieu mal nommé enverrait le joueur au mauvais endroit, ce qui est pire que « inconnu ».
 */
const LIEUX = [
  [/MiningGallery/i,        'Galerie minière'],
  [/DesertersOutpost/i,     'Avant-poste de déserteurs'],
  [/DesertersBase/i,        'Base de déserteurs'],
  [/Deserters/i,            'Camp de déserteurs'],
  [/Sandflies/i,            'Repaire des Mouches de sable'],
  [/ScavengerBase|Scavenger/i, 'Camp de charognards'],
  [/HarkBase|Harkonnen/i,   'Base Harkonnen'],
  [/DeathPit/i,             'Fosse de la mort'],
  [/MiniCamp/i,             'Mini-camp'],
  [/Ecolab|EcoLab/i,        'Laboratoire écologique'],
  [/ShipWreck|Wreck/i,      'Épave'],
  [/Cave/i,                 'Grotte'],
  [/TraversalChallenge|VerticalChallenge/i, 'Défi de traversée'],
  [/HighGroundReward/i,     'Point haut'],
  [/Contract/i,             'Contrat'],
  [/Testing|AiTesting/i,    'Zone de test (contenu non joué)'],
];
function lieuLisible(nomNiveau) {
  for (const [re, libelle] of LIEUX) if (re.test(nomNiveau)) return libelle;
  return null;
}

// ── Balayage des niveaux ────────────────────────────────────────────────────────────
const parPlan = {};        // id de plan → liste de lieux
const tablesManquantes = new Set();
let nbNiveaux = 0, nbSpawners = 0, nbSpawnersAvecTable = 0, nbCommuns = 0;
const blocsVus = new Set();

for (const p of fichiersJson(DIR_MAPS)) {
  let txt;
  try { txt = fs.readFileSync(p, 'utf8'); } catch (e) { continue; }
  // Test bon marché avant l'analyse : la grande majorité des niveaux n'a aucun coffre.
  if (!txt.includes('TemporaryLootSpawner')) continue;

  let arr;
  try { arr = JSON.parse(txt); } catch (e) { continue; }
  if (!Array.isArray(arr)) continue;
  nbNiveaux++;

  const nomNiveau = path.basename(p, '.json');
  const rel = path.relative(DIR_MAPS, p).replace(/\\/g, '/');
  const bloc = rel.split('/').slice(0, 3).join('/');   // Région/CB/Bloc
  blocsVus.add(bloc);
  const region = rel.split('/')[0];

  for (const acteur of arr) {
    if (acteur.Type !== 'TemporaryLootSpawner') continue;
    nbSpawners++;
    const cfg = (acteur.Properties || {}).m_LootConfig || {};
    const table = nomCourt((cfg.LootTable || {}).AssetPathName);
    if (!table) continue;   // coffre au contenu décidé ailleurs : on ne devine pas
    nbSpawnersAvecTable++;

    // Position locale au bloc, via le RootComponent (index de fin de l'ObjectPath).
    let pos = null;
    const rc = (acteur.Properties || {}).RootComponent;
    if (rc && rc.ObjectPath) {
      const i = parseInt(String(rc.ObjectPath).split('.').pop(), 10);
      const L = arr[i] && arr[i].Properties && arr[i].Properties.RelativeLocation;
      if (L) pos = [Math.round(L.X), Math.round(L.Y), Math.round(L.Z)];
    }

    for (const o of objetsDe(table)) {
      if (o.manquante) { tablesManquantes.add(o.manquante); continue; }
      // On ne garde que les plans : le reste du butin (munitions, eau…) n'intéresse pas
      // cette page, et le mélanger rendrait les lieux illisibles.
      if (!/schematic/i.test(o.id)) continue;
      // Les plans atteints par le pool commun tombent dans presque tous les coffres du jeu :
      // les publier ferait afficher « Grotte, Fosse de la mort, Mini-camp, Base… » sur
      // chaque ligne, ce qui n'aide personne à décider où aller. On ne garde que les
      // emplacements choisis.
      if (!o.unique) { nbCommuns++; continue; }
      const cle = o.id.toLowerCase();
      (parPlan[cle] = parPlan[cle] || []).push({
        lieu: lieuLisible(nomNiveau),
        region,
        bloc: bloc.split('/').pop(),
        niveau: nomNiveau,
        table,
        pos,
      });
    }
  }
}

// Dédoublonnage : un même plan sort souvent du même type de lieu à plusieurs endroits.
// On garde une entrée par (lieu, région, bloc) et on compte les coffres.
for (const [cle, liste] of Object.entries(parPlan)) {
  const parCle = {};
  for (const e of liste) {
    const k = [e.lieu, e.region, e.bloc].join('|');
    if (!parCle[k]) parCle[k] = { ...e, coffres: 0 };
    parCle[k].coffres++;
  }
  parPlan[cle] = Object.values(parCle).sort((a, b) => b.coffres - a.coffres);
}

const out = {
  generated_at: new Date().toISOString(),
  source: 'Maps/Biomes/**/CB/** (acteurs TemporaryLootSpawner posés) + Systems/LootTables',
  note: 'Lieu de drop réel, remonté depuis les coffres posés dans les niveaux des blocs de '
      + 'terrain. Positions LOCALES au bloc (l\'assemblage du monde est procédural, la '
      + 'position monde n\'est pas dans ces fichiers). Aucune probabilité : elle dépend du '
      + 'pool éligible au tirage, l\'annoncer serait un faux chiffre.',
  count: Object.keys(parPlan).length,
  locations: parPlan,
};
fs.writeFileSync(SORTIE, JSON.stringify(out));

console.log(`plan_locations.json écrit — ${Math.round(fs.statSync(SORTIE).size / 1024)} Ko`);
console.log(`  blocs balayés         : ${blocsVus.size}`);
console.log(`  niveaux avec coffres  : ${nbNiveaux}`);
console.log(`  coffres posés         : ${nbSpawners}  (dont ${nbSpawnersAvecTable} avec une table)`);
console.log(`  PLANS LOCALISÉS       : ${out.count}   (${nbCommuns} liens vers le pool commun écartés)`);
if (tablesManquantes.size) {
  console.log(`  tables non exportées  : ${tablesManquantes.size}`);
  [...tablesManquantes].slice(0, 8).forEach(t => console.log(`      · ${t}`));
}
