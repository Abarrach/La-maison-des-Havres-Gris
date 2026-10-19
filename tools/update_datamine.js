#!/usr/bin/env node
'use strict';
/**
 * update_datamine.js — Orchestrateur du pipeline de données dataminées.
 *
 * OBJECTIF : après un patch du jeu, répondre en une commande à « qu'est-ce qui est
 * périmé, et comment je le remets à jour ». Rien n'est deviné : chaque verdict vient
 * d'une date de fichier réelle (pak du jeu, export FModel, dernière exécution du
 * pipeline enregistrée dans tools/datamine_state.json).
 *
 * ── La chaîne, en trois maillons ────────────────────────────────────────────
 *   1. LE JEU      Steam met à jour des .pak. C'est le SEUL signal fiable qu'un
 *                  patch est sorti (le jeu n'écrit aucun fichier de version ;
 *                  l'identifiant de build vient du manifeste Steam).
 *   2. L'EXPORT    FModel extrait les DataTables en JSON. Étape manuelle AUJOURD'HUI
 *                  (FModel n'a pas de ligne de commande), donc cet outil ne clique
 *                  pas à ta place : il dit exactement QUELS dossiers ré-exporter, et
 *                  il le dit tout seul, sans que tu aies à surveiller les patchs.
 *                  ⚠ Manuel ≠ inévitable : FModel n'est qu'une interface au-dessus de
 *                  CUE4Parse, qui est une bibliothèque. J:/Download/dune_extract/
 *                  CostExtract est un programme .NET déjà écrit qui monte les paks et
 *                  lit les DataTables — revérifié le 2026-10-19 sur le build repackagé
 *                  en IoStore : il monte toujours. Le généraliser rendrait cette étape
 *                  scriptable ; seuls le .usmap et la clé AES resteraient hors code.
 *   3. LES SORTIES Les scripts tools/build_*.js transforment l'export en .json servis
 *                  par le site. C'est ce que cet outil exécute, dans l'ordre des
 *                  dépendances, avec un diff sémantique (quoi a été ajouté / retiré /
 *                  modifié) au lieu d'un simple « le fichier a changé ».
 *
 * ── Usage ───────────────────────────────────────────────────────────────────
 *   node tools/update_datamine.js --check          État complet, aucune écriture. Code de
 *                                                  sortie 0 = à jour, 2 = du travail attend.
 *   node tools/update_datamine.js                  Régénère ce qui est périmé (étapes locales).
 *   node tools/update_datamine.js --force          Régénère tout, même ce qui est à jour.
 *   node tools/update_datamine.js --only=recipes   Une seule étape (identifiants : voir --check).
 *   node tools/update_datamine.js --dry-run        Montre les commandes sans rien lancer.
 *   node tools/update_datamine.js --report=x.md    Écrit le compte rendu en Markdown.
 *
 *   Étapes coûteuses ou à source manuelle, hors du passage par défaut :
 *   --with-snapshot        snapshot gaming.tools (réseau, ~30 min, souvent bloqué Cloudflare)
 *   --with-univers         plans_uniques.json (demande un export d'addon collé dans un .txt)
 *   --run-planner-import   base_pieces_v3.json via le script externe import_building_data.js
 *   --with-meshes          recopie les .glb du planner depuis l'export FModel
 *   --all                  les quatre ci-dessus d'un coup
 *
 *   Chemins : détectés depuis les réglages FModel (%APPDATA%/FModel/AppSettings.json).
 *   Forçage possible : --export=<racine Content/Dune> --game=<dossier Paks>
 *                      --univers-src=<export .txt de l'addon, pour --with-univers>.
 *
 * ── Ce que l'outil ne fait PAS ──────────────────────────────────────────────
 * Il ne commite rien, ne déploie rien (le déploiement reste manuel, WinSCP), et ne
 * modifie jamais l'export FModel. Après une régénération, relis les diffs, teste en
 * local, puis commite et déploie toi-même.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const STATE_FILE = path.join(__dirname, 'datamine_state.json');

// ── Arguments ───────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const valOf = (name) => {
  const a = args.find(x => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : null;
};
const CHECK_ONLY = has('--check') || has('--list');
const DRY_RUN = has('--dry-run');
const FORCE = has('--force');
const ALL_OPT = has('--all');
const WITH = {
  snapshot: ALL_OPT || has('--with-snapshot'),
  univers: ALL_OPT || has('--with-univers'),
  planner_import: ALL_OPT || has('--run-planner-import'),
  meshes: ALL_OPT || has('--with-meshes'),
};
const ONLY = valOf('only');
const REPORT = valOf('report');

if (has('--help') || has('-h')) {
  console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].replace(/^.*?\/\*\*/s, '').replace(/^ \* ?/gm, ''));
  process.exit(0);
}

// ── Petits utilitaires ──────────────────────────────────────────────────────
const exists = (p) => !!p && fs.existsSync(p);
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; } };
const iso = (ms) => (ms ? new Date(ms).toISOString().slice(0, 16).replace('T', ' ') : '—');
const jour = (ms) => (ms ? new Date(ms).toISOString().slice(0, 10) : '—');

/**
 * Date de modification la plus récente d'un fichier ou d'un dossier.
 *
 * PIÈGE : la mtime d'un DOSSIER ne bouge que si une entrée y est ajoutée ou retirée —
 * ré-exporter par-dessus des fichiers existants la laisse inchangée. On descend donc de
 * quelques niveaux pour attraper la vraie fraîcheur. Descente bornée (profondeur + nombre
 * d'entrées) : Maps/Biomes contient des dizaines de milliers de fichiers, un parcours
 * complet coûterait des minutes pour une information qu'un échantillon donne déjà.
 */
function treeMtime(p, depth = 2, budget = { n: 600 }) {
  let st;
  try { st = fs.statSync(p); } catch (e) { return null; }
  let best = st.mtimeMs;
  if (st.isDirectory() && depth > 0) {
    let entries;
    try { entries = fs.readdirSync(p, { withFileTypes: true }); } catch (e) { return best; }
    for (const e of entries) {
      if (budget.n-- <= 0) break;
      const m = treeMtime(path.join(p, e.name), depth - 1, budget);
      if (m && m > best) best = m;
    }
  }
  return best;
}

// ── Découverte de l'environnement (FModel, jeu, Steam) ───────────────────────

/**
 * Réglages FModel : ils portent à la fois le dossier d'export ET le dossier de paks du
 * jeu. On les lit plutôt que de coder des chemins en dur — c'est FModel qui fait foi,
 * et ça rend l'outil utilisable sur une autre machine sans le modifier.
 */
function lireReglagesFModel() {
  const appdata = process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData/Roaming');
  const p = path.join(appdata, 'FModel', 'AppSettings.json');
  const s = readJson(p);
  if (!s) return { fichier: p, ok: false };
  let mappings = null, aesReload = null;
  const entree = Object.entries(s.PerDirectory || {}).find(([k]) => /dune/i.test(k));
  if (entree) {
    const cfg = entree[1] || {};
    aesReload = cfg.LastAesReload || null;
    const ep = (cfg.Endpoints || []).map(e => e && e.FilePath).filter(Boolean);
    mappings = ep.length ? ep[ep.length - 1] : null;   // le dernier configuré = celui en service
  }
  return {
    fichier: p, ok: true,
    exportsRoot: s.RawDataDirectory || s.PropertiesDirectory || null,
    paksDir: s.GameDirectory || null,
    mappings, aesReload,
  };
}

/**
 * Le .usmap à utiliser : le PLUS RÉCENT du dossier où vit celui configuré dans FModel.
 *
 * Piège constaté (2026-10-20) : FModel pointait encore sur celui de juin alors qu'un dump
 * de septembre dormait à côté. Régénérer depuis le vieux ne plante pas — il ANNULE
 * silencieusement les corrections du récent. Une régénération ne doit jamais reculer.
 */
function usmapLePlusRecent(reglages) {
  const configure = reglages.mappings || null;
  if (!configure) return { choisi: null, configure: null };
  try {
    const dossier = path.dirname(configure);
    const cands = fs.readdirSync(dossier)
      .filter(f => f.toLowerCase().endsWith('.usmap'))
      .map(f => path.join(dossier, f))
      .map(p => ({ p, m: fs.statSync(p).mtimeMs }))
      .sort((a, b) => b.m - a.m);
    return { choisi: cands.length ? cands[0].p : configure, configure };
  } catch (e) { return { choisi: configure, configure }; }
}

/** Racine des exports : .../Exports/DuneSandbox/Content/Dune (celle que suivent les build_*). */
function trouverRacineExport(reglages) {
  const forcee = valOf('export');
  const candidats = [
    forcee,
    reglages.exportsRoot && path.join(reglages.exportsRoot, 'DuneSandbox/Content/Dune'),
    'J:/Download/Fmodel/Output/Exports/DuneSandbox/Content/Dune',
  ].filter(Boolean);
  return candidats.find(exists) || candidats[0] || null;
}

/**
 * État du jeu installé : identifiant de build Steam + date de chaque .pak.
 *
 * Le buildid dit « c'est un autre patch » sans ambiguïté ; les dates des paks disent
 * QUELLES données ont bougé — un patch qui ne touche que Art.pak n'a aucune raison de
 * périmer nos recettes de craft.
 */
function lireEtatJeu(reglages) {
  const paksDir = valOf('game') || reglages.paksDir;
  if (!exists(paksDir)) return { ok: false, paksDir };
  const paks = {};
  for (const f of fs.readdirSync(paksDir)) {
    // IoStore : le contenu réel est dans les .ucas/.utoc, le .pak à côté peut être un
    // résidu de 379 octets jamais réécrit. Prendre les trois extensions, sinon on date
    // le patch sur un fichier mort.
    if (!/\.(pak|ucas|utoc)$/i.test(f)) continue;
    try { paks[f] = fs.statSync(path.join(paksDir, f)).mtimeMs; } catch (e) { /* ignoré */ }
  }
  /**
   * Depuis le repackaging de l'automne 2026, le jeu n'expose plus des paks NOMMÉS par
   * domaine (Systems.pak, Maps_Biomes_Graben.pak…) mais des chunks numérotés
   * (pakchunk170-Windows.ucas). Le numéro de chunk ne dit rien du contenu : savoir quel
   * chunk porte Systems/ demanderait de lire le .utoc.
   *
   * On perd donc la granularité « ce patch ne touche que l'art ». On ne perd PAS le
   * signal : à défaut de savoir quoi, on prend la date du conteneur le plus récent et on
   * considère que tout peut avoir bougé. Prudent plutôt que faussement rassurant.
   */
  const chunke = Object.keys(paks).length > 0
    && Object.keys(paks).every(f => /^pakchunk\d+|^global\./i.test(f));
  // .../common/<Jeu>/DuneSandbox/Content/Paks → on remonte jusqu'à steamapps
  let steamapps = null, installdir = null;
  let cur = paksDir;
  for (let i = 0; i < 8 && cur; i++) {
    const parent = path.dirname(cur);
    if (path.basename(parent).toLowerCase() === 'common') { installdir = path.basename(cur); steamapps = path.dirname(parent); break; }
    if (parent === cur) break;
    cur = parent;
  }
  let buildId = null, lastUpdated = null;
  if (steamapps && exists(steamapps)) {
    for (const f of fs.readdirSync(steamapps)) {
      if (!/^appmanifest_\d+\.acf$/i.test(f)) continue;
      let txt = '';
      try { txt = fs.readFileSync(path.join(steamapps, f), 'utf8'); } catch (e) { continue; }
      const dir = (txt.match(/"installdir"\s+"([^"]+)"/) || [])[1];
      if (!installdir || !dir || dir.toLowerCase() !== installdir.toLowerCase()) continue;
      buildId = (txt.match(/"buildid"\s+"(\d+)"/) || [])[1] || null;
      const lu = (txt.match(/"LastUpdated"\s+"(\d+)"/) || [])[1];
      lastUpdated = lu ? Number(lu) * 1000 : null;
      break;
    }
  }
  const plusRecent = Object.entries(paks).sort((a, b) => b[1] - a[1])[0] || null;
  return { ok: true, paksDir, paks, chunke, buildId, lastUpdated, pakLePlusRecent: plusRecent };
}

/** Date du pak le plus récent parmi ceux qui alimentent une étape (motifs avec * autorisés). */
function pakMtime(jeu, motifs) {
  if (!jeu.ok || !motifs || !motifs.length) return null;
  // Paks chunkés : aucun nom ne peut matcher, on retombe sur le conteneur le plus récent.
  if (jeu.chunke) {
    return jeu.pakLePlusRecent
      ? { ms: jeu.pakLePlusRecent[1], pak: jeu.pakLePlusRecent[0], approx: true }
      : null;
  }
  let best = null, nom = null;
  for (const [f, m] of Object.entries(jeu.paks)) {
    const match = motifs.some(mo => mo.includes('*')
      ? new RegExp('^' + mo.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$', 'i').test(f)
      : f.toLowerCase() === mo.toLowerCase());
    if (match && (best === null || m > best)) { best = m; nom = f; }
  }
  return best === null ? null : { ms: best, pak: nom };
}

// ── Le pipeline ─────────────────────────────────────────────────────────────
// `sources` : chemins RELATIFS à la racine d'export (Content/Dune) — pas d'absolu ici,
// c'est ce qui rend l'outil portable et le fichier d'état lisible.
// `paks`    : quels paks du jeu alimentent ces sources (motifs, * autorisé).
// `args`    : arguments passés au script, calculés depuis les chemins découverts.
const STEPS = [
  {
    id: 'export',
    label: 'Export des DataTables depuis les paks (sans FModel)',
    exe: (c) => c.extracteur,
    args: () => ['--config', path.join(ROOT, 'tools/extract/extract.config.json')],
    outputs: [],            // écrit dans l'arborescence d'export, pas dans le dépôt
    sources: [],
    paks: ['*'],            // tout pak/ucas/utoc : c'est la source du jeu elle-même
    note: 'Remplace les clics dans FModel : monte les paks, applique le .usmap et la table '
      + 'des types, charge la localisation FR, et écrit aux MÊMES chemins que FModel — donc '
      + 'les étapes suivantes ne voient aucune différence. Lecture seule : ne touche ni au '
      + 'jeu ni à aucun processus. À construire une fois : dotnet build tools/extract -c Release',
  },
  {
    id: 'snapshot',
    label: 'Snapshot gaming.tools (liste d\'objets, stats d\'armes, capacités)',
    script: 'tools/build_stuff_snapshot.js',
    outputs: ['stuff_data.json', 'stuff_skills.json', 'stuff_names.json'],
    sources: [], paks: [],
    optIn: 'snapshot',
    note: 'Réseau, ~30 min, régulièrement bloqué (403 Cloudflare) y compris depuis le poste de dev. '
      + 'Seule source des stats d\'ARMES (le datamine ne donne que des références de Blueprints). '
      + 'Utile surtout quand un patch ajoute de NOUVEAUX objets.',
  },
  {
    id: 'mapstructtypes',
    label: 'Table des types de TMap (clé/valeur des maps)',
    script: 'tools/build_mapstructtypes.js',
    args: (c) => [c.usmap.choisi].filter(Boolean),
    outputs: ['tools/mapstructtypes.json'],
    sources: [],
    sourcesAbs: (c) => [c.usmap.choisi],
    paks: [],
    note: 'Sans cette table, FModel et CUE4Parse sortent les TMap VIDES (recettes, coûts, '
      + 'scaling par grade). Elle se déduit du .usmap : dès que celui-ci change, elle doit '
      + 'suivre, sinon les nouvelles maps redeviennent vides sans message d\'erreur.',
  },
  {
    id: 'recipes',
    label: 'Recettes de craft',
    script: 'tools/build_recipes_from_datamine.js',
    args: (c) => [path.join(c.exportRoot, 'Systems/Crafting/DT_ItemsCraftingRecipes.json')],
    outputs: ['stuff_recipes.json'],
    sources: ['Systems/Crafting/DT_ItemsCraftingRecipes.json'],
    paks: ['Systems.pak'],
    // PIÈGE VÉRIFIÉ (2026-09-13) : sans stuff_names.json, le script ne peut plus nommer les
    // ingrédients. Il ne s'arrête pas — il retombe sur des noms dérivés du template et
    // réécrit les 1 271 recettes avec ces noms dégradés, en n'affichant qu'un ⚠ noyé dans
    // sa sortie. stuff_names.json est GITIGNORÉ, donc absent d'un dépôt fraîchement cloné,
    // et son autre source (gaming.tools) répond 403.
    garde: () => exists(path.join(ROOT, 'stuff_names.json')) ? null
      : 'stuff_names.json absent (fichier gitignoré) → les noms d\'ingrédients seraient DÉGRADÉS.\n'
        + '      Remède : le récupérer depuis la prod (curl -O https://havresgris.ddns.net/stuff_names.json)\n'
        + '      ou le regénérer avec --with-snapshot (réseau, souvent bloqué). --force passe outre.',
  },
  {
    id: 'descriptions',
    label: 'Descriptions FR des objets (injectées dans stuff_data.json)',
    script: 'tools/build_descriptions_from_datamine.js',
    args: (c) => [path.join(c.exportRoot, 'Systems/Items/CDT_BaseItems.json')],
    outputs: ['stuff_data.json'],
    sources: ['Systems/Items/CDT_BaseItems.json'],
    paks: ['Systems.pak'],
    requiresLocal: ['stuff_data.json'],
  },
  {
    id: 'armor',
    label: 'Stats d\'armure (valeur + mitigations)',
    script: 'tools/build_armor_stats_from_datamine.js',
    args: (c) => [path.join(c.exportRoot, 'Systems/Items/DT_ArmorItemTable.json')],
    outputs: ['stuff_data.json'],
    sources: ['Systems/Items/DT_ArmorItemTable.json'],
    paks: ['Systems.pak'],
    requiresLocal: ['stuff_data.json'],
  },
  {
    id: 'augments',
    label: 'Effets chiffrés des augments',
    script: 'tools/build_augments_from_datamine.js',
    args: (c) => [path.join(c.exportRoot, 'Systems/Items')],
    outputs: ['stuff_augments.json'],
    sources: ['Systems/Items/DT_ItemTable_Augments.json', 'Systems/Items/Upgrades'],
    paks: ['Systems.pak'],
    requiresLocal: ['stuff_data.json'],
  },
  {
    id: 'loot',
    label: 'Butin des lieux NOMMÉS (avec probabilités)',
    script: 'tools/build_loot_locations_from_datamine.js',
    args: (c) => [path.join(c.exportRoot, 'Systems')],
    outputs: ['stuff_loot.json'],
    sources: ['Systems/LootTables/Loot_DifficultyScaled', 'Systems/Looting'],
    paks: ['Systems.pak'],
    requiresLocal: ['stuff_data.json'],
  },
  {
    id: 'plan_sources',
    label: 'Où peut tomber chaque plan (conteneurs à tags)',
    script: 'tools/build_plan_sources_from_datamine.js',
    args: (c) => [path.join(c.exportRoot, 'Systems')],
    outputs: ['plan_sources.json'],
    sources: ['Systems/LootTables', 'Systems/Looting', 'Systems/Items/CDT_BaseItems.json'],
    paks: ['Systems.pak'],
  },
  {
    id: 'plan_locations',
    label: 'Lieux réels des plans uniques (coffres posés dans les niveaux)',
    script: 'tools/build_plan_locations_from_maps.js',
    args: (c) => [c.exportRoot],
    outputs: ['plan_locations.json'],
    sources: ['Maps/Biomes', 'Systems/LootTables'],
    paks: ['Maps.pak', 'Maps_Biomes_*.pak', 'Systems.pak'],
    note: 'Marche sur un export PARTIEL des régions : il traite ce qu\'il trouve et dit ce qui manque. '
      + 'Couverture actuelle ~70 % (8 régions).',
  },
  {
    id: 'plans_index',
    label: 'Pont nom de plan ↔ identifiant (multilingue) + lieu connu',
    script: 'tools/build_plans_index.js',
    args: (c) => [path.join(c.exportRoot, 'Localization/ST_Localization_Items.json')],
    outputs: ['plans_index.json'],
    sources: ['Localization/ST_Localization_Items.json', 'Systems/Items/CDT_BaseItems.json'],
    paks: ['Localization.pak', 'Systems.pak'],
    requiresLocal: ['stuff_loot.json'],
  },
  {
    id: 'plans_univers',
    label: 'Univers des plans uniques apprenables',
    script: 'tools/build_plans_uniques.js',
    args: (c) => [c.exportAddon],
    outputs: ['plans_uniques.json'],
    sources: [], paks: [],
    optIn: 'univers',
    requiresLocal: ['plans_index.json'],
    manual: 'J:/Download/plans total.txt',
    note: 'Source MANUELLE : relancer l\'addon en jeu SANS filtre et coller le résultat dans le .txt. '
      + 'À refaire seulement quand un patch ajoute des plans uniques.',
  },
  {
    id: 'base_pieces_v3',
    label: 'Catalogue du Constructeur de Base (670 pièces)',
    external: true,          // le script vit HORS du dépôt : lancé par importPlanner()
    optIn: 'planner_import',
    outputs: ['base_pieces_v3.json'],
    sources: ['Systems/Building/Data', 'Systems/Vehicles'],
    paks: ['Systems.pak', 'Vehicles.pak'],
    note: 'Script externe J:/Download/Fmodel/import_building_data.js. PIÈGE : il écrit toujours '
      + 'vers un chemin ABSOLU codé en dur (racine du dépôt principal) — le résultat est recopié '
      + 'ici après coup. Régénérer ce fichier entraîne planner_pieces en cascade.',
  },
  {
    id: 'planner_pieces',
    label: 'Catalogue unifié du planner (pièces + sockets + utilitaires)',
    script: 'tools/build_planner_pieces.js',
    outputs: ['planner_pieces.json'],
    sources: [], paks: [],
    requiresLocal: ['base_pieces_v3.json', 'dune_pieces_sockets.json'],
    note: '100 % local : fusionne base_pieces_v3.json (externe), dune_pieces_sockets.json et '
      + 'planner_utilities.json. À relancer après toute régénération de base_pieces_v3.json.',
  },
  {
    id: 'meshes',
    label: 'Meshes .glb référencés par le planner → models/',
    script: 'tools/flatten_glb.js',
    args: (c) => [c.exportsRoot].filter(Boolean),
    outputs: [],           // models/ est gitignoré (357 Mo) : pas de diff possible, pas d'état de sortie
    sources: [], paks: ['Environment_Structures.pak', 'Environment_Props.pak', 'Art.pak', 'Vehicles.pak', 'Placables.pak'],
    optIn: 'meshes',
    requiresLocal: ['planner_pieces.json'],
    note: 'Ne copie que les meshes cités par planner_pieces.json. models/ n\'est pas versionné : '
      + 'les .glb nouveaux ou changés doivent être envoyés au serveur par WinSCP.',
  },
];

// ── Données dataminées SANS pipeline automatisé (résultat de l'audit) ────────
// Elles existent, elles servent, mais aucun script ne sait les régénérer. Les lister à
// chaque --check est le seul moyen de ne pas les oublier après un patch.
const ANGLES_MORTS = [
  {
    id: 'sockets',
    fichiers: ['dune_pieces_sockets.json', 'dune_socket_profiles.json', 'dune_group_config.json'],
    label: 'Géométrie d\'accroche du planner (552 pièces, 71 profils, 92 groupes)',
    detail: 'AUCUN script de régénération n\'existe. Issus d\'un reverse engineering manuel\n'
      + '    (dune.layout.tools + FModel) fait dans une session antérieure.\n'
      + '    Si un patch change la géométrie des pièces, ces fichiers ne bougeront pas.\n'
      + '    Dégradation propre : une pièce absente retombe sur une pose « cellule » simple.',
  },
  {
    id: 'planner_utilities',
    fichiers: ['planner_utilities.json'],
    label: 'Utilitaires du planner (22 placeables fonctionnels)',
    detail: 'Extrait à la main de DT_PlaceableData_Functional + bbox lue dans les .glb.\n'
      + '    Pas de script : un patch ajoutant un utilitaire demande une passe manuelle.',
  },
  {
    id: 'planner_costs',
    fichiers: ['planner_costs.json'],
    label: 'Coûts de construction (matériaux, énergie, eau)',
    detail: 'Source NON dataminable : compilée par TroubleChute (tools.tcno.co/dune), crédité.\n'
      + '    Les recettes de structures ne sont pas dans les DataTables (InstancedStruct).\n'
      + '    Après un patch d\'équilibrage, vérifier à la main sur tcno.co.',
  },
  {
    id: 'divers',
    fichiers: ['metiers.json', 'landsraad_data.json', 'base_pieces_v2.json'],
    label: 'Fichiers curés à la main (et un fichier mort)',
    detail: 'metiers.json et landsraad_data.json sont saisis à la main, pas dataminés.\n'
      + '    base_pieces_v2.json n\'est plus lu par aucune page (le planner charge v3 /\n'
      + '    planner_pieces.json) : ne pas perdre de temps à le régénérer.',
  },
];

// ── État persistant ─────────────────────────────────────────────────────────
function lireEtat() {
  return readJson(STATE_FILE) || {
    _note: 'Écrit par tools/update_datamine.js. Trace la fraîcheur des données dataminées : '
      + 'quand chaque étape du pipeline a tourné, et sur quel build du jeu. Versionné exprès — '
      + 'sans lui, plus rien ne dit de quelle version du jeu proviennent les .json du site. '
      + '« game » = état du jeu AU DERNIER PASSAGE de l\'outil ; chaque étape porte en plus '
      + 'son propre game_build_id.',
    updated_at: null, game: {}, export: {}, steps: {},
  };
}
function ecrireEtat(etat) {
  etat.updated_at = new Date().toISOString();
  fs.writeFileSync(STATE_FILE, JSON.stringify(etat, null, 2) + '\n');
}

// ── Diff sémantique des sorties ─────────────────────────────────────────────
const META = new Set(['generated_at', 'source', 'note', 'count', 'version', 'locale', 'icon_base']);

/** Ramène un JSON de sortie à une table identifiant → valeur, quelle que soit sa forme. */
function entrees(json) {
  if (!json) return null;
  const m = new Map();
  const pousserTableau = (arr) => {
    for (const [i, v] of arr.entries()) {
      const id = (v && (v.id || v.templateId || v.key || v.name)) || String(i);
      m.set(String(id), v);
    }
  };
  if (Array.isArray(json)) { pousserTableau(json); return m; }
  if (typeof json !== 'object') return null;
  for (const clef of ['items', 'pieces', 'utilities', 'plans', 'augments', 'loot', 'sources', 'locations']) {
    const v = json[clef];
    if (Array.isArray(v)) { pousserTableau(v); return m; }
    if (v && typeof v === 'object') { for (const [k, val] of Object.entries(v)) m.set(k, val); return m; }
  }
  for (const [k, v] of Object.entries(json)) if (!META.has(k) && !k.startsWith('_')) m.set(k, v);
  return m;
}

function empreinte(v) { return crypto.createHash('sha1').update(JSON.stringify(v)).digest('hex').slice(0, 12); }

function diffSorties(avant, apres) {
  const a = entrees(avant), b = entrees(apres);
  if (!a || !b) return null;
  const ajoutes = [], retires = [], changes = [];
  for (const k of b.keys()) if (!a.has(k)) ajoutes.push(k);
  for (const k of a.keys()) if (!b.has(k)) retires.push(k);
  for (const [k, v] of b) if (a.has(k) && empreinte(a.get(k)) !== empreinte(v)) changes.push(k);
  return { avant: a.size, apres: b.size, ajoutes, retires, changes };
}

const echant = (arr, n = 8) => arr.slice(0, n).join(', ') + (arr.length > n ? `, … (+${arr.length - n})` : '');

// ── Analyse de fraîcheur ────────────────────────────────────────────────────
/**
 * Verdict d'une étape. Trois états possibles, dans cet ordre de priorité :
 *   export  — le pak du jeu est plus récent que l'export FModel ⇒ RÉ-EXPORTER d'abord,
 *             relancer le script maintenant ne ferait que reproduire l'ancien contenu.
 *   build   — l'export est plus récent que la dernière exécution ⇒ relancer le script.
 *   ok      — rien à faire.
 */
function analyser(step, ctx) {
  const { jeu, exportRoot, etat } = ctx;
  const pak = pakMtime(jeu, step.paks);
  const srcs = (step.sources || []).map(rel => {
    const abs = path.join(exportRoot, rel);
    return { rel, abs, present: exists(abs), mtime: treeMtime(abs) };
  });
  // Sources hors export FModel (le .usmap vit à côté de FModel, pas dans ses exports).
  // Elles ne se « ré-exportent » pas : on les marque pour que le plan d'action ne
  // demande jamais de les regénérer dans FModel.
  for (const abs of (step.sourcesAbs ? step.sourcesAbs(ctx) : [])) {
    if (!abs) continue;
    srcs.push({ rel: path.basename(abs), abs, present: exists(abs), mtime: treeMtime(abs), horsExport: true });
  }
  const manquants = srcs.filter(s => !s.present).map(s => s.rel);
  const localsManquants = (step.requiresLocal || []).filter(f => !exists(path.join(ROOT, f)));
  const manuelManquant = step.manual && !exists(ctx.exportAddon) ? ctx.exportAddon : null;

  const srcMax = srcs.reduce((m, s) => (s.mtime && s.mtime > m ? s.mtime : m), 0) || null;
  // Périmés côté export : ceux dont le pak est plus récent (marge de 1 h pour absorber
  // l'écart entre le téléchargement Steam et l'horodatage des fichiers extraits).
  const MARGE = 3600 * 1000;
  let aReexporter = pak ? srcs.filter(s => !s.horsExport && (!s.mtime || pak.ms - s.mtime > MARGE)) : [];
  // Un dossier parent déjà listé couvre ses enfants : ne pas demander deux fois le même
  // export (LootTables et LootTables/Loot_DifficultyScaled, par exemple).
  aReexporter = aReexporter.filter(s => !aReexporter.some(a => a !== s && s.rel.startsWith(a.rel + '/')));

  const st = etat.steps[step.id] || null;
  const ranAt = st && st.ran_at ? Date.parse(st.ran_at) : null;
  let sortieMs = ranAt;
  if (!sortieMs) {
    // Pas d'état enregistré (premier usage de l'outil) : on se rabat sur le `generated_at`
    // de la sortie quand elle en porte un. Moins fiable — une sortie modifiée par plusieurs
    // étapes garde le generated_at de la première — mais mieux que rien pour amorcer.
    for (const o of step.outputs || []) {
      const j = readJson(path.join(ROOT, o));
      const g = j && j.generated_at ? Date.parse(j.generated_at) : null;
      if (g && (!sortieMs || g < sortieMs)) sortieMs = g;
    }
  }

  /**
   * Dépendances LOCALES (un .json du dépôt produit par une autre étape).
   * On se fie à leur `generated_at`, jamais à leur mtime : dans un worktree fraîchement
   * créé, tous les fichiers portent la date du checkout — les comparer par mtime
   * déclarerait la totalité du pipeline périmée à chaque fois.
   */
  const localMax = (step.requiresLocal || []).reduce((m, f) => {
    const j = readJson(path.join(ROOT, f));
    const g = j && j.generated_at ? Date.parse(j.generated_at) : null;
    return g && g > m ? g : m;
  }, 0) || null;

  // Garde-fou : condition qui ferait produire au script une sortie DÉGRADÉE (pas une
  // erreur — c'est justement le cas dangereux, il écrit quand même).
  const garde = step.garde ? step.garde(ctx) : null;

  let verdict = 'ok', raison = '';
  if (manquants.length || localsManquants.length || manuelManquant) {
    verdict = 'bloque';
    raison = [
      manquants.length ? `export absent : ${manquants.join(', ')}` : null,
      localsManquants.length ? `fichier local requis : ${localsManquants.join(', ')}` : null,
      manuelManquant ? `source manuelle absente : ${manuelManquant}` : null,
    ].filter(Boolean).join(' · ');
  } else if (aReexporter.length) {
    verdict = 'export';
    raison = `${pak.pak} du ${jour(pak.ms)} plus récent que l'export`;
  } else if (!sortieMs) {
    verdict = 'build';
    raison = 'jamais généré par cet outil (pas d\'état enregistré)';
  } else if (srcMax && srcMax - sortieMs > MARGE) {
    verdict = 'build';
    raison = `export du ${jour(srcMax)} plus récent que la dernière génération (${jour(sortieMs)})`;
  } else if (localMax && localMax - sortieMs > MARGE) {
    verdict = 'build';
    raison = `une dépendance locale a été régénérée depuis (${jour(localMax)})`;
  } else if (!srcs.length && pak && pak.ms - sortieMs > MARGE) {
    // Étape sans DataTable identifiée (recopie de meshes) : le pak fait foi.
    verdict = 'build';
    raison = `${pak.pak} du ${jour(pak.ms)} plus récent que la dernière exécution`;
  }
  return { pak, srcs, aReexporter, sortieMs, localMax, verdict, raison, garde, manquants, localsManquants, manuelManquant };
}

// ── Affichage de --check ────────────────────────────────────────────────────
const MARQUE = { ok: '✓', build: '⟳', export: '⬇', bloque: '✗', optin: '○' };

function afficherCheck(ctx, analyses) {
  const { jeu, reglages, exportRoot, etat } = ctx;
  const lignes = [];
  const P = (s = '') => { lignes.push(s); console.log(s); };

  P('═══ Fraîcheur des données dataminées ═══');
  P('');
  if (jeu.ok) {
    P(`Jeu installé   : build Steam ${jeu.buildId || '?'} — dernière mise à jour ${iso(jeu.lastUpdated)}`);
    if (jeu.pakLePlusRecent) P(`                 conteneur le plus récent : ${jeu.pakLePlusRecent[0]} (${iso(jeu.pakLePlusRecent[1])})`);
    if (jeu.chunke) {
      P('                 ⚠ paks CHUNKÉS (pakchunkNNN-Windows, IoStore) : leur numéro ne dit');
      P('                   pas ce qu\'ils contiennent. Impossible de savoir quel domaine a');
      P('                   bougé → tout ce qui précède ce patch est déclaré à ré-exporter.');
    }
  } else {
    P(`Jeu installé   : INTROUVABLE (${jeu.paksDir || 'chemin inconnu'}) — détection de patch impossible,`);
    P('                 seules les dates d\'export FModel serviront de repère.');
  }
  P(`Export FModel  : ${exportRoot}${exists(exportRoot) ? '' : '  ✗ INTROUVABLE'}`);
  if (reglages.ok) P(`                 (réglages lus dans ${reglages.fichier})`);
  if (reglages.mappings) {
    const m = exists(reglages.mappings);
    P(`Mappings usmap : ${path.basename(reglages.mappings)}${m ? '' : '  ✗ fichier absent'}  (réglage FModel)`);
    const u = ctx.usmap;
    if (u && u.choisi && path.resolve(u.choisi) !== path.resolve(reglages.mappings)) {
      P(`                 ⚠ un .usmap PLUS RÉCENT existe à côté : ${path.basename(u.choisi)}`);
      P('                   (' + iso(treeMtime(u.choisi)) + ') — FModel exporte donc avec un fichier périmé.');
      P('                   Le changer dans FModel : Settings → Mapping.');
    }
  }
  const derniere = etat.updated_at ? `${iso(Date.parse(etat.updated_at))}` : 'jamais';
  P(`Dernier passage: ${derniere}${etat.game && etat.game.build_id ? ` (données issues du build ${etat.game.build_id})` : ''}`);
  if (jeu.ok && etat.game && etat.game.build_id && jeu.buildId && etat.game.build_id !== jeu.buildId) {
    P('');
    P(`⚠ LE JEU A ÉTÉ PATCHÉ depuis le dernier passage de l'outil (build ${etat.game.build_id} → ${jeu.buildId}).`);
  }
  P('');
  P('Étapes  (✓ à jour · ⟳ à régénérer · ⬇ ré-export FModel requis d\'abord · ✗ bloquée · ○ sur demande)');
  P('');
  for (const { step, a } of analyses) {
    const opt = step.optIn && !WITH[step.optIn];
    const marque = opt ? MARQUE.optin : MARQUE[a.verdict];
    P(`${marque} ${step.id.padEnd(16)} ${step.label}`);
    const det = [];
    if (a.pak) det.push(`jeu ${a.pak.pak} ${jour(a.pak.ms)}`);
    const srcMax = a.srcs.reduce((m, s) => (s.mtime && s.mtime > m ? s.mtime : m), 0);
    // « export » désigne l'export FModel ; une source qui n'en vient pas (le .usmap)
    // mérite son propre mot, sinon on cherche en vain le fichier dans les exports.
    const horsExport = a.srcs.length && a.srcs.every(s => s.horsExport);
    if (srcMax) det.push(`${horsExport ? 'source' : 'export'} ${jour(srcMax)}`);
    if (a.sortieMs) det.push(`généré ${jour(a.sortieMs)}`);
    if (det.length) P(`    ${det.join('  ·  ')}`);
    if (a.raison) P(`    → ${a.raison}`);
    if (a.garde) P(`    ⚠ ${a.garde}`);
    if (opt) P(`    (hors passage par défaut : ajoute ${step.optIn === 'planner_import' ? '--run-planner-import' : '--with-' + step.optIn})`);
    if (a.verdict === 'export') for (const s of a.aReexporter) P(`    ⬇ à ré-exporter : Content/Dune/${s.rel}`);
  }

  // ── Plan d'action : la seule partie qu'on lit vraiment quand un patch vient de sortir
  let aExporter = new Set();
  for (const { a } of analyses) for (const s of a.aReexporter) aExporter.add(s.rel);
  // Même dédoublonnage que par étape, mais sur la liste finale : deux étapes peuvent
  // demander l'une un dossier, l'autre un de ses sous-dossiers.
  aExporter = new Set([...aExporter].filter(r => ![...aExporter].some(p => p !== r && r.startsWith(p + '/'))));
  const aBatir = analyses.filter(x => x.a.verdict === 'build' && !(x.step.optIn && !WITH[x.step.optIn])).map(x => x.step.id);
  P('');
  P('═══ À faire ═══');
  P('');
  if (!aExporter.size && !aBatir.length) {
    P('Rien : les données du site correspondent à l\'export FModel, lui-même à jour avec le jeu.');
  }
  if (aExporter.size && ctx.extracteur) {
    // L'extracteur est là : plus aucune raison d'envoyer quelqu'un cliquer dans FModel.
    P('1. node tools/update_datamine.js');
    P('   → l\'étape « export » relit les paks et réécrit ces DataTables toute seule,');
    P('     puis enchaîne sur les étapes qui en dépendent :');
    for (const rel of [...aExporter].sort()) P(`       Content/Dune/${rel}`);
    P('   (FModel reste utile pour explorer à la main et pour les .glb du planner.)');
  } else if (aExporter.size) {
    P('1. Dans FModel — export manuel, car l\'extracteur n\'est pas construit.');
    P('   Pour rendre cette étape automatique : dotnet build tools/extract -c Release');
    P(`   • ouvrir ${jeu.paksDir || 'le dossier Paks du jeu'}`);
    P('   • si le chargement échoue après un patch : rafraîchir la clé AES et les mappings (.usmap)');
    P('   • ré-exporter en JSON (clic droit → Export Raw Data / Save Properties) :');
    for (const rel of [...aExporter].sort()) P(`       Content/Dune/${rel}`);
    P('   • FModel doit être réglé en Français (AssetLanguage) : les descriptions FR en dépendent.');
    P('2. Puis : node tools/update_datamine.js');
  } else if (aBatir.length) {
    P(`1. node tools/update_datamine.js     (régénère : ${aBatir.join(', ')})`);
  }
  P('');
  P('═══ Données dataminées SANS pipeline automatisé ═══');
  P('');
  for (const t of ANGLES_MORTS) {
    P(`⚠ ${t.label}`);
    P(`    ${t.fichiers.join(', ')}`);
    P('    ' + t.detail);
    if (t.automatisable) P(`    → partiellement automatisé : ${t.automatisable}`);
    P('');
  }
  return lignes;
}

// ── Exécution d'une étape ───────────────────────────────────────────────────
function lireSortie(rel) { return readJson(path.join(ROOT, rel)); }

function executer(step, ctx) {
  const argv = step.args ? step.args(ctx) : [];
  // Une étape peut être un exécutable (l'extracteur .NET) plutôt qu'un script node.
  const binaire = step.exe ? step.exe(ctx) : null;
  if (step.exe && !binaire) {
    console.log(`⏭  [${step.id}] SKIP — binaire absent. Construis-le : dotnet build tools/extract -c Release`);
    return { id: step.id, status: 'skipped' };
  }
  const programme = binaire || 'node';
  const arguments_ = binaire ? argv : [step.script, ...argv];
  const cmd = [programme, ...arguments_].join(' ');
  if (DRY_RUN) { console.log(`   (dry-run) ${cmd}`); return { id: step.id, status: 'dry-run', cmd }; }

  const avant = {};
  for (const o of step.outputs || []) avant[o] = lireSortie(o);

  console.log(`\n▶ [${step.id}] ${step.label}`);
  console.log(`   ${cmd}`);
  try {
    execFileSync(programme, arguments_, { cwd: ROOT, stdio: 'inherit' });
  } catch (e) {
    console.error(`✗ [${step.id}] ÉCHEC : ${e.message}`);
    return { id: step.id, status: 'error', error: e.message };
  }
  const diffs = {};
  for (const o of step.outputs || []) diffs[o] = diffSorties(avant[o], lireSortie(o));
  return { id: step.id, status: 'ok', diffs, cmd };
}

/** Étape externe : le script qui régénère base_pieces_v3.json vit hors du dépôt. */
function importPlanner(ctx) {
  // Il est posé à côté de FModel.exe : <...>/Output/Exports → deux crans au-dessus.
  const derive = ctx.exportsRoot
    ? path.join(ctx.exportsRoot, '../../import_building_data.js')
    : null;
  const EXT = [derive, 'J:/Download/Fmodel/import_building_data.js'].filter(Boolean).find(exists)
    || 'J:/Download/Fmodel/import_building_data.js';
  const SORTIE_EXT = 'j:/Download/Serveur/Carte Dune OK/DuneMap/base_pieces_v3.json';
  const LOCALE = path.join(ROOT, 'base_pieces_v3.json');
  if (!exists(EXT)) { console.log(`⏭  [base_pieces_v3] script externe introuvable : ${EXT}`); return { id: 'base_pieces_v3', status: 'skipped' }; }
  if (DRY_RUN) { console.log(`   (dry-run) node ${EXT}`); return { id: 'base_pieces_v3', status: 'dry-run' }; }
  const avant = lireSortie('base_pieces_v3.json');
  console.log(`\n▶ [base_pieces_v3] script externe : ${EXT}`);
  try { execFileSync('node', [EXT], { stdio: 'inherit' }); }
  catch (e) { console.error(`✗ [base_pieces_v3] ÉCHEC : ${e.message}`); return { id: 'base_pieces_v3', status: 'error', error: e.message }; }
  const ext = path.resolve(SORTIE_EXT);
  if (ext.toLowerCase() !== LOCALE.toLowerCase() && exists(ext)) {
    fs.copyFileSync(ext, LOCALE);
    console.log(`    → recopié dans ce dépôt : ${LOCALE}`);
  }
  return { id: 'base_pieces_v3', status: 'ok', diffs: { 'base_pieces_v3.json': diffSorties(avant, lireSortie('base_pieces_v3.json')) } };
}

// ── Programme principal ─────────────────────────────────────────────────────
const reglages = lireReglagesFModel();
const exportRoot = trouverRacineExport(reglages);
const jeu = lireEtatJeu(reglages);
const etat = lireEtat();
const ctx = {
  reglages, exportRoot, jeu, etat,
  exportsRoot: reglages.exportsRoot,
  exportAddon: valOf('univers-src') || 'J:/Download/plans total.txt',
  usmap: usmapLePlusRecent(reglages),
  extracteur: (() => {
    const p = path.join(ROOT, 'tools/extract/bin/Release/net10.0/DuneExtract.exe');
    return exists(p) ? p : null;
  })(),
};

if (!exists(exportRoot)) {
  console.error(`✗ Racine d'export FModel introuvable : ${exportRoot}`);
  console.error('  → règle-la avec --export=<chemin vers ...\\Exports\\DuneSandbox\\Content\\Dune>');
  if (!CHECK_ONLY) process.exit(1);
}

const analyses = STEPS.map(step => ({ step, a: analyser(step, ctx) }));

if (CHECK_ONLY) {
  const lignes = afficherCheck(ctx, analyses);
  if (REPORT) { fs.writeFileSync(REPORT, '```\n' + lignes.join('\n') + '\n```\n'); console.log(`\n(compte rendu écrit dans ${REPORT})`); }
  const duTravail = analyses.some(x => !(x.step.optIn && !WITH[x.step.optIn]) && (x.a.verdict === 'build' || x.a.verdict === 'export'));
  process.exit(duTravail ? 2 : 0);   // code 2 = action requise (utilisable dans une tâche planifiée)
}

// Sélection des étapes à lancer.
// Un garde-fou armé écarte l'étape MÊME avec --only : le cas dangereux est justement
// celui où le script écrirait sans échouer. Seul --force passe outre, délibérément.
const gardees = analyses.filter(x => x.a.garde && !FORCE);
for (const { step, a } of gardees) {
  console.log(`⚠ [${step.id}] écartée — ${a.garde}`);
}
if (gardees.length) console.log('');

let aLancer = analyses.filter(({ step, a }) => {
  if (a.garde && !FORCE) return false;
  if (ONLY) return step.id === ONLY;
  if (step.optIn && !WITH[step.optIn]) return false;
  if (a.verdict === 'bloque') return false;
  if (a.verdict === 'export') return false;              // relancer sur un export périmé ne sert à rien
  return FORCE || a.verdict === 'build';
});

/**
 * Cascade : régénérer stuff_loot.json périme plans_index.json, régénérer base_pieces_v3.json
 * périme planner_pieces.json… Sans ça, un passage laisse des fichiers incohérents entre eux
 * jusqu'au passage SUIVANT, et le diff du patch se retrouve étalé sur deux exécutions.
 */
if (!ONLY) {
  const produits = new Set(aLancer.flatMap(x => x.step.outputs || []));
  let ajout = true;
  while (ajout) {
    ajout = false;
    for (const x of analyses) {
      if (aLancer.includes(x)) continue;
      if (x.step.optIn && !WITH[x.step.optIn]) continue;
      if (x.a.verdict === 'bloque' || x.a.verdict === 'export') continue;
      if (!(x.step.requiresLocal || []).some(f => produits.has(f))) continue;
      aLancer.push(x);
      (x.step.outputs || []).forEach(o => produits.add(o));
      ajout = true;
    }
  }
  // On reste dans l'ordre de déclaration : c'est l'ordre des dépendances.
  aLancer.sort((p, q) => STEPS.indexOf(p.step) - STEPS.indexOf(q.step));
}

if (ONLY && !aLancer.length) {
  const connue = STEPS.some(s => s.id === ONLY);
  console.error(connue
    ? `Étape « ${ONLY} » écartée (voir la raison ci-dessus). --force pour l'exécuter quand même.`
    : `Étape inconnue : ${ONLY} (identifiants : ${STEPS.map(s => s.id).join(', ')})`);
  process.exit(1);
}

// Rappel des étapes sautées, pour ne pas croire à tort que tout est couvert.
const bloquees = analyses.filter(x => x.a.verdict === 'bloque' && !(x.step.optIn && !WITH[x.step.optIn]));
const periemees = analyses.filter(x => x.a.verdict === 'export');
if (periemees.length) {
  console.log('⚠ Ré-export FModel requis AVANT de régénérer ces étapes (sautées) :');
  for (const { step, a } of periemees) console.log(`    ${step.id} — ${a.raison}`);
  console.log('  Détail des chemins à ré-exporter : node tools/update_datamine.js --check\n');
}
if (bloquees.length) {
  console.log('⚠ Étapes bloquées (dépendance absente, sautées) :');
  for (const { step, a } of bloquees) console.log(`    ${step.id} — ${a.raison}`);
  console.log('');
}
if (!aLancer.length) {
  console.log(periemees.length
    ? 'Rien à régénérer MAINTENANT : ce qui reste attend le ré-export FModel listé ci-dessus.'
    : 'Rien à régénérer : tout est à jour (--force pour tout relancer quand même).');
  process.exit(0);
}

console.log(`Pipeline : ${aLancer.map(x => x.step.id).join(' → ')}`);

// Une étape « externe » (script hors dépôt) a son propre lanceur.
const resultats = [];
const dejaFaites = new Set();
for (const { step } of aLancer) {
  resultats.push(step.external ? importPlanner(ctx) : executer(step, ctx));
  dejaFaites.add(step.id);
}

/**
 * L'export vient peut-être de rafraîchir les DataTables : les étapes écartées faute
 * d'export à jour sont désormais faisables. Sans cette reprise, il faudrait relancer la
 * commande une seconde fois — et surtout le diff du patch arriverait en deux morceaux,
 * répartis sur deux exécutions.
 */
if (resultats.some(r => r.id === 'export' && r.status === 'ok') && !ONLY && !DRY_RUN) {
  // En BOUCLE, et non en une passe : une dépendance à deux niveaux serait sinon ratée.
  // Vécu le 2026-10-20 — l'export a débloqué base_pieces_v3, mais planner_pieces (qui
  // dépend de base_pieces_v3, pas de l'export) a été évalué AVANT que base_pieces_v3 ne
  // tourne, donc jugé à jour. Le catalogue du planner est resté en arrière d'un cran,
  // silencieusement. On réévalue donc après chaque vague, jusqu'à ce que plus rien ne
  // bouge.
  for (let vague = 0; vague < 6; vague++) {
    const suite = STEPS
      .filter(st => !dejaFaites.has(st.id))
      .filter(st => !(st.optIn && !WITH[st.optIn]))
      .map(st => ({ step: st, a: analyser(st, ctx) }))
      .filter(x => !x.a.garde && (x.a.verdict === 'build' || (FORCE && x.a.verdict === 'ok')));
    if (!suite.length) break;
    console.log(`
▶ Reprise (vague ${vague + 1}) : ${suite.map(x => x.step.id).join(', ')}`);
    for (const { step } of suite) {
      resultats.push(step.external ? importPlanner(ctx) : executer(step, ctx));
      dejaFaites.add(step.id);
    }
  }
}

// ── Compte rendu ────────────────────────────────────────────────────────────
const rapport = [];
const R = (s = '') => { rapport.push(s); console.log(s); };
R('');
R('═══ Résultat ═══');
for (const r of resultats) R(`  ${r.status === 'ok' ? '✓' : r.status === 'error' ? '✗' : '·'} ${r.id} — ${r.status}`);
R('');
R('═══ Ce que le patch a changé ═══');
let rienChange = true;
for (const r of resultats) {
  for (const [fichier, d] of Object.entries(r.diffs || {})) {
    if (!d) { R(`  ${fichier} : comparaison impossible (forme inattendue) — vérifie le diff git`); rienChange = false; continue; }
    if (!d.ajoutes.length && !d.retires.length && !d.changes.length) { R(`  ${fichier} : aucun changement (${d.apres} entrées)`); continue; }
    rienChange = false;
    R(`  ${fichier} : ${d.avant} → ${d.apres} entrées  (+${d.ajoutes.length} −${d.retires.length} ~${d.changes.length})`);
    if (d.ajoutes.length) R(`      ajoutés  : ${echant(d.ajoutes)}`);
    if (d.retires.length) R(`      retirés  : ${echant(d.retires)}`);
    if (d.changes.length) R(`      modifiés : ${echant(d.changes)}`);
  }
}
if (DRY_RUN) R('  (dry-run : rien n\'a été exécuté, donc rien à comparer)');
else if (rienChange) R('  (rien de neuf — les données du site reflétaient déjà cet export)');

// ── Mise à jour de l'état ───────────────────────────────────────────────────
if (!DRY_RUN) {
  etat.game = jeu.ok
    ? { build_id: jeu.buildId, last_updated: jeu.lastUpdated ? new Date(jeu.lastUpdated).toISOString() : null, paks_dir: jeu.paksDir }
    : etat.game;
  etat.export = { root: exportRoot, mappings: reglages.mappings ? path.basename(reglages.mappings) : null };
  const maintenant = new Date().toISOString();
  for (const r of resultats) {
    if (r.status !== 'ok') continue;
    const step = STEPS.find(s => s.id === r.id);
    const sources = {};
    if (step) for (const rel of step.sources || []) {
      const m = treeMtime(path.join(exportRoot, rel));
      if (m) sources[rel] = new Date(m).toISOString();
    }
    const sorties = {};
    for (const o of (step && step.outputs) || []) {
      const e = entrees(lireSortie(o));
      if (e) sorties[o] = { entrees: e.size };
    }
    etat.steps[r.id] = { ran_at: maintenant, game_build_id: jeu.buildId || null, sources, outputs: sorties };
  }
  ecrireEtat(etat);
  R('');
  R(`(état enregistré dans ${path.relative(ROOT, STATE_FILE).replace(/\\/g, '/')} — versionne-le avec les données)`);
}

R('');
R('Rappel : rien n\'a été commité ni déployé. Relis les diffs, teste en local, puis');
R('commite et envoie les fichiers concernés par WinSCP (d\'abord /v2, puis la racine).');

if (REPORT) { fs.writeFileSync(REPORT, '```\n' + rapport.join('\n') + '\n```\n'); console.log(`\n(compte rendu écrit dans ${REPORT})`); }
process.exit(resultats.some(r => r.status === 'error') ? 1 : 0);
