#!/usr/bin/env node
'use strict';
/**
 * build_landsraad_from_datamine.js — Missions Landsraad, prises dans le jeu.
 *
 * `landsraad_data.json` (page Missions, planner.html) était saisi à la main : 25 missions
 * relevées en avril 2026. Le jeu en compte 41 depuis la 1.4 (Ruines de Tsimpo, Passe du
 * Vent, Piste des Contrebandiers), avec des noms qui ont parfois changé en français.
 *
 * ── La chaîne, dans les fichiers du jeu ─────────────────────────────────────
 *   Systems/Landsraad/VotingBlock/DA_LVB_VotingBlock1..5
 *       un « bloc de vote » par spécialité (Artisanat, Combat…) : m_DisplayName en
 *       français et la liste des missions de ce pool (m_Stories) ;
 *   Systems/MnemonicRecall/Data/JourneyCards/LandsraadContracts/DA_LDR_*
 *       une mission : nom et description FR (GuiData du nœud racine), cartes cibles
 *       (m_TargetMaps), points de tâche, récompense en Solaris ;
 *   Maps/DT_MapsInfo
 *       identifiant de carte → nom FR du lieu (« FireDungeon » → « Station Expérimentale
 *       de l'Imperium 136 ») et taille de groupe conseillée.
 *
 * Les pools contiennent aussi des contrats de TEST (DA_LDR_TestBuilding…,
 * TestControlPoint…) : sans carte ni nom réel, ils sont écartés.
 *
 * ── Missions désactivées ────────────────────────────────────────────────────
 * Funcom désactive une mission CÔTÉ SERVEUR : elle reste dans son pool, rien dans les
 * fichiers ne la distingue. La seule source est donc la note de patch, citée ci-dessous
 * avec son lien. C'est un fait publié, pas une estimation : le jour où une mission est
 * réactivée, il suffit de retirer sa ligne.
 *
 * Usage :
 *   node tools/build_landsraad_from_datamine.js [racine Content/Dune]   écrit landsraad_data.json
 *   node tools/build_landsraad_from_datamine.js --check                 compare, n'écrit rien
 */
const fs = require('fs');
const path = require('path');

const RACINE = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const CHECK = args.includes('--check');
const DUNE = args.find(a => !a.startsWith('--'))
  || 'J:/Download/Fmodel/Output/Exports/DuneSandbox/Content/Dune';

const D_POOLS = path.join(DUNE, 'Systems/Landsraad/VotingBlock');
const D_MISSIONS = path.join(DUNE, 'Systems/MnemonicRecall/Data/JourneyCards/LandsraadContracts');
const F_MAPS = path.join(DUNE, 'Maps/DT_MapsInfo.json');
const F_OUT = path.join(RACINE, 'landsraad_data.json');

const DESACTIVEES = {
  DA_LDR_Crafting_Convergence: {
    depuis: '1.5.3.0 (17/09/2026)',
    source: 'https://duneawakening.com/news/dune-awakening-console-release-patch-notes/',
  },
  DA_LDR_Exploration_SampleRecovery: {
    depuis: '1.5.3.0 (17/09/2026)',
    source: 'https://duneawakening.com/news/dune-awakening-console-release-patch-notes/',
  },
};

for (const p of [D_POOLS, D_MISSIONS, F_MAPS]) {
  if (!fs.existsSync(p)) {
    console.error(`Introuvable : ${p}\n→ lance d'abord : DuneExtract --config tools/extract/extract.config.json --only landsraad,landsraad_pools,maps_info`);
    process.exit(1);
  }
}

const lireJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const texte = (t) => String((t && (t.LocalizedString || t.SourceString)) || '').replace(/<\/?[^>]*>/g, '').replace(/\s+/g, ' ').trim();
const nomAsset = (ref) => { const m = /'([^':]+)'$/.exec((ref && ref.ObjectName) || ''); return m ? m[1] : null; };
// Une référence d'objet pointe dans le même fichier par l'indice qui suit le dernier point.
const parIndice = (exports, ref) => { const m = /\.(\d+)$/.exec((ref && ref.ObjectPath) || ''); return m ? exports[+m[1]] : null; };

function fichiers(dir) {
  const out = [];
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) out.push(...fichiers(p));
    else if (f.endsWith('.json')) out.push(p);
  }
  return out;
}

// ── Lieux ───────────────────────────────────────────────────────────────────
const cartes = {};
{
  const j = lireJson(F_MAPS);
  for (const [id, r] of Object.entries((Array.isArray(j) ? j[0] : j).Rows || {})) {
    // m_RecommendedGroupSize = EGroupSize::Solo (lieux ouverts) ou ::Party (stations
    // expérimentales, l'Ancienne carrière) : c'est ce qui sépare un objectif faisable seul
    // d'un objectif qui justifie de grouper des joueurs.
    const g = String(r.m_RecommendedGroupSize || '').replace(/^.*::/, '');
    cartes[id] = { nom: texte(r.m_DisplayName) || id, groupe: g === 'Party' ? 'groupe' : g === 'Solo' ? 'solo' : (g.toLowerCase() || null) };
  }
}

// ── Missions ────────────────────────────────────────────────────────────────
const missions = {};
for (const f of fichiers(D_MISSIONS)) {
  const ex = lireJson(f);
  const racine = ex.find(x => x.Type === 'JourneyStoryNode' && x.Name === 'RootNode');
  if (!racine) continue;
  const p = racine.Properties || {};
  const gui = (parIndice(ex, p.m_GuiData) || {}).Properties || {};
  const id = p.m_UniqueName || path.basename(f, '.json');
  const solaris = (p.m_CurrenciesToAward || []).find(c => c.Currency && c.Currency.Name === 'Solaris');
  missions[id] = {
    name: texte(gui.m_Name),
    desc: texte(gui.m_Description),
    maps: (p.m_TargetMaps || []).map(m => m.Name).filter(Boolean),
    points: p.m_LandsraadTaskPoints || null,
    solaris: solaris ? solaris.Amount : null,
  };
}

// ── Pools (une spécialité = un bloc de vote) ────────────────────────────────
const categories = [];
const quests = [];
const ecartees = [];
for (const f of fichiers(D_POOLS)) {
  const bloc = (lireJson(f)[0] || {}).Properties || {};
  const cat = texte(bloc.m_DisplayName);
  if (!cat) continue;
  categories.push({ name: cat, order: bloc.m_OrderWeight || 0 });
  for (const ref of bloc.m_Stories || []) {
    const id = nomAsset(ref);
    const m = id && missions[id];
    // ⚠ Pas de /_Test/ sur l'identifiant : il écartait « DA_LDR_Gather_TestingStationCleanup »,
    // une vraie mission. Les contrats de test sont tous préfixés DA_LDR_Test.
    if (!m || !m.maps.length || !m.name || /^Test\b|^PH_/i.test(m.name) || /^DA_LDR_Test/i.test(id)) { ecartees.push(id); continue; }
    const lieu = cartes[m.maps[0]] || { nom: m.maps[0], groupe: null };
    const q = { id, name: m.name, type: cat, zone: lieu.nom, map: m.maps[0] };
    if (lieu.groupe) q.groupe = lieu.groupe;
    if (m.points) q.points = m.points;
    if (m.solaris) q.solaris = m.solaris;
    if (m.desc) q.desc = m.desc;
    if (DESACTIVEES[id]) q.desactivee = DESACTIVEES[id];
    quests.push(q);
  }
}
categories.sort((a, b) => a.order - b.order);
const ordreCat = new Map(categories.map((c, i) => [c.name, i]));
quests.sort((a, b) => ordreCat.get(a.type) - ordreCat.get(b.type) || a.name.localeCompare(b.name, 'fr'));

const inconnues = Object.keys(DESACTIVEES).filter(id => !quests.some(q => q.id === id));

// ── Compte rendu ────────────────────────────────────────────────────────────
console.log(`missions jouables : ${quests.length} (écartées des pools : ${ecartees.length}, contrats de test)`);
for (const c of categories) {
  const n = quests.filter(q => q.type === c.name);
  console.log(`  ${c.name.padEnd(12)} ${n.length}  ${n.filter(q => q.desactivee).map(q => '(désactivée : ' + q.name + ')').join(' ')}`);
}
console.log(`lieux : ${[...new Set(quests.map(q => q.zone))].join(' · ')}`);
if (inconnues.length) console.log(`⚠ désactivations déclarées pour des missions absentes du jeu : ${inconnues.join(', ')} — à retirer de DESACTIVEES`);

const ancien = fs.existsSync(F_OUT) ? lireJson(F_OUT) : { quests: [] };
const avant = new Set((ancien.quests || []).map(q => q.name));
const apres = new Set(quests.map(q => q.name));
console.log(`par rapport au fichier en place : +${[...apres].filter(n => !avant.has(n)).length} noms, −${[...avant].filter(n => !apres.has(n)).length} noms`);

if (CHECK) process.exit(0);

const out = {
  generated_at: new Date().toISOString(),
  source: 'datamine : Systems/Landsraad/VotingBlock (pools), JourneyCards/LandsraadContracts (missions), Maps/DT_MapsInfo (lieux)',
  note: 'Généré par tools/build_landsraad_from_datamine.js — ne pas éditer à la main. Une mission désactivée '
    + 'l\'est côté serveur et reste dans son pool : « desactivee » vient de la note de patch citée.',
  categories: categories.map(c => c.name),
  quests,
};
fs.writeFileSync(F_OUT, JSON.stringify(out, null, 2) + '\n');
console.log(`\nlandsraad_data.json écrit (${quests.length} missions).`);
