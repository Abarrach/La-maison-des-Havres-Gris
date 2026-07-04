#!/usr/bin/env node
/**
 * build_stuff_snapshot.js — Génère le snapshot de données de l'Optimiseur de stuff.
 *
 * POURQUOI un snapshot : Cloudflare bloque l'IP datacenter du serveur sur
 * gaming.tools (403 « Just a moment… »). On génère donc les données depuis une
 * machine NON bloquée et on déploie les fichiers.
 *
 * Produit, dans le dossier racine du site :
 *   • stuff_data.json     → liste compacte (armes/armures/augments/utilitaires)
 *   • stuff_recipes.json  → recettes (ingrédients + quantités) par id
 *
 * Lancer depuis la racine du dépôt :   node tools/build_stuff_snapshot.js
 * (Node 18+. Aucune dépendance.)
 *
 * ⚠ Cloudflare rate-limit : un BURST fait re-bloquer l'IP (403) pour 10-30 min.
 *   Le script va LENTEMENT (séquentiel ~600 ms). Si tu vois beaucoup de 403,
 *   l'IP est en cooldown → attends 15-30 min et RELANCE : le script est
 *   REPRENABLE (il ne re-télécharge que ce qui manque, et réutilise la liste
 *   déjà générée si items.d.json est bloqué). Relance jusqu'à « 0 restantes ».
 */
const fs = require('fs');
const path = require('path');

const OUT    = path.resolve(__dirname, '..');            // racine du site
const LOCALE = 'fr';                                     // langue des données (fr/en/de/es) — on joue en FR
const CDN    = 'https://cdn-hosted.gaming.tools/dune/data/' + LOCALE;
const UA     = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const H      = { 'User-Agent': UA, 'Accept': 'application/json',
                 'Referer': `https://dune.gaming.tools/${LOCALE}/items`, 'Origin': 'https://dune.gaming.tools' };
const GROUPS = ['weapons', 'garment', 'augment', 'utility'];
const DELAY  = 2500; // ms entre requêtes. Mesuré : ~3 s = OK (≈20 req/min) ; <1 s = blocage Cloudflare.
                     // 691 items ≈ 29 min. Ne PAS réduire sous ~2 s sous peine de 403.
const DATA   = path.join(OUT, 'stuff_data.json');
const RECIP  = path.join(OUT, 'stuff_recipes.json');

const sleep = ms => new Promise(r => setTimeout(r, ms));
function resolveFlat(flat, i, d = 0) {
  if (d > 18) return null;
  if (typeof i !== 'number') return i;
  if (i < 0 || i >= flat.length) return i;
  const v = flat[i];
  if (v !== null && typeof v === 'object') {
    const o = Array.isArray(v) ? [] : {};
    for (const k in v) o[k] = resolveFlat(flat, v[k], d + 1);
    return o;
  }
  return v;
}
const compactStats = s => (Array.isArray(s) ? s : []).filter(x => x && x.key)
  .map(x => ({ k: x.key, n: x.name, v: x.value, f: x.format, t: x.type }));

// Renvoie {data} (200), {notFound} (404) ou {blocked} (403/erreur après retries).
async function getJson(url, tries = 5) {
  for (let a = 0; a < tries; a++) {
    let r;
    try { r = await fetch(url, { headers: H }); }
    catch (e) { await sleep(900); continue; }
    if (r.status === 404) return { notFound: true };
    if (r.status === 403) { await sleep(2500); continue; }
    if (!r.ok) { await sleep(700); continue; }
    try { return { data: await r.json() }; } catch (e) { await sleep(700); }
  }
  return { blocked: true };
}

(async () => {
  // ── 1) Liste ──────────────────────────────────────────────────────────────
  console.log('1/2 — liste des items…');
  const listRes = await getJson(`${CDN}/items.d.json`);
  if (listRes.data) {
    const flat = listRes.data;
    // Carte nom/icône de TOUS les items (pour build_recipes_from_datamine.js — noms FR des ingrédients)
    const names = {};
    for (const idx of flat[0]) { const it = resolveFlat(flat, idx); if (it && it.id) names[it.id.toLowerCase()] = { name: it.name, icon: it.iconPath }; }
    fs.writeFileSync(path.join(OUT, 'stuff_names.json'), JSON.stringify(names));
    console.log(`    stuff_names.json — ${Object.keys(names).length} noms d'items.`);
    const items = [];
    for (const idx of flat[0]) {
      const it = resolveFlat(flat, idx);
      if (!it || !Array.isArray(it.categories) || !it.categories.length) continue;
      let group = null;
      for (const c of it.categories) { const p = c.split('/'); if (p[0] === 'items' && GROUPS.includes(p[1])) { group = p[1]; break; } }
      if (!group) continue;
      let sub = group;
      for (const c of it.categories) { const p = c.split('/'); if (p[1] === group && p.length > 2) { const cand = p.slice(1).join('/'); if (cand.length > sub.length) sub = cand; } }
      items.push({ id: it.id, name: it.name, icon: it.iconPath, tier: it.tier, rarity: it.rarity, group, cat: sub, stats: compactStats(it.stats) });
    }
    fs.writeFileSync(DATA, JSON.stringify({
      generated_at: new Date().toISOString(), mode: 'snapshot', locale: LOCALE, source: 'dune.gaming.tools',
      icon_base: 'https://cdn-hosted.gaming.tools/dune/images', count: items.length, items,
    }));
    console.log(`    stuff_data.json — ${items.length} items.`);
  } else if (fs.existsSync(DATA)) {
    console.log('    items.d.json bloqué (Cloudflare) → on réutilise stuff_data.json existant et on continue.');
  } else {
    console.error('    Échec : items.d.json bloqué ET aucun stuff_data.json existant. Attends 15-30 min et relance.');
    process.exit(1);
  }

  // ── 1bis) Capacités & techniques (skills.d.json — 1 seul fetch) ─────────────
  console.log('1bis/2 — capacités & techniques…');
  const skRes = await getJson(`${CDN}/skills.d.json`);
  if (skRes.data) {
    const arr = resolveFlat(skRes.data, 0);
    const skills = (Array.isArray(arr) ? arr : []).map(s => ({
      id: s.id, name: s.name, icon: s.iconPath, type: s.skillType, tree: s.skillTree,
      maxLevel: s.maxLevel || 1,
      stats: (s.stats || []).map(st => ({ lvl: st.level, k: st.key, n: st.name, v: st.value, f: st.format, op: st.operation })),
    })).filter(s => s.id && s.name);
    fs.writeFileSync(path.join(OUT, 'stuff_skills.json'), JSON.stringify({
      generated_at: new Date().toISOString(), locale: LOCALE, source: 'dune.gaming.tools',
      icon_base: 'https://cdn-hosted.gaming.tools/dune/images', count: skills.length, skills,
    }));
    console.log(`    stuff_skills.json — ${skills.length} skills.`);
  } else if (fs.existsSync(path.join(OUT, 'stuff_skills.json'))) {
    console.log('    skills.d.json bloqué → on garde stuff_skills.json existant.');
  } else {
    console.log('    skills.d.json bloqué et aucun snapshot — capacités/techniques indisponibles (relance plus tard).');
  }

  // ── 2) Recettes (reprenable) ───────────────────────────────────────────────
  console.log('2/2 — recettes (lent ; relançable jusqu’à « 0 restantes »)…');
  const data = JSON.parse(fs.readFileSync(DATA, 'utf8'));
  const ids = data.items.map(i => i.id).filter(Boolean);
  let recipes = {};
  try { recipes = JSON.parse(fs.readFileSync(RECIP, 'utf8')) || {}; } catch (e) {}
  const descs = {};                                     // id → description (FR) récupérée des détails
  const scaledMap = {};                                 // id → { grade: {key:value,…} } (armes multi-grades)
  const save = () => {
    fs.writeFileSync(RECIP, JSON.stringify(recipes));
    // injecte descriptions + scaledStats dans stuff_data.json
    let touched = false;
    for (const it of data.items) {
      if (descs[it.id] && it.desc !== descs[it.id]) { it.desc = descs[it.id]; touched = true; }
      if (scaledMap[it.id] && !it.scaled) { it.scaled = scaledMap[it.id]; touched = true; }
    }
    if (touched) fs.writeFileSync(DATA, JSON.stringify(data));
  };

  let processed = 0, ok = 0, stillBlocked = 0;
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    if (recipes[id] !== undefined) continue;            // déjà traité (succès, 404, ou {none})
    const res = await getJson(`${CDN}/items/${id}.d.json`);
    if (res.blocked) { stillBlocked++; continue; }       // NON stocké → retenté au prochain run
    if (res.notFound) { recipes[id] = { none: true }; }
    else {
      const root = resolveFlat(res.data, 0);
      if (root.description) descs[id] = root.description;
      if (Array.isArray(root.scaledStats) && root.scaledStats.length) {
        const sc = {};
        for (const g of root.scaledStats) { const o = {}; for (const s of (g.stats || [])) o[s.key] = s.value; sc[g.grade] = o; }
        if (Object.keys(sc).length) scaledMap[id] = sc;
      }
      const recs = [];
      for (const rec of (root.recipes || [])) {
        const first = (rec.qualityLevels || [])[0];
        const ings = ((first && first.ingredients) || []).map(g => ({
          id: (g.entity || {}).id || '', name: (g.entity || {}).name || '?',
          icon: (g.entity || {}).iconPath || '', qty: g.quantity || 0 }));
        if (ings.length) recs.push({ output: rec.outputQuantity || 1, ingredients: ings });
      }
      recipes[id] = (recs.length || root.baseBuyFromVendorPrice != null)
        ? { name: root.name, tier: root.tier, rarity: root.rarity, vendorPrice: root.baseBuyFromVendorPrice ?? null, recipes: recs }
        : { none: true };
      if (recs.length) ok++;
    }
    if (++processed % 20 === 0) {
      save();
      const remaining = ids.filter(x => recipes[x] === undefined).length;
      console.log(`    traités ${ids.length - remaining}/${ids.length} | recettes=${Object.values(recipes).filter(v => v && v.recipes && v.recipes.length).length} | restantes=${remaining}`);
    }
    await sleep(DELAY);
  }
  save();
  const remaining = ids.filter(x => recipes[x] === undefined).length;
  const total = Object.values(recipes).filter(v => v && v.recipes && v.recipes.length).length;
  console.log(`Terminé. recettes=${total} | restantes=${remaining}${stillBlocked ? `  (⚠ ${stillBlocked} bloquées ce run)` : ''}.`);
  if (remaining > 0) console.log('⚠ Il reste des items bloqués par Cloudflare. Attends 15-30 min et RELANCE le script (reprise auto).');
  else console.log('✓ Complet. Déploie stuff_data.json + stuff_recipes.json via WinSCP.');
})();
