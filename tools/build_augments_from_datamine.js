#!/usr/bin/env node
/**
 * build_augments_from_datamine.js — Extrait les effets CHIFFRÉS des augments depuis le DATAMINE
 * (FModel) vers stuff_augments.json, pour les câbler dans le moteur de l'optimiseur (Phase 0).
 *
 * Source :
 *  - DT_ItemTable_Augments.json : 1 row par augment (clé = EItemTemplateID) → pointe un DataAsset
 *    AugmentStatsPerQualityDataAsset (DA_AUGMENT_*) dans Systems/Items/Upgrades/.
 *  - Chaque DataAsset : ApplicableItems (tags = à quels objets l'augment s'applique), MinQualityLevel,
 *    et StatsData[] = liste d'effets. Un effet = { Operation, StatChangeTarget, (Weapon|Armor|Item)Stats[],
 *    RangeCurve, ProbabilityCurve }. Une SEULE entrée peut toucher PLUSIEURS stats (même roll).
 *  - RangeCurve = CurveVector : composante 0 (X) = MIN du roll, composante 1 (Y) = MAX, indexée par
 *    Time = niveau de qualité (0→5). Le joueur tire une valeur entre min et max (côté aléatoire).
 *
 * Sémantique des valeurs (vérifié) :
 *  - Operation Multiply → la valeur est un FACTEUR (ex. 1.48 = ×1,48 = +48 %).
 *  - Operation Add      → la valeur est un DELTA  (ex. 0.0325 = +3,25 points ; mitigations en fractions).
 *
 * Pont d'ID : EItemTemplateID.toLowerCase() = id gaming.tools (couverture 104/104 augments du tool).
 *
 * Usage : node tools/build_augments_from_datamine.js [racine_export_FModel]
 *   racine par défaut = J:/Download/Fmodel/Output/Exports/DuneSandbox/Content/Dune/Systems/Items
 */
const fs = require('fs');
const path = require('path');

const OUT = path.resolve(__dirname, '..');
const ITEMS_DIR = process.argv[2] || 'J:/Download/Fmodel/Output/Exports/DuneSandbox/Content/Dune/Systems/Items';
const UPGRADES = path.join(ITEMS_DIR, 'Upgrades');
const DT_AUG = path.join(ITEMS_DIR, 'DT_ItemTable_Augments.json');

if (!fs.existsSync(DT_AUG)) { console.error('Introuvable : ' + DT_AUG); process.exit(1); }
if (!fs.existsSync(UPGRADES)) { console.error('Introuvable : ' + UPGRADES + '\n→ exporte le dossier Systems/Items/Upgrades dans FModel.'); process.exit(1); }

// Index de tous les .json sous Upgrades/ par nom d'objet (sans extension).
const byName = {};
(function walk(d){ for (const e of fs.readdirSync(d, { withFileTypes: true })) {
  const p = path.join(d, e.name);
  if (e.isDirectory()) walk(p); else if (e.name.endsWith('.json')) byName[e.name.replace(/\.json$/, '')] = p;
} })(UPGRADES);

// "AugmentStatsPerQualityDataAsset'DA_AUGMENT_xxx'" → "DA_AUGMENT_xxx"
function objName(ref){ const m = String((ref && ref.ObjectName) || '').match(/'([^']+)'/); return m ? m[1] : null; }

// CurveVector → { q: [min, max] } (composante 0 = min, 1 = max), pour les qualités présentes.
const curveCache = {};
function rangeByQuality(curveRef){
  const name = objName(curveRef); if (!name) return null;
  if (curveCache[name] !== undefined) return curveCache[name];
  const f = byName[name];
  if (!f) { curveCache[name] = null; return null; }
  const props = JSON.parse(fs.readFileSync(f, 'utf8'))[0].Properties || {};
  const comps = [];
  for (const k of Object.keys(props)) if (/^FloatCurves(\[\d+\])?$/.test(k)) comps.push(props[k].Keys || []);
  const minC = comps[0] || [], maxC = comps[1] || comps[0] || [];
  const out = {}; const times = new Set(minC.map(k => k.Time));
  for (const t of times) {
    const mn = minC.find(k => k.Time === t), mx = maxC.find(k => k.Time === t);
    out[t] = [mn ? +mn.Value.toFixed(6) : 0, mx ? +mx.Value.toFixed(6) : (mn ? +mn.Value.toFixed(6) : 0)];
  }
  curveCache[name] = { curve: name, q: out };
  return curveCache[name];
}

const dt = JSON.parse(fs.readFileSync(DT_AUG, 'utf8'));
const rows = (Array.isArray(dt) ? dt[0].Rows : dt.Rows) || {};

const augments = {};
let nOk = 0, nSkip = 0;
for (const id in rows) {
  if (id === '---') continue;
  const ad = rows[id].AugmentStaticStats && rows[id].AugmentStaticStats.AugmentData;
  const daName = objName(ad);
  const f = daName && byName[daName];
  if (!f) { nSkip++; continue; }
  const props = JSON.parse(fs.readFileSync(f, 'utf8'))[0].Properties || {};
  const applies = ((props.ApplicableItems && props.ApplicableItems.TagDictionary) || []).map(t => t.TagName);
  const effects = [];
  for (const sd of (props.StatsData || [])) {
    const stats = [
      ...(sd.WeaponStats || []).map(x => x.Name),
      ...(sd.ArmorStats  || []).map(x => x.Name),
      ...(sd.ItemStats   || []).map(x => x.Name),
    ];
    if (!stats.length) continue;
    const rng = rangeByQuality(sd.RangeCurve);
    effects.push({
      op: (sd.Operation || '').split('::').pop(),          // Multiply | Add | Set
      target: (sd.StatChangeTarget || '').split('::').pop(),// Weapon | Armor | Item
      stats,
      curve: rng ? rng.curve : null,
      q: rng ? rng.q : null,                                // { qualité: [min, max] }
    });
  }
  if (!effects.length) { nSkip++; continue; }
  augments[id.toLowerCase()] = {
    minQuality: props.MinQualityLevel != null ? props.MinQualityLevel : 0,
    applies,
    autoDesc: (props.ApplicableItems && props.ApplicableItems.AutoDescription || '').trim(),
    effects,
  };
  nOk++;
}

const outObj = { generated_at: new Date().toISOString(), source: 'datamine FModel DT_ItemTable_Augments', count: nOk, augments };
const outPath = path.join(OUT, 'stuff_augments.json');
fs.writeFileSync(outPath, JSON.stringify(outObj));
console.log(`augments extraits : ${nOk} (ignorés sans data : ${nSkip})`);

// Couverture vs stuff_data.json (augments affichés dans l'outil)
try {
  const data = JSON.parse(fs.readFileSync(path.join(OUT, 'stuff_data.json'), 'utf8'));
  const augIds = data.items.filter(i => i.group === 'augment').map(i => i.id);
  const hit = augIds.filter(id => augments[id]).length;
  console.log(`couverture optimiseur : ${hit}/${augIds.length} augments`);
} catch (e) { /* noop */ }

// Inventaire des stats rencontrées (aide au mapping moteur)
const vocab = {};
for (const a of Object.values(augments)) for (const e of a.effects) for (const s of e.stats) {
  const key = e.target + '.' + s; vocab[key] = (vocab[key] || 0) + 1;
}
console.log('stuff_augments.json écrit. Vocabulaire (cible.stat : n) :');
Object.entries(vocab).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log('  ' + k + ' : ' + v));
