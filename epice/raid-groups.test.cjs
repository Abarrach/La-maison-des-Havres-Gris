const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const RaidGroups = require('./raid-groups.js');
const html = fs.readFileSync(__dirname + '/debrief.html','utf8');
function extract(name, next) {
  const from=html.indexOf('function '+name+'(');
  return html.slice(from,html.indexOf(next,from));
}
const context = vm.createContext({RaidGroups});
vm.runInContext(extract('mkDefenseSquad','// Nettoyage du collage') + extract('emptyCompo','let currentCompo') + extract('cleanCompo','async function saveAssign') + extract('chefHat','// Nom + badge'),context);
function fixture() {
  return JSON.parse(JSON.stringify({tactical_version:2,commandement:{cs:'Transporteur',cdr:'Nord',cp:'Patrouille 1',cb:'Constructeur'},
    recolte:[{transporteur:'Transporteur',moissonneur:'Moissonneur'}],
    defense:[{nord:{nom:'Nord',cac:true,assaut:true},sud:{nom:'Sud'},est:{nom:'Est'},ouest:{nom:'Ouest'},assauts:[]}],
    recon:{scouts:[{nom:'Scout'}]},distance:{pilotes:[{nom:'Patrouille 1'},{nom:'Patrouille 2'}]},
    base_avancee:{active:true,constructeur:'Constructeur',buggy:'Buggy 2',sous_fief:true,patrouilleurs:['Patrouille 1','Patrouille 2']},ingame:[]}));
}
test('récolte et base : groupes exacts, assaut cardinal et patrouilleurs jamais dupliqués',()=>{
  const c=fixture();c.ingame=RaidGroups.build(c);
  assert.deepEqual(c.ingame[0].membres,['Transporteur','Moissonneur','Scout','Nord']);
  assert.deepEqual(c.ingame[1].membres,['Constructeur','Buggy 2','Patrouille 1','Patrouille 2']);
  assert.deepEqual(c.ingame[2].membres,['Sud','Est','Ouest']);
  const all=c.ingame.flatMap(g=>g.membres);assert.equal(all.length,11);assert.equal(new Set(all).size,11);
  assert.deepEqual(RaidGroups.issues(c,true),[]);
});
test('CaC et Assaut survivent à normalisation, sauvegarde et relecture',()=>{
  const c=context.normalizeCompo(fixture());const saved=context.cleanCompo(c);
  const round=context.normalizeCompo(JSON.parse(JSON.stringify(saved)));
  assert.equal(round.defense[0].nord.cac,true);assert.equal(round.defense[0].nord.assaut,true);
  assert.equal(round.base_avancee.constructeur,'Constructeur');assert.equal(round.commandement.cb,'Constructeur');
});
test('ancienne composition lisible sans activation de base ni réécriture des groupes',()=>{
  const old={commandement:{cs:'Ancien'},defense:{nord:'Ancien',sud:'Sud'},ingame:[{membres:['Ancien','Sud']}]};
  const c=context.normalizeCompo(JSON.parse(JSON.stringify(old)));
  assert.equal(c.base_avancee.active,false);assert.equal(c.tactical_version,undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(c.ingame)),old.ingame);
  assert.equal(c.defense[0].nord.nom,'Ancien');
});
test('base désactivée : patrouille regroupée normalement, noms de base exclus',()=>{
  const c=fixture();c.base_avancee.active=false;c.ingame=RaidGroups.build(c);
  assert.ok(c.ingame.some(g=>g.label==='Patrouille'&&g.membres.length===2));
  assert.ok(!c.ingame.flatMap(g=>g.membres).includes('Constructeur'));
  assert.deepEqual(RaidGroups.issues(c,true),[]);
});
test('multiples récoltes, assauts et scouts : aucun débordement perdu',()=>{
  const c=fixture();c.recolte.push({transporteur:'T2',moissonneur:'M2'});c.defense[0].sud.assaut=true;
  for(let i=2;i<=8;i++)c.recon.scouts.push({nom:'Scout '+i});
  c.ingame=RaidGroups.build(c);const all=c.ingame.flatMap(g=>g.membres);
  assert.equal(all.length,20);assert.equal(new Set(all).size,20);assert.ok(c.ingame.every(g=>g.membres.length<=4));
  assert.deepEqual(c.ingame[1].membres,['T2','M2','Scout 2','Sud']);
});
test('prérequis manquants, patrouilleur invalide et doublons sont signalés',()=>{
  const c=fixture();c.base_avancee.sous_fief=false;c.base_avancee.patrouilleurs=['Patrouille 1','Inconnu'];c.defense[0].nord.assaut=false;
  const warnings=RaidGroups.issues(c,false).join(' ');
  assert.match(warnings,/sous-fief/);assert.match(warnings,/deux patrouilleurs/);assert.match(warnings,/Assaut/);
  c.ingame=[{membres:['Nord','nord']}];assert.match(RaidGroups.issues(c,true).join(' '),/plusieurs groupes/);
});
test('ancien assaut séparé et renforts sont préservés',()=>{
  const c=fixture();c.defense[0].assauts=[{nom:'Ancien assaut'}];c.recolte[0].defenseur_cac='Ancien CaC';
  const all=RaidGroups.build(c).flatMap(g=>g.membres);assert.ok(all.includes('Ancien assaut'));assert.ok(all.includes('Ancien CaC'));
});
test('manuel personnalisé conservé exactement, bloc ajouté une seule fois et éditable',()=>{
  const custom='<h3>Mon manuel personnalisé</h3><p>La patrouille ne descend qu’en dernier recours.</p>';
  const added=RaidGroups.withBaseSop(custom);assert.ok(added.startsWith(custom));assert.match(added,/sous-fief/);
  assert.equal(RaidGroups.withBaseSop(added),added);
  const edited=added.replace('génie, stockage et appui lourd','Notre tactique modifiée');assert.equal(RaidGroups.withBaseSop(edited),edited);
});
test('Chef de base cumulable avec une fonction de commandement',()=>{
  const c=fixture();c.commandement.cs='Constructeur';const badge=context.chefHat('Constructeur',c);
  assert.match(badge,/>CS</);assert.match(badge,/>CB</);
});
test('alerte base : ne pas annoncer Récolte et DR incomplètes quand leurs postes sont remplis',()=>{
  context.esc = value => String(value);
  vm.runInContext(extract('renderCompoReadonly', '  // ── SUR LE TERRAIN') + 'return h;}', context);
  const c=fixture();c.base_avancee.patrouilleurs=['',''];c.ingame=RaidGroups.build(c);
  const rendered=context.renderCompoReadonly(c);
  assert.match(rendered,/Récolte et défense rapprochée complètes/);
  assert.match(rendered,/choisir deux patrouilleurs/);
  assert.doesNotMatch(rendered,/prêt à partir/);
  c.recolte[0].transporteur='';
  assert.match(context.renderCompoReadonly(c),/Récolte : affecter un transporteur et un moissonneur/);
});
test('compo sans groupes en jeu : une seule alerte, pas une par joueur',()=>{
  const c=fixture();c.ingame=[];
  const w=RaidGroups.issues(c,true);
  assert.deepEqual(w,['Groupes en jeu : pas encore pré-remplis.']);
  c.ingame=[{label:'Vide',membres:['','','','']}];
  assert.deepEqual(RaidGroups.issues(c,true),['Groupes en jeu : pas encore pré-remplis.']);
});
test('joueur hors groupe : pseudo rendu tel quel, et les manquants tiennent sur une ligne',()=>{
  const c=fixture();c.ingame=RaidGroups.build(c);
  c.ingame[2].membres=[];  // l'escouade Sud/Est/Ouest disparaît des groupes
  const w=RaidGroups.issues(c,true);
  assert.deepEqual(w.filter(m=>m.startsWith('Sans groupe')),['Sans groupe en jeu : Sud, Est, Ouest.']);
  assert.doesNotMatch(w.join('\n'),/\bsud\b/);
});
test('Chef de base traité comme CS/CDR/CP : son pseudo compte comme déjà posé',()=>{
  vm.runInContext(extract('usedNames','  function candidates'),context);
  const c=context.normalizeCompo(fixture());c.ingame=[];
  context.currentCompo=c;
  const used=context.usedNames();
  ['cs','cdr','cp','cb'].forEach(k=>assert.ok(used.has(c.commandement[k].toLowerCase()),k+' absent de usedNames'));
});
