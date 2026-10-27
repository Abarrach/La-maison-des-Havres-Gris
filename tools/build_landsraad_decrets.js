#!/usr/bin/env node
'use strict';
/**
 * build_landsraad_decrets.js — Les décrets du Landsraad, pris dans le jeu.
 *
 * Alimente `/decret` (discord_decret.php) : le membre connecté coche dans un menu les
 * décrets proposés cette semaine, le bot poste le sondage de la guilde.
 *
 * ── Pourquoi un menu et pas une lecture automatique ─────────────────────────
 * Les trois décrets de la semaine sont TIRÉS AU SORT par serveur (colonne Weight) :
 * aucun site ne les publie (recherche du 2026-10-28), le jeu seul les montre. On ne
 * peut donc qu'abréger la saisie — d'où un catalogue complet, à jour du jeu.
 *
 * ── Source ──────────────────────────────────────────────────────────────────
 *   Systems/Landsraad/DT_LandsraadDecrees
 *       une ligne par décret : Name, NarrativeText, EffectText (FR via le .locres),
 *       Weight, bIsEnabled, bIsAvailableInMultiplayer.
 * Deux décrets portent le même nom (« En l'honneur des défunts », distance et corps à
 * corps) : seul l'effet les distingue, d'où le libellé court par identifiant.
 *
 * Usage :
 *   node tools/build_landsraad_decrets.js [racine Content/Dune]   écrit landsraad_decrets.json
 *   node tools/build_landsraad_decrets.js --check                 compare, n'écrit rien
 */
const fs = require('fs');
const path = require('path');

const RACINE = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const CHECK = args.includes('--check');
const DUNE = args.find(a => !a.startsWith('--'))
  || 'J:/Download/Fmodel/Output/Exports/DuneSandbox/Content/Dune';

const F_TABLE = path.join(DUNE, 'Systems/Landsraad/DT_LandsraadDecrees.json');
const F_OUT = path.join(RACINE, 'landsraad_decrets.json');

// Libellé d'une réponse de sondage Discord : 55 caractères au plus. Le nom du jeu seul
// ne suffit pas (deux décrets homonymes) et l'effet complet est trop long : on écrit
// donc un résumé par identifiant. Un décret nouveau sans résumé garde son nom du jeu,
// et le compte rendu le signale.
const COURT = {
  ExperienceRateIncrease:        ['📚', 'Collaboration des savoirs — XP +50 %'],
  RangedDamageIncreased:         ['🎯', 'En l\'honneur des défunts — distance +33 %'],
  MeleeDamageIncreased:          ['🔪', 'En l\'honneur des défunts — mêlée +33 %'],
  CraftingCostReduced:           ['🔨', 'Contrat de production — fabrication −25 %'],
  DropInventoryOnDefeatActive:   ['💀', 'Droit de pillage — butin total en DD JcJ'],
  RepairAndRefiningTimes:        ['🔧', 'Contrat de raffinage — réparation/raffinage −75 %'],
  SpecialVendorActive:           ['🛒', 'Droits d\'importation — vendeur du Landsraad'],
  SpecialVendorActive_Vehicles:  ['🚙', 'Importation — vendeur de véhicules'],
  SpecialVendorActive_Weapons:   ['🔫', 'Importation — vendeur d\'armes'],
  SpecialVendorActive_Armor:     ['🥋', 'Importation — vendeur d\'armures'],
  SpecialVendorActive_Utilities: ['🧰', 'Importation — vendeur d\'outils'],
};

if (!fs.existsSync(F_TABLE)) {
  console.error(`introuvable : ${F_TABLE}\n→ node tools/update_datamine.js --extraire (cible landsraad_decrees)`);
  process.exit(1);
}
const lireJson = f => JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, ''));
const txt = t => (t && (t.LocalizedString || t.SourceString) || '').trim();

const rows = lireJson(F_TABLE)[0].Rows || {};
const decrets = [];
const ecartes = [];
const sansResume = [];
for (const [id, r] of Object.entries(rows)) {
  // Désactivé, ou réservé au solo : jamais proposé sur notre serveur.
  if (!r.bIsEnabled || r.bIsAvailableInMultiplayer === false) { ecartes.push(id); continue; }
  const nom = txt(r.Name);
  const [emoji, court] = COURT[id] || ['🏛️', nom];
  if (!COURT[id]) sansResume.push(id);
  // La Maison bénéficiaire est citée dans le texte des vendeurs (« de la Maison Moritani »).
  const maison = (txt(r.NarrativeText).match(/de la Maison ([A-Z][\wéè-]+)/) || [])[1] || '';
  const d = { id, nom, effet: txt(r.EffectText), court: court.slice(0, 55), emoji, poids: r.Weight };
  if (maison) d.maison = maison;
  decrets.push(d);
}
decrets.sort((a, b) => a.court.localeCompare(b.court, 'fr'));

// ── Compte rendu ────────────────────────────────────────────────────────────
console.log(`décrets proposables : ${decrets.length} (écartés, désactivés ou solo : ${ecartes.join(', ') || 'aucun'})`);
for (const d of decrets) console.log(`  ${d.emoji} ${d.court.padEnd(52)} poids ${d.poids}${d.maison ? '  · Maison ' + d.maison : ''}`);
if (sansResume.length) console.log(`⚠ sans résumé (nom du jeu utilisé) : ${sansResume.join(', ')} — à ajouter dans COURT`);
const inconnus = Object.keys(COURT).filter(id => !rows[id]);
if (inconnus.length) console.log(`⚠ résumés pour des décrets absents du jeu : ${inconnus.join(', ')} — à retirer de COURT`);

const ancien = fs.existsSync(F_OUT) ? lireJson(F_OUT) : { decrets: [] };
const avant = new Set((ancien.decrets || []).map(d => d.id));
const apres = new Set(decrets.map(d => d.id));
console.log(`par rapport au fichier en place : +${[...apres].filter(i => !avant.has(i)).length}, −${[...avant].filter(i => !apres.has(i)).length}`);

if (CHECK) process.exit(0);

const out = {
  generated_at: new Date().toISOString(),
  source: 'datamine : Systems/Landsraad/DT_LandsraadDecrees (nom, effet, poids de tirage)',
  note: 'Généré par tools/build_landsraad_decrets.js — ne pas éditer à la main. « court » = libellé '
    + 'de réponse de sondage (55 caractères max chez Discord), écrit dans le script.',
  decrets,
};
fs.writeFileSync(F_OUT, JSON.stringify(out, null, 2) + '\n');
console.log(`\nlandsraad_decrets.json écrit (${decrets.length} décrets).`);
