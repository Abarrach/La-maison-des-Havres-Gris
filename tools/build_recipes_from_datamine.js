#!/usr/bin/env node
/**
 * build_recipes_from_datamine.js — Génère stuff_recipes.json depuis le DATAMINE.
 *
 * Remplace l'ancien « bake » des 691 recettes via gaming.tools (throttlé par
 * Cloudflare) : les recettes viennent désormais directement des fichiers du jeu.
 *
 * Source = export FModel de `DT_ItemsCraftingRecipes` (chargé avec l'usmap
 * Dumper-7 + le mapstructtypes.json d'Adain → Ingredients/Outcome remplis).
 * Pont d'ID : EItemTemplateID (PascalCase, ex. « ScrapMetal ») → id gaming.tools
 * = simple `.toLowerCase()` (vérifié : ~98 % de couverture sur l'optimiseur).
 *
 * Les NOMS/icônes des ingrédients viennent de la liste FR complète gaming.tools
 * (1 seul fetch, pas de throttle) ; repli = nom « joliment » dérivé du template.
 *
 * Usage :  node tools/build_recipes_from_datamine.js [chemin_DT_ItemsCraftingRecipes.json]
 * Défaut du chemin : export FModel standard sur la machine de l'auteur.
 */
const fs = require('fs');
const path = require('path');

const OUT = path.resolve(__dirname, '..');
const DT_DEFAULT = 'J:/Download/Fmodel/Output/Exports/DuneSandbox/Content/Dune/Systems/Crafting/DT_ItemsCraftingRecipes.json';
const DT_PATH = process.argv[2] || DT_DEFAULT;
const LOCALE = 'fr';
const CDN = 'https://cdn-hosted.gaming.tools/dune/data/' + LOCALE;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const H = { 'User-Agent': UA, 'Accept': 'application/json', 'Referer': `https://dune.gaming.tools/${LOCALE}/items`, 'Origin': 'https://dune.gaming.tools' };

function resolveFlat(flat, i, d = 0) {
  if (d > 18) return null;
  if (typeof i !== 'number') return i;
  if (i < 0 || i >= flat.length) return i;
  const v = flat[i];
  if (v !== null && typeof v === 'object') { const o = Array.isArray(v) ? [] : {}; for (const k in v) o[k] = resolveFlat(flat, v[k], d + 1); return o; }
  return v;
}
// "ScrapMetal" → "Scrap Metal" (repli quand le nom FR est introuvable)
const prettify = s => String(s).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ').trim();

(async () => {
  if (!fs.existsSync(DT_PATH)) { console.error('Introuvable : ' + DT_PATH + '\n→ exporte DT_ItemsCraftingRecipes dans FModel (usmap + mapstructtypes chargés).'); process.exit(1); }

  // 1) Carte nom/icône de TOUS les items. Priorité au cache LOCAL stuff_names.json
  //    (émis par build_stuff_snapshot.js) → pas de réseau ; repli = fetch ; repli = templates.
  let nameMap = {};
  const namesFile = path.join(OUT, 'stuff_names.json');
  if (fs.existsSync(namesFile)) {
    nameMap = JSON.parse(fs.readFileSync(namesFile, 'utf8')) || {};
    console.log(`noms d'items (cache local stuff_names.json) : ${Object.keys(nameMap).length}`);
  } else {
    try {
      const r = await fetch(`${CDN}/items.d.json`, { headers: H });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const flat = await r.json();
      for (const idx of flat[0]) { const it = resolveFlat(flat, idx); if (it && it.id) nameMap[it.id.toLowerCase()] = { name: it.name, icon: it.iconPath }; }
      console.log(`noms d'items (gaming.tools FR) : ${Object.keys(nameMap).length}`);
    } catch (e) {
      console.warn('⚠ pas de stuff_names.json ET fetch KO (' + e.message + ') → noms dérivés des templates. Lance d\'abord build_stuff_snapshot.js.');
    }
  }

  // 2) Recettes datamine → indexées par item PRODUIT (id minuscule)
  const j = JSON.parse(fs.readFileSync(DT_PATH, 'utf8'));
  const rows = (Array.isArray(j) ? j[0].Rows : j.Rows) || {};
  const out = {};
  let nRec = 0;
  for (const rk in rows) {
    const rec = rows[rk].Recipe || rows[rk];
    const outcome = (rec.Outcome || [])[0];
    if (!outcome || !outcome.Key || !outcome.Key.Name) continue;
    const outId = outcome.Key.Name.toLowerCase();
    const ipq = (rec.IngredientsPerQuality || [])[0] || {};
    const ings = [];
    if (ipq.m_WaterIngredientAmount) ings.push({ id: 'water', name: (nameMap['water'] && nameMap['water'].name) || 'Eau', icon: (nameMap['water'] && nameMap['water'].icon) || '/images/water.png', qty: ipq.m_WaterIngredientAmount });
    for (const g of (ipq.Ingredients || [])) {
      const tmpl = g.Key && g.Key.Name; if (!tmpl) continue;
      const id = tmpl.toLowerCase(); const nm = nameMap[id];
      ings.push({ id, name: nm ? nm.name : prettify(tmpl), icon: nm ? nm.icon : '', qty: (g.Value && g.Value.Amount) || 0 });
    }
    if (!ings.length) continue;
    const station = (rec.RequiredProductionTypes || []).map(p => p.Name).filter(Boolean);
    const item = nameMap[outId];
    out[outId] = {
      name: item ? item.name : prettify(outcome.Key.Name),
      recipes: [{ output: (outcome.Value && outcome.Value.Amount) || 1, ingredients: ings }],
      station: station.length ? station : undefined,
      craftTime: rec.CraftingTimeInSec || undefined,
    };
    nRec++;
  }

  fs.writeFileSync(path.join(OUT, 'stuff_recipes.json'), JSON.stringify(out));
  console.log(`stuff_recipes.json écrit : ${nRec} recettes (depuis le datamine).`);
  console.log('→ déploie stuff_recipes.json via WinSCP. Plus de bake Cloudflare.');
})();
