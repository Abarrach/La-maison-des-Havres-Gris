#!/usr/bin/env node
'use strict';
/**
 * build_skills_from_datamine.js — Capacités, techniques et attributs, pris dans le jeu.
 *
 * `stuff_skills.json` (Optimiseur) venait d'un snapshot gaming.tools du 27/06/2026 : la
 * refonte des capacités de la 1.5.3.0 (17/09) y manquait — Déflection notée « 1 niveau,
 * cycle 12 s » alors qu'elle a 3 niveaux et passe de 8 à 4 s.
 *
 * ── La chaîne, dans les fichiers du jeu ─────────────────────────────────────
 *   Systems/Progression/DT_TrainingModules   une ligne par compétence : Tag, arbre
 *       (SkillArea), MaxLevel, nom et description FR, icône, et selon le type :
 *   • capacité (Skills.Ability.*)  AbilityExtraStatsUIData[] = { ligne d'une table de
 *       courbes (CT_AbilityTuning), libellé FR, en % ou non } ;
 *   • technique (Skills.Perk.*)    Perks[niveau] → DT_Perks (même Tag) → BuffClass ;
 *   • attribut (Skills.Attribute.*, Spice.*, Science.*)  BuffClass directement.
 *   BuffClass = un GameplayEffect : sa valeur par défaut porte Modifiers[] (attribut,
 *   opération, ScalableFloat = Value × courbe(niveau)) et l'objet DuneGameplayEffectUIData
 *   les libellés FR alignés sur Modifiers (DescriptionShort[i], bPercentBased[i]).
 *   Les courbes se lisent au temps = niveau, interpolation linéaire.
 *
 * ── Compatibilité ───────────────────────────────────────────────────────────
 * Même forme que l'ancien fichier (l'Optimiseur n'a rien à changer) et MÊMES
 * identifiants : les builds sauvegardés référencent « skills-ability-blindspot ».
 * L'identifiant gaming.tools est le Tag en minuscules (Skills.Perk.BodyShots →
 * skills-perk-bodyshots) ; à défaut on rapproche par l'icône, puis par le nom.
 *
 * Usage :
 *   node tools/build_skills_from_datamine.js [racine Content/Dune]   écrit stuff_skills.json
 *   node tools/build_skills_from_datamine.js --check                 compare, n'écrit rien
 */
const fs = require('fs');
const path = require('path');

const RACINE = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const CHECK = args.includes('--check');
const DUNE = args.find(a => !a.startsWith('--'))
  || 'J:/Download/Fmodel/Output/Exports/DuneSandbox/Content/Dune';
const F_OUT = path.join(RACINE, 'stuff_skills.json');
const F_MODULES = path.join(DUNE, 'Systems/Progression/DT_TrainingModules.json');
const F_PERKS = path.join(DUNE, 'Systems/Progression/DT_Perks.json');

for (const f of [F_MODULES, F_PERKS]) {
  if (!fs.existsSync(f)) {
    console.error(`Introuvable : ${f}\n→ lance d'abord : DuneExtract --config tools/extract/extract.config.json --only progression,ability_tuning`);
    process.exit(1);
  }
}

const lireJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const lignes = (f) => { const j = lireJson(f); return (Array.isArray(j) ? (j.find(x => x.Rows) || j[0]) : j).Rows || {}; };
const texte = (t) => String((t && (t.LocalizedString || t.SourceString)) || '').trim();
const apres = (s) => String(s || '').replace(/^.*::/, '');

// « /Game/Dune/Systems/…/PerkLevels.0 » → fichier exporté correspondant (ou null).
const cache = new Map();
function exporte(objectPath) {
  const m = /^\/Game\/Dune\/(.+?)(?:\.[^/]*)?$/.exec(objectPath || '');
  if (!m) return null;
  const f = path.join(DUNE, m[1] + '.json');
  if (!cache.has(f)) cache.set(f, fs.existsSync(f) ? lireJson(f) : null);
  return cache.get(f);
}

// Valeur d'une courbe au temps t (interpolation linéaire, constante aux bords).
const manquantes = new Set();
function courbe(ref, t) {
  const tab = ref && ref.CurveTable && exporte(ref.CurveTable.ObjectPath);
  if (!ref || !ref.CurveTable) return null;
  const rows = tab && (Array.isArray(tab) ? tab[0] : tab).Rows;
  const r = rows && rows[ref.RowName];
  if (!r || !r.Keys || !r.Keys.length) { manquantes.add(`${ref.CurveTable.ObjectName}:${ref.RowName}`); return undefined; }
  const k = r.Keys;
  if (t <= k[0].Time) return k[0].Value;
  if (t >= k[k.length - 1].Time) return k[k.length - 1].Value;
  for (let i = 1; i < k.length; i++) {
    if (t <= k[i].Time) {
      const a = k[i - 1], b = k[i];
      return r.InterpMode === 'RCIM_Constant' ? a.Value : a.Value + (b.Value - a.Value) * (t - a.Time) / (b.Time - a.Time);
    }
  }
  return k[k.length - 1].Value;
}
// ScalableFloat = Value × courbe(niveau), ou Value seul sans courbe.
function scalable(sf, niveau) {
  if (!sf) return undefined;
  if (!sf.Curve || !sf.Curve.CurveTable) return sf.Value;
  const c = courbe(sf.Curve, niveau);
  return c === undefined ? undefined : (sf.Value ?? 1) * c;
}
const arrondi = (v) => Math.round(v * 1e6) / 1e6;
const icone = (p) => {
  const m = /^\/Game\/Dune\/([^.]+)/.exec(p || '');
  return m ? '/images/dune/' + m[1].toLowerCase() + '.webp' : null;
};

// Modificateurs d'un GameplayEffect, évalués à un niveau.
const effetsIntrouvables = new Set();
function statsEffet(buffClass, niveau) {
  const j = buffClass && exporte(buffClass.ObjectPath);
  if (!j) { if (buffClass) effetsIntrouvables.add(buffClass.ObjectName); return []; }
  const cdo = j.find(x => /^Default__/.test(x.Name || '')) || {};
  const ui = (j.find(x => x.Type === 'DuneGameplayEffectUIData') || {}).Properties || {};
  const out = [];
  const mods = (cdo.Properties || {}).Modifiers || [];
  const libs = ui.DescriptionShort || [], pcts = ui.bPercentBased || [];
  // Libellés alignés sur les modificateurs quand l'interface en donne autant ; sinon le
  // premier vaut pour tous (cas d'un effet réel + son modificateur d'affichage).
  const aligne = libs.length === mods.length;
  for (const [i, m] of mods.entries()) {
    let k = m.Attribute && m.Attribute.AttributeName;
    const mag = m.ModifierMagnitude || {};
    if (!k || apres(mag.MagnitudeCalculationType) !== 'ScalableFloat') continue;
    const sf = mag.ScalableFloatMagnitude || {};
    const v = scalable(sf, niveau);
    if (v === undefined) continue;
    // Modificateur d'AFFICHAGE : le jeu pose la valeur à montrer sur un attribut de PNJ
    // sans effet (NPCToNPCDamageMultiplier), lue dans CT_AbilityStatDisplay. Préfixé
    // « UI_ » : l'Optimiseur l'affiche sans jamais l'additionner aux vraies stats.
    const proprio = JSON.stringify(m.Attribute.AttributeOwner || m.Attribute.Attribute || '');
    const tab = (sf.Curve && sf.Curve.CurveTable && sf.Curve.CurveTable.ObjectName) || '';
    if (/NPCCharacterAttributeSet/.test(proprio) || /CT_AbilityStatDisplay/.test(tab)) {
      const row = sf.Curve && sf.Curve.RowName;
      k = 'UI_' + (row && row !== 'None' ? row : 'Valeur');
    }
    const j2 = aligne ? i : 0;
    out.push({ lvl: niveau, k, n: texte(libs[j2]) || k, v: arrondi(v),
               f: pcts[j2] ? '{v:0.#}%' : '{v:0.#}', op: apres(m.ModifierOp) });
  }
  return out;
}

// ── Lecture ─────────────────────────────────────────────────────────────────
const modules = lignes(F_MODULES);
const perksParTag = {};
for (const r of Object.values(lignes(F_PERKS))) if (r.Tag && r.Tag.TagName) perksParTag[r.Tag.TagName] = r;

const TYPES = { Ability: 'Ability', Perk: 'Technique', Attribute: 'Attribute', Spice: 'Attribute', Science: 'Attribute' };
const ancien = fs.existsSync(F_OUT) ? lireJson(F_OUT) : { skills: [] };
const ancienParId = new Map((ancien.skills || []).map(s => [s.id, s]));
const ancienParIcone = new Map((ancien.skills || []).map(s => [s.type + '|' + s.icon, s]));
const ancienParNom = new Map((ancien.skills || []).map(s => [s.type + '|' + s.name, s]));

const skills = [];
const reprises = [];
const idsPris = new Set();
const tagsPresents = new Set(Object.values(modules).map(r => {
  const [, f, n] = ((r.Tag && r.Tag.TagName) || '').split('.');
  return f && n ? 'skills-' + f.toLowerCase() + '-' + n.toLowerCase() : null;
}).filter(Boolean));
for (const r of Object.values(modules)) {
  const tag = (r.Tag && r.Tag.TagName) || '';
  const [, famille, nomTag] = tag.split('.');
  const type = TYPES[famille];
  if (!type || !nomTag) continue;                     // Skills.Key.* = paliers d'arbre, pas des compétences
  const name = texte(r.DisplayName);
  if (!name || /^XX_/.test(name)) continue;           // « XX_ » = compétence fictive, absente de l'arbre en jeu
  const icon = icone(r.Icon && r.Icon.AssetPathName);
  const maxLevel = r.MaxLevel || 1;

  const stats = [];
  if (famille === 'Ability') {
    for (const s of (r.AbilityExtraStatsUIData || [])) {
      for (let lvl = 1; lvl <= maxLevel; lvl++) {
        const v = courbe(s.Stat, lvl);
        if (v === undefined || v === null) continue;
        stats.push({ lvl, k: s.Stat.RowName, n: texte(s.DescriptionShort) || s.Stat.RowName, v: arrondi(v),
                     f: s.bPercentBased ? '{v:0.#}%' : '{v:0.#}' });
      }
    }
  } else if (famille === 'Perk' && (r.Perks || []).length) {
    for (const p of r.Perks) {
      const perk = perksParTag[p.Value && p.Value.Tag && p.Value.Tag.TagName];
      if (perk) stats.push(...statsEffet(perk.BuffClass, (p.Value && p.Value.GrantedLevel) || +p.Key || 1));
    }
    // Une technique peut AUSSI porter un effet sur sa propre ligne (Fente téméraire).
    if (r.BuffClass) for (let lvl = 1; lvl <= maxLevel; lvl++) stats.push(...statsEffet(r.BuffClass, lvl));
  } else {
    // Attributs, et techniques sans entrée Perks (Surcharge du bouclier) : l'effet est
    // porté directement par la ligne de la compétence.
    for (let lvl = 1; lvl <= maxLevel; lvl++) stats.push(...statsEffet(r.BuffClass, lvl));
  }
  // Une technique à niveau unique liste parfois ses paliers 1 à 3 dans Perks : on ne
  // garde que les niveaux atteignables.
  for (let i = stats.length - 1; i >= 0; i--) if (stats[i].lvl > maxLevel) stats.splice(i, 1);
  // Même ordre que l'ancien fichier : par statistique, puis par niveau.
  const ordreK = [...new Set(stats.map(s => s.k))];
  stats.sort((a, b) => ordreK.indexOf(a.k) - ordreK.indexOf(b.k) || a.lvl - b.lvl);

  const idTag = 'skills-' + famille.toLowerCase() + '-' + nomTag.toLowerCase();
  // Le Tag d'abord. Le rapprochement par icône ou nom ne sert qu'à une compétence dont
  // le Tag a changé, et jamais en prenant l'identifiant d'une AUTRE compétence encore
  // présente : « Cartographie » existe deux fois (Explorer1 et Explorer6), le rapprochement
  // par nom leur donnait le même identifiant.
  const libre = (s) => s && !tagsPresents.has(s.id) && !idsPris.has(s.id);
  const prev = ancienParId.get(idTag)
    || [ancienParIcone.get(type + '|' + icon), ancienParNom.get(type + '|' + name)].find(libre);
  const id = prev ? prev.id : idTag;
  idsPris.add(id);
  const sk = { id, name, icon, type, tree: apres(r.SkillArea), maxLevel, stats };
  // Effet codé dans une capacité accordée (GrantedAbilities : Danse des lames…) : aucun
  // chiffre lisible dans les fichiers. Plutôt que d'effacer ce que l'ancien snapshot
  // montrait, on le garde, marqué `stats_src` — jamais présenté comme une donnée du jeu.
  if (!stats.length && prev && (prev.stats || []).length) {
    sk.stats = prev.stats.filter(s => s.lvl <= maxLevel);
    sk.stats_src = prev.stats_src || 'gaming.tools (snapshot du 2026-06-27)';
    reprises.push(name);
  }
  const desc = texte(r.AbilityLongDescription) || texte(perksParTag['Perks.' + nomTag] && perksParTag['Perks.' + nomTag].LongDescription);
  if (desc) sk.desc = desc;
  skills.push(sk);
}
skills.sort((a, b) => a.tree.localeCompare(b.tree) || a.type.localeCompare(b.type) || a.name.localeCompare(b.name, 'fr'));

// ── Confrontation avec l'ancien snapshot (c'est la validation) ──────────────
const parType = {};
for (const s of skills) parType[s.type] = (parType[s.type] || 0) + 1;
console.log(`compétences : ${skills.length}  ${JSON.stringify(parType)}`);
const nouv = new Map(skills.map(s => [s.id, s]));
let identiques = 0;
const changees = [], ajoutees = [], disparues = [];
const sig = (s) => JSON.stringify({ m: s.maxLevel, st: (s.stats || []).map(x => [x.lvl, x.k, Math.round(x.v * 1e4) / 1e4]) });
for (const s of skills) {
  const o = ancienParId.get(s.id);
  if (!o) { ajoutees.push(`${s.name} (${s.type}, ${s.tree})`); continue; }
  if (sig(o) === sig(s)) identiques++; else changees.push(s);
}
for (const o of (ancien.skills || [])) if (!nouv.has(o.id)) disparues.push(`${o.name} (${o.id})`);
console.log(`identiques à l'ancien snapshot : ${identiques} · changées : ${changees.length} · nouvelles : ${ajoutees.length} · disparues : ${disparues.length}`);
for (const s of changees.slice(0, 14)) {
  const o = ancienParId.get(s.id);
  const resume = (x) => `niv ${x.maxLevel} ` + [...new Set((x.stats || []).map(t => t.k))].slice(0, 2)
    .map(k => k.replace(/^.*\./, '') + ' ' + (x.stats || []).filter(t => t.k === k).map(t => Math.round(t.v * 100) / 100).join('/')).join(', ');
  console.log(`  ~ ${s.name} : ${resume(o)}  →  ${resume(s)}`);
}
if (changees.length > 14) console.log(`  … (+${changees.length - 14})`);
if (ajoutees.length) console.log(`  + ${ajoutees.join(' · ')}`);
if (disparues.length) console.log(`  − ${disparues.join(' · ')}`);
if (reprises.length) console.log(`ℹ chiffres repris de l'ancien snapshot (effet codé, illisible dans les fichiers) : ${reprises.join(', ')}`);
if (effetsIntrouvables.size) console.log(`⚠ effets non exportés : ${[...effetsIntrouvables].join(', ')}`);
if (manquantes.size) console.log(`⚠ courbes introuvables : ${[...manquantes].slice(0, 10).join(', ')}`);

if (CHECK) process.exit(0);

const out = {
  generated_at: new Date().toISOString(),
  locale: 'fr',
  source: 'datamine : DT_TrainingModules + DT_Perks + GameplayEffects + CT_AbilityTuning / CT_SkillAttributeValues / PerkLevels',
  icon_base: ancien.icon_base || 'https://cdn-hosted.gaming.tools/dune/images',
  count: skills.length,
  skills,
};
fs.writeFileSync(F_OUT, JSON.stringify(out) + '\n');
console.log(`\nstuff_skills.json écrit (${skills.length} compétences).`);
