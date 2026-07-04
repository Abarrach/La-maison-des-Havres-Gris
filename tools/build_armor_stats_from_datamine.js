#!/usr/bin/env node
/**
 * build_armor_stats_from_datamine.js — Remplace les stats brutes d'armure (gaming.tools) par
 * les vraies valeurs dataminées depuis DT_ArmorItemTable.json (FModel).
 *
 * Contrairement aux armes (DT_ItemTableWeapons.json ne contient que des références vers des
 * Blueprints, dégâts réels non exportés), les armures ont TOUT en clair dans une DataTable :
 *   ArmorStats.ArmorValue, ArmorStats.{Melee,Dart,HeavyDart,Physical,Energy,Heat,Radiation,
 *   Poison}DamageMitigationArmor (fractions, ex. 0.12 = +12%).
 *
 * Vérifié manuellement : ArmorValue et mitigations collent à 100% avec gaming.tools sur 2 items
 * pris au hasard (65/113 armorValue, mitigations identiques au %). PhysicalDamageMitigationArmor
 * EST la mitigation "Commotion" de gaming.tools (concussiveMitigation) — confirmé sur un item
 * avec concussiveMitigation=3% ↔ PhysicalDamageMitigationArmor=0.03.
 *
 * Pont d'ID : clé de ligne (EItemTemplateID) .toLowerCase() = id gaming.tools (comme
 * recettes/descriptions/augments).
 *
 * DT_ArmorItemTable a aussi PLUS de types de mitigation que gaming.tools n'expose (Froid,
 * Coriolis, Explosifs, Récolte, Réparation, Tempête de sable ×3, Soins) — volontairement
 * IGNORÉS ici (décision user 2026-07-03 : garder les 8 types MITIG existants).
 *
 * Usage : node tools/build_armor_stats_from_datamine.js [chemin_DT_ArmorItemTable.json]
 */
const fs = require('fs');
const path = require('path');

const OUT = path.resolve(__dirname, '..');
const DT_DEFAULT = 'J:/Download/Fmodel/Output/Exports/DuneSandbox/Content/Dune/Systems/Items/DT_ArmorItemTable.json';
const DT_PATH = process.argv[2] || DT_DEFAULT;

if (!fs.existsSync(DT_PATH)) { console.error('Introuvable : ' + DT_PATH + '\n→ exporte Systems/Items/DT_ArmorItemTable.json dans FModel.'); process.exit(1); }

// clé MITIG (utilisée par l'optimiseur) → { champ brut ArmorStats, libellé FR, format } — mêmes
// libellés/format que gaming.tools (vérifiés sur stuff_data.json) pour ne rien changer à l'affichage.
const MIT_FIELDS = {
  bladeMitigation:      { raw: 'MeleeDamageMitigationArmor',     n: 'Réduction des dégâts des lames :' },
  lightDartMitigation:  { raw: 'DartDamageMitigationArmor',      n: 'Réduction des dégâts des petites aiguilles :' },
  heavyDartMitigation:  { raw: 'HeavyDartDamageMitigationArmor', n: 'Réduction des dégâts des grosses aiguilles :' },
  concussiveMitigation: { raw: 'PhysicalDamageMitigationArmor',  n: 'Réduction des dégâts commotionnants :' },  // = "Commotion" (vérifié)
  energyMitigation:     { raw: 'EnergyDamageMitigationArmor',    n: 'Réduction des dégâts d\'énergie :' },
  heatMitigation:       { raw: 'HeatDamageMitigationArmor',      n: 'Réduction des dégâts de feu :' },
  radiationMitigation:  { raw: 'RadiationDamageMitigationArmor', n: 'Réduc. des dégâts de radiations :' },
  poisonMitigation:     { raw: 'PoisonDamageMitigationArmor',    n: 'Réduction des dégâts de poison :' },
};
const MIT_F = '{v:+0.#;-0.#}%';
const ARMOR_F = '{v:0}';
const ALL_KEYS = ['armorValue', ...Object.keys(MIT_FIELDS)];

const dt = JSON.parse(fs.readFileSync(DT_PATH, 'utf8'));
const rows = (Array.isArray(dt) ? dt[0].Rows : dt.Rows) || {};

const armorMap = {};
for (const key in rows) {
  const st = rows[key].ArmorStats; if (!st) continue;
  const id = key.toLowerCase();
  const entry = { armorValue: st.ArmorValue || 0 };
  for (const k in MIT_FIELDS) entry[k] = Math.round((st[MIT_FIELDS[k].raw] || 0) * 1000) / 10; // fraction → %, 1 décimale
  armorMap[id] = entry;
}
console.log(`DT_ArmorItemTable : ${Object.keys(armorMap).length} items d'armure dataminés.`);

const dataPath = path.join(OUT, 'stuff_data.json');
const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
let matched = 0, changed = 0;
for (const it of data.items) {
  if (it.group !== 'garment') continue;
  const dm = armorMap[(it.id || '').toLowerCase()]; if (!dm) continue;
  matched++;
  const oldVals = {}; for (const k of ALL_KEYS) oldVals[k] = (it.stats || []).find(s => s.k === k)?.v || 0;
  it.stats = (it.stats || []).filter(s => !ALL_KEYS.includes(s.k));   // retire les anciennes valeurs gaming.tools
  if (dm.armorValue) it.stats.push({ k: 'armorValue', n: 'Valeur d\'armure :', v: dm.armorValue, f: ARMOR_F, t: 'number' });
  for (const k in MIT_FIELDS) {
    if (dm[k]) it.stats.push({ k, n: MIT_FIELDS[k].n, v: dm[k], f: MIT_F, t: 'number' });
  }
  if (ALL_KEYS.some(k => Math.abs(oldVals[k] - (dm[k] || 0)) > 0.05)) changed++;
}
fs.writeFileSync(dataPath, JSON.stringify(data));
console.log(`garments (271) : ${matched} appariés au datamine, ${changed} avec une valeur modifiée (patch depuis le dernier scrape gaming.tools).`);
console.log('stuff_data.json mis à jour (armorValue + 8 mitigations 100% dataminés pour les armures). Déploie-le via WinSCP.');
