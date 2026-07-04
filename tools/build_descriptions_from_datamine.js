#!/usr/bin/env node
/**
 * build_descriptions_from_datamine.js — Injecte les descriptions FR dans stuff_data.json
 * depuis le DATAMINE (export FModel de CDT_BaseItems, FModel réglé en Français).
 *
 * CDT_BaseItems : 4154 items, clé = EItemTemplateID. Chaque item → StaticData.{Name,
 * ShortDesc, LongDesc} en FText déjà localisés (LocalizedString = texte FR).
 * Pont d'ID : clé `.toLowerCase()` = id gaming.tools (comme les recettes).
 *
 * → Supprime la DERNIÈRE dépendance gaming.tools/Cloudflare (descriptions d'augments).
 *
 * Usage : node tools/build_descriptions_from_datamine.js [chemin_CDT_BaseItems.json]
 */
const fs = require('fs');
const path = require('path');

const OUT = path.resolve(__dirname, '..');
const DT_DEFAULT = 'J:/Download/Fmodel/Output/Exports/DuneSandbox/Content/Dune/Systems/Items/CDT_BaseItems.json';
const DT_PATH = process.argv[2] || DT_DEFAULT;

// FText FModel → texte FR (LocalizedString prioritaire ; repli SourceString) + strip balises riches.
function ftext(f) {
  if (!f) return '';
  const s = (typeof f === 'string') ? f : (f.LocalizedString || f.SourceString || f.CultureInvariantString || '');
  return String(s || '').replace(/<\/?[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

if (!fs.existsSync(DT_PATH)) { console.error('Introuvable : ' + DT_PATH + '\n→ exporte CDT_BaseItems dans FModel (Language = French).'); process.exit(1); }

const j = JSON.parse(fs.readFileSync(DT_PATH, 'utf8'));
const rows = (Array.isArray(j) ? j[0].Rows : j.Rows) || {};
const descMap = {};
for (const k in rows) {
  const sd = rows[k].StaticData || rows[k];
  const desc = ftext(sd.LongDesc) || ftext(sd.ShortDesc); // LongDesc = effet détaillé (plus utile)
  if (desc) descMap[k.toLowerCase()] = desc;
}
console.log(`descriptions FR dataminées : ${Object.keys(descMap).length} (sur ${Object.keys(rows).length} items CDT_BaseItems)`);

const dataPath = path.join(OUT, 'stuff_data.json');
const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
const cov = {};
for (const it of data.items) {
  cov[it.group] = cov[it.group] || { n: 0, d: 0 };
  cov[it.group].n++;
  const d = descMap[(it.id || '').toLowerCase()];
  if (d) { it.desc = d; cov[it.group].d++; }
}
fs.writeFileSync(dataPath, JSON.stringify(data));
console.log('couverture description par groupe (optimiseur) :');
for (const g in cov) console.log(`  ${g}: ${cov[g].d}/${cov[g].n}`);
console.log('stuff_data.json mis à jour (champ desc). Déploie-le via WinSCP.');
