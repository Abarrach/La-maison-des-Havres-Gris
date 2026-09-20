// ============================================================
//  PROPOSITION D'ORGANISATION — ce que l'automate a le droit de faire
// ============================================================
// Les assertions qui comptent ne sont pas « ça remplit les cases » mais « ça ne
// ment pas » : un poste critique sans titulaire doit rester VIDE, un « peut-être »
// ne doit pas fonder une compo, et personne ne doit occuper deux rôles.
//
//     node epice/raid-auto.test.cjs

const { test } = require('node:test');
const assert   = require('node:assert/strict');
const fs       = require('node:fs');
const path     = require('node:path');
const RaidAuto   = require('./raid-auto.js');
const RaidGroups = require('./raid-groups.js');

// emptyCompo() vit dans debrief.html : on l'extrait plutôt que d'en recopier la forme,
// pour qu'un champ ajouté au modèle soit exercé ici aussi.
const html = fs.readFileSync(path.join(__dirname, 'debrief.html'), 'utf8');
const fonction = nom => {
  const m = new RegExp(String.raw`^function ${nom}\([\s\S]*?^\}$`, 'm').exec(html);
  assert.ok(m, 'fonction introuvable dans debrief.html : ' + nom);
  return m[0] + '\n';
};
const vide = new Function(fonction('mkDefenseSquad') + fonction('emptyCompo') + 'return emptyCompo;')();

const qui = (name, poste, statut) => ({ name, poste, statut: statut || 'present' });
const histo = o => {
  const s = {};
  Object.keys(o).forEach(n => { s[n] = { roles: o[n], sorties: Object.values(o[n]).reduce((a, b) => a + b, 0) }; });
  return s;
};

// Un créneau confortable : de quoi remplir tous les postes.
const COMPLET = [
  qui('Abarrach', 'transporteur'), qui('Sarazin', 'moissonneur'),
  qui('EthanQuix_', 'pilote_orni'), qui('PlayGunN', 'pilote_orni'),
  qui('LeFouDuLaBo4/Pit', 'pilote_orni_cac'), qui('SlyTrooper', 'pilote_orni_cac'),
  qui('Toboe', 'pilote_orni'), qui('Lorhelyne', 'orni_scout'),
  qui('Lohre', 'base_avancee'), qui('Quätrequart', 'base_avancee'),
];

test('le poste déclaré sur Discord prime sur l habitude', () => {
  // Karrel a conduit le transporteur six fois, mais AUJOURD HUI il s est inscrit pilote.
  // Abarrach, lui, a coché transporteur : c est lui qui doit être placé.
  const { compo } = RaidAuto.proposer(vide(),
    [qui('Abarrach', 'transporteur'), qui('Karrel', 'pilote_orni')],
    histo({ Karrel: { transporteur: 6 }, Abarrach: { patrouille: 2 } }));
  assert.equal(compo.recolte[0].transporteur, 'Abarrach');
});

test('l habitude sert quand personne n a déclaré le poste', () => {
  const { compo, journal } = RaidAuto.proposer(vide(),
    [qui('Karrel', 'pilote_orni'), qui('Toboe', 'pilote_orni')],
    histo({ Karrel: { transporteur: 6 }, Toboe: { patrouille: 9 } }));
  assert.equal(compo.recolte[0].transporteur, 'Karrel');
  assert.ok(journal.habitude.some(j => j.nom === 'Karrel' && j.role === 'transporteur' && j.fois === 6));
});

test('un poste critique sans titulaire reste VIDE', () => {
  // Le cas du créneau 14–16 du jeu d essai : plus personne pour le transporteur.
  // Promouvoir un pilote d office ferait passer un créneau intenable pour complet.
  const { compo, journal } = RaidAuto.proposer(vide(),
    [qui('Sarazin', 'moissonneur'), qui('PlayGunN', 'pilote_orni'), qui('Fenros', 'pilote_orni')],
    histo({ PlayGunN: { patrouille: 4 }, Fenros: { cardinal: 3 } }));
  assert.equal(compo.recolte[0].transporteur, '', 'aucun transporteur ne devait être inventé');
  assert.ok(journal.manque.includes('transporteur'));
  assert.equal(compo.recolte[0].moissonneur, 'Sarazin', 'le moissonneur, lui, était déclaré');
});

test('la base avancée ne s active qu à partir de DEUX volontaires', () => {
  const seul = RaidAuto.proposer(vide(), COMPLET.filter(c => c.name !== 'Quätrequart'), histo({}));
  assert.equal(seul.compo.base_avancee.active, false, 'un constructeur seul n est pas une base avancée');
  const deux = RaidAuto.proposer(vide(), COMPLET, histo({}));
  assert.equal(deux.compo.base_avancee.active, true);
  assert.ok(deux.compo.base_avancee.constructeur && deux.compo.base_avancee.buggy);
  assert.equal(deux.compo.base_avancee.sous_fief, false, 'le sous-fief ne se devine pas, il se demande');
});

test('un cardinal est toujours marqué Assaut, et de préférence l habitué', () => {
  const { compo } = RaidAuto.proposer(vide(), COMPLET, histo({ SlyTrooper: { cardinal: 5, assaut: 5 } }));
  const assauts = RaidGroups.assaults(compo);
  assert.equal(assauts.length, 1);
  assert.equal(assauts[0], 'SlyTrooper');
});

test('le CaC déclaré sur Discord est reporté sur la case', () => {
  const { compo } = RaidAuto.proposer(vide(), COMPLET, histo({}));
  const parNom = {};
  ['nord', 'sud', 'est', 'ouest'].forEach(k => { if (compo.defense[0][k].nom) parNom[compo.defense[0][k].nom] = compo.defense[0][k]; });
  (compo.distance.pilotes || []).forEach(p => { if (p.nom) parNom[p.nom] = p; });
  assert.equal(parNom['LeFouDuLaBo4/Pit'].cac, true);
  assert.equal(parNom['EthanQuix_'].cac, false);
});

test('la proposition ne place jamais quelqu un deux fois', () => {
  const { compo } = RaidAuto.proposer(vide(), COMPLET, histo({}));
  const doublons = RaidGroups.issues(compo, false).filter(w => /plusieurs rôles/.test(w));
  assert.deepEqual(doublons, []);
});

test('un « peut-être » n est pas placé, il est signalé en renfort', () => {
  const { compo, journal } = RaidAuto.proposer(vide(),
    COMPLET.concat([qui('fenrir1092', 'pilote_orni', 'maybe'), qui('Clotho', '', 'absent')]),
    histo({}));
  const tous = JSON.stringify(compo);
  assert.ok(!tous.includes('fenrir1092'), 'un peut-être ne doit pas fonder une organisation');
  assert.ok(!tous.includes('Clotho'),     'un absent encore moins');
  assert.deepEqual(journal.renforts, ['fenrir1092']);
});

test('le chef de sortie reste vide s il n y a aucun précédent', () => {
  const sans = RaidAuto.proposer(vide(), COMPLET, histo({}));
  assert.equal(sans.compo.commandement.cs, '');
  assert.ok(sans.journal.manque.some(m => /chef de sortie/.test(m)));
  const avec = RaidAuto.proposer(vide(), COMPLET, histo({ Abarrach: { cs: 4, transporteur: 4 } }));
  assert.equal(avec.compo.commandement.cs, 'Abarrach');
});

test('CDR et CP ont un repli structurel, pas le CS', () => {
  // Quelqu un doit mener l escouade et la patrouille même sans historique.
  const { compo } = RaidAuto.proposer(vide(), COMPLET, histo({}));
  assert.ok(compo.commandement.cdr, 'le CDR devrait retomber sur le cardinal Assaut');
  assert.ok(compo.commandement.cp,  'le CP devrait retomber sur le premier patrouilleur');
  assert.equal(RaidGroups.assaults(compo)[0], compo.commandement.cdr);
});

test('deux commandements ne se cumulent pas sur la même personne', () => {
  // Galatea a été CS une fois et CDR deux fois : sans garde-fou elle prend les deux.
  const { compo } = RaidAuto.proposer(vide(), COMPLET.concat([qui('Galatea', 'pilote_orni')]),
    histo({ Galatea: { cs: 1, cdr: 2, cardinal: 3 }, EthanQuix_: { cardinal: 3 } }));
  const c = compo.commandement;
  assert.equal(c.cs, 'Galatea');
  assert.notEqual(c.cdr, c.cs, 'le CDR ne doit pas être le CS quand un autre cardinal existe');
  const portes = [c.cs, c.cdr, c.cp, c.cb].filter(Boolean);
  assert.equal(new Set(portes).size, portes.length, 'chaque commandement à une personne différente');
});

test('un chef cumule quand même s il n y a personne d autre', () => {
  // Deux joueurs seulement : la règle « pas de cumul » ne doit pas vider les cases.
  const { compo } = RaidAuto.proposer(vide(),
    [qui('Abarrach', 'transporteur'), qui('Galatea', 'pilote_orni')],
    histo({ Abarrach: { cs: 3 } }));
  assert.equal(compo.commandement.cs, 'Abarrach');
  assert.ok(compo.commandement.cdr, 'le CDR reste désigné faute de mieux');
});

test('personne n est oublié : le reste part en patrouille', () => {
  const { compo } = RaidAuto.proposer(vide(), COMPLET, histo({}));
  const places = new Set();
  ['nord', 'sud', 'est', 'ouest'].forEach(k => places.add(compo.defense[0][k].nom));
  (compo.distance.pilotes || []).forEach(p => places.add(p.nom));
  (compo.recon.scouts || []).forEach(p => places.add(p.nom));
  [compo.recolte[0].transporteur, compo.recolte[0].moissonneur,
   compo.base_avancee.constructeur, compo.base_avancee.buggy].forEach(n => places.add(n));
  COMPLET.forEach(c => assert.ok(places.has(c.name), c.name + ' a disparu de la proposition'));
});

test('deux exécutions identiques donnent le même résultat', () => {
  const h = histo({ PlayGunN: { cardinal: 3 }, Toboe: { cardinal: 3 } });   // ex aequo volontaire
  const a = RaidAuto.proposer(vide(), COMPLET, h).compo;
  const b = RaidAuto.proposer(vide(), COMPLET.slice().reverse(), h).compo;
  assert.deepEqual(a, b, 'l ordre des inscriptions ne doit pas changer la proposition');
});

test('un créneau vide ne fait pas planter la proposition', () => {
  const { compo, journal } = RaidAuto.proposer(vide(), [], histo({}));
  assert.equal(compo.recolte[0].transporteur, '');
  assert.equal(compo.base_avancee.active, false);
  assert.ok(journal.manque.includes('transporteur'));
  assert.deepEqual(compo.distance.pilotes, [{ nom: '', faucon: false, passager: '', cac: false }]);
});
