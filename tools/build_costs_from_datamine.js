#!/usr/bin/env node
'use strict';
/**
 * build_costs_from_datamine.js — Coûts de construction, pris dans le jeu.
 *
 * ── Ce que ce script corrige ────────────────────────────────────────────────
 * `planner_costs.json` vient de TroubleChute (tools.tcno.co/dune, crédité), et le
 * dépôt affirmait que ces coûts n'étaient « pas dataminables : InstancedStruct ».
 * C'est faux, et cette phrase a dissuadé de rouvrir le sujet pendant des mois :
 * `CDT_BuildableGroupData` porte `m_BuildableTierData[].m_PlacementCosts`, soit les
 * coûts par palier EN CLAIR. Ce qui bloquait réellement, c'était la table des types
 * de `TMap` — sans elle, la map sortait vide, d'où la fausse conclusion.
 *
 * Conséquences concrètes de la dépendance : les coûts étaient figés à la date du
 * relevé de tcno, et un set ajouté par un patch (Sardaukar, 2026-10-19) n'en avait
 * aucun tant que tcno ne l'avait pas relevé.
 *
 * ── Le modèle réel du jeu ───────────────────────────────────────────────────
 * Le coût ne dépend pas du « set » (notion de tcno) mais du couple
 * **groupe × palier** : une Fondation coûte 12 pierres en Tier0 et 15 en Tier1. Et le
 * palier est porté par la PIÈCE, pas par la faction — les Atréides ont 85 pièces en
 * Tier2 et 8 en Tier0. Indexer par pièce est donc plus juste que le pont
 * faction → set → nom anglais utilisé jusqu'ici.
 *
 * ── Nommage des matériaux ───────────────────────────────────────────────────
 * Les coûts désignent les matériaux par identifiant interne (`Stone`). On les traduit
 * via `CDT_BaseItems` → `Name.SourceString`, qui donne « Granite Stone » : exactement
 * le nom employé par tcno. Les deux sources s'agrègent donc dans la même ligne de
 * synthèse. Prendre le nom français ici couperait chaque matériau en deux.
 *
 * ── Prudence ────────────────────────────────────────────────────────────────
 * On AJOUTE une clé `by_piece` sans toucher aux données tcno existantes, et le planner
 * s'en sert en priorité avec repli sur l'ancien chemin. Si une valeur dataminée était
 * fausse, le repli reste disponible et la comparaison ci-dessous le dirait.
 *
 * Usage :
 *   node tools/build_costs_from_datamine.js --check   compare à tcno, n'écrit rien
 *   node tools/build_costs_from_datamine.js           écrit planner_costs.json
 */
const fs = require('fs');
const path = require('path');

const RACINE = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const CHECK = args.includes('--check');
const SYS = args.find(a => !a.startsWith('--'))
  || 'J:/Download/Fmodel/Output/Exports/DuneSandbox/Content/Dune/Systems';

const F_GROUP = path.join(SYS, 'Building/Data/CDT_BuildableGroupData.json');
const D_BUILD = path.join(SYS, 'Building/Data/BuildingData');
const F_ITEMS = path.join(SYS, 'Items/CDT_BaseItems.json');
const F_COSTS = path.join(RACINE, 'planner_costs.json');

for (const f of [F_GROUP, D_BUILD, F_ITEMS]) {
  if (!fs.existsSync(f)) {
    console.error(`Introuvable : ${f}\n→ lance d'abord : DuneExtract --config tools/extract/extract.config.json --only building,base_items`);
    process.exit(1);
  }
}
const lire = (f) => { const j = JSON.parse(fs.readFileSync(f, 'utf8')); return (Array.isArray(j) ? j[0] : j).Rows || {}; };

// ── Matériaux : identifiant interne → nom anglais (celui de tcno) ───────────
const materiaux = {};
for (const [id, r] of Object.entries(lire(F_ITEMS))) {
  const n = r && r.StaticData && r.StaticData.Name;
  if (n && n.SourceString) materiaux[id] = n.SourceString;
}
const nomMateriau = (id) => materiaux[id] || id;

// ── Coûts par groupe × palier ───────────────────────────────────────────────
const parGroupe = {};
for (const [groupe, g] of Object.entries(lire(F_GROUP))) {
  const paliers = {};
  for (const entree of (g.m_BuildableTierData || [])) {
    const palier = entree.Key && entree.Key.Name;
    const v = entree.Value || {};
    if (!palier) continue;
    const res = {};
    for (const c of (v.m_PlacementCosts || [])) {
      const id = c.Key && c.Key.Name;
      if (id && typeof c.Value === 'number') res[nomMateriau(id)] = c.Value;
    }
    paliers[palier] = { resources: res, health: v.m_MaxHealth || null };
  }
  parGroupe[groupe] = paliers;
}

// ── Groupe + palier de chaque pièce ─────────────────────────────────────────
const pieces = {};
for (const f of fs.readdirSync(D_BUILD)) {
  if (!f.startsWith('DT_BuildingData_') || !f.endsWith('.json')) continue;
  for (const [id, r] of Object.entries(lire(path.join(D_BUILD, f)))) {
    const groupe = r.m_BuildableGroupType && r.m_BuildableGroupType.Name;
    const palier = r.m_BuildableTier && r.m_BuildableTier.Name;
    if (!groupe || !palier) continue;
    const cout = (parGroupe[groupe] || {})[palier];
    if (!cout || !Object.keys(cout.resources).length) continue;
    pieces[id] = { resources: cout.resources, group: groupe, tier: palier };
    if (cout.health) pieces[id].health = cout.health;
  }
}

// ── Machines et utilitaires (placeables) ────────────────────────────────────
// Même modèle groupe × palier que les pièces, mais la ligne de `CDT_PlaceableData`
// porte EN PLUS l'énergie et l'eau. Ces valeurs venaient jusqu'ici de tcno, figées
// avant la 1.5.3.0 (17/09/2026) : épice encore exigée par les fabricateurs avancés,
// coûts d'avant la baisse de 10 à 25 %, et production d'eau des deux pièges à vent
// INVERSÉE et en unités par seconde. gaming.tools affiche bien 2 700/h et 6 300/h,
// soit les 6 et 14 unités toutes les 8 s du jeu.
// Eau : seule la production PASSIVE est une donnée de la ligne. Distilles et
// purificateurs ne produisent qu'en traitant du sang ou des corps, ce qui n'y figure
// pas (0) — on ne l'invente pas, le planner le signale à part.
const F_PLACE = path.join(SYS, 'Building/Data/CDT_PlaceableData.json');
const placeables = {};
if (fs.existsSync(F_PLACE)) {
  for (const [id, r] of Object.entries(lire(F_PLACE))) {
    const groupe = r.m_BuildableGroupType && r.m_BuildableGroupType.Name;
    const palier = r.m_BuildableTier && r.m_BuildableTier.Name;
    const cout = groupe && palier ? (parGroupe[groupe] || {})[palier] : null;
    const power = (r.m_PowerProduction || 0) - (r.m_PowerConsumption || 0);
    const qte = r.m_WaterGenerationAmountPerUpdate || 0, periode = r.m_WaterGenerationRateInSecs || 0;
    const eauH = qte > 0 && periode > 0 ? Math.round(qte * 3600 / periode) : 0;
    if (!(cout && Object.keys(cout.resources).length) && !power && !eauH) continue;
    placeables[id] = { resources: cout ? cout.resources : {}, power, group: groupe || null, tier: palier || null };
    if (eauH) placeables[id].water_per_h = eauH;
    if (r.m_WaterCapacity > 0 && r.m_bCanStoreWater) placeables[id].water_capacity = r.m_WaterCapacity;
  }
} else {
  console.warn(`⚠ ${F_PLACE} introuvable : coûts des machines non régénérés (le planner garde tcno).`);
}

function comparerMachines() {
  const tcno = JSON.parse(fs.readFileSync(F_COSTS, 'utf8')).functional || {};
  const catalogue = JSON.parse(fs.readFileSync(path.join(RACINE, 'planner_pieces.json'), 'utf8')).pieces || [];
  const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const parNom = new Map(Object.entries(tcno).map(([k, v]) => [norm(k), v]));
  let couvertes = 0, identiques = 0;
  const ecarts = [], sans = [];
  for (const p of catalogue) {
    if (p.faction_id !== 'placeables') continue;
    const nous = placeables[p.id];
    if (!nous) { sans.push(p.id); continue; }
    couvertes++;
    const chez = parNom.get(norm(p.label_en)) || parNom.get(norm(p.label_en) + 's');
    if (!chez) continue;
    if (JSON.stringify(chez.resources || {}) === JSON.stringify(nous.resources) && (chez.power || 0) === nous.power) identiques++;
    else ecarts.push(`${p.id} : tcno ${JSON.stringify(chez.resources)} ${chez.power || 0}W → jeu ${JSON.stringify(nous.resources)} ${nous.power}W`);
  }
  console.log('\n=== Machines : confrontation avec tcno ===');
  console.log(`  machines du catalogue chiffrées par le jeu : ${couvertes} (sans : ${sans.join(', ') || 'aucune'})`);
  console.log(`  identiques à tcno : ${identiques} · différentes : ${ecarts.length} (attendu : tcno est d'avant la 1.5.3.0)`);
  for (const e of ecarts.slice(0, 8)) console.log('    ' + e);
  if (ecarts.length > 8) console.log(`    … (+${ecarts.length - 8})`);
}

// ── Comparaison avec les valeurs tcno (c'est la validation) ─────────────────
// On rejoue le pont du planner — faction → set, label_en → nom tcno — pour confronter
// les deux sources sur les pièces que tcno couvre.
function comparer() {
  const tcno = JSON.parse(fs.readFileSync(F_COSTS, 'utf8'));
  const catalogue = JSON.parse(fs.readFileSync(path.join(RACINE, 'base_pieces_v3.json'), 'utf8')).pieces || [];
  const FACTION_TO_SET = {
    atreides: 'Atreides Stronghold', harkonnen: 'Harkonnen Stronghold',
    choam_shelter: 'CHOAM Shelter', choam: 'CHOAM Facility',
  };
  const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const index = {};
  for (const [set, data] of Object.entries(tcno.buildings || {})) {
    const m = new Map();
    for (const sous of Object.values(data.items || {})) {
      for (const [nom, v] of Object.entries(sous)) {
        m.set(norm(nom), typeof v === 'number' ? { [data.defaultResource]: v } : v);
      }
    }
    index[set] = m;
  }

  let compares = 0, identiques = 0;
  const ecarts = [], memeQte = [], absentsTcno = [];
  for (const p of catalogue) {
    const nous = pieces[p.id];
    if (!nous) continue;
    const set = FACTION_TO_SET[p.faction_id];
    const chez = set && index[set] && index[set].get(norm(p.label_en));
    if (!chez) { absentsTcno.push(p.id); continue; }
    compares++;
    if (JSON.stringify(chez) === JSON.stringify(nous.resources)) { identiques++; continue; }
    // Distinguer un désaccord sur la QUANTITÉ (grave : l'un des deux se trompe) d'un
    // désaccord sur le seul MATÉRIAU (attendu : tcno applique un matériau par set, alors
    // que le jeu le fixe par palier — une pièce Tier0 dans un set Tier2 les sépare).
    const qte = (o) => Object.values(o).sort().join(',');
    if (qte(chez) === qte(nous.resources)) memeQte.push(`${p.id} (${nous.tier}) : ${Object.keys(chez)[0]} → ${Object.keys(nous.resources)[0]}`);
    else ecarts.push(`${p.id} (${nous.tier}) : tcno ${JSON.stringify(chez)} ≠ jeu ${JSON.stringify(nous.resources)}`);
  }
  console.log('\n=== Confrontation avec les valeurs de tcno ===');
  console.log(`  pièces comparables : ${compares}`);
  console.log(`  valeurs identiques : ${identiques}`);
  console.log(`  même quantité, matériau affiné par le palier : ${memeQte.length}`);
  for (const e of memeQte.slice(0, 4)) console.log('    ' + e);
  console.log(`  écarts de QUANTITÉ : ${ecarts.length}`);
  for (const e of ecarts.slice(0, 10)) console.log('    ' + e);
  if (ecarts.length > 10) console.log(`    … (+${ecarts.length - 10})`);
  console.log(`  pièces SANS coût tcno mais avec coût jeu : ${absentsTcno.length}`
    + (absentsTcno.length ? ` (ex. ${absentsTcno.slice(0, 3).join(', ')})` : ''));
}

console.log(`groupes avec coûts : ${Object.values(parGroupe).filter(p => Object.keys(p).length).length}`);
console.log(`pièces chiffrées   : ${Object.keys(pieces).length}`);
const parPalier = {};
for (const p of Object.values(pieces)) parPalier[p.tier] = (parPalier[p.tier] || 0) + 1;
console.log(`par palier         : ${JSON.stringify(parPalier)}`);

console.log(`machines chiffrées : ${Object.keys(placeables).length}`);

if (CHECK) { comparer(); comparerMachines(); process.exit(0); }

comparer();
comparerMachines();
const costs = JSON.parse(fs.readFileSync(F_COSTS, 'utf8'));
costs.by_piece = pieces;
if (Object.keys(placeables).length) {
  costs.by_placeable = placeables;
  costs._by_placeable_note = 'Machines et utilitaires, dataminés (CDT_PlaceableData : groupe × palier → '
    + 'CDT_BuildableGroupData, énergie = m_PowerProduction − m_PowerConsumption, eau PASSIVE par heure = '
    + 'm_WaterGenerationAmountPerUpdate × 3600 / m_WaterGenerationRateInSecs). Prioritaire sur la clé '
    + 'functional (tcno, d\'avant la 1.5.3.0), gardée en repli.';
}
costs._by_piece_note = 'Coûts dataminés (CDT_BuildableGroupData.m_BuildableTierData[].m_PlacementCosts), '
  + 'indexés par identifiant de pièce. Le coût dépend du couple groupe × palier, et le palier est porté '
  + 'par la pièce : indexer ainsi évite le pont faction → set → nom anglais. Les noms de matériaux sont '
  + 'les noms anglais du jeu (Name.SourceString), identiques à ceux de tcno, pour que les deux sources '
  + 's\'agrègent. Les clés tcno sont conservées : le planner s\'en sert en repli.';
costs._by_piece_generated_at = new Date().toISOString();
fs.writeFileSync(F_COSTS, JSON.stringify(costs, null, 2) + '\n');
console.log(`\nplanner_costs.json mis à jour (clé by_piece, ${Object.keys(pieces).length} pièces).`);
