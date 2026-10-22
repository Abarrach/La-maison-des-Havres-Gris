#!/usr/bin/env node
'use strict';
/**
 * build_metiers_from_datamine.js — Pistes de spécialisation (page Métiers), prises dans le jeu.
 *
 * `metiers.json` était saisi à la main (avril 2026). Le jeu le décrit entièrement :
 *   Systems/Specialization/DA_<Piste>Track   courbe d'XP, passifs (attribut + courbe par
 *       niveau, CF_Passive*), et m_Keystones[] = { m_Level, m_Cost (épice), m_Keystone } ;
 *   Keystones/DA_*      l'effet : points de compétence (m_PointsToAdd), modificateurs
 *       d'attribut (Modifiers[].Value), cosmétique, recette, ou étiquette de joueur ;
 *   GUI/DA_*GUIData     titre et description FR (m_Name, m_Description), et l'extension
 *       d'affichage : libellé de la stat, en % ou non, multiplicateur, « soustraire 1 »,
 *       inversion de signe, décimales — exactement ce que montre le jeu.
 *
 * ── Ce qui reste à NOUS ─────────────────────────────────────────────────────
 *   • `stat` : clé interne de la page (hp, stamina, scrip…) qui sert à additionner les
 *     paliers. Reprise du fichier en place, palier par palier (même piste, même niveau).
 *   • `is_landsraad_favorable` : jugement de la guilde, pas une donnée du jeu. Repris tel quel.
 *
 * Usage :
 *   node tools/build_metiers_from_datamine.js [racine Content/Dune]   écrit metiers.json
 *   node tools/build_metiers_from_datamine.js --check                 compare, n'écrit rien
 */
const fs = require('fs');
const path = require('path');

const RACINE = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const CHECK = args.includes('--check');
const DUNE = args.find(a => !a.startsWith('--'))
  || 'J:/Download/Fmodel/Output/Exports/DuneSandbox/Content/Dune';
const D_SPEC = path.join(DUNE, 'Systems/Specialization');
const F_OUT = path.join(RACINE, 'metiers.json');

if (!fs.existsSync(path.join(D_SPEC, 'DA_CombatTrack.json'))) {
  console.error(`Introuvable : ${D_SPEC}\n→ lance d'abord : DuneExtract --config tools/extract/extract.config.json --only specialization`);
  process.exit(1);
}

const PISTES = [['Combat', 'COMBAT'], ['Sabotage', 'SABOTAGE'], ['Exploration', 'EXPLORATION'],
                ['Gathering', 'RECOLTE'], ['Crafting', 'FABRICATION']];

const lireJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const texte = (t) => String((t && (t.LocalizedString || t.SourceString)) || '').replace(/<\/?[^>]*>/g, '').replace(/\s+/g, ' ').trim();
// « /Game/Dune/Systems/Specialization/GUI/DA_X.DA_X » → objets exportés (ou null).
function exporte(p) {
  const m = /^\/Game\/Dune\/Systems\/Specialization\/([^.]+)/.exec(p || '');
  const f = m && path.join(D_SPEC, m[1] + '.json');
  return f && fs.existsSync(f) ? lireJson(f) : null;
}
const principal = (objs, type) => (objs || []).find(o => !type || o.Type === type) || null;

// Valeur telle que le jeu l'affiche, d'après la description d'affichage de la stat.
function affiche(v, fmt) {
  if (typeof v !== 'number') return null;
  fmt = fmt || {};
  if (fmt.m_bShouldSubtractOne) v -= 1;
  v *= (fmt.m_ValueMultiplier ?? 1);
  if (fmt.m_bIsPercentage) v *= 100;
  if (fmt.m_bInvertSign) v = -v;
  // Au moins le centième : le jeu arrondit l'AFFICHAGE (m_NumDecimals), mais la page
  // additionne les paliers — arrondir chacun fausserait la somme.
  const d = Math.max(fmt.m_NumDecimals ?? 0, 2);
  return Math.round(v * 10 ** d) / 10 ** d;
}
// Courbe CurveFloat au temps t (linéaire, constante aux bords).
function courbeFloat(ref, t) {
  const j = ref && exporte(ref.ObjectPath);
  const fc = j && j[0] && j[0].Properties && j[0].Properties.FloatCurve;
  const k = fc && fc.Keys;
  if (!k || !k.length) return null;
  if (t <= k[0].Time) return k[0].Value;
  if (t >= k[k.length - 1].Time) return k[k.length - 1].Value;
  for (let i = 1; i < k.length; i++) if (t <= k[i].Time) {
    const a = k[i - 1], b = k[i];
    return a.Value + (b.Value - a.Value) * (t - a.Time) / (b.Time - a.Time);
  }
  return null;
}

const ancien = fs.existsSync(F_OUT) ? lireJson(F_OUT) : [];
const cle = (m, n, passif) => `${m}|${n}|${passif ? 'p' : ''}`;
const ancienPar = new Map();
for (const e of ancien) ancienPar.set(cle(e.metier, e.niveau, e.is_passive) + (e.is_passive ? '|' + e.stat : ''), e);
const ancienParNiveau = new Map(ancien.filter(e => !e.is_passive).map(e => [cle(e.metier, e.niveau), e]));

const sortie = [];
const inconnus = [];
const gardes = [];
const xp = {};
for (const [nomPiste, metier] of PISTES) {
  const t = lireJson(path.join(D_SPEC, `DA_${nomPiste}Track.json`))[0].Properties;
  xp[metier] = t.m_XPCurve || [];
  const guiPiste = principal(exporte(t.m_GUIData && t.m_GUIData.AssetPathName), 'CharacterSpecializationTrackGUIData');
  const libsPassifs = ((guiPiste && guiPiste.Properties.m_Attributes) || []);

  // ── Passifs (niveau 0) : valeur gagnée par niveau de piste ──
  const anciensPassifs = ancien.filter(e => e.metier === metier && e.is_passive);
  const passifs = t.m_PassiveAttributes || [];
  for (const [i, pa] of passifs.entries()) {
    // Plus d'attributs que de libellés (Récolte : 3 pour 2) : deux attributs qui suivent la
    // MÊME courbe partagent le libellé du premier (rendement du compacteur, « soustraire 1 »).
    const j = libsPassifs[i] ? i
      : passifs.findIndex(q => q.ValuePerLevel && pa.ValuePerLevel && q.ValuePerLevel.ObjectPath === pa.ValuePerLevel.ObjectPath);
    const fmt = libsPassifs[j] || libsPassifs[0] || {};
    const v1 = courbeFloat(pa.ValuePerLevel, 1);
    const prev = anciensPassifs[i];
    const e = { metier, niveau: 0, talent: 'Passif : ' + (texte(fmt.m_Name) || (prev && prev.talent.replace(/^Passif : /, '')) || pa.Attribute.AttributeName),
                description: prev ? prev.description : '', stat: prev ? prev.stat : pa.Attribute.AttributeName,
                valeur: affiche(v1, fmt), is_passive: true };
    if (fmt.m_bIsPercentage) e.suffixe = '%';
    sortie.push(e);
  }

  // ── Paliers ──
  const paliers = (t.m_Keystones || []).slice().sort((a, b) => a.m_Level - b.m_Level);
  for (const k of paliers) {
    const ks = principal(exporte(k.m_Keystone && k.m_Keystone.ObjectPath));
    const p = (ks && ks.Properties) || {};
    const guiObjs = exporte(p.m_GUIData && p.m_GUIData.AssetPathName) || [];
    const gui = (principal(guiObjs, 'CharacterSpecializationKeystoneGUIData') || {}).Properties || {};
    const ext = guiObjs.find(o => /AttributeModGUIData|GenericValueListGUIData/.test(o.Type));
    const prev = ancienParNiveau.get(cle(metier, k.m_Level));
    const e = { metier, niveau: k.m_Level, talent: texte(gui.m_Name) || (prev && prev.talent) || '?',
                description: texte(gui.m_Description) || (prev && prev.description) || '' };

    let valeur = null, pct = false;
    if (ks && ks.Type === 'CharacterSpecializationAddSkillPointsKeystone') {
      valeur = p.m_PointsToAdd;
    } else if (ks && ks.Type === 'CharacterSpecializationAttributeModKeystone' && !(ext && /GenericValueList/.test(ext.Type))) {
      const fmt = ((ext && ext.Properties && ext.Properties.m_Attributes) || [])[0] || {};
      const m0 = (p.Modifiers || [])[0];
      valeur = affiche(m0 && m0.Value, fmt);
      pct = !!fmt.m_bIsPercentage;
    } else if (ext && /GenericValueList/.test(ext.Type)) {
      // Valeur FIXÉE par l'affichage du jeu (Machinerie efficace : 15 %) — c'est ce que
      // voit le joueur, même quand le modificateur interne s'exprime autrement.
      const vd = ((ext.Properties || {}).m_ValuesData || [])[0];
      if (vd && vd.m_bUseCustomValue) { valeur = affiche(vd.m_Value, { m_bIsPercentage: vd.m_bIsPercentage }); pct = !!vd.m_bIsPercentage; }
    }
    // Signe : « −15 % » ou « +15 % » pour une même réduction est une convention de
    // PRÉSENTATION, liée aux libellés de la page. À valeur absolue égale, on garde le signe
    // en place ; seule une vraie différence de valeur passe.
    if (valeur !== null && prev && typeof prev.valeur === 'number' && Math.abs(Math.abs(prev.valeur) - Math.abs(valeur)) < 1e-9) {
      valeur = prev.valeur;
    }
    if (!ks) inconnus.push(`${metier}@${k.m_Level} : palier non exporté`);

    if (prev && prev.stat !== undefined && valeur !== null) {
      e.stat = prev.stat;
      e.valeur = valeur;
      if (pct || prev.suffixe) e.suffixe = pct ? '%' : prev.suffixe;
    } else if (prev && prev.stat !== undefined && prev.valeur !== undefined) {
      // Le jeu ne chiffre pas ce palier (étiquette de joueur : « +1 niveau de qualité du
      // butin ») : on garde la valeur saisie, qui traduit sa description.
      e.stat = prev.stat;
      e.valeur = prev.valeur;
      if (prev.suffixe) e.suffixe = prev.suffixe;
      gardes.push(`${metier}@${k.m_Level} « ${e.talent} » (${prev.valeur}${prev.suffixe || ''})`);
    } else if (valeur !== null && !prev) {
      inconnus.push(`${metier}@${k.m_Level} « ${e.talent} » : nouvelle stat (${valeur}${pct ? ' %' : ''}), clé interne à choisir`);
      e.stat = 'nouveau_' + metier.toLowerCase() + '_' + k.m_Level;
      e.valeur = valeur;
      if (pct) e.suffixe = '%';
    }
    if (prev && prev.is_landsraad_favorable) e.is_landsraad_favorable = true;
    e.cout_epice = k.m_Cost;
    sortie.push(e);
  }
}

// ── Confrontation avec le fichier en place (c'est la validation) ────────────
const nouv = new Map(sortie.map(e => [cle(e.metier, e.niveau, e.is_passive) + (e.is_passive ? '|' + e.stat : ''), e]));
const champs = ['talent', 'description', 'valeur', 'suffixe', 'cout_epice'];
const ecarts = {}, lignes = [];
let identiques = 0;
for (const [k, e] of nouv) {
  const o = ancienPar.get(k);
  if (!o) { lignes.push(`  + ${e.metier} niv ${e.niveau} « ${e.talent} »`); continue; }
  const d = champs.filter(c => JSON.stringify(o[c] ?? null) !== JSON.stringify(e[c] ?? null));
  if (!d.length) { identiques++; continue; }
  for (const c of d) ecarts[c] = (ecarts[c] || 0) + 1;
  lignes.push(`  ~ ${e.metier} niv ${e.niveau} : ` + d.map(c => `${c} ${JSON.stringify(o[c])} → ${JSON.stringify(e[c])}`).join(' ; '));
}
for (const [k, o] of ancienPar) if (!nouv.has(k)) lignes.push(`  − ${o.metier} niv ${o.niveau} « ${o.talent} »`);
console.log(`paliers + passifs : ${sortie.length} (fichier en place : ${ancien.length}) · identiques : ${identiques}`);
console.log(`écarts par champ : ${JSON.stringify(ecarts)}`);
console.log(lignes.slice(0, 80).join('\n'));
if (lignes.length > 80) console.log(`  … (+${lignes.length - 80})`);
// ── Tables d'XP de la page (skills.js) : codées en dur, VÉRIFIÉES ici ──────
// XP_CUMUL = m_XPCurve (identique pour les 5 pistes) ; MISSIONS_CUMUL = XP / gain d'une
// mission Landsraad (DT_LandsraadContractsDailyBonus, serveur officiel : 125), arrondi
// au-dessus. Vérifié identique le 2026-10-23 : on ne réécrit pas skills.js, on prévient.
try {
  const js = fs.readFileSync(path.join(RACINE, 'skills.js'), 'utf8');
  const lireTable = (nom) => { const m = new RegExp(`const ${nom}\\s*=\\s*(\\{[^}]*\\})`).exec(js); return m ? Function(`return ${m[1]}`)() : null; };
  const XP = lireTable('XP_CUMUL'), MI = lireTable('MISSIONS_CUMUL');
  const ref = xp.COMBAT || [];
  const pistesEgales = Object.values(xp).every(c => JSON.stringify(c) === JSON.stringify(ref));
  const fBonus = path.join(DUNE, 'Systems/Landsraad/DT_LandsraadContractsDailyBonus.json');
  let parMission = null;
  if (fs.existsSync(fBonus)) {
    const rows = (j => (Array.isArray(j) ? (j.find(x => x.Rows) || j[0]) : j).Rows)(lireJson(fBonus));
    const b = rows && rows.CombatBonusBasic;
    const g = b && b.m_DedicatedServerBonusRewardData && (b.m_DedicatedServerBonusRewardData.m_SpecializationXP || [])[0];
    parMission = g ? g.Amount : null;
  }
  const ecXP = [], ecMI = [];
  for (let n = 1; n < ref.length; n++) {
    if (XP && XP[n] !== ref[n]) ecXP.push(n);
    if (MI && parMission && MI[n] !== Math.ceil(ref[n] / parMission)) ecMI.push(n);
  }
  console.log(`tables d'XP de skills.js : ${pistesEgales ? 'courbe commune aux 5 pistes' : '⚠ COURBES DIFFÉRENTES selon la piste'}`
    + ` · XP_CUMUL ${XP ? (ecXP.length ? `⚠ ${ecXP.length} niveau(x) faux (${ecXP.slice(0, 5).join(', ')})` : 'conforme') : 'introuvable'}`
    + ` · MISSIONS_CUMUL ${parMission ? (ecMI.length ? `⚠ ${ecMI.length} niveau(x) faux` : `conforme (${parMission} XP par mission)`) : 'non vérifiée (DT_LandsraadContractsDailyBonus non exporté)'}`);
} catch (err) { console.log(`⚠ tables d'XP non vérifiées : ${err.message}`); }

if (inconnus.length) console.log('⚠ ' + inconnus.join('\n⚠ '));
if (gardes.length) console.log('ℹ valeur saisie conservée (palier non chiffré par le jeu) : ' + gardes.join(', '));

if (CHECK) process.exit(0);
fs.writeFileSync(F_OUT, JSON.stringify(sortie, null, 2) + '\n');
console.log(`\nmetiers.json écrit (${sortie.length} entrées).`);
