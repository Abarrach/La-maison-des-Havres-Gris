#!/usr/bin/env node
'use strict';
/**
 * update_datamine.js — Orchestrateur du pipeline de données dataminées.
 *
 * À relancer après CHAQUE mise à jour du jeu (patch Funcom) pour vérifier si les
 * fichiers *.json servis par le site ont besoin d'être régénérés, et les régénérer
 * dans le bon ordre. Ne fait rien de destructif : chaque étape est un script
 * `tools/build_*.js` déjà existant, appelé ici avec les bons arguments et dans
 * le bon ordre de dépendances. Ce script ne fait qu'orchestrer + vérifier.
 *
 * ⚠️ Pré-requis obligatoire AVANT de lancer une mise à jour : ré-exporter les
 * DataTables du jeu avec FModel (après un patch) vers
 * J:/Download/Fmodel/Output/Exports/DuneSandbox/... — voir --check pour la liste
 * exacte des chemins attendus et leur date de dernière modification.
 *
 * Usage :
 *   node tools/update_datamine.js --check          Vérifie l'état du pipeline sans rien écrire (SANS RISQUE).
 *   node tools/update_datamine.js                   Régénère tout (sauf l'étape réseau gaming.tools, lente/fragile).
 *   node tools/update_datamine.js --with-snapshot   Inclut aussi la régénération de stuff_data.json / stuff_skills.json
 *                                                    depuis gaming.tools (~30 min, throttle Cloudflare, voir cette étape).
 *   node tools/update_datamine.js --only=recipes     Ne relance qu'une étape (id ci-dessous).
 *   node tools/update_datamine.js --run-planner-import  Lance aussi le script EXTERNE qui régénère
 *                                                        base_pieces_v3.json (voir note plus bas).
 *
 * Après régénération, le script affiche un résumé (compteurs avant/après comparés
 * au dernier commit git) pour voir d'un coup d'œil si le patch a changé quoi que
 * ce soit. Les fichiers modifiés restent dans l'arbre de travail : à toi de les
 * relire, tester le site en local, puis commiter + déployer (WinSCP) toi-même.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const FMODEL_SYSTEMS = 'J:/Download/Fmodel/Output/Exports/DuneSandbox/Content/Dune/Systems';
const FMODEL_ENV     = 'J:/Download/Fmodel/Output/Exports/DuneSandbox/Content/Dune/Environment';

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const onlyArg = (args.find(a => a.startsWith('--only=')) || '').slice(7) || null;
const CHECK_ONLY = has('--check') || has('--list');
const WITH_SNAPSHOT = has('--with-snapshot');
const RUN_PLANNER_IMPORT = has('--run-planner-import');

function exists(p) { return p && fs.existsSync(p); }
function mtimeStr(p) {
  try { return fs.statSync(p).mtime.toISOString().slice(0, 16).replace('T', ' '); }
  catch (e) { return null; }
}

// ── Définition du pipeline ──────────────────────────────────────────────────
// Ordre = ordre de dépendance réel (ex. descriptions/armor/loot ont besoin que
// stuff_data.json existe déjà — snapshot ou un commit précédent suffit).
const STEPS = [
  {
    id: 'snapshot',
    label: 'Snapshot gaming.tools (liste items + skills)',
    script: 'tools/build_stuff_snapshot.js',
    outputs: ['stuff_data.json', 'stuff_skills.json', 'stuff_names.json'],
    network: true,
    optIn: true, // ne tourne que si --with-snapshot (lent : ~30 min, throttle Cloudflare)
    fmodelDeps: [],
    note: '⚠ Réseau, ~30 min, peut être bloqué (403 Cloudflare) selon l\'IP. Reprenable : relance si incomplet.'
      + ' Nécessaire seulement pour repérer de VRAIS NOUVEAUX objets ajoutés par le patch (armes/armures/augments/'
      + 'utilitaires) — si aucun nouvel objet n\'est sorti, les étapes datamine suivantes suffisent.',
  },
  {
    id: 'recipes',
    label: 'Recettes de craft (datamine)',
    script: 'tools/build_recipes_from_datamine.js',
    outputs: ['stuff_recipes.json'],
    fmodelDeps: [`${FMODEL_SYSTEMS}/Crafting/DT_ItemsCraftingRecipes.json`],
  },
  {
    id: 'descriptions',
    label: 'Descriptions FR (datamine)',
    script: 'tools/build_descriptions_from_datamine.js',
    outputs: ['stuff_data.json'],
    fmodelDeps: [`${FMODEL_SYSTEMS}/Items/CDT_BaseItems.json`],
    requiresLocal: ['stuff_data.json'],
  },
  {
    id: 'armor',
    label: 'Stats d\'armure (datamine)',
    script: 'tools/build_armor_stats_from_datamine.js',
    outputs: ['stuff_data.json'],
    fmodelDeps: [`${FMODEL_SYSTEMS}/Items/DT_ArmorItemTable.json`],
    requiresLocal: ['stuff_data.json'],
  },
  {
    id: 'augments',
    label: 'Effets d\'augments (datamine)',
    script: 'tools/build_augments_from_datamine.js',
    outputs: ['stuff_augments.json'],
    fmodelDeps: [
      `${FMODEL_SYSTEMS}/Items/DT_ItemTable_Augments.json`,
      `${FMODEL_SYSTEMS}/Items/Upgrades`,
    ],
    requiresLocal: ['stuff_data.json'],
  },
  {
    id: 'loot',
    label: 'Emplacements de loot (lieux nommés, datamine)',
    script: 'tools/build_loot_locations_from_datamine.js',
    outputs: ['stuff_loot.json'],
    fmodelDeps: [
      `${FMODEL_SYSTEMS}/LootTables/Loot_DifficultyScaled`,
    ],
    requiresLocal: ['stuff_data.json'],
  },
  {
    id: 'planner_pieces',
    label: 'Catalogue unifié du planner (fusion base_pieces_v3 + sockets)',
    script: 'tools/build_planner_pieces.js',
    outputs: ['planner_pieces.json'],
    fmodelDeps: [],
    requiresLocal: ['base_pieces_v3.json', 'dune_pieces_sockets.json'],
  },
];

// ── Étapes hors pipeline standard : signalées mais pas exécutées d'office ────
const EXTERNAL_NOTES = [
  {
    id: 'base_pieces_v3',
    label: 'base_pieces_v3.json (670 pièces du Constructeur de Base)',
    detail:
      'Généré par un script EXTERNE au dépôt : J:/Download/Fmodel/import_building_data.js\n' +
      '    (hors git, présent uniquement sur cette machine). Dépend de :\n' +
      `      ${FMODEL_SYSTEMS}/Building/Data/BuildingData/*.json\n` +
      `      ${FMODEL_SYSTEMS}/Building/Data/BuildableGroupData/DT_BuildableGroupData_Building.json\n` +
      `      ${FMODEL_SYSTEMS}/Building/Data/DT_DuneBuildableUiSubcategory.json\n` +
      `      ${FMODEL_SYSTEMS}/Building/Data/PlaceableData/DT_PlaceableData_Functional.json\n` +
      `      ${FMODEL_SYSTEMS}/Vehicles/Blueprints/{Ground,Flying}Vehicles/BP_*.json\n` +
      '    ⚠ PIÈGE CONNU : ce script écrit toujours vers le chemin ABSOLU codé en dur\n' +
      '    "j:/Download/Serveur/Carte Dune OK/DuneMap/base_pieces_v3.json" (la racine du\n' +
      '    dépôt PRINCIPAL), jamais vers le worktree courant. Lancé avec --run-planner-import,\n' +
      '    ce script copie le résultat dans CE dépôt après coup pour compenser.',
  },
  {
    id: 'sockets_data',
    label: 'dune_pieces_sockets.json / dune_socket_profiles.json / dune_group_config.json',
    detail:
      'AUCUN script de régénération connu n\'existe pour ces 3 fichiers (552 pièces,\n' +
      '    71 profils de sockets, 92 groupes). D\'après le README, ils viennent d\'un\n' +
      '    reverse engineering de dune.layout.tools + extraction FModel fait manuellement\n' +
      '    lors d\'une session antérieure — pas d\'automatisation retrouvée sur cette machine.\n' +
      '    ⚠ Si un patch du jeu change la géométrie/les sockets des pièces de construction,\n' +
      '    CES 3 FICHIERS NE SE METTRONT PAS À JOUR AUTOMATIQUEMENT. Il faudra soit\n' +
      '    retrouver/reconstruire ce pipeline, soit refaire le reverse engineering.\n' +
      '    (Seul base_planner.js dégrade proprement : une pièce sans entrée dans ce fichier\n' +
      '    retombe sur une pose "cellule" simple, sans sockets ni mesh réel.)',
  },
];

function checkPrereqs(step) {
  const missingFmodel = (step.fmodelDeps || []).filter(p => !exists(p));
  const missingLocal = (step.requiresLocal || []).filter(f => !exists(path.join(ROOT, f)));
  return { missingFmodel, missingLocal, ready: !missingFmodel.length && !missingLocal.length };
}

function printCheck() {
  console.log('=== État du pipeline datamine (--check, aucune écriture) ===\n');
  for (const step of STEPS) {
    if (step.optIn && !WITH_SNAPSHOT) {
      console.log(`○ ${step.id.padEnd(15)} ${step.label} — [réseau, opt-in --with-snapshot]`);
      continue;
    }
    const { missingFmodel, missingLocal, ready } = checkPrereqs(step);
    const mark = ready ? '✓' : '✗';
    console.log(`${mark} ${step.id.padEnd(15)} ${step.label}`);
    for (const p of (step.fmodelDeps || [])) {
      const ok = exists(p);
      console.log(`    ${ok ? '✓' : '✗ MANQUANT'}  ${p}${ok ? '  (modifié ' + mtimeStr(p) + ')' : ''}`);
    }
    if (missingLocal.length) console.log(`    ✗ fichier(s) local requis manquant(s) : ${missingLocal.join(', ')}`);
  }
  console.log('\n=== Données sans pipeline automatisé connu ===\n');
  for (const n of EXTERNAL_NOTES) {
    console.log(`⚠ ${n.label}`);
    console.log('    ' + n.detail);
    console.log('');
  }
}

function runStep(step) {
  const { missingFmodel, missingLocal, ready } = checkPrereqs(step);
  if (!ready) {
    console.log(`⏭  [${step.id}] SKIP — dépendance(s) manquante(s) : ${[...missingFmodel, ...missingLocal].join(', ')}`);
    return { id: step.id, status: 'skipped' };
  }
  console.log(`\n▶ [${step.id}] ${step.label}`);
  try {
    execFileSync('node', [step.script], { cwd: ROOT, stdio: 'inherit' });
    return { id: step.id, status: 'ok', outputs: step.outputs };
  } catch (e) {
    console.error(`✗ [${step.id}] ÉCHEC : ${e.message}`);
    return { id: step.id, status: 'error', error: e.message };
  }
}

// ── Comparaison avant/après vs le dernier commit git (compteurs, pas juste octets) ──
function gitShowSafe(rel) {
  try { return execFileSync('git', ['show', `HEAD:${rel}`], { cwd: ROOT, maxBuffer: 1024 * 1024 * 64 }).toString('utf8'); }
  catch (e) { return null; }
}
function summarize(rel) {
  const before = gitShowSafe(rel);
  let after;
  try { after = fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch (e) { return null; }
  if (before === null) return `${rel} : pas de version commitée à comparer`;
  // Normalise CRLF→LF avant de comparer : git (autocrlf) peut réécrire les fins de
  // ligne dans l'arbre de travail sans que le CONTENU logique ait changé — une
  // comparaison octet-à-octet donnerait un faux "CHANGÉ" à chaque exécution.
  const norm = (s) => s.replace(/\r\n/g, '\n');
  if (norm(before) === norm(after)) return `${rel} : identique au dernier commit (rien de nouveau)`;
  try {
    const b = JSON.parse(before), a = JSON.parse(after);
    const count = (o) => {
      if (Array.isArray(o)) return o.length;
      if (o && typeof o === 'object') {
        if (Array.isArray(o.items)) return o.items.length;
        if (Array.isArray(o.pieces)) return o.pieces.length;
        if (o.augments) return Object.keys(o.augments).length;
        if (o.loot) return Object.keys(o.loot).length;
        return Object.keys(o).length;
      }
      return null;
    };
    const cb = count(b), ca = count(a);
    return `${rel} : CHANGÉ (${cb ?? '?'} → ${ca ?? '?'} entrées) — relis le diff avant de déployer`;
  } catch (e) {
    return `${rel} : CHANGÉ (contenu non-JSON comparable, vérifie manuellement)`;
  }
}

// ── Étape externe optionnelle : import_building_data.js ─────────────────────
function runPlannerImport() {
  const EXT_SCRIPT = 'J:/Download/Fmodel/import_building_data.js';
  const EXT_OUTPUT = 'j:/Download/Serveur/Carte Dune OK/DuneMap/base_pieces_v3.json';
  const LOCAL_OUTPUT = path.join(ROOT, 'base_pieces_v3.json');
  if (!exists(EXT_SCRIPT)) {
    console.log(`⏭  [base_pieces_v3] SKIP — script externe introuvable : ${EXT_SCRIPT}`);
    return;
  }
  console.log(`\n▶ [base_pieces_v3] Lancement du script externe (${EXT_SCRIPT})`);
  execFileSync('node', [EXT_SCRIPT], { stdio: 'inherit' });
  // Le script externe écrit toujours vers la racine du dépôt PRINCIPAL (chemin codé
  // en dur) — si on tourne depuis un autre checkout/worktree, on resynchronise ici.
  const normExt = path.resolve(EXT_OUTPUT);
  if (normExt.toLowerCase() !== LOCAL_OUTPUT.toLowerCase() && exists(normExt)) {
    fs.copyFileSync(normExt, LOCAL_OUTPUT);
    console.log(`    → copié vers ce dépôt : ${LOCAL_OUTPUT}`);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────
if (CHECK_ONLY) {
  printCheck();
  process.exit(0);
}

const runExternal = RUN_PLANNER_IMPORT && (!onlyArg || onlyArg === 'base_pieces_v3');
const toRun = STEPS.filter(s => (!s.optIn || WITH_SNAPSHOT) && (!onlyArg || s.id === onlyArg));
if (!toRun.length && !runExternal) {
  console.error(onlyArg ? `Étape inconnue : ${onlyArg} (voir --check pour la liste des id)` : 'Rien à faire.');
  process.exit(1);
}

console.log(`Pipeline : ${toRun.map(s => s.id).join(' → ') || '(aucune étape locale)'}${runExternal ? ' (+ base_pieces_v3 externe)' : ''}\n`);

const results = [];
let externalRan = false;
if (runExternal) { runPlannerImport(); externalRan = true; }
for (const step of toRun) results.push(runStep(step));

console.log('\n=== Résumé ===');
if (externalRan) console.log('  ✓ base_pieces_v3 — ok (externe)');
for (const r of results) {
  console.log(`  ${r.status === 'ok' ? '✓' : r.status === 'skipped' ? '⏭' : '✗'} ${r.id} — ${r.status}`);
}

console.log('\n=== Ce qui a changé vs le dernier commit git ===');
const touched = new Set();
for (const step of toRun) if (results.find(r => r.id === step.id && r.status === 'ok')) (step.outputs || []).forEach(o => touched.add(o));
if (externalRan) touched.add('base_pieces_v3.json');
if (!touched.size) console.log('  (aucune étape exécutée avec succès)');
for (const rel of touched) console.log('  ' + summarize(rel));

console.log('\nRappel : ce script ne commite ni ne déploie rien. Relis les diffs, teste en local,');
console.log('puis commit + déploie (WinSCP) les fichiers concernés toi-même.');
console.log('Pense aussi à relancer `node tools/flatten_glb.js` si des meshes ont changé,');
console.log('et vérifie --check pour les 2 fichiers de données sans pipeline automatisé (sockets).');
