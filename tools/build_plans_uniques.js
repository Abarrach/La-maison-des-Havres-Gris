#!/usr/bin/env node
/**
 * build_plans_uniques.js — Construit `plans_uniques.json`, l'UNIVERS des plans uniques
 * apprenables, extrait une fois pour toutes de l'addon en jeu.
 *
 * Pourquoi ce fichier est nécessaire au registre de guilde : l'addon n'exporte que les
 * plans MANQUANTS. Sans la liste totale, « possédé » serait indéterminable — l'absence
 * d'un plan dans la liste d'un membre voudrait dire soit « il l'a », soit « ce plan
 * n'existe pas ». Avec l'univers, possédé = univers − manquants, sans ambiguïté.
 *
 * Le cas limite que ça évite : un plan que TOUS les membres possèdent n'apparaît dans
 * aucune liste de manquants. Sans univers, il serait invisible du registre.
 *
 * Source : l'export de l'addon lancé sans filtre (tous les plans uniques apprenables),
 * pas seulement ceux qui manquent au joueur. Même format de collage que `plans.html`,
 * donc même analyse — en-tête de tier, compteur, nom, catégorie.
 *
 * Usage : node tools/build_plans_uniques.js [chemin_export.txt]
 */
const fs = require('fs');
const path = require('path');

const RACINE = path.resolve(__dirname, '..');
const SRC = process.argv[2] || 'J:/Download/plans total.txt';
const INDEX = path.join(RACINE, 'plans_index.json');
const SORTIE = path.join(RACINE, 'plans_uniques.json');

if (!fs.existsSync(SRC)) {
  console.error('Introuvable : ' + SRC + '\n→ relancer l\'addon en jeu SANS filtre et coller le résultat dans un .txt.');
  process.exit(1);
}

// Même normalisation que `plans.html` et `build_plans_index.js` : c'est elle qui fait
// foi des deux côtés, un écart ici casserait silencieusement la reconnaissance.
function norm(s) {
  return String(s).toLowerCase()
    .replace(/[‘’`´]/g, "'")
    .replace(/\s+/g, ' ')
    .replace(/[^a-z0-9' ]/g, '')
    .trim();
}

// Duraluminium AVANT aluminium : le premier contient le second (cf. plans.html).
const ENTETES_TIER = [
  [/duralumin/i,          'Duraluminum'],
  [/plastanium/i,         'Plastanium'],
  [/aluminium|aluminum/i, 'Aluminum'],
  [/cuivre|copper/i,      'Copper'],
  [/\bfer\b|iron/i,       'Iron'],
  [/acier|steel/i,        'Steel'],
];
function tierDeLEntete(l) {
  if (!/products\s*$/i.test(l) && !/^produits\b/i.test(l)) return null;
  for (const [re, t] of ENTETES_TIER) if (re.test(l)) return t;
  return null;
}

const CATS = ['armor', 'weapons', 'utility', 'vehicles'];

const index = JSON.parse(fs.readFileSync(INDEX, 'utf8')).plans || {};

/**
 * Noms FRANÇAIS par identifiant, depuis `CDT_BaseItems` (DataTable, donc traduite
 * par FModel — cf. le piège documenté au README : un StringTable ne donne que
 * l'anglais). Indispensable ici : la guilde tape en français et le collage de
 * gaming.tools est en français ; afficher « Wayfinder Helm » rendrait
 * l'autocomplétion Discord inutilisable.
 */
function nomsFrancais() {
  const p = 'J:/Download/Fmodel/Output/Exports/DuneSandbox/Content/Dune/Systems/Items/CDT_BaseItems.json';
  if (!fs.existsSync(p)) return {};
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  const rows = ((Array.isArray(j) ? j[0] : j) || {}).Rows || {};
  const out = {};
  for (const ligne of Object.values(rows)) {
    const n = ((ligne || {}).StaticData || {}).Name;
    if (!n || !n.Key || !n.LocalizedString) continue;
    let m = n.Key.match(/^ITEMS\/SCHEMATIC_SCHEMATIC_(.+)_NAME$/);
    if (m) { out['schematic_' + m[1].toLowerCase()] = n.LocalizedString; continue; }
    m = n.Key.match(/^ITEMS\/SCHEMATIC_(.+)_SCHEMATIC_NAME$/);
    if (m) out[m[1].toLowerCase()] = n.LocalizedString;
  }
  return out;
}
const FR = nomsFrancais();
const lignes = fs.readFileSync(SRC, 'utf8').replace(/\u00a0/g, ' ').split(/\r?\n/);

const plans = {};
let tier = null, nonReconnus = [], dernier = null;
for (const brut of lignes) {
  const l = brut.trim();
  if (!l) continue;
  const t = tierDeLEntete(l);
  if (t) { tier = t; dernier = null; continue; }
  if (/^\d+$/.test(l)) continue;          // compteur du tier
  if (/^G\d+$/i.test(l)) continue;        // grades G0..G5
  const cat = CATS.find(c => l === c || l.toLowerCase().startsWith(c + ' -'));
  if (cat) { if (dernier) plans[dernier].cat = cat; continue; }
  if (!tier) continue;

  const info = index[norm(l)];
  if (!info) { nonReconnus.push(l); dernier = null; continue; }
  // Un même identifiant peut revenir sous deux libellés (FR/EN) : on garde une entrée.
  // Nom français si on l'a, sinon le libellé reconnu (anglais) : mieux vaut un nom
  // anglais qu'un identifiant technique dans l'autocomplétion Discord.
  plans[info.id] = plans[info.id] || { n: FR[info.id] || info.n, tier, cat: null };
  dernier = info.id;
}

const out = {
  generated_at: new Date().toISOString(),
  source: 'Export addon « tous les plans uniques apprenables »',
  note: 'UNIVERS des plans uniques. Sert au registre de guilde : possédé = univers − manquants. '
      + 'Sans lui, un plan absent d\'une liste de manquants serait indistinguable d\'un plan inexistant.',
  count: Object.keys(plans).length,
  plans,
};
fs.writeFileSync(SORTIE, JSON.stringify(out));

console.log(`plans_uniques.json écrit — ${Math.round(fs.statSync(SORTIE).size / 1024)} Ko`);
console.log(`  plans uniques : ${out.count}`);
const parTier = {};
Object.values(plans).forEach(p => { parTier[p.tier] = (parTier[p.tier] || 0) + 1; });
Object.entries(parTier).forEach(([t, n]) => console.log(`      ${t.padEnd(13)} ${n}`));
if (nonReconnus.length) {
  console.log(`  NON RECONNUS  : ${nonReconnus.length}`);
  nonReconnus.slice(0, 10).forEach(x => console.log(`      · ${x}`));
}
