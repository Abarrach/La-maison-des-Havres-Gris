#!/usr/bin/env node
/**
 * build_loot_locations_from_datamine.js — Objets uniques trouvables à un LIEU NOMMÉ (stations
 * expérimentales à thème élémentaire, donjon), avec probabilité d'apparition, depuis les tables de
 * loot FModel (Systems/LootTables/, Systems/Looting/).
 *
 * ⚠ Ne couvre QUE les lieux nommés sous Systems/LootTables/Loot_DifficultyScaled/ (dossiers avec des
 * tables "_Main" par palier Basic/Rare/UltraRare qui débouchent sur un pool d'objets EXPLICITE
 * "_UniqueSchematics_W"/"_UniqueAugments_W"). Les conteneurs génériques (Rare/Basic/UltraRare
 * "ordinaires", trouvables n'importe où) utilisent un système de FILTRAGE PAR TAGS (requêtes
 * booléennes façon GameplayTagQuery) bien plus complexe à interpréter fidèlement — volontairement
 * PAS traité ici (décision : se limiter aux lieux nommés, résultat fiable, plutôt qu'un système
 * générique approximatif).
 *
 * Modèle de résolution (2 types de table, imbriqués) :
 *  - Table PONDÉRÉE ("_W", ex UniqueSchematics_W) : UN tirage parmi les lignes, proportionnel à
 *    `Weight`. Une ligne est soit un objet direct (ItemTemplateId), soit une référence
 *    (LootWeightedTable = re-pondérée, LootTable = tirages indépendants) → récursion.
 *  - Table de TIRAGES INDÉPENDANTS ("_Main"/"_D1"/"_Schematics"...) : CHAQUE ligne est un tirage
 *    Bernoulli indépendant (probabilité `PercentageChance`) qui, s'il se déclenche, effectue
 *    `NumRolls` tirages indépendants dans sa cible (avec remise).
 *  Combinées récursivement → P(objet X apparaît au moins une fois) en ouvrant le conteneur de plus
 *  haut palier (UltraRare) à cet endroit. C'est une hypothèse simplificatrice documentée (pas de
 *  garantie anti-doublon modélisée), mais cohérente avec les valeurs de poids du jeu.
 *
 * Usage : node tools/build_loot_locations_from_datamine.js [racine_Systems_FModel]
 *   racine par défaut = J:/Download/Fmodel/Output/Exports/DuneSandbox/Content/Dune/Systems
 */
const fs = require('fs');
const path = require('path');

const OUT = path.resolve(__dirname, '..');
const SYS = process.argv[2] || 'J:/Download/Fmodel/Output/Exports/DuneSandbox/Content/Dune/Systems';
const LOOTTABLES = path.join(SYS, 'LootTables');
const LOOTING = path.join(SYS, 'Looting');
const DIFFSCALED = path.join(LOOTTABLES, 'Loot_DifficultyScaled');

if (!fs.existsSync(DIFFSCALED)) { console.error('Introuvable : ' + DIFFSCALED + '\n→ exporte Systems/LootTables/ (et Systems/Looting/) dans FModel.'); process.exit(1); }

// Index de tous les .json sous LootTables/ et Looting/, par nom d'asset (sans extension).
const byName = {};
(function indexDir(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) indexDir(p);
    else if (e.name.endsWith('.json')) byName[e.name.replace(/\.json$/, '')] = p;
  }
})(LOOTTABLES);
if (fs.existsSync(LOOTING)) (function indexDir(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) indexDir(p);
    else if (e.name.endsWith('.json')) byName[e.name.replace(/\.json$/, '')] = p;
  }
})(LOOTING);

// "/Game/.../Folder.DT_Whatever" → "DT_Whatever"
function assetName(ref) {
  const p = ref && ref.AssetPathName;
  if (!p) return null;
  const seg = p.split('/').pop();
  return seg.includes('.') ? seg.split('.').pop() : seg;
}

const rowsCache = {};
function loadRows(name) {
  if (!name) return null;
  if (rowsCache[name] !== undefined) return rowsCache[name];
  const f = byName[name];
  if (!f) { rowsCache[name] = null; return null; }
  try {
    const d = JSON.parse(fs.readFileSync(f, 'utf8'));
    const rows = (Array.isArray(d) ? d[0].Rows : d.Rows) || {};
    rowsCache[name] = Object.values(rows);
  } catch (e) { rowsCache[name] = null; }
  return rowsCache[name];
}

const MAX_DEPTH = 14;

// Table pondérée : UN tirage parmi les lignes (proportionnel à Weight) → Map(itemId -> proba pour CE tirage).
function resolveWeighted(rows, depth) {
  const dist = new Map();
  if (!rows || depth > MAX_DEPTH) return dist;
  const total = rows.reduce((s, r) => s + (r.Weight || 0), 0);
  if (!total) return dist;
  for (const r of rows) {
    const p = (r.Weight || 0) / total;
    if (!p) continue;
    const item = r.ItemTemplateId && r.ItemTemplateId.Name;
    if (item && item !== 'None') { dist.set(item, (dist.get(item) || 0) + p); continue; }
    const wt = assetName(r.LootWeightedTable), lt = assetName(r.LootTable);
    const subRows = loadRows(wt || lt);
    if (!subRows) continue;
    const sub = wt ? resolveWeighted(subRows, depth + 1) : resolveRolls(subRows, depth + 1);
    for (const [id, sp] of sub) dist.set(id, (dist.get(id) || 0) + p * sp);
  }
  return dist;
}
// Table de tirages indépendants : chaque ligne = Bernoulli(pct) déclenchant NumRolls tirages avec
// remise dans sa cible → Map(itemId -> proba d'apparaître AU MOINS UNE FOIS sur toutes les lignes).
function resolveRolls(rows, depth) {
  const pNever = new Map();
  if (!rows || depth > MAX_DEPTH) return new Map();
  for (const r of rows) {
    const pct = r.PercentageChance != null ? r.PercentageChance : 1;
    const rolls = r.NumRolls || 1;
    let subDist;
    const item = r.ItemTemplateId && r.ItemTemplateId.Name;
    if (item && item !== 'None') subDist = new Map([[item, 1]]);
    else {
      const wt = assetName(r.LootWeightedTable), lt = assetName(r.LootTable);
      const subRows = loadRows(wt || lt);
      if (!subRows) continue;
      subDist = wt ? resolveWeighted(subRows, depth + 1) : resolveRolls(subRows, depth + 1);
    }
    for (const [id, pOnce] of subDist) {
      const pMissAllRolls = Math.pow(1 - pOnce, rolls);
      const pRowMiss = 1 - pct * (1 - pMissAllRolls);
      pNever.set(id, (pNever.has(id) ? pNever.get(id) : 1) * pRowMiss);
    }
  }
  const dist = new Map();
  for (const [id, pn] of pNever) dist.set(id, 1 - pn);
  return dist;
}

// ── Lieux nommés : dossiers sous Loot_DifficultyScaled/ (hors Unique_Pools, dossier partagé) ──
const LABELS = {
  TestingStation_136_Fire: 'Station expérimentale (Feu)',
  TestingStation_152_Electrical: 'Station expérimentale (Électricité)',
  TestingStation_195_Poison: 'Station expérimentale (Poison)',
  TestingStation_24_Darkness: 'Station expérimentale (Obscurité)',
  TestingStation_89_Radiation: 'Station expérimentale (Radiations)',
  B1C4_Dungeon_TheOldQuarry: 'Donjon (The Old Quarry)',
};

const results = {}; // itemId (lowercase) -> [{location, tier, chance}]
const locDirs = fs.readdirSync(DIFFSCALED, { withFileTypes: true })
  .filter(e => e.isDirectory() && e.name !== 'Unique_Pools');

for (const loc of locDirs) {
  const dir = path.join(DIFFSCALED, loc.name);
  const label = LABELS[loc.name] || loc.name.replace(/_/g, ' ');
  const files = fs.readdirSync(dir).filter(f => /_Main\.json$/.test(f));
  for (const f of files) {
    const name = f.replace(/\.json$/, '');
    const tier = /UltraRare/i.test(name) ? 'Ultra Rare' : /Rare/i.test(name) ? 'Rare' : /Basic/i.test(name) ? 'Basique' : 'Autre';
    const rows = loadRows(name);
    const dist = resolveRolls(rows, 0);
    for (const [itemId, chance] of dist) {
      if (chance < 0.001) continue;
      const id = itemId.toLowerCase();
      if (!results[id]) results[id] = [];
      results[id].push({ location: label, tier, chance: Math.round(chance * 1000) / 10 }); // %, 1 décimale
    }
  }
}

// Ne garder que les objets qui existent dans stuff_data.json (équipement, pas ressources/monnaie),
// pont d'ID : id du schéma "xxx_Schematic" → objet "xxx" (le schéma déverrouille la fabrication).
const dataPath = path.join(OUT, 'stuff_data.json');
const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
const knownIds = new Set(data.items.map(i => i.id.toLowerCase()));
const loot = {};
let matched = 0, totalItems = 0;
for (const rawId in results) {
  totalItems++;
  const itemId = rawId.replace(/_schematic$/, '');
  if (!knownIds.has(itemId)) continue;
  matched++;
  loot[itemId] = results[rawId].sort((a, b) => b.chance - a.chance);
}

fs.writeFileSync(path.join(OUT, 'stuff_loot.json'), JSON.stringify({
  generated_at: new Date().toISOString(),
  source: 'datamine FModel (Systems/LootTables/Loot_DifficultyScaled, lieux nommés uniquement)',
  note: 'Probabilité = objet obtenu au moins une fois en ouvrant le conteneur Ultra Rare de plus haut palier à cet endroit (hypothèse : tirages indépendants, sans anti-doublon).',
  loot,
}));
console.log(`Lieux traités : ${locDirs.length} (${locDirs.map(l => l.name).join(', ')})`);
console.log(`Objets trouvés dans les tables de loot : ${totalItems}, dont ${matched} reconnus dans stuff_data.json (autres = ressources/monnaie/fragments, ignorés).`);
console.log('stuff_loot.json écrit. Déploie-le via WinSCP.');
